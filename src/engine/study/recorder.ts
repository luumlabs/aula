// Registro de intentos en el progreso (port de StudyEngine/Learning/Recorder.swift): dominio por habilidad, cuaderno de
// errores con repasos espaciados, estadística diaria y XP. Todo devuelve un progreso NUEVO.
import { IDs } from '@engine/base/ids'
import { MasteryModel, attempt as learnAttempt, type AttemptMode } from '@engine/learn'
import {
  answerForGrading, effectiveAspect, effectiveLabelMode, FigureGeometry, isReviewUsable, labelAnswerParts, makeSkillProgress, MAX_ATTEMPTS,
  type Attempt, type DayRecord, type Exercise, type ItemID, type MistakeEntry, type SkillProgress, type StudyProgress
} from '@shared/schema'
import { instantiateTemplate, type AnswerInput } from '@engine/grading'
import { L } from '@engine/grading/messages'
import type { AttemptRecord, MistakeView, SkillsInput, StudyLang } from './types'
import { LearnBridge } from './bridge'
import { addDaysISO, addInt, dayKey, finite, isoOf, skillMap, toDate } from './util'
import { ownValue } from '@shared/schema'

/** Días entre repasos de un error (etapas 0…4); tras la última, resuelto. */
export const MISTAKE_STAGES: readonly number[] = [1, 3, 7, 16, 35]

/** Suma `minutes` (y opcionalmente un intento) al día `key`. */
function addToDay(days: readonly DayRecord[], key: string, minutes: number, attempts = 0, correct = 0): DayRecord[] {
  const i = days.findIndex((d) => d.day === key)
  if (i < 0) return [...days, { day: key, minutes, attempts, correct }]
  const out = [...days]
  const d = out[i]
  out[i] = { ...d, minutes: d.minutes + minutes, attempts: addInt(d.attempts, attempts), correct: d.correct + correct }
  return out
}

export const Recorder = {
  mistakeStages: MISTAKE_STAGES,

  dayKey(d: Date): string {
    return dayKey(d)
  },

  /** Anota un intento y devuelve el progreso nuevo. */
  record(p: StudyProgress, exercise: Exercise, rec: AttemptRecord, now: Date): StudyProgress {
    // crédito y tiempo saneados: un NaN acababa en un progress.json imposible de guardar
    const credit = Number.isFinite(rec.credit) ? Math.min(Math.max(rec.credit, 0), 1) : 0
    const seconds = rec.seconds !== undefined && Number.isFinite(rec.seconds) && rec.seconds >= 0 ? Math.min(rec.seconds, 86_400) : undefined
    const hints = Math.max(0, Math.trunc(finite(rec.hints, 0)))
    const mode = rec.mode ?? 'practice'
    const id = exercise.id, skill = exercise.skill
    const at: Attempt = { id: IDs.short(8), exerciseID: id, skill, date: isoOf(now), credit, level: exercise.level, hints, mode }
    if (seconds !== undefined) at.seconds = seconds
    if (rec.input !== undefined) at.input = rec.input
    const out: StudyProgress = { ...p, attempts: [...p.attempts, at] }
    const level = Math.min(3, Math.max(1, Math.trunc(finite(exercise.level, 2))))
    const diffW = [1.0, 1.2, 1.5][level - 1]

    // un ejercicio sin habilidad (los incrustados de un «Pruébalo» antiguo) cuenta para el día y la XP, pero no crea un
    // dominio `skills[""]` ni un error «fantasma» que el repaso de errores nunca encuentra
    if (skill) {
      const sp = ownValue(p.skills, skill) ?? makeSkillProgress()
      const outcome = learnAttempt(credit, {
        difficulty: exercise.level, hintsUsed: hints, seconds: seconds ?? null,
        expectedSeconds: exercise.estimatedSeconds ?? null, mode: mode as AttemptMode
      })
      out.skills = { ...p.skills, [skill]: LearnBridge.apply(LearnBridge.masteryModel.updated(LearnBridge.mastery(sp), outcome, now), sp) }
      out.mistakes = Recorder.updatedMistakes(p.mistakes, exercise, credit, mode, rec, now)
    }

    // estadística del día
    out.days = addToDay(p.days, dayKey(now), (seconds ?? 30) / 60, 1, credit)
    out.xp = addInt(p.xp, Math.round(credit * 10 * diffW))
    if (out.attempts.length > MAX_ATTEMPTS) out.attempts = out.attempts.slice(out.attempts.length - MAX_ATTEMPTS)
    return out
  },

  /** El cuaderno de errores tras un intento (por id y habilidad: un id repetido en otra habilidad no es el mismo error). */
  updatedMistakes(list: readonly MistakeEntry[], ex: Exercise, credit: number, mode: Attempt['mode'], rec: AttemptRecord, now: Date): MistakeEntry[] {
    const id = ex.id, skill = ex.skill
    if (credit < 0.999) {
      const k = list.findIndex((m) => m.id === id && (m.skill === skill || m.skill === ''))
      if (k >= 0) {
        const m: MistakeEntry = { ...list[k], count: addInt(list[k].count, 1), lastSeen: isoOf(now), stage: 0, due: addDaysISO(now, MISTAKE_STAGES[0]), resolved: false, skill }
        if (rec.input !== undefined) m.lastInput = rec.input
        if (rec.why !== undefined) m.why = rec.why
        const out = [...list]
        out[k] = m
        return out
      }
      const m: MistakeEntry = { id, exerciseID: id, skill, firstSeen: isoOf(now), lastSeen: isoOf(now), count: 1, due: addDaysISO(now, MISTAKE_STAGES[0]), stage: 0, resolved: false }
      if (ex.templateID !== undefined) m.templateID = ex.templateID
      if (ex.seed !== undefined) m.seed = ex.seed
      if (rec.input !== undefined) m.lastInput = rec.input
      if (rec.why !== undefined) m.why = rec.why
      return [...list, m]
    }
    const idx = list.findIndex((m) => m.id === id && m.skill === skill)
    if (idx < 0 || !(mode === 'review' || mode === 'practice')) return [...list]
    const prev = list[idx]
    const stage = Math.max(0, addInt(prev.stage, 1))
    const m: MistakeEntry = { ...prev, stage, lastSeen: isoOf(now) }
    if (stage >= MISTAKE_STAGES.length) m.resolved = true
    else m.due = addDaysISO(now, MISTAKE_STAGES[stage])
    const out = [...list]
    out[idx] = m
    return out
  },

  /** Suma tiempo de estudio al día (lectura de lecciones, simulacros, tutor…). */
  addTime(p: StudyProgress, seconds: number, now: Date): StudyProgress {
    if (!Number.isFinite(seconds) || seconds <= 0) return p
    return { ...p, days: addToDay(p.days, dayKey(now), Math.min(seconds, 86_400) / 60) }
  },

  completeLesson(p: StudyProgress, skill: ItemID, now: Date): StudyProgress {
    const sp: SkillProgress = { ...(ownValue(p.skills, skill) ?? makeSkillProgress()), lessonDone: true, lessonDoneAt: isoOf(now), lessonStep: 0 }
    return { ...p, skills: { ...p.skills, [skill]: sp }, xp: addInt(p.xp, 20) }
  },

  withSkill(p: StudyProgress, skill: ItemID, sp: SkillProgress): StudyProgress {
    return { ...p, skills: { ...p.skills, [skill]: sp } }
  },

  /**
   * Errores que toca repasar. Los que no tienen habilidad no se pueden repasar y no cuentan. Con `skills`, tampoco los de
   * ejercicios o plantillas que ya no existen (el plan no los anuncia si la sesión de errores no los va a enseñar).
   */
  dueMistakes(p: StudyProgress, now: Date, skillsInput?: SkillsInput): MistakeEntry[] {
    const skills = skillsInput ? skillMap(skillsInput) : undefined
    return p.mistakes.filter((m) => {
      if (m.resolved || !m.skill) return false
      const due = toDate(m.due)
      if (!due || due.getTime() > now.getTime()) return false
      if (!skills) return true
      const s = ownValue(skills, m.skill)
      if (!s) return false
      if (m.templateID !== undefined) return s.templates.some((t) => t.id === m.templateID)
      const e = s.exercises.find((x) => x.id === m.exerciseID)
      return e !== undefined && isReviewUsable(e.review)
    })
  },

  /** El ejercicio de un error (las variantes de plantilla, con su semilla). */
  mistakeExercise(m: MistakeEntry, skillsInput: SkillsInput): Exercise | undefined {
    const s = skillMap(skillsInput)[m.skill]
    if (!s) return undefined
    if (m.templateID !== undefined && m.seed !== undefined) {
      const t = s.templates.find((x) => x.id === m.templateID)
      return t ? instantiateTemplate(t, m.seed) : undefined
    }
    return s.exercises.find((x) => x.id === m.exerciseID && isReviewUsable(x.review))
  },

  notebook(p: StudyProgress, skills: SkillsInput, now: Date): MistakeView[] {
    return p.mistakes
      .filter((m) => !m.resolved && m.skill !== '')
      .map((m): MistakeView => {
        const due = toDate(m.due) ?? now
        const ms = due.getTime() - now.getTime()
        const view: MistakeView = { entry: m, due: ms <= 0, inDays: ms <= 0 ? 0 : Math.ceil(ms / 86_400_000) }
        const ex = Recorder.mistakeExercise(m, skills)
        if (ex) view.exercise = ex
        return view
      })
      .sort((a, b) => (toDate(a.entry.due)?.getTime() ?? 0) - (toDate(b.entry.due)?.getTime() ?? 0))
  },

  /** Dominio (0…1) con el olvido; undefined si nunca se intentó. */
  mastery(sp: SkillProgress | undefined, now: Date): number | undefined {
    return LearnBridge.probability(sp, now)
  },

  /** Texto breve de una respuesta para el cuaderno de errores (port de `ExerciseState.inputSummary`). */
  inputSummary(input: AnswerInput, exercise?: Exercise, lang?: StudyLang): string | undefined {
    const a = exercise ? answerForGrading(exercise.answer) : undefined
    switch (input.kind) {
      case 'none': return undefined
      case 'text': return input.text.trim() ? input.text : undefined
      case 'choice': {
        const opts = a?.kind === 'choice' ? a.options.filter((o) => input.ids.includes(o.id)).map((o) => o.md) : input.ids
        return opts.length ? opts.join('; ') : undefined
      }
      case 'bool': return input.value ? L(lang, 'Verdadero', 'True') : L(lang, 'Falso', 'False')
      case 'ordering': return input.items.length ? input.items.join(' → ') : undefined
      case 'matching': {
        const pairs = Object.entries(input.pairs).map(([k, v]) => `${k} → ${v}`).sort()
        return pairs.length ? pairs.join('; ') : undefined
      }
      case 'blanks': {
        if (a?.kind === 'label' && effectiveLabelMode(a) === 'locate') {
          // «señala la parte»: lo que señaló, por su nombre (no las coordenadas)
          const parts = labelAnswerParts(a)
          const names = input.values.map((v) => FigureGeometry.parsePoint(v)).filter((pt): pt is [number, number] => pt !== undefined)
            .map(([x, y]) => { const h = FigureGeometry.hit(x, y, parts, effectiveAspect(a)); return h === undefined ? L(lang, '(fuera de las partes)', '(outside the parts)') : parts[h].name })
          return names.length ? names.join(' | ') : undefined
        }
        const b = input.values.filter((x) => x !== '')
        return b.length ? b.join(' | ') : undefined
      }
      case 'parts': {
        const subs = a?.kind === 'multi' ? a.parts : []
        const p = input.parts.map((x, i) => Recorder.inputSummary(x, subs[i] ? { ...exercise!, answer: subs[i].answer } : undefined, lang)).filter((x): x is string => x !== undefined)
        return p.length ? p.join(' / ') : undefined
      }
    }
  },

  /** Clave de modo de intento de LearnKit (los nombres coinciden). */
  modeWeight(mode: Attempt['mode']): number {
    return MasteryModel.modeWeight(mode as AttemptMode)
  }
}
