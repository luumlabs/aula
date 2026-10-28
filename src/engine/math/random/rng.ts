// Generador pseudoaleatorio determinista: la misma semilla produce la misma secuencia en cualquier máquina (y la misma que
// la app Swift). Algoritmo: xoshiro256** inicializado con splitmix64. Solo aritmética entera de 64 bits. No es criptográfico.

const MASK = (1n << 64n) - 1n

function u64(x: bigint): bigint {
  return x & MASK
}

function rotl(x: bigint, k: bigint): bigint {
  return u64((x << k) | (x >> (64n - k)))
}

/** Semilla aceptada: entero (se toma módulo 2⁶⁴). */
export type Seed = bigint | number

function toSeed(seed: Seed): bigint {
  if (typeof seed === 'bigint') return u64(seed)
  if (!Number.isFinite(seed)) return 0n
  return u64(BigInt(Math.trunc(seed)))
}

export class DeterministicRNG {
  private s0: bigint
  private s1: bigint
  private s2: bigint
  private s3: bigint

  /** Crea un generador a partir de una semilla. */
  constructor(seed: Seed) {
    let sm = toSeed(seed)
    const splitmix = (): bigint => {
      sm = u64(sm + 0x9e3779b97f4a7c15n)
      let z = sm
      z = u64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n)
      z = u64((z ^ (z >> 27n)) * 0x94d049bb133111ebn)
      return z ^ (z >> 31n)
    }
    this.s0 = splitmix()
    this.s1 = splitmix()
    this.s2 = splitmix()
    this.s3 = splitmix()
  }

  /** Siguiente número de 64 bits. */
  next(): bigint {
    const result = u64(rotl(u64(this.s1 * 5n), 7n) * 9n)
    const t = u64(this.s1 << 17n)
    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = rotl(this.s3, 45n)
    return result
  }

  /** Número real en `[0, 1)` con 53 bits de precisión. */
  double(): number {
    return Number(this.next() >> 11n) * (1.0 / 9_007_199_254_740_992.0)
  }

  /** Número real en el intervalo cerrado dado. */
  doubleIn(lower: number, upper: number): number {
    return lower + (upper - lower) * this.double()
  }

  /** Entero uniforme en `[lower, upper]` (sin sesgo de módulo). Los extremos son enteros de 64 bits. */
  intBig(lower: bigint, upper: bigint): bigint {
    const span = u64(BigInt.asUintN(64, upper - lower) + 1n)
    if (span === 0n) return BigInt.asIntN(64, this.next()) // rango completo
    const threshold = u64(0n - span) % span
    let x = this.next()
    while (x < threshold) x = this.next()
    return BigInt.asIntN(64, lower + (x % span))
  }

  /** Entero uniforme en `[lower, upper]` (enteros exactos de `number`). */
  int(lower: number, upper: number): number {
    return Number(this.intBig(BigInt(lower), BigInt(upper)))
  }

  /** Elemento al azar (`undefined` si el arreglo está vacío). */
  pick<T>(a: readonly T[]): T | undefined {
    if (a.length === 0) return undefined
    return a[this.int(0, a.length - 1)]
  }

  /** Copia barajada del arreglo (Fisher–Yates). */
  shuffle<T>(a: readonly T[]): T[] {
    const out = [...a]
    if (out.length <= 1) return out
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      const t = out[i]
      out[i] = out[j]
      out[j] = t
    }
    return out
  }

  /** `true` con probabilidad `p` (por defecto 0.5). */
  chance(p = 0.5): boolean {
    return this.double() < p
  }
}
