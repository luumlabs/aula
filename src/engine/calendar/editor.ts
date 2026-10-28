// El formulario de un evento en la interfaz («Nuevo evento» y la hoja de cada evento), puro e isomorfo: del evento a los
// campos y de los campos al borrador (evento nuevo) o al cambio. El cambio lleva SOLO lo que se tocó, para que «solo esta
// vez» no toque lo que es de toda la serie y para no reescribir lo que el estudiante no cambió.
// Fechas como las dan los campos del formulario: «2026-10-26» y «10:30», en la zona del estudiante.
import type { CalendarDraftInput, CalendarEventKind, CalendarEventView, CalendarPatchInput } from '@shared/calendar'
import { addDays, isoWeekday, makeInstant, pad, wallTime } from '@engine/calendar/time'
import { DAY_CODES, parseRRule } from './rrule'

/** Cómo se repite en el formulario («custom» = una regla que el formulario no sabe dibujar y se conserva tal cual). */
export type RepeatMode = 'none' | 'daily' | 'weekly' | 'custom'

export interface EventForm {
  title: string
  kind: CalendarEventKind
  isTask: boolean
  /** Curso de Aula vinculado. */
  packID: string | null
  allDay: boolean
  /** «2026-10-26». */
  startDate: string
  /** «10:30» (no cuenta en los de todo el día). */
  startTime: string
  /** ¿Tiene fin? (en los de todo el día, el fin es el último día) */
  hasEnd: boolean
  endDate: string
  endTime: string
  repeat: RepeatMode
  /** Días de «cada semana»: 1 = lunes … 7 = domingo. */
  weekdays: number[]
  /** Último día de la repetición («» = sin fin). */
  until: string
  /** La regla tal cual cuando `repeat` es «custom». */
  customRule: string | null
  location: string
  notes: string
}

/** Lo que significa el formulario: lo que se compara y se guarda. */
export interface EventFormValues {
  title: string
  kind: CalendarEventKind
  isTask: boolean
  packID: string | null
  allDay: boolean
  start: Date
  end: Date | null
  rule: string | null
  location: string
  notes: string
}

export type EventFormError = 'title' | 'date' | 'endBeforeStart' | 'untilBeforeStart' | 'weekdays'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/
const HOUR = 3_600_000

/** «2026-10-26» de un instante en una zona. */
export function dateKey(d: Date, tz: string): string {
  const w = wallTime(d, tz)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`
}

/** «10:30» de un instante en una zona. */
export function timeKey(d: Date, tz: string): string {
  const w = wallTime(d, tz)
  return `${pad(w.hour, 2)}:${pad(w.minute, 2)}`
}

function civil(date: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(date)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null
  return { y, m: mo, d }
}

/** El instante de un día y una hora del formulario (`null` si no se entienden). Sin hora, la medianoche. */
export function formInstant(date: string, time: string | null, tz: string): Date | null {
  const c = civil(date)
  if (!c) return null
  let h = 0, mi = 0
  if (time !== null) {
    const t = TIME_RE.exec(time)
    if (!t) return null
    h = Number(t[1])
    mi = Number(t[2])
    if (h > 23 || mi > 59) return null
  }
  return new Date(makeInstant(c.y, c.m, c.d, h, mi, 0, tz))
}

/** Día de la semana de una fecha del formulario: 1 = lunes … 7 = domingo. */
export function isoWeekdayOf(date: string): number {
  const c = civil(date)
  return c ? isoWeekday(c.y, c.m, c.d) : 1
}

/** ISO (1 = lunes) → código RRULE («MO»). */
function dayCode(iso: number): string {
  return DAY_CODES[iso % 7]
}

/** La repetición de una regla RRULE tal como la dibuja el formulario. */
export function repeatFromRule(rule: string | null | undefined, startDate: string, tz: string): Pick<EventForm, 'repeat' | 'weekdays' | 'until' | 'customRule'> {
  const plain = { repeat: 'none' as RepeatMode, weekdays: [isoWeekdayOf(startDate)], until: '', customRule: null }
  if (!rule?.trim()) return plain
  let r
  try {
    r = parseRRule(rule, tz)
  } catch {
    return { ...plain, repeat: 'custom', customRule: rule }
  }
  const until = r.until ? dateKey(r.until, tz) : ''
  const simple = r.interval === 1 && r.count === undefined && !r.byMonthDay.length && !r.byMonth.length && !r.bySetPos.length
  if (simple && r.frequency === 'DAILY' && !r.byDay.length) return { ...plain, repeat: 'daily', until }
  if (simple && r.frequency === 'WEEKLY' && r.byDay.every((d) => d.ordinal === undefined)) {
    const days = r.byDay.length ? [...new Set(r.byDay.map((d) => (d.weekday === 1 ? 7 : d.weekday - 1)))].sort((a, b) => a - b) : plain.weekdays
    return { ...plain, repeat: 'weekly', weekdays: days, until }
  }
  return { ...plain, repeat: 'custom', customRule: rule }
}

/** La regla RRULE del formulario (`null` = no se repite). «Hasta» es el último día entero. */
export function ruleFromForm(f: Pick<EventForm, 'repeat' | 'weekdays' | 'until' | 'customRule' | 'startDate'>): string | null {
  const until = civil(f.until) ? ';UNTIL=' + f.until.replace(/-/g, '') : ''
  switch (f.repeat) {
    case 'none': return null
    case 'custom': return f.customRule
    case 'daily': return 'FREQ=DAILY' + until
    case 'weekly': {
      const days = (f.weekdays.length ? [...new Set(f.weekdays)] : [isoWeekdayOf(f.startDate)]).sort((a, b) => a - b)
      return 'FREQ=WEEKLY;BYDAY=' + days.map(dayCode).join(',') + until
    }
  }
}

/** Un formulario vacío que empieza en `start` (una hora; o el día entero). */
export function emptyEventForm(start: Date, tz: string, opts: { allDay?: boolean; kind?: CalendarEventKind; title?: string } = {}): EventForm {
  const end = new Date(start.getTime() + HOUR)
  const startDate = dateKey(start, tz)
  return {
    title: opts.title ?? '', kind: opts.kind ?? 'event', isTask: opts.kind === 'assignment', packID: null, allDay: opts.allDay ?? false,
    startDate, startTime: timeKey(start, tz), hasEnd: !opts.allDay, endDate: dateKey(end, tz), endTime: timeKey(end, tz),
    repeat: 'none', weekdays: [isoWeekdayOf(startDate)], until: '', customRule: null, location: '', notes: ''
  }
}

/** El formulario de un evento que ya existe (o de una repetición: con sus fechas de esa vez). */
export function eventFormFromView(v: CalendarEventView, tz: string): EventForm {
  const start = new Date(v.start)
  const end = v.end ? new Date(v.end) : null
  const startDate = dateKey(start, tz)
  const f: EventForm = {
    ...emptyEventForm(start, tz, { allDay: v.allDay, kind: v.kind, title: v.title }),
    isTask: v.isTask, packID: v.packID ?? null, location: v.location ?? '', notes: v.notes ?? ''
  }
  if (v.allDay) {
    // el fin de los de todo el día es exclusivo: el último día es el anterior
    const last = end && end.getTime() > start.getTime() ? addDays(end, -1, tz) : start
    f.endDate = dateKey(last.getTime() < start.getTime() ? start : last, tz)
    f.hasEnd = f.endDate !== startDate
  } else if (end && end.getTime() > start.getTime()) {
    f.hasEnd = true
    f.endDate = dateKey(end, tz)
    f.endTime = timeKey(end, tz)
  } else {
    f.hasEnd = false
  }
  return { ...f, ...repeatFromRule(v.recurrence, startDate, tz) }
}

/** Al mover el inicio, el fin se mueve igual (misma duración). */
export function moveFormStart(f: EventForm, next: Pick<EventForm, 'startDate' | 'startTime'>, tz: string): EventForm {
  const before = formInstant(f.startDate, f.allDay ? null : f.startTime, tz)
  const after = formInstant(next.startDate, f.allDay ? null : next.startTime, tz)
  const out = { ...f, ...next }
  if (!before || !after) return out
  if (f.allDay) {
    const s = formInstant(f.startDate, null, tz), e = formInstant(f.endDate, null, tz)
    const days = s && e ? Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000)) : 0
    out.endDate = dateKey(addDays(after, days, tz), tz)
  } else {
    const end = formInstant(f.endDate, f.endTime, tz)
    const span = end && end.getTime() > before.getTime() ? end.getTime() - before.getTime() : HOUR
    const ne = new Date(after.getTime() + span)
    out.endDate = dateKey(ne, tz)
    out.endTime = timeKey(ne, tz)
  }
  // «cada semana» sin tocar los días sigue el día del inicio
  if (f.repeat === 'weekly' && f.weekdays.length === 1 && f.weekdays[0] === isoWeekdayOf(f.startDate)) out.weekdays = [isoWeekdayOf(next.startDate)]
  return out
}

/** Lo que significa el formulario, o el primer problema que tiene. */
export function eventFormValues(f: EventForm, tz: string): { values: EventFormValues } | { error: EventFormError } {
  const title = f.title.trim()
  if (!title) return { error: 'title' }
  const start = formInstant(f.startDate, f.allDay ? null : f.startTime, tz)
  if (!start) return { error: 'date' }
  const due = f.kind === 'assignment'
  let end: Date | null = null
  if (f.allDay) {
    if (f.hasEnd && f.endDate !== f.startDate) {
      const last = formInstant(f.endDate, null, tz)
      if (!last) return { error: 'date' }
      if (last.getTime() < start.getTime()) return { error: 'endBeforeStart' }
      end = addDays(last, 1, tz)
    }
  } else if (f.hasEnd && !due) {
    end = formInstant(f.endDate, f.endTime, tz)
    if (!end) return { error: 'date' }
    if (end.getTime() < start.getTime()) return { error: 'endBeforeStart' }
    if (end.getTime() === start.getTime()) end = null
  }
  if (f.repeat === 'weekly' && !f.weekdays.length) return { error: 'weekdays' }
  if (f.repeat !== 'none' && f.repeat !== 'custom' && f.until) {
    const u = formInstant(f.until, null, tz)
    if (!u) return { error: 'date' }
    if (addDays(u, 1, tz).getTime() <= start.getTime()) return { error: 'untilBeforeStart' }
  }
  return {
    values: {
      title, kind: f.kind, isTask: f.isTask || due, packID: f.packID, allDay: f.allDay, start, end, rule: ruleFromForm(f),
      location: f.location.trim(), notes: f.notes.trim()
    }
  }
}

/** El borrador de un evento nuevo. En «cada semana», la primera vez es el primer día elegido desde el inicio. */
export function eventDraftFromForm(f: EventForm, tz: string): CalendarDraftInput | EventFormError {
  const r = eventFormValues(f, tz)
  if ('error' in r) return r.error
  const v = r.values
  let { start, end } = v
  if (f.repeat === 'weekly' && f.weekdays.length) {
    const first = isoWeekdayOf(f.startDate)
    let shift = 0
    while (shift < 7 && !f.weekdays.includes(((first - 1 + shift) % 7) + 1)) shift += 1
    if (shift > 0 && shift < 7) {
      const moved = addDays(start, shift, tz)
      if (end) end = new Date(end.getTime() + (moved.getTime() - start.getTime()))
      start = moved
    }
  }
  const d: CalendarDraftInput = { title: v.title, kind: v.kind, start: start.toISOString(), allDay: v.allDay, isTask: v.isTask }
  if (end) d.end = end.toISOString()
  if (v.packID) d.packID = v.packID
  if (v.location) d.location = v.location
  if (v.notes) d.notes = v.notes
  if (v.rule) { d.recurrence = v.rule; d.timeZone = tz }
  return d
}

/** El cambio entre el formulario como se abrió y como está: solo lo distinto (vacío = nada que guardar). */
export function eventPatchFromForms(initial: EventForm, current: EventForm, tz: string): CalendarPatchInput | EventFormError {
  const now = eventFormValues(current, tz)
  if ('error' in now) return now.error
  const was = eventFormValues(initial, tz)
  const a = 'values' in was ? was.values : null
  const b = now.values
  const p: CalendarPatchInput = {}
  if (b.title !== a?.title) p.title = b.title
  if (b.kind !== a?.kind) p.kind = b.kind
  if (b.allDay !== a?.allDay) p.allDay = b.allDay
  if (b.start.getTime() !== a?.start.getTime()) p.start = b.start.toISOString()
  if ((b.end?.getTime() ?? null) !== (a?.end?.getTime() ?? null)) {
    if (b.end) p.end = b.end.toISOString()
    else p.clearEnd = true
  }
  if (b.isTask !== a?.isTask) p.isTask = b.isTask
  if (b.packID !== (a?.packID ?? null)) {
    if (b.packID) p.packID = b.packID
    else p.clearPack = true
  }
  if (b.rule !== (a?.rule ?? null)) {
    if (b.rule) p.recurrence = b.rule
    else p.clearRecurrence = true
  }
  if (b.location !== a?.location) p.location = b.location
  if (b.notes !== a?.notes) p.notes = b.notes
  return p
}

/** ¿Lleva algo que solo puede cambiar en toda la serie? (con «solo esta vez» no se permite) */
export function patchTouchesSeries(p: CalendarPatchInput): boolean {
  return p.recurrence !== undefined || p.clearRecurrence === true || p.isTask !== undefined || p.packID !== undefined || p.clearPack === true || p.reminders !== undefined
}
