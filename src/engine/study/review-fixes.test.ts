// Port de Tests/StudyEngineTests/EngineReviewLearningFixTests.swift (revisión J1 del motor): una lección guiada siempre se puede
// terminar, los cursos de antes no cambian solos de modo, el plan no anula el examen y la corrección abierta no pierde puntos.
import { describe, expect, it } from 'vitest'
import {
  decodeProgress, decodeSkillProgress, emptyProgress, encodeSkillProgress, makeExercise, makePack, makeSkill, makeSkillRef,
  type Exercise, type Skill, type SkillProgress, type StudyProgress
} from '@shared/schema'
import { makeGrade, medianReview, parseOpenReview, reviewCredit, type OpenAnswerReview } from '@engine/grading'
import { ContentValidator } from '@engine/content'
import { numeric, text, tryIt } from './testutil'
import { LearningController } from './learning'
import { LearnBridge } from './bridge'
import type { LearningConcept } from './types'

const correct = makeGrade('correct', 1)
const wrong = makeGrade('incorrect', 0)
const use = { hints: 0, revealed: false }

function num(id: string, v: number, skill = 's'): Exercise {
  return makeExercise({
    id, skill, prompt: [text(`Calcula la suma de ${v} y 2.`, `${id}-p`)], answer: numeric(String(v + 2)),
    hints: ['Añade dos unidades.'], solution: [text(`${v} + 2 = ${v + 2}.`, `${id}-s`)], tags: ['suma']
  })
}

function skill(id = 's', count: number): Skill {
  const ex = Array.from({ length: count }, (_, i) => num(`${id}e${i + 1}`, (i + 1) * 10 + (id === 's' ? 0 : 1), id))
  return makeSkill({
    id, title: `Sumas ${id}`,
    lesson: [text('# Sumas\nSumar dos añade dos unidades a la cantidad inicial.', `${id}-concept`), tryIt(ex.map((e) => e.id), `${id}-checks`)],
    exercises: ex
  })
}

/** Responde bien las preguntas que vayan saliendo hasta dominar el concepto (o hasta que no haya más). */
function master(c: LearningConcept, s: Skill, start: SkillProgress | undefined): { ok: boolean; progress: SkillProgress | undefined } {
  let p = start
  for (let k = 0; k < 6; k++) {
    if (LearningController.canAdvance(c, p)) return { ok: true, progress: p }
    const step = LearningController.status(c, p) === 'check' ? LearningController.prepareCheck(c, s, p) : LearningController.acknowledgeExplanation(c, s, p)
    p = step.progress
    if (!step.exercise) return { ok: LearningController.canAdvance(c, p), progress: p }
    p = LearningController.recordCheck(c, s, step.exercise, correct, use, p).progress
  }
  return { ok: LearningController.canAdvance(c, p), progress: p }
}

describe('una lección guiada siempre se puede terminar', () => {
  it('una sección final sin preguntas no bloquea: basta con leerla', () => {
    const ex = Array.from({ length: 6 }, (_, i) => num(`e${i + 1}`, (i + 1) * 7))
    const s = makeSkill({
      id: 's', title: 'Sumas', exercises: ex,
      lesson: [text('# Sumar dos\nSumar dos añade dos unidades.', 'a'), tryIt(ex.map((e) => e.id), 'k'), text('## Consejos para el examen\nRevisa siempre el signo antes de entregar.', 'z')]
    })
    const cs = LearningController.concepts(s)
    expect(cs.length).toBe(2)
    const first = master(cs[0], s, undefined)
    expect(first.ok).toBe(true)
    expect(LearningController.checkKind(cs[1], s)).toBe('none')
    const read = LearningController.acknowledgeExplanation(cs[1], s, first.progress)
    expect(read.exercise).toBeUndefined()
    expect(LearningController.canAdvance(cs[1], read.progress)).toBe(true)
    expect(LearningController.isMastered(s, read.progress)).toBe(true)
    // y se guarda y se vuelve a leer igual
    const restored = decodeSkillProgress(JSON.parse(JSON.stringify(encodeSkillProgress(read.progress))))
    expect(LearningController.isMastered(s, restored)).toBe(true)
  })

  it('con 3 preguntas, un fallo no agota el concepto', () => {
    const s = skill('s', 3)
    const c = LearningController.concepts(s)[0]
    const first = LearningController.acknowledgeExplanation(c, s, undefined)
    const r1 = LearningController.recordCheck(c, s, first.exercise!, wrong, use, first.progress)
    expect(r1.phase).toBe('reteach')
    expect(LearningController.remediationBlocks(c, s, r1.progress).length).toBeGreaterThan(0)
    const second = LearningController.acknowledgeExplanation(c, s, r1.progress)
    expect(second.exercise).toBeDefined()
    const r2 = LearningController.recordCheck(c, s, second.exercise!, correct, use, second.progress)
    expect(r2.phase).toBe('check')
    const third = LearningController.prepareCheck(c, s, r2.progress)
    expect(third.exercise).toBeDefined()
    expect(LearningController.recordCheck(c, s, third.exercise!, correct, use, third.progress).phase).toBe('mastered')
  })

  it('con banco de sobra se enseña otro ejemplo resuelto', () => {
    const s = skill('s', 6)
    const c = LearningController.concepts(s)[0]
    const first = LearningController.acknowledgeExplanation(c, s, undefined)
    const p = LearningController.recordCheck(c, s, first.exercise!, wrong, use, first.progress).progress
    expect(LearningController.remediationBlocks(c, s, p).some((b) => b.type === 'example')).toBe(true)
    expect(master(c, s, p).ok).toBe(true)
  })

  it('si de verdad se acaban, se puede seguir «sin comprobar» y la lección termina', () => {
    const s = skill('s', 2)
    const c = LearningController.concepts(s)[0]
    const first = LearningController.acknowledgeExplanation(c, s, undefined)
    let p = LearningController.recordCheck(c, s, first.exercise!, wrong, use, first.progress).progress
    const second = LearningController.acknowledgeExplanation(c, s, p)
    p = LearningController.recordCheck(c, s, second.exercise!, correct, use, second.progress).progress
    const none = LearningController.prepareCheck(c, s, p)
    expect(none.exercise).toBeUndefined()
    expect(none.prepareMore).toBe(true)
    p = none.progress
    expect(LearningController.status(c, p)).toBe('needsPractice')
    expect(LearningController.continueWithoutChecks(c, s, undefined).applied).toBe(false)
    const go = LearningController.continueWithoutChecks(c, s, p)
    expect(go.applied).toBe(true)
    expect(LearningController.canAdvance(c, go.progress)).toBe(true)
    expect(LearningController.isUnchecked(c, go.progress)).toBe(true)
    expect(LearningController.isMastered(s, go.progress)).toBe(true)
  })

  it('un concepto solo con preguntas abiertas se certifica con una nota completa', () => {
    const essay = makeExercise({
      id: 'q1', skill: 's', prompt: [text('Explica las causas de la Revolución francesa.')],
      answer: { kind: 'open', modelAnswer: 'Crisis fiscal, ideas ilustradas, desigualdad.', rubric: [{ text: 'Causas', points: 2 }] }
    })
    const s = makeSkill({ id: 's', title: 'Historia', exercises: [essay], lesson: [text('# Causas\nLa crisis fiscal y la Ilustración.', 't'), tryIt(['q1'], 'c')] })
    const c = LearningController.concepts(s)[0]
    expect(LearningController.checkKind(c, s)).toBe('selfAssessed')
    expect(LearningController.requiredSuccessesFor(c)).toBe(1)
    const q = LearningController.acknowledgeExplanation(c, s, undefined)
    expect(q.exercise?.id).toBe('q1')
    // ver la respuesta modelo al autoevaluarse no es ayuda
    const seen = LearningController.recordAssistance(c, s, q.exercise!, { hints: 0, revealed: true }, q.progress)
    expect(seen.phase).toBe('check')
    const done = LearningController.recordCheck(c, s, q.exercise!, correct, { hints: 0, revealed: true }, seen.progress)
    expect(done.phase).toBe('mastered')
    expect(LearningController.isMastered(s, done.progress)).toBe(true)
    // una nota parcial no certifica
    const q2 = LearningController.acknowledgeExplanation(c, s, undefined)
    expect(LearningController.recordCheck(c, s, q2.exercise!, makeGrade('partial', 0.5), { hints: 0, revealed: true }, q2.progress).phase).toBe('reteach')
  })

  it('en un concepto con preguntas que Aula corrige sola, una abierta no cuenta', () => {
    const base = skill('s', 4)
    const essay = makeExercise({ id: 'q1', skill: 's', prompt: [text('Explica por qué sumar dos añade dos.')], answer: { kind: 'open', modelAnswer: 'Porque…', rubric: [] } })
    const checks = base.lesson[1]
    const s: Skill = { ...base, exercises: [...base.exercises, essay], lesson: [base.lesson[0], checks.type === 'tryit' ? { ...checks, exerciseIDs: [...checks.exerciseIDs, 'q1'] } : checks] }
    const c = LearningController.concepts(s)[0]
    expect(LearningController.checkKind(c, s)).toBe('objective')
    const p = LearningController.acknowledgeExplanation(c, s, undefined).progress
    const r = LearningController.recordCheck(c, s, essay, correct, use, p)
    expect(r.phase).toBe('check')
    expect(LearningController.successfulCheckCount(c, r.progress)).toBe(0)
  })

  it('el validador avisa de un concepto con menos de cuatro preguntas y sin plantilla', () => {
    const v = new ContentValidator()
    expect(v.checkSkill(skill('s', 3)).some((i) => i.message.includes('solo tiene 3 preguntas'))).toBe(true)
    expect(v.checkSkill(skill('s', 4)).some((i) => i.message.includes('preguntas que se corrigen solas'))).toBe(false)
  })
})

describe('el plan', () => {
  it('un progress.json de antes (sin lessonMode) sigue en «Explorar» y su plan no bloquea la lección siguiente', () => {
    const legacy = '{"schema":1,"skills":{"s":{"alpha":9,"beta":1,"attempts":3,"lessonDone":true,"lessonStep":2},"t":{"alpha":1,"beta":1,"attempts":0}},"settings":{"dailyMinutes":60}}'
    const progress = decodeProgress(JSON.parse(legacy))
    expect(progress.settings.lessonMode).toBe('explore')
    expect(progress.skills.s?.lessonDone).toBe(true)
    const pack = makePack({ id: 'p', title: 'P', skills: [makeSkillRef({ id: 's', title: 'S', order: 0 }), makeSkillRef({ id: 't', title: 'T', order: 1 })] })
    const plan = LearnBridge.dailyPlan(pack, { s: skill('s', 3), t: skill('t', 3) }, progress, 60, new Date(1_800_000_000_000))
    expect(plan.some((i) => i.skillID === 't')).toBe(true)
    expect(plan.some((i) => i.kind === 'learn' && i.skillID === 's')).toBe(false)
    expect(emptyProgress().settings.lessonMode).toBe('guided')
  })

  it('con el examen a dos días, las lecciones guiadas no se encadenan y el plan va a lo que más puntos da', () => {
    const now = new Date(1_800_000_000_000)
    const skills = { a: skill('a', 4), b: skill('b', 4), c: skill('c', 4) }
    const refs = [makeSkillRef({ id: 'a', title: 'A', weight: 1, order: 0 }), makeSkillRef({ id: 'b', title: 'B', weight: 1, order: 1 }), makeSkillRef({ id: 'c', title: 'C', weight: 98, order: 2 })]
    const near = makePack({ id: 'p', title: 'P', skills: refs, exam: { title: 'Final', date: new Date(now.getTime() + 2 * 86_400_000).toISOString() } })
    const progress: StudyProgress = { ...emptyProgress(), settings: { ...emptyProgress().settings, lessonMode: 'guided' } }
    expect(LearnBridge.dailyPlan(near, skills, progress, 90, now).some((i) => i.skillID === 'c')).toBe(true)
    // lejos del examen, sí se encadenan
    const far = { ...near, exam: { title: 'Final', date: new Date(now.getTime() + 30 * 86_400_000).toISOString() } }
    expect(LearnBridge.dailyPlan(far, skills, progress, 90, now).some((i) => i.skillID === 'c')).toBe(false)
  })
})

describe('corrección abierta', () => {
  const crit = (t: string, points: number, max: number): OpenAnswerReview['criteria'][number] => ({ text: t, points, max, comment: '' })

  it('la mediana no baja una nota unánime de un criterio fraccionario', () => {
    const rubric = [{ text: 'A', points: 0.75 }, { text: 'B', points: 1 }]
    const r: OpenAnswerReview = { criteria: [crit('A', 0.75, 0.75), crit('B', 1, 1)], feedback: '', missing: [] }
    const m = medianReview([r, r, r], rubric)
    expect(m.criteria[0].points).toBe(0.75)
    expect(reviewCredit(m)).toBe(1)
    // una mediana entre dos notas sí se redondea, pero nunca por debajo de la más baja
    const lo: OpenAnswerReview = { criteria: [crit('A', 0.6, 0.75), crit('B', 1, 1)], feedback: '', missing: [] }
    const hi: OpenAnswerReview = { criteria: [crit('A', 0.7, 0.75), crit('B', 1, 1)], feedback: '', missing: [] }
    expect(medianReview([lo, hi], rubric).criteria[0].points).toBeGreaterThanOrEqual(0.6)
  })

  it('una corrección que deja criterios sin puntuar no vale; los índices desde 0 se entienden', () => {
    const rubric = [{ text: 'A', points: 1 }, { text: 'B', points: 1 }, { text: 'C', points: 1 }]
    expect(parseOpenReview('{"criteria":[{"index":1,"points":1}],"feedback":"ok"}', rubric)).toBeUndefined()
    expect(parseOpenReview('{"criteria":[{"index":0,"points":1},{"index":1,"points":0},{"index":2,"points":0.5}]}', rubric)?.criteria.map((c) => c.points)).toEqual([1, 0, 0.5])
    expect(parseOpenReview('{"criteria":[{"index":1,"points":1},{"index":2,"points":0},{"index":3,"points":0.5}]}', rubric)?.criteria.map((c) => c.points)).toEqual([1, 0, 0.5])
  })
})

describe('minutos de hoy', () => {
  it('Inicio y el resumen del curso los muestran en minutos enteros', async () => {
    const { courseOverview, homeSummary } = await import('./index')
    const { makePack, decodeProgress } = await import('@shared/schema')
    const now = new Date(2026, 9, 26, 18)
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const pack = makePack({ id: 'p', title: 'P' })
    const progress = decodeProgress({ days: [{ day: key, minutes: 0.016666666666666666, attempts: 1, correct: 1 }] })
    expect(courseOverview(pack, [], progress, now).minutesToday).toBe(0)
    const home = homeSummary([{ pack, skills: [] }], { p: progress }, [], { name: '', aiReady: true }, now)
    expect(home.today.minutesDone).toBe(0)
    const more = decodeProgress({ days: [{ day: key, minutes: 12.6, attempts: 1, correct: 1 }] })
    expect(courseOverview(pack, [], more, now).minutesToday).toBe(13)
  })
})
