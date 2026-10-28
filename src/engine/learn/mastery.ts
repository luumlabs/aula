// Dominio de habilidades: posterior Beta con olvido exponencial (portado de LearnKit/Mastery).
//
// Para cada habilidad se estima θ = probabilidad de resolver bien un ejercicio típico. Se parte de una Beta(1, 1) y cada
// intento suma evidencia: α += peso·crédito, β += peso·(1 − crédito). El peso depende de la dificultad, las pistas, el tiempo y
// el modo (un examen pesa más que una lección). La evidencia vieja se desvanece hacia la Beta inicial (semivida
// `halfLifeDays`) y los intentos recientes pesan más que los antiguos.
import { BetaMath } from './betaMath'
import { clamp, finiteOr, incremented, resolveText, type TextOptions } from './support'
import { type Rating } from './fsrs'
import { decodeSwiftDate, encodeSwiftDate } from '@engine/calendar/time'

/** Contexto del intento: lección (evidencia débil) … examen (la más fuerte). */
export type AttemptMode = 'lesson' | 'practice' | 'review' | 'diagnostic' | 'exam'
export const ATTEMPT_MODES: readonly AttemptMode[] = ['lesson', 'practice', 'review', 'diagnostic', 'exam']

/** Nivel de dominio, de menos a más. */
export type MasteryLevel = 'unseen' | 'learning' | 'practicing' | 'solid' | 'mastered'
export const MASTERY_LEVELS: readonly MasteryLevel[] = ['unseen', 'learning', 'practicing', 'solid', 'mastered']

/** Orden de los niveles (para comparar: `masteryLevelOrder(a) < masteryLevelOrder(b)`). */
export function masteryLevelOrder(l: MasteryLevel): number {
  return MASTERY_LEVELS.indexOf(l)
}

/** Etiqueta del nivel («Sin ver», «Aprendiendo», «Practicando», «Sólido», «Dominado»). */
export function masteryLevelLabel(l: MasteryLevel, o?: TextOptions): string {
  const en = resolveText(o).lang === 'en'
  switch (l) {
    case 'unseen': return en ? 'Unseen' : 'Sin ver'
    case 'learning': return en ? 'Learning' : 'Aprendiendo'
    case 'practicing': return en ? 'Practicing' : 'Practicando'
    case 'solid': return en ? 'Solid' : 'Sólido'
    case 'mastered': return en ? 'Mastered' : 'Dominado'
  }
}

/** Estado de dominio de una habilidad (α y β están «al día» de `lastPracticed`). */
export interface SkillMastery {
  alpha: number
  beta: number
  /** Intentos registrados (sin descuento). */
  attempts: number
  lastPracticed: Date | null
  lastCorrect: Date | null
  /** Aciertos seguidos. */
  streak: number
}

export const PRIOR_ALPHA = 1.0
export const PRIOR_BETA = 1.0

/** Habilidad sin ningún intento. */
export function freshMastery(): SkillMastery {
  return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA, attempts: 0, lastPracticed: null, lastCorrect: null, streak: 0 }
}

/** Crea un estado con valores por defecto para lo que no se indique. */
export function skillMastery(p: Partial<SkillMastery> = {}): SkillMastery {
  return { ...freshMastery(), ...p }
}

/** Resultado de un intento. */
export interface AttemptOutcome {
  /** De 0 (mal) a 1 (perfecto). */
  credit: number
  /** 1 fácil · 2 media · 3 difícil. */
  difficulty: number
  hintsUsed: number
  seconds: number | null
  expectedSeconds: number | null
  mode: AttemptMode
}

/** Intento con valores por defecto: dificultad media, sin pistas, sin tiempos y en modo práctica. */
export function attempt(credit: number, p: Partial<Omit<AttemptOutcome, 'credit'>> = {}): AttemptOutcome {
  return { credit, difficulty: 2, hintsUsed: 0, seconds: null, expectedSeconds: null, mode: 'practice', ...p }
}

/** Intento equivalente a calificar una tarjeta: Otra vez 0 · Difícil 0,6 · Bien y Fácil 1 (modo repaso). */
export function attemptFromRating(rating: Rating, seconds: number | null = null, expectedSeconds: number | null = null): AttemptOutcome {
  const credit = rating === 1 ? 0 : rating === 2 ? 0.6 : 1
  return { credit, difficulty: 2, hintsUsed: 0, seconds, expectedSeconds, mode: 'review' }
}

export class MasteryModel {
  /** Días en los que la evidencia pierde la mitad de su peso. */
  readonly halfLifeDays: number
  /** Evidencia que sobrevive a cada intento de peso 1 (0,5…1). */
  readonly attemptRetention: number

  static readonly hintFactor = 0.75
  static readonly successThreshold = 0.5

  constructor(halfLifeDays = 21, attemptRetention = 0.95) {
    this.halfLifeDays = Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : 21
    this.attemptRetention = Number.isFinite(attemptRetention) ? Math.min(Math.max(attemptRetention, 0.5), 1) : 0.95
  }

  /** Peso base según el contexto. */
  static modeWeight(mode: AttemptMode): number {
    switch (mode) {
      case 'lesson': return 0.5
      case 'practice': return 1.0
      case 'review': return 0.8
      case 'diagnostic': return 1.25
      case 'exam': return 1.5
      default: return 1.0
    }
  }

  /** Cuánto cuenta un ACIERTO según la dificultad. */
  static successWeight(difficulty: number): number {
    const d = Math.min(Math.max(Math.trunc(finiteOr(difficulty, 2)), 1), 3)
    return d === 1 ? 0.6 : d === 2 ? 1.0 : 1.5
  }

  /** Cuánto cuenta un FALLO según la dificultad. */
  static failureWeight(difficulty: number): number {
    const d = Math.min(Math.max(Math.trunc(finiteOr(difficulty, 2)), 1), 3)
    return d === 1 ? 1.4 : d === 2 ? 1.0 : 0.7
  }

  /** Crédito efectivo: reducido por pistas y por lentitud (solo si hubo algo de crédito). */
  static effectiveCredit(o: AttemptOutcome): number {
    let c = clamp(o.credit, 0, 1)
    const hints = Math.min(Math.max(Math.trunc(finiteOr(o.hintsUsed, 0)), 0), 20)
    c *= Math.pow(MasteryModel.hintFactor, hints)
    const sec = o.seconds, expected = o.expectedSeconds
    if (c > 0 && sec !== null && expected !== null && Number.isFinite(sec) && Number.isFinite(expected) && sec > 0 && expected > 0) {
      // hasta 1,5× el tiempo esperado no se penaliza; desde 4× se pierde el 30 %
      const ratio = sec / expected
      c *= 1 - 0.3 * clamp((ratio - 1.5) / 2.5, 0, 1)
    }
    return c
  }

  /** (α, β) con el olvido aplicado hasta `now`. Nunca no positivos. */
  decayed(m: SkillMastery, now: Date): { alpha: number; beta: number } {
    const a0 = PRIOR_ALPHA, b0 = PRIOR_BETA
    const a = Math.max(finiteOr(m.alpha, a0), 1e-6)
    const b = Math.max(finiteOr(m.beta, b0), 1e-6)
    if (!m.lastPracticed) return { alpha: a, beta: b }
    const dt = (now.getTime() - m.lastPracticed.getTime()) / 1000
    if (!Number.isFinite(dt) || !(dt > 0)) return { alpha: a, beta: b }
    const factor = Math.pow(0.5, dt / 86_400 / this.halfLifeDays)
    return { alpha: a0 + (a - a0) * factor, beta: b0 + (b - b0) * factor }
  }

  /** Evidencia efectiva (suma de pesos sobre la Beta inicial) con el olvido aplicado. */
  effectiveEvidence(m: SkillMastery, now: Date): number {
    const d = this.decayed(m, now)
    return Math.max(0, d.alpha + d.beta - PRIOR_ALPHA - PRIOR_BETA)
  }

  /** Estado tras un intento: olvido hasta `now`, descuento de lo previo y la evidencia del intento. */
  updated(m: SkillMastery, o: AttemptOutcome, now: Date): SkillMastery {
    const a0 = PRIOR_ALPHA, b0 = PRIOR_BETA
    const { alpha: a, beta: b } = this.decayed(m, now)
    const credit = MasteryModel.effectiveCredit(o)
    const base = MasteryModel.modeWeight(o.mode)
    const retained = Math.pow(this.attemptRetention, base)
    const r: SkillMastery = { ...m }
    r.alpha = a0 + retained * (a - a0) + base * MasteryModel.successWeight(o.difficulty) * credit
    r.beta = b0 + retained * (b - b0) + base * MasteryModel.failureWeight(o.difficulty) * (1 - credit)
    r.attempts = incremented(m.attempts)
    // con un reloj atrasado no se retrocede la marca temporal
    r.lastPracticed = laterOf(now, m.lastPracticed ?? now)
    if (credit >= MasteryModel.successThreshold) {
      r.lastCorrect = laterOf(now, m.lastCorrect ?? now)
      r.streak = incremented(m.streak)
    } else {
      r.streak = 0
    }
    return r
  }

  /** Probabilidad (0…1) de resolver bien un ejercicio típico en `now` (media del posterior con olvido). */
  probability(m: SkillMastery, now: Date): number {
    const d = this.decayed(m, now)
    return clamp(d.alpha / (d.alpha + d.beta), 0, 1)
  }

  /** Confianza (0…1) según la evidencia acumulada: 0 sin datos, ≈ 0,63 con 5, ≈ 0,86 con 10. */
  confidence(m: SkillMastery): number {
    const a = finiteOr(m.alpha, PRIOR_ALPHA), b = finiteOr(m.beta, PRIOR_BETA)
    const n = Math.max(0, a + b - PRIOR_ALPHA - PRIOR_BETA)
    return clamp(1 - Math.exp(-n / 5), 0, 1)
  }

  /** Nivel en `now`: sin intentos → unseen; ≥ 90 % mastered; ≥ 75 % con ≥ 3 de evidencia solid; ≥ 55 % practicing. */
  level(m: SkillMastery, now: Date): MasteryLevel {
    if (!(m.attempts > 0)) return 'unseen'
    const p = this.probability(m, now)
    const evidence = this.effectiveEvidence(m, now)
    if (p >= 0.9) return 'mastered'
    if (p >= 0.75 && evidence >= 3) return 'solid'
    if (p >= 0.55) return 'practicing'
    return 'learning'
  }

  /** Intervalo de credibilidad (por defecto 80 %) de la probabilidad de dominio. */
  credibleInterval(m: SkillMastery, now: Date, level = 0.8): { low: number; high: number } {
    const d = this.decayed(m, now)
    const tail = (1 - clamp(level, 0.01, 0.999)) / 2
    return { low: BetaMath.quantile(tail, d.alpha, d.beta), high: BetaMath.quantile(1 - tail, d.alpha, d.beta) }
  }
}

function laterOf(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

// MARK: - JSON (mismo formato que la app Swift: las fechas ausentes se omiten)

export interface SkillMasteryJSON {
  alpha: number
  beta: number
  attempts: number
  lastPracticed?: string
  lastCorrect?: string
  streak: number
}

export function skillMasteryToJSON(m: SkillMastery): SkillMasteryJSON {
  const out: SkillMasteryJSON = { alpha: m.alpha, beta: m.beta, attempts: m.attempts, streak: m.streak }
  if (m.lastPracticed) out.lastPracticed = encodeSwiftDate(m.lastPracticed)
  if (m.lastCorrect) out.lastCorrect = encodeSwiftDate(m.lastCorrect)
  return out
}

/** Lee un estado guardado, tolerando claves ausentes (valores de `freshMastery`). */
export function skillMasteryFromJSON(v: unknown): SkillMastery {
  const f = freshMastery()
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return f
  const o = v as Record<string, unknown>
  const num = (x: unknown, d: number) => (typeof x === 'number' ? x : d)
  return {
    alpha: num(o.alpha, f.alpha),
    beta: num(o.beta, f.beta),
    attempts: Math.trunc(num(o.attempts, 0)),
    lastPracticed: decodeSwiftDate(o.lastPracticed),
    lastCorrect: decodeSwiftDate(o.lastCorrect),
    streak: Math.trunc(num(o.streak, 0))
  }
}
