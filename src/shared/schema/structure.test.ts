import { describe, expect, it } from 'vitest'
import { parseJSON, stringifyJSON } from '@engine/base/json'
import { decodeBlock, encodeBlock, type Block, type BlockOf } from './blocks'
import { decodeStructure, encodeStructure, makeStructure, routeStructureType } from './structure'

const decode = (json: string): Block => decodeBlock(parseJSON(json))!
const structure = (json: string): BlockOf<'structure'> => {
  const b = decode(json)
  if (b.type !== 'structure') throw new Error(`es ${b.type}`)
  return b
}

describe('bloque structure', () => {
  it('se lee con su tipo y con cada alias', () => {
    for (const type of ['structure', 'Structural', 'structural_formula', 'skeletal', 'line-angle', 'smiles', 'chem_structure', 'estructura', 'molecule2d']) {
      const b = structure(`{"type":"${type}","smiles":"CCO"}`)
      expect(b.smiles).toBe('CCO')
      expect(b.style).toBe('skeletal')
    }
  })

  it('«molecule» con SMILES y sin nada en 3D es una estructura; con átomos o fórmula sigue siendo model3d', () => {
    expect(decode('{"type":"molecule","smiles":"CCO"}').type).toBe('structure')
    expect(decode('{"type":"molecular","smiles":"CCO","title":"Etanol"}').type).toBe('structure')
    expect(decode('{"type":"molecule","formula":"H2O"}').type).toBe('model3d')
    expect(decode('{"type":"molecule","smiles":"O","atoms":[{"element":"O","x":0,"y":0,"z":0}]}').type).toBe('model3d')
    expect(decode('{"type":"molecule3d","smiles":"CCO"}').type).toBe('model3d')
    expect(decode('{"type":"model3d","smiles":"CCO"}').type).toBe('model3d')
    expect(routeStructureType('diagram', 'molecule', { smiles: 'C' })).toBe('diagram')
  })

  it('estilos: full → semidesarrollada; los alias en español', () => {
    expect(structure('{"type":"structure","smiles":"CC","full":true}').style).toBe('condensed')
    expect(structure('{"type":"structure","smiles":"CC","style":"semidesarrollada"}').style).toBe('condensed')
    expect(structure('{"type":"structure","smiles":"CC","style":"desarrollada"}').style).toBe('expanded')
    expect(structure('{"type":"structure","smiles":"CC","style":"line"}').style).toBe('skeletal')
    expect(structure('{"type":"structure","smiles":"CC","style":"???"}').style).toBe('skeletal')
  })

  it('átomos de los grupos: el texto «3» vale; 0, −1 y 1,5 no', () => {
    const b = structure('{"type":"structure","smiles":"CCO","groups":[{"atoms":["3",0,-1,1.5,2,2],"label":"OH"},{"atoms":3,"label":"uno"}],"notes":[{"atom":"2","text":"α"},{"atom":0,"text":"x"}]}')
    expect(b.groups[0].atoms).toEqual([3, 2])
    expect(b.groups[1].atoms).toEqual([3])
    expect(b.notes).toEqual([{ atom: 2, text: 'α' }])
  })

  it('la SMILES se recorta (espacios fuera, 500 caracteres como mucho)', () => {
    expect(structure('{"type":"structure","smiles":"  CCO  "}').smiles).toBe('CCO')
    expect(structure(`{"type":"structure","smiles":"${'C'.repeat(700)}"}`).smiles).toHaveLength(500)
  })

  it('se guarda igual y mínimo', () => {
    const json = '{"type":"structure","id":"s1","title":"Aspirina","smiles":"CC(=O)Oc1ccccc1C(=O)O","formula":"C9H8O4","alt":"aspirina","groups":[{"atoms":[2,3,4],"label":"éster","md":"R–COO–R"}],"steps":[{"md":"El éster","group":"éster"},"Y el ácido"]}'
    const b = decode(json)
    const out = encodeBlock(b)
    expect(out).toEqual({
      id: 's1', type: 'structure', title: 'Aspirina', smiles: 'CC(=O)Oc1ccccc1C(=O)O', formula: 'C9H8O4', alt: 'aspirina',
      groups: [{ atoms: [2, 3, 4], label: 'éster', md: 'R–COO–R' }], steps: [{ md: 'El éster', group: 'éster' }, { md: 'Y el ácido' }]
    })
    expect(encodeBlock(decodeBlock(parseJSON(stringifyJSON(out)))!)).toEqual(out)
    // los opcionales con su valor por defecto no se escriben
    expect(encodeStructure(makeStructure({ smiles: 'C' }))).toEqual({ smiles: 'C', alt: '' })
    const all = encodeStructure(makeStructure({ smiles: 'C', style: 'expanded', aromatic: 'kekule', autoGroups: true, showFormula: false, reversible: true, conditions: 'calor', notes: [{ atom: 1, text: 'x' }] }))
    expect(all).toEqual({ smiles: 'C', alt: '', style: 'expanded', aromatic: 'kekule', autoGroups: true, notes: [{ atom: 1, text: 'x' }], showFormula: false, conditions: 'calor', reversible: true })
    expect(decodeStructure(all)).toEqual(makeStructure({ smiles: 'C', style: 'expanded', aromatic: 'kekule', autoGroups: true, showFormula: false, reversible: true, conditions: 'calor', notes: [{ atom: 1, text: 'x' }] }))
  })

  it('una versión antigua lo conserva como desconocido (forma JSON intacta)', () => {
    const b = decode('{"type":"structure","smiles":"CCO"}')
    expect(encodeBlock(b).smiles).toBe('CCO')
  })
})
