import { Fraction } from '../numbers/fraction'
import { INT_MAX, INT_MIN, absBig } from '../numbers/int64'
import { roundHalfAwayFromZero, swiftPow } from './rounding'

/** Aritmética exacta auxiliar (raíces, logaritmos y redondeos racionales; combinatoria entera). */
export const Exact = {
  /**
   * Raíz entera exacta `k`-ésima de `n` ≥ 0, o `null` si no es potencia perfecta.
   * Coste acotado: con `n ≥ 2` y `k ≥ 63` no hay raíz entera (2⁶³ ya no cabe en un `Int`).
   */
  intRoot(n: bigint, k: bigint): bigint | null {
    if (n < 0n || k < 1n) return null
    if (n < 2n || k === 1n) return n
    if (k >= 63n) return null
    const kk = Number(k)
    const guess = BigInt(roundHalfAwayFromZero(swiftPow(Number(n), 1 / kk)))
    const lo = guess - 1n > 2n ? guess - 1n : 2n
    const hi = guess + 1n > 2n ? guess + 1n : 2n
    for (let c = lo; c <= hi; c++) {
      let acc = 1n
      let ok = true
      for (let i = 0; i < kk; i++) {
        const m = acc * c
        if (m > INT_MAX || m > n) {
          ok = false
          break
        }
        acc = m
      }
      if (ok && acc === n) return c
    }
    return null
  },

  /** `x^(power/index)` exacto cuando `x` tiene raíz `index`-ésima racional (admite base negativa con índice impar). */
  root(x: Fraction, power: bigint, index: bigint): Fraction | null {
    if (index < 1n) return null
    const negative = x.isNegative
    if (negative && index % 2n === 0n) return null
    if (x.num === INT_MIN) return null
    const rn = Exact.intRoot(absBig(x.num), index)
    const rd = Exact.intRoot(x.den, index)
    if (rn === null || rd === null) return null
    let root = Fraction.of(rn, rd)
    if (!root) return null
    if (negative) {
      root = root.negated()
      if (!root) return null
    }
    return root.power(power)
  },

  /** `log_b(x)` racional exacto (p. ej. log₂ 8 = 3, log₄ 2 = 1/2), o `null`. */
  log(b: Fraction, x: Fraction): Fraction | null {
    if (!(b.sign > 0) || b.equals(Fraction.ONE) || !(x.sign > 0)) return null
    if (x.equals(Fraction.ONE)) return Fraction.ZERO
    const r = Math.log(x.doubleValue) / Math.log(b.doubleValue)
    if (!Number.isFinite(r) || Math.abs(r) >= 64) return null
    for (let d = 1; d <= 6; d++) {
      const p = roundHalfAwayFromZero(r * d)
      if (!(Math.abs(r - p / d) < 1e-9)) continue
      const lhs = b.power(p)
      const rhs = x.power(d)
      if (lhs && rhs && lhs.equals(rhs)) return Fraction.of(p, d)
    }
    return null
  },

  /** Parte entera por redondeo «mitad lejos de cero». */
  roundHalfAway(q: Fraction): bigint {
    const half = Fraction.of(1, 2) as Fraction
    if (q.isNegative) {
      const a = q.negated()
      const s = a ? a.adding(half) : null
      if (!s) return BigInt(roundHalfAwayFromZero(q.doubleValue))
      return -s.floorInt()
    }
    const s = q.adding(half)
    if (!s) return BigInt(roundHalfAwayFromZero(q.doubleValue))
    return s.floorInt()
  },

  /** Redondeo a `places` decimales (mitad lejos de cero), exacto. */
  round(q: Fraction, places: bigint): Fraction | null {
    const ap = absBig(places)
    if (ap > 15n) return null
    const scale = Fraction.int(10).power(ap)
    if (!scale) return null
    const scaled = places >= 0n ? q.multiplied(scale) : q.divided(scale)
    if (!scaled) return null
    const r = Exact.roundHalfAway(scaled)
    if (r > INT_MAX || r < INT_MIN) return null
    const rounded = Fraction.int(r)
    return places >= 0n ? rounded.divided(scale) : rounded.multiplied(scale)
  },

  /** Combinaciones exactas C(n, k) (`null` si no caben en un `Int`). */
  combinations(n: bigint, k: bigint): bigint | null {
    if (n < 0n || k < 0n) return null
    if (k > n) return 0n
    const kk = k < n - k ? k : n - k
    let r = 1n
    for (let i = 1n; i <= kk; i++) {
      const m = r * (n - kk + i)
      if (m > INT_MAX) return null
      r = m / i // exacto: r·(n-kk+i) es divisible entre i
    }
    return r
  },

  /** Variaciones exactas P(n, k) (`null` si no caben en un `Int`). */
  permutations(n: bigint, k: bigint): bigint | null {
    if (n < 0n || k < 0n) return null
    if (k > n) return 0n
    let r = 1n
    for (let i = 0n; i < k; i++) {
      const m = r * (n - i)
      if (m > INT_MAX) return null
      r = m
    }
    return r
  },
}
