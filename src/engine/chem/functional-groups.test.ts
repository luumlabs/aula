import { describe, expect, it } from 'vitest'
import { detectFunctionalGroups, groupKindsForLabel, type FunctionalGroupKind } from './functional-groups'
import { parseSmiles } from './smiles'

const kinds = (smiles: string): FunctionalGroupKind[] => detectFunctionalGroups(parseSmiles(smiles)).map((g) => g.kind)

describe('grupos funcionales', () => {
  it('aspirina: éster, ácido carboxílico y areno', () => {
    expect(kinds('CC(=O)OC1=CC=CC=C1C(=O)O').sort()).toEqual(['arene', 'carboxylicAcid', 'ester'])
    expect(kinds('CC(=O)Oc1ccccc1C(=O)O').sort()).toEqual(['arene', 'carboxylicAcid', 'ester'])
  })
  it('paracetamol: amida, fenol y areno', () => {
    expect(kinds('CC(=O)NC1=CC=C(C=C1)O').sort()).toEqual(['amide', 'arene', 'phenol'])
  })
  it('cafeína: amidas y una amina terciaria', () => {
    const k = kinds('CN1C=NC2=C1C(=O)N(C(=O)N2C)C')
    expect(k.filter((x) => x === 'amide')).toHaveLength(2)
    expect(k).toContain('amine3')
    expect(kinds('Cn1cnc2c1c(=O)n(C)c(=O)n2C').sort()).toEqual(k.sort())
  })
  it('glucosa abierta: aldehído y 5 alcoholes', () => {
    const k = kinds('OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)C=O')
    expect(k.filter((x) => x === 'aldehyde')).toHaveLength(1)
    expect(k.filter((x) => x === 'alcohol')).toHaveLength(5)
  })
  it('acetato de etilo: solo éster (ni éter ni cetona)', () => {
    expect(kinds('CC(=O)OCC')).toEqual(['ester'])
  })
  it('anhídrido acético: un anhídrido', () => {
    expect(kinds('CC(=O)OC(=O)C')).toEqual(['anhydride'])
  })
  it('alanina: amina primaria y ácido carboxílico', () => {
    expect(kinds('C[C@@H](C(=O)O)N').sort()).toEqual(['amine1', 'carboxylicAcid'])
  })
  it('otros: cetona, éter, nitrilo, nitro, tiol, halogenuro, alqueno, alquino, acetato', () => {
    expect(kinds('CC(=O)C')).toEqual(['ketone'])
    expect(kinds('CCOCC')).toEqual(['ether'])
    expect(kinds('CC#N')).toEqual(['nitrile'])
    expect(kinds('c1ccc(cc1)[N+](=O)[O-]').sort()).toEqual(['arene', 'nitro'])
    expect(kinds('CCS')).toEqual(['thiol'])
    expect(kinds('CCCl')).toEqual(['halide'])
    expect(kinds('CC=CC')).toEqual(['alkene'])
    expect(kinds('CC#CC')).toEqual(['alkyne'])
    expect(kinds('CC(=O)[O-]')).toEqual(['carboxylate'])
    expect(kinds('CC(=O)Cl')).toEqual(['acylHalide'])
    expect(kinds('CNC')).toEqual(['amine2'])
    expect(kinds('c1ccc2ccccc2c1')).toEqual(['arene'])
  })
  it('los anillos fusionados enteros, también en Kekulé (naftaleno, antraceno, fenantreno)', () => {
    const arene = (smiles: string): number[] => detectFunctionalGroups(parseSmiles(smiles)).filter((g) => g.kind === 'arene').flatMap((g) => g.atoms)
    expect(arene('c1ccc2ccccc2c1')).toHaveLength(10)
    expect(arene('C1=CC=C2C=CC=CC2=C1')).toHaveLength(10)
    expect(arene('C1=CC=C2C=C3C=CC=CC3=CC2=C1')).toHaveLength(14)
    expect(arene('c1ccc2c(c1)ccc1ccccc12')).toHaveLength(14)
    expect(arene('C1=CC=C2C(=C1)C=CC3=CC=CC=C32')).toHaveLength(14)
    // lo que no es un benceno sigue fuera: la tetralina (un anillo saturado), la antraquinona (el del medio), la quinona
    expect(arene('C1CCC2=CC=CC=C2C1')).toHaveLength(6)
    expect(arene('O=C1C2=CC=CC=C2C(=O)C2=CC=CC=C12')).toHaveLength(12)
    expect(arene('O=C1C=CC(=O)C=C1')).toEqual([])
    expect(arene('O=c1ccc(=O)cc1')).toEqual([])
    expect(kinds('c1ccccc1-c1ccccc1')).toEqual(['arene', 'arene'])
    expect(kinds('C=Cc1ccccc1').sort()).toEqual(['alkene', 'arene'])
  })
  it('un naftol en Kekulé (como lo copia la IA de PubChem) es un fenol, no un alcohol', () => {
    expect(kinds('C1=CC=C2C=C(C=CC2=C1)O').sort()).toEqual(['arene', 'phenol'])
    expect(kinds('C1=CC=C2C(=C1)C=CC=C2O').sort()).toEqual(['arene', 'phenol'])
    expect(kinds('Oc1cccc2ccccc12').sort()).toEqual(['arene', 'phenol'])
  })
  it('los átomos del grupo, desde 0', () => {
    const ester = detectFunctionalGroups(parseSmiles('CC(=O)OCC'))[0]
    expect(ester.atoms).toEqual([1, 2, 3])
  })
  it('reconoce el grupo por la etiqueta que escribe la IA', () => {
    expect(groupKindsForLabel('Éster')).toEqual(['ester'])
    expect(groupKindsForLabel('grupo hidroxilo')).toContain('alcohol')
    expect(groupKindsForLabel('Ácido carboxílico')).toEqual(['carboxylicAcid'])
    expect(groupKindsForLabel('amine')).toEqual(['amine1', 'amine2', 'amine3'])
    expect(groupKindsForLabel('carbono quiral')).toEqual([])
  })
})
