// Herramientas que hablan con el estudiante o cambian algo (port de AssistantTools.swift): preguntar con opciones, enseñar
// tarjetas, abrir pantallas, crear y cambiar cursos, el calendario, la fecha del examen y guardar tarjetas de repaso. Todo lo que
// cambia algo pide permiso con una tarjeta y lo que cambia queda en el historial del turno (deshacer en «Cambios de Aula»).
import { clip, foldPlain, isDateOnly, isoLocal, parseDate, parseRef } from '@engine/assistant'
import { parseRuleText, type AssistantCalendarEvent, type AssistantEventDraft } from '@engine/calendar'
import { AppLanguage } from '@engine/base/language'
import { settingsPath } from '@shared/settings/sections'
import { IDs } from '@engine/base/ids'
import { tr } from '@shared/ai/i18n'
import type { JSONObject } from '@shared/ai/json'
import type { AssistantFact, AssistantOption } from '@shared/assistant/types'
import { decodeFlashcard, type ExamInfo, type SourceMeta } from '@shared/schema'
import type { AgentTool } from '../../ai/model'
import { ASSISTANT_SCREENS, type AssistantScreen, type GenerationDepth, type ToolEnv } from '../host'
import { newCard } from '../models'
import { outError, outJSON, Schema, tool, type ToolArgs } from '../toolkit'
import { approval, courseArg, enrichRef, fact, findCourse, showItems, unknownCourse, when } from './common'
import { eventJSON } from './read'

// MARK: Preguntar y enseñar

export function askUserTool(env: ToolEnv): AgentTool {
  return tool('ask_user',
    'Ask the student ONE short question and wait for the answer, with optional quick-reply options shown as buttons (2–5). Options can point to things in the app with `ref` (from find_items) — use that for "¿Te refieres a esto?" confirmations. They can also type a different answer. Use it when you need a decision to continue (time of the exam, quick vs. thorough course, which lesson they mean).',
    Schema.object([
      ['question', Schema.string()],
      ['options', Schema.array(Schema.object([['label', Schema.string()], ['detail', Schema.string('optional one-line explanation')], ['ref', Schema.free()]], ['label'], true), '2–5 options; each a label (or {label, detail, ref})')],
      ['allow_other', Schema.boolean('let them type another answer (default true)')]
    ], ['question']),
    async (a) => {
      const q = a.string('question', ['text', 'prompt'])
      if (!q) return outError("Missing 'question'.")
      const opts: AssistantOption[] = (a.array('options', ['choices']) ?? []).slice(0, 6).flatMap((v): AssistantOption[] => {
        if (typeof v === 'string') return v.trim() ? [{ id: IDs.short(5), label: v }] : []
        if (!v || typeof v !== 'object' || Array.isArray(v)) return []
        const o = v as JSONObject
        const ref = parseRef(o.ref)
        const label = (typeof o.label === 'string' && o.label) || (typeof o.title === 'string' && o.title) || ref?.title
        if (!label) return []
        const opt: AssistantOption = { id: IDs.short(5), label }
        const detail = typeof o.detail === 'string' ? o.detail : typeof o.subtitle === 'string' ? o.subtitle : undefined
        if (detail) opt.detail = detail
        if (ref) opt.ref = enrichRef(env, ref)
        return [opt]
      })
      const card = newCard('question', q, { options: opts, allowsOther: a.bool('allow_other') ?? true, icon: 'questionmark.bubble' })
      const ans = await env.io.ask(card)
      switch (ans.kind) {
        case 'option': {
          const o = opts[ans.index]
          if (!o) break
          const out: JSONObject = { ok: true, answer: o.label, option_index: ans.index }
          if (o.ref) out.ref = refJSONOf(o.ref)
          return outJSON(out)
        }
        case 'typed': return outJSON({ ok: true, answer: ans.text, typed: true })
        case 'approved': return outJSON({ ok: true, answer: 'yes' })
        case 'denied': return outJSON({ ok: true, answer: 'no' })
        default: break
      }
      return outJSON({ ok: false, answer: null, note: 'No answer yet. End your turn with the question in plain text; they will reply later.' })
    })
}

function refJSONOf(r: NonNullable<AssistantOption['ref']>): JSONObject {
  const o: JSONObject = { kind: r.kind, title: r.title }
  if (r.courseID) o.course_id = r.courseID
  const key = r.kind === 'course' ? 'course_id' : r.kind === 'lesson' ? 'skill_id' : r.kind === 'exercise' ? 'exercise_id' : r.kind === 'material' ? 'source_id' : 'event_id'
  if (r.itemID) o[key] = r.itemID
  if (r.skillID && r.kind === 'exercise') o.skill_id = r.skillID
  return o
}

export function showItemsTool(env: ToolEnv): AgentTool {
  return tool('show_items',
    'Show tappable cards (with an Open button) for courses, lessons, exercises, materials or events in your reply — e.g. after listing their courses or recommending what to study. Never use it to answer a question: write the answer first, cards are an optional extra. Each item is a `ref` from find_items (kind + ids + title). Does not navigate by itself.',
    Schema.object([['title', Schema.string('optional heading')], ['items', Schema.array(Schema.free(), 'refs from find_items / list_courses (kind, course_id, skill_id/exercise_id/source_id/event_id, title, subtitle)')]], ['items']),
    (a) => {
      const refs = (a.array('items', ['refs']) ?? []).slice(0, 12).flatMap((v) => { const r = parseRef(v); return r ? [enrichRef(env, r)] : [] })
      if (!refs.length) return outError('No valid items. Each needs kind and ids (use find_items).')
      showItems(env, a.string('title') ?? '', refs)
      return outJSON({ ok: true, shown: refs.length })
    })
}

// MARK: Navegar

/** Las herramientas de la app (ids de tools/registry.ts en la interfaz). */
const APP_TOOLS = ['calculator', 'grapher', 'periodic', 'chemistry', 'molecules', 'units', 'timer', 'stats', 'matrix', 'geometry', 'physics', 'formulas'] as const
const TOOL_ALIASES: Record<string, string> = { graphing: 'grapher', graph: 'grapher', calc: 'calculator', table: 'periodic', unit: 'units', converter: 'units', pomodoro: 'timer', statistics: 'stats', matrices: 'matrix' }
/** El id de la herramienta que entiende la interfaz (acepta los nombres parecidos que use el modelo). */
export function appTool(raw: string): string {
  const k = raw.trim().toLowerCase()
  return TOOL_ALIASES[k] ?? k
}

export function openScreenTool(env: ToolEnv): AgentTool {
  return tool('open_screen',
    "Open a screen of the app for the student (this takes them out of the chat): home, today (what's due), stats, calendar, settings, create_course (the course wizard), a course (overview), a lesson (optionally at a `step`), practice (a lesson or their weakest), cards (flashcard review), exam (mock exam), mistakes, materials, reference (glossary/formulas), exercise (practise one exercise), tool (one of the app's tools: calculator, grapher, periodic table, chemistry, molecules, units, timer, stats, matrix, geometry, physics, formulas) or run (progress of a course being created). Only when they ask to go somewhere or to start studying; otherwise prefer show_items.",
    Schema.object([
      ['screen', Schema.string(undefined, ASSISTANT_SCREENS)], ['course_id', Schema.string()], ['skill_id', Schema.string()], ['exercise_id', Schema.string()],
      ['tool', Schema.string(undefined, [...APP_TOOLS])], ['settings_pane', Schema.string('for settings: general, ai, platforms, memory, data')],
      ['step', Schema.integer('lesson: open it at this step (1 = first; the steps of the lesson reader)', 1)]
    ], ['screen']),
    async (a) => {
      const raw = (a.string('screen') ?? '').toLowerCase()
      if (!(ASSISTANT_SCREENS as readonly string[]).includes(raw)) return outError(`Unknown screen. Use one of: ${ASSISTANT_SCREENS.join(', ')}.`)
      const screen = raw as AssistantScreen
      let courseID = courseArg(env, a)
      if (courseID) {
        const c = findCourse(env, courseID)
        if (!c) return unknownCourse(env, courseID)
        courseID = c.pack.id
      }
      const needsCourse: AssistantScreen[] = ['course', 'lesson', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference', 'exercise', 'run']
      if (needsCourse.includes(screen) && !courseID) return outError('This screen needs course_id.')
      const target = { screen, ...(courseID ? { courseID } : {}), ...(a.string('skill_id') ? { skillID: a.string('skill_id')! } : {}),
        ...(a.string('exercise_id') ? { exerciseID: a.string('exercise_id')! } : {}), ...(a.string('tool') ? { tool: appTool(a.string('tool')!) } : {}),
        ...(a.string('settings_pane') ? { settingsPane: a.string('settings_pane')! } : {}), ...(a.int('step') !== undefined ? { step: Math.max(0, a.int('step')! - 1) } : {}) }
      if (env.control?.open) {
        const note = await env.control.open(target)
        if (note) return outError(note)
      } else if (env.navigate) env.navigate(target)
      else return outError('Navigation is not available here.')
      return outJSON({ ok: true, opened: screen, note: 'The screen is open; the chat stays available. Keep your reply to one short line.' })
    })
}

// MARK: Crear y cambiar cursos

function depthOf(raw: string | undefined): GenerationDepth {
  switch (foldPlain(raw ?? '').trim()) {
    case 'quick': case 'fast': case 'rapido': case 'short': case 'light': case 'express': return 'quick'
    case 'deep': case 'thorough': case 'a fondo': case 'fondo': case 'serious': case 'serio': case 'complete': case 'completo': case 'full': return 'deep'
    default: return 'standard'
  }
}

function depthTitle(d: GenerationDepth): string {
  return d === 'quick' ? tr('Rápido · lo esencial', 'Quick · the essentials') : d === 'deep' ? tr('A fondo', 'In depth') : tr('Completo', 'Complete')
}

/** Lo que el estudiante adjuntó a esta conversación y ya se puede leer. */
export function attachmentSources(env: ToolEnv): SourceMeta[] {
  try { return env.filesHandle().loadPack().sources.filter((s) => s.status === 'ready') } catch { return [] }
}

/** Texto libre que va al equipo o se guarda (notas, temas…), recortado para la tarjeta; si lleva direcciones, una línea con sus
 * sitios para que se vean aunque el texto se recorte (A2-P1-1, A2-P2-8). */
export function freeTextFacts(items: Array<[string, string | undefined]>, max = 300): AssistantFact[] {
  const out: AssistantFact[] = []
  const hosts = new Set<string>()
  for (const [label, raw] of items) {
    const text = raw?.trim()
    if (!text) continue
    out.push(fact(label, clip(text, max)))
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'«»()[\]{}]+/gi)) {
      try { hosts.add(new URL(m[0]).hostname) } catch { /* no es una dirección */ }
    }
  }
  if (hosts.size) out.push(fact(tr('Enlaces', 'Links'), [...hosts].slice(0, 5).join(', ') + (hosts.size > 5 ? '…' : '')))
  return out
}

export function createCourseTool(env: ToolEnv): AgentTool {
  return tool('create_course',
    "Create a new Aula course and start building it with the course pipeline (lessons, practice, flashcards, mock exam; answers are verified). depth: quick (essentials, ~10 min, good if the exam is very soon), standard (complete course) or deep (more lessons and practice; slower). Set search_platform=true to have Aula first look for the materials on the student's study platform (Canvas, Moodle…) with its own browser — only possible if app info says a platform is configured. Files attached to this chat are added as materials unless use_attachments=false. The app shows a confirmation card; you don't need to ask in text first. Ask before calling if you don't know what the course is for.",
    Schema.object([
      ['title', Schema.string('short course title, e.g. «Inglés · prueba del lunes»')], ['subject', Schema.string()], ['depth', Schema.string(undefined, ['quick', 'standard', 'deep'])],
      ['exam_title', Schema.string()], ['exam_date', Schema.string('ISO')], ['goal', Schema.string('what they want to achieve')], ['topics', Schema.string('syllabus / what the exam covers, as they said it')],
      ['notes', Schema.string('format, allowed aids, preferences')], ['language', Schema.string("course language code (es, en…); default the app's")], ['search_platform', Schema.boolean()],
      ['platform_course', Schema.string('the course name/code as it appears on the platform')], ['focus', Schema.string('what to look for on the platform')], ['use_attachments', Schema.boolean('default true')]
    ], ['title']),
    async (a) => {
      const title = a.string('title')?.trim()
      if (!title) return outError("Missing 'title'.")
      const info = env.control ? await env.control.appInfo() : undefined
      const depth = depthOf(a.string('depth'))
      const examDate = a.string('exam_date') ? parseDate(a.string('exam_date')!) : undefined
      const files = (a.bool('use_attachments') ?? true) ? attachmentSources(env) : []
      const wantsPlatform = a.bool('search_platform') ?? false
      const canPlatform = !!info && info.computerUseEnabled && info.platforms.length > 0
      // sin el equipo que crea cursos, el estudiante lo termina en la pantalla de crear curso (ya rellena)
      if (!env.team) {
        const actions = [{ id: IDs.short(6), kind: 'prepareCourse' as const, label: tr('Preparar el curso', 'Prepare the course'), prominent: true, value: title }]
        env.io.show(newCard('actions', tr(`Crear «${title}»`, `Create “${title}”`), {
          detail: tr('Ábrelo en «Crear curso» para elegir los materiales y empezar.', 'Open it in “Create course” to pick the materials and start.'), state: 'pending', icon: 'plus.rectangle.on.rectangle', actions, allowsOther: false
        }))
        return outJSON({ ok: false, created: false, card_shown: true, note: "Creating courses from the chat isn't available right now: a card lets the student open the course wizard already filled in. Tell them in one line." })
      }
      const facts: AssistantFact[] = [fact(tr('Curso', 'Course'), title), fact(tr('Tipo', 'Kind'), depthTitle(depth))]
      if (examDate) facts.push(fact(tr('Examen', 'Exam'), [a.string('exam_title'), when(examDate)].filter((x): x is string => !!x).join(' · ')))
      if (wantsPlatform) {
        facts.push(fact(tr('Materiales', 'Materials'), canPlatform ? tr(`Los busca en ${AppLanguage.list(info!.platforms)}`, `Looks for them on ${AppLanguage.list(info!.platforms)}`)
          : tr(`Sin buscar en tu plataforma (conéctala en ${settingsPath('platforms', 'es')})`, `Without searching your platform (connect it in ${settingsPath('platforms', 'en')})`)))
      }
      if (files.length) facts.push(fact(tr('Del chat', 'From the chat'), AppLanguage.list(files.slice(0, 4).map((f) => f.title)) + (files.length > 4 ? '…' : '')))
      // A2-P1-1: lo que el equipo recibirá como instrucciones se ve en la tarjeta (una orden escondida en las notas, también)
      facts.push(...freeTextFacts([
        [tr('Objetivo', 'Goal'), a.string('goal')], [tr('Temas', 'Topics'), a.string('topics')], [tr('Notas para el equipo', 'Notes for the team'), a.string('notes')],
        [tr('Qué busca en la plataforma', 'What it looks for on the platform'), wantsPlatform && canPlatform ? a.string('focus') : undefined]
      ]))
      const no = await approval(env, tr('Crear un curso', 'Create a course'), facts, tr('Crear el curso', 'Create the course'), 'plus.rectangle.on.rectangle')
      if (no) return no
      const spec = {
        title, subject: a.string('subject') ?? '', depth, goal: a.string('goal') ?? '', topics: a.string('topics') ?? '', notes: a.string('notes') ?? '', searchPlatform: wantsPlatform && canPlatform,
        attachmentSourceIDs: files.map((f) => f.id), ...(a.string('exam_title') ? { examTitle: a.string('exam_title')! } : {}), ...(examDate ? { examDate: examDate.toISOString() } : {}),
        ...(a.string('language') ? { language: a.string('language')! } : {}), ...(a.string('platform_course') ? { platformCourse: a.string('platform_course')! } : {}),
        ...(a.string('focus') ? { focus: a.string('focus')! } : {})
      }
      try {
        const run = await env.team.create(spec, files.length ? env.files() : undefined)
        env.io.show(newCard('course', run.title, { icon: 'hammer', state: 'done', packID: run.courseID, detail: run.status || tr('Preparando el curso', 'Preparing the course'), allowsOther: false,
          actions: [{ id: IDs.short(6), kind: 'open', label: tr('Ver progreso', 'See progress'), prominent: true, courseID: run.courseID }] }))
        env.courseChanged?.(run.courseID)
        const o: JSONObject = { ok: true, course_id: run.courseID, status: run.status, searches_platform: run.searchesPlatform, materials_from_chat: files.length,
          note: `The course is being built in the background (it shows in the sidebar as “${tr('Creándose…', 'Being created…')}”). Tell the student in one or two lines; they can keep chatting.` }
        if (wantsPlatform && !run.searchesPlatform) o.platform_note = run.platformNote ?? `No study platform is configured (${settingsPath('platforms')}).`
        return outJSON(o)
      } catch (err) {
        return outError(`Could not create the course: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function extendCourseTool(env: ToolEnv): AgentTool {
  return tool('extend_course',
    'Ask the course pipeline to change an existing course ("add level-3 exercises to X", "add a lesson on Y", "make the lesson about Z simpler", "use these new notes"). It changes only what is asked and re-verifies it. Files attached to this chat can be added as new materials. Shows a confirmation card.',
    Schema.object([
      ['course_id', Schema.string()], ['instruction', Schema.string("precise instruction, in the student's words plus any detail you know")], ['skill_id', Schema.string('the lesson to change, if it is about one')],
      ['use_attachments', Schema.boolean("add this chat's files as materials (default true when there are files)")]
    ], env.defaultCourseID ? ['instruction'] : ['course_id', 'instruction']),
    async (a) => {
      const c = findCourse(env, courseArg(env, a))
      if (!c) return unknownCourse(env, a.string('course_id'))
      const instruction = a.string('instruction')?.trim()
      if (!instruction) return outError("Missing 'instruction'.")
      const sid = a.string('skill_id')
      const skill = sid ? c.pack.skills.find((s) => s.id === sid || foldPlain(s.title) === foldPlain(sid)) : undefined
      const files = (a.bool('use_attachments') ?? true) ? attachmentSources(env) : []
      if (!env.team) {
        env.io.show(newCard('actions', tr(`Cambiar «${c.pack.title}»`, `Change “${c.pack.title}”`), {
          detail: clip(instruction, 220), state: 'pending', icon: 'wand.and.rays', allowsOther: false,
          actions: [{ id: IDs.short(6), kind: 'extendCourse', label: tr('Abrir el curso', 'Open the course'), prominent: true, courseID: c.pack.id, value: instruction }]
        }))
        return outJSON({ ok: false, started: false, card_shown: true, note: "Changing courses from the chat isn't available right now: a card lets the student open the course and ask for the change there. Tell them in one line." })
      }
      const facts: AssistantFact[] = [fact(tr('Curso', 'Course'), c.pack.title), ...freeTextFacts([[tr('Cambio', 'Change'), instruction]])]
      if (skill) facts.push(fact(tr('Lección', 'Lesson'), skill.title))
      if (files.length) facts.push(fact(tr('Del chat', 'From the chat'), AppLanguage.list(files.slice(0, 4).map((f) => f.title))))
      const no = await approval(env, tr('Cambiar un curso', 'Change a course'), facts, tr('Pedir el cambio', 'Ask for the change'), 'wand.and.rays')
      if (no) return no
      try {
        const run = await env.team.extend(c.pack.id, instruction, { ...(skill ? { skillID: skill.id } : {}), attachmentSourceIDs: files.map((f) => f.id), ...(files.length ? { attachments: env.files() } : {}) })
        env.io.show(newCard('course', run.title || c.pack.title, { icon: 'wand.and.rays', state: 'done', packID: run.courseID, detail: run.status, allowsOther: false,
          actions: [{ id: IDs.short(6), kind: 'open', label: tr('Ver progreso', 'See progress'), prominent: true, courseID: run.courseID }] }))
        return outJSON({ ok: true, course_id: c.pack.id, status: run.status, note: 'The change runs in the background; the course updates when it finishes.' })
      } catch (err) {
        return outError(`Could not start the change: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

// MARK: Calendario

const EVENT_KINDS = ['exam', 'quiz', 'assignment', 'class', 'study', 'other'] as const

function kindTitle(k: string): string {
  switch (k) {
    case 'exam': return tr('Examen', 'Exam')
    case 'quiz': return tr('Prueba corta', 'Quiz')
    case 'assignment': return tr('Entrega', 'Assignment')
    case 'class': return tr('Clase', 'Class')
    case 'study': return tr('Estudio', 'Study')
    default: return tr('Evento', 'Event')
  }
}

function eventSchema(required: string[], withID = false) {
  const fields: Array<[string, ReturnType<typeof Schema.string>]> = [
    ['title', Schema.string()], ['start', Schema.string('ISO 8601 local time, e.g. 2026-10-19T09:00 (or 2026-10-19 for all day); for a repeating class, the FIRST class')], ['end', Schema.string('optional ISO end')],
    ['all_day', Schema.boolean()], ['kind', Schema.string(undefined, EVENT_KINDS)], ['course_id', Schema.string('the Aula course it belongs to, if any')], ['notes', Schema.string()], ['location', Schema.string()],
    ['repeat', Schema.string('optional repetition as an iCalendar RRULE, e.g. FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=2026-12-20 for «Mondays and Wednesdays until 20 Dec» (or COUNT=12). «none» stops repeating')],
    ['reminders', Schema.array(Schema.integer(undefined, 0, 86_400), 'optional reminders: minutes before (e.g. [120] = 2 hours before)')],
    ['task', Schema.boolean('it is a task the student will tick off (deadlines always are)')],
    ['scope', Schema.string('only when changing one day of a repeating event (event_id with «#»): this, following or all', ['this', 'following', 'all'])]
  ]
  if (withID) fields.unshift(['event_id', Schema.string('from calendar_events')])
  return Schema.object(fields, required)
}

function draftFrom(a: ToolArgs, base?: AssistantCalendarEvent): { draft?: AssistantEventDraft; error?: string } {
  const startRaw = a.string('start', ['date', 'when'])
  const start = (startRaw ? parseDate(startRaw) : undefined) ?? base?.start
  if (!start) return { error: "Missing or invalid 'start' (use ISO like 2026-10-19T09:00, or 2026-10-19 for all day)." }
  const allDay = a.bool('all_day') ?? (startRaw ? isDateOnly(startRaw) : base?.allDay ?? false)
  const title = a.string('title') ?? base?.title ?? ''
  if (!title.trim()) return { error: "Missing 'title'." }
  let kind = (a.string('kind') ?? base?.kind ?? 'other').toLowerCase()
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) kind = ['test', 'midterm', 'final', 'examen', 'prueba'].includes(kind) ? 'exam' : 'other'
  let reminders: number[] | undefined
  const list = a.array('reminders', ['reminder_minutes'])
  if (list) reminders = list.flatMap((x) => (typeof x === 'number' && Number.isFinite(x) ? [Math.trunc(x)] : []))
  else if (a.int('reminder_minutes') !== undefined) reminders = [a.int('reminder_minutes')!]
  const repeat = a.string('repeat', ['recurrence', 'rrule'])
  if (repeat && repeat.toLowerCase() !== 'none') {
    let ok = false
    try { ok = parseRuleText(repeat) !== undefined } catch { ok = false }
    if (!ok) return { error: 'Invalid \'repeat\': use an RRULE like FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=2026-12-20 (or COUNT=10), or «none» to stop repeating.' }
  }
  const endRaw = a.string('end')
  const end = endRaw ? parseDate(endRaw) : base?.end
  const d: AssistantEventDraft = { title, start, allDay, kind }
  if (end) d.end = end
  const course = a.string('course_id') ?? base?.courseID
  if (course) d.courseID = course
  const notes = a.string('notes') ?? base?.notes
  if (notes) d.notes = notes
  const loc = a.string('location') ?? base?.location
  if (loc) d.location = loc
  if (repeat) d.recurrence = repeat
  if (reminders) d.reminders = reminders
  const task = a.bool('task', ['is_task'])
  if (task !== undefined) d.isTask = task
  const scope = a.string('scope')
  if (scope) d.scope = scope
  return { draft: d }
}

function eventFacts(env: ToolEnv, d: AssistantEventDraft, withRepeat = true): AssistantFact[] {
  const f = [fact(tr('Qué', 'What'), d.title), fact(tr('Cuándo', 'When'), when(d.start, d.allDay)), fact(tr('Tipo', 'Kind'), kindTitle(d.kind ?? 'other'))]
  if (d.courseID) {
    const c = findCourse(env, d.courseID)
    if (c) f.push(fact(tr('Curso', 'Course'), c.pack.title))
  }
  if (d.location) f.push(fact(tr('Dónde', 'Where'), d.location))
  // A2-P2-8: todo lo que se guarda se ve (una serie diaria, seis avisos o un enlace en las notas no pasan escondidos)
  if (withRepeat && d.recurrence && d.recurrence.toLowerCase() !== 'none') f.push(fact(tr('Se repite', 'Repeats'), d.recurrence))
  if (d.reminders?.length) f.push(fact(tr('Avisos', 'Reminders'), d.reminders.slice(0, 6).map(reminderText).join(', ') + (d.reminders.length > 6 ? '…' : '')))
  f.push(...freeTextFacts([[tr('Notas', 'Notes'), d.notes]], 200))
  return f
}

function reminderText(min: number): string {
  if (min <= 0) return tr('al empezar', 'at the start')
  if (min % 1440 === 0) return tr(`${min / 1440} d antes`, `${min / 1440} d before`)
  if (min % 60 === 0) return tr(`${min / 60} h antes`, `${min / 60} h before`)
  return tr(`${min} min antes`, `${min} min before`)
}

/** En una serie: a qué días afecta (este, los siguientes o todos) y cómo se repite (sin esto, aceptar «Quitar Clase de Física ·
 * lunes 19» borraba el cuatrimestre entero). */
function seriesFacts(base: AssistantCalendarEvent, scope: string | undefined, newRule?: string): AssistantFact[] {
  const f: AssistantFact[] = []
  if (base.recurrence) {
    const s = base.id.includes('#') ? (scope ?? 'this') : 'all'
    f.push(fact(tr('Afecta a', 'Applies to'), s === 'following' ? tr('Este día y los siguientes', 'This day and the following ones') : s === 'all' ? tr('Toda la serie', 'The whole series') : tr('Solo este día', 'Only this day')))
  }
  if (newRule && newRule.toLowerCase() === 'none') {
    if (base.recurrence) f.push(fact(tr('Se repite', 'Repeats'), tr('Dejará de repetirse', 'It will stop repeating')))
  } else if (newRule ?? base.recurrence) f.push(fact(tr('Se repite', 'Repeats'), (newRule ?? base.recurrence)!))
  return f
}

async function allEvents(env: ToolEnv): Promise<AssistantCalendarEvent[]> {
  if (!env.calendar) return []
  return env.calendar.events(new Date(Date.now() - 366 * 86_400_000), new Date(Date.now() + 366 * 86_400_000))
}

export function addCalendarEventTool(env: ToolEnv): AgentTool {
  return tool('add_calendar_event',
    "Add an event to the student's Aula calendar (an exam, a quiz, a deadline, a study session…). Linking a course does not set or change its main exam date; use set_exam_date for the course plan and countdown. The app shows them a confirmation card; you don't need to ask in text first. If you don't know the time of an exam, ask (or use the whole day).",
    eventSchema(['title', 'start']),
    async (a) => {
      const cal = env.calendar
      if (!cal) return outError('The calendar is not available.')
      const { draft, error } = draftFrom(a)
      if (!draft) return outError(error ?? 'Invalid event.')
      const no = await approval(env, tr('Añadir al calendario', 'Add to the calendar'), eventFacts(env, draft), tr('Añadir', 'Add'), 'calendar.badge.plus')
      if (no) return no
      try {
        const e = await cal.addEvent(draft)
        showItems(env, tr('En tu calendario', 'In your calendar'), [{ kind: 'event', itemID: e.id, title: e.title, subtitle: when(e.start, e.allDay), date: e.start.toISOString(), ...(e.courseID ? { courseID: e.courseID } : {}) }], 'calendar')
        return outJSON({ ok: true, added: eventJSON(e) })
      } catch (err) {
        return outError(`Could not add it: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function updateCalendarEventTool(env: ToolEnv): AgentTool {
  return tool('update_calendar_event', 'Change an event of the Aula calendar (date, time, title…). Only fields you send change. Shows a confirmation card.', eventSchema(['event_id'], true),
    async (a) => {
      const cal = env.calendar
      if (!cal) return outError('The calendar is not available.')
      const id = a.string('event_id', ['id'])
      if (!id) return outError("Missing 'event_id'.")
      const base = (await allEvents(env)).find((e) => e.id === id)
      if (!base) return outError(`No event '${id}'. Use calendar_events.`)
      if (!base.editable) return outError('That event comes from the study platform and is read-only in Aula.')
      const { draft, error } = draftFrom(a, base)
      if (!draft) return outError(error ?? 'Invalid event.')
      const facts = [...eventFacts(env, draft, false), ...seriesFacts(base, a.string('scope'), a.string('repeat', ['recurrence', 'rrule']))]
      if (draft.start.getTime() !== base.start.getTime()) facts.splice(2, 0, fact(tr('Antes', 'Before'), when(base.start, base.allDay)))
      const no = await approval(env, tr('Cambiar un evento', 'Change an event'), facts, tr('Cambiar', 'Change'), 'calendar.badge.clock')
      if (no) return no
      try {
        return outJSON({ ok: true, updated: eventJSON(await cal.updateEvent(id, draft)) })
      } catch (err) {
        return outError(`Could not change it: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function deleteCalendarEventTool(env: ToolEnv): AgentTool {
  return tool('delete_calendar_event',
    'Remove an event from the Aula calendar. For one day of a repeating class (event_id with «#»), `scope` says whether only that day (this, the default), that day and the following ones (following) or the whole series (all). Shows a confirmation card.',
    Schema.object([['event_id', Schema.string()], ['scope', Schema.string(undefined, ['this', 'following', 'all'])]], ['event_id']),
    async (a) => {
      const cal = env.calendar
      if (!cal) return outError('The calendar is not available.')
      const id = a.string('event_id', ['id'])
      if (!id) return outError("Missing 'event_id'.")
      const e = (await allEvents(env)).find((x) => x.id === id)
      if (!e) return outError(`No event '${id}'.`)
      if (!e.editable) return outError('That event comes from the study platform and is read-only in Aula.')
      const scope = a.string('scope')
      const no = await approval(env, tr('Quitar del calendario', 'Remove from the calendar'), [fact(tr('Qué', 'What'), e.title), fact(tr('Cuándo', 'When'), when(e.start, e.allDay)), ...seriesFacts(e, scope)],
        tr('Quitar', 'Remove'), 'calendar.badge.minus')
      if (no) return no
      try {
        await cal.deleteEvent(id, scope)
        return outJSON({ ok: true, deleted: id })
      } catch (err) {
        return outError(`Could not remove it: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function completeTaskTool(env: ToolEnv): AgentTool {
  return tool('complete_task',
    'Tick off a task of the calendar (a deadline, an assignment from the study platform, one day of a repeating task) as done — or not done with done=false — when the student says so («ya entregué la práctica 3»). Shows a confirmation card (a task marked done stops its reminders).',
    Schema.object([['event_id', Schema.string('from calendar_events')], ['done', Schema.boolean()]], ['event_id']),
    async (a) => {
      const cal = env.calendar
      if (!cal) return outError('The calendar is not available.')
      const id = a.string('event_id', ['id'])
      if (!id) return outError("Missing 'event_id'.")
      const done = a.bool('done') ?? true
      const e = (await allEvents(env)).find((x) => x.id === id)
      if (!e) return outError(`No event '${id}'. Use calendar_events.`)
      if (!e.isTask) return outError('That event is not a task. Change it with update_calendar_event (task: true) if the student wants to tick it off.')
      // como el resto de escrituras: una tarea hecha deja de avisar, y la orden podría venir de un PDF o de una página ajena
      const facts = [fact(tr('Qué', 'What'), e.title), fact(tr('Cuándo', 'When'), when(e.start, e.allDay))]
      if (done) facts.push(fact(tr('Avisos', 'Reminders'), tr('Dejará de avisarte de esta tarea', 'It will stop reminding you of this task')))
      const no = await approval(env, done ? tr('Marcar como hecha', 'Mark as done') : tr('Marcar como pendiente', 'Mark as pending'), facts, done ? tr('Marcar', 'Mark') : tr('Desmarcar', 'Unmark'), 'checkmark.circle')
      if (no) return no
      try {
        await cal.setTaskDone(id, done)
        return outJSON({ ok: true, event_id: id, done })
      } catch (err) {
        return outError(err instanceof Error ? err.message : String(err))
      }
    })
}

export function setExamDateTool(env: ToolEnv): AgentTool {
  return tool('set_exam_date', 'Set or change the exam date (and title) of a course: the plan, reminders and countdown use it. Shows a confirmation card.',
    Schema.object([['course_id', Schema.string()], ['date', Schema.string('ISO, e.g. 2026-10-19T09:00')], ['title', Schema.string('exam title, optional')]], env.defaultCourseID ? ['date'] : ['course_id', 'date']),
    async (a) => {
      const c = findCourse(env, courseArg(env, a))
      if (!c) return unknownCourse(env, a.string('course_id'))
      const raw = a.string('date')
      const date = raw ? parseDate(raw) : undefined
      if (!raw || !date) return outError("Invalid 'date'.")
      const title = a.string('title') ?? c.pack.exam?.title ?? tr('Examen', 'Exam')
      const facts = [fact(tr('Curso', 'Course'), c.pack.title), fact(tr('Examen', 'Exam'), title), fact(tr('Cuándo', 'When'), when(date, isDateOnly(raw)))]
      if (c.pack.exam?.date) facts.push(fact(tr('Antes', 'Before'), when(new Date(c.pack.exam.date))))
      const no = await approval(env, tr('Fecha del examen', 'Exam date'), facts, tr('Guardar', 'Save'), 'calendar')
      if (no) return no
      try {
        c.store.updatePack((p) => {
          const e: ExamInfo = p.exam ? { ...p.exam } : { title }
          e.title = title
          e.date = date.toISOString()
          p.exam = e
          if (p.selfPaced) p.selfPaced = false
        })
        env.courseChanged?.(c.pack.id)
        return outJSON({ ok: true, course_id: c.pack.id, exam_date: isoLocal(date) })
      } catch (err) {
        return outError(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}

export function addFlashcardTool(env: ToolEnv): AgentTool {
  return tool('add_flashcard', 'Save a flashcard to a lesson of a course when the student asks ("guárdame esto como tarjeta"). One idea per card; Markdown + $LaTeX$ allowed. Shows a confirmation card.',
    Schema.object([['course_id', Schema.string()], ['skill_id', Schema.string()], ['front', Schema.string()], ['back', Schema.string()], ['kind', Schema.string(undefined, ['basic', 'cloze', 'reversible'])]],
      env.defaultCourseID ? ['skill_id', 'front', 'back'] : ['course_id', 'skill_id', 'front', 'back']),
    async (a) => {
      const c = findCourse(env, courseArg(env, a))
      if (!c) return unknownCourse(env, a.string('course_id'))
      const sid = a.string('skill_id', ['skill'])
      const ref = sid ? c.pack.skills.find((s) => s.id === sid || foldPlain(s.title) === foldPlain(sid)) : undefined
      if (!ref) return outError(`Unknown lesson. Lessons: ${c.pack.skills.map((s) => s.id).join(', ')}`)
      const front = a.string('front'), back = a.string('back')
      if (!front || !back) return outError("Both 'front' and 'back' are required.")
      const no = await approval(env, tr('Guardar una tarjeta', 'Save a flashcard'), [fact(tr('Pregunta', 'Question'), clip(front, 200)), fact(tr('Respuesta', 'Answer'), clip(back, 200)),
        fact(tr('Lección', 'Lesson'), `${ref.title} · ${c.pack.title}`)], tr('Guardar', 'Save'), 'rectangle.stack.badge.plus')
      if (no) return no
      const card = decodeFlashcard({ id: `${ref.id}-aula-${IDs.short(5)}`, skill: ref.id, front, back, kind: a.string('kind') ?? 'basic' })
      if (!card) return outError('Could not build the card.')
      const issues = env.validator.checkCard(card, 'card').filter((i) => i.severity === 'error')
      if (issues.length) return outJSON({ ok: false, issues: issues.slice(0, 8).map((i) => ({ path: i.path, message: i.message })) })
      try {
        c.store.updateSkill(ref.id, (s) => { s.cards.push(card) })
        env.courseChanged?.(c.pack.id)
        return outJSON({ ok: true, saved: true, card_id: card.id, course_id: c.pack.id, skill_id: ref.id })
      } catch (err) {
        return outError(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
}
