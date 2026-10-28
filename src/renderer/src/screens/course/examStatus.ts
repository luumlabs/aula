// Dónde está el examen respecto a hoy: por venir (cuenta atrás), hoy (aún no ha empezado) o ya pasado (también si fue hoy y ya
// acabó la hora). Puro y sin idioma: la tarjeta del examen elige las palabras.

export type ExamStatus =
  | { phase: 'upcoming'; days: number }
  | { phase: 'today' }
  | { phase: 'past'; daysAgo: number }

const DAY = 86_400_000

function dayStart(d: Date): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

/** Días naturales (horario local) de `from` a `to`; redondea para no tropezar con los cambios de hora. */
export function calendarDays(from: Date, to: Date): number {
  return Math.round((dayStart(to) - dayStart(from)) / DAY)
}

/** `null` si no hay fecha o no se entiende. */
export function examStatus(date: string | Date | undefined | null, now: Date = new Date()): ExamStatus | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return null
  const days = calendarDays(now, d)
  if (days > 0) return { phase: 'upcoming', days }
  if (days === 0 && d.getTime() >= now.getTime()) return { phase: 'today' }
  return { phase: 'past', daysAgo: Math.max(0, -days) }
}
