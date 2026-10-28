import { describe, expect, it } from 'vitest'
import { histogram, linearRegression, normalPdf, normalProb, normalQuantile, parseList, parsePairs, summarize } from './stats'

describe('lectura de datos', () => {
  it('entiende la coma decimal del español', () => {
    expect(parseList('1,5 2,5\n3', true).values).toEqual([1.5, 2.5, 3])
    expect(parseList('1, 2, 3', true).values).toEqual([1, 2, 3])
    expect(parseList('1;2;3,5', true).values).toEqual([1, 2, 3.5])
  })
  it('en inglés la coma separa', () => {
    expect(parseList('1,2,3.5', false).values).toEqual([1, 2, 3.5])
  })
  it('separa lo que no es un número', () => {
    expect(parseList('4 x 5', false)).toEqual({ values: [4, 5], bad: ['x'] })
  })
  it('lee pares por líneas', () => {
    expect(parsePairs('1 2\n2;4\n3\t6\nbasura', false)).toEqual({ pairs: [[1, 2], [2, 4], [3, 6]], bad: 1 })
  })
})

describe('summarize', () => {
  it('da el resumen de cinco números (método TI)', () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9])!
    expect([s.min, s.q1, s.median, s.q3, s.max]).toEqual([1, 2.5, 5, 7.5, 9])
    expect(s.mean).toBe(5)
    expect(s.sdSample).toBeCloseTo(2.7386, 4)
    expect(s.sdPop).toBeCloseTo(2.5820, 4)
  })
  it('encuentra modas y valores atípicos', () => {
    const s = summarize([2, 3, 3, 4, 4, 5, 40])!
    expect(s.modes).toEqual([3, 4])
    expect(s.outliers).toEqual([40])
    expect(s.whiskers).toEqual([2, 5])
    expect(summarize([1, 2, 3])!.modes).toEqual([])
    expect(summarize([])).toBeNull()
  })
})

describe('histograma', () => {
  it('cubre todos los datos con clases bonitas', () => {
    const xs = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9.5]
    const h = histogram(xs, 5)
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(xs.length)
    expect(h[0].lo).toBeLessThanOrEqual(1)
    expect(h[h.length - 1].hi).toBeGreaterThanOrEqual(9.5)
    expect(h[1].hi - h[1].lo).toBe(2)
  })
})

describe('regresión y normal', () => {
  it('ajusta una recta exacta', () => {
    const r = linearRegression([[1, 3], [2, 5], [3, 7]])!
    expect(r.slope).toBeCloseTo(2)
    expect(r.intercept).toBeCloseTo(1)
    expect(r.r2).toBeCloseTo(1)
    expect(linearRegression([[1, 1], [1, 2]])).toBeNull()
  })
  it('calcula probabilidades de la normal', () => {
    expect(normalProb(-1, 1, 0, 1)).toBeCloseTo(0.6827, 4)
    expect(normalProb(-Infinity, 0, 0, 1)).toBeCloseTo(0.5, 6)
    expect(normalQuantile(0.975, 100, 15)).toBeCloseTo(129.4, 1)
    expect(normalPdf(0, 0, 1)).toBeCloseTo(0.39894, 5)
  })
})
