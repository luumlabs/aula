// Vectores de la implementación de referencia de FSRS-4.5 (ts-fsrs 3.5.7, py-fsrs 2.5.1 y salidas generadas con py-fsrs).
import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, defaultFSRSParameters, FSRS, FSRS_WEIGHT_COUNT, isValidFSRSParameters, newReviewState, RATINGS, type Rating, type ReviewState } from './fsrs'
import { scenarios, table, weightSets, type GoldenOutcome, type GoldenScenario } from './fsrsGolden.testdata'
import { close, date, DAY, plus, pyWeights, ratingOf, scheduledDays, t0, tsWeights } from './testSupport.testutil'

const fsrs = (weights: number[], retention = 0.9, maxDays = 36_500) => new FSRS({ weights, requestRetention: retention, maximumIntervalDays: maxDays })

describe('FSRS · constantes y especificación', () => {
  it('pesos por defecto oficiales', () => {
    expect([...DEFAULT_WEIGHTS]).toEqual([0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755])
    expect(DEFAULT_WEIGHTS.length).toBe(FSRS_WEIGHT_COUNT)
    expect(defaultFSRSParameters().weights).toEqual([...DEFAULT_WEIGHTS])
  })

  it('valores por defecto del contrato', () => {
    const p = defaultFSRSParameters()
    expect(p.requestRetention).toBe(0.9)
    expect(p.maximumIntervalDays).toBe(365)
    expect(p.enableShortTerm).toBe(true)
    expect(p.learningSteps).toEqual([60, 600])
    expect(p.relearningSteps).toEqual([600])
    expect(isValidFSRSParameters(p)).toBe(true)
  })

  it('factor y decay; R(S, S) = 90 %', () => {
    expect(FSRS.decay).toBe(-0.5)
    expect(close(FSRS.factor, 19 / 81, 1e-15)).toBe(true)
    expect(close(FSRS.factor, Math.pow(0.9, 1 / FSRS.decay) - 1, 1e-12)).toBe(true)
    for (const s of [0.1, 1, 7.5, 100, 3650]) expect(close(FSRS.retrievability(s, s), 0.9, 1e-12)).toBe(true)
  })
})

describe('FSRS · ts-fsrs algorithm.test.ts', () => {
  it('curva del olvido', () => {
    const dt = [0, 1, 2, 3, 4, 5], s = [1, 2, 3, 4, 4, 2]
    const expected = [1.0, 0.946059, 0.9299294, 0.92216794, 0.9, 0.79394596]
    dt.forEach((t, i) => expect(FSRS.retrievability(t, s[i])).toBeCloseTo(expected[i], 8))
  })

  it('estabilidad y dificultad iniciales', () => {
    const f = fsrs(tsWeights)
    for (const g of RATINGS) {
      expect(f.initialStability(g)).toBe(tsWeights[g - 1])
      expect(Math.abs(f.initialDifficulty(g) - Math.min(Math.max(tsWeights[4] - (g - 3) * tsWeights[5], 1), 10))).toBeLessThan(1e-12)
    }
    const py = fsrs(pyWeights)
    const d = RATINGS.map((g) => py.initialDifficulty(g))
    ;[8.4348, 6.8686, 5.3024, 3.7362].forEach((v, i) => expect(Math.abs(d[i] - v)).toBeLessThan(1e-12))
  })

  it('la estabilidad inicial tiene suelo', () => {
    const w = [...DEFAULT_WEIGHTS]
    w[0] = 0
    w[1] = -3
    const f = new FSRS({ weights: w })
    expect(f.initialStability(1)).toBe(0.1)
    expect(f.initialStability(2)).toBe(0.1)
  })

  it('dificultad siguiente', () => {
    const f = fsrs(tsWeights)
    const expected = [6.66816418, 5.83669392, 5.00522366, 4.1737534]
    RATINGS.forEach((g, i) => expect(Math.abs(f.nextDifficulty(5.0, g) - expected[i])).toBeLessThan(1e-7))
  })

  it('estabilidad siguiente', () => {
    const f = fsrs(tsWeights)
    const s = 5.0, d = [1, 2, 3, 4], r = [0.9, 0.8, 0.7, 0.6]
    const recall = [26.98093855, 14.12848781, 63.60068241, 208.72742276]
    const forget = [1.9016012, 2.0777825, 2.3257503, 2.62916465]
    RATINGS.forEach((g, i) => {
      expect(Math.abs(f.recallStability(d[i], s, r[i], g) - recall[i])).toBeLessThan(1e-6)
      expect(Math.abs(f.forgetStability(d[i], s, r[i]) - forget[i])).toBeLessThan(1e-6)
    })
  })

  it('modificador de intervalo según la retención', () => {
    const expected = [422, 102, 43, 22, 13, 8, 4, 2, 1, 1]
    const got: number[] = []
    for (let i = 1; i <= 10; i++) {
      const m = FSRS.intervalModifierFor(i / 10)
      got.push(Math.trunc(Math.min(Math.max(1, Math.round(1.0 * m)), 36_500)))
    }
    expect(got).toEqual(expected)
    expect(close(FSRS.intervalModifierFor(0.9), 1.0, 1e-12)).toBe(true)
  })
})

describe('FSRS · secuencia estándar', () => {
  it('historia de intervalos', () => {
    const f = fsrs(pyWeights)
    const ratings: Rating[] = [3, 3, 3, 3, 3, 3, 1, 1, 3, 3, 3, 3, 3]
    let st: ReviewState = newReviewState(t0)
    let now = t0
    const history: number[] = []
    const phases: string[] = []
    for (const r of ratings) {
      st = f.next(st, r, now)
      history.push(scheduledDays(st))
      phases.push(st.phase)
      now = st.due
    }
    expect(history).toEqual([0, 5, 16, 43, 106, 236, 0, 0, 12, 25, 47, 85, 147])
    expect(phases).toEqual(['learning', 'review', 'review', 'review', 'review', 'review', 'relearning', 'relearning', 'review', 'review', 'review', 'review', 'review'])
  })

  it('primer repaso como la referencia', () => {
    const f = fsrs(pyWeights)
    const now = date(2022, 12, 29, 12, 30, 0)
    const p = f.preview(newReviewState(now), now)
    expect(RATINGS.map((r) => p[r].stability)).toEqual([1.14, 1.01, 5.44, 14.67])
    RATINGS.map((r) => p[r].difficulty).forEach((v, i) => expect(Math.abs(v - [8.4348, 6.8686, 5.3024, 3.7362][i])).toBeLessThan(1e-12))
    expect(RATINGS.map((r) => p[r].reps)).toEqual([1, 1, 1, 1])
    expect(RATINGS.map((r) => p[r].lapses)).toEqual([0, 0, 0, 0])
    expect(RATINGS.map((r) => scheduledDays(p[r]))).toEqual([0, 0, 0, 15])
    expect(RATINGS.map((r) => p[r].phase)).toEqual(['learning', 'learning', 'learning', 'review'])
  })

  it('«Fácil» en una nueva gradúa con round(S0(Fácil))', () => {
    const st = fsrs(tsWeights).next(newReviewState(t0), 4, t0)
    expect(st.phase).toBe('review')
    expect(scheduledDays(st)).toBe(11)
  })
})

describe('FSRS · escenarios generados con py-fsrs', () => {
  function replay(sc: GoldenScenario) {
    const f = fsrs(sc.weights, sc.retention, sc.maxInterval)
    let st = newReviewState(t0)
    let now = t0
    let myIntro = 1
    st = f.next(st, ratingOf(sc.first), now)
    while (st.phase !== 'review') {
      now = st.due
      st = f.next(st, 3, now)
      myIntro += 1
      if (myIntro > 6) throw new Error(`[${sc.name}] la tarjeta no gradúa`)
    }
    const repsOffset = myIntro - sc.pyIntroReviews
    sc.steps.forEach((step, i) => {
      const ctx = `[${sc.name} paso ${i + 1} ${step.rating}]`
      now = plus(st.due, step.delay * DAY)
      const elapsed = Math.floor((now.getTime() - (st.lastReview as Date).getTime()) / 1000 / DAY)
      expect(elapsed, `${ctx} días`).toBe(step.elapsed)
      st = f.next(st, ratingOf(step.rating), now)
      expect(st.phase, `${ctx} fase`).toBe(step.phase === 'Review' ? 'review' : 'relearning')
      expect(close(st.stability, step.s, 1e-9), `${ctx} S ${st.stability} vs ${step.s}`).toBe(true)
      expect(close(st.difficulty, step.d, 1e-9), `${ctx} D ${st.difficulty} vs ${step.d}`).toBe(true)
      expect(st.lapses, `${ctx} lapsos`).toBe(step.lapses)
      expect(st.reps, `${ctx} repasos`).toBe(step.reps + repsOffset)
      expect(scheduledDays(st), `${ctx} intervalo`).toBe(Math.trunc(Math.min(step.ivl, sc.maxInterval)))
      if (step.ivl > sc.maxInterval) return
    })
  }

  it('todos los escenarios', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12)
    for (const sc of scenarios) {
      // la referencia sobrepasa el tope: a partir de ahí los calendarios divergen
      const cut = sc.steps.findIndex((s) => s.ivl > sc.maxInterval)
      replay(cut < 0 ? sc : { ...sc, steps: sc.steps.slice(0, cut + 1) })
    }
  })

  it('el desborde del tope de la referencia no se reproduce', () => {
    const sc = scenarios.find((s) => s.name === 'default_max365') as GoldenScenario
    expect(sc.steps.some((s) => s.ivl > sc.maxInterval)).toBe(true)
    const f = fsrs(sc.weights, sc.retention, sc.maxInterval)
    let st = f.next(newReviewState(t0), 4, t0)
    for (let i = 0; i < 12; i++) {
      st = f.next(st, 4, st.due)
      expect(scheduledDays(st)).toBeLessThanOrEqual(365)
    }
    expect(scheduledDays(st)).toBe(365)
  })

  it('los cuatro resultados desde estados de repaso arbitrarios', () => {
    expect(table.length).toBe(294)
    const counts: Record<string, number> = {}
    for (const r of table) counts[r.weights] = (counts[r.weights] ?? 0) + 1
    expect(counts).toEqual({ default: 75, alt: 75, odd: 48, tie: 48, py: 48 })
    table.forEach((row, n) => {
      const f = fsrs(weightSets[row.weights])
      const now = plus(t0, row.elapsed * DAY)
      const st: ReviewState = { phase: 'review', due: now, stability: row.s, difficulty: row.d, reps: 5, lapses: 1, lastReview: t0, step: 0 }
      const p = f.preview(st, now)
      const pairs: [Rating, GoldenOutcome][] = [[1, row.again], [2, row.hard], [3, row.good], [4, row.easy]]
      for (const [rating, e] of pairs) {
        const ctx = `[fila ${n} w=${row.weights} S=${row.s} D=${row.d} t=${row.elapsed} ${rating}]`
        const got = p[rating]
        expect(close(got.stability, e.s, 1e-9), `${ctx} S`).toBe(true)
        expect(close(got.difficulty, e.d, 1e-9), `${ctx} D`).toBe(true)
        expect(got.phase, `${ctx} fase`).toBe(e.phase === 'Review' ? 'review' : 'relearning')
        expect(got.lapses, `${ctx} lapsos`).toBe(e.lapses)
        expect(got.reps, `${ctx} repasos`).toBe(e.reps)
        expect(scheduledDays(got), `${ctx} intervalo`).toBe(e.ivl)
      }
    })
  })
})
