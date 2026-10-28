import type { Fraction } from '../numbers/fraction'
import { UINT_MAX, absBig } from '../numbers/int64'
import { shortestDigits } from './swift-double'

/**
 * Dígitos decimales de un número, tomados de su representación más corta (`2.675` es "2675", no 2.67499999…).
 * Permite redondear «como en la escuela» (mitad hacia arriba, en valor absoluto) sin errores de coma flotante.
 *
 * Valor = 0.d₁d₂…dₙ × 10^pointPos
 */
export class DecimalDigits {
  negative: boolean
  /** Cifras significativas (sin ceros a la izquierda ni a la derecha). Vacío = cero. */
  digits: number[]
  /** Posición del punto decimal respecto a la primera cifra (número de cifras enteras; puede ser ≤ 0 o > n). */
  pointPos: number

  private constructor(negative: boolean, digits: number[], pointPos: number) {
    this.negative = negative
    this.digits = digits
    this.pointPos = pointPos
  }

  /** Dígitos de un `number` finito (`null` si es NaN o infinito). */
  static fromDouble(x: number): DecimalDigits | null {
    if (!Number.isFinite(x)) return null
    let negative = x < 0
    if (x === 0) return new DecimalDigits(false, [], 0)
    const { digits, exponent } = shortestDigits(x)
    const all = [...digits].map(Number)
    let point = exponent
    while (all.length > 0 && all[0] === 0) {
      all.shift()
      point -= 1
    }
    while (all.length > 0 && all[all.length - 1] === 0) all.pop()
    if (all.length === 0) {
      point = 0
      negative = false
    }
    return new DecimalDigits(negative, all, point)
  }

  /** Dígitos de una fracción exacta con denominador de la forma 2ᵃ5ᵇ (decimal finito); `null` si es periódica. */
  static fromFraction(f: Fraction, maxDigits = 30): DecimalDigits | null {
    let d = f.den
    let twos = 0
    let fives = 0
    while (d % 2n === 0n) {
      d /= 2n
      twos += 1
    }
    while (d % 5n === 0n) {
      d /= 5n
      fives += 1
    }
    if (d !== 1n) return null
    const places = Math.max(twos, fives)
    if (places > maxDigits) return null
    // numerador × 10^places / denominador es entero (con aritmética de 64 bits sin signo, como en Swift)
    let factor = 1n
    for (let i = 0; i < places; i++) {
      factor *= 10n
      if (factor > UINT_MAX) return null
    }
    const mult = f.den
    if (mult === 0n || factor % mult !== 0n) return null
    const scaled = absBig(f.num) * (factor / mult)
    if (scaled > UINT_MAX) return null
    const all = [...scaled.toString()].map(Number)
    let point = all.length - places
    while (all.length > 0 && all[0] === 0) {
      all.shift()
      point -= 1
    }
    while (all.length > 0 && all[all.length - 1] === 0) all.pop()
    let negative = f.num < 0n
    if (all.length === 0) {
      point = 0
      negative = false
    }
    return new DecimalDigits(negative, all, point)
  }

  /** Copia independiente. */
  clone(): DecimalDigits {
    return new DecimalDigits(this.negative, [...this.digits], this.pointPos)
  }

  get isZero(): boolean {
    return this.digits.length === 0
  }

  /** Redondea a `places` cifras decimales (puede ser negativo: -2 redondea a centenas). Mitad hacia arriba (en valor absoluto). */
  roundToPlaces(places: number): void {
    this.roundKeeping(this.pointPos + places)
  }

  /** Redondea a `figures` cifras significativas. */
  roundToSignificant(figures: number): void {
    if (this.digits.length === 0) return
    this.roundKeeping(Math.max(figures, 1))
  }

  private roundKeeping(keep: number): void {
    if (keep >= this.digits.length) return
    if (keep < 0) {
      this.digits = []
      this.pointPos = 0
      this.negative = false
      return
    }
    const up = this.digits[keep] >= 5
    this.digits.length = keep
    if (up) {
      let i = keep - 1
      let carry = true
      while (carry && i >= 0) {
        if (this.digits[i] === 9) {
          this.digits[i] = 0
          i -= 1
        } else {
          this.digits[i] += 1
          carry = false
        }
      }
      if (carry) {
        this.digits.unshift(1)
        this.pointPos += 1
      }
    }
    while (this.digits.length > 0 && this.digits[this.digits.length - 1] === 0) this.digits.pop()
    if (this.digits.length === 0) {
      this.pointPos = 0
      this.negative = false
    }
  }

  /** Valor como `number` (para reconvertir tras redondear). */
  get doubleValue(): number {
    if (this.digits.length === 0) return 0
    const v = Number(`${this.negative ? '-' : ''}0.${this.digits.join('')}e${this.pointPos}`)
    return Number.isNaN(v) ? 0 : v
  }

  /** Texto en notación posicional con exactamente `places` decimales (rellena con ceros). */
  fixed(places: number, trimZeros: boolean, decimalSeparator = '.'): string {
    const p = Math.max(places, 0)
    let intPart = ''
    if (this.pointPos <= 0) {
      intPart = '0'
    } else {
      for (let k = 0; k < this.pointPos; k++) intPart += k < this.digits.length ? String(this.digits[k]) : '0'
    }
    let frac = ''
    for (let k = 0; k < p; k++) {
      const idx = this.pointPos + k
      frac += idx >= 0 && idx < this.digits.length ? String(this.digits[idx]) : '0'
    }
    if (trimZeros) frac = frac.replace(/0+$/, '')
    const sign = this.negative && this.digits.some((d) => d !== 0) ? '-' : ''
    // evitar "-0"
    const allZero = !/[1-9]/.test(intPart) && !/[1-9]/.test(frac)
    return (allZero ? '' : sign) + intPart + (frac === '' ? '' : decimalSeparator + frac)
  }

  /** Texto con exactamente `figures` cifras significativas (conserva ceros finales significativos). */
  significant(figures: number, decimalSeparator = '.'): string {
    if (this.digits.length === 0) {
      return figures > 1 ? '0' + decimalSeparator + '0'.repeat(figures - 1) : '0'
    }
    // número de decimales necesarios para mostrar `figures` cifras significativas
    const places = figures - this.pointPos
    if (places >= 0) return this.fixed(places, false, decimalSeparator)
    // más cifras enteras que cifras significativas: se rellena con ceros (1234.5 con 2 cifras → 1200)
    return this.fixed(0, false, decimalSeparator)
  }
}

/**
 * Decimal exacto de una fracción si es finito (0.75, 0.125, 0.8660254037844386: lo que se escribió como decimal se muestra
 * como decimal); `null` si es periódico (1/3) o tendría más de `maxPlaces` decimales.
 */
export function decimalString(f: Fraction, maxPlaces = 16): string | null {
  if (f.isInteger) return null
  const d = DecimalDigits.fromFraction(f, maxPlaces)
  if (!d) return null
  const places = Math.max(0, d.digits.length - d.pointPos)
  if (places > maxPlaces) return null
  return d.fixed(places, true)
}
