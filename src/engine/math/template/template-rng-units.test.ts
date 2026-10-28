import { describe, expect, it } from 'vitest'
import { MathError, MV } from '../core/types'
import { AnswerChecker } from '../check/answer-checker'
import type { UnitMode } from '../check/specs'
import { Numerics } from '../eval/numerics'
import { INT_MAX, INT_MIN } from '../numbers/int64'
import { DeterministicRNG } from '../random/rng'
import { UnitTable, unitIsAffine, unitQuantityName } from '../units/unit-table'
import { Q, expectValue, frac, has } from '../test-support.testutil'
import { TemplateEngine } from './engine'
import { decodeTemplateVar, decodeVarKind, encodeTemplateVar, makeTemplateContext, type TemplateContext, type TemplateVar, type VarKind } from './types'

const intVar = (name: string, min: number, max: number, exclude: number[] = []): TemplateVar => ({ name, kind: { type: 'int', min, max, exclude } })
const ctx = (vars: TemplateVar[], constraints: string[] = [], seed: number | bigint = 0): TemplateContext => TemplateEngine.sample(vars, constraints, seed)

describe('TemplateRNGUnitTests', () => {
  // MARK: Generador determinista

  it('RNG matches reference sequences', () => {
    const rows: Array<[bigint, bigint[]]> = [
      [0n, [11091344671253066420n, 13793997310169335082n, 1900383378846508768n]],
      [42n, [1546998764402558742n, 6990951692964543102n, 12544586762248559009n]],
      [20261007n, [16695199790024771265n, 10602459519138875852n, 14980740151457591040n]],
    ]
    for (const [seed, expected] of rows) {
      const g = new DeterministicRNG(seed)
      expect([g.next(), g.next(), g.next()], `semilla ${seed}`).toEqual(expected)
    }
    const d = new DeterministicRNG(42)
    expect(d.double()).toBe(0.08386297105988216)
    expect(d.double()).toBe(0.3789802506626686)
  })

  it('RNG ranges and helpers', () => {
    const g = new DeterministicRNG(7)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const x = g.int(-3, 3)
      expect(x >= -3 && x <= 3).toBe(true)
      seen.add(x)
      const u = g.double()
      expect(u >= 0 && u < 1).toBe(true)
      const r = g.doubleIn(2, 5)
      expect(r >= 2 && r <= 5).toBe(true)
    }
    expect([...seen].sort((a, b) => a - b), 'todos los valores salen').toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(g.int(5, 5)).toBe(5)
    const full = g.intBig(INT_MIN, INT_MAX)
    expect(full >= INT_MIN && full <= INT_MAX, 'rango completo sin desbordar').toBe(true)
    expect(g.pick([])).toBeUndefined()
    expect(g.pick(['solo'])).toBe('solo')
    const base = Array.from({ length: 20 }, (_, i) => i + 1)
    const shuffled = g.shuffle(base)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(base)
    expect(shuffled).not.toEqual(base)
    expect(g.shuffle([])).toEqual([])
    const a = new DeterministicRNG(99)
    const b = new DeterministicRNG(99)
    expect(Array.from({ length: 50 }, () => a.int(0, 1000))).toEqual(Array.from({ length: 50 }, () => b.int(0, 1000)))
    const c = new DeterministicRNG(100)
    const d = new DeterministicRNG(99)
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(Array.from({ length: 5 }, () => d.next()))
  })

  // MARK: Plantillas

  it('sampling is deterministic with fixed regression values', () => {
    const vars = [intVar('a', 1, 9), intVar('b', 1, 9)]
    const c1 = ctx(vars, ['a != b'], 1)
    expectValue(c1.values.a, Q(5))
    expectValue(c1.values.b, Q(2))
    const again = ctx(vars, ['a != b'], 1)
    expectValue(again.values.a, c1.values.a, 'misma semilla, mismos valores')
    expectValue(again.values.b, c1.values.b)
    const c2 = ctx(vars, ['gcd(a,b) == 1', 'a < b'], 2)
    expectValue(c2.values.a, Q(1))
    expectValue(c2.values.b, Q(8))
    const c4 = ctx([{ name: 'r', kind: { type: 'real', min: 0, max: 10, decimals: 1 } }, { name: 'u', kind: { type: 'pick', values: ['m', 'cm', 'km'] } }], [], 4)
    expectValue(c4.values.r, Q(57, 10))
    expect(c4.strings.u).toBe('m')
    const many = new Set<string>()
    for (let s = 0; s < 40; s++) {
      try {
        many.add(MV.describe(ctx(vars, ['a != b'], s).values.a))
      } catch {
        // semilla sin solución
      }
    }
    expect(many.size).toBeGreaterThan(5)
  })

  it('constraints always hold', () => {
    const vars: TemplateVar[] = [intVar('a', -9, 9, [0]), intVar('b', -9, 9, [0]), { name: 'c', kind: { type: 'expr', expr: 'a*b' } }]
    const constraints = ['a != b', 'gcd(a, b) == 1', 'c < 20', 'a > 0 && b < 0 || a < 0 && b > 0', 'not(a == -b)']
    for (let seed = 0; seed < 60; seed++) {
      const c = ctx(vars, constraints, seed)
      const a = MV.double(c.values.a)
      const b = MV.double(c.values.b)
      expect(a).not.toBe(b)
      expect(a).not.toBe(0)
      expect(Numerics.gcd(BigInt(a), BigInt(b))).toBe(1n)
      expect(a * b).toBeLessThan(20)
      expect(a * b < 0).toBe(true)
      expect(a).not.toBe(-b)
      expectValue(c.values.c, Q(a * b))
    }
  })

  it('variable kinds', () => {
    const c = ctx([
      intVar('n', 1, 3, [1, 2]),
      { name: 'x', kind: { type: 'real', min: 0.1, max: 0.3, decimals: 2 } },
      { name: 'f', kind: { type: 'fraction', minDen: 2, maxDen: 9, maxNum: 9, proper: true } },
      { name: 's', kind: { type: 'pick', values: ['H2O', '0.5', '1/4'] } },
      { name: 'y', kind: { type: 'expr', expr: 'n^2 + x' } },
    ], [], 11)
    expectValue(c.values.n, Q(3), 'excluidos 1 y 2')
    const x = MV.fraction(c.values.x)
    expect(x).not.toBeNull()
    if (!x) return
    expect(x.doubleValue >= 0.1 && x.doubleValue <= 0.3).toBe(true)
    expect(Math.abs(Math.round(x.doubleValue * 100) - x.doubleValue * 100)).toBeLessThanOrEqual(1e-9)
    const f = MV.fraction(c.values.f)
    expect(f && f.num < f.den && f.den >= 2n && f.den <= 9n, 'fracción propia').toBe(true)
    expect(c.strings.s).toBeDefined()
    expectValue(c.values.y, MV.rational(frac(9).adding(x) ?? frac(0)), 'las expr son exactas')
  })

  it('render formats', () => {
    const c = makeTemplateContext(
      { a: MV.int(3), b: MV.int(-8), f: Q(1, 8), r: Q(57, 10), big: MV.int(825221) },
      { a: '3', b: '-8', f: '1/8', r: '5.7', u: 'm/s', big: '825221' },
    )
    const rows: Array<[string, string]> = [
      ['{{a}}', '3'], ['{{a+b}}', '-5'], ['{{a/b}}', '-0.375'], ['{{f}}', '1/8'], ['{{f*2}}', '0.25'], ['{{tex:a/b}}', '-\\frac{3}{8}'],
      ['{{frac:a/b}}', '-\\frac{3}{8}'], ['{{frac:a}}', '3'], ['{{signed:a}}', '+3'], ['{{signed:b}}', '-8'], ['{{dec(2):a/7}}', '0.43'],
      ['{{dec(3):f}}', '0.125'], ['{{dec(1):0.25}}', '0.3'], ['{{dec(2):2.675}}', '2.68'], ['{{dec(0):r}}', '6'], ['{{sig(2):a/7}}', '0.43'],
      ['{{sig(3):big}}', '825000'], ['{{sci:big}}', '8.25\\times10^{5}'], ['{{pct:f}}', '12.5\\%'], ['{{pct:f*100}}', '12.5\\%'], ['{{abs:b}}', '8'], ['{{str:u}}', 'm/s'],
      ['{{u}}', 'm/s'], ['{{r}} {{u}}', '5.7 m/s'], ['x^{{{a}}}', 'x^{3}'], ['{{tex:a*x^2+b*x}}', '3x^{2}-8x'], ['{{tex:sqrt(a+1)}}', '2'], ['{{tex:sqrt(a-1)}}', '\\sqrt{2}'],
      ['{{tex:pi*a}}', '3\\pi'], ['{{ a + 1 }}', '4'], ['sin llaves', 'sin llaves'], ['{una} {{a}}', '{una} 3'], ['{{TEX:a/b}}', '-\\frac{3}{8}'],
      ['{{a mod 2}}', '1'], ['{{a % 2}}', '1'], ['{{max(a, b)}}', '3'], ['{{mean(a, b)}}', '-2.5'],
    ]
    for (const [text, expected] of rows) expect(TemplateEngine.render(text, c), `«${text}»`).toBe(expected)
    expectValue(TemplateEngine.evaluate('a*b + f', c), Q(-191, 8))
  })

  it('template errors are clear', () => {
    const message = (block: () => unknown): string => {
      try {
        block()
        return ''
      } catch (e) {
        return e instanceof MathError ? e.message : String(e)
      }
    }
    const a = [intVar('a', 1, 2)]
    expect(message(() => TemplateEngine.sample(a, ['a > 5'], 1))).toContain('No se pudo cumplir')
    expect(message(() => TemplateEngine.sample([intVar('a', 5, 1)], [], 1))).toContain('al revés')
    expect(message(() => TemplateEngine.sample([intVar('pi', 1, 2)], [], 1))).toContain('reservado')
    expect(message(() => TemplateEngine.sample([...a, ...a], [], 1))).toContain('dos veces')
    expect(message(() => TemplateEngine.sample([intVar('2a', 1, 2)], [], 1))).toContain('no es válido')
    expect(message(() => TemplateEngine.sample(a, ['a >< 3'], 1))).toContain('En la restricción')
    expect(message(() => TemplateEngine.sample([intVar('a', 1, 1, [1])], [], 1))).toContain('ningún valor')
    expect(message(() => TemplateEngine.sample([{ name: 'p', kind: { type: 'pick', values: [] } }], [], 1))).toContain('opciones')
    expect(message(() => TemplateEngine.sample([intVar('a', 0, 10_000_000)], [], 1))).toContain('demasiado grande')
    const c = makeTemplateContext({ a: MV.int(0) }, { a: '0', u: 'cm' })
    expect(message(() => TemplateEngine.render('{{b}}', c))).toContain('no está definida')
    expect(message(() => TemplateEngine.render('{{a', c))).toContain('Falta cerrar')
    expect(message(() => TemplateEngine.render('{{}}', c))).toContain('vacío')
    expect(message(() => TemplateEngine.render('{{dec:a}}', c))).toContain('número de cifras')
    expect(message(() => TemplateEngine.render('{{u+1}}', c))).toContain('es un texto')
    expect(message(() => TemplateEngine.render('{{1/a}}', c))).toContain('dividir entre cero')
  })

  it('identifiers with digits in templates', () => {
    const c = ctx([intVar('x1', 2, 2), intVar('a2b', 5, 5)], [], 3)
    expect(TemplateEngine.render('{{x1}} {{x1*a2b}} {{log2(8)}} {{2x1}}', c)).toBe('2 10 3 4')
  })

  it('VarKind and TemplateVar decoding is tolerant', () => {
    const decode = (json: string): VarKind => decodeVarKind(JSON.parse(json))
    expect(decode('{"type":"int","min":1,"max":9,"exclude":[0]}')).toEqual({ type: 'int', min: 1, max: 9, exclude: [0] })
    expect(decode('{"int":{"min":"2","max":5}}')).toEqual({ type: 'int', min: 2, max: 5, exclude: [] })
    expect(decode('{"kind":"entero","lo":1,"hi":3}')).toEqual({ type: 'int', min: 1, max: 3, exclude: [] })
    expect(decode('{"type":"pick","options":["m","cm",12]}')).toEqual({ type: 'pick', values: ['m', 'cm', '12'] })
    expect(decode('{"pick":["a","b"]}')).toEqual({ type: 'pick', values: ['a', 'b'] })
    expect(decode('{"type":"decimal","min":0,"max":1,"places":2}')).toEqual({ type: 'real', min: 0, max: 1, decimals: 2 })
    expect(decode('{"type":"fraccion","maxDen":6}')).toEqual({ type: 'fraction', minDen: 2, maxDen: 6, maxNum: 9, proper: true })
    expect(decode('{"expr":"a*b"}')).toEqual({ type: 'expr', expr: 'a*b' })
    expect(() => decode('{"type":"banana"}')).toThrow()
    expect(decodeTemplateVar(JSON.parse('{"name":"a","type":"int","min":1,"max":4}'))).toEqual(intVar('a', 1, 4))
    const kinds: VarKind[] = [{ type: 'int', min: 1, max: 2, exclude: [3] }, { type: 'real', min: 0.5, max: 2, decimals: 1 }, { type: 'pick', values: ['x'] },
      { type: 'fraction', minDen: 2, maxDen: 3, maxNum: 4, proper: false }, { type: 'expr', expr: 'a+1' }]
    for (const kind of kinds) {
      const v: TemplateVar = { name: 'v', kind }
      expect(decodeTemplateVar(JSON.parse(JSON.stringify(encodeTemplateVar(v))))).toEqual(v)
    }
  })

  // MARK: Unidades

  it('unit parsing', () => {
    const rows: Array<[string, number[], number]> = [
      ['m', [1, 0, 0, 0, 0, 0, 0, 0], 1], ['cm', [1, 0, 0, 0, 0, 0, 0, 0], 0.01], ['km', [1, 0, 0, 0, 0, 0, 0, 0], 1000], ['µm', [1, 0, 0, 0, 0, 0, 0, 0], 1e-6],
      ['kg', [0, 1, 0, 0, 0, 0, 0, 0], 1], ['mg', [0, 1, 0, 0, 0, 0, 0, 0], 1e-6], ['m/s', [1, 0, -1, 0, 0, 0, 0, 0], 1], ['km/h', [1, 0, -1, 0, 0, 0, 0, 0], 1 / 3.6],
      ['m/s^2', [1, 0, -2, 0, 0, 0, 0, 0], 1], ['m/s²', [1, 0, -2, 0, 0, 0, 0, 0], 1], ['m s^-1', [1, 0, -1, 0, 0, 0, 0, 0], 1], ['kg·m/s²', [1, 1, -2, 0, 0, 0, 0, 0], 1],
      ['N', [1, 1, -2, 0, 0, 0, 0, 0], 1], ['kJ/mol', [2, 1, -2, 0, 0, -1, 0, 0], 1000], ['J/(mol·K)', [2, 1, -2, 0, -1, -1, 0, 0], 1], ['mL', [3, 0, 0, 0, 0, 0, 0, 0], 1e-6],
      ['L', [3, 0, 0, 0, 0, 0, 0, 0], 0.001], ['M', [-3, 0, 0, 0, 0, 1, 0, 0], 1000], ['mmol', [0, 0, 0, 0, 0, 1, 0, 0], 0.001], ['atm', [-1, 1, -2, 0, 0, 0, 0, 0], 101325],
      ['mmHg', [-1, 1, -2, 0, 0, 0, 0, 0], 101325 / 760], ['Hz', [0, 0, -1, 0, 0, 0, 0, 0], 1], ['Ω', [2, 1, -3, -2, 0, 0, 0, 0], 1], ['kΩ', [2, 1, -3, -2, 0, 0, 0, 0], 1000],
      ['%', [0, 0, 0, 0, 0, 0, 0, 0], 0.01], ['ppm', [0, 0, 0, 0, 0, 0, 0, 0], 1e-6], ['cal', [2, 1, -2, 0, 0, 0, 0, 0], 4.184], ['metros', [1, 0, 0, 0, 0, 0, 0, 0], 1],
      ['segundos', [0, 0, 1, 0, 0, 0, 0, 0], 1], ['KM', [1, 0, 0, 0, 0, 0, 0, 0], 1000], ['g/mL', [-3, 1, 0, 0, 0, 0, 0, 0], 1000], ['1/s', [0, 0, -1, 0, 0, 0, 0, 0], 1],
      ['°', [0, 0, 0, 0, 0, 0, 0, 1], Math.PI / 180], ['rad', [0, 0, 0, 0, 0, 0, 0, 1], 1],
    ]
    for (const [text, dims, factor] of rows) {
      const u = UnitTable.parse(text)
      expect(u, `«${text}»`).not.toBeNull()
      if (!u) continue
      expect([...u.dimension], `«${text}»`).toEqual(dims)
      expect(Math.abs(u.factor - factor) <= 1e-12 * Math.max(1, factor), `«${text}»: ${u.factor}`).toBe(true)
    }
    for (const bad of ['', 'xyz', 'm^', 'kg^(1/2)', 'm'.repeat(100), '5 m', '1 km', '2/s']) expect(UnitTable.parse(bad), `«${bad}»`).toBeNull()
    const name = (t: string): string | null => {
      const u = UnitTable.parse(t)
      return u ? unitQuantityName(u) : null
    }
    expect(name('m/s')).toBe('velocidad')
    expect(name('kPa')).toBe('presión')
    expect(name('mol/L')).toBe('concentración molar')
  })

  it('unit conversions', () => {
    const rows: Array<[number, string, string, number]> = [
      [1, 'm', 'cm', 100], [100, 'cm', 'm', 1], [5, 'km/h', 'm/s', 5 / 3.6], [1, 'atm', 'mmHg', 760], [1, 'atm', 'kPa', 101.325], [1, 'kcal', 'J', 4184],
      [20, '°C', 'K', 293.15], [293.15, 'K', '°C', 20], [68, '°F', '°C', 20], [-40, '°C', '°F', -40], [100, '°C', '°F', 212], [1, 'L', 'mL', 1000],
      [0.5, 'M', 'mmol/L', 500], [180, '°', 'rad', Math.PI], [1, 'h', 's', 3600], [1, 'mi', 'km', 1.609344], [2, 'lb', 'kg', 0.90718474], [1, 'kWh', 'MJ', 3.6],
    ]
    for (const [v, from, to, expected] of rows) {
      const r = UnitTable.convert(v, from, to)
      expect(r, `${from}→${to}`).not.toBeNull()
      expect(Math.abs((r ?? NaN) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${v} ${from} → ${to}: ${r}`).toBe(true)
    }
    expect(UnitTable.convert(1, 'm', 'kg'), 'dimensiones distintas').toBeNull()
    expect(UnitTable.convert(1, 'm', 'zz')).toBeNull()
    expect(UnitTable.areCompatible('N', 'kg·m/s^2')).toBe(true)
    expect(UnitTable.areCompatible('N', 'J')).toBe(false)
    const c = UnitTable.parse('°C')
    const k = UnitTable.parse('K')
    expect(c ? unitIsAffine(c) : false).toBe(true)
    expect(k ? unitIsAffine(k) : true).toBe(false)
  })

  it('numeric answers with units', () => {
    const chk = (input: string, value: string, unit: string | null, mode: UnitMode = 'optional') => AnswerChecker.checkNumeric(input, { value, unit, unitMode: mode })
    expect(chk('100 cm', '1', 'm').status).toBe('correct')
    expect(chk('0.001 km', '1', 'm').status, 'regresión: se partía en «0.00» + «1 km»').toBe('correct')
    expect(chk('0.5 1/s', '0.5', 'Hz').status).toBe('correct')
    expect(chk('293.15 K', '20', '°C').status).toBe('correct')
    expect(chk('68 °F', '20', '°C').status).toBe('correct')
    expect(chk('9,8 m/s^2', '9.8', 'm/s²').status).toBe('correct')
    expect(chk('5 metros', '5', 'm').status).toBe('correct')
    expect(chk('1 kg', '1', 'm').diagnosis).toEqual(['unitWrong'])
    expect(chk('1', '1', 'm', 'required').diagnosis).toEqual(['unitMissing'])
    const cm = chk('100', '1', 'm', 'required')
    expect(cm.status).toBe('incorrect')
    expect(cm.diagnosis.slice(0, 2)).toEqual(['unitConversion', 'unitMissing'])
    expect(cm.message).toContain('cm')
    expect(chk('293.15', '20', '°C').message).toContain('K')
    expect(has(chk('1000', '1', 'kg'), 'unitConversion')).toBe(true)
    const both = chk('7', '1', 'm', 'required')
    expect(both.diagnosis).toEqual(['unitMissing'])
    expect(both.message).toContain('Falta la unidad')
  })
})

