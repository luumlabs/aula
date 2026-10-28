// Importar un .ics una vez (Google Calendar, Outlook, Apple Calendar, el horario de la universidad…) como eventos PROPIOS:
// se pueden cambiar y borrar como los demás. Cada UID es un evento; si se repite, con su regla cuando Aula la sabe guardar
// igual (se comprueba que salgan las mismas fechas), y si no, cada vez como evento suelto. El id sale del UID
// (`own:ics-<huella>`), así que volver a importar el mismo archivo no duplica nada.
import { addDays, localTimeZone } from '@engine/calendar/time'
import { stableID } from './ics/hash'
import { compactStamp, parseICSSeries, type ICSParseOptions, type ICSSeries } from './ics/parser'
import type { StudyEvent } from './ics/studyEvent'
import { expandOccurrences } from './expander'
import {
  cleanText, isNamedTimeZone, kindFromCampus, makeCalendarEvent, prefixChars, type CalendarEvent, type CalendarFile, type CalendarOccurrenceOverride
} from './model'
import { parseRRule, type RecurrenceRule } from './rrule'
import { endFor, newTask, occurrenceKey } from './series'

/** Tope de eventos que añade una importación (un archivo enorme no llena el calendario). */
export const MAX_IMPORTED_EVENTS = 3000

/** Trabajo que pueden dar, entre todas, las reglas que se guardan de una importación: periodos que recorre el expansor para
 *  comprobarlas y, después, en cada vista del calendario (con COUNT no puede saltar: va desde el principio). Las que no caben
 *  se importan como eventos sueltos (como mucho 200 por serie). */
export const MAX_IMPORT_RULE_WORK = 50_000

/** Una regla más larga no es de un calendario real (se importa como eventos sueltos). */
const MAX_RULE_TEXT = 400

/** Lo gastado en una importación. */
interface ImportBudget {
  ruleWork: number
}

export interface ICSImportOptions {
  now?: Date
  /** Zona del estudiante (horas flotantes y medianoche de los de todo el día). */
  timeZone?: string
}

/** Cómo fue: los eventos añadidos (copias), cuántos se repiten y cuántos ya estaban. */
export interface ICSImportSummary {
  added: CalendarEvent[]
  recurring: number
  skipped: number
}

/** El id propio de lo importado con ese UID (estable: el mismo archivo da los mismos ids). */
export function importedEventID(uid: string): string {
  return 'own:ics-' + stableID(uid)
}

function same(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null)
}

/** Un evento suelto (una vez) a partir de lo leído. */
function singleEvent(id: string, e: StudyEvent, s: ICSSeries, now: Date): CalendarEvent {
  const kind = kindFromCampus(e.kind, e.isExam, e.title)
  const ev = makeCalendarEvent({
    id, title: prefixChars(e.title, 200), kind, start: e.start, allDay: e.allDay, origin: 'own', createdBy: 'student', created: now, updated: now
  })
  if (e.end && e.end.getTime() > e.start.getTime()) ev.end = e.end
  const course = cleanText(e.course), notes = cleanText(e.descriptionText), location = cleanText(e.location), url = cleanText(e.url)
  if (course) ev.course = course
  if (notes) ev.notes = notes
  if (location) ev.location = location
  if (url) ev.url = url
  if (s.isTodo || kind === 'assignment') ev.task = { ...newTask(), done: s.completed, ...(s.completed ? { completedAt: now } : {}) }
  return ev
}

/** Periodos (por lo que cuesta cada uno) que recorre el expansor para llegar de `min` a `max`. */
function ruleWork(rule: RecurrenceRule, start: number, min: number, max: number): number {
  const from = rule.count !== undefined ? start : min
  const unitDays = rule.frequency === 'DAILY' ? 1 : rule.frequency === 'WEEKLY' ? 7 : rule.frequency === 'MONTHLY' ? 28 : 365
  const periods = Math.ceil(Math.max(0, max - from) / 86_400_000 / unitDays / rule.interval) + 2
  return periods * (1 + rule.byDay.length + rule.byMonthDay.length)
}

/** La regla del archivo como regla de Aula, solo si da EXACTAMENTE las mismas fechas que leyó el lector del .ics (y si
 *  expandirla no cuesta más de lo que queda en `budget`). */
function faithfulRule(s: ICSSeries, budget?: ImportBudget): RecurrenceRule | null {
  if (!s.rule || s.hasExtraDates || !isNamedTimeZone(s.zone) || s.rule.length > MAX_RULE_TEXT) return null
  let rule: RecurrenceRule
  try {
    rule = parseRRule(s.rule, s.zone)
  } catch {
    return null
  }
  const expected = [...s.occurrences, ...s.excluded, ...s.changed.map((c) => c.original)].map((d) => d.getTime())
  if (!expected.length) return null
  const set = new Set(expected)
  const min = Math.min(...expected), max = Math.max(...expected)
  if (budget) {
    const work = ruleWork(rule, s.event.start.getTime(), min, max)
    if (budget.ruleWork + work > MAX_IMPORT_RULE_WORK) return null
    budget.ruleWork += work
  }
  const got = expandOccurrences(s.event.start, rule, s.zone, new Date(min), new Date(max), set.size + 2).map((d) => d.getTime())
  if (got.length !== set.size || got.some((t) => !set.has(t))) return null
  return rule
}

/** Lo que cambia en una repetición respecto a la serie (o `null` si nada). */
function overrideFor(series: CalendarEvent, original: Date, e: StudyEvent): CalendarOccurrenceOverride | null {
  const o: CalendarOccurrenceOverride = { cancelled: false }
  const end = endFor(series, original, series.timeZone)
  if (!same(e.start, original)) o.start = e.start
  if (e.end && !same(e.end, end)) o.end = e.end
  const title = prefixChars(e.title, 200)
  if (title !== series.title) o.title = title
  const location = cleanText(e.location), notes = cleanText(e.descriptionText)
  if (location !== series.location) o.location = location ?? ''
  if (notes !== series.notes) o.notes = notes ?? ''
  return Object.keys(o).length > 1 ? o : null
}

/** Los eventos propios de una serie leída: uno con su regla, o uno por cada vez si la regla no se puede guardar igual. */
export function eventsFromSeries(s: ICSSeries, now: Date = new Date(), budget?: ImportBudget): CalendarEvent[] {
  const rule = faithfulRule(s, budget)
  if (rule) {
    const ev = singleEvent(importedEventID(s.uid), s.event, s, now)
    ev.recurrence = rule
    ev.timeZone = s.zone
    ev.exceptions = s.excluded.map((d) => new Date(d))
    for (const c of s.changed) {
      const o = overrideFor(ev, c.original, c.event)
      if (o) ev.overrides[occurrenceKey(c.original, s.zone, ev.allDay)] = o
    }
    // una serie de tareas: lo hecho va por repetición
    if (ev.task) ev.task = newTask()
    return [ev]
  }
  if (!s.rule && !s.hasExtraDates && !s.changed.length) return [singleEvent(importedEventID(s.uid), s.event, s, now)]
  // cada vez, suelta (con su propio id estable)
  const out: CalendarEvent[] = []
  const span = s.event.end ? s.event.end.getTime() - s.event.start.getTime() : null
  for (const start of s.occurrences) {
    const end = span === null ? null : s.event.allDay ? addDays(start, Math.max(1, Math.round(span / 86_400_000)), s.zone) : new Date(start.getTime() + span)
    const e: StudyEvent = { ...s.event, start, end }
    out.push(singleEvent(importedEventID(`${s.uid}#${compactStamp(start.getTime())}`), e, s, now))
  }
  for (const c of s.changed) out.push(singleEvent(importedEventID(`${s.uid}#${compactStamp(c.original.getTime())}`), c.event, s, now))
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Añade al calendario lo leído de un .ics. Lo que ya estaba (mismo id, es decir, mismo UID) no se toca. */
export function importSeriesInto(f: CalendarFile, series: ICSSeries[], opts: ICSImportOptions = {}): ICSImportSummary {
  const now = opts.now ?? new Date()
  const existing = new Set(f.events.map((e) => e.id))
  const added: CalendarEvent[] = []
  const budget: ImportBudget = { ruleWork: 0 }
  let recurring = 0
  let skipped = 0
  // lleno, se para (no se sigue convirtiendo el resto del archivo)
  series: for (const s of series) {
    for (const ev of eventsFromSeries(s, now, budget)) {
      if (existing.has(ev.id)) { skipped += 1; continue }
      if (added.length >= MAX_IMPORTED_EVENTS) break series
      existing.add(ev.id)
      f.events.push(ev)
      added.push(ev)
      if (ev.recurrence) recurring += 1
    }
  }
  return { added, recurring, skipped }
}

/** Lee un .ics y lo añade al calendario (ver `importSeriesInto`). */
export function importICSInto(f: CalendarFile, input: string | Uint8Array, opts: ICSImportOptions = {}): ICSImportSummary {
  const parse: ICSParseOptions = { now: opts.now, timeZone: opts.timeZone ?? localTimeZone() }
  return importSeriesInto(f, parseICSSeries(input, parse), opts)
}
