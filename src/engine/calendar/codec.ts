// `calendar.json` con el formato de la app Swift (StudyCalendar.swift: CalendarFile, CalendarEvent, CalendarTask…).
// Lectura tolerante: un evento estropeado no se lleva a los demás, lo nuevo es opcional (los archivos de la versión 1 se leen
// igual) y lo que esta versión no entiende (un campo de una versión futura, una regla que no sabe leer) se conserva y se vuelve
// a escribir tal cual mientras no se cambie. Fechas en ISO 8601 con milisegundos (UTC); campos vacíos fuera.
import { stringifyJSON } from '@engine/base/json'
import { parseISODate, UTC } from '@engine/calendar/time'
import { IDs } from '@engine/base/ids'
import {
  CALENDAR_FILE_SCHEMA, decodeKind, isNamedTimeZone, type CalendarEvent, type CalendarEventKind, type CalendarFile, type CalendarOccurrenceOverride,
  type CalendarTask, type PreservedField
} from './model'
import { formatRRule, parseRRule, type RecurrenceRule } from './rrule'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Las claves que esta versión entiende (en el orden de Swift). */
export const EVENT_KEYS = [
  'id', 'title', 'kind', 'start', 'end', 'allDay', 'course', 'notes', 'location', 'url', 'origin', 'platformID', 'platformCourseID', 'packID', 'createdBy',
  'created', 'updated', 'recurrence', 'timeZone', 'exceptions', 'overrides', 'reminders', 'task'
] as const
const KNOWN = new Set<string>(EVENT_KEYS)
const ORIGINS = new Set(['platform', 'course', 'own'])
const AUTHORS = new Set(['student', 'ai'])
const MAX_REMINDER = 60 * 24 * 60

/** JSON canónico (para comparar valores). */
export function canonicalJSON(v: unknown): string {
  return stringifyJSON(v, { pretty: false, sortKeys: true })
}

// MARK: - Valores sueltos

export function decodeDate(v: unknown): Date | undefined {
  return typeof v === 'string' ? parseISODate(v) ?? undefined : undefined
}

export function encodeDate(d: Date): string {
  return d.toISOString()
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)

/** `[Date]` (falla si alguna no lo es). */
function dateList(v: unknown): Date[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Date[] = []
  for (const x of v) {
    const d = decodeDate(x)
    if (!d) return undefined
    out.push(d)
  }
  return out
}

function dateMap(v: unknown): Record<string, Date> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, Date> = {}
  for (const [k, x] of Object.entries(v)) {
    const d = decodeDate(x)
    if (!d) return undefined
    out[k] = d
  }
  return out
}

function intList(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: number[] = []
  for (const x of v) {
    const n = int(x)
    if (n === undefined) return undefined
    out.push(n)
  }
  return out
}

function stringMap(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') return undefined
    out[k] = x
  }
  return out
}

/** La regla tal como se guarda (texto RRULE, UNTIL en UTC). */
export function decodeRule(v: unknown): RecurrenceRule | undefined {
  if (typeof v !== 'string') return undefined
  try {
    return parseRRule(v, UTC)
  } catch {
    return undefined
  }
}

export function encodeRule(r: RecurrenceRule): string {
  return formatRRule(r)
}

export function decodeTask(v: unknown): CalendarTask | undefined {
  if (!isObj(v)) return undefined
  const t: CalendarTask = { done: bool(v.done) ?? false, doneOccurrences: dateMap(v.doneOccurrences) ?? {} }
  const at = decodeDate(v.completedAt)
  if (at) t.completedAt = at
  return t
}

export function encodeTask(t: CalendarTask): Obj {
  const out: Obj = { done: t.done, doneOccurrences: Object.fromEntries(Object.entries(t.doneOccurrences).map(([k, d]) => [k, encodeDate(d)])) }
  if (t.completedAt) out.completedAt = encodeDate(t.completedAt)
  return out
}

export function decodeOverride(v: unknown): CalendarOccurrenceOverride | undefined {
  if (!isObj(v)) return undefined
  const o: CalendarOccurrenceOverride = { cancelled: bool(v.cancelled) ?? false }
  const start = decodeDate(v.start), end = decodeDate(v.end)
  if (start) o.start = start
  if (end) o.end = end
  if (typeof v.title === 'string') o.title = v.title
  if (typeof v.notes === 'string') o.notes = v.notes
  if (typeof v.location === 'string') o.location = v.location
  if (v.kind !== undefined && v.kind !== null) o.kind = decodeKind(v.kind)
  if (typeof v.allDay === 'boolean') o.allDay = v.allDay
  if (typeof v.course === 'string') o.course = v.course
  if (typeof v.url === 'string') o.url = v.url
  return o
}

export function encodeOverride(o: CalendarOccurrenceOverride): Obj {
  const out: Obj = { cancelled: o.cancelled }
  if (o.start) out.start = encodeDate(o.start)
  if (o.end) out.end = encodeDate(o.end)
  if (o.title !== undefined) out.title = o.title
  if (o.notes !== undefined) out.notes = o.notes
  if (o.location !== undefined) out.location = o.location
  if (o.kind !== undefined) out.kind = o.kind
  if (o.allDay !== undefined) out.allDay = o.allDay
  if (o.course !== undefined) out.course = o.course
  if (o.url !== undefined) out.url = o.url
  return out
}

function overrideMap(v: unknown): Record<string, CalendarOccurrenceOverride> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, CalendarOccurrenceOverride> = {}
  for (const [k, x] of Object.entries(v)) {
    const o = decodeOverride(x)
    if (!o) return undefined
    out[k] = o
  }
  return out
}

// MARK: - Evento

/** Cómo quedaría cada campo en el archivo (sin valor = no se escribe). */
function fieldValues(e: CalendarEvent): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: e.id, title: e.title, kind: e.kind, start: encodeDate(e.start), allDay: e.allDay, origin: e.origin
  }
  if (e.end) o.end = encodeDate(e.end)
  if (e.course !== undefined) o.course = e.course
  if (e.notes !== undefined) o.notes = e.notes
  if (e.location !== undefined) o.location = e.location
  if (e.url !== undefined) o.url = e.url
  if (e.platformID !== undefined) o.platformID = e.platformID
  if (e.platformCourseID !== undefined) o.platformCourseID = e.platformCourseID
  if (e.packID !== undefined) o.packID = e.packID
  if (e.createdBy !== undefined) o.createdBy = e.createdBy
  if (e.created) o.created = encodeDate(e.created)
  if (e.updated) o.updated = encodeDate(e.updated)
  if (e.recurrence) o.recurrence = encodeRule(e.recurrence)
  if (e.timeZone !== undefined) o.timeZone = e.timeZone
  if (e.exceptions.length) o.exceptions = e.exceptions.map(encodeDate)
  if (Object.keys(e.overrides).length) o.overrides = Object.fromEntries(Object.entries(e.overrides).map(([k, x]) => [k, encodeOverride(x)]))
  if (e.reminders.length) o.reminders = [...e.reminders]
  if (e.task) o.task = encodeTask(e.task)
  return o
}

const fallbackOf = (v: unknown): string | undefined => (v === undefined ? undefined : canonicalJSON(v))

/** Un evento como se guarda: sin campos vacíos; lo que no se entendió y no ha cambiado vuelve tal cual estaba. */
export function encodeEvent(e: CalendarEvent): Obj {
  const values = fieldValues(e)
  const out: Obj = {}
  for (const key of EVENT_KEYS) {
    const value = values[key]
    const p = e.preserved?.[key]
    if (p && !p.unknown && fallbackOf(value) === p.fallback) { out[key] = p.raw; continue }
    if (value !== undefined) out[key] = value
  }
  for (const [key, p] of Object.entries(e.preserved ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (p.unknown) out[key] = p.raw
  return out
}

/** Lee un evento. `null` solo si no es un objeto (como `FailableEvent` de Swift). */
export function decodeEvent(raw: unknown, now: () => Date = () => new Date()): CalendarEvent | null {
  if (!isObj(raw)) return null
  const c = raw
  const e: CalendarEvent = {
    id: str(c.id) ?? 'own:' + IDs.short(8),
    title: str(c.title) ?? '',
    kind: decodeKind(c.kind),
    start: decodeDate(c.start) ?? now(),
    allDay: bool(c.allDay) ?? false,
    origin: typeof c.origin === 'string' && ORIGINS.has(c.origin) ? (c.origin as CalendarEvent['origin']) : 'own',
    exceptions: dateList(c.exceptions) ?? [],
    overrides: overrideMap(c.overrides) ?? {},
    reminders: (intList(c.reminders) ?? []).filter((m) => m >= 0 && m <= MAX_REMINDER)
  }
  const end = decodeDate(c.end)
  if (end) e.end = end
  for (const k of ['course', 'notes', 'location', 'url', 'platformID', 'packID'] as const) {
    const v = str(c[k])
    if (v !== undefined) e[k] = v
  }
  const pcid = int(c.platformCourseID)
  if (pcid !== undefined) e.platformCourseID = pcid
  if (typeof c.createdBy === 'string' && AUTHORS.has(c.createdBy)) e.createdBy = c.createdBy as CalendarEvent['createdBy']
  const created = decodeDate(c.created), updated = decodeDate(c.updated)
  if (created) e.created = created
  if (updated) e.updated = updated
  const rule = decodeRule(c.recurrence)
  if (rule) e.recurrence = rule
  if (isNamedTimeZone(c.timeZone)) e.timeZone = c.timeZone
  const task = decodeTask(c.task)
  if (task) e.task = task

  // campos que estaban y no se pudieron leer, y campos desconocidos: se guardan para volver a escribirlos
  const kept: Record<string, PreservedField> = {}
  for (const [key, value] of Object.entries(c)) if (!KNOWN.has(key)) kept[key] = { raw: value, unknown: true }
  const values = fieldValues(e)
  const check = (key: string, ok: boolean) => {
    const value = c[key]
    if (value === undefined || value === null || ok) return
    kept[key] = { raw: value, fallback: fallbackOf(values[key]), unknown: false }
  }
  check('start', decodeDate(c.start) !== undefined)
  check('end', end !== undefined)
  check('origin', typeof c.origin === 'string' && ORIGINS.has(c.origin))
  check('recurrence', rule !== undefined)
  check('timeZone', typeof c.timeZone === 'string')
  check('exceptions', dateList(c.exceptions) !== undefined)
  check('overrides', overrideMap(c.overrides) !== undefined)
  check('reminders', intList(c.reminders) !== undefined)
  check('task', task !== undefined)
  // el tipo, el origen y la zona se leen con tolerancia: se guarda el texto original
  if (typeof c.kind === 'string' && decodeKind(c.kind) !== c.kind) kept.kind = { raw: c.kind, fallback: fallbackOf(values.kind), unknown: false }
  if (typeof c.timeZone === 'string' && !isNamedTimeZone(c.timeZone)) kept.timeZone = { raw: c.timeZone, fallback: fallbackOf(values.timeZone), unknown: false }
  if (Object.keys(kept).length) e.preserved = kept
  return e
}

// MARK: - Archivo

/** Lee `calendar.json` ya analizado. Lanza si no es un objeto (archivo dañado). */
export function decodeCalendarFile(raw: unknown, now?: () => Date): CalendarFile {
  if (!isObj(raw)) throw new Error('calendar.json no es un objeto JSON')
  const schema = int(raw.schema) ?? 1
  const events = Array.isArray(raw.events) ? raw.events.map((x) => decodeEvent(x, now)).filter((x): x is CalendarEvent => x !== null) : []
  return { schema, events, links: stringMap(raw.links) ?? {}, completed: dateMap(raw.completed) ?? {} }
}

export function encodeCalendarFile(f: CalendarFile): Obj {
  return {
    schema: f.schema,
    events: f.events.map(encodeEvent),
    links: { ...f.links },
    completed: Object.fromEntries(Object.entries(f.completed).map(([k, d]) => [k, encodeDate(d)]))
  }
}

/** Bytes de `calendar.json` (legible, claves ordenadas, como `JSONCoders` de Swift). */
export function calendarFileText(f: CalendarFile): string {
  return stringifyJSON(encodeCalendarFile({ ...f, schema: CALENDAR_FILE_SCHEMA }), { pretty: true, sortKeys: true })
}

export type { CalendarEventKind }
