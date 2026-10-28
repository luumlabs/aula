import { tr } from '../core/i18n'
import type { MathValue } from '../core/types'
import { DecimalDigits, decimalString } from './decimal-digits'

/** Cifras significativas que se muestran cuando no se indica el número de decimales. */
const CLEAN_FIGURES = 12

/** Tope de cifras que se piden a los formateadores (más de 40 no tiene sentido y cantidades absurdas colgaban la app). */
export const MAX_DIGITS = 40

function special(x: number): string | null {
  if (Number.isNaN(x)) return NumberFormat.undefinedWord
  if (!Number.isFinite(x)) return x < 0 ? '-∞' : '∞'
  return null
}

/**
 * Formato de números para la interfaz y las plantillas. Redondea «como en la escuela» (mitad hacia arriba) sobre el
 * decimal más corto del número, así `2.675` con 2 decimales da `2.68` y no `2.67`.
 */
export const NumberFormat = {
  maxDigits: MAX_DIGITS,

  /**
   * «indefinido» en el idioma de la interfaz (un valor NaN). El corrector lo acepta como respuesta en los 12 idiomas
   * (`AnswerWords.undefined`), así que una clave generada con este texto sigue funcionando.
   */
  get undefinedWord(): string {
    return tr('indefinido')
  },

  /** Acota un número de cifras pedido: entre `lower` y `MAX_DIGITS`. */
  clampDigits(n: number, lower: number): number {
    return Math.min(Math.max(n, lower), MAX_DIGITS)
  },

  /**
   * Número en notación decimal.
   * - `places`: decimales a mostrar (`undefined` = el valor «limpio», sin ruido de coma flotante: `0.1+0.2` → `0.3`).
   * - `trimZeros`: quita los ceros finales (`1.50` → `1.5`).
   * - `decimalComma`: usa coma como separador decimal (`0,5`).
   */
  decimal(x: number, places?: number | null, trimZeros = true, decimalComma = false): string {
    const s = special(x)
    if (s !== null) return s
    const d = DecimalDigits.fromDouble(x)
    if (!d) return String(x)
    const sep = decimalComma ? ',' : '.'
    if (places !== undefined && places !== null) {
      const p = NumberFormat.clampDigits(places, 0) // `places: Int.max` desbordaba y 999 999 999 colgaba la app
      d.roundToPlaces(p)
      return d.fixed(p, trimZeros, sep)
    }
    if (d.isZero) return '0'
    // Números enormes o diminutos: notación con exponente (no caben en pantalla en forma posicional).
    if (d.pointPos > 21 || d.pointPos < -11) {
      d.roundToSignificant(CLEAN_FIGURES)
      const exponent = d.pointPos - 1
      const digits = d.digits.map(String)
      let mantissa = digits[0]
      if (digits.length > 1) mantissa += sep + digits.slice(1).join('')
      return (d.negative ? '-' : '') + mantissa + `e${exponent}`
    }
    d.roundToSignificant(CLEAN_FIGURES)
    const p = Math.max(0, d.digits.length - d.pointPos)
    return d.fixed(p, true, sep)
  },

  /** Número con `figures` cifras significativas (conserva los ceros finales: `0.5` con 3 → `0.500`). */
  significant(x: number, figures: number): string {
    const s = special(x)
    if (s !== null) return s
    const d = DecimalDigits.fromDouble(x)
    if (!d) return String(x)
    const f = NumberFormat.clampDigits(figures, 1)
    d.roundToSignificant(f)
    return d.significant(f)
  },

  /**
   * Notación científica en TeX: `32000` → `3.2\times10^{4}`.
   * Con `trimZeros: false` conserva todas las cifras pedidas (`3.20\times10^{4}`).
   */
  scientificTeX(x: number, figures = 3, trimZeros = true): string {
    const s = special(x)
    if (s !== null) return s === '∞' ? '\\infty' : s === '-∞' ? '-\\infty' : s
    const d = DecimalDigits.fromDouble(x)
    if (!d || d.isZero) return '0'
    const f = NumberFormat.clampDigits(figures, 1)
    d.roundToSignificant(f)
    const exponent = d.pointPos - 1
    const digits = d.digits.map(String)
    if (!trimZeros) while (digits.length < f) digits.push('0')
    let mantissa = digits[0]
    if (digits.length > 1) mantissa += '.' + digits.slice(1).join('')
    const sign = d.negative ? '-' : ''
    if (exponent === 0) return sign + mantissa
    return sign + mantissa + `\\times10^{${exponent}}`
  },

  /** Número en TeX: racional → `\frac{a}{b}`; real → decimal limpio (o científica si es enorme o diminuto). */
  texNumber(v: MathValue): string {
    if (v.kind === 'rational') return v.value.latex
    const x = v.value
    if (Number.isNaN(x)) return '\\text{' + NumberFormat.undefinedWord + '}'
    if (!Number.isFinite(x)) return x < 0 ? '-\\infty' : '\\infty'
    if (x === 0) return '0'
    const a = Math.abs(x)
    if (a >= 1e9 || a < 1e-4) return NumberFormat.scientificTeX(x, 6)
    return NumberFormat.decimal(x)
  },

  /**
   * Texto «limpio» de un valor, apto para mostrar en un enunciado: enteros, decimales exactos cortos (`0.75`),
   * fracciones (`1/3`) y reales redondeados (`0.7071067812`).
   */
  plain(v: MathValue, decimalComma = false): string {
    if (v.kind === 'rational') {
      const f = v.value
      if (f.isInteger) return String(f.num)
      const s = decimalString(f, 6)
      if (s !== null) return decimalComma ? s.replace(/\./g, ',') : s
      return f.plain
    }
    return NumberFormat.decimal(v.value, undefined, true, decimalComma)
  },
}
