import { afterEach, describe, expect, it } from 'vitest'
import { MathError } from '../core/types'
import { AnswerChecker } from '../check/answer-checker'
import type { NumericForm } from '../check/specs'
import { evaluate } from '../eval/evaluate'
import { NumberFormat } from '../format/number-format'
import { TemplateEngine } from '../template/engine'
import { unitQuantityName, UnitTable } from '../units/unit-table'
import { has } from '../test-support.testutil'
import { NumberInput } from './number-input'
import { MathParser } from './parser'

// Separador decimal del estudiante (`NumberInput`): las dos formas de escribir decimales se aceptan siempre; la preferencia
// elige la lectura preferida, el separador de los números de los mensajes y, en un número con un solo grupo de tres
// cifras, que el separador decimal del estudiante no sea de miles (MC-04).

function withSetting(setting: string, body: () => void): void {
  NumberInput.apply(setting)
  try {
    body()
  } finally {
    NumberInput.apply('auto')
  }
}

const numeric = (input: string, value: string, form: NumericForm = 'any') => AnswerChecker.checkNumeric(input, { value, form })
const set = (input: string, expected: string[]) => AnswerChecker.checkSet(input, expected)
const point = (input: string, expected: string[]) => AnswerChecker.checkPoint(input, expected)
const interval = (input: string, expected: string) => AnswerChecker.checkInterval(input, expected)

function messageOf(block: () => unknown): string | null {
  try {
    block()
    return null
  } catch (e) {
    return e instanceof MathError ? e.message : null
  }
}

describe('NumberInputTests', () => {
  afterEach(() => NumberInput.apply('auto'))

  // MARK: La preferencia

  it('the preference can be forced and reset', () => {
    NumberInput.apply('comma')
    expect(NumberInput.decimalComma).toBe(true)
    NumberInput.apply('point')
    expect(NumberInput.decimalComma).toBe(false)
    NumberInput.decimalComma = true
    expect(NumberInput.decimalComma).toBe(true)
    NumberInput.decimalComma = false
    expect(NumberInput.decimalComma).toBe(false)
    NumberInput.apply('auto')
    expect(NumberInput.decimalComma).toBe(NumberInput.systemDecimalComma)
    expect(NumberInput.isForced).toBe(false)
  })

  // MARK: Números ambiguos («1,234» / «1.234»)

  it('unambiguous numbers are always accepted', () => {
    for (const setting of ['comma', 'point']) {
      withSetting(setting, () => {
        for (const [input, value] of [['12,5', '12.5'], ['12.5', '12.5'], ['1.234,5', '1234.5'], ['1,234.5', '1234.5'], ['0,866', '0.866'],
          ['1,234,567', '1234567'], ['1.234.567', '1234567']]) {
          expect(numeric(input, value).status, `«${input}» vs «${value}» con ${setting}`).toBe('correct')
        }
      })
    }
  })

  it('own decimal separator is never a thousands separator', () => {
    withSetting('point', () => {
      expect(numeric('1.234', '1234').status, 'km sin pasar a m').toBe('incorrect')
      expect(numeric('10.000', '10000').status).toBe('incorrect')
      expect(numeric('1.234', '1.234').status).toBe('correct')
      expect(numeric('1,234', '1234').status).toBe('correct')
      expect(numeric('1,234', '1.234').status).toBe('correct')
      expect(numeric('10,000', '10000').status).toBe('correct')
    })
    withSetting('comma', () => {
      expect(numeric('1,234', '1234').status).toBe('incorrect')
      expect(numeric('1,234', '1.234').status).toBe('correct')
      expect(numeric('1.234', '1234').status).toBe('correct')
      expect(numeric('1.234', '1.234').status).toBe('correct')
      expect(numeric('10.000', '10000').status).toBe('correct')
    })
    withSetting('point', () => {
      expect(AnswerChecker.checkExpression('1,500', { expected: '1500' }).status).toBe('correct')
      expect(AnswerChecker.checkExpression('1,500', { expected: '1.5' }).status).toBe('correct')
      expect(AnswerChecker.checkExpression('1.500', { expected: '1500' }).status).not.toBe('correct')
    })
    withSetting('comma', () => {
      expect(AnswerChecker.checkExpression('1,500', { expected: '1500' }).status).not.toBe('correct')
      expect(AnswerChecker.checkExpression('1,500', { expected: '1.5' }).status).toBe('correct')
      expect(AnswerChecker.checkExpression('1.500', { expected: '1500' }).status).toBe('correct')
    })
  })

  it('preferred reading of an ambiguous number', () => {
    withSetting('point', () => {
      const v = numeric('1,234', '1235')
      expect(v.normalizedInput, 'con punto decimal, «1,234» son miles').toBe('1234')
      expect(has(v, 'offByOne'), JSON.stringify(v.diagnosis)).toBe(true)
      expect(numeric('1.234', '1235').normalizedInput).toBe('1.234')
    })
    withSetting('comma', () => {
      const v = numeric('1,234', '1235')
      expect(v.normalizedInput).toBe('1.234')
      expect(v.diagnosis).toEqual(['other'])
      const w = numeric('1.234', '1235')
      expect(w.normalizedInput).toBe('1234')
      expect(has(w, 'offByOne')).toBe(true)
    })
  })

  // MARK: Listas, puntos e intervalos

  it('lists with decimal comma', () => {
    withSetting('comma', () => {
      expect(set('1,5; 2', ['1.5', '2']).status).toBe('correct')
      expect(set('{1,5; 2,5}', ['1.5', '2.5']).status).toBe('correct')
      expect(set('x = 1,5 o x = 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5, 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5', ['1.5']).status).toBe('correct')
      expect(set('1,5', ['1', '5']).status, 'la otra lectura se sigue aceptando').toBe('correct')
      expect(set('1, 2; 3', ['1', '2', '3']).status).toBe('correct')
      expect(set('1.5; 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5', ['7']).normalizedInput, 'a igualdad, la lectura con coma decimal').toBe('{1.5}')
    })
  })

  it('lists with decimal point', () => {
    withSetting('point', () => {
      expect(set('1.5, 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1.5; 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5; 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5, 2', ['1.5', '2']).status).toBe('correct')
      expect(set('1,5', ['1', '5']).status).toBe('correct')
      expect(set('1,5', ['1.5']).status).toBe('correct')
      expect(set('1,2,3', ['1', '2', '3']).status).toBe('correct')
      expect(set('1,5', ['7']).normalizedInput, 'a igualdad, la lectura clásica').toBe('{1, 5}')
    })
  })

  it('points with both separators', () => {
    for (const setting of ['comma', 'point']) {
      withSetting(setting, () => {
        expect(point('(1,5; 2)', ['1.5', '2']).status, setting).toBe('correct')
        expect(point('(1.5, 2)', ['1.5', '2']).status, setting).toBe('correct')
        expect(point('(1,5, -2,5)', ['1.5', '-2.5']).status, setting).toBe('correct')
        expect(point('(1,5)', ['1', '5']).status, setting).toBe('correct')
        expect(point('(1;5)', ['1', '5']).status, setting).toBe('correct')
        expect(point('(1, 2, 3)', ['1', '2', '3']).status, setting).toBe('correct')
        expect(point('(1,5,2)', ['1.5', '2']).status, `todo pegado: no se adivina (${setting})`).toBe('formatProblem')
      })
    }
  })

  it('intervals with both separators', () => {
    for (const setting of ['comma', 'point']) {
      withSetting(setting, () => {
        expect(interval('[1,5; 3]', '[1.5, 3]').status, setting).toBe('correct')
        expect(interval('[1,5, 3]', '[1.5, 3]').status, setting).toBe('correct')
        expect(interval('[1.5, 3]', '[1.5, 3]').status, setting).toBe('correct')
        expect(interval('(1,5)', '(1, 5)').status, setting).toBe('correct')
        expect(interval('{1,5; 2}', 'x = 1.5 o x = 2').status, setting).toBe('correct')
        expect(interval('{1, 2}', '{1; 2}').status, setting).toBe('correct')
        expect(interval('x < 1,5', '(-inf, 1.5)').status, setting).toBe('correct')
      })
    }
  })

  // MARK: Números en los mensajes

  const modeError = (): string | null => messageOf(() => evaluate(MathParser.parse('mode(1.5, 1.5, sqrt(2), sqrt(2))')))

  it('numbers in messages follow the preference', () => {
    withSetting('comma', () => {
      expect(numeric('1/3', '0.333').message).toContain('0,333')
      expect(numeric('3/4', '0.75', 'decimal').message).toContain('(por ejemplo 0,75)')
      expect(numeric('32000', '32000', 'scientific').message).toContain('3,2e4 o 3,2×10^4')
      expect(interval('[1.5, 3]', '(1.5, 3]').message).toBe('Los intervalos están bien, pero revisa los extremos: en x = 1,5 debe ir paréntesis ( ). '
        + '(Corchete si el valor se incluye; paréntesis si no, o si es ∞ o hace cero un denominador.)')
      expect(modeError()).toContain('1,5; ')
    })
    withSetting('point', () => {
      expect(numeric('1/3', '0.333').message).toContain('0.333')
      expect(numeric('3/4', '0.75', 'decimal').message).toContain('(por ejemplo 0.75)')
      expect(numeric('32000', '32000', 'scientific').message).toContain('3.2e4 o 3.2×10^4')
      expect(interval('[1.5, 3]', '(1.5, 3]').message).toContain('en x = 1.5 debe ir paréntesis')
      expect(modeError()).toContain('1.5, ')
    })
    withSetting('comma', () => {
      expect(numeric('0,25', '4').normalizedInput).toBe('0.25')
      expect(numeric('0,25', '4').latexInput).toBe('0.25')
      expect(NumberFormat.decimal(0.5)).toBe('0.5')
    })
  })

  // MARK: Textos reestructurados para traducir (el español no cambia)

  it('restructured spanish messages are unchanged', () => {
    const parseMessage = (s: string): string | null => messageOf(() => MathParser.parse(s))
    expect(parseMessage('x1')).toBe('Falta un operador antes de «1»: para un subíndice escribe «x_1»; para multiplicar, «x*1»')
    expect(parseMessage('2 3')).toBe('Falta un operador antes de «3»: escribe «2*3» o usa paréntesis')
    expect(parseMessage('(2)3')).toBe('Falta un operador antes de «3»: escribe «*» entre los dos factores')
    expect(parseMessage('sinn(x)')).toBe('No conozco la función «sinn». ¿Quisiste decir «sin»?')
    expect(parseMessage('area(x)')).toBe('No conozco la función «area»')
    expect(parseMessage('root(3)')).toBe('«root» necesita 2 argumentos y recibió 1: por ejemplo root(3, x)')
    expect(parseMessage('gcd(4)')).toBe('«gcd» necesita al menos 2 argumentos y recibió 1: por ejemplo gcd(a, b)')
    expect(parseMessage('normalcdf(1)')).toBe('«normalcdf» necesita entre 2 y 4 argumentos y recibió 1: por ejemplo normalcdf(-1.96, 1.96) o normalcdf(a, b, μ, σ)')
    expect(MathParser.ambiguityNote('1/2x')).toBe('Entendí 1/2x como 1/(2x); si querías (1/2)x escribe (1/2)x')
    expect(numeric('0.375', '3/8', 'percent').message).toBe('El valor es correcto, pero escríbelo como porcentaje, con el símbolo %.')
    expect(numeric('6/8', '3/4', 'reducedFraction').message).toBe('El valor es correcto, pero falta simplificar la fracción: 6/8 = 3/4.')
    expect(numeric('5', '5', 'any').message).toBeUndefined()
    expect(point('(1, 2)', ['1', '-2']).message).toBe('La coordenada x está bien, pero la y tiene el signo al revés.')
    expect(point('(1, 5, 7)', ['1', '2', '3']).message).toBe('La coordenada x está bien. La coordenada y no coincide. La coordenada z no coincide.')
    expect(AnswerChecker.checkEquation('y=-2x+1', 'y=2x+1').message).toBe('Casi: revisa el signo de «x» en tu ecuación.')
    expect(AnswerChecker.checkExpression('z+1', { expected: 'x+1' }).message).toBe('Usa solo la variable x (no «z»).')
    expect(set('1, 2', ['1', '2', '3']).message).toBe('Te falta una solución: revisa si descartaste un valor válido o si la ecuación tiene más de una raíz.')
    expect(set('1, 4', ['1', '2']).message).toBe('Tu conjunto no coincide: acertaste 1 de 2.')
    const n = UnitTable.parse('N')
    expect(n ? unitQuantityName(n) : null).toBe('fuerza')
    const f = UnitTable.parse('m^2*kg/s')
    expect(f ? unitQuantityName(f) : null, 'sin nombre: la fórmula de la dimensión').toBe('m^2·kg·s^-1')
  })

  it('exact numbers in messages are not grouped', () => {
    expect(messageOf(() => MathParser.parse('1'.repeat(2001)))).toBe('La expresión es demasiado larga (máximo 2000 caracteres)')
    expect(messageOf(() => evaluate(MathParser.parse('1000!')))).toBe('El factorial de 1000 es demasiado grande')
    expect(messageOf(() => TemplateEngine.sample([{ name: 'a', kind: { type: 'int', min: 5000, max: 1000, exclude: [] } }], [], 1)))
      .toBe('La variable «a» tiene el rango al revés (min 5000 > max 1000).')
    expect(numeric('6000/8000', '3/4', 'reducedFraction').message).toBe('El valor es correcto, pero falta simplificar la fracción: 6000/8000 = 3/4.')
    expect(numeric('0.0052', '5.2').message).toBe('Tu respuesta difiere por un factor de 10^-3: revisa la coma decimal o la conversión de unidades.')
  })

  it('points with more than three coordinates do not crash', () => {
    const v = point('(1, 2, 3, 5)', ['1', '2', '3', '4'])
    expect(v.status).toBe('partial')
    expect(v.message).toContain('x4')
  })
})
