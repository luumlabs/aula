// Logros: hitos que se calculan con el progreso guardado (nada se apunta aparte salvo cuándo se vieron por primera vez).
// Puro: lo usa el proceso principal para avisar al conseguirlos y la interfaz para la estantería de Estadísticas.
import { examPercent, ownValue, type ItemID, type Pack, type StudyProgress } from '@shared/schema'
import type { AchievementId, AchievementView } from '@shared/ipc/achievements'
import { LearnBridge } from './bridge'
import { StudyStatsCalc } from './stats'

export interface AchievementCourse {
  pack: Pack
  progress: StudyProgress
}

/** Qué mide cada logro y cuánto hace falta. El orden es el de la estantería. */
export const ACHIEVEMENTS: ReadonlyArray<{ id: AchievementId; goal: number }> = [
  { id: 'firstAnswer', goal: 1 },
  { id: 'creator', goal: 1 },
  { id: 'streak3', goal: 3 },
  { id: 'streak7', goal: 7 },
  { id: 'streak30', goal: 30 },
  { id: 'hour1', goal: 60 },
  { id: 'hours10', goal: 600 },
  { id: 'correct100', goal: 100 },
  { id: 'correct1000', goal: 1000 },
  { id: 'cards100', goal: 100 },
  { id: 'cards1000', goal: 1000 },
  { id: 'firstMastered', goal: 1 },
  { id: 'mastered10', goal: 10 },
  { id: 'mistakes10', goal: 10 },
  { id: 'mockPassed', goal: 1 },
  { id: 'courseReady', goal: 1 }
]

/** Nota de corte de un simulacro cuando el curso no la dice. */
const DEFAULT_PASS = 0.5

/** Lo que lleva el estudiante en cada medida (sumando todos sus cursos). */
export function achievementMeasures(courses: readonly AchievementCourse[], now: Date, opts: { sampleIds?: readonly ItemID[] } = {}): Record<AchievementId, number> {
  const progresses = courses.map((c) => c.progress)
  const stats = StudyStatsCalc.summary(progresses, now, 1)
  const streak = Math.max(stats.streak.best, stats.streak.current)
  const correct = progresses.reduce((s, p) => s + p.days.reduce((a, d) => a + (Number.isFinite(d.correct) ? d.correct : 0), 0), 0)
  const answered = progresses.reduce((s, p) => s + Math.max(p.attempts.length, p.days.reduce((a, d) => a + d.attempts, 0)), 0)
  const reviews = progresses.reduce((s, p) => s + Object.values(p.cards).reduce((a, c) => a + c.reps + c.lapses, 0), 0)
  let mastered = 0
  let passed = 0
  let ready = 0
  for (const { pack, progress } of courses) {
    mastered += pack.skills.filter((s) => LearnBridge.level(ownValue(progress.skills, s.id), now) === 'mastered').length
    const pass = pack.blueprint?.passPercent ?? DEFAULT_PASS
    if (progress.exams.some((e) => e.kind !== 'diagnostic' && examPercent(e) >= pass)) passed++
    if (LearnBridge.readiness(pack, progress, now).labelKey === 'ready') ready++
  }
  const resolved = progresses.reduce((s, p) => s + p.mistakes.filter((m) => m.resolved).length, 0)
  const samples = new Set(opts.sampleIds ?? [])
  const own = courses.filter((c) => !samples.has(c.pack.id)).length
  return {
    firstAnswer: answered, creator: own,
    streak3: streak, streak7: streak, streak30: streak,
    hour1: stats.totalMinutes, hours10: stats.totalMinutes,
    correct100: Math.floor(correct), correct1000: Math.floor(correct),
    cards100: reviews, cards1000: reviews,
    firstMastered: mastered, mastered10: mastered,
    mistakes10: resolved, mockPassed: passed, courseReady: ready
  }
}

/** La estantería: cada logro con lo que lleva y, si ya se consiguió, cuándo se vio por primera vez. */
export function achievementViews(measures: Record<AchievementId, number>, earnedAt: Readonly<Record<string, string>>): AchievementView[] {
  return ACHIEVEMENTS.map(({ id, goal }) => {
    const value = Math.max(0, measures[id] ?? 0)
    const at = Object.prototype.hasOwnProperty.call(earnedAt, id) ? earnedAt[id] : undefined
    return { id, goal, value: Math.min(value, goal), earned: value >= goal || at !== undefined, ...(at ? { earnedAt: at } : {}) }
  })
}

/** Los logros conseguidos ahora que no estaban apuntados. */
export function newlyEarned(views: readonly AchievementView[], earnedAt: Readonly<Record<string, string>>): AchievementId[] {
  return views.filter((v) => v.value >= v.goal && !Object.prototype.hasOwnProperty.call(earnedAt, v.id)).map((v) => v.id)
}
