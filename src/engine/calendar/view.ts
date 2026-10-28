// Lo que cruza el IPC: eventos del motor (con `Date`) ↔ vistas JSON de `@shared/calendar`, y la lectura validada de lo que
// manda la interfaz (borradores y cambios). También la frase de vista previa de «Añadir rápido».
import type {
  CalendarDraftInput, CalendarEventView, CalendarPatchInput, CalendarReminderView, CalendarSnapshotView
} from '@shared/calendar'
import { CALENDAR_EVENT_KINDS, isSubscriptionID } from '@shared/calendar'
import { localTimeZone, makeInstant, parseISODate } from '@engine/calendar/time'
import {
  CalendarError, CalendarMessages, eventZone, isEditable, isNamedTimeZone, isTask, kindTitle, type CalendarEvent, type CalendarEventDraft, type CalendarEventKind,
  type CalendarEventPatch, type CalendarReminder, type CalendarSnapshot
} from './model'
import type { QuickEventResult } from './quickAdd'
import { tr } from '@shared/ai/i18n'
import { formatRRule, parseRRule, RecurrenceParseError, recurrenceSummary, type CalendarLanguage, type RecurrenceRule } from './rrule'

export interface ViewOptions {
  language?: CalendarLanguage
  /** Zona del sistema (la de los eventos sin zona propia). */
  timeZone?: string
}

/** Un evento para la interfaz. En una repetición, `id` es el de la serie y `occurrenceKey` su clave. */
export function toEventView(e: CalendarEvent, opts: ViewOptions = {}): CalendarEventView {
  const tz = eventZone(e, opts.timeZone ?? localTimeZone())
  const v: CalendarEventView = {
    id: e.seriesID && e.occurrenceKey ? e.seriesID : e.id,
    title: e.title,
    kind: e.kind,
    start: e.start.toISOString(),
    end: e.end ? e.end.toISOString() : null,
    allDay: e.allDay,
    origin: e.origin,
    reminders: [...e.reminders],
    isTask: isTask(e),
    editable: isEditable(e)
  }
  if (e.seriesID && e.occurrenceKey) v.occurrenceKey = e.occurrenceKey
  if (e.course) v.course = e.course
  if (e.notes) v.notes = e.notes
  if (e.location) v.location = e.location
  if (e.url) v.url = e.url
  if (e.platformID) v.platformID = e.platformID
  if (e.origin === 'platform' && isSubscriptionID(e.platformID)) v.subscriptionID = e.platformID
  if (e.platformLabel) v.platformLabel = e.platformLabel
  if (e.platformCourseID !== undefined) v.platformCourseID = e.platformCourseID
  if (e.packID) v.packID = e.packID
  if (e.createdBy) v.createdBy = e.createdBy
  if (e.created) v.created = e.created.toISOString()
  if (e.updated) v.updated = e.updated.toISOString()
  if (e.recurrence) {
    v.recurrence = formatRRule(e.recurrence, { allDay: e.allDay, timeZone: tz })
    v.recurrenceText = recurrenceSummary(e.recurrence, { language: opts.language, timeZone: tz })
  }
  if (e.timeZone) v.timeZone = e.timeZone
  if (isTask(e)) v.task = { done: e.task?.done ?? false, ...(e.task?.completedAt ? { completedAt: e.task.completedAt.toISOString() } : {}) }
  return v
}

export function toSnapshotView(s: CalendarSnapshot, opts: ViewOptions = {}): CalendarSnapshotView {
  const out: CalendarSnapshotView = { events: s.events.map((e) => toEventView(e, opts)) }
  if (s.platformError) out.platformError = s.platformError
  if (s.fileProblem) out.fileProblem = s.fileProblem
  if (s.fetchedAt) out.fetchedAt = s.fetchedAt.toISOString()
  return out
}

export function toReminderView(r: CalendarReminder): CalendarReminderView {
  return { id: r.id, eventID: r.eventID, title: r.title, kind: r.kind, eventStart: r.eventStart.toISOString(), fireAt: r.fireAt.toISOString(), minutesBefore: r.minutesBefore }
}

// MARK: - Lo que manda la interfaz

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Un instante: ISO 8601 con zona («…Z», «…+02:00») o la hora de pared en `tz` («2026-10-19T10:00», «2026-10-19»). */
export function parseInstant(s: string, tz: string = localTimeZone()): { date: Date; dateOnly: boolean } | null {
  const t = s.trim()
  if (!t) return null
  const iso = parseISODate(t)
  if (iso) return { date: iso, dateOnly: false }
  const m = LOCAL_RE.exec(t)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const h = m[4] !== undefined ? Number(m[4]) : 0, mi = m[5] !== undefined ? Number(m[5]) : 0, se = m[6] !== undefined ? Number(m[6]) : 0
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > dim || h > 23 || mi > 59 || se > 59) return null
  return { date: new Date(makeInstant(y, mo, d, h, mi, se, tz)), dateOnly: m[4] === undefined }
}

function needDate(v: unknown, field: string, tz: string): Date {
  const p = typeof v === 'string' ? parseInstant(v, tz) : null
  if (!p) throw CalendarError.invalid(tr(`Fecha no válida (${field}).`, `Invalid date (${field}).`))
  return p.date
}

function optText(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw CalendarError.invalid(tr(`Texto no válido (${field}).`, `Invalid text (${field}).`))
  return v.length > 20_000 ? Array.from(v).slice(0, 20_000).join('') : v
}

function optBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw CalendarError.invalid(tr(`Valor no válido (${field}).`, `Invalid value (${field}).`))
  return v
}

function optKind(v: unknown): CalendarEventKind | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !(CALENDAR_EVENT_KINDS as readonly string[]).includes(v)) throw CalendarError.invalid(tr('Tipo de evento no válido.', 'Invalid event type.'))
  return v as CalendarEventKind
}

function optReminders(v: unknown): number[] | undefined {
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw CalendarError.invalid(tr('Avisos no válidos.', 'Invalid reminders.'))
  return v.map((x) => Math.trunc(x as number))
}

/** «FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=2026-12-20» (también con la fecha con guiones, como la escriben los modelos). */
export function parseRuleText(text: string | null | undefined, tz: string = localTimeZone()): RecurrenceRule | undefined {
  const t = text?.trim()
  if (!t) return undefined
  const fixed = t.replace(/UNTIL=(\d{4})-(\d{2})-(\d{2})/gi, 'UNTIL=$1$2$3')
  try {
    return parseRRule(fixed, tz)
  } catch (err) {
    if (err instanceof RecurrenceParseError) throw CalendarError.invalid(err.message)
    throw err
  }
}

/** Un borrador de la interfaz, validado. */
export function draftFromInput(raw: unknown, tz: string = localTimeZone()): CalendarEventDraft {
  if (!isObj(raw)) throw CalendarError.invalid(tr('Evento no válido.', 'Invalid event.'))
  const i = raw as Partial<CalendarDraftInput> & Obj
  const zone = typeof i.timeZone === 'string' && isNamedTimeZone(i.timeZone) ? i.timeZone : undefined
  const ruleZone = zone ?? tz
  const title = optText(i.title, 'title')
  if (title === undefined) throw CalendarError.invalid(CalendarMessages.missingTitle)
  const d: CalendarEventDraft = { title, start: needDate(i.start, 'start', ruleZone) }
  const kind = optKind(i.kind)
  if (kind) d.kind = kind
  if (i.end !== undefined && i.end !== null) d.end = needDate(i.end, 'end', ruleZone)
  const allDay = optBool(i.allDay, 'allDay')
  if (allDay !== undefined) d.allDay = allDay
  for (const k of ['course', 'notes', 'location', 'url', 'packID'] as const) {
    const v = optText(i[k], k)
    if (v !== undefined) d[k] = v
  }
  const rule = typeof i.recurrence === 'string' ? parseRuleText(i.recurrence, ruleZone) : undefined
  if (i.recurrence !== undefined && i.recurrence !== null && typeof i.recurrence !== 'string') throw CalendarError.invalid(tr('Repetición no válida.', 'Invalid repetition.'))
  if (rule) d.recurrence = rule
  if (zone) d.timeZone = zone
  const reminders = optReminders(i.reminders)
  if (reminders) d.reminders = reminders
  const isTaskFlag = optBool(i.isTask, 'isTask')
  if (isTaskFlag !== undefined) d.isTask = isTaskFlag
  return d
}

/** Un cambio de la interfaz, validado. */
export function patchFromInput(raw: unknown, tz: string = localTimeZone()): CalendarEventPatch {
  if (!isObj(raw)) throw CalendarError.invalid(tr('Cambio no válido.', 'Invalid change.'))
  const i = raw as Partial<CalendarPatchInput> & Obj
  const p: CalendarEventPatch = {}
  const title = optText(i.title, 'title')
  if (title !== undefined) p.title = title
  const kind = optKind(i.kind)
  if (kind) p.kind = kind
  if (i.start !== undefined && i.start !== null) p.start = needDate(i.start, 'start', tz)
  if (i.end !== undefined && i.end !== null) p.end = needDate(i.end, 'end', tz)
  const allDay = optBool(i.allDay, 'allDay')
  if (allDay !== undefined) p.allDay = allDay
  for (const k of ['course', 'notes', 'location', 'url', 'packID'] as const) {
    const v = optText(i[k], k)
    if (v !== undefined) p[k] = v
  }
  for (const k of ['clearEnd', 'clearPack', 'clearRecurrence', 'isTask'] as const) {
    const v = optBool(i[k], k)
    if (v !== undefined) p[k] = v
  }
  if (typeof i.recurrence === 'string') {
    if (i.recurrence.trim().toLowerCase() === 'none') p.clearRecurrence = true
    else {
      const r = parseRuleText(i.recurrence, tz)
      if (r) p.recurrence = r
    }
  }
  const reminders = optReminders(i.reminders)
  if (reminders) p.reminders = reminders
  return p
}

// MARK: - Vista previa de «Añadir rápido»

/** «Examen · lunes 19 de octubre, 10:00–12:00 · Inglés · Cada semana: lunes y miércoles». */
export function quickSummary(r: QuickEventResult, lang: CalendarLanguage = 'es'): string {
  const tz = r.timeZone
  const parts = [r.title, kindTitle(r.kind, lang)]
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(r.start)
  if (r.allDay) parts.push(day)
  else {
    const time = (d: Date) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d)
    parts.push(`${day}, ${time(r.start)}${r.end && r.end.getTime() > r.start.getTime() ? '–' + time(r.end) : ''}`)
  }
  if (r.course) parts.push(r.course)
  if (r.recurrence) parts.push(recurrenceSummary(r.recurrence, { language: lang, timeZone: tz }))
  return parts.join(' · ')
}
