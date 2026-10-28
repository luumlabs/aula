import { afterEach, describe, expect, it } from 'vitest'
import { NumberStyle } from '../../base/numberStyle'
import { derivative } from '../algebra/derivative'
import { simplify } from '../algebra/simplify'
import { freeVariables } from '../core/expr'
import { MV } from '../core/types'
import { tryEvaluate, tryEvaluateDouble } from '../eval/evaluate'
import { NumberFormat } from '../format/number-format'
import { Fraction } from '../numbers/fraction'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { TemplateEngine } from '../template/engine'
import { makeTemplateContext } from '../template/types'
import { UnitTable } from '../units/unit-table'
import { Q, exact, expectFrac, expectValue, frac, has, parseError } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import type { ExpressionForm, NumericSpec } from './specs'
import type { Diagnosis } from './verdict'

/** Textos hostiles: vacíos, enormes, anidados, Unicode raro. */
const HOSTILE: string[] = [
  '', ' ', '\n\t', '\u0000', '​​', '((((', '))))', '{{{{', '}}}}', '||||', '^^^^', '----', '++++', '....', ',,,,', ';;;;',
  '∞∞∞', '√√√', '°°°', '%%%', '!!!!', '😀', 'x😀y', '🧪 2', 'ﷺ', '‮2+3', 'á+1', '١٢٣', '２＋３', 'ℵ₀', 'e̊', '\\', '$$', '\\frac{', '\\sqrt[',
  '{{x}}', '1e99999', '1e-99999', 'log_(', 'log_{', 'x_{', 'x_', 'sin^', 'sin^-', 'nCr(', 'max(1,', '(1,2]', '[1,', 'x<', '<x', '=', '==', 'x=', '≤≥≠',
  '9' + '9'.repeat(400),
  '0.' + '0'.repeat(500) + '1',
  'theta' + 'theta'.repeat(300),
  'sin' + 'sin '.repeat(400) + 'x',
  '('.repeat(1000) + 'x' + ')'.repeat(1000),
  '['.repeat(1000) + '1' + ']'.repeat(1000),
  '\\frac{1}{'.repeat(300) + '2' + '}'.repeat(300),
  '-'.repeat(5000) + '1',
  Array(3000).fill('2').join('^'),
  Array(4000).fill('x').join('+'),
  '1,'.repeat(5000),
  '(1,2) U '.repeat(1200) + '(3,4)',
  'a'.repeat(10_000),
  'é'.repeat(10_000),
  '±1'.repeat(1000),
  '{{a}}'.repeat(2000),
  '½'.repeat(3000),
  'x'.repeat(10_000),
]

const numeric = (input: string, value: string, more: Partial<NumericSpec> = {}) => AnswerChecker.checkNumeric(input, { value, ...more })
const expression = (input: string, expected: string, form: ExpressionForm = 'any', forbidden: string[] = []) =>
  AnswerChecker.checkExpression(input, { expected, form, forbiddenFunctions: forbidden })

/** Entradas hostiles en TODAS las entradas públicas (nunca cuelgan ni fallan) y regresiones. */
describe('HostileAndRegressionTests', () => {
  afterEach(() => NumberInput.apply('auto'))

  it('parser, evaluator and printers never crash or hang', () => {
    const start = Date.now()
    for (const s of HOSTILE) {
      let e
      try {
        e = MathParser.parse(s)
      } catch {
        e = null
      }
      if (e) {
        toPlain(e)
        toLatex(e)
        simplify(e)
        derivative(e, 'x')
        freeVariables(e)
        tryEvaluate(e, { x: MV.int(2) })
        tryEvaluateDouble(e, { x: 2 })
      }
      try {
        MathParser.parseEquation(s)
      } catch {
        // se espera
      }
      MathParser.ambiguityNote(s)
      Fraction.parse(s)
      UnitTable.parse(s)
    }
    expect(Date.now() - start).toBeLessThan(10_000)
  })

  it('checkers never crash or hang and answer with a verdict', () => {
    const start = Date.now()
    for (const s of HOSTILE) {
      const verdicts = [
        AnswerChecker.checkNumeric(s, { value: '3/4', unit: 'm' }), AnswerChecker.checkExpression(s, { expected: '2x+1' }),
        AnswerChecker.checkEquation(s, 'y=2x+1'), AnswerChecker.checkSet(s, ['1', '2']),
        AnswerChecker.checkInterval(s, '(1,2]'), AnswerChecker.checkPoint(s, ['1', '2']),
        AnswerChecker.checkText(s, ['mitocondria']),
      ]
      for (const v of verdicts) {
        expect(v.credit >= 0 && v.credit <= 1, `crédito fuera de rango para «${s.slice(0, 40)}»`).toBe(true)
        if (v.status === 'formatProblem') expect(v.message, `«${s.slice(0, 40)}» sin mensaje`).toBeDefined()
      }
      // también como respuesta esperada (ejercicio mal escrito): nunca lanza
      AnswerChecker.checkNumeric('1', { value: s })
      AnswerChecker.checkExpression('x', { expected: s })
      AnswerChecker.checkEquation('y=x', s)
      AnswerChecker.checkSet('1', [s])
      AnswerChecker.checkInterval('(1,2)', s)
      AnswerChecker.checkPoint('(1,2)', [s, s])
      AnswerChecker.checkText('a', [s])
    }
    expect(Date.now() - start, 'los verificadores deben responder rápido').toBeLessThan(20_000)
  }, 60_000)

  it('templates never crash or hang', () => {
    const start = Date.now()
    const ctx = makeTemplateContext({ a: MV.int(2) }, { a: '2' })
    const attempt = (f: () => unknown): void => {
      try {
        f()
      } catch {
        // se espera
      }
    }
    for (const s of HOSTILE) {
      attempt(() => TemplateEngine.render(s, ctx))
      attempt(() => TemplateEngine.evaluate(s, ctx))
      attempt(() => TemplateEngine.sample([{ name: 'a', kind: { type: 'int', min: 1, max: 3, exclude: [] } }], [s], 1, 5))
      attempt(() => TemplateEngine.sample([{ name: 'a', kind: { type: 'expr', expr: s } }], [], 1))
    }
    expect(Date.now() - start).toBeLessThan(10_000)
  })

  it('a thousand nested parentheses give a clear error', () => {
    const deep = '('.repeat(1000) + '1' + ')'.repeat(1000)
    expect(parseError(deep)?.kind, '2001 caracteres: se rechaza por largo antes de analizar').toBe('syntax')
    expect(parseError(deep)?.message).toContain('demasiado larga')
    const deep900 = '('.repeat(900) + '1' + ')'.repeat(900)
    expect(parseError(deep900)?.kind, 'cabe en el límite de longitud pero no en el de profundidad').toBe('overflow')
    expect(parseError(deep900)?.message).toContain('niveles anidados')
    expect(AnswerChecker.checkExpression(deep, { expected: '1' }).status).toBe('formatProblem')
    expect(AnswerChecker.checkSet('1,'.repeat(3000), ['1']).status).toBe('formatProblem')
    expect(AnswerChecker.checkNumeric('1'.repeat(10_000), { value: '1' }).status).toBe('formatProblem')
    expect(AnswerChecker.checkExpression('x+'.repeat(5000) + 'x', { expected: 'x' }).message).toContain('demasiado larga')
  })

  // MARK: Regresiones: verificador numérico

  it('thousands separated by spaces', () => {
    expect(numeric('1 000', '1000').status).toBe('correct')
    expect(numeric('1 000 000', '1e6').status).toBe('correct')
    expect(numeric('1 000,5', '1000.5').status).toBe('correct')
    expect(numeric('2 1/2', '5/2').status, 'los números mixtos no se tocan').toBe('correct')
    expect(numeric('12 345 m', '12345', { unit: 'm' }).status).toBe('correct')
  })

  it('key written as a rounded decimal', () => {
    NumberStyle.apply('point')
    const exactValue = numeric('1/3', '0.333')
    expect(exactValue.status).toBe('wrongForm')
    expect(exactValue.diagnosis).toEqual(['sameAsExpected', 'rounding'])
    expect(exactValue.message).toContain('0.333')
    expect(numeric('pi', '3.14').status).toBe('wrongForm')
    expect(numeric('3.1416', '3.14').status).toBe('wrongForm')
    expect(numeric('0.333', '0.333').status).toBe('correct')
    expect(numeric('0.33', '0.333').status, 'menos cifras que la clave: aproximación').toBe('partial')
    expect(numeric('0.33', '0.333').diagnosis).toEqual(['rounding'])
    expect(numeric('0.5', '0.5').status).toBe('correct')
  })

  it("diagnosis tolerates the student's rounding", () => {
    const rows: Array<[string, string, Diagnosis]> = [
      ['43', '0.75', 'degreesVsRadians'], ['0.0131', '0.75', 'radiansVsDegrees'], ['-1.41', 'sqrt(2)', 'signError'], ['1.41', '-sqrt(2)', 'signError'],
      ['2.83', 'sqrt(2)', 'factorOfTwo'], ['0.71', 'sqrt(2)', 'reciprocal'], ['14.1', 'sqrt(2)', 'factorOfTen'], ['3.14', '-pi', 'signError'],
      ['57.3', '1', 'degreesVsRadians'], ['151', '12.3', 'forgotSquareRoot'], ['2.72', 'e - 1', 'offByOne'],
    ]
    for (const [input, value, diag] of rows) {
      const v = numeric(input, value)
      expect(v.status, `«${input}» vs «${value}»`).toBe('incorrect')
      expect(has(v, diag), `«${input}» vs «${value}»: ${v.diagnosis.join(',')}`).toBe(true)
    }
    expect(has(numeric('1', '0.75'), 'forgotSquareRoot')).toBe(false)
    expect(numeric('6', '2.5').diagnosis).toEqual(['other'])
  })

  it('the angle mode of the expression is detected', () => {
    const deg = numeric('sin(30)', '1/2')
    expect(deg.status).toBe('incorrect')
    expect(deg.diagnosis).toEqual(['degreesVsRadians'])
    expect(deg.message).toContain('°')
    expect(numeric('sin(pi/6)', '1/2', { angle: 'degrees' }).diagnosis).toEqual(['radiansVsDegrees'])
    expect(numeric('sin(30°)', '1/2').status).toBe('correct')
    expect(numeric('sin(30)', '1/2', { angle: 'degrees' }).status).toBe('correct')
  })

  it('mixed numbers are previewed as written', () => {
    const v = numeric('3 1/2', '7/2', { form: 'mixedNumber' })
    expect(v.status).toBe('correct')
    expect(v.normalizedInput).toBe('3 1/2')
    expect(v.latexInput).toBe('3\\frac{1}{2}')
    expect(numeric('-3 1/2', '-7/2').normalizedInput).toBe('-3 1/2')
  })

  it('set builder notation for intervals', () => {
    for (const input of ['{x | -2 < x < 2}', '{x : -2 < x < 2}', '{x ∈ R | -2 < x < 2}', '{ x | x > -2 y x < 2 }']) {
      expect(AnswerChecker.checkInterval(input, '(-2, 2)').status, `«${input}»`).toBe('correct')
    }
    expect(AnswerChecker.checkInterval('{x | x ≠ 1}', '(-inf,1) U (1,inf)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('(-2, 2)', '{x | -2 < x < 2}').status, 'también en la respuesta esperada').toBe('correct')
    expect(AnswerChecker.checkInterval('{1, 2}', '{1; 2}').status, 'las llaves sin barra siguen siendo puntos').toBe('correct')
  })

  it('decimals are previewed as written', () => {
    expect(numeric('0.3333333', '1/3').normalizedInput).toBe('0.3333333')
    expect(numeric('0.8660254037844386', 'sqrt(3)/2').normalizedInput).toBe('0.8660254037844386')
    expect(numeric('0.8660254037844386', 'sqrt(3)/2').latexInput).toBe('0.8660254037844386')
  })

  it('trailing zeros do not overflow exact decimals', () => {
    expectFrac(Fraction.parse('1.50000000000000000000'), frac(3, 2))
    expectFrac(Fraction.parse('0.2500000000000000000000000'), frac(1, 4))
    expectValue(exact('1.50000000000000000000 + 1'), Q(5, 2))
    expect(numeric('0.750000000000000000000', '3/4').status).toBe('correct')
    expectFrac(Fraction.parse('100.000'), frac(100))
    expectFrac(Fraction.parse('1e2'), frac(100))
  })

  // MARK: Regresiones: verificador de expresiones

  it('exact constants against decimals', () => {
    expect(expression('0.7071', 'sqrt(2)/2').status).toBe('partial')
    expect(expression('0.7071', 'sqrt(2)/2').diagnosis).toEqual(['rounding'])
    expect(expression('0.8660254037844386', 'sqrt(3)/2').status).toBe('partial')
    expect(expression('3.141592653589793', 'pi').status).toBe('partial')
    expect(expression('0.3333333333333333', '1/3').status).toBe('partial')
    expect(expression('0.5', '1/2').status).toBe('correct')
    expect(expression('1/sqrt(2)', 'sqrt(2)/2').status).toBe('correct')
    expect(expression('0.9', 'sqrt(2)/2').status).toBe('incorrect')
    expect(expression('3^(1/2)/2', 'sqrt(3)/2', 'any', ['sqrt']).status).toBe('wrongForm')
    expect(expression('x^0.5', 'sqrt(x)', 'any', ['sqrt']).status).toBe('wrongForm')
  })

  it('simplified form rules', () => {
    const notSimplified: Array<[string, string]> = [
      ['x+x+1', '2x+1'], ['2x-3x', '-x'], ['x+2+3', 'x+5'], ['x+0', 'x'], ['2*3x', '6x'], ['2x/4', 'x/2'], ['x*x', 'x^2'], ['x^2*x', 'x^3'],
      ['x/x*2', '2'], ['1x', 'x'], ['x/1', 'x'], ['x^1', 'x'], ['--x', 'x'], ['6/8', '3/4'], ['(x^2-1)/(x-1)', 'x+1'], ['(2x+2)/4', '(x+1)/2'],
      ['sqrt(12)', '2sqrt(3)'], ['sqrt(1/2)', 'sqrt(2)/2'], ['1/sqrt(2)', 'sqrt(2)/2'], ['cbrt(16)', '2cbrt(2)'], ['2^3x', '8x'], ['sqrt(4)x', '2x'],
      ['x/(-2)', '-x/2'], ['e^x*e^(2x)', 'e^(3x)'], ['2(x+1)+3(x+1)', '5(x+1)'], ['a*b+b*a', '2a*b'], ['sin(pi/6)x', 'x/2'], ['(-x)(-y)', 'x*y'],
    ]
    for (const [input, expected] of notSimplified) {
      const v = expression(input, expected, 'simplified')
      expect(v.status, `«${input}» no está simplificada: ${v.message ?? ''}`).toBe('wrongForm')
      expect(has(v, 'notSimplified'), `«${input}»`).toBe(true)
    }
    const simplified: Array<[string, string]> = [
      ['2x+1', '2x+1'], ['x/2', 'x/2'], ['(1/2)x', 'x/2'], ['0.5x', 'x/2'], ['-3/4', '-3/4'], ['-x/2', '-x/2'], ['3x/2', '3x/2'], ['x^3', 'x^3'],
      ['3sqrt(2)', '3sqrt(2)'], ['sqrt(2)/2', 'sqrt(2)/2'], ['3sqrt(2)/2', '3sqrt(2)/2'], ['pi/2', 'pi/2'], ['e^(3x)', 'e^(3x)'], ['5(x+1)', '5(x+1)'],
      ['5x+5', '5(x+1)'], ['(x+2)(x-3)', 'x^2-x-6'], ['x^2-x-6', 'x^2-x-6'], ['2x+3y', '2x+3y'], ['sin(x)^2+cos(x)^2', 'sin(x)^2+cos(x)^2'],
    ]
    for (const [input, expected] of simplified) {
      const v = expression(input, expected, 'simplified')
      expect(v.status, `«${input}» sí está simplificada: ${v.message ?? ''}`).toBe('correct')
    }
  })

  it('assignment prefixes with function notation', () => {
    for (const input of ['f(theta) = 2theta', 'f(θ) = 2θ', "f'(x) = 2x", "y' = 2x", 'dy/dx = 2x', 'g(x, y) = 2x']) {
      const expected = input.includes('θ') || input.includes('theta') ? '2θ' : '2x'
      expect(expression(input, expected).status, `«${input}»`).toBe('correct')
    }
    expect(expression('x^2 = 2x', '2x').status).toBe('formatProblem')
  })

  it('absurd digit counts are clamped', () => {
    const start = Date.now()
    expect(NumberFormat.decimal(1.5, Number.MAX_SAFE_INTEGER)).not.toBe('')
    expect(NumberFormat.decimal(1.5, 999_999_999)).not.toBe('')
    expect(NumberFormat.significant(1, 999_999_999)).not.toBe('')
    expect(NumberFormat.scientificTeX(12345, Number.MAX_SAFE_INTEGER)).not.toBe('')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(NumberFormat.decimal(1.5, 2, false)).toBe('1.50')
  })

  it('huge integer ranges sample quickly', () => {
    const start = Date.now()
    const kind = { type: 'int' as const, min: -2_400_000, max: 2_400_000, exclude: [0] }
    try {
      TemplateEngine.sample([{ name: 'a', kind }], ['a == 17'], 7)
    } catch {
      // casi nunca se cumple
    }
    const ctx = TemplateEngine.sample([{ name: 'a', kind }], ['a != 1'], 7)
    const a = MV.double(ctx.values.a)
    expect(Math.abs(a) <= 2_400_000 && a !== 0).toBe(true)
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('the input preference is the shared NumberStyle', () => {
    NumberInput.apply('comma')
    expect(NumberInput.decimalComma).toBe(true)
    expect(NumberStyle.decimalComma, 'un solo estado para toda la app').toBe(true)
    NumberInput.apply('point')
    expect(NumberInput.decimalComma).toBe(false)
    expect(NumberStyle.decimalComma).toBe(false)
    NumberStyle.apply('comma')
    expect(NumberInput.decimalComma, 'lo que fija la interfaz en NumberStyle vale para la entrada').toBe(true)
    NumberInput.decimalComma = false
    expect(NumberStyle.decimalComma).toBe(false)
    NumberInput.apply('auto')
    expect(NumberInput.decimalComma).toBe(NumberInput.systemDecimalComma)
  })
})
