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
})
