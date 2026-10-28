import { describe, expect, it } from 'vitest'
import type { AngleMode } from '../core/types'
import { NumberInput } from '../parse/number-input'
import { has } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import type { NumericForm, UnitMode } from './specs'
import type { Diagnosis, VerdictStatus } from './verdict'

interface ChkOptions {
  form?: NumericForm
  decimals?: number | null
  unit?: string | null
  mode?: UnitMode
  abs?: number
  rel?: number
  alt?: string[]
  angle?: AngleMode
}

function chk(input: string, value: string, o: ChkOptions = {}) {
  return AnswerChecker.checkNumeric(input, {
    value, form: o.form ?? 'any', decimals: o.decimals ?? null, unit: o.unit ?? null, unitMode: o.mode ?? 'optional',
    absTol: o.abs ?? 0, relTol: o.rel ?? 0, alternatives: o.alt ?? [], angle: o.angle ?? 'radians',
  })
}

describe('NumericCheckerTests', () => {
  // MARK: Entradas correctas

  it('accepted ways of writing the same number', () => {
    const rows: Array<[string, string]> = [
      ['3/4', '0.75'],
      ['0.75', '3/4'],
      ['75/100', '3/4'],
      ['  3/4  ', '0.75'],
      ['x = 3/4', '0.75'],
      ['f(x) = 3/4', '0.75'],
      ['y=0.75', '3/4'],
      ['0,75', '3/4'],
      ['.75', '3/4'],
      ['-0.5', '-1/2'],
      ['−1/2', '-0.5'],
      ['- 1/2', '-0.5'],
      ['-(1/2)', '-0.5'],
      ['0.50', '1/2'],
      ['1/2', '2/4'],
      ['6/8', '3/4'],
      ['1.5', '3/2'],
      ['3/2', '1.5'],
      ['1 1/2', '3/2'],
      ['2', '2'],
      ['+2', '2'],
      ['2.0', '2'],
      ['4/2', '2'],
      ['1000', '1e3'],
      ['1e3', '1000'],
      ['3.2e3', '3200'],
      ['3.2E3', '3200'],
      ['3.2*10^3', '3200'],
      ['3.2×10^3', '3200'],
      ['3.2 x 10^3', '3200'],
      ['3.2·10³', '3200'],
      ['3.2 X 10^3', '3200'],
      ['32/10*10^3', '3200'],
      ['$50', '50'],
      ['50 $', '50'],
      ['€ 50', '50'],
      ['aprox. 50', '50'],
      ['≈ 0.75', '3/4'],
      ['x ≈ 0.75', '3/4'],
      ['la respuesta = 0.75', '3/4'],
      ['sqrt(2)/2', '1/sqrt(2)'],
      ['√2/2', 'sqrt(2)/2'],
      ['2^(1/2)', 'sqrt(2)'],
      ['\\frac{\\sqrt{3}}{2}', 'sqrt(3)/2'],
      ['1.4142135', 'sqrt(2)'],
      ['0.70710678', 'sqrt(2)/2'],
      ['pi/6', '0.5235987756'],
      ['π/6', 'pi/6'],
      ['5pi/6', '5*pi/6'],
      ['ln(2)', '0.693147'],
      ['e^2', '7.3890561'],
      ['sin(30°)', '1/2'],
      ['cos(60°)', '0.5'],
      ['30°', 'pi/6'],
      ['50%', '1/2'],
      ['50 %', '0.5'],
      ['12.5%', '1/8'],
      ['0', '0'],
      ['-0', '0'],
      ['0.0000001', '1e-7'],
      ['1/3', '0.3333333333333'],
      ['1/3', '1/3'],
      ['1000', '1000'],
    ]
    for (const [input, value] of rows) {
      const v = chk(input, value)
      expect(v.status, `«${input}» vs «${value}»: ${v.message ?? ''}`).toBe('correct')
      expect(v.credit).toBe(1)
      expect(v.normalizedInput, `«${input}»`).toBeDefined()
      expect(v.latexInput, `«${input}»`).toBeDefined()
    }
  })

  it('correct verdicts carry previews', () => {
    const v = chk('3/4', '0.75')
    expect(v.normalizedInput).toBe('3/4')
    expect(v.latexInput).toBe('\\frac{3}{4}')
    expect(v.message).toBeUndefined()
    expect(chk('sqrt(2)/2', '0.7071067811865476').latexInput).toBe('\\frac{\\sqrt{2}}{2}')
    expect(chk('37.5%', '3/8').latexInput).toBe('37.5\\%')
  })

  it('alternatives', () => {
    expect(chk('-pi', 'pi', { alt: ['-pi'] }).status).toBe('correct')
    expect(chk('pi', 'pi', { alt: ['-pi'] }).status).toBe('correct')
    expect(chk('3.14159', 'pi', { alt: ['-pi'] }).status).toBe('correct')
    expect(chk('2', 'pi', { alt: ['-pi'] }).status).toBe('incorrect')
    expect(chk('-3', '3', { alt: ['-3', '0'] }).status).toBe('correct')
    expect(chk('0', '3', { alt: ['-3', '0'] }).status).toBe('correct')
    expect(chk('1/2', '0.5', { alt: ['bad(', '1/2'] }).status, 'una alternativa mal escrita se ignora').toBe('correct')
  })

  // MARK: Tolerancias

  it('explicit tolerances', () => {
    expect(chk('3.14', '3.14159', { abs: 0.01 }).status).toBe('correct')
    expect(chk('3.2', '3.14159', { abs: 0.01 }).status).toBe('incorrect')
    expect(chk('3.15', '3.14159', { abs: 0.01 }).status).toBe('correct')
    expect(chk('101', '100', { rel: 0.02 }).status).toBe('correct')
    expect(chk('103', '100', { rel: 0.02 }).status).toBe('incorrect')
    expect(chk('0.0001', '0', { abs: 0.001 }).status).toBe('correct')
    expect(chk('1/3', '0.33', { abs: 0.005 }).status).toBe('correct')
  })

  it('default tolerance: exact for rationals, relative for reals', () => {
    expect(chk('0.5', '1/2').status).toBe('correct')
    expect(chk('0.500001', '1/2').status, 'racional frente a racional: exacto').toBe('incorrect')
    expect(chk('0.3333333333', '1/3').status, '10 cifras: una aproximación, no el valor exacto').toBe('partial')
    expect(chk('0.7071068', 'sqrt(2)/2').status, 'con irracionales, tolerancia relativa 1e-6').toBe('correct')
    expect(chk('0.7071', 'sqrt(2)/2').status).toBe('partial')
    expect(chk('0.70', 'sqrt(2)/2').status, '0.70 es 0.7071 cortado a 2 decimales').toBe('partial')
    expect(has(chk('0.70', 'sqrt(2)/2'), 'truncation')).toBe(true)
    expect(chk('0.69', 'sqrt(2)/2').status).toBe('incorrect')
    expect(chk('1.4142', 'sqrt(2)').status).toBe('partial')
    expect(chk('1.41421', 'sqrt(2)').status).toBe('partial')
    expect(chk('1.414214', 'sqrt(2)').status).toBe('correct')
    expect(chk('0', '0').status).toBe('correct')
    expect(chk('0.0000000001', '0').status, 'racional frente a racional: 1e-10 no es 0').toBe('incorrect')
    expect(chk('sin(pi)', '0').status, 'sin(π) es exactamente 0').toBe('correct')
    expect(chk('1e-12', 'sin(pi)*1').status, 'ruido de coma flotante frente a 0').toBe('correct')
  })

  it('approximations get partial credit', () => {
    const rows: Array<[string, string, Diagnosis]> = [['0.333', '1/3', 'rounding'], ['0.33', '1/3', 'rounding'], ['0.3333333', '1/3', 'rounding'], ['0.67', '2/3', 'rounding'], ['0.6667', '2/3', 'rounding'],
      ['0.66', '2/3', 'truncation'], ['0.71', 'sqrt(2)/2', 'rounding'], ['0.7071', 'sqrt(2)/2', 'rounding'], ['3.14', 'pi', 'rounding'],
      ['3.1416', 'pi', 'rounding'], ['2.718', 'e', 'rounding'], ['0.693', 'ln(2)', 'rounding'], ['0.14', '1/7', 'rounding'], ['1.73', 'sqrt(3)', 'rounding']]
    for (const [input, value, diag] of rows) {
      const v = chk(input, value)
      expect(v.status, `«${input}» vs «${value}»: ${v.message ?? ''}`).toBe('partial')
      expect(v.credit).toBe(0.5)
      expect(has(v, diag), `«${input}» vs «${value}» etiquetas ${v.diagnosis.join(',')}`).toBe(true)
    }
    for (const [input, value] of [['0.3', '1/3'], ['0.34', '1/3'], ['0.72', 'sqrt(2)/2'], ['3.1', 'pi'], ['3.15', 'pi'], ['0.7', 'sqrt(2)/2']]) {
      expect(chk(input, value).status, `«${input}» vs «${value}»`).toBe('incorrect')
    }
  })

  // MARK: Decimales exigidos

  it('required decimals', () => {
    const rows: Array<[string, string, number, VerdictStatus]> = [
      ['3.14', 'pi', 2, 'correct'], ['3.140', 'pi', 2, 'correct'], ['3.15', 'pi', 2, 'partial'], ['3.13', 'pi', 2, 'partial'], ['3.141', 'pi', 2, 'wrongForm'], ['3.2', 'pi', 2, 'incorrect'],
      ['3.12', 'pi', 2, 'incorrect'], ['3', 'pi', 0, 'correct'], ['4', 'pi', 0, 'partial'], ['5', 'pi', 0, 'incorrect'], ['3.1416', 'pi', 4, 'correct'], ['3.1415', 'pi', 4, 'partial'],
      ['2.68', '2.675', 2, 'correct'], ['2.67', '2.675', 2, 'partial'], ['-1.01', '-1.005', 2, 'correct'], ['-1.00', '-1.005', 2, 'partial'], ['0.333', '1/3', 3, 'correct'],
      ['0.334', '1/3', 3, 'partial'], ['0.33', '1/3', 3, 'incorrect'], ['1.41', 'sqrt(2)', 2, 'correct'], ['1.42', 'sqrt(2)', 2, 'partial'], ['1.4', 'sqrt(2)', 2, 'partial'],
      ['1.3', 'sqrt(2)', 2, 'incorrect'], ['0.00', '0.001', 2, 'correct'], ['100', '99.999', 2, 'correct'], ['12', '12', 2, 'correct'], ['12.00', '12', 2, 'correct'],
    ]
    for (const [input, value, k, status] of rows) {
      const v = chk(input, value, { decimals: k })
      expect(v.status, `«${input}» vs «${value}» con ${k} decimales: ${v.message ?? ''}`).toBe(status)
      if (status === 'partial' || status === 'wrongForm') {
        expect(v.credit).toBe(0.5)
        expect(has(v, 'rounding')).toBe(true)
      }
    }
  })

  it('exact value when decimals are required is wrongForm', () => {
    for (const [input, value, k] of [['1/3', '1/3', 3], ['3.14159265', 'pi', 2], ['pi', 'pi', 2], ['0.33333333', '1/3', 3], ['sqrt(2)', 'sqrt(2)', 2]] as Array<[string, string, number]>) {
      const v = chk(input, value, { decimals: k })
      expect(v.status, `«${input}» vs «${value}»: ${v.message ?? ''}`).toBe('wrongForm')
      expect(v.credit).toBe(0.5)
      expect(has(v, 'rounding')).toBe(true)
      expect(has(v, 'sameAsExpected')).toBe(true)
      expect(v.message).toContain(`${k} decimal`)
    }
  })

  // MARK: Formas

  it('forms', () => {
    const rows: Array<[string, string, NumericForm, VerdictStatus, Diagnosis | null]> = [
      ['5', '5', 'integer', 'correct', null], ['5.0', '5', 'integer', 'correct', null],
      ['10/2', '5', 'integer', 'wrongForm', 'notSimplified'], ['5.5', '5.5', 'integer', 'correct', null],
      ['3/4', '0.75', 'fraction', 'correct', null], ['6/8', '0.75', 'fraction', 'correct', null],
      ['0.75', '3/4', 'fraction', 'wrongForm', 'decimalInsteadOfFraction'], ['7/4', '1.75', 'fraction', 'correct', null],
      ['1 3/4', '7/4', 'fraction', 'correct', null], ['2', '2', 'fraction', 'correct', null],
      ['3/4', '3/4', 'reducedFraction', 'correct', null], ['6/8', '3/4', 'reducedFraction', 'wrongForm', 'notReduced'],
      ['0.75', '3/4', 'reducedFraction', 'wrongForm', 'decimalInsteadOfFraction'], ['-3/4', '-0.75', 'reducedFraction', 'correct', null],
      ['(-3)/4', '-0.75', 'reducedFraction', 'correct', null], ['-6/8', '-3/4', 'reducedFraction', 'wrongForm', 'notReduced'],
      ['9/12', '3/4', 'reducedFraction', 'wrongForm', 'notReduced'], ['5', '5', 'reducedFraction', 'correct', null],
      ['0.75', '3/4', 'decimal', 'correct', null], ['3/4', '0.75', 'decimal', 'wrongForm', 'fractionInsteadOfDecimal'],
      ['.75', '3/4', 'decimal', 'correct', null], ['0,75', '3/4', 'decimal', 'correct', null],
      ['sqrt(2)/2', '0.7071067811865476', 'decimal', 'wrongForm', 'fractionInsteadOfDecimal'], ['2', '2', 'decimal', 'correct', null],
      ['3.2e4', '32000', 'scientific', 'correct', null], ['3.2×10^4', '32000', 'scientific', 'correct', null],
      ['3.2*10^4', '32000', 'scientific', 'correct', null], ['3.2 x 10^4', '32000', 'scientific', 'correct', null],
      ['32000', '32000', 'scientific', 'wrongForm', 'other'], ['32e3', '32000', 'scientific', 'wrongForm', 'notSimplified'],
      ['0.32e5', '32000', 'scientific', 'wrongForm', 'notSimplified'], ['-6.02e-3', '-0.00602', 'scientific', 'correct', null],
      ['37.5%', '3/8', 'percent', 'correct', null], ['37.5', '3/8', 'percent', 'wrongForm', 'percentVsFraction'],
      ['0.375', '3/8', 'percent', 'wrongForm', 'percentVsFraction'], ['37,5 %', '0.375', 'percent', 'correct', null],
      ['1 3/4', '7/4', 'mixedNumber', 'correct', null], ['7/4', '7/4', 'mixedNumber', 'wrongForm', 'notSimplified'],
      ['1.75', '7/4', 'mixedNumber', 'wrongForm', 'notSimplified'], ['3/4', '3/4', 'mixedNumber', 'correct', null],
      ['-2 1/3', '-7/3', 'mixedNumber', 'correct', null], ['3', '3', 'mixedNumber', 'correct', null],
    ]
    for (const [input, value, form, status, diag] of rows) {
      const v = chk(input, value, { form })
      expect(v.status, `«${input}» vs «${value}» forma ${form}: ${v.message ?? ''}`).toBe(status)
      if (diag) expect(has(v, diag), `«${input}» etiquetas ${v.diagnosis.join(',')}`).toBe(true)
      if (status === 'wrongForm') {
        expect(v.credit).toBe(0.5)
        expect(has(v, 'sameAsExpected')).toBe(true)
      }
    }
  })

  it('wrong value is not rescued by form', () => {
    expect(chk('5/8', '3/4', { form: 'reducedFraction' }).status).toBe('incorrect')
    expect(chk('0.7', '3/4', { form: 'decimal' }).status).toBe('incorrect')
    expect(chk('33000', '32000', { form: 'scientific' }).status).toBe('incorrect')
  })

  // MARK: Separadores de miles y coma decimal

  it('thousands and decimal separators', () => {
    const rows: Array<[string, string]> = [
      ['1,234.56', '1234.56'], ['1.234,56', '1234.56'], ['1,234,567', '1234567'], ['1.234.567', '1234567'],
      ['12,5', '12.5'], ['0,866', '0.866'], ['1234', '1234'], ['$9,096.98', '9096.98'], ['9,096.98', '9096.98'],
      ['2,5e3', '2500'], ['1,5', '3/2'], ['1,234', '1.234'], ['1.234', '1.234'],
    ]
    for (const [input, value] of rows) {
      const v = chk(input, value)
      expect(v.status, `«${input}» vs «${value}»: ${v.message ?? ''}`).toBe('correct')
    }
    const thousands = NumberInput.decimalComma ? '1.234' : '1,234'
    expect(chk(thousands, '1234').status).toBe('correct')
    expect(chk(NumberInput.decimalComma ? '10.000' : '10,000', '10000').status).toBe('correct')
    expect(chk('1,234', '5').status).not.toBe('correct')
    expect(chk('1,23,4', '1234').status).not.toBe('correct')
  })

  // MARK: "No definido"

  it('undefined answers', () => {
    for (const input of ['DNE', 'dne', 'undefined', 'Undefined', 'indefinido', 'indefinida', 'no existe', 'No existe.', 'does not exist', '∄', 'no definido', 'D.N.E.']) {
      expect(chk(input, 'DNE').status, `«${input}»`).toBe('correct')
      expect(chk(input, 'undefined').status, `«${input}»`).toBe('correct')
      expect(chk(input, 'indefinido').status, `«${input}»`).toBe('correct')
    }
    expect(chk('5', 'DNE').status).toBe('incorrect')
    expect(chk('0', 'undefined').status).toBe('incorrect')
    expect(chk('DNE', '5').status).toBe('incorrect')
    expect(chk('undefined', '0').status).toBe('incorrect')
    expect(chk('5', 'DNE').message).toContain('indefinido')
    expect(chk('1/0', 'DNE').status, '1/0 no es una respuesta legible').toBe('formatProblem')
    expect(chk('abc', 'DNE').status).toBe('formatProblem')
  })

  // MARK: Ángulos

  it('angle modes in answers', () => {
    expect(chk('sin(30)', '0.5', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('sin(30)', '0.5', { angle: 'radians' }).status).toBe('incorrect')
    expect(chk('sin(30°)', '0.5', { angle: 'radians' }).status).toBe('correct')
    expect(chk('sin(30°)', '0.5', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('30°', '30', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('30°', 'pi/6', { angle: 'radians' }).status).toBe('correct')
    expect(chk('tan(pi/4)', '1').status).toBe('correct')
    expect(chk('tan(45)', '1', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('atan(1)', '45', { angle: 'degrees' }).status).toBe('correct')
    expect(chk('atan(1)', 'pi/4').status).toBe('correct')
    expect(chk('tan(90)', 'DNE', { angle: 'degrees' }).status, 'tan(90°) no se puede evaluar').toBe('formatProblem')
  })

  // MARK: Problemas de formato (nunca penalizan)

  it('format problems', () => {
    const rows: Array<[string, string]> = [
      ['', '5'], ['   ', '5'], ['abc', '5'], ['hola mundo', '5'], ['x+1', '5'], ['2x', '5'], ['1/0', '5'], ['sqrt(-4)', '5'], ['ln(0)', '5'], ['5 +', '5'], ['((5)', '5'], ['5 5', '5'], ['1.2.3', '5'],
      ['@', '5'], ['%', '5'], ['tan(pi/2)', '5'], ['10^10^10', '5'], ['--', '5'],
    ]
    for (const [input, value] of rows) {
      const v = chk(input, value)
      expect(v.status, `«${input}»: ${v.message ?? ''}`).toBe('formatProblem')
      expect(v.credit).toBe(0)
      expect(v.message).toBeDefined()
    }
    expect(chk('x+1', '5').message).toContain('«x»')
    expect(chk('1/0', '5').message?.toLowerCase()).toContain('cero')
    expect(chk('1'.repeat(400), '5').status).toBe('formatProblem')
  })

  it('broken spec is reported, not thrown', () => {
    for (const value of ['', 'abc', 'x+1', '1/0', '((']) {
      const v = chk('5', value)
      expect(v.status, `valor del ejercicio «${value}»`).toBe('formatProblem')
      expect(v.message).toContain('esperada')
    }
  })

  // MARK: Diagnóstico de errores típicos

  it('diagnosis of typical errors', () => {
    const rows: Array<[string, string, Diagnosis]> = [
      ['-4.5', '4.5', 'signError'], ['3', '-3', 'signError'], ['-3/4', '3/4', 'signError'], ['0.5', '-0.5', 'signError'], ['-sqrt(2)', 'sqrt(2)', 'signError'],
      ['0.25', '4', 'reciprocal'], ['2/3', '3/2', 'reciprocal'], ['1/5', '5', 'reciprocal'], ['1.5', '2/3', 'reciprocal'],
      ['37.5', '0.375', 'percentVsFraction'], ['0.375', '37.5', 'percentVsFraction'], ['20', '0.2', 'percentVsFraction'], ['0.05', '5', 'percentVsFraction'],
      ['52', '5.2', 'factorOfTen'], ['0.52', '5.2', 'factorOfTen'], ['5200', '5.2', 'factorOfTen'], ['0.0052', '5.2', 'factorOfTen'],
      ['10.4', '5.2', 'factorOfTwo'], ['3.5', '7', 'factorOfTwo'], ['14', '7', 'factorOfTwo'], ['2.6', '5.2', 'factorOfTwo'],
      ['60', 'pi/3', 'degreesVsRadians'], ['30', 'pi/6', 'degreesVsRadians'], ['180', 'pi', 'degreesVsRadians'], ['1.0472', '60', 'radiansVsDegrees'], ['pi/6', '30', 'radiansVsDegrees'],
      ['9', '3', 'forgotSquareRoot'], ['25', '5', 'forgotSquareRoot'], ['3', '9', 'forgotSquare'], ['1.5', '2.25', 'forgotSquare'],
      ['8.3', '7.3', 'offByOne'], ['11', '12', 'offByOne'], ['-1', '0', 'offByOne'], ['6.5', '5.5', 'offByOne'],
      ['0.66', '2/3', 'truncation'], ['0.3', '1/3', 'rounding'], ['3.1', 'pi', 'rounding'],
    ]
    expect(rows.length).toBeGreaterThanOrEqual(25)
    for (const [input, value, diag] of rows) {
      const v = chk(input, value)
      expect(v.status, `«${input}» vs «${value}»`).not.toBe('correct')
      expect(has(v, diag), `«${input}» vs «${value}»: se esperaba ${diag}, salió ${v.diagnosis.join(',')}`).toBe(true)
      expect(v.message).toBeDefined()
    }
  })

  it('messages for the most likely cause', () => {
    expect(chk('-4.5', '4.5').message).toContain('signo')
    expect(chk('3', '-3').message).toContain('faltó el signo menos')
    expect(chk('30', 'pi/6').message).toBe('Parece que usaste grados donde la respuesta está en radianes.')
    expect(chk('pi/6', '30').message).toBe('Parece que usaste radianes donde la respuesta está en grados.')
    expect(chk('0.25', '4').message).toContain('recíproco')
    expect(chk('9', '3').message).toContain('raíz cuadrada')
    expect(chk('8.3', '7.3').message).toContain('1 de distancia')
    expect(chk('52', '5.2').message).toContain('10^')
  })

  it('several causes return all labels', () => {
    const v = chk('4', '2')
    expect(has(v, 'factorOfTwo')).toBe(true)
    expect(has(v, 'forgotSquareRoot')).toBe(true)
    expect(v.diagnosis[0], 'la causa más probable va primero').toBe('factorOfTwo')
    const w = chk('1', '-1')
    expect(has(w, 'signError')).toBe(true)
    expect(has(w, 'reciprocal')).toBe(false)
    const x = chk('100', '1')
    expect(has(x, 'percentVsFraction')).toBe(true)
    expect(has(x, 'factorOfTen')).toBe(true)
  })

  it('unrelated wrong answers get other', () => {
    for (const [input, value] of [['123', '7'], ['17', '4'], ['0.123', '5'], ['-88', '3.1']]) {
      const v = chk(input, value)
      expect(v.status).toBe('incorrect')
      expect(v.diagnosis, `«${input}» vs «${value}»`).toEqual(['other'])
    }
  })

  // MARK: Unidades

  it('units basics', () => {
    const rows: Array<[string, string, string, UnitMode, VerdictStatus, Diagnosis | null]> = [
      ['5 m/s', '5', 'm/s', 'optional', 'correct', null], ['5', '5', 'm/s', 'optional', 'correct', null], ['5', '5', 'm/s', 'required', 'partial', 'unitMissing'],
      ['5 m/s', '5', 'm/s', 'required', 'correct', null], ['5 kg', '5', 'm/s', 'optional', 'partial', 'unitWrong'], ['5 m', '5', 'm/s', 'optional', 'partial', 'unitWrong'],
      ['5 m/s^2', '5', 'm/s', 'optional', 'partial', 'unitWrong'], ['500 cm/s', '5', 'm/s', 'optional', 'correct', null], ['18 km/h', '5', 'm/s', 'optional', 'correct', null],
      ['5 km/h', '5', 'm/s', 'optional', 'incorrect', 'unitConversion'], ['7 m/s', '5', 'm/s', 'optional', 'incorrect', null], ['7 kg', '5', 'm/s', 'optional', 'incorrect', 'unitWrong'],
      ['1000 g', '1', 'kg', 'optional', 'correct', null], ['1 kg', '1000', 'g', 'optional', 'correct', null], ['500 mL', '0.5', 'L', 'optional', 'correct', null], ['0.5 L', '500', 'mL', 'optional', 'correct', null],
      ['1 h', '3600', 's', 'optional', 'correct', null], ['90 min', '1.5', 'h', 'optional', 'correct', null], ['2 días', '48', 'h', 'optional', 'correct', null], ['1 atm', '101325', 'Pa', 'optional', 'correct', null],
      ['760 mmHg', '1', 'atm', 'optional', 'correct', null], ['1 cal', '4.184', 'J', 'optional', 'correct', null], ['1 kWh', '3600', 'kJ', 'optional', 'correct', null], ['9.8 m/s^2', '9.8', 'm/s^2', 'optional', 'correct', null],
      ['9,8 m/s²', '9.8', 'm/s^2', 'optional', 'correct', null], ['9.8 m s^-2', '9.8', 'm/s^2', 'optional', 'correct', null], ['9.8 m/s/s', '9.8', 'm/s^2', 'optional', 'correct', null],
      ['12 kg·m/s²', '12', 'N', 'optional', 'correct', null], ['3 N·m', '3', 'J', 'optional', 'correct', null], ['100 W·s', '100', 'J', 'optional', 'correct', null],
      ['20 °C', '20', '°C', 'optional', 'correct', null], ['293.15 K', '20', '°C', 'optional', 'correct', null], ['68 °F', '20', '°C', 'optional', 'correct', null], ['20 °C', '293.15', 'K', 'optional', 'correct', null],
      ['25 °C', '298.15', 'K', 'optional', 'correct', null], ['68 °F', '293.15', 'K', 'optional', 'correct', null], ['100 °C', '212', '°F', 'optional', 'correct', null], ['0 °C', '32', '°F', 'optional', 'correct', null],
      ['3.2e3 J', '3.2', 'kJ', 'optional', 'correct', null], ['1.5 mol', '1500', 'mmol', 'optional', 'correct', null], ['2 mol/L', '2', 'M', 'optional', 'correct', null], ['2 mM', '0.002', 'M', 'optional', 'correct', null],
      ['0.5 µm', '500', 'nm', 'optional', 'correct', null], ['0.5 μm', '500', 'nm', 'optional', 'correct', null], ['1 um', '1000', 'nm', 'optional', 'correct', null], ['5 meters', '5', 'm', 'optional', 'correct', null],
      ['5 metros', '500', 'cm', 'optional', 'correct', null], ['5 KG', '5000', 'g', 'optional', 'correct', null], ['5 Km', '5000', 'm', 'optional', 'correct', null], ['5 segundos', '5', 's', 'optional', 'correct', null],
      ['30 grados', 'pi/6', 'rad', 'optional', 'correct', null], ['pi/6 rad', '30', '°', 'optional', 'correct', null], ['0.5236 rad', '30', '°', 'optional', 'incorrect', null],
      ['37.5%', '37.5', '%', 'optional', 'correct', null], ['37.5', '37.5', '%', 'optional', 'correct', null], ['0.375', '37.5', '%', 'optional', 'incorrect', 'percentVsFraction'], ['2 %', '20', '‰', 'optional', 'correct', null],
      ['300 ppm', '0.03', '%', 'optional', 'correct', null], ['1 ft', '12', 'in', 'optional', 'correct', null], ['1 mi', '5280', 'ft', 'optional', 'correct', null], ['1 lb', '453.59237', 'g', 'optional', 'correct', null],
    ]
    for (const [input, value, unit, mode, status, diag] of rows) {
      const v = chk(input, value, { unit, mode })
      expect(v.status, `«${input}» vs «${value} ${unit}» (${mode}): ${v.message ?? ''}`).toBe(status)
      if (diag) expect(has(v, diag), `«${input}» vs «${value} ${unit}» etiquetas ${v.diagnosis.join(',')}`).toBe(true)
    }
  })

  it('unit ignore mode', () => {
    expect(chk('5 lo que sea', '5', { unit: 'm', mode: 'ignore' }).status).toBe('correct')
    expect(chk('5 kg', '5', { unit: 'm', mode: 'ignore' }).status).toBe('correct')
    expect(chk('5', '5', { unit: 'm', mode: 'ignore' }).status).toBe('correct')
    expect(chk('500 cm', '5', { unit: 'm', mode: 'ignore' }).status, 'en modo ignorar no se convierte').toBe('incorrect')
    expect(chk('6 kg', '5', { unit: 'm', mode: 'ignore' }).status).toBe('incorrect')
  })

  it('unit inside expected value and unitless spec', () => {
    expect(chk('500 cm', '5 m').status).toBe('correct')
    expect(chk('5 m', '5 m').status).toBe('correct')
    expect(chk('5 kg', '5 m').status).toBe('partial')
    expect(chk('5 m', '5').status, 'sin unidad esperada, la unidad escrita se ignora').toBe('correct')
    expect(chk('5 apples', '5').status).toBe('formatProblem')
  })

  it('unknown unit is a format problem', () => {
    expect(chk('5 zorgs', '5', { unit: 'm' }).status).toBe('formatProblem')
    expect(chk('5 xyzzy/s', '5', { unit: 'm/s' }).status).toBe('formatProblem')
  })

  it('unit previews in latex', () => {
    expect(chk('5 m/s', '5', { unit: 'm/s' }).latexInput).toBe('5\\,\\mathrm{m/s}')
    expect(chk('9.8 m/s^2', '9.8', { unit: 'm/s^2' }).latexInput).toBe('9.8\\,\\mathrm{m/s^{2}}')
    expect(chk('20 °C', '20', { unit: '°C' }).latexInput).toBe('20\\,^{\\circ}\\mathrm{C}')
    expect(chk('0.5 μm', '0.5', { unit: 'μm' }).latexInput).toBe('0.5\\,\\mu \\mathrm{m}')
    expect(chk('5 m/s', '5', { unit: 'm/s' }).normalizedInput).toBe('5 m/s')
  })

  // MARK: Ambigüedad avisada al estudiante

  it('ambiguity note is appended to wrong answers', () => {
    const v = chk('5/6pi', '5pi/6')
    expect(v.status).toBe('incorrect')
    expect(v.message).toContain('Entendí 5/6pi como 5/(6pi)')
    expect(v.normalizedInput).toBe('5/(6pi)')
    const ok = chk('5pi/6', '5pi/6')
    expect(ok.status).toBe('correct')
    expect(ok.message).toBeUndefined()
  })

  it('previews of wrong answers still present', () => {
    const v = chk('0.25', '4')
    expect(v.normalizedInput).toBe('0.25')
    expect(v.latexInput).toBe('0.25')
    expect(chk('sqrt(3)/3', '1').normalizedInput).toBe('sqrt(3)/3')
  })
})
