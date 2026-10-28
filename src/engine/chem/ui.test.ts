// Pruebas de la API para la interfaz y del índice público del motor de química.

import { afterEach, describe, expect, it } from 'vitest'
import * as chem from './index'
import {
  balanceSummary, chemKeyNumber, checkChemAnswer, elementCategories, molarMassBreakdown, searchElements, setChemLanguage,
} from './index'

describe('Índice público', () => {
  it('expone las piezas principales', () => {
    for (const name of [
      'PeriodicTable', 'ALL_ELEMENTS', 'ElectronConfiguration', 'Formula', 'parseFormula', 'ChemicalEquation', 'balance', 'OxidationStates',
      'ChemQuantity', 'Stoichiometry', 'Solutions', 'Gases', 'AcidBase', 'SigFigs', 'Nomenclature', 'IonTable', 'ChemChecker', 'ChemTools',
      'runChemistryTool', 'CHEMISTRY_TOOL', 'checkChemAnswer', 'setChemLanguage', 'ChemError', 'Rational',
    ]) {
      expect(chem[name as keyof typeof chem], name).toBeDefined()
    }
    expect(chem.ALL_ELEMENTS.length).toBe(118)
  })
})

describe('Búsqueda de elementos', () => {
  afterEach(() => setChemLanguage('es'))

  it('ordena de más a menos parecido', () => {
    expect(searchElements('Fe')[0]?.symbol).toBe('Fe')
    expect(searchElements('26')[0]?.symbol).toBe('Fe')
    expect(searchElements('Z=8')[0]?.symbol).toBe('O')
    expect(searchElements('hierro')[0]?.symbol).toBe('Fe')
    expect(searchElements('iron')[0]?.symbol).toBe('Fe')
    expect(searchElements('co')[0]?.symbol).toBe('Co')
    const ca = searchElements('ca').map((e) => e.symbol)
    expect(ca[0]).toBe('Ca')
    expect(ca).toContain('C') // «carbono» empieza por «ca»
    expect(searchElements('fos').map((e) => e.symbol)).toContain('P')
    expect(searchElements('nio').length).toBeGreaterThan(3) // contiene «nio»
    expect(searchElements('', { limit: 5 })).toEqual([])
    expect(searchElements('a'.repeat(100))).toEqual([])
    expect(searchElements('o', { limit: 3 }).length).toBeLessThanOrEqual(3)
    expect(new Set(searchElements('n', { limit: 50 }).map((e) => e.atomicNumber)).size).toBe(searchElements('n', { limit: 50 }).length)
  })

  it('busca también en el idioma pedido', () => {
    expect(searchElements('eisen', { lang: 'de' })[0]?.symbol).toBe('Fe')
    expect(searchElements('eisen')[0]?.symbol).not.toBe('Fe')
  })
})

describe('Familias', () => {
  it('11 familias con sus elementos', () => {
    const cats = elementCategories('es')
    expect(cats.length).toBe(11)
    expect(cats.reduce((a, c) => a + c.atomicNumbers.length, 0)).toBe(118)
    const halogen = cats.find((c) => c.key === 'halogen')
    expect(halogen?.title).toBe('Halógeno')
    expect(halogen?.isMetal).toBe(false)
    expect(halogen?.atomicNumbers).toEqual([9, 17, 35, 53, 85])
    expect(elementCategories('en').find((c) => c.key === 'halogen')?.title).toBe('Halogen')
  })
})

describe('Masa molar para la interfaz', () => {
  it('desglose con nombres y textos', () => {
    const r = molarMassBreakdown('Ca(OH)2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBeCloseTo(74.092, 9)
    expect(r.formatted).toBe('74.092 g/mol')
    expect(r.ce).toBe('\\ce{Ca(OH)2}')
    expect(r.unicode).toBe('Ca(OH)₂')
    expect(r.parts.map((p) => [p.symbol, p.count])).toEqual([['Ca', 1], ['H', 2], ['O', 2]]) // orden de la IUPAC
    expect(r.parts[0].name).toBe('Calcio')
    expect(r.parts.reduce((a, p) => a + p.percent, 0)).toBeCloseTo(100, 6)
    expect(molarMassBreakdown('Ca(OH)2', { lang: 'en' }).ok && molarMassBreakdown('Ca(OH)2', { lang: 'en' })).toMatchObject({
      parts: [{ name: 'Calcium' }, { name: 'Hydrogen' }, { name: 'Oxygen' }],
    })
    const approx = molarMassBreakdown('TcO4-')
    expect(approx.ok && approx.isApproximate).toBe(true)
    expect(approx.ok && approx.charge).toBe(-1)
  })

  it('fallos con motivo', () => {
    const bad = molarMassBreakdown('co2')
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.code).toBe('lowercaseSymbol')
    expect(bad.message).toContain('CO2 (dióxido de carbono)')
    const empty = molarMassBreakdown('')
    expect(!empty.ok && empty.code).toBe('empty')
    expect(JSON.parse(JSON.stringify(bad))).toEqual(bad)
  })
})

describe('Balanceo para la interfaz', () => {
  it('coeficientes y textos', () => {
    const r = balanceSummary('Fe + O2 -> Fe2O3')
    expect(r.ok).toBe(true)
    expect(r.status).toBe('balanced')
    expect(r.coefficients).toEqual([4, 3, 2])
    expect(r.text).toBe('4 Fe + 3 O₂ → 2 Fe₂O₃')
    expect(r.plain).toBe('4 Fe + 3 O2 -> 2 Fe2O3')
    expect(r.ce).toBe('\\ce{4 Fe + 3 O2 -> 2 Fe2O3}')
    expect(r.species.map((s) => [s.side, s.coefficient, s.plain])).toEqual([
      ['reactants', 4, 'Fe'], ['reactants', 3, 'O2'], ['products', 2, 'Fe2O3'],
    ])
    expect(r.steps.length).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })

  it('medios, equilibrios y fallos', () => {
    const acid = balanceSummary('MnO4- + Fe2+ -> Mn2+ + Fe3+', 'acidic')
    expect(acid.text).toBe('MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O')
    expect(acid.species.find((s) => s.plain === 'H^+')?.ce).toBe('H^+')
    expect(balanceSummary('N2 + H2 <=> NH3').reversible).toBe(true)
    const multiple = balanceSummary('H2 + O2 -> H2O + H2O2')
    expect(multiple.ok).toBe(false)
    expect(multiple.status).toBe('multipleSolutions')
    expect(multiple.alternatives.length).toBe(2)
    const invalid = balanceSummary('H2 + O2')
    expect(invalid.status).toBe('invalid')
    expect(invalid.text).toBeNull()
    expect(invalid.species).toEqual([])
    expect(invalid.message).toBe('Falta la flecha (→) entre reactivos y productos.')
  })
})

describe('Corrector de ejercicios de química', () => {
  it('cada modo usa su corrector', () => {
    expect(checkChemAnswer({ mode: 'formula', expected: 'CuSO4·5H2O' }, 'CuSO4.5H2O').status).toBe('correct')
    expect(checkChemAnswer({ mode: 'formula', expected: 'CuSO4·5H2O' }, 'CuSO4').status).not.toBe('correct')
    const eq = { mode: 'equation', expected: '4 Fe + 3 O2 -> 2 Fe2O3' } as const
    expect(checkChemAnswer(eq, '4Fe + 3O2 -> 2Fe2O3').status).toBe('correct')
    const unbalanced = checkChemAnswer(eq, 'Fe + O2 -> Fe2O3')
    expect(unbalanced.status).not.toBe('correct')
    expect(unbalanced.feedback.length).toBeGreaterThan(0)
    const n = { mode: 'number', expected: '0.250', sigFigs: 3 } as const
    expect(checkChemAnswer(n, '0.250').status).toBe('correct')
    expect(checkChemAnswer(n, '0.3').status).not.toBe('correct')
    expect(checkChemAnswer({ mode: 'name', expected: 'cloruro de sodio' }, 'Cloruro de sodio').status).toBe('correct')
    expect(checkChemAnswer({ mode: 'configuration', expected: 'Fe2+' }, '[Ar] 3d6').status).toBe('correct')
  })

  it('respuestas vacías y claves no numéricas', () => {
    expect(checkChemAnswer({ mode: 'formula', expected: 'H2O' }, '   ')).toEqual({ status: 'invalid', feedback: 'Escribe tu respuesta primero.' })
    expect(checkChemAnswer({ mode: 'number', expected: 'mucho' }, '3').status).toBe('invalid')
    expect(chemKeyNumber('0.250')).toBe(0.25)
    expect(chemKeyNumber('2,5e-3')).toBe(0.0025)
    expect(chemKeyNumber('3/4')).toBe(0.75)
    expect(chemKeyNumber('6.02×10^23')).toBeCloseTo(6.02e23, -10)
    expect(chemKeyNumber('')).toBeNull()
    expect(chemKeyNumber('abc')).toBeNull()
    expect(chemKeyNumber('Infinity')).toBeNull()
  })
})
