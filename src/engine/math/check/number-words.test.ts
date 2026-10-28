// Un número seguido de palabras (casos del juez en el curso de estequiometría): «3,01·10^23 moléculas» decía «Tu respuesta tiene
// la letra «a»» y «88 g de CO2», «para un subíndice escribe «O_2»». Ahora: con unidad en la clave vale la unidad del principio;
// si no, se pide solo el número (sin contar como intento fallido).
import { describe, expect, it } from 'vitest'
import { setMathLanguage } from '../core/i18n'
import { AnswerChecker } from './answer-checker'
import { NumericChecker } from './numeric-checker'
import type { UnitMode } from './specs'

const chk = (input: string, value: string, unit: string | null = null, unitMode: UnitMode = 'optional') =>
  AnswerChecker.checkNumeric(input, { value, unit, unitMode, form: 'any', decimals: null, absTol: 0, relTol: 0, alternatives: [], angle: 'radians' })

describe('número con palabras detrás', () => {
  it('con unidad en la clave, «88 g de CO2» es 88 g', () => {
    expect(chk('88 g de CO2', '88', 'g').status).toBe('correct')
    expect(chk('0,088 kg de CO2', '88', 'g').status).toBe('correct')
    expect(chk('90 g de CO2', '88', 'g').status).toBe('incorrect')
  })

  it('sin unidad en la clave, se pide solo el número (formato, no error)', () => {
    const v = chk('3,01·10^23 moléculas', '3.011e23')
    expect(v.status).toBe('formatProblem')
    expect(v.message).toBe('Escribe solo el número, sin unidades ni palabras detrás.')
    expect(chk('3.011·10^23 moleculas', '3.011e23').message).not.toMatch(/letra/)
    expect(chk('88 de CO2', '88', 'g').message).toBe('Escribe solo el número y la unidad (g), sin más palabras.')
    // la unidad del principio se lee aunque no sea la pedida: el aviso es el de siempre
    expect(chk('88 gramos de dióxido', '88', 'mL').message).toMatch(/La unidad no corresponde/)
    setMathLanguage('en')
    try { expect(chk('3 molecules', '3').message).toBe('Write only the number, without units or words after it.') } finally { setMathLanguage('es') }
  })

  it('una variable suelta sigue explicándose como letra', () => {
    expect(chk('5x', '5').message).toMatch(/letra «x»/)
    expect(chk('VII', '7').message).toMatch(/letra/)
  })

  it('con la unidad ignorada se toma el número más largo, no la primera cifra', () => {
    expect(chk('3.01*10^23 moléculas', '3.01e23', null, 'ignore').status).toBe('correct')
  })

  it('las piezas', () => {
    expect(NumericChecker.numberThenWords('3.01*10^23 moléculas')).toEqual({ num: '3.01*10^23', rest: 'moléculas' })
    expect(NumericChecker.numberThenWords('5 x')).toBeNull()
    expect(NumericChecker.leadingUnit('g de CO2')).toBe('g')
    expect(NumericChecker.leadingUnit('moléculas')).toBeNull()
  })
})
