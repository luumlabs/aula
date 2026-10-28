// Regresión: «y» (y «u», «v», «o») como VARIABLE no es la conjunción «y / o / ∪». La app Swift partía «-1 ≤ y ≤ 3» por la «y»
// y respondía «No pude leer «-1 <=»» (p. ej., el recorrido de y = … en un ejercicio).

import { describe, expect, it } from 'vitest'
import { AnswerChecker, AnswerListReading } from '../index'

const interval = (input: string, expected: string): string => AnswerChecker.checkInterval(input, expected).status

describe('variables que coinciden con palabras de unión', () => {
  it('desigualdades con la variable y', () => {
    for (const input of ['-1 ≤ y ≤ 3', '-1 <= y <= 3', 'y >= -1 and y <= 3', 'y ≥ -1 y y ≤ 3', '{y | -1 ≤ y ≤ 3}', '{y ∈ ℝ | -1 ≤ y ≤ 3}', 'y ∈ [-1, 3]']) {
      expect(interval(input, '[-1, 3]'), input).toBe('correct')
    }
    expect(interval('y ≥ -1', '[-1, inf)')).toBe('correct')
    expect(interval('y < -1 o y > 3', '(-inf, -1) U (3, inf)')).toBe('correct')
    // una respuesta errónea con y se lee y se corrige (no es un problema de formato)
    expect(interval('-1 < y ≤ 3', '[-1, 3]')).toBe('partial')
    expect(interval('0 ≤ y ≤ 3', '[-1, 3]')).toBe('incorrect')
  })

  it('la conjunción «y» y la unión «o/u» siguen funcionando', () => {
    expect(interval('x > 1 y x < 3', '(1, 3)')).toBe('correct')
    expect(interval('x > 1 and x < 3', '(1, 3)')).toBe('correct')
    expect(interval('x < 1 o x > 3', '(-inf, 1) U (3, inf)')).toBe('correct')
    expect(interval('(-inf, 1) u (3, inf)', '(-inf, 1) U (3, inf)')).toBe('correct')
    expect(interval('-1 <= t <= 3', '[-1, 3]')).toBe('correct')
  })

  it('variables u y v (palabras de unión) en desigualdades', () => {
    expect(interval('u >= -1 and u <= 3', '[-1, 3]')).toBe('correct')
    expect(interval('u > 1 y u < 3', '(1, 3)')).toBe('correct')
    expect(interval('v < 1 o v > 3', '(-inf, 1) U (3, inf)')).toBe('correct')
    expect(interval('-1 ≤ u ≤ 3', '[-1, 3]')).toBe('correct')
  })

  it('conjuntos de soluciones con la variable y', () => {
    expect(AnswerChecker.checkSet('y = 1, y = -1', ['1', '-1']).status).toBe('correct')
    expect(AnswerChecker.checkSet('y = 1 o y = -1', ['1', '-1']).status).toBe('correct')
    expect(AnswerChecker.checkSet('y = 1 y y = -1', ['1', '-1']).status).toBe('correct')
    expect(AnswerChecker.checkSet('1 y 2', ['1', '2']).status).toBe('correct')
    expect(AnswerListReading.setPieces('y = 1, y = -1')).toEqual(['y = 1', 'y = -1'])
  })

  it('ecuaciones y puntos con y no se parten por palabras', () => {
    expect(AnswerChecker.checkEquation('y = 2x + 1', 'y = 2*x + 1').status).toBe('correct')
    expect(AnswerChecker.checkPoint('(1, 2)', ['1', '2']).status).toBe('correct')
    expect(AnswerChecker.checkPoint('x = 1, y = 2', ['1', '2']).status).toBe('correct')
  })
})
