import { afterEach, describe, expect, it } from 'vitest'
import { E, type Expr } from '../core/expr'
import { foldDiacritics } from '../core/text'
import { MV, angleModeLenient, type AngleMode } from '../core/types'
import { Exact } from '../eval/exact'
import { tryEvaluateDouble, evaluateDouble } from '../eval/evaluate'
import { NumberFormat } from '../format/number-format'
import { Fraction } from '../numbers/fraction'
import { INT_MAX } from '../numbers/int64'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { DeterministicRNG } from '../random/rng'
import { TemplateEngine } from '../template/engine'
import { makeTemplateContext } from '../template/types'
import { UnitTable } from '../units/unit-table'
import { P, Q, exact, expectValue, frac } from '../test-support.testutil'
import { AnswerChecker } from './answer-checker'
import { MathEquivalence } from './equivalence'
import { ExpressionChecker } from './expression-checker'
import { decodeExpressionSpec, decodeNumericSpec, expressionSpec, type UnitMode } from './specs'
import { ValueMatch } from './value-match'

interface NumOpts {
  angle?: AngleMode
  abs?: number
  rel?: number
  unit?: string | null
  mode?: UnitMode
}

const numeric = (input: string, value: string, o: NumOpts = {}) =>
  AnswerChecker.checkNumeric(input, { value, angle: o.angle ?? 'radians', absTol: o.abs ?? 0, relTol: o.rel ?? 0, unit: o.unit ?? null, unitMode: o.mode ?? 'optional' })

const expression = (input: string, expected: string, variables: string[] | null = null, domain: [number, number] | null = null) =>
  AnswerChecker.checkExpression(input, { expected, variables, ...(domain ? { domainMin: domain[0], domainMax: domain[1] } : {}) })

/** Arreglos de la auditoría «math-chem» (MC-01…MC-24) y PQ-05. */
describe('AuditFixesTests', () => {
  afterEach(() => NumberInput.apply('auto'))

  // MARK: MC-01 · tolerancia relativa

  it('zero never matches a non-zero key', () => {
    for (const wrong of ['0', '3.97e-18', '1e-20', '7.94e-19', '-3.97e-19', '0.0']) expect(numeric(wrong, '3.97e-19').status, `«${wrong}»`).not.toBe('correct')
    expect(numeric('3.97e-19', '3.97e-19').status).toBe('correct')
    expect(numeric('3.970e-19', '3.97e-19').status).toBe('correct')
    expect(numeric('3.9700001e-19', '3.97e-19').status).toBe('correct')
    expect(numeric('3.97*10^-19', '3.97e-19').status).toBe('correct')
    for (const wrong of ['1.7e-10', '1.8e-10', '0']) expect(numeric(wrong, '1.77e-10').status, `«${wrong}»`).not.toBe('correct')
    const zero = numeric('0', '1.77e-10')
    expect(zero.diagnosis.includes('signError'), '«0» no es un error de signo').toBe(false)
    expect(zero.message ?? '').not.toContain('signo')
    expect(zero.diagnosis.includes('rounding'), 'redondear a 0 no es «estar muy cerca»').toBe(false)
    expect(numeric('0', '10^(-9.5)').status).not.toBe('correct')
    expect(numeric('1e-10', '10^(-9.5)').status).not.toBe('correct')
    expect(numeric('3.16227766e-10', '10^(-9.5)').status).toBe('correct')
    expect(numeric('-1.77e-10', '1.77e-10').diagnosis.includes('signError')).toBe(true)
  })

  it('keys that are zero still work', () => {
    expect(numeric('0', '0').status).toBe('correct')
    expect(numeric('sin(pi)', '0').status).toBe('correct')
    expect(numeric('cos(pi/2)', '0').status).toBe('correct')
    expect(numeric('ln(1)', '0').status).toBe('correct')
    expect(numeric('0.0', '0').status).toBe('correct')
    expect(numeric('0.001', '0').status).not.toBe('correct')
    expect(AnswerChecker.checkSet('0, 1', ['0', '1']).status).toBe('correct')
    expect(AnswerChecker.checkPoint('(0, 2)', ['0', '2']).status).toBe('correct')
    expect(AnswerChecker.checkPoint('(sin(pi), 2)', ['0', '2']).status).toBe('correct')
    expect(expression('sin(pi)', '0').status).toBe('correct')
    expect(expression('sin(x)^2+cos(x)^2-1', '0', ['x']).status).toBe('correct')
  })

  it('author tolerances are kept', () => {
    expect(numeric('3.15', '3.14', { abs: 0.01 }).status).toBe('correct')
    expect(numeric('3.2', '3.14', { abs: 0.01 }).status).not.toBe('correct')
    expect(numeric('104', '100', { rel: 0.05 }).status).toBe('correct')
    expect(numeric('106', '100', { rel: 0.05 }).status).not.toBe('correct')
    expect(AnswerChecker.checkPoint('(1.01, -2)', ['1', '-2'], 0.05).status).toBe('correct')
    expect(AnswerChecker.checkPoint('(1.1, -2)', ['1', '-2'], 0.05).status).not.toBe('correct')
  })

  it('tiny values in sets, points, intervals and expressions', () => {
    expect(AnswerChecker.checkSet('0', ['1e-20']).status).not.toBe('correct')
    expect(AnswerChecker.checkSet('0, 2', ['6.63e-34', '2']).status).not.toBe('correct')
    expect(AnswerChecker.checkPoint('(0, 0)', ['3e-7', '0']).status).not.toBe('correct')
    expect(AnswerChecker.checkInterval('(0, 1)', '(1e-20, 1)').status).not.toBe('correct')
    expect(AnswerChecker.checkInterval('(1e-20, 1)', '(1e-20, 1)').status).toBe('correct')
    expect(expression('0', '6.63e-34*3e8/5e-7').status).not.toBe('correct')
    expect(expression('0', '6.63e-34*3e8/5e-7').status, 'tampoco «aproximación»').not.toBe('partial')
    expect(expression('3.978e-19', '6.63e-34*3e8/5e-7').status).toBe('correct')
    expect(expression('0', '6.67e-11*m/r^2', ['m', 'r']).status).not.toBe('correct')
    expect(expression('6.67e-11*m/r', '6.67e-11*m/r^2', ['m', 'r']).status, 'otra expresión diminuta').not.toBe('correct')
    expect(expression('6.67*10^(-11)*m/r^2', '6.67e-11*m/r^2', ['m', 'r']).status).toBe('correct')
    expect(MathEquivalence.equivalent(P('0'), P('6.67e-11*x'))).toBe(false)
    expect(MathEquivalence.equivalent(P('sin(x)^2+cos(x)^2-1'), P('0'))).toBe(true)
    expect(MathEquivalence.equivalent(P('(x+1)^2'), P('x^2+2x+1'))).toBe(true)
  })

  it('one equality for every checker', () => {
    expect(ValueMatch.equal(MV.real(0.7071067), MV.real(Math.sqrt(2) / 2))).toBe(true)
    expect(ValueMatch.equal(MV.int(0), MV.real(6.63e-34))).toBe(false)
    expect(ValueMatch.equal(MV.real(1e-13), MV.int(0))).toBe(true)
    expect(ValueMatch.same(MV.int(0), MV.real(1e-13))).toBe(true)
    expect(ValueMatch.equal(MV.rational(Fraction.parse('0.3333333333333') as Fraction), MV.rational(frac(1, 3)))).toBe(true)
    expect(ValueMatch.equal(MV.rational(Fraction.parse('0.3333') as Fraction), MV.rational(frac(1, 3)))).toBe(false)
  })

  // MARK: MC-02 · grados con «°»

  it('degrees in sets', () => {
    expect(AnswerChecker.checkSet('30°, 150°', ['30', '150']).status).toBe('correct')
    expect(AnswerChecker.checkSet('30, 150', ['30°', '150°']).status).toBe('correct')
    expect(AnswerChecker.checkSet('x = 30° o x = 150°', ['30', '150']).status).toBe('correct')
    expect(AnswerChecker.checkSet('30°, 150°', ['pi/6', '5pi/6']).status, 'en radianes «30°» sigue valiendo π/6').toBe('correct')
    expect(AnswerChecker.checkSet('π/6, 5π/6', ['30°', '150°']).status).toBe('correct')
    expect(AnswerChecker.checkSet('30, 150', ['pi/6', '5pi/6']).status, 'sin «°» no se adivinan grados').not.toBe('correct')
    const half = AnswerChecker.checkSet('30°, 210°', ['30', '150'])
    expect(half.status).toBe('partial')
    expect(half.normalizedInput, 'se ve lo que escribió').toBe('{30°, 210°}')
    expect(AnswerChecker.checkSet('-30°, 30°', ['-30', '30']).status).toBe('correct')
    expect(AnswerChecker.checkSet('30, 150', ['asin(1/2)', '180-asin(1/2)'], false, 'degrees').status).toBe('correct')
  })

  it('degrees in numbers, points and intervals', () => {
    const v = numeric('30°', '30')
    expect(v.status, v.message ?? '').toBe('correct')
    expect(numeric('-45°', '-45').status).toBe('correct')
    expect(numeric('30°', 'pi/6').status).toBe('correct')
    expect(numeric('π/6', '30°').status).toBe('correct')
    expect(numeric('30', '30°').status, 'clave en grados con «°», respuesta sin él').toBe('correct')
    const wrong = numeric('45°', '30')
    expect(wrong.status).toBe('incorrect')
    expect(wrong.diagnosis.includes('radiansVsDegrees'), 'escribió «°»: no usó radianes').toBe(false)
    expect(wrong.message ?? '').not.toContain('radianes')
    expect(numeric('30', 'pi/6').diagnosis.includes('degreesVsRadians')).toBe(true)
    expect(numeric('30', '30', { angle: 'degrees' }).status).toBe('correct')
    expect(AnswerChecker.checkPoint('(30°, 0)', ['30', '0']).status).toBe('correct')
    expect(AnswerChecker.checkPoint('(30, 1/2)', ['30°', 'sin(30°)']).status).toBe('correct')
    expect(AnswerChecker.checkInterval('[0°, 90°)', '[0, 90)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('[0, 90)', '[0°, 90°)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('0° <= x < 90°', '[0, 90)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('[0, 90)', '[0, pi/2)').status).not.toBe('correct')
  })

  it('angle mode is lenient', () => {
    for (const raw of ['deg', 'degree', 'degrees', 'DEG', 'grados', '°', 'Degrees']) expect(angleModeLenient(raw), raw).toBe('degrees')
    for (const raw of ['rad', 'radian', 'radians', 'radianes', '', 'grad', 'lo que sea']) expect(angleModeLenient(raw), raw).toBe('radians')
    expect(decodeNumericSpec(JSON.parse('{"value":"30","angle":"deg"}')).angle).toBe('degrees')
    expect(decodeExpressionSpec(JSON.parse('{"expected":"sin(x)","angle":"grados"}')).angle).toBe('degrees')
    expect(JSON.stringify('degrees' as AngleMode), 'se guarda igual que antes').toBe('"degrees"')
  })

  // MARK: MC-03 · valores exactos con clave real

  it('exact answers are not approximations', () => {
    for (const [input, key] of [['3', 'tan(pi/3)^2'], ['3', 'sqrt(3)^2'], ['2', 'sec(pi/4)^2'], ['1/2', 'sin(pi/4)^2'], ['2', 'ln(e^2)'],
      ['1', '2*sin(pi/4)*cos(pi/4)'], ['0.5', 'sin(pi/4)^2'], ['0.25', 'sin(pi/4)^4']]) {
      const v = expression(input, key)
      expect(v.status, `«${input}» por ${key}: ${v.message ?? ''}`).toBe('correct')
      expect(v.credit).toBe(1)
    }
    for (const [input, key] of [['0.8660254037844386', 'sqrt(3)/2'], ['0.866', 'sqrt(3)/2'], ['0.3333333333333', '1/3'], ['0.7071', 'sqrt(2)/2']]) {
      const v = expression(input, key)
      expect(v.status, `«${input}» por ${key}`).toBe('partial')
      expect(v.credit).toBe(0.5)
    }
  })

  // MARK: MC-05 · raíces enteras acotadas

  it('integer root is bounded', () => {
    expect(Exact.intRoot(8n, 3n)).toBe(2n)
    expect(Exact.intRoot(1n << 62n, 62n)).toBe(2n)
    expect(Exact.intRoot(1n << 62n, 2n)).toBe(1n << 31n)
    expect(Exact.intRoot(1n << 62n, 63n)).toBeNull()
    expect(Exact.intRoot(1_000_000_000_000n, 1_000_000_000n)).toBeNull()
    expect(Exact.intRoot(1n, 1_000_000_000n)).toBe(1n)
    expect(Exact.intRoot(0n, 1_000_000_000n)).toBe(0n)
    expect(Exact.intRoot(INT_MAX, 1n)).toBe(INT_MAX)
    expect(Exact.intRoot(INT_MAX, 2n)).toBeNull()
    expectValue(exact('8^(1/3)'), Q(2))
    expectValue(exact('(-8)^(1/3)'), Q(-2))
    expectValue(exact('root(5, 32)'), Q(2))
    const start = Date.now()
    expect(numeric('8^0.333333333', '2').status).not.toBe('formatProblem')
    expect(numeric('8^0.333333333333', '2').status).not.toBe('formatProblem')
    expression('root(1000000000, 2)', '2')
    expression('2^(1/1000000000)', '1')
    expect(Date.now() - start).toBeLessThan(2000)
  })

  // MARK: MC-06 y MC-21 · texto

  it('opposite prefixes are not typos', () => {
    for (const [written, accepted] of [['exotérmica', 'endotérmica'], ['hipertónica', 'hipotónica'], ['hipoglucemia', 'hiperglucemia'],
      ['efferent', 'afferent'], ['apolar', 'polar'], ['atípico', 'típico'], ['endocytosis', 'exocytosis'],
      ['anaerobic', 'aerobic'], ['exergonic', 'endergonic'], ['adsorción', 'absorción'],
      ['intermolecular', 'intramolecular'], ['macroevolución', 'microevolución']]) {
      const v = AnswerChecker.checkText(written, [accepted])
      expect(v.status, `«${written}» por «${accepted}»: ${v.message ?? ''}`).toBe('incorrect')
      expect(v.message ?? '', 'no revela la respuesta').not.toContain(foldDiacritics(accepted))
    }
    expect(AnswerChecker.checkText('mitocondira', ['mitocondria']).status).toBe('partial')
    expect(AnswerChecker.checkText('endotermca', ['endotérmica']).status).toBe('partial')
    expect(AnswerChecker.checkText('fotosintesis', ['fotosíntesis']).status).toBe('correct')
    expect(AnswerChecker.checkText('desoxiribonucleco', ['desoxirribonucleico']).status, '2 erratas en 13+ letras').toBe('partial')
    expect(AnswerChecker.checkText('hipotonica', ['hipotónica']).status).toBe('correct')
    expect(AnswerChecker.checkText('endocitoss', ['endocitosis']).status, 'una errata').toBe('partial')
    expect(AnswerChecker.checkText('endcitoss', ['endocitosis']).status, 'dos ediciones en 11 letras').toBe('incorrect')
  })

  it('a known wrong answer is never a typo', () => {
    expect(AnswerChecker.checkText('glucasa', ['glucosa']).status).toBe('partial')
    const v = AnswerChecker.checkText('glucasa', ['glucosa'], ['glucasa'])
    expect(v.status).toBe('incorrect')
    expect(v.credit).toBe(0)
    expect(AnswerChecker.checkText('glucosa', ['glucosa'], ['glucasa']).status).toBe('correct')
  })

  it('articles that are part of the answer', () => {
    expect(AnswerChecker.checkText('vitamina', ['vitamina A']).status).not.toBe('correct')
    expect(AnswerChecker.checkText('hepatitis', ['hepatitis A']).status).not.toBe('correct')
    expect(AnswerChecker.checkText('tipo', ['tipo I']).status).not.toBe('correct')
    expect(AnswerChecker.checkText('vitamina A', ['vitamina A']).status).toBe('correct')
    expect(AnswerChecker.checkText('la vitamina A', ['vitamina A']).status).toBe('correct')
    expect(AnswerChecker.checkText('a cell', ['cell']).status).toBe('correct')
    expect(AnswerChecker.checkText('the nucleus', ['nucleus']).status).toBe('correct')
    expect(AnswerChecker.checkText('A', ['A']).status, 'una sola letra no se borra').toBe('correct')
    expect(AnswerChecker.checkText('le noyau', ['noyau']).status).toBe('correct')
    expect(AnswerChecker.checkText('der Zellkern', ['Zellkern']).status).toBe('correct')
    expect(AnswerChecker.checkText('il nucleo', ['nucleo']).status).toBe('correct')
    expect(AnswerChecker.checkText('o núcleo', ['núcleo']).status).toBe('correct')
  })

  // MARK: MC-07 y MC-13 · impresoras

  it('latex product with negative right factor', () => {
    const a = toLatex(P('x*(-2*y)'))
    expect(a.startsWith('x-'), a).toBe(false)
    expect(a).toContain('\\left(-')
    const b = toLatex(P('3*(-x*y)'))
    expect(b.startsWith('3-'), b).toBe(false)
    const tree = E.mul(E.num(Fraction.int(7)), E.mul(E.num(frac(-5, 9)), E.num(Fraction.int(2))))
    expect(toLatex(tree).startsWith('7-'), toLatex(tree)).toBe(false)
    expect(toLatex(P('2*x*y')), 'los productos normales no cambian').toBe('2xy')
  })

  it('plain text is stable', () => {
    const x = E.variable('x')
    const quotient = E.div(E.num(Fraction.int(1)), E.mul(E.num(Fraction.int(2)), x))
    const sum = E.add(x, E.num(Fraction.int(1)))
    for (const tree of [E.mul(quotient, sum), E.mul(E.neg(quotient), sum)]) {
      const text = toPlain(tree)
      const back = MathParser.parse(text)
      expect(Math.abs(evaluateDouble(tree, { x: 1.3 }) - evaluateDouble(back, { x: 1.3 })), `«${text}» se relee con otro valor`).toBeLessThanOrEqual(1e-12)
    }
    expect(toPlain(P('(x+1)(x-1)'))).toBe('(x+1)(x-1)')
    expect(toPlain(P('2(x+1)'))).toBe('2(x+1)')
  })

  it('printers round trip on random trees', () => {
    const rng = new DeterministicRNG(0xa0d17)
    const leaf = (): Expr => {
      switch (rng.int(0, 4)) {
        case 0: return E.variable('x')
        case 1: return E.variable('y')
        case 2: return E.num(Fraction.int(-rng.int(1, 9)))
        case 3: {
          const n = rng.int(1, 9)
          const d = rng.int(2, 9)
          return E.num(Fraction.of(n, d) ?? Fraction.ONE)
        }
        default: return E.num(Fraction.int(rng.int(1, 12)))
      }
    }
    const tree = (depth: number): Expr => {
      if (depth === 0 || rng.chance(0.25)) return leaf()
      switch (rng.int(0, 6)) {
        case 0: return E.add(tree(depth - 1), tree(depth - 1))
        case 1: return E.sub(tree(depth - 1), tree(depth - 1))
        case 2:
        case 3: return E.mul(tree(depth - 1), tree(depth - 1))
        case 4: return E.div(tree(depth - 1), tree(depth - 1))
        case 5: return E.neg(tree(depth - 1))
        default: return E.pow(tree(depth - 1), E.num(Fraction.int(rng.int(2, 3))))
      }
    }
    const env = { x: 1.37, y: -0.61 }
    const plainFailures: string[] = []
    const latexMismatches: string[] = []
    let checked = 0
    let latexUnread = 0
    for (let k = 0; k < 2500; k++) {
      const t = tree(4)
      const want = tryEvaluateDouble(t, env)
      if (want === null || !Number.isFinite(want) || !(Math.abs(want) < 1e9)) continue
      checked += 1
      const reread = (text: string): number | null => {
        try {
          return tryEvaluateDouble(MathParser.parse(text), env)
        } catch {
          return null
        }
      }
      const same = (got: number): boolean => Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
      const p = reread(toPlain(t))
      if (p === null || !same(p)) plainFailures.push(toPlain(t))
      const l = reread(toLatex(t))
      if (l !== null) {
        if (!same(l)) latexMismatches.push(toLatex(t))
      } else latexUnread += 1
    }
    expect(checked).toBeGreaterThan(1200)
    expect(plainFailures.length, plainFailures.slice(0, 5).join(' | ')).toBe(0)
    expect(latexMismatches.length, latexMismatches.slice(0, 5).join(' | ')).toBe(0)
    expect(latexUnread).toBeLessThan(checked / 100)
  })

  // MARK: MC-11 · plantillas

  it('percent placeholder', () => {
    const ctx = makeTemplateContext({ p: MV.rational(frac(3, 8)), q: MV.real(0.1) })
    expect(TemplateEngine.render('{{pct:p}}', ctx)).toBe('37.5\\%')
    expect(TemplateEngine.render('{{pct:p*100}}', ctx), 'ya multiplicado: no se repite').toBe('37.5\\%')
    expect(TemplateEngine.render('{{pct:100*p}}', ctx)).toBe('37.5\\%')
    expect(TemplateEngine.render('{{pct:q}}', ctx)).toBe('10\\%')
  })

  // MARK: MC-12 · ecuaciones de una variable sin raíces

  it('an equation without real roots is fast', () => {
    const start = Date.now()
    const v = AnswerChecker.checkEquation('x^2+4=0', 'x^2+1=0')
    expect(Date.now() - start).toBeLessThan(500)
    expect(v.status).not.toBe('correct')
    expect(AnswerChecker.checkEquation('x^2=-1', 'x^2+1=0').status, 'proporcionales: misma ecuación').toBe('correct')
    expect(AnswerChecker.checkEquation('2x^2+2=0', 'x^2+1=0').status).toBe('correct')
    expect(AnswerChecker.checkEquation('x^2=4', 'x^2-4=0').status).toBe('correct')
  })

  // MARK: MC-14 · log con dos argumentos

  it('log with two numbers explains the convention', () => {
    expectValue(exact('log(8, 2)'), Q(1, 3), 'la convención no cambia: base primero')
    const note = MathParser.ambiguityNote('log(8, 2)')
    expect(note).toContain('log_2(8)')
    expectValue(exact('log_2(8)'), Q(3))
    expect(MathParser.ambiguityNote('log(x, 8)'), 'con letras no hay aviso').toBeNull()
    expect(MathParser.ambiguityNote('log(8)'), 'con un argumento tampoco').toBeNull()
    expect(numeric('log(8, 2)', '3').message, 'el aviso llega al estudiante cuando falla').toContain('log_2(8)')
  })

  // MARK: MC-15 · expresiones con separador de miles

  it('expressions use the thousands readings', () => {
    NumberInput.apply('point')
    expect(expression('1,500', '1500').status).toBe('correct')
    expect(expression('1 500', '1500').status).toBe('correct')
    expect(expression('1,234,567', '1234567').status).toBe('correct')
    expect(expression('2x+1', '2x+1').status).toBe('correct')
  })

  // MARK: MC-16 · puntos con decimales

  it('points use the same criterion as the other checkers', () => {
    const want = ['sqrt(2)/2', 'sqrt(2)/2']
    const approx = AnswerChecker.checkPoint('(0.7071, 0.7071)', want)
    expect(approx.status).toBe('partial')
    expect(approx.credit).toBe(0.5)
    expect(AnswerChecker.checkPoint('(0.707107, 0.707107)', want).status).toBe('correct')
    expect(AnswerChecker.checkSet('0.707107', ['sqrt(2)/2']).status).toBe('correct')
    expect(numeric('0.707107', 'sqrt(2)/2').status).toBe('correct')
    expect(AnswerChecker.checkPoint('(1000.0004, 2)', ['1000', '2']).status, 'relativa también arriba').toBe('correct')
    expect(AnswerChecker.checkPoint('(0.7071, 5)', ['sqrt(2)/2', '3']).status, 'una aproximación y otra mal').toBe('incorrect')
  })

  // MARK: MC-17 · diferencias de temperatura

  it('temperature differences', () => {
    const ambiguous = numeric('5 K', '5', { unit: '°C' })
    expect(ambiguous.status, 'puede ser una diferencia: se avisa').toBe('partial')
    expect(ambiguous.message).toContain('diferencia')
    expect(numeric('278.15 K', '5', { unit: '°C' }).status).toBe('correct')
    expect(numeric('5 K', '5', { unit: 'Δ°C' }).status).toBe('correct')
    expect(numeric('5 °C', '5', { unit: 'Δ°C' }).status).toBe('correct')
    expect(numeric('9 °F', '5', { unit: 'Δ°C' }).status, 'una variación de 9 °F es una de 5 °C').toBe('correct')
    expect(numeric('278.15 K', '5', { unit: 'Δ°C' }).status).not.toBe('correct')
    expect(numeric('5', '5', { unit: 'delta_degC' }).status).toBe('correct')
    expect(UnitTable.convert(5, 'Δ°C', 'K')).toBe(5)
    expect(Math.abs((UnitTable.convert(5, '°C', 'K') ?? NaN) - 278.15)).toBeLessThanOrEqual(1e-9)
    expect(numeric('20 °F', '5', { unit: '°C' }).status).toBe('incorrect')
  })

  // MARK: MC-18 · dominio degenerado

  it('a degenerate sampling domain falls back to the default', () => {
    expect(expression('x', 'x^2', null, [0, 0]).status).not.toBe('correct')
    const reversed = expressionSpec('sqrt(x)', { domainMin: 5, domainMax: 1 })
    expect(new ExpressionChecker(reversed).samplingDomain, 'extremos al revés: se ordenan').toEqual([1, 5])
    expect(AnswerChecker.checkExpression('x^(1/2)', reversed).status).toBe('correct')
    expect(new ExpressionChecker(expressionSpec('x', { domainMin: NaN })).samplingDomain).toEqual([-6, 6])
  })

  // MARK: MC-19 y PQ-05 · palabras en los 12 idiomas

  it('undefined in every language of the app', () => {
    const words = ['DNE', 'indefinido', 'no existe', 'undefined', 'does not exist', 'não existe', 'nao existe', 'indefinido',
      'indéfini', "n'existe pas", 'undefiniert', 'nicht definiert', 'indefinito', 'non esiste', 'не определено',
      'не существует', '无定义', '不存在', '未定義', '存在しない', '정의되지 않음', '존재하지 않음', 'غير معرّف',
      'غير معرف', 'अपरिभाषित', '«indefinido»', '“não existe”', ' Undefined. ', '「未定義」', 'No  existe']
    for (const w of words) expect(numeric(w, 'DNE').status, `«${w}»`).toBe('correct')
    expect(numeric('indéfini', '5').status).toBe('incorrect')
    expect(numeric('5', 'indefinido').status).toBe('incorrect')
    expect(numeric('dne', '未定義').status, 'la clave también puede venir en otro idioma').toBe('correct')
    expect(NumberFormat.decimal(NaN), 'sin catálogo, la palabra base').toBe('indefinido')
    expect(numeric(NumberFormat.decimal(NaN), 'DNE').status).toBe('correct')
  })

  it('empty set, all reals and list words in every language', () => {
    for (const w of ['∅', 'no solution', 'sin solución', 'sem solução', 'pas de solution', 'keine Lösung', 'nessuna soluzione',
      'нет решений', '无解', '解なし', '해 없음', 'لا يوجد حل', 'कोई हल नहीं', 'conjunto vazio', 'ensemble vide']) {
      expect(AnswerChecker.checkSet(w, []).status, `«${w}»`).toBe('correct')
      expect(AnswerChecker.checkInterval(w, '∅').status, `«${w}»`).toBe('correct')
    }
    for (const w of ['R', 'ℝ', 'todos los reales', 'all real numbers', 'todos os reais', 'tous les réels', 'alle reellen Zahlen',
      'tutti i reali', 'все действительные числа', '全体实数', 'すべての実数', '모든 실수', 'جميع الأعداد الحقيقية', 'सभी वास्तविक संख्याएँ']) {
      expect(AnswerChecker.checkInterval(w, '(-inf, inf)').status, `«${w}»`).toBe('correct')
    }
    for (const w of ['x = 1 o x = 2', 'x = 1 ou x = 2', 'x = 1 oder x = 2', 'x = 1 или x = 2', '1 et 2', '1 und 2', 'x = 1 或 x = 2', '1 または 2', '1 또는 2', '1 أو 2', '1 या 2']) {
      expect(AnswerChecker.checkSet(w, ['1', '2']).status, `«${w}»`).toBe('correct')
    }
    expect(AnswerChecker.checkSet('e, 2', ['e', '2']).status, '«e» es el número e, no «y»').toBe('correct')
    expect(AnswerChecker.checkInterval('(-inf, 1) ou (2, inf)', '(-inf, 1) U (2, inf)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('x > 1 et x < 2', '(1, 2)').status).toBe('correct')
    expect(AnswerChecker.checkInterval('x > e', '(e, inf)').status).toBe('correct')
  })

  // MARK: MC-24

  it('multi-letter variables still get \\cdot', () => {
    expect(toLatex(E.mul(E.variable('total'), E.variable('x')))).toContain('\\cdot')
    expect(toLatex(E.mul(E.variable('a'), E.variable('x')))).not.toContain('\\cdot')
  })
})
