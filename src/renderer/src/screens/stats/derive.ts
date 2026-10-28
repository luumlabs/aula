// Cuentas de la pantalla de estadísticas a partir de `StatsData` (puras, con pruebas al lado).
import { MASTERY_LEVELS, type MasteryLevelName, type StatsCourse, type StatsData, type StatsDay, type StatsLevelPoint, type StatsTopic } from '@shared/ipc/stats'

/** Los cursos elegidos («todos» si `id` es null o ya no existe). */
export function pickCourses(data: StatsData, id: string | null): StatsCourse[] {
  if (!id) return data.courses
  const one = data.courses.filter((c) => c.id === id)
  return one.length ? one : data.courses
}

/** Suma día a día de los cursos elegidos (todos tienen la misma ventana). */
export function sumDays(courses: StatsCourse[]): StatsDay[] {
  const first = courses[0]
  if (!first) return []
  return first.days.map((d, i) => ({
    date: d.date,
    minutes: courses.reduce((s, c) => s + clean(c.days[i]?.minutes), 0),
    attempts: courses.reduce((s, c) => s + Math.max(0, Math.round(clean(c.days[i]?.attempts))), 0),
    correct: courses.reduce((s, c) => s + clean(c.days[i]?.correct), 0)
  }))
}

export interface Totals {
  minutes: number
  activeDays: number
  attempts: number
  correct: number
  /** null sin intentos. */
  accuracy: number | null
}

export function totals(days: StatsDay[]): Totals {
  let minutes = 0, activeDays = 0, attempts = 0, correct = 0
  for (const d of days) {
    minutes += d.minutes
    attempts += d.attempts
    correct += d.correct
    if (isActive(d)) activeDays++
  }
  return { minutes, activeDays, attempts, correct, accuracy: attempts > 0 ? Math.min(1, correct / attempts) : null }
}

/** Un día cuenta si hubo estudio (minutos o ejercicios). */
export function isActive(d: StatsDay): boolean {
  return d.minutes > 0 || d.attempts > 0
}

/**
 * Racha como en LearnKit (StudyStats.streak): `current` son los días seguidos que terminan hoy o, si hoy aún no hay
 * actividad, ayer (la racha no se pierde hasta que acaba el día); `best` la más larga de la ventana.
 */
export function streak(days: StatsDay[], today: string): { current: number; best: number } {
  const t = dayNumber(today)
  if (t == null) return { current: 0, best: 0 }
  const active = new Set<number>()
  for (const d of days) {
    const n = dayNumber(d.date)
    if (n != null && n <= t && isActive(d)) active.add(n)
  }
  if (!active.size) return { current: 0, best: 0 }
  let best = 0, run = 0
  let prev: number | null = null
  for (const n of [...active].sort((a, b) => a - b)) {
    run = prev === n - 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = n
  }
  let current = 0
  let cursor = active.has(t) ? t : t - 1
  while (active.has(cursor)) {
    current++
    cursor--
  }
  return { current, best }
}

/** Número de día civil (sin horas: el horario de verano no influye). */
export function dayNumber(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3])
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null
}

/** Día de la semana con el lunes = 0. */
export function weekdayMonday(key: string): number {
  const n = dayNumber(key)
  // 1970-01-01 fue jueves (3 con el lunes = 0)
  return n == null ? 0 : (((n + 3) % 7) + 7) % 7
}

/** Nivel del mapa de calor por minutos (umbrales de la app original). */
export function heatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (!(minutes > 0)) return 0
  if (minutes < 10) return 1
  if (minutes < 25) return 2
  if (minutes < 50) return 3
  return 4
}

export interface HeatCell {
  week: number
  weekday: number
  day: StatsDay
}

/** Casillas del mapa: columnas = semanas (lunes arriba), la primera semana puede empezar a medias. */
export function heatGrid(days: StatsDay[]): { cells: HeatCell[]; weeks: number; weekStarts: string[] } {
  if (!days.length) return { cells: [], weeks: 0, weekStarts: [] }
  const offset = weekdayMonday(days[0].date)
  const cells = days.map((day, i) => ({ week: Math.floor((i + offset) / 7), weekday: (i + offset) % 7, day }))
  const weeks = cells[cells.length - 1].week + 1
  const weekStarts: string[] = []
  for (let w = 0; w < weeks; w++) {
    const first = cells.find((c) => c.week === w)
    weekStarts.push(first ? shiftKey(first.day.date, -first.weekday) : '')
  }
  return { cells, weeks, weekStarts }
}

/** Promedio por día con estudio, el mejor día de la semana y la semana más larga. */
export function rhythm(days: StatsDay[]): { avgActive: number | null; bestWeekday: number | null; bestWeek: { start: string; minutes: number } | null; byWeekday: number[] } {
  const active = days.filter((d) => d.minutes > 0)
  const avgActive = active.length ? active.reduce((s, d) => s + d.minutes, 0) / active.length : null
  const byWeekday = new Array<number>(7).fill(0)
  for (const d of days) byWeekday[weekdayMonday(d.date)] += d.minutes
  const max = Math.max(...byWeekday)
  const bestWeekday = max > 0 ? byWeekday.indexOf(max) : null
  const { cells, weekStarts } = heatGrid(days)
  const byWeek = new Map<number, number>()
  for (const c of cells) byWeek.set(c.week, (byWeek.get(c.week) ?? 0) + c.day.minutes)
  let bestWeek: { start: string; minutes: number } | null = null
  for (const [w, m] of byWeek) if (m > 0 && (!bestWeek || m > bestWeek.minutes)) bestWeek = { start: weekStarts[w], minutes: m }
  return { avgActive, bestWeekday, bestWeek, byWeekday }
}

/** Temas con más ejercicios primero (y por título si empatan). */
export function sortedTopics(courses: StatsCourse[]): StatsTopic[] {
  return courses.flatMap((c) => c.topics).sort((a, b) => (a.attempts !== b.attempts ? b.attempts - a.attempts : a.title.localeCompare(b.title)))
}

/**
 * Niveles por semana sumando los cursos. Las semanas de antes de empezar (todo «Sin ver») no dicen nada: la serie empieza
 * una semana antes del primer avance (como en la app original).
 */
export function sumLevels(courses: StatsCourse[]): StatsLevelPoint[] {
  const byDate = new Map<string, Record<MasteryLevelName, number>>()
  for (const c of courses)
    for (const p of c.levels) {
      const acc = byDate.get(p.date) ?? emptyCounts()
      for (const l of MASTERY_LEVELS) acc[l] += clean(p.counts[l])
      byDate.set(p.date, acc)
    }
  const points = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, counts }))
  const firstProgress = points.findIndex((p) => MASTERY_LEVELS.some((l) => l !== 'unseen' && p.counts[l] > 0))
  if (firstProgress < 0) return []
  return points.slice(Math.max(0, firstProgress - 1))
}

export function emptyCounts(): Record<MasteryLevelName, number> {
  return { unseen: 0, learning: 0, practicing: 0, solid: 0, mastered: 0 }
}

/** ¿Hay algo que medir con estos cursos? */
export function nothingToMeasure(courses: StatsCourse[]): boolean {
  return courses.every((c) => c.days.every((d) => !isActive(d)) && c.topics.length === 0 && c.expected == null)
}

/** «AAAA-MM-DD» desplazado `n` días. */
export function shiftKey(key: string, n: number): string {
  const d = dayNumber(key)
  if (d == null) return key
  return new Date((d + n) * 86400000).toISOString().slice(0, 10)
}

/** Fecha local a partir de «AAAA-MM-DD» (mediodía, para formatear sin saltos de zona). */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}

function clean(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}
