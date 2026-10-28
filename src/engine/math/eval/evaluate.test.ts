import { describe, expect, it } from 'vitest'
import { E } from '../core/expr'
import { MathError, MV, type MathErrorKind, type MathValue } from '../core/types'
import { P, Q, R, errorOf, exact, expectClose, expectValue, num } from '../test-support.testutil'
import { evaluate, evaluateDouble, tryEvaluate, tryEvaluateDouble } from './evaluate'

const q = Q

describe('EvaluateTests', () => {
  // MARK: Exactitud de racionales

  it('rational arithmetic stays exact', () => {
    const rows: Array<[string, MathValue]> = [
      ['1/2+1/3', q(5, 6)], ['1/2-1/3', q(1, 6)], ['2/3*3/4', q(1, 2)], ['1/2/(1/4)', q(2)], ['0.1+0.2', q(3, 10)], ['0.5*0.5', q(1, 4)], ['1/3*3', q(1)],
      ['1/7+1/13+1/17', q(431, 1547)], ['(1/2)^3', q(1, 8)], ['2^-2', q(1, 4)], ['(-2)^3', q(-8)], ['(-2)^4', q(16)], ['(2/3)^-2', q(9, 4)], ['2^10', q(1024)],
      ['-1/2', q(-1, 2)], ['--1/2', q(1, 2)], ['100%', q(1)], ['25%', q(1, 4)], ['3/4%', q(75)], ['7 mod 3', q(1)], ['mod(5.5,2)', q(3, 2)], ['1.5e3', q(1500)],
      ['12/18', q(2, 3)], ['-12/-18', q(2, 3)], ['0/5', q(0)], ['5*0', q(0)], ['1-1', q(0)], ['(1+2)*(3+4)', q(21)], ['10/4', q(5, 2)], ['2^0', q(1)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
  })

  it('exact roots', () => {
    const rows: Array<[string, MathValue]> = [
      ['sqrt(9/4)', q(3, 2)], ['sqrt(16)', q(4)], ['sqrt(0)', q(0)], ['sqrt(1)', q(1)], ['sqrt(0.25)', q(1, 2)], ['sqrt(2.25)', q(3, 2)], ['4^(1/2)', q(2)],
      ['9^0.5', q(3)], ['8^(1/3)', q(2)], ['8^(2/3)', q(4)], ['(-8)^(1/3)', q(-2)], ['(-8)^(2/3)', q(4)], ['(1/8)^(1/3)', q(1, 2)], ['27^(-1/3)', q(1, 3)],
      ['cbrt(27)', q(3)], ['cbrt(-27)', q(-3)], ['cbrt(1/8)', q(1, 2)], ['root(4,16)', q(2)], ['root(3,-8)', q(-2)], ['root(1,5)', q(5)], ['root(2,49)', q(7)],
      ['sqrt(sqrt(16))', q(2)], ['sqrt(100)*sqrt(4)', q(20)], ['sqrt(1/9)', q(1, 3)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
    for (const s of ['sqrt(2)', 'sqrt(8)', '2^(1/2)', 'sqrt(1/2)', 'cbrt(2)', 'sqrt(2)*sqrt(2)', 'pi', 'e', 'sqrt(3)/2', 'root(3,10)']) {
      const v = exact(s)
      expect(v ? MV.isExact(v) : true, `«${s}» no debería ser exacto`).toBe(false)
    }
    expectClose(MV.double(exact('sqrt(2)*sqrt(2)') as MathValue), 2)
  })

  it('exact logarithms', () => {
    const rows: Array<[string, MathValue]> = [
      ['log(1000)', q(3)], ['log(1)', q(0)], ['log(0.01)', q(-2)], ['log(10)', q(1)], ['log2(8)', q(3)], ['log2(1/4)', q(-2)], ['log_2(1)', q(0)],
      ['log(2,8)', q(3)], ['log(3,81)', q(4)], ['log(4,2)', q(1, 2)], ['log(8,4)', q(2, 3)], ['log(1/2,8)', q(-3)], ['log(10,0.001)', q(-3)], ['ln(1)', q(0)],
      ['log_5(125)', q(3)], ['log(9,3)', q(1, 2)], ['log10(100)', q(2)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
    for (const s of ['log(2)', 'ln(2)', 'log(10,2)']) expect(MV.isExact(exact(s) as MathValue), s).toBe(false)
    expectClose(MV.double(exact('ln(10)') as MathValue), Math.log(10))
    expectClose(MV.double(exact('ln(e)') as MathValue), 1)
    expectClose(MV.double(exact('log(3,10)') as MathValue), Math.log(10) / Math.log(3))
  })

  it('exact elementary values', () => {
    const rows: Array<[string, MathValue]> = [
      ['exp(0)', q(1)], ['e^0', q(1)], ['abs(-3/4)', q(3, 4)], ['abs(5)', q(5)], ['floor(-2.5)', q(-3)], ['ceil(-2.5)', q(-2)], ['floor(2.5)', q(2)], ['ceil(2.1)', q(3)],
      ['round(2.5)', q(3)], ['round(-2.5)', q(-3)], ['round(2.4)', q(2)], ['round(0.5)', q(1)], ['round(2.567,2)', q(257, 100)], ['round(1.005,2)', q(101, 100)],
      ['round(1234.5678,-2)', q(1200)], ['trunc(-2.7)', q(-2)], ['trunc(2.7)', q(2)], ['sign(-5)', q(-1)], ['sign(0)', q(0)], ['sign(3)', q(1)],
      ['min(3,1,2)', q(1)], ['max(3,1,2)', q(3)], ['min(1/2,1/3)', q(1, 3)], ['gcd(12,18)', q(6)], ['gcd(12,18,8)', q(2)], ['lcm(4,6)', q(12)], ['lcm(4,6,10)', q(60)],
      ['gcd(0,5)', q(5)], ['gcd(-12,18)', q(6)], ['lcm(0,5)', q(0)], ['mod(-7,3)', q(2)], ['mod(7,-3)', q(-2)], ['mod(7,3)', q(1)], ['mod(6,3)', q(0)], ['mod(1/2,1/3)', q(1, 6)],
      ['rad(0)', q(0)], ['deg(0)', q(0)], ['pow(2,10)', q(1024)], ['pow(2,-1)', q(1, 2)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
  })

  it('factorial and combinatorics', () => {
    const rows: Array<[string, MathValue]> = [
      ['0!', q(1)], ['1!', q(1)], ['5!', q(120)], ['10!', q(3_628_800)], ['20!', q(2_432_902_008_176_640_000n)], ['fact(6)', q(720)],
      ['nCr(5,2)', q(10)], ['nCr(5,0)', q(1)], ['nCr(5,5)', q(1)], ['nCr(5,6)', q(0)], ['nCr(52,5)', q(2_598_960)], ['nCr(60,30)', q(118_264_581_564_861_424n)],
      ['binom(10,3)', q(120)], ['nPr(10,3)', q(720)], ['nPr(5,5)', q(120)], ['nPr(5,0)', q(1)], ['nPr(3,5)', q(0)], ['nPr(20,20)', q(2_432_902_008_176_640_000n)],
      ['5!/3!', q(20)], ['6!/(2!4!)', q(15)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
    // más allá de Int: pasa a real sin perder la magnitud
    const f21 = exact('21!')
    expect(f21?.kind).toBe('real')
    expectClose(MV.double(f21 as MathValue), 51_090_942_171_709_440_000, 1e-12)
    expectClose(num('25!'), 1.5511210043330986e25, 1e-12)
    expectClose(num('170!'), 7.257415615307994e306, 1e-12)
    expectClose(num('nCr(100,50)'), 1.0089134454556419e29, 1e-12)
  })

  it('large integers degrade to real without error', () => {
    const big = exact('9999999999*9999999999')
    expect(big?.kind).toBe('real')
    expectClose(MV.double(big as MathValue), 9.999999998e19, 1e-12)
    const p = exact('2^100')
    expect(p?.kind).toBe('real')
    expectClose(MV.double(p as MathValue), 1.2676506002282294e30, 1e-12)
    expectValue(exact('2^62'), q(1n << 62n))
    const sum = exact('9223372036854775807+1')
    expect(sum?.kind).toBe('real')
    expectClose(MV.double(sum as MathValue), 9.223372036854775808e18, 1e-12)
    expect(errorOf('9223372036854775807+1')).toBeNull()
  })

  // MARK: Trigonometría exacta en múltiplos de π

  it('exact trig at notable angles', () => {
    const rows: Array<[string, MathValue]> = [
      ['sin(0)', q(0)], ['cos(0)', q(1)], ['tan(0)', q(0)], ['sin(pi/6)', q(1, 2)], ['cos(pi/3)', q(1, 2)], ['sin(pi/2)', q(1)], ['cos(pi/2)', q(0)], ['sin(pi)', q(0)],
      ['cos(pi)', q(-1)], ['tan(pi/4)', q(1)], ['tan(pi)', q(0)], ['sin(3pi/2)', q(-1)], ['cos(2pi)', q(1)], ['sin(2pi)', q(0)], ['sin(7pi/6)', q(-1, 2)],
      ['sin(-pi/6)', q(-1, 2)], ['cos(-pi/3)', q(1, 2)], ['cos(2pi/3)', q(-1, 2)], ['sin(5pi/6)', q(1, 2)], ['sin(11pi/6)', q(-1, 2)], ['cos(4pi/3)', q(-1, 2)],
      ['sec(0)', q(1)], ['sec(pi/3)', q(2)], ['sec(pi)', q(-1)], ['csc(pi/2)', q(1)], ['csc(pi/6)', q(2)], ['csc(7pi/6)', q(-2)], ['cot(pi/4)', q(1)], ['cot(pi/2)', q(0)],
      ['tan(3pi/4)', q(-1)], ['tan(5pi/4)', q(1)], ['sin(pi/6+2pi)', q(1, 2)], ['sin(13pi/6)', q(1, 2)], ['cos(100pi)', q(1)], ['sin(pi*2/3+pi/3)', q(0)],
      ['sin(30°)', q(1, 2)], ['cos(60°)', q(1, 2)], ['tan(45°)', q(1)], ['sin(90°)', q(1)], ['cos(180°)', q(-1)], ['sin(210°)', q(-1, 2)], ['sin(360°)', q(0)],
    ]
    for (const [s, v] of rows) expectValue(exact(s), v, `«${s}»`)
    // La constante τ = 2π solo existe al construir expresiones en código (al escribir, «tau» es la letra τ).
    const tau = E.constant('tau')
    expectValue(evaluate(E.call('sin', [E.div(tau, E.int(12))])), q(1, 2))
    expectValue(evaluate(E.call('cos', [E.div(tau, E.int(6))])), q(1, 2))
  })

  it('irrational trig values are accurate', () => {
    const r2 = Math.sqrt(2) / 2
    const r3 = Math.sqrt(3) / 2
    const rows: Array<[string, number]> = [
      ['sin(pi/4)', r2], ['cos(pi/4)', r2], ['sin(pi/3)', r3], ['cos(pi/6)', r3], ['tan(pi/3)', Math.sqrt(3)], ['tan(pi/6)', 1 / Math.sqrt(3)],
      ['sin(3pi/4)', r2], ['cos(3pi/4)', -r2], ['sin(5pi/4)', -r2], ['sin(2pi/3)', r3], ['cos(5pi/6)', -r3], ['tan(2pi/3)', -Math.sqrt(3)],
      ['sin(1)', Math.sin(1)], ['cos(2)', Math.cos(2)], ['tan(0.5)', Math.tan(0.5)], ['sin(pi/12)', Math.sin(Math.PI / 12)], ['sec(pi/4)', Math.sqrt(2)],
    ]
    for (const [s, v] of rows) expectClose(num(s), v, 1e-14, `«${s}»`)
  })

  it('trig poles are domain errors', () => {
    for (const s of ['tan(pi/2)', 'tan(3pi/2)', 'tan(-pi/2)', 'sec(pi/2)', 'csc(0)', 'csc(pi)', 'cot(0)', 'cot(pi)', 'tan(90°)', 'sec(270°)']) {
      expect(errorOf(s)?.kind, `«${s}»`).toBe('domain')
    }
    expect(errorOf('tan(1.5707)')).toBeNull()
    expect(num('tan(1.5707)')).not.toBeNull()
    expect(num('tan(1.5707963267948966)'), 'cos ≈ 6e-17: se trata como polo').toBeNull()
  })

  it('angle modes', () => {
    const rows: Array<[string, number]> = [
      ['sin(30)', 0.5], ['cos(60)', 0.5], ['sin(90)', 1], ['cos(90)', 0], ['sin(180)', 0], ['cos(180)', -1], ['tan(45)', 1], ['sin(45)', Math.sqrt(2) / 2],
      ['cos(30)', Math.sqrt(3) / 2], ['sin(-30)', -0.5], ['sin(390)', 0.5], ['cos(360)', 1], ['sin(30°)', 0.5], ['sec(60)', 2], ['csc(30)', 2], ['cot(45)', 1],
      ['asin(0.5)', 30], ['acos(0.5)', 60], ['atan(1)', 45], ['asin(1)', 90], ['acos(0)', 90], ['acos(-1)', 180], ['atan2(1,1)', 45], ['atan2(1,-1)', 135], ['acot(1)', 45],
      ['asec(2)', 60], ['acsc(2)', 30], ['sin(sin^-1(0.3))', 0.3], ['30°+30°', 60], ['sin(1)', Math.sin(Math.PI / 180)],
    ]
    for (const [s, v] of rows) expectClose(num(s, {}, 'degrees'), v, 1e-13, `grados: «${s}»`)
    expectValue(exact('sin(30)', {}, 'degrees'), q(1, 2), 'en grados también es exacto')
    expectValue(exact('cos(60)', {}, 'degrees'), q(1, 2))
    expectValue(exact('sin(180)', {}, 'degrees'), q(0))
    expectValue(exact('tan(45)', {}, 'degrees'), q(1))
    expectValue(exact('sin(30°)', {}, 'degrees'), q(1, 2))
    expectValue(exact('30°', {}, 'degrees'), q(30), 'en grados el símbolo no cambia el valor')
    expect(tryEvaluate(P('tan(90)'), {}, 'degrees')).toBeNull()
    expect(tryEvaluate(P('tan(90)'), {}, 'radians')).not.toBeNull()
    const radianRows: Array<[string, number]> = [['asin(0.5)', Math.PI / 6], ['acos(0.5)', Math.PI / 3], ['atan(1)', Math.PI / 4], ['atan2(1,1)', Math.PI / 4], ['30°', Math.PI / 6]]
    for (const [s, v] of radianRows) expectClose(num(s), v, 1e-14, `radianes: «${s}»`)
    expectClose(num('rad(180)'), Math.PI)
    expectClose(num('deg(pi)'), 180)
    expectClose(num('rad(90)', {}, 'degrees'), Math.PI / 2, 1e-14, 'rad() siempre devuelve radianes')
  })

  it('inverse trig domains', () => {
    for (const s of ['asin(1.0001)', 'acos(-2)', 'asin(2)', 'asec(0.5)', 'acsc(0)', 'acosh(0.5)', 'atanh(1)', 'atanh(-1)', 'atanh(2)']) {
      expect(errorOf(s)?.kind, `«${s}»`).toBe('domain')
    }
    expectClose(num('asin(1)'), Math.PI / 2)
    expectClose(num('acos(-1)'), Math.PI)
    expectClose(num('asin(1+1e-14)'), Math.PI / 2, 1e-9, 'el error de redondeo no debe fallar')
    expectClose(num('atan(1000000)'), Math.PI / 2, 1e-6)
    expectClose(num('acot(0)'), Math.PI / 2)
    expectClose(num('atan2(-1,-1)'), (-3 * Math.PI) / 4)
    expectClose(num('atan2(0,-1)'), Math.PI)
  })

  it('hyperbolic', () => {
    expectClose(num('sinh(1)'), Math.sinh(1))
    expectClose(num('cosh(1)'), Math.cosh(1))
    expectClose(num('tanh(0.5)'), Math.tanh(0.5))
    expectClose(num('asinh(1)'), Math.asinh(1))
    expectClose(num('acosh(2)'), Math.acosh(2))
    expectClose(num('atanh(0.5)'), Math.atanh(0.5))
    expectClose(num('cosh(x)^2-sinh(x)^2', { x: 1.3 }), 1)
  })

  // MARK: Dominios

  it('domain errors', () => {
    const rows: Array<[string, MathErrorKind]> = [
      ['1/0', 'domain'], ['0/0', 'domain'], ['1/(2-2)', 'domain'], ['ln(0)', 'domain'], ['ln(-1)', 'domain'], ['log(0)', 'domain'], ['log(-5)', 'domain'], ['sqrt(-1)', 'domain'],
      ['sqrt(-0.0001)', 'domain'], ['(-8)^(1/2)', 'domain'], ['(-1)^0.5', 'domain'], ['(-4)^(1/4)', 'domain'], ['0^0', 'domain'], ['0^-1', 'domain'], ['0^(-1/2)', 'domain'],
      ['(-1)!', 'domain'], ['fact(1.5)', 'domain'], ['fact(-3)', 'domain'], ['nCr(-1,2)', 'domain'], ['nCr(2.5,1)', 'domain'], ['nPr(5,-1)', 'domain'], ['gcd(1.5,2)', 'domain'],
      ['mod(5,0)', 'domain'], ['5 mod 0', 'domain'], ['log(1,5)', 'domain'], ['log(0,5)', 'domain'], ['log(-2,4)', 'domain'], ['log(2,-4)', 'domain'], ['log(2,0)', 'domain'],
      ['root(0,5)', 'domain'], ['root(2,-4)', 'domain'], ['root(4,-16)', 'domain'], ['inf-inf', 'domain'], ['0*inf', 'domain'], ['inf/inf', 'domain'], ['asin(2)', 'domain'],
      ['log2(0)', 'domain'], ['1/0.0', 'domain'], ['tan(pi/2)', 'domain'],
      ['171!', 'overflow'], ['exp(1000)', 'overflow'], ['10^10^10', 'overflow'], ['2^5000', 'overflow'], ['e^1000', 'overflow'], ['sinh(1000)', 'overflow'], ['nCr(2000,1000)', 'overflow'],
      ['x', 'unknownVariable'], ['2x+y', 'unknownVariable'],
    ]
    for (const [s, k] of rows) {
      const e = errorOf(s)
      expect(e?.kind, `«${s}» → ${e?.message ?? 'sin error'}`).toBe(k)
      if (e) expect(e.message).not.toBe('')
    }
  })

  it('infinity arithmetic is allowed when well defined', () => {
    expect(num('inf+1')).toBe(Infinity)
    expect(num('-inf')).toBe(-Infinity)
    expect(num('1/inf')).toBe(0)
    expect(num('inf*2')).toBe(Infinity)
    expect(num('inf*inf')).toBe(Infinity)
    expect(num('min(3,inf)')).toBe(3)
    expect(num('max(3,inf)')).toBe(Infinity)
    expect(num('abs(-inf)')).toBe(Infinity)
  })

  it('zero power conventions', () => {
    expectValue(exact('0^2'), q(0))
    expectValue(exact('0^0.5'), q(0))
    expectValue(exact('x^0', { x: q(7) }), q(1))
    expect(num('0^0')).toBeNull()
    expectValue(exact('1^1000000'), q(1))
    expectValue(exact('(-1)^1000001'), q(-1))
  })

  // MARK: Variables

  it('variables exact and double', () => {
    expectValue(exact('x/3+y', { x: q(1), y: q(1, 2) }), q(5, 6))
    expectValue(exact('2x^2-3x+1', { x: q(1, 2) }), q(0))
    expect(MV.double(exact('x*y', { x: R(0.5), y: q(2) }) as MathValue)).toBe(1)
    expectClose(num('x^2+1', { x: 3 }), 10)
    expectClose(num('sin(x)^2+cos(x)^2', { x: 0.7 }), 1)
    expect(errorOf('x+1')?.kind).toBe('unknownVariable')
    expect(errorOf('x+1')?.message).toContain('«x»')
    expectClose(num('e*x', { x: 2 }), 2 * Math.E)
  })

  it('evaluate agrees with evaluateDouble on many expressions', () => {
    const exprs = ['x^2+3x-1', 'sqrt(x^2+1)', 'sin(x)*cos(x)', 'ln(x^2+1)', 'e^(-x^2)', '(x+1)/(x^2+2)', '2^x', 'x^x', 'abs(x-2)', 'atan(x)*3', 'x!', 'x mod 3', 'floor(x)+ceil(x)',
      'min(x,2)+max(x,1)', 'x^(1/3)', 'log(2,x^2+1)', 'tan(x/3)', 'sinh(x)+cosh(x)', 'round(x*10)/10', 'nCr(x+3,2)', 'sign(x-1.5)', 'cbrt(x-2)', 'root(3,x+1)']
    for (const s of exprs) {
      const e = P(s)
      for (const x of [0, 1, 2, 3, 4, 5, 7]) {
        const d = tryEvaluateDouble(e, { x })
        const v = tryEvaluate(e, { x: R(x) })
        if (d !== null && v !== null) expectClose(MV.double(v), d, 1e-12, `«${s}» en x=${x}`)
        else expect(d === null, `«${s}» en x=${x}: ambos deben fallar o ambos valer`).toBe(v === null)
      }
    }
  })

  // MARK: Expresiones construidas a mano

  it('programmatic expressions', () => {
    expect(() => evaluate(E.call('sin', []))).toThrow()
    expect(() => evaluate(E.call('sin', [E.int(1), E.int(2)]))).toThrow()
    try {
      evaluate(E.call('nope', [E.int(1)]))
      expect.fail('debería fallar')
    } catch (e) {
      expect(e instanceof MathError && e.kind).toBe('unknownFunction')
    }
    expectValue(evaluate(E.call('log2', [E.int(8)])), q(3))
    expectValue(evaluate(E.call('log10', [E.int(1000)])), q(3))
    expectValue(evaluate(E.unary('plus', E.int(3))), q(3))
    expectValue(evaluate(E.binary('mod', E.int(7), E.int(3))), q(1))
    expectValue(evaluate(E.unary('percent', E.int(50))), q(1, 2))
    expectValue(evaluate(E.unary('factorial', E.int(4))), q(24))
    expectValue(evaluate(E.real(0.25)), R(0.25))
    expect(evaluateDouble(E.constant('pi'))).toBe(Math.PI)
  })
})
