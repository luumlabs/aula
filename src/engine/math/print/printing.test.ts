import { describe, expect, it } from 'vitest'
import { E, type Expr } from '../core/expr'
import { MV } from '../core/types'
import { tryEvaluateDouble } from '../eval/evaluate'
import { NumberFormat } from '../format/number-format'
import { MathParser } from '../parse/parser'
import { P, frac, plainOf } from '../test-support.testutil'
import { toLatex } from './latex'
import { toPlain } from './plain'

const tex = (s: string): string => toLatex(P(s))

describe('PrintingTests', () => {
  // MARK: LaTeX mínimo y correcto

  it('latex basics', () => {
    const rows: Array<[string, string]> = [
      ['1/2', '\\frac{1}{2}'], ['-1/2', '-\\frac{1}{2}'], ['x/2', '\\frac{x}{2}'], ['(x+1)/(x-1)', '\\frac{x+1}{x-1}'], ['-(x+1)/2', '-\\frac{x+1}{2}'],
      ['1/2+1/3', '\\frac{1}{2}+\\frac{1}{3}'], ['(3/4)x', '\\frac{3}{4}x'], ['2/3*x', '\\frac{2}{3}x'], ['sqrt(x+1)/2', '\\frac{\\sqrt{x+1}}{2}'],
      ['1-x', '1-x'], ['1-(x-2)', '1-\\left(x-2\\right)'], ['x-(-2)', 'x-\\left(-2\\right)'], ['-x-y', '-x-y'], ['x^2-1', 'x^{2}-1'], ['3x^2+2x+1', '3x^{2}+2x+1'],
      ['2x', '2x'], ['x*2', 'x\\cdot 2'], ['2*3', '2\\cdot 3'], ['2x*3', '2x\\cdot 3'], ['xy', 'xy'], ['2(x+1)', '2\\left(x+1\\right)'], ['(x+y)(x-y)', '\\left(x+y\\right)\\left(x-y\\right)'],
      ['x(x+1)', 'x\\left(x+1\\right)'], ['3.5x', '3.5x'], ['0.001', '0.001'], ['1000000', '1000000'],
    ]
    for (const [i, e] of rows) expect(tex(i), `«${i}»`).toBe(e)
  })

  it('latex powers and roots', () => {
    const rows: Array<[string, string]> = [
      ['x^-1', 'x^{-1}'], ['x^(n+1)', 'x^{n+1}'], ['(x+1)^2', '\\left(x+1\\right)^{2}'], ['(1/2)^2', '\\left(\\frac{1}{2}\\right)^{2}'], ['2^(1/2)', '2^{\\frac{1}{2}}'],
      ['e^x', 'e^{x}'], ['e^(x+1)', 'e^{x+1}'], ['exp(x)', 'e^{x}'], ['exp(x)^2', '\\left(e^{x}\\right)^{2}'], ['(e^x)^2', '\\left(e^{x}\\right)^{2}'],
      ['(-2)^2', '\\left(-2\\right)^{2}'], ['-2^2', '-2^{2}'], ['2^-2', '2^{-2}'], ['x^y^z', 'x^{y^{z}}'], ['(x^y)^z', '\\left(x^{y}\\right)^{z}'], ['(a/b)^2', '\\left(\\frac{a}{b}\\right)^{2}'],
      ['a/b^2', '\\frac{a}{b^{2}}'], ['sqrt(x)', '\\sqrt{x}'], ['sqrt(1/2)', '\\sqrt{\\frac{1}{2}}'], ['sqrt(sqrt(x))', '\\sqrt{\\sqrt{x}}'], ['cbrt(x)', '\\sqrt[3]{x}'],
      ['root(3,x)', '\\sqrt[3]{x}'], ['root(n,x+1)', '\\sqrt[n]{x+1}'], ['sqrt(x)^2', '\\left(\\sqrt{x}\\right)^{2}'], ['abs(x)^2', '\\left|x\\right|^{2}'], ['3sqrt(2)', '3\\sqrt{2}'],
      ['sqrt(x)sqrt(y)', '\\sqrt{x}\\sqrt{y}'], ['pow(2,3)', '2^{3}'],
    ]
    for (const [i, e] of rows) expect(tex(i), `«${i}»`).toBe(e)
  })

  it('latex functions', () => {
    const rows: Array<[string, string]> = [
      ['sin(x)', '\\sin x'], ['sin(2x)', '\\sin\\left(2x\\right)'], ['sin(x)^2', '\\sin^{2} x'], ['sin(2x)^2', '\\sin^{2}\\left(2x\\right)'], ['sin(x^2)', '\\sin\\left(x^{2}\\right)'],
      ['cos(x)^2+sin(x)^2', '\\cos^{2} x+\\sin^{2} x'], ['sin(x)cos(x)', '\\sin\\left(x\\right)\\cos x'], ['2sin(x)cos(x)', '2\\sin\\left(x\\right)\\cos x'], ['tan(x)/x', '\\frac{\\tan x}{x}'],
      ['ln(x)', '\\ln x'], ['ln(x+1)', '\\ln\\left(x+1\\right)'], ['ln|x|', '\\ln\\left|x\\right|'], ['ln(x)/x', '\\frac{\\ln x}{x}'], ['log(x)', '\\log x'], ['log_2(x)', '\\log_{2} x'],
      ['log(x)^2', '\\log^{2} x'], ['asin(x)', '\\arcsin x'], ['acos(x)', '\\arccos x'], ['atan(x)', '\\arctan x'], ['sinh(x)', '\\sinh x'], ['sec(x)', '\\sec x'], ['cot(x)', '\\cot x'],
      ['sin(pi/6)', '\\sin\\left(\\frac{\\pi}{6}\\right)'], ['abs(x)', '\\left|x\\right|'], ['floor(x)', '\\left\\lfloor x\\right\\rfloor'], ['ceil(x/2)', '\\left\\lceil \\frac{x}{2}\\right\\rceil'],
      ['min(x,y)', '\\min\\left(x,y\\right)'], ['max(1,2,3)', '\\max\\left(1,2,3\\right)'], ['gcd(a,b)', '\\gcd\\left(a,b\\right)'], ['round(x,2)', '\\operatorname{round}\\left(x,2\\right)'],
      ['sign(x)', '\\operatorname{sgn}\\left(x\\right)'], ['nCr(n,k)', '\\binom{n}{k}'], ['nPr(n,k)', 'P\\left(n,k\\right)'], ['x mod 2', 'x\\;\\operatorname{mod}\\;2'],
      ['x!', 'x!'], ['(x+1)!', '\\left(x+1\\right)!'], ['fact(5)', '5!'], ['atan2(y,x)', '\\operatorname{atan2}\\left(y,x\\right)'], ['50%', '50\\%'], ['30°', '30^{\\circ}'],
    ]
    for (const [i, e] of rows) expect(tex(i), `«${i}»`).toBe(e)
  })

  it('latex symbols and names', () => {
    const rows: Array<[string, string]> = [
      ['pi/2', '\\frac{\\pi}{2}'], ['2pi', '2\\pi'], ['pi r^2', '\\pi r^{2}'], ['θ', '\\theta'], ['2θ', '2\\theta'], ['α+β', '\\alpha+\\beta'], ['α_1', '\\alpha_{1}'],
      ['v_0', 'v_{0}'], ['x_1+x_2', 'x_{1}+x_{2}'], ['x_max', 'x_{\\mathrm{max}}'], ['inf', '\\infty'], ['-inf', '-\\infty'], ['e', 'e'], ['tau', '\\tau'], ['ω t', '\\omega t'],
    ]
    for (const [i, e] of rows) expect(tex(i), `«${i}»`).toBe(e)
    expect(toLatex(MathParser.parse('total*rate', { wordVariables: true }))).toBe('\\mathrm{total}\\cdot \\mathrm{rate}')
    expect(toLatex(MathParser.parse('2*speed', { wordVariables: true }))).toBe('2\\cdot \\mathrm{speed}')
  })

  it('latex never uses commands the renderers lack', () => {
    const allowed = new Set(['frac', 'sqrt', 'left', 'right', 'cdot', 'pi', 'tau', 'infty', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
      'ln', 'log', 'min', 'max', 'gcd', 'binom', 'operatorname', 'mathrm', 'lfloor', 'rfloor', 'lceil', 'rceil', 'circ', 'times', 'mu', 'Omega', ';', ',',
      'theta', 'alpha', 'beta', 'gamma', 'delta', 'omega', 'lambda', 'phi', 'sigma', 'rho', 'epsilon', 'zeta', 'eta', 'iota', 'kappa', 'nu', 'xi', 'chi', 'psi',
      'upsilon', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'ldots', '%', '{', '}', '|', 'varnothing', 'cup', 'quad'])
    const samples = ['1/2', 'sqrt(x)', 'root(3,x)', 'sin(x)^2', 'x mod 2', 'nCr(5,2)', 'nPr(5,2)', 'floor(x)', 'ceil(x)', 'sign(x)', 'round(x,2)', 'atan2(y,x)', '30°', '50%', 'log_2(x)', 'ln|x|',
      'asec(x)', 'sinh(x)', 'θ+α', 'x_max', 'pi/2', 'inf', 'min(1,2)', 'gcd(1,2)', 'lcm(1,2)', 'exp(x)', 'cbrt(x)', '|x|', 'rad(x)', 'tau']
    for (const s of samples) {
      const t = tex(s)
      for (const m of t.matchAll(/\\([A-Za-z]+|[;,%{}|])/g)) expect(allowed.has(m[1]), `«${s}» → «${t}» usa \\${m[1]}`).toBe(true)
      expect([...t].filter((c) => c === '{').length, `llaves de «${t}»`).toBe([...t].filter((c) => c === '}').length)
      expect(t.split('\\left').length, `left/right de «${t}»`).toBe(t.split('\\right').length)
    }
  })

  it('latex is never empty and handles weird trees', () => {
    const trees: Expr[] = [
      E.num(frac(-3, 4)), E.real(0.1), E.real(-2.5e-9), E.real(1e20), E.neg(E.neg(E.variable('x'))), E.sub(E.int(1), E.neg(E.int(2))),
      E.add(E.variable('x'), E.num(frac(-1))), E.mul(E.num(frac(1, 2)), E.num(frac(1, 3))), E.call('sin', [E.int(1), E.int(2)]), E.call('zzz', [E.int(1)]),
      E.pow(E.unary('factorial', E.variable('n')), E.int(2)), E.unary('degree', E.add(E.variable('x'), E.int(1))), E.constant('inf'),
    ]
    for (const t of trees) {
      expect(toLatex(t)).not.toBe('')
      expect(toPlain(t)).not.toBe('')
    }
    expect(toPlain(E.add(E.variable('x'), E.num(frac(-1))))).toBe('x-1')
    expect(toPlain(E.mul(E.num(frac(1, 2)), E.num(frac(1, 3))))).toBe('0.5(1/3)')
    expect(toPlain(E.neg(E.neg(E.variable('x'))))).toBe('-(-x)')
    expect(tryEvaluateDouble(MathParser.parse(toPlain(E.real(1e20)))), 'los reales enormes se vuelven a leer').toBe(1e20)
  })

  // MARK: Formato plain

  it('plain parenthesization', () => {
    const rows: Array<[string, string]> = [
      ['a/b/c', 'a/b/c'], ['a/(b/c)', 'a/(b/c)'], ['a-(b-c)', 'a-(b-c)'], ['a-(b+c)', 'a-(b+c)'], ['-(a+b)', '-(a+b)'], ['a*(b+c)', 'a*(b+c)'], ['(a+b)*c', '(a+b)*c'],
      ['a/(b+c)', 'a/(b+c)'], ['(a+b)/c', '(a+b)/c'], ['-a/b', '-a/b'], ['a/-b', 'a/(-b)'], ['a*-b', 'a*(-b)'], ['1-2-3', '1-2-3'], ['1-(2-3)', '1-(2-3)'], ['1/(2/3)', '1/(2/3)'],
      ['1/2/3', '1/2/3'], ['(2x)^2', '(2x)^2'], ['2x^2', '2x^2'], ['x^(-1)', 'x^(-1)'], ['x*(-y)', 'x*(-y)'], ['x-(-y)', 'x-(-y)'], ['x+-y', 'x-y'], ['(x+1)^(x-1)', '(x+1)^(x-1)'],
      ['2^x^y', '2^x^y'], ['(2^x)^y', '(2^x)^y'], ['-2^x', '-2^x'], ['a mod b', 'a mod b'], ['x mod (y+1)', 'x mod (y+1)'], ['(a+b) mod c', '(a+b) mod c'], ['-(a mod b)', '-(a mod b)'],
      ['sqrt(x)^2', 'sqrt(x)^2'], ['3!!', '(3!)!'], ['(n+1)!', '(n+1)!'], ['(2n)!', '(2n)!'], ['-x!', '-x!'], ['(-x)!', '(-x)!'], ['-30°', '-30°'], ['(x+1)°', '(x+1)°'],
    ]
    for (const [i, e] of rows) expect(plainOf(i), `«${i}»`).toBe(e)
  })

  it('plain of programmatic numbers', () => {
    expect(toPlain(E.num(frac(3, 4)))).toBe('0.75')
    expect(toPlain(E.num(frac(-3, 4)))).toBe('-0.75')
    expect(toPlain(E.num(frac(1, 3)))).toBe('1/3')
    expect(toPlain(E.mul(E.num(frac(1, 3)), E.variable('x')))).toBe('1/3*x')
    expect(toPlain(E.pow(E.num(frac(1, 3)), E.int(2)))).toBe('(1/3)^2')
    expect(toPlain(E.pow(E.num(frac(1, 2)), E.int(2)))).toBe('0.5^2')
    expect(toPlain(E.real(0.1))).toBe('0.1')
    expect(toPlain(E.real(3))).toBe('3')
    expect(toPlain(E.real(-2.5))).toBe('-2.5')
    expect(toPlain(E.real(Infinity))).toBe('inf')
    expect(toPlain(E.real(1e-7))).toBe('1e-07')
    expect(tryEvaluateDouble(MathParser.parse(toPlain(E.real(1e-7))))).toBe(1e-7)
    expect(toPlain(E.int(-5))).toBe('-5')
    expect(toPlain(E.pow(E.int(-2), E.int(2)))).toBe('(-2)^2')
    expect(toPlain(E.sub(E.variable('x'), E.int(-2)))).toBe('x-(-2)')
    expect(toPlain(E.unary('plus', E.variable('x')))).toBe('x')
  })

  it('description is plain', () => {
    expect(plainOf('1/2x')).toBe('1/(2x)')
    expect(plainOf('sin^2 x')).toBe('sin(x)^2')
  })

  // MARK: Formato de números

  it('NumberFormat.decimal', () => {
    const rows: Array<[number, number | null, boolean, boolean, string]> = [
      [0.5, null, true, false, '0.5'], [0.5, null, true, true, '0,5'], [0.1 + 0.2, null, true, false, '0.3'], [1 / 3, null, true, false, '0.333333333333'], [2 / 3, null, true, false, '0.666666666667'],
      [100, null, true, false, '100'], [-0, null, true, false, '0'], [1234.5678, 2, true, false, '1234.57'], [1234.5678, 2, true, true, '1234,57'], [2.675, 2, true, false, '2.68'],
      [1.005, 2, true, false, '1.01'], [0.125, 2, true, false, '0.13'], [-0.125, 2, true, false, '-0.13'], [2.5, 0, true, false, '3'], [-2.5, 0, true, false, '-3'], [3.14159, 3, true, false, '3.142'],
      [1.5, 3, false, false, '1.500'], [1.5, 3, true, false, '1.5'], [0.001, 2, true, false, '0'], [-0.001, 2, true, false, '0'], [0.0049, 2, false, false, '0.00'], [99.999, 2, true, false, '100'],
      [1e-10, null, true, false, '0.0000000001'], [123456789.123, null, true, false, '123456789.123'], [1e22, null, true, false, '1e22'], [1.5e-15, null, true, false, '1.5e-15'], [5, 2, false, false, '5.00'],
      [0.999, 2, false, false, '1.00'], [12, 1, false, true, '12,0'],
    ]
    for (const [x, places, trim, comma, e] of rows) expect(NumberFormat.decimal(x, places, trim, comma), `decimal(${x}, ${places})`).toBe(e)
    expect(NumberFormat.decimal(NaN)).toBe('indefinido')
    expect(NumberFormat.decimal(Infinity)).toBe('∞')
    expect(NumberFormat.decimal(-Infinity)).toBe('-∞')
  })

  it('NumberFormat.significant', () => {
    const rows: Array<[number, number, string]> = [[1234.5678, 3, '1230'], [1234.5678, 6, '1234.57'], [0.0012345, 3, '0.00123'], [0.5, 3, '0.500'], [100, 3, '100'], [0, 3, '0.00'], [123456, 2, '120000'],
      [9.999, 3, '10.0'], [-0.00456, 2, '-0.0046'], [3, 1, '3'], [2.5, 1, '3'], [0.000999, 2, '0.0010'], [7.0, 4, '7.000']]
    for (const [x, f, e] of rows) expect(NumberFormat.significant(x, f), `significant(${x}, ${f})`).toBe(e)
  })

  it('NumberFormat.scientificTeX', () => {
    const rows: Array<[number, number, string]> = [[32000, 3, '3.2\\times10^{4}'], [0.00045, 2, '4.5\\times10^{-4}'], [6.02e23, 3, '6.02\\times10^{23}'], [1, 3, '1'], [-150, 2, '-1.5\\times10^{2}'],
      [0, 3, '0'], [9999, 2, '1\\times10^{4}'], [123456, 3, '1.23\\times10^{5}'], [0.5, 3, '5\\times10^{-1}'], [10, 3, '1\\times10^{1}'], [3.2, 3, '3.2']]
    for (const [x, f, e] of rows) expect(NumberFormat.scientificTeX(x, f), `sci(${x}, ${f})`).toBe(e)
    expect(NumberFormat.scientificTeX(32000, 3, false)).toBe('3.20\\times10^{4}')
    expect(NumberFormat.scientificTeX(Infinity)).toBe('\\infty')
  })

  it('NumberFormat.texNumber', () => {
    expect(NumberFormat.texNumber(MV.rational(frac(3, 4)))).toBe('\\frac{3}{4}')
    expect(NumberFormat.texNumber(MV.rational(frac(-3, 4)))).toBe('-\\frac{3}{4}')
    expect(NumberFormat.texNumber(MV.rational(frac(5)))).toBe('5')
    expect(NumberFormat.texNumber(MV.real(0.7071067811865476))).toBe('0.707106781187')
    expect(NumberFormat.texNumber(MV.real(2))).toBe('2')
    expect(NumberFormat.texNumber(MV.real(1.5e12))).toBe('1.5\\times10^{12}')
    expect(NumberFormat.texNumber(MV.real(0.00002))).toBe('2\\times10^{-5}')
    expect(NumberFormat.texNumber(MV.real(-0.5))).toBe('-0.5')
    expect(NumberFormat.texNumber(MV.real(Infinity))).toBe('\\infty')
    expect(NumberFormat.texNumber(MV.real(0))).toBe('0')
  })

  it('NumberFormat.plain value', () => {
    expect(NumberFormat.plain(MV.rational(frac(3, 4)))).toBe('0.75')
    expect(NumberFormat.plain(MV.rational(frac(1, 3)))).toBe('1/3')
    expect(NumberFormat.plain(MV.rational(frac(-7)))).toBe('-7')
    expect(NumberFormat.plain(MV.rational(frac(3, 4)), true)).toBe('0,75')
    expect(NumberFormat.plain(MV.real(0.5))).toBe('0.5')
    expect(NumberFormat.plain(MV.real(Math.sqrt(2)))).toBe('1.41421356237')
  })
})
