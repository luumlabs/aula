import { describe, expect, it } from 'vitest'
import type { AngleMode } from '../core/types'
import { P } from '../test-support.testutil'
import { EquivalenceEngine, MathEquivalence } from './equivalence'

type Domain = [number, number]

const eq = (a: string, b: string, domain: Domain = [-6, 6], angle: AngleMode = 'radians', vars: string[] | null = null): boolean =>
  MathEquivalence.equivalent(P(a), P(b), { variables: vars, domain, angle })

function assertEquivalent(pairs: Array<[string, string]>, domain: Domain = [-6, 6], angle: AngleMode = 'radians'): void {
  for (const [a, b] of pairs) {
    expect(eq(a, b, domain, angle), `«${a}» debería ser equivalente a «${b}»`).toBe(true)
    expect(eq(b, a, domain, angle), `simetría: «${b}» ≡ «${a}»`).toBe(true)
  }
}

function assertDifferent(pairs: Array<[string, string]>, domain: Domain = [-6, 6], angle: AngleMode = 'radians'): void {
  for (const [a, b] of pairs) {
    expect(eq(a, b, domain, angle), `«${a}» NO debería ser equivalente a «${b}»`).toBe(false)
    expect(eq(b, a, domain, angle), `simetría: «${b}» ≢ «${a}»`).toBe(false)
  }
}

describe('EquivalenceTests', () => {
  // MARK: Identidades trigonométricas

  it('trig identities', () => {
    assertEquivalent([
      ['sin(x)^2+cos(x)^2', '1'], ['1+tan(x)^2', 'sec(x)^2'], ['1+cot(x)^2', 'csc(x)^2'], ['sin(2x)', '2sin(x)cos(x)'], ['cos(2x)', 'cos(x)^2-sin(x)^2'], ['cos(2x)', '1-2sin(x)^2'],
      ['cos(2x)', '2cos(x)^2-1'], ['tan(x)', 'sin(x)/cos(x)'], ['sec(x)', '1/cos(x)'], ['csc(x)', '1/sin(x)'], ['cot(x)', 'cos(x)/sin(x)'], ['cot(x)', '1/tan(x)'], ['sin(x+pi/2)', 'cos(x)'],
      ['cos(x-pi/2)', 'sin(x)'], ['sin(pi-x)', 'sin(x)'], ['cos(pi-x)', '-cos(x)'], ['sin(-x)', '-sin(x)'], ['cos(-x)', 'cos(x)'], ['tan(-x)', '-tan(x)'], ['sin(x+2pi)', 'sin(x)'],
      ['tan(x+pi)', 'tan(x)'], ['sin(3x)', '3sin(x)-4sin(x)^3'], ['cos(3x)', '4cos(x)^3-3cos(x)'], ['tan(2x)', '2tan(x)/(1-tan(x)^2)'], ['sin(x)^2', '(1-cos(2x))/2'],
      ['cos(x)^2', '(1+cos(2x))/2'], ['sin(x)cos(x)', 'sin(2x)/2'], ['(sin(x)+cos(x))^2', '1+sin(2x)'], ['sin(x)^4-cos(x)^4', 'sin(x)^2-cos(x)^2'], ['1/(1+tan(x)^2)', 'cos(x)^2'],
      ['sec(x)^2-tan(x)^2', '1'], ['sin(x)/(1+cos(x))', '(1-cos(x))/sin(x)'], ['asin(sin(x))', 'asin(sin(x))'], ['sinh(x)', '(e^x-e^-x)/2'], ['cosh(x)^2-sinh(x)^2', '1'],
    ])
  })

  it('trig identities in two variables', () => {
    assertEquivalent([
      ['sin(x+y)', 'sin(x)cos(y)+cos(x)sin(y)'], ['cos(x+y)', 'cos(x)cos(y)-sin(x)sin(y)'], ['sin(x-y)', 'sin(x)cos(y)-cos(x)sin(y)'], ['tan(x+y)', '(tan(x)+tan(y))/(1-tan(x)tan(y))'],
      ['sin(x)+sin(y)', '2sin((x+y)/2)cos((x-y)/2)'], ['cos(x)-cos(y)', '-2sin((x+y)/2)sin((x-y)/2)'], ['sin(x)sin(y)', '(cos(x-y)-cos(x+y))/2'],
    ])
  })

  it('trig non-identities', () => {
    assertDifferent([
      ['sin(2x)', '2sin(x)'], ['cos(2x)', '2cos(x)'], ['sin(x+y)', 'sin(x)+sin(y)'], ['sin(x)^2', 'sin(x^2)'], ['tan(x)', 'sin(x)'], ['sec(x)', 'cos(x)'], ['sin(x)^2+cos(x)^2', '2'],
      ['cos(2x)', '1-sin(x)^2'], ['sin(x+pi)', 'sin(x)'], ['cos(x+pi/2)', 'sin(x)'], ['1+tan(x)^2', 'csc(x)^2'], ['sin(x)', 'cos(x)'], ['tan(x/2)', 'tan(x)/2'],
    ])
  })

  // MARK: Álgebra

  it('expansion and factoring', () => {
    assertEquivalent([
      ['(x+1)^2', 'x^2+2x+1'], ['(x-1)(x+1)', 'x^2-1'], ['x^3-1', '(x-1)(x^2+x+1)'], ['x^3+8', '(x+2)(x^2-2x+4)'], ['2(x+3)', '2x+6'], ['(x+2)(x-3)', 'x^2-x-6'],
      ['(2x-1)^2', '4x^2-4x+1'], ['x^4-1', '(x^2+1)(x+1)(x-1)'], ['(x+1)^3', 'x^3+3x^2+3x+1'], ['-(x-3)', '3-x'], ['x(x+1)(x+2)', 'x^3+3x^2+2x'], ['(x^2-4)/2', 'x^2/2-2'],
      ['3(x+1)-2(x-1)', 'x+5'], ['(x+1)/2+(x-1)/3', '(5x+1)/6'], ['1/x+1/2', '(2+x)/(2x)'], ['(x^2+2x+1)/(x+1)', 'x+1'], ['x/(x+1)+1/(x+1)', '1'], ['(1/2)x+(1/3)x', '(5/6)x'],
      ['x^2*x^3', 'x^5'], ['(x^2)^3', 'x^6'], ['x^5/x^2', 'x^3'], ['(2x)^3', '8x^3'], ['abs(x)^2', 'x^2'], ['sqrt(x^2)', 'abs(x)'], ['x*abs(x)', 'x*sqrt(x^2)'],
    ])
  })

  it('multivariable algebra', () => {
    assertEquivalent([
      ['(x+y)^2', 'x^2+2xy+y^2'], ['(x-y)(x+y)', 'x^2-y^2'], ['x*y', 'y*x'], ['(x+y)^3', 'x^3+3x^2*y+3x*y^2+y^3'], ['(x+y+z)^2', 'x^2+y^2+z^2+2xy+2xz+2yz'], ['x/y+y/x', '(x^2+y^2)/(xy)'],
      ['(a+b)^2-(a-b)^2', '4ab'], ['1/x+1/y', '(x+y)/(x*y)'],
    ])
    assertDifferent([['(x+y)^2', 'x^2+y^2'], ['x-y', 'y-x'], ['x/y', 'y/x'], ['(x+y)^2', 'x^2+2xy+y^2+0.001']])
  })

  it('algebra non-equivalences', () => {
    assertDifferent([
      ['(x+1)^2', 'x^2+1'], ['(x+1)^2', 'x^2+2x'], ['x^2', '2x'], ['x+1', 'x-1'], ['x', '-x'], ['1/x', 'x'], ['x^3', 'x^2'], ['2x+1', '2x+1.001'], ['(x-1)(x+1)', 'x^2+1'], ['sqrt(x^2)', 'x'],
      ['x/2', '2/x'], ['x^2-4', '(x-2)^2'], ['x*abs(x)', 'x^2'], ['abs(x)', 'x'], ['x/(x+1)', '1/(x+1)'], ['1/(x+1)+1/(x-1)', '2/(x^2-1)'],
    ])
  })

  // MARK: Singularidades removibles y dominios

  it('removable singularities are equivalent', () => {
    assertEquivalent([['(x^2-1)/(x-1)', 'x+1'], ['(x^2-4)/(x+2)', 'x-2'], ['x/x', '1'], ['x^2/x', 'x'], ['(x^2-9)/(x-3)', 'x+3'], ['(x^3-1)/(x-1)', 'x^2+x+1'], ['x*(x+1)/(x+1)', 'x'],
      ['(x-2)/(x^2-4)', '1/(x+2)'], ['sin(x)^2/sin(x)', 'sin(x)'], ['(1-cos(x)^2)/sin(x)', 'sin(x)']])
  })

  it('different domains are not equivalent', () => {
    assertDifferent([
      ['ln(x^2)', '2*ln(x)'], ['ln(x)+ln(x+1)', 'ln(x*(x+1))'], ['sqrt(x)', 'sqrt(x)*1+abs(x)*0+sqrt(-x)*0'], ['sqrt(x)*sqrt(x)', 'x'], ['sqrt(x^2)', 'x'], ['ln(x)', 'ln(-x)'],
      ['sqrt(x)', 'abs(x)'], ['sqrt(x-1)', 'sqrt(1-x)'], ['log(x)+log(y)', 'log(x*y)'], ['asin(x)', 'asin(x)+sqrt(x-10)*0'],
    ])
  })

  it('restricting the domain makes log rules valid', () => {
    assertEquivalent([['ln(x^2)', '2*ln(x)'], ['ln(x)+ln(x+1)', 'ln(x*(x+1))'], ['sqrt(x)*sqrt(x)', 'x'], ['sqrt(x^2)', 'x'], ['log(x)+log(y)', 'log(x*y)'], ['ln(x/y)', 'ln(x)-ln(y)']], [0.2, 6])
    expect(MathEquivalence.equivalent(P('x*abs(x)'), P('x^2'), { domain: [0.1, 5] })).toBe(true)
    expect(MathEquivalence.equivalent(P('x*abs(x)'), P('x^2'), { domain: [-5, 5] })).toBe(false)
  })

  it('structurally equal expressions are equivalent even if never defined', () => {
    expect(eq('sqrt(-1-x^2)', 'sqrt(-1-x^2)')).toBe(true)
    expect(eq('sqrt(-1-x^2)', 'sqrt(-2-x^2)'), 'nunca definidas: no hay puntos válidos').toBe(false)
    expect(eq('ln(-1-x^2)', 'ln(-x^2-1)+0'), 'dominio vacío').toBe(false)
  })

  it('restricted domains need adaptive sampling', () => {
    expect(eq('ln(x-5.9)', 'ln(x-5.9)+0*x')).toBe(true)
    expect(eq('sqrt(x-5.9)^2', 'sqrt(x-5.9)*sqrt(x-5.9)')).toBe(true)
    expect(eq('sqrt(x-5.9)^2', 'x-5.9'), 'dominios distintos').toBe(false)
    expect(eq('sqrt(x-5.9)', 'sqrt(x-5.9)+0.001')).toBe(false)
    expect(eq('asin(x/6)', 'asin(x/6)+sin(x)^2+cos(x)^2-1')).toBe(true)
  })

  // MARK: Sin variables y números

  it('numeric constant expressions', () => {
    assertEquivalent([['sqrt(2)/2', '1/sqrt(2)'], ['0.5', '1/2'], ['sin(pi/6)', '1/2'], ['2^10', '1024'], ['sqrt(8)', '2sqrt(2)'], ['sqrt(3)^2', '3'], ['e^0', '1'], ['log(1000)', '3'],
      ['cos(pi/4)', 'sqrt(2)/2'], ['tan(pi/4)', '1'], ['ln(e^3)', '3'], ['1/3+1/6', '1/2'], ['0.1+0.2', '0.3'], ['(1+sqrt(5))/2', '1+1/((1+sqrt(5))/2)'], ['2pi', '360°']])
    assertDifferent([['pi', '3.14159'], ['1/3', '0.333'], ['sqrt(2)', '1.4142'], ['e', '2.718'], ['sin(1)', '0.84'], ['sqrt(-1)', 'sqrt(-4)'], ['2', '3']])
    expect(eq('1/3', '0.3333333333'), 'diferencia de 3e-11: dentro de la tolerancia por defecto').toBe(true)
    expect(MathEquivalence.equivalent(P('1/3'), P('0.3333333333'), { relTol: 1e-15, absTol: 1e-15 })).toBe(false)
    expect(MathEquivalence.equivalent(P('pi'), P('3.14159'), { relTol: 1e-5, absTol: 1e-5 })).toBe(true)
  })

  it('variables parameter', () => {
    expect(MathEquivalence.equivalent(P('a*x+b'), P('b+a*x'), { variables: ['x', 'a', 'b'] })).toBe(true)
    expect(MathEquivalence.equivalent(P('a*x'), P('x'), { variables: ['x'] }), 'falta el valor de a').toBe(false)
    expect(MathEquivalence.equivalent(P('x+0*y'), P('x')), 'y sobra pero no influye').toBe(true)
  })

  it('angle mode parameter', () => {
    expect(MathEquivalence.equivalent(P('sin(x)'), P('sin(x°)'), { angle: 'degrees' })).toBe(true)
    expect(MathEquivalence.equivalent(P('sin(x)'), P('sin(x°)'), { angle: 'radians' })).toBe(false)
    expect(MathEquivalence.equivalent(P('sin(2x)'), P('2sin(x)cos(x)'), { angle: 'degrees' })).toBe(true)
    expect(MathEquivalence.equivalent(P('sin(x)^2+cos(x)^2'), P('1'), { angle: 'degrees' })).toBe(true)
  })

  it('integer-only functions', () => {
    assertEquivalent([['n!/(n-1)!', 'n'], ['fact(n+1)', '(n+1)*fact(n)'], ['nCr(n,2)', 'n*(n-1)/2'], ['nPr(n,2)', 'n*(n-1)'], ['nCr(n,1)', 'n'], ['gcd(n,n)', 'abs(n)']])
    assertDifferent([['n!', 'n^2'], ['nCr(n,2)', 'n*(n+1)/2']])
  })

  // MARK: Robustez y rendimiento

  it('numerical noise and cancellation', () => {
    assertEquivalent([['(x+1)^10', 'x^10+10x^9+45x^8+120x^7+210x^6+252x^5+210x^4+120x^3+45x^2+10x+1'], ['sqrt(x^2+1)-x', '1/(sqrt(x^2+1)+x)'], ['exp(x)-1', 'exp(x)-1'],
      ['(x^2+x)^2-x^4', '2x^3+x^2'], ['log(10^x)', 'x'], ['e^(ln(2)*x)', '2^x']])
  })

  it('samples parameter and performance', () => {
    const start = Date.now()
    for (let i = 0; i < 20; i++) expect(MathEquivalence.equivalent(P('sin(x)^2+cos(x)^2'), P('1'), { samples: 200 })).toBe(true)
    expect(MathEquivalence.equivalent(P('2x'), P('x+x'), { samples: 1 })).toBe(true)
    expect(MathEquivalence.equivalent(P('x'), P('x+0.1'), { samples: 1 })).toBe(false)
    expect(Date.now() - start).toBeLessThan(5000)
  })

  it('engine diagnostic helpers', () => {
    const pairs: Array<[number, number]> = [[2, -2], [3, -3], [-1.5, 1.5], [0.5, -0.5]]
    expect(EquivalenceEngine.holds(pairs, (x) => -x)).toBe(true)
    expect(EquivalenceEngine.holds(pairs, (x) => x)).toBe(false)
    expect(Math.abs((EquivalenceEngine.constantRatio(pairs) ?? 0) + 1)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs((EquivalenceEngine.constantDifference([[1, 3], [2, 4], [5, 7]]) ?? 0) - 2)).toBeLessThanOrEqual(1e-12)
    expect(EquivalenceEngine.constantDifference([[1, 3], [2, 5], [5, 7]])).toBeNull()
    expect(EquivalenceEngine.constantRatio([[1, 2], [2, 5], [3, 6]])).toBeNull()
    expect(EquivalenceEngine.holds([[1, 1]], (x) => x), 'con muy pocos pares no se concluye').toBe(false)
  })
})
