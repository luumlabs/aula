// Port de Tests/StudyEngineTests/LearnBridgeTests.swift y GuidedLearnBridgeTests.swift (con el curso de ejemplo de funciones).
import { describe, expect, it } from 'vitest'
import { emptyProgress, makeExercise, makePack, makeSkill, makeSkillProgress, type ItemID, type Pack, type Skill, type StudyProgress } from '@shared/schema'
import { functionsCourse } from '@main/services/store/samples'
import { Rating } from '@engine/learn'
import { correct, numeric, text, tryIt } from './testutil'
import { LearningController } from './learning'
import { LearnBridge } from './bridge'
import { Recorder } from './recorder'
import { CardReview } from './cards'

const DAY = 86_400_000
const t0 = new Date(1_800_000_000_000)
const at = (ms: number): Date => new Date(t0.getTime() + ms)

function sample(): [Pack, Record<ItemID, Skill>] {
  const [pack, skills] = functionsCourse(t0)
  return [pack, Object.fromEntries(skills.map((s) => [s.id, s]))]
}

describe('Recorder', () => {
  it('registrar sube el dominio y llena el cuaderno de errores', () => {
    const [, skills] = sample()
    const ex = skills.parabola.exercises[0]
    let p = emptyProgress()
    expect(Recorder.mastery(p.skills.parabola, t0)).toBeUndefined()
    for (let i = 0; i < 4; i++) p = Recorder.record(p, ex, { credit: 1, seconds: 20, mode: 'practice' }, at(i * 60_000))
    const good = Recorder.mastery(p.skills.parabola, at(300_000))!
    expect(good).toBeGreaterThan(0.6)
    expect(p.skills.parabola.attempts).toBe(4)
    expect(p.skills.parabola.streak).toBe(4)
    expect(p.mistakes).toEqual([])
    // un fallo baja el dominio y entra al cuaderno, con repaso mañana
    p = Recorder.record(p, ex, { credit: 0, seconds: 20, mode: 'practice', input: 'x=3', why: 'Signo' }, at(400_000))
    expect(Recorder.mastery(p.skills.parabola, at(401_000))!).toBeLessThan(good)
    const m = p.mistakes[0]
    expect(m.lastInput).toBe('x=3')
    expect(m.why).toBe('Signo')
    expect(Math.abs(Date.parse(m.due) - at(400_000).getTime() - DAY)).toBeLessThan(1000)
    expect(Recorder.dueMistakes(p, at(400_000))).toEqual([])
    expect(Recorder.dueMistakes(p, at(400_000 + DAY + 1000)).length).toBe(1)
    // acertarlo 5 veces espaciadas lo resuelve
    let t = at(400_000 + DAY + 1000)
    for (let i = 0; i < 5; i++) { p = Recorder.record(p, ex, { credit: 1, seconds: 20, mode: 'review' }, t); t = new Date(t.getTime() + 40 * DAY) }
    expect(p.mistakes[0].resolved).toBe(true)
    // el olvido: sin practicar, el dominio decae
    expect(Recorder.mastery(p.skills.parabola, new Date(t.getTime() + 120 * DAY))!).toBeLessThan(Recorder.mastery(p.skills.parabola, t)!)
  })

  it('créditos y tiempos absurdos no rompen el progreso', () => {
    const [, skills] = sample()
    const ex = skills.parabola.exercises[0]
    const p = Recorder.record(emptyProgress(), ex, { credit: Number.NaN, seconds: Number.POSITIVE_INFINITY, hints: -3 }, t0)
    expect(p.attempts[0].credit).toBe(0)
    expect(p.attempts[0].seconds).toBeUndefined()
    expect(p.attempts[0].hints).toBe(0)
    expect(Number.isFinite(p.skills.parabola.alpha)).toBe(true)
    // sin habilidad: cuenta para el día pero no crea dominio ni error fantasma
    const orphan = Recorder.record(emptyProgress(), { ...ex, skill: '' }, { credit: 0 }, t0)
    expect(orphan.skills).toEqual({})
    expect(orphan.mistakes).toEqual([])
    expect(orphan.days[0].attempts).toBe(1)
  })
})

describe('CardReview', () => {
  it('cola de tarjetas, FSRS y huecos', () => {
    const [pack, skills] = sample()
    let p = emptyProgress()
    let q = CardReview.queue(pack, skills, p, { now: t0 })
    expect(q.length).toBeGreaterThan(0)
    expect(q.every((c) => c.isNew)).toBe(true)
    expect(q.length).toBeLessThanOrEqual(8)
    expect(CardReview.queue(pack, skills, p, { now: t0, includeNew: false })).toEqual([])
    const first = q[0]
    const pv = CardReview.preview(p.cards[first.card.id], t0)
    expect(Object.keys(pv).length).toBe(4)
    expect(pv[Rating.again]).toContain('min')
    expect(pv[Rating.good]).not.toBe(pv[Rating.again])
    p = CardReview.rate(p, first.card.id, Rating.good, t0, { skillId: first.skillId, seconds: 6 })
    expect(p.cards[first.card.id].reps).toBe(1)
    expect(p.skills[first.skillId]?.attempts).toBe(0)
    expect(p.skills[first.skillId]?.alpha ?? 0).toBeGreaterThan(1)
    q = CardReview.queue(pack, skills, p, { now: t0 })
    expect(q.some((c) => c.card.id === first.card.id)).toBe(false)
    p = CardReview.rate(p, q[0].card.id, Rating.again, t0, { skills })
    expect(Date.parse(p.cards[q[0].card.id].due) - t0.getTime()).toBeLessThan(3_600_000)
    const far = at(60 * DAY)
    expect(CardReview.queue(pack, skills, p, { now: far, includeNew: false }).some((c) => c.card.id === first.card.id)).toBe(true)
    expect(CardReview.clozeText('La derivada de $x^2$ es {{c1::$2x$}}.', false)).toBe('La derivada de $x^2$ es **[…]**.')
    expect(CardReview.clozeText('La derivada de $x^2$ es {{c1::$2x$}}.', true)).toBe('La derivada de $x^2$ es **$2x$**.')
    expect(CardReview.clozeText('{{c1::A::pista}} y {{c2::B}}', false)).toBe('**[…]** y **[…]**')
    expect(CardReview.clozeText('{{c1}} … ::', false)).toBe('{{c1}} … ::')
  })

  it('las tarjetas solas no llevan el dominio más allá del 70 %', () => {
    const [pack, skills] = sample()
    let p = emptyProgress()
    const cards = CardReview.queue(pack, skills, p, { now: t0, newLimit: 100 }).filter((c) => c.skillId === 'parabola')
    let t = t0
    for (let k = 0; k < 13; k++) for (const c of cards) { p = CardReview.rate(p, c.card.id, Rating.good, t, { skillId: c.skillId }); t = new Date(t.getTime() + 60_000) }
    const sp = p.skills.parabola
    expect(sp.attempts).toBe(0)
    expect(sp.alpha / (sp.alpha + sp.beta)).toBeLessThanOrEqual(0.7 + 1e-9)
  })
})

describe('LearnBridge', () => {
  it('plan y nota estimada', () => {
    const [pack, skills] = sample()
    const empty = emptyProgress()
    expect(LearnBridge.readiness(pack, empty, t0).label).toBe('Aún sin datos')
    const plan = LearnBridge.dailyPlan(pack, skills, empty, 45, t0)
    expect(plan.length).toBeGreaterThan(0)
    expect(plan.reduce((s, i) => s + i.minutes, 0)).toBeLessThanOrEqual(45)
    expect(plan.some((i) => i.kind === 'diagnostic' || i.kind === 'learn')).toBe(true)
    let p = emptyProgress()
    for (const sk of Object.values(skills)) for (const e of sk.exercises.slice(0, 6)) p = Recorder.record(p, e, { credit: 1, seconds: 30, mode: 'practice' }, t0)
    const r = LearnBridge.readiness(pack, p, t0)
    expect(r.expectedScore).toBeGreaterThan(0.5)
    expect(r.coverage).toBeGreaterThan(0.9)
    expect(LearnBridge.level(p.skills.parabola, t0)).not.toBe('unseen')
  })
})

describe('LearnBridge con el examen ya pasado', () => {
  it('planifica como un curso a tu ritmo, sin hablar de un examen que ya fue', () => {
    const [pack, skills] = sample()
    const progress = emptyProgress()
    const past: Pack = { ...pack, exam: { title: 'Parcial', date: at(-7 * DAY).toISOString() } }
    const own: Pack = { ...pack, exam: undefined, selfPaced: true }
    const plan = LearnBridge.dailyPlan(past, skills, progress, 45, t0, 'es')
    expect(plan.length).toBeGreaterThan(0)
    expect(plan).toEqual(LearnBridge.dailyPlan(own, skills, progress, 45, t0, 'es'))
    expect(JSON.stringify(plan)).not.toMatch(/del examen/)
  })
})

describe('LearnBridge en modo guiado', () => {
  function course(): [Pack, Record<string, Skill>] {
    const lesson = [text('# Suma\nSumar añade unidades.', 'topic'), tryIt(['one', 'two'])]
    const questions = [makeExercise({ id: 'one', skill: 'a', prompt: [text('1 + 2')], answer: numeric('3') }), makeExercise({ id: 'two', skill: 'a', prompt: [text('2 + 2')], answer: numeric('4') })]
    const a = makeSkill({ id: 'a', title: 'Primera', lesson, exercises: questions })
    const b: Skill = { ...a, id: 'b', title: 'Segunda', exercises: questions.map((e) => ({ ...e, skill: 'b' })) }
    const pack = makePack({ id: 'course', title: 'Course', subject: 'Math' })
    pack.skills = [
      { id: 'b', title: 'Segunda', weight: 90, order: 1, objectives: [], prerequisites: [], minutes: 20, status: 'ready', counts: { lessonBlocks: 2, exercises: 2, templates: 0, cards: 0, decks: 0 } },
      { id: 'a', title: 'Primera', weight: 10, order: 0, objectives: [], prerequisites: [], minutes: 20, status: 'ready', counts: { lessonBlocks: 2, exercises: 2, templates: 0, cards: 0, decks: 0 } }
    ]
    return [pack, { a, b }]
  }

  it('el plan guiado enseña la primera lección aunque la siguiente valga más o la vieja esté leída', () => {
    const [pack, skills] = course()
    const p: StudyProgress = { ...emptyProgress(), skills: { a: makeSkillProgress({ alpha: 100, beta: 1, attempts: 99, lessonDone: true }) } }
    const plan = LearnBridge.dailyPlan(pack, skills, p, 60, t0)
    expect(plan.filter((i) => i.kind === 'learn').map((i) => i.skillID)).toEqual(['a'])
    expect(plan.some((i) => i.kind === 'diagnostic' || i.skillID === 'b')).toBe(false)
  })

  it('una comprobación pendiente vuelve a su lección y dos aciertos abren la siguiente', () => {
    const [pack, skills] = course()
    const skill = skills.a
    const concept = LearningController.concepts(skill)[0]
    let saved = LearningController.acknowledgeExplanation(concept, skill, undefined).progress
    let progress: StudyProgress = { ...emptyProgress(), skills: { a: saved } }
    expect(LearnBridge.dailyPlan(pack, skills, progress, 60, t0)[0]?.kind).toBe('learn')
    for (let k = 0; k < 2; k++) {
      const q = LearningController.prepareCheck(concept, skill, saved)
      const r = LearningController.recordCheck(concept, skill, q.exercise!, correct, { hints: 0, revealed: false }, q.progress)
      progress = { ...progress, skills: { ...progress.skills, a: r.progress } }
      progress = Recorder.record(progress, q.exercise!, { credit: 1, mode: 'lesson' }, t0)
      saved = progress.skills.a
    }
    expect(LearnBridge.probability(progress.skills.a, t0)!).toBeLessThan(0.9)
    const next = LearnBridge.dailyPlan(pack, skills, progress, 60, t0)
    expect(next.filter((i) => i.kind === 'learn').map((i) => i.skillID)).toEqual(['b'])
    expect(next.some((i) => i.skillID === 'a' && i.kind === 'learn')).toBe(false)
  })

  it('leer y explorar no crean evidencia guiada', () => {
    const [pack, skills] = course()
    for (const mode of ['reading', 'explore'] as const) {
      const p: StudyProgress = { ...emptyProgress(), settings: { ...emptyProgress().settings, lessonMode: mode }, skills: { a: makeSkillProgress({ alpha: 4, beta: 1, attempts: 3, lessonDone: true }) } }
      expect(LearningController.isMastered(skills.a, p.skills.a)).toBe(false)
      const items = LearnBridge.dailyPlan(pack, skills, p, 60, t0)
      expect(items.find((i) => i.skillID === 'a')?.kind).toBe('practice')
      expect(p.skills.a.learning).toEqual({})
    }
  })
})
