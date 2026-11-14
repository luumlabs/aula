// Pruebas de SMILES; las primeras pruebas de lectura están adaptadas de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs:
// test/science.test.ts.
import { describe, expect, it } from 'vitest'
import { Formula, compositionsEqual } from './formula'
import { setChemLanguage } from './l10n'
import { SmilesError, parseSmiles, parseStructure, smilesComposition, smilesFormulaParts, withExplicitHydrogens, type SmilesErrorKind } from './smiles'

const formulaOf = (smiles: string): string => {
  const c = smilesComposition(parseSmiles(smiles))
  return Formula.fromComposition(c.composition, c.charge).plainText
}
const sameAtoms = (smiles: string, formula: string): boolean => {
  const c = smilesComposition(parseSmiles(smiles))
  const f = Formula.parse(formula)
  return compositionsEqual(c.composition, f.composition) && c.charge === f.charge
}
const massOf = (smiles: string): number => {
  const c = smilesComposition(parseSmiles(smiles))
  return Formula.fromComposition(c.composition, c.charge).molarMass
}
const kindOf = (smiles: string): SmilesErrorKind['type'] | undefined => {
  try {
    parseStructure(smiles)
    return undefined
  } catch (e) {
    if (e instanceof SmilesError) return e.kind.type
    throw e
  }
}

const CAFFEINE = 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C'
const CAFFEINE_AROMATIC = 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'
const ASPIRIN = 'CC(=O)OC1=CC=CC=C1C(=O)O'
const ASPIRIN_AROMATIC = 'CC(=O)Oc1ccccc1C(=O)O'
const GLUCOSE_CHAIN = 'OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)C=O'
const GLUCOSE_RING = 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O'
const CHOLESTEROL = 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C'

describe('SMILES: lectura (como en Sketchy)', () => {
  it('lee ramas, anillos, cargas y partes', () => {
    expect(parseSmiles('CC(=O)O').bonds.map((b) => b.order)).toEqual([1, 2, 1])
    expect(parseSmiles('c1ccccc1').bonds.filter((b) => b.order === 1.5)).toHaveLength(6)
    expect(parseSmiles('[NH4+].[Cl-]').atoms.map((a) => [a.element, a.charge])).toEqual([['N', 1], ['Cl', -1]])
    expect(kindOf('C1CC')).toBe('unclosedRing')
    expect(kindOf('C(C')).toBe('unclosedBranch')
  })

  it('guarda el isótopo, la clase, la quiralidad y la dirección de / y \\', () => {
    const m = parseSmiles('[13CH4]')
    expect(m.atoms[0].isotope).toBe(13)
    expect(m.hydrogens[0]).toBe(4)
    expect(parseSmiles('[*:2]CC').atoms[0].atomClass).toBe(2)
    expect(parseSmiles('C[C@@H](O)N').atoms[1].chirality).toBe('@@')
    expect(parseSmiles('F/C=C\\F').bonds.map((b) => b.dir)).toEqual(['up', undefined, 'down'])
  })

  it('anillos con %nn, el orden en el cierre y el título detrás', () => {
    expect(parseSmiles('C%10CCCCC%10').rings).toHaveLength(1)
    const m = parseSmiles('C=1CCCCC1')
    expect(m.bonds.find((b) => b.closure)?.order).toBe(2)
    expect(parseSmiles('CCO etanol').atoms).toHaveLength(3)
    expect(parseSmiles('  CCO  ').source).toBe('CCO')
  })

  it('el puente entre dos anillos aromáticos es sencillo, con o sin «-»', () => {
    for (const s of ['c1ccccc1-c1ccccc1', 'c1ccccc1c1ccccc1']) {
      const m = parseSmiles(s)
      expect(m.bonds.filter((b) => b.order === 1)).toHaveLength(1)
      expect(formulaOf(s)).toBe('C12H10')
    }
  })

  it('anillos mínimos (naftaleno: dos de 6, no el «sobre» de 10)', () => {
    const rings = parseSmiles('c1ccc2ccccc2c1').rings
    expect(rings.map((r) => r.length)).toEqual([6, 6])
    expect(parseSmiles(CHOLESTEROL).rings.map((r) => r.length).sort()).toEqual([5, 6, 6, 6])
  })
})

describe('SMILES: fórmula molecular y masa molar', () => {
  const table: [string, string][] = [
    ['CCO', 'C2H6O'], ['c1ccccc1', 'C6H6'], ['C1=CC=CC=C1', 'C6H6'], ['CC(=O)O', 'C2H4O2'],
    [CAFFEINE, 'C8H10N4O2'], [CAFFEINE_AROMATIC, 'C8H10N4O2'], [ASPIRIN, 'C9H8O4'], [ASPIRIN_AROMATIC, 'C9H8O4'],
    [GLUCOSE_CHAIN, 'C6H12O6'], [GLUCOSE_RING, 'C6H12O6'], ['c1ccc2ccccc2c1', 'C10H8'], ['c1ccncc1', 'C5H5N'],
    ['c1cc[nH]c1', 'C4H5N'], ['c1ccsc1', 'C4H4S'], ['c1ccoc1', 'C4H4O'], ['c1cnc[nH]1', 'C3H4N2'],
    ['CC(C)CC1=CC=C(C=C1)C(C)C(=O)O', 'C13H18O2'], ['CC(=O)NC1=CC=C(C=C1)O', 'C8H9NO2'], [CHOLESTEROL, 'C27H46O'],
    ['OS(=O)(=O)O', 'H2SO4'], ['OP(=O)(O)O', 'H3PO4'], ['CS(=O)C', 'C2H6OS'], ['O', 'H2O'], ['C', 'CH4'], ['O=C=O', 'CO2'],
    ['CC#N', 'C2H3N'], ['C[C@@H](C(=O)O)N', 'C3H7NO2'], ['Cc1ccccc1', 'C7H8'], ['Oc1ccccc1', 'C6H6O'],
    ['C1CCCCC1', 'C6H12'], ['C=C', 'C2H4'], ['C#C', 'C2H2']
  ]
  it.each(table)('%s → %s', (smiles, formula) => {
    expect(sameAtoms(smiles, formula)).toBe(true)
  })

  it('masas molares', () => {
    expect(massOf(CAFFEINE)).toBeCloseTo(194.19, 1)
    expect(massOf(ASPIRIN)).toBeCloseTo(180.16, 1)
    expect(massOf(GLUCOSE_RING)).toBeCloseTo(180.16, 1)
  })

  it('cargas: nitrobenceno neutro, acetato −1, amonio +1', () => {
    const nitro = smilesComposition(parseSmiles('c1ccc(cc1)[N+](=O)[O-]'))
    expect(nitro.charge).toBe(0)
    expect(Formula.fromComposition(nitro.composition).plainText).toBe('C6H5NO2')
    expect(smilesComposition(parseSmiles('CC(=O)[O-]')).charge).toBe(-1)
    expect(formulaOf('[NH4+]')).toBe('NH4^+')
  })

  it('un grupo R hace la fórmula genérica', () => {
    const c = smilesComposition(parseSmiles('*C(=O)O'))
    expect(c.generic).toBe(true)
    expect(Formula.fromComposition(c.composition).plainText).toBe('CHO2')
  })

  it('el isótopo cuenta aparte', () => {
    expect(formulaOf('[13CH4]')).toBe('^{13}CH4')
  })
})

describe('SMILES: Kekulé', () => {
  it('benceno: tres dobles alternos', () => {
    const m = parseSmiles('c1ccccc1')
    expect(m.bonds.filter((b) => b.kekule === 2)).toHaveLength(3)
  })
  it('naftaleno y cafeína aromática tienen forma de Kekulé', () => {
    expect(parseSmiles('c1ccc2ccccc2c1').bonds.filter((b) => b.kekule === 2)).toHaveLength(5)
    const caf = parseSmiles(CAFFEINE_AROMATIC)
    expect(caf.bonds.filter((b) => b.kekule === 2)).toHaveLength(2)
  })
  it('el pirrol deja sencillos los enlaces del N–H', () => {
    const m = parseSmiles('c1cc[nH]c1')
    const nh = 3
    expect(m.bonds.filter((b) => (b.a === nh || b.b === nh) && b.kekule === 2)).toHaveLength(0)
  })
  it('iones aromáticos: piridinio y tropilio', () => {
    expect(formulaOf('c1cc[nH+]cc1')).toBe('C5H6N^+')
    expect(formulaOf('[cH+]1cccccc1')).toBe('C7H7^+')
  })
  it('un anillo imposible no se puede escribir en Kekulé', () => {
    expect(kindOf('c1cccc1')).toBe('notKekulizable')
    expect(kindOf('c1ccnc1')).toBe('notKekulizable')
  })
  it('selenofeno, telurofeno, arsol y arsabenceno: [se] y [te] como [s], [as] como [p]', () => {
    for (const s of ['c1cc[se]c1', '[se]1cccc1', 'c1cc[te]c1', '[asH]1cccc1', 'c1cc[as]cc1', 'c1ccsc1']) expect(kindOf(s), s).toBeUndefined()
    expect(formulaOf('c1cc[se]c1')).toBe('C4H4Se')
    expect(formulaOf('[asH]1cccc1')).toBe('C4H5As')
    expect(parseSmiles('c1cc[se]c1').bonds.filter((b) => b.kekule === 2)).toHaveLength(2)
  })
})

describe('SMILES: una fórmula por sustancia', () => {
  const parts = (smiles: string): string[] => smilesFormulaParts(parseSmiles(smiles)).map((c) => Formula.fromComposition(c.composition, c.charge).plainText)
  it('cada parte separada con «.» lleva la suya; una sal es una sola', () => {
    expect(parts('CCO')).toEqual(['C2H6O'])
    expect(parts('CCCC.CC(C)C')).toEqual(['C4H10', 'C4H10'])
    expect(parts('c1ccc2ccccc2c1.Cc1ccccc1')).toEqual(['C10H8', 'C7H8'])
    expect(parts('CCO.O')).toEqual(['C2H6O', 'H2O'])
    expect(parts('[Na+].[Cl-]')).toEqual(['NaCl'])
    expect(parts('[NH4+].[Cl-]')).toEqual(['NH4Cl'])
    expect(parts('[NH4+].[Cl-].CC(=O)[O-]')).toEqual(['NH4^+', 'Cl^-', 'C2H3O2^-'])
  })
  it('un «*» suelto no tiene fórmula', () => {
    expect(parts('*')).toEqual([])
    expect(parts('C*')).toEqual(['CH3'])
  })
})

describe('SMILES: errores con tipo', () => {
  const cases: [string, SmilesErrorKind['type']][] = [
    ['', 'empty'], ['CH3CH2OH', 'looksLikeFormula'], ['C(C)(C)(C)(C)C', 'overValence'], ['[Xx]', 'unknownElement'],
    ['cC', 'aromaticOutsideRing'], ['C12CC12', 'duplicateBond'], ['C'.repeat(81), 'tooManyAtoms'], ['C'.repeat(600), 'tooLong'],
    ['C(', 'unclosedBranch'], ['C)', 'unopenedBranch'], ['(C)', 'branchWithoutAtom'], ['1CC', 'ringWithoutAtom'],
    ['C11', 'ringOnItself'], ['C%1CC', 'badRingNumber'], ['C[NH4', 'unclosedBracket'], ['C[N@H+3-]', 'badBracketAtom'],
    ['C=', 'danglingBond'], ['=C', 'danglingBond'], ['NaCl', 'needsBrackets'], ['C$C', 'unexpectedChar'], ['[CH5]', 'overValence'],
    ['CC>CC', 'reactionArrows'], ['>>CC', 'reactionSide'], ['CC>>', 'reactionSide']
  ]
  it.each(cases)('«%s» → %s', (smiles, kind) => {
    expect(kindOf(smiles)).toBe(kind)
  })

  it('posiciones desde 1 y mensajes en los dos idiomas', () => {
    try {
      parseSmiles('CCH')
    } catch (e) {
      expect((e as SmilesError).kind).toEqual({ type: 'looksLikeFormula', pos: 3 })
      expect((e as SmilesError).message).toMatch(/CCO/)
    }
    setChemLanguage('en')
    try {
      parseSmiles('C1CC')
    } catch (e) {
      expect((e as SmilesError).message).toMatch(/Ring 1 is opened and never closed/)
    } finally {
      setChemLanguage('es')
    }
  })

  it('cosas al azar solo lanzan SmilesError y van rápido', () => {
    const alphabet = 'CNOcnos()[]=#123%+-H.@/\\BrClSP*:0 '
    let seed = 7
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < 400; k++) {
      const s = Array.from({ length: 1 + Math.floor(rand() * 24) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('')
      const t0 = performance.now()
      try {
        parseStructure(s)
      } catch (e) {
        expect(e).toBeInstanceOf(SmilesError)
      }
      expect(performance.now() - t0).toBeLessThan(25)
    }
  })
})

describe('SMILES: reacciones e hidrógenos explícitos', () => {
  it('esterificación: 2 + 2 especies, numeradas seguidas', () => {
    const r = parseStructure('CC(=O)O.OCC>>CC(=O)OCC.O')
    expect(r.species?.map((s) => s.side)).toEqual(['reactant', 'reactant', 'product', 'product'])
    expect(r.molecule.atoms).toHaveLength(4 + 3 + 6 + 1)
    expect(r.species?.[1].atoms).toEqual([4, 5, 6])
  })
  it('una reacción con agentes', () => {
    const r = parseStructure('C=C.[H][H]>[Ni]>CC')
    expect(r.species?.filter((s) => s.side === 'agent')).toHaveLength(1)
  })
  it('las posiciones de los errores cuentan desde el principio de la reacción', () => {
    try {
      parseStructure('CC>>C(')
    } catch (e) {
      expect((e as SmilesError).kind.type).toBe('unclosedBranch')
    }
    try {
      parseStructure('CC>>CH')
    } catch (e) {
      expect((e as SmilesError).kind).toEqual({ type: 'looksLikeFormula', pos: 6 })
    }
  })
  it('los H implícitos pasan a ser átomos al final', () => {
    const m = withExplicitHydrogens(parseSmiles('CCO'))
    expect(m.atoms).toHaveLength(9)
    expect(m.bonds).toHaveLength(8)
    expect(m.atoms.slice(0, 3).map((a) => a.element)).toEqual(['C', 'C', 'O'])
    expect(m.hydrogens.every((h) => h === 0)).toBe(true)
  })
})
