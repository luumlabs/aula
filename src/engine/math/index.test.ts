import { describe, expect, it } from 'vitest'
import * as MathKit from './index'

/** Prueba de humo: el módulo carga y la API pública responde de punta a punta (MathKitTests.swift). */
describe('MathKit public API', () => {
  it('module loads', () => {
    expect(MathKit.MathKitInfo.name).toBe('MathKit')
  })

  it('end to end', () => {
    const e = MathKit.MathParser.parse('1/2 + 1/3')
    const v = MathKit.evaluate(e)
    expect(v.kind === 'rational' && v.value.plain).toBe('5/6')
    expect(MathKit.toPlain(MathKit.simplify(e))).toBe('5/6')
    expect(MathKit.AnswerChecker.checkNumeric('5/6', MathKit.numericSpec('5/6')).status).toBe('correct')
    expect(MathKit.MathEquivalence.equivalent(MathKit.MathParser.parse('2(x+3)'), MathKit.MathParser.parse('2x+6'))).toBe(true)
    expect(MathKit.LiveCalculator.calculate('2^10').text).toBe('1024')
    expect(MathKit.Verdict.isCorrect(MathKit.AnswerChecker.checkText('Mitocondria', ['mitocondria']))).toBe(true)
  })

  it('answer list reading follows the decimal comma rule of the checkers', () => {
    MathKit.NumberInput.apply('comma')
    try {
      expect(MathKit.AnswerListReading.setPieces('{1,5; 2,5}')).toEqual(['1,5', '2,5'])
      expect(MathKit.AnswerListReading.setPieces('1,5, 2')).toEqual(['1,5', '2'])
      expect(MathKit.AnswerListReading.pointPieces('1,5, 2')).toEqual(['1,5', '2'])
      expect(MathKit.AnswerListReading.setPieces('x = 1 o x = 2')).toEqual(['x = 1', 'x = 2'])
    } finally {
      MathKit.NumberInput.apply('point')
    }
    expect(MathKit.AnswerListReading.setPieces('1,5, 2')).toEqual(['1', '5', '2'])
    expect(MathKit.AnswerListReading.setPieces('1,5; 2')).toEqual(['1,5', '2'])
    expect(MathKit.AnswerListReading.pointPieces('1;5')).toEqual(['1', '5'])
    MathKit.NumberInput.apply('auto')
  })

  it('messages can be translated', () => {
    MathKit.setMathTranslator((key) => (key === 'Escribe tu respuesta.' ? 'Write your answer.' : undefined))
    try {
      expect(MathKit.AnswerChecker.checkNumeric('', { value: '1' }).message).toBe('Write your answer.')
    } finally {
      MathKit.setMathTranslator(null)
    }
    expect(MathKit.AnswerChecker.checkNumeric('', { value: '1' }).message).toBe('Escribe tu respuesta.')
  })
})
