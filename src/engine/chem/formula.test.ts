// Portado de la app Swift anterior: Tests/ChemKitTests/FormulaParserTests.swift y CompositionTests.swift.

import { describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import { PeriodicTable } from './elements'
import { AtomKey, Formula, compositionsEqual } from './formula'
import { EmpiricalFormula } from './composition'
import { FORMULA_MAX_DEPTH, FORMULA_MAX_LENGTH, parseFormula } from './parser'
import { Rational } from './rational'
import { chargeText } from './text'
import { INVALID, VALID } from './formula-fixtures.testutil'

const F = (s: string): Formula => Formula.parse(s)

function message(input: string): string {
  try {
    parseFormula(input)
    return 'OK'
  } catch (e) {
    return e instanceof ChemError ? e.message : String(e)
  }
}

function thrown(f: () => unknown): ChemError | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ChemError ? e : null
  }
}

describe('Analizador de fórmulas', () => {
  it('fórmulas válidas (y sus formas canónicas se vuelven a leer igual)', () => {
    expect(VALID.length).toBeGreaterThanOrEqual(140)
    for (const [input, hill, charge] of VALID) {
      const f = parseFormula(input)
      expect(f.hillFormula, input).toBe(charge === 0 ? hill : hill + '^' + chargeText(charge))
      expect(f.charge, input).toBe(charge)
      const again = parseFormula(f.plainText)
      expect(compositionsEqual(again.composition, f.composition), input).toBe(true)
      expect(again.charge, input).toBe(f.charge)
      expect(again.identityKey, input).toBe(f.identityKey)
      expect(parseFormula(f.unicodeText).identityKey, input).toBe(f.identityKey)
      expect(parseFormula(f.latex).identityKey, input).toBe(f.identityKey)
      // mhchem: la misma especie (sin «\ce{}» que el analizador quita).
      expect(parseFormula(f.ce).identityKey, input).toBe(f.identityKey)
    }
  })

  it('formas canónicas', () => {
    const f = F('Ca(OH)2')
    expect(f.plainText).toBe('Ca(OH)2')
    expect(f.unicodeText).toBe('Ca(OH)₂')
    expect(f.latex).toBe('\\mathrm{Ca(OH)_{2}}')
    expect(f.ce).toBe('\\ce{Ca(OH)2}')
    const s = F('SO₄²⁻')
    expect(s.plainText).toBe('SO4^2-')
    expect(s.latex).toBe('\\mathrm{SO_{4}^{2-}}')
    expect(s.ce).toBe('\\ce{SO4^2-}')
    expect(F('CuSO4.5H2O').unicodeText).toBe('CuSO₄·5H₂O')
    expect(F('CuSO4.5H2O').latex).toBe('\\mathrm{CuSO_{4}\\cdot 5H_{2}O}')
    expect(F('CuSO4.5H2O').ce).toBe('\\ce{CuSO4*5H2O}')
    expect(F('[Fe(CN)6]3-').unicodeText).toBe('[Fe(CN)₆]³⁻')
    expect(F('NH4+').unicodeText).toBe('NH₄⁺')
    expect(F('e-').unicodeText).toBe('e⁻')
    expect(F('H2O(l)').unicodeText).toBe('H₂O(l)')
    expect(F('2H2O').toString()).toBe('2 H₂O')
    expect(F('1/2 O2').text('latex', true, false)).toBe('\\frac{1}{2}\\,\\mathrm{O_{2}}')
    expect(F('C6H12O6').hillFormula).toBe('C6H12O6')
    expect(F('CH3OH').hillFormula).toBe('CH4O')
    expect(F('D2O').unicodeText).toBe('D₂O')
    expect(F('^{14}CO2').unicodeText).toBe('¹⁴CO₂')
  })

  it('coeficiente, estado y electrón', () => {
    const f = F('2 H2O(l)')
    expect(f.coefficient?.equals(Rational.int(2))).toBe(true)
    expect(f.state).toBe('l')
    expect(F('1/2 O2').coefficient?.toString()).toBe('1/2')
    expect(F('0.5 O2').coefficient?.toString()).toBe('1/2')
    expect(F('½O2').coefficient?.toString()).toBe('1/2')
    expect(F('3/2O2').coefficient?.toString()).toBe('3/2')
    expect(F('H2O').coefficient).toBeNull()
    for (const e of ['e-', 'e^-', 'e⁻', 'e^{-}', 'e', '3e-']) {
      const x = F(e)
      expect(x.isElectron, e).toBe(true)
      expect(x.charge, e).toBe(-1)
    }
    expect(F('3e-').coefficient?.toString()).toBe('3')
    expect(F('NaCl(aq)').state).toBe('aq')
    expect(F('NaCl(ac)').state).toBe('aq')
    expect(F('CO2(g)').state).toBe('g')
    expect(F('Fe(s)').state).toBe('s')
    expect(F('H2O(l)').withoutState().state).toBeNull()
  })

  it('recuento de átomos', () => {
    const f = F('Al2(SO4)3')
    expect(f.countOfSymbol('Al')).toBe(2)
    expect(f.countOfSymbol('S')).toBe(3)
    expect(f.countOfSymbol('O')).toBe(12)
    expect(f.atomCount).toBe(17)
    expect(f.elements.map((e) => e.symbol)).toEqual(['Al', 'S', 'O'])
    const h = F('CuSO4·5H2O')
    expect(h.countOfSymbol('O')).toBe(9)
    expect(h.countOfSymbol('H')).toBe(10)
    expect(h.isHydrate).toBe(true)
    const d = F('CH3D')
    expect(d.countOfSymbol('H')).toBe(3)
    expect(d.countOfSymbol('D')).toBe(1)
    const hydrogen = PeriodicTable.bySymbol('H')
    expect(hydrogen && d.countOf(hydrogen)).toBe(4)
    expect(F('O2').isElementalSubstance).toBe(true)
    expect(F('O2^2-').isElementalSubstance).toBe(false)
    expect(F('Fe3+').isMonatomic).toBe(true)
  })

  it('heurísticas de las cargas ambiguas', () => {
    expect(compositionsEqual(F('O2-').composition, F('O').composition)).toBe(true) // óxido, no superóxido
    expect(compositionsEqual(F('O2^-').composition, F('O2').composition)).toBe(true) // superóxido sin ambigüedad
    expect(F('N3-').charge).toBe(-3) // nitruro
    expect(F('N3^-').countOfSymbol('N')).toBe(3) // azida
    expect(F('I3-').countOfSymbol('I')).toBe(3) // triyoduro
    expect(F('Ag(NH3)2+').countOfSymbol('N')).toBe(2) // tras «)» el dígito es subíndice
    expect(F('[Cu(NH3)4]2+').charge).toBe(2) // tras «]» el dígito es carga
  })
})

describe('Errores del analizador', () => {
  it('mensajes amables y precisos', () => {
    expect(message('')).toBe('La fórmula está vacía.')
    expect(message('   ')).toBe('La fórmula está vacía.')
    expect(message('Xy')).toBe('«Xy» no es un símbolo químico.')
    expect(message('co')).toBe('Los símbolos empiezan por mayúscula: ¿Co (cobalto) o CO (monóxido de carbono)?')
    expect(message('h2o')).toBe('Los símbolos empiezan por mayúscula: ¿quisiste decir H2O (agua)?')
    expect(message('nacl')).toBe('Los símbolos empiezan por mayúscula: ¿quisiste decir NaCl (cloruro de sodio)?')
    expect(message('NACL')).toBe('«A» no es un símbolo químico. ¿Quisiste decir NaCl (cloruro de sodio)?')
    expect(message('CL2')).toBe('«L» no es un símbolo químico. ¿Quisiste decir Cl2 (cloro)?')
    expect(message('Ca(OH')).toBe('Falta cerrar un paréntesis.')
    expect(message('[Fe(CN)6')).toBe('Falta cerrar un corchete «[».')
    expect(message('Ca(OH]2')).toBe('El «(» se cierra con «]»: usa el mismo tipo de paréntesis para abrir y cerrar.')
    expect(message('H2O)')).toBe('Sobra un «)»: se cierra algo que no se había abierto.')
    expect(message('()')).toBe('Hay un paréntesis vacío.')
    expect(message('H0')).toBe('Un subíndice no puede ser 0: si el elemento no está, no lo escribas.')
    expect(message('2')).toBe('«2» es solo un número: falta la fórmula química.')
    expect(message('Na+Cl')).toContain('en medio')
    expect(message('H 2 O')).toContain('«2»')
    expect(message('€')).toBe('No entiendo «€» dentro de una fórmula química.')
    expect(message('H99999999')).toContain('demasiado grande')
  })

  it('las fórmulas inválidas lanzan ChemError con mensaje', () => {
    expect(INVALID.length).toBeGreaterThanOrEqual(55)
    for (const input of INVALID) {
      const e = thrown(() => parseFormula(input))
      expect(e, input).not.toBeNull()
      expect(e?.message.length ?? 0, input).toBeGreaterThan(0)
    }
    expect(VALID.length + INVALID.length).toBeGreaterThanOrEqual(150)
  })

  it('entradas hostiles', () => {
    const start = Date.now()
    expect(parseFormula('H'.repeat(10_000)).countOfSymbol('H')).toBe(10_000)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(() => parseFormula('Xq'.repeat(5_000))).toThrow()
    expect(() => parseFormula('😀'.repeat(10_000))).toThrow()
    expect(thrown(() => parseFormula('H'.repeat(25_000)))?.equals(ChemError.tooLong(FORMULA_MAX_LENGTH))).toBe(true)
    // 500 niveles de paréntesis: error amable, sin colgarse ni reventar la pila.
    const deep = '('.repeat(500) + 'H' + ')'.repeat(500)
    expect(thrown(() => parseFormula(deep))?.equals(ChemError.tooDeep(FORMULA_MAX_DEPTH))).toBe(true)
    const deepCounts = '('.repeat(90) + 'H' + ')2'.repeat(90)
    expect(thrown(() => parseFormula(deepCounts))?.equals(ChemError.quantityTooLarge())).toBe(true)
    // 100 niveles se aceptan.
    expect(parseFormula('('.repeat(99) + 'H' + ')'.repeat(99)).countOfSymbol('H')).toBe(1)
    expect(() => parseFormula('((H999999)999999)999999')).toThrow()
    // Sugerencias de mayúsculas sin explosión combinatoria.
    const t0 = Date.now()
    expect(() => parseFormula('co'.repeat(19) + 'x')).toThrow()
    expect(() => parseFormula('co'.repeat(20))).toThrow()
    expect(Date.now() - t0).toBeLessThan(500)
    expect(() => parseFormula('(H'.repeat(2_000))).toThrow()
  })

  it('comparaciones', () => {
    expect(F('H_2O').compare(F('H2O'))).toBe('identical')
    expect(F('CH3COOH').compare(F('C2H4O2'))).toBe('sameComposition')
    expect(F('CH2O').compare(F('C6H12O6'))).toBe('sameEmpiricalFormula')
    expect(F('Fe2+').compare(F('Fe3+'))).toBe('differentCharge')
    expect(F('NaCl').compare(F('KCl'))).toBe('different')
    expect(F('CuSO4·5H2O').compare(F('CuSO4.5H2O'))).toBe('identical')
    expect(F('C2H5OH').isSameSpecies(F('CH3CH2OH'))).toBe(true)
    expect(F('CO').isSameSpecies(F('Co'))).toBe(false)
    expect(F('C6H12O6').empiricalFormula.plainText).toBe('CH2O')
    expect(F('CH3COOH').condensed.plainText).toBe('C2H4O2')
    expect(F('Na2SO4').condensed.plainText).toBe('Na2SO4')
    const n = PeriodicTable.bySymbol('N')
    const h = PeriodicTable.bySymbol('H')
    if (!n || !h) throw new Error('faltan elementos')
    const comp = new Map([[AtomKey.ofElement(n), 1], [AtomKey.ofElement(h), 3]])
    expect(Formula.fromComposition(comp).plainText).toBe('NH3')
  })

  it('JSON de ida y vuelta', () => {
    const f = F('2 Fe2(SO4)3(aq)')
    const json = JSON.stringify(f)
    expect(json).toBe('"2Fe2(SO4)3(aq)"')
    const back = Formula.fromJSON(JSON.parse(json) as string)
    expect(back.equals(f)).toBe(true)
    expect(() => Formula.fromJSON('Xy')).toThrow()
  })
})

describe('Masa molar y composición', () => {
  const mm = (f: string): number => F(f).molarMass

  it('masas molares de los libros', () => {
    const expected: [string, number, string][] = [
      ['H2O', 18.015, '18.015 g/mol'], ['CO2', 44.009, '44.009 g/mol'], ['NaCl', 58.44, '58.44 g/mol'],
      ['CaCO3', 100.086, '100.086 g/mol'], ['C6H12O6', 180.156, '180.156 g/mol'], ['H2SO4', 98.072, '98.07 g/mol'],
      ['NH3', 17.031, '17.031 g/mol'], ['Fe2O3', 159.687, '159.687 g/mol'], ['Ca(OH)2', 74.092, '74.092 g/mol'],
      ['Al2(SO4)3', 342.132, '342.13 g/mol'], ['CuSO4·5H2O', 249.677, '249.68 g/mol'], ['KMnO4', 158.032, '158.032 g/mol'],
      ['K4[Fe(CN)6]', 368.345, '368.345 g/mol'], ['(NH4)2SO4', 132.134, '132.13 g/mol'], ['C8H18', 114.232, '114.232 g/mol'],
      ['Mg3(PO4)2', 262.855, '262.855 g/mol'], ['NaHCO3', 84.006, '84.006 g/mol'], ['C12H22O11', 342.297, '342.297 g/mol'],
      ['Pb(NO3)2', 331.208, '331.2 g/mol'], ['SO4^2-', 96.056, '96.06 g/mol'], ['O2', 31.998, '31.998 g/mol'],
      ['N2', 28.014, '28.014 g/mol'], ['CH4', 16.043, '16.043 g/mol'], ['NaOH', 39.997, '39.997 g/mol'],
      ['KClO3', 122.545, '122.55 g/mol'], ['C3H8', 44.097, '44.097 g/mol'], ['Fe', 55.845, '55.845 g/mol'],
    ]
    for (const [f, value, text] of expected) {
      const d = F(f).molarMassDetails()
      expect(Math.abs(d.value - value), f).toBeLessThan(0.0005)
      expect(d.formatted, f).toBe(text)
      expect(d.isApproximate, f).toBe(false)
    }
  })

  it('isótopos y masas aproximadas', () => {
    const d2o = F('D2O').molarMassDetails()
    expect(Math.abs(d2o.value - 20.027)).toBeLessThan(0.001)
    expect(d2o.isApproximate).toBe(false)
    expect(Math.abs(mm('^{14}CO2') - (14.0032 + 31.998))).toBeLessThan(0.001)
    const tc = F('TcO4-').molarMassDetails()
    expect(tc.isApproximate).toBe(true)
    expect(Math.abs(tc.value - (98 + 63.996))).toBeLessThan(0.001)
    expect(F('^{57}Fe').molarMassDetails().isApproximate).toBe(true)
    expect(Math.abs(mm('e-') - 5.4858e-4)).toBeLessThan(1e-8)
  })

  it('la masa molar es la suma de sus partes', () => {
    for (const [input] of VALID) {
      const f = parseFormula(input)
      if (f.isElectron) continue
      let manual = 0
      for (const [k, n] of f.composition) manual += n * k.mass
      expect(Math.abs(f.molarMass - manual), input).toBeLessThan(1e-9)
      const d = f.molarMassDetails()
      expect(Math.abs(d.contributions.reduce((a, c) => a + c.subtotal, 0) - d.value), input).toBeLessThan(1e-9)
      expect(Math.abs(d.contributions.reduce((a, c) => a + c.massPercent, 0) - 100), input).toBeLessThan(1e-6)
    }
    expect(Math.abs(mm('CuSO4·5H2O') - mm('CuSO9H10'))).toBeLessThan(1e-9)
    expect(Math.abs(mm('Ca(OH)2') - mm('CaO2H2'))).toBeLessThan(1e-9)
    expect(Math.abs(mm('2H2O') - mm('H2O'))).toBeLessThan(1e-12) // el coeficiente no cuenta
  })

  it('composición porcentual', () => {
    const p = F('H2O').percentComposition
    expect(p.map((x) => x.element.symbol)).toEqual(['H', 'O'])
    expect(p[0].percent).toBeCloseTo((2.016 / 18.015) * 100, 9)
    expect(Math.abs(p[1].percent - 88.81)).toBeLessThan(0.01)
    const glucose = F('C6H12O6').percentComposition
    expect(Math.abs((glucose.find((x) => x.element.symbol === 'C')?.percent ?? 0) - 40.0)).toBeLessThan(0.01)
    expect(Math.abs((glucose.find((x) => x.element.symbol === 'O')?.percent ?? 0) - 53.29)).toBeLessThan(0.01)
  })

  it('fórmula empírica a partir de porcentajes y masas', () => {
    expect(EmpiricalFormula.fromPercentages([['C', 40.0], ['H', 6.7], ['O', 53.3]]).formula.plainText).toBe('CH2O')
    expect(EmpiricalFormula.fromPercentages([['C', 85.6], ['H', 14.4]]).formula.plainText).toBe('CH2')
    const fe = EmpiricalFormula.fromPercentages([['Fe', 69.94], ['O', 30.06]])
    expect(fe.formula.plainText).toBe('Fe2O3')
    expect(fe.multiplier).toBe(2) // 1 : 1.5 → ×2
    const vitC = EmpiricalFormula.fromPercentages([['C', 40.92], ['H', 4.58], ['O', 54.5]])
    expect(vitC.formula.plainText).toBe('C3H4O3') // 1 : 1.33 : 1 → ×3
    expect(vitC.multiplier).toBe(3)
    expect(EmpiricalFormula.fromPercentages([['Na', 32.37], ['S', 22.57], ['O', 45.06]]).formula.plainText).toBe('Na2SO4')
    expect(EmpiricalFormula.fromPercentages([['K', 26.58], ['Cr', 35.35], ['O', 38.07]]).formula.plainText).toBe('K2Cr2O7')
    expect(EmpiricalFormula.fromPercentages([['N', 30.4], ['O', 69.6]]).formula.plainText).toBe('NO2')
    expect(EmpiricalFormula.fromPercentages([['carbono', 92.3], ['hidrógeno', 7.7]]).formula.plainText).toBe('CH')
    // 1 : 1.25 → ×4 (no confundir con 1 : 1.2 → ×5).
    expect(EmpiricalFormula.fromMasses([['C', 12.011 * 4], ['H', 1.008 * 5]]).formula.plainText).toBe('C4H5')
    expect(EmpiricalFormula.fromMasses([['C', 12.011 * 5], ['H', 1.008 * 6]]).formula.plainText).toBe('C5H6')
    const suma = EmpiricalFormula.fromPercentages([['C', 40.0], ['H', 6.7]])
    expect(suma.steps.some((s) => s.includes('no 100 %'))).toBe(true)
  })

  it('errores de la fórmula empírica', () => {
    expect(() => EmpiricalFormula.fromPercentages([])).toThrow()
    expect(() => EmpiricalFormula.fromPercentages([['Xy', 50], ['O', 50]])).toThrow()
    expect(() => EmpiricalFormula.fromPercentages([['C', -5], ['O', 50]])).toThrow()
    expect(() => EmpiricalFormula.fromPercentages([['C', NaN], ['O', 50]])).toThrow()
    expect(() => EmpiricalFormula.fromMasses([['C', 1e300], ['H', 1e-300]])).toThrow()
    expect(() => EmpiricalFormula.molecularFormula(F('CH2O'), 1e300)).toThrow()
  })

  it('fórmula molecular', () => {
    const r = EmpiricalFormula.molecularFormula(F('CH2O'), 180.16)
    expect(r.formula.plainText).toBe('C6H12O6')
    expect(r.factor).toBe(6)
    expect(EmpiricalFormula.molecularFormula(F('CH'), 78.11).formula.plainText).toBe('C6H6')
    expect(EmpiricalFormula.molecularFormula(F('NO2'), 92.0).formula.plainText).toBe('N2O4')
    expect(EmpiricalFormula.molecularFormula(F('P2O5'), 283.9).formula.plainText).toBe('P4O10')
    expect(() => EmpiricalFormula.molecularFormula(F('CH2O'), 100)).toThrow()
    expect(() => EmpiricalFormula.molecularFormula(F('CH2O'), -1)).toThrow()
  })
})
