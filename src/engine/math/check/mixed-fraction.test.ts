import { describe, expect, it } from 'vitest'
import { AnswerChecker } from './answer-checker'
import { WrittenForm } from './numeric-checker'
import type { NumericForm } from './specs'
import type { Diagnosis } from './verdict'
import { Fraction } from '../numbers/fraction'
import { INT_MAX, INT_MIN } from '../numbers/int64'
import { expectFrac } from '../test-support.testutil'

// MJ-M10/MJ-M11: requisitos de forma de los números mixtos.
const check = (input: string, value: string, form: NumericForm, unit: string | null = null) =>
  AnswerChecker.checkNumeric(input, { value, form, unit, unitMode: unit !== null ? 'required' : 'optional' })

function wrongForm(input: string, value: string, form: NumericForm, diagnosis: Diagnosis, unit: string | null = null) {
  const v = check(input, value, form, unit)
  expect(v.status, input).toBe('wrongForm')
  expect(v.credit, input).toBe(0.5)
  expect(v.diagnosis.includes('sameAsExpected'), input).toBe(true)
  expect(v.diagnosis.includes(diagnosis), input).toBe(true)
  expect(v.normalizedInput, input).toBeDefined()
  expect(v.latexInput, input).toBeDefined()
  return v
}

describe('MixedFractionFormTests', () => {
  it('unreduced positive mixed fraction is wrongForm', () => {
    for (const [input, value] of [['1 2/4', '3/2'], ['1 0/2', '1'], [`0 ${INT_MAX}/${INT_MAX}`, '1']]) wrongForm(input, value, 'reducedFraction', 'notReduced')
  })

  it('unreduced negative mixed fraction is wrongForm', () => {
    const v = wrongForm('-1 6/8', '-7/4', 'reducedFraction', 'notReduced')
    expect(v.normalizedInput).toBe('-1 6/8')
    expect(v.latexInput).toBe('-1\\frac{6}{8}')
  })

  it('unreduced mixed fraction with unit is wrongForm', () => {
    const v = wrongForm('x = 1 2/4 m', '3/2', 'reducedFraction', 'notReduced', 'm')
    expect(v.normalizedInput).toBe('1 2/4 m')
    expect(v.latexInput).toContain('\\frac{2}{4}')
    expect(v.diagnosis.includes('unitMissing')).toBe(false)
    expect(v.diagnosis.includes('unitWrong')).toBe(false)
  })

  it('improper mixed numbers are wrongForm', () => {
    wrongForm('1 5/4', '9/4', 'mixedNumber', 'notSimplified')
    wrongForm('-1 5/4', '-9/4', 'mixedNumber', 'notSimplified')
    wrongForm('1 4/4', '2', 'mixedNumber', 'notSimplified')
    wrongForm('0 5/4', '5/4', 'mixedNumber', 'notSimplified')
  })

  it('proper part comparison uses exact integers near Int.max', () => {
    const max = INT_MAX
    const below = INT_MAX - 1n
    wrongForm(`0 ${max}/${below}`, `${max}/${below}`, 'mixedNumber', 'notSimplified')
    const proper = check(`0 ${below}/${max}`, `${below}/${max}`, 'mixedNumber')
    expect(proper.status).toBe('correct')
    expect(proper.credit).toBe(1)
  })

  it('canonical mixed representations keep full credit', () => {
    const rows = [['1 1/2', '3/2'], ['-1 3/4', '-7/4'], ['+2 2/3', '8/3'], ['0 1/2', '1/2'], ['-0 1/2', '-1/2'], ['1 0/1', '1']]
    for (const form of ['reducedFraction', 'mixedNumber'] as NumericForm[]) {
      for (const [input, value] of rows) {
        const v = check(input, value, form)
        expect(v.status, `${input}, ${form}`).toBe('correct')
        expect(v.credit, input).toBe(1)
      }
      for (const input of ['0', '1', '-2', '+3']) expect(check(input, input, form).status, input).toBe('correct')
    }
  })

  it('each form keeps its existing distinct requirement', () => {
    const unreducedProper = check('1 2/4', '3/2', 'mixedNumber')
    expect(unreducedProper.status).toBe('correct')
    expect(unreducedProper.credit).toBe(1)
    const reducedImproperPart = check('1 5/4', '9/4', 'reducedFraction')
    expect(reducedImproperPart.status).toBe('correct')
    expect(reducedImproperPart.credit).toBe(1)
  })

  it('general parsing and unconstrained forms keep rational values', () => {
    for (const [input, value] of [['1 2/4', '3/2'], ['1 5/4', '9/4'], ['-1 5/4', '-9/4'], ['1 4/4', '2']]) {
      expectFrac(Fraction.parse(input), Fraction.parse(value), input)
      for (const form of ['any', 'fraction'] as NumericForm[]) {
        const v = check(input, value, form)
        expect(v.status, `${input}, ${form}`).toBe('correct')
        expect(v.credit, input).toBe(1)
      }
    }
  })

  it('wrong values and zero denominators keep their existing status', () => {
    for (const form of ['reducedFraction', 'mixedNumber'] as NumericForm[]) {
      for (const input of ['1 2/4', '1 5/4']) {
        const wrong = check(input, '7/4', form)
        expect(wrong.status, input).toBe('incorrect')
        expect(wrong.credit, input).toBe(0)
      }
      const malformed = check('1 1/0', '3/2', form)
      expect(malformed.status).toBe('formatProblem')
      expect(malformed.credit).toBe(0)
    }
  })

  it('written mixed metadata does not convert or negate extreme whole part', () => {
    for (const whole of [String(INT_MIN), String(INT_MAX)]) expect(new WrittenForm(`${whole} 1/2`).isMixed).toBe(true)
    expect(new WrittenForm(`1 ${INT_MIN}/2`).isMixed).toBe(false)
    expect(new WrittenForm(`1 1/${INT_MIN}`).isMixed).toBe(false)
  })
})
