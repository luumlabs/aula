// Estadísticas de estudio de uno o varios cursos: minutos por día, racha, semana y precisión (sobre StudyStats de LearnKit).
import { StudyStats, type DayStat } from '@engine/learn'
import { addDays, localTimeZone, startOfDay, wallTime } from '@engine/calendar/time'
import type { StudyProgress } from '@shared/schema'
import type { StudyStatsSummary } from './types'
import { dayKey } from './util'

export const StudyStatsCalc = {
  /** Los días de varios cursos sumados (minutos, intentos, aciertos), en orden. */
  mergedDays(progresses: readonly StudyProgress[]): DayStat[] {
    const merged = new Map<string, DayStat>()
    for (const p of progresses) {
      for (const d of p.days) {
        const m = merged.get(d.day) ?? { day: d.day, minutes: 0, attempts: 0, correct: 0 }
        m.minutes += Number.isFinite(d.minutes) ? d.minutes : 0
        m.attempts += d.attempts
        m.correct += Number.isFinite(d.correct) ? d.correct : 0
        merged.set(d.day, m)
      }
    }
    return [...merged.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  },

  /** Días con actividad: los registrados y, además, los de las fechas de los intentos y de los repasos de tarjetas. */
  activeDays(progresses: readonly StudyProgress[], tz: string): DayStat[] {
    const days = StudyStatsCalc.mergedDays(progresses)
    const known = new Set(days.filter((d) => d.minutes > 0 || d.attempts > 0).map((d) => d.day))
    const extra = new Set<string>()
    for (const p of progresses) {
      for (const a of p.attempts) { const t = Date.parse(a.date); if (!Number.isNaN(t)) extra.add(dayKey(new Date(t), tz)) }
      for (const c of Object.values(p.cards)) if (c.lastReview) { const t = Date.parse(c.lastReview); if (!Number.isNaN(t)) extra.add(dayKey(new Date(t), tz)) }
    }
    const out = [...days]
    for (const d of extra) if (!known.has(d)) out.push({ day: d, minutes: 0, attempts: 1, correct: 0 })
    return out
  },

  summary(progresses: readonly StudyProgress[], now: Date, nDays = 14, tz: string = localTimeZone()): StudyStatsSummary {
    const days = StudyStatsCalc.mergedDays(progresses)
    const active = StudyStatsCalc.activeDays(progresses, tz)
    const activeSet = new Set(active.filter((d) => d.minutes > 0 || d.attempts > 0).map((d) => d.day))
    const today = dayKey(now, tz)
    const t = days.find((d) => d.day === today)
    const streak = StudyStats.streak(active, now, tz)
    // lunes…domingo de esta semana
    const w = wallTime(now, tz)
    const weekday = (new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7
    const monday = addDays(startOfDay(now, tz), -weekday, tz)
    const week = Array.from({ length: 7 }, (_, i) => activeSet.has(dayKey(addDays(monday, i, tz), tz)))
    const n = Math.max(1, Math.min(366, Math.trunc(nDays)))
    const start = startOfDay(now, tz)
    const minutesByDay = Array.from({ length: n }, (_, i) => {
      const key = dayKey(addDays(start, i - (n - 1), tz), tz)
      return { day: key, minutes: days.find((d) => d.day === key)?.minutes ?? 0 }
    })
    const totalAttempts = days.reduce((s, d) => s + d.attempts, 0)
    const totalCorrect = days.reduce((s, d) => s + d.correct, 0)
    return {
      minutesToday: t?.minutes ?? 0,
      attemptsToday: t?.attempts ?? 0,
      accuracyToday: t && t.attempts > 0 ? Math.min(1, Math.max(0, t.correct / t.attempts)) : 0,
      streak,
      week,
      minutesByDay,
      totalMinutes: days.reduce((s, d) => s + d.minutes, 0),
      totalAttempts,
      accuracy: totalAttempts > 0 ? Math.min(1, Math.max(0, totalCorrect / totalAttempts)) : 0
    }
  }
}
