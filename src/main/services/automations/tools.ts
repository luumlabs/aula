// Herramientas de una revisión automática (AutomationTools.swift y AutomationAgentTools de AutomationRunner.swift).
// Todo en SOLO LECTURA fuera de Aula: la plataforma se lee (nunca se pulsa, escribe, descarga ni se inicia sesión) y solo en
// las direcciones de las cuentas del estudiante; lo que tocaría algo se apunta en `skipped`.
import type { JSONObject, JSONValue } from '@shared/ai/json'
import type { AssistantCard } from '@shared/assistant/types'
import type { HomeSummary } from '@shared/ipc/home'
import type { PackSummary } from '@shared/schema/library'
import { parseISODate } from '@engine/calendar/time'
import { tr } from '@shared/ai/i18n'
import type { Automation, AutomationFinding } from '@shared/automations'
import type { AgentTool } from '../ai'
import type { AutomationPlatformAccount, AutomationPlatforms } from './env'
import type { RoutineEvent } from './routines'
import { actionsCard, cardAction } from './routines'
import { clip } from './texts'

/** Lo que la IA informa al terminar (`report_check`). */
export interface AutomationReport {
  summary: string
  items: AutomationFinding[]
  conditionMet: boolean
  important: boolean
  skipped: string[]
  needsSignIn?: string
}

/** Lo que va pasando en una revisión. */
export class RunLog {
  /** La plataforma pidió iniciar sesión (nombre y cuenta). */
  signIn?: { site: string; accountId: string }
  readonly blocked: string[] = []
  readonly cards: AssistantCard[] = []
  readonly created: string[] = []
  pages = 0
  report?: AutomationReport

  needsSignIn(site: string, accountId: string): void {
    if (!this.signIn) this.signIn = { site, accountId }
  }
  block(what: string): void {
    if (!this.blocked.includes(what) && this.blocked.length < 12) this.blocked.push(what)
  }
}

// MARK: Seguridad

/** Direcciones que empiezan, entregan o borran algo (además de lo que ya vigila el navegador de Aula). */
const RISKY_PATHS = ['/take', '/submit', 'startattempt', 'processattempt', 'attempt.php', 'summary.php', '/submissions', 'record_answer', 'new_quizzes/taking', 'logout',
  '/delete', 'post.php', '/reply', '/compose', '/messages/new', 'editsubmission', 'savesubmission', 'togglecompletion', '/turnin', 'formresponse', 'signout', 'sign_out']

export function riskyURL(url: string): boolean {
  const s = url.toLowerCase()
  return RISKY_PATHS.some((p) => s.includes(p))
}

/** ¿Es de una de las cuentas del estudiante (su dominio o un subdominio)? */
export function accountForURL(url: string, accounts: readonly AutomationPlatformAccount[]): AutomationPlatformAccount | undefined {
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return undefined }
  return accounts.find((a) => {
    try {
      const h = new URL(a.url).hostname.toLowerCase()
      return host === h || host.endsWith('.' + h)
    } catch { return false }
  })
}

// MARK: Argumentos

const str = (v: JSONValue | undefined): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const bool = (v: JSONValue | undefined): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const out = (v: unknown): string => JSON.stringify(v)

function findingFrom(v: JSONValue): AutomationFinding | null {
  if (typeof v === 'string') return v.trim() ? { key: v, title: v, kind: 'other', fresh: false } : null
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as JSONObject
  const title = str(o.title) ?? str(o.name) ?? ''
  const key = str(o.key) ?? (typeof o.id === 'number' ? String(o.id) : str(o.id)) ?? str(o.url) ?? title
  if (!title && !key) return null
  const dueText = str(o.due)
  const due = dueText ? (parseISODate(dueText) ?? (Number.isNaN(Date.parse(dueText)) ? null : new Date(Date.parse(dueText)))) : null
  return {
    key, title: title || key, kind: (str(o.kind) ?? 'other').toLowerCase(), fresh: bool(o.fresh) ?? false,
    ...(str(o.url) ? { url: str(o.url) } : {}), ...(str(o.course) ? { course: str(o.course) } : {}),
    ...(due ? { due: due.toISOString() } : {}), ...(str(o.detail) ? { detail: clip(str(o.detail)!, 200) } : {})
  }
}

// MARK: Herramientas

export interface ToolsContext {
  automation: Automation
  log: RunLog
  /** Eventos del calendario ya leídos (de ayer a dentro de 62 días). */
  events: readonly RoutineEvent[]
  study: HomeSummary | null
  packs: readonly PackSummary[]
  platforms: AutomationPlatforms | null
  accounts: readonly AutomationPlatformAccount[]
  tab: string
  now: Date
  /** Programa un seguimiento (solo con «Aula siempre activa»). Devuelve cuándo quedó. */
  followup?: (draft: { title: string; instruction: string; when: Date }) => Promise<{ id: string; at: string }>
}

export function reportCheckTool(log: RunLog): AgentTool {
  const item = {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'stable id: the platform URL or id of the thing' }, title: { type: 'string' },
      kind: { type: 'string', enum: ['assignment', 'announcement', 'material', 'grade', 'exam', 'class', 'message', 'other'] },
      url: { type: 'string' }, course: { type: 'string', description: 'course name/code as on the platform' },
      due: { type: 'string', description: 'ISO date-time if it has one' }, detail: { type: 'string', description: 'one short line' },
      fresh: { type: 'boolean', description: 'appeared since the last check' }
    },
    required: ['key', 'title']
  }
  return {
    name: 'report_check',
    description: 'Finish the automatic task: report what the student needs to know and everything relevant you found (with stable keys). Call it exactly once, at the end.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'for the student, Markdown, ≤ 120 words, in their language' },
        items: { type: 'array', items: item, description: 'everything relevant found' },
        condition_met: { type: 'boolean', description: 'for «tell me when…» tasks' },
        important: { type: 'boolean', description: 'the student should hear about something now even if not new' },
        skipped: { type: 'array', items: { type: 'string' }, description: 'things you did not do because they would change the platform or need the student' },
        needs_sign_in: { type: 'string', description: 'platform name if its pages asked to sign in' }
      },
      required: ['summary']
    },
    run(args) {
      const items = (Array.isArray(args.items) ? args.items : []).slice(0, 60).map(findingFrom).filter((f): f is AutomationFinding => !!f)
      const skipped = (Array.isArray(args.skipped) ? args.skipped : []).filter((x): x is string => typeof x === 'string').slice(0, 8).map((x) => clip(x, 160))
      log.report = { summary: typeof args.summary === 'string' ? args.summary : '', items, conditionMet: bool(args.condition_met) ?? false, important: bool(args.important) ?? false, skipped, ...(str(args.needs_sign_in) ? { needsSignIn: str(args.needs_sign_in) } : {}) }
      return out({ ok: true, note: 'Reported. You are done: end your turn now without more text.' })
    }
  }
}

function calendarTool(c: ToolsContext): AgentTool {
  return {
    name: 'calendar_events',
    description: "Events of the student's Aula calendar (platform dates, course exams and their own events): id, kind (exam, quiz, assignment, lecture, study, event), title, start, course, url.",
    inputSchema: { type: 'object', properties: { days_ahead: { type: 'number', description: 'default 14, max 60' }, include_past_day: { type: 'boolean', description: 'also yesterday' }, kinds: { type: 'array', items: { type: 'string' } } } },
    run(args) {
      const ahead = Math.min(60, Math.max(1, typeof args.days_ahead === 'number' ? args.days_ahead : 14))
      const from = c.now.getTime() - (args.include_past_day === true ? 86_400_000 : 0)
      const to = c.now.getTime() + ahead * 86_400_000
      const kinds = Array.isArray(args.kinds) ? new Set(args.kinds.filter((k): k is string => typeof k === 'string')) : null
      const list = c.events.filter((e) => e.start.getTime() >= from && e.start.getTime() <= to && (!kinds || kinds.has(e.kind)))
        .slice(0, 80).map((e) => ({ id: e.id, kind: e.kind, title: e.title, start: e.start.toISOString(), all_day: e.allDay, ...(e.course ? { course: e.course } : {}), ...(e.url ? { url: e.url } : {}) }))
      return out({ ok: true, count: list.length, events: list })
    }
  }
}

function studyTool(c: ToolsContext): AgentTool {
  return {
    name: 'study_overview',
    description: "The student's Aula courses: readiness, cards and mistakes due, exam dates, and today's study plan.",
    inputSchema: { type: 'object', properties: {} },
    run() {
      const s = c.study
      if (!s) return out({ ok: true, courses: c.packs.map((p) => ({ course_id: p.id, title: p.title, ...(p.examDate ? { exam: p.examDate } : {}) })) })
      return out({
        ok: true,
        today: { minutes_done: s.today.minutesDone, minutes_goal: s.today.minutesGoal },
        courses: s.courses.map((x) => ({ course_id: x.id, title: x.title, readiness: Math.round(x.readiness * 100) / 100, cards_due: x.dueCards, mistakes_due: x.mistakes, ...(x.examDate ? { exam: x.examDate } : {}) })),
        today_plan: s.plan.filter((p) => !p.done).slice(0, 8).map((p) => ({ course: p.courseTitle, what: p.title, minutes: p.minutes, kind: p.kind }))
      })
    }
  }
}

function platformTools(c: ToolsContext): AgentTool[] {
  const p = c.platforms
  if (!p) return []
  const guard = (url: string): { error: string } | null => {
    if (!/^https?:\/\//i.test(url)) return { error: 'Use a full http(s) address of the student platform.' }
    if (riskyURL(url)) {
      c.log.block(tr(`Abrir ${clip(url, 90)}`, `Open ${clip(url, 90)}`))
      return { error: 'Not allowed in an automatic task: Aula only READS the student platform (never submits, starts, posts, sends, marks or deletes anything). Note it in `skipped` and continue.' }
    }
    if (!accountForURL(url, c.accounts)) return { error: 'Only the addresses of the student platforms are allowed here: ' + c.accounts.map((a) => a.url).join(', ') }
    return null
  }
  const page = async (url: string, fn: () => Promise<{ url: string; title: string; needsLogin: boolean; text: string; nextOffset: number | null }>) => {
    const bad = guard(url)
    if (bad) return out({ ok: false, ...bad })
    let r: Awaited<ReturnType<typeof fn>>
    try {
      r = await fn()
    } catch (err) {
      const code = (err as { code?: unknown }).code
      if (code === 'blocked' || code === 'denied') c.log.block(tr(`Abrir ${clip(url, 90)}`, `Open ${clip(url, 90)}`))
      return out({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
    c.log.pages++
    if (r.needsLogin) {
      const acc = accountForURL(r.url || url, c.accounts)
      c.log.needsSignIn(acc?.label ?? new URL(url).hostname, acc?.id ?? '')
      return out({ ok: false, login_required: true, note: 'The page asks to sign in. Do not try to sign in: stop using this platform and set needs_sign_in in report_check.' })
    }
    return out({ ok: true, url: r.url, title: r.title, next_offset: r.nextOffset, text: r.text })
  }
  return [
    {
      name: 'platform_read',
      description: "Read a page of the student's study platform as text (read-only, with their saved session). Long pages come in chunks: pass `offset` = next_offset to continue.",
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, offset: { type: 'number' } }, required: ['url'] },
      run: (args, ctx) => {
        const url = str(args.url) ?? ''
        return page(url, () => p.read(url, { tab: c.tab, offset: typeof args.offset === 'number' ? Math.max(0, Math.trunc(args.offset)) : undefined, signal: ctx.signal }))
      }
    },
    {
      name: 'platform_links',
      description: "The links of a page of the student's study platform (text and address), to find where things are.",
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: (args, ctx) => {
        const url = str(args.url) ?? ''
        return page(url, () => p.links(url, { tab: c.tab, signal: ctx.signal }))
      }
    }
  ]
}

function offerReviewTool(c: ToolsContext): AgentTool {
  return {
    name: 'offer_review',
    description: 'Propose to the student a fuller review in one of their Aula courses (e.g. a short lesson + practice about today\'s class). The app shows a card with a button; the course pipeline only runs if they press it.',
    inputSchema: { type: 'object', properties: { course_id: { type: 'string' }, title: { type: 'string', description: 'short, e.g. «Repaso de la clase de hoy: límites»' }, instruction: { type: 'string', description: 'precise instruction for the course pipeline' }, why: { type: 'string', description: 'one line for the student' } }, required: ['course_id', 'title', 'instruction'] },
    run(args) {
      const pack = c.packs.find((p) => p.id === str(args.course_id))
      if (!pack) return out({ ok: false, error: `Unknown course. Courses: ${c.packs.map((p) => `${p.id} («${p.title}»)`).join(', ') || 'none'}` })
      const instruction = str(args.instruction)
      if (!instruction) return out({ ok: false, error: "Missing 'instruction'." })
      const title = clip(str(args.title) ?? tr(`Un repaso en «${pack.title}»`, `A review in “${pack.title}”`), 120)
      c.log.cards.push(actionsCard(title, [
        cardAction('extendCourse', tr('Prepararlo en el curso', 'Prepare it in the course'), { symbol: 'refine', prominent: true, value: clip(instruction, 2000), courseID: pack.id }),
        cardAction('ask', tr('Repasarlo aquí juntos', 'Review it here together'), { symbol: 'chat', value: tr(`Hagamos juntos un repaso rápido: ${title}`, `Let's do a quick review together: ${title}`) }),
        cardAction('dismiss', tr('Ahora no', 'Not now'))
      ], { detail: str(args.why) ? clip(str(args.why)!, 200) : undefined, icon: 'refine' }))
      return out({ ok: true, note: 'The student will see a card with a button to create it.' })
    }
  }
}

function followupTool(c: ToolsContext): AgentTool {
  return {
    name: 'schedule_followup',
    description: 'Schedule ONE follow-up check for later (e.g. «check again at 20:00 whether the slides were posted»). Limits apply (it spends from the daily budget for automatic tasks; never during quiet hours or at night).',
    inputSchema: { type: 'object', properties: { when: { type: 'string', description: 'ISO local time, e.g. 2026-10-12T20:00' }, title: { type: 'string' }, what: { type: 'string', description: 'what to check and why' } }, required: ['when', 'title', 'what'] },
    async run(args) {
      const raw = str(args.when) ?? ''
      const t = Date.parse(raw)
      if (Number.isNaN(t)) return out({ ok: false, error: "Invalid 'when' (ISO like 2026-10-12T20:00)." })
      try {
        const r = await c.followup!({ title: str(args.title) ?? c.automation.title, instruction: str(args.what) ?? '', when: new Date(t) })
        c.log.created.push(tr(`Seguimiento: ${str(args.title) ?? c.automation.title}`, `Follow-up: ${str(args.title) ?? c.automation.title}`))
        return out({ ok: true, id: r.id, at: r.at })
      } catch (err) {
        return out({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

/** Las herramientas de esta revisión según lo que puede mirar la automatización. */
export function automationTools(c: ToolsContext): AgentTool[] {
  const a = c.automation
  const tools: AgentTool[] = []
  if (a.capabilities.includes('calendar') || a.capabilities.includes('courses') || a.capabilities.includes('platform')) tools.push(calendarTool(c))
  if (a.capabilities.includes('courses')) tools.push(studyTool(c))
  if (a.capabilities.includes('platform')) tools.push(...platformTools(c))
  if (a.capabilities.includes('study') && a.capabilities.includes('courses')) tools.push(offerReviewTool(c))
  if (c.followup) tools.push(followupTool(c))
  tools.push(reportCheckTool(c.log))
  return tools
}
