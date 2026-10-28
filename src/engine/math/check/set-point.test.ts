import { describe, expect, it } from 'vitest'
import { AnswerChecker } from './answer-checker'
import { ListParsing } from './list-parsing'
import type { Diagnosis, VerdictStatus } from './verdict'

const set = (input: string, expected: string[], ordered = false) => AnswerChecker.checkSet(input, expected, ordered)
const point = (input: string, expected: string[], absTol = 1e-6) => AnswerChecker.checkPoint(input, expected, absTol)

describe('SetAndPointCheckerTests', () => {
  // MARK: Conjuntos

  it('accepted ways to write a set', () => {
    const inputs = ['1, 2, 3', '3, 2, 1', '{1;2;3}', '{1, 2, 3}', '(1, 2, 3)', '[1;2;3]', 'x=1, x=2, x=3', 'x = 1 o x = 2 o x = 3',
      'x=1 or x=2 or x=3', 'x=1 y x=2 y x=3', '1 and 2 and 3', 'x ∈ {1, 2, 3}', 'S = {1, 2, 3}', '1, 2, 3, 3', '6/6, 4/2, sqrt(9)',
      'x_1 = 1, x_2 = 2, x_3 = 3', 'x1=1; x2=2; x3=3']
    for (const input of inputs) {
      const v = set(input, ['1', '2', '3'])
      expect(v.status, `«${input}»: ${v.message ?? ''}`).toBe('correct')
      expect(v.normalizedInput).toBeDefined()
      expect(v.latexInput).toBeDefined()
    }
  })

  it('plus-minus and radicals', () => {
    expect(set('±2', ['2', '-2']).status).toBe('correct')
    expect(set('x = ±2', ['2', '-2']).status).toBe('correct')
    expect(set('2±sqrt(3)', ['2+sqrt(3)', '2-sqrt(3)']).status).toBe('correct')
    expect(set('2 +- sqrt(3)', ['2+sqrt(3)', '2-sqrt(3)']).status).toBe('correct')
    expect(set('(1±√5)/2', ['(1+sqrt(5))/2', '(1-sqrt(5))/2']).status).toBe('correct')
    expect(set('x = (-1 ± sqrt(9))/2', ['1', '-2']).status).toBe('correct')
    expect(set('(3±√(9-8))/2', ['1', '2']).status).toBe('correct')
    expect(ListParsing.expandPlusMinus('±1±2±3±4').length, 'como mucho 3 signos ± por pieza').toBe(8)
    expect(set('π/6, 5π/6', ['pi/6', '5pi/6']).status).toBe('correct')
  })

  it('missing and extra solutions', () => {
    const missing = set('1, 2', ['1', '2', '3'])
    expect(missing.status).toBe('partial')
    expect(missing.diagnosis).toEqual(['missingSolution'])
    expect(Math.abs(missing.credit - 0.33)).toBeLessThanOrEqual(1e-9)
    const extra = set('1, 2, 3, 4', ['1', '2', '3'])
    expect(extra.status).toBe('partial')
    expect(extra.diagnosis).toEqual(['extraSolution'])
    expect(extra.message).toContain('sustitúyelo')
    const both = set('1, 4', ['1', '2'])
    expect(both.status).toBe('partial')
    expect([...both.diagnosis].sort()).toEqual(['extraSolution', 'missingSolution'])
    expect(set('7, 8', ['1', '2']).status).toBe('incorrect')
    expect(set('-1, -2', ['1', '2']).diagnosis).toEqual(['signError'])
  })

  it('empty sets', () => {
    for (const word of ['∅', '{}', 'no solution', 'No hay solución', 'sin solución', 'ninguna', 'conjunto vacío', 'DNE']) {
      expect(set(word, []).status, `«${word}»`).toBe('correct')
    }
    expect(set('1', []).status).toBe('incorrect')
    expect(set('1', []).diagnosis).toEqual(['extraSolution'])
    expect(set('∅', ['1']).status).toBe('incorrect')
    expect(set('∅', ['1']).diagnosis).toEqual(['missingSolution'])
  })

  it('ordered sequences', () => {
    expect(set('1, 2, 3', ['1', '2', '3'], true).status).toBe('correct')
    const swapped = set('2, 1, 3', ['1', '2', '3'], true)
    expect(swapped.status).toBe('partial')
    expect(swapped.diagnosis).toEqual(['orderMatters'])
    expect(set('1, 1, 2', ['1', '1', '2'], true).status, 'con orden, los repetidos cuentan').toBe('correct')
    expect(set('1, 2', ['1', '1', '2'], true).status).not.toBe('correct')
  })

  it('decimal approximations and decimal comma', () => {
    const approx = set('0.333, 2', ['1/3', '2'])
    expect(approx.status).toBe('partial')
    expect(approx.diagnosis).toEqual(['rounding'])
    expect(set('0.3333333333333, 2', ['1/3', '2']).status, 'dentro de la tolerancia').toBe('correct')
    expect(set('1,5', ['1.5']).status, 'una sola coma entre cifras es decimal').toBe('correct')
    expect(set('1,5', ['1', '5']).status, '…o una lista, si eso es lo esperado').toBe('correct')
    expect(set('1, 5', ['1', '5']).status).toBe('correct')
  })

  it('format problems and word sets', () => {
    expect(set('', ['1']).status).toBe('formatProblem')
    expect(set('x, 2', ['1', '2']).status, 'letras sueltas en una lista de números').toBe('formatProblem')
    expect(set('1, 2+', ['1', '2']).status).toBe('formatProblem')
    expect(set('sqrt(-1)', ['1']).status).toBe('formatProblem')
    expect(set('Rojo, verde', ['rojo', 'verde']).status).toBe('correct')
    expect(set('rojo', ['rojo', 'verde']).status).toBe('partial')
    expect(set('azul', ['rojo', 'verde']).status).toBe('incorrect')
  })

  // MARK: Puntos

  it('accepted ways to write a point', () => {
    for (const input of ['(1, -2)', '(1; -2)', 'P = (1, -2)', 'A(1,-2)', 'x=1, y=-2', '1, -2', '[1, -2]', '(1,−2)', '( 1 , -2 )', '(2/2, -4/2)']) {
      expect(point(input, ['1', '-2']).status, `«${input}»`).toBe('correct')
    }
    expect(point('(1, 2, 3)', ['1', '2', '3']).status).toBe('correct')
    expect(point('(0.5, sqrt(2)/2)', ['1/2', 'sqrt(2)/2']).status).toBe('correct')
    expect(point('(1,5; 2)', ['1.5', '2']).status, 'con punto y coma, la coma es decimal').toBe('correct')
    expect(point('(1, -2)', ['1', '-2']).normalizedInput).toBe('(1, -2)')
    expect(point('(1, -2)', ['1', '-2']).latexInput).toBe('\\left(1,\\,-2\\right)')
  })

  it('point mistakes', () => {
    const swapped = point('(-2, 1)', ['1', '-2'])
    expect(swapped.status).toBe('incorrect')
    expect(swapped.message).toContain('intercambiadas')
    const sign = point('(1, 2)', ['1', '-2'])
    expect(sign.status).toBe('partial')
    expect(sign.diagnosis).toEqual(['signError'])
    expect(Math.abs(sign.credit - 0.25)).toBeLessThanOrEqual(1e-9)
    expect(point('(5, 7)', ['1', '-2']).status).toBe('incorrect')
    expect(point('(1.0000001, -2)', ['1', '-2']).status).toBe('correct')
    expect(point('(1.01, -2)', ['1', '-2'], 0.05).status).toBe('correct')
  })

  it('point format problems', () => {
    expect(point('(1, 2)', ['1', '2', '3']).status, 'faltan coordenadas').toBe('formatProblem')
    expect(point('(1, 2) (3, 4)', ['1', '2']).status, 'dos puntos').toBe('formatProblem')
    expect(point('(x, 2)', ['1', '2']).status).toBe('formatProblem')
    expect(point('', ['1', '2']).status).toBe('formatProblem')
    expect(point('(1, sqrt(-1))', ['1', '2']).status).toBe('formatProblem')
    expect(point('(1, 2)', ['a', '2']).status, 'punto esperado mal definido').toBe('formatProblem')
  })

  it('function parentheses are not several points', () => {
    const want = ['-sqrt(2)/2', 'sqrt(2)/2']
    expect(point('-sqrt(2)/2, sqrt(2)/2', want).status).toBe('correct')
    expect(point('-sqrt(2)/2,sqrt(2)/2', want).status).toBe('correct')
    expect(point('(-sqrt(2)/2, sqrt(2)/2)', want).status).toBe('correct')
    expect(point('P = (-sqrt(2)/2, sqrt(2)/2)', want).status).toBe('correct')
    expect(point('(1, 2), (3, 4)', ['1', '2']).status, 'dos puntos de verdad').toBe('formatProblem')
    const rounded = point('-0.7071, 0.7071', want)
    expect(rounded.status).toBe('partial')
    expect(rounded.credit).toBe(0.5)
    expect(rounded.message).toContain('exactos')
  })
})

describe('OrderedTextSetTests', () => {
  const check = (input: string, expected: string[], status: VerdictStatus, credit: number, diagnosis: Diagnosis[] = [], ordered = true): void => {
    const r = AnswerChecker.checkSet(input, expected, ordered)
    expect(r.status, input).toBe(status)
    expect(Math.abs(r.credit - credit), input).toBeLessThanOrEqual(1e-12)
    expect(r.diagnosis, input).toEqual(diagnosis)
  }

  it('reordered text gets order partial credit', () => {
    check('blue, red', ['red', 'blue'], 'partial', 0.5, ['orderMatters'])
    check('red, blue, red', ['red', 'red', 'blue'], 'partial', 0.5, ['orderMatters'])
  })

  it('missing, extra and different multiplicities are incorrect', () => {
    check('red, blue', ['red', 'red', 'blue'], 'incorrect', 0, ['other'])
    check('red, red, blue', ['red', 'blue'], 'incorrect', 0, ['other'])
    check('red, blue, blue', ['red', 'red', 'blue'], 'incorrect', 0, ['other'])
  })

  it('mixed text and number preserves ordered positions', () => {
    check('2, alpha', ['alpha', '2'], 'partial', 0.5, ['orderMatters'])
  })

  it('exact ordered text including repetitions is correct', () => {
    check('red, blue', ['red', 'blue'], 'correct', 1)
    check('red, red, blue', ['red', 'red', 'blue'], 'correct', 1)
  })

  it('unordered text keeps membership and duplicate compatibility', () => {
    check('blue, red', ['red', 'blue'], 'correct', 1, [], false)
    check('red, red, blue', ['red', 'blue'], 'correct', 1, [], false)
    check('red, blue', ['red', 'red', 'blue'], 'correct', 1, [], false)
    check('blue, red, blue', ['red', 'red', 'blue'], 'correct', 1, [], false)
  })

  it('folding, brackets and separators still apply', () => {
    const r = AnswerChecker.checkSet('{ROJO; árbol}', ['rojo', 'arbol'], true)
    expect(r.status).toBe('correct')
    expect(r.credit).toBe(1)
    expect(r.normalizedInput).toBe('rojo, arbol')
    check('[blue; RED]', ['blue', 'red'], 'correct', 1)
  })

  it('missing or foreign distinct values keep their previous credit', () => {
    check('red', ['red', 'blue'], 'partial', 0.25, ['missingSolution'])
    check('red, green', ['red', 'blue'], 'partial', 0.25, ['extraSolution', 'missingSolution'])
    check('green', ['red', 'blue'], 'incorrect', 0, ['extraSolution', 'missingSolution'])
    check('red, blue, green', ['red', 'blue'], 'partial', 0.5, ['extraSolution'])
  })

  it('numeric ordered and unordered sequences keep their previous results', () => {
    check('2, 1', ['1', '2'], 'partial', 0.5, ['orderMatters'])
    check('1, 1, 2', ['1', '1', '2'], 'correct', 1)
    check('1, 2', ['1', '1', '2'], 'incorrect', 0, ['other'])
    check('2, 1', ['1', '2'], 'correct', 1, [], false)
  })

  it('empty input and empty text list keep their previous results', () => {
    check(' \n ', ['red', 'blue'], 'formatProblem', 0)
    check('{}', ['red', 'blue'], 'incorrect', 0, ['missingSolution'])
  })
})
