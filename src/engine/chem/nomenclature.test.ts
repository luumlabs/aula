// Portado de la app Swift anterior: Tests/ChemKitTests/NomenclatureTests.swift y AuditMercuryCationTests.swift.

import { describe, expect, it } from 'vitest'
import { Formula } from './formula'
import { IonTable } from './ion-table'
import { Nomenclature } from './nomenclature'
import { OxidationStates } from './redox'
import { parseFormula } from './parser'
import { nameInfo, oxidationStatesInfo } from './tools'

const names = (f: string): readonly string[] => Nomenclature.name(f)?.allNames ?? []
const key = (f: string): string => parseFormula(f).identityKey
function formulaFor(name: string): Formula {
  const f = Nomenclature.formulaForName(name)
  if (!f) throw new Error(`sin fórmula para «${name}»`)
  return f
}

describe('Nomenclatura', () => {
  it('tabla de iones', () => {
    expect(IonTable.all.length).toBeGreaterThanOrEqual(75)
    expect(IonTable.parsed.length).toBe(IonTable.all.length) // todas las fórmulas de la tabla se leen
    for (const ion of IonTable.all) {
      const f = IonTable.formulaOf(ion)
      expect(f.charge, ion.formulaText).not.toBe(0)
      expect(ion.kind === 'cation', ion.formulaText).toBe(f.charge > 0)
    }
    const byName = new Map<string, string>()
    for (const ion of IonTable.all) if (!byName.has(ion.name)) byName.set(ion.name, ion.formulaText)
    expect(byName.get('sulfato')).toBe('SO4^2-')
    expect(byName.get('amonio')).toBe('NH4^+')
    expect(byName.get('permanganato')).toBe('MnO4^-')
    expect(byName.get('dicromato')).toBe('Cr2O7^2-')
    expect(byName.get('hierro(III)')).toBe('Fe^3+')
    expect(byName.get('mercurio(I)')).toBe('Hg2^2+')
    expect(IonTable.matching(parseFormula('NO3-'))?.name).toBe('nitrato')
    expect(IonTable.matching(parseFormula('NO3^2-'))).toBeNull()
  })

  it('fórmula → nombre', () => {
    const cases: [string, string][] = [
    ['NaCl', 'cloruro de sodio'], ['Fe2(SO4)3', 'sulfato de hierro(III)'], ['Ca(OH)2', 'hidróxido de calcio'],
    ['FeCl3', 'cloruro de hierro(III)'], ['FeCl2', 'cloruro de hierro(II)'], ['CuSO4·5H2O', 'sulfato de cobre(II) pentahidratado'],
    ['H2SO4', 'ácido sulfúrico'], ['HNO3', 'ácido nítrico'], ['H3PO4', 'ácido fosfórico'], ['HClO4', 'ácido perclórico'],
    ['HCl', 'cloruro de hidrógeno'], ['HCl(aq)', 'ácido clorhídrico'], ['CO2', 'dióxido de carbono'], ['CO', 'monóxido de carbono'],
    ['N2O5', 'pentaóxido de dinitrógeno'], ['PCl5', 'pentacloruro de fósforo'], ['CCl4', 'tetracloruro de carbono'],
    ['SF6', 'hexafluoruro de azufre'], ['SO3', 'trióxido de azufre'], ['P4O10', 'decaóxido de tetrafósforo'],
    ['Na2O2', 'peróxido de sodio'], ['H2O2', 'peróxido de hidrógeno'], ['H2O', 'agua'], ['NH3', 'amoníaco'],
    ['NH4NO3', 'nitrato de amonio'], ['(NH4)2SO4', 'sulfato de amonio'], ['KMnO4', 'permanganato de potasio'],
    ['K2Cr2O7', 'dicromato de potasio'], ['NaHCO3', 'hidrogenocarbonato de sodio'], ['Hg2Cl2', 'cloruro de mercurio(I)'],
    ['HgCl2', 'cloruro de mercurio(II)'], ['Fe2O3', 'óxido de hierro(III)'], ['Al2O3', 'óxido de aluminio'],
    ['MnO2', 'óxido de manganeso(IV)'], ['PbO2', 'óxido de plomo(IV)'], ['SnCl2', 'cloruro de estaño(II)'], ['Cu2O', 'óxido de cobre(I)'],
    ['CuO', 'óxido de cobre(II)'], ['BaO2', 'peróxido de bario'], ['KO2', 'superóxido de potasio'], ['NaH', 'hidruro de sodio'],
    ['Na2S', 'sulfuro de sodio'], ['Ag2O', 'óxido de plata'], ['TiCl4', 'cloruro de titanio(IV)'], ['K3[Fe(CN)6]', 'hexacianoferrato(III) de potasio'],
    ['Ca3(PO4)2', 'fosfato de calcio'], ['CaCO3', 'carbonato de calcio'], ['KClO3', 'clorato de potasio'], ['NaClO', 'hipoclorito de sodio'],
    ['Na2S2O3', 'tiosulfato de sodio'], ['Mg3N2', 'nitruro de magnesio'], ['AlCl3', 'cloruro de aluminio'], ['ZnSO4', 'sulfato de zinc'],
    ['AgNO3', 'nitrato de plata'], ['Ba(OH)2', 'hidróxido de bario'], ['NaCH3COO', 'acetato de sodio'], ['KH2PO4', 'dihidrogenofosfato de potasio'],
    ['O2', 'oxígeno'], ['O3', 'ozono'], ['Fe', 'hierro'], ['S8', 'azufre'], ['P4', 'fósforo blanco'], ['C6H12O6', 'glucosa'],
    ['CH4', 'metano'], ['C2H5OH', 'etanol'], ['CH3COOH', 'ácido acético'], ['SO4^2-', 'ion sulfato'], ['Fe3+', 'ion hierro(III)'],
    ['NH4+', 'ion amonio'], ['Cl-', 'ion cloruro'], ['e-', 'electrón'], ['XeF4', 'tetrafluoruro de xenón'], ['Cl2O7', 'heptaóxido de dicloro'],
    ['NO', 'monóxido de nitrógeno'], ['N2O', 'monóxido de dinitrógeno'], ['H2S', 'sulfuro de hidrógeno'], ['CS2', 'disulfuro de carbono'],
    ]
    for (const [formula, name] of cases) expect(Nomenclature.name(formula)?.name, formula).toBe(name)
  })

  it('otros nombres', () => {
    expect(Nomenclature.name('NaCl')?.traditional).toBe('cloruro sódico')
    expect(Nomenclature.name('Fe2(SO4)3')?.traditional).toBe('sulfato férrico')
    expect(Nomenclature.name('FeCl2')?.traditional).toBe('cloruro ferroso')
    expect(Nomenclature.name('FeCl3')?.systematic).toBe('tricloruro de hierro')
    expect(Nomenclature.name('Fe2O3')?.systematic).toBe('trióxido de dihierro')
    expect(Nomenclature.name('Fe2O3')?.stock).toBe('óxido de hierro(III)')
    expect(Nomenclature.name('NaCl')?.stock).toBeNull() // el sodio solo tiene una carga: sin números romanos
    expect(Nomenclature.name('NaHCO3')?.common).toBe('bicarbonato de sodio')
    expect(Nomenclature.name('K3[Fe(CN)6]')?.common).toBe('ferricianuro de potasio')
    expect(Nomenclature.name('H2O2')?.common).toBe('agua oxigenada')
    expect(Nomenclature.name('NO')?.common).toBe('óxido nítrico')
    expect(Nomenclature.name('HCl')?.common).toBe('ácido clorhídrico')
    expect(Nomenclature.name('HCl')?.notes[0] ?? '').toContain('ácido clorhídrico')
    expect(Nomenclature.name('Fe3+')?.traditional).toBe('ion férrico')
    expect(Nomenclature.name('O2')?.systematic).toBe('dioxígeno')
    expect(names('CuSO4·5H2O')).toContain('sulfato cúprico pentahidratado')
  })

  it('nombre → fórmula', () => {
    const cases: [string, string][] = [
    ['cloruro de sodio', 'NaCl'], ['sulfato de hierro(III)', 'Fe2(SO4)3'], ['sulfato de hierro (III)', 'Fe2(SO4)3'],
    ['Sulfato de Hierro(III)', 'Fe2(SO4)3'], ['sulfato férrico', 'Fe2(SO4)3'], ['sulfato ferrico', 'Fe2(SO4)3'],
    ['hidróxido de calcio', 'Ca(OH)2'], ['ácido sulfúrico', 'H2SO4'], ['acido sulfurico', 'H2SO4'], ['óxido de hierro(III)', 'Fe2O3'],
    ['dióxido de carbono', 'CO2'], ['pentaóxido de dinitrógeno', 'N2O5'], ['pentóxido de dinitrógeno', 'N2O5'],
    ['tetracloruro de carbono', 'CCl4'], ['agua', 'H2O'], ['amoníaco', 'NH3'], ['amoniaco', 'NH3'],
    ['sulfato de cobre(II) pentahidratado', 'CuSO4·5H2O'], ['cloruro sódico', 'NaCl'], ['nitrato de amonio', 'NH4NO3'],
    ['sulfato de amonio', '(NH4)2SO4'], ['permanganato de potasio', 'KMnO4'], ['dicromato de potasio', 'K2Cr2O7'],
    ['ion sulfato', 'SO4^2-'], ['ion amonio', 'NH4^+'], ['hierro', 'Fe'], ['oxígeno', 'O2'], ['cloro', 'Cl2'],
    ['cloruro de mercurio(I)', 'Hg2Cl2'], ['cloruro de titanio(IV)', 'TiCl4'], ['carbonato de calcio', 'CaCO3'],
    ['bicarbonato de sodio', 'NaHCO3'], ['hidrogenocarbonato de sodio', 'NaHCO3'], ['fosfato de calcio', 'Ca3(PO4)2'],
    ['trióxido de azufre', 'SO3'], ['monóxido de carbono', 'CO'], ['tricloruro de hierro', 'FeCl3'],
    ['cloruro de hidrógeno', 'HCl'], ['ácido clorhídrico', 'HCl'], ['hexacianoferrato(III) de potasio', 'K3[Fe(CN)6]'],
    ['ferrocianuro de potasio', 'K4[Fe(CN)6]'], ['cloruro de galio', 'GaCl3'], ['hidróxido de aluminio', 'Al(OH)3'],
    ['nitrato de plomo(II)', 'Pb(NO3)2'], ['óxido de cobre(I)', 'Cu2O'], ['cloruro de hierro(3+)', 'FeCl3'], ['glucosa', 'C6H12O6'],
    ['etanol', 'C2H5OH'], ['ozono', 'O3'], ['el agua oxigenada', 'H2O2'], ['acetato de sodio', 'NaCH3COO'],
    ['hipoclorito de sodio', 'NaClO'], ['sulfato de bario', 'BaSO4'], ['peróxido de sodio', 'Na2O2'], ['hidruro de litio', 'LiH'],
    ['cloruro de calcio dihidratado', 'CaCl2·2H2O'], ['hexafluoruro de azufre', 'SF6'],
    ]
    for (const [name, formula] of cases) {
      const f = Nomenclature.formulaForName(name)
      expect(f, `Sin fórmula para «${name}»`).not.toBeNull()
      expect(f?.identityKey, name).toBe(key(formula))
    }
  })

  it('nunca inventa', () => {
    for (const unknown of ['cloruro de hierro', 'xyz de sodio', 'sulfato de oro(VII)', 'ácido inventadico', 'cloruro de neón', 'dióxido de', '',
      'a'.repeat(500), 'óxido de hierro(IX)', 'pentahidratado']) {
      expect(Nomenclature.formulaForName(unknown), unknown).toBeNull()
    }
    for (const f of ['C8H18', 'LiAlH4', 'Fe(CO)5', 'CuFeS2', 'C60', 'NO3^2-']) expect(Nomenclature.name(f), f).toBeNull()
  })

  it('ida y vuelta fórmula → nombre → fórmula', () => {
    for (const f of ['NaCl', 'Fe2(SO4)3', 'Ca(OH)2', 'KMnO4', 'NH4NO3', 'CuSO4·5H2O', 'CO2', 'N2O5', 'H2SO4', 'Hg2Cl2', 'Al2O3', 'CaCO3', 'PCl5']) {
      const name = Nomenclature.name(f)?.name
      expect(name, f).toBeTruthy()
      if (!name) continue
      expect(Nomenclature.formulaForName(name)?.identityKey, `${f} → ${name}`).toBe(key(f))
    }
  })
})

describe('Catión mercurio(I) multiplicado', () => {
  it('se agrupa entre paréntesis', () => {
    const phosphate = formulaFor('fosfato de mercurio(I)')
    expect(phosphate.identityKey).toBe(key('(Hg2)3(PO4)2'))
    expect(phosphate.text('plain', false, false)).toBe('(Hg2)3(PO4)2')
    expect(phosphate.charge).toBe(0)
    expect(phosphate.countOfSymbol('Hg')).toBe(6) // tres cationes Hg2 son seis átomos de mercurio
  })

  it('los compuestos que ya estaban bien siguen igual', () => {
    expect(formulaFor('cloruro de mercurio(I)').identityKey).toBe(key('Hg2Cl2'))
    expect(formulaFor('nitrato de mercurio(I)').identityKey).toBe(key('Hg2(NO3)2'))
    expect(formulaFor('sulfuro de mercurio(I)').identityKey).toBe(key('Hg2S'))
  })

  it('el resto del motor entiende la fórmula generada', () => {
    const formula = formulaFor('fosfato de mercurio(I)')
    const states = OxidationStates.analyze(formula)
    expect(states.stateOf('Hg')?.signedString()).toBe('+1')
    expect(states.stateOf('P')?.signedString()).toBe('+5')
    expect(states.stateOf('O')?.signedString()).toBe('-2')
    expect(oxidationStatesInfo('(Hg2)3(PO4)2').ok).toBe(true)
    expect(Nomenclature.name(formula)?.name).toBe('fosfato de mercurio(I)')
    expect(Nomenclature.name(formula)?.traditional).toBe('fosfato mercurioso')
    // El amonio conserva su adjetivo tradicional y no se contamina con el mercurio(I).
    expect(Nomenclature.name(parseFormula('(NH4)3PO4'))?.traditional).toBe('fosfato amónico')
    const tool = nameInfo('(Hg2)3(PO4)2')
    expect(tool.ok).toBe(true)
    expect(tool.text).not.toContain('amónico')
    expect(tool.text.includes('mercurioso') || tool.text.includes('mercurio(I)'), tool.text).toBe(true)
  })
})
