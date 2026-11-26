import { describe, expect, it } from 'vitest'
import { structureInfo } from './structure-tool'

describe('structureInfo: varias sustancias y avisos de dibujo', () => {
  it('dos isómeros con «.»: la fórmula de cada uno, nunca una sumada', () => {
    const out = structureInfo('CCCC.CC(C)C')
    expect(out.ok).toBe(true)
    expect(out.text).toContain('2 sustancias')
    expect(out.text).toContain('C4H10 (58')
    expect(out.text).not.toContain('C8H20')
    expect(out.text).not.toContain('Copia «')
    expect(out.latex).toBe('\\ce{C4H10, C4H10}')
    expect(out.value).toBeUndefined()
  })
  it('C.C.C.C son cuatro metanos, no C4H16', () => {
    const out = structureInfo('C.C.C.C')
    expect(out.text).toContain('4 sustancias')
    expect(out.text).not.toContain('C4H16')
  })
  it('una sal sigue siendo una sola sustancia con su fórmula', () => {
    const out = structureInfo('[Na+].[Cl-]')
    expect(out.text).toContain('Fórmula molecular: NaCl')
    expect(out.text).toContain('Copia «NaCl»')
  })
  it('un «*» suelto no tiene fórmula', () => {
    expect(structureInfo('*').text).toContain('Solo grupos R')
  })
  it('el 1,1-dimetilciclohexano y la testosterona ya no salen deformados', () => {
    expect(structureInfo('CC1(C)CCCCC1').text).not.toContain('deformado')
    expect(structureInfo('CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C').text).not.toContain('deformado')
    expect(structureInfo('C1CC2CCC1C2').text).toContain('deformado')
  })
  it('avisa cuando la desarrollada no se puede ofrecer', () => {
    expect(structureInfo('CC(C)(C)O').text).not.toContain('desarrollada')
    expect(structureInfo('CCC1(C)CCCCC1').text).toContain('la fórmula desarrollada (style expanded) sale con H encimados')
  })
  it('acepta nombres de la biblioteca (inglés, español y reacciones) y sugiere si no existe', () => {
    const g = structureInfo('glucose')
    expect(g.ok).toBe(true)
    expect(g.text).toContain('Biblioteca de moléculas: «glucose» →')
    expect(g.text).toContain('Fórmula molecular: C6H12O6')

    const rxn = structureInfo('etanol.ácido acético>>acetato de etilo.agua')
    expect(rxn.ok).toBe(true)
    expect(rxn.text).toContain('SMILES válida: CCO.CC(=O)O>>CC(=O)OCC.O')
    expect(rxn.text).toContain('Ajustada 1:1')

    const bad = structureInfo('gluc')
    expect(bad.ok).toBe(false)
    expect(bad.text).toContain('glucosa')
  })
})
