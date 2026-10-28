// Generador pseudoaleatorio determinista (SplitMix64) y semillas a partir de texto (FNV-1a de 64 bits).
//
// Misma secuencia que la versión Swift con la misma semilla (aritmética de 64 bits sin signo con BigInt): los simulacros, el
// sorteo de ejercicios y el «fuzz» de intervalos son reproducibles entre la app Swift y esta.

const MASK64 = (1n << 64n) - 1n
const GOLDEN = 0x9e3779b97f4a7c15n
const MIX1 = 0xbf58476d1ce4e5b9n
const MIX2 = 0x94d049bb133111ebn
const TWO_POW_53 = 9_007_199_254_740_992

/** Semilla: `bigint` (64 bits sin signo) o un entero de JavaScript (se trunca y se toma módulo 2⁶⁴). */
export type Seed = bigint | number

export function toSeed(seed: Seed): bigint {
  if (typeof seed === 'bigint') return BigInt.asUintN(64, seed)
  if (!Number.isFinite(seed)) return 0n
  return BigInt.asUintN(64, BigInt(Math.trunc(seed)))
}

export class SplitMix64 {
  private state: bigint

  constructor(seed: Seed) {
    this.state = toSeed(seed)
  }

  /** Mezcla dos valores en una semilla nueva (flujos independientes: sección 3, ejercicio 7…). */
  static withStream(seed: Seed, stream: number): SplitMix64 {
    const s = BigInt.asUintN(64, BigInt.asUintN(64, BigInt(Math.trunc(stream))) * GOLDEN)
    const g = new SplitMix64(BigInt.asUintN(64, toSeed(seed) + s))
    // dos descartes para decorrelacionar semillas consecutivas
    g.next()
    g.next()
    return g
  }

  next(): bigint {
    this.state = (this.state + GOLDEN) & MASK64
    let z = this.state
    z = ((z ^ (z >> 30n)) * MIX1) & MASK64
    z = ((z ^ (z >> 27n)) * MIX2) & MASK64
    return z ^ (z >> 31n)
  }

  /** Número en [0, 1) con 53 bits de precisión. */
  nextUnit(): number {
    return Number(this.next() >> 11n) * (1 / TWO_POW_53)
  }

  /** Entero uniforme en 0..<n (multiplicación de 128 bits). 0 si n <= 1. */
  nextInt(n: number): number {
    if (!(n > 1)) return 0
    return Number((this.next() * BigInt(Math.floor(n))) >> 64n)
  }

  /** Baraja (Fisher–Yates) de forma determinista. */
  shuffled<T>(array: readonly T[]): T[] {
    const a = array.slice()
    if (a.length <= 1) return a
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1)
      if (i !== j) {
        const t = a[i]
        a[i] = a[j]
        a[j] = t
      }
    }
    return a
  }

  /** Índice elegido con probabilidad proporcional a `weights` (no positivos o no finitos cuentan 0). Si todos son 0,
   *  uniforme. `null` si está vacío. */
  weightedIndex(weights: readonly number[]): number | null {
    if (weights.length === 0) return null
    const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
    const total = clean.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return this.nextInt(weights.length)
    let target = this.nextUnit() * total
    for (let i = 0; i < clean.length; i++) {
      const w = clean[i]
      if (w <= 0) continue
      if (target < w) return i
      target -= w
    }
    for (let i = clean.length - 1; i >= 0; i--) if (clean[i] > 0) return i
    return null
  }
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

/** Semilla estable a partir de un texto (FNV-1a de 64 bits sobre su UTF-8), p. ej. «id de tarjeta + nº de repasos». */
export function learnKitSeed(text: string): bigint {
  let h = FNV_OFFSET
  for (const b of new TextEncoder().encode(text)) {
    h ^= BigInt(b)
    h = (h * FNV_PRIME) & MASK64
  }
  return h
}
