// Puente entre el progreso guardado (StudyModel) y la ciencia del aprendizaje (@engine/learn): dominio por habilidad, repaso
// espaciado FSRS, nota estimada y plan diario (port de StudyEngine/Learning/LearnBridge.swift).
import {
  FSRS, MasteryModel, ReadinessEstimator, StudyPlanner, freshMastery, type CardPhase, type MasteryLevel, type PlanItem, type PlanSkill, type Readiness,
  type ReviewState, type SkillMastery
} from '@engine/learn'
import { daysBetween, localTimeZone, startOfDay } from '@engine/calendar/time'
import { ownValue, makeSkillProgress, orderedSkills, packHasExam, type CardProgress, type ItemID, type Pack, type Skill, type SkillProgress, type StudyProgress } from '@shared/schema'
import type { SkillsInput, StudyLang } from './types'
import { isoOf, skillMap, toDate } from './util'
import { LearningController } from './learning'
import { CardReview } from './cards'
import { Recorder } from './recorder'

const masteryModel = new MasteryModel()
const fsrs = new FSRS()
const CARD_PHASES: readonly CardPhase[] = ['new', 'learning', 'review', 'relearning']

export const LearnBridge = {
  masteryModel,
  fsrs,

  // MARK: Dominio

  mastery(sp: SkillProgress | undefined): SkillMastery {
    if (!sp) return freshMastery()
    return { alpha: sp.alpha, beta: sp.beta, attempts: sp.attempts, lastPracticed: toDate(sp.lastPracticed), lastCorrect: toDate(sp.lastCorrect), streak: sp.streak }
  },

  /** El progreso de la habilidad con este dominio (uno nuevo; el de entrada no se toca). */
  apply(m: SkillMastery, sp: SkillProgress | undefined): SkillProgress {
    const out: SkillProgress = { ...(sp ?? makeSkillProgress()), alpha: m.alpha, beta: m.beta, attempts: m.attempts, streak: m.streak }
    if (m.lastPracticed) out.lastPracticed = isoOf(m.lastPracticed); else delete out.lastPracticed
    if (m.lastCorrect) out.lastCorrect = isoOf(m.lastCorrect); else delete out.lastCorrect
    return out
  },

  /** Probabilidad de dominio (0…1) con el olvido aplicado; undefined si nunca se intentó. */
  probability(sp: SkillProgress | undefined, now: Date): number | undefined {
    if (!sp || !(sp.attempts > 0)) return undefined
    return masteryModel.probability(LearnBridge.mastery(sp), now)
  },

  level(sp: SkillProgress | undefined, now: Date): MasteryLevel {
    if (!sp || !(sp.attempts > 0)) return 'unseen'
    return masteryModel.level(LearnBridge.mastery(sp), now)
  },

  // MARK: Nota estimada y plan

  /** Peso de una habilidad acotado (un peso de 1e308 hacía que las sumas dieran ∞ y la nota estimada NaN). */
  weight(w: number): number {
    return Number.isFinite(w) ? Math.min(Math.max(w, 0.01), 1e6) : 1
  },

  readiness(pack: Pack, progress: StudyProgress, now: Date, lang?: StudyLang): Readiness {
    const items = pack.skills.map((s) => ({ weight: { skillID: s.id, weight: LearnBridge.weight(s.weight) }, mastery: LearnBridge.mastery(ownValue(progress.skills, s.id)) }))
    return ReadinessEstimator.estimate(items, masteryModel, now, { lang })
  },

  /** Todas las tarjetas vencidas (sin el tope de 60 de una sesión). */
  dueCardCount(pack: Pack, skills: SkillsInput, progress: StudyProgress, now: Date): number {
    return CardReview.queue(pack, skills, progress, { now, includeNew: false, limit: Number.MAX_SAFE_INTEGER }).length
  },

  dailyPlan(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, minutes: number, now: Date, lang?: StudyLang): PlanItem[] {
    const skills = skillMap(skillsInput)
    const tz = localTimeZone()
    let precedingGuided: ItemID | undefined
    // con el examen a dos días o menos se prioriza lo que más puntos da: encadenar las lecciones guiadas lo anularía
    const examDate = toDate(pack.exam?.date)
    const examIsNear = examDate !== null && examDate.getTime() >= now.getTime() && daysBetween(startOfDay(now, tz), startOfDay(examDate, tz), tz) <= 2
    const plan = orderedSkills(pack).map((ref): PlanSkill => {
      const saved = ownValue(progress.skills, ref.id)
      let needsTeaching: boolean | undefined, ready: boolean | undefined
      const prerequisites = [...ref.prerequisites]
      const skill: Skill | undefined = ownValue(skills, ref.id)
      if (progress.settings.lessonMode === 'guided' && skill && skill.lesson.length) {
        ready = LearningController.isMastered(skill, saved)
        // una comprobación guiada pendiente vuelve a su lección, no a la práctica normal
        needsTeaching = !ready
        if (!examIsNear && precedingGuided !== undefined && !prerequisites.includes(precedingGuided)) prerequisites.push(precedingGuided)
        precedingGuided = ref.id
      } else if (skill && skill.lesson.length) {
        needsTeaching = saved?.lessonDone !== true
      }
      return {
        id: ref.id, title: ref.title, weight: LearnBridge.weight(ref.weight), mastery: LearnBridge.mastery(saved), prerequisites,
        estimatedMinutes: Math.min(Math.max(5, ref.minutes), 600), needsTeaching, progressReady: ready
      }
    })
    return StudyPlanner.dailyPlan({
      now, examDate, minutesAvailable: minutes, skills: plan,
      dueCards: LearnBridge.dueCardCount(pack, skills, progress, now),
      dueMistakes: Recorder.dueMistakes(progress, now, skills).length,
      hasDiagnostic: progress.settings.lessonMode === 'guided' || progress.diagnosticDone || Object.values(progress.skills).some((s) => s.attempts > 0),
      mockExamsDone: progress.exams.filter((e) => e.kind === 'mock').length,
      // un examen que ya pasó no es una meta: el plan sigue como un curso a tu ritmo (repasar para no olvidar, sin «x % del examen»)
      selfPaced: !packHasExam(pack) || (examDate !== null && examDate.getTime() < now.getTime())
    }, { model: masteryModel, lang, timeZone: tz })
  },

  // MARK: Tarjetas

  reviewState(c: CardProgress | undefined, now: Date): ReviewState {
    if (!c) return { phase: 'new', due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, step: 0 }
    const phase = (CARD_PHASES as readonly string[]).includes(c.phase) ? (c.phase as CardPhase) : 'new'
    return { phase, due: toDate(c.due) ?? now, stability: c.stability, difficulty: c.difficulty, reps: c.reps, lapses: c.lapses, lastReview: toDate(c.lastReview), step: c.step }
  },

  cardProgress(s: ReviewState): CardProgress {
    const out: CardProgress = { phase: s.phase, due: isoOf(s.due), stability: s.stability, difficulty: s.difficulty, reps: s.reps, lapses: s.lapses, step: s.step }
    if (s.lastReview) out.lastReview = isoOf(s.lastReview)
    return out
  }
}
