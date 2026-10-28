// El centro de punta a punta con una IA y una plataforma simuladas en una carpeta de datos temporal (port de
// AutomationTests.swift y AutomationV2Tests.swift): una asignación nueva se avisa UNA vez, la sesión caducada se avisa sin
// abrir nunca la ventana, recuperación con tope, reintentos, presupuesto, rutinas sin IA, bandeja y seguimientos.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeInstant } from '@engine/calendar/time'
import { emptyUsage, messageText, type ChatMessage, type ChatRequest } from '@shared/ai/types'
import type { AssistantMessage } from '@shared/assistant/types'
import { defaultProactiveSettings, defaultSchedule, routineID, visibleSwift, type AutomationNotice, type ProactiveSettings } from '@shared/automations'
import { AIError, type ChatModel } from '../ai'
import { AutomationCenter } from './center'
import type { AutomationEnvironment, AutomationPlatforms } from './env'
import type { RoutineEvent } from './routines'
import { AutomationStore } from './store'

const TZ = 'Europe/Madrid'
const at = (y: number, m: number, d: number, h: number, min = 0, s = 0) => makeInstant(y, m, d, h, min, s, TZ)

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'aula-auto-center-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

// MARK: Apoyo

/** Una plataforma simulada: tareas que pueden cambiar, sesión que puede caducar. */
class FakePlatform implements AutomationPlatforms {
  tasks = [{ id: 1, title: 'Tarea 1: Límites', due: '2026-10-20T23:59:00+02:00' }, { id: 2, title: 'Tarea 2: Derivadas', due: '2026-10-27T23:59:00+01:00' }]
  loggedIn = true
  log: string[] = []
  readonly base = 'https://campus.test.edu'
  accounts() { return [{ id: 'acc-canvas', label: 'Canvas', kind: 'canvas', url: this.base }] }
  readiness() { return null }
  page(): string {
    return '# MAT101 · Tareas\n' + this.tasks.map((t) => `- [${t.title}](${this.base}/courses/7/assignments/${t.id}) — vence ${t.due}`).join('\n') + `\n\n[Entregar tarea](${this.base}/courses/7/assignments/1/submit)`
  }
  async read(url: string, o: { tab: string }) {
    this.log.push(`read ${new URL(url).pathname} [${o.tab}]`)
    return { url, title: 'Tareas', needsLogin: !this.loggedIn, text: this.loggedIn ? this.page() : 'Inicia sesión: usuario y contraseña', nextOffset: null }
  }
  async links(url: string, o: { tab: string }) { return this.read(url, o) }
  closeTab(tab: string) { this.log.push('close ' + tab) }
}

/** Lee las asignaciones del texto de la página como lo haría la IA. */
function parseAssignments(text: string) {
  return text.split('\n').flatMap((line) => {
    const m = /^- \[(.+?)\]\((.+?)\) — vence (.+)$/.exec(line)
    return m ? [{ key: m[2], title: m[1], kind: 'assignment', url: m[2], due: m[3] }] : []
  })
}

type Step = { calls?: { name: string; args: Record<string, unknown> }[]; text?: string; usage?: number }

/** Un modelo con guion: cada paso puede pedir herramientas o responder. */
function scripted(fn: (req: ChatRequest, toolResults: string[], step: number) => Step | Error, seen: string[] = []): ChatModel {
  return {
    providerId: 'fake', providerName: 'IA simulada', kind: 'openai-compatible', model: 'aula-fake',
    capabilities: { tools: true, vision: false, streaming: false, jsonMode: true, contextWindow: 200_000, reasoning: null },
    async complete(req) {
      const step = req.messages.filter((m) => m.role === 'assistant').length
      if (step === 0) seen.push(messageText(req.messages[req.messages.length - 1]))
      const results = req.messages.filter((m) => m.role === 'tool').map(messageText)
      const r = fn(req, results, step)
      if (r instanceof Error) throw r
      const message: ChatMessage = { role: 'assistant', content: r.text ? [{ type: 'text', text: r.text }] : [], ...(r.calls ? { toolCalls: r.calls.map((c, i) => ({ id: `call-${step}-${i}`, name: c.name, arguments: c.args as never })) } : {}) }
      return { message, usage: { ...emptyUsage(), promptTokens: r.usage ?? 500, completionTokens: r.usage !== undefined ? 0 : 100 }, finish: r.calls ? 'toolCalls' : 'stop' }
    }
  }
}

/** La IA que revisa la plataforma simulada (intenta también abrir «Entregar», que nunca se abre). */
function checker(seen: string[] = []): ChatModel {
  return scripted((_req, results, step) => {
    if (step === 0) return { calls: [{ name: 'platform_read', args: { url: 'https://campus.test.edu/courses/7/assignments' } }, { name: 'platform_read', args: { url: 'https://campus.test.edu/courses/7/assignments/1/submit' } }] }
    if (step === 1) {
      const page = JSON.parse(results[0]) as { ok: boolean; text?: string; login_required?: boolean }
      if (!page.ok) return { calls: [{ name: 'report_check', args: { summary: 'No pude entrar en Canvas.', items: [], needs_sign_in: 'Canvas' } }] }
      const items = parseAssignments(page.text ?? '')
      return { calls: [{ name: 'report_check', args: { summary: `Hay ${items.length} tareas en MAT101.`, items, skipped: ['Entregar la tarea 1'] } }] }
    }
    return { text: 'hecho' }
  }, seen)
}

/** La IA que solo informa (con el título de la automatización en el resumen). */
function reporter(summary: (title: string) => string = (t) => `Resumen de ${t}`, ran: string[] = [], usage = 500): ChatModel {
  return scripted((req, _r, step) => {
    if (step === 0) {
      const prompt = messageText(req.messages[req.messages.length - 1])
      const title = /«([^»]+)»/.exec(prompt)?.[1] ?? '?'
      ran.push(prompt.includes('LATE') ? `late:${title}` : title)
      return { calls: [{ name: 'report_check', args: { summary: summary(title), items: [] } }], usage }
    }
    return { text: 'ok', usage: 1 }
  })
}

class Env implements AutomationEnvironment {
  now = 0
  model_: ChatModel | null = null
  platform: FakePlatform | null = null
  events_: RoutineEvent[] = []
  chats: { thread: string; message: AssistantMessage }[] = []
  notices: AutomationNotice[] = []
  withdrawn: string[] = []
  timeZone() { return TZ }
  async events(from: Date, to: Date) { return this.events_.filter((e) => e.start >= from && e.start <= to) }
  packs() { return [] }
  packIDForEvent() { return undefined }
  async studySummary() { return null }
  async model() { return this.model_ }
  language(): 'es' { return 'es' }
  platforms() { return this.platform }
  chat() { return { postSystemMessage: (thread: string, message: AssistantMessage) => { this.chats.push({ thread, message }); return message.id } } }
  notify(n: AutomationNotice) { this.notices.push(n) }
  withdraw(ids: string[]) { this.withdrawn.push(...ids) }
}

function setup(start: number) {
  const env = new Env()
  env.now = start
  const center = new AutomationCenter({ store: new AutomationStore(root), env, clock: () => env.now })
  const run = async (t: number) => { env.now = t; await center.tick(); await center.waitIdle() }
  return { env, center, run }
}

const quietOff = (): ProactiveSettings => ({ ...defaultProactiveSettings(), enabled: true, quiet: { enabled: false, from: '22:30', to: '07:30' }, morningBrief: false, platformCheck: false, deadlineReminders: false, examOffers: false, weeklySummary: false })
const ev = (id: string, title: string, kind: string, start: number, course?: string): RoutineEvent => ({ id, title, kind, start: new Date(start), allDay: false, ...(course ? { course } : {}), origin: 'own' })

// MARK: Pruebas

describe('una revisión completa', () => {
  it('aparece una asignación nueva → se avisa una sola vez; la sesión caducada, sin abrir nunca la ventana', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 7, 55))
    const prompts: string[] = []
    env.model_ = checker(prompts)
    env.platform = new FakePlatform()
    const item = await center.save({ title: 'Revisar Canvas', instruction: 'Mira si hay asignaciones nuevas en MAT101 y avísame.', schedule: { ...defaultSchedule('daily'), times: ['08:00'] }, capabilities: ['platform', 'calendar', 'courses'], notify: 'news', untilFound: false })
    expect(item.nextRun).toBe(new Date(at(2026, 10, 12, 8)).toISOString())

    // 8:00 — primera revisión: aprende lo que hay (2 tareas), sin notificación y ya leída
    await run(at(2026, 10, 12, 8, 0, 20))
    expect(env.chats.length).toBe(1)
    expect(env.notices.length).toBe(0)
    expect(env.chats[0].message.origin?.title).toBe('Automatización: Revisar Canvas')
    expect(env.chats[0].thread).toBe('aula-novedades')
    let runs = center.runs(item.automation.id)
    expect([runs[0].outcome, runs[0].knownCount]).toEqual(['nothingNew', 2])
    expect(runs[0].tokens).toBeGreaterThan(0)
    expect(runs[0].skippedActions.some((s) => s.includes('submit'))).toBe(true) // «Entregar» ni se abrió
    expect(env.platform.log.filter((l) => l.includes('/submit'))).toEqual([])
    expect(env.platform.log.every((l) => l.includes('[automation-') || l.startsWith('close automation-'))).toBe(true)
    expect(center.inboxEntries()[0].read).toBe(true)
    expect(prompts[0]).toContain('FIRST check')

    // aparece una asignación nueva; al día siguiente a las 8:00 → novedad y UNA notificación
    env.platform.tasks.push({ id: 3, title: 'Tarea 3: Integrales', due: '2026-11-03T23:59:00+01:00' })
    await run(at(2026, 10, 13, 8, 0, 10))
    expect(env.notices.length).toBe(1)
    const n = env.notices[0]
    expect([n.title, n.subtitle, n.kind, n.level]).toEqual(['Tarea 3: Integrales', 'Asignación nueva', 'platform', 'active'])
    expect(n.body).toContain('¿La organizamos juntos?')
    const entry = center.inboxEntries().find((e) => e.id === n.entryID)!
    expect(entry.title).toBe('1 asignación nueva: «Tarea 3: Integrales»')
    expect(entry.read).toBe(false)
    const msg = env.chats[env.chats.length - 1].message
    expect(msg.cards.some((c) => c.kind === 'actions' && c.title.includes('Tarea 3'))).toBe(true)
    expect(msg.cards[0].actions.some((a) => a.kind === 'ask')).toBe(true)
    runs = center.runs(item.automation.id)
    expect(runs[0].outcome).toBe('news')
    expect(runs[0].newItems.map((f) => f.title)).toEqual(['Tarea 3: Integrales'])
    expect(prompts[1]).toContain('Already known')

    // al otro día, nada nuevo: no vuelve a avisar
    await run(at(2026, 10, 14, 8, 0, 5))
    expect(env.notices.length).toBe(1)
    expect(env.chats.length).toBe(3)

    // la sesión caduca: avisa «Inicia sesión otra vez» y nunca abre la ventana por su cuenta
    env.platform.loggedIn = false
    await run(at(2026, 10, 15, 8, 0, 5))
    const last = env.chats[env.chats.length - 1].message
    expect(last.cards.some((c) => c.actions.some((a) => a.kind === 'signIn' && a.value === 'acc-canvas'))).toBe(true)
    expect(env.notices[env.notices.length - 1].title).toBe('Inicia sesión otra vez en Canvas')
    expect(center.runs(item.automation.id)[0].outcome).toBe('needsSignIn')
    const snap = await center.snapshot()
    expect(snap.health.some((h) => h.kind === 'signIn' && h.site === 'Canvas')).toBe(true)
  })
})

describe('el planificador en marcha', () => {
  it('al despertar, como mucho 3 recuperaciones por minuto (y la IA sabe que va tarde)', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 7))
    const ran: string[] = []
    env.model_ = reporter(undefined, ran)
    for (let i = 1; i <= 5; i++) await center.save({ title: `Tarea ${i}`, instruction: 'x', schedule: { ...defaultSchedule('daily'), times: ['08:00'] }, capabilities: ['courses'], notify: 'news', untilFound: false })
    await run(at(2026, 10, 12, 9, 30))
    expect(ran.length).toBe(3)
    await run(at(2026, 10, 12, 9, 30, 20))
    expect(ran.length).toBe(3)
    await run(at(2026, 10, 12, 9, 31, 31))
    expect(ran.length).toBe(5)
    expect(ran.every((r) => r.startsWith('late:'))).toBe(true)
    await run(at(2026, 10, 12, 9, 33))
    expect(ran.length).toBe(5)
    expect((await center.items()).every((i) => i.lastOutcome === 'nothingNew')).toBe(true)
  })

  it('reintenta con espera tras un fallo pasajero y avisa una vez de lo que no tiene arreglo solo', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 9, 59))
    let attempts = 0
    env.model_ = scripted((_r, _t, step) => {
      if (step === 0) { attempts++; if (attempts === 1) return new AIError('network', 'sin conexión') }
      return step === 0 ? { calls: [{ name: 'report_check', args: { summary: 'Todo bien.', items: [] } }] } : { text: 'ok' }
    })
    const a = await center.save({ title: 'Plan', instruction: 'x', schedule: { ...defaultSchedule('interval'), everyHours: 1 }, capabilities: ['courses'], notify: 'news', untilFound: false })
    await run(at(2026, 10, 12, 10, 0, 10))
    let st = (await center.item(a.automation.id))!
    expect(st.retryAt).toBe(new Date(at(2026, 10, 12, 10, 5, 10)).toISOString())
    expect(env.chats.length).toBe(0)
    await run(at(2026, 10, 12, 10, 6))
    st = (await center.item(a.automation.id))!
    expect(attempts).toBe(2)
    expect([st.retryAt, st.consecutiveFailures]).toEqual([undefined, 0])
    // sin IA: un mensaje (no se repite) y sin reintento
    env.model_ = null
    await run(at(2026, 10, 12, 11, 0, 5))
    await run(at(2026, 10, 12, 12, 0, 5))
    const failures = env.chats.filter((c) => c.message.text.startsWith('No pude hacer'))
    expect(failures.length).toBe(1)
    expect(env.notices.some((n) => n.kind === 'problem')).toBe(true) // sin arreglo solo: también notificación
    st = (await center.item(a.automation.id))!
    expect([st.retryAt, st.consecutiveFailures]).toEqual([undefined, 2])
  })

  it('el presupuesto diario para las revisiones (también a mitad) y avisa una vez', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 9, 59))
    env.model_ = reporter(() => 'Revisado.', [], 1200)
    await center.setProactive({ ...quietOff(), enabled: false, dailyTokenLimit: 10_000 })
    const a = await center.save({ title: 'Cada hora', instruction: 'x', schedule: { ...defaultSchedule('interval'), everyHours: 1 }, capabilities: ['courses'], notify: 'news', untilFound: false })
    for (let h = 10; h <= 21; h++) await run(at(2026, 10, 12, h, 0, 5))
    const runs = center.runs(a.automation.id)
    const ok = runs.filter((r) => r.outcome === 'nothingNew').length
    expect(ok).toBeGreaterThanOrEqual(5)
    expect(runs.filter((r) => r.outcome === 'budget').length).toBe(12 - ok)
    expect(env.chats.filter((c) => c.message.text.includes('presupuesto')).length).toBe(1)
    const snap = await center.snapshot()
    expect(snap.usageToday).toBeLessThanOrEqual(10_000 + 2500) // el tope es real: se corta a mitad
    expect(snap.budget.exhausted).toBe(true)
    await run(at(2026, 10, 13, 8, 0, 5))
    expect(center.runs(a.automation.id)[0].outcome).toBe('nothingNew')
  })
})

describe('«Aula siempre activa»', () => {
  it('rutinas sin IA: bienvenida, examen sin preparar, resumen de la mañana y recordatorios', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 10))
    env.events_ = [ev('own:ensayo', 'Ensayo de inglés', 'assignment', at(2026, 10, 13, 12), 'ENG1101'), ev('own:parcial', 'Parcial de Química', 'exam', at(2026, 10, 21, 9), 'QUI110')]
    await center.setProactive({ ...defaultProactiveSettings(), enabled: true })
    await center.waitIdle()
    expect(env.chats[0].message.text).toContain('Aula siempre activa está encendida')
    expect(env.chats[0].message.text).toContain('solo leo')
    const offer = env.chats.find((c) => c.message.cards.some((k) => k.actions.some((x) => x.kind === 'prepareCourse' && x.value === 'own:parcial')))
    expect(offer?.message.text).toContain('Parcial de Química')
    expect(env.notices.some((n) => n.title === '¿Preparo «Parcial de Química»?')).toBe(true)
    expect(new Set((await center.items()).map((i) => i.automation.routine))).toEqual(new Set(['morningBrief', 'platformCheck', 'deadlineReminders', 'examOffers', 'weeklySummary']))
    // la oferta no se repite; sin IA, el resumen de la mañana sale igual
    await run(at(2026, 10, 13, 7, 46, 30))
    expect(env.chats.filter((c) => c.message.cards.some((k) => k.actions.some((x) => x.kind === 'prepareCourse'))).length).toBe(1)
    expect(env.chats.some((c) => c.message.origin?.title === 'Rutina de la mañana' && c.message.text.includes('Ensayo de inglés'))).toBe(true)
    // 2 h antes de la entrega: recordatorio con la propuesta de hacerlo juntos y la nota de integridad
    const before = env.chats.length
    await run(at(2026, 10, 13, 10, 0, 30))
    const reminders = env.chats.slice(before).filter((c) => c.message.origin?.kind === 'reminder')
    expect(reminders.length).toBe(1)
    expect(reminders[0].message.text).toContain('Ensayo de inglés')
    expect(reminders[0].message.text).toContain('la entrega la escribes y la envías tú')
    expect(env.notices[env.notices.length - 1].level).toBe('timeSensitive')
    expect(env.notices[env.notices.length - 1].group).toBe('reminder.eng1101')
    await run(at(2026, 10, 13, 10, 5))
    expect(env.chats.slice(before).filter((c) => c.message.origin?.kind === 'reminder').length).toBe(1)
    // apagar una rutina la apaga; apagar el modo, las que usan IA (las ligeras siguen con la app abierta)
    await center.setEnabled(routineID('weeklySummary'), false)
    expect(center.proactiveSettings().weeklySummary).toBe(false)
    await center.setProactive({ ...center.proactiveSettings(), enabled: false })
    const routines = (await center.items()).filter((i) => i.automation.routine)
    expect(routines.filter((i) => i.automation.enabled).map((i) => i.automation.routine).sort()).toEqual(['deadlineReminders', 'examOffers'])
  })

  it('A4-P1-1: el examen del curso de ejemplo no sale en el resumen de la mañana', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 10))
    const sample: RoutineEvent = { ...ev('course:exam-2-math112', 'Exam #2 — Trigonometry', 'exam', at(2026, 10, 14, 9)), origin: 'course', packID: 'exam-2-math112' }
    env.events_ = [sample, ev('own:parcial', 'Parcial de Química', 'exam', at(2026, 10, 15, 9), 'QUI110')]
    await center.setProactive({ ...quietOff(), morningBrief: true })
    await run(at(2026, 10, 13, 7, 46, 30))
    const brief = env.chats.find((c) => c.message.origin?.title === 'Rutina de la mañana')
    expect(brief?.message.text).toContain('Parcial de Química')
    expect(env.chats.some((c) => c.message.text.includes('Trigonometry'))).toBe(false)
  })

  it('con el modo apagado y cero configuración, los recordatorios de entregas siguen llegando', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 9))
    env.events_ = [ev('own:e', 'Práctica 2', 'assignment', at(2026, 10, 12, 23, 59))]
    center.start()
    center.stop()
    expect((await center.items()).map((i) => i.automation.id).sort()).toEqual([routineID('deadlineReminders'), routineID('examOffers')])
    await run(at(2026, 10, 12, 21, 59, 30))
    expect(env.chats.filter((c) => c.message.origin?.kind === 'reminder').length).toBe(1)
    expect(env.notices[0]?.kind).toBe('reminder')
  })

  it('el resumen de la mañana llega aunque la IA falle', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 7, 40))
    env.model_ = scripted(() => new AIError('network', 'Sin conexión con el proveedor'))
    await center.setProactive({ ...quietOff(), morningBrief: true })
    await run(at(2026, 10, 12, 7, 45, 10))
    const morningMsg = env.chats.find((c) => c.message.origin?.title === 'Rutina de la mañana')!
    expect(morningMsg.message.text.startsWith('¡Buenos días!')).toBe(true)
    expect(morningMsg.message.notices[0]).toContain('Tu proveedor de IA no respondió')
    const st = await center.item(routineID('morningBrief'))
    expect(st?.retryAt).toBeUndefined()
  })

  it('seguimientos de la IA: límites, silencio y madrugada', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 15))
    await expect(center.scheduleFollowup({ title: 'x', instruction: 'y', when: new Date(at(2026, 10, 12, 20)) })).rejects.toThrow()
    await center.setProactive({ ...defaultProactiveSettings(), enabled: true, maxFollowupsPerDay: 2, examOffers: false, quiet: { enabled: true, from: '22:30', to: '07:30' } })
    const a = await center.scheduleFollowup({ title: '¿Subió las diapositivas?', instruction: 'Mira si hay diapositivas nuevas', when: new Date(at(2026, 10, 12, 20)), threadID: 't-1' })
    expect(a.nextRun).toBe(new Date(at(2026, 10, 12, 20)).toISOString())
    expect([a.automation.origin, a.automation.threadID]).toEqual(['aula', 't-1'])
    const b = await center.scheduleFollowup({ title: 'Tarde', instruction: 'z', when: new Date(at(2026, 10, 12, 23, 30)) })
    expect(b.nextRun).toBe(new Date(at(2026, 10, 13, 7, 30)).toISOString())
    await expect(center.scheduleFollowup({ title: 'otro', instruction: 'z', when: new Date(at(2026, 10, 12, 18)) })).rejects.toThrow(/Daily limit/)
    expect(center.followupsLeft()).toBe(0)
    env.now = at(2026, 10, 13, 12)
    await center.setProactive({ ...center.proactiveSettings(), quiet: { enabled: false, from: '22:30', to: '07:30' } })
    const c = await center.scheduleFollowup({ title: 'Noche', instruction: 'z', when: new Date(at(2026, 10, 14, 3)) })
    expect(c.nextRun).toBe(new Date(at(2026, 10, 14, 6)).toISOString())
    await expect(center.scheduleFollowup({ title: 'lejos', instruction: 'z', when: new Date(at(2026, 11, 30, 12)) })).rejects.toThrow()
    await center.pause(at(2026, 10, 14, 0))
    await run(at(2026, 10, 13, 12, 1))
    expect(env.chats.filter((x) => x.message.origin?.automationID === c.automation.id)).toEqual([])
  })
})

describe('bandeja en el centro', () => {
  it('leer, posponer (y volver con aviso), archivar y despejar; todo se guarda', async () => {
    const { env, center, run } = setup(at(2026, 10, 12, 10))
    env.events_ = [ev('own:ensayo', 'Ensayo de inglés', 'assignment', at(2026, 10, 13, 12), 'ENG1101')]
    await center.setProactive({ ...quietOff(), deadlineReminders: true })
    await center.waitIdle()
    const welcome = center.inboxEntries().find((e) => e.kind === 'system')!
    expect(center.unread()).toBe(1)
    await run(at(2026, 10, 13, 10, 0, 30))
    const reminder = center.inboxEntries().find((e) => e.kind === 'reminder' && e.priority === 2)!
    expect([reminder.course, reminder.notified]).toEqual(['ENG1101', true])
    const n = env.notices[env.notices.length - 1]
    expect([n.level, n.entryID, n.group, n.subtitle]).toEqual(['timeSensitive', reminder.id, 'reminder.eng1101', 'ENG1101'])
    expect(reminder.message?.text).toContain('Ensayo de inglés') // el mensaje entero, también en la entrada
    // el de 24 h también salió (recuperado): se lee para dejar solo el de 2 h
    center.markRead(center.inboxEntries().filter((e) => e.kind === 'reminder' && e.id !== reminder.id).map((e) => e.id))
    expect(center.markRead([welcome.id])).toEqual([welcome.id])
    expect(env.withdrawn).toContain(welcome.id) // su notificación se quita
    center.snooze([reminder.id], env.now + 3_600_000)
    expect(center.unread()).toBe(0)
    expect(visibleSwift(center.inboxEntries(), 'snoozed', env.now).map((e) => e.id)).toEqual([reminder.id])
    await run(env.now + 3_601_000)
    const back = center.inboxEntries().find((e) => e.id === reminder.id)!
    expect([back.resurfaced, back.read, back.snoozedUntil]).toEqual([true, false, undefined])
    expect(env.notices[env.notices.length - 1].subtitle).toBe('Lo pospusiste: vuelve ahora')
    expect(center.unread()).toBe(1)
    center.archive([reminder.id])
    expect(center.unread()).toBe(0)
    center.archive([reminder.id], false)
    center.markRead([reminder.id], false)
    expect(center.markAllRead()).toEqual([reminder.id])
    expect(center.archiveRead().length).toBe(center.inboxEntries().length)
    const disk = new AutomationStore(root).inbox()!
    expect(disk.every((e) => e.archived)).toBe(true)
  })

  it('lo idéntico no se deja dos veces el mismo día', async () => {
    const { env, center } = setup(at(2026, 10, 12, 9))
    env.model_ = reporter(() => 'Nada nuevo en Canvas.')
    const a = await center.save({ title: 'Canvas', instruction: 'x', schedule: { ...defaultSchedule('daily'), times: ['20:00'] }, capabilities: ['courses'], notify: 'always', untilFound: false })
    center.runNow(a.automation.id)
    await center.waitIdle()
    env.now += 600_000
    center.runNow(a.automation.id)
    await center.waitIdle()
    expect(center.runs(a.automation.id).length).toBe(2)
    expect(center.inboxEntries().length).toBe(1)
  })
})
