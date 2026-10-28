import { describe, expect, it } from 'vitest'
import { AnswerChecker } from './answer-checker'

const eq = (input: string, expected: string, vars: string[] | null = null) => AnswerChecker.checkEquation(input, expected, vars)
const text = (input: string, accepted: string[], rejected: string[] = []) => AnswerChecker.checkText(input, accepted, rejected).status

/**
 * MTH-05: en las respuestas de texto, la raya tipográfica y las demás rayas valen como el guion, y el guion pegado entre
 * una letra y una cifra es opcional («U 235» = «U-235»). Los signos que cambian el sentido se siguen distinguiendo.
 */
describe('TextDashEquivalenceTests', () => {
  it('typographic dashes are the hyphen', () => {
    expect(text('3-4', ['3–4'])).toBe('correct')
    expect(text('3–4', ['3-4'])).toBe('correct')
    expect(text('3—4', ['3-4'])).toBe('correct')
    expect(text('–5', ['-5'])).toBe('correct')
    expect(text('−5', ['-5'])).toBe('correct')
    expect(text('‐5', ['-5'])).toBe('correct')
    expect(text('－5', ['-5'])).toBe('correct')
    expect(text('Cl–', ['Cl-'])).toBe('correct')
    expect(text('1914–1918', ['1914-1918'])).toBe('correct')
    expect(text('ácido–base', ['ácido-base'])).toBe('correct')
    expect(text('K – Ca – P', ['K, Ca, P'])).toBe('correct')
  })

  it('hyphen between letter and digit is optional', () => {
    expect(text('U 235', ['U-235'])).toBe('correct')
    expect(text('U-235', ['U 235'])).toBe('correct')
    expect(text('U–235', ['U-235'])).toBe('correct')
    expect(text('C 14', ['C-14'])).toBe('correct')
    expect(text('B 12', ['B-12'])).toBe('correct')
    expect(text('vitamina B 12', ['vitamina B-12'])).toBe('correct')
    expect(text('COVID 19', ['COVID-19'])).toBe('correct')
    expect(text('carbono 14', ['carbono-14'])).toBe('correct')
  })

  it('meaningful signs still count', () => {
    for (const [input, accepted] of [['Na', 'Na+'], ['Na-', 'Na+'], ['Na–', 'Na+'], ['Cl', 'Cl-'], ['Cl', 'Cl–'], ['3+4', '3-4'], ['3–4', '3+4'], ['3 4', '3-4'],
      ['5', '-5'], ['5', '–5'], ['Na-1', 'Na+1'], ['Na 1', 'Na+1'], ['x+1', 'x-1'], ['x-1', 'x+1'], ['2x–1', '2x+1'], ['Fe3', 'Fe3+']]) {
      expect(text(input, [accepted]), `«${input}» vs «${accepted}»`).not.toBe('correct')
    }
    expect(text('U 235', ['U-235'], ['U 235']), 'un error típico del autor sigue mandando').not.toBe('correct')
  })
})

/** MJ-M05: el corrector de ecuaciones concedía equivalencia aunque faltaran soluciones (fuera de la ventana o tangenciales). */
describe('AuditEquationEquivalenceTests', () => {
  it('a missing solution outside the scan window is rejected', () => {
    expect(eq('x = 1', '(x-1)(x-100) = 0').status).toBe('incorrect')
    expect(eq('x = 1', '(x-1)(x+1000) = 0').status).toBe('incorrect')
    expect(eq('x = 1', 'x^2 - 101x + 100 = 0').status).toBe('incorrect')
  })

  it('a missing tangential solution is rejected', () => {
    expect(eq('x = 1', '(x-1)(x-sqrt(2))^2 = 0').status, '√2 es raíz doble de la esperada').toBe('incorrect')
    expect(eq('x = 1', '(x-1)(x-pi)^2 = 0').status).toBe('incorrect')
  })

  it('equivalent forms still pass', () => {
    const rows: Array<[string, string]> = [
      ['x = 1', '(x-1) = 0'], ['x = 1', '2(x-1) = 0'], ['x^2 - 5x + 6 = 0', '(x-2)(x-3) = 0'], ['x^2 = 4', 'x^2 - 4 = 0'], ['2x^2 + 2 = 0', 'x^2 + 1 = 0'],
      ['x = 1', '(x-1)(x^2+1) = 0'], ['x = 3', '3 = x'], ['x^2 = 0', 'x = 0'], ['x^2 + 2x + 1 = 0', 'x = -1'], ['(x-1)^2(x-2) = 0', '(x-1)(x-2) = 0'], ['x^2 + 1 = 0', '2x^2 + 2 = 0'],
    ]
    for (const [input, expected] of rows) {
      const v = eq(input, expected)
      expect(v.status, `«${input}» vs «${expected}»: ${v.message ?? ''}`).toBe('correct')
    }
  })

  it('extra solutions are still rejected', () => {
    expect(eq('x^2 = 9', 'x = 3').status).toBe('incorrect')
    expect(eq('x = 1', '(x-1)(x-2) = 0').status).toBe('incorrect')
    expect(eq('x^2 + 4 = 0', 'x^2 + 1 = 0').status).not.toBe('correct')
  })
})

/** MTH-02 y MTH-04: ecuaciones con funciones (log, ln, raíces, exponenciales, trigonométricas, valor absoluto). */
describe('FunctionEquationEquivalenceTests', () => {
  it('a known function on the left is an equation, not a function definition', () => {
    const rows: Array<[string, string]> = [
      ['x = 100', 'log(x) = 2'], ['x = 1', 'log(x) = 0'], ['x = e', 'ln(x) = 1'], ['x = 9', 'sqrt(x) = 3'],
      ['x = 4', 'sqrt(x) = 2'], ['x = 0', 'exp(x) = 1'], ['x^2 = 4', 'abs(x) = 2'], ['(x - 2)(x + 2) = 0', 'abs(x) = 2'],
      ['x = 8', 'cbrt(x) = 2'], ['x = 1', 'ln(x) = 0'],
    ]
    for (const [input, expected] of rows) {
      const v = eq(input, expected)
      expect(v.status, `${input} frente a ${expected}: ${v.message ?? '-'}`).toBe('correct')
    }
    expect(eq('x = 10', 'log(x) = 2').status).toBe('incorrect')
    expect(eq('x = 2', 'abs(x) = 2').status, 'falta x = −2').toBe('incorrect')
    expect(eq('x = 3', 'sqrt(x) = 3').status).toBe('incorrect')
    expect(eq('x = pi/2', 'sin(x) = 1').status).toBe('incorrect')
    expect(eq('2sin(x) = 2', 'sin(x) = 1').status).toBe('correct')
  })

  it('real function notation still works', () => {
    expect(eq('y = 2x + 1', 'f(x) = 2x + 1').status).toBe('correct')
    expect(eq('f(x) = 2x + 1', 'y = 2x + 1').status).toBe('correct')
    expect(eq('g(x) = x^2', 'y = x^2').status).toBe('correct')
    expect(eq('a x = 3', 'a(x) = 3', ['a', 'x']).status, 'una variable declarada delante de un paréntesis es un producto').toBe('correct')
  })

  it('missing far solutions of non-polynomial equations are rejected', () => {
    const rows: Array<[string, string]> = [
      ['x = 1', '(x-1)(sqrt(x) - 10) = 0'], ['x = 1', '(x-1)(ln(x) - 5) = 0'], ['x = 1', '(x-1)(log(x) - 4) = 0'], ['x = 1', '(x-1)(e^x - e^120) = 0'],
      ['x = 1', '(x-1)(abs(x) - 5000) = 0'], ['x = 1', '(x-1)(sqrt(x) - 10)^2 = 0'], ['x = 1', '(x-1)(cbrt(x) + 30) = 0'], ['x = 0', 'x*(ln(x + 1) - 0.000001) = 0'],
      ['x = 1', '(x-1)*sqrt(x - 9) = 0'],
    ]
    for (const [input, expected] of rows) {
      const v = eq(input, expected)
      expect(v.status, `${input} frente a ${expected} pierde una solución: ${v.message ?? '-'}`).toBe('incorrect')
    }
  })

  it('equivalent non-polynomial equations are accepted', () => {
    const rows: Array<[string, string]> = [
      ['(x - 1)(x - 100) = 0', '(x-1)(sqrt(x) - 10) = 0'], ['ln(x) = 5', 'x = e^5'], ['e^x = 1000', 'x = ln(1000)'], ['2^x = 1024', 'x = 10'], ['log(x) = 6', 'x = 1000000'],
      ['sqrt(x) = 3', 'x = 9'], ['sqrt(x + 7) = x - 5', 'x = 9'], ['x = 1', '(x - 1)(x - 100)/(x - 100) = 0'], ['x = 0', 'x*sqrt(x) = 0'], ['x = 0', 'sqrt(x) = 0'],
      ['x = 9', 'sqrt(x - 9) = 0'], ['sin(2x) = 0', '2sin(x)cos(x) = 0'], ['tan(x) = 0', 'sin(x) = 0'], ['x^2 = 4', 'abs(x) = 2'], ['x = 1000', 'log(x) = 3'],
    ]
    for (const [input, expected] of rows) {
      const v = eq(input, expected)
      expect(v.status, `${input} frente a ${expected}: ${v.message ?? '-'}`).toBe('correct')
    }
    expect(eq('x + 4 = 0', 'sqrt(x)^2 + 4 = 0').status).toBe('incorrect')
  })

  it('underflow zeros are not solutions', () => {
    expect(eq('x = 0', 'x*e^(-x^2) = 0').status).toBe('correct')
    expect(eq('x = 1', '(x-1)*e^x = 0').status).toBe('correct')
    expect(eq('x = 1', '(x-1)*e^(-x) = 0').status).toBe('correct')
    expect(eq('x = 2', '(x-2)*e^(-x^2/2) = 0').status).toBe('correct')
    expect(eq('x = 3', '(x-1)*e^(-x^2) = 0').status).toBe('incorrect')
    expect(eq('x = 0', 'abs(x) = x').status, 'la solución es todo x ≥ 0, no solo 0').toBe('incorrect')
    expect(eq('sqrt(x^2) = x', 'abs(x) = x').status).toBe('correct')
    expect(eq('x = x', 'x = 2').status).toBe('incorrect')
  })

  it('non-polynomial comparison is bounded', () => {
    const start = Date.now()
    eq('x = 1', '(x-1)(sqrt(x) - 10) = 0')
    eq('sin(2x) = 0', '2sin(x)cos(x) = 0')
    eq('x = 1', '(x-1)(ln(x) - 5) = 0')
    expect(Date.now() - start).toBeLessThan(4500)
    const huge = Array.from({ length: 180 }, (_, i) => `sin(x + ${i})`).join(' + ')
    const t0 = Date.now()
    const v = eq(huge + ' = 1', 'x = 1')
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(v.status).not.toBe('correct')
  })
})
