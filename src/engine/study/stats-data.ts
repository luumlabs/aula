// Datos de la pantalla de Estadísticas (`stats.get`), port de StatsData.compute (StudyUI/App/StatsView.swift): 12 semanas
// que terminan hoy (fechas LOCALES), minutos e intentos por día, precisión por tema, niveles de dominio al final de cada semana
// y la nota estimada día a día, reconstruidos repasando los intentos guardados. El último punto es el progreso real de hoy.
import { attempt as learnAttempt, type AttemptMode, type MasteryLevel } from '@engine/learn'
import { addDays, localTimeZone, startOfDay } from '@engine/calendar/time'
import { ownValue, setOwn, emptyProgress, makeSkillProgress, type Attempt, type ItemID, type Pack, type SkillProgress, type StudyProgress } from '@shared/schema'
import { MASTERY_LEVELS, STATS_WINDOW_DAYS, type MasteryLevelName, type StatsCourse, type StatsData, type StatsDay, type StatsLevelPoint, type StatsScorePoint, type StatsTopic } from '@shared/ipc/stats'
import type { SkillsInput, StudyLang } from './types'
import { LearnBridge } from './bridge'
import { readinessLabel } from './overview'
import { dayKey } from './util'

/** Un curso para las estadísticas. */
export interface StatsCourseInput {
  pack: Pack
  skills?: SkillsInput
  progress: StudyProgress
  /** Aún se está creando: no tiene estadísticas ni nota (no sale). */
  generating?: boolean
}

/** Nombre del nivel para la interfaz (los de LearnKit coinciden). */
export const masteryLevelName = (l: MasteryLevel): MasteryLevelName => l

function emptyCounts(): Record<MasteryLevelName, number> {
  const out = {} as Record<MasteryLevelName, number>
  for (const l of MASTERY_LEVELS) out[l] = 0
  return out
}

const finitePos = (x: number): number => (Number.isFinite(x) ? Math.max(0, x) : 0)

function courseStats(input: StatsCourseInput, dayDates: readonly Date[], start: Date, now: Date, tz: string, lang?: StudyLang): StatsCourse {
  const { pack, progress } = input
  // minutos por día (días repetidos se suman)
  const byDay = new Map<string, StatsDay>()
  for (const d of progress.days) {
    const e = byDay.get(d.day) ?? { date: d.day, minutes: 0, attempts: 0, correct: 0 }
    e.minutes += finitePos(d.minutes); e.attempts += Math.max(0, d.attempts); e.correct += finitePos(d.correct)
    byDay.set(d.day, e)
  }
  const keys = dayDates.map((d) => dayKey(d, tz))
  const days: StatsDay[] = keys.map((k) => ({ date: k, minutes: byDay.get(k)?.minutes ?? 0, attempts: byDay.get(k)?.attempts ?? 0, correct: byDay.get(k)?.correct ?? 0 }))
  // precisión por tema (intentos de las últimas 12 semanas)
  const startMs = start.getTime()
  const perSkill = new Map<ItemID, { n: number; credit: number }>()
  const sorted: Array<{ a: Attempt; t: number }> = []
  for (const a of progress.attempts) {
    const t = Date.parse(a.date)
    if (Number.isNaN(t)) continue
    sorted.push({ a, t })
    if (t < startMs) continue
    const e = perSkill.get(a.skill) ?? { n: 0, credit: 0 }
    e.n += 1; e.credit += Number.isFinite(a.credit) ? a.credit : 0
    perSkill.set(a.skill, e)
  }
  const topics: StatsTopic[] = []
  for (const [id, e] of perSkill) {
    const ref = pack.skills.find((s) => s.id === id)
    if (!ref || e.n <= 0) continue
    topics.push({ id: `${pack.id}/${id}`, courseId: pack.id, skillId: id, title: ref.title, courseTitle: pack.title, hue: pack.hue, attempts: e.n, accuracy: Math.min(1, Math.max(0, e.credit / e.n)) })
  }
  topics.sort((x, y) => (x.attempts !== y.attempts ? y.attempts - x.attempts : x.title.localeCompare(y.title)))
  // reconstrucción del dominio día a día repasando los intentos
  sorted.sort((x, y) => x.t - y.t)
  const states: Record<ItemID, SkillProgress> = {}
  const apply = (a: Attempt, at: number): void => {
    const sp = ownValue(states, a.skill) ?? makeSkillProgress()
    const outcome = learnAttempt(Number.isFinite(a.credit) ? Math.min(Math.max(a.credit, 0), 1) : 0, {
      difficulty: Math.min(3, Math.max(1, a.level)), hintsUsed: Math.max(0, a.hints), seconds: a.seconds ?? null, expectedSeconds: null, mode: a.mode as AttemptMode
    })
    setOwn(states, a.skill, LearnBridge.apply(LearnBridge.masteryModel.updated(LearnBridge.mastery(sp), outcome, new Date(at)), sp))
  }
  const history: StatsScorePoint[] = []
  const levels: StatsLevelPoint[] = []
  let idx = 0, anyAttempt = false
  dayDates.forEach((d, i) => {
    const isToday = i === dayDates.length - 1
    const end = addDays(d, 1, tz)
    while (idx < sorted.length && sorted[idx].t < end.getTime()) { apply(sorted[idx].a, sorted[idx].t); idx += 1; anyAttempt = true }
    // el último punto es el estado real (incluye lo aprendido con tarjetas, que no deja intentos)
    const snapshot = isToday ? progress.skills : states
    const at = isToday ? now : end
    const seen = pack.skills.some((s) => (ownValue(snapshot, s.id)?.attempts ?? 0) > 0)
    if (seen && (anyAttempt || isToday)) {
      const r = LearnBridge.readiness(pack, { ...emptyProgress(), skills: snapshot }, at, lang)
      history.push({ date: keys[i], expected: r.expectedScore, low: r.low, high: r.high })
    }
    if (i % 7 === 6 || isToday) {
      const counts = emptyCounts()
      for (const ref of pack.skills) counts[masteryLevelName(LearnBridge.level(ownValue(snapshot, ref.id), at))] += 1
      levels.push({ date: keys[i], counts })
    }
  })
  const seenNow = pack.skills.some((s) => (ownValue(progress.skills, s.id)?.attempts ?? 0) > 0)
  const r = LearnBridge.readiness(pack, progress, now, lang)
  const out: StatsCourse = {
    id: pack.id, title: pack.title, icon: pack.icon, hue: pack.hue, expected: seenNow ? r.expectedScore : null, low: r.low, high: r.high,
    coverage: r.coverage, label: readinessLabel(r.labelKey), days, topics, levels, history, skillCount: pack.skills.length
  }
  if (pack.exam?.date) out.examDate = pack.exam.date
  return out
}

/** Estadísticas de los cursos (los que se están creando no salen). */
export function buildStatsData(courses: readonly StatsCourseInput[], now: Date, lang?: StudyLang, tz: string = localTimeZone()): StatsData {
  const today = startOfDay(now, tz)
  const start = addDays(today, -(STATS_WINDOW_DAYS - 1), tz)
  const dayDates = Array.from({ length: STATS_WINDOW_DAYS }, (_, i) => addDays(start, i, tz))
  return {
    start: dayKey(start, tz),
    today: dayKey(today, tz),
    courses: courses.filter((c) => !c.generating).map((c) => courseStats(c, dayDates, start, now, tz, lang))
  }
}
