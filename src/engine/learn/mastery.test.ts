// Dominio Beta con olvido (de MasteryTests.swift).
import { describe, expect, it } from 'vitest'
import {
  ATTEMPT_MODES, attempt as outcome, attemptFromRating, freshMastery, MASTERY_LEVELS, masteryLevelLabel, masteryLevelOrder, MasteryModel,
  skillMastery, skillMasteryFromJSON, skillMasteryToJSON, type AttemptMode, type SkillMastery
} from './mastery'
import { DISTANT_FUTURE, DISTANT_PAST } from '@engine/calendar/time'
import { INT_MAX, INT_MIN } from './support'
import { DAY, plus, t0, TestRNG } from './testSupport.testutil'

const model = new MasteryModel()

interface Opts { difficulty?: number; hints?: number; mode?: AttemptMode; seconds?: number | null; expected?: number | null; at?: Date; model?: MasteryModel }
function attempt(m: SkillMastery, credit: number, o: Opts = {}): SkillMastery {
  return (o.model ?? model).updated(m, outcome(credit, { difficulty: o.difficulty ?? 2, hintsUsed: o.hints ?? 0, mode: o.mode ?? 'practice',
    seconds: o.seconds ?? null, expectedSeconds: o.expected ?? null }), o.at ?? t0)
}
const p = (m: SkillMastery, at: Date = t0) => model.probability(m, at)
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThanOrEqual(tol)
const fresh = freshMastery

describe('Mastery · estado inicial y un intento', () => {
  it('estado fresco', () => {
    const m = fresh()
    expect(m.alpha).toBe(1); expect(m.beta).toBe(1); expect(m.attempts).toBe(0); expect(m.streak).toBe(0)
    expect(m.lastPracticed).toBeNull(); expect(m.lastCorrect).toBeNull()
    expect(model.level(m, t0)).toBe('unseen')
    near(model.probability(m, t0), 0.5, 1e-15)
    expect(model.confidence(m)).toBe(0)
    near(model.probability(m, plus(t0, 1000 * DAY)), 0.5, 1e-15)
  })

  it('un acierto', () => {
    const m = attempt(fresh(), 1)
    near(m.alpha, 2, 1e-12); near(m.beta, 1, 1e-12)
    expect(m.attempts).toBe(1); expect(m.streak).toBe(1)
    expect(m.lastPracticed).toEqual(t0); expect(m.lastCorrect).toEqual(t0)
    near(p(m), 2 / 3, 1e-12)
    near(model.confidence(m), 1 - Math.exp(-1 / 5), 1e-12)
    expect(model.level(m, t0)).toBe('practicing')
  })

  it('un fallo', () => {
    const m = attempt(fresh(), 0)
    near(m.alpha, 1, 1e-12); near(m.beta, 2, 1e-12)
    expect(m.attempts).toBe(1); expect(m.streak).toBe(0)
    expect(m.lastPracticed).toEqual(t0); expect(m.lastCorrect).toBeNull()
    near(p(m), 1 / 3, 1e-12)
    expect(model.level(m, t0)).toBe('learning')
  })

  it('no muta la entrada', () => {
    const m0 = fresh()
    attempt(m0, 1)
    expect(m0).toEqual(fresh())
  })

  it('cinco aciertos: valor exacto', () => {
    let e = 0
    for (let i = 0; i < 5; i++) e = 0.95 * e + 1
    near(e, 4.52438125, 1e-12)
    let m = fresh()
    for (let i = 0; i < 5; i++) m = attempt(m, 1)
    near(m.alpha, 1 + e, 1e-9); near(m.beta, 1, 1e-12)
    const plain = new MasteryModel(21, 1)
    let q = fresh()
    for (let i = 0; i < 5; i++) q = plain.updated(q, outcome(1), t0)
    near(q.alpha, 6, 1e-12)
  })
})

describe('Mastery · monotonía y ponderaciones', () => {
  it('acierto sube y fallo baja', () => {
    const starts: SkillMastery[] = [fresh(), attempt(fresh(), 1), attempt(fresh(), 0)]
    let m = fresh()
    for (let i = 0; i < 12; i++) { m = attempt(m, i % 3 === 0 ? 0 : 1); starts.push(m) }
    for (const start of starts) for (const mode of ATTEMPT_MODES) for (const d of [1, 2, 3]) for (const hints of [0, 1, 3]) {
      const before = p(start)
      const up = attempt(start, 1, { difficulty: d, hints, mode })
      const down = attempt(start, 0, { difficulty: d, hints, mode })
      if (hints === 0) expect(p(up)).toBeGreaterThan(before)
      expect(p(down)).toBeLessThan(before)
      expect(p(up)).toBeGreaterThan(p(down))
    }
  })

  it('crédito parcial entre fallo y acierto', () => {
    const start = attempt(attempt(fresh(), 1), 1)
    const values = [0, 0.25, 0.5, 0.75, 1].map((c) => p(attempt(start, c)))
    for (let i = 1; i < values.length; i++) expect(values[i - 1]).toBeLessThan(values[i])
  })

  it('aciertos repetidos nunca bajan', () => {
    let m = fresh()
    let last = p(m)
    for (let i = 0; i < 80; i++) { m = attempt(m, 1); const c = p(m); expect(c).toBeGreaterThan(last); expect(c).toBeLessThan(1); last = c }
    let w = fresh()
    last = p(w)
    for (let i = 0; i < 80; i++) { w = attempt(w, 0); const c = p(w); expect(c).toBeLessThan(last); expect(c).toBeGreaterThan(0); last = c }
  })

  it('pesos por dificultad', () => {
    const start = attempt(attempt(fresh(), 1), 0)
    const right = [1, 2, 3].map((d) => p(attempt(start, 1, { difficulty: d })))
    expect(right[0]).toBeLessThan(right[1]); expect(right[1]).toBeLessThan(right[2])
    const wrong = [1, 2, 3].map((d) => p(attempt(start, 0, { difficulty: d })))
    expect(wrong[0]).toBeLessThan(wrong[1]); expect(wrong[1]).toBeLessThan(wrong[2])
    near(attempt(fresh(), 1, { difficulty: 1 }).alpha, 1.6, 1e-12)
    near(attempt(fresh(), 1, { difficulty: 3 }).alpha, 2.5, 1e-12)
    near(attempt(fresh(), 0, { difficulty: 1 }).beta, 2.4, 1e-12)
    near(attempt(fresh(), 0, { difficulty: 3 }).beta, 1.7, 1e-12)
  })

  it('dificultad fuera de rango se acota', () => {
    expect(attempt(fresh(), 1, { difficulty: 0 })).toEqual(attempt(fresh(), 1, { difficulty: 1 }))
    expect(attempt(fresh(), 1, { difficulty: -7 })).toEqual(attempt(fresh(), 1, { difficulty: 1 }))
    expect(attempt(fresh(), 1, { difficulty: 9 })).toEqual(attempt(fresh(), 1, { difficulty: 3 }))
    expect(attempt(fresh(), 0, { difficulty: INT_MAX })).toEqual(attempt(fresh(), 0, { difficulty: 3 }))
    expect(attempt(fresh(), 0, { difficulty: INT_MIN })).toEqual(attempt(fresh(), 0, { difficulty: 1 }))
  })

  it('las pistas reducen el crédito', () => {
    const start = attempt(attempt(fresh(), 1), 1)
    const values = [0, 1, 2, 3, 4].map((h) => p(attempt(start, 1, { hints: h })))
    for (let i = 1; i < values.length; i++) expect(values[i - 1]).toBeGreaterThan(values[i])
    const one = attempt(fresh(), 1, { hints: 1 })
    near(one.alpha, 1.75, 1e-12); near(one.beta, 1.25, 1e-12)
    expect(attempt(fresh(), 0, { hints: 5 })).toEqual(attempt(fresh(), 0, { hints: 0 }))
    expect(attempt(fresh(), 1, { hints: -3 })).toEqual(attempt(fresh(), 1, { hints: 0 }))
    expect(Number.isFinite(attempt(fresh(), 1, { hints: INT_MAX }).alpha)).toBe(true)
    expect(attempt(attempt(fresh(), 1), 1, { hints: 3 }).streak).toBe(0)
    expect(attempt(attempt(fresh(), 1), 1, { hints: 1 }).streak).toBe(2)
    expect(attempt(fresh(), 1, { hints: 50 })).toEqual(attempt(fresh(), 1, { hints: 20 }))
    expect(attempt(fresh(), 1, { hints: 21 })).toEqual(attempt(fresh(), 1, { hints: 20 }))
    expect(attempt(fresh(), 1, { hints: 19 })).not.toEqual(attempt(fresh(), 1, { hints: 20 }))
  })

  it('pesos por modo', () => {
    const start = attempt(attempt(fresh(), 1), 1)
    const order: AttemptMode[] = ['lesson', 'review', 'practice', 'diagnostic', 'exam']
    const right = order.map((mode) => p(attempt(start, 1, { mode })))
    for (let i = 1; i < right.length; i++) expect(right[i - 1]).toBeLessThan(right[i])
    const wrong = order.map((mode) => p(attempt(start, 0, { mode })))
    for (let i = 1; i < wrong.length; i++) expect(wrong[i - 1]).toBeGreaterThan(wrong[i])
    near(attempt(fresh(), 1, { mode: 'exam' }).alpha - 1, 1.5, 1e-12)
    near(attempt(fresh(), 1, { mode: 'lesson' }).alpha - 1, 0.5, 1e-12)
  })

  it('las respuestas lentas valen menos', () => {
    const base = attempt(fresh(), 1)
    expect(attempt(fresh(), 1, { seconds: 60, expected: 60 })).toEqual(base)
    expect(attempt(fresh(), 1, { seconds: 90, expected: 60 })).toEqual(base)
    const slow = attempt(fresh(), 1, { seconds: 150, expected: 60 })
    const verySlow = attempt(fresh(), 1, { seconds: 240, expected: 60 })
    expect(p(slow)).toBeLessThan(p(base)); expect(p(verySlow)).toBeLessThan(p(slow))
    near(verySlow.alpha, 1.7, 1e-12); near(verySlow.beta, 1.3, 1e-12)
    expect(attempt(fresh(), 1, { seconds: 100_000, expected: 60 })).toEqual(verySlow)
    expect(attempt(fresh(), 1, { seconds: 5, expected: 60 })).toEqual(base)
  })

  it('tiempos incompletos o inválidos se ignoran', () => {
    const base = attempt(fresh(), 1)
    for (const [s, e] of [[500, null], [null, 60], [-10, 60], [100, 0], [NaN, 60], [Infinity, 60], [100, Infinity]] as [number | null, number | null][]) {
      expect(attempt(fresh(), 1, { seconds: s, expected: e })).toEqual(base)
    }
    expect(attempt(fresh(), 0, { seconds: 1000, expected: 10 })).toEqual(attempt(fresh(), 0))
  })

  it('créditos hostiles', () => {
    expect(attempt(fresh(), NaN)).toEqual(attempt(fresh(), 0))
    expect(attempt(fresh(), -4)).toEqual(attempt(fresh(), 0))
    expect(attempt(fresh(), 7)).toEqual(attempt(fresh(), 1))
    expect(attempt(fresh(), Infinity)).toEqual(attempt(fresh(), 1))
    expect(attempt(fresh(), -Infinity)).toEqual(attempt(fresh(), 0))
  })
})

describe('Mastery · rachas, olvido y niveles', () => {
  it('racha y último acierto', () => {
    let m = fresh()
    m = attempt(m, 1, { at: t0 })
    m = attempt(m, 1, { at: plus(t0, 10) })
    m = attempt(m, 0.5, { at: plus(t0, 20) })
    expect(m.streak).toBe(3)
    expect(m.lastCorrect).toEqual(plus(t0, 20))
    m = attempt(m, 0.49, { at: plus(t0, 30) })
    expect(m.streak).toBe(0)
    expect(m.lastCorrect).toEqual(plus(t0, 20))
    expect(m.lastPracticed).toEqual(plus(t0, 30))
    expect(m.attempts).toBe(4)
    m = attempt(m, 1, { at: plus(t0, 40) })
    expect(m.streak).toBe(1)
  })

  it('un intento con fecha atrasada no retrocede las marcas', () => {
    const later = attempt(fresh(), 1, { at: plus(t0, 10 * DAY) })
    const back = attempt(later, 1, { at: t0 })
    expect(back.lastPracticed).toEqual(later.lastPracticed)
    expect(back.lastCorrect).toEqual(later.lastCorrect)
    near(model.probability(later, t0), model.probability(later, later.lastPracticed as Date), 1e-15)
  })

  it('la evidencia se reduce a la mitad cada semivida', () => {
    let m = fresh()
    for (let i = 0; i < 10; i++) m = attempt(m, 1)
    const d0 = model.decayed(m, t0), d21 = model.decayed(m, plus(t0, 21 * DAY)), d42 = model.decayed(m, plus(t0, 42 * DAY))
    near(d21.alpha - 1, (d0.alpha - 1) / 2, 1e-9)
    near(d42.alpha - 1, (d0.alpha - 1) / 4, 1e-9)
    near(d21.beta, 1, 1e-12)
    near(new MasteryModel(7).decayed(m, plus(t0, 7 * DAY)).alpha - 1, (d0.alpha - 1) / 2, 1e-9)
  })

  it('la probabilidad decae hacia la media inicial', () => {
    let strong = fresh(), weak = fresh()
    for (let i = 0; i < 12; i++) { strong = attempt(strong, 1); weak = attempt(weak, 0) }
    let lastS = p(strong), lastW = p(weak)
    expect(lastS).toBeGreaterThan(0.9); expect(lastW).toBeLessThan(0.15)
    for (const days of [1, 7, 21, 60, 200, 1000]) {
      const now = plus(t0, days * DAY)
      const s = p(strong, now), w = p(weak, now)
      expect(s).toBeLessThan(lastS); expect(s).toBeGreaterThan(0.5)
      expect(w).toBeGreaterThan(lastW); expect(w).toBeLessThan(0.5)
      lastS = s; lastW = w
    }
    near(p(strong, plus(t0, 5000 * DAY)), 0.5, 1e-6)
  })

  it('los niveles bajan con el tiempo', () => {
    let m = fresh()
    for (let i = 0; i < 12; i++) m = attempt(m, 1)
    expect(model.level(m, t0)).toBe('mastered')
    expect(model.level(m, plus(t0, 21 * DAY))).toBe('solid')
    expect(model.level(m, plus(t0, 60 * DAY))).toBe('practicing')
    expect(model.level(m, plus(t0, 120 * DAY))).toBe('learning')
    expect(model.level(m, plus(t0, 3000 * DAY))).toBe('learning')
  })

  it('tras un descanso largo un intento mueve más', () => {
    let m = fresh()
    for (let i = 0; i < 12; i++) m = attempt(m, 1)
    const immediate = attempt(m, 0, { at: t0 })
    const later = plus(t0, 90 * DAY)
    const afterBreak = attempt(m, 0, { at: later })
    expect(model.probability(m, later) - p(afterBreak, later)).toBeGreaterThan(p(m) - p(immediate))
    expect(model.confidence(immediate)).toBeGreaterThan(0)
  })

  it('lo reciente pesa más que los fallos antiguos', () => {
    let m = fresh()
    for (let i = 0; i < 15; i++) m = attempt(m, 0)
    for (let i = 0; i < 15; i++) m = attempt(m, 1)
    expect(p(m)).toBeGreaterThan(0.6)
    const flat = new MasteryModel(21, 1)
    let q = fresh()
    for (let i = 0; i < 15; i++) q = flat.updated(q, outcome(0), t0)
    for (let i = 0; i < 15; i++) q = flat.updated(q, outcome(1), t0)
    near(flat.probability(q, t0), 0.5, 1e-12)
    expect(p(m)).toBeGreaterThan(flat.probability(q, t0) + 0.1)
  })

  it('confianza creciente y acotada', () => {
    let m = fresh()
    let last = model.confidence(m)
    expect(last).toBe(0)
    for (let i = 0; i < 200; i++) { m = attempt(m, 1); const c = model.confidence(m); expect(c).toBeGreaterThanOrEqual(last); expect(c).toBeLessThan(1); last = c }
    expect(last).toBeGreaterThan(0.98)
    expect(model.confidence(attempt(fresh(), 0))).toBeGreaterThan(0)
    expect(model.confidence(skillMastery({ alpha: NaN, beta: NaN }))).toBe(0)
  })

  it('progresión de niveles con aciertos seguidos', () => {
    let m = fresh()
    const levels: string[] = []
    for (let i = 0; i < 12; i++) { m = attempt(m, 1); levels.push(model.level(m, t0)) }
    expect(levels[0]).toBe('practicing'); expect(levels[1]).toBe('practicing'); expect(levels[2]).toBe('practicing')
    expect(levels[3]).toBe('solid'); expect(levels[8]).toBe('solid'); expect(levels[9]).toBe('mastered'); expect(levels[11]).toBe('mastered')
    for (let i = 1; i < levels.length; i++) expect(masteryLevelOrder(levels[i - 1] as never)).toBeLessThanOrEqual(masteryLevelOrder(levels[i] as never))
  })

  it('niveles con fallos', () => {
    let m = fresh()
    for (let i = 0; i < 3; i++) m = attempt(m, 0)
    expect(model.level(m, t0)).toBe('learning')
    expect(p(m)).toBeLessThan(0.3)
    let mixed = fresh()
    for (let i = 0; i < 20; i++) mixed = attempt(mixed, i % 2 === 0 ? 1 : 0)
    expect(model.level(mixed, t0)).toBe('learning')
    let good = fresh()
    for (let i = 0; i < 30; i++) good = attempt(good, i % 5 === 4 ? 0 : 1)
    expect(['practicing', 'solid']).toContain(model.level(good, t0))
  })

  it('orden y etiquetas de los niveles', () => {
    expect(MASTERY_LEVELS).toEqual(['unseen', 'learning', 'practicing', 'solid', 'mastered'])
    expect(MASTERY_LEVELS.map((l) => masteryLevelLabel(l))).toEqual(['Sin ver', 'Aprendiendo', 'Practicando', 'Sólido', 'Dominado'])
    expect(MASTERY_LEVELS.map((l) => masteryLevelLabel(l, { lang: 'en' }))).toEqual(['Unseen', 'Learning', 'Practicing', 'Solid', 'Mastered'])
  })
})

describe('Mastery · intervalos, robustez y fórmula exacta', () => {
  it('el intervalo contiene la media y se estrecha', () => {
    let m = fresh()
    let lastWidth = 2
    for (let i = 0; i < 25; i++) {
      m = attempt(m, 1)
      const ci = model.credibleInterval(m, t0)
      const mean = p(m)
      expect(ci.low).toBeLessThanOrEqual(mean); expect(ci.high).toBeGreaterThanOrEqual(mean)
      expect(ci.low >= 0 && ci.high <= 1).toBe(true)
      expect(ci.high - ci.low).toBeLessThan(lastWidth + 1e-12)
      lastWidth = ci.high - ci.low
    }
    const wide = model.credibleInterval(fresh(), t0, 0.95), narrow = model.credibleInterval(fresh(), t0, 0.5)
    expect(wide.low).toBeLessThan(narrow.low); expect(wide.high).toBeGreaterThan(narrow.high)
    const uniform = model.credibleInterval(fresh(), t0)
    near(uniform.low, 0.1, 1e-9); near(uniform.high, 0.9, 1e-9)
  })

  it('estados corruptos se reparan', () => {
    const nan = skillMastery({ alpha: NaN, beta: Infinity, attempts: -4, lastPracticed: t0, streak: -2 })
    const out = attempt(nan, 1)
    expect(Number.isFinite(out.alpha) && Number.isFinite(out.beta)).toBe(true)
    expect(out.alpha).toBeGreaterThan(0); expect(out.beta).toBeGreaterThan(0)
    expect(p(nan) >= 0 && p(nan) <= 1).toBe(true)
    const negative = skillMastery({ alpha: -5, beta: 0, attempts: 3 })
    expect(p(negative) >= 0 && p(negative) <= 1).toBe(true)
    expect(attempt(negative, 0).alpha).toBeGreaterThan(0)
    const huge = skillMastery({ alpha: 1e300, beta: 1e300, attempts: INT_MAX, lastPracticed: t0, lastCorrect: t0, streak: INT_MAX })
    const outHuge = attempt(huge, 1)
    expect(outHuge.attempts).toBe(INT_MAX); expect(outHuge.streak).toBe(INT_MAX)
    expect(Number.isFinite(p(outHuge))).toBe(true)
    expect(Number.isFinite(model.confidence(huge))).toBe(true)
  })

  it('saneado de los parámetros del modelo', () => {
    expect(new MasteryModel(0).halfLifeDays).toBe(21); expect(new MasteryModel(-3).halfLifeDays).toBe(21)
    expect(new MasteryModel(NaN).halfLifeDays).toBe(21); expect(new MasteryModel(Infinity).halfLifeDays).toBe(21)
    expect(new MasteryModel(10).halfLifeDays).toBe(10)
    expect(new MasteryModel(21, 0.1).attemptRetention).toBe(0.5); expect(new MasteryModel(21, 7).attemptRetention).toBe(1)
    expect(new MasteryModel(21, NaN).attemptRetention).toBe(0.95); expect(new MasteryModel().halfLifeDays).toBe(21)
  })

  it('saltos de tiempo astronómicos', () => {
    const m = attempt(fresh(), 1)
    near(model.probability(m, DISTANT_FUTURE), 0.5, 1e-12)
    near(model.probability(m, DISTANT_PAST), model.probability(m, t0), 1e-12)
    expect(Number.isFinite(attempt(m, 1, { at: DISTANT_FUTURE }).alpha)).toBe(true)
  })

  it('JSON como la app Swift', () => {
    let m = fresh()
    for (let i = 0; i < 7; i++) m = attempt(m, i === 3 ? 0 : 1, { at: plus(t0, i * DAY) })
    expect(skillMasteryFromJSON(JSON.parse(JSON.stringify(skillMasteryToJSON(m))))).toEqual(m)
    expect(skillMasteryFromJSON({})).toEqual(fresh())
    const partial = skillMasteryFromJSON({ alpha: 4, beta: 2, attempts: 5 })
    expect(partial.alpha).toBe(4); expect(partial.attempts).toBe(5); expect(partial.lastPracticed).toBeNull()
    expect('lastPracticed' in skillMasteryToJSON(fresh())).toBe(false)
  })

  it('calificación de tarjeta → intento', () => {
    expect(attemptFromRating(1).credit).toBe(0); expect(attemptFromRating(2).credit).toBe(0.6)
    expect(attemptFromRating(3).credit).toBe(1); expect(attemptFromRating(4).credit).toBe(1)
    const o = attemptFromRating(3, 12, 10)
    expect(o.mode).toBe('review'); expect(o.difficulty).toBe(2); expect(o.hintsUsed).toBe(0); expect(o.seconds).toBe(12); expect(o.expectedSeconds).toBe(10)
    expect(model.updated(fresh(), attemptFromRating(2), t0).streak).toBe(1)
  })

  it('un estudiante simulado converge a su nivel real', () => {
    for (const [truth, lo, hi] of [[0.9, 0.8, 0.97], [0.8, 0.7, 0.9], [0.5, 0.38, 0.62], [0.2, 0.08, 0.32]]) {
      const rng = new TestRNG(Math.trunc(truth * 1000))
      let m = fresh()
      let now = t0
      const finals: number[] = []
      for (let i = 0; i < 300; i++) {
        m = attempt(m, rng.unit() < truth ? 1 : 0, { at: now })
        now = plus(now, DAY / 2)
        if (i >= 200) finals.push(model.probability(m, now))
      }
      const avg = finals.reduce((a, b) => a + b, 0) / finals.length
      expect(avg).toBeGreaterThan(lo); expect(avg).toBeLessThan(hi)
    }
  })

  it('sigue a un estudiante que mejora', () => {
    const finals: number[] = []
    for (let seed = 1; seed <= 30; seed++) {
      const rng = new TestRNG(BigInt(seed) * 7919n)
      let m = fresh()
      let now = t0
      for (let i = 0; i < 120; i++) {
        m = attempt(m, rng.unit() < (i < 60 ? 0.3 : 0.9) ? 1 : 0, { at: now })
        now = plus(now, DAY)
      }
      finals.push(model.probability(m, now))
    }
    const mean = finals.reduce((a, b) => a + b, 0) / finals.length
    expect(mean).toBeGreaterThan(0.72); expect(mean).toBeLessThan(0.93)
    expect(Math.min(...finals)).toBeGreaterThan(0.45)
  })

  it('fórmula de actualización exacta', () => {
    const start = skillMastery({ alpha: 3, beta: 2, attempts: 4, lastPracticed: t0, lastCorrect: t0, streak: 2 })
    const modes: [AttemptMode, number][] = [['lesson', 0.5], ['practice', 1.0], ['review', 0.8], ['diagnostic', 1.25], ['exam', 1.5]]
    const success: Record<number, number> = { 1: 0.6, 2: 1.0, 3: 1.5 }
    const failure: Record<number, number> = { 1: 1.4, 2: 1.0, 3: 0.7 }
    for (const [mode, base] of modes) for (const d of [1, 2, 3]) for (const credit of [0, 0.25, 0.5, 1]) {
      const out = attempt(start, credit, { difficulty: d, mode })
      const retained = Math.pow(0.95, base)
      near(out.alpha, 1 + retained * 2 + base * success[d] * credit, 1e-12)
      near(out.beta, 1 + retained * 1 + base * failure[d] * (1 - credit), 1e-12)
    }
  })

  it('olvido y después intento, exacto', () => {
    const start = skillMastery({ alpha: 3, beta: 2, attempts: 4, lastPracticed: t0, lastCorrect: t0, streak: 2 })
    const later = plus(t0, 21 * DAY)
    const out = attempt(start, 1, { at: later })
    near(out.alpha, 1 + 0.95 * 1 + 1, 1e-12); near(out.beta, 1 + 0.95 * 0.5, 1e-12)
    expect(out.lastPracticed).toEqual(later)
    const out7 = attempt(start, 0, { at: plus(t0, 14 * DAY), model: new MasteryModel(7) })
    near(out7.alpha, 1 + 0.95 * 0.5, 1e-12); near(out7.beta, 1 + 0.95 * 0.25 + 1, 1e-12)
  })
})
