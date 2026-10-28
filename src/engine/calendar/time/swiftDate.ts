// Fechas en los JSON de la app Swift: ISO 8601 con fracción («2026-01-05T09:00:00.000Z»), también sin fracción o con desfase.
// Los `Codable` por defecto de Swift (sin estrategia) escriben segundos desde el 1-ene-2001; se aceptan al leer.
import { civilSeconds, daysInMonth } from './civil'

/** 2001-01-01T00:00:00Z en ms (fecha de referencia de Foundation). */
export const REFERENCE_DATE_MS = 978_307_200_000
/** `Date.distantPast` / `Date.distantFuture` de Foundation. */
export const DISTANT_PAST = new Date(-62_135_596_800_000)
export const DISTANT_FUTURE = new Date(64_092_211_200_000)

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:([Zz])|([+-])(\d{2}):?(\d{2}))$/

/** Lee una fecha ISO 8601 estricta («…Z», «…+02:00», con o sin fracción). `null` si no lo es. */
export function parseISODate(text: string): Date | null {
  const m = ISO_RE.exec(text.trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 60) return null
  const frac = m[7] ? Number('0.' + m[7]) : 0
  let offset = 0
  if (m[9]) offset = (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 3600 + Number(m[11]) * 60)
  const secs = civilSeconds(y, mo, d, h, mi, Math.min(s, 59)) - offset
  return new Date(Math.round((secs + frac) * 1000))
}

/** Fecha de un JSON de la app Swift: texto ISO o número (segundos desde 2001). `null` si no se entiende. */
export function decodeSwiftDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') return parseISODate(value)
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(REFERENCE_DATE_MS + value * 1000)
  return null
}

/** Como la escribe la app Swift (`JSONCoders`): ISO 8601 en UTC con milisegundos. */
export function encodeSwiftDate(date: Date): string {
  return date.toISOString()
}

/** ¿Es un `Date` válido? */
export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime())
}
