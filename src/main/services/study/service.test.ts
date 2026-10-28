// El servicio de estudio con el curso de demostración real (resources/demo-course, «Exam #2 · MATH 101»), copiado a una
// carpeta temporal. Port de Tests/StudyEngineTests/DemoCourseFixtureTests.swift más las vistas (Inicio, curso, estadísticas)
// y las escrituras del progreso (intentos, tarjetas, tiempo, más ejercicios, simulacros, corrección abierta).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { makeExercise, orderedSkills, type Exercise, type Pack, type Skill } from '@shared/schema'
import type { HomeEvent } from '@shared/ipc/home'
import { STATS_WINDOW_DAYS } from '@shared/ipc/stats'
import { ContentValidator } from '@engine/content'
import { canonicalInput, grade, Input, type AnswerInput } from '@engine/grading'
import { Recorder } from '@engine/study'
import { setDataRoot } from '../paths'
import { Library, type PackStore } from '../store'
import { AIError } from '../ai'
import { MockChatModel, step } from '../ai/testing/mocks'
import { setStudyLibrary } from './courses'
import { setOpenGraderModel } from './open-grader'
import * as study from './service'

const PACK = 'exam-2-math112'
const DAY = 86_400_000
const fixture = fileURLToPath(new URL('../../../../resources/demo-course', import.meta.url))

let root = ''
let store: PackStore
let pack: Pack
let skills: Skill[] = []
let events: HomeEvent[] = []

/** La fecha local «AAAA-MM-DD» (la de las estadísticas). */
const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function keyOf(e: Exercise): AnswerInput | undefined {
  if (e.answer.kind === 'multi') {
    const parts = e.answer.parts.map((p) => canonicalInput(p.answer))
    return parts.every((p): p is AnswerInput => p !== undefined) ? Input.parts(parts) : undefined
  }
  return canonicalInput(e.answer)
}

beforeAll(() => {
  // una copia: la biblioteca escribe cerrojos y progreso, y el curso versionado no se toca
  root = mkdtempSync(join(tmpdir(), 'aula-demo-course-'))
  cpSync(fixture, root, { recursive: true })
  setDataRoot(root)
  const lib = new Library(root, { recordsHistory: false })
  expect(lib.packIDs()).toEqual([PACK])
  setStudyLibrary(lib)
  study.setStudySources({ events: async () => events, aiReady: async () => false })
  store = lib.openPack(PACK)!
  pack = store.loadPack()
  skills = store.loadSkills(orderedSkills(pack).map((s) => s.id))
})

afterAll(() => {
  setStudyLibrary(null)
  setOpenGraderModel(null)
  study.setStudySources({ events: null, aiReady: null })
  rmSync(root, { recursive: true, force: true })
})

describe('el curso de demostración', () => {
  it('se carga completo y valida sin errores', () => {
    expect(pack.language).toBe('en')
    expect(skills.length).toBe(pack.skills.length)
    expect(skills.length).toBeGreaterThanOrEqual(6)
    const v = ContentValidator.withMath()
    const ids = new Set<string>()
    for (const s of skills) {
      expect(s.exercises.length, s.id).toBeGreaterThanOrEqual(10)
      for (const e of [...s.exercises.map((x) => x.id), ...s.templates.map((x) => x.id)]) { expect(ids.has(e), e).toBe(false); ids.add(e) }
      const issues = v.checkSkill(s, pack)
      expect(issues.filter((i) => i.severity === 'error').map((i) => `${s.id} ${i.path}: ${i.message}`)).toEqual([])
      expect(issues.filter((i) => i.message.includes('error típico')).map((i) => `${s.id} ${i.path}: ${i.message}`)).toEqual([])
    }
  })

  it('cada ejercicio acepta su clave y reconoce sus errores típicos', () => {
    for (const s of skills) {
      for (const e of s.exercises) {
        const key = keyOf(e)
        expect(key, `${e.id} no se corrige solo`).toBeDefined()
        expect(grade(e, key!).status, `${e.id} no acepta su propia clave`).toBe('correct')
        if (['numeric', 'point', 'set', 'interval', 'expression', 'short'].includes(e.answer.kind)) {
          expect(e.wrongs.length, `${e.id} sin errores típicos`).toBeGreaterThan(0)
          for (const w of e.wrongs) {
            const r = grade(e, Input.text(w.input))
            expect(r.status, `${e.id}: «${w.input}» pasa por buena`).not.toBe('correct')
            expect(r.matchedWrong?.why, `${e.id}: «${w.input}» no se reconoce`).toBe(w.why)
          }
        } else if (e.answer.kind === 'choice') {
          expect(e.answer.options.some((o) => !o.correct && !!o.why), `${e.id}: ninguna opción incorrecta explica por qué`).toBe(true)
        }
      }
    }
  })

  it('«cos 210°» reconoce el error del signo', () => {
    const skill = skills.find((s) => s.id === 'exact-trig-values')!
    const e = skill.exercises.find((x) => x.id === 'etv-e5')!
    expect(e.prompt.some((b) => b.type === 'text' && b.md.includes('\\cos 210^\\circ'))).toBe(true)
    expect(e.level).toBe(1)
    for (const ok of ['-√3/2', '-sqrt(3)/2', '−√3/2', '-(√3)/2']) expect(grade(e, Input.text(ok)).status, ok).toBe('correct')
    for (const typo of ['√3/2', 'sqrt(3)/2']) {
      const r = grade(e, Input.text(typo))
      expect(r.status, typo).toBe('incorrect')
      const why = r.matchedWrong?.why ?? ''
      expect(why).toContain('wrong sign')
      expect(why).toContain('Quadrant III')
      expect(r.feedback[0]?.markdown).toBe(why)
    }
    const quiz = skill.exercises.filter((x) => x.answer.kind === 'numeric' || x.answer.kind === 'choice')
    expect(grade(quiz[0], Input.text('1/2')).status).toBe('correct')
  })
})

describe('servicio de estudio', () => {
  const now = new Date()
  const ago = (days: number): Date => new Date(now.getTime() - days * DAY)

  it('la vista del curso sin progreso', () => {
    const o = study.overview(PACK, now)
    expect(o.id).toBe(PACK)
    expect(o.readiness).toBe(0)
    expect(o.label).toBe('notStarted')
    expect(o.attempts).toBe(0)
    expect(o.skills.length).toBe(skills.length)
    expect(o.plan.length).toBeGreaterThan(0)
    expect(o.plan.every((p) => p.courseId === PACK && p.minutes > 0)).toBe(true)
    expect(o.minutesGoal).toBeGreaterThan(0)
  })

  it('guarda intentos (también de días anteriores), errores, tarjetas y tiempo', () => {
    const s = skills[0]
    // tres semanas: aciertos con algún fallo
    let last = study.recordAttempt({ packId: PACK, skillId: s.id, exerciseId: s.exercises[0].id, result: { credit: 1, status: 'correct' }, seconds: 40, mode: 'practice' }, ago(20))
    for (const [i, e] of skills[1].exercises.slice(0, 4).entries()) {
      last = study.recordAttempt({ packId: PACK, skillId: skills[1].id, exerciseId: e.id, result: { credit: i === 2 ? 0 : 1, status: i === 2 ? 'incorrect' : 'correct' }, seconds: 30, mode: 'practice' }, ago(10))
    }
    for (const e of s.exercises.slice(1, 6)) {
      last = study.recordAttempt({ packId: PACK, skillId: s.id, exerciseId: e.id, result: { credit: 1, status: 'correct' }, seconds: 25, mode: 'practice', input: '42' }, now)
    }
    const wrong = study.recordAttempt({
      packId: PACK, skillId: s.id, exerciseId: s.exercises[6].id, mode: 'practice', input: Input.text('x'),
      result: { credit: 0, status: 'incorrect', feedback: [{ kind: 'error', markdown: 'Check the quadrant.' }] }
    }, now)
    expect(last.skillAttempts).toBe(6)
    expect(wrong.skillAttempts).toBe(7)
    expect(wrong.mastery).toBeGreaterThan(0)
    expect(wrong.streak).toBeGreaterThanOrEqual(1)
    const p = store.loadProgress()
    expect(p.attempts.length).toBe(11)
    const m = p.mistakes.find((x) => x.exerciseID === s.exercises[6].id)!
    expect(m.why).toBe('Check the quadrant.')
    expect(m.lastInput).toBe('x')
    // el fallo de hace 10 días ya toca repasarlo
    expect(wrong.mistakes).toBeGreaterThanOrEqual(1)
    // tarjetas y tiempo
    const card = s.cards[0]
    const r = study.reviewCard({ packId: PACK, cardId: card.id, rating: 3, seconds: 8 }, now)
    expect(r.skillId).toBe(s.id)
    expect(store.loadProgress().cards[card.id]?.reps).toBe(1)
    expect(study.recordTime(PACK, 600, now).minutesToday).toBeGreaterThanOrEqual(10)
    expect(() => study.recordAttempt({ packId: PACK, skillId: 'nope', exerciseId: 'x', result: { credit: 1 } }, now)).toThrow(/habilidad/)
    expect(() => study.reviewCard({ packId: 'nope', cardId: card.id, rating: 3 }, now)).toThrow()
  })

  it('la vista del curso y el resumen de Inicio con lo estudiado', async () => {
    const o = study.overview(PACK, now)
    expect(o.attempts).toBe(11)
    expect(o.accuracy).toBeGreaterThan(0.5)
    expect(o.readiness).toBeGreaterThan(0)
    expect(o.readinessLow).toBeLessThanOrEqual(o.readiness)
    expect(o.readinessHigh).toBeGreaterThanOrEqual(o.readiness)
    expect(o.label).not.toBe('notStarted')
    expect(o.minutesToday).toBeGreaterThanOrEqual(10)
    const first = o.skills.find((x) => x.id === skills[0].id)!
    expect(first.seen).toBe(true)
    expect(first.mastery).toBeGreaterThan(0)
    expect(o.skills.find((x) => x.id === skills.at(-1)!.id)?.seen).toBe(false)

    const examDay = new Date(now.getTime() + 9 * DAY)
    events = [
      { id: 'ev-exam', title: 'Exam #2', start: examDay.toISOString(), kind: 'exam', courseId: PACK },
      { id: 'ev-class', title: 'Lecture', start: new Date(now.getTime() + DAY).toISOString(), kind: 'class', courseId: PACK },
      { id: 'ev-far', title: 'Final', start: new Date(now.getTime() + 60 * DAY).toISOString(), kind: 'event' }
    ]
    const h = await study.summary(now)
    expect(h.aiReady).toBe(false)
    expect(h.courses.map((c) => c.id)).toEqual([PACK])
    expect(h.courses[0].skillCount).toBe(pack.skills.length)
    expect(h.courses[0].readiness).toBeCloseTo(o.readiness, 6)
    expect(h.exams.map((x) => [x.courseId, x.title])).toEqual([[PACK, 'Exam #2']])
    expect(h.upcoming.map((e) => e.id)).toEqual(['ev-class', 'ev-exam'])
    expect(h.today.minutesDone).toBeGreaterThanOrEqual(10)
    expect(h.today.minutesGoal).toBeGreaterThan(0)
    // hecho hoy: la práctica del primer tema y una sesión de tarjetas; el total suma lo que queda del plan
    expect(h.today.itemsDone).toBe(2)
    expect(h.today.itemsTotal).toBe(h.today.itemsDone + h.plan.length)
    expect(h.streak.days).toBeGreaterThanOrEqual(1)
    expect(h.streak.week.length).toBe(7)
    expect(h.plan.length).toBeGreaterThan(0)
    expect(h.plan.every((p) => p.courseId === PACK && p.courseTitle === pack.title)).toBe(true)
    expect(h.mistakes).toBe(o.mistakes)
    expect(h.dueCards).toBe(o.dueCards)
    events = []
  })

  it('las estadísticas: 84 días, temas, niveles y la nota estimada día a día', () => {
    const st = study.stats(now)
    expect(st.today).toBe(localDay(now))
    expect(st.courses.length).toBe(1)
    const c = st.courses[0]
    expect(c.days.length).toBe(STATS_WINDOW_DAYS)
    expect(c.days[0].date).toBe(st.start)
    expect(c.days.at(-1)?.date).toBe(st.today)
    expect(c.days.at(-1)?.attempts).toBe(6)
    expect(c.days.find((d) => d.date === localDay(ago(10)))?.attempts).toBe(4)
    expect(c.days.find((d) => d.date === localDay(ago(10)))?.correct).toBe(3)
    expect(c.days.reduce((s, d) => s + d.attempts, 0)).toBe(11)
    const topic = c.topics.find((t) => t.skillId === skills[1].id)!
    expect(topic.attempts).toBe(4)
    expect(topic.accuracy).toBeCloseTo(0.75, 6)
    expect(topic.id).toBe(`${PACK}/${skills[1].id}`)
    // niveles: el último punto es hoy y cuenta todos los temas
    expect(c.levels.at(-1)?.date).toBe(st.today)
    for (const l of c.levels) expect(Object.values(l.counts).reduce((s, n) => s + n, 0)).toBe(c.skillCount)
    expect(c.levels.at(-1)!.counts.unseen).toBeLessThan(c.skillCount)
    expect(c.levels[0].counts.unseen).toBe(c.skillCount)
    // nota estimada: cada día desde el primer intento (como StatsData.compute de Swift), el último es hoy
    expect(c.history[0].date).toBe(localDay(ago(20)))
    expect(c.history.at(-1)?.date).toBe(st.today)
    expect(c.history.length).toBe(c.days.length - c.days.findIndex((d) => d.date === localDay(ago(20))))
    for (const x of c.history) expect(x.low <= x.expected && x.expected <= x.high).toBe(true)
    expect(c.expected).not.toBeNull()
  })

  it('pedir más ejercicios deja la petición en runs/', () => {
    const s = skills[0]
    const r = study.prepareMore({ packId: PACK, skillId: s.id }, now)
    expect(existsSync(r.file)).toBe(true)
    expect(r.file.startsWith(store.runsDirectory)).toBe(true)
    const saved = JSON.parse(readFileSync(r.file, 'utf8')) as { kind: string; instruction: string }
    expect(saved.kind).toBe('practice-request')
    expect(saved.instruction).toBe(r.instruction)
    expect(r.instruction.length).toBeGreaterThan(20)
  })

  it('un simulacro: se empieza, se guarda en curso, se entrega y se informa', () => {
    const plan = study.startExam(PACK, now)!
    expect(plan.run.items.length).toBeGreaterThan(0)
    expect(store.loadProgress().examRun?.id).toBe(plan.run.id)
    const inputs: Record<string, AnswerInput> = {}
    for (const it of plan.run.items) { const k = keyOf(plan.exercises[it.exerciseID]); if (k) inputs[it.exerciseID] = k }
    expect(() => study.submitExam({ packId: PACK, runId: 'otro', inputs }, now)).toThrow()
    const res = study.submitExam({ packId: PACK, runId: plan.run.id, inputs, activeSeconds: 610 }, new Date(now.getTime() + 20 * 60_000))
    // la duración es el tiempo activo que manda la interfaz, no los 20 min de reloj
    expect(res.result.durationSeconds).toBe(610)
    expect(res.report.percent).toBeGreaterThan(0.99)
    expect(Object.values(res.grades).every((g) => g.status === 'correct')).toBe(true)
    const p = store.loadProgress()
    expect(p.examRun).toBeUndefined()
    expect(p.exams.length).toBe(1)
    expect(p.attempts.filter((a) => a.mode === 'exam').length).toBe(plan.run.items.length)
  })

  it('la corrección abierta: sin IA pide autoevaluarse; con IA corrige por la rúbrica', async () => {
    const essay = makeExercise({
      id: 'essay-1', skill: skills[0].id, prompt: [{ id: 'p', type: 'text', md: 'Explain what a reference angle is.' }],
      answer: { kind: 'open', modelAnswer: 'The acute angle to the x-axis.', rubric: [{ text: 'Acute angle', points: 1 }, { text: 'Measured to the x-axis', points: 1 }] }
    })
    setOpenGraderModel(async () => { throw new AIError('missingKey', 'No AI configured') })
    await expect(study.gradeOpen({ packId: PACK, skillId: skills[0].id, exerciseId: essay.id, exercise: essay, answer: 'It is acute.' })).rejects.toMatchObject({ code: 'needs_ai' })
    const model = new MockChatModel([step({ text: 'Here: {"criteria":[{"index":1,"points":1,"comment":"Good."},{"index":2,"points":0,"comment":"Which axis?"}],"missing":["the x-axis"],"feedback":"Almost."}' })])
    setOpenGraderModel(async () => model)
    const r = await study.gradeOpen({ packId: PACK, skillId: skills[0].id, exerciseId: essay.id, exercise: essay, answer: 'It is acute.' })
    expect(r.review.criteria.map((c) => c.points)).toEqual([1, 0])
    expect(r.grade.status).toBe('partial')
    expect(r.grade.credit).toBeCloseTo(0.5, 9)
    expect(r.provider).toContain('Mock')
    expect(model.callCount).toBe(1)
    await expect(study.gradeOpen({ packId: PACK, skillId: skills[0].id, exerciseId: essay.id, exercise: essay, answer: '   ' })).rejects.toMatchObject({ code: 'invalid_args' })
    setOpenGraderModel(null)
  })

  it('el día local de las estadísticas es el mismo que el del progreso', () => {
    expect(Recorder.dayKey(now)).toBe(localDay(now))
  })
})
