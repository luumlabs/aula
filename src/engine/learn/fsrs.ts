// Planificador de repaso espaciado FSRS-4.5 (open-spaced-repetition), portado de LearnKit/FSRS (Swift) con paridad numérica:
// los `progress.json` que ya existen guardan este estado.
//
// Modelo de memoria (DSR): cada tarjeta tiene una estabilidad S (días hasta que la probabilidad de recordar baja al 90 %),
// una dificultad D ∈ [1, 10] y una recuperabilidad R(t, S) = (1 + 19/81 · t/S)^-0,5. El intervalo siguiente es el t en el que
// R baja hasta la retención pedida. Es una función pura: el reloj entra como parámetro (`now`) y nada se muta.
// - En los pasos cortos (aprendizaje y reaprendizaje) S y D NO cambian; solo se mueve el calendario.
// - En repaso, S y D se actualizan con las fórmulas de FSRS-4.5 usando la D previa; Difícil < Bien < Fácil. El tope
//   `maximumIntervalDays` se aplica DESPUÉS de ordenar (nunca se supera).
// - Los días transcurridos son fraccionarios (segundos / 86 400).
import { clamp, decimal, finiteOr, incremented, resolveText, roundHalfAway, type TextOptions } from './support'
import { SplitMix64, type Seed } from './seededRandom'
import { addDays, decodeSwiftDate, encodeSwiftDate, startOfDay, localTimeZone } from '@engine/calendar/time'

// MARK: - Tipos

/** Calificación al repasar una tarjeta: 1 otra vez · 2 difícil · 3 bien · 4 fácil. */
export type Rating = 1 | 2 | 3 | 4
export const Rating = { again: 1, hard: 2, good: 3, easy: 4 } as const satisfies Record<string, Rating>
export const RATINGS: readonly Rating[] = [1, 2, 3, 4]

export function isRating(v: unknown): v is Rating {
  return v === 1 || v === 2 || v === 3 || v === 4
}

/** Texto del botón: «Otra vez», «Difícil», «Bien», «Fácil» (o en inglés). */
export function ratingLabel(r: Rating, o?: TextOptions): string {
  const en = resolveText(o).lang === 'en'
  switch (r) {
    case 1: return en ? 'Again' : 'Otra vez'
    case 2: return en ? 'Hard' : 'Difícil'
    case 3: return en ? 'Good' : 'Bien'
    case 4: return en ? 'Easy' : 'Fácil'
  }
}

/** Fase de una tarjeta: nueva, aprendiendo (pasos en minutos), en repaso (días) o reaprendiendo tras un olvido. */
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning'
export const CARD_PHASES: readonly CardPhase[] = ['new', 'learning', 'review', 'relearning']

/** Estado de memoria y calendario de UNA tarjeta (un valor: `FSRS.next` devuelve uno nuevo). */
export interface ReviewState {
  phase: CardPhase
  /** Cuándo toca repasarla. */
  due: Date
  /** Estabilidad S en días (0 si es nueva). */
  stability: number
  /** Dificultad D en [1, 10] (0 si es nueva). */
  difficulty: number
  /** Repasos hechos (cuentan también los pasos cortos). */
  reps: number
  /** Olvidos estando en repaso. */
  lapses: number
  /** Último repaso; `null` si nunca. */
  lastReview: Date | null
  /** Paso de (re)aprendizaje en curso. */
  step: number
}

/** Tarjeta nueva, disponible desde `now`. */
export function newReviewState(now: Date): ReviewState {
  return { phase: 'new', due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, step: 0 }
}

/** `true` si ya toca (su `due` es igual o anterior a `now`). */
export function isDue(s: ReviewState, now: Date): boolean {
  return s.due.getTime() <= now.getTime()
}

/** Como `isDue`, pero las tarjetas en repaso cuentan como vencidas durante TODO el día de su fecha (en la zona indicada). */
export function isDueToday(s: ReviewState, now: Date, timeZone: string = localTimeZone()): boolean {
  if (s.phase !== 'review') return s.due.getTime() <= now.getTime()
  const tomorrow = addDays(startOfDay(now, timeZone), 1, timeZone)
  return s.due.getTime() < tomorrow.getTime()
}

/** Parámetros del planificador. */
export interface FSRSParameters {
  /** Pesos w0…w16. Si no son 17 números finitos y razonables, se usan los de por defecto. */
  weights: number[]
  /** Probabilidad de recordar deseada (0,5…0,99). */
  requestRetention: number
  /** Intervalo máximo en días (1…36 500). */
  maximumIntervalDays: number
  /** Sin pasos cortos si es `false`. */
  enableShortTerm: boolean
  /** Pasos de aprendizaje en segundos (por defecto 1 y 10 min). */
  learningSteps: number[]
  /** Pasos de reaprendizaje en segundos (por defecto 10 min). */
  relearningSteps: number[]
}

export const FSRS_WEIGHT_COUNT = 17
/** Pesos oficiales de FSRS-4.5 (los de py-fsrs 2.x). */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755
]

export function defaultFSRSParameters(): FSRSParameters {
  return { weights: [...DEFAULT_WEIGHTS], requestRetention: 0.9, maximumIntervalDays: 365, enableShortTerm: true, learningSteps: [60, 600], relearningSteps: [600] }
}

/** Copia con todo en rango (pesos inválidos → por defecto; retención 0,5…0,99; máximo 1…36 500; pasos ≤ 0 fuera). */
export function sanitizeFSRSParameters(p: Partial<FSRSParameters>): FSRSParameters {
  const base = { ...defaultFSRSParameters(), ...p }
  const weights = Array.isArray(base.weights) ? base.weights : []
  const weightsOK = weights.length === FSRS_WEIGHT_COUNT && weights.every((w) => typeof w === 'number' && Number.isFinite(w) && Math.abs(w) <= 100)
  return {
    weights: weightsOK ? [...weights] : [...DEFAULT_WEIGHTS],
    requestRetention: clamp(finiteOr(base.requestRetention, 0.9), 0.5, 0.99),
    maximumIntervalDays: clamp(finiteOr(base.maximumIntervalDays, 365), 1, 36_500),
    enableShortTerm: base.enableShortTerm !== false,
    learningSteps: (base.learningSteps ?? []).filter((s) => Number.isFinite(s) && s > 0),
    relearningSteps: (base.relearningSteps ?? []).filter((s) => Number.isFinite(s) && s > 0)
  }
}

export function fsrsParametersEqual(a: FSRSParameters, b: FSRSParameters): boolean {
  const eq = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]) || v === y[i])
  return eq(a.weights, b.weights) && a.requestRetention === b.requestRetention && a.maximumIntervalDays === b.maximumIntervalDays &&
    a.enableShortTerm === b.enableShortTerm && eq(a.learningSteps, b.learningSteps) && eq(a.relearningSteps, b.relearningSteps)
}

/** `true` si no haría falta sanearlos. */
export function isValidFSRSParameters(p: FSRSParameters): boolean {
  return fsrsParametersEqual(p, sanitizeFSRSParameters(p))
}

// MARK: - Fuzz

/** «Fuzz» de intervalos (como Anki / ts-fsrs): nada por debajo de 2,5 días; ±15 % entre 2,5 y 7, ±10 % entre 7 y 20, ±5 % por encima. */
export const Fuzz = {
  ranges: [
    { start: 2.5, end: 7.0, factor: 0.15 },
    { start: 7.0, end: 20.0, factor: 0.1 },
    { start: 20.0, end: Infinity, factor: 0.05 }
  ],
  minimumInterval: 2.5,

  /** Rango de intervalos posibles (días enteros) tras el fuzz. */
  range(interval: number, elapsedDays: number, maximumInterval: number): { min: number; max: number } {
    let delta = 1.0
    for (const r of Fuzz.ranges) delta += r.factor * Math.max(Math.min(interval, r.end) - r.start, 0)
    const capped = Math.min(interval, maximumInterval)
    let lo = Math.max(2, roundHalfAway(capped - delta))
    const hi = Math.min(roundHalfAway(capped + delta), maximumInterval)
    if (capped > elapsedDays) lo = Math.max(lo, elapsedDays + 1)
    lo = Math.min(lo, hi)
    return { min: lo, max: hi }
  },

  /** Aplica el fuzz a un intervalo ya redondeado con `factor` ∈ [0, 1). */
  apply(interval: number, elapsedDays: number, maximumInterval: number, factor: number): number {
    if (!(interval >= Fuzz.minimumInterval)) return interval
    const r = Fuzz.range(interval, elapsedDays, maximumInterval)
    const f = clamp(factor, 0, 0.999_999_999_999)
    const v = Math.floor(f * (r.max - r.min + 1) + r.min)
    return Math.min(Math.max(v, r.min), r.max)
  }
}

// MARK: - FSRS

const SECONDS_PER_DAY = 86_400

type Outcomes = Record<Rating, ReviewState>

export class FSRS {
  /** Exponente del olvido. */
  static readonly decay = -0.5
  /** 0,9^(1/decay) − 1 = 19/81: R(S, S) = 90 %. */
  static readonly factor = 19.0 / 81.0
  static readonly minStability = 0.01
  static readonly maxStability = 36_500.0
  static readonly secondsPerDay = SECONDS_PER_DAY

  /** Parámetros efectivos (ya saneados). */
  readonly parameters: FSRSParameters
  /** I(r, S) / S para la retención pedida. */
  readonly intervalModifier: number
  /** Intervalo máximo en días (entero ≥ 1; un máximo fraccionario se redondea a la baja). */
  readonly maxInterval: number
  private readonly w: number[]
  private readonly learningSteps: number[]
  private readonly relearningSteps: number[]

  constructor(parameters: Partial<FSRSParameters> = {}) {
    const p = sanitizeFSRSParameters(parameters)
    this.parameters = p
    this.w = p.weights
    this.intervalModifier = FSRS.intervalModifierFor(p.requestRetention)
    this.maxInterval = Math.max(1, Math.floor(p.maximumIntervalDays))
    this.learningSteps = p.enableShortTerm ? p.learningSteps : []
    this.relearningSteps = p.enableShortTerm ? p.relearningSteps : []
  }

  // API pública ------------------------------------------------------------------------------------------------------

  /** Estado tras calificar con `rating` en `now`. Con `fuzzSeed`, los intervalos en días (≥ 2,5) se desplazan de forma
   *  determinista según esa semilla. */
  next(state: ReviewState, rating: Rating, now: Date, fuzzSeed?: Seed | null): ReviewState {
    return this.outcomes(state, now, fuzzSeed)[rating]
  }

  /** Los cuatro resultados posibles (para «Otra vez 1 min · Difícil 6 min · Bien 10 min · Fácil 14 días»). */
  preview(state: ReviewState, now: Date, fuzzSeed?: Seed | null): Record<Rating, ReviewState> {
    return this.outcomes(state, now, fuzzSeed)
  }

  /** Probabilidad (0…1) de recordar en `now`. 1 si es nueva o no tiene memoria. */
  retrievability(state: ReviewState, now: Date): number {
    if (state.phase === 'new' || !Number.isFinite(state.stability) || !(state.stability > 0) || !state.lastReview) return 1
    const s = this.repaired(state)
    return FSRS.retrievability(this.elapsedDays(s, now), s.stability)
  }

  /** R(t, S). 1 si S no es válida, t no es un número o t ≤ 0; con t = +∞, 0. */
  static retrievability(elapsedDays: number, stability: number): number {
    if (!(stability > 0) || !Number.isFinite(stability) || Number.isNaN(elapsedDays)) return 1
    return Math.pow(1 + (FSRS.factor * Math.max(0, elapsedDays)) / stability, FSRS.decay)
  }

  /** Texto breve del tiempo entre dos instantes: «30 s», «10 min», «3 h», «3 días», «1 mes», «1,5 meses», «2 años». */
  static intervalDescription(from: Date, to: Date, o?: TextOptions): string {
    const { lang, comma } = resolveText(o)
    const en = lang === 'en'
    const seconds = (to.getTime() - from.getTime()) / 1000
    if (!Number.isFinite(seconds)) return '—'
    if (!(seconds > 0)) return en ? 'now' : 'ahora'
    if (seconds < 59.5) return `${Math.max(1, Math.trunc(roundHalfAway(seconds)))} s`
    const minutes = roundHalfAway(seconds / 60)
    if (minutes < 60) return `${Math.trunc(Math.max(1, minutes))} min`
    const hours = roundHalfAway(seconds / 3600)
    if (hours < 24) return `${Math.trunc(Math.max(1, hours))} h`
    const days = seconds / SECONDS_PER_DAY
    const wholeDays = roundHalfAway(days)
    if (wholeDays < 30) {
      const n = Math.trunc(Math.max(1, wholeDays))
      return n === 1 ? (en ? '1 day' : '1 día') : en ? `${n} days` : `${n} días`
    }
    const monthsRounded = roundHalfAway((days / 30.4375) * 10) / 10
    if (monthsRounded < 12) {
      return monthsRounded === 1 ? (en ? '1 month' : '1 mes') : `${decimal(monthsRounded, 1, comma)} ${en ? 'months' : 'meses'}`
    }
    const yearsRounded = roundHalfAway((days / 365.25) * 10) / 10
    return yearsRounded === 1 ? (en ? '1 year' : '1 año') : `${decimal(yearsRounded, 1, comma)} ${en ? 'years' : 'años'}`
  }

  // Fórmulas de FSRS-4.5 (públicas para probarlas contra la referencia) ------------------------------------------------

  /** (r^(1/decay) − 1) / factor. */
  static intervalModifierFor(r: number): number {
    return (Math.pow(r, 1 / FSRS.decay) - 1) / FSRS.factor
  }

  /** S0(G) = max(w[G−1], 0,1). */
  initialStability(g: Rating): number {
    return Math.max(this.w[g - 1], 0.1)
  }

  /** D0(G) = w4 − (G − 3)·w5, acotada a [1, 10]. */
  initialDifficulty(g: Rating): number {
    return clamp(this.w[4] - (g - 3) * this.w[5], 1, 10)
  }

  /** D' = w7·w4 + (1 − w7)·(D − w6·(G − 3)), acotada a [1, 10]. */
  nextDifficulty(d: number, g: Rating): number {
    const nd = d - this.w[6] * (g - 3)
    return clamp(this.w[7] * this.w[4] + (1 - this.w[7]) * nd, 1, 10)
  }

  /** Estabilidad tras recordar (Difícil/Bien/Fácil). */
  recallStability(d: number, s: number, r: number, rating: Rating): number {
    const w = this.w
    const hardPenalty = rating === 2 ? w[15] : 1
    const easyBonus = rating === 4 ? w[16] : 1
    const inc = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus
    return this.boundedStability(s * (1 + inc), s)
  }

  /** Estabilidad tras olvidar (Otra vez). */
  forgetStability(d: number, s: number, r: number): number {
    const w = this.w
    const v = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14])
    return this.boundedStability(v, FSRS.minStability)
  }

  private boundedStability(v: number, fallback: number): number {
    return clamp(finiteOr(v, fallback), FSRS.minStability, FSRS.maxStability)
  }

  /** Intervalo en días (entero ≥ 1, ≤ máximo) para una estabilidad; con `fuzzFactor` aplica el fuzz. */
  intervalDays(stability: number, elapsedDays: number, fuzzFactor: number | null): number {
    const raw = finiteOr(stability * this.intervalModifier, this.maxInterval)
    let ivl = Math.min(Math.max(1, roundHalfAway(raw)), this.maxInterval)
    if (fuzzFactor !== null) ivl = Fuzz.apply(ivl, Math.floor(elapsedDays), this.maxInterval, fuzzFactor)
    return ivl
  }

  /** Retraso tras «Difícil» en el paso k: media de los dos primeros si hay ≥ 2; 1,5 × el paso si hay uno; después, el paso actual. */
  hardDelay(steps: readonly number[], k: number): number {
    if (k === 0 && steps.length === 1) return steps[0] * 1.5
    if (k === 0 && steps.length >= 2) return (steps[0] + steps[1]) / 2
    return steps[Math.min(k, steps.length - 1)]
  }

  // Máquina de estados ---------------------------------------------------------------------------------------------------

  private outcomes(raw: ReviewState, now: Date, fuzzSeed?: Seed | null): Outcomes {
    const state = this.repaired(raw)
    const fuzz = fuzzSeed === undefined || fuzzSeed === null ? null : new SplitMix64(fuzzSeed).nextUnit()
    switch (state.phase) {
      case 'new': return this.newCardOutcomes(state, now, fuzz)
      case 'learning': return this.stepOutcomes(state, now, fuzz, this.learningSteps)
      case 'relearning': return this.stepOutcomes(state, now, fuzz, this.relearningSteps)
      default: return this.reviewOutcomes(state, now, fuzz)
    }
  }

  /** Repara estados corruptos (no finitos, fuera de rango o negativos) para que nunca den NaN. */
  private repaired(input: ReviewState): ReviewState {
    const s: ReviewState = { ...input }
    s.reps = Math.max(0, s.reps)
    s.lapses = Math.max(0, s.lapses)
    s.step = Math.max(0, s.step)
    if (!CARD_PHASES.includes(s.phase)) s.phase = 'new'
    if (s.phase === 'new') return s
    if (!Number.isFinite(s.stability) || s.stability <= 0) s.stability = this.initialStability(1)
    s.stability = clamp(s.stability, FSRS.minStability, FSRS.maxStability)
    if (!Number.isFinite(s.difficulty)) s.difficulty = this.initialDifficulty(3)
    s.difficulty = clamp(s.difficulty, 1, 10)
    return s
  }

  private elapsedDays(s: ReviewState, now: Date): number {
    if (!s.lastReview) return 0
    const dt = (now.getTime() - s.lastReview.getTime()) / 1000
    if (!Number.isFinite(dt) || dt <= 0) return 0
    return dt / SECONDS_PER_DAY
  }

  private make(base: ReviewState, now: Date, phase: CardPhase, dueInSeconds: number, stability: number, difficulty: number, lapses: number, step: number): ReviewState {
    return { phase, due: new Date(now.getTime() + dueInSeconds * 1000), stability, difficulty, reps: incremented(base.reps), lapses, lastReview: now, step }
  }

  private makeReview(base: ReviewState, now: Date, days: number, stability: number, difficulty: number, lapses: number): ReviewState {
    return this.make(base, now, 'review', days * SECONDS_PER_DAY, stability, difficulty, lapses, 0)
  }

  private newCardOutcomes(st: ReviewState, now: Date, fuzz: number | null): Outcomes {
    const graduated = (g: Rating, days: number) => this.makeReview(st, now, days, this.initialStability(g), this.initialDifficulty(g), 0)
    const learning = (g: Rating, step: number, delay: number) =>
      this.make(st, now, 'learning', delay, this.initialStability(g), this.initialDifficulty(g), 0, step)
    const steps = this.learningSteps
    if (steps.length === 0) {
      // sin pasos cortos: las cuatro van a repaso con intervalos estrictamente crecientes
      const [a, h, g, e] = this.ordered(
        this.intervalDays(this.initialStability(1), 0, fuzz),
        this.intervalDays(this.initialStability(2), 0, fuzz),
        this.intervalDays(this.initialStability(3), 0, fuzz),
        this.intervalDays(this.initialStability(4), 0, fuzz)
      )
      return { 1: graduated(1, a), 2: graduated(2, h), 3: graduated(3, g), 4: graduated(4, e) }
    }
    const easyDays = this.intervalDays(this.initialStability(4), 0, fuzz)
    const good = steps.length === 1 ? graduated(3, this.intervalDays(this.initialStability(3), 0, fuzz)) : learning(3, 1, steps[1])
    return { 1: learning(1, 0, steps[0]), 2: learning(2, 0, this.hardDelay(steps, 0)), 3: good, 4: graduated(4, easyDays) }
  }

  private stepOutcomes(st: ReviewState, now: Date, fuzz: number | null, steps: readonly number[]): Outcomes {
    // sin pasos configurados (se cambió la configuración): se trata como una de repaso
    if (steps.length === 0) return this.reviewOutcomes({ ...st, phase: 'review', step: 0 }, now, fuzz)
    const phase = st.phase
    const elapsed = this.elapsedDays(st, now)
    const s = st.stability, d = st.difficulty
    const k = st.step
    const inRange = k < steps.length
    const staying = (step: number, delay: number) => this.make(st, now, phase, delay, s, d, st.lapses, step)
    const graduated = (days: number) => this.makeReview(st, now, days, s, d, st.lapses)
    // S no cambia en los pasos cortos: Fácil gana un día para que siempre sea mayor que Bien (salvo en el tope)
    const goodDays = this.intervalDays(s, elapsed, fuzz)
    const easyDays = Math.min(goodDays + 1, this.maxInterval)
    const again = staying(0, steps[0])
    const hard = inRange ? staying(k, this.hardDelay(steps, k)) : graduated(goodDays)
    const good = !inRange || k + 1 >= steps.length ? graduated(goodDays) : staying(k + 1, steps[k + 1])
    return { 1: again, 2: hard, 3: good, 4: graduated(easyDays) }
  }

  private reviewOutcomes(st: ReviewState, now: Date, fuzz: number | null): Outcomes {
    const t = this.elapsedDays(st, now)
    const s = st.stability, d = st.difficulty
    const r = FSRS.retrievability(t, s)
    const sAgain = this.forgetStability(d, s, r)
    const sHard = this.recallStability(d, s, r, 2)
    const sGood = this.recallStability(d, s, r, 3)
    const sEasy = this.recallStability(d, s, r, 4)
    let h = this.intervalDays(sHard, t, fuzz)
    let g = this.intervalDays(sGood, t, fuzz)
    let e = this.intervalDays(sEasy, t, fuzz)
    const lapsed = incremented(st.lapses)
    let again: ReviewState
    if (this.relearningSteps.length === 0) {
      // olvidar sin reaprendizaje: sigue en repaso con intervalo corto (Otra vez < Difícil < Bien < Fácil)
      const ordered = this.ordered(this.intervalDays(sAgain, t, fuzz), h, g, e)
      h = ordered[1]; g = ordered[2]; e = ordered[3]
      again = this.makeReview(st, now, ordered[0], sAgain, this.nextDifficulty(d, 1), lapsed)
    } else {
      h = Math.min(h, g)
      g = Math.max(g, h + 1)
      e = Math.max(e, g + 1)
      again = this.make(st, now, 'relearning', this.relearningSteps[0], sAgain, this.nextDifficulty(d, 1), lapsed, 0)
    }
    // el tope va al final: nunca se supera aunque el orden empujara por encima
    h = Math.min(h, this.maxInterval); g = Math.min(g, this.maxInterval); e = Math.min(e, this.maxInterval)
    return {
      1: again,
      2: this.makeReview(st, now, h, sHard, this.nextDifficulty(d, 2), st.lapses),
      3: this.makeReview(st, now, g, sGood, this.nextDifficulty(d, 3), st.lapses),
      4: this.makeReview(st, now, e, sEasy, this.nextDifficulty(d, 4), st.lapses)
    }
  }

  /** Fuerza again < hard < good < easy (cada uno al menos 1 más que el anterior) y recorta al máximo. */
  private ordered(again: number, hard: number, good: number, easy: number): [number, number, number, number] {
    let a = again, h = hard, g = good, e = easy
    a = Math.min(a, h)
    h = Math.max(h, a + 1)
    g = Math.max(g, h + 1)
    e = Math.max(e, g + 1)
    const m = this.maxInterval
    return [Math.min(a, m), Math.min(h, m), Math.min(g, m), Math.min(e, m)]
  }
}

// MARK: - JSON (mismo formato que la app Swift)

export interface ReviewStateJSON {
  phase: CardPhase
  due: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReview?: string
  step: number
}

/** Como lo escribe Swift (`lastReview` se omite si no hay). */
export function reviewStateToJSON(s: ReviewState): ReviewStateJSON {
  const out: ReviewStateJSON = { phase: s.phase, due: encodeSwiftDate(s.due), stability: s.stability, difficulty: s.difficulty, reps: s.reps, lapses: s.lapses, step: s.step }
  if (s.lastReview) out.lastReview = encodeSwiftDate(s.lastReview)
  return out
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Lee un estado guardado (tolerante con datos antiguos: `step` es opcional). `null` si falta algo obligatorio. */
export function reviewStateFromJSON(v: unknown): ReviewState | null {
  if (!isObject(v)) return null
  const phase = v.phase
  if (typeof phase !== 'string' || !CARD_PHASES.includes(phase as CardPhase)) return null
  const due = decodeSwiftDate(v.due)
  const num = (x: unknown) => (typeof x === 'number' ? x : null)
  const stability = num(v.stability), difficulty = num(v.difficulty), reps = num(v.reps), lapses = num(v.lapses)
  if (!due || stability === null || difficulty === null || reps === null || lapses === null) return null
  const lastReview = v.lastReview === undefined || v.lastReview === null ? null : decodeSwiftDate(v.lastReview)
  if (v.lastReview !== undefined && v.lastReview !== null && !lastReview) return null
  const step = num(v.step)
  return { phase: phase as CardPhase, due, stability, difficulty, reps: Math.trunc(reps), lapses: Math.trunc(lapses), lastReview, step: step === null ? 0 : Math.trunc(step) }
}

/** Parámetros guardados, tolerando claves ausentes. */
export function fsrsParametersFromJSON(v: unknown): FSRSParameters {
  const d = defaultFSRSParameters()
  if (!isObject(v)) return d
  const nums = (x: unknown) => (Array.isArray(x) && x.every((n) => typeof n === 'number') ? (x as number[]) : null)
  return {
    weights: nums(v.weights) ?? d.weights,
    requestRetention: typeof v.requestRetention === 'number' ? v.requestRetention : d.requestRetention,
    maximumIntervalDays: typeof v.maximumIntervalDays === 'number' ? v.maximumIntervalDays : d.maximumIntervalDays,
    enableShortTerm: typeof v.enableShortTerm === 'boolean' ? v.enableShortTerm : d.enableShortTerm,
    learningSteps: nums(v.learningSteps) ?? d.learningSteps,
    relearningSteps: nums(v.relearningSteps) ?? d.relearningSteps
  }
}
