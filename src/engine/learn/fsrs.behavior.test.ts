// Comportamiento de FSRS: pasos de aprendizaje, propiedades, recuperabilidad, fuzz, robustez y JSON (de FSRSBehaviorTests.swift).
import { describe, expect, it } from 'vitest'
import {
  CARD_PHASES, DEFAULT_WEIGHTS, defaultFSRSParameters, FSRS, fsrsParametersEqual, fsrsParametersFromJSON, Fuzz, isDue, isDueToday,
  isValidFSRSParameters, newReviewState, RATINGS, ratingLabel, reviewStateFromJSON, reviewStateToJSON, type FSRSParameters, type Rating, type ReviewState
} from './fsrs'
import { table, weightSets } from './fsrsGolden.testdata'
import { DISTANT_FUTURE, DISTANT_PAST, REFERENCE_DATE_MS } from '@engine/calendar/time'
import { INT_MAX } from './support'
import { close, date, DAY, plus, scheduledDays, secondsBetween, t0, TestRNG, Zones } from './testSupport.testutil'

const f = new FSRS()
const fsrs = (p: Partial<FSRSParameters>) => new FSRS(p)

function reviewState(s: number, d = 5, daysAgo: number, now: Date, reps = 4, lapses = 0): ReviewState {
  return { phase: 'review', due: now, stability: s, difficulty: d, reps, lapses, lastReview: plus(now, -daysAgo * DAY), step: 0 }
}

describe('FSRS · tarjeta nueva con los pasos por defecto', () => {
  it('previsualización', () => {
    const p = f.preview(newReviewState(t0), t0)
    expect(Object.keys(p).map(Number).sort()).toEqual([1, 2, 3, 4])
    const [again, hard, good, easy] = [p[1], p[2], p[3], p[4]]
    expect(again.phase).toBe('learning'); expect(again.step).toBe(0); expect(secondsBetween(t0, again.due)).toBe(60)
    expect(hard.phase).toBe('learning'); expect(hard.step).toBe(0); expect(secondsBetween(t0, hard.due)).toBe(330)
    expect(good.phase).toBe('learning'); expect(good.step).toBe(1); expect(secondsBetween(t0, good.due)).toBe(600)
    expect(easy.phase).toBe('review'); expect(scheduledDays(easy)).toBe(14)
    expect(again.stability).toBe(0.4872); expect(hard.stability).toBe(1.4003)
    expect(good.stability).toBe(3.7145); expect(easy.stability).toBe(13.8206)
    expect(again.difficulty).toBeCloseTo(7.6214, 12)
    expect(hard.difficulty).toBeCloseTo(6.3916, 12)
    expect(good.difficulty).toBeCloseTo(5.1618, 12)
    expect(easy.difficulty).toBeCloseTo(3.932, 12)
    for (const s of [again, hard, good, easy]) {
      expect(s.reps).toBe(1); expect(s.lapses).toBe(0); expect(s.lastReview).toEqual(t0)
    }
  })

  it('descripciones en español (y en inglés)', () => {
    const p = f.preview(newReviewState(t0), t0)
    const text = RATINGS.map((r) => `${ratingLabel(r)} ${FSRS.intervalDescription(t0, p[r].due)}`).join(' · ')
    expect(text).toBe('Otra vez 1 min · Difícil 6 min · Bien 10 min · Fácil 14 días')
    const en = RATINGS.map((r) => `${ratingLabel(r, { lang: 'en' })} ${FSRS.intervalDescription(t0, p[r].due, { lang: 'en' })}`).join(' · ')
    expect(en).toBe('Again 1 min · Hard 6 min · Good 10 min · Easy 14 days')
  })

  it('next = preview en todas las fases', () => {
    const states: ReviewState[] = [newReviewState(t0)]
    const learning = f.next(newReviewState(t0), 3, t0)
    const review = f.next(f.next(newReviewState(t0), 4, t0), 3, plus(t0, 14 * DAY))
    const relearning = f.next(review, 1, review.due)
    states.push(learning, review, relearning)
    for (const st of states) {
      const now = plus(st.lastReview ?? t0, 7 * DAY)
      const p = f.preview(st, now)
      for (const r of RATINGS) expect(f.next(st, r, now)).toEqual(p[r])
    }
  })

  it('Bien, Bien gradúa', () => {
    let st = f.next(newReviewState(t0), 3, t0)
    expect(st.phase).toBe('learning'); expect(st.step).toBe(1)
    st = f.next(st, 3, st.due)
    expect(st.phase).toBe('review')
    expect(scheduledDays(st)).toBe(4)
    expect(st.stability).toBe(3.7145)
    expect(st.difficulty).toBeCloseTo(5.1618, 12)
    expect(st.reps).toBe(2); expect(st.step).toBe(0)
  })

  it('los pasos no cambian S ni D', () => {
    let st = f.next(newReviewState(t0), 2, t0)
    const s0 = st.stability, d0 = st.difficulty
    let now = st.due
    for (const r of [1, 2, 1, 2] as Rating[]) {
      st = f.next(st, r, now)
      expect(st.phase).toBe('learning')
      expect(st.stability).toBe(s0); expect(st.difficulty).toBe(d0)
      now = st.due
    }
    expect(st.reps).toBe(5)
  })

  it('Otra vez vuelve al primer paso; Difícil en el paso 1 lo repite', () => {
    let st = f.next(newReviewState(t0), 3, t0)
    const again = f.next(st, 1, st.due)
    expect(again.phase).toBe('learning'); expect(again.step).toBe(0)
    expect(secondsBetween(again.lastReview as Date, again.due)).toBe(60)
    st = f.next(st, 2, st.due)
    expect(st.step).toBe(1)
    expect(secondsBetween(st.lastReview as Date, st.due)).toBe(600)
  })

  it('Fácil en aprendizaje gradúa con un día más que Bien', () => {
    const st = f.next(newReviewState(t0), 1, t0)
    const p = f.preview(st, st.due)
    expect(p[3].phase).toBe('learning')
    expect(p[4].phase).toBe('review')
    expect(scheduledDays(p[4])).toBe(2)
    const learning = f.next(newReviewState(t0), 3, t0)
    const q = f.preview(learning, learning.due)
    expect(scheduledDays(q[3])).toBe(4)
    expect(scheduledDays(q[4])).toBe(5)
  })
})

describe('FSRS · pasos configurables', () => {
  it('tres pasos de aprendizaje', () => {
    const g = fsrs({ learningSteps: [30, 300, 3600] })
    const p = g.preview(newReviewState(t0), t0)
    expect(secondsBetween(t0, p[1].due)).toBe(30)
    expect(secondsBetween(t0, p[2].due)).toBe(165)
    expect(secondsBetween(t0, p[3].due)).toBe(300)
    expect(p[3].step).toBe(1)
    expect(p[4].phase).toBe('review')
    let st = p[3]
    st = g.next(st, 2, st.due)
    expect(st.step).toBe(1); expect(secondsBetween(st.lastReview as Date, st.due)).toBe(300)
    st = g.next(st, 3, st.due)
    expect(st.step).toBe(2); expect(secondsBetween(st.lastReview as Date, st.due)).toBe(3600)
    st = g.next(st, 2, st.due)
    expect(st.step).toBe(2); expect(secondsBetween(st.lastReview as Date, st.due)).toBe(3600)
    const again = g.next(st, 1, st.due)
    expect(again.step).toBe(0); expect(secondsBetween(again.lastReview as Date, again.due)).toBe(30)
    st = g.next(st, 3, st.due)
    expect(st.phase).toBe('review')
    expect(scheduledDays(st)).toBeGreaterThanOrEqual(1)
  })

  it('un solo paso', () => {
    const g = fsrs({ learningSteps: [900] })
    const p = g.preview(newReviewState(t0), t0)
    expect(secondsBetween(t0, p[1].due)).toBe(900)
    expect(secondsBetween(t0, p[2].due)).toBe(1350)
    expect(p[3].phase).toBe('review')
    expect(scheduledDays(p[3])).toBe(4)
    expect(scheduledDays(p[4])).toBe(14)
  })

  it('sin pasos: las cuatro a repaso con intervalos crecientes', () => {
    for (const params of [{ learningSteps: [] }, { enableShortTerm: false }]) {
      const p = fsrs(params).preview(newReviewState(t0), t0)
      const days = RATINGS.map((r) => scheduledDays(p[r]))
      expect(days).toEqual([1, 2, 4, 14])
      for (const r of RATINGS) expect(p[r].phase).toBe('review')
      expect(p[1].lapses).toBe(0)
    }
  })

  it('sin pasos cortos tampoco hay reaprendizaje', () => {
    const p = fsrs({ enableShortTerm: false }).preview(reviewState(20, 5, 20, t0), t0)
    expect(p[1].phase).toBe('review')
    expect(p[1].lapses).toBe(1)
    const days = RATINGS.map((r) => scheduledDays(p[r]))
    for (let i = 1; i < days.length; i++) expect(days[i - 1]).toBeLessThan(days[i])
    expect(days[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('FSRS · reaprendizaje', () => {
  it('un olvido va a reaprendizaje y cuenta una vez', () => {
    const review = reviewState(30, 5, 30, t0)
    const lapsed = f.next(review, 1, t0)
    expect(lapsed.phase).toBe('relearning'); expect(lapsed.step).toBe(0)
    expect(secondsBetween(t0, lapsed.due)).toBe(600)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.reps).toBe(review.reps + 1)
    expect(lapsed.stability).toBeLessThan(review.stability)
    expect(lapsed.difficulty).toBeGreaterThan(review.difficulty)
    const again2 = f.next(lapsed, 1, lapsed.due)
    expect(again2.lapses).toBe(1)
    expect(again2.stability).toBe(lapsed.stability); expect(again2.difficulty).toBe(lapsed.difficulty)
    expect(again2.phase).toBe('relearning')
    const back = f.next(lapsed, 3, lapsed.due)
    expect(back.phase).toBe('review')
    expect(scheduledDays(back)).toBe(Math.round(lapsed.stability))
    expect(back.lapses).toBe(1)
  })

  it('varios pasos de reaprendizaje', () => {
    const g = fsrs({ relearningSteps: [300, 1800] })
    let st = g.next(reviewState(30, 5, 30, t0), 1, t0)
    expect(secondsBetween(t0, st.due)).toBe(300)
    const hard = g.next(st, 2, st.due)
    expect(hard.step).toBe(0)
    expect(secondsBetween(hard.lastReview as Date, hard.due)).toBe(1050)
    st = g.next(st, 3, st.due)
    expect(st.phase).toBe('relearning'); expect(st.step).toBe(1)
    expect(secondsBetween(st.lastReview as Date, st.due)).toBe(1800)
    st = g.next(st, 3, st.due)
    expect(st.phase).toBe('review')
  })

  it('sin pasos de reaprendizaje sigue en repaso', () => {
    const p = fsrs({ relearningSteps: [] }).preview(reviewState(30, 5, 30, t0), t0)
    expect(p[1].phase).toBe('review'); expect(p[1].lapses).toBe(1)
    const days = RATINGS.map((r) => scheduledDays(p[r]))
    for (let i = 1; i < days.length; i++) expect(days[i - 1]).toBeLessThan(days[i])
  })

  it('una tarjeta aprendiendo sin pasos configurados se trata como de repaso', () => {
    const g = fsrs({ learningSteps: [] })
    const st: ReviewState = { phase: 'learning', due: t0, stability: 3.7145, difficulty: 5.1618, reps: 1, lapses: 0, lastReview: plus(t0, -600), step: 1 }
    const p = g.preview(st, t0)
    expect(p[3].phase).toBe('review'); expect(p[2].phase).toBe('review'); expect(p[4].phase).toBe('review')
    expect(p[1].phase).toBe('relearning')
  })

  it('un paso más allá de los configurados gradúa', () => {
    const g = fsrs({ learningSteps: [60, 600] })
    const st: ReviewState = { phase: 'learning', due: t0, stability: 3.7145, difficulty: 5.1618, reps: 2, lapses: 0, lastReview: plus(t0, -3600), step: 2 }
    const p = g.preview(st, t0)
    expect(p[3].phase).toBe('review'); expect(p[2].phase).toBe('review')
    expect(p[1].phase).toBe('learning'); expect(p[1].step).toBe(0)
  })
})

describe('FSRS · propiedades del repaso', () => {
  it('la estabilidad crece con mejores calificaciones', () => {
    for (const s of [0.5, 2, 10, 60, 400]) for (const d of [1, 3, 5, 8, 10]) for (const t of [0, 1, 5, 30, 200]) {
      const p = f.preview(reviewState(s, d, t, t0), t0)
      const [sa, sh, sg, se] = [p[1].stability, p[2].stability, p[3].stability, p[4].stability]
      expect(sa).toBeLessThan(sh)
      expect(sh).toBeGreaterThanOrEqual(s)
      if (t === 0) {
        expect(Math.abs(sh - s)).toBeLessThan(1e-12); expect(Math.abs(sg - s)).toBeLessThan(1e-12); expect(Math.abs(se - s)).toBeLessThan(1e-12)
      } else {
        expect(sh).toBeLessThanOrEqual(sg)
        expect(sg).toBeLessThan(se)
      }
    }
  })

  it('intervalos Difícil < Bien < Fácil', () => {
    for (const s of [0.01, 0.3, 1, 3, 10, 50, 300, 2000]) for (const t of [0, 1, 10, 100]) {
      const p = f.preview(reviewState(s, 5, t, t0), t0)
      const h = scheduledDays(p[2]), g = scheduledDays(p[3]), e = scheduledDays(p[4])
      expect(h).toBeGreaterThanOrEqual(1)
      if (e < 365) {
        expect(h).toBeLessThan(g); expect(g).toBeLessThan(e)
      } else {
        expect(h).toBeLessThanOrEqual(g); expect(g).toBeLessThanOrEqual(e)
      }
    }
  })

  it('orden y límites de la dificultad', () => {
    const p = f.preview(reviewState(20, 5, 20, t0), t0)
    expect(p[1].difficulty).toBeGreaterThan(p[2].difficulty)
    expect(p[2].difficulty).toBeGreaterThan(p[3].difficulty)
    expect(p[3].difficulty).toBeGreaterThan(p[4].difficulty)
    let hardCase = reviewState(20, 9.9, 20, t0)
    let easyCase = reviewState(20, 1.1, 20, t0)
    let now = t0
    for (let i = 0; i < 300; i++) {
      hardCase = f.next(hardCase, 1, now)
      easyCase = f.next(easyCase, 4, now)
      now = new Date(Math.max(hardCase.due.getTime(), easyCase.due.getTime()))
      hardCase.phase = 'review'
      easyCase.phase = 'review'
      expect(hardCase.difficulty).toBeLessThanOrEqual(10)
      expect(easyCase.difficulty).toBeGreaterThanOrEqual(1)
    }
    expect(Math.abs(hardCase.difficulty - 10)).toBeLessThan(0.05)
  })

  it('«Bien» deja la dificultad en su equilibrio', () => {
    const st = reviewState(20, DEFAULT_WEIGHTS[4], 20, t0)
    expect(Math.abs(f.next(st, 3, t0).difficulty - DEFAULT_WEIGHTS[4])).toBeLessThan(1e-12)
  })

  it('más fácil, más estabilidad a lo largo de la historia', () => {
    const run = (middle: Rating) => {
      let st = f.next(newReviewState(t0), 3, t0)
      st = f.next(st, 3, st.due)
      for (const r of [3, middle, 3, 3] as Rating[]) st = f.next(st, r, st.due)
      return st
    }
    const results = ([2, 3, 4] as Rating[]).map(run)
    expect(results[0].stability).toBeLessThan(results[1].stability)
    expect(results[1].stability).toBeLessThan(results[2].stability)
    expect(scheduledDays(results[0])).toBeLessThanOrEqual(scheduledDays(results[1]))
    expect(scheduledDays(results[1])).toBeLessThanOrEqual(scheduledDays(results[2]))
  })

  it('efecto del espaciado', () => {
    let last = 0
    for (const t of [1, 3, 7, 15, 30, 60, 120]) {
      const s = f.next(reviewState(15, 5, t, t0), 3, t0).stability
      expect(s).toBeGreaterThan(last)
      last = s
    }
    expect(close(f.next(reviewState(15, 5, 0, t0), 3, t0).stability, 15, 1e-12)).toBe(true)
  })

  it('repasar antes de tiempo da un intervalo menor', () => {
    const onTime = f.next(reviewState(30, 5, 30, t0), 3, t0)
    const early = f.next(reviewState(30, 5, 10, t0), 3, t0)
    const late = f.next(reviewState(30, 5, 60, t0), 3, t0)
    expect(scheduledDays(early)).toBeLessThan(scheduledDays(onTime))
    expect(scheduledDays(onTime)).toBeLessThan(scheduledDays(late))
  })

  it('contadores de repasos y olvidos', () => {
    let st = newReviewState(t0)
    let now = t0
    const script: Rating[] = [3, 3, 3, 1, 3, 2, 1, 1, 3, 4]
    let expectedLapses = 0
    script.forEach((r, i) => {
      const before = st.phase
      st = f.next(st, r, now)
      if (before === 'review' && r === 1) expectedLapses += 1
      expect(st.reps).toBe(i + 1)
      expect(st.lapses).toBe(expectedLapses)
      expect(st.lastReview).toEqual(now)
      now = st.due
    })
    expect(expectedLapses).toBe(2)
  })

  it('fallar una nueva no es un olvido', () => {
    expect(f.next(newReviewState(t0), 1, t0).lapses).toBe(0)
    expect(fsrs({ enableShortTerm: false }).next(newReviewState(t0), 1, t0).lapses).toBe(0)
  })
})

describe('FSRS · recuperabilidad', () => {
  it('una nueva vale 1', () => {
    expect(f.retrievability(newReviewState(t0), t0)).toBe(1)
    expect(f.retrievability(newReviewState(t0), plus(t0, 400 * DAY))).toBe(1)
  })

  it('decae y vale 90 % en S', () => {
    const st = reviewState(10, 5, 0, t0)
    expect(Math.abs(f.retrievability(st, t0) - 1)).toBeLessThan(1e-12)
    let last = 1
    for (const d of [1, 2, 5, 10, 20, 50, 200, 5000]) {
      const r = f.retrievability(st, plus(t0, d * DAY))
      expect(r).toBeLessThan(last); expect(r).toBeGreaterThan(0)
      last = r
    }
    expect(close(f.retrievability(st, plus(t0, 10 * DAY)), 0.9, 1e-12)).toBe(true)
    expect(close(f.retrievability(st, plus(t0, 5 * DAY)), Math.pow(1 + FSRS.factor * 0.5, -0.5), 1e-12)).toBe(true)
  })

  it('reloj atrasado y datos que faltan', () => {
    const st = reviewState(10, 5, 0, t0)
    expect(f.retrievability(st, plus(t0, -5 * DAY))).toBe(1)
    expect(f.retrievability({ ...st, lastReview: null }, t0)).toBe(1)
    expect(f.retrievability({ ...st, stability: 0 }, t0)).toBe(1)
    expect(f.retrievability({ ...st, stability: NaN }, t0)).toBe(1)
  })

  it('en la fecha programada ≈ retención pedida', () => {
    for (const retention of [0.7, 0.8, 0.85, 0.9, 0.95]) {
      const g = fsrs({ requestRetention: retention, maximumIntervalDays: 36_500 })
      for (const s of [50, 120, 365, 1000]) {
        const base: ReviewState = { phase: 'review', due: t0, stability: s, difficulty: 5, reps: 3, lapses: 0, lastReview: t0, step: 0 }
        const ivl = g.intervalDays(s, 0, null)
        expect(Math.abs(g.retrievability(base, plus(t0, ivl * DAY)) - retention)).toBeLessThan(0.005)
      }
    }
  })

  it('R(due) ≈ 0,9 con S grande', () => {
    let st = f.next(newReviewState(t0), 4, t0)
    const g = fsrs({ maximumIntervalDays: 36_500 })
    for (let i = 0; i < 5; i++) {
      st = g.next(st, 3, st.due)
      if (st.stability > 40) expect(Math.abs(g.retrievability(st, st.due) - 0.9)).toBeLessThan(0.01)
    }
  })

  it('R medio al repasar ≈ retención', () => {
    for (const retention of [0.8, 0.9, 0.95]) {
      const g = fsrs({ requestRetention: retention, maximumIntervalDays: 36_500 })
      let st = g.next(newReviewState(t0), 4, t0)
      let sum = 0, n = 0
      for (let i = 0; i < 9; i++) {
        const r = g.retrievability(st, st.due)
        if (st.stability > 20 && st.stability * g.intervalModifier < 30_000) { sum += r; n += 1 }
        st = g.next(st, 3, st.due)
      }
      expect(n).toBeGreaterThan(3)
      expect(Math.abs(sum / n - retention)).toBeLessThan(0.01)
    }
  })
})

describe('FSRS · intervalo máximo, retención y parámetros', () => {
  it('nunca se supera el máximo', () => {
    for (const cap of [1, 2, 7, 30, 365]) {
      const g = fsrs({ maximumIntervalDays: cap })
      let st = g.next(newReviewState(t0), 4, t0)
      expect(scheduledDays(st)).toBeLessThanOrEqual(cap)
      for (const r of [4, 3, 4, 2, 4, 4, 3, 4, 4] as Rating[]) {
        st = g.next(st, r, st.due)
        const p = g.preview(st, st.due)
        for (const rr of [2, 3, 4] as Rating[]) expect(scheduledDays(p[rr])).toBeLessThanOrEqual(cap)
        expect(scheduledDays(st)).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('más retención, intervalos más cortos', () => {
    const st = reviewState(40, 5, 40, t0)
    let last = Infinity
    for (const r of [0.7, 0.8, 0.9, 0.95, 0.99]) {
      const d = scheduledDays(fsrs({ requestRetention: r, maximumIntervalDays: 36_500 }).next(st, 3, t0))
      expect(d).toBeLessThan(last)
      last = d
    }
  })

  it('pesos inválidos → por defecto', () => {
    const bad = [[], [1, 2, 3], new Array(18).fill(1), new Array(17).fill(NaN), new Array(17).fill(Infinity), new Array(17).fill(1000)]
    for (const w of bad) {
      const g = fsrs({ weights: w })
      expect(g.parameters.weights).toEqual([...DEFAULT_WEIGHTS])
      expect(g.next(newReviewState(t0), 3, t0).stability).toBe(3.7145)
    }
    expect(isValidFSRSParameters({ ...defaultFSRSParameters(), weights: [1, 2] })).toBe(false)
  })

  it('retención y máximo acotados', () => {
    expect(fsrs({ requestRetention: 0.1 }).parameters.requestRetention).toBe(0.5)
    expect(fsrs({ requestRetention: 1.5 }).parameters.requestRetention).toBe(0.99)
    expect(fsrs({ requestRetention: NaN }).parameters.requestRetention).toBe(0.9)
    expect(fsrs({ maximumIntervalDays: 0 }).parameters.maximumIntervalDays).toBe(1)
    expect(fsrs({ maximumIntervalDays: -50 }).parameters.maximumIntervalDays).toBe(1)
    expect(fsrs({ maximumIntervalDays: 1e9 }).parameters.maximumIntervalDays).toBe(36_500)
    expect(fsrs({ maximumIntervalDays: Infinity }).parameters.maximumIntervalDays).toBe(365)
    expect(isValidFSRSParameters({ ...defaultFSRSParameters(), requestRetention: 0.1 })).toBe(false)
  })

  it('pasos inválidos fuera', () => {
    const g = fsrs({ learningSteps: [-5, 0, NaN, 60, Infinity, 600], relearningSteps: [0, -1] })
    expect(g.parameters.learningSteps).toEqual([60, 600])
    expect(g.parameters.relearningSteps).toEqual([])
  })
})

describe('FSRS · fuzz', () => {
  const r = (i: number, e = 0, m = 365) => {
    const x = Fuzz.range(i, e, m)
    return [x.min, x.max]
  }

  it('rango como la fórmula de referencia', () => {
    expect(r(10)).toEqual([8, 12]); expect(r(3)).toEqual([2, 4]); expect(r(100)).toEqual([93, 107]); expect(r(365)).toEqual([345, 365])
    expect(r(10, 9)).toEqual([10, 12]); expect(r(10, 15)).toEqual([8, 12]); expect(r(10, 9, 10)).toEqual([10, 10]); expect(r(2.5)).toEqual([2, 4])
  })

  it('determinista por semilla y dentro del rango', () => {
    const st = reviewState(40, 5, 40, t0)
    expect(f.next(st, 3, t0, 12345)).toEqual(f.next(st, 3, t0, 12345))
    const unfuzzed = scheduledDays(f.next(st, 3, t0))
    const range = Fuzz.range(unfuzzed, 40, 365)
    const seen = new Set<number>()
    for (let seed = 0; seed < 500; seed++) {
      const d = scheduledDays(f.next(st, 3, t0, seed))
      expect(d).toBeGreaterThanOrEqual(range.min); expect(d).toBeLessThanOrEqual(range.max)
      seen.add(d)
    }
    expect(seen.size).toBeGreaterThan(3)
    expect(Math.min(...seen)).toBe(range.min)
  })

  it('no cambia S, D ni los intervalos cortos', () => {
    const st = reviewState(40, 5, 40, t0)
    const a = f.next(st, 3, t0), b = f.next(st, 3, t0, 99)
    expect(a.stability).toBe(b.stability); expect(a.difficulty).toBe(b.difficulty)
    const small = reviewState(1, 5, 1, t0)
    for (let seed = 0; seed < 50; seed++) expect(f.next(small, 2, t0, seed).due).toEqual(f.next(small, 2, t0).due)
    for (let seed = 0; seed < 20; seed++) expect(f.next(newReviewState(t0), 3, t0, seed).due).toEqual(plus(t0, 600))
  })

  it('mantiene orden y máximo', () => {
    const g = fsrs({ maximumIntervalDays: 90 })
    for (let seed = 0; seed < 300; seed++) {
      const p = g.preview(reviewState(60, 5, 60, t0), t0, seed)
      const h = scheduledDays(p[2]), gd = scheduledDays(p[3]), e = scheduledDays(p[4])
      expect(e).toBeLessThanOrEqual(90)
      expect(h).toBeLessThanOrEqual(gd); expect(gd).toBeLessThanOrEqual(e)
    }
  })

  it('rango contra un port literal de la referencia', () => {
    const rows: [number, number, number, number, number][] = [
      [1, 0, 365, 2, 2], [2, 0, 365, 2, 3], [3, 0, 365, 2, 4], [4, 0, 365, 3, 5], [5, 0, 365, 4, 6], [6, 0, 365, 4, 8],
      [7, 0, 365, 5, 9], [8, 0, 365, 6, 10], [10, 0, 365, 8, 12], [15, 0, 365, 13, 17], [20, 0, 365, 17, 23],
      [21, 0, 365, 18, 24], [30, 0, 365, 27, 33], [50, 0, 365, 46, 54], [100, 0, 365, 93, 107], [365, 0, 365, 345, 365],
      [10, 9, 365, 10, 12], [10, 15, 365, 8, 12], [10, 9, 10, 10, 10], [300, 0, 320, 283, 317], [30, 28, 365, 29, 33],
      [2.5, 0, 365, 2, 4], [6, 6, 365, 4, 8], [6, 5, 365, 6, 8]
    ]
    for (const [i, e, m, lo, hi] of rows) expect(r(i, e, m), `i=${i} e=${e} m=${m}`).toEqual([lo, hi])
  })

  it('aplicar: extremos y uniformidad', () => {
    const apply = (i: number, fct: number, elapsed = 0, max = 365) => Fuzz.apply(i, elapsed, max, fct)
    expect(apply(3, 0)).toBe(2); expect(apply(3, 0.5)).toBe(3); expect(apply(3, 0.999_999)).toBe(4)
    for (const fct of [0, 0.3, 0.999]) { expect(apply(1, fct)).toBe(1); expect(apply(2, fct)).toBe(2) }
    expect(apply(10, -5)).toBe(8); expect(apply(10, 7)).toBe(12); expect(apply(10, NaN)).toBe(8)
    const counts: Record<number, number> = {}
    for (let i = 0; i < 1000; i++) { const v = apply(10, i / 1000); counts[v] = (counts[v] ?? 0) + 1 }
    expect(counts).toEqual({ 8: 200, 9: 200, 10: 200, 11: 200, 12: 200 })
    for (let i = 0; i < 100; i++) expect(apply(365, i / 100, 0, 365)).toBeLessThanOrEqual(365)
  })

  it('usa los días enteros transcurridos', () => {
    for (const elapsed of [40, 40.7, 40.99]) expect(f.intervalDays(43.2, elapsed, 0.1)).toBe(41)
    expect(f.intervalDays(43.2, 40.7, 0)).toBe(41)
    expect(f.intervalDays(43.2, 40.7, 0.999_999)).toBe(47)
    expect(f.intervalDays(43.2, 40.7, null)).toBe(43)
  })

  it('el rango nunca se invierte', () => {
    expect(r(10, 9.5, 10)).toEqual([10, 10])
    expect(r(10, 11.2, 365)).toEqual([8, 12])
  })
})

describe('FSRS · robustez', () => {
  it('estados hostiles nunca dan una salida inválida', () => {
    const rng = new TestRNG(0xfeed)
    const weird = [NaN, Infinity, -Infinity, -5, 0, 1e-12, 0.5, 3, 40, 1e9, 1e300, -1e300]
    const num = () => (rng.unit() < 0.4 ? rng.pick(weird) : rng.double(0, 100))
    const nows = [t0, DISTANT_PAST, DISTANT_FUTURE, plus(t0, -1e7), plus(t0, 1e9)]
    for (let i = 0; i < 4000; i++) {
      const last = rng.unit() < 0.2 ? null : plus(t0, rng.double(-1e8, 1e8))
      const st: ReviewState = {
        phase: rng.pick(CARD_PHASES), due: plus(t0, rng.double(-1e8, 1e8)), stability: num(), difficulty: num(),
        reps: rng.unit() < 0.1 ? INT_MAX : Math.trunc(rng.double(-5, 1000)),
        lapses: rng.unit() < 0.1 ? INT_MAX : Math.trunc(rng.double(-5, 100)),
        lastReview: last, step: Math.trunc(rng.double(-3, 9))
      }
      const now = rng.pick(nows)
      const seed = rng.unit() < 0.3 ? i : null
      for (const out of Object.values(f.preview(st, now, seed))) {
        expect(Number.isFinite(out.stability) && Number.isFinite(out.difficulty)).toBe(true)
        expect(out.stability).toBeGreaterThanOrEqual(0)
        expect(out.stability).toBeLessThanOrEqual(FSRS.maxStability)
        expect(out.difficulty === 0 || (out.difficulty >= 1 && out.difficulty <= 10)).toBe(true)
        expect(Number.isNaN(out.due.getTime())).toBe(false)
        expect(out.reps).toBeGreaterThanOrEqual(0); expect(out.lapses).toBeGreaterThanOrEqual(0)
        expect(out.step).toBeGreaterThanOrEqual(0)
        expect(out.lastReview).toEqual(now)
      }
      const rr = f.retrievability(st, now)
      expect(Number.isFinite(rr) && rr >= 0 && rr <= 1).toBe(true)
    }
  })

  it('parámetros hostiles nunca dan una salida inválida', () => {
    const rng = new TestRNG(0xbeef)
    for (let i = 0; i < 400; i++) {
      const w = Array.from({ length: 17 }, () => (rng.unit() < 0.2 ? rng.pick([-100, 100, 0, 1e-9, 99.9]) : rng.double(-6, 6)))
      const g = fsrs({ weights: w, requestRetention: rng.double(0.5, 0.99), maximumIntervalDays: rng.double(1, 5000), enableShortTerm: rng.unit() < 0.8,
        learningSteps: [rng.double(1, 100), rng.double(100, 5000)], relearningSteps: [rng.double(1, 5000)] })
      let st = newReviewState(t0)
      let now = t0
      for (let k = 0; k < 40; k++) {
        st = g.next(st, rng.pick(RATINGS), now)
        expect(Number.isFinite(st.stability) && Number.isFinite(st.difficulty)).toBe(true)
        expect(st.stability).toBeLessThanOrEqual(FSRS.maxStability)
        expect(st.due.getTime()).toBeGreaterThanOrEqual(now.getTime())
        now = st.due
      }
    }
  })

  it('repaso sin último repaso = mismo día', () => {
    const n = f.next({ phase: 'review', due: t0, stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReview: null, step: 0 }, 3, t0)
    expect(close(n.stability, 10, 1e-12)).toBe(true)
    expect(n.phase).toBe('review')
  })

  it('contadores extremos no desbordan', () => {
    const n = f.next({ phase: 'review', due: t0, stability: 10, difficulty: 5, reps: INT_MAX, lapses: INT_MAX, lastReview: t0, step: 0 }, 1, plus(t0, DAY))
    expect(n.reps).toBe(INT_MAX); expect(n.lapses).toBe(INT_MAX)
  })

  it('estados corruptos se reparan con valores concretos', () => {
    const good = reviewState(DEFAULT_WEIGHTS[0], 5, 3, t0)
    for (const bad of [NaN, Infinity, -Infinity, -4, 0]) for (const r of RATINGS) expect(f.next({ ...good, stability: bad }, r, t0)).toEqual(f.next(good, r, t0))
    expect(f.next({ ...good, difficulty: NaN }, 3, t0)).toEqual(f.next({ ...good, difficulty: DEFAULT_WEIGHTS[4] }, 3, t0))
    expect(f.next({ ...good, difficulty: 99 }, 2, t0)).toEqual(f.next({ ...good, difficulty: 10 }, 2, t0))
    expect(f.next({ ...good, difficulty: -3 }, 4, t0)).toEqual(f.next({ ...good, difficulty: 1 }, 4, t0))
    const out = f.next({ ...good, reps: -9, lapses: -4, step: -2 }, 1, t0)
    expect(out.reps).toBe(1); expect(out.lapses).toBe(1); expect(out.step).toBe(0)
  })

  it('recuperabilidad estática con entradas inválidas', () => {
    expect(FSRS.retrievability(5, 0)).toBe(1); expect(FSRS.retrievability(5, -3)).toBe(1); expect(FSRS.retrievability(5, NaN)).toBe(1)
    expect(FSRS.retrievability(5, Infinity)).toBe(1); expect(FSRS.retrievability(-5, 10)).toBe(1); expect(FSRS.retrievability(-Infinity, 10)).toBe(1)
    expect(FSRS.retrievability(NaN, 10)).toBe(1); expect(FSRS.retrievability(Infinity, 10)).toBe(0); expect(FSRS.retrievability(0, 10)).toBe(1)
  })

  it('máximo fraccionario redondea a la baja', () => {
    for (const [cap, expected] of [[30.5, 30], [30.99, 30], [31.0, 31], [1.5, 1], [0.4, 1], [2.999, 2]]) {
      const g = fsrs({ maximumIntervalDays: cap })
      expect(g.maxInterval).toBe(expected)
      let st = g.next(newReviewState(t0), 4, t0)
      for (let i = 0; i < 6; i++) st = g.next(st, 4, st.due)
      expect(scheduledDays(st)).toBe(expected)
    }
  })

  it('estabilidad no finita → el máximo', () => {
    const g = fsrs({ maximumIntervalDays: 120 })
    expect(g.intervalDays(Infinity, 0, null)).toBe(120)
    expect(g.intervalDays(NaN, 0, null)).toBe(120)
    expect(g.intervalDays(0, 0, null)).toBe(1)
  })

  it('pesos raros siguen dando intervalos ordenados', () => {
    const g = fsrs({ weights: weightSets.odd, maximumIntervalDays: 36_500 })
    let checked = 0
    for (const row of table.filter((x) => x.weights === 'odd')) {
      const p = g.preview(reviewState(row.s, row.d, row.elapsed, t0), t0)
      const h = scheduledDays(p[2]), gd = scheduledDays(p[3]), e = scheduledDays(p[4])
      expect(h).toBeLessThan(gd); expect(gd).toBeLessThan(e)
      checked += 1
    }
    expect(checked).toBe(48)
  })

  it('Otra vez se recorta a Difícil cuando sería más largo', () => {
    const w = [...DEFAULT_WEIGHTS]
    w[11] = 3.0; w[14] = 4.0; w[15] = 0.0
    const g = fsrs({ weights: w, requestRetention: 0.9, maximumIntervalDays: 36_500, enableShortTerm: false })
    const cases: [number, number, number, number[]][] = [[2, 5, 30, [2, 3, 44, 123]], [1, 4, 60, [1, 2, 44, 124]], [3, 7, 45, [3, 4, 43, 117]]]
    for (const [s, d, days, expected] of cases) {
      const p = g.preview(reviewState(s, d, days, t0), t0)
      expect(RATINGS.map((x) => scheduledDays(p[x]))).toEqual(expected)
      expect(p[1].phase).toBe('review')
    }
  })

  it('500 repasos seguidos estables', () => {
    let st = newReviewState(t0)
    let now = t0
    const rng = new TestRNG(7)
    for (let i = 0; i < 500; i++) {
      st = f.next(st, rng.pick([3, 3, 3, 4, 2, 1] as Rating[]), now)
      expect(st.due.getTime()).toBeGreaterThanOrEqual(now.getTime())
      now = st.due
    }
    expect(Number.isFinite(st.stability)).toBe(true)
  })

  it('el tiempo transcurrido es fraccionario', () => {
    const st = reviewState(10, 5, 2.5, t0)
    const r25 = FSRS.retrievability(2.5, 10)
    expect(r25).not.toBe(FSRS.retrievability(2, 10))
    expect(close(f.retrievability(st, t0), r25, 1e-12)).toBe(true)
    expect(close(f.next(st, 3, t0).stability, f.recallStability(5, 10, r25, 3), 1e-12)).toBe(true)
    const half = reviewState(10, 5, 0.5, t0)
    expect(close(f.retrievability(half, t0), FSRS.retrievability(0.5, 10), 1e-12)).toBe(true)
    expect(f.next(half, 3, t0).stability).toBeGreaterThan(10)
    let lastS = 0, lastR = 2
    for (let hours = 1; hours <= 96; hours++) {
      const state = reviewState(10, 5, hours / 24, t0)
      const s = f.next(state, 3, t0).stability
      const rr = f.retrievability(state, t0)
      expect(s).toBeGreaterThan(lastS); expect(rr).toBeLessThan(lastR)
      lastS = s; lastR = rr
    }
  })
})

describe('FSRS · JSON y reloj', () => {
  it('ida y vuelta con el formato de la app Swift', () => {
    const st = f.next(f.next(newReviewState(t0), 3, t0), 3, plus(t0, 600))
    const json = JSON.parse(JSON.stringify(reviewStateToJSON(st)))
    expect(json.due).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(reviewStateFromJSON(json)).toEqual(st)
    const fresh = reviewStateToJSON(newReviewState(t0))
    expect('lastReview' in fresh).toBe(false)
  })

  it('lee JSON antiguo sin `step` y fechas numéricas de Swift', () => {
    const st = reviewStateFromJSON(JSON.parse('{"phase":"learning","due":1000,"stability":1.5,"difficulty":6,"reps":2,"lapses":0,"lastReview":900}'))
    expect(st?.step).toBe(0); expect(st?.phase).toBe('learning')
    expect(st?.due.getTime()).toBe(REFERENCE_DATE_MS + 1_000_000)
    expect(reviewStateFromJSON({ phase: 'nope' })).toBeNull()
    expect(reviewStateFromJSON({ phase: 'review', due: '2026-01-05T09:00:00Z', stability: 1, difficulty: 5, reps: 1, lapses: 0 })?.due).toEqual(t0)
  })

  it('parámetros tolerantes', () => {
    expect(fsrsParametersEqual(fsrsParametersFromJSON({}), defaultFSRSParameters())).toBe(true)
    const q = fsrsParametersFromJSON({ requestRetention: 0.85, learningSteps: [120], unknown: 1 })
    expect(q.requestRetention).toBe(0.85); expect(q.learningSteps).toEqual([120]); expect(q.maximumIntervalDays).toBe(365)
    expect(fsrsParametersEqual(fsrsParametersFromJSON(JSON.parse(JSON.stringify(q))), q)).toBe(true)
  })

  it('calificaciones y fases', () => {
    expect(RATINGS).toEqual([1, 2, 3, 4])
    expect(RATINGS.map((r) => ratingLabel(r))).toEqual(['Otra vez', 'Difícil', 'Bien', 'Fácil'])
    expect(CARD_PHASES).toEqual(['new', 'learning', 'review', 'relearning'])
  })

  it('tarjeta nueva e isDue', () => {
    const n = newReviewState(t0)
    expect(n.phase).toBe('new'); expect(n.due).toEqual(t0)
    expect(n.stability).toBe(0); expect(n.difficulty).toBe(0); expect(n.reps).toBe(0); expect(n.lapses).toBe(0); expect(n.lastReview).toBeNull()
    expect(isDue(n, t0)).toBe(true)
    expect(isDue(n, plus(t0, -1))).toBe(false)
  })

  it('descripción de intervalos (coma)', () => {
    const d = (seconds: number) => FSRS.intervalDescription(t0, plus(t0, seconds), { decimalSeparator: ',' })
    const cases: [number, string][] = [
      [0, 'ahora'], [-30, 'ahora'], [0.4, '1 s'], [30, '30 s'], [59, '59 s'], [59.6, '1 min'], [60, '1 min'], [330, '6 min'], [600, '10 min'],
      [3569, '59 min'], [3570, '1 h'], [3600, '1 h'], [5400, '2 h'], [3 * 3600, '3 h'], [86_399, '1 día'], [86_400, '1 día'], [3 * 86_400, '3 días'],
      [29 * 86_400, '29 días'], [29.6 * 86_400, '1 mes'], [30 * 86_400, '1 mes'], [45 * 86_400, '1,5 meses'], [60 * 86_400, '2 meses'],
      [120 * 86_400, '3,9 meses'], [360 * 86_400, '11,8 meses'], [364 * 86_400, '1 año'], [365 * 86_400, '1 año'], [400 * 86_400, '1,1 años'],
      [730 * 86_400, '2 años'], [3650 * 86_400, '10 años']
    ]
    for (const [s, text] of cases) expect(d(s), `${s} s`).toBe(text)
  })

  it('descripción de intervalos (punto) y extremos', () => {
    const d = (seconds: number) => FSRS.intervalDescription(t0, plus(t0, seconds), { decimalSeparator: '.' })
    expect(d(45 * 86_400)).toBe('1.5 meses'); expect(d(400 * 86_400)).toBe('1.1 años'); expect(d(60 * 86_400)).toBe('2 meses'); expect(d(3 * 86_400)).toBe('3 días')
    expect(FSRS.intervalDescription(t0, DISTANT_FUTURE).endsWith('años')).toBe(true)
    expect(FSRS.intervalDescription(DISTANT_PAST, DISTANT_PAST)).toBe('ahora')
    expect(FSRS.intervalDescription(t0, new Date(NaN))).toBe('—')
  })

  it('el vencimiento no depende de la zona ni del horario de verano', () => {
    const before = date(2026, 3, 7, 22, 0, 0, Zones.newYork)
    const st = f.next(f.next(newReviewState(before), 4, before), 3, plus(before, 14 * DAY))
    const days = secondsBetween(st.lastReview as Date, st.due) / DAY
    expect(Math.abs(days - Math.round(days))).toBeLessThan(1e-9)
  })

  it('¿toca hoy? (el día entero para las de repaso)', () => {
    const ny = Zones.newYork
    const due = date(2026, 10, 8, 22, 0, 0, ny)
    const card: ReviewState = { phase: 'review', due, stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReview: plus(due, -10 * DAY), step: 0 }
    const morning = date(2026, 10, 8, 9, 0, 0, ny)
    expect(isDue(card, morning)).toBe(false)
    expect(isDueToday(card, morning, ny)).toBe(true)
    expect(isDueToday(card, date(2026, 10, 8, 0, 0, 1, ny), ny)).toBe(true)
    expect(isDueToday(card, date(2026, 10, 7, 23, 59, 59, ny), ny)).toBe(false)
    expect(isDueToday(card, date(2026, 10, 9, 8, 0, 0, ny), ny)).toBe(true)
    expect(isDueToday({ ...card, due: date(2026, 10, 9, 0, 0, 0, ny) }, morning, ny)).toBe(false)
    const learning: ReviewState = { ...card, phase: 'learning', due: plus(morning, 600) }
    expect(isDueToday(learning, morning, ny)).toBe(false)
    expect(isDueToday(learning, plus(morning, 600), ny)).toBe(true)
    expect(isDueToday({ ...learning, phase: 'relearning' }, morning, ny)).toBe(false)
    expect(isDueToday(newReviewState(morning), morning, ny)).toBe(true)
    expect(isDueToday(newReviewState(plus(morning, 60)), morning, ny)).toBe(false)
    const late = { ...card, due: date(2026, 11, 1, 23, 30, 0, ny) }
    expect(isDueToday(late, date(2026, 11, 1, 6, 0, 0, ny), ny)).toBe(true)
    expect(isDueToday(late, date(2026, 10, 31, 23, 0, 0, ny), ny)).toBe(false)
    expect(isDueToday(card, date(2026, 10, 9, 3, 0, 0, Zones.madrid), Zones.madrid)).toBe(true)
  })
})
