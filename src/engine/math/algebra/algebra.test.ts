import { describe, expect, it } from 'vitest'
import { E, exprEquals, freeVariables, substitute } from '../core/expr'
import { MathEquivalence } from '../check/equivalence'
import { tryEvaluate, tryEvaluateDouble } from '../eval/evaluate'
import { Fraction } from '../numbers/fraction'
import { toPlain } from '../print/plain'
import { P, Q, expectFrac, expectValue, frac } from '../test-support.testutil'
import { derivative } from './derivative'
import { Polynomial } from './polynomial'
import { simplify } from './simplify'

const simp = (s: string): string => toPlain(simplify(P(s)))
const deriv = (s: string, v = 'x'): string | null => {
  const d = derivative(P(s), v)
  return d ? toPlain(d) : null
}
const sorted = (s: Set<string>): string[] => [...s].sort()
const coeffs = (p: Polynomial | null): string[] | undefined => p?.coeffs.map((c) => c.plain)

describe('AlgebraTests', () => {
  // MARK: simplify

  it('simplify folds exact constants', () => {
    const rows: Array<[string, string]> = [
      ['1/2+1/3', '5/6'], ['2+3*4', '14'], ['(1+2)*(3+4)', '21'], ['sqrt(16)', '4'], ['sqrt(9/4)', '3/2'], ['2^3', '8'], ['2^-3', '1/8'], ['(-2)^3', '-8'],
      ['5!', '120'], ['3!+2!', '8'], ['50%', '1/2'], ['(1/2)^2', '1/4'], ['sin(0)', '0'], ['cos(0)', '1'], ['sin(pi/6)', '1/2'], ['cos(pi/3)+sin(pi/6)', '1'],
      ['log(1000)', '3'], ['log2(8)', '3'], ['ln(1)', '0'], ['exp(0)', '1'], ['7 mod 3', '1'], ['floor(2.5)', '2'], ['abs(-3)', '3'], ['gcd(12,18)', '6'],
      ['1/3+1/6', '1/2'], ['10/4', '5/2'], ['2/4', '1/2'], ['6/8', '3/4'], ['-3/6', '-1/2'], ['3/9', '1/3'],
    ]
    for (const [i, e] of rows) expect(simp(i), `«${i}»`).toBe(e)
  })

  it('simplify keeps exact symbolic values symbolic', () => {
    const rows: Array<[string, string]> = [
      ['sqrt(2)', 'sqrt(2)'], ['pi', 'pi'], ['sqrt(3)/2', 'sqrt(3)/2'], ['e', 'e'], ['ln(2)', 'ln(2)'], ['sin(1)', 'sin(1)'], ['2pi', '2pi'], ['pi/6', 'pi/6'],
      ['sqrt(2)*sqrt(2)', '2'], ['sqrt(12)', '2sqrt(3)'], ['sqrt(8)', '2sqrt(2)'], ['sqrt(72)', '6sqrt(2)'], ['sqrt(50)', '5sqrt(2)'], ['sqrt(18)', '3sqrt(2)'],
      ['pi/pi', '1'], ['2pi/pi', '2'], ['pi*2/4', 'pi/2'], ['pi*pi', 'pi^2'], ['e^2*e^3', 'e^5'], ['ln(e)', '1'], ['ln(e^x)', 'x'], ['exp(ln(x))', 'x'],
    ]
    for (const [i, e] of rows) expect(simp(i), `«${i}»`).toBe(e)
  })

  it('simplify algebraic identities', () => {
    const rows: Array<[string, string]> = [
      ['x+0', 'x'], ['0+x', 'x'], ['x*1', 'x'], ['1*x', 'x'], ['x*0', '0'], ['x/1', 'x'], ['x^1', 'x'], ['x^0', '1'], ['1^x', '1'], ['--x', 'x'], ['-(-x)', 'x'],
      ['x-(-y)', 'x+y'], ['x+(-y)', 'x-y'], ['x-x', '0'], ['x+x', '2x'], ['2x+3x', '5x'], ['x-2x', '-x'], ['x+1+2', 'x+3'], ['1+x+2', '3+x'], ['5-x', '5-x'], ['3-x-2', '1-x'],
      ['2*3x', '6x'], ['x*2*3', '6x'], ['x*x', 'x^2'], ['x^2*x', 'x^3'], ['x*x^-1', '1'], ['x/x', '1'], ['x*y/x', 'y'], ['x^2/x', 'x'], ['(x+1)^2/(x+1)', 'x+1'],
      ['2x/4', 'x/2'], ['6x/9', '2x/3'], ['x/2*4', '2x'], ['4/(2x)', '2/x'], ['2*(1/x)', '2/x'], ['x^-2', '1/x^2'], ['1/x^-2', 'x^2'], ['(x^2)^3', 'x^6'], ['(x^-1)^-1', 'x'],
      ['(-x)^2', 'x^2'], ['(-x)^3', '-x^3'], ['(2x)^2', '4x^2'], ['(x/2)^2', 'x^2/4'], ['0.5x+0.25x', '3x/4'], ['x/2+x/2', 'x'], ['x/3+2x/3', 'x'], ['y*x-x*y', '0'],
      ['x*2*x', '2x^2'], ['2*x*3*x', '6x^2'], ['1/2*x*4', '2x'], ['-x*-y', 'x*y'], ['-2x*-3', '6x'], ['x^2+2x+1-x^2', '2x+1'], ['sqrt(x^2)', 'abs(x)'], ['abs(-x)', 'abs(x)'],
      ['abs(abs(x))', 'abs(x)'], ['sin(-x)', '-sin(x)'], ['cos(-x)', 'cos(x)'], ['tan(-x)', '-tan(x)'], ['(x+1)/(x+1)', '1'], ['1/(1/x)', 'x'], ['x*(1/x)', '1'],
      ['sin(x)^2*sin(x)', 'sin(x)^3'], ['x/(2x)', '1/2'], ['(3x)/(6y)', 'x/(2y)'], ['-(x/2)', '-x/2'], ['-(2x/3)', '-2x/3'], ['x^2*y/(x*y^2)', 'x/y'],
    ]
    for (const [i, e] of rows) expect(simp(i), `«${i}»`).toBe(e)
  })

  it('simplify degrees to π multiples', () => {
    const rows: Array<[string, string]> = [['30°', 'pi/6'], ['45°', 'pi/4'], ['90°', 'pi/2'], ['180°', 'pi'], ['360°', '2pi'], ['-30°', '-pi/6'], ['150°', '5pi/6'], ['0°', '0'], ['270°', '3pi/2']]
    for (const [i, e] of rows) expect(simp(i), `«${i}»`).toBe(e)
  })

  it('simplify does not distribute or expand', () => {
    expect(simp('2(x+1)')).toBe('2(x+1)')
    expect(simp('(x+1)(x-1)')).toBe('(x+1)(x-1)')
    expect(simp('(x+1)^2')).toBe('(x+1)^2')
  })

  it('simplify preserves value on many expressions', () => {
    const exprs = ['x+x*2-3x', '(x+1)^2/(x+1)', 'sqrt(x^2)*2', 'x/2+x/3-x/6', '2^x*2^-x', 'sin(x)*sin(x)+cos(x)^2', 'x^3/x', '(2x)^3/(4x)', '1/(x+1)+1/(x+1)', 'x*y*x/y', '(x/y)^2*y^2',
      '-(-(x-1))', '2*3^2*x', 'ln(e^2)*x', 'x-(-x)', 'x^2^2', '(x^2)^2/x^3', 'sqrt(8)*x', '30°+x', '3!*x/2', '0.25*x*4', 'x/0.5', 'x*50%', 'abs(x)*abs(-x)']
    for (const s of exprs) {
      const e = P(s)
      const simplified = simplify(e)
      for (const x of [0.7, 1.3, 2.9, -1.4, 3.3]) {
        const env = { x, y: 1.9 }
        const a = tryEvaluateDouble(e, env)
        if (a === null) continue
        const b = tryEvaluateDouble(simplified, env)
        expect(b, `«${s}» → «${toPlain(simplified)}» ya no se puede evaluar en x=${x}`).not.toBeNull()
        if (b === null) continue
        expect(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)), `«${s}» → «${toPlain(simplified)}»: ${a} vs ${b} en x=${x}`).toBe(true)
      }
    }
  })

  it('simplify is idempotent', () => {
    for (const s of ['x+x*2-3x', 'sqrt(12)*x', '(x+1)^2/(x+1)', 'x/2+x/3', '2*3*x*4', 'x*y/x', '30°', '(2x)^2/(4x)', '1/x+1/x', '-(-x)', '0.5x+0.25x']) {
      const once = simplify(P(s))
      expect(exprEquals(simplify(once), once), `«${s}»`).toBe(true)
    }
  })

  // MARK: Derivadas simbólicas

  it('derivative symbolic forms', () => {
    const rows: Array<[string, string]> = [
      ['5', '0'], ['x', '1'], ['x^2', '2x'], ['x^3', '3x^2'], ['3x^2+2x+1', '6x+2'], ['2x', '2'], ['x^-1', '-1/x^2'], ['1/x', '-1/x^2'], ['x^(1/2)', '0.5*x^(-0.5)'],
      ['sin(x)', 'cos(x)'], ['cos(x)', '-sin(x)'], ['tan(x)', 'sec(x)^2'], ['e^x', 'e^x'], ['exp(x)', 'exp(x)'], ['ln(x)', '1/x'], ['2^x', '2^x*ln(2)'], ['sqrt(x)', '1/(2sqrt(x))'],
      ['x*sin(x)', 'sin(x)+x*cos(x)'], ['sin(2x)', '2cos(2x)'], ['(x^2+1)^3', '6x(x^2+1)^2'], ['x/(x+1)', '1/(x+1)^2'], ['ln(x^2)', '2x/x^2'], ['e^(2x)', '2e^(2x)'],
      ['sin(x)^2', '2sin(x)*cos(x)'], ['x^2*e^x', '2x*e^x+x^2*e^x'], ['1/x^2', '-2/x^3'], ['abs(x)', 'x/abs(x)'], ['x^x', 'x^x*(ln(x)+1)'], ['y', '0'], ['pi*x', 'pi'],
      ['sin(x)+cos(x)', 'cos(x)-sin(x)'], ['atan(x)', '1/(1+x^2)'], ['asin(x)', '1/sqrt(1-x^2)'], ['cosh(x)', 'sinh(x)'], ['sinh(x)', 'cosh(x)'], ['log(x)', '1/(x*ln(10))'],
    ]
    for (const [i, e] of rows) {
      const d = deriv(i)
      expect(d, `«${i}» debería derivarse`).not.toBeNull()
      if (d === null) continue
      expect(MathEquivalence.equivalent(P(d), P(e), { variables: ['x'], domain: [0.2, 3] }), `d/dx «${i}» = «${d}» ≠ «${e}»`).toBe(true)
    }
    expect(deriv('x^3')).toBe('3x^2')
    expect(deriv('3x^2+2x+1')).toBe('6x+2')
    expect(deriv('2x')).toBe('2')
    expect(deriv('sin(x)')).toBe('cos(x)')
    expect(deriv('cos(x)')).toBe('-sin(x)')
    expect(deriv('e^x')).toBe('e^x')
    expect(deriv('1/x')).toBe('-1/x^2')
    expect(deriv('y')).toBe('0')
    expect(deriv('5')).toBe('0')
  })

  it('derivative matches numerical differentiation', () => {
    const exprs = [
      'x^3-2x^2+x-5', 'x^5', '1/x', '1/(x^2+1)', '(x^2+1)/(x-4)', 'sqrt(x^2+1)', 'x*sqrt(x)', 'cbrt(x)', 'root(4,x)', 'x^2*sin(x)', 'sin(x)/x', 'tan(x)', 'sec(x)', 'csc(x)', 'cot(x)',
      'sin(3x)*cos(2x)', 'sin(x)^3', 'cos(x^2)', 'e^(x^2)', 'x*e^(-x)', 'ln(x^2+1)', 'ln(sin(x)+2)', 'log(x^2+1)', 'log2(x+3)', 'log(3,x+3)', '2^x', 'x^x', 'x^(1/3)', '(x+1)^x', '3^(2x)',
      'asin(x/4)', 'acos(x/4)', 'atan(2x)', 'asec(x+4)', 'acot(x)', 'sinh(x)*cosh(x)', 'tanh(x)', 'asinh(x)', 'acosh(x+2)', 'atanh(x/4)', 'abs(x-1)*x', 'atan2(x,3)', 'atan2(2,x)',
      'pow(x,3)', '(x^2+1)^(1/2)', 'e^(sin(x))', 'sin(cos(x))', 'ln(ln(x+3))', 'sqrt(sin(x)+2)', 'x^2/(x+1)^3', 'rad(x)^2', 'deg(x)', 'x%', '(x°)', 'pi*x^2', 'e*x', '2^(x^2)',
    ]
    for (const s of exprs) {
      const e = P(s)
      const d = derivative(e, 'x')
      expect(d, `«${s}» debería tener derivada`).not.toBeNull()
      if (!d) continue
      let checked = 0
      for (const x of [0.3, 0.9, 1.7, 2.4, 3.1]) {
        const h = 1e-6
        const fp = tryEvaluateDouble(e, { x: x + h })
        const fm = tryEvaluateDouble(e, { x: x - h })
        const dv = tryEvaluateDouble(d, { x })
        if (fp === null || fm === null || dv === null) continue
        const numeric = (fp - fm) / (2 * h)
        if (!Number.isFinite(numeric) || !Number.isFinite(dv)) continue
        checked += 1
        expect(Math.abs(numeric - dv) <= 1e-4 * Math.max(1, Math.abs(numeric)), `d/dx «${s}» = «${toPlain(d)}»: ${numeric} vs ${dv} en x=${x}`).toBe(true)
      }
      expect(checked, `«${s}» debería poder comprobarse en al menos 2 puntos`).toBeGreaterThanOrEqual(2)
    }
  })

  it('unsupported derivatives return null', () => {
    for (const s of ['floor(x)', 'ceil(x)', 'round(x)', 'x!', 'nCr(x,2)', 'gcd(x,2)', 'sign(x)', 'x mod 2', 'min(x,1)', 'max(x,2)', 'trunc(x)', 'fact(x)', 'mod(x,3)']) {
      expect(deriv(s), `«${s}»`).toBeNull()
    }
    expect(deriv('floor(2)'), 'sin variable es constante').toBe('0')
    expect(deriv('floor(y)')).toBe('0')
    expect(derivative(P('root(x,8)'), 'x'), 'índice variable').toBeNull()
  })

  it('derivative with respect to other variable', () => {
    expect(deriv('x*y', 'y')).toBe('x')
    expect(deriv('x^2*y^3', 'y')).toBe('3x^2*y^2')
    expect(deriv('sin(t)*t', 't')).not.toBeNull()
    expect(deriv('x^2+y^2', 'z')).toBe('0')
  })

  // MARK: Sustitución y variables libres

  it('substituting', () => {
    expect(toPlain(substitute(P('x^2+x'), 'x', P('y+1')))).toBe('(y+1)^2+y+1')
    expect(toPlain(substitute(P('x*y'), 'x', E.int(3)))).toBe('3y')
    expect(toPlain(simplify(substitute(P('sin(x)'), 'x', P('pi/6'))))).toBe('1/2')
    expect(toPlain(substitute(P('x+1'), 'z', E.int(3)))).toBe('x+1')
    expect(toPlain(substitute(P('x+x'), 'x', P('-x')))).toBe('-x-x')
    expectValue(tryEvaluate(substitute(P('x^2+1'), 'x', E.int(2))), Q(5))
  })

  it('free variables', () => {
    expect(sorted(freeVariables(P('x+y*z')))).toEqual(['x', 'y', 'z'])
    expect(sorted(freeVariables(P('pi*e*inf')))).toEqual([])
    expect(sorted(freeVariables(P('tau*theta'))), 'los nombres griegos son variables (π es la única constante griega)').toEqual(['θ', 'τ'].sort())
    expect(sorted(freeVariables(P('sin(x)^2+cos(t)')))).toEqual(['t', 'x'])
    expect(sorted(freeVariables(P('x_1+x_2')))).toEqual(['x_1', 'x_2'])
    expect(sorted(freeVariables(P('2+3')))).toEqual([])
    expect(sorted(freeVariables(P('log_x(8)')))).toEqual(['x'])
    expect(sorted(freeVariables(P('nCr(n,k)')))).toEqual(['k', 'n'])
  })

  // MARK: Polinomios auxiliares

  it('polynomial extraction and gcd', () => {
    const p = Polynomial.from(P('(x-1)(x+1)'), 'x') as Polynomial
    expect(coeffs(p)).toEqual(['-1', '0', '1'])
    const q = Polynomial.from(P('x-1'), 'x') as Polynomial
    const g = Polynomial.gcd(p, q)
    expect(coeffs(g)).toEqual(['-1', '1'])
    expect(Polynomial.from(P('sin(x)'), 'x')).toBeNull()
    expect(Polynomial.from(P('1/x'), 'x')).toBeNull()
    expect(Polynomial.from(P('x*y'), 'x')).toBeNull()
    expect(Polynomial.from(P('x^0.5'), 'x')).toBeNull()
    expect(coeffs(Polynomial.from(P('x/2+1/2'), 'x'))).toEqual(['1/2', '1/2'])
    const r = Polynomial.from(P('x^3-6x^2+11x-6'), 'x') as Polynomial
    expect(r.hasRationalRoot()).toBe(true)
    expect(Polynomial.from(P('x^2+1'), 'x')?.hasRationalRoot()).toBe(false)
    expect(Polynomial.from(P('x^2-2'), 'x')?.hasRationalRoot()).toBe(false)
    expect(Polynomial.from(P('2x^2-x-1'), 'x')?.hasRationalRoot()).toBe(true)
    expectFrac(Polynomial.from(P('x^2+2x+1'), 'x')?.evaluate(frac(-1)), Fraction.int(0))
    const d = r.divided(q)
    expect(coeffs(d?.quotient ?? null)).toEqual(['6', '-5', '1'])
    expect(d?.remainder.isZero).toBe(true)
    expect(Polynomial.from(P('4x+6'), 'x')?.integerPrimitive()?.content).toBe(2n)
  })

  it('real roots (Sturm) and square-free part', () => {
    const count = (s: string): number | null => (Polynomial.from(P(s), 'x') as Polynomial).realRootCount()
    expect(count('x^2-1')).toBe(2)
    expect(count('x^2+1')).toBe(0)
    expect(count('(x-1)^2')).toBe(1)
    expect(count('x^3-6x^2+11x-6')).toBe(3)
    expect(count('x^3+x')).toBe(1)
    expect(count('5')).toBe(0)
    expect(coeffs((Polynomial.from(P('(x-1)^2*(x+2)'), 'x') as Polynomial).squareFreePart())).toEqual(['-2', '1', '1'])
  })
})
