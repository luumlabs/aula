// Portado de la app Swift anterior: Tests/ChemKitTests/LocalizationTests.swift. Como en Swift, sin cambiar el idioma todo sale
// en español (las claves). Al final, pruebas propias del catálogo en inglés y de las formas de plural.

import { afterEach, describe, expect, it } from 'vitest'
import { ChemError } from './errors'
import {
  ALL_ELEMENTS, ELEMENT_CATEGORIES, PeriodicTable, STANDARD_STATES, categoryTitle, describeElement, localizedCategoryTitle,
  localizedElementName, localizedElementNameInSentence, localizedStateTitle, stateTitle, type Element,
} from './elements'
import { ELEMENT_NAMES } from './element-l10n'
import { ElectronConfiguration } from './electron-config'
import { Formula, PHYSICAL_STATES, localizedPhysicalStateTitle, physicalStateTitle } from './formula'
import { getChemLanguage, phrasesAreSpanish, setChemLanguage } from './l10n'
import { parseFormula } from './parser'
import { ChemQuantity, dimensionTitle, localizedDimensionTitle, localizedUnitSymbol, unitSymbol, type ChemDimension } from './quantity'
import { ChemicalEquation } from './equation'
import { OxidationStates } from './redox'
import { AcidBase } from './acid-base'
import { Gases, Solutions } from './solutions'
import { SigFigs } from './sigfigs'
import { Stoichiometry } from './stoichiometry'
import { ChemTools } from './tools'
import { andList, inSentence, orList } from './text'

const el = (s: string): Element => {
  const e = PeriodicTable.bySymbol(s)
  if (!e) throw new Error(s)
  return e
}
const q = (s: string): ChemQuantity => ChemQuantity.parse(s)
function message(body: () => unknown): string {
  try {
    body()
    return 'OK'
  } catch (e) {
    return e instanceof ChemError ? e.message : String(e)
  }
}

describe('Localización (español, sin catálogo)', () => {
  it('la tabla de nombres coincide con los datos', () => {
    expect(getChemLanguage()).toBe('es')
    expect(ELEMENT_NAMES.es.length).toBe(118)
    for (const e of ALL_ELEMENTS) {
      expect(ELEMENT_NAMES.es[e.atomicNumber - 1], e.symbol).toBe(e.name)
      expect(localizedElementName(e), e.symbol).toBe(e.name)
      expect(localizedElementNameInSentence(e), e.symbol).toBe(e.name.toLowerCase())
    }
    expect(localizedElementName(el('Ra'))).toBe('Radio')
    expect(localizedElementNameInSentence(el('Fe'))).toBe('hierro')
    expect(PeriodicTable.byName('hierro')?.symbol).toBe('Fe')
    expect(describeElement(el('Fe'))).toBe('Hierro (Fe)')
  })

  it('los títulos localizados coinciden con el texto español', () => {
    for (const c of ELEMENT_CATEGORIES) expect(localizedCategoryTitle(c), c).toBe(categoryTitle(c))
    for (const s of STANDARD_STATES) expect(localizedStateTitle(s), s).toBe(stateTitle(s))
    for (const s of PHYSICAL_STATES) expect(localizedPhysicalStateTitle(s), s).toBe(physicalStateTitle(s))
    const dimensions: ChemDimension[] = ['mass', 'amount', 'particles', 'volume', 'pressure', 'temperature', 'molarity', 'molality', 'energy']
    for (const d of dimensions) expect(localizedDimensionTitle(d), d).toBe(dimensionTitle(d))
  })

  it('listas y nombres dentro de frases', () => {
    expect(phrasesAreSpanish()).toBe(true)
    expect(andList(['Cu', 'Fe'])).toBe('Cu y Fe')
    expect(andList(['Cu', 'Fe', 'S'])).toBe('Cu, Fe y S')
    expect(orList(['Co (cobalto)', 'CO (monóxido de carbono)'])).toBe('Co (cobalto) o CO (monóxido de carbono)')
    expect(orList(['A', 'B', 'C'])).toBe('A, B o C')
    expect(inSentence('Oxígeno')).toBe('oxígeno')
  })

  it('mensajes de error construidos como frases completas', () => {
    expect(message(() => ElectronConfiguration.ion(el('Fe'), 27))).toBe('Un átomo de hierro solo tiene 26 electrones: no puede tener carga 27+.')
    expect(message(() => parseFormula('^{5}C'))).toBe('Un isótopo de carbono no puede tener número másico 5 (tiene al menos 6 protones).')
    expect(ChemError.tooLong(20_000).message).toBe('El texto es demasiado largo (máximo 20000 caracteres).')
    expect(message(() => Solutions.molarity(q('5 g'), Formula.parse('NaCl'), q('10 g')))).toBe(
      'El volumen de la disolución tiene que ser un volumen (me has dado 10 g).',
    )
    expect(message(() => Solutions.dilution(q('0.5 M'), q('-10 mL'), q('0.1 M'), null))).toBe('El volumen tiene que ser positivo.')
    expect(message(() => Solutions.massPercent(q('5 mL'), q('100 g')))).toBe('La masa de soluto tiene que ser una masa (me has dado 5 mL).')
    expect(message(() => Gases.combined(q('10 g'), q('1 L'), q('300 K'), q('1 atm'), null, q('350 K')))).toBe(
      'P₁ tiene que ser una presión (me has dado 10 g).',
    )
    expect(message(() => Gases.idealGas({ pressure: q('1 atm'), volume: q('5 g'), amount: null, temperature: q('300 K') }))).toBe(
      'El volumen tiene que ser un volumen (me has dado 5 g).',
    )
    expect(message(() => Stoichiometry.convert('10 g', 'mol', null))).toBe(
      'Para pasar a cantidad de sustancia necesito la fórmula de la sustancia (por ejemplo «H2O»).',
    )
    expect(message(() => q('10 g').convertedTo('kelvin'))).toBe('No se puede pasar de g (masa) a K (temperatura) directamente.')
    expect(message(() => q('1 mol').convertedTo('particles'))).toBe(
      'No se puede pasar de mol (cantidad de sustancia) a partículas (número de partículas) directamente.',
    )
    expect(message(() => Solutions.molarity(q('6.02e23 partículas'), null, q('1 L')))).toBe(
      'Para pasar 6.02e23 partículas a moles necesito la fórmula del soluto.',
    )
    expect(localizedUnitSymbol('particles')).toBe(unitSymbol('particles'))
    expect(localizedUnitSymbol('milliliter')).toBe('mL')
    expect(message(() => OxidationStates.analyze('CuFeS2'))).toContain('Fe y Cu quedan sin determinar')
    expect(message(() => ChemicalEquation.parse('H2 + O2 -> + H2O'))).toBe('Sobra un «+» en los productos: falta una especie.')
    expect(message(() => AcidBase.solve('pH = abc'))).toBe('No entiendo el valor de pH en «pH = abc».')
    expect(message(() => AcidBase.solve('  '))).toBe('La descripción está vacía.')
    expect(message(() => AcidBase.solve('HCl 0.01 M ' + 'x'.repeat(300)))).toBe('El texto es demasiado largo (máximo 200 caracteres).')
    expect(message(() => AcidBase.solve('NH2OH 0.10 M'))).toContain('M Kb=…»')
  })

  it('correcciones para el alumno construidas como frases completas', () => {
    const T = ChemTools
    expect(T.checkFormula('Fe', 'Fe3+').feedback).toBe('Los átomos están bien, pero la especie debería ser de carga 3+ y la has escrito sin carga.')
    expect(T.checkFormula('SO4^2-', 'SO4').feedback).toBe('Los átomos están bien, pero la especie debería ser neutra y la has escrito con carga 2-.')
    expect(T.checkFormula('Fe2+', 'Fe3+').feedback).toBe('Los átomos están bien, pero la especie debería ser de carga 3+ y la has escrito con carga 2+.')
    expect(T.checkName('NaCl', 'NaCl').feedback).toBe('Has escrito una fórmula; se pide el nombre: cloruro de sodio.')
    expect(T.checkName('cloruro de sodio', 'NaCl').feedback).toBe('¡Correcto!')
    expect(T.checkElectronConfiguration('[Ar] 4s2 3d6', 'Fe').feedback).toBe('¡Correcto! [Ar] 4s² 3d⁶')
    const hPlus = T.checkElectronConfiguration('1s1', 'H+')
    expect(hPlus.status).toBe('incorrect')
    expect(hPlus.feedback.startsWith('No es correcta. ')).toBe(true)
    expect(hPlus.feedback.endsWith(' La correcta es (sin electrones).')).toBe(true)
    expect(SigFigs.check('1200', 1234.5, 5).feedback).toBe(
      'El valor es correcto, pero con los datos dados corresponden 5 cifras significativas, no entre 2 y 4 (ambiguo): escribe 1234.5.',
    )
    expect(SigFigs.check('3.7', 2.5).feedback).toBe('El valor no es correcto: debería salir ≈ 2.500.')
    expect(SigFigs.check('250', 2.5).feedback).toBe(
      'El valor no es correcto: debería salir ≈ 2.500. Parece un error de potencia de 10 (te sale ×10^2): revisa las unidades o los prefijos (m, k…).',
    )
  })

  it('no se cuelan marcadores de formato en los mensajes', () => {
    const T = ChemTools
    const feedback = [
      T.checkFormula('NaCl2', 'NaCl').feedback,
      T.checkFormula('CH2O', 'C6H12O6').feedback,
      T.checkEquation('H2 + O2 -> H2O', '2 H2 + O2 -> 2 H2O').feedback,
      T.checkEquation('4 H2 + 2 O2 -> 4 H2O', '2 H2 + O2 -> 2 H2O').feedback,
      T.checkEquation('Fe3+ + e- -> Fe', 'Fe3+ + e- -> Fe2+').feedback,
      T.checkName('sulfato de hierro(II)', 'Fe2(SO4)3').feedback,
      T.checkElectronConfiguration('[Ar] 4s2 3d4', 'Cr').feedback,
      SigFigs.check('0.045', 0.04503, 3).feedback,
      SigFigs.check('-2.5', 2.5).feedback,
      message(() => parseFormula('co')),
      message(() => parseFormula('Ca(OH]2')),
      message(() => parseFormula('[Fe(CN)6')),
      message(() => ElectronConfiguration.parse('1s3')),
      message(() => ChemicalEquation.parse('H2 + O2')),
    ]
    for (const text of feedback) {
      expect(text.length).toBeGreaterThan(0)
      for (const marker of ['%@', '%lld', '%ld', '%d', '%lf', '%%', '$@', 'undefined', 'null', 'NaN']) {
        expect(text.includes(marker), `«${marker}» en: ${text}`).toBe(false)
      }
    }
  })
})

describe('Localización (inglés, con el catálogo de la app)', () => {
  afterEach(() => setChemLanguage('es'))

  it('nombres, títulos, listas y mensajes en inglés', () => {
    setChemLanguage('en-US')
    expect(getChemLanguage()).toBe('en')
    expect(phrasesAreSpanish()).toBe(false)
    expect(localizedElementName(el('Fe'))).toBe('Iron')
    expect(localizedCategoryTitle('halogen')).not.toBe(categoryTitle('halogen'))
    expect(categoryTitle('halogen')).toBe('Halógeno') // el texto fijo para la IA no cambia
    expect(andList(['Cu', 'Fe', 'S'])).toBe('Cu, Fe, and S')
    expect(message(() => ElectronConfiguration.ion(el('Fe'), 27))).toContain('iron')
    expect(message(() => parseFormula(''))).not.toBe('La fórmula está vacía.')
    expect(ChemError.tooLong(20_000).message).toContain('20000')
    expect(ChemTools.checkName('cloruro de sodio', 'NaCl').feedback).not.toBe('¡Correcto!')
    const steps = ChemTools.molarMass('H2O').text
    expect(steps).toContain('Multiplico') // los pasos para la IA siguen en español
    const hint = ChemTools.checkElectronConfiguration('[Ar] 4s2 3d4', 'Cr').feedback
    for (const marker of ['%@', '%lld', '$@']) expect(hint).not.toContain(marker)
  })

  it('formas de plural', () => {
    expect(SigFigs.check('2', 2, 1).feedback).toBe('¡Correcto! El valor y la cifra significativa (1) está bien.')
    expect(SigFigs.check('2.0', 2, 2).feedback).toBe('¡Correcto! El valor y las cifras significativas (2) están bien.')
    setChemLanguage('en')
    expect(SigFigs.check('2', 2, 1).feedback).toBe('Correct! The value and the significant figure (1) are right.')
    expect(SigFigs.check('2.0', 2, 2).feedback).toBe('Correct! The value and the significant figures (2) are right.')
  })
})
