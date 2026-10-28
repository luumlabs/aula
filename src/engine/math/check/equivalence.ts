import { exprEquals, freeVariables, usesIntegerOnlyFunctions, type Expr } from '../core/expr'
import { sortedStrings } from '../core/text'
import type { AngleMode } from '../core/types'
import { tryEvaluateDouble } from '../eval/evaluate'
import { roundHalfAwayFromZero } from '../eval/rounding'
import { MathParser } from '../parse/parser'
import { DeterministicRNG } from '../random/rng'
import { ValueMatch } from './value-match'

/** Opciones de `MathEquivalence.equivalent`. */
export interface EquivalenceOptions {
  /** Variables a muestrear (por defecto, todas las libres de ambas expresiones). */
  variables?: readonly string[] | null
  /** Intervalo del que se toman los valores de cada variable (por defecto −6…6). */
  domain?: readonly [number, number]
  samples?: number
  relTol?: number
  absTol?: number
  angle?: AngleMode
}

/** Configuración del motor de muestreo. */
export interface EquivalenceConfig {
  vars: string[]
  domain: readonly [number, number]
  samples: number
  relTol: number
  absTol: number
  angle: AngleMode
  /** Muestrear solo enteros (para factoriales, combinatoria, mcd…). */
  integerPoints: boolean
  /** Un punto donde solo una expresión falla invalida la equivalencia. */
  strictDomain: boolean
  seed: bigint
}

export type EquivalenceVerdict = 'equivalent' | 'different' | 'domainMismatch' | 'notEnoughPoints'

export interface EquivalenceResult {
  verdict: EquivalenceVerdict
  /** Pares (valor de a, valor de b) en los puntos válidos para ambas. */
  pairs: Array<[number, number]>
  points: Array<Record<string, number>>
}

/** Configuración con los valores por defecto. */
export function equivalenceConfig(c: Partial<EquivalenceConfig> & { vars: string[] }): EquivalenceConfig {
  return {
    domain: [-6, 6],
    samples: 40,
    relTol: 1e-9,
    absTol: 1e-9,
    angle: 'radians',
    integerPoints: false,
    strictDomain: true,
    seed: 0x4d41544845514956n,
    ...c,
  }
}

/** Equivalencia numérica entre expresiones. */
export const MathEquivalence = {
  /**
   * Compara dos expresiones numéricamente en muchos puntos del dominio.
   *
   * - Evita las singularidades: los puntos donde **ambas** fallan se descartan.
   * - Si en un punto solo una de las dos falla (dominios distintos), **no** son equivalentes.
   * - Exige que al menos el 60 % de los `samples` puntos pedidos sean válidos.
   * - La diferencia debe ser ≤ `absTol' + relTol·max(|a|,|b|)`, con `absTol' = absTol·min(1, max|b|)`.
   */
  equivalent(a: Expr, b: Expr, options: EquivalenceOptions = {}): boolean {
    if (exprEquals(a, b)) return true
    const vars = options.variables
      ? sortedStrings(options.variables.map((v) => MathParser.canonicalVariableName(v)))
      : sortedStrings(new Set([...freeVariables(a), ...freeVariables(b)]))
    const config = equivalenceConfig({
      vars,
      domain: options.domain ?? [-6, 6],
      samples: Math.max(options.samples ?? 40, 1),
      relTol: options.relTol ?? 1e-9,
      absTol: options.absTol ?? 1e-9,
      angle: options.angle ?? 'radians',
    })
    config.integerPoints = usesIntegerOnlyFunctions(a) || usesIntegerOnlyFunctions(b)
    // Con factoriales y combinatoria se prueban enteros (que incluyen 0, 1…): un punto aislado donde solo una de las dos
    // expresiones existe (n!/(n-1)! en n = 0) no cuenta como dominio distinto.
    if (config.integerPoints) config.strictDomain = false
    return EquivalenceEngine.compare(a, b, config).verdict === 'equivalent'
  },
}

function closeTo(x: number, y: number, relTol: number, absTol: number): boolean {
  if (x === y) return true
  return Math.abs(x - y) <= absTol + relTol * Math.max(Math.abs(x), Math.abs(y))
}

function finiteOrNull(v: number | null): number | null {
  return v !== null && Number.isFinite(v) ? v : null
}

/** Escala de los pares (el mayor valor absoluto). */
function pairsScale(pairs: ReadonlyArray<[number, number]>): number {
  return pairs.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1])), 0)
}

/** Motor de muestreo compartido por `equivalent` y los verificadores (que lo usan para diagnosticar errores). */
export const EquivalenceEngine = {
  close: closeTo,

  /**
   * Margen absoluto proporcional al tamaño de la referencia (nunca mayor que `absTol`). Si la referencia es 0 en todas
   * partes, solo el ruido de coma flotante (`ValueMatch.zeroFloor`).
   */
  scaledAbsTol(absTol: number, scale: number): number {
    if (!(absTol > 0) || !Number.isFinite(scale)) return Math.max(0, Number.isFinite(absTol) ? absTol : 0)
    if (scale === 0) return Math.min(absTol, ValueMatch.zeroFloor)
    return absTol * Math.min(1, scale)
  },

  compare(a: Expr, b: Expr, c: EquivalenceConfig): EquivalenceResult {
    const pairs: Array<[number, number]> = []
    const points: Array<Record<string, number>> = []

    // Sin variables: una sola comparación.
    if (c.vars.length === 0) {
      const x = tryEvaluateDouble(a, {}, c.angle)
      const y = tryEvaluateDouble(b, {}, c.angle)
      if (x === null || y === null || !(Number.isFinite(x) || Number.isFinite(y))) {
        return { verdict: (x === null) === (y === null) ? 'notEnoughPoints' : 'domainMismatch', pairs: [], points: [] }
      }
      const tol = EquivalenceEngine.scaledAbsTol(c.absTol, Math.abs(y))
      const ok = x === y || (Number.isFinite(x) && Number.isFinite(y) && closeTo(x, y, c.relTol, tol))
      return { verdict: ok ? 'equivalent' : 'different', pairs: [[x, y]], points: [{}] }
    }

    const rng = new DeterministicRNG(c.seed)
    const needed = Math.ceil(c.samples * 0.6)
    const maxAttempts = Math.min(Math.max(c.samples, 2), 40) * 300
    let valid = 0
    let attempts = 0
    let verdict: EquivalenceVerdict = 'equivalent'
    const [lo, hi] = c.domain
    while (valid < c.samples && attempts < maxAttempts) {
      if (attempts >= 1500 && valid === 0) break // probablemente no está definida en ninguna parte
      attempts += 1
      const env: Record<string, number> = {}
      for (const v of c.vars) {
        let x = lo + (hi - lo) * rng.double()
        if (c.integerPoints) x = roundHalfAwayFromZero(x)
        env[v] = x
      }
      const fa = finiteOrNull(tryEvaluateDouble(a, env, c.angle))
      const fb = finiteOrNull(tryEvaluateDouble(b, env, c.angle))
      if (fa === null && fb === null) continue
      if (fa === null || fb === null) {
        // Dominios distintos. Si el otro valor es casi cero puede ser un artefacto del borde: se ignora el punto.
        const x = (fa ?? fb) as number
        if (Math.abs(x) <= 1e-7) continue
        if (c.strictDomain) return { verdict: 'domainMismatch', pairs, points }
        continue
      }
      pairs.push([fa, fb])
      points.push(env)
      valid += 1
      // Con el margen sin escalar (el mayor posible): si ya falla, falla seguro.
      if (!closeTo(fa, fb, c.relTol, c.absTol)) {
        if (c.strictDomain) return { verdict: 'different', pairs, points }
        verdict = 'different'
      }
    }
    // Con el margen escalado al tamaño de la referencia (b) en los puntos de prueba.
    if (verdict === 'equivalent') {
      const scale = pairs.reduce((m, p) => Math.max(m, Math.abs(p[1])), 0)
      const tol = EquivalenceEngine.scaledAbsTol(c.absTol, scale)
      if (pairs.some((p) => !closeTo(p[0], p[1], c.relTol, tol))) verdict = 'different'
    }
    if (verdict === 'different') return { verdict: 'different', pairs, points }
    if (valid < needed) return { verdict: 'notEnoughPoints', pairs, points }
    return { verdict, pairs, points }
  },

  // MARK: Relaciones entre pares de valores (para diagnosticar errores)

  /** ¿Se cumple `y ≈ f(x)` en todos los pares? */
  holds(pairs: ReadonlyArray<[number, number]>, f: (x: number) => number | null, tol = 1e-7): boolean {
    if (pairs.length < 3) return false
    const absTol = EquivalenceEngine.scaledAbsTol(tol, pairsScale(pairs))
    for (const [x, y] of pairs) {
      const expected = f(x)
      if (expected === null || !Number.isFinite(expected) || !closeTo(y, expected, tol, absTol)) return false
    }
    return true
  },

  /** Si `y/x` es una constante en todos los pares, la devuelve. */
  constantRatio(pairs: ReadonlyArray<[number, number]>, tol = 1e-7): number | null {
    if (pairs.length < 3) return null
    const zero = EquivalenceEngine.scaledAbsTol(1e-9, pairsScale(pairs))
    let ratio: number | null = null
    for (const [x, y] of pairs) {
      if (Math.abs(x) < zero) {
        if (Math.abs(y) < zero) continue
        return null
      }
      const r = y / x
      if (ratio !== null) {
        if (!closeTo(r, ratio, tol, tol)) return null
      } else ratio = r
    }
    return ratio
  },

  /** Si `y - x` es una constante en todos los pares, la devuelve. */
  constantDifference(pairs: ReadonlyArray<[number, number]>, tol = 1e-7): number | null {
    if (pairs.length < 3) return null
    const absTol = EquivalenceEngine.scaledAbsTol(tol, pairsScale(pairs))
    let diff: number | null = null
    for (const [x, y] of pairs) {
      const d = y - x
      if (diff !== null) {
        if (!closeTo(d, diff, tol, absTol)) return null
      } else diff = d
    }
    return diff
  },
}
