import { describe, expect, it } from 'vitest'
import { MV } from './core/types'
import { AnswerChecker } from './check/answer-checker'
import { LiveCalculator, MathKitChecker, TemplateFailure, TemplateInstantiator, type TemplateSourceLike } from './services'

const calc = (expression: string, degrees = false) => LiveCalculator.calculate(expression, degrees)

describe('CalculatorTests', () => {
  it('plain arithmetic still works', () => {
    const r = calc('3/4 + 1/6')
    expect(r.error).toBeUndefined()
    expect(r.text.startsWith('11/12'), r.text).toBe(true)
  })

  it('comparisons return true or false', () => {
    expect(calc('sin(pi/4) == sqrt(2)/2').text.startsWith('true')).toBe(true)
    expect(calc('(-5/13)^2 + (12/13)^2 = 1').text.startsWith('true')).toBe(true)
    expect(calc('1/2 < sqrt(2)/2').text.startsWith('true')).toBe(true)
    expect(calc('1/2 > sqrt(2)/2').text.startsWith('false')).toBe(true)
    expect(calc('0 < 3/7 < 1/2').text.startsWith('true')).toBe(true)
    expect(calc('0 < 3/5 < 1/2').text.startsWith('false')).toBe(true)
    expect(calc('cos(60) ≈ 1/2', true).text.startsWith('true')).toBe(true)
    expect(calc('1/3 != 0.333').text.startsWith('true')).toBe(true)
    expect(calc('2 <= 2').text.startsWith('true')).toBe(true)
    expect(calc('2 < 2').text.startsWith('false')).toBe(true)
  })

  it("scientific notation is not Euler's number", () => {
    expect(calc('abs((sqrt(2)/2)^2 + (sqrt(2)/2)^2 - 1) < 1e-9').text.startsWith('true')).toBe(true)
    const r = calc('6.02e23 / 1e23')
    expect(r.error).toBeUndefined()
    expect(Math.abs((r.decimal ?? 0) - 6.02)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs((calc('2e-3').decimal ?? 0) - 0.002)).toBeLessThanOrEqual(1e-15)
    expect(Math.abs((calc('2e').decimal ?? 0) - 2 * Math.E)).toBeLessThanOrEqual(1e-12)
  })

  it('lists and combined conditions', () => {
    const list = calc('sin(pi/6), cos(0); 2^10')
    expect(list.error).toBeUndefined()
    expect(list.text.split('\n').length).toBe(3)
    expect(list.text).toContain('2^10 → 1024')
    expect(LiveCalculator.topLevelSplit('gcd(4,6)', [','])).toEqual(['gcd(4,6)'])
    expect(calc('cos(pi/3) == 1/2 && cos(7*pi/6) == -sqrt(3)/2').text.startsWith('true')).toBe(true)
    expect(calc('cos(pi/3) == 1/2 && cos(7*pi/6) == sqrt(3)/2').text.startsWith('false')).toBe(true)
    expect(calc('1 > 2 || 3 > 2').text.startsWith('true')).toBe(true)
    expect(calc('1/2 && cos(7*pi/6)').error).toBeDefined()
  })

  it('comparison errors are explained', () => {
    expect(calc('1/0 < 2').error).toBeDefined()
    expect(LiveCalculator.comparisonChain('f(a<b)'), 'dentro de paréntesis no es una comparación').toBeNull()
    expect(LiveCalculator.comparisonChain('< 3')).toBeNull()
  })

  it('the calculator is exact', () => {
    expect(calc('1/2+1/3').text.startsWith('5/6')).toBe(true)
    expect(calc('1/2+1/3').latex).toBe('\\frac{5}{6}')
    expect(Math.abs((calc('sin(30)', true).decimal ?? 0) - 0.5)).toBeLessThanOrEqual(1e-12)
    expect(calc('x+1').error).toBeDefined()
    expect(calc('1/0').error).toBeDefined()
    const real = calc('sqrt(2)')
    expect(real.text).toBe('1.4142135623731')
    expect(real.latex).toBe('\\sqrt{2}')
  })
})

describe('MathKitChecker', () => {
  it('checks expressions and numeric values of the content', () => {
    const c = MathKitChecker
    expect(c.checkExpression('2*x+', null)).not.toBeNull()
    expect(c.checkExpression('a*q', ['a', 'x']), 'variable no definida').not.toBeNull()
    expect(c.checkExpression('a*q', ['a', 'x'])).toBe('usa «q», que no está definida (disponibles: a, x)')
    expect(c.checkExpression('a*x', ['a', 'x'])).toBeNull()
    expect(c.checkExpression('gcd(a,b) == 1', ['a', 'b']), 'restricciones de plantilla').toBeNull()
    expect(c.checkExpression('a*b < 100', ['a', 'b'])).toBeNull()
    expect(c.checkExpression('   ')).toBe('está vacía')
    expect(c.checkNumericValue('x+1')).toBe('contiene variables (x); debe ser un número')
    expect(c.checkNumericValue('DNE')).toBeNull()
    expect(c.checkNumericValue('sqrt(2)/2')).toBeNull()
    expect(c.checkNumericValue('')).toBe('está vacío')
  })

  it('declared greek variables are recognized', () => {
    const m = MathKitChecker
    expect(m.checkExpression('alpha*x + theta', ['alpha', 'theta', 'x'])).toBeNull()
    expect(m.checkExpression('α*x + θ', ['alpha', 'theta', 'x'])).toBeNull()
    expect(m.checkExpression('2*sin(theta)', ['θ'])).toBeNull()
    expect(m.checkExpression('alpha*x', ['x'])).not.toBeNull()
    expect(MathKitChecker.sidesFix('theta + 1'), 'se conserva para la calculadora y el graficador').toBe('theta + 1')
  })

  it('the answer key validator accepts undefined in every language', () => {
    for (const w of ['DNE', 'indefinido', 'não existe', "n'existe pas", 'existiert nicht', 'non esiste', '不存在', '存在しない', 'не существует', 'غير موجود', '∅', 'ninguno', 'none']) {
      expect(MathKitChecker.checkNumericValue(w), w).toBeNull()
    }
    expect(MathKitChecker.checkNumericValue('banana')).not.toBeNull()
  })

  it('sides splits comparisons', () => {
    expect(MathKitChecker.sides('a <= b == c')).toEqual(['a', 'b', 'c'])
    expect(MathKitChecker.sides('x ≠ 2')).toEqual(['x', '2'])
  })
})

const LIN_JSON: Record<string, unknown> = {
  id: 'lin', skill: 's', level: 2,
  vars: [{ name: 'a', kind: 'int', min: 2, max: 9 }, { name: 'b', kind: 'int', min: -9, max: 9, exclude: [0] }],
  constraints: ['a != b'],
  prompt: [{ type: 'text', md: 'Resuelve ${{a}}x{{signed:b}}=0$.' }],
  answer: { kind: 'numeric', value: '-b/a' },
  hints: ['Despeja x'],
  solution: [{ type: 'text', md: '$x=-\\frac{{{b}}}{{{a}}}$' }],
  wrongs: [{ input: 'b/a', why: 'Olvidaste cambiar el signo.' }],
}
const LIN = LIN_JSON as unknown as TemplateSourceLike

function promptValues(ex: Record<string, unknown>): [number, number] | null {
  const prompt = ex.prompt as Array<{ md?: string }>
  const m = /\$(\d+)x([+-]\d+)=0\$/.exec(prompt[0]?.md ?? '')
  return m ? [Number(m[1]), Number(m[2])] : null
}

describe('TemplateInstantiator', () => {
  it('templates are deterministic and answers are exact', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const e = TemplateInstantiator.instantiateJSON(LIN, LIN_JSON, seed)
      expect(e.id).toBe(`lin#${seed}`)
      expect(e.templateID).toBe('lin')
      expect(e.seed).toBe(seed)
      expect(e.vars).toBeUndefined()
      expect(e.constraints).toBeUndefined()
      const pv = promptValues(e)
      expect(pv, JSON.stringify(e.prompt)).not.toBeNull()
      if (!pv) continue
      const [a, b] = pv
      expect(a).not.toBe(b)
      expect(b).not.toBe(0)
      seen.add(`${a},${b}`)
      const answer = e.answer as { value: string }
      // la clave es -b/a exacta y se acepta a sí misma; el error típico b/a no
      expect(AnswerChecker.checkNumeric(`${-b}/${a}`, { value: answer.value }).status, `a=${a} b=${b} answer=${answer.value}`).toBe('correct')
      expect(AnswerChecker.checkNumeric(`${b}/${a}`, { value: answer.value }).status).not.toBe('correct')
      // la solución rellena las llaves de TeX
      const solution = (e.solution as Array<{ md: string }>)[0].md
      expect(solution).toBe(`$x=-\\frac{${b}}{${a}}$`)
    }
    expect(seen.size, 'las semillas deben dar variantes distintas').toBeGreaterThan(10)
    expect(JSON.stringify(TemplateInstantiator.instantiateJSON(LIN, LIN_JSON, 7)), 'misma semilla = mismo ejercicio').toBe(JSON.stringify(TemplateInstantiator.instantiateJSON(LIN, LIN_JSON, 7)))
  })

  it('unknown kinds and impossible constraints are explained', () => {
    const bad = { ...LIN, vars: [{ ...LIN.vars[0], kind: 'banana' }, LIN.vars[1]] }
    expect(() => TemplateInstantiator.context(bad, 1)).toThrow(TemplateFailure)
    const impossible = { ...LIN, constraints: ['a > 100'] }
    try {
      TemplateInstantiator.context(impossible, 1)
      expect.fail('debería fallar')
    } catch (e) {
      expect(e instanceof TemplateFailure && e.kind).toBe('sampling')
      expect((e as Error).message).toContain('No se pudieron elegir valores')
    }
  })

  it('huge template bounds do not crash', () => {
    const t: TemplateSourceLike = { id: 't', vars: [{ name: 'a', kind: 'int', min: -1e300, max: 1e300, exclude: [1e308, -5e300] }], constraints: [] }
    expect(() => TemplateInstantiator.instantiateJSON(t, { id: 't', prompt: [{ type: 'text', md: '{{a}}' }], answer: { kind: 'numeric', value: 'a' } }, 1)).toThrow(TemplateFailure)
  })

  it('impossible constraints on huge ranges fail fast', () => {
    const t: TemplateSourceLike = { id: 't', vars: [{ name: 'a', kind: 'int', min: 0, max: 4_999_990 }], constraints: ['a < 0'] }
    const start = Date.now()
    expect(() => TemplateInstantiator.context(t, 3)).toThrow(TemplateFailure)
    expect(Date.now() - start).toBeLessThan(3000)
    expect(TemplateInstantiator.maxTries([{ name: 'a', kind: { type: 'int', min: 1, max: 9, exclude: [] } }], ['a != 2']), 'las plantillas normales conservan sus 400 intentos').toBe(400)
  })

  it('huge decimal counts in template directives are clamped', () => {
    const t: TemplateSourceLike = { id: 't', vars: [{ name: 'a', kind: 'int', min: 1, max: 9 }], constraints: [] }
    const json = { id: 't', prompt: [{ type: 'text', md: 'Vale {{dec(999999999):a/3}} y {{sig(99999999):a}} y {{dec(2):a/4}}' }], answer: { kind: 'numeric', value: 'a' } }
    const start = Date.now()
    const ex = TemplateInstantiator.instantiateJSON(t, json, 5)
    expect(Date.now() - start).toBeLessThan(2000)
    const md = (ex.prompt as Array<{ md: string }>)[0].md
    expect(md.length, md).toBeLessThan(120)
    expect(TemplateInstantiator.clampDirectiveDigits('{{dec(2):x}} {{DEC( 123456 ):y}}')).toBe('{{dec(2):x}} {{DEC( 15 ):y}}')
    expect(TemplateInstantiator.clampDirectiveDigits('sin directivas (12345)')).toBe('sin directivas (12345)')
  })

  it('greek template variables are substituted in the answer', () => {
    for (const name of ['alpha', 'theta']) {
      const t: TemplateSourceLike = { id: 't', vars: [{ name, kind: 'int', min: 2, max: 5 }], constraints: [] }
      const ex = TemplateInstantiator.instantiateJSON(t, { id: 't', prompt: [{ type: 'text', md: `Calcula {{${name}}} por 2` }], answer: { kind: 'numeric', value: `${name}*2` } }, 11)
      const value = Number((ex.answer as { value: string }).value)
      expect([4, 6, 8, 10], `${name}: ${value}`).toContain(value)
    }
  })

  it('substitute keeps free variables and treats equations by parts', () => {
    const ctx = { values: { a: MV.int(2), b: MV.int(-3) }, strings: {} }
    expect(TemplateInstantiator.substitute('a*x+b', ctx)).toBe('2x-3')
    expect(TemplateInstantiator.substitute('y = a*x', ctx), 'como en Swift: la parte sin variables de plantilla se deja tal cual').toBe('y  = 2x')
    expect(TemplateInstantiator.substitute('x^2', ctx)).toBe('x^2')
    expect(TemplateInstantiator.substitute('no es (una expresión', ctx)).toBe('no es (una expresión')
  })

  it('var kinds come from the content spec', () => {
    expect(TemplateInstantiator.varKind({ name: 'a', kind: 'Integer', min: 1.7, max: 9.2 })).toEqual({ type: 'int', min: 1, max: 9, exclude: [] })
    expect(TemplateInstantiator.varKind({ name: 'r', kind: 'decimal' })).toEqual({ type: 'real', min: 0, max: 10, decimals: 1 })
    expect(TemplateInstantiator.varKind({ name: 'p', kind: 'choice', values: ['x'] })).toEqual({ type: 'pick', values: ['x'] })
    expect(TemplateInstantiator.varKind({ name: 'f', kind: 'frac' })).toEqual({ type: 'fraction', minDen: 2, maxDen: 9, maxNum: 9, proper: true })
    expect(TemplateInstantiator.varKind({ name: 'e', kind: 'derived', expr: 'a+1' })).toEqual({ type: 'expr', expr: 'a+1' })
    expect(TemplateInstantiator.varKind({ name: 'e', kind: 'expr' })).toBeNull()
    expect(TemplateInstantiator.safeInt(1e300)).toBe(1e15)
    expect(TemplateInstantiator.safeInt(-2.9)).toBe(-2)
    expect(TemplateInstantiator.safeInt(NaN)).toBe(0)
  })
})

describe('MathKitChecker canonical numeric input', () => {
  it('writes the key as the student would', () => {
    expect(MathKitChecker.canonicalNumericInput({ value: '3/4' })).toBe('3/4')
    expect(MathKitChecker.canonicalNumericInput({ value: '5', unit: 'm/s', unitMode: 'required' })).toBe('5 m/s')
    expect(MathKitChecker.canonicalNumericInput({ value: 'pi', decimals: 3 })).toBe('3.142')
    expect(MathKitChecker.canonicalNumericInput({ value: '1/3', decimals: 9_999_999_999 })).toBe('0.333333333333333')
    expect(MathKitChecker.canonicalNumericInput({ value: '1/2', decimals: -5 })).toBe('1')
    expect(MathKitChecker.canonicalNumericInput({ value: '3/8', form: 'percent' }), 'sin decimales no se puede escribir el porcentaje').toBeNull()
    expect(MathKitChecker.canonicalNumericInput({ value: 'x', decimals: 2 })).toBeNull()
    expect(MathKitChecker.numericRoundedInput({ value: '2', decimals: 2, unit: 'kg', unitMode: 'required' })).toBe('2.00 kg')
    // la clave escrita así se acepta a sí misma
    expect(AnswerChecker.checkNumeric(MathKitChecker.canonicalNumericInput({ value: 'pi', decimals: 3 }) ?? '', { value: 'pi', decimals: 3 }).status).toBe('correct')
  })
})
