// Horas del día, días de la semana, horas de silencio y claves de día (TimeOfDay, Weekdays, QuietHours y AutomationDay de
// AutomationModels.swift). Isomorfo: las cuentas de calendario van en la zona que se pasa (por defecto, la del sistema).
import { foldDiacritics } from '@engine/base/ids'
import { makeInstant, wallTime, localTimeZone } from '@engine/calendar/time'
import type { QuietHours, TimeText } from './types'

const MIN_PER_DAY = 1440

/** «08:00» a partir de horas y minutos (recortados a un día). */
export function timeText(hour: number, minute = 0): TimeText {
  const h = Math.min(23, Math.max(0, Math.trunc(hour)))
  const m = Math.min(59, Math.max(0, Math.trunc(minute)))
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Minutos del día → «HH:mm» (con vuelta: 1500 → «01:00»). */
export function timeFromMinutes(minutes: number): TimeText {
  const m = ((Math.trunc(minutes) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY
  return timeText(Math.floor(m / 60), m % 60)
}

/** Minutos desde medianoche de una hora «HH:mm» (0 si no se entiende). */
export function timeMinutes(t: TimeText): number {
  const p = parseTime(t)
  if (!p) return 0
  const [h, m] = p.split(':').map(Number)
  return h * 60 + m
}

/** «08:00», «8:30», «8», «20h», «8pm», «8:30 pm», «12am», «20.15» → «HH:mm». También minutos (número). `null` si no vale. */
export function parseTime(raw: unknown): TimeText | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return timeFromMinutes(raw)
  if (typeof raw !== 'string') return null
  let s = raw.toLowerCase().trim().replace(/\s+/g, '')
  let pm = false
  let am = false
  for (const suf of ['p.m.', 'pm']) if (s.endsWith(suf)) { pm = true; s = s.slice(0, -suf.length) }
  for (const suf of ['a.m.', 'am']) if (s.endsWith(suf)) { am = true; s = s.slice(0, -suf.length) }
  if (s.endsWith('h')) s = s.slice(0, -1)
  s = s.replace(/\./g, ':')
  const parts = s.split(':')
  if (parts.length > 2 || !/^\d{1,2}$/.test(parts[0])) return null
  let h = Number(parts[0])
  const m = parts.length === 2 ? (/^\d{1,2}$/.test(parts[1]) ? Number(parts[1]) : -1) : 0
  if (h < 0 || h > 24 || m < 0 || m > 59) return null
  if (pm && h < 12) h += 12
  if (am && h === 12) h = 0
  if (h === 24) h = 0
  return timeText(h, m)
}

/** Días de la semana como `Calendar` de Swift: 1 = domingo … 7 = sábado. */
export const WEEKDAYS = {
  all: [1, 2, 3, 4, 5, 6, 7],
  schoolDays: [2, 3, 4, 5, 6],
  weekend: [1, 7],
  /** En el orden de la semana de la app (lunes primero). */
  mondayFirst: [2, 3, 4, 5, 6, 7, 1]
}

const DAY_NAMES: [number, string[]][] = [
  [1, ['sun', 'sunday', 'dom', 'domingo', 'do']],
  [2, ['mon', 'monday', 'lun', 'lunes', 'lu']],
  [3, ['tue', 'tuesday', 'mar', 'martes', 'ma']],
  [4, ['wed', 'wednesday', 'mie', 'miercoles', 'mi']],
  [5, ['thu', 'thursday', 'jue', 'jueves', 'ju']],
  [6, ['fri', 'friday', 'vie', 'viernes', 'vi']],
  [7, ['sat', 'saturday', 'sab', 'sabado', 'sa']]
]

/** «mon», «lunes», «weekdays», «fin de semana»… → días (1…7, sin repetir y en orden). */
export function parseWeekdays(raw: readonly unknown[]): number[] {
  const out = new Set<number>()
  for (const r of raw) {
    if (typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 7) { out.add(r); continue }
    if (typeof r !== 'string') continue
    const s = foldDiacritics(r.toLowerCase()).trim()
    if (['weekdays', 'school days', 'laborables', 'entre semana', 'lunes a viernes'].includes(s)) WEEKDAYS.schoolDays.forEach((d) => out.add(d))
    else if (['weekend', 'fin de semana'].includes(s)) WEEKDAYS.weekend.forEach((d) => out.add(d))
    else if (['every day', 'daily', 'todos', 'todos los dias', 'all'].includes(s)) WEEKDAYS.all.forEach((d) => out.add(d))
    else {
      const hit = DAY_NAMES.find(([, names]) => names.includes(s))
      if (hit) out.add(hit[0])
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** Código corto para la IA («mon»). */
export function weekdayCode(d: number): string {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][Math.max(0, Math.min(6, d - 1))]
}

/** Día estable («2026-10-12») en la zona dada: para contar el uso diario. */
export function dayKey(date: Date | number, tz: string = localTimeZone()): string {
  const w = wallTime(date, tz)
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
}

/** Instante de una hora de pared (`minutes` del día) del día que contiene `date` (o `addDays` días después). */
export function atMinutes(date: Date | number, minutes: number, tz: string, addDays = 0): number {
  const w = wallTime(date, tz)
  return makeInstant(w.year, w.month, w.day + addDays, Math.floor(minutes / 60), minutes % 60, 0, tz)
}

/** Minutos del día de un instante en la zona. */
export function minutesOfDay(date: Date | number, tz: string): number {
  const w = wallTime(date, tz)
  return w.hour * 60 + w.minute
}

// MARK: Horas de silencio

/** Nunca de madrugada, aunque las horas de silencio estén apagadas (1:00–6:00). */
export const NIGHT_QUIET: QuietHours = { enabled: true, from: '01:00', to: '06:00' }

/** ¿Está `date` dentro de las horas de silencio? */
export function quietContains(q: QuietHours, date: Date | number, tz: string = localTimeZone()): boolean {
  const from = timeMinutes(q.from)
  const to = timeMinutes(q.to)
  if (!q.enabled || from === to) return false
  const m = minutesOfDay(date, tz)
  return from < to ? m >= from && m < to : m >= from || m < to
}

/** El final de las horas de silencio que contienen `date` (o `date` si no está dentro). */
export function quietEnd(q: QuietHours, date: Date | number, tz: string = localTimeZone()): number {
  const ms = typeof date === 'number' ? date : date.getTime()
  if (!quietContains(q, ms, tz)) return ms
  const to = timeMinutes(q.to)
  const today = atMinutes(ms, to, tz)
  return today > ms ? today : atMinutes(ms, to, tz, 1)
}
