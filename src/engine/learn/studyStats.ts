// Estadísticas de estudio: rachas, tendencia de aciertos y formato de tiempos (portado de LearnKit/Stats).
import { clamp, roundHalfAway } from './support'
import { safeInt } from './studyPlanner'
import { daysFromCivil, daysInMonth, localTimeZone, pad, wallTime } from '@engine/calendar/time'

/** Resumen de un día de estudio. */
export interface DayStat {
  /** Día local `yyyy-MM-dd`. */
  day: string
  minutes: number
  attempts: number
  /** Crédito acumulado (correct / attempts = precisión). */
  correct: number
}

/** Clave `yyyy-MM-dd` de una fecha en la zona indicada. */
export function dayKey(date: Date, timeZone: string = localTimeZone()): string {
  const w = wallTime(date, timeZone)
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`
}

function isActive(d: DayStat): boolean {
  return (Number.isFinite(d.minutes) && d.minutes > 0) || d.attempts > 0
}

export const StudyStats = {
  /** Racha de días con actividad. `current` termina hoy (o ayer, si hoy aún no hay actividad); `best`, la más larga.
   *  Se comparan fechas de calendario; se ignoran las inválidas y las posteriores a hoy; los repetidos se fusionan. */
  streak(days: readonly DayStat[], today: Date, timeZone: string = localTimeZone()): { current: number; best: number } {
    const w = wallTime(today, timeZone)
    const todayNumber = StudyStats.dayNumber(w.year, w.month, w.day)
    if (todayNumber === null) return { current: 0, best: 0 }
    const active = new Set<number>()
    for (const stat of days) {
      if (!isActive(stat)) continue
      const n = StudyStats.dayNumberFrom(stat.day)
      if (n !== null && n <= todayNumber) active.add(n)
    }
    if (active.size === 0) return { current: 0, best: 0 }
    let best = 0, run = 0
    let previous: number | null = null
    for (const n of [...active].sort((a, b) => a - b)) {
      run = previous === n - 1 ? run + 1 : 1
      best = Math.max(best, run)
      previous = n
    }
    let current = 0
    let cursor = active.has(todayNumber) ? todayNumber : todayNumber - 1
    while (active.has(cursor)) {
      current += 1
      cursor -= 1
    }
    return { current, best }
  },

  /** Precisión móvil por día con intentos: Σ correct / Σ attempts de ese día y los `window − 1` anteriores. */
  accuracyTrend(days: readonly DayStat[], window: number): number[] {
    const merged = new Map<number, { attempts: number; correct: number }>()
    for (const stat of days) {
      if (!(stat.attempts > 0)) continue
      const n = StudyStats.dayNumberFrom(stat.day)
      if (n === null) continue
      const credit = Number.isFinite(stat.correct) ? stat.correct : 0
      const e = merged.get(n) ?? { attempts: 0, correct: 0 }
      e.attempts += stat.attempts
      e.correct += credit
      merged.set(n, e)
    }
    const ordered = [...merged.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
    const w = Math.max(1, Number.isFinite(window) ? Math.trunc(window) : 1)
    const out: number[] = []
    for (let i = 0; i < ordered.length; i++) {
      const slice = ordered.slice(Math.max(0, i - w + 1), i + 1)
      const attempts = slice.reduce((s, x) => s + x.attempts, 0)
      const correct = slice.reduce((s, x) => s + x.correct, 0)
      out.push(attempts > 0 ? clamp(correct / attempts, 0, 1) : 0)
    }
    return out
  },

  /** «0 min», «<1 min», «45 min», «1 h», «1 h 20 min» (igual en español e inglés). */
  formatMinutes(m: number): string {
    if (!Number.isFinite(m) || !(m > 0)) return '0 min'
    if (m < 0.5) return '<1 min'
    const total = safeInt(roundHalfAway(m))
    if (total < 60) return `${total} min`
    const h = Math.trunc(total / 60), r = total % 60
    return r === 0 ? `${h} h` : `${h} h ${r} min`
  },

  /** Días desde 1970-01-01 de una fecha civil; `null` si no existe (13.º mes, 30 de febrero…). */
  dayNumber(y: number, m: number, d: number): number | null {
    if (!(y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1)) return null
    if (d > daysInMonth(y, m)) return null
    return daysFromCivil(y, m, d)
  },

  /** Interpreta `yyyy-MM-dd` (año de 4 cifras; mes y día de 1 o 2). `null` si no tiene ese formato. */
  dayNumberFrom(text: string): number | null {
    const m = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/.exec(text)
    if (!m) return null
    return StudyStats.dayNumber(Number(m[1]), Number(m[2]), Number(m[3]))
  }
}
