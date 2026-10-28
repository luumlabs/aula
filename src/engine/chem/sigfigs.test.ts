// Portado de la app Swift anterior: Tests/ChemKitTests/SigFigsTests.swift, UnitExponentAnswerTests.swift y
// AuditNumericAnswerTests.swift.

import { describe, expect, it } from 'vitest'
import { Measurement, SigFigCount, SigFigs } from './sigfigs'
import { fixed, scientific } from './text'

const M = (s: string): Measurement => {
  const m = Measurement.of(s)
  if (!m) throw new Error(`medida ${s}`)
  return m
}
const status = (answer: string, expected: number, sig: number | null = null): string => SigFigs.check(answer, expected, sig).status

describe('Cifras significativas', () => {
  it('recuento', () => {
    const cases: [string, number, number][] = [
      ['0.00450', 3, 3], ['1.200e3', 4, 4], ['1,20', 3, 3], ['1200', 2, 4], ['1200.', 4, 4], ['100', 1, 3], ['105', 3, 3],
      ['0.0', 1, 1], ['0', 1, 1], ['0.00', 2, 2], ['6.022e23', 4, 4], ['6.02×10^23', 3, 3], ['1.0×10³', 2, 2], ['-0.0450', 3, 3],
      ['+12.0', 3, 3], ['1.234,5', 5, 5], ['1,234.5', 5, 5], ['1,200,000', 2, 7], ['12e3', 2, 2], ['120e3', 2, 3], ['1.20E-3', 3, 3],
      ['4.50 x 10^-2', 3, 3], ['4.5·10^-2', 2, 2], ['7', 1, 1], ['70', 1, 2], ['70.', 2, 2], ['0.070', 2, 2], ['1.0', 2, 2],
      ['3.14159', 6, 6], ['1.00 × 10⁻³', 3, 3], ['2.0*10^{5}', 2, 2], [' 25.0 ', 3, 3], ['1.', 1, 1], ['.5', 1, 1],
    ]
    for (const [text, lo, hi] of cases) expect(SigFigs.count(text)?.equals(new SigFigCount(lo, hi)), text).toBe(true)
    expect(SigFigs.count('1200')?.isAmbiguous).toBe(true)
    expect(SigFigs.count('1200')?.toString()).toBe('entre 2 y 4')
    for (const bad of ['', 'abc', '1.2.3', '--5', '1e', 'e5', '1/2', '12 g y 3', '∞']) expect(SigFigs.count(bad), bad).toBeNull()
  })

  it('valores leídos', () => {
    expect(SigFigs.parse('1,20')?.value).toBe(1.2)
    expect(SigFigs.parse('1.234,5')?.value).toBe(1234.5)
    expect(SigFigs.parse('1,234.5')?.value).toBe(1234.5)
    expect(Math.abs((SigFigs.parse('6.02×10^23')?.value ?? 0) - 6.02e23)).toBeLessThan(1e10)
    expect(SigFigs.parse('1.0×10³')?.value).toBe(1000)
    expect(Math.abs((SigFigs.parse('4.5·10^-2')?.value ?? 0) - 0.045)).toBeLessThan(1e-15)
    expect(SigFigs.parse('−3.5')?.value).toBe(-3.5)
    expect(SigFigs.parse('0.00450')?.lastDigitExponent).toBe(-5)
    expect(SigFigs.parse('1200')?.lastDigitExponent).toBe(0)
    expect(SigFigs.parse('1.20e3')?.lastDigitExponent).toBe(1)
    expect(SigFigs.parse('12.50')?.decimals).toBe(2)
  })

  it('redondeo y formato', () => {
    expect(SigFigs.round(123.456, 3)).toBe(123)
    expect(SigFigs.round(0.0012345, 2)).toBe(0.0012)
    expect(SigFigs.round(0.0445, 2)).toBe(0.045) // mitad hacia arriba
    expect(SigFigs.round(-2.5, 1)).toBe(-3)
    expect(SigFigs.format(2.5, 3)).toBe('2.50')
    expect(SigFigs.format(1234, 2)).toBe('1.2 × 10³')
    expect(SigFigs.format(1234, 4)).toBe('1234')
    expect(SigFigs.format(1200, 3)).toBe('1.20 × 10³')
    expect(SigFigs.format(0.000123, 2)).toBe('1.2 × 10⁻⁴')
    expect(SigFigs.format(0.0012345, 3)).toBe('0.00123')
    expect(SigFigs.format(6.02214076e23, 4)).toBe('6.022 × 10²³')
    expect(SigFigs.format(9.999, 2)).toBe('1.0 × 10¹') // «10» se leería con 1 cifra
    expect(SigFigs.format(99.96, 3)).toBe('1.00 × 10²')
    expect(SigFigs.format(250, 2)).toBe('2.5 × 10²')
    expect(SigFigs.format(298.15, 3)).toBe('298')
    expect(SigFigs.format(0, 3)).toBe('0.00')
    expect(SigFigs.format(-0.04567, 2)).toBe('-0.046')
    expect(scientific(6.02214076e23, 4, 'latex')).toBe('6.022 \\times 10^{23}')
    expect(scientific(6.02214076e23, 4, 'plain')).toBe('6.022e23')
    expect(fixed(122.545, 2)).toBe('122.55')
    expect(fixed(-0.0001, 2)).toBe('0.00')
  })

  it('reglas de las operaciones', () => {
    expect(SigFigs.sigFigsForProduct(['4.56', '1.4'])).toBe(2)
    expect(SigFigs.sigFigsForProduct(['0.00450', '2.000', '15'])).toBe(2)
    expect(SigFigs.sigFigsForProduct(['4.56', 'abc'])).toBeNull()
    expect(SigFigs.decimalsForSum(['12.11', '18.0', '1.013'])).toBe(1)
    expect(SigFigs.decimalsForSum(['100', '0.5'])).toBe(0)
    // (12.11 + 18.0 + 1.013) × 2.0 → la suma tiene 1 decimal (31.1, 3 cifras) y el producto 2 cifras → 62.
    const sum = M('12.11').add(M('18.0')).add(M('1.013'))
    expect(sum.sigFigs).toBe(3)
    expect(sum.formatted).toBe('31.1')
    const product = sum.mul(M('2.0'))
    expect(product.sigFigs).toBe(2)
    expect(product.formatted).toBe('62')
    expect(product.value).toBeCloseTo(62.246, 9) // sin redondear por el camino
    expect(M('4.56').mul(M('1.4')).formatted).toBe('6.4')
    expect(M('10.1').sub(M('3.555')).formatted).toBe('6.5')
    expect(M('100.0').div(M('3.0')).formatted).toBe('33')
    // Los números exactos no limitan.
    expect(M('1.234').mul(Measurement.exact(2)).formatted).toBe('2.468')
    expect(Measurement.of('xyz')).toBeNull()
  })

  it('corrección de respuestas', () => {
    expect(status('0.0450', 0.045, 3)).toBe('correct')
    const wrongCount = SigFigs.check('0.045', 0.045, 3)
    expect(wrongCount.status).toBe('partial')
    expect(wrongCount.feedback).toBe('El valor es correcto, pero con los datos dados corresponden 3 cifras significativas, no 2: escribe 0.0450.')
    expect(status('0.04500', 0.045, 3)).toBe('partial')
    expect(status('0.0460', 0.045, 3)).toBe('incorrect')
    expect(status('4.5e-2', 0.045, 2)).toBe('correct')
    expect(status('0.0450 g', 0.045, 3)).toBe('correct')
    expect(status('abc', 0.045)).toBe('invalid')
    const power = SigFigs.check('45', 0.045)
    expect(power.status).toBe('incorrect')
    expect(power.feedback).toContain('potencia de 10')
    expect(status('1200', 1234, 2)).toBe('correct')
    expect(status('14.3', 14.2974)).toBe('correct')
    expect(status('14.3', 14.2974, 3)).toBe('correct')
    expect(status('14.30', 14.2974, 3)).toBe('partial')
    expect(status('14', 14.2974, 3)).toBe('partial')
    expect(status('28.6', 14.2974)).toBe('incorrect')
    expect(SigFigs.check('28.6', 14.2974).feedback).toContain('doble')
    expect(status('-14.3', 14.2974)).toBe('incorrect')
    expect(status('1,43·10^1', 14.2974, 3)).toBe('correct')
  })
})

describe('Unidades con exponente y paréntesis', () => {
  it('las unidades con «^» son unidades, no operaciones', () => {
    expect(status('2.70 g/cm^3', 2.7)).toBe('correct')
    expect(status('2.70 g/cm^3', 2.7, 3)).toBe('correct')
    expect(status('9.8 m/s^2', 9.8)).toBe('correct')
    expect(status('5.0 m^2', 5, 2)).toBe('correct')
    expect(status('1.2 kg·m^2/s^2', 1.2, 2)).toBe('correct')
    expect(status('1.0 mol·L^-1', 1.0, 2)).toBe('correct')
    expect(status('3.0 m^(-1)', 3)).toBe('correct')
    expect(status('2.50 g/cm^3', 2.7, 3)).toBe('incorrect')
  })

  it('las potencias de números siguen siendo operaciones', () => {
    expect(status('2^3', 2)).toBe('invalid')
    expect(status('2 ^ 3', 8)).toBe('invalid')
    expect(status('2(3)', 2)).toBe('invalid')
    expect(status('2 (3 g)', 2)).toBe('invalid')
  })

  it('exponente y unidad entre paréntesis', () => {
    expect(status('1.5 × 10^(-3)', 1.5e-3)).toBe('correct')
    expect(status('1.5×10^( -3 ) M', 1.5e-3, 2)).toBe('correct')
    expect(status('1.5 × 10^(3)', 1.5e-3)).toBe('incorrect')
    expect(SigFigs.parse('1.50×10^(-3)')?.sigFigs.equals(new SigFigCount(3))).toBe(true)
    expect(status('1.5 × 10^(-3', 1.5e-3)).toBe('invalid')
    expect(status('0.25 (M)', 0.25)).toBe('correct')
    expect(status('12 (aq)', 12)).toBe('correct')
  })
})

describe('Respuestas numéricas: expresiones frente a números', () => {
  it('un prefijo de una expresión no es la respuesta', () => {
    expect(status('2+2', 2)).toBe('invalid')
    expect(status('1/2', 1)).toBe('invalid')
    expect(status('1/2', 0.5)).toBe('invalid')
    expect(status('1e', 1)).toBe('invalid')
    expect(status('2 + 3', 2)).toBe('invalid')
    expect(status('2(3)', 2)).toBe('invalid')
    expect(status('3·4', 3)).toBe('invalid')
  })

  it('números, unidades y porcentajes siguen funcionando', () => {
    expect(status('2', 2)).toBe('correct')
    expect(status('2.0 g', 2)).toBe('correct')
    expect(status('0.0450', 0.045, 3)).toBe('correct')
    expect(status('4.5e-2', 0.045, 2)).toBe('correct')
    expect(status('4.50 g/mol', 4.5)).toBe('correct')
    expect(status('12 kJ/(mol·K)', 12)).toBe('correct')
    expect(status('45 %', 45)).toBe('correct')
    expect(status('3 ppm', 3)).toBe('correct')
  })

  it('texto explicativo y unidades compuestas no son operaciones', () => {
    expect(status('10 g de NaCl', 10)).toBe('correct')
    expect(status('4.50 g de NaCl', 4.5)).toBe('correct')
    expect(status('2.70 g/cm3', 2.7)).toBe('correct')
    expect(status('2.70 g/cm³', 2.7)).toBe('correct')
    expect(status('5 mg/dL', 5)).toBe('correct')
    expect(status('15 % m/v', 15)).toBe('correct')
    expect(status('12 g/100 mL', 12)).toBe('correct')
    expect(status('8.31 J mol-1 K-1', 8.31)).toBe('correct')
  })

  it('separadores de miles y decimales', () => {
    expect(status('1,200', 1200)).toBe('correct')
    expect(status('1,200', 1.2)).toBe('correct')
    expect(status('1.200', 1.2)).toBe('correct')
  })
})
