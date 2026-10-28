// Vista de un curso (`course.overview`): nota estimada con su intervalo, plan de hoy, dominio por habilidad y pendientes.
import type { CourseOverview, ReadinessLabel, SkillProgressView } from '@shared/ipc/course-view'
import type { HomePlanItem, PlanKind as HomePlanKind } from '@shared/ipc/home'
import type { PlanItem, ReadinessLabelKey } from '@engine/learn'
import { ownValue, orderedSkills, type Pack, type StudyProgress } from '@shared/schema'
import type { SkillsInput, StudyLang } from './types'
import { LearnBridge } from './bridge'
import { CardReview } from './cards'
import { Recorder } from './recorder'
import { dayKey, skillMap } from './util'

/** Etiqueta de la interfaz a partir de la de LearnKit. */
export function readinessLabel(key: ReadinessLabelKey): ReadinessLabel {
  switch (key) {
    case 'noData': return 'notStarted'
    case 'gettingStarted': case 'farFromReady': return 'early'
    case 'onTrack': case 'doingWell': return 'gettingThere'
    case 'almostReady': return 'almostReady'
    case 'ready': return 'ready'
  }
}

/** Tipo del bloque del plan para la interfaz. */
export function homePlanKind(item: PlanItem): HomePlanKind {
  switch (item.kind) {
    case 'review': return item.id === 'formulas' ? 'review' : 'cards'
    case 'mistakes': return 'mistakes'
    case 'learn': return 'learn'
    case 'practice': case 'diagnostic': return 'practice'
    case 'mock': return 'exam'
    case 'rest': return 'review'
  }
}

/** Un bloque del plan de LearnKit como lo pinta la interfaz (id único entre cursos: «<curso>:<id>»). */
export function toHomePlanItem(pack: Pack, item: PlanItem): HomePlanItem {
  const out: HomePlanItem = {
    id: `${pack.id}:${item.id}`, courseId: pack.id, courseTitle: pack.title, icon: pack.icon, hue: pack.hue, kind: homePlanKind(item),
    title: item.title, detail: item.reason, minutes: Math.max(0, item.minutes)
  }
  if (item.skillID) out.skillId = item.skillID
  return out
}

/** Minutos de hoy de un curso. */
export function minutesOn(progress: StudyProgress, now: Date): number {
  const key = dayKey(now)
  return progress.days.find((d) => d.day === key)?.minutes ?? 0
}

/** ¿Hay algún intento en el curso? */
export const hasAttempts = (pack: Pack, progress: StudyProgress): boolean => pack.skills.some((s) => (ownValue(progress.skills, s.id)?.attempts ?? 0) > 0)

export function buildCourseOverview(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, now: Date, lang?: StudyLang, minutesGoal?: number): CourseOverview {
  const skills = skillMap(skillsInput)
  const r = LearnBridge.readiness(pack, progress, now, lang)
  const seen = hasAttempts(pack, progress)
  const goal = Math.max(5, Math.trunc(minutesGoal ?? progress.settings.dailyMinutes ?? 45) || 45)
  const plan = LearnBridge.dailyPlan(pack, skills, progress, goal, now, lang).filter((i) => i.kind !== 'rest').map((i) => toHomePlanItem(pack, i))
  const dueMistakes = Recorder.dueMistakes(progress, now, skills)
  const views: SkillProgressView[] = orderedSkills(pack).map((ref) => {
    const sp = ownValue(progress.skills, ref.id)
    return {
      id: ref.id,
      mastery: Recorder.mastery(sp, now) ?? 0,
      seen: (sp?.attempts ?? 0) > 0 || sp?.lessonDone === true,
      dueCards: ownValue(skills, ref.id) ? CardReview.queue(pack, skills, progress, { now, includeNew: false, limit: Number.MAX_SAFE_INTEGER, skillId: ref.id }).length : 0,
      mistakes: dueMistakes.filter((m) => m.skill === ref.id).length
    }
  })
  const attempts = Math.max(progress.days.reduce((s, d) => s + d.attempts, 0), progress.attempts.length)
  const correctDays = progress.days.reduce((s, d) => s + (Number.isFinite(d.correct) ? d.correct : 0), 0)
  const dayAttempts = progress.days.reduce((s, d) => s + d.attempts, 0)
  return {
    id: pack.id,
    readiness: seen ? r.expectedScore : 0,
    readinessLow: seen ? r.low : 0,
    readinessHigh: seen ? r.high : 0,
    coverage: r.coverage,
    label: readinessLabel(r.labelKey),
    plan,
    minutesToday: Math.round(minutesOn(progress, now)),
    minutesGoal: goal,
    dueCards: LearnBridge.dueCardCount(pack, skills, progress, now),
    mistakes: dueMistakes.length,
    skills: views,
    attempts,
    accuracy: dayAttempts > 0 ? Math.min(1, Math.max(0, correctDays / dayAttempts)) : 0
  }
}
