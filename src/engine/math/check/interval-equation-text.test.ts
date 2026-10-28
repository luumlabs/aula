import { describe, expect, it } from 'vitest'
import { has } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import { decodeTextMatchOptions, type TextMatchOptions } from './specs'

const interval = (input: string, expected: string) => AnswerChecker.checkInterval(input, expected)
const equation = (input: string, expected: string, vars: string[] | null = null) => AnswerChecker.checkEquation(input, expected, vars)
const text = (input: string, accepted: string[], options: Partial<TextMatchOptions> = {}) => AnswerChecker.checkText(input, accepted, [], options)

describe('IntervalEquationTextTests', () => {
  // MARK: Intervalos

  it('equivalent ways to write intervals', () => {
    const rows: Array<[string, string]> = [
      ['(−∞, 3] ∪ (5, ∞)', '(-inf,3] U (5,inf)'], ['(-inf,3] U (5,inf)', 'x<=3 o x>5'], ['x<=3 or x>5', '(-oo, 3] ∪ (5, oo)'],
      ['2 < x <= 7', '(2,7]'], ['x ≠ 3', '(-inf,3) U (3,inf)'], ['x != 3', '(-inf,3) U (3,inf)'], ['R', '(-inf,inf)'],
      ['todos los reales', '(-inf, inf)'], ['ℝ', '(-inf, inf)'], ['∅', 'x<1 y x>2'], ['[1, 3)', '[1;3)'], ['x ∈ [1, 3)', '[1,3)'],
      ['x>2 y x<5', '(2,5)'], ['x > 2 and x < 5', '(2,5)'], ['3 > x', '(-inf,3)'], ['x > -2', '(-2, inf)'], ['[-π, π]', '[-pi,pi]'],
      ['x < 1/2', '(-inf, 0.5)'], ['(-inf, 2) U (2, 5) U [5, inf)', 'x != 2'], ['{1, 2}', 'x = 1 o x = 2'], ['(1, 3) ∪ (2, 4)', '(1, 4)'],
      ['[1,2] ∪ [2,3]', '[1,3]'], ['θ < 2', '(-inf,2)'], ['x ≤ 3', '(-inf, 3]'], ['x ≥ 3', '[3, inf)'], ['S = (1, 2]', '(1,2]'],
    ]
    for (const [input, expected] of rows) {
      const v = interval(input, expected)
      expect(v.status, `«${input}» vs «${expected}»: ${v.message ?? ''}`).toBe('correct')
    }
    expect(interval('(-∞, 3] ∪ (5, ∞)', '(-inf,3] U (5,inf)').normalizedInput).toBe('(-∞, 3] ∪ (5, ∞)')
    expect(interval('x < 1/2', '(-inf, 0.5)').latexInput).toBe('(-\\infty,\\,\\frac{1}{2})')
  })

  it('interval mistakes', () => {
    const ends = interval('[2,5]', '(2,5)')
    expect(ends.status).toBe('partial')
    expect(ends.diagnosis).toEqual(['wrongInterval'])
    expect(ends.message).toContain('paréntesis')
    const opposite = interval('(-inf, 2)', '(2, inf)')
    expect(opposite.status).toBe('incorrect')
    expect(opposite.diagnosis).toEqual(['wrongInterval', 'signError'])
    const missing = interval('(5, inf)', '(-inf, 3) U (5, inf)')
    expect(missing.status).toBe('incorrect')
    expect(has(missing, 'missingSolution')).toBe(true)
    expect(has(interval('(-inf, inf)', '(-inf, 3)'), 'extraSolution')).toBe(true)
  })

  it('interval format problems', () => {
    expect(interval('(5,2)', '(2,5)').status, 'extremos al revés').toBe('formatProblem')
    expect(interval('(-2, ∞]', '(-2,inf)').status, 'infinito con corchete').toBe('formatProblem')
    expect(interval('(-2,3)(4,5)', '(-2,3) U (4,5)').status, 'falta la unión').toBe('formatProblem')
    expect(interval('(1, 2, 3)', '(1,2)').status).toBe('formatProblem')
    expect(interval('x < y', '(1,2)').status).toBe('formatProblem')
    expect(interval('x < 1 o y > 2', '(1,2)').status, 'dos variables').toBe('formatProblem')
    expect(interval('', '(1,2)').status).toBe('formatProblem')
    expect(interval('(1,2)', '(2,1)').status, 'intervalo esperado mal escrito').toBe('formatProblem')
    expect(interval('(-2, ∞]', '(-2,inf)').message).toContain('paréntesis')
  })

  // MARK: Ecuaciones

  it('equivalent equations', () => {
    const rows: Array<[string, string]> = [
      ['y=2x+1', 'y=2x+1'], ['2x-y+1=0', 'y=2x+1'], ['x=(y-1)/2', 'y=2x+1'], ['2y = 4x + 2', 'y=2x+1'], ['y - 1 = 2x', 'y=2x+1'],
      ['y^2+x^2-4=0', 'x^2+y^2=4'], ['x^2 - 5x + 6 = 0', '(x-2)(x-3)=0'], ['2x=6', 'x=3'], ['x/3 = 1', 'x=3'], ['3 = x', 'x=3'],
      ['f(x)=2x+1', 'y=2x+1'], ['y=2x+1', 'f(x)=2x+1'], ['g(x) = 2x+1', 'f(x)=2x+1'], ['f = 2x+1', 'f(x)=2x+1'],
      ['r = 2cos(theta)', 'r=2cos(θ)'], ['r(theta) = 2cos(theta)', 'r=2cos(θ)'], ['r = 2cos θ', 'r(θ)=2cos(θ)'], ['y = 2cos θ', 'r(θ)=2cos(θ)'],
      ['h(t) = -16t^2 + 64', 'h(t) = 64 - 16t^2'], ['h = 64-16t^2', 'h(t) = 64 - 16t^2'], ['x(y) = 6', 'x*y=6'], ['θ = pi/4', 'theta = pi/4'],
      ['y = sen(x)', 'y=sin(x)'], ['x² + y² = r²', 'x^2+y^2=r^2'],
    ]
    for (const [input, expected] of rows) {
      const v = equation(input, expected)
      expect(v.status, `«${input}» vs «${expected}»: ${v.message ?? ''}`).toBe('correct')
      expect(v.latexInput).toBeDefined()
    }
    expect(equation('f(x)=2x+1', 'y=2x+1').normalizedInput, 'se muestra como lo escribió').toBe('f(x) = 2x+1')
    expect(equation('r(theta) = 2cos(theta)', 'r=2cos(θ)').latexInput).toBe('r\\left(\\theta\\right)=2\\cos \\theta')
  })

  it('wrong equations and diagnosis', () => {
    const sign = equation('y=-2x+1', 'y=2x+1')
    expect(sign.status).toBe('incorrect')
    expect(sign.diagnosis).toEqual(['signError'])
    expect(equation('x=2y+1', 'y=2x+1').message).toContain('intercambiaste')
    expect(equation('y = 2x + 2', 'y=2x+1').status).toBe('incorrect')
    expect(equation('x^2=9', 'x=3').status, 'x² = 9 tiene una solución de más').toBe('incorrect')
    expect(equation('x=3', 'x^2=9').status).toBe('incorrect')
    expect(equation('x^2+y^2=2', 'x^2+y^2=4').status).toBe('incorrect')
  })

  it('equation format problems', () => {
    expect(equation('2x+1', 'y=2x+1').status, 'falta el =').toBe('formatProblem')
    expect(equation('f(x) =', 'f(x)=2x+1').status).toBe('formatProblem')
    expect(equation('z = 2x+1', 'y=2x+1').status).toBe('formatProblem')
    expect(equation('y = 2x+1 = 3', 'y=2x+1').status).toBe('formatProblem')
    expect(equation('y <= 2x', 'y=2x').status).toBe('formatProblem')
    expect(equation('', 'y=2x').status).toBe('formatProblem')
    expect(equation('y=2x', 'y=').status, 'ecuación esperada mal escrita').toBe('formatProblem')
    expect(equation('y=2a', 'y=2x', ['x', 'y']).status).toBe('formatProblem')
  })

  // MARK: Texto

  it('text normalization', () => {
    const rows: Array<[string, string]> = [
      ['La Mitocondria', 'mitocondria'], ['mitocondria.', 'mitocondria'], ['  MITOCONDRIA  ', 'mitocondria'], ['fotosíntesis', 'fotosintesis'],
      ['Fotosintesis', 'fotosíntesis'], ['el núcleo', 'núcleo'], ['the nucleus', 'nucleus'], ['H₂O', 'H2O'], ['h2o', 'H2O'],
      ['3,14', '3.14'], ['3.14', '3,14'], ['¡Ácido desoxirribonucleico!', 'acido desoxirribonucleico'], ["don't", 'dont'],
    ]
    for (const [input, accepted] of rows) expect(text(input, [accepted]).status, `«${input}» vs «${accepted}»`).toBe('correct')
    expect(text('DNA', ['ADN']).status, 'los sinónimos los decide el autor').toBe('incorrect')
    expect(text('DNA', ['ADN', 'DNA']).status).toBe('correct')
    expect(text('H2O2', ['H2O']).status, 'las cifras no admiten erratas').toBe('incorrect')
  })

  it('typo tolerance', () => {
    const typo = text('mitocondrai', ['mitocondria'])
    expect(typo.status).toBe('partial')
    expect(typo.message).toContain('ortografía')
    expect(text('fotosinteisis', ['fotosintesis']).status).toBe('partial')
    expect(text('celula', ['célula']).status, 'los acentos no son erratas').toBe('correct')
    expect(text('gen', ['gel']).status, 'palabras cortas: sin tolerancia').toBe('incorrect')
    expect(text('mitocondraaaa', ['mitocondria']).status).toBe('incorrect')
    expect(text('mitocondrai', ['mitocondria'], { typoTolerance: false }).status).toBe('incorrect')
    expect(text('celula', ['célula'], { ignoreAccents: false }).status).not.toBe('correct')
  })

  it('keywords', () => {
    const o: Partial<TextMatchOptions> = { keywords: ['ribosoma', 'proteína|proteínas'] }
    expect(text('El ribosoma produce proteínas', [], o).status).toBe('correct')
    expect(text('ribosomas hacen proteinas', [], o).status, 'erratas leves y acentos dentro de las palabras clave').toBe('correct')
    const half = text('el ribosoma', [], o)
    expect(half.status).toBe('partial')
    expect(Math.abs(half.credit - 0.5)).toBeLessThanOrEqual(1e-9)
    expect(text('nada que ver', [], o).status).toBe('incorrect')
    expect(text('el ribosoma', [], { ...o, minKeywordsForCredit: 2 }).status, 'por debajo del mínimo no hay crédito').toBe('incorrect')
    expect(text('ocurre en el ciclo de Krebs', [], { keywords: ['ciclo de krebs'] }).status).toBe('correct')
  })

  it('text format problems', () => {
    expect(text('', ['a']).status).toBe('formatProblem')
    expect(text('¿?!', ['a']).status).toBe('formatProblem')
    expect(text('algo', []).status, 'ejercicio sin respuestas aceptadas').toBe('formatProblem')
    expect(text('a '.repeat(3000), ['a']).status).toBe('formatProblem')
  })

  it('text options are decodable and tolerant', () => {
    const o = decodeTextMatchOptions(JSON.parse('{"ignoreCase":"no","keywords":"mitosis","minKeywordsForCredit":"1"}'))
    expect(o.ignoreCase).toBe(false)
    expect(o.keywords).toEqual(['mitosis'])
    expect(o.minKeywordsForCredit).toBe(1)
    expect(o.typoTolerance).toBe(true)
    expect(decodeTextMatchOptions(JSON.parse(JSON.stringify(o)))).toEqual(o)
  })
})
