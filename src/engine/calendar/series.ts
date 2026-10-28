// Eventos propios que se repiten (StudyCalendar+Series.swift): claves de las repeticiones, cada repetición como evento, lo
// cambiado solo una vez, partir una serie en dos y mover toda la serie conservando los días quitados y las tareas hechas.
import { addDays, daysBetween, fromWallSeconds, makeInstant, pad, startOfDay, wallSeconds, wallTime } from '@engine/calendar/time'
import { expandOccurrences } from './expander'
import {
  CalendarError, CalendarMessages, cleanText, cloneEvent, eventZone, isTask, prefixChars, type CalendarEvent, type CalendarEventPatch,
  type CalendarOccurrenceOverride, type CalendarTask
} from './model'
import { rulesEqual } from './rrule'
import { tr } from '@shared/ai/i18n'

const SECOND = 1000
const DAY_MS = 86_400_000

/** «own:abc#20261014T100000» → [«own:abc», «20261014T100000»]. */
export function splitOccurrence(id: string): [string, string] | null {
  if (!id.startsWith('own:')) return null
  const hash = id.indexOf('#')
  if (hash < 0) return null
  const key = id.slice(hash + 1)
  return key ? [id.slice(0, hash), key] : null
}

/** Clave de una repetición: su inicio ORIGINAL en hora de pared de la zona del evento («20261014T100000», o «20261014» si
 *  es de todo el día). No cambia con el horario de verano ni con la zona del sistema. */
export function occurrenceKey(start: Date, timeZone: string, allDay: boolean): string {
  const w = wallTime(start, timeZone)
  const day = `${pad(w.year, 4)}${pad(w.month, 2)}${pad(w.day, 2)}`
  return allDay ? day : `${day}T${pad(w.hour, 2)}${pad(w.minute, 2)}${pad(w.second, 2)}`
}

/** El inicio original que corresponde a una clave. */
export function instantForKey(key: string, timeZone: string): Date | null {
  const digits = key.replace(/\D/g, '')
  if (digits.length !== 8 && digits.length !== 14) return null
  const num = (a: number, b: number) => Number(digits.slice(a, a + b))
  const [h, mi, s] = digits.length === 14 ? [num(8, 2), num(10, 2), num(12, 2)] : [0, 0, 0]
  return new Date(makeInstant(num(0, 4), num(4, 2), num(6, 2), h, mi, s, timeZone))
}

/** La duración de cada repetición: la del evento (en los de todo el día, en días de calendario). */
export function endFor(e: CalendarEvent, start: Date, defaultZone?: string): Date | undefined {
  if (!e.end || e.end.getTime() <= e.start.getTime()) return undefined
  if (e.allDay) {
    const tz = eventZone(e, defaultZone)
    const days = daysBetween(startOfDay(e.start, tz), startOfDay(e.end, tz), tz)
    return addDays(startOfDay(start, tz), Math.max(1, days), tz)
  }
  return new Date(start.getTime() + (e.end.getTime() - e.start.getTime()))
}

function overrideIsEmpty(o: CalendarOccurrenceOverride): boolean {
  return o.start === undefined && o.end === undefined && o.title === undefined && o.notes === undefined && o.location === undefined && o.kind === undefined &&
    o.allDay === undefined && o.course === undefined && o.url === undefined && !o.cancelled
}
export { overrideIsEmpty }

/** Una repetición concreta como evento (id `own:<id>#<clave>`), con lo cambiado solo esa vez. `null` si esa vez no hay. */
export function instance(e: CalendarEvent, original: Date, key: string, defaultZone?: string): CalendarEvent | null {
  const i = cloneEvent(e)
  delete i.preserved
  i.id = e.id + '#' + key
  i.seriesID = e.id
  i.occurrenceKey = key
  i.start = original
  i.end = endFor(e, original, defaultZone)
  i.exceptions = []
  i.overrides = {}
  const o = e.overrides[key]
  if (o) {
    if (o.cancelled) return null
    if (o.allDay !== undefined && o.allDay !== e.allDay) {
      i.allDay = o.allDay
      // pasa a todo el día: ese día entero (salvo que también se diera la hora)
      if (o.allDay && o.start === undefined) {
        const tz = eventZone(e, defaultZone)
        i.start = startOfDay(original, tz)
        i.end = addDays(i.start, 1, tz)
      }
    }
    if (o.start) {
      const d = i.end ? i.end.getTime() - i.start.getTime() : undefined
      i.start = o.start
      i.end = o.end ?? (d !== undefined ? new Date(o.start.getTime() + d) : undefined)
    } else if (o.end) i.end = o.end
    if (o.title !== undefined) i.title = o.title
    if (o.notes !== undefined) i.notes = o.notes
    if (o.location !== undefined) i.location = o.location
    if (o.kind !== undefined) i.kind = o.kind
    if (o.course !== undefined) i.course = o.course || undefined
    if (o.url !== undefined) i.url = o.url || undefined
  }
  if (isTask(e)) {
    const doneAt = e.task?.doneOccurrences[key]
    i.task = { done: doneAt !== undefined, doneOccurrences: {}, ...(doneAt ? { completedAt: doneAt } : {}) }
  }
  return i
}

/** Un evento propio entre `from` y `to`: él mismo si no se repite; si se repite, cada repetición (sin las quitadas). */
export function expandEvent(e: CalendarEvent, from: Date, to: Date, defaultZone?: string): CalendarEvent[] {
  const rule = e.recurrence
  if (!rule) return [e]
  const tz = eventZone(e, defaultZone)
  const span = Math.max(e.end ? e.end.getTime() - e.start.getTime() : 0, e.allDay ? DAY_MS : 3_600_000)
  const excluded = new Set(e.exceptions.map((x) => occurrenceKey(x, tz, e.allDay)))
  const out: CalendarEvent[] = []
  const seen = new Set<string>()
  for (const s of expandOccurrences(e.start, rule, tz, new Date(from.getTime() - span), to)) {
    const key = occurrenceKey(s, tz, e.allDay)
    seen.add(key)
    if (excluded.has(key)) continue
    const i = instance(e, s, key, defaultZone)
    if (i) out.push(i)
  }
  // una repetición movida DENTRO del rango desde fuera de él
  for (const [key, o] of Object.entries(e.overrides)) {
    if (seen.has(key) || excluded.has(key) || o.cancelled || !o.start) continue
    if (o.start.getTime() > to.getTime() || o.start.getTime() + span < from.getTime()) continue
    const original = instantForKey(key, tz)
    if (!original || !isOccurrence(e, original, defaultZone)) continue
    const i = instance(e, original, key, defaultZone)
    if (i) out.push(i)
  }
  return out
}

/** ¿`start` es de verdad una repetición del evento? (para no aceptar ids inventados) */
export function isOccurrence(e: CalendarEvent, start: Date, defaultZone?: string): boolean {
  if (!e.recurrence) return start.getTime() === e.start.getTime()
  const t = start.getTime()
  return expandOccurrences(e.start, e.recurrence, eventZone(e, defaultZone), new Date(t - SECOND), new Date(t + SECOND)).some((d) => d.getTime() === t)
}

/** La repetición `key` de un evento (`null` si no existe o se quitó). */
export function occurrence(e: CalendarEvent, key: string, defaultZone?: string): CalendarEvent | null {
  if (!e.recurrence) return null
  const tz = eventZone(e, defaultZone)
  const s = instantForKey(key, tz)
  if (!s || !isOccurrence(e, s, defaultZone)) return null
  if (e.exceptions.some((x) => occurrenceKey(x, tz, e.allDay) === key)) return null
  return instance(e, s, key, defaultZone)
}

/** Avisos válidos: entre 0 y 60 días antes, sin repetir, ordenados y como mucho cinco. */
export function cleanReminders(list: number[]): number[] {
  return [...new Set(list.filter((m) => Number.isInteger(m) && m >= 0 && m <= 60 * 24 * 60))].sort((a, b) => a - b).slice(0, 5)
}

/** Lo de la serie que trae un cambio (repetición, avisos, tarea). */
export function applySeriesFields(patch: CalendarEventPatch, e: CalendarEvent, defaultZone: string): void {
  if (patch.recurrence) {
    e.recurrence = patch.recurrence
    if (!e.timeZone) e.timeZone = defaultZone
  }
  if (patch.clearRecurrence === true) {
    e.recurrence = undefined
    e.exceptions = []
    e.overrides = {}
  }
  if (patch.reminders) e.reminders = cleanReminders(patch.reminders)
  if (patch.isTask !== undefined) e.task = patch.isTask ? e.task ?? newTask() : undefined
}

export function newTask(): CalendarTask {
  return { done: false, doneOccurrences: {} }
}

/** Aplica a un evento propio los campos de un cambio. */
export function applyPatch(patch: CalendarEventPatch, e: CalendarEvent, defaultZone: string): void {
  const t = cleanText(patch.title)
  if (t !== undefined) e.title = prefixChars(t, 200)
  if (patch.kind) e.kind = patch.kind
  if (patch.start) {
    // mover el inicio arrastra el fin (misma duración), salvo que también venga un fin nuevo
    if (e.end && patch.end === undefined && patch.clearEnd !== true) e.end = new Date(patch.start.getTime() + (e.end.getTime() - e.start.getTime()))
    e.start = patch.start
  }
  if (patch.end) e.end = patch.end
  if (patch.clearEnd === true) e.end = undefined
  if (patch.allDay !== undefined) e.allDay = patch.allDay
  if (patch.course !== undefined) e.course = cleanText(patch.course)
  if (patch.notes !== undefined) e.notes = cleanText(patch.notes)
  if (patch.location !== undefined) e.location = cleanText(patch.location)
  if (patch.url !== undefined) e.url = cleanText(patch.url)
  if (patch.packID !== undefined) e.packID = patch.packID
  if (patch.clearPack === true) e.packID = undefined
  applySeriesFields(patch, e, defaultZone)
}

/** Lo que solo se puede cambiar en la serie y viene distinto en un cambio de «solo esta vez» (`null` = nada). */
export function seriesOnlyChange(patch: CalendarEventPatch, e: CalendarEvent): string | null {
  const howItRepeats = (): string => tr('cómo se repite', 'how it repeats')
  if (patch.recurrence && !rulesEqual(patch.recurrence, e.recurrence)) return howItRepeats()
  if (patch.clearRecurrence === true && e.recurrence) return howItRepeats()
  if (patch.reminders) {
    const r = cleanReminders(patch.reminders)
    if (r.length !== e.reminders.length || r.some((m, i) => m !== e.reminders[i])) return tr('los avisos', 'the reminders')
  }
  if (patch.isTask !== undefined && patch.isTask !== (e.task !== undefined)) return tr('si es una tarea', 'whether it’s a task')
  const pack = patch.clearPack === true ? undefined : patch.packID ?? e.packID
  if (pack !== e.packID) return tr('el curso de Aula vinculado', 'the linked Aula course')
  return null
}

/** Aplica un cambio a una serie entera (o a la cola nueva de «esta y las siguientes»), con `current` = la repetición que se
 *  editó tal como se ve. Solo es mover si el inicio que llega es distinto del de esa repetición: entonces el inicio de la
 *  serie se desplaza la misma hora de pared y los días quitados, los cambios sueltos y las tareas hechas cambian de clave
 *  con ella. El fin se toma como duración. */
export function applyToSeries(patch: CalendarEventPatch, e: CalendarEvent, current: CalendarEvent, editedKey: string, defaultZone: string): void {
  const tz = eventZone(e, defaultZone)
  const oldAllDay = e.allDay
  const p: CalendarEventPatch = { ...patch }
  const moved = patch.start ? patch.start.getTime() !== current.start.getTime() : false
  const delta = moved && patch.start ? wallSeconds(patch.start, tz) - wallSeconds(current.start, tz) : 0
  const duration = patch.end ? patch.end.getTime() - (patch.start ?? current.start).getTime() : undefined
  p.start = moved ? fromWallSeconds(wallSeconds(e.start, tz) + delta, tz) : undefined
  p.end = duration !== undefined ? new Date((p.start ?? e.start).getTime() + duration) : undefined
  applyPatch(p, e, defaultZone)
  if (e.end && e.end.getTime() < e.start.getTime()) throw CalendarError.invalid(CalendarMessages.endBeforeStart)
  if (!e.recurrence || !(moved || e.allDay !== oldAllDay)) return
  const shifted = (d: Date) => fromWallSeconds(wallSeconds(d, tz) + delta, tz)
  const rekey = (key: string): string | null => {
    const i = instantForKey(key, tz)
    return i ? occurrenceKey(shifted(i), tz, e.allDay) : null
  }
  e.exceptions = e.exceptions.map(shifted)
  const overrides: Record<string, CalendarOccurrenceOverride> = {}
  for (const [k, o0] of Object.entries(e.overrides)) {
    const nk = rekey(k)
    if (nk === null) continue
    const o = { ...o0 }
    // la repetición editada pasa a la hora nueva de la serie: ya no lleva su propia hora
    if (k === editedKey && moved) { delete o.start; delete o.end }
    if (!overrideIsEmpty(o)) overrides[nk] = o
  }
  e.overrides = overrides
  if (e.task) {
    const done: Record<string, Date> = {}
    for (const [k, v] of Object.entries(e.task.doneOccurrences)) {
      const nk = rekey(k)
      if (nk !== null && done[nk] === undefined) done[nk] = v
    }
    e.task.doneOccurrences = done
  }
}

/** La serie termina justo antes de `original` (y la cola sigue con las veces que le queden si la regla contaba veces). */
export function endSeries(e: CalendarEvent, original: Date, tail: CalendarEvent, defaultZone?: string): void {
  if (!e.recurrence) return
  const rule = { ...e.recurrence }
  if (rule.count !== undefined) {
    const done = expandOccurrences(e.start, e.recurrence, eventZone(e, defaultZone), e.start, new Date(original.getTime() - SECOND)).length
    const total = rule.count
    rule.count = Math.max(1, done)
    tail.recurrence = { ...rule, count: Math.max(1, total - done) }
  } else {
    rule.until = new Date(original.getTime() - SECOND)
  }
  e.recurrence = rule
}

/** El inicio original de una clave (o el pasado lejano si no se entiende), para repartir lo de una serie partida. */
export function keyInstantOr(key: string, tz: string, fallback = -8.64e15): number {
  return instantForKey(key, tz)?.getTime() ?? fallback
}
