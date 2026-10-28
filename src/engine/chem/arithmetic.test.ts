// Portado de la app Swift anterior: Tests/ChemKitTests/ArithmeticTests.swift.
// En TypeScript los racionales usan `bigint`: no hay desbordamiento (las pruebas de `CheckedInt` y del BigInt propio
// de Swift se convierten en pruebas de los ayudantes con `bigint`).

import { describe, expect, it } from 'vitest'
import { Rational, bigGcd, bigLcm, bigToSafeNumber, multiplyMatrixVector, nullSpace } from './rational'

const R = (n: number | bigint, d: number | bigint = 1): Rational => {
  const r = Rational.of(n, d)
  if (!r) throw new Error('denominador 0')
  return r
}

describe('Aritmética exacta', () => {
  it('enteros grandes: mcd, mcm y conversión segura', () => {
    expect(bigGcd(462n, 1071n)).toBe(21n)
    expect(bigGcd(-12n, 18n)).toBe(6n)
    expect(bigLcm(4n, 6n)).toBe(12n)
    expect(bigLcm(0n, 6n)).toBe(0n)
    const max = 9223372036854775807n
    const big = max * max
    expect(big.toString()).toBe('85070591730234615847396907784232501249')
    expect(bigToSafeNumber(big)).toBeNull()
    expect(bigToSafeNumber(-7n)).toBe(-7)
  })

  it('racionales', () => {
    expect(R(6, 8).equals(R(3, 4))).toBe(true)
    expect(R(3, -6).equals(R(-1, 2))).toBe(true)
    expect(Rational.of(1, 0)).toBeNull()
    expect(R(8, 3).signedString()).toBe('+8/3')
    expect(Rational.int(-2).signedString()).toBe('-2')
    expect(Rational.int(0).signedString()).toBe('0')
    expect(R(1, 2).latex()).toBe('\\frac{1}{2}')
    expect(R(-1, 2).latex()).toBe('-\\frac{1}{2}')
    expect(R(1, 3).add(R(1, 6)).equals(R(1, 2))).toBe(true)
    // Sin desbordamiento: Int.max + 1 es exacto.
    expect(Rational.int(9223372036854775807n).add(Rational.ONE).toString()).toBe('9223372036854775808')
    expect(Rational.ONE.div(Rational.ZERO)).toBeNull()
    expect(R(1, 3).lt(R(1, 2))).toBe(true)
    expect(Rational.parse('1/2')?.equals(R(1, 2))).toBe(true)
    expect(Rational.parse('0.25')?.equals(R(1, 4))).toBe(true)
    expect(Rational.parse('1,5')?.equals(R(3, 2))).toBe(true)
    expect(Rational.parse('½')?.equals(R(1, 2))).toBe(true)
    expect(Rational.parse('1½')?.equals(R(3, 2))).toBe(true)
    expect(Rational.parse('-3')?.equals(Rational.int(-3))).toBe(true)
    expect(Rational.parse('abc')).toBeNull()
    expect(Rational.parse('1/0')).toBeNull()
    expect(Rational.parse('')).toBeNull()
  })

  it('JSON de racionales con validación', () => {
    const json = JSON.stringify(R(3, 4))
    expect(Rational.fromJSON(JSON.parse(json)).equals(R(3, 4))).toBe(true)
    expect(() => Rational.fromJSON({ numerator: 1, denominator: 0 })).toThrow()
    expect(Rational.fromJSON({ numerator: 2, denominator: 4 }).equals(R(1, 2))).toBe(true)
    expect(Rational.fromJSON({ numerator: 5 }).equals(Rational.int(5))).toBe(true)
    expect(() => Rational.fromJSON({ numerator: 1.5, denominator: 2 })).toThrow()
  })

  it('espacio nulo sencillo', () => {
    // 4 Fe + 3 O2 -> 2 Fe2O3: filas Fe, O.
    const ns = nullSpace([[1, 0, -2], [0, 2, -3]], 3)
    expect(ns.rank).toBe(2)
    expect(ns.basis.length).toBe(1)
    const v = ns.basis[0].map(Number)
    expect(JSON.stringify(v) === '[4,3,2]' || JSON.stringify(v) === '[-4,-3,-2]').toBe(true)
  })

  it('espacio nulo con números enormes', () => {
    const huge = 3_000_000_000
    const m = [[huge, -(huge - 1), 0], [0, huge + 7, -(huge - 11)]]
    const ns = nullSpace(m, 3)
    expect(ns.basis.length).toBe(1)
    expect(multiplyMatrixVector(m, ns.basis[0]).every((x) => x === 0n)).toBe(true)
  })
})
