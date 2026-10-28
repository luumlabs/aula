// Portado de la app Swift anterior: Tests/ChemKitTests/AuditFixesTests.swift, AuditSpeciesAndGasLawTests.swift,
// AuditFractionalStoichiometryTests.swift y AuditChemInputTests.swift (hallazgos de la auditoría de la app Swift).

import { afterEach, describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import { ALL_ELEMENTS } from './elements'
import { CHEM_LANGUAGES, ELEMENT_NAMES } from './element-l10n'
import { Formula } from './formula'
import { setChemDecimalComma } from './l10n'
import { ChemQuantity } from './quantity'
import { Rational } from './rational'
import { SigFigs } from './sigfigs'
import { ChemConstants, Stoichiometry } from './stoichiometry'
import { Gases, Solutions } from './solutions'
import { balance } from './balancer'
import { ChemTools } from './tools'

const T = ChemTools
const q = (s: string): ChemQuantity => ChemQuantity.parse(s)
const F = (s: string): Formula => Formula.parse(s)
const coefficients = (rs: readonly Rational[] | undefined): string[] => (rs ?? []).map((r) => r.toString())

describe('MC-08 · claves con coeficientes fraccionarios', () => {
  it('la clave fraccionaria se exige', () => {
    const multiple = T.checkEquation('2H2 + O2 -> 2H2O', 'H2 + 1/2 O2 -> H2O')
    expect(multiple.status, multiple.feedback).toBe('partial')
    expect(multiple.feedback.startsWith('¡Correcto!')).toBe(false)
    expect(T.checkEquation('H2 + 1/2 O2 -> H2O', 'H2 + 1/2 O2 -> H2O').status).toBe('correct')
    expect(T.checkEquation('H2 + 0.5 O2 -> H2O', 'H2 + 1/2 O2 -> H2O').status).toBe('correct')
    expect(T.checkEquation('4H2 + 2O2 -> 4H2O', 'H2 + 1/2 O2 -> H2O').status).toBe('partial')
    expect(T.checkEquation('2H2 + 2O2 -> 2H2O', 'H2 + 1/2 O2 -> H2O').status, 'sin balancear').toBe('incorrect')
    expect(T.checkEquation('C + O2 -> CO2', 'C + O2 -> CO2').status).toBe('correct')
    expect(T.checkEquation('2H2 + O2 -> 2H2O', 'H2 + O2 -> H2O').status).toBe('correct')
    expect(T.checkEquation('4H2 + 2O2 -> 4H2O', '2H2 + O2 -> 2H2O').status).toBe('partial')
  })
})

describe('MC-09 · «1,200» con coma de miles', () => {
  afterEach(() => setChemDecimalComma(null))

  it('respuestas numéricas con separador de miles', () => {
    setChemDecimalComma(false)
    const v = T.checkNumber('1,200', 1200)
    expect(v.status, v.feedback).toBe('correct')
    expect(v.feedback).not.toContain('potencia de 10')
    expect(T.checkNumber('1,200', 1.2).status, 'la otra lectura también vale').toBe('correct')
    expect(T.checkNumber('1,200 J', 1200).status).toBe('correct')
    expect(T.checkNumber('12,500', 12500, 3).status, '12500 con 3 cifras (ambiguo 3…5)').toBe('correct')
    expect(T.checkNumber('1,5', 1.5).status, 'una o dos cifras tras la coma: decimal').toBe('correct')
    expect(T.checkNumber('0,500', 0.5).status, 'con cero delante: decimal').toBe('correct')
    expect(T.checkNumber('1,200', 12).status).not.toBe('correct')
    expect(T.checkNumber('1.200', 1200).status, 'su punto decimal nunca es de miles').not.toBe('correct')

    setChemDecimalComma(true)
    expect(T.checkNumber('1,200', 1.2).status).toBe('correct')
    expect(T.checkNumber('1,200', 1200).status, 'su coma decimal nunca es de miles').not.toBe('correct')
    expect(T.checkNumber('1.200', 1200).status, 'el punto, que no es su decimal, puede ser de miles').toBe('correct')
    expect(T.checkNumber('1.200', 1.2).status).toBe('correct')
    expect(T.checkNumber('1.200,5', 1200.5).status).toBe('correct')

    // Los datos y las herramientas de la IA leen como siempre (coma decimal), sea cual sea el ajuste.
    setChemDecimalComma(false)
    expect(SigFigs.parse('1,200')?.value).toBe(1.2)
    expect(SigFigs.parse('1,200,000')?.value).toBe(1_200_000)
  })
})

describe('UI1-08 · nombres de los elementos', () => {
  it('no se repiten dentro de un idioma', () => {
    for (const lang of CHEM_LANGUAGES) {
      const names = ELEMENT_NAMES[lang]
      expect(names.length, lang).toBe(ALL_ELEMENTS.length)
      const seen = new Map<string, string>()
      names.forEach((n, i) => {
        const key = n.trim().toLowerCase()
        const symbol = ALL_ELEMENTS[i].symbol
        expect(seen.has(key), `[${lang}] «${n}» es el nombre de ${seen.get(key)} y ${symbol}`).toBe(false)
        seen.set(key, symbol)
      })
    }
    // La clave de cada nombre es el nombre en español de los datos.
    ALL_ELEMENTS.forEach((e, i) => expect(ELEMENT_NAMES.es[i], e.symbol).toBe(e.name))
  })
})

describe('CH-13 · especies repetidas', () => {
  it('se suman y no saltan los coeficientes mínimos', () => {
    expect(T.checkEquation('2H2+2H2+2O2->4H2O', '2H2+O2->2H2O').status).toBe('partial')
    expect(T.checkEquation('H2+H2+O2->2H2O', '2H2+O2->2H2O').status).toBe('correct')
    expect(T.checkEquation('4H2+2O2->4H2O', '2H2+O2->2H2O').status).toBe('partial')
    expect(T.checkEquation('2H2+O2->2H2O', '2H2+O2->2H2O').status).toBe('correct')
    expect(T.checkEquation('2H2+O2->H2O+H2O', '2H2+O2->2H2O').status).toBe('correct')
  })

  it('un cambio de fase no avisa de un estado equivocado', () => {
    const v = T.checkEquation('H2O(s)->H2O(l)', 'H2O(s)->H2O(l)')
    expect(v.status).toBe('correct')
    expect(v.feedback).not.toContain('Revisa el estado')
  })
})

describe('CH-10 · gases con datos no positivos o extremos', () => {
  it('ley combinada', () => {
    expect(() => Gases.combined(q('1 atm'), q('10 L'), q('300 K'), q('-1 atm'), null, q('300 K'))).toThrow(ChemError)
    expect(() => Gases.combined(q('1 atm'), q('10 L'), q('300 K'), null, q('0 L'), q('300 K'))).toThrow(ChemError)
    expect(() => Gases.combined(q('1 atm'), q('-10 L'), q('300 K'), q('2 atm'), null, q('300 K'))).toThrow(ChemError)
    expect(Gases.combined(q('1 atm'), q('10 L'), q('300 K'), null, q('20 L'), q('300 K')).value).toBeCloseTo(0.5, 12)
    expect(() => Gases.combined(q('1 atm'), q('10 L'), q('300 K'), null, new ChemQuantity(1e-320, 'liter'), q('300 K'))).toThrow(ChemError)
    expect(() => Gases.molarVolume(q('300 K'), new ChemQuantity(1e-320, 'atmosphere'))).toThrow(ChemError)
  })

  it('densidad', () => {
    expect(() => Gases.density(F('CO2'), q('-1 atm'), q('300 K'))).toThrow(ChemError)
    expect(Gases.density(F('CO2'), q('1 atm'), q('273.15 K')).value).toBeCloseTo(44.009 / (ChemConstants.gasConstantLatm * 273.15), 9)
  })

  it('gas ideal: datos negativos, divisores cero y resultados no finitos', () => {
    const ideal = Gases.idealGas
    expect(() => ideal({ pressure: q('-1 atm'), volume: null, amount: q('1 mol'), temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: null, amount: q('-1 mol'), temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: q('-10 L'), amount: null, temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: null, volume: q('0 L'), amount: q('1 mol'), temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('0 atm'), volume: q('10 L'), amount: null, temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: null, amount: q('0 mol'), temperature: q('298 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: q('10 L'), amount: q('1 mol'), temperature: q('0 K') })).toThrow(ChemError)
    expect(() => ideal({ pressure: null, volume: q('10 L'), amount: q('1 mol'), temperature: new ChemQuantity(Infinity, 'kelvin') })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: null, amount: new ChemQuantity(1e308, 'mole'), temperature: q('300 K') })).toThrow(ChemError)
    expect(ideal({ pressure: q('1.00 atm'), volume: null, amount: q('1.00 mol'), temperature: q('273.15 K') }).value).toBeCloseTo(22.414, 3)
  })
})

describe('CH-01 · estequiometría con coeficientes fraccionarios', () => {
  it('la ecuación fraccionaria conserva su proporción', () => {
    const r = Stoichiometry.solve('1.5H2 + O2 -> H2O + 0.5H2O2', { H2: '1.5 mol' }, 'H2O')
    expect(r.targetMoles ?? 0, '1.5 mol de H₂ dan 1.0 mol de H₂O, no 1.5').toBeCloseTo(1.0, 12)
    expect(Math.abs((r.targetGrams ?? 0) - 18.015)).toBeLessThan(1e-3)
    expect(r.lines.map((l) => l.coefficient.toString())).toEqual(['3', '2', '2', '1'])
  })

  it('½ O₂ no cuenta como 1', () => {
    expect(Stoichiometry.solve('H2 + 0.5 O2 -> H2O', { O2: '0.5 mol' }, 'H2O').targetMoles ?? 0).toBeCloseTo(1.0, 12)
  })

  it('el escalado da enteros primitivos', () => {
    const r = balance('4.5H2 + 3O2 -> 3H2O + 1.5H2O2')
    expect(r.status).toBe('alreadyBalanced')
    expect(r.coefficients, '9,6,6,3 dividido entre 3').toEqual([3, 2, 2, 1])
    expect(coefficients(r.equation?.coefficients)).toEqual(['3', '2', '2', '1'])
    expect(r.message).toContain('enteros primitivos')
    const s = balance('1.5H2 + O2 -> H2O + 0.5H2O2')
    expect(s.status).toBe('alreadyBalanced')
    expect(s.coefficients).toEqual([3, 2, 2, 1])
    expect(coefficients(s.equation?.coefficients)).toEqual(['3', '2', '2', '1'])
  })
})

describe('CH-14 · aritmética exacta en los extremos', () => {
  it('Int.min se conserva (y en TypeScript nada se desborda)', () => {
    const min = Rational.int(-9223372036854775808n)
    expect(min.toString()).toBe('-9223372036854775808')
    expect(min.toNumber()).toBe(-9223372036854775808)
    expect(min.mul(Rational.ONE).equals(min)).toBe(true)
    expect(min.div(Rational.ONE)?.equals(min)).toBe(true)
    expect(min.add(Rational.ONE).toString()).toBe('-9223372036854775807')
    expect(min.sub(Rational.int(-1)).toString()).toBe('-9223372036854775807')
    expect(min.sub(min).equals(Rational.ZERO)).toBe(true)
    expect(min.div(min)?.equals(Rational.ONE)).toBe(true)
    // Donde Swift devolvía `nil` por desbordamiento, aquí el resultado es exacto.
    expect(min.sub(Rational.ONE).toString()).toBe('-9223372036854775809')
    expect(min.neg().toString()).toBe('9223372036854775808')
    expect(Rational.of(1, -9223372036854775808n)?.toString()).toBe('-1/9223372036854775808')
  })
})

describe('CH-11 y CH-12 · disoluciones y rendimiento', () => {
  it('molaridad y molalidad rechazan un soluto no positivo', () => {
    expect(() => Solutions.molarity(q('-0.5 mol'), null, q('1 L'))).toThrow(ChemError)
    expect(() => Solutions.molarity(q('-5 g'), F('NaCl'), q('1 L'))).toThrow(ChemError)
    expect(() => Solutions.molarity(q('0 mol'), null, q('1 L'))).toThrow(ChemError)
    expect(() => Solutions.molality(q('-0.5 mol'), null, q('500 g'))).toThrow(ChemError)
    expect(() => Solutions.molality(q('0 mol'), null, q('500 g'))).toThrow(ChemError)
  })

  it('un rendimiento real negativo se rechaza', () => {
    expect(() => Stoichiometry.solve('N2 + H2 -> NH3', { N2: '28.0 g', H2: '10.0 g' }, 'NH3', '-5.0 g')).toThrow(ChemError)
    const r = Stoichiometry.solve('N2 + H2 -> NH3', { N2: '28.0 g', H2: '10.0 g' }, 'NH3', '25.0 g')
    expect(Math.abs((r.percentYield ?? 0) - 73.43)).toBeLessThan(0.01)
  })
})

describe('CH-09 · unidad del resultado del gas ideal', () => {
  it('se respeta si la magnitud coincide', () => {
    const n = Gases.idealGas({ pressure: q('1.00 atm'), volume: q('24.5 L'), amount: null, temperature: q('298.15 K'), resultUnit: 'millimole' })
    expect(n.unit).toBe('mmol')
    expect(n.value).toBeCloseTo((24.5 / (ChemConstants.gasConstantLatm * 298.15)) * 1000, 6)
    const v = Gases.idealGas({ pressure: q('1.00 atm'), volume: null, amount: q('1.00 mol'), temperature: q('273.15 K'), resultUnit: 'milliliter' })
    expect(v.unit).toBe('mL')
    expect(Math.abs(v.value - 22_414)).toBeLessThan(1)
    const t = Gases.idealGas({ pressure: q('1 atm'), volume: q('24.5 L'), amount: q('1 mol'), temperature: null, resultUnit: 'celsius' })
    expect(t.unit).toBe('°C')
    expect(t.value).toBeCloseTo(24.5 / ChemConstants.gasConstantLatm - 273.15, 6)
  })

  it('una unidad de otra magnitud se rechaza', () => {
    const ideal = Gases.idealGas
    expect(() => ideal({ pressure: q('1 atm'), volume: null, amount: q('1 mol'), temperature: q('273.15 K'), resultUnit: 'pascal' })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: null, amount: q('1 mol'), temperature: q('273.15 K'), resultUnit: 'mole' })).toThrow(ChemError)
    expect(() => ideal({ pressure: null, volume: q('10 L'), amount: q('1 mol'), temperature: q('298 K'), resultUnit: 'kilogram' })).toThrow(ChemError)
    expect(() => ideal({ pressure: q('1 atm'), volume: q('10 L'), amount: q('1 mol'), temperature: null, resultUnit: 'liter' })).toThrow(ChemError)
  })
})
