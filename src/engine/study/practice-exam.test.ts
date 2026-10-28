// Port de las pruebas de práctica, tarjetas y simulacros de Tests/StudyEngineTests/AuditContentFixTests.swift (CL-03, CL-04,
// CL-06, CL-07/08/25), RobustnessRegressionTests.swift y StudyEngineTests.swift (los cursos de ejemplo validan sin errores).
import { describe, expect, it } from 'vitest'
import {
  emptyProgress, makeExercise, makeFlashcard, makePack, makeSkill, makeSkillProgress, makeSkillRef,
  type Answer, type CardProgress, type ExamRun, type Exercise, type ItemID, type Pack, type Skill, type SkillProgress, type StudyProgress
} from '@shared/schema'
import { functionsCourse, welcomeCourse } from '@main/services/store/samples'
import { Rating } from '@engine/learn'
import { ContentValidator } from '@engine/content'
import { Input } from '@engine/grading'
import { PracticeQueue } from './practice'
import { Recorder } from './recorder'
import { CardReview } from './cards'
import { LearnBridge } from './bridge'
import { ExamBuilder } from './exam'
import { buildExam, buildPractice, examExercises, examReport, gradeExam, recordExam } from './index'

const NOW = new Date(1_900_000_000_000)
const DAY = 86_400_000

function ex(id: string, skill: string, level = 2, answer: Answer = { kind: 'truefalse', value: true, explainWhy: false }): Exercise {
  return makeExercise({ id, skill, level, prompt: [{ id: `${id}-p`, type: 'text', md: `¿${id}?` }], answer })
}

/** Banco típico: 3 de nivel 1, 6 de nivel 2 y 5 de nivel 3. */
function bank(): [Pack, Record<ItemID, Skill>] {
  const pack = makePack({ id: 'p', title: 'P', skills: [makeSkillRef({ id: 's', title: 'S' })] })
  const exercises = [
    ...Array.from({ length: 3 }, (_, i) => ex(`l1-${i}`, 's', 1)),
    ...Array.from({ length: 6 }, (_, i) => ex(`l2-${i}`, 's', 2)),
    ...Array.from({ length: 5 }, (_, i) => ex(`l3-${i}`, 's', 3))
  ]
  return [pack, { s: makeSkill({ id: 's', title: 'S', exercises }) }]
}

function mastered(p: number, attempts = 20, now = NOW): SkillProgress {
  return makeSkillProgress({ alpha: 1 + p * 30, beta: 1 + (1 - p) * 30, attempts, lastPracticed: now.toISOString() })
}

const withSkill = (sp: SkillProgress): StudyProgress => ({ ...emptyProgress(), skills: { s: sp } })

function functions(): [Pack, Record<ItemID, Skill>, Skill[]] {
  const [pack, list] = functionsCourse(NOW)
  return [pack, Object.fromEntries(list.map((s) => [s.id, s])), list]
}

describe('práctica adaptativa', () => {
  it('empieza donde está el dominio y llega al nivel examen', () => {
    const [pack, skills] = bank()
    // sin ver: empieza por lo fácil, pero la sesión sube hasta el nivel examen
    const fresh = PracticeQueue.build(pack, skills, emptyProgress(), { kind: 'skill', skillId: 's' }, { count: 10, now: NOW, seed: 1 })
    expect(fresh.length).toBe(10)
    expect(fresh[0].level).toBe(1)
    expect(fresh.some((e) => e.level === 3)).toBe(true)
    // con mucho dominio, directo al nivel examen
    const strong = PracticeQueue.build(pack, skills, withSkill(mastered(0.95)), { kind: 'skill', skillId: 's' }, { count: 5, now: NOW, seed: 2 })
    expect(strong[0].level).toBe(3)
  })

  it('evita lo que se acaba de hacer', () => {
    const [pack, skills] = bank()
    let p = emptyProgress()
    for (const id of ['l1-0', 'l1-1', 'l1-2']) p = Recorder.record(p, skills.s.exercises.find((e) => e.id === id)!, { credit: 1, mode: 'practice' }, NOW)
    const q = PracticeQueue.build(pack, skills, p, { kind: 'skill', skillId: 's' }, { count: 3, now: NOW, seed: 3 })
    expect(q.some((e) => e.id.startsWith('l1-'))).toBe(false)
  })

  it('tras los fallos, el siguiente hueco baja de nivel; los errores no se adaptan', () => {
    const [pack, skills] = bank()
    const p = withSkill(mastered(0.15, 6))
    const session = ['l3-0', 'l3-1', 'l3-2'].map((id) => skills.s.exercises.find((e) => e.id === id)!)
    expect(PracticeQueue.refill(1, session, pack, skills, p, { kind: 'skill', skillId: 's' }, { now: NOW, seed: 4 })?.level).toBe(1)
    expect(PracticeQueue.refill(1, session, pack, skills, p, { kind: 'mistakes' }, { now: NOW })).toBeUndefined()
    expect(PracticeQueue.refill(7, session, pack, skills, p, { kind: 'skill', skillId: 's' }, { now: NOW })).toBeUndefined()
  })

  it('una sola variante por plantilla y sesión', () => {
    const [pack, , list] = functions()
    const sk = list.find((s) => s.templates.length > 0)!
    const q = buildPractice(pack, { [sk.id]: sk }, emptyProgress(), { kind: 'skill', skillId: sk.id }, { count: 40, seed: 5, now: NOW })
    const tids = q.map((e) => e.templateID).filter((t): t is string => !!t)
    expect(tids.length).toBeGreaterThan(0)
    expect(new Set(tids).size).toBe(tids.length)
    expect(q.filter((e) => e.templateID).every((e) => e.id.startsWith(`${e.templateID}#`))).toBe(true)
  })

  it('nunca repite un id aunque el curso tenga ids y habilidades repetidos', () => {
    const [pack0, , list] = functions()
    const skills: Record<ItemID, Skill> = {}
    for (const s of list) if (!skills[s.id]) skills[s.id] = s
    skills[list[0].id] = { ...list[0], exercises: [...list[0].exercises, ...list[0].exercises] }
    const pack: Pack = { ...pack0, skills: [...pack0.skills, ...pack0.skills] }
    for (const request of [{ kind: 'weakest' } as const, { kind: 'diagnostic' } as const, { kind: 'skill', skillId: 'parabola' } as const]) {
      const q = PracticeQueue.build(pack, skills, emptyProgress(), request, { count: 40, seed: 9, now: NOW })
      expect(q.length, request.kind).toBeGreaterThan(0)
      expect(new Set(q.map((e) => e.id)).size, request.kind).toBe(q.length)
    }
  })

  it('el diagnóstico toma hasta dos fáciles de cada habilidad', () => {
    const [pack, skills] = functions()
    const q = PracticeQueue.build(pack, skills, emptyProgress(), { kind: 'diagnostic' }, { now: NOW, seed: 6 })
    expect(q.length).toBeGreaterThan(0)
    expect(q.every((e) => e.level <= 2)).toBe(true)
    for (const s of pack.skills) expect(q.filter((e) => e.skill === s.id).length).toBeLessThanOrEqual(2)
  })

  it('la cola de errores repite lo fallado que ya toca', () => {
    const [pack, skills] = bank()
    const failed = skills.s.exercises[4]
    const p = Recorder.record(emptyProgress(), failed, { credit: 0, mode: 'practice' }, NOW)
    expect(PracticeQueue.build(pack, skills, p, { kind: 'mistakes' }, { now: NOW })).toEqual([])
    expect(PracticeQueue.build(pack, skills, p, { kind: 'mistakes' }, { now: new Date(NOW.getTime() + 2 * DAY) }).map((e) => e.id)).toEqual([failed.id])
  })
})

describe('cuaderno de errores y tarjetas', () => {
  it('intentos sin habilidad y errores de ejercicios que ya no existen', () => {
    let p = Recorder.record(emptyProgress(), ex('inline', ''), { credit: 0, hints: 0, seconds: 5, mode: 'lesson' }, NOW)
    expect(p.skills['']).toBeUndefined()
    expect(p.mistakes).toEqual([])
    expect(p.attempts.length).toBe(1)
    const due = new Date(NOW.getTime() - 60_000).toISOString()
    const entry = (id: string, skill: string): StudyProgress['mistakes'][number] => ({ id, exerciseID: id, skill, count: 1, firstSeen: due, lastSeen: due, due, stage: 0, resolved: false })
    p = { ...p, mistakes: [entry('vivo', 's'), entry('borrado', 's'), entry('fantasma', '')] }
    const s = makeSkill({ id: 's', title: 'S', exercises: [ex('vivo', 's')] })
    expect(Recorder.dueMistakes(p, NOW).map((m) => m.id)).toEqual(['vivo', 'borrado'])
    expect(Recorder.dueMistakes(p, NOW, { s }).map((m) => m.id)).toEqual(['vivo'])
  })

  it('las tarjetas solas no dan «Dominado» y tras la lección salen las de ese tema', () => {
    const [pack, skills] = functions()
    const card = skills.parabola.cards[0]
    let p = emptyProgress()
    let t = NOW
    for (let i = 0; i < 40; i++) { p = CardReview.rate(p, card.id, Rating.good, t, { skillId: 'parabola' }); t = new Date(t.getTime() + 60_000) }
    const sp = p.skills.parabola
    expect(sp.attempts).toBe(0)
    expect(LearnBridge.level(sp, t)).toBe('unseen')
    expect(LearnBridge.masteryModel.probability(LearnBridge.mastery(sp), t)).toBeLessThanOrEqual(CardReview.cardCeiling + 1e-9)
    const q: StudyProgress = { ...emptyProgress(), skills: { parabola: makeSkillProgress({ lessonDone: true }) } }
    const fresh = CardReview.queue(pack, skills, q, { now: t })
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.every((c) => c.skillId === 'parabola')).toBe(true)
  })

  it('las tarjetas pendientes no se cuentan con tope de 60', () => {
    const pack = makePack({ id: 'p', title: 'P', skills: [makeSkillRef({ id: 's', title: 'S' })] })
    const s = makeSkill({ id: 's', title: 'S', cards: Array.from({ length: 100 }, (_, i) => makeFlashcard({ id: `c${i}`, front: `f${i}`, back: 'b' })) })
    const cards: Record<string, CardProgress> = {}
    for (const c of s.cards) cards[c.id] = { phase: 'review', due: new Date(NOW.getTime() - DAY).toISOString(), stability: 3, difficulty: 5, reps: 3, lapses: 0, lastReview: new Date(NOW.getTime() - 4 * DAY).toISOString(), step: 0 }
    expect(LearnBridge.dueCardCount(pack, { s }, { ...emptyProgress(), cards }, NOW)).toBe(100)
  })
})

describe('simulacros', () => {
  const run = (items: ExamRun['items'], durationMinutes = 0): ExamRun => ({ id: 'x', startedAt: NOW.toISOString(), durationMinutes, items, currentIndex: 0, kind: 'mock' })
  const item = (exerciseID: string, points: number): ExamRun['items'][number] => ({ exerciseID, skill: 's', points, flagged: false, seconds: 0 })

  it('las preguntas que no se construyeron no cuentan y sin límite se guarda el tiempo real', () => {
    const e = ex('e', 's')
    const { result } = ExamBuilder.grade(run([item('e', 5), item('falta', 5)]), { e }, { e: Input.bool(true) }, new Date(NOW.getTime() + 600_000))
    expect(result.totalPoints).toBe(5)
    expect(result.scorePoints).toBe(5)
    expect(result.items.length).toBe(1)
    expect(result.durationSeconds).toBeCloseTo(600, 3)
  })

  it('puntos absurdos dan una nota finita', () => {
    const e = ex('e', 's')
    const r = { ...run([item('e', Number.POSITIVE_INFINITY), item('e2', -3)]), durationMinutes: Number.MAX_SAFE_INTEGER }
    const { result } = ExamBuilder.grade(r, { e }, { e: Input.bool(true) }, NOW)
    expect(Number.isFinite(result.scorePoints) && Number.isFinite(result.totalPoints) && Number.isFinite(result.durationSeconds)).toBe(true)
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('las abiertas y las cortas «con IA» quedan fuera del simulacro en pantalla (no del de papel)', () => {
    const pack = makePack({ id: 'p', title: 'P', skills: [makeSkillRef({ id: 's', title: 'S' })] })
    const openPart: Answer = {
      kind: 'multi', parts: [
        { label: 'a', prompt: [{ id: 'a', type: 'text', md: 'x' }], answer: { kind: 'truefalse', value: true, explainWhy: false }, points: 1, hints: [] },
        { label: 'b', prompt: [{ id: 'b', type: 'text', md: '¿Por qué?' }], answer: { kind: 'open', modelAnswer: 'm', rubric: [] }, points: 1, hints: [] }
      ]
    }
    const short: Answer = { kind: 'short', accepted: ['x'], keywords: [], typoTolerance: true, aiGrade: true }
    const s = makeSkill({ id: 's', title: 'S', exercises: [ex('ok', 's'), ex('multi', 's', 2, openPart), ex('corta', 's', 2, short)] })
    expect(ExamBuilder.needsSeparateGrading(openPart)).toBe(true)
    const plan = ExamBuilder.build(pack, { s }, emptyProgress(), { seed: 1, now: NOW })
    expect(plan?.run.items.map((i) => i.exerciseID)).toEqual(['ok'])
    expect(plan?.leftOut).toBe(2)
    expect(plan?.leftOutNotice).toBeTruthy()
    expect(ExamBuilder.build(pack, { s }, emptyProgress(), { seed: 1, now: NOW, onScreen: false })?.run.items.length).toBe(3)
  })

  it('construir, corregir, guardar e informar un simulacro del curso de ejemplo', () => {
    const [pack, skills] = functions()
    const plan = buildExam(pack, skills, emptyProgress(), { seed: 7, now: NOW })!
    expect(plan.run.items.length).toBeGreaterThan(0)
    expect(plan.totalPoints).toBeGreaterThan(0)
    // misma semilla, mismo examen
    expect(buildExam(pack, skills, emptyProgress(), { seed: 7, now: NOW, id: plan.run.id })?.run.items.map((i) => i.exerciseID)).toEqual(plan.run.items.map((i) => i.exerciseID))
    const exercises = examExercises(plan.run, skills)
    expect(Object.keys(exercises).length).toBe(new Set(plan.run.items.map((i) => i.exerciseID)).size)
    const graded = gradeExam(plan.run, exercises, {}, new Date(NOW.getTime() + 30 * 60_000))
    expect(graded.result.scorePoints).toBe(0)
    expect(graded.result.totalPoints).toBeCloseTo(plan.run.items.reduce((s, i) => s + i.points, 0), 6)
    const started = { ...emptyProgress(), examRun: plan.run }
    const saved = recordExam(started, graded, plan.run, exercises, { now: NOW })
    expect(saved.examRun).toBeUndefined()
    expect(saved.exams.length).toBe(1)
    expect(saved.attempts.length).toBe(plan.run.items.length)
    expect(saved.attempts.every((a) => a.mode === 'exam')).toBe(true)
    const report = examReport(graded, plan.run, pack)
    expect(report.percent).toBe(0)
    expect(report.sections.length).toBeGreaterThan(0)
  })
})

describe('los cursos de ejemplo validan sin errores', () => {
  it('funciones y bienvenida', () => {
    const v = new ContentValidator()
    for (const [pack, skills] of [functionsCourse(NOW), welcomeCourse()]) {
      for (const s of skills) {
        const errors = v.checkSkill(s, pack).filter((i) => i.severity === 'error')
        expect(errors.map((e) => `${pack.id}/${s.id} ${e.path}: ${e.message}`)).toEqual([])
      }
    }
  })
})
