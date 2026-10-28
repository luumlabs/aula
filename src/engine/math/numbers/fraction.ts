import { chars, isASCII, isDigit, trimWS } from '../core/text'
import { INT_MAX, INT_MIN, absBig, fitsInt, gcdBig } from './int64'

/**
 * Fracción exacta de enteros de 64 bits (como `Int` en Swift), siempre irreducible y con denominador positivo.
 *
 * Todas las operaciones aritméticas devuelven `null` si hay desbordamiento (nunca lanzan): quien llama decide si pasa a
 * `number` o informa del error. Internamente usa `bigint` pero respeta los límites de `Int` (−2⁶³ … 2⁶³−1).
 */
export class Fraction {
  /** Numerador (lleva el signo). */
  readonly num: bigint
  /** Denominador (siempre > 0). */
  readonly den: bigint

  private constructor(n: bigint, d: bigint) {
    this.num = n
    this.den = d
  }

  /** `n/d` reducida. `null` si `d == 0` o si el resultado no cabe en un `Int` (por ejemplo `Int.min / -1`). */
  static of(n: bigint | number, d: bigint | number = 1n): Fraction | null {
    const nb = typeof n === 'bigint' ? n : BigInt(n)
    const db = typeof d === 'bigint' ? d : BigInt(d)
    if (!fitsInt(nb) || !fitsInt(db)) return null
    const r = Fraction.normalized(nb, db)
    return r ? new Fraction(r[0], r[1]) : null
  }

  /** El entero `n` como fracción `n/1` (debe caber en un `Int`). */
  static int(n: bigint | number): Fraction {
    const nb = typeof n === 'bigint' ? n : BigInt(n)
    if (!fitsInt(nb)) throw new RangeError('Fraction.int: fuera del rango de Int')
    return new Fraction(nb, 1n)
  }

  static readonly ZERO = new Fraction(0n, 1n)
  static readonly ONE = new Fraction(1n, 1n)

  /** Constructor sin normalizar (el llamador garantiza que ya está reducida y con denominador > 0). */
  static unchecked(n: bigint, d: bigint): Fraction {
    return new Fraction(n, d)
  }

  // Reduce y normaliza el signo. `null` si `d == 0` o no es representable.
  private static normalized(n: bigint, d: bigint): [bigint, bigint] | null {
    if (d === 0n) return null
    if (n === 0n) return [0n, 1n]
    const g = gcdBig(n, d)
    const nm = absBig(n) / g
    const dm = absBig(d) / g
    if (dm > INT_MAX) return null
    const negative = n < 0n !== d < 0n
    if (negative) {
      if (nm === INT_MAX + 1n) return [INT_MIN, dm]
      if (nm > INT_MAX) return null
      return [-nm, dm]
    }
    if (nm > INT_MAX) return null
    return [nm, dm]
  }

  // MARK: Propiedades

  /** Valor aproximado como `number`. */
  get doubleValue(): number {
    return Number(this.num) / Number(this.den)
  }

  /** Numerador como `number` (aproximado si es enorme). */
  get numerator(): number {
    return Number(this.num)
  }

  /** Denominador como `number` (aproximado si es enorme). */
  get denominator(): number {
    return Number(this.den)
  }

  /** `true` si el denominador es 1. */
  get isInteger(): boolean {
    return this.den === 1n
  }

  /** `true` si vale cero. */
  get isZero(): boolean {
    return this.num === 0n
  }

  /** `true` si es menor que cero. */
  get isNegative(): boolean {
    return this.num < 0n
  }

  /** Signo: -1, 0 o 1. */
  get sign(): number {
    return this.num < 0n ? -1 : this.num > 0n ? 1 : 0
  }

  // MARK: Aritmética con detección de desbordamiento

  /** Opuesto (`null` solo para `Int.min`). */
  negated(): Fraction | null {
    const r = -this.num
    return fitsInt(r) ? new Fraction(r, this.den) : null
  }

  /** Valor absoluto (`null` solo para `Int.min`). */
  absolute(): Fraction | null {
    return this.num < 0n ? this.negated() : this
  }

  /** Inverso multiplicativo (`null` si es cero o no cabe). */
  reciprocal(): Fraction | null {
    if (this.num === 0n) return null
    return Fraction.of(this.den, this.num)
  }

  /** Suma. `null` si hay desbordamiento. */
  adding(o: Fraction): Fraction | null {
    const g = gcdBig(this.den, o.den)
    const bg = this.den / g
    const dg = o.den / g
    const t1 = this.num * dg
    const t2 = o.num * bg
    if (!fitsInt(t1) || !fitsInt(t2)) return null
    const num = t1 + t2
    if (!fitsInt(num)) return null
    const den = this.den * dg
    if (!fitsInt(den)) return null
    return Fraction.of(num, den)
  }

  /** Resta. `null` si hay desbordamiento. */
  subtracting(o: Fraction): Fraction | null {
    const neg = o.negated()
    return neg ? this.adding(neg) : null
  }

  /** Producto. `null` si hay desbordamiento. */
  multiplied(o: Fraction): Fraction | null {
    if (this.num === 0n || o.num === 0n) return Fraction.ZERO
    // Simplificación cruzada antes de multiplicar para evitar desbordamientos innecesarios.
    const g1 = gcdBig(this.num, o.den)
    const g2 = gcdBig(o.num, this.den)
    const a = this.num / g1
    const d = o.den / g1
    const c = o.num / g2
    const b = this.den / g2
    const num = a * c
    const den = b * d
    if (!fitsInt(num) || !fitsInt(den)) return null
    return Fraction.of(num, den)
  }

  /** Cociente. `null` si el divisor es cero o hay desbordamiento. */
  divided(o: Fraction): Fraction | null {
    const inv = o.reciprocal()
    return inv ? this.multiplied(inv) : null
  }

  /**
   * Potencia entera (exponente negativo = inverso). `null` si desborda o si es `0` elevado a un exponente negativo.
   * Por convención `x.power(0) == 1` para cualquier `x`.
   */
  power(e: bigint | number): Fraction | null {
    let exp = typeof e === 'bigint' ? e : BigInt(e)
    if (exp === 0n) return Fraction.ONE
    let base: Fraction
    if (exp < 0n) {
      const inv = this.reciprocal()
      if (!inv) return null
      base = inv
      exp = -exp
    } else {
      base = this
    }
    let result: Fraction = Fraction.ONE
    while (exp > 0n) {
      if ((exp & 1n) === 1n) {
        const r = result.multiplied(base)
        if (!r) return null
        result = r
      }
      exp >>= 1n
      if (exp > 0n) {
        const sq = base.multiplied(base)
        if (!sq) return null
        base = sq
      }
    }
    return result
  }

  /** Parte entera hacia abajo (suelo). */
  floorInt(): bigint {
    const q = this.num / this.den
    return this.num % this.den !== 0n && this.num < 0n ? q - 1n : q
  }

  /** Parte entera hacia arriba (techo). */
  ceilInt(): bigint {
    const q = this.num / this.den
    return this.num % this.den !== 0n && this.num > 0n ? q + 1n : q
  }

  // MARK: Comparación

  /** Igualdad exacta. */
  equals(o: Fraction | null | undefined): boolean {
    return !!o && this.num === o.num && this.den === o.den
  }

  /** Orden de los racionales (−1, 0, 1), sin desbordamiento. */
  compare(o: Fraction): number {
    const l = this.num * o.den
    const r = o.num * this.den
    return l < r ? -1 : l > r ? 1 : 0
  }

  /** `self < o`. */
  lt(o: Fraction): boolean {
    return this.compare(o) < 0
  }

  /** `self > o`. */
  gt(o: Fraction): boolean {
    return this.compare(o) > 0
  }

  /** ¿Es exactamente el entero `n`? */
  isInt(n: number | bigint): boolean {
    return this.den === 1n && this.num === (typeof n === 'bigint' ? n : BigInt(n))
  }

  /** Clave para conjuntos y diccionarios. */
  get key(): string {
    return `${this.num}/${this.den}`
  }

  // MARK: Texto

  /** LaTeX: `\frac{3}{4}`, `-\frac{3}{4}`, `5`. */
  get latex(): string {
    if (this.den === 1n) return String(this.num)
    const s = this.num < 0n ? '-' : ''
    return `${s}\\frac{${absBig(this.num)}}{${this.den}}`
  }

  /** Texto plano: `3/4`, `-3/4`, `5`. */
  get plain(): string {
    return this.den === 1n ? String(this.num) : `${this.num}/${this.den}`
  }

  toString(): string {
    return this.plain
  }

  // MARK: JSON (tolerante)

  /** Se guarda como `{"numerator": 3, "denominator": 4}`. */
  toJSON(): { numerator: number; denominator: number } {
    return { numerator: Number(this.num), denominator: Number(this.den) }
  }

  /** Acepta `{"numerator":3,"denominator":4}` (se normaliza), un entero, o un texto como `"3/4"` / `"0.75"`. Lanza si no. */
  static fromJSON(value: unknown): Fraction {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>
      const n = o.numerator
      if (typeof n === 'number' && Number.isInteger(n)) {
        const d = typeof o.denominator === 'number' && Number.isInteger(o.denominator) ? o.denominator : 1
        const f = Fraction.of(n, d)
        if (!f) throw new Error('Fracción no válida (denominador 0 o desbordamiento)')
        return f
      }
    }
    if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 2 ** 63) return Fraction.int(BigInt(value))
    if (typeof value === 'string') {
      const f = Fraction.parse(value)
      if (f) return f
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const f = Fraction.parse(String(value))
      if (f) return f
    }
    throw new Error('No se pudo leer una fracción')
  }

  // MARK: Lectura de texto

  /**
   * Lee un número racional escrito por una persona y lo devuelve **exacto** cuando es posible.
   *
   * Formatos: `"3/4"`, `"-2"`, `"0.75"`, `".5"`, `"1,5"` (coma decimal), `"2 1/2"` (número mixto; el signo afecta a todo
   * el número), `"1.2e-3"`, `"½"`, `"2½"`, `"1,234.5"` / `"1.234,5"` (separador de miles) y `"50%"`.
   * Devuelve `null` si el texto no es un racional o si no cabe exactamente en un `Int`.
   */
  static parse(s: string): Fraction | null {
    let t = cleanForParsing(s)
    if (t === '') return null
    // Porcentaje final: "50%" -> 50/100
    let percent = false
    if (t.endsWith('%')) {
      percent = true
      t = trimWS(t.slice(0, -1))
      if (t === '') return null
    }
    let value = parseNoPercent(t)
    if (!value) return null
    if (percent) {
      const v = value.divided(Fraction.int(100))
      if (!v) return null
      value = v
    }
    return value
  }

  /** Entero, decimal o científico: `-12`, `0.75`, `.5`, `5.`, `1,5`, `1.2e-3`, `1,234.5`. */
  static parseDecimal(str: string): Fraction | null {
    return parseDecimal(str)
  }
}

/** Fracciones Unicode comunes → texto "n/d". */
export const vulgarFractions: ReadonlyMap<string, string> = new Map([
  ['½', '1/2'], ['⅓', '1/3'], ['⅔', '2/3'], ['¼', '1/4'], ['¾', '3/4'],
  ['⅕', '1/5'], ['⅖', '2/5'], ['⅗', '3/5'], ['⅘', '4/5'], ['⅙', '1/6'], ['⅚', '5/6'],
  ['⅐', '1/7'], ['⅛', '1/8'], ['⅜', '3/8'], ['⅝', '5/8'], ['⅞', '7/8'], ['⅑', '1/9'], ['⅒', '1/10'],
])

const MINUS_LIKE = new Set(['−', '–', '—', '‒', '‐', '‑', '﹣', '－'])
const SPACE_LIKE = new Set([' ', ' ', ' ', ' ', ' ', ' ', '　', '\t', '\n', '\r'])
const INVISIBLE = new Set(['​', '‌', '‍', '﻿', '⁠', '­'])

// Limpia espacios raros, signos Unicode y fracciones vulgares.
function cleanForParsing(s: string): string {
  let out = ''
  let prevWasDigit = false
  for (const ch of chars(s)) {
    const f = vulgarFractions.get(ch)
    if (f !== undefined) {
      // "2½" = 2 + 1/2  → se convierte en "2 1/2"
      if (prevWasDigit) out += ' '
      out += f
      prevWasDigit = false
      continue
    }
    if (MINUS_LIKE.has(ch)) out += '-'
    else if (SPACE_LIKE.has(ch)) out += ' '
    else if (INVISIBLE.has(ch)) {
      // se quita
    } else if (ch === '⁄' || ch === '∕') out += '/'
    else out += ch
    prevWasDigit = isASCII(ch) && isDigit(ch)
  }
  return trimWS(out)
}

function parseNoPercent(raw: string): Fraction | null {
  // "3 / 4" → "3/4"; después, un número mixto como "2 1/2" queda en dos partes
  let t = raw
  while (t.includes(' /') || t.includes('/ ')) t = t.split(' /').join('/').split('/ ').join('/')
  // Número mixto: "2 1/2", "-2 1/2"
  const parts = t.split(' ').filter((p) => p !== '')
  if (parts.length === 2) {
    const whole = parts[0]
    const frac = parts[1]
    // la parte fraccionaria de un mixto es "n/d" con enteros sin signo
    const w = parseSimpleInteger(whole)
    if (w === null) return null
    if ([...frac].filter((c) => c === '/').length !== 1) return null
    if (![...frac].every((c) => isDigit(c) || c === '/')) return null
    const fr = parseSlash(frac)
    if (!fr) return null
    const neg = whole.startsWith('-')
    const absW = Fraction.of(absBig(w))
    const sum = absW ? absW.adding(fr) : null
    if (!sum) return null
    return neg ? sum.negated() : sum
  }
  if (parts.length !== 1) return null
  const s = parts[0]
  if (s.includes('/')) return parseSlash(s)
  return parseDecimal(s)
}

// "-3", "+3", "3" → entero (sin separadores).
function parseSimpleInteger(s: string): bigint | null {
  let body = s
  if (body.startsWith('-') || body.startsWith('+')) body = body.slice(1)
  if (body === '' || ![...body].every(isDigit)) return null
  const v = BigInt(body)
  if (v > INT_MAX) return null
  return s.startsWith('-') ? -v : v
}

// "a/b" con a y b decimales.
function parseSlash(s: string): Fraction | null {
  const pieces = s.split('/')
  if (pieces.length !== 2) return null
  const l = trimWS(pieces[0])
  const r = trimWS(pieces[1])
  if (l === '' || r === '') return null
  const a = parseDecimal(l)
  const b = parseDecimal(r)
  if (!a || !b) return null
  return a.divided(b)
}

function countOf(s: string, c: string): number {
  let n = 0
  for (const x of s) if (x === c) n++
  return n
}

function parseDecimal(str: string): Fraction | null {
  let s = str
  let negative = false
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  if (s === '') return null

  // Separa la parte científica.
  let mantissa = s
  let exponent = 0
  const eIdx = s.search(/[eE]/)
  if (eIdx >= 0) {
    mantissa = s.slice(0, eIdx)
    let expStr = s.slice(eIdx + 1)
    let expNeg = false
    if (expStr.startsWith('-')) {
      expNeg = true
      expStr = expStr.slice(1)
    } else if (expStr.startsWith('+')) expStr = expStr.slice(1)
    if (expStr === '' || expStr.length > 4 || ![...expStr].every(isDigit)) return null
    const ev = Number(expStr)
    exponent = expNeg ? -ev : ev
  }
  if (mantissa === '') return null

  // Separadores: decide cuál es el decimal.
  const dots = countOf(mantissa, '.')
  const commas = countOf(mantissa, ',')
  let intPart = ''
  let fracPart = ''
  if (dots === 0 && commas === 0) {
    intPart = mantissa
  } else if (dots > 0 && commas > 0) {
    // El último separador es el decimal; el otro es de miles.
    const decimalIsDot = mantissa.lastIndexOf('.') > mantissa.lastIndexOf(',')
    const thousands = decimalIsDot ? ',' : '.'
    const dec = decimalIsDot ? '.' : ','
    if (countOf(mantissa, dec) !== 1) return null
    const pieces = mantissa.split(dec)
    if (pieces.length !== 2 || !validThousands(pieces[0], thousands)) return null
    intPart = pieces[0].split(thousands).join('')
    fracPart = pieces[1]
    if (fracPart.includes(thousands)) return null
  } else {
    const sep = dots > 0 ? '.' : ','
    const count = Math.max(dots, commas)
    if (count === 1) {
      const pieces = mantissa.split(sep)
      intPart = pieces[0]
      fracPart = pieces.length > 1 ? pieces[1] : ''
    } else {
      // Varios separadores iguales: solo valen como separador de miles ("1,234,567").
      if (!validThousands(mantissa, sep)) return null
      intPart = mantissa.split(sep).join('')
    }
  }
  if (![...intPart].every(isDigit) || ![...fracPart].every(isDigit)) return null
  if (intPart === '' && fracPart === '') return null
  // Los ceros finales de la parte decimal no cambian el valor: "1.50000000000000000000" = 3/2 sin desbordar.
  fracPart = fracPart.replace(/0+$/, '')

  // Quita ceros a la izquierda para no desbordar con textos largos tipo "000000…1".
  const digits = (intPart + fracPart).replace(/^0+/, '')
  let numer = 0n
  if (digits !== '') {
    if (digits.length > 19) return null
    const v = BigInt(digits)
    if (v > INT_MAX) return null // Int(_:) devuelve nil si se desborda
    numer = v
  }
  let scale = -fracPart.length + exponent // valor = numer × 10^scale
  if (numer === 0n) return Fraction.ZERO
  let denom = 1n
  while (scale > 0) {
    numer *= 10n
    if (numer > INT_MAX) return null
    scale -= 1
  }
  while (scale < 0) {
    denom *= 10n
    if (denom > INT_MAX) return null
    scale += 1
  }
  return Fraction.of(negative ? -numer : numer, denom)
}

// ¿`text` es un número entero con separadores de miles bien colocados (grupos de 3)?
function validThousands(text: string, sep: string): boolean {
  const groups = text.split(sep)
  if (groups.length < 2) return groups.length === 1 && groups[0] !== ''
  const first = groups[0]
  if (first.length < 1 || first.length > 3 || ![...first].every(isDigit)) return false
  return groups.slice(1).every((g) => g.length === 3 && [...g].every(isDigit))
}
