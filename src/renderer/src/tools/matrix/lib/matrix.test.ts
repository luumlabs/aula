import { describe, expect, it } from 'vitest'
import { Q, add, determinant, identity, inverse, matrixTex, multiply, opTex, rank, rref, transpose, type Matrix } from './matrix'

const M = (rows: (number | string)[][]): Matrix => rows.map((r) => r.map((x) => Q.parse(String(x))!))
const plain = (m: Matrix) => m.map((r) => r.map((x) => x.toString()))

describe('Q', () => {
  it('lee enteros, fracciones y decimales exactos', () => {
    expect(Q.parse('-3/4')!.toString()).toBe('-3/4')
    expect(Q.parse('0,25')!.toString()).toBe('1/4')
    expect(Q.parse('2.5')!.toTex()).toBe('\\frac{5}{2}')
    expect(Q.parse('1/0')).toBeNull()
    expect(Q.parse('abc')).toBeNull()
  })
  it('opera sin perder exactitud', () => {
    expect(Q.of(1, 3).add(Q.of(1, 6)).toString()).toBe('1/2')
    expect(Q.of(2, 3).div(Q.of(4, 9)).toString()).toBe('3/2')
  })
})

describe('matrices', () => {
  it('calcula determinantes', () => {
    expect(determinant(M([[1, 2], [3, 4]]))!.toString()).toBe('-2')
    expect(determinant(M([[2, 0, 1], [1, 3, 2], [1, 1, 2]]))!.toString()).toBe('6')
    expect(determinant(M([[1, 2], [2, 4]]))!.toString()).toBe('0')
    expect(determinant(M([[0, 1], [1, 0]]))!.toString()).toBe('-1')
    expect(determinant(M([[1, 2, 3]]))).toBeNull()
  })
  it('invierte con fracciones', () => {
    const inv = inverse(M([[1, 2], [3, 4]])).inverse!
    expect(plain(inv)).toEqual([['-2', '1'], ['3/2', '-1/2']])
    expect(plain(multiply(M([[1, 2], [3, 4]]), inv)!)).toEqual(plain(identity(2)))
    expect(inverse(M([[1, 2], [2, 4]])).inverse).toBeNull()
  })
  it('traspone, suma y multiplica', () => {
    expect(plain(transpose(M([[1, 2, 3]])))).toEqual([['1'], ['2'], ['3']])
    expect(plain(add(M([[1, 2]]), M([[3, 4]]))!)).toEqual([['4', '6']])
    expect(plain(add(M([[1, 2]]), M([[3, 4]]), -1)!)).toEqual([['-2', '-2']])
    expect(multiply(M([[1, 2]]), M([[1, 2]]))).toBeNull()
  })
  it('reduce paso a paso', () => {
    const r = rref(M([[2, 4, 6], [1, 1, 1]]))
    expect(plain(r.result)).toEqual([['1', '0', '-1'], ['0', '1', '2']])
    expect(r.steps.length).toBeGreaterThan(1)
    // la última matriz de los pasos es el resultado
    expect(plain(r.steps[r.steps.length - 1].matrix)).toEqual(plain(r.result))
    expect(rank(M([[1, 2], [2, 4]]))).toBe(1)
  })
  it('escribe LaTeX', () => {
    expect(matrixTex(M([[1, '1/2']]))).toBe('\\begin{bmatrix}1 & \\frac{1}{2}\\end{bmatrix}')
    expect(opTex({ type: 'add', i: 1, j: 0, k: Q.of(-3) })).toBe('R_{2} \\to R_{2} - 3\\,R_{1}')
    expect(opTex({ type: 'swap', i: 0, j: 2 })).toBe('R_{1} \\leftrightarrow R_{3}')
  })
})
