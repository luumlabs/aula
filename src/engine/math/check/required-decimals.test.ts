import { describe, expect, it } from 'vitest'
import { MathError, type AngleMode } from '../core/types'
import { evaluate, evaluateDouble } from '../eval/evaluate'
import { Fraction } from '../numbers/fraction'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { UnitTable } from '../units/unit-table'
import { MV } from '../core/types'
import { has } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import { MathEquivalence } from './equivalence'
import { NumericChecker } from './numeric-checker'
import type { NumericForm, UnitMode } from './specs'
import type { CheckVerdict, Diagnosis, VerdictStatus } from './verdict'

interface Opts {
  k?: number | null
  alternatives?: string[]
  form?: NumericForm
  unit?: string | null
  unitMode?: UnitMode
  absTol?: number
  relTol?: number
}

const check = (input: string, key: string, o: Opts = {}): CheckVerdict => AnswerChecker.checkNumeric(input, {
  value: key, decimals: o.k ?? null, alternatives: o.alternatives ?? [], form: o.form ?? 'any', unit: o.unit ?? null,
  unitMode: o.unitMode ?? 'optional', absTol: o.absTol ?? 0, relTol: o.relTol ?? 0,
})

function assertVerdict(v: CheckVerdict, status: VerdictStatus, credit: number, context = '', diagnosis: Diagnosis | null = null): void {
  expect(v.status, `${context}: ${v.message ?? ''}`).toBe(status)
  expect(Math.abs(v.credit - credit), context).toBeLessThanOrEqual(1e-12)
  if (diagnosis) expect(has(v, diagnosis), `${context}: ${v.diagnosis.join(',')}`).toBe(true)
}

/** `Int.max` / `Int.min` de Swift como `number` (lo más cerca que se puede escribir). */
const INT_MAX_N = 9_223_372_036_854_775_807
const INT_MIN_N = -9_223_372_036_854_775_808

describe('RequiredDecimalContractTests', () => {
  it('large magnitude does not create free full or partial credit', () => {
    for (const input of ['1000000000500', '1000000000000.02', '999999999999.98']) assertVerdict(check(input, '1000000000000', { k: 2 }), 'incorrect', 0, input)
    assertVerdict(check('-1000000000000.02', '-1000000000000', { k: 2 }), 'incorrect', 0)
    for (const input of ['1000000000000.01', '999999999999.99']) assertVerdict(check(input, '1000000000000', { k: 2 }), 'partial', 0.5, input, 'rounding')
    assertVerdict(check('1000000000002', '1000000000000', { k: 0 }), 'incorrect', 0)
    assertVerdict(check('1000000000001', '1000000000000', { k: 0 }), 'partial', 0.5, '', 'rounding')
  })

  it('tiny values use the requested quantum', () => {
    assertVerdict(check('0', '3.97e-19', { k: 21 }), 'incorrect', 0)
    assertVerdict(check('3.97e-19', '3.97e-19', { k: 21 }), 'correct', 1)
    assertVerdict(check('3.98e-19', '3.97e-19', { k: 21 }), 'partial', 0.5, '', 'rounding')
    assertVerdict(check('3.99e-19', '3.97e-19', { k: 21 }), 'incorrect', 0)
    assertVerdict(check('0', '3.97e-12', { k: 12 }), 'incorrect', 0)
    assertVerdict(check('4e-12', '3.97e-12', { k: 12 }), 'correct', 1)
    assertVerdict(check('0', '0.001', { k: 2 }), 'correct', 1, 'rounding genuinely gives zero')
  })

  it('rounded values and school half ties remain correct', () => {
    const rows: Array<[string, string, number]> = [['0.333', '1/3', 3], ['0.667', '2/3', 3], ['-0.333', '-1/3', 3], ['-0.667', '-2/3', 3],
      ['2.68', '2.675', 2], ['-1.01', '-1.005', 2], ['3.14', 'pi', 2], ['1.41', 'sqrt(2)', 2], ['100', '99.999', 2]]
    for (const [input, key, k] of rows) assertVerdict(check(input, key, { k }), 'correct', 1, `${input} vs ${key}`)
  })

  it('unrounded values remain wrongForm', () => {
    for (const [input, key, k] of [['1/3', '1/3', 3], ['2/3', '2/3', 3], ['1/3', '1/3', 21], ['3.14159265', 'pi', 2], ['pi', 'pi', 2], ['sqrt(2)', 'sqrt(2)', 2]] as Array<[string, string, number]>) {
      const r = check(input, key, { k })
      assertVerdict(r, 'wrongForm', 0.5, input, 'rounding')
      expect(has(r, 'sameAsExpected')).toBe(true)
    }
  })

  it('author tolerances do not override requested decimals', () => {
    assertVerdict(check('3.2', 'pi', { k: 2, absTol: 1, relTol: 1 }), 'incorrect', 0)
    assertVerdict(check('1000000000000.02', '1000000000000', { k: 2, absTol: 1 }), 'incorrect', 0)
    assertVerdict(check('3.2', 'pi', { absTol: 1 }), 'correct', 1, 'no decimals: preserve explicit tolerance')
    assertVerdict(check('101', '100', { relTol: 0.02 }), 'correct', 1)
  })

  it('exact large rational fixed points and trailing zeros', () => {
    const rows: Array<[string, string, number]> = [
      ['10000000000000000', '10000000000000000', 2], ['10000000000000000', '10000000000000000.00', 2], ['10000000000000000.00', '10000000000000000', 2],
      ['-10000000000000000.00', '-10000000000000000', 2], ['1000000000000', '1000000000000', 15], ['1000000000000.000000000000000', '1000000000000', 15],
    ]
    for (const [input, key, k] of rows) assertVerdict(check(input, key, { k }), 'correct', 1, input)
    assertVerdict(check('1000000000000.02', '1000000000000', { k: 15 }), 'incorrect', 0)
  })

  it('distinct rationals collapsed to one double stay wrong', () => {
    const key = Fraction.parse('10000000000000000')
    const next = Fraction.parse('10000000000000001')
    expect(key && next && !key.equals(next)).toBe(true)
    expect(key?.doubleValue, 'fixture: different rationals share their Double').toBe(next?.doubleValue)
    for (const [input, expected] of [['10000000000000001', '10000000000000000'], ['9999999999999999', '10000000000000000'], ['10000000000000001.00', '10000000000000000.00']]) {
      assertVerdict(check(input, expected, { k: 2 }), 'incorrect', 0, input)
    }
  })

  it('fixed finite fractions do not require a materialized decimal scale', () => {
    for (const [input, key, k] of [['1/2', '1/2', 21], ['0.5', '1/2', 21], ['1/4611686018427387904', '1/4611686018427387904', 62], ['0', '0', 62], ['0.' + '0'.repeat(62), '0', 62]] as Array<[string, string, number]>) {
      assertVerdict(check(input, key, { k }), 'correct', 1, input)
    }
  })

  it('the rounded target can differ from the exact key', () => {
    const key = '1000000000000000001/1000000000'
    assertVerdict(check('1000000000', key, { k: 2 }), 'correct', 1)
    assertVerdict(check(key, key, { k: 2 }), 'wrongForm', 0.5, '', 'rounding')
  })

  it('a one-ULP rational difference does not become full credit', () => {
    assertVerdict(check('4503599627370497/4503599627370496', '1', { k: 2 }), 'wrongForm', 0.5, '', 'rounding')
  })

  it('unit credit uses the raw decimal match', () => {
    assertVerdict(check('1000000000000', '1000000000000', { k: 2, unit: 'm', unitMode: 'required' }), 'partial', 0.5, '', 'unitMissing')
    assertVerdict(check('1000000000000 s', '1000000000000', { k: 2, unit: 'm', unitMode: 'required' }), 'partial', 0.5, '', 'unitWrong')
    assertVerdict(check('1000000000000.02', '1000000000000', { k: 2, unit: 'm', unitMode: 'required' }), 'incorrect', 0)
    assertVerdict(check('1000000000000.02 s', '1000000000000', { k: 2, unit: 'm', unitMode: 'required' }), 'incorrect', 0)
    assertVerdict(check('100 cm', '1', { k: 2, unit: 'm', unitMode: 'required' }), 'correct', 1)
  })

  it('percent credit uses the transformed value', () => {
    assertVerdict(check('37.5', '0.375', { k: 3, form: 'percent' }), 'wrongForm', 0.5, '', 'percentVsFraction')
    assertVerdict(check('37.5%', '0.375', { k: 3, form: 'percent' }), 'correct', 1)
    assertVerdict(check('1000000000002', '10000000000', { k: 2, form: 'percent' }), 'incorrect', 0)
  })

  it('temperature credit uses the raw value', () => {
    assertVerdict(check('20 K', '20', { k: 2, unit: '°C', unitMode: 'required' }), 'partial', 0.5, '', 'unitConversion')
    assertVerdict(check('1000000000000.02 K', '1000000000000', { k: 2, unit: '°C', unitMode: 'required' }), 'incorrect', 0)
  })

  it('forms and alternative targets remain supported', () => {
    assertVerdict(check('0.75', '3/4', { k: 2, form: 'fraction' }), 'wrongForm', 0.5, '', 'decimalInsteadOfFraction')
    assertVerdict(check('-3.14', 'pi', { k: 2, alternatives: ['-pi'] }), 'correct', 1)
    assertVerdict(check('3.14', 'pi', { k: 2, alternatives: ['bad(', '-pi'] }), 'correct', 1)
  })

  it('a certified full wins over an unresolved alternative in either order', () => {
    for (const [key, alt] of [['1', '100*sqrt(2)'], ['100*sqrt(2)', '1']]) assertVerdict(check('1', key, { k: 15, alternatives: [alt] }), 'correct', 1)
  })

  it('an unresolved real evaluation explains the evaluator limit', () => {
    for (const [input, key, k] of [['10000000000000000+sin(1)', '10000000000000000', 2], ['100*sqrt(2)', '100*sqrt(2)', 15]] as Array<[string, string, number]>) {
      const r = check(input, key, { k })
      assertVerdict(r, 'formatProblem', 0)
      expect(r.diagnosis).toEqual([])
      expect(r.message).toBeDefined()
    }
    assertVerdict(check('141', '100*sqrt(2)', { k: 15, alternatives: ['141'] }), 'correct', 1)
  })

  it('a certified partial survives an unresolved alternative in either order', () => {
    for (const [key, alt] of [['1/3', '100*sqrt(2)'], ['100*sqrt(2)', '1/3']]) assertVerdict(check('1/3', key, { k: 15, alternatives: [alt] }), 'wrongForm', 0.5, '', 'rounding')
  })

  it('an unknown alternative prevents an uncertified rejection', () => {
    for (const [key, alt] of [['1', '100*sqrt(2)'], ['100*sqrt(2)', '1']]) {
      const r = check('2', key, { k: 15, alternatives: [alt] })
      assertVerdict(r, 'formatProblem', 0)
      expect(r.diagnosis).toEqual([])
    }
  })

  it('the precision marker survives separator readings', () => {
    const separator = NumberInput.decimalComma ? '.' : ','
    const input = `cos(1${separator}001*pi)`
    expect(NumericChecker.groupingReadings(input).length, 'fixture must actually have both readings').toBe(2)
    const r = check(input, '1', { k: 18 })
    assertVerdict(r, 'formatProblem', 0)
    expect(r.normalizedInput).toBeDefined()
    expect(r.latexInput).toBeDefined()
    expect(r.diagnosis).toEqual([])
  })

  it('the precision marker survives degree label readings', () => {
    const r = check('2°', '1', { k: 18 })
    assertVerdict(r, 'formatProblem', 0)
    expect(r.normalizedInput).toBeDefined()
    expect(r.latexInput).toBeDefined()
  })

  it('a certified degree label full still wins', () => {
    assertVerdict(check('1°', '1', { k: 18 }), 'correct', 1)
  })

  it('ordinary format and incorrect keep the existing ranking', () => {
    const separator = NumberInput.decimalComma ? '.' : ','
    const input = `sqrt(1${separator}001-2)`
    expect(NumericChecker.groupingReadings(input).length).toBe(2)
    assertVerdict(check(input, '0', { k: 2 }), 'incorrect', 0)
  })

  it('no decimals preserves the generic tolerance and approximation', () => {
    assertVerdict(check('1.4142135', 'sqrt(2)'), 'correct', 1)
    assertVerdict(check('0.333', '1/3'), 'partial', 0.5, '', 'rounding')
    assertVerdict(check('0.0001', '0', { absTol: 0.001 }), 'correct', 1)
    assertVerdict(check('0.500001', '1/2'), 'incorrect', 0)
  })
})

describe('RequiredDecimalPrecisionPostfixTests', () => {
  it('extreme places reject before rounding', () => {
    for (const k of [INT_MAX_N, 400]) {
      const r = check('12', '12', { k })
      expect(r.status).toBe('formatProblem')
      expect(r.credit).toBe(0)
      expect(r.diagnosis).toEqual([])
      expect(r.message).toBeDefined()
    }
  })

  it('checked optional arithmetic does not invent a student error', () => {
    const minimum = '(-4611686018427387904)*2'
    expect(check(minimum, minimum, { k: 2 }).status, 'fixed rational equality needs no absolute value').toBe('correct')
    const uncertain = check('0', minimum, { k: 2 })
    expect(uncertain.status, 'a failed exact subtraction certificate is not proof of a student error').toBe('formatProblem')
    expect(uncertain.credit).toBe(0)
    expect(check('0', minimum, { k: 2, alternatives: ['0'] }).status, 'another certified full alternative still wins').toBe('correct')
  })

  it('undefined and existing negative places behavior remain intact', () => {
    expect(check('DNE', 'DNE', { k: INT_MAX_N }).status).toBe('correct')
    expect(check('12', '12', { k: INT_MIN_N }).status, 'existing negative places coerce to zero').toBe('correct')
  })
})

describe('NumericBoundarySafetyTests', () => {
  it('root indices beyond Int remain numeric', () => {
    for (const source of ['root(1e20,2)', 'root(-1e20,2)', 'root(-9223372036854775808,2)']) {
      const e = MathParser.parse(source)
      expect(Math.abs(evaluateDouble(e) - 1), source).toBeLessThanOrEqual(1e-12)
      expect(Math.abs(MV.double(evaluate(e)) - 1), source).toBeLessThanOrEqual(1e-12)
    }
    for (const source of ['root(1e20,-2)', 'root(-1e20,-2)', 'root(-9223372036854775808,-2)']) {
      const e = MathParser.parse(source)
      expect(() => evaluateDouble(e), source).toThrow()
      expect(() => evaluate(e), source).toThrow()
    }
    expect(Math.abs(evaluateDouble(MathParser.parse('root(-3,-8)')) + 0.5)).toBeLessThanOrEqual(1e-12)
  })

  it('infinite trigonometric arguments report domain in both angle modes', () => {
    const kindOf = (f: () => unknown): string | null => {
      try {
        f()
        return null
      } catch (e) {
        return e instanceof MathError ? e.kind : 'other'
      }
    }
    for (const fn of ['sin', 'cos', 'tan', 'sec', 'csc', 'cot']) {
      for (const arg of ['inf', '-inf']) {
        const source = `${fn}(${arg})`
        const e = MathParser.parse(source)
        for (const mode of ['degrees', 'radians'] as AngleMode[]) {
          expect(kindOf(() => evaluateDouble(e, {}, mode)), source).toBe('domain')
          expect(kindOf(() => evaluate(e, {}, mode)), source).toBe('domain')
        }
      }
    }
    expect(Math.abs(evaluateDouble(MathParser.parse('sin(30)'), {}, 'degrees') - 0.5)).toBeLessThanOrEqual(1e-12)
  })

  it('nested unit powers reject unrepresentable dimensions', () => {
    for (const symbol of ['m', 's', 'N']) {
      const source = '('.repeat(10) + symbol + ')^99'.repeat(10)
      expect(source.length).toBeLessThanOrEqual(60)
      expect(UnitTable.parse(source), source).toBeNull()
    }
    const ordinary = UnitTable.parse('(m/s^2)^3')
    expect(ordinary ? [...ordinary.dimension] : null).toEqual([3, 0, -6, 0, 0, 0, 0, 0])
  })

  it('an extreme equivalence sample count does not overflow', () => {
    expect(MathEquivalence.equivalent(MathParser.parse('x+1'), MathParser.parse('x+2'), { samples: Number.MAX_SAFE_INTEGER })).toBe(false)
  })
})

describe('AuditMathSignsAndRadicalsTests', () => {
  const expression = (input: string, expected: string, forbidden: string[] = []) => AnswerChecker.checkExpression(input, { expected, forbiddenFunctions: forbidden })
  const text = (input: string, accepted: string[]) => AnswerChecker.checkText(input, accepted).status

  it('text answers keep their charges', () => {
    expect(text('Na+', ['Na+'])).toBe('correct')
    expect(text('Na', ['Na+'])).not.toBe('correct')
    expect(text('Na-', ['Na+'])).not.toBe('correct')
    expect(text('Cl-', ['Cl+'])).not.toBe('correct')
    expect(text('Cl−', ['Cl-']), 'el signo menos Unicode es el mismo que el guion').toBe('correct')
  })

  it('text answers keep numeric signs', () => {
    expect(text('3-4', ['3+4'])).not.toBe('correct')
    expect(text('3 + 4', ['3+4'])).toBe('correct')
    expect(text('well known', ['well-known'])).toBe('correct')
  })

  it('prose hyphens keep joining words', () => {
    expect(text('well - known', ['well known'])).toBe('correct')
    expect(text('COVID 19', ['COVID-19'])).toBe('correct')
    expect(text('SARS CoV 2', ['SARS-CoV-2'])).toBe('correct')
    expect(text('K, Ca, P, Cl, Ar', ['K - Ca - P - Cl - Ar'])).toBe('correct')
  })

  it('signs attached to digits are kept', () => {
    expect(text('Na-1', ['Na+1'])).not.toBe('correct')
    expect(text('Fe-3', ['Fe+3'])).not.toBe('correct')
    expect(text('2x-1', ['2x+1'])).not.toBe('correct')
    expect(text('x-1', ['x+1'])).not.toBe('correct')
    expect(text('x - 1', ['x-1'])).toBe('correct')
    expect(text('Na+1', ['Na+1'])).toBe('correct')
  })

  it('a lone sign is a format problem', () => {
    expect(text('+', ['Na+'])).toBe('formatProblem')
    expect(text('-', ['Cl-'])).toBe('formatProblem')
  })

  it('a fractional power counts as any radical', () => {
    expect(expression('x^(1/3)', 'cbrt(x)', ['cbrt']).status).toBe('wrongForm')
    expect(expression('x^0.5', 'sqrt(x)', ['root']).status).toBe('wrongForm')
    expect(expression('x^(1/3)', 'cbrt(x)', ['root']).status).toBe('wrongForm')
    expect(expression('x^(1/3)', 'cbrt(x)').status).toBe('correct')
    expect(expression('x^0.5', 'sqrt(x)', ['cbrt']).status).not.toBe('wrongForm')
    expect(expression('x^(1/3)', 'cbrt(x)', ['sqrt']).status).not.toBe('wrongForm')
    expect(expression('sqrt(x)', 'sqrt(x)', ['root']).status).toBe('wrongForm')
    expect(expression('cbrt(x)', 'cbrt(x)', ['root']).status).toBe('wrongForm')
    expect(expression('root(3,x)', 'cbrt(x)', ['cbrt']).status).toBe('wrongForm')
    expect(expression('x^pi', 'x^pi', ['sqrt']).status).not.toBe('wrongForm')
    const v = expression('x^0.5', 'sqrt(x)', ['sqrt', 'cbrt', 'root'])
    expect(v.status).toBe('wrongForm')
    expect(v.message).toContain('sqrt')
  })
})
