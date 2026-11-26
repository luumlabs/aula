import { describe, expect, it } from 'vitest'
import { Formula, compositionsEqual } from './formula'
import { MOLECULE_LIBRARY, lookupMolecule, normalizeMoleculeName, resolveStructureInput, searchMolecules } from './molecule-library'
import { parseSmiles, parseStructure, smilesComposition } from './smiles'
import { layoutQuality, layoutStructure } from './structure-layout'

describe('biblioteca de moléculas con nombre', () => {
  it('tiene entradas únicas y ningún alias choca entre dos moléculas distintas', () => {
    const ids = new Set<string>()
    const seen = new Map<string, string>()
    for (const m of MOLECULE_LIBRARY) {
      expect(ids.has(m.id), `id repetido: ${m.id}`).toBe(false)
      ids.add(m.id)
      const names = new Set([m.id, m.en, m.es, ...(m.aliases ?? [])].map(normalizeMoleculeName))
      for (const key of names) {
        expect(key.length, `alias vacío en ${m.id}`).toBeGreaterThan(0)
        const prev = seen.get(key)
        expect(prev, `colisión de alias «${key}» entre ${prev} y ${m.id}`).toBeUndefined()
        seen.set(key, m.id)
      }
    }
  })

  it('todas las SMILES de la biblioteca son válidas, coinciden con su fórmula y se dibujan bien en 2D', () => {
    for (const m of MOLECULE_LIBRARY) {
      const mol = parseSmiles(m.smiles)
      const expected = Formula.parse(m.formula)
      const got = smilesComposition(mol)
      expect(
        compositionsEqual(got.composition, expected.composition) && got.charge === expected.charge,
        `${m.id}: SMILES ${m.smiles} da ${Formula.fromComposition(got.composition, got.charge).plainText}, esperado ${m.formula}`
      ).toBe(true)
      const q = layoutQuality(mol, layoutStructure(mol))
      expect(q.bridged, `${m.id} (${m.smiles}) es un sistema con puentes`).toBe(false)
      expect(q.deformed, `${m.id} (${m.smiles}) sale deformada en 2D (minAtomDistance=${q.minAtomDistance.toFixed(2)})`).toBe(false)
    }
  })

  it('ningún alias secuestra una SMILES válida de otra sustancia', () => {
    for (const m of MOLECULE_LIBRARY) {
      const expected = Formula.parse(m.formula)
      for (const alias of [m.id, m.en, m.es, ...(m.aliases ?? [])]) {
        // Si el alias (sin espacios) por casualidad se leyera como SMILES directa, tendría que ser la misma sustancia
        if (/\s/.test(alias)) continue
        let parsed
        try {
          parsed = parseSmiles(alias)
        } catch {
          continue
        }
        const got = smilesComposition(parsed)
        const same = compositionsEqual(got.composition, expected.composition) && got.charge === expected.charge
        expect(same, `alias «${alias}» de ${m.id} también es SMILES válida de otra sustancia`).toBe(true)
      }
    }
  })

  it('busca en inglés y español sin distinguir mayúsculas, tildes ni guiones', () => {
    expect(lookupMolecule('glucose')?.id).toBe('glucose')
    expect(lookupMolecule('GLUCOSA')?.id).toBe('glucose')
    expect(lookupMolecule('D-glucosa')?.id).toBe('glucose')
    expect(lookupMolecule('ácido acético')?.id).toBe('acetic-acid')
    expect(lookupMolecule('acido acetico')?.id).toBe('acetic-acid')
    expect(lookupMolecule('acetic_acid')?.id).toBe('acetic-acid')
    expect(lookupMolecule('Ácido Acetilsalicílico')?.id).toBe('aspirin')
    expect(lookupMolecule('cafeina')?.id).toBe('caffeine')
    expect(lookupMolecule('triptofano')?.id).toBe('tryptophan')
    expect(lookupMolecule('desoxirribosa')?.id).toBe('deoxyribose')
    expect(lookupMolecule('inexistente-xyz')).toBeUndefined()
  })

  it('resuelve nombres sueltos, mezclas y reacciones sin romper SMILES puras ni títulos tras espacio', () => {
    const g = parseStructure('glucose')
    expect(g.molecule.source).toBe(lookupMolecule('glucose')!.smiles)
    expect(Formula.fromComposition(smilesComposition(g.molecule).composition).plainText).toBe('C6H12O6')

    const rxn = parseStructure('ethanol.acetic acid>>ethyl acetate.water')
    expect(rxn.species).toHaveLength(4)
    expect(rxn.molecule.source).toBe('CCO.CC(=O)O>>CC(=O)OCC.O')

    const rxnEs = parseStructure('etanol.ácido acético>>acetato de etilo.agua')
    expect(rxnEs.molecule.source).toBe('CCO.CC(=O)O>>CC(=O)OCC.O')

    const mix = parseStructure('glucose.fructose')
    expect(mix.species).toBeUndefined()
    expect(mix.molecule.source).toBe(`${lookupMolecule('glucose')!.smiles}.${lookupMolecule('fructose')!.smiles}`)

    // SMILES directa y SMILES con título detrás siguen funcionando igual
    expect(resolveStructureInput('CCO').resolved).toEqual([])
    expect(parseStructure('CCO').molecule.source).toBe('CCO')
    expect(parseStructure('CCO etanol').molecule.source).toBe('CCO')
    expect(parseStructure('[Na+].[Cl-]').molecule.source).toBe('[Na+].[Cl-]')
  })

  it('sugiere moléculas parecidas al buscar por prefijo o subcadena', () => {
    expect(searchMolecules('gluc').map((m) => m.id)).toContain('glucose')
    expect(searchMolecules('acetil').map((m) => m.id)).toContain('aspirin')
    expect(searchMolecules('a')).toEqual([])
  })
})
