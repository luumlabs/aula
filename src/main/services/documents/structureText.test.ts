import { describe, expect, it } from 'vitest'
import { decodeBlock, type Block, type BlockOf } from '@shared/schema'
import type { DocumentPlan } from '@shared/documents'
import { block } from './markdown'
import { structureMarkdown } from './structureText'

const plan = { title: 'x', sections: [] } as unknown as DocumentPlan
const md = (json: object, lang: 'es' | 'en' = 'es'): string => block(decodeBlock(json) as Block, { plan, folder: '', lang, asset: () => undefined })[0]

describe('estructuras en los documentos', () => {
  it('la aspirina: rótulo con el título, fórmula, SMILES y grupos', () => {
    const out = md({ type: 'structure', title: 'Aspirina', smiles: 'CC(=O)Oc1ccccc1C(=O)O', groups: [{ atoms: [2, 3, 4], label: 'éster', md: 'Une dos partes.' }], caption: 'Ácido acetilsalicílico' })
    expect(out).toContain('*[Fórmula estructural: Aspirina]*')
    expect(out).toContain('$\\ce{C9H8O4}$')
    expect(out).toContain('SMILES: `CC(=O)Oc1ccccc1C(=O)O`')
    expect(out).toContain('- **éster**: Une dos partes.')
    expect(out).toContain('*Ácido acetilsalicílico*')
  })
  it('en inglés y con una reacción', () => {
    const out = md({ type: 'structure', smiles: 'CC(=O)O.OCC>>CC(=O)OCC.O', reversible: true, conditions: 'H₂SO₄' }, 'en')
    expect(out).toContain('*[Structural formula]*')
    expect(out).toContain('<=>')
    expect(out).toContain('*H₂SO₄*')
  })
  it('una SMILES mala deja la fórmula escrita a mano', () => {
    expect(md({ type: 'structure', smiles: 'C1CC', formula: 'C3H6' })).toContain('$\\ce{C3H6}$')
  })
  it('varias sustancias con «.»: una fórmula por cada una, como en pantalla', () => {
    expect(md({ type: 'structure', smiles: 'c1ccc2ccccc2c1.Cc1ccccc1' })).toContain('$\\ce{C10H8, C7H8}$')
    expect(md({ type: 'structure', smiles: 'CCCC.CC(C)C' })).toContain('$\\ce{C4H10, C4H10}$')
    expect(md({ type: 'structure', smiles: '[NH4+].[Cl-].CC(=O)[O-]' })).toContain('$\\ce{NH4^+, Cl^-, C2H3O2^-}$')
    expect(md({ type: 'structure', smiles: '[Na+].[Cl-]' })).toContain('$\\ce{NaCl}$')
  })
  it('un «*» suelto no deja una fórmula vacía', () => {
    const out = md({ type: 'structure', smiles: '*' })
    expect(out).not.toContain('\\ce{}')
    expect(out).toContain('SMILES: `*`')
  })
  it('el recorrido guiado sale numerado', () => {
    const out = md({ type: 'structure', smiles: 'CCO', groups: [{ atoms: [3], label: 'hidroxilo' }], steps: [{ md: 'Primero, el **OH**.', group: 'hidroxilo' }, { md: 'Luego el carbono α.\nQue lleva dos H.', atoms: [2] }] })
    expect(out).toContain('1. Primero, el **OH**.\n2. Luego el carbono α.\n   Que lleva dos H.')
  })
  it('en el enunciado de un ejercicio: la SMILES y el pie, sin la fórmula, los grupos ni el recorrido', () => {
    const b = decodeBlock({ type: 'structure', smiles: 'CCO', groups: [{ atoms: [3], label: 'hidroxilo' }], steps: [{ md: 'El OH' }, { md: 'El C' }], caption: 'Observa la molécula' }) as BlockOf<'structure'>
    const out = structureMarkdown(b, { inPrompt: true })
    expect(out).toContain('SMILES: `CCO`')
    expect(out).toContain('*Observa la molécula*')
    expect(out).not.toContain('C2H6O')
    expect(out).not.toContain('hidroxilo')
    expect(out).not.toContain('El OH')
    expect(structureMarkdown(b)).toContain('$\\ce{C2H6O}$')
  })
})
