// Herramientas del calendario para la IA (CalendarTools.swift) y el adaptador para el chat «Aula»
// (StudyCalendar+Assistant.swift). Las definiciones son datos (nombre, descripción y parámetros en JSON Schema) y los
// manejadores reciben los argumentos tal como los manda el modelo. Añadir, cambiar, borrar y marcar tareas piden permiso
// (`approve`): sin nadie que conteste, no se hacen. El marco de herramientas de la IA se conecta después.
import { addDays, localTimeZone, pad, startOfDay, wallTime, offsetSeconds } from '@engine/calendar/time'
import {
  CALENDAR_EVENT_KINDS, eventZone, isDone, isEditable, isPatchEmpty, isTask, type CalendarAuthor, type CalendarEditScope, type CalendarEvent,
  type CalendarEventDraft, type CalendarEventKind, type CalendarEventPatch, type CalendarSnapshot
} from './model'
import { formatRRule, readableRecurrence, type CalendarLanguage, type RecurrenceRule } from './rrule'
import { splitOccurrence } from './series'
import { tr } from '@shared/ai/i18n'
import { parseInstant, parseRuleText } from './view'

/** Lo que las herramientas necesitan del calendario (lo da el servicio del proceso principal). */
export interface CalendarBackend {
  events(from: Date, to: Date, refresh?: boolean): Promise<CalendarSnapshot>
  upcomingExams(days?: number, now?: Date): Promise<CalendarEvent[]>
  search(text: string, from?: Date, to?: Date): Promise<CalendarEvent[]>
  event(id: string): Promise<CalendarEvent | null>
  add(draft: CalendarEventDraft, author?: CalendarAuthor): CalendarEvent | Promise<CalendarEvent>
  /** Sin `scope`, una repetición cambia solo esa vez. */
  update(id: string, patch: CalendarEventPatch, scope?: CalendarEditScope): CalendarEvent | Promise<CalendarEvent>
  delete(id: string, scope?: CalendarEditScope): void | Promise<void>
  setDone(id: string, done: boolean, at?: Date): boolean | Promise<boolean>
  /** El evento propio (la serie) al que pertenece un id, para las tarjetas de permiso. */
  ownSeries(id: string): CalendarEvent | null
}

// MARK: - Definiciones

export type CalendarToolName =
  | 'calendar_list' | 'calendar_upcoming_exams' | 'calendar_search' | 'calendar_add' | 'calendar_update' | 'calendar_delete' | 'calendar_complete_task'

export const CALENDAR_TOOL_NAMES: readonly CalendarToolName[] = [
  'calendar_list', 'calendar_upcoming_exams', 'calendar_search', 'calendar_add', 'calendar_update', 'calendar_delete', 'calendar_complete_task'
]

export interface JSONSchema {
  type: 'object' | 'string' | 'integer' | 'boolean' | 'array'
  description?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  items?: JSONSchema
  properties?: Record<string, JSONSchema>
  required?: string[]
  additionalProperties?: boolean
}

export interface CalendarToolDefinition {
  name: CalendarToolName
  description: string
  parameters: JSONSchema
}

const S = {
  string: (description: string, values?: readonly string[]): JSONSchema => (values ? { type: 'string', description, enum: [...values] } : { type: 'string', description }),
  integer: (description: string, min?: number, max?: number): JSONSchema => ({ type: 'integer', description, ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) }),
  boolean: (description = ''): JSONSchema => (description ? { type: 'boolean', description } : { type: 'boolean' }),
  array: (items: JSONSchema, description: string): JSONSchema => ({ type: 'array', items, description }),
  object: (fields: [string, JSONSchema][], required: string[] = []): JSONSchema => ({ type: 'object', properties: Object.fromEntries(fields), required, additionalProperties: false })
}

const EVENT_FIELDS: [string, JSONSchema][] = [
  ['title', S.string("short title, in the student's language (e.g. «Prueba de inglés»)")],
  ['kind', S.string('exam, quiz, assignment (a due date), lecture (a class), study (a planned study session) or event', CALENDAR_EVENT_KINDS)],
  ['start', S.string("ISO 8601 in the student's time zone: 2026-10-19T10:00 (or 2026-10-19 for all day)")],
  ['end', S.string('optional end, same format')],
  ['course', S.string('optional subject or course name/code («Inglés», «BIO101»)')],
  ['notes', S.string('optional notes: topics, format, what to bring')],
  ['location', S.string('optional place')],
  ['aula_course_id', S.string('optional id of the Aula course this belongs to')],
  ['repeat', S.string('optional repetition as an iCalendar RRULE: FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=2026-12-20 (or COUNT=12); «none» stops repeating')],
  ['reminders', S.array(S.integer('', 0, 86_400), 'optional reminders in minutes before (e.g. [120])')],
  ['task', S.boolean('a task the student ticks off when done (deadlines always are)')]
]

export const CALENDAR_TOOL_DEFINITIONS: readonly CalendarToolDefinition[] = [
  {
    name: 'calendar_list',
    description: "List the student's calendar between two dates: dates from ALL their study platforms (exams, quizzes, due dates, classes; read-only), the exam dates of their Aula courses, and their own events. Default: today and the next 14 days.",
    parameters: S.object([
      ['from', S.string('start date (ISO 8601, default today)')], ['to', S.string('end date (ISO 8601, default from + 14 days)')],
      ['refresh', S.boolean('read the platforms again instead of the copy from the last 15 minutes')]
    ])
  },
  {
    name: 'calendar_upcoming_exams',
    description: "The student's upcoming exams and quizzes (from their platforms, their Aula courses and their own events), nearest first. Each one says whether an Aula course already prepares it (aula_course_id).",
    parameters: S.object([['days', S.integer('how many days ahead (default 60)', 1, 365)]])
  },
  {
    name: 'calendar_search',
    description: 'Find calendar events by words in the title, subject or notes (accents and case do not matter), e.g. «inglés», «parcial 2», «MATH112». Searches from a month ago to a year ahead unless you give a range.',
    parameters: S.object([['query', S.string('words to look for')], ['from', S.string('optional ISO 8601')], ['to', S.string('optional ISO 8601')]], ['query'])
  },
  {
    name: 'calendar_add',
    description: "Add an event to the student's calendar (their own events: an exam they told you about, a study session, a due date). Ask for the time if you do not know it; without a time it is an all-day event. Returns the saved event with its id.",
    parameters: S.object(EVENT_FIELDS, ['title', 'start'])
  },
  {
    name: 'calendar_update',
    description: "Change an event: only the fields you send change. The student's own events can change completely; for an Aula course's exam (origin course) only its date, title, notes and place; events from a study platform cannot be changed (add an own event instead).",
    parameters: S.object([
      ['id', S.string('event id (from calendar_list / calendar_search)')], ...EVENT_FIELDS, ['clear_end', S.boolean('remove the end time')],
      ['scope', S.string('for one day of a repeating event (id with «#»): this (default), following or all', ['this', 'following', 'all'])]
    ], ['id'])
  },
  {
    name: 'calendar_delete',
    description: "Delete one of the student's own events (for an Aula course's exam it removes the exam date; the course stays). Events from a study platform cannot be deleted. Confirm with the student first if it was not their idea.",
    parameters: S.object([['id', S.string('event id')], ['scope', S.string('for one day of a repeating event: this (default), following or all', ['this', 'following', 'all'])]], ['id'])
  },
  {
    name: 'calendar_complete_task',
    description: 'Tick off a task (an own task, one day of a repeating task, or an assignment from a study platform) as done, or done=false to undo it. Only when the student says it is done. Shows a confirmation card (a task marked done stops its reminders).',
    parameters: S.object([['id', S.string('event id')], ['done', S.boolean()]], ['id'])
  }
]

// MARK: - Entradas y salidas

export interface CalendarListInput { from?: string; to?: string; refresh?: boolean }
export interface CalendarUpcomingInput { days?: number }
export interface CalendarSearchInput { query: string; from?: string; to?: string }
export interface CalendarEventFieldsInput {
  title?: string; kind?: string; start?: string; end?: string; course?: string; notes?: string; location?: string; aula_course_id?: string
  repeat?: string; reminders?: number[]; task?: boolean
}
export interface CalendarAddInput extends CalendarEventFieldsInput { title: string; start: string }
export interface CalendarUpdateInput extends CalendarEventFieldsInput { id: string; clear_end?: boolean; scope?: 'this' | 'following' | 'all' }
export interface CalendarDeleteInput { id: string; scope?: 'this' | 'following' | 'all' }
export interface CalendarCompleteInput { id: string; done?: boolean }

/** Lo que manda cada herramienta. */
export interface CalendarToolInputs {
  calendar_list: CalendarListInput
  calendar_upcoming_exams: CalendarUpcomingInput
  calendar_search: CalendarSearchInput
  calendar_add: CalendarAddInput
  calendar_update: CalendarUpdateInput
  calendar_delete: CalendarDeleteInput
  calendar_complete_task: CalendarCompleteInput
}

/** Un evento como lo ve la IA. */
export interface CalendarToolEvent {
  id: string
  title: string
  kind: CalendarEventKind
  start: string
  all_day: boolean
  origin: string
  editable: boolean
  end?: string
  course?: string
  notes?: string
  location?: string
  url?: string
  aula_course_id?: string
  platform_id?: string
  created_by?: string
  repeat?: string
  task?: boolean
  done?: boolean
  reminders?: number[]
}

/** Resultado de una herramienta: `text` es el JSON compacto para el modelo; `data`, lo mismo como objeto. */
export interface CalendarToolResult {
  ok: boolean
  isError: boolean
  text: string
  data: Record<string, unknown>
}

export interface CalendarFact { label: string; value: string }
/** La tarjeta de permiso que se enseña al estudiante. */
export interface CalendarApprovalCard { title: string; facts: CalendarFact[]; actionLabel: string; icon: string }

export interface CalendarToolOptions {
  /** Pide permiso; `true` = aprobado. Sin él, las escrituras no se hacen. */
  approve?: (card: CalendarApprovalCard) => Promise<boolean>
  timeZone?: string
  now?: () => Date
  language?: CalendarLanguage
}

export type CalendarToolHandler = (args: unknown) => Promise<CalendarToolResult>
export type CalendarToolHandlers = Record<CalendarToolName, CalendarToolHandler>

/** Aprueba todo (pruebas y automatizaciones que ya pidieron permiso). */
export const autoApprove = async (): Promise<boolean> => true

// MARK: - Fechas

/** Lee una fecha de la IA: ISO 8601 con o sin zona, con o sin hora (sin hora = todo el día), en la zona del estudiante. */
export function parseToolDate(s: string, timeZone: string = localTimeZone()): { date: Date; allDay: boolean } | null {
  const p = parseInstant(s, timeZone)
  return p ? { date: p.date, allDay: p.dateOnly } : null
}

/** «2026-10-19T10:00+02:00» o «2026-10-19». */
export function toolISO(d: Date, allDay: boolean, timeZone: string = localTimeZone()): string {
  const w = wallTime(d, timeZone)
  const day = `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`
  if (allDay) return day
  const off = offsetSeconds(d.getTime(), timeZone)
  const a = Math.abs(off)
  return `${day}T${pad(w.hour, 2)}:${pad(w.minute, 2)}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 3600), 2)}:${pad(Math.floor((a % 3600) / 60), 2)}`
}

/** Un evento en JSON para la IA. */
export function toolEventJSON(e: CalendarEvent, timeZone: string = localTimeZone()): CalendarToolEvent {
  const o: CalendarToolEvent = {
    id: e.id, title: e.title, kind: e.kind, start: toolISO(e.start, e.allDay, timeZone), all_day: e.allDay, origin: e.origin, editable: isEditable(e)
  }
  if (e.end) o.end = toolISO(e.end, e.allDay, timeZone)
  if (e.course) o.course = e.course
  if (e.notes) o.notes = Array.from(e.notes).length > 600 ? Array.from(e.notes).slice(0, 600).join('') + '…' : e.notes
  if (e.location) o.location = e.location
  if (e.url) o.url = e.url
  if (e.packID) o.aula_course_id = e.packID
  if (e.platformID) o.platform_id = e.platformID
  if (e.createdBy) o.created_by = e.createdBy
  if (e.recurrence) o.repeat = formatRRule(e.recurrence, { allDay: e.allDay, timeZone: eventZone(e, timeZone) })
  if (isTask(e)) { o.task = true; o.done = isDone(e) }
  if (e.reminders.length) o.reminders = [...e.reminders]
  return o
}

// MARK: - Manejadores

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (a: Obj, k: string): string | undefined => (typeof a[k] === 'string' ? (a[k] as string) : undefined)
const bool = (a: Obj, k: string): boolean | undefined => (typeof a[k] === 'boolean' ? (a[k] as boolean) : undefined)
const int = (a: Obj, k: string): number | undefined => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? Math.trunc(a[k] as number) : undefined)
const ints = (a: Obj, k: string): number[] | undefined =>
  Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).map((x) => Math.trunc(x)) : undefined
const kindOf = (s: string | undefined): CalendarEventKind | undefined => {
  const k = s?.toLowerCase()
  return k && (CALENDAR_EVENT_KINDS as readonly string[]).includes(k) ? (k as CalendarEventKind) : undefined
}

function result(data: Record<string, unknown>, isError = false): CalendarToolResult {
  return { ok: !isError, isError, text: JSON.stringify(data), data }
}

function fail(message: string): CalendarToolResult {
  return result({ ok: false, error: message }, true)
}

/** «this» (por defecto), «following» o «all» → alcance. */
export function parseScope(s: string | undefined | null): CalendarEditScope {
  switch (s?.toLowerCase()) {
    case 'following': case 'this_and_following': case 'future': return 'thisAndFollowing'
    case 'all': case 'series': return 'allOccurrences'
    default: return 'thisOccurrence'
  }
}

/** El alcance de un cambio en una serie, para la tarjeta de permiso. */
export function scopeFact(scope: CalendarEditScope): CalendarFact {
  const value = scope === 'thisOccurrence' ? tr('Solo este día', 'Only this day')
    : scope === 'thisAndFollowing' ? tr('Este día y todos los siguientes', 'This day and all the following ones')
      : tr('Toda la serie (todos los días)', 'The whole series (every day)')
  return { label: tr('Alcance', 'Scope'), value }
}

/** Lo que la tarjeta de permiso dice de un evento propio: qué es, a qué días afecta y cómo se repite. */
export function cardFacts(backend: CalendarBackend, id: string, scope: CalendarEditScope | null, timeZone: string, lang: CalendarLanguage = 'es'): { title?: string; facts: CalendarFact[] } {
  const e = backend.ownSeries(id)
  if (!e) return { facts: [] }
  const facts: CalendarFact[] = []
  if (e.recurrence) {
    facts.push(splitOccurrence(id) && scope ? scopeFact(scope) : scopeFact('allOccurrences'))
    facts.push({ label: tr('Se repite', 'Repeats'), value: readableRecurrence(e.recurrence, { language: lang, timeZone: eventZone(e, timeZone) }) })
  }
  return { title: e.title, facts }
}

/** Los manejadores de las siete herramientas sobre un calendario. */
export function makeCalendarToolHandlers(backend: CalendarBackend, opts: CalendarToolOptions = {}): CalendarToolHandlers {
  const tz = opts.timeZone ?? localTimeZone()
  const now = opts.now ?? (() => new Date())
  const lang = opts.language ?? 'es'
  const approve = async (title: string, what: string, actionLabel: string, icon: string, extra: CalendarFact[] = []): Promise<CalendarToolResult | null> => {
    const card: CalendarApprovalCard = { title, facts: [{ label: tr('Qué', 'What'), value: what }, ...extra], actionLabel, icon }
    const ok = opts.approve ? await opts.approve(card).catch(() => false) : false
    return ok ? null : fail("The student did not approve it. Don't retry now.")
  }
  const out = (events: CalendarEvent[], extra: Record<string, unknown> = {}, limit = 120): CalendarToolResult => {
    const data: Record<string, unknown> = { ...extra, ok: true, today: toolISO(now(), false, tz), count: events.length, events: events.slice(0, limit).map((e) => toolEventJSON(e, tz)) }
    if (events.length > limit) data.note = `Only the first ${limit} are listed; narrow the range.`
    return result(data)
  }
  const date = (a: Obj, k: string) => {
    const s = str(a, k)
    return s !== undefined ? parseToolDate(s, tz) : null
  }
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  return {
    async calendar_list(args) {
      const a = asObj(args)
      const from = date(a, 'from')?.date ?? startOfDay(now(), tz)
      const toP = date(a, 'to')
      let to = toP ? (toP.allDay ? addDays(toP.date, 1, tz) : toP.date) : new Date(from.getTime() + 14 * 86_400_000)
      if (to.getTime() <= from.getTime()) to = new Date(from.getTime() + 86_400_000)
      if (to.getTime() - from.getTime() > 400 * 86_400_000) return fail('The range is too long (max 400 days).')
      const snap = await backend.events(from, to, bool(a, 'refresh') ?? false)
      return out(snap.events, snap.platformError ? { platform_warning: snap.platformError } : {})
    },
    async calendar_upcoming_exams(args) {
      const days = Math.min(365, Math.max(1, int(asObj(args), 'days') ?? 60))
      return out(await backend.upcomingExams(days, now()))
    },
    async calendar_search(args) {
      const a = asObj(args)
      const q = str(a, 'query')
      if (!q || !q.trim()) return fail("Missing 'query'.")
      return out(await backend.search(q, date(a, 'from')?.date, date(a, 'to')?.date), {}, 60)
    },
    async calendar_add(args) {
      const a = asObj(args)
      const title = str(a, 'title')
      if (!title || !title.trim()) return fail("Missing 'title'.")
      const startText = str(a, 'start')
      const start = startText !== undefined ? parseToolDate(startText, tz) : null
      if (!start) return fail("Missing or invalid 'start' (use 2026-10-19T10:00 or 2026-10-19).")
      const end = date(a, 'end')?.date
      const kind = kindOf(str(a, 'kind')) ?? 'event'
      const no = await approve(tr('Añadir al calendario', 'Add to calendar'), title, tr('Añadir', 'Add'), 'calendar.badge.plus')
      if (no) return no
      try {
        const draft: CalendarEventDraft = {
          title, kind, start: start.date, end, allDay: start.allDay, course: str(a, 'course'), notes: str(a, 'notes'), location: str(a, 'location'),
          packID: str(a, 'aula_course_id'), recurrence: parseRuleText(str(a, 'repeat'), tz), reminders: ints(a, 'reminders') ?? [], isTask: bool(a, 'task') ?? false
        }
        const ev = await backend.add(draft, 'ai')
        return result({ ok: true, event: toolEventJSON(ev, tz) })
      } catch (err) {
        return fail(message(err))
      }
    },
    async calendar_update(args) {
      const a = asObj(args)
      const id = str(a, 'id')
      if (!id) return fail("Missing 'id'.")
      const patch: CalendarEventPatch = {
        title: str(a, 'title'), kind: kindOf(str(a, 'kind')), course: str(a, 'course'), notes: str(a, 'notes'), location: str(a, 'location'),
        packID: str(a, 'aula_course_id'), clearEnd: bool(a, 'clear_end')
      }
      const s = str(a, 'start')
      if (s !== undefined) {
        const p = parseToolDate(s, tz)
        if (!p) return fail("Invalid 'start' (use 2026-10-19T10:00 or 2026-10-19).")
        patch.start = p.date
        patch.allDay = p.allDay
      }
      const e = str(a, 'end')
      if (e !== undefined) {
        const p = parseToolDate(e, tz)
        if (!p) return fail("Invalid 'end'.")
        patch.end = p.date
      }
      const r = str(a, 'repeat')
      if (r !== undefined) {
        if (r.toLowerCase() === 'none') patch.clearRecurrence = true
        else {
          try { patch.recurrence = parseRuleText(r, tz) } catch (err) { return fail(message(err)) }
        }
      }
      patch.reminders = ints(a, 'reminders')
      patch.isTask = bool(a, 'task')
      for (const k of Object.keys(patch) as (keyof CalendarEventPatch)[]) if (patch[k] === undefined) delete patch[k]
      if (isPatchEmpty(patch)) return fail('Nothing to change: send at least one field.')
      const scope = parseScope(str(a, 'scope'))
      const card = cardFacts(backend, id, scope, tz, lang)
      const no = await approve(tr('Cambiar un evento', 'Change an event'), str(a, 'title') ?? card.title ?? id, tr('Cambiar', 'Change'), 'calendar.badge.clock', card.facts)
      if (no) return no
      try {
        const ev = id.includes('#') ? await backend.update(id, patch, scope) : await backend.update(id, patch)
        return result({ ok: true, event: toolEventJSON(ev, tz) })
      } catch (err) {
        return fail(message(err))
      }
    },
    async calendar_delete(args) {
      const a = asObj(args)
      const id = str(a, 'id')
      if (!id) return fail("Missing 'id'.")
      const scope = parseScope(str(a, 'scope'))
      const card = cardFacts(backend, id, scope, tz, lang)
      const no = await approve(tr('Quitar del calendario', 'Remove from calendar'), card.title ?? id, tr('Quitar', 'Remove'), 'calendar.badge.minus', card.facts)
      if (no) return no
      try {
        if (id.includes('#')) await backend.delete(id, scope)
        else await backend.delete(id)
        return result({ ok: true, deleted: id })
      } catch (err) {
        return fail(message(err))
      }
    },
    async calendar_complete_task(args) {
      const a = asObj(args)
      const id = str(a, 'id')
      if (!id) return fail("Missing 'id'.")
      // como cualquier otra escritura: una tarea hecha deja de avisar, y la orden podría venir de un PDF o de una página
      const done = bool(a, 'done') ?? true
      const card = cardFacts(backend, id, 'thisOccurrence', tz, lang)
      const no = await approve(done ? tr('Marcar como hecha', 'Mark as done') : tr('Marcar como pendiente', 'Mark as pending'), card.title ?? id, done ? tr('Marcar', 'Mark') : tr('Desmarcar', 'Unmark'), 'checkmark.circle',
        done ? [{ label: tr('Avisos', 'Reminders'), value: tr('Dejará de avisarte de esta tarea', 'It will stop reminding you about this task') }] : [])
      if (no) return no
      try {
        const d = await backend.setDone(id, done, now())
        return result({ ok: true, id, done: d })
      } catch (err) {
        return fail(message(err))
      }
    }
  }
}

// MARK: - Adaptador para el chat «Aula»

/** Un evento como lo ve el chat. `kind`: exam · quiz · assignment · class · study · other. `source`: aula · platform · course. */
export interface AssistantCalendarEvent {
  id: string
  title: string
  start: Date
  end?: Date
  allDay: boolean
  kind: string
  courseID?: string
  notes?: string
  location?: string
  source: 'aula' | 'platform' | 'course'
  editable: boolean
  course?: string
  recurrence?: string
  isTask: boolean
  done: boolean
  reminders: number[]
}

/** Lo que manda el chat para añadir o cambiar un evento (sin valor = no cambia). */
export interface AssistantEventDraft {
  title: string
  start: Date
  end?: Date
  allDay?: boolean
  kind?: string
  courseID?: string
  notes?: string
  location?: string
  /** RRULE; «none» deja de repetirse. */
  recurrence?: string
  reminders?: number[]
  isTask?: boolean
  /** Al cambiar una repetición: «this», «following» o «all». */
  scope?: string
}

export interface AssistantCalendar {
  events(from: Date, to: Date): Promise<AssistantCalendarEvent[]>
  addEvent(d: AssistantEventDraft): Promise<AssistantCalendarEvent>
  updateEvent(id: string, d: AssistantEventDraft): Promise<AssistantCalendarEvent>
  deleteEvent(id: string, scope?: string): Promise<void>
  setTaskDone(id: string, done: boolean): Promise<void>
}

/** exam · quiz · assignment · class · study · other (los nombres del chat) → tipo del calendario. */
export function assistantKind(s: string | undefined): CalendarEventKind {
  switch ((s ?? '').toLowerCase()) {
    case 'exam': return 'exam'
    case 'quiz': return 'quiz'
    case 'assignment': case 'deadline': case 'due': return 'assignment'
    case 'class': case 'lecture': return 'lecture'
    case 'study': return 'study'
    default: return 'event'
  }
}

export function assistantKindName(k: CalendarEventKind): string {
  return k === 'lecture' ? 'class' : k === 'event' ? 'other' : k
}

/** La asignatura va en su campo y las notas, tal cual: lo que lee la IA se puede devolver sin estropear las notas. */
export function toAssistantEvent(e: CalendarEvent, timeZone: string = localTimeZone()): AssistantCalendarEvent {
  const out: AssistantCalendarEvent = {
    id: e.id, title: e.title, start: e.start, allDay: e.allDay, kind: assistantKindName(e.kind), source: e.origin === 'own' ? 'aula' : e.origin,
    editable: isEditable(e), isTask: isTask(e), done: isDone(e), reminders: [...e.reminders]
  }
  if (e.end) out.end = e.end
  if (e.packID) out.courseID = e.packID
  if (e.notes) out.notes = e.notes
  if (e.location) out.location = e.location
  if (e.course) out.course = e.course
  if (e.recurrence) out.recurrence = formatRRule(e.recurrence, { allDay: e.allDay, timeZone: eventZone(e, timeZone) })
  return out
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

/** El calendario para el chat «Aula» (mismo archivo que la pantalla Calendario). */
export function makeAssistantCalendar(backend: CalendarBackend, opts: { timeZone?: string } = {}): AssistantCalendar {
  const tz = opts.timeZone ?? localTimeZone()
  const rule = (text: string | undefined): RecurrenceRule | undefined => parseRuleText(text, tz)
  return {
    async events(from, to) {
      return (await backend.events(from, to)).events.map((e) => toAssistantEvent(e, tz))
    },
    async addEvent(d) {
      const ev = await backend.add({
        title: d.title, kind: assistantKind(d.kind), start: d.start, end: d.end, allDay: d.allDay ?? false, notes: d.notes, location: d.location, packID: d.courseID,
        recurrence: rule(d.recurrence), reminders: d.reminders ?? [], isTask: d.isTask ?? false
      }, 'ai')
      return toAssistantEvent(ev, tz)
    },
    // solo cambia lo que de verdad cambia respecto al evento guardado: el chat manda el borrador completo
    async updateEvent(id, d) {
      const stored = await backend.event(id)
      const base = stored ? toAssistantEvent(stored, tz) : null
      const changed = <T>(next: T | undefined, old: T | undefined): T | undefined => (!base || !sameValue(next, old) ? next : undefined)
      const kindName = changed(d.kind ?? 'other', base?.kind)
      const patch: CalendarEventPatch = {
        title: changed(d.title, base?.title), kind: kindName !== undefined ? assistantKind(kindName) : undefined, start: changed(d.start, base?.start),
        end: changed(d.end, base?.end), allDay: changed(d.allDay ?? false, base?.allDay), notes: changed(d.notes, base?.notes),
        location: changed(d.location, base?.location), packID: changed(d.courseID, base?.courseID)
      }
      if (d.end === undefined && (base?.end !== undefined || !base)) patch.clearEnd = true
      if (d.recurrence !== undefined) {
        if (d.recurrence.toLowerCase() === 'none') patch.clearRecurrence = true
        else patch.recurrence = rule(d.recurrence)
      }
      if (d.reminders) patch.reminders = d.reminders
      if (d.isTask !== undefined) patch.isTask = d.isTask
      for (const k of Object.keys(patch) as (keyof CalendarEventPatch)[]) if (patch[k] === undefined) delete patch[k]
      if (isPatchEmpty(patch) && base) return base
      const ev = id.includes('#') ? await backend.update(id, patch, parseScope(d.scope)) : await backend.update(id, patch)
      return toAssistantEvent(ev, tz)
    },
    async deleteEvent(id, scope) {
      if (id.includes('#')) await backend.delete(id, parseScope(scope))
      else await backend.delete(id)
    },
    async setTaskDone(id, done) {
      await backend.setDone(id, done)
    }
  }
}
