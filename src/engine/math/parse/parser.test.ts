import { describe, expect, it } from 'vitest'
import { simplify } from '../algebra/simplify'
import { derivative } from '../algebra/derivative'
import { E, freeVariables, substitute } from '../core/expr'
import { MV, type MathErrorKind } from '../core/types'
import { evaluate, evaluateDouble, tryEvaluate, tryEvaluateDouble } from '../eval/evaluate'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { DeterministicRNG } from '../random/rng'
import { MathParser } from './parser'
import { P, Q, errorOf, exact, expectClose, expectValue, num, parseError, plainOf } from '../test-support.testutil'

const sorted = (s: Set<string>): string[] => [...s].sort()

describe('ParserTests', () => {
  // MARK: Precedencia y asociatividad (por valor)

  it('precedence values', () => {
    const rows: Array<[string, number]> = [
      ['2+3*4', 14], ['(2+3)*4', 20], ['10-4-3', 3], ['100/10/5', 2], ['2*3/4', 1.5], ['2*3^2', 18], ['(2*3)^2', 36], ['8/2*4', 16],
      ['2^3^2', 512], ['(2^3)^2', 64], ['2^(3^2)', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-1', 0.5], ['2^-2', 0.25], ['-2^-2', -0.25],
      ['2*-3', -6], ['2--3', 5], ['2+-3', -1], ['--3', 3], ['+3', 3], ['-+3', -3], ['+-3', -3], ['3-+2', 1], ['2^+2', 4],
      ['3!', 6], ['2^3!', 64], ['(2^3)!', 40320], ['-3!', -6], ['3!^2', 36], ['(1+2)!', 6], ['0!', 1], ['5!/3!', 20],
      ['5%', 0.05], ['50%*2', 1], ['200%', 2], ['2^50%', Math.sqrt(2)], ['10 mod 3', 1], ['-7 mod 3', 2], ['7 mod -3', -2],
      ['2*3 mod 4', 2], ['10/4 mod 2', 0.5], ['1+2 mod 2', 1], ['5 mod 3 mod 2', 0], ['2+3*4^2/8-1', 7], ['1-1-1-1', -2], ['2/3/4', 1 / 6],
      ['1/2/2', 0.25], ['2^3*2', 16], ['2*2^3', 16], ['-1^2', -1], ['(-1)^3', -1], ['0.1*3', 0.3], ['4/-2', -2], ['--2^2', 4],
    ]
    for (const [s, v] of rows) expectClose(num(s), v, 1e-9, `«${s}»`)
  })

  it('right associative power plain', () => {
    expect(plainOf('2^3^2')).toBe('2^3^2')
    expect(plainOf('(2^3)^2')).toBe('(2^3)^2')
    expect(plainOf('2^-3^2')).toBe('2^(-3^2)')
    expect(plainOf('x^2^3')).toBe('x^2^3')
  })

  // MARK: Multiplicación implícita

  it('implicit multiplication plain', () => {
    const rows: Array<[string, string]> = [
      ['2x', '2x'], ['2*x', '2x'], ['x*2', 'x*2'], ['2(x+1)', '2(x+1)'], ['(x+1)(x-1)', '(x+1)(x-1)'], ['x(x+1)', 'x*(x+1)'], ['(x+1)x', '(x+1)*x'],
      ['x y', 'x*y'], ['xy', 'x*y'], ['xyz', 'x*y*z'], ['2xy', '2x*y'], ['2x^2', '2x^2'], ['x^2y', 'x^2*y'], ['x^2 y', 'x^2*y'],
      ['3x^2+2x+1', '3x^2+2x+1'], ['2pi', '2pi'], ['2π', '2pi'], ['pi r^2', 'pi*r^2'], ['πr²', 'pi*r^2'], ['3sqrt(2)', '3sqrt(2)'],
      ['2sqrt(x)', '2sqrt(x)'], ['2 sqrt x', '2sqrt(x)'], ['sqrt 2 x', 'sqrt(2)*x'], ['√2x', 'sqrt(2)*x'], ['√(2x)', 'sqrt(2x)'],
      ['2e', '2e'], ['2e^x', '2e^x'], ['e^2x', 'e^2*x'], ['e^(2x)', 'e^(2x)'], ['2^3x', '2^3*x'], ['2(3)(4)', '2*3*4'], ['(2)(3)', '2*3'],
      ['2(x)(y)', '2x*y'], ['x(2)', 'x*2'], ['xsin(x)', 'x*sin(x)'], ['2sinx', '2sin(x)'], ['2 sin x', '2sin(x)'], ['sin x cos x', 'sin(x)*cos(x)'],
      ['sin 2x cos 3x', 'sin(2x)*cos(3x)'], ['sin(x)cos(x)', 'sin(x)*cos(x)'], ['sin(x)(x+1)', 'sin(x)(x+1)'], ['sin x^2', 'sin(x^2)'],
      ['a b c', 'a*b*c'], ['2 x y', '2x*y'], ['0.5x', '0.5x'], ['.5x', '0.5x'], ['1,5x', '1.5x'], ['3e2x', '300x'], ['x e', 'x*e'],
      ['2θ', '2θ'], ['sin θ', 'sin(θ)'], ['v_0 t', 'v_0*t'], ['(x+1)(x+2)(x+3)', '(x+1)(x+2)(x+3)'], ['2(x+1)(x+2)', '2(x+1)(x+2)'],
      ['ln 2x', 'ln(2x)'], ['ln|x|', 'ln(abs(x))'], ['2|x|', '2abs(x)'], ['|x||y|', 'abs(x)*abs(y)'], ['x(y+z)', 'x*(y+z)'], ['pi(x+1)', 'pi*(x+1)'],
    ]
    expect(rows.length).toBeGreaterThanOrEqual(30)
    for (const [input, expected] of rows) expect(plainOf(input), `«${input}»`).toBe(expected)
  })

  it('implicit multiplication values', () => {
    const rows: Array<[string, Record<string, number>, number]> = [
      ['2x', { x: 3 }, 6], ['2(x+1)', { x: 3 }, 8], ['(x+1)(x-1)', { x: 4 }, 15], ['x(x+1)', { x: 2 }, 6], ['2x^2', { x: 3 }, 18],
      ['3x^2+2x+1', { x: 2 }, 17], ['2^3x', { x: 2 }, 16], ['xy', { x: 2, y: 3 }, 6], ['2xy', { x: 2, y: 3 }, 12], ['x y z', { x: 1, y: 2, z: 3 }, 6],
      ['3(x-2)^2', { x: 4 }, 12], ['2x(x+1)', { x: 2 }, 12], ['pi r^2', { r: 2 }, 4 * Math.PI], ['2pi', {}, 2 * Math.PI],
      ['e^2x', { x: 3 }, 3 * Math.exp(2)], ['e^(2x)', { x: 3 }, Math.exp(6)], ['sin 2x', { x: 1 }, Math.sin(2)], ['sin x cos x', { x: 1 }, Math.sin(1) * Math.cos(1)],
      ['sin x^2', { x: 2 }, Math.sin(4)], ['sin^2 x', { x: 2 }, Math.sin(2) * Math.sin(2)], ['ln 2x', { x: 2 }, Math.log(4)], ['sqrt 2 x', { x: 3 }, 3 * Math.sqrt(2)],
      ['sqrt(2x)', { x: 8 }, 4], ['3sqrt(4)', {}, 6], ['(1/2)x', { x: 4 }, 2], ['1/2*x', { x: 4 }, 2], ['1/2x', { x: 4 }, 0.125], ['1/(2x)', { x: 4 }, 0.125],
      ['x/2y', { x: 8, y: 2 }, 2], ['x/2*y', { x: 8, y: 2 }, 8], ['2x/3y', { x: 3, y: 1 }, 2], ['5/6pi', {}, 5 / (6 * Math.PI)], ['5pi/6', {}, (5 * Math.PI) / 6],
      ['-2x', { x: 3 }, -6], ['-x^2', { x: 3 }, -9], ['(-x)^2', { x: 3 }, 9], ['2 x', { x: 3 }, 6], ['(x)(x)', { x: 5 }, 25], ['x(x)(x)', { x: 2 }, 8],
    ]
    for (const [s, env, v] of rows) expectClose(num(s, env), v, 1e-9, `«${s}»`)
  })

  it('implicit multiplication binds tighter than division', () => {
    expect(plainOf('1/2x')).toBe('1/(2x)')
    expect(plainOf('5/6pi')).toBe('5/(6pi)')
    expect(plainOf('a/b c')).toBe('a/(b*c)')
    expect(plainOf('1/2*x')).toBe('1/2*x')
    expect(plainOf('(1/2)x')).toBe('1/2*x')
    expect(plainOf('1/x*2')).toBe('1/x*2')
  })

  // MARK: Avisos de ambigüedad

  it('ambiguity notes', () => {
    expect(MathParser.ambiguityNote('1/2x')).toBe('Entendí 1/2x como 1/(2x); si querías (1/2)x escribe (1/2)x')
    expect(MathParser.ambiguityNote('5/6pi')).toBe('Entendí 5/6pi como 5/(6pi); si querías (5/6)pi escribe (5/6)pi')
    expect(MathParser.ambiguityNote('x/2y')).toBe('Entendí x/2y como x/(2y); si querías (x/2)y escribe (x/2)y')
    expect(MathParser.ambiguityNote('1/2(x+1)')).not.toBeNull()
    expect(MathParser.ambiguityNote('sin(x)/2x')).not.toBeNull()
    expect(MathParser.ambiguityNote('3+1/2x')).not.toBeNull()
    for (const s of ['1/(2x)', '(1/2)x', '1/2*x', '1/2', '2x/3', '1/sin x', 'x/y', '1/ (2']) expect(MathParser.ambiguityNote(s), s).toBeNull()
  })

  // MARK: Funciones sin paréntesis, potencias de funciones, inversas

  it('functions without parentheses', () => {
    const rows: Array<[string, string]> = [
      ['sin x', 'sin(x)'], ['sin 2x', 'sin(2x)'], ['ln x', 'ln(x)'], ['log x', 'log(x)'], ['sqrt x', 'sqrt(x)'], ['sqrt x^2', 'sqrt(x^2)'],
      ['sin x + 1', 'sin(x)+1'], ['sin x / 2', 'sin(x)/2'], ['sin pi x', 'sin(pi*x)'], ['cos -x', 'cos(-x)'], ['exp x y', 'exp(x*y)'],
      ['sin sin x', 'sin(sin(x))'], ['sqrt sqrt 16', 'sqrt(sqrt(16))'], ['2 sin x cos x', '2sin(x)*cos(x)'], ['sin x!', 'sin(x!)'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
  })

  it('powers and inverses of functions', () => {
    const rows: Array<[string, string]> = [
      ['sin^2 x', 'sin(x)^2'], ['sin^2(x)', 'sin(x)^2'], ['sin²x', 'sin(x)^2'], ['sin²(2x)', 'sin(2x)^2'], ['cos^3 x', 'cos(x)^3'],
      ['tan^2(x/2)', 'tan(x/2)^2'], ['ln^2 x', 'ln(x)^2'], ['sin^-1(x)', 'asin(x)'], ['sin^-1 x', 'asin(x)'], ['cos^(-1)(x)', 'acos(x)'],
      ['tan⁻¹(x)', 'atan(x)'], ['sin^{-1}(x)', 'asin(x)'], ['arcsin(x)', 'asin(x)'], ['arccos x', 'acos(x)'], ['arctan(1)', 'atan(1)'],
      ['sec^-1(x)', 'asec(x)'], ['sinh^-1(x)', 'asinh(x)'], ['sin(x)^2', 'sin(x)^2'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
    expectClose(num('sin^-1(0.5)'), Math.PI / 6)
    expectClose(num('tan^-1(1)'), Math.PI / 4)
    expectClose(num('sin^2(2)'), Math.sin(2) * Math.sin(2))
  })

  it('function names and aliases', () => {
    const rows: Array<[string, string]> = [
      ['SIN(x)', 'sin(x)'], ['Sin(x)', 'sin(x)'], ['sen(x)', 'sin(x)'], ['tg(x)', 'tan(x)'], ['tg x', 'tan(x)'], ['ctg(x)', 'cot(x)'], ['cosec(x)', 'csc(x)'],
      ['arcsen(x)', 'asin(x)'], ['arctg(x)', 'atan(x)'], ['raiz(x)', 'sqrt(x)'], ['RAÍZ(x)', 'sqrt(x)'], ['binom(5,2)', 'nCr(5, 2)'], ['NCR(5,2)', 'nCr(5, 2)'],
      ['ncr(5,2)', 'nCr(5, 2)'], ['npr(5,2)', 'nPr(5, 2)'], ['mcd(12,18)', 'gcd(12, 18)'], ['mcm(4,6)', 'lcm(4, 6)'], ['ceiling(x)', 'ceil(x)'],
      ['sgn(x)', 'sign(x)'], ['factorial(5)', 'fact(5)'], ['atan2(1,1)', 'atan2(1, 1)'], ['arctan2(1,1)', 'atan2(1, 1)'], ['LN(x)', 'ln(x)'], ['Exp(x)', 'exp(x)'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
  })

  it('logarithm forms', () => {
    const rows: Array<[string, string]> = [
      ['log(100)', 'log(100)'], ['log10(x)', 'log(x)'], ['log_10(x)', 'log(x)'], ['log_{10}(x)', 'log(x)'], ['log_e(x)', 'ln(x)'], ['log_2 x', 'log(2, x)'],
      ['log_2(8)', 'log(2, 8)'], ['log_{2}(8)', 'log(2, 8)'], ['log2(8)', 'log(2, 8)'], ['log3(81)', 'log(3, 81)'], ['log(2,8)', 'log(2, 8)'],
      ['log_3(x+1)', 'log(3, x+1)'], ['log_{x+1}(5)', 'log(x+1, 5)'], ['log100', 'log(100)'], ['log 100', 'log(100)'], ['ln(x)', 'ln(x)'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
    expectClose(num('log_2(8)'), 3)
    expectClose(num('log3(81)'), 4)
    expectClose(num('log(5,125)'), 3)
    expectClose(num('log2(1/8)'), -3)
  })

  // MARK: Constantes, números

  it('number formats', () => {
    const rows: Array<[string, string]> = [
      ['0.5', '0.5'], ['.5', '0.5'], ['5.', '5'], ['1.5e3', '1500'], ['1e-3', '0.001'], ['2E3', '2000'], ['1e+2', '100'], ['0,5', '0.5'], ['0,5+0,25', '0.5+0.25'],
      ['3,14', '3.14'], ['1,5e2', '150'], ['007', '7'], ['1.0', '1'], ['½', '0.5'], ['¼', '0.25'], ['¾', '0.75'], ['2½', '2.5'], ['⅓', '1/3'],
      ['1/3', '1/3'], ['0.125', '0.125'], ['1e-7', '0.0000001'], ['0.8660254037844386', '0.8660254037844386'], ['0.3333333', '0.3333333'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
    expectValue(exact('0.1+0.2'), Q(3, 10), 'los decimales son exactos')
    expectValue(exact('1.2e-3'), Q(3, 2500))
    expectValue(exact('2e3'), Q(2000))
  })

  it('scientific versus Euler number', () => {
    expect(plainOf('2e')).toBe('2e')
    expect(plainOf('2e^3')).toBe('2e^3')
    expect(plainOf('2ex')).toBe('2e*x')
    expect(plainOf('2e3')).toBe('2000')
    expect(plainOf('2e-3')).toBe('0.002')
    expect(plainOf('2e+3')).toBe('2000')
    expect(parseError('2e3', { scientificNotation: false }), 'sin notación científica, 2e3 son 3 factores seguidos').not.toBeNull()
  })

  it('constants', () => {
    expectClose(num('pi'), Math.PI)
    expectClose(num('PI'), Math.PI)
    expectClose(num('π'), Math.PI)
    expectClose(num('e'), Math.E)
    expect(num('inf')).toBe(Infinity)
    expect(num('∞')).toBe(Infinity)
    expect(num('-∞')).toBe(-Infinity)
    expect(num('infinity')).toBe(Infinity)
    expect(freeVariables(P('e')).size).toBe(0)
    expect(freeVariables(P('pi*inf')).size).toBe(0)
    expect(sorted(freeVariables(P('E'))), 'la E mayúscula es una variable (energía)').toEqual(['E'])
    // «tau» es la letra τ (par motor, constante de tiempo), igual que «τ» y «\tau»; no la constante 2π
    expect(sorted(freeVariables(P('tau')))).toEqual(['τ'])
    expect(sorted(freeVariables(P('τ')))).toEqual(['τ'])
    expect(sorted(freeVariables(P('\\tau')))).toEqual(['τ'])
    expectClose(num('tau', { τ: 2 }), 2)
    expect(toLatex(E.constant('tau')), 'la constante sigue existiendo para expresiones construidas en código').toBe('\\tau')
    expectClose(tryEvaluateDouble(E.constant('tau')), 2 * Math.PI)
  })

  // MARK: Unicode y entradas pegadas

  it('unicode normalization', () => {
    const rows: Array<[string, string]> = [
      ['x−y', 'x-y'], ['x–y', 'x-y'], ['x—y', 'x-y'], ['2×3', '2*3'], ['2·3', '2*3'], ['2⋅3', '2*3'], ['6÷3', '6/3'], ['6∕3', '6/3'], ['x²', 'x^2'], ['x³', 'x^3'],
      ['x⁴', 'x^4'], ['x⁻¹', 'x^(-1)'], ['x⁻²', 'x^(-2)'], ['x¹²', 'x^12'], ['e^(−x)', 'e^(-x)'], ['√x', 'sqrt(x)'], ['√(x+1)', 'sqrt(x+1)'], ['√16', 'sqrt(16)'],
      ['∛x', 'cbrt(x)'], ['π', 'pi'], ['∞', 'inf'], ['−∞', '-inf'], ['x', 'x'],
      ['（x+1）', 'x+1'], ['ｘ＋１', 'x+1'], ['2\u00A0x', '2x'], ['2\u2009x', '2x'], ['2\u200Bx', '2x'], ['x\u3000y', 'x*y'], ['\uFEFFx', 'x'],
      ['log₂(8)', 'log(2, 8)'], ['x₁+x₂', 'x_1+x_2'], ['[x+1]', 'x+1'], ['{x+1}', 'x+1'], ['(x+1]', 'x+1'], ['⌊x⌋', 'floor(x)'], ['⌈x⌉', 'ceil(x)'],
      ['30º', '30°'], ['x', 'x'], ['x²', 'x^2'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
  })

  it('vulgar fractions and mixed numbers in expressions', () => {
    expectValue(exact('½+½'), Q(1))
    expectValue(exact('2½*2'), Q(5))
    expectValue(exact('¾'), Q(3, 4))
    expectValue(exact('3⅛'), Q(25, 8))
    expectValue(exact('2 ½'), Q(5, 2))
  })

  // MARK: LaTeX de entrada

  it('TeX import', () => {
    const rows: Array<[string, number]> = [
      ['\\frac{1}{2}', 0.5], ['\\frac{\\sqrt{3}}{2}', Math.sqrt(3) / 2], ['\\dfrac{3}{4}', 0.75], ['2\\cdot 3', 6], ['2\\times 3', 6],
      ['\\sqrt{16}', 4], ['\\sqrt[3]{27}', 3], ['\\pi', Math.PI], ['2\\pi', 2 * Math.PI], ['\\frac{\\pi}{6}', Math.PI / 6],
      ['\\left(1+2\\right)\\cdot 3', 9], ['2^{3}', 8], ['2^{-1}', 0.5], ['\\sin\\left(\\frac{\\pi}{2}\\right)', 1], ['\\ln e', 1],
      ['\\log_{2}(8)', 3], ['\\binom{5}{2}', 10], ['50\\%', 0.5], ['30^\\circ', Math.PI / 6], ['30^{\\circ}', Math.PI / 6],
      ['$\\frac{1}{3}$', 1 / 3], ['\\(\\frac{1}{3}\\)', 1 / 3], ['-\\frac{3}{4}', -0.75], ['\\frac{1}{2}+\\frac{1}{3}', 5 / 6],
      ['\\lfloor 2.7 \\rfloor', 2], ['\\left|-3\\right|', 3], ['e^{2}', Math.exp(2)], ['\\frac{1}{\\frac{1}{2}}', 2], ['\\sqrt{\\frac{9}{4}}', 1.5],
      ['\\text{3}', 3], ['1\\,000', 1000],
    ]
    for (const [s, v] of rows) expectClose(num(s), v, 1e-9, `TeX «${s}»`)
    expect(num('\\infty')).toBe(Infinity)
    expect(plainOf('\\frac{x+1}{x-1}')).toBe('(x+1)/(x-1)')
    expect(plainOf('\\theta')).toBe('θ')
    expect(plainOf('x_{1}+x_{2}')).toBe('x_1+x_2')
  })

  // MARK: Valor absoluto con barras

  it('absolute value bars', () => {
    const rows: Array<[string, Record<string, number>, number]> = [
      ['|x|', { x: -3 }, 3], ['|x-5|', { x: 2 }, 3], ['||x|-1|', { x: -3 }, 2], ['|x||y|', { x: -2, y: 3 }, 6], ['2|x|', { x: -2 }, 4],
      ['|2x|', { x: -2 }, 4], ['ln|x|', { x: -2 }, Math.log(2)], ['-|x|', { x: 4 }, -4], ['|x|+|y|', { x: -1, y: -2 }, 3], ['|(x-1)(x+1)|', { x: 0 }, 1],
      ['|x - |y||', { x: 1, y: -3 }, 2],
    ]
    for (const [s, env, v] of rows) expectClose(num(s, env), v, 1e-9, `«${s}»`)
    expect(parseError('|x')).not.toBeNull()
    expect(parseError('x|')).not.toBeNull()
    expect(parseError('||')).not.toBeNull()
  })

  // MARK: Errores con posición y mensajes

  it('syntax errors have positions and messages', () => {
    const rows: Array<[string, MathErrorKind, number | null, string]> = [
      ['2+', 'syntax', 2, 'incompleta'],
      ['((3)', 'syntax', 0, 'Falta cerrar un paréntesis'],
      ['(3))', 'syntax', 3, 'Sobra un paréntesis'],
      ['  2 + (3', 'syntax', 6, 'Falta cerrar un paréntesis'],
      ['x² + (3', 'syntax', 5, 'Falta cerrar un paréntesis'],
      ['3 +* 4', 'syntax', 3, 'Falta un número'],
      ['1.2.3', 'syntax', 0, 'Número mal escrito'],
      ['5 5', 'syntax', 2, 'Falta un operador'],
      ['x3', 'syntax', 1, 'Falta un operador'],
      ['2 @ 3', 'syntax', 2, 'No reconozco el símbolo'],
      ['x = 3', 'syntax', 2, '«=»'],
      ['x < 3', 'syntax', 2, 'desigualdad'],
      ['1, 2', 'syntax', 1, 'Sobra una coma'],
      ['sin', 'syntax', 0, 'Falta el argumento'],
      ['sin()', 'syntax', 3, 'Falta el argumento'],
      ['root(3)', 'syntax', 0, 'necesita 2 argumentos'],
      ['max()', 'syntax', 3, 'Falta el argumento'],
      ['sqrt(1,2,3)', 'syntax', null, 'demasiados argumentos'],
      ['|x', 'syntax', 0, 'valor absoluto'],
      ['root 3', 'syntax', 0, 'necesita paréntesis'],
      ['', 'syntax', 0, 'Escribe una expresión'],
      ['   ', 'syntax', 0, 'Escribe una expresión'],
      [')', 'syntax', 0, 'no puede empezar'],
      ['*3', 'syntax', 0, 'no puede empezar'],
      ['2 3', 'syntax', 2, 'Falta un operador'],
      ['mod 3', 'syntax', 0, 'mod'],
      ['2e999', 'overflow', 0, 'demasiado grande'],
    ]
    for (const [input, kind, position, fragment] of rows) {
      const e = parseError(input)
      expect(e, `«${input}» debería fallar`).not.toBeNull()
      if (!e) continue
      expect(e.kind, `«${input}» tipo (${e.message})`).toBe(kind)
      if (position !== null) expect(e.position, `«${input}» posición (${e.message})`).toBe(position)
      expect(e.message, `«${input}»`).toContain(fragment)
    }
  })

  it('unknown function suggestions', () => {
    const rows: Array<[string, string | null]> = [
      ['sinn(x)', 'sin'], ['cso(x)', 'cos'], ['tna(x)', 'tan'], ['sqr(x)', 'sqrt'], ['sqrtt(x)', 'sqrt'], ['lnn(x)', 'ln'], ['abc(x)', 'abs'],
      ['coss(x)', 'cos'], ['area(x)', null], ['speed(2)', null], ['force(m)', null],
    ]
    for (const [input, suggestion] of rows) {
      const e = parseError(input)
      expect(e, `«${input}» debería ser una función desconocida`).not.toBeNull()
      if (!e) continue
      expect(e.kind, `«${input}»: ${e.message}`).toBe('unknownFunction')
      if (suggestion !== null) expect(e.message, input).toContain(`¿Quisiste decir «${suggestion}»?`)
      else expect(e.message, input).not.toContain('¿Quisiste decir')
      expect(e.position).toBe(0)
    }
  })

  it('short letter runs followed by parenthesis are products', () => {
    expect(plainOf('xy(z)')).toBe('x*y*z')
    expect(plainOf('ab(x+1)')).toBe('a*b*(x+1)')
    expect(plainOf('xyz(2)')).toBe('x*y*z*2')
    expect(plainOf('pit(x)')).toBe('pi*t*x')
  })

  // MARK: Coma decimal frente a lista

  it('decimal comma context', () => {
    expectValue(exact('1,5+1'), Q(5, 2))
    expectValue(exact('max(1,5)'), Q(5), 'en una función de varios argumentos la coma separa')
    expectValue(exact('max(1;5)'), Q(5))
    expectValue(exact('min(1,5)'), Q(1))
    expectValue(exact('gcd(12,18)'), Q(6))
    expectValue(exact('sin(0,5)'), exact('sin(0.5)'), 'en una función de un argumento es decimal')
    expectValue(exact('(1,5)'), Q(3, 2))
    expectValue(exact('max(1,5; 2,5)'), Q(5, 2), 'con punto y coma, las comas son decimales')
    expectValue(exact('round(2,567; 2)'), Q(257, 100))
    expect(parseError('1, 5'), 'con espacio es una lista, no un número').not.toBeNull()
    expect(parseError('1,5,3')).not.toBeNull()
    expect(parseError('1,5', { decimalComma: false })).not.toBeNull()
    expect(toPlain(MathParser.parse('max(1,5)', { decimalComma: false }))).toBe('max(1, 5)')
  })

  // MARK: Opciones

  it('options disable features', () => {
    expect(parseError('2x', { implicitMultiplication: false })).not.toBeNull()
    expect(parseError('2(3)', { implicitMultiplication: false })).not.toBeNull()
    expect(toPlain(MathParser.parse('2*x', { implicitMultiplication: false }))).toBe('2x')
    expect(sorted(freeVariables(MathParser.parse('total*rate', { implicitMultiplication: false })))).toEqual(['rate', 'total'])
    expect(parseError('30°', { degreeSymbol: false })).not.toBeNull()
    expect(evaluateDouble(MathParser.parse('7 % 3', { percent: false }))).toBe(1)
    expect(evaluateDouble(MathParser.parse('7%3', { percent: false }))).toBe(1)
    const o = { wordVariables: true }
    expect(sorted(freeVariables(MathParser.parse('speed*time + total', o)))).toEqual(['speed', 'time', 'total'])
    expect(sorted(freeVariables(MathParser.parse('sin(angle)', o)))).toEqual(['angle'])
    expect(sorted(freeVariables(MathParser.parse('min', o))), 'sin paréntesis, min es una variable').toEqual(['min'])
    expect(toPlain(MathParser.parse('min(a,b)', o))).toBe('min(a, b)')
  })

  // MARK: Ecuaciones

  it('parse equation', () => {
    const a = MathParser.parseEquation('y = 2x+1')
    expect(toPlain(a.lhs)).toBe('y')
    expect(toPlain(a.rhs)).toBe('2x+1')
    const b = MathParser.parseEquation('2x - y + 1 = 0')
    expect(toPlain(b.lhs)).toBe('2x-y+1')
    expect(toPlain(b.rhs)).toBe('0')
    const c = MathParser.parseEquation('(x-2)^2/25 + (y+1)^2/9 == 1')
    expect(toPlain(c.lhs)).toBe('(x-2)^2/25+(y+1)^2/9')
    expect(toPlain(c.rhs)).toBe('1')
    for (const bad of ['x+1', 'x = ', '= 3', 'x = y = 2', 'x <= 3', 'x != 3', '']) {
      expect(() => MathParser.parseEquation(bad), `«${bad}»`).toThrow()
    }
    expect(toPlain(MathParser.parseEquation('f(x)=3').rhs)).toBe('3')
  })

  // MARK: Idempotencia plain → parse → plain

  it('plain → parse → plain is stable', () => {
    const inputs = [
      '1/2x', '2x(x+1)', 'sin x cos x', 'e^-x', '-x^2', '(-x)^2', '2^-3^2', 'sqrt 2 x', 'x²y³', 'a/b/c', 'a/(b/c)', 'a-(b-c)', 'a-(b+c)', '-(a+b)', '-(-x)',
      '2*3*4', '2(3)(4)', 'x!y', '(n+1)!', '3!!', '50%', '2*50%', '30°', 'sin(30°)', '|x|+|y|', '||x|-1|', 'ln|x|', 'log_2 x', 'log(2,8)', 'root(3,8)', 'nCr(5,2)',
      '5/6pi', '1,5x', '0.5x', '1e-3', '2e3x', 'π r²', '1/x^2', 'x^(1/2)', 'x^1/2', '(x+1)^(x-1)', '2^x^y', '-2^x', '(2x)^2', '2x^2', 'x^(-1)', 'x*(-y)', 'x-(-y)', '-x-y',
      '(1/2)x', '1/(2x)', 'a b c', 'mod(7,3)', '7 mod 3', 'x mod (y+1)', 'min(1,2,3)', 'atan2(y,x)', 'sin^2 x + cos^2 x', 'tan⁻¹ x', 'e^2x', '2e^(3x)', 'x_1 + x_2', 'θ²',
      '(a+b)(a-b)', '(a+b)*c', 'a*(b+c)', 'a/(b+c)', '(a+b)/c', '-a/b', 'a/-b', 'a*-b', '2*-3', '1-2-3', '1-(2-3)', '1/2/3', '1/(2/3)', 'x^2^3', '(x^2)^3',
      '-1^2', '(-1)^2', '- -1', 'x--y', 'x+-y', '2sin(x)cos(x)', 'sqrt(sqrt(x))', 'exp(-x^2/2)', '1/sqrt(2pi)', 'x*y*z', 'x(y)(z)', '(x)(y)(z)', '3x/4y', 'ab/cd',
    ]
    const envs = [
      { x: 1.7, y: 2.3, z: 0.9, a: 1.3, b: 2.2, c: 3.1, d: 1.9, n: 4, r: 1.1, θ: 0.4 },
      { x: -0.6, y: 1.2, z: 3.3, a: 2.5, b: -1.5, c: 0.7, d: 4.2, n: 3, r: 2.0, θ: 1.0 },
    ]
    for (const s of inputs) {
      const e1 = P(s)
      const p1 = toPlain(e1)
      let e2
      try {
        e2 = MathParser.parse(p1)
      } catch {
        expect.fail(`«${s}» → «${p1}» no se puede volver a analizar`)
      }
      expect(toPlain(e2), `«${s}» → «${p1}» no es estable`).toBe(p1)
      for (const env of envs) {
        const a = tryEvaluateDouble(e1, env)
        const b = tryEvaluateDouble(e2, env)
        if (a !== null && b !== null) expect(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) || (Number.isNaN(a) && Number.isNaN(b)), `«${s}»: ${a} vs ${b}`).toBe(true)
      }
    }
  })

  // MARK: Entradas hostiles

  it('long inputs are rejected, not hung', () => {
    expect(parseError('1'.repeat(2001))?.kind).toBe('syntax')
    expect(parseError('('.repeat(2000))).not.toBeNull()
    expect(parseError('('.repeat(1000) + 'x' + ')'.repeat(1000))).not.toBeNull()
    expect(parseError('-'.repeat(1999) + 'x')).not.toBeNull()
    expect(parseError(Array(1000).fill('2').join('^'))).not.toBeNull()
    expect(parseError('sin '.repeat(400) + 'x')).not.toBeNull()
    expect(parseError('a'.repeat(2000))).not.toBeNull()
    expect(parseError('|'.repeat(100))).not.toBeNull()
  })

  it('deep but reasonable inputs still work', () => {
    expectClose(num('('.repeat(20) + 'x' + ')'.repeat(20), { x: 3 }), 3)
    expectClose(num(Array(60).fill('1').join('+')), 60)
    expectClose(num(Array(50).fill('x').join('*'), { x: 1 }), 1)
    expectClose(num('sin(cos(tan(sin(cos(tan(0.5))))))'), Math.sin(Math.cos(Math.tan(Math.sin(Math.cos(Math.tan(0.5)))))))
    expectClose(num('2^2^2^2'), 65536)
  })

  it('huge numbers and powers', () => {
    expect(errorOf('10^10^10')?.kind).toBe('overflow')
    expect(errorOf('9^9^9^9')?.kind).toBe('overflow')
    expect(errorOf('171!')?.kind).toBe('overflow')
    expect(errorOf('exp(1000)')?.kind).toBe('overflow')
    expect(errorOf('2^2000')?.kind).toBe('overflow')
    expect(errorOf('10^400')?.kind).toBe('overflow')
    expect(errorOf('9999999999999999999999999'), 'un entero enorme pasa a real sin error').toBeNull()
    expect(errorOf('0.' + '0'.repeat(400) + '1')).toBeNull()
    expect(parseError('1e999')?.kind).toBe('overflow')
    expect(num('1e-300')).not.toBeNull()
    expect(errorOf('1e-300 * 1e-300'), 'el subdesbordamiento a 0 no es un error').toBeNull()
  })

  it('random garbage never crashes or hangs', () => {
    const rng = new DeterministicRNG(20261007)
    const alphabet = Array.from('0123456789+-*/^()[]{}|!%°.,;=<>xyzabcsinlogpie π√∞²³ \u00A0\\$_&~`\'"é😀@#')
    let parsed = 0
    const start = Date.now()
    const env = { x: Q(2), y: Q(3), z: Q(5), a: Q(7), b: Q(1), c: Q(4) }
    for (let k = 0; k < 3000; k++) {
      const n = rng.int(0, 40)
      let s = ''
      for (let i = 0; i < n; i++) s += alphabet[rng.int(0, alphabet.length - 1)]
      let e
      try {
        e = MathParser.parse(s)
      } catch {
        continue
      }
      parsed += 1
      const plain = toPlain(e)
      toLatex(e)
      simplify(e)
      tryEvaluate(e, env)
      // lo que se imprime se vuelve a leer
      let again
      try {
        again = MathParser.parse(plain)
      } catch {
        expect.fail(`«${s}» → «${plain}» no se vuelve a leer`)
      }
      expect(toPlain(again), `«${s}»`).toBe(plain)
    }
    expect(parsed, 'el generador debería producir bastantes expresiones válidas').toBeGreaterThan(30)
    expect(Date.now() - start).toBeLessThan(20_000)
  })

  it('hostile inputs give errors, not stack overflows', () => {
    const texts = [
      '('.repeat(1999),
      '('.repeat(40) + 'x' + ')'.repeat(40),
      'sin '.repeat(300) + 'x',
      '-'.repeat(1500) + 'x',
      Array(100).fill('x').join('+'),
      Array(119).fill('x').join('*'),
    ]
    for (const t of texts) {
      let e
      try {
        e = MathParser.parse(t)
      } catch {
        continue
      }
      toPlain(e)
      toLatex(e)
      simplify(e)
      derivative(e, 'x')
      tryEvaluate(e, { x: MV.int(1) })
      substitute(e, 'x', E.int(2))
    }
  })

  it('smoke: public API end to end', () => {
    const e = MathParser.parse('1/2 + 1/3')
    expectValue(evaluate(e), Q(5, 6))
    expect(toPlain(simplify(e))).toBe('5/6')
  })
})
