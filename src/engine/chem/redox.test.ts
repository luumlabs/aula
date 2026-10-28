// Portado de la app Swift anterior: Tests/ChemKitTests/RedoxTests.swift y AuditOxidationChargeTests.swift.

import { describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import { ChemicalEquation } from './equation'
import { OxidationStates, redoxAnalysis, redoxAnalysisOf } from './redox'
import { Rational } from './rational'
import { oxidationStatesInfo } from './tools'

/** (especie, {símbolo: número de oxidación esperado}) */
const CASES: readonly (readonly [string, Readonly<Record<string, string>>])[] = [

  ['KMnO4', { K: '+1', Mn: '+7', O: '-2' }], ['K2Cr2O7', { K: '+1', Cr: '+6', O: '-2' }],
  ['H2SO4', { H: '+1', S: '+6', O: '-2' }], ['H2SO3', { S: '+4' }], ['Na2S2O3', { Na: '+1', S: '+2' }],
  ['S4O6^2-', { S: '+5/2' }], ['H2S', { H: '+1', S: '-2' }], ['SO2', { S: '+4' }], ['SO3', { S: '+6' }], ['S8', { S: '0' }],
  ['NH3', { N: '-3', H: '+1' }], ['NH4+', { N: '-3' }], ['HNO3', { N: '+5' }], ['HNO2', { N: '+3' }], ['NO2', { N: '+4' }],
  ['NO', { N: '+2' }], ['N2O', { N: '+1' }], ['N2', { N: '0' }], ['N2H4', { N: '-2' }], ['HN3', { N: '-1/3' }],
  ['NH4NO3', { N: '+1', H: '+1', O: '-2' }], ['H2O2', { O: '-1', H: '+1' }], ['Na2O2', { O: '-1' }], ['BaO2', { Ba: '+2', O: '-1' }],
  ['KO2', { K: '+1', O: '-1/2' }], ['OF2', { O: '+2', F: '-1' }], ['O3', { O: '0' }], ['NaH', { Na: '+1', H: '-1' }],
  ['CaH2', { H: '-1' }], ['LiAlH4', { Li: '+1', Al: '+3', H: '-1' }], ['NaBH4', { B: '+3', H: '-1' }], ['B2H6', { B: '+3', H: '-1' }],
  ['SiH4', { Si: '+4', H: '-1' }], ['Fe3O4', { Fe: '+8/3' }], ['Fe2O3', { Fe: '+3' }], ['FeO', { Fe: '+2' }],
  ['FeS2', { Fe: '+2', S: '-1' }], ['CH4', { C: '-4' }], ['CO', { C: '+2' }], ['CO2', { C: '+4' }], ['C6H12O6', { C: '0' }],
  ['CH3OH', { C: '-2' }], ['CH2O', { C: '0' }], ['HCOOH', { C: '+2' }], ['C2H2', { C: '-1' }], ['CH3COOH', { C: '0' }],
  ['C2H5OH', { C: '-2' }], ['CO3^2-', { C: '+4' }], ['HCO3-', { C: '+4' }], ['C2O4^2-', { C: '+3' }], ['CrO4^2-', { Cr: '+6' }],
  ['Cr2O7^2-', { Cr: '+6' }], ['MnO4-', { Mn: '+7' }], ['MnO4^2-', { Mn: '+6' }], ['MnO2', { Mn: '+4' }], ['ClO-', { Cl: '+1' }],
  ['ClO2-', { Cl: '+3' }], ['ClO3-', { Cl: '+5' }], ['ClO4-', { Cl: '+7' }], ['HClO', { Cl: '+1' }], ['Cl2O7', { Cl: '+7' }],
  ['ICl', { I: '+1', Cl: '-1' }], ['IF5', { I: '+5' }], ['BrF3', { Br: '+3' }], ['CCl4', { C: '+4', Cl: '-1' }],
  ['CHCl3', { C: '+2' }], ['NCl3', { N: '+3' }], ['SOCl2', { S: '+4' }], ['K4[Fe(CN)6]', { K: '+1', Fe: '+2', C: '+2', N: '-3' }],
  ['K3[Fe(CN)6]', { Fe: '+3' }], ['[Cu(NH3)4]SO4', { Cu: '+2', N: '-3', S: '+6' }], ['Hg2Cl2', { Hg: '+1' }], ['Hg2^2+', { Hg: '+1' }],
  ['Pb3O4', { Pb: '+8/3' }], ['PbO2', { Pb: '+4' }], ['CuSO4·5H2O', { Cu: '+2', S: '+6', H: '+1', O: '-2' }], ['CaC2', { C: '-1' }],
  ['KSCN', { S: '-2', C: '+4', N: '-3' }], ['XeF4', { Xe: '+4' }], ['XeO3', { Xe: '+6' }], ['UO2^2+', { U: '+6' }],
  ['P4O10', { P: '+5' }], ['H3PO4', { P: '+5' }], ['PH3', { P: '-3' }], ['H3PO3', { P: '+3' }], ['Fe', { Fe: '0' }],
  ['Fe3+', { Fe: '+3' }], ['Cl-', { Cl: '-1' }], ['O2^2-', { O: '-1' }], ['Fe2(SO4)3', { Fe: '+3', S: '+6' }],
  ['(NH4)2SO4', { N: '-3', S: '+6' }], ['Ca(OH)2', { Ca: '+2', O: '-2', H: '+1' }], ['NaCl', { Na: '+1', Cl: '-1' }],
  ['Al2(SO4)3', { Al: '+3', S: '+6' }], ['KClO3', { Cl: '+5' }], ['NaClO', { Cl: '+1' }], ['D2O', { H: '+1', O: '-2' }],
  ['NaHCO3', { Na: '+1', C: '+4' }], ['Cu2O', { Cu: '+1' }], ['CuO', { Cu: '+2' }], ['SnCl4', { Sn: '+4' }],
  ['H2CrO4', { Cr: '+6' }], ['NaNO2', { N: '+3' }], ['Ca3(PO4)2', { P: '+5' }], ['TiO2', { Ti: '+4' }],
]

function errorText(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ChemError ? e.message : String(e)
  }
}

describe('Números de oxidación', () => {
  it('casos de libro (y la suma es la carga)', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100)
    for (const [species, expected] of CASES) {
      const r = OxidationStates.analyze(species)
      for (const [symbol, value] of Object.entries(expected)) {
        expect(r.stateOf(symbol)?.signedString(), `${species} ${symbol}: ${r.summary}`).toBe(value)
      }
      let sum = Rational.ZERO
      for (const e of r.entries) sum = sum.add(e.state.mul(e.count))
      expect(sum.equals(Rational.int(r.formula.charge)), species).toBe(true)
      expect(r.steps.length, species).toBeGreaterThan(0)
    }
  })

  it('entornos distintos del mismo elemento', () => {
    const r = OxidationStates.analyze('NH4NO3')
    const n = r.entries.find((e) => e.element.symbol === 'N')
    expect(n?.state.equals(Rational.ONE)).toBe(true)
    expect(new Set(n?.sites.map((s) => s.state.toString()))).toEqual(new Set(['-3', '5']))
    expect(r.summary).toBe('N: +1 (-3 en NH₄⁺, +5 en NO₃⁻), H: +1, O: -2')
    expect(OxidationStates.analyze('Fe3O4').warnings.some((w) => w.includes('promedio'))).toBe(true)
    expect(OxidationStates.analyze('I3-').steps).toContain('En I₃⁻ los 3 átomos son iguales: -1 ÷ 3 = -1/3.')
  })

  it('casos indeterminados o no válidos', () => {
    expect(() => OxidationStates.analyze('e-')).toThrow(ChemError)
    expect(errorText(() => OxidationStates.analyze('CuFeS2'))).toContain('varias combinaciones')
    expect(() => OxidationStates.analyze('Xy')).toThrow(ChemError)
  })

  it('los estados conocidos tienen que sumar la carga de la especie', () => {
    expect(errorText(() => OxidationStates.analyze('NaF2'))).toContain('no cuadra')
    expect(() => OxidationStates.analyze('KF3')).toThrow(ChemError)
    expect(oxidationStatesInfo('NaF2').ok).toBe(false)
    for (const formula of ['MgCl3', 'RbCl2', 'BaCl3', 'NaCl3', 'CaCl^-', 'MgCl3^2-', 'AlF4', 'AlF5']) {
      expect(() => OxidationStates.analyze(formula), formula).toThrow(ChemError)
    }
  })

  it('las especies reales siguen funcionando', () => {
    const state = (f: string, s: string): string | undefined => OxidationStates.analyze(f).stateOf(s)?.signedString()
    expect(state('KMnO4', 'Mn')).toBe('+7')
    expect(state('Hg2Cl2', 'Hg')).toBe('+1')
    expect(state('OF2', 'O')).toBe('+2')
    expect(state('Na2O2', 'O')).toBe('-1')
    expect(state('AlF3', 'Al')).toBe('+3')
    expect(state('AlCl3', 'Al')).toBe('+3')
    expect(state('Cl2O', 'Cl')).toBe('+1')
    expect(state('ClF3', 'Cl')).toBe('+3')
    expect(state('PCl5', 'P')).toBe('+5')
    // Los intermetálicos no tienen estados asignables por reglas: mejor error que metales negativos.
    for (const alloy of ['NiAl', 'CuAl2', 'TiAl', 'CoAl']) expect(() => OxidationStates.analyze(alloy), alloy).toThrow(ChemError)
  })
})

describe('Análisis redox de ecuaciones', () => {
  it('desplazamiento simple', () => {
    const a = redoxAnalysisOf('Zn + Cu2+ -> Zn2+ + Cu')
    expect(a.isRedox).toBe(true)
    expect(a.oxidations[0]?.element.symbol).toBe('Zn')
    expect(a.oxidations[0]?.from.equals(Rational.ZERO)).toBe(true)
    expect(a.oxidations[0]?.to.equals(Rational.int(2))).toBe(true)
    expect(a.reductions[0]?.element.symbol).toBe('Cu')
    expect(a.reducingAgents.map((f) => f.plainText)).toEqual(['Zn'])
    expect(a.oxidizingAgents.map((f) => f.plainText)).toEqual(['Cu^2+'])
    expect(a.electronsTransferred).toBe(2)
    expect(a.summary).toContain('El Zn se oxida (0 → +2)')
  })

  it('permanganato y hierro', () => {
    const a = redoxAnalysisOf('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O')
    expect(a.electronsTransferred).toBe(5)
    expect(a.oxidizingAgents.map((f) => f.unicodeText)).toEqual(['MnO₄⁻'])
    expect(a.reducingAgents.map((f) => f.unicodeText)).toEqual(['Fe²⁺'])
    expect(redoxAnalysis(ChemicalEquation.parse('MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O')).electronsTransferred).toBe(5)
  })

  it('dismutación y comproporción', () => {
    const d = redoxAnalysisOf('Cl2 + OH- -> Cl- + ClO3- + H2O')
    expect(d.isDisproportionation).toBe(true)
    expect(d.electronsTransferred).toBe(5)
    expect(d.summary).toContain('dismutación')
    const c = redoxAnalysisOf('IO3- + I- + H+ -> I2 + H2O')
    expect(c.isComproportionation).toBe(true)
    expect(c.electronsTransferred).toBe(5)
    const peroxide = redoxAnalysisOf('H2O2 -> H2O + O2')
    expect(peroxide.isDisproportionation).toBe(true)
    expect(peroxide.electronsTransferred).toBe(2)
  })

  it('redox con fórmulas moleculares', () => {
    expect(redoxAnalysisOf('2H2 + O2 -> 2H2O').electronsTransferred).toBe(4)
    expect(redoxAnalysisOf('4Fe + 3O2 -> 2Fe2O3').electronsTransferred).toBe(12)
    const hcl = redoxAnalysisOf('KMnO4 + HCl -> KCl + MnCl2 + Cl2 + H2O')
    expect(hcl.electronsTransferred).toBe(10)
    expect(hcl.oxidizingAgents.map((f) => f.plainText)).toEqual(['KMnO4'])
    expect(hcl.reducingAgents.map((f) => f.plainText)).toEqual(['HCl'])
    const h2o2 = redoxAnalysisOf('MnO4- + H2O2 + H+ -> Mn2+ + O2 + H2O')
    expect(h2o2.electronsTransferred).toBe(10)
    expect(h2o2.oxidations.map((o) => o.element.symbol)).toEqual(['O'])
    expect(h2o2.oxidations[0]?.from.equals(Rational.int(-1))).toBe(true)
  })

  it('reacciones que no son redox', () => {
    const a = redoxAnalysisOf('NaOH + HCl -> NaCl + H2O')
    expect(a.isRedox).toBe(false)
    expect(a.electronsTransferred).toBeNull()
    expect(a.summary).toBe('No es una reacción redox: ningún elemento cambia de número de oxidación.')
    expect(redoxAnalysisOf('AgNO3 + NaCl -> AgCl + NaNO3').isRedox).toBe(false)
    expect(redoxAnalysisOf('CaCO3 -> CaO + CO2').isRedox).toBe(false)
  })

  it('semirreacción con electrones', () => {
    const a = redoxAnalysisOf('Fe3+ + e- -> Fe2+')
    expect(a.reductions[0]?.element.symbol).toBe('Fe')
    expect(a.oxidations.length).toBe(0)
  })
})
