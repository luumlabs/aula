import { describe, expect, it } from 'vitest'
import { formatFixed, formatNumber, localizeTex, niceStep, niceTicks, parseNumber, roundSig, scientificParts, texNumber } from './num'

describe('formatNumber', () => {
  it('usa la coma decimal en español y el punto en inglés', () => {
    expect(formatNumber(1.5, { comma: true })).toBe('1,5')
    expect(formatNumber(1.5)).toBe('1.5')
  })
  it('limpia el ruido de coma flotante', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(2 / 3, { sig: 4 })).toBe('0.6667')
  })
  it('agrupa miles solo desde 5 cifras', () => {
    expect(formatNumber(1234)).toBe('1234')
    expect(formatNumber(12345)).toBe('12 345')
  })
  it('pasa a notación científica con magnitudes extremas', () => {
    expect(formatNumber(6.02214076e23, { sig: 4 })).toBe('6.022 × 10²³')
    expect(formatNumber(-1.6e-19, { comma: true })).toBe('−1,6 × 10⁻¹⁹')
  })
  it('usa el signo menos tipográfico y no deja «−0»', () => {
    expect(formatNumber(-3)).toBe('−3')
    expect(formatNumber(-0.0000001, { maxDecimals: 3 })).toBe('−1 × 10⁻⁷')
    expect(formatNumber(-0.0001, { maxDecimals: 2 })).toBe('0')
  })
})

describe('texNumber', () => {
  it('escribe la coma de LaTeX', () => {
    expect(texNumber(2.5, { comma: true })).toBe('2{,}5')
    expect(texNumber(3.2e-8, { sig: 3 })).toBe('3.2\\times10^{-8}')
  })
  it('localiza un LaTeX', () => {
    expect(localizeTex('3.5+\\frac{1.25}{2}', true)).toBe('3{,}5+\\frac{1{,}25}{2}')
  })
})

describe('parseNumber', () => {
  it('lee coma y punto decimal', () => {
    expect(parseNumber('1,5')).toBe(1.5)
    expect(parseNumber('1.5')).toBe(1.5)
    expect(parseNumber('−2,25')).toBe(-2.25)
  })
  it('entiende los separadores de miles', () => {
    expect(parseNumber('1.234,5')).toBe(1234.5)
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('1,234,567')).toBe(1234567)
  })
  it('lee notación científica y fracciones', () => {
    expect(parseNumber('2e-3')).toBeCloseTo(0.002)
    expect(parseNumber('3,2 × 10^-8')).toBeCloseTo(3.2e-8)
    expect(parseNumber('3.2·10⁻⁸')).toBeCloseTo(3.2e-8)
    expect(parseNumber('3/4')).toBe(0.75)
    expect(parseNumber('10^3')).toBe(1000)
  })
  it('rechaza lo que no es un número', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('1/0')).toBeNull()
    expect(parseNumber('1..2')).toBeNull()
  })
})

describe('utilidades', () => {
  it('redondea a cifras significativas', () => {
    expect(roundSig(123456, 3)).toBe(123000)
    expect(roundSig(0.0012345, 2)).toBe(0.0012)
  })
  it('calcula pasos y marcas bonitas', () => {
    expect(niceStep(16, 8)).toBe(2)
    expect(niceStep(1, 10)).toBeCloseTo(0.1)
    expect(niceTicks(-1, 1, 4)).toEqual([-1, -0.5, 0, 0.5, 1])
  })
  it('separa mantisa y exponente', () => {
    expect(scientificParts(9.99996, 4)).toEqual({ mantissa: '1', exponent: 1 })
    expect(formatFixed(3.5, 2, true)).toBe('3,50')
  })
})
