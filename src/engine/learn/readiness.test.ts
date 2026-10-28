// Preparación para el examen (de ReadinessTests.swift).
import { describe, expect, it } from 'vitest'
import { attempt as outcome, ATTEMPT_MODES, freshMastery, MasteryModel, skillMastery, type SkillMastery } from './mastery'
import { ReadinessEstimator, type Readiness, type ReadinessEntry } from './readiness'
import { DAY, plus, t0, TestRNG } from './testSupport.testutil'

const model = new MasteryModel()
const entry = (id: string, w: number, m: SkillMastery): ReadinessEntry => ({ weight: { skillID: id, weight: w }, mastery: m })
function practiced(correct: number, wrong = 0, at: Date = t0): SkillMastery {
  let m = freshMastery()
  for (let i = 0; i < wrong; i++) m = model.updated(m, outcome(0), at)
  for (let i = 0; i < correct; i++) m = model.updated(m, outcome(1), at)
  return m
}
const estimate = (skills: ReadinessEntry[], at: Date = t0): Readiness => ReadinessEstimator.estimate(skills, model, at)
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThanOrEqual(tol)
const fresh = freshMastery

describe('Readiness · sin datos', () => {
  it('vacío e inválidos', () => {
    const empty = estimate([])
    expect(empty).toEqual({ expectedScore: 0, low: 0, high: 0, coverage: 0, label: 'Aún sin datos', labelKey: 'noData', weakest: [] })
    const junk = estimate([entry('a', 0, fresh()), entry('b', -3, practiced(5)), entry('c', NaN, fresh()), entry('d', Infinity, fresh())])
    expect(junk).toEqual(empty)
  })

  it('todo sin ver', () => {
    const r = estimate([entry('a', 10, fresh()), entry('b', 20, fresh()), entry('c', 30, fresh())])
    near(r.expectedScore, 0.1, 1e-12)
    expect(r.coverage).toBe(0)
    expect(r.label).toBe('Aún sin datos')
    expect(r.low).toBeLessThan(r.expectedScore); expect(r.high).toBeGreaterThan(r.expectedScore)
    expect(r.high - r.low).toBeGreaterThan(0.1)
    expect(r.weakest).toEqual(['c', 'b', 'a'])
  })

  it('lo no visto se penaliza', () => {
    expect(estimate([entry('a', 1, fresh())]).expectedScore).toBeLessThan(0.2)
    expect(estimate([entry('a', 1, practiced(1, 1))]).expectedScore).toBeGreaterThan(0.4)
  })
})

describe('Readiness · mezclas', () => {
  it('una sola habilidad = su posterior', () => {
    const m = practiced(10)
    const r = estimate([entry('a', 7, m)])
    near(r.expectedScore, model.probability(m, t0), 1e-12)
    const ci = model.credibleInterval(m, t0)
    near(r.low, ci.low, 1e-6); near(r.high, ci.high, 1e-6)
    expect(r.coverage).toBe(1); expect(r.label).toBe('Listo'); expect(r.weakest).toEqual([])
  })

  it('un intento da un intervalo ancho', () => {
    const one = estimate([entry('a', 1, practiced(1))])
    near(one.expectedScore, 2 / 3, 1e-12)
    expect(one.high - one.low).toBeGreaterThan(0.4)
    const many = estimate([entry('a', 1, practiced(12, 6))])
    expect(many.high - many.low).toBeLessThan(one.high - one.low)
  })

  it('media ponderada', () => {
    const a = practiced(8), b = practiced(1, 4)
    const r = estimate([entry('a', 60, a), entry('b', 40, b)])
    near(r.expectedScore, 0.6 * model.probability(a, t0) + 0.4 * model.probability(b, t0), 1e-12)
    expect(r.coverage).toBe(1); expect(r.weakest).toEqual(['b'])
  })

  it('invariante a la escala de los pesos y al orden', () => {
    const skills = [entry('a', 3, practiced(5)), entry('b', 1, practiced(2, 3)), entry('c', 2, fresh())]
    const base = estimate(skills)
    const scaled = estimate(skills.map((s) => entry(s.weight.skillID, s.weight.weight * 37.5, s.mastery)))
    near(base.expectedScore, scaled.expectedScore, 1e-12); near(base.low, scaled.low, 1e-9); near(base.high, scaled.high, 1e-9)
    near(base.coverage, scaled.coverage, 1e-12); expect(base.weakest).toEqual(scaled.weakest)
    const rng = new TestRNG(5)
    const nine = Array.from({ length: 9 }, (_, i) => entry(`s${i}`, i + 1, practiced(rng.int(10), rng.int(6))))
    const x = estimate(nine), y = estimate([...nine].reverse())
    near(x.expectedScore, y.expectedScore, 1e-12); near(x.low, y.low, 1e-9); near(x.high, y.high, 1e-9); expect(x.weakest).toEqual(y.weakest)
  })

  it('cobertura ponderada', () => {
    near(estimate([entry('a', 30, practiced(4)), entry('b', 10, fresh())]).coverage, 0.75, 1e-12)
    near(estimate([entry('a', 1, practiced(4)), entry('b', 1, fresh())]).coverage, 0.5, 1e-12)
  })

  it('umbrales de las etiquetas', () => {
    const l = (e: number, c: number) => ReadinessEstimator.label(e, c)
    expect(l(0.9, 0)).toBe('Aún sin datos'); expect(l(0.9, 0.39)).toBe('Recién empezando'); expect(l(0.2, 0.4)).toBe('Te falta bastante')
    expect(l(0.39, 1)).toBe('Te falta bastante'); expect(l(0.4, 1)).toBe('En camino'); expect(l(0.59, 1)).toBe('En camino')
    expect(l(0.6, 1)).toBe('Vas bien'); expect(l(0.74, 1)).toBe('Vas bien'); expect(l(0.75, 1)).toBe('Casi listo')
    expect(l(0.84, 1)).toBe('Casi listo'); expect(l(0.85, 1)).toBe('Listo'); expect(l(0.99, 0.9)).toBe('Listo'); expect(l(0.99, 0.89)).toBe('Casi listo')
    expect(ReadinessEstimator.label(0.99, 1, { lang: 'en' })).toBe('Ready')
  })

  it('las etiquetas nunca retroceden al mejorar', () => {
    const labels = [0, 1, 2, 4, 8, 14].map((k) => estimate([entry('a', 1, practiced(k, k === 0 ? 0 : 1))]).label)
    expect(labels[0]).toBe('Aún sin datos')
    const order = ['Aún sin datos', 'Recién empezando', 'Te falta bastante', 'En camino', 'Vas bien', 'Casi listo', 'Listo']
    const ranks = labels.map((x) => order.indexOf(x))
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]).toBeLessThanOrEqual(ranks[i])
    expect(ranks[ranks.length - 1]).toBeGreaterThanOrEqual(4)
  })
})

describe('Readiness · monotonía, olvido y las más flojas', () => {
  it('acierto sube, fallo baja', () => {
    const base = [entry('a', 5, practiced(3, 2)), entry('b', 5, practiced(6))]
    const r0 = estimate(base)
    const up = [{ ...base[0], mastery: model.updated(base[0].mastery, outcome(1), t0) }, base[1]]
    const down = [{ ...base[0], mastery: model.updated(base[0].mastery, outcome(0), t0) }, base[1]]
    expect(estimate(up).expectedScore).toBeGreaterThan(r0.expectedScore)
    expect(estimate(down).expectedScore).toBeLessThan(r0.expectedScore)
  })

  it('añadir una no vista baja la nota', () => {
    const seen = [entry('a', 10, practiced(10))]
    const withUnseen = [...seen, entry('z', 10, fresh())]
    expect(estimate(withUnseen).expectedScore).toBeLessThan(estimate(seen).expectedScore)
    near(estimate(withUnseen).coverage, 0.5, 1e-12)
  })

  it('evidencia vieja baja la nota pero no la cobertura', () => {
    const skills = [entry('a', 1, practiced(10)), entry('b', 1, practiced(9, 1))]
    const now = estimate(skills), later = estimate(skills, plus(t0, 60 * DAY))
    expect(later.expectedScore).toBeLessThan(now.expectedScore)
    expect(later.coverage).toBe(now.coverage)
    expect(later.high - later.low).toBeGreaterThan(now.high - now.low)
  })

  it('más evidencia, intervalo más estrecho', () => {
    let lastWidth = 2
    for (const n of [1, 3, 6, 12, 24]) {
      const r = estimate([entry('a', 1, practiced(n * 3, n)), entry('b', 1, practiced(n * 3, n))])
      expect(r.high - r.low).toBeLessThan(lastWidth)
      lastWidth = r.high - r.low
    }
  })

  it('orden y filtro de las más flojas', () => {
    const r = estimate([entry('strong', 50, practiced(12)), entry('weakBig', 30, practiced(0, 4)), entry('weakSmall', 5, practiced(0, 4)),
      entry('mid', 20, practiced(3, 3)), entry('unseen', 10, fresh())])
    expect(r.weakest).toEqual(['weakBig', 'mid', 'unseen', 'weakSmall'])
  })

  it('como mucho cinco y sin repetidos; empates por peso y por id', () => {
    expect(estimate(Array.from({ length: 12 }, (_, i) => entry(`s${i}`, 12 - i, fresh()))).weakest).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(estimate([entry('x', 5, fresh()), entry('x', 4, fresh()), entry('y', 1, fresh())]).weakest).toEqual(['x', 'y'])
    expect(estimate([entry('b', 1, fresh()), entry('a', 1, fresh()), entry('c', 1, fresh())]).weakest).toEqual(['a', 'b', 'c'])
    const a = skillMastery({ alpha: 2, beta: 8, attempts: 5 }), b = skillMastery({ alpha: 8, beta: 8, attempts: 5 })
    expect(estimate([entry('A', 10, a), entry('B', 16, b)]).weakest).toEqual(['B', 'A'])
    expect(estimate([entry('B', 16, b), entry('A', 10, a)]).weakest).toEqual(['B', 'A'])
    const c = skillMastery({ alpha: 5, beta: 5, attempts: 5 })
    expect(estimate([entry('z', 4, c), entry('m', 4, c)]).weakest).toEqual(['m', 'z'])
  })

  it('invariantes con entradas aleatorias', () => {
    const rng = new TestRNG(0xabcdef)
    for (let i = 0; i < 600; i++) {
      const n = 1 + rng.int(12)
      const skills: ReadinessEntry[] = []
      for (let j = 0; j < n; j++) {
        let m = fresh()
        let when = t0
        for (let k = 0, c = rng.int(15); k < c; k++) {
          m = model.updated(m, outcome(rng.unit() < 0.6 ? 1 : 0, { difficulty: 1 + rng.int(3), hintsUsed: rng.int(3), mode: rng.pick(ATTEMPT_MODES) }), when)
          when = plus(when, rng.double(0, 5) * DAY)
        }
        skills.push(entry(`k${j}`, rng.unit() < 0.1 ? 0 : rng.double(0.1, 40), m))
      }
      const r = estimate(skills, plus(t0, rng.double(0, 90) * DAY))
      expect(r.expectedScore >= 0 && r.expectedScore <= 1).toBe(true)
      expect(r.low).toBeLessThanOrEqual(r.expectedScore + 1e-12); expect(r.high).toBeGreaterThanOrEqual(r.expectedScore - 1e-12)
      expect(r.low >= 0 && r.high <= 1).toBe(true)
      expect(r.coverage >= 0 && r.coverage <= 1).toBe(true)
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.weakest.length).toBeLessThanOrEqual(5)
      expect(new Set(r.weakest).size).toBe(r.weakest.length)
    }
  })
})

describe('Readiness · calibración Monte Carlo', () => {
  const normal = (g: TestRNG) => Math.sqrt(-2 * Math.log(Math.max(g.unit(), 1e-12))) * Math.cos(2 * Math.PI * g.unit())
  const gamma = (shape: number, g: TestRNG): number => {
    if (shape < 1) return gamma(shape + 1, g) * Math.pow(Math.max(g.unit(), 1e-300), 1 / shape)
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d)
    for (;;) {
      let x = 0, v = 0
      do { x = normal(g); v = 1 + c * x } while (v <= 0)
      v = v * v * v
      const u = g.unit()
      if (u < 1 - 0.0331 * x * x * x * x) return d * v
      if (Math.log(Math.max(u, 1e-300)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
    }
  }
  const beta = (a: number, b: number, g: TestRNG) => { const x = gamma(a, g), y = gamma(b, g); return x / (x + y) }
  const params = (s: ReadinessEntry) => {
    if (s.mastery.attempts === 0) return [ReadinessEstimator.unseenAlpha, ReadinessEstimator.unseenBeta]
    const d = model.decayed(s.mastery, t0)
    return [d.alpha, d.beta]
  }

  it('el intervalo cubre ≈ 80 %', () => {
    const cases: { name: string; skills: ReadinessEntry[]; tolerance: number }[] = [
      { name: 'una', skills: [entry('a', 1, practiced(6, 3))], tolerance: 0.012 },
      { name: 'tres iguales', skills: [entry('a', 1, practiced(4, 2)), entry('b', 1, practiced(7, 1)), entry('c', 1, practiced(2, 4))], tolerance: 0.03 },
      { name: 'ponderadas con no vistas', skills: [entry('a', 40, practiced(9, 1)), entry('b', 25, practiced(3, 3)), entry('c', 20, fresh()), entry('d', 15, practiced(1, 5))], tolerance: 0.035 },
      { name: 'muchas', skills: Array.from({ length: 10 }, (_, i) => entry(`k${i}`, i + 1, practiced(i, 3))), tolerance: 0.03 }
    ]
    for (const c of cases) {
      const r = estimate(c.skills)
      const total = c.skills.reduce((s, x) => s + x.weight.weight, 0)
      const rng = new TestRNG(0x5eed)
      const samples = 20_000
      let inside = 0
      for (let i = 0; i < samples; i++) {
        let score = 0
        for (const s of c.skills) { const [a, b] = params(s); score += (s.weight.weight / total) * beta(a, b, rng) }
        if (score >= r.low && score <= r.high) inside += 1
      }
      expect(Math.abs(inside / samples - 0.8), c.name).toBeLessThanOrEqual(c.tolerance)
    }
  })

  it('la media Monte Carlo coincide', () => {
    const skills = [entry('a', 30, practiced(5, 2)), entry('b', 70, practiced(1, 6)), entry('c', 20, fresh())]
    const r = estimate(skills)
    const rng = new TestRNG(77)
    let sum = 0
    const n = 20_000
    for (let i = 0; i < n; i++) {
      let score = 0
      for (const s of skills) { const [a, b] = params(s); score += (s.weight.weight / 120) * beta(a, b, rng) }
      sum += score
    }
    near(sum / n, r.expectedScore, 0.004)
  })

  it('pesos basura junto a válidos y pesos enormes o diminutos', () => {
    const m = practiced(6, 1)
    const base = estimate([entry('a', 10, m)])
    const withJunk = estimate([entry('a', 10, m), entry('neg', -5, practiced(20)), entry('zero', 0, fresh()), entry('nan', NaN, practiced(20)), entry('inf', Infinity, practiced(20))])
    expect(withJunk).toEqual(base)
    const small = estimate([entry('a', 1, m), entry('b', 3, fresh())])
    for (const other of [estimate([entry('a', 0.5e308, m), entry('b', 1.5e308, fresh())]), estimate([entry('a', 1e-300, m), entry('b', 3e-300, fresh())])]) {
      near(other.expectedScore, small.expectedScore, 1e-12); near(other.low, small.low, 1e-9); near(other.high, small.high, 1e-9)
      near(other.coverage, small.coverage, 1e-12); expect(other.weakest).toEqual(small.weakest); expect(other.label).toBe(small.label)
    }
    near(estimate([entry('a', Number.MAX_VALUE, m)]).expectedScore, estimate([entry('a', 1, m)]).expectedScore, 1e-12)
  })
})
