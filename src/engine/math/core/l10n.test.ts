// Idioma de los mensajes de MathKit: catálogo en inglés (generado del catálogo Swift) y vuelta al español base.

import { afterEach, describe, expect, it } from 'vitest'
import { AnswerChecker, getMathLanguage, MathParser, mathTr, normalizeMathLanguage, setMathLanguage, setMathTranslator } from '../index'

const messages = (): Array<string | undefined> => [
  AnswerChecker.checkNumeric('', { value: '1' }).message,
  AnswerChecker.checkSet('1', ['1', '2', '3']).message,
  AnswerChecker.checkNumeric('3.14159', { value: 'pi', decimals: 2 }).message,
  AnswerChecker.checkText('', ['fotosíntesis']).message,
]

const parseError = (src: string): string => {
  try {
    MathParser.parse(src)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

afterEach(() => setMathLanguage('es'))

describe('setMathLanguage', () => {
  it('normaliza los códigos de idioma', () => {
    expect(normalizeMathLanguage('es-ES')).toBe('es')
    expect(normalizeMathLanguage('en_US')).toBe('en')
    expect(normalizeMathLanguage('EN')).toBe('en')
    expect(normalizeMathLanguage('fr')).toBe('es')
    expect(normalizeMathLanguage('')).toBe('es')
    setMathLanguage('en-GB')
    expect(getMathLanguage()).toBe('en')
  })

  it('los mensajes de los verificadores salen en inglés y vuelven al español', () => {
    const spanish = messages()
    expect(spanish[0]).toBe('Escribe tu respuesta.')
    expect(spanish[1]).toBe('Te faltan 2 soluciones.')
    expect(spanish[2]).toBe('El valor es correcto, pero se pide redondeado a 2 decimales.')

    setMathLanguage('en-US')
    const english = messages()
    expect(english[0]).toBe('Enter your answer.')
    expect(english[1]).toBe("You're missing 2 solutions.")
    expect(english[2]).toBe('The value is correct, but it needs to be rounded to 2 decimal places.')
    english.forEach((m, i) => expect(m).not.toBe(spanish[i]))

    setMathLanguage('es-ES')
    expect(messages()).toEqual(spanish)
  })

  it('elige la forma de plural con el primer argumento numérico', () => {
    expect(mathTr('Te faltan %lld soluciones.', 1)).toBe('Te falta 1 solución.')
    expect(mathTr('Te faltan %lld soluciones.', 3)).toBe('Te faltan 3 soluciones.')
    setMathLanguage('en')
    expect(mathTr('Te faltan %lld soluciones.', 1)).toBe("You're missing 1 solution.")
    expect(mathTr('Te faltan %lld soluciones.', 3)).toBe("You're missing 3 solutions.")
  })

  it('los errores del intérprete también se traducen', () => {
    const spanish = parseError('2 +')
    setMathLanguage('en')
    const english = parseError('2 +')
    expect(english).not.toBe('')
    expect(english).not.toBe(spanish)
    setMathLanguage('es')
    expect(parseError('2 +')).toBe(spanish)
  })

  it('un traductor propio tiene prioridad y setMathLanguage lo quita', () => {
    setMathTranslator((key) => (key === 'Escribe tu respuesta.' ? 'X' : undefined))
    expect(AnswerChecker.checkNumeric('', { value: '1' }).message).toBe('X')
    setMathLanguage('en')
    expect(AnswerChecker.checkNumeric('', { value: '1' }).message).toBe('Enter your answer.')
  })
})
