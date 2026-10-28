import type { Expr } from '../core/expr'
import { StackGuard } from '../core/stack-guard'
import { Fraction } from '../numbers/fraction'
import { INT_MAX, INT_MIN, absBig, gcdBig } from '../numbers/int64'

const MAX_DEGREE = 60

/** Polinomio de una variable con coeficientes racionales exactos. Se usa para comprobar formas (factorizada, irreducible). */
export class Polynomial {
  /** `coeffs[i]` = coeficiente de x^i. Sin ceros finales; el polinomio cero es `[]`. */
  readonly coeffs: readonly Fraction[]

  static readonly maxDegree = MAX_DEGREE

  constructor(coeffs: readonly Fraction[]) {
    const c = [...coeffs]
    while (c.length > 0 && c[c.length - 1].isZero) c.pop()
    this.coeffs = c
  }

  static constant(f: Fraction): Polynomial {
    return new Polynomial([f])
  }

  static readonly x = new Polynomial([Fraction.ZERO, Fraction.ONE])

  get isZero(): boolean {
    return this.coeffs.length === 0
  }

  get degree(): number {
    return this.coeffs.length - 1
  }

  get leading(): Fraction {
    return this.coeffs[this.coeffs.length - 1] ?? Fraction.ZERO
  }

  equals(o: Polynomial): boolean {
    return this.coeffs.length === o.coeffs.length && this.coeffs.every((c, i) => c.equals(o.coeffs[i]))
  }

  // MARK: Extracción desde una expresión

  /** Interpreta `e` como polinomio en `variable`; `null` si no lo es (otras variables, funciones, divisiones por la variable…). */
  static from(e: Expr, variable: string, depth = 0): Polynomial | null {
    if (StackGuard.exhausted(depth)) return null
    switch (e.type) {
      case 'number':
        return Polynomial.constant(e.value)
      case 'variable':
        return e.name === variable ? Polynomial.x : null
      case 'unary': {
        if (e.op === 'neg') return Polynomial.from(e.arg, variable, depth + 1)?.scaled(Fraction.int(-1)) ?? null
        if (e.op === 'plus') return Polynomial.from(e.arg, variable, depth + 1)
        return null
      }
      case 'binary': {
        switch (e.op) {
          case 'add': {
            const p = Polynomial.from(e.left, variable, depth + 1)
            const q = p ? Polynomial.from(e.right, variable, depth + 1) : null
            return p && q ? p.adding(q) : null
          }
          case 'sub': {
            const p = Polynomial.from(e.left, variable, depth + 1)
            const q = p ? Polynomial.from(e.right, variable, depth + 1) : null
            const nq = q ? q.scaled(Fraction.int(-1)) : null
            return p && nq ? p.adding(nq) : null
          }
          case 'mul': {
            const p = Polynomial.from(e.left, variable, depth + 1)
            const q = p ? Polynomial.from(e.right, variable, depth + 1) : null
            return p && q ? p.multiplied(q) : null
          }
          case 'div': {
            const p = Polynomial.from(e.left, variable, depth + 1)
            const q = p ? Polynomial.from(e.right, variable, depth + 1) : null
            if (!p || !q || q.degree !== 0) return null
            const inv = q.leading.reciprocal()
            return inv ? p.scaled(inv) : null
          }
          case 'pow': {
            if (e.right.type !== 'number') return null
            const k = e.right.value
            if (!k.isInteger || k.num < 0n || k.num > BigInt(MAX_DEGREE)) return null
            const p = Polynomial.from(e.left, variable, depth + 1)
            return p ? p.power(Number(k.num)) : null
          }
          default:
            return null
        }
      }
      default:
        return null
    }
  }

  // MARK: Aritmética (null si desborda)

  scaled(f: Fraction): Polynomial | null {
    const out: Fraction[] = []
    for (const c of this.coeffs) {
      const m = c.multiplied(f)
      if (!m) return null
      out.push(m)
    }
    return new Polynomial(out)
  }

  adding(o: Polynomial): Polynomial | null {
    const out: Fraction[] = []
    const n = Math.max(this.coeffs.length, o.coeffs.length)
    for (let i = 0; i < n; i++) {
      const a = this.coeffs[i] ?? Fraction.ZERO
      const b = o.coeffs[i] ?? Fraction.ZERO
      const s = a.adding(b)
      if (!s) return null
      out.push(s)
    }
    return new Polynomial(out)
  }

  multiplied(o: Polynomial): Polynomial | null {
    if (this.isZero || o.isZero) return new Polynomial([])
    if (this.degree + o.degree > MAX_DEGREE) return null
    const out: Fraction[] = new Array<Fraction>(this.degree + o.degree + 1).fill(Fraction.ZERO)
    for (let i = 0; i < this.coeffs.length; i++) {
      for (let j = 0; j < o.coeffs.length; j++) {
        const m = this.coeffs[i].multiplied(o.coeffs[j])
        const s = m ? out[i + j].adding(m) : null
        if (!s) return null
        out[i + j] = s
      }
    }
    return new Polynomial(out)
  }

  power(n: number): Polynomial | null {
    let result = Polynomial.constant(Fraction.ONE)
    for (let i = 0; i < n; i++) {
      const r = result.multiplied(this)
      if (!r) return null
      result = r
    }
    return result
  }

  /** División con resto: `self = q·o + r`. */
  divided(o: Polynomial): { quotient: Polynomial; remainder: Polynomial } | null {
    if (o.isZero) return null
    let rem: Polynomial = this
    const quotient: Fraction[] = new Array<Fraction>(Math.max(this.degree - o.degree + 1, 0)).fill(Fraction.ZERO)
    while (!rem.isZero && rem.degree >= o.degree) {
      const factor = rem.leading.divided(o.leading)
      if (!factor) return null
      const shift = rem.degree - o.degree
      quotient[shift] = factor
      const sub: Fraction[] = new Array<Fraction>(shift).fill(Fraction.ZERO)
      for (const c of o.coeffs) {
        const m = c.multiplied(factor)
        if (!m) return null
        sub.push(m)
      }
      const neg = new Polynomial(sub).scaled(Fraction.int(-1))
      const next = neg ? rem.adding(neg) : null
      if (!next) return null
      rem = next
    }
    return { quotient: new Polynomial(quotient), remainder: rem }
  }

  /** Máximo común divisor (mónico) por el algoritmo de Euclides. */
  static gcd(a: Polynomial, b: Polynomial): Polynomial | null {
    let x = a
    let y = b
    let guardCount = 0
    while (!y.isZero) {
      const d = x.divided(y)
      if (!d) return null
      x = y
      y = d.remainder
      guardCount += 1
      if (guardCount > 200) return null
    }
    if (x.isZero) return x
    const inv = x.leading.reciprocal()
    if (!inv) return x
    return x.scaled(inv)
  }

  evaluate(at: Fraction): Fraction | null {
    let acc: Fraction = Fraction.ZERO
    for (let i = this.coeffs.length - 1; i >= 0; i--) {
      const m = acc.multiplied(at)
      const s = m ? m.adding(this.coeffs[i]) : null
      if (!s) return null
      acc = s
    }
    return acc
  }

  // MARK: Contenido y raíces racionales

  /** Polinomio con coeficientes enteros primitivos (mismo conjunto de raíces) y el contenido extraído. */
  integerPrimitive(): { poly: bigint[]; content: bigint } | null {
    if (this.isZero) return null
    let lcm = 1n
    for (const c of this.coeffs) {
      const g = gcdBig(lcm, c.den)
      const m = (lcm / g) * c.den
      if (m > INT_MAX) return null
      lcm = m
    }
    const ints: bigint[] = []
    for (const c of this.coeffs) {
      const m = c.num * (lcm / c.den)
      if (m > INT_MAX || m < INT_MIN) return null
      ints.push(m)
    }
    let g = 0n
    for (const i of ints) g = gcdBig(g, i)
    if (!(g > 0n)) return null
    return { poly: ints.map((i) => i / g), content: g }
  }

  /** ¿Tiene alguna raíz racional? (teorema de la raíz racional). `null` si no se pudo decidir. */
  hasRationalRoot(): boolean | null {
    if (this.isZero) return true
    if (this.degree < 1) return false
    const ip = this.integerPrimitive()
    if (!ip) return null
    const ints = ip.poly
    if (ints[0] === 0n) return true
    const a0 = absBig(ints[0])
    const an = absBig(ints[ints.length - 1])
    if (!(a0 < 5_000_000n && an < 5_000_000n)) return null
    const divisors = (n: number): number[] => {
      const out: number[] = []
      for (let i = 1; i * i <= n; i++) {
        if (n % i === 0) {
          out.push(i)
          if (i !== n / i) out.push(n / i)
        }
      }
      return out
    }
    const ps = divisors(Number(a0))
    const qs = divisors(Number(an))
    if (ps.length * qs.length > 20_000) return null
    for (const p of ps) {
      for (const q of qs) {
        for (const sign of [1, -1]) {
          const r = Fraction.of(sign * p, q)
          const v = r ? this.evaluate(r) : null
          if (!v) return null
          if (v.isZero) return true
        }
      }
    }
    return false
  }

  // MARK: Raíces reales (Sturm)

  /** Derivada formal. `null` si algún coeficiente no cabe en `Int`. */
  get derivative(): Polynomial | null {
    if (this.degree <= 0) return new Polynomial([Fraction.ZERO])
    const out: Fraction[] = []
    for (let i = 1; i < this.coeffs.length; i++) {
      const m = this.coeffs[i].multiplied(Fraction.int(i))
      if (!m) return null
      out.push(m)
    }
    return new Polynomial(out)
  }

  /**
   * Parte libre de cuadrados `p / mcd(p, p')`: el mismo conjunto de raíces, todas simples.
   * `null` si el polinomio es cero o si la aritmética exacta no cabe.
   */
  squareFreePart(): Polynomial | null {
    if (this.degree <= 0) return this
    const d = this.derivative
    if (!d || d.isZero) return null
    const g = Polynomial.gcd(this, d)
    if (!g || g.isZero) return null
    return this.divided(g)?.quotient ?? null
  }

  /**
   * Número de raíces reales **distintas** (la multiplicidad no cuenta), con el teorema de Sturm.
   * `null` si el polinomio es cero o si la secuencia de Sturm no cabe en la aritmética exacta.
   */
  realRootCount(): number | null {
    if (this.isZero) return null
    if (this.degree <= 0) return 0
    const d = this.derivative
    if (!d || d.isZero) return 0
    const chain: Polynomial[] = [this, d]
    for (;;) {
      const last = chain[chain.length - 1]
      const div = chain[chain.length - 2].divided(last)
      if (!div) return null
      const next = div.remainder.scaled(Fraction.int(-1))
      if (!next) return null
      if (next.isZero) break
      chain.push(next)
      if (chain.length > 400) return null
    }
    /** Cambios de signo de la secuencia en +∞ o −∞ (el signo en −∞ cambia con el grado impar). */
    const variations = (atMinusInfinity: boolean): number => {
      const signs: number[] = []
      for (const p of chain) {
        let s = p.leading.sign
        if (atMinusInfinity && p.degree % 2 === 1) s = -s
        if (s !== 0) signs.push(s)
      }
      if (signs.length <= 1) return 0
      let v = 0
      for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) v += 1
      return v
    }
    return variations(true) - variations(false)
  }
}
