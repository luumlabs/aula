import { describe, expect, it } from 'vitest'
import { MV } from '../core/types'
import { Q, expectFrac, expectValue, frac } from '../test-support.testutil'
import { Fraction } from './fraction'
import { INT_MAX, INT_MIN } from './int64'

const F = (n: number | bigint, d: number | bigint = 1): Fraction | null => Fraction.of(n, d)

describe('FractionTests', () => {
  // MARK: Construcción y normalización

  it('normalization', () => {
    const rows: Array<[bigint, bigint, bigint, bigint]> = [
      [6n, 4n, 3n, 2n], [-6n, 4n, -3n, 2n], [6n, -4n, -3n, 2n], [-6n, -4n, 3n, 2n], [0n, 5n, 0n, 1n], [0n, -5n, 0n, 1n], [5n, 1n, 5n, 1n], [7n, 7n, 1n, 1n],
      [100n, 10n, 10n, 1n], [1n, 3n, 1n, 3n], [-1n, -3n, 1n, 3n], [12n, 18n, 2n, 3n], [INT_MAX, INT_MAX, 1n, 1n], [INT_MIN, 2n, -(1n << 62n), 1n],
    ]
    for (const [n, d, en, ed] of rows) {
      const f = F(n, d)
      expect(f, `${n}/${d}`).not.toBeNull()
      expect(f?.num, `${n}/${d} numerador`).toBe(en)
      expect(f?.den, `${n}/${d} denominador`).toBe(ed)
    }
  })

  it('zero denominator and unrepresentable', () => {
    expect(F(1, 0)).toBeNull()
    expect(F(0, 0)).toBeNull()
    expect(F(INT_MIN, -1), '2^63 no cabe').toBeNull()
    expect(F(1, INT_MIN), 'el denominador 2^63 no cabe').toBeNull()
    expect(F(INT_MIN, 1)).not.toBeNull()
  })

  it('integer init', () => {
    expect(Fraction.int(5).den).toBe(1n)
    expect(Fraction.int(5).isInteger).toBe(true)
    expect(frac(1, 2).isInteger).toBe(false)
    expect(Fraction.int(0).isZero).toBe(true)
    expect(frac(-1, 2).isNegative).toBe(true)
    expect(frac(-3, 4).sign).toBe(-1)
    expect(Fraction.int(0).sign).toBe(0)
  })

  // MARK: Aritmética

  it('arithmetic', () => {
    expectFrac(frac(1, 2).adding(frac(1, 3)), frac(5, 6))
    expectFrac(frac(1, 2).subtracting(frac(1, 3)), frac(1, 6))
    expectFrac(frac(2, 3).multiplied(frac(3, 4)), frac(1, 2))
    expectFrac(frac(1, 2).divided(frac(1, 4)), frac(2))
    expectFrac(frac(-1, 2).adding(frac(1, 2)), frac(0))
    expectFrac(frac(5, 6).subtracting(frac(5, 6)), frac(0))
    expectFrac(frac(3).multiplied(frac(1, 3)), frac(1))
    expectFrac(frac(-2, 3).multiplied(frac(-3, 2)), frac(1))
    expectFrac(frac(1, 6).adding(frac(1, 10)), frac(4, 15))
    expectFrac(frac(7, 12).divided(frac(-7, 6)), frac(-1, 2))
  })

  it('division by zero', () => {
    expect(frac(1).divided(Fraction.int(0))).toBeNull()
    expect(Fraction.int(0).reciprocal()).toBeNull()
    expect(Fraction.int(0).power(-1)).toBeNull()
    expectFrac(Fraction.int(0).divided(frac(5)), Fraction.int(0))
  })

  it('overflow is reported, not trapped', () => {
    const big = Fraction.int(INT_MAX)
    expect(big.adding(big), 'suma desbordada').toBeNull()
    expect(big.multiplied(big), 'producto desbordado').toBeNull()
    expect(Fraction.int(INT_MIN).subtracting(Fraction.int(1))).toBeNull()
    expect(Fraction.int(INT_MIN).negated(), '-Int.min no cabe').toBeNull()
    expect(frac(1n, INT_MAX).adding(frac(1n, INT_MAX - 1n)), 'denominadores enormes').toBeNull()
    expect(Fraction.int(2).power(63)).toBeNull()
    expect(Fraction.int(2).power(62)).not.toBeNull()
    expect(Fraction.int(10).power(19)).toBeNull()
    expect(Fraction.int(10).power(18)).not.toBeNull()
    expect(Fraction.int(INT_MIN).multiplied(Fraction.int(-1))).toBeNull()
    expect(big.multiplied(Fraction.int(1))).not.toBeNull()
  })

  it('cross reduction avoids spurious overflow', () => {
    // (Int.max/2) * (2/Int.max) = 1, sin desbordar gracias a la simplificación cruzada
    const a = frac(INT_MAX, 2n)
    const b = frac(2n, INT_MAX)
    expectFrac(a.multiplied(b), Fraction.int(1))
    const n = frac(1n, 1n << 40n)
    expectFrac(n.adding(n), frac(1n, 1n << 39n))
  })

  it('power', () => {
    expectFrac(frac(2, 3).power(3), frac(8, 27))
    expectFrac(frac(2, 3).power(-2), frac(9, 4))
    expectFrac(frac(-2).power(3), frac(-8))
    expectFrac(frac(-2).power(4), frac(16))
    expectFrac(frac(5).power(0), frac(1))
    expectFrac(Fraction.int(0).power(0), frac(1), 'convención: x^0 = 1 (la evaluación decide si 0^0 es un error)')
    expectFrac(Fraction.int(1).power(1_000_000_000), frac(1))
    expectFrac(frac(-1).power(1_000_000_001), frac(-1))
    expectFrac(Fraction.int(0).power(1_000_000_000), Fraction.int(0))
  })

  it('floor and ceil', () => {
    expect(frac(7, 2).floorInt()).toBe(3n)
    expect(frac(7, 2).ceilInt()).toBe(4n)
    expect(frac(-7, 2).floorInt()).toBe(-4n)
    expect(frac(-7, 2).ceilInt()).toBe(-3n)
    expect(frac(4).floorInt()).toBe(4n)
    expect(frac(-4).ceilInt()).toBe(-4n)
  })

  // MARK: Comparable, Hashable

  it('comparable and hashable', () => {
    expect(frac(1, 3).lt(frac(1, 2))).toBe(true)
    expect(frac(-1, 2).lt(frac(-1, 3))).toBe(true)
    expect(frac(-1).lt(Fraction.int(0))).toBe(true)
    expect(frac(2, 4).lt(frac(1, 2))).toBe(false)
    expect(frac(INT_MAX - 1n, INT_MAX).lt(frac(INT_MAX - 2n, INT_MAX - 1n))).toBe(false)
    expect(frac(INT_MAX - 2n, INT_MAX - 1n).lt(frac(INT_MAX - 1n, INT_MAX)), 'comparación sin desbordar').toBe(true)
    const sorted = [frac(1, 2), frac(-3), frac(1, 3), frac(5, 4)].sort((a, b) => a.compare(b)).map((f) => f.plain)
    expect(sorted).toEqual(['-3', '1/3', '1/2', '5/4'])
    expect(new Set([frac(1, 2), frac(2, 4), frac(3, 6)].map((f) => f.key)).size).toBe(1)
    expect(frac(1, 2).equals(frac(-2, -4))).toBe(true)
  })

  // MARK: Texto

  it('latex and plain', () => {
    const rows: Array<[Fraction, string, string]> = [
      [frac(3, 4), '\\frac{3}{4}', '3/4'], [frac(-3, 4), '-\\frac{3}{4}', '-3/4'], [frac(5), '5', '5'], [frac(-5), '-5', '-5'],
      [Fraction.int(0), '0', '0'], [frac(7, 2), '\\frac{7}{2}', '7/2'], [frac(6, -8), '-\\frac{3}{4}', '-3/4'],
    ]
    for (const [f, tex, plain] of rows) {
      expect(f.latex).toBe(tex)
      expect(f.plain).toBe(plain)
      expect(String(f)).toBe(plain)
    }
    expect(Fraction.int(INT_MIN).latex).toBe('-9223372036854775808')
  })

  it('double value', () => {
    expect(frac(1, 4).doubleValue).toBe(0.25)
    expect(frac(-3, 2).doubleValue).toBe(-1.5)
    expect(frac(1, 3).doubleValue).toBe(1 / 3)
  })

  // MARK: Lectura de texto

  const parseRows = (rows: Array<[string, Fraction | null]>): void => {
    for (const [s, expected] of rows) expectFrac(Fraction.parse(s), expected, `«${s}»`)
  }

  it('parse basic forms', () => {
    parseRows([
      ['3/4', frac(3, 4)], ['-2', frac(-2)], ['+7', frac(7)], ['0.75', frac(3, 4)], ['1,5', frac(3, 2)], ['.5', frac(1, 2)], ['5.', frac(5)],
      ['-0.125', frac(-1, 8)], ['  4/6 ', frac(2, 3)], ['3 / 4', frac(3, 4)], ['-3/4', frac(-3, 4)], ['3/-4', frac(-3, 4)], ['0', frac(0)],
      ['007', frac(7)], ['1.50', frac(3, 2)], ['100', frac(100)], ['0.5/2', frac(1, 4)], ['−3/4', frac(-3, 4)],
    ])
  })

  it('parse mixed numbers', () => {
    parseRows([
      ['2 1/2', frac(5, 2)], ['-2 1/2', frac(-5, 2)], ['1 3/4', frac(7, 4)], ['0 1/2', frac(1, 2)], ['10 2/3', frac(32, 3)],
      ['2 5/2', frac(9, 2)], ['2½', frac(5, 2)], ['½', frac(1, 2)], ['-½', frac(-1, 2)], ['2 ½', frac(5, 2)], ['¾', frac(3, 4)], ['1⅓', frac(4, 3)],
      ['2 -1/2', null], ['2 1.5/2', null], ['2.5 1/2', null], ['1 2 3', null],
    ])
  })

  it('parse scientific', () => {
    parseRows([
      ['1.2e-3', frac(3, 2500)], ['2e3', frac(2000)], ['1E3', frac(1000)], ['5e-1', frac(1, 2)], ['1.5E+2', frac(150)], ['0e5', frac(0)],
      ['1e30', null], ['1e-30', null], ['e5', null], ['1e', null], ['1e+', null], ['2e3.5', null],
    ])
  })

  it('parse separators', () => {
    parseRows([
      ['1,234.5', frac(12345, 10)], ['1.234,5', frac(12345, 10)], ['1,234,567', frac(1_234_567)], ['1.234.567', frac(1_234_567)],
      ['1,234', frac(1234, 1000)], ['12,5', frac(25, 2)], ['1,23,4', null], ['1,2.3', null], ['1.2.3', null], ['12,34,567', null],
    ])
  })

  it('parse percent', () => {
    expectFrac(Fraction.parse('50%'), frac(1, 2))
    expectFrac(Fraction.parse('37.5%'), frac(3, 8))
    expectFrac(Fraction.parse('100 %'), frac(1))
    expect(Fraction.parse('%')).toBeNull()
  })

  it('parse rejects garbage', () => {
    for (const s of ['', ' ', 'abc', '1/0', '1/', '/2', '--5', '+-5', '5-', '1 / / 2', '0x10', '1_000', 'NaN', 'inf', '1e1e1', '٣', '3/4/5', '(1/2)', '1.2.3.4']) {
      expect(Fraction.parse(s), `«${s}» no es un racional`).toBeNull()
    }
  })

  it('parse huge inputs returns null instead of trapping', () => {
    expect(Fraction.parse('123456789012345678901234567890')).toBeNull()
    expect(Fraction.parse('0.' + '1'.repeat(40))).toBeNull()
    expect(Fraction.parse('9'.repeat(5000))).toBeNull()
    expectFrac(Fraction.parse('0.' + '0'.repeat(5) + '1'), frac(1, 1_000_000))
    expectFrac(Fraction.parse('9223372036854775807'), Fraction.int(INT_MAX))
    expect(Fraction.parse('9223372036854775808'), '2^63 no cabe').toBeNull()
    expectFrac(Fraction.parse('0000000000000000000000000012'), frac(12), 'los ceros a la izquierda no cuentan')
  })

  // MARK: JSON

  it('JSON round trip and tolerance', () => {
    const f = frac(-3, 4)
    expectFrac(Fraction.fromJSON(JSON.parse(JSON.stringify(f))), f)
    expectFrac(Fraction.fromJSON({ numerator: 6, denominator: -8 }), frac(-3, 4))
    expectFrac(Fraction.fromJSON(5), frac(5))
    expectFrac(Fraction.fromJSON('3/4'), frac(3, 4))
    expectFrac(Fraction.fromJSON({ numerator: 3 }), frac(3))
    expect(() => Fraction.fromJSON({ numerator: 1, denominator: 0 })).toThrow()
    expect(() => Fraction.fromJSON('hola')).toThrow()
  })

  // MARK: MathValue

  it('math value', () => {
    expect(MV.isExact(MV.rational(frac(1, 2)))).toBe(true)
    expect(MV.isExact(MV.real(0.5))).toBe(false)
    expect(MV.double(MV.rational(frac(1, 2)))).toBe(0.5)
    expect(MV.double(MV.real(2.5))).toBe(2.5)
    expectValue(MV.int(7), Q(7))
    expect(MV.integerValue(MV.real(3))).toBe(3)
    expect(MV.integerValue(MV.real(3.5))).toBeNull()
    expect(MV.integerValue(MV.rational(frac(1, 2)))).toBeNull()
    expect(MV.isInteger(MV.real(1e300))).toBe(true)
    expectFrac(MV.fraction(MV.rational(frac(7, 3))), frac(7, 3))
    expect(MV.fraction(MV.real(1))).toBeNull()
  })
})
