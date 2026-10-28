// Fórmulas con varias igualdades: se parten por sus \quad de primer nivel.
import { describe, expect, it } from 'vitest'
import { splitFormula } from './tex'

describe('splitFormula', () => {
  it('parte por \\quad y \\qquad de primer nivel', () => {
    expect(splitFormula('\\csc\\theta=\\dfrac{1}{\\sin\\theta}\\quad\\sec\\theta=\\dfrac{1}{\\cos\\theta}\\qquad\\cot\\theta=1')).toEqual([
      '\\csc\\theta=\\dfrac{1}{\\sin\\theta}',
      '\\sec\\theta=\\dfrac{1}{\\cos\\theta}',
      '\\cot\\theta=1'
    ])
  })
  it('no parte dentro de llaves ni de entornos', () => {
    expect(splitFormula('f(x)=\\text{a\\quad b}')).toEqual(['f(x)=\\text{a\\quad b}'])
    expect(splitFormula('\\begin{cases}x\\quad y\\end{cases}')).toEqual(['\\begin{cases}x\\quad y\\end{cases}'])
  })
  it('no confunde otros comandos ni deja trozos vacíos', () => {
    expect(splitFormula('\\quadrant x')).toEqual(['\\quadrant x'])
    expect(splitFormula('\\quad a=1 \\quad')).toEqual(['a=1'])
    expect(splitFormula('a\\\\b')).toEqual(['a\\\\b'])
  })
})
