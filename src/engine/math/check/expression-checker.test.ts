import { describe, expect, it } from 'vitest'
import type { AngleMode } from '../core/types'
import { has } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import { decodeExpressionSpec, type ExpressionForm } from './specs'
import type { Diagnosis } from './verdict'

interface ChkOptions {
  form?: ExpressionForm
  forbidden?: string[]
  vars?: string[] | null
  min?: number
  max?: number
  angle?: AngleMode
}

function chk(input: string, expected: string, o: ChkOptions = {}) {
  return AnswerChecker.checkExpression(input, {
    expected, form: o.form ?? 'any', forbiddenFunctions: o.forbidden ?? [], variables: o.vars ?? null,
    domainMin: o.min ?? -6, domainMax: o.max ?? 6, angle: o.angle ?? 'radians',
  })
}

describe('ExpressionCheckerTests', () => {
  // MARK: Equivalencia

  it('equivalent answers are correct', () => {
    const rows: Array<[string, string]> = [
      ['2x+4', '2(x+2)'], ['2(x+2)', '2x+4'], ['(x+1)^2', 'x^2+2x+1'], ['x^2-1', '(x-1)(x+1)'], ['3+2x', '2x+3'], ['2*x+1', '1+x*2'], ['x*2+1', '2x+1'], ['(2x+3)/(x-1)', '(3+2*x)/(x-1)'],
      ['tan(x)', 'sin(x)/cos(x)'], ['1/(2x)', '1/2*1/x'], ['sqrt(x^2)', 'abs(x)'], ['e^(2x)', '(e^x)^2'], ['log(x^2)', '2*log(abs(x))'], ['cos(2x)', '1-2sin(x)^2'],
      ['x^2*x', 'x^3'], ['2^(x+1)', '2*2^x'], ['(x^2-1)/(x-1)', 'x+1'], ['0.5x', 'x/2'], ['x/2', '1/2*x'], ['-(x-3)', '3-x'], ['y', 'y'], ['sqrt(8)', '2sqrt(2)'], ['1/sqrt(2)', 'sqrt(2)/2'],
      ['x²+2x+1', '(x+1)²'], ['2x(x+1)', '2x^2+2x'], ['e^-x', '1/e^x'], ['\\frac{x+1}{2}', '(x+1)/2'], ['(x+1)/2', 'x/2+1/2'],
    ]
    for (const [input, expected] of rows) {
      const v = chk(input, expected)
      expect(v.status, `«${input}» vs «${expected}»: ${v.message ?? ''}`).toBe('correct')
      expect(v.credit).toBe(1)
      expect(v.normalizedInput).toBeDefined()
      expect(v.latexInput).toBeDefined()
    }
    expect(chk('sin(x)^2+cos(x)^2', '1', { vars: ['x'] }).status).toBe('correct')
  })

  it('assignment prefixes are accepted', () => {
    for (const input of ['f(x) = 2x+1', 'y = 2x+1', 'g(x)=2x+1', 'F(t) = 2x+1', '  y=2x+1  ', 'f (x) = 2x+1']) {
      expect(chk(input, '2x+1').status, `«${input}»`).toBe('correct')
    }
    expect(chk('x^2 = 2x+1', '2x+1').status).toBe('formatProblem')
    expect(chk('2x+1 = 2x+1', '2x+1').status).toBe('formatProblem')
    expect(chk('y =', '2x+1').status).toBe('formatProblem')
    expect(chk('y = z = 2x+1', '2x+1').status).toBe('formatProblem')
  })

  it('variables and format problems', () => {
    expect(chk('z+1', 'x+1').status).toBe('formatProblem')
    expect(chk('z+1', 'x+1').message).toContain('Usa solo la variable x')
    expect(chk('x+y', 'x+1').status).toBe('formatProblem')
    expect(chk('', 'x').status).toBe('formatProblem')
    expect(chk('2+', 'x').status).toBe('formatProblem')
    expect(chk('sinn(x)', 'sin(x)').status).toBe('formatProblem')
    expect(chk('sinn(x)', 'sin(x)').message).toContain('¿Quisiste decir «sin»?')
    expect(chk('x', 'x+').status, 'ejercicio mal definido').toBe('formatProblem')
    expect(chk('a*x', 'a*x+b', { vars: ['x', 'a', 'b'] }).status).toBe('incorrect')
    expect(chk('a*x+b', 'b+a*x', { vars: ['x', 'a', 'b'] }).status).toBe('correct')
    expect(chk('x', 't', { vars: ['t'] }).status).toBe('formatProblem')
  })

  it('numeric expected with letters in input', () => {
    const v = chk('sin(x)^2+cos(x)^2', '1')
    expect(v.status).toBe('wrongForm')
    expect(has(v, 'notSimplified')).toBe(true)
    expect(chk('x+1', '1').status).toBe('incorrect')
    expect(chk('sqrt(2)/2', '1/sqrt(2)').status).toBe('correct')
    expect(chk('0.5', '1/2').status).toBe('correct')
    expect(chk('3', '1/2').status).toBe('incorrect')
  })

  // MARK: Diagnóstico

  it('diagnosis of wrong expressions', () => {
    const rows: Array<[string, string, Diagnosis]> = [
      ['-(2x+3)', '2x+3', 'signError'], ['-x^2+1', 'x^2-1', 'signError'], ['2x', 'x', 'factorOfTwo'], ['x/2', 'x', 'factorOfTwo'], ['1/x', 'x', 'reciprocal'], ['x/(x+1)', '(x+1)/x', 'reciprocal'],
      ['2x+2', '2x+1', 'offByOne'], ['2x', '2x+1', 'offByOne'], ['x^4', 'x^2', 'forgotSquareRoot'], ['sqrt(x)', 'x', 'forgotSquare'], ['sin(-x)', 'sin(x)', 'signError'], ['(x-1)^2', '(x+1)^2', 'signError'],
      ['100x', 'x', 'percentVsFraction'], ['57.29578x', 'x', 'degreesVsRadians'], ['0.0174533x', 'x', 'radiansVsDegrees'], ['10x', 'x', 'factorOfTen'], ['x+5', 'x', 'other'],
    ]
    for (const [input, expected, diag] of rows) {
      const v = chk(input, expected)
      expect(v.status, `«${input}» vs «${expected}»: ${v.message ?? ''}`).toBe('incorrect')
      expect(has(v, diag), `«${input}» vs «${expected}»: etiquetas ${v.diagnosis.join(',')}`).toBe(true)
      expect(v.message).toBeDefined()
    }
    const unrelated = chk('x^3+7', 'sin(x)')
    expect(unrelated.diagnosis).toEqual(['other'])
    expect(unrelated.status).toBe('incorrect')
  })

  it('common trap: absolute value', () => {
    const v = chk('sqrt(x^2)', 'x')
    expect(v.status).toBe('incorrect')
    expect(v.message).toContain('|x|')
  })

  it('different domain is partial credit', () => {
    const v = chk('2*log(x)', 'log(x^2)')
    expect(v.status).toBe('partial')
    expect(v.credit).toBe(0.5)
    expect(v.message).toContain('dominio')
    expect(chk('2*log(x)', 'log(x^2)', { min: 0.1, max: 6 }).status, 'en un dominio positivo son equivalentes').toBe('correct')
  })

  // MARK: Formas

  it('expanded form', () => {
    expect(chk('x^2+2x+1', 'x^2+2x+1', { form: 'expanded' }).status).toBe('correct')
    expect(chk('(x+1)^2', 'x^2+2x+1', { form: 'expanded' }).status).toBe('wrongForm')
    expect(has(chk('(x+1)^2', 'x^2+2x+1', { form: 'expanded' }), 'notExpanded')).toBe(true)
    expect(chk('(x+2)(x-2)', 'x^2-4', { form: 'expanded' }).status).toBe('wrongForm')
    expect(chk('x(x+1)', 'x^2+x', { form: 'expanded' }).status).toBe('wrongForm')
    expect(chk('2(x+1)', '2x+2', { form: 'expanded' }).status).toBe('wrongForm')
    expect(chk('x^2-4', 'x^2-4', { form: 'expanded' }).status).toBe('correct')
    expect(chk('(2x)^2', '4x^2', { form: 'expanded' }).status).toBe('wrongForm')
    expect(chk('4x^2', '4x^2', { form: 'expanded' }).status).toBe('correct')
    expect(chk('x^2+x', 'x^2+x+1', { form: 'expanded' }).status).toBe('incorrect')
    expect(chk('sin(x)(x+1)', 'sin(x)*(x+1)', { form: 'expanded' }).status).toBe('correct')
  })

  it('factored form', () => {
    expect(chk('(x+2)(x-2)', '(x+2)(x-2)', { form: 'factored' }).status).toBe('correct')
    expect(chk('x^2-4', '(x-2)(x+2)', { form: 'factored' }).status).toBe('wrongForm')
    expect(has(chk('x^2-4', '(x-2)(x+2)', { form: 'factored' }), 'notFactored')).toBe(true)
    expect(chk('2x+4', '2(x+2)', { form: 'factored' }).status).toBe('wrongForm')
    expect(chk('2(x+2)', '2(x+2)', { form: 'factored' }).status).toBe('correct')
    expect(chk('(x+1)^2', '(x+1)^2', { form: 'factored' }).status).toBe('correct')
    expect(chk('x^2+2x+1', '(x+1)^2', { form: 'factored' }).status).toBe('wrongForm')
    expect(chk('2(x^2-1)', '2(x-1)(x+1)', { form: 'factored' }).status, 'x²-1 todavía se puede factorizar').toBe('wrongForm')
    expect(chk('2(x-1)(x+1)', '2(x-1)(x+1)', { form: 'factored' }).status).toBe('correct')
    expect(chk('x(x+3)', 'x(x+3)', { form: 'factored' }).status).toBe('correct')
    expect(chk('x^2+3x', 'x(x+3)', { form: 'factored' }).status).toBe('wrongForm')
    expect(chk('(x^2+1)(x+1)', '(x^2+1)(x+1)', { form: 'factored' }).status, 'x²+1 es irreducible').toBe('correct')
    expect(chk('(x-1)(x+1)(x^2+1)', 'x^4-1', { form: 'factored' }).status, 'si lo esperado no es factorizado, no se exige').toBe('correct')
  })

  it('simplified form', () => {
    expect(chk('x+1', 'x+1', { form: 'simplified' }).status).toBe('correct')
    expect(chk('(x^2-1)/(x-1)', 'x+1', { form: 'simplified' }).status).toBe('wrongForm')
    expect(chk('x+x+1', '2x+1', { form: 'simplified' }).status).toBe('wrongForm')
    expect(chk('2sqrt(3)', 'sqrt(12)', { form: 'simplified' }).status).toBe('correct')
    expect(chk('sqrt(12)', '2sqrt(3)', { form: 'simplified' }).status).toBe('wrongForm')
    expect(chk('1/sqrt(2)', 'sqrt(2)/2', { form: 'simplified' }).status, 'falta racionalizar el denominador').toBe('wrongForm')
    expect(chk('sqrt(2)/2', 'sqrt(2)/2', { form: 'simplified' }).status).toBe('correct')
    expect(chk('2*3x', '6x', { form: 'simplified' }).status).toBe('wrongForm')
    expect(has(chk('2*3x', '6x', { form: 'simplified' }), 'notSimplified')).toBe(true)
    expect(chk('6/8', '3/4', { form: 'simplified' }).status).toBe('wrongForm')
  })

  it('lowest terms form', () => {
    expect(chk('(x+1)/(x+2)', '(x+1)/(x+2)', { form: 'lowestTerms' }).status).toBe('correct')
    expect(chk('(x^2-1)/(x^2-x)', '(x+1)/x', { form: 'lowestTerms' }).status).toBe('wrongForm')
    expect(has(chk('(x^2-1)/(x^2-x)', '(x+1)/x', { form: 'lowestTerms' }), 'notReduced')).toBe(true)
    expect(chk('(2x+2)/4', '(x+1)/2', { form: 'lowestTerms' }).status, 'queda un factor 2 común').toBe('wrongForm')
    expect(chk('(x+1)/2', '(x+1)/2', { form: 'lowestTerms' }).status).toBe('correct')
    expect(chk('6/8', '3/4', { form: 'lowestTerms' }).status).toBe('wrongForm')
    expect(chk('3/4', '3/4', { form: 'lowestTerms' }).status).toBe('correct')
    expect(chk('(x-1)(x+2)/((x-1)(x+3))', '(x+2)/(x+3)', { form: 'lowestTerms' }).status).toBe('wrongForm')
    expect(chk('(x+2)/(x+3)', '(x+2)/(x+3)', { form: 'lowestTerms' }).status).toBe('correct')
  })

  it('forbidden functions', () => {
    let v = chk('sqrt(3)/2', 'sqrt(3)/2', { forbidden: ['sqrt'] })
    expect(v.status).toBe('wrongForm')
    expect(v.message).toContain('sqrt')
    v = chk('3^(1/2)/2', 'sqrt(3)/2', { forbidden: ['sqrt'] })
    expect(v.status, 'una potencia fraccionaria también es un radical').toBe('wrongForm')
    expect(chk('0.8660254037844386', 'sqrt(3)/2', { forbidden: ['sqrt'] }).status, 'un decimal no es el valor exacto').toBe('partial')
    expect(chk('sin(x)', 'sin(x)', { forbidden: ['cos'] }).status).toBe('correct')
    expect(chk('sin(x)/cos(x)', 'tan(x)', { forbidden: ['tan'] }).status).toBe('correct')
    expect(chk('tan(x)', 'tan(x)', { forbidden: ['TAN'] }).status, 'no distingue mayúsculas').toBe('wrongForm')
    expect(chk('tg(x)', 'tan(x)', { forbidden: ['tan'] }).status, 'los alias cuentan').toBe('wrongForm')
    expect(chk('2x', 'x+x', { forbidden: ['sqrt', 'sin'] }).status).toBe('correct')
    expect(chk('x+1', 'x+2', { forbidden: ['sqrt'] }).status).toBe('incorrect')
  })

  // MARK: Ángulos y dominio

  it('angle mode and domain', () => {
    expect(chk('sin(x)', 'sin(x°)', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('sin(x)', 'sin(x°)', { angle: 'radians' }).status).toBe('incorrect')
    expect(chk('sqrt(x)', 'abs(x)', { min: 0, max: 5 }).status).toBe('incorrect')
    expect(chk('x*abs(x)', 'x^2', { min: 0.5, max: 5 }).status).toBe('correct')
    expect(chk('x*abs(x)', 'x^2', { min: -5, max: 5 }).status).toBe('incorrect')
  })

  // MARK: Avisos y previsualización

  it('previews and ambiguity notes', () => {
    const v = chk('1/2x', '1/(2x)')
    expect(v.status, '1/2x se entiende como 1/(2x)').toBe('correct')
    expect(v.normalizedInput).toBe('1/(2x)')
    expect(v.latexInput).toBe('\\frac{1}{2x}')
    const w = chk('1/2x', 'x/2')
    expect(w.status).toBe('incorrect')
    expect(w.message).toContain('Entendí 1/2x como 1/(2x)')
    expect(chk('(1/2)x', 'x/2').status).toBe('correct')
  })

  it('spec is decodable with tolerant input', () => {
    const spec = decodeExpressionSpec(JSON.parse('{"expected":"2x+1","form":"Factorizada","forbiddenFunctions":"sqrt","samples":"20","domainMin":-3}'))
    expect(spec.expected).toBe('2x+1')
    expect(spec.form).toBe('factored')
    expect(spec.forbiddenFunctions).toEqual(['sqrt'])
    expect(spec.samples).toBe(20)
    expect(spec.domainMin).toBe(-3)
    expect(spec.domainMax).toBe(6)
    expect(decodeExpressionSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec)
    expect(() => decodeExpressionSpec({ form: 'any' })).toThrow()
  })
})
