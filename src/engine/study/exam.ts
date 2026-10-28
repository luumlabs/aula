// Simulacros (port de StudyEngine/Learning/ExamBuilder.swift): arma el examen a partir del modelo del curso (secciones, puntos,
// duración), lo corrige y lo resume en un informe con lo que conviene repasar.
import { IDs } from '@engine/base/ids'
import { CourseLanguages } from '@engine/base/language'
import { ExamPicker, type BlueprintSection as PickerSection, type ExerciseRef } from '@engine/learn'
import {
  examPercent, isReviewUsable, makeExamBlueprint, type Answer, type BlueprintSection, type ExamBlueprint, type ExamItemResult, type ExamResult, type ExamRun,
  type ExamRunItem, type Exercise, type ItemID, type Pack, type Skill, type StudyProgress
} from '@shared/schema'
import { answerInputIsEmpty, grade, makeGrade, sanitizedGrade, type AnswerInput, type GradeOptions, type GradeResult } from '@engine/grading'
import { L } from '@engine/grading/messages'
import type { BuildExamOptions, ExamGrade, ExamPlan, ExamReport, ExamSectionReport, ExamSkillReport, SkillsInput, StudyLang } from './types'
import { PracticeQueue } from './practice'
import { Recorder } from './recorder'
import { isoOf, seedOf, skillMap, toDate, u64 } from './util'
import { ownValue, setOwn } from '@shared/schema'

const GOLDEN = 0x9e3779b97f4a7c15n

/** Redondeo «de colegio» (mitades hacia fuera del cero), como `.rounded()` de Swift. */
const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x))

export const ExamBuilder = {
  /** Simulacro estándar cuando la IA no definió uno: una sección por unidad según el peso de sus habilidades. */
  fallbackBlueprint(pack: Pack): ExamBlueprint {
    const total = Math.max(1, pack.skills.reduce((s, x) => s + x.weight, 0))
    const sections: BlueprintSection[] = []
    for (const u of pack.units) {
      const skills = pack.skills.filter((s) => u.skillIDs.includes(s.id))
      if (!skills.length) continue
      const w = skills.reduce((s, x) => s + x.weight, 0)
      sections.push({ title: u.title, skillIDs: skills.map((s) => s.id), count: Math.max(1, roundHalfAway((w / total) * 12)), minLevel: 1, maxLevel: 3, pointsEach: 5 })
    }
    if (!sections.length) {
      sections.push({ title: CourseLanguages.problemsTitle(CourseLanguages.of(pack.language)), skillIDs: pack.skills.map((s) => s.id), count: Math.min(10, Math.max(3, pack.skills.length)), minLevel: 1, maxLevel: 3, pointsEach: 5 })
    }
    const minutes = pack.exam?.durationMinutes ?? 75
    return makeExamBlueprint(minutes, sections.reduce((s, x) => s + x.count * x.pointsEach, 0), sections)
  },

  blueprint(pack: Pack): ExamBlueprint {
    return pack.blueprint && pack.blueprint.sections.length ? pack.blueprint : ExamBuilder.fallbackBlueprint(pack)
  },

  /**
   * ¿Hace falta otra corrección (Aula o autoevaluación) para puntuarlo bien? Respuestas abiertas, cortas «con IA» y ejercicios
   * por apartados con alguna parte así: en pantalla solo se corrige por coincidencia.
   */
  needsSeparateGrading(a: Answer): boolean {
    switch (a.kind) {
      case 'open': return true
      case 'short': return a.aiGrade
      case 'multi': return a.parts.some((p) => ExamBuilder.needsSeparateGrading(p.answer))
      default: return false
    }
  },

  /** El banco como referencias (las plantillas, con 4 variantes). Con `onScreen`, sin lo que necesita otra corrección. */
  pool(skills: Readonly<Record<ItemID, Skill>>, onScreen = true): { refs: ExerciseRef[]; leftOut: number } {
    const refs: ExerciseRef[] = []
    let leftOut = 0
    for (const [sid, s] of Object.entries(skills)) {
      for (const e of s.exercises) {
        if (!isReviewUsable(e.review)) continue
        if (onScreen && ExamBuilder.needsSeparateGrading(e.answer)) { leftOut += 1; continue }
        refs.push({ id: e.id, skillID: sid, level: e.level, tags: e.tags, isTemplate: false })
      }
      for (const t of s.templates) {
        if (onScreen && ExamBuilder.needsSeparateGrading(t.answer)) { leftOut += 1; continue }
        for (let k = 0; k < 4; k++) refs.push({ id: `${t.id}#${k}`, skillID: sid, level: t.level, tags: t.tags, isTemplate: true })
      }
    }
    return { refs, leftOut }
  },

  build(pack: Pack, skillsInput: SkillsInput, progress: StudyProgress, opts: BuildExamOptions = {}): ExamPlan | undefined {
    const now = opts.now ?? new Date()
    const seed = seedOf(opts.seed, now)
    const skills = skillMap(skillsInput)
    const bp = ExamBuilder.blueprint(pack)
    const allIDs = Object.keys(skills)
    const sections: PickerSection[] = bp.sections.map((s) => ({ title: s.title, skillIDs: s.skillIDs.length ? s.skillIDs : allIDs, count: s.count, minLevel: s.minLevel, maxLevel: s.maxLevel }))
    const seen = new Set(progress.exams.flatMap((e) => e.items.map((i) => i.exerciseID)))
    const bank = ExamBuilder.pool(skills, opts.onScreen ?? true)
    const picked = ExamPicker.pick(sections, bank.refs, seed, seen)
    const items: ExamRunItem[] = []
    picked.forEach((group, si) => {
      if (si >= bp.sections.length) return
      const sec = bp.sections[si]
      const pointsEach = Number.isFinite(sec.pointsEach) ? Math.min(Math.max(sec.pointsEach, 0), 1e6) : 1
      for (const ref of group) {
        const hash = ref.id.lastIndexOf('#')
        if (ref.isTemplate && hash >= 0) {
          const tid = ref.id.slice(0, hash)
          const k = BigInt(/^\d+$/.test(ref.id.slice(hash + 1)) ? ref.id.slice(hash + 1) : '0')
          // la plantilla se instancia ya: con algunas semillas no cumple sus restricciones y esa pregunta, invisible en pantalla,
          // contaba como 0. Se prueban otras semillas; si ninguna sirve, se queda fuera
          const base = u64(u64(seed * 6364136223846793005n) + u64(k * 1442695040888963407n) + BigInt(items.length + 1))
          const template = ownValue(skills, ref.skillID)?.templates.find((t) => t.id === tid)
          if (!template) continue
          let found: bigint | undefined
          for (let i = 0n; i < 8n; i++) {
            const s = u64(base + u64(i * GOLDEN))
            if (PracticeQueue.defaultInstantiate(template, s)) { found = s; break }
          }
          if (found === undefined) continue
          items.push({ exerciseID: `${tid}#${found}`, skill: ref.skillID, templateID: tid, seed: found.toString(), points: pointsEach, sectionTitle: sec.title, flagged: false, seconds: 0 })
        } else {
          items.push({ exerciseID: ref.id, skill: ref.skillID, points: pointsEach, sectionTitle: sec.title, flagged: false, seconds: 0 })
        }
      }
    })
    if (!items.length) return undefined
    const run: ExamRun = { id: opts.id ?? IDs.short(6), startedAt: isoOf(now), durationMinutes: bp.durationMinutes, items, currentIndex: 0, kind: 'mock' }
    const plan: ExamPlan = { run, blueprint: bp, totalPoints: items.reduce((s, i) => s + i.points, 0), leftOut: bank.leftOut }
    if (bank.leftOut > 0) {
      plan.leftOutNotice = L(opts.lang, `${bank.leftOut} preguntas de respuesta abierta no entran en el simulacro porque no se pueden corregir solas: practícalas aparte.`,
        `${bank.leftOut} open-answer questions are left out of the mock exam because they can't be graded automatically: practise them separately.`)
    }
    return plan
  },

  /** El ejercicio concreto de un elemento del simulacro (con sus puntos). */
  exercise(item: ExamRunItem, skillsInput: SkillsInput): Exercise | undefined {
    const s = skillMap(skillsInput)[item.skill]
    if (!s) return undefined
    let e: Exercise | undefined
    if (item.templateID !== undefined && item.seed !== undefined) {
      const t = s.templates.find((x) => x.id === item.templateID)
      e = t ? PracticeQueue.defaultInstantiate(t, BigInt(item.seed)) : undefined
    } else e = s.exercises.find((x) => x.id === item.exerciseID)
    return e ? { ...e, points: item.points } : undefined
  },

  exercises(run: ExamRun, skills: SkillsInput): Record<string, Exercise> {
    const out: Record<string, Exercise> = {}
    for (const it of run.items) { const e = ExamBuilder.exercise(it, skills); if (e) setOwn(out, it.exerciseID, e) }
    return out
  },

  /** Calificación final: puntos por ejercicio, resultado del simulacro y la corrección de cada pregunta. */
  grade(run: ExamRun, exercises: Readonly<Record<string, Exercise>>, inputs: Readonly<Record<string, AnswerInput>>, now: Date, activeSeconds?: number,
    gradeOpts: GradeOptions = {}): ExamGrade {
    const items: ExamItemResult[] = []
    const grades: Record<string, GradeResult> = {}
    let score = 0, total = 0
    for (const raw of run.items) {
      // puntos y crédito saneados: un ∞ o un NaN dejaban la nota en NaN
      const points = Number.isFinite(raw.points) ? Math.min(Math.max(raw.points, 0), 1e6) : 0
      // una pregunta que no se pudo construir no se enseñó: ni suma al total ni baja la nota
      const ex = exercises[raw.exerciseID]
      if (!ex) continue
      total += points
      const input = ownValue(inputs, raw.exerciseID) ?? { kind: 'none' as const }
      let r = answerInputIsEmpty(input) ? makeGrade('incorrect', 0) : sanitizedGrade(grade(ex, input, gradeOpts))
      if (r.status === 'invalid') r = makeGrade('incorrect', 0, { feedback: r.feedback })
      setOwn(grades, raw.exerciseID, r)
      score += points * r.credit
      const item: ExamItemResult = { exerciseID: raw.exerciseID, skill: raw.skill, credit: r.credit, points }
      if (Number.isFinite(raw.seconds)) item.seconds = raw.seconds
      items.push(item)
    }
    // la duración es el tiempo ACTIVO que mide la interfaz (como ExamModel.submit de Swift: lo que estuvo cerrado o en pausa
    // no cuenta), con el tope del límite si lo hay; sin ese dato, el tiempo desde que empezó (acotado a un día sin límite)
    const limit = Math.min(run.durationMinutes, 10_000) * 60 * 1.2
    let secs: number
    if (activeSeconds !== undefined && Number.isFinite(activeSeconds) && activeSeconds >= 0) {
      secs = run.durationMinutes > 0 ? Math.min(activeSeconds, limit) : Math.min(activeSeconds, 10_000_000)
    } else {
      const started = toDate(run.startedAt) ?? now
      const elapsed = (now.getTime() - started.getTime()) / 1000
      secs = run.durationMinutes > 0 ? Math.min(limit, elapsed) : Math.min(elapsed, 86_400)
    }
    const result: ExamResult = { id: run.id, date: isoOf(now), kind: run.kind, scorePoints: score, totalPoints: total, durationSeconds: Math.max(0, secs), items }
    return { result, grades }
  },

  /** Guarda la entrega: cada pregunta como intento de examen, el resultado, y cierra el simulacro en curso. */
  record(progress: StudyProgress, graded: ExamGrade, run: ExamRun, exercises: Readonly<Record<string, Exercise>>,
    opts: { now: Date; inputs?: Readonly<Record<string, AnswerInput>>; secondsByItem?: Readonly<Record<string, number>> }): StudyProgress {
    let p = progress
    for (const it of run.items) {
      const ex = exercises[it.exerciseID]
      if (!ex) continue
      const r = graded.grades[it.exerciseID]
      const input = opts.inputs?.[it.exerciseID]
      p = Recorder.record(p, ex, {
        credit: r?.credit ?? 0, hints: 0, seconds: opts.secondsByItem?.[it.exerciseID] ?? (it.seconds > 0 ? it.seconds : undefined), mode: 'exam',
        input: input ? Recorder.inputSummary(input, ex) : undefined, why: r?.feedback[0]?.markdown
      }, opts.now)
    }
    const out: StudyProgress = { ...p, exams: [...p.exams, graded.result] }
    delete out.examRun
    return out
  },

  /** Informe: nota, por secciones y habilidades, y las tres habilidades que más puntos hicieron perder. */
  report(graded: ExamGrade, run: ExamRun, pack: Pack, lang?: StudyLang): ExamReport {
    const r = graded.result
    const bySection = new Map<string, ExamSectionReport>()
    const bySkill = new Map<string, ExamSkillReport>()
    const title = (id: string): string => pack.skills.find((s) => s.id === id)?.title ?? id
    const sectionOf = new Map(run.items.map((i) => [i.exerciseID, i.sectionTitle ?? ''] as const))
    for (const it of r.items) {
      const sec = sectionOf.get(it.exerciseID) ?? ''
      const s = bySection.get(sec) ?? { title: sec, points: 0, total: 0, percent: 0, items: 0 }
      s.points += it.points * it.credit; s.total += it.points; s.items += 1
      bySection.set(sec, s)
      const k = bySkill.get(it.skill) ?? { skillId: it.skill, title: title(it.skill), points: 0, total: 0, percent: 0, items: 0, wrong: 0 }
      k.points += it.points * it.credit; k.total += it.points; k.items += 1
      if (it.credit < 0.999) k.wrong += 1
      bySkill.set(it.skill, k)
    }
    const pct = (a: number, b: number): number => (b > 0 ? Math.min(1, Math.max(0, a / b)) : 0)
    const sections = [...bySection.values()].map((s) => ({ ...s, percent: pct(s.points, s.total) }))
    const skills = [...bySkill.values()].map((s) => ({ ...s, percent: pct(s.points, s.total) }))
    const review = [...skills].filter((s) => s.total - s.points > 1e-9).sort((a, b) => (b.total - b.points) - (a.total - a.points) || a.percent - b.percent).slice(0, 3)
      .map((s) => ({
        skillId: s.skillId, title: s.title,
        reason: L(lang, `Perdiste ${fmt(s.total - s.points)} de ${fmt(s.total)} puntos (${s.wrong} de ${s.items} preguntas): repásalo antes del examen.`,
          `You lost ${fmt(s.total - s.points)} of ${fmt(s.total)} points (${s.wrong} of ${s.items} questions): review it before the exam.`)
      }))
    const percent = examPercent(r)
    const pass = ExamBuilder.blueprint(pack).passPercent
    const out: ExamReport = {
      examId: r.id, score: r.scorePoints, total: r.totalPoints, percent, durationSeconds: r.durationSeconds, sections, skills, review,
      wrongItems: r.items.filter((i) => i.credit < 0.999).map((i) => i.exerciseID)
    }
    if (pass !== undefined) out.passed = percent >= pass
    return out
  }
}

const fmt = (x: number): string => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(1))
