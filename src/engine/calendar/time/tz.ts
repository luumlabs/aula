// Zonas horarias IANA sin dependencias: el desfase de cada instante sale de `Intl` (Node y Chromium traen ICU completo).
// Sustituye a `Calendar`/`TimeZone` de Swift: hora de pared, inicio del día, sumar días o meses conservando la hora del reloj,
// cambios de hora… Las horas que no existen (salto de primavera) usan el desfase de antes del salto y las que existen dos
// veces (otoño) son la primera, como Foundation y el RFC 5545.
import { civilFromDays, civilSeconds, daysInMonth, MS_PER_DAY, normalizeMonth, SECONDS_PER_DAY, weekdayOfEpochDay } from './civil'

export const UTC = 'UTC'

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()
const validity = new Map<string, boolean>()
/** Caché de desfases por cuarto de hora (los cambios de hora caen siempre en cuartos de hora en UTC). */
const offsetCache = new Map<string, Map<number, number>>()
const QUARTER_MS = 15 * 60_000

/** Zona del sistema («Europe/Madrid»); `UTC` si no se puede saber. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC
  } catch {
    return UTC
  }
}

function isUTC(tz: string): boolean {
  return tz === 'UTC' || tz === 'Etc/UTC' || tz === 'GMT' || tz === 'Etc/GMT' || tz === 'Z'
}

const FIXED_RE = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/

/** Zona de desfase fijo («+05:30»), como `TimeZone(secondsFromGMT:)`. */
export function fixedOffsetZone(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const a = Math.abs(Math.trunc(seconds))
  const hh = String(Math.floor(a / 3600)).padStart(2, '0'), mm = String(Math.floor((a % 3600) / 60)).padStart(2, '0'), ss = a % 60
  return `${sign}${hh}:${mm}` + (ss ? `:${String(ss).padStart(2, '0')}` : '')
}

/** Desfase de una zona fija («+05:30» → 19 800); `null` si no lo es. */
export function fixedOffsetSeconds(tz: string): number | null {
  const m = FIXED_RE.exec(tz)
  if (!m) return null
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0))
}

/** ¿Es un identificador de zona que entiende el sistema? (IANA: «America/New_York», «UTC»…) */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false
  if (fixedOffsetSeconds(tz) !== null) return true
  const hit = validity.get(tz)
  if (hit !== undefined) return hit
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    // los desfases sueltos («+05:00») no son zonas con nombre
    ok = /^[A-Za-z]/.test(tz)
  } catch {
    ok = false
  }
  if (validity.size > 512) validity.clear()
  validity.set(tz, ok)
  return ok
}

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    offsetFormatters.set(tz, f)
  }
  return f
}

const OFFSET_RE = /GMT(?:([+-−])(\d{1,2}):?(\d{2})(?::?(\d{2}))?)?\s*$/

function computeOffset(ms: number, tz: string): number {
  const text = offsetFormatter(tz).format(new Date(ms))
  const m = OFFSET_RE.exec(text)
  if (!m || !m[1]) return 0
  const sign = m[1] === '+' ? 1 : -1
  return sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0))
}

/** Segundos de diferencia con UTC en ese instante (positivo al este). Una zona desconocida cuenta como UTC. */
export function offsetSeconds(ms: number, tz: string): number {
  if (isUTC(tz) || !Number.isFinite(ms)) return 0
  const fixed = fixedOffsetSeconds(tz)
  if (fixed !== null) return fixed
  if (!isValidTimeZone(tz)) return 0
  const bucket = Math.floor(ms / QUARTER_MS)
  let cache = offsetCache.get(tz)
  if (!cache) {
    cache = new Map()
    offsetCache.set(tz, cache)
  }
  const hit = cache.get(bucket)
  if (hit !== undefined) return hit
  const off = computeOffset(bucket * QUARTER_MS, tz)
  if (cache.size > 200_000) cache.clear()
  cache.set(bucket, off)
  return off
}

/** Hora de pared de un instante en una zona. `weekday`: 1 = domingo … 7 = sábado (como `Calendar`). */
export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
  weekday: number
  /** Días civiles desde 1970-01-01 de esa fecha local. */
  epochDay: number
}

export function wallTime(date: Date | number, tz: string): WallTime {
  const ms = typeof date === 'number' ? date : date.getTime()
  const local = ms + offsetSeconds(ms, tz) * 1000
  const epochDay = Math.floor(local / MS_PER_DAY)
  const rest = local - epochDay * MS_PER_DAY
  const c = civilFromDays(epochDay)
  const secs = Math.floor(rest / 1000)
  return {
    year: c.year,
    month: c.month,
    day: c.day,
    hour: Math.floor(secs / 3600),
    minute: Math.floor((secs % 3600) / 60),
    second: secs % 60,
    millisecond: rest - secs * 1000,
    weekday: weekdayOfEpochDay(epochDay),
    epochDay
  }
}

/** Instante (ms) de una hora de pared en una zona (admite días, horas… fuera de rango: se normalizan). Si esa hora no
 *  existe (salto de primavera), con el desfase de antes del salto; si existe dos veces (otoño), la primera. */
export function makeInstant(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, tz: string = UTC): number {
  const naive = civilSeconds(year, month, day, hour, minute, second)
  const naiveMs = naive * 1000
  const before = offsetSeconds(naiveMs - MS_PER_DAY, tz)
  const after = offsetSeconds(naiveMs + MS_PER_DAY, tz)
  const current = offsetSeconds(naiveMs, tz)
  let best: number | null = null
  for (const off of new Set([before, after, current])) {
    const t = naive - off
    if (t + offsetSeconds(t * 1000, tz) === naive && (best === null || t < best)) best = t
  }
  return (best ?? naive - before) * 1000
}

/** Igual que `makeInstant` pero devuelve un `Date`. */
export function makeDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, tz: string = UTC): Date {
  return new Date(makeInstant(year, month, day, hour, minute, second, tz))
}

/** Inicio del día local (la medianoche, o el primer instante del día si la medianoche no existe). */
export function startOfDay(date: Date | number, tz: string): Date {
  const w = wallTime(date, tz)
  return new Date(makeInstant(w.year, w.month, w.day, 0, 0, 0, tz))
}

/** Suma días de calendario conservando la hora de pared (como `Calendar.date(byAdding: .day)`). */
export function addDays(date: Date | number, n: number, tz: string): Date {
  const w = wallTime(date, tz)
  return new Date(makeInstant(w.year, w.month, w.day + n, w.hour, w.minute, w.second, tz) + w.millisecond)
}

/** Suma meses (el día se recorta al último del mes: 31-ene + 1 mes = 28/29-feb). */
export function addMonths(date: Date | number, n: number, tz: string): Date {
  const w = wallTime(date, tz)
  const t = normalizeMonth(w.year, w.month + n)
  const d = Math.min(w.day, daysInMonth(t.year, t.month))
  return new Date(makeInstant(t.year, t.month, d, w.hour, w.minute, w.second, tz) + w.millisecond)
}

export function addYears(date: Date | number, n: number, tz: string): Date {
  return addMonths(date, 12 * n, tz)
}

/** Días completos de calendario entre dos instantes (como `dateComponents([.day], from:to:)`). */
export function daysBetween(from: Date | number, to: Date | number, tz: string): number {
  const a = wallTime(from, tz), b = wallTime(to, tz)
  let diff = b.epochDay - a.epochDay
  const ta = ((a.hour * 60 + a.minute) * 60 + a.second) * 1000 + a.millisecond
  const tb = ((b.hour * 60 + b.minute) * 60 + b.second) * 1000 + b.millisecond
  if (diff > 0 && tb < ta) diff -= 1
  else if (diff < 0 && tb > ta) diff += 1
  return diff
}

export function isSameDay(a: Date | number, b: Date | number, tz: string): boolean {
  return wallTime(a, tz).epochDay === wallTime(b, tz).epochDay
}

/** El día entero que contiene el instante: [inicio, inicio del día siguiente). */
export function dayInterval(date: Date | number, tz: string): { start: Date; end: Date } {
  const w = wallTime(date, tz)
  return { start: new Date(makeInstant(w.year, w.month, w.day, 0, 0, 0, tz)), end: new Date(makeInstant(w.year, w.month, w.day + 1, 0, 0, 0, tz)) }
}

/** Último segundo del día local (el día del cambio de hora no tiene 24 horas). */
export function endOfDay(date: Date | number, tz: string): Date {
  return new Date(dayInterval(date, tz).end.getTime() - 1000)
}

/** Fija la hora de pared de un día (como `Calendar.date(bySettingHour:minute:second:of:)`). */
export function settingTime(date: Date | number, hour: number, minute: number, second: number, tz: string): Date {
  const w = wallTime(date, tz)
  return new Date(makeInstant(w.year, w.month, w.day, hour, minute, second, tz))
}

/** Cambios de hora de una zona entre dos instantes (el primer instante con el desfase nuevo). Como mucho `limit`. */
export function offsetTransitions(tz: string, from: Date | number, to: Date | number, limit = 100): Date[] {
  const out: Date[] = []
  if (isUTC(tz) || fixedOffsetSeconds(tz) !== null || !isValidTimeZone(tz)) return out
  let t = typeof from === 'number' ? from : from.getTime()
  const end = typeof to === 'number' ? to : to.getTime()
  let off = computeOffset(t, tz)
  while (t < end && out.length < limit) {
    const next = Math.min(t + MS_PER_DAY, end)
    const nextOff = computeOffset(next, tz)
    if (nextOff !== off) {
      // búsqueda binaria al segundo
      let lo = t, hi = next
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2000) * 1000
        if (mid <= lo || mid >= hi) break
        if (computeOffset(mid, tz) === off) lo = mid
        else hi = mid
      }
      out.push(new Date(hi))
      off = nextOff
    }
    t = next
  }
  return out
}

/** ¿Está en horario de verano? (su desfase es mayor que el menor del año). */
export function isDaylightSaving(date: Date | number, tz: string): boolean {
  const ms = typeof date === 'number' ? date : date.getTime()
  const y = wallTime(ms, UTC).year
  const jan = offsetSeconds(civilSeconds(y, 1, 1) * 1000, tz)
  const jul = offsetSeconds(civilSeconds(y, 7, 1) * 1000, tz)
  return offsetSeconds(ms, tz) > Math.min(jan, jul)
}

const abbrevFormatters = new Map<string, Intl.DateTimeFormat>()
/** Abreviatura de la zona («EDT», «GMT+1»). */
export function zoneAbbreviation(date: Date | number, tz: string): string {
  if (fixedOffsetSeconds(tz) !== null) return 'GMT' + tz
  try {
    let f = abbrevFormatters.get(tz)
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      abbrevFormatters.set(tz, f)
    }
    return f.formatToParts(new Date(date)).find((p) => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    return tz
  }
}

/** Segundos de «hora de pared» (como si la zona fuera UTC). */
export function wallSeconds(date: Date | number, tz: string): number {
  const ms = typeof date === 'number' ? date : date.getTime()
  return ms / 1000 + offsetSeconds(ms, tz)
}

/** Inversa de `wallSeconds` (con las reglas de `makeInstant` para las horas que no existen o se repiten). */
export function fromWallSeconds(wall: number, tz: string): Date {
  const whole = Math.floor(wall)
  const days = Math.floor(whole / SECONDS_PER_DAY)
  const rest = whole - days * SECONDS_PER_DAY
  const c = civilFromDays(days)
  return new Date(makeInstant(c.year, c.month, c.day, Math.floor(rest / 3600), Math.floor((rest % 3600) / 60), rest % 60, tz) + (wall - whole) * 1000)
}
