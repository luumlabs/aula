// Aritmética exacta: números racionales con enteros grandes (`bigint`) y álgebra lineal exacta para balancear.
// La app Swift usaba `Int` con comprobación de desbordamiento y repetía con su propio BigInt; aquí todo es `bigint`:
// nunca se desborda ni pierde precisión.

const abs = (x: bigint): bigint => (x < 0n ? -x : x)

/** Máximo común divisor (no negativo). */
export function bigGcd(a: bigint, b: bigint): bigint {
  let x = abs(a)
  let y = abs(b)
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

/** Mínimo común múltiplo (no negativo). */
export function bigLcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n
  return (abs(a) / bigGcd(a, b)) * abs(b)
}

/** `bigint` a `number` si es un entero exacto representable; si no, `null`. */
export function bigToSafeNumber(x: bigint): number | null {
  return x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(x) : null
}

const UNICODE_FRACTIONS: Readonly<Record<string, readonly [number, number]>> = {
  '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅖': [2, 5],
  '⅗': [3, 5], '⅘': [4, 5], '⅙': [1, 6], '⅚': [5, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
}

/** Entero estilo `Int(texto)` de Swift en `bigint`: signo opcional y cifras. */
function parseBigInt(t: string): bigint | null {
  return /^[+-]?\d+$/.test(t) ? BigInt(t) : null
}

/**
 * Número racional exacto y reducido (denominador siempre positivo). Se usa para coeficientes (`1/2 O2`) y números de
 * oxidación promedio (Fe₃O₄ → +8/3).
 */
export class Rational {
  readonly num: bigint
  readonly den: bigint

  private constructor(num: bigint, den: bigint) {
    this.num = num
    this.den = den
  }

  /** Fracción reducida; `null` si el denominador es 0. */
  static of(numerator: number | bigint, denominator: number | bigint = 1): Rational | null {
    const n = typeof numerator === 'bigint' ? numerator : BigInt(Math.trunc(numerator))
    const d = typeof denominator === 'bigint' ? denominator : BigInt(Math.trunc(denominator))
    if (d === 0n) return null
    if (n === 0n) return Rational.ZERO
    const sign = d < 0n ? -1n : 1n
    const g = bigGcd(n, d)
    return new Rational((sign * n) / g, (sign * d) / g)
  }

  /** Entero exacto. */
  static int(n: number | bigint): Rational {
    return new Rational(typeof n === 'bigint' ? n : BigInt(Math.trunc(n)), 1n)
  }

  static readonly ZERO = new Rational(0n, 1n)
  static readonly ONE = new Rational(1n, 1n)

  get isInteger(): boolean {
    return this.den === 1n
  }
  get isZero(): boolean {
    return this.num === 0n
  }
  get sign(): number {
    return this.num === 0n ? 0 : this.num > 0n ? 1 : -1
  }
  /** Numerador y denominador como `number` (para mostrar o calcular en coma flotante). */
  get numerator(): number {
    return Number(this.num)
  }
  get denominator(): number {
    return Number(this.den)
  }
  /** Valor en coma flotante. */
  toNumber(): number {
    return Number(this.num) / Number(this.den)
  }
  /** Valor entero si lo es (y cabe en un `number` exacto). */
  get intValue(): number | null {
    return this.den === 1n ? bigToSafeNumber(this.num) : null
  }

  /** «3», «-2», «1/2», «-8/3». */
  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`
  }
  /** Con signo explícito, como los números de oxidación: «+7», «-2», «0», «+8/3». */
  signedString(): string {
    if (this.num === 0n) return '0'
    return (this.num > 0n ? '+' : '') + this.toString()
  }
  /** LaTeX: `\frac{1}{2}` o el entero. */
  latex(): string {
    if (this.den === 1n) return this.num.toString()
    return (this.num < 0n ? '-' : '') + `\\frac{${abs(this.num)}}{${this.den}}`
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den) as Rational
  }
  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den) as Rational
  }
  mul(o: Rational | number): Rational {
    const r = typeof o === 'number' ? Rational.int(o) : o
    return Rational.of(this.num * r.num, this.den * r.den) as Rational
  }
  /** `null` si se divide entre 0. */
  div(o: Rational | number): Rational | null {
    const r = typeof o === 'number' ? Rational.int(o) : o
    if (r.num === 0n) return null
    return Rational.of(this.num * r.den, this.den * r.num)
  }
  neg(): Rational {
    return new Rational(-this.num, this.den)
  }
  abs(): Rational {
    return this.num < 0n ? this.neg() : this
  }

  compare(o: Rational): number {
    const l = this.num * o.den
    const r = o.num * this.den
    return l < r ? -1 : l > r ? 1 : 0
  }
  equals(o: Rational | null | undefined): boolean {
    return !!o && this.num === o.num && this.den === o.den
  }
  lt(o: Rational): boolean {
    return this.compare(o) < 0
  }
  gt(o: Rational): boolean {
    return this.compare(o) > 0
  }

  /** Lee «3», «-2», «1/2», «0.5», «1,5», «½», «1½». `null` si no es un número racional sencillo. */
  static parse(text: string): Rational | null {
    const t = text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '').split(',').join('.')
    if (!t) return null
    const uf = Rational.parseUnicodeFraction(t)
    if (uf) return uf
    const slash = t.indexOf('/')
    if (slash >= 0) {
      const n = parseBigInt(t.slice(0, slash).trim())
      const d = parseBigInt(t.slice(slash + 1).trim())
      if (n === null || d === null) return null
      return Rational.of(n, d)
    }
    const whole = parseBigInt(t)
    if (whole !== null) return Rational.int(whole)
    // Decimal finito: «0.25» → 1/4.
    const parts = t.split('.')
    if (parts.length !== 2) return null
    const [intPart, fracPart] = parts
    if (!fracPart || fracPart.length > 9 || !/^\d+$/.test(fracPart)) return null
    const negative = intPart.startsWith('-')
    const digits = negative || intPart.startsWith('+') ? intPart.slice(1) : intPart
    if (digits && !/^\d+$/.test(digits)) return null
    const w = BigInt(digits || '0')
    const scale = 10n ** BigInt(fracPart.length)
    const n = w * scale + BigInt(fracPart)
    return Rational.of(negative ? -n : n, scale)
  }

  private static parseUnicodeFraction(t: string): Rational | null {
    const cs = Array.from(t)
    const last = cs[cs.length - 1]
    const f = UNICODE_FRACTIONS[last]
    if (!f) return null
    const whole = cs.slice(0, -1).join('')
    if (!whole) return Rational.of(f[0], f[1])
    const w = parseBigInt(whole)
    if (w === null || w < 0n || w >= 1_000_000n) return null
    return Rational.of(w * BigInt(f[1]) + BigInt(f[0]), f[1])
  }

  /** JSON: `{ numerator, denominator }` (como la app Swift). */
  toJSON(): { numerator: number; denominator: number } {
    return { numerator: this.numerator, denominator: this.denominator }
  }

  /** Lee el JSON validando el denominador (un 0 no puede colarse). */
  static fromJSON(v: unknown): Rational {
    const o = v as { numerator?: unknown; denominator?: unknown }
    const n = o?.numerator
    const d = o?.denominator ?? 1
    if (typeof n !== 'number' || typeof d !== 'number' || !Number.isInteger(n) || !Number.isInteger(d)) {
      throw new Error('Rational no válido')
    }
    const r = Rational.of(n, d)
    if (!r) throw new Error('Denominador no válido')
    return r
  }
}

// MARK: Álgebra lineal exacta

/** Fracción interna reducida, con denominador positivo. */
interface Frac {
  n: bigint
  d: bigint
}

const frac = (n: bigint, d: bigint = 1n): Frac => {
  if (n === 0n) return { n: 0n, d: 1n }
  const s = d < 0n ? -1n : 1n
  const g = bigGcd(n, d)
  return { n: (s * n) / g, d: (s * d) / g }
}
const fSub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d)
const fMul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d)
const fDiv = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n)

/** Resultado: rango y base entera primitiva del espacio nulo (un vector por columna libre). */
export interface NullSpace {
  rank: number
  basis: bigint[][]
}

/** Espacio nulo exacto de una matriz entera `filas × columnas` (eliminación de Gauss-Jordan en fracciones). */
export function nullSpace(matrix: readonly (readonly (number | bigint)[])[], columns: number): NullSpace {
  const a: Frac[][] = matrix.map((row) => row.map((x) => frac(typeof x === 'bigint' ? x : BigInt(x))))
  const pivotColumns: number[] = []
  let row = 0
  for (let col = 0; col < columns; col++) {
    if (row >= a.length) break
    let p = -1
    for (let r = row; r < a.length; r++) {
      if (a[r][col].n !== 0n) {
        p = r
        break
      }
    }
    if (p < 0) continue
    if (p !== row) [a[row], a[p]] = [a[p], a[row]]
    const pivot = a[row][col]
    for (let c = col; c < columns; c++) a[row][c] = fDiv(a[row][c], pivot)
    for (let r = 0; r < a.length; r++) {
      if (r === row || a[r][col].n === 0n) continue
      const f = a[r][col]
      for (let c = col; c < columns; c++) {
        if (a[row][c].n !== 0n) a[r][c] = fSub(a[r][c], fMul(f, a[row][c]))
      }
    }
    pivotColumns.push(col)
    row++
  }
  const pivotSet = new Set(pivotColumns)
  const basis: bigint[][] = []
  for (let free = 0; free < columns; free++) {
    if (pivotSet.has(free)) continue
    const v: Frac[] = Array.from({ length: columns }, () => frac(0n))
    v[free] = frac(1n)
    pivotColumns.forEach((pc, i) => {
      const x = a[i][free]
      v[pc] = { n: -x.n, d: x.d }
    })
    basis.push(primitive(v))
  }
  return { rank: pivotColumns.length, basis }
}

/** Multiplica por el mcm de los denominadores y divide entre el mcd: vector entero primitivo. */
function primitive(v: Frac[]): bigint[] {
  let l = 1n
  for (const x of v) if (x.n !== 0n) l = bigLcm(l, x.d)
  let ints = v.map((x) => x.n * (l / x.d))
  let g = 0n
  for (const x of ints) g = bigGcd(g, x)
  if (g !== 0n && g !== 1n) ints = ints.map((x) => x / g)
  return ints
}

/** Producto matriz · vector en enteros grandes (para comprobar soluciones). */
export function multiplyMatrixVector(matrix: readonly (readonly (number | bigint)[])[], vector: readonly bigint[]): bigint[] {
  return matrix.map((row) => {
    let s = 0n
    row.forEach((c, j) => {
      const b = typeof c === 'bigint' ? c : BigInt(c)
      if (b !== 0n && j < vector.length) s += b * vector[j]
    })
    return s
  })
}
