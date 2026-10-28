// `Double.description` de Swift: las cifras más cortas que identifican el número (las mismas que `String(x)` en JS),
// con el formato de Swift: «0.5», «5.0», «1e-05», «1.5e+20».

/** Cifras significativas más cortas y exponente decimal: valor = 0.d₁d₂… × 10^exponent. */
export function shortestDigits(x: number): { digits: string; exponent: number } {
  const s = Math.abs(x).toExponential() // «1.2345e+21»: tantas cifras como hagan falta para identificarlo
  const [mant, exp] = s.split('e')
  const digits = mant.replace('.', '').replace(/0+$/, '') || '0'
  return { digits, exponent: Number(exp) + 1 }
}

/** Texto de un `Double` como lo escribe Swift (`description`). */
export function swiftDoubleDescription(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf'
  const sign = x < 0 || Object.is(x, -0) ? '-' : ''
  if (x === 0) return sign + '0.0'
  const { digits, exponent } = shortestDigits(x)
  if (exponent < -3 || Math.abs(x) > 2 ** 54) {
    const e = exponent - 1
    const mantissa = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits
    const es = Math.abs(e) < 10 ? '0' + Math.abs(e) : String(Math.abs(e))
    return `${sign}${mantissa}e${e < 0 ? '-' : '+'}${es}`
  }
  if (exponent <= 0) return `${sign}0.${'0'.repeat(-exponent)}${digits}`
  if (digits.length <= exponent) return `${sign}${digits}${'0'.repeat(exponent - digits.length)}.0`
  return `${sign}${digits.slice(0, exponent)}.${digits.slice(exponent)}`
}
