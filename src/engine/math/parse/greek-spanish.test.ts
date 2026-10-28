import { describe, expect, it } from 'vitest'
import { E, exprEquals, freeVariables } from '../core/expr'
import { MV } from '../core/types'
import { AnswerChecker } from '../check/answer-checker'
import { MathEquivalence } from '../check/equivalence'
import { evaluate, evaluateDouble } from '../eval/evaluate'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { TemplateEngine } from '../template/engine'
import { P, Q, exact, expectClose, expectValue, num, parseError, plainOf } from '../test-support.testutil'
import { MathParser } from './parser'

const vars = (s: Set<string>): string[] => [...s].sort()

describe('GreekAndSpanishTests', () => {
  it('greek names are single symbols', () => {
    const rows: Array<[string, string]> = [
      ['theta', 'θ'], ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'], ['iota', 'ι'], ['kappa', 'κ'],
      ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
      ['varphi', 'φ'], ['vartheta', 'θ'], ['varepsilon', 'ε'],
    ]
    for (const [input, plain] of rows) {
      const e = P(input)
      expect(toPlain(e), `«${input}»`).toBe(plain)
      expect(vars(freeVariables(e)), `«${input}»`).toEqual([plain])
    }
    expect(vars(freeVariables(P('pi')))).toEqual([])
    expectClose(num('pi'), Math.PI)
    expectClose(num('Pi'), Math.PI)
  })

  it('capitalized names use capital letters when they exist', () => {
    const rows: Array<[string, string]> = [
      ['Delta', 'Δ'], ['DELTA', 'Δ'], ['Theta', 'Θ'], ['Omega', 'Ω'], ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Gamma', 'Γ'], ['Lambda', 'Λ'], ['Psi', 'Ψ'], ['Xi', 'Ξ'],
      ['Alpha', 'α'], ['Beta', 'β'], ['Mu', 'μ'], ['Tau', 'τ'], ['Eta', 'η'], ['tHeta', 'θ'],
    ]
    for (const [input, plain] of rows) expect(plainOf(input), `«${input}»`).toBe(plain)
  })

  it('greek names inside words and implicit multiplication', () => {
    const rows: Array<[string, string]> = [
      ['2theta', '2θ'], ['theta^2', 'θ^2'], ['sin(theta)', 'sin(θ)'], ['sin theta', 'sin(θ)'], ['sintheta', 'sin(θ)'],
      ['costheta', 'cos(θ)'], ['sen theta', 'sin(θ)'], ['tg(alpha)', 'tan(α)'], ['cosec theta', 'csc(θ)'],
      ['omega t', 'ω*t'], ['omegat', 'ω*t'], ['sin(omegat + phi)', 'sin(ω*t+φ)'], ['alphabeta', 'α*β'], ['alpha beta', 'α*β'],
      ['2alpha+3beta', '2α+3β'], ['mu N', 'μ*N'], ['muN', 'μ*N'], ['mux', 'μ*x'], ['rho g h', 'ρ*g*h'], ['rhogh', 'ρ*g*h'],
      ['Delta x', 'Δ*x'], ['Deltax', 'Δ*x'], ['deltax', 'δ*x'], ['lambdax', 'λ*x'], ['sigma^2', 'σ^2'], ['theta_1+theta_2', 'θ_1+θ_2'],
      ['theta(t)', 'θ*t'], ['r(theta)', 'r*θ'], ['e^(i theta)', 'e^(i*θ)'], ['2tau', '2τ'], ['betax(2)', 'β*x*2'],
    ]
    for (const [input, plain] of rows) expect(plainOf(input), `«${input}»`).toBe(plain)
  })

  it('ambiguous letter runs and how to avoid them', () => {
    expect(vars(freeVariables(P('mu')))).toEqual(['μ'])
    expect(vars(freeVariables(P('m u')))).toEqual(['m', 'u'])
    expect(vars(freeVariables(P('m*u')))).toEqual(['m', 'u'])
    expect(vars(freeVariables(P('xi')))).toEqual(['ξ'])
    expect(vars(freeVariables(P('x i')))).toEqual(['i', 'x'])
    expect(vars(freeVariables(P('xy')))).toEqual(['x', 'y'])
    expect(vars(freeVariables(P('abc')))).toEqual(['a', 'b', 'c'])
    expect(toPlain(P('pix'))).toBe('pi*x')
    expect(toPlain(P('pit(x)'))).toBe('pi*t*x')
    expect(toPlain(P('ex'))).toBe('e*x')
    expect(vars(freeVariables(P('beta')))).toEqual(['β'])
    expect(vars(freeVariables(P('zeta')))).toEqual(['ζ'])
    expect(vars(freeVariables(P('theta')))).toEqual(['θ'])
    expect(vars(freeVariables(P('epsilon')))).toEqual(['ε'])
    expect(vars(freeVariables(P('upsilon')))).toEqual(['υ'])
    expect(parseError('area(x)')?.kind).toBe('unknownFunction')
    expect(parseError('theta(t)')).toBeNull()
  })

  it('unicode name and TeX are the same variable', () => {
    for (const spelling of ['theta', 'θ', '\\theta', 'theta']) expect(exprEquals(P('sin(' + spelling + ')'), P('sin(θ)')), spelling).toBe(true)
    expect(exprEquals(P('\\Delta x'), P('Delta x'))).toBe(true)
    expect(exprEquals(P('\\alpha\\beta'), P('alphabeta'))).toBe(true)
    expect(exprEquals(P('τ'), P('tau'))).toBe(true)
    expect(MathEquivalence.equivalent(P('2sin(theta)cos(theta)'), P('sin(2θ)'))).toBe(true)
  })

  it('greek latex and plain round trip', () => {
    expect(toLatex(P('theta^2 + 2alpha'))).toBe('\\theta^{2}+2\\alpha')
    expect(toLatex(P('Delta x'))).toBe('\\Delta x')
    expect(toLatex(P('omega_0 t'))).toBe('\\omega_{0}t')
    for (const s of ['theta', '2theta+1', 'sin(omega t)', 'Delta x/Delta t', 'mu N', 'theta_1^2']) {
      const once = toPlain(P(s))
      expect(toPlain(P(once)), `«${s}» → «${once}»`).toBe(once)
    }
    expect(toLatex(E.variable('theta'))).toBe('\\theta')
    expect(toLatex(E.variable('Delta_x'))).toBe('\\Delta_{x}')
  })

  it('values can be given with either name', () => {
    const e = P('2theta')
    expectValue(evaluate(e, { θ: MV.int(3) }), Q(6))
    expectValue(evaluate(e, { theta: MV.int(3) }), Q(6), 'θ también se busca como «theta»')
    expect(evaluateDouble(e, { theta: 1.5 })).toBe(3)
    expect(evaluateDouble(P('theta_1'), { theta_1: 2 })).toBe(2)
    expect(evaluateDouble(E.variable('theta'), { θ: 4 }), 'y al revés').toBe(4)
    expect(() => evaluate(e, { x: MV.int(1) })).toThrow()
    expectValue(evaluate(P('sin(theta*pi)'), { theta: Q(1, 6) }), Q(1, 2))
  })

  it('canonical variable name', () => {
    const rows: Array<[string, string]> = [
      ['theta', 'θ'], ['Theta', 'Θ'], ['Delta', 'Δ'], ['alpha', 'α'], ['Alpha', 'α'], ['tau', 'τ'], ['theta_1', 'θ_1'],
      ['Delta_x', 'Δ_x'], [' omega ', 'ω'], ['x', 'x'], ['v_0', 'v_0'], ['total', 'total'], ['θ', 'θ'], ['pi', 'pi'],
    ]
    for (const [input, expected] of rows) expect(MathParser.canonicalVariableName(input), `«${input}»`).toBe(expected)
    const spec = { expected: '2sin(theta)', variables: ['theta'] }
    expect(AnswerChecker.checkExpression('2sin(θ)', spec).status).toBe('correct')
    expect(AnswerChecker.checkExpression('2 sen theta', spec).status).toBe('correct')
    expect(MathEquivalence.equivalent(P('sin(2theta)'), P('2sin(θ)cos(θ)'), { variables: ['theta'] })).toBe(true)
    expect(AnswerChecker.checkEquation('y = 2theta', 'y = 2θ', ['theta', 'y']).status).toBe('correct')
    const declared = new Set(['x', 'theta'].map((v) => MathParser.canonicalVariableName(v)))
    expect([...freeVariables(P('x*sin(theta)'))].every((v) => declared.has(v))).toBe(true)
  })

  it('other parse modes also recognize greek words', () => {
    expect(vars(freeVariables(MathParser.parse('theta*omega', { implicitMultiplication: false })))).toEqual(['θ', 'ω'])
    expect(vars(freeVariables(MathParser.parse('theta + speed', { wordVariables: true })))).toEqual(['speed', 'θ'])
    expect(vars(freeVariables(MathParser.parse('alphabet', { wordVariables: true }))), 'solo palabras completas').toEqual(['alphabet'])
  })

  // MARK: Nombres en español

  it('spanish function names', () => {
    const rows: Array<[string, string]> = [
      ['sen(x)', 'sin(x)'], ['sen x', 'sin(x)'], ['senx', 'sin(x)'], ['SEN(x)', 'sin(x)'], ['tg(x)', 'tan(x)'], ['tgx', 'tan(x)'],
      ['arcsen(x)', 'asin(x)'], ['arcsen x', 'asin(x)'], ['cosec(x)', 'csc(x)'], ['cosec x', 'csc(x)'], ['arctg(x)', 'atan(x)'],
      ['cotg(x)', 'cot(x)'], ['senh(x)', 'sinh(x)'], ['arcoseno(x)', 'asin(x)'], ['arcocoseno(x)', 'acos(x)'], ['arcotangente(x)', 'atan(x)'],
      ['raíz(x)', 'sqrt(x)'], ['techo(x)', 'ceil(x)'], ['suelo(x)', 'floor(x)'], ['signo(x)', 'sign(x)'], ['maximo(1,2)', 'max(1, 2)'],
      ['minimo(1,2)', 'min(1, 2)'], ['redondeo(x)', 'round(x)'], ['mcd(4,6)', 'gcd(4, 6)'], ['mcm(4,6)', 'lcm(4, 6)'],
      ['sen^2 x + cos^2 x', 'sin(x)^2+cos(x)^2'], ['sen^-1(x)', 'asin(x)'], ['tg(pi/4)', 'tan(pi/4)'],
    ]
    for (const [input, plain] of rows) expect(plainOf(input), `«${input}»`).toBe(plain)
    expectValue(exact('sen(pi/6)'), Q(1, 2))
    expectValue(exact('tg(45°)'), Q(1))
    expectValue(exact('cosec(pi/2)'), Q(1))
  })

  it('arc separated from the trig name', () => {
    const rows: Array<[string, string]> = [
      ['arc sen(x)', 'asin(x)'], ['arc sen x', 'asin(x)'], ['arc sin(x)', 'asin(x)'], ['arc tan(1)', 'atan(1)'], ['arc cos(0)', 'acos(0)'],
      ['arc tg x', 'atan(x)'], ['2 arc sen(x)', '2asin(x)'], ['arc', 'a*r*c'], ['arc x', 'a*r*c*x'],
    ]
    for (const [input, plain] of rows) expect(plainOf(input), `«${input}»`).toBe(plain)
    expectClose(num('arc sen(1/2)'), Math.PI / 6)
  })

  // MARK: Regresiones

  it('decimal logarithm base', () => {
    expect(plainOf('log_0.5(4)'), 'antes se leía log(0, 0.5·4)').toBe('log(0.5, 4)')
    expectValue(exact('log_0.5(4)'), Q(-2))
    expectValue(exact('log_1,5(2.25)'), Q(2))
    expectValue(exact('log_{0.5}(4)'), Q(-2))
    expect(parseError('x_1.5'), 'en las variables el subíndice no lleva decimales').not.toBeNull()
  })

  it('digit right after a variable suggests a subscript', () => {
    const e = parseError('x1')
    expect(e?.position).toBe(1)
    expect(e?.message).toContain('x_1')
    expect(e?.message).toContain('x*1')
    expect(parseError('theta1')?.message).toContain('theta_1')
    expect(parseError('2 3')?.message ?? 'subíndice', 'dos números no son un subíndice').not.toContain('subíndice')
    expect(parseError("f'(x)")?.message).toContain('apóstrofo')
  })

  it('templates accept greek variable names', () => {
    const ctx = TemplateEngine.sample([
      { name: 'theta', kind: { type: 'int', min: 30, max: 30, exclude: [] } },
      { name: 'tau', kind: { type: 'int', min: 2, max: 2, exclude: [] } },
    ], ['theta > tau'], 1)
    expectValue(TemplateEngine.evaluate('theta + tau', ctx), Q(32))
    expectValue(TemplateEngine.evaluate('θ*2', ctx), Q(60), 'el símbolo también encuentra la variable «theta»')
    expect(TemplateEngine.render('{{theta}}° y {{str:θ}} · {{tex:sin(theta*x)}}', ctx)).toBe('30° y 30 · \\sin\\left(30x\\right)')
  })
})
