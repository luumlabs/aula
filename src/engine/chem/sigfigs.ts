// Cifras significativas: contar, redondear, reglas de operación y corrección de respuestas numéricas.
//
// Convenciones:
// - Coma decimal: «1,20» = 1.20 (3 cifras). Con punto y coma a la vez, el último es el decimal («1.234,5»). Varias
//   comas sin punto («1,200,000») son separadores de miles.
// - «1200» es ambiguo: se devuelve el rango 2…4; «1200.» (con punto) tiene 4; «1.200e3» tiene 4.
// - Notación científica: «1.20e3», «1.20E3», «1.20×10^3», «1.20 x 10³», «1.20·10^3», «1.20*10^-3», «1.20×10^(-3)».
// - El cero: «0» tiene 1 cifra; «0.00» se cuenta por sus decimales (2).

import type { ChemCheck, ChemCheckStatus } from './types'
import { L, isDecimalComma } from './l10n'
import { chars, exponentOf, isDigit, pow10, roundHalfAway, roundToSignificant, significant, SUPERSCRIPT_CHARS, trimAll, trimmed } from './text'

/** Cifras significativas de un número escrito. Un entero con ceros finales («1200») es ambiguo: 2…4. */
export class SigFigCount {
  constructor(
    readonly minimum: number,
    readonly maximum: number = minimum,
  ) {}

  /** `true` si no se puede saber con certeza («1200»). */
  get isAmbiguous(): boolean {
    return this.minimum !== this.maximum
  }

  /** Texto en español, fijo (lo usan los informes para la IA): «3» o «entre 2 y 4». */
  toString(): string {
    return this.isAmbiguous ? `entre ${this.minimum} y ${this.maximum}` : `${this.minimum}`
  }

  contains(n: number): boolean {
    return n >= this.minimum && n <= this.maximum
  }

  equals(o: SigFigCount | null | undefined): boolean {
    return !!o && o.minimum === this.minimum && o.maximum === this.maximum
  }

  toJSON(): { minimum: number; maximum: number } {
    return { minimum: this.minimum, maximum: this.maximum }
  }
}

/** Número leído de un texto, con la información de precisión con que se escribió. */
export interface WrittenNumber {
  readonly value: number
  /** Texto tal cual se leyó. */
  readonly text: string
  readonly sigFigs: SigFigCount
  /** Exponente de la última cifra escrita (0.00450 → -5; 12.5 → -1; 1200 → 0; 1.20e3 → 1). */
  readonly lastDigitExponent: number
  /** Decimales escritos (sin contar el exponente): «12.50» → 2. */
  readonly decimals: number
}

export function normalizedNumberText(text: string): string {
  let s = trimAll(text)
  for (const [a, b] of [['−', '-'], ['–', '-'], [' ', ' '], [' ', ' '], ['⋅', '·'], ['✕', '×']]) s = s.split(a).join(b)
  return s
}

/** «1,200», «12,500», «999.999»: de 1 a 3 cifras (sin cero inicial), el separador y exactamente 3 cifras. */
function isSingleThousandsGroup(raw: string, separator: string): boolean {
  const parts = raw.split(separator)
  if (parts.length !== 2) return false
  const [head, tail] = parts
  return head.length >= 1 && head.length <= 3 && head[0] !== '0' && /^\d+$/.test(head) && tail.length === 3 && /^\d+$/.test(tail)
}

/**
 * Lee un número que empieza en `start`. Devuelve el número y el índice siguiente. `thousands`: un único separador
 * (`,` o `.`) seguido de exactamente tres cifras se lee como separador de miles (1200) y no como decimal (1.2). Por
 * defecto, decimal: la lectura de siempre para los datos y las herramientas de la IA.
 */
export function readNumber(c: readonly string[], start: number, thousands: string | null = null): [WrittenNumber, number] | null {
  let i = start
  let negative = false
  if (i < c.length && (c[i] === '-' || c[i] === '+')) {
    negative = c[i] === '-'
    i++
  }
  const mantissaStart = i
  let raw = ''
  while (i < c.length && (isDigit(c[i]) || c[i] === '.' || c[i] === ',')) {
    // Una coma o punto final seguido de algo que no es dígito: termina el número (salvo «1200.»).
    if (c[i] === ',' || c[i] === '.') {
      const nextIsDigit = i + 1 < c.length && isDigit(c[i + 1])
      if (!nextIsDigit) {
        if (c[i] === '.' && raw.length > 0 && !raw.includes('.') && !raw.includes(',')) {
          raw += '.'
          i++
        }
        break
      }
    }
    raw += c[i++]
  }
  if (!/\d/.test(raw) || i <= mantissaStart) return null
  // Separadores decimales y de miles.
  const dots = raw.split('.').length - 1
  const commas = raw.split(',').length - 1
  let mantissa = raw
  if (dots > 0 && commas > 0) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) mantissa = raw.split('.').join('').split(',').join('.')
    else mantissa = raw.split(',').join('')
  } else if (commas > 1) {
    mantissa = raw.split(',').join('')
  } else if (commas === 1) {
    mantissa = thousands === ',' && isSingleThousandsGroup(raw, ',') ? raw.split(',').join('') : raw.split(',').join('.')
  } else if (dots > 1) {
    return null
  } else if (dots === 1 && thousands === '.' && isSingleThousandsGroup(raw, '.')) {
    mantissa = raw.split('.').join('')
  }
  // Exponente.
  let exponent = 0
  let j = i
  const readExponentDigits = (k0: number): [number, number] | null => {
    let k = k0
    while (k < c.length && c[k] === ' ') k++
    let sign = 1
    if (k < c.length && (c[k] === '-' || c[k] === '+')) {
      sign = c[k] === '-' ? -1 : 1
      k++
    }
    let digits = ''
    while (k < c.length && isDigit(c[k])) digits += c[k++]
    if (!digits || digits.length > 4) return null
    return [sign * Number(digits), k]
  }
  const readSuperscriptExponent = (k0: number): [number, number] | null => {
    let k = k0
    let text = ''
    while (k < c.length && SUPERSCRIPT_CHARS[c[k]] !== undefined) text += SUPERSCRIPT_CHARS[c[k++]]
    if (!text) return null
    const sign = text.startsWith('-') ? -1 : 1
    const ds = text.replace(/[^0-9]/g, '')
    if (!ds) return null
    const v = Number(ds)
    if (!(v < 10_000)) return null
    return [sign * v, k]
  }
  const e1 = j < c.length && (c[j] === 'e' || c[j] === 'E') ? readExponentDigits(j + 1) : null
  if (e1) {
    exponent = e1[0]
    j = e1[1]
  } else {
    let k = j
    while (k < c.length && c[k] === ' ') k++
    if (k < c.length && ['×', 'x', 'X', '*', '·'].includes(c[k])) {
      let m = k + 1
      while (m < c.length && c[m] === ' ') m++
      if (m + 1 < c.length && c[m] === '1' && c[m + 1] === '0') {
        const afterTen = m + 2
        if (afterTen < c.length && c[afterTen] === '^') {
          // «10^3», «10^{-3}» (TeX) y «10^(-3)» (calculadora).
          let p = afterTen + 1
          let closer: string | null = null
          if (p < c.length && (c[p] === '{' || c[p] === '(')) {
            closer = c[p] === '{' ? '}' : ')'
            p++
          }
          const r = readExponentDigits(p)
          if (r) {
            let q2 = r[1]
            if (closer) {
              while (q2 < c.length && c[q2] === ' ') q2++
              if (q2 < c.length && c[q2] === closer) q2++
              else return null
            }
            exponent = r[0]
            j = q2
          }
        } else {
          const r = readSuperscriptExponent(afterTen)
          if (r) {
            exponent = r[0]
            j = r[1]
          }
        }
      }
    }
  }
  // Cifras significativas sobre la mantisa.
  const hasPoint = mantissa.includes('.')
  const digits = mantissa.replace(/[^0-9]/g, '')
  const decimals = hasPoint ? (mantissa.split('.').pop() ?? '').length : 0
  const significantDigits = digits.replace(/^0+/, '')
  let sig: SigFigCount
  if (!significantDigits) {
    sig = new SigFigCount(Math.max(1, decimals))
  } else if (hasPoint) {
    sig = new SigFigCount(significantDigits.length)
  } else {
    const trailingZeros = significantDigits.length - significantDigits.replace(/0+$/, '').length
    sig = new SigFigCount(significantDigits.length - trailingZeros, significantDigits.length)
  }
  const mantText = mantissa.startsWith('.') ? '0' + mantissa : mantissa.endsWith('.') ? mantissa.slice(0, -1) : mantissa
  if (!/^\d+(\.\d+)?$/.test(mantText)) return null
  const mant = Number(mantText)
  const value = (negative ? -1 : 1) * mant * pow10(exponent)
  if (!Number.isFinite(value)) return null
  const text = c.slice(start, j).join('')
  return [{ value, text, sigFigs: sig, lastDigitExponent: exponent - decimals, decimals }, j]
}

/** Lee un número completo (el texto entero debe ser el número). */
export function parseWrittenNumber(text: string): WrittenNumber | null {
  const c = chars(normalizedNumberText(text))
  const r = readNumber(c, 0)
  if (!r) return null
  let k = r[1]
  while (k < c.length && c[k] === ' ') k++
  return k === c.length ? r[0] : null
}

/** Cuenta las cifras significativas de un número escrito. `null` si el texto no es un número. */
export const countSigFigs = (text: string): SigFigCount | null => parseWrittenNumber(text)?.sigFigs ?? null

const EXACT_SIGFIGS = Number.POSITIVE_INFINITY
const EXACT_LSD = Number.NEGATIVE_INFINITY

/**
 * Medida con su precisión, para encadenar operaciones con las reglas de cifras significativas (sumas: decimales;
 * productos: cifras). Los valores intermedios no se redondean.
 */
export class Measurement {
  private constructor(
    readonly value: number,
    /** Cifras significativas (`Infinity` para números exactos). */
    readonly sigFigs: number,
    /** Exponente de la última cifra significativa (`-Infinity` para números exactos). */
    readonly lastDigitExponent: number,
  ) {}

  /** Medida escrita («12.50», «1.2e-3»). Para un entero ambiguo («1200») se toman todas las cifras. */
  static of(text: string): Measurement | null {
    const n = parseWrittenNumber(text)
    return n ? new Measurement(n.value, n.sigFigs.maximum, n.lastDigitExponent) : null
  }

  /** Número exacto (contado o definido): no limita la precisión. */
  static exact(value: number): Measurement {
    return new Measurement(value, EXACT_SIGFIGS, EXACT_LSD)
  }

  private static fromSigFigs(value: number, sf: number): Measurement {
    if (sf === EXACT_SIGFIGS) return Measurement.exact(value)
    const e = exponentOf(value)
    const s = Math.max(1, sf)
    return new Measurement(value, s, e - s + 1)
  }

  private static fromLastDigit(value: number, lsd: number): Measurement {
    if (lsd === EXACT_LSD) return Measurement.exact(value)
    const e = exponentOf(value)
    const sf = value === 0 ? 1 : Math.max(1, e - lsd + 1)
    return new Measurement(value, sf, lsd)
  }

  mul(o: Measurement): Measurement {
    return Measurement.fromSigFigs(this.value * o.value, Math.min(this.sigFigs, o.sigFigs))
  }
  div(o: Measurement): Measurement {
    return Measurement.fromSigFigs(this.value / o.value, Math.min(this.sigFigs, o.sigFigs))
  }
  add(o: Measurement): Measurement {
    return Measurement.fromLastDigit(this.value + o.value, Math.max(this.lastDigitExponent, o.lastDigitExponent))
  }
  sub(o: Measurement): Measurement {
    return Measurement.fromLastDigit(this.value - o.value, Math.max(this.lastDigitExponent, o.lastDigitExponent))
  }

  /** Valor redondeado según su precisión. */
  get rounded(): number {
    return this.sigFigs === EXACT_SIGFIGS ? this.value : roundToSignificant(this.value, this.sigFigs)
  }
  /** Texto redondeado según su precisión. */
  get formatted(): string {
    return this.sigFigs === EXACT_SIGFIGS ? trimmed(this.value, 10) : significant(this.value, this.sigFigs)
  }
}

/** Cifras significativas: contar, redondear, reglas de operación y corrección. */
export const SigFigs = {
  count: countSigFigs,
  parse: parseWrittenNumber,
  /** Redondea a `sigFigs` cifras significativas. */
  round: (x: number, sigFigs: number): number => roundToSignificant(x, sigFigs),
  /** Texto con exactamente `sigFigs` cifras: (2.5, 3) → «2.50»; (1234, 2) → «1.2 × 10³». */
  format: (x: number, sigFigs: number): string => significant(x, sigFigs),

  /** Cifras significativas de un producto o cociente: las del dato con menos cifras. */
  sigFigsForProduct(values: readonly string[]): number | null {
    const counts = values.map((v) => countSigFigs(v)?.maximum ?? null)
    if (counts.some((c) => c === null) || counts.length === 0) return null
    return Math.min(...(counts as number[]))
  },

  /** Decimales de una suma o resta: los del dato con menos decimales (para números sin exponente). */
  decimalsForSum(values: readonly string[]): number | null {
    const parsed = values.map(parseWrittenNumber)
    if (parsed.some((p) => p === null) || parsed.length === 0) return null
    return Math.max(0, Math.min(...(parsed as WrittenNumber[]).map((p) => -p.lastDigitExponent)))
  },

  Measurement,

  /**
   * Comprueba una respuesta numérica del alumno («0.0450», «4.50e-2», «4,5·10^-2», con unidad detrás o no).
   * `requiredSigFigs`: cifras que corresponden según los datos (`null` = no se evalúan). Margen relativo por defecto 1 %.
   *
   * Separadores: «1,200» / «1.200» (un solo separador y tres cifras) es ambiguo. El separador decimal del alumno nunca es
   * de miles; el otro puede ser de miles (1200, la lectura preferida) o decimal (1,2), y vale la que dé la respuesta.
   */
  check(answer: string, expected: number, requiredSigFigs: number | null = null, relativeTolerance = 0.01): ChemCheck {
    const c = chars(normalizedNumberText(answer))
    const cannotRead: ChemCheck = {
      status: 'invalid',
      feedback: L('No encuentro un número en «%@». Escribe solo el resultado, por ejemplo 0.0450 o 4.50e-2.', answer),
    }
    const first = Number.isFinite(expected) ? readNumber(c, 0) : null
    if (!first) return cannotRead
    const [n, end] = first
    const otherSeparator = isDecimalComma() ? '.' : ','
    const alt = readNumber(c, 0, otherSeparator)
    if (alt && alt[0].value !== n.value) {
      const [thousands, end2] = alt
      const preferred = !trailingIsExpression(c, end) ? checkNumber(thousands, expected, requiredSigFigs, relativeTolerance) : null
      const other = !trailingIsExpression(c, end2) ? checkNumber(n, expected, requiredSigFigs, relativeTolerance) : null
      if (preferred && other) return rank(other.status) > rank(preferred.status) ? other : preferred
      if (preferred) return preferred
      if (other) return other
      return trailingGarbage()
    }
    if (trailingIsExpression(c, end)) return trailingGarbage()
    return checkNumber(n, expected, requiredSigFigs, relativeTolerance)
  },
}

/** Lo que ve el alumno cuando detrás del número hay una operación («2+2», «1/2», «1e»). */
function trailingGarbage(): ChemCheck {
  return { status: 'invalid', feedback: L('Escribe solo el resultado, sin operaciones: por ejemplo 0.0450 o 4.50e-2.') }
}

/**
 * ¿Detrás del número hay una operación o un exponente incompleto? «2+2», «1/2», «3·4», «2^3», «2(3)» y «1e» sí; texto
 * explicativo o una unidad compuesta («10 g de NaCl», «g/100 mL», «J mol-1 K-1», «g/cm^3», «m/s^2») no. Un operador
 * seguido de un número solo es una operación si antes hay otro número o un paréntesis cerrado.
 */
function trailingIsExpression(c: readonly string[], start: number): boolean {
  if (start >= c.length) return false
  let first = start
  while (first < c.length && c[first] === ' ') first++
  if (first >= c.length) return false
  // Exponente incompleto: «1e», «1e-».
  if (c[first] === 'e' || c[first] === 'E') {
    const next = first + 1
    if (next >= c.length || c[next] === '-' || c[next] === '+' || c[next] === '−') return true
  }
  // Una respuesta que empieza por operador («/2», «+3») no es un número.
  if (['+', '*', '/', '×', '·', '^', '=', '<', '>', '−'].includes(c[first])) return true
  const operators = new Set(['+', '-', '*', '/', '×', '·', '^', '=', '<', '>', '−'])
  for (let i = start; i < c.length; i++) {
    if (!operators.has(c[i])) continue
    let j = i + 1
    while (j < c.length && c[j] === ' ') j++
    if (j >= c.length) continue
    const after = c[j]
    if (!(isDigit(after) || after === '(')) continue
    // También el «^»: «2^3» es una potencia, pero «cm^3», «m/s^2» o «kg·m^2» son unidades.
    let k = i - 1
    while (k >= 0 && c[k] === ' ') k--
    if (k < 0) continue
    if (isDigit(c[k]) || c[k] === ')' || c[k] === ']') return true
  }
  // Multiplicación implícita: «2(3)». Un paréntesis sin cifras es una unidad o una aclaración: «0.25 (M)».
  if (c[first] === '(') {
    let k = first - 1
    while (k >= 0 && c[k] === ' ') k--
    if (k >= 0 && isDigit(c[k])) {
      let close = c.indexOf(')', first)
      if (close < 0) close = c.length
      if (c.slice(first + 1, close).some(isDigit)) return true
    }
  }
  return false
}

/** Orden entre dos lecturas del mismo texto (mayor = mejor). */
function rank(s: ChemCheckStatus): number {
  return s === 'correct' ? 3 : s === 'partial' ? 2 : s === 'incorrect' ? 1 : 0
}

/** Corrige un número ya leído. */
function checkNumber(n: WrittenNumber, expected: number, requiredSigFigs: number | null, relativeTolerance: number): ChemCheck {
  const tol = Math.max(Math.abs(expected) * relativeTolerance, 1e-300)
  const error = Math.abs(n.value - expected)
  const expectedText = significant(expected, requiredSigFigs ?? 4)
  const hint = hintFor(n.value, expected)
  /** Frase principal más la pista (otra frase completa), si la hay. */
  const withHint = (sentence: string): string => (hint ? sentence + ' ' + hint : sentence)
  if (requiredSigFigs === null) {
    if (error <= tol) return { status: 'correct', feedback: L('¡Correcto!') }
    return { status: 'incorrect', feedback: withHint(L('El valor no es correcto: debería salir ≈ %@.', expectedText)) }
  }
  const required = requiredSigFigs
  const roundedExpected = roundToSignificant(expected, required)
  const matchesRounding = Math.abs(n.value - roundedExpected) <= Math.max(Math.abs(roundedExpected) * 1e-9, 1e-300)
  const studentCount = n.sigFigs
  // ¿El valor es coherente con lo que escribió (redondeado a sus propias cifras)?
  const ownRounding = roundToSignificant(expected, Math.max(1, studentCount.maximum))
  const consistent =
    error <= tol ||
    Math.abs(n.value - ownRounding) <= Math.max(Math.abs(ownRounding) * 1e-9, 1e-300) ||
    (studentCount.isAmbiguous &&
      Math.abs(n.value - roundToSignificant(expected, Math.max(1, studentCount.minimum))) <= Math.abs(expected) * 1e-9 + 1e-300)
  const correctText = significant(expected, required)
  if (studentCount.contains(required)) {
    if (matchesRounding || error <= tol) {
      return { status: 'correct', feedback: L('¡Correcto! El valor y las cifras significativas (%lld) están bien.', required) }
    }
    return { status: 'incorrect', feedback: withHint(L('Las cifras significativas están bien, pero el valor no: debería salir %@.', correctText)) }
  }
  if (consistent) {
    if (studentCount.isAmbiguous) {
      return {
        status: 'partial',
        feedback: L(
          'El valor es correcto, pero con los datos dados corresponden %lld cifras significativas, no entre %lld y %lld (ambiguo): escribe %@.',
          required,
          studentCount.minimum,
          studentCount.maximum,
          correctText,
        ),
      }
    }
    return {
      status: 'partial',
      feedback: L('El valor es correcto, pero con los datos dados corresponden %lld cifras significativas, no %lld: escribe %@.', required, studentCount.minimum, correctText),
    }
  }
  return { status: 'incorrect', feedback: withHint(L('El valor no es correcto: debería salir %@ (%lld cifras significativas).', correctText, required)) }
}

/** Pista según el tipo de error (potencia de 10, signo…): una frase completa o «». */
function hintFor(got: number, expected: number): string {
  if (got === 0 || expected === 0) return ''
  const ratio = got / expected
  if (ratio < 0) return L('Revisa el signo.')
  const l = Math.log10(Math.abs(ratio))
  if (Math.abs(l - roundHalfAway(l)) < 0.01 && Math.abs(l) >= 0.99) {
    const power = roundHalfAway(l)
    const factor = (power > 0 ? '×' : '÷') + '10^' + String(Math.abs(power))
    return L('Parece un error de potencia de 10 (te sale %@): revisa las unidades o los prefijos (m, k…).', factor)
  }
  if (Math.abs(ratio - 2) < 0.02 || Math.abs(ratio - 0.5) < 0.01) return L('Te sale el doble o la mitad: revisa los coeficientes estequiométricos.')
  return ''
}
