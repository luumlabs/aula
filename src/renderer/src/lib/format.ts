// Formato de fechas y números según el idioma de la interfaz.
import i18n from '@renderer/i18n'
import { addDays, civilDaysBetween } from './civil'

export { addDays, daysFrom, startOfDay } from './civil'

const loc = () => (i18n.language === 'es' ? 'es-ES' : 'en-US')

/** Días naturales entre hoy y `date` (0 = hoy, 1 = mañana, negativo = pasado). */
export function daysUntil(date: string | Date, now = new Date()): number {
  const d = typeof date === 'string' ? new Date(date) : date
  return civilDaysBetween(now, d)
}

export function fmtDate(date: string | Date, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(loc(), opts).format(d)
}

export function fmtTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit' }).format(d)
}

/** «75 %» en español, «75%» en inglés. `v` es una fracción (0.75). */
export function fmtPercent(v: number, digits = 0): string {
  return new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: digits }).format(v)
}

/** Un texto citado con las comillas del idioma: «así» en español, “so” en inglés. */
export function quoted(text: string): string {
  return i18n.language === 'es' ? `«${text}»` : `“${text}”`
}

/** Signo de porcentaje para poner tras una cifra ya formateada: « %» (espacio sin salto) en español, «%» en inglés. */
export function percentSuffix(): string {
  return i18n.language === 'es' ? ' %' : '%'
}

export function weekdayLetters(): string[] {
  // Lunes primero
  const base = new Date(2024, 0, 1) // lunes
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(loc(), { weekday: 'narrow' }).format(addDays(base, i)))
}

/** «Hoy», «Mañana», «en 3 días», «hace 2 días». (El segundo argumento se mantiene por compatibilidad.) */
export function relativeDay(date: string | Date, _t?: unknown): string {
  const n = daysUntil(date)
  if (n === 0) return i18n.t('common:time.today')
  if (n === 1) return i18n.t('common:time.tomorrow')
  if (n > 1) return i18n.t('common:time.inDays', { count: n })
  return i18n.t('common:time.daysAgo', { count: -n })
}

export function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase(loc()) + s.slice(1)
}

/** «45 min», «2 h», «12 h 18 min». */
export function fmtMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export function fmtNumber(v: number, digits = 0): string {
  return new Intl.NumberFormat(loc(), { maximumFractionDigits: digits }).format(v)
}
