import { describe, expect, it } from 'vitest'
import { MV } from '@engine/math/core/types'
import { Fraction } from '@engine/math/numbers/fraction'
import { setMathLanguage } from '@engine/math/core/i18n'
import { closedForm, displayValue, engineInput, exactForm, expansion, loadValue, missingClosers, nearFraction, previewCalc, replacingAns, runCalc, splitAssignment, squareFree, storeValue, type CalcContext } from './engine'

const ctx = (over: Partial<CalcContext> = {}): CalcContext => ({ vars: {}, ans: null, degrees: false, ...over })
const value = (text: string, c = ctx()) => {
  const r = runCalc(text, c)
  if (!r.ok) throw new Error(JSON.stringify(r.issue))
  return r
}

describe('runCalc', () => {
  it('calcula exacto con fracciones', () => {
    const r = value('1/3 + 1/4')
    expect(r.value.kind).toBe('rational')
    expect(displayValue(r.value, false).tex).toBe('\\frac{7}{12}')
  })
  it('cierra los paréntesis que faltan', () => {
    const r = value('sqrt(9/4')
    expect(displayValue(r.value, false).tex).toBe('\\frac{3}{2}')
    expect(r.input).toBe('sqrt(9/4)')
  })
  it('respeta grados y radianes', () => {
    expect(displayValue(value('sin(30)', ctx({ degrees: true })).value, false).tex).toBe('\\frac{1}{2}')
    const rad = value('sin(30)')
    expect(rad.looksLikeDegrees).toBe(true)
    expect(rad.usesTrig).toBe(true)
  })
  it('guarda variables y usa ans', () => {
    const a = value('a = 5')
    expect(a.assigned).toBe('a')
    expect(a.tex).toBe('a = 5')
    const r = value('2a + ans', ctx({ vars: { a: a.value }, ans: MV.int(1) }))
    expect(displayValue(r.value, false).tex).toBe('11')
  })
  it('explica los errores habituales', () => {
    expect(runCalc('', ctx())).toEqual({ ok: false, issue: { code: 'empty' } })
    expect(runCalc('ans + 1', ctx())).toEqual({ ok: false, issue: { code: 'noAns' } })
    expect(runCalc('x + 1', ctx())).toEqual({ ok: false, issue: { code: 'unknown', names: ['x'] } })
    expect(runCalc('ans = 3', ctx())).toEqual({ ok: false, issue: { code: 'ansName' } })
    expect(runCalc('pi = 3', ctx())).toMatchObject({ ok: false, issue: { code: 'constantName' } })
    expect(runCalc('2x = 4', ctx())).toMatchObject({ ok: false, issue: { code: 'equation' } })
    expect(runCalc('a =', ctx())).toMatchObject({ ok: false, issue: { code: 'missingValue' } })
    expect(runCalc('1/0', ctx())).toMatchObject({ ok: false, issue: { code: 'engine', kind: 'domain' } })
  })
  it('entiende la coma decimal y los símbolos del teclado', () => {
    expect(displayValue(value('3,5×2').value, false).tex).toBe('7')
    expect(displayValue(value('√(8)').value, false).tex).toBe('2\\sqrt{2}')
    expect(displayValue(value('2π').value, false).tex).toBe('2\\pi')
    expect(displayValue(value('5!').value, false).tex).toBe('120')
    expect(displayValue(value('nCr(5,2)').value, false).tex).toBe('10')
    expect(displayValue(value('2e3').value, false).tex).toBe('2000')
  })
})

describe('con la calculadora del motor (LiveCalculator)', () => {
  it('resuelve comparaciones y listas', () => {
    const c = value('sin(pi/6) == 1/2')
    expect(c.kind).toBe('bool')
    expect(MV.double(c.value)).toBe(1)
    expect(value('1/2 = 0,5').kind).toBe('bool')
    expect(MV.double(value('2 > 3').value)).toBe(0)
    const l = value('1/2; 1/3')
    expect(l.kind).toBe('list')
    expect(l.text?.split('\n')).toHaveLength(2)
  })
  it('no confunde la coma decimal con una lista (el motor separaría «3,5×2» en dos cuentas)', () => {
    expect(engineInput('3,5×2 + max(1,5)')).toBe('3.5×2 + max(1,5)')
    expect(value('3,5×2').kind).toBe('value')
  })
  it('aprovecha la forma cerrada del motor cuando no hay otra', () => {
    const r = value('|−3| + √(2)')
    expect(r.closedTex).toBe('3+\\sqrt{2}')
    expect(displayValue(r.value, false, r.closedTex).tex).toBe('3+\\sqrt{2}')
    expect(closedForm('2^{\\frac{1}{2}}e')).toBeNull()
  })
  it('mejora lo que el motor da en bruto', () => {
    // el motor escribe 30.000000000000 (ruido de coma flotante) y \arcsin(1/2) o \sin(π/4) como LaTeX
    expect(displayValue(value('asin(0.5)', ctx({ degrees: true })).value, false).tex).toBe('30')
    expect(displayValue(value('sin(pi/4)').value, false).tex).toBe('\\frac{\\sqrt{2}}{2}')
  })
  it('los mensajes salen en el idioma elegido', () => {
    setMathLanguage('en')
    const r = runCalc('1/0', ctx())
    setMathLanguage('es')
    expect(r.ok === false && r.issue.code === 'engine' && r.issue.message).toMatch(/zero/i)
  })
})

describe('previewCalc', () => {
  it('marca el hueco que falta', () => {
    expect(previewCalc('3+', ctx())?.tex).toBe('3+\\square')
    expect(previewCalc('sin(', ctx())?.tex).toContain('\\square')
  })
  it('da el valor cuando ya se puede', () => {
    const p = previewCalc('2^10', ctx())
    expect(p?.partial).toBe(false)
    expect(p?.result && MV.double(p.result.value)).toBe(1024)
  })
})

describe('formato', () => {
  it('desarrolla fracciones periódicas', () => {
    expect(expansion(Fraction.of(5, 6)!, true).tex).toBe('0{,}8\\overline{3}')
    expect(expansion(Fraction.of(1, 4)!, false)).toEqual({ tex: '0.25', exact: true })
  })
  it('reconoce π y raíces', () => {
    expect(exactForm((3 * Math.PI) / 4)?.tex).toBe('\\frac{3\\pi}{4}')
    expect(exactForm(Math.SQRT1_2)?.tex).toBe('\\frac{\\sqrt{2}}{2}')
    expect(exactForm(Math.sqrt(12))?.tex).toBe('2\\sqrt{3}')
    expect(exactForm(1.234567)).toBeNull()
    expect(squareFree(72)).toEqual({ a: 6, m: 2 })
  })
  it('limpia el ruido de coma flotante', () => {
    expect(displayValue(MV.real(30.000000000000004), false).tex).toBe('30')
    expect(nearFraction(0.5000000000000001)?.plain).toBe('1/2')
    expect(displayValue(MV.real(Math.E), false).approx).toBe(true)
  })
  it('da el número mixto', () => {
    expect(displayValue(MV.rational(Fraction.of(7, 4)!), false).mixedTex).toBe('1\\tfrac{3}{4}')
  })
  it('agrupa miles', () => {
    expect(displayValue(MV.int(1234567), false).tex).toBe('1\\,234\\,567')
  })
})

describe('utilidades', () => {
  it('divide asignaciones', () => {
    expect(splitAssignment('a = 5')).toEqual({ name: 'a ', expr: ' 5' })
    expect(splitAssignment('a <= 5')).toBeNull()
  })
  it('cambia ans y cuenta paréntesis', () => {
    expect(replacingAns('2ans+answer')).toBe('2ϙ+answer')
    expect(missingClosers('sin(cos(1')).toBe('))')
  })
  it('guarda y recupera valores', () => {
    const v = MV.rational(Fraction.of(-7, 3)!)
    expect(MV.equals(loadValue(storeValue(v)), v)).toBe(true)
    expect(loadValue({ k: 'r', v: 'x' })).toBeNull()
  })
})
