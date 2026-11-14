import { describe, expect, it } from 'vitest'
import { decodeBlock, decodeExercise, type Block, type ContentIssue } from '@shared/schema'
import { ContentNormalizer } from './normalizer'
import { ContentValidator } from './validator'

const v = ContentValidator.withMath()
const block = (o: object): Block => decodeBlock(ContentNormalizer.block(JSON.parse(JSON.stringify(o))))!
const issues = (o: object): ContentIssue[] => v.checkBlock(block(o), 'blocks[0]')
const find = (o: object, severity: ContentIssue['severity'], fragment: string): ContentIssue | undefined =>
  issues(o).find((i) => i.severity === severity && i.message.includes(fragment))

const CAFFEINE = { type: 'structure', title: 'Cafeína', smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', formula: 'C8H10N4O2', alt: 'Cafeína' }

describe('normalizador', () => {
  it('mueve las claves que la IA escribe distinto', () => {
    const b = block({ type: 'molecule', name: 'Etanol', SMILES: 'CCO', molecularFormula: 'C2H6O', highlights: [{ name: 'hidroxilo', atom: 3 }] })
    expect(b.type).toBe('structure')
    if (b.type !== 'structure') return
    expect(b.smiles).toBe('CCO')
    expect(b.title).toBe('Etanol')
    expect(b.formula).toBe('C2H6O')
    expect(b.groups).toEqual([{ atoms: [3], label: 'hidroxilo' }])
  })
  it('los grupos solo con nombre pasan a autoGroups', () => {
    const b = block({ type: 'structure', canonicalSmiles: 'CC(=O)OCC', groups: ['éster'] })
    expect(b.type === 'structure' && b.autoGroups && b.groups.length === 0 && b.smiles === 'CC(=O)OCC').toBe(true)
  })
})

describe('validación del bloque structure', () => {
  it('la cafeína con su fórmula pasa sin nada que decir', () => {
    expect(issues(CAFFEINE)).toEqual([])
  })
  it('una fórmula que no casa es un error', () => {
    const e = find({ ...CAFFEINE, formula: 'C8H10N4O' }, 'error', 'La SMILES da C8H10N4O2')
    expect(e?.path).toBe('blocks[0].formula')
  })
  it('SMILES vacía, una fórmula condensada, un elemento raro y demasiados enlaces', () => {
    expect(find({ type: 'structure', alt: 'x' }, 'error', 'Falta la SMILES')?.path).toBe('blocks[0].smiles')
    expect(find({ type: 'structure', alt: 'x', smiles: 'CH3CH2OH' }, 'error', 'etanol = CCO')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C[Xx]' }, 'error', 'no es un elemento')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C(C)(C)(C)(C)C' }, 'error', 'El átomo 1 (C) tiene 5 enlaces')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C'.repeat(81) }, 'error', 'máximo 80')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C1CC' }, 'error', 'anillo 1')).toBeDefined()
  })
  it('átomos de grupos y notas fuera de la molécula, con la numeración desde 1', () => {
    const e = find({ type: 'structure', alt: 'x', smiles: 'CCO', groups: [{ atoms: [3, 4], label: 'OH' }] }, 'error', 'El átomo 4 no existe')
    expect(e?.path).toBe('blocks[0].groups[0].atoms')
    expect(e?.message).toContain('se cuentan desde 1')
    expect(e?.message).toContain('1 C, 2 C, 3 O')
    expect(find({ type: 'structure', alt: 'x', smiles: 'CCO', groups: [{ atoms: [0], label: 'OH' }] }, 'error', 'no tiene átomos válidos')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CCO', notes: [{ atom: 9, text: 'α' }] }, 'error', 'El átomo 9')?.path).toBe('blocks[0].notes[0].atom')
  })
  it('avisos: dibujo deformado, sin alt, grupos repetidos, muchos átomos, desarrollada grande', () => {
    expect(find({ type: 'structure', alt: 'x', smiles: 'C1CC2CCC1C2' }, 'warning', 'deformado')).toBeDefined()
    expect(find({ type: 'structure', smiles: 'CCO' }, 'warning', 'Falta `alt`')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CCO', groups: [{ atoms: [3], label: 'OH' }, { atoms: [2], label: 'oh' }] }, 'warning', 'dos grupos')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C'.repeat(62) }, 'warning', 'es mucho')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CCCCCCCCCCCCCCCC', style: 'expanded' }, 'warning', 'hasta 15')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', aromatic: 'circle' }, 'warning', 'Kekulé')).toBeDefined()
  })
  it('info: estereoquímica tetraédrica, una etiqueta que no casa, sin fórmula', () => {
    expect(find({ type: 'structure', alt: 'x', smiles: 'C[C@@H](O)CC' }, 'info', 'no se dibujan')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'C/C=C\\C', formula: 'C4H8' }, 'info', 'no se dibujan')).toBeUndefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CC(=O)OCC', groups: [{ atoms: [1, 2], label: 'cetona' }] }, 'info', 'Aula reconoce: éster')).toBeDefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CC(=O)OCC', groups: [{ atoms: [2, 3, 4], label: 'Éster' }] }, 'info', 'Aula reconoce')).toBeUndefined()
    expect(find({ type: 'structure', alt: 'x', smiles: 'CCO' }, 'info', 'Añade `formula`')).toBeDefined()
  })
  it('pasos: el grupo tiene que existir', () => {
    const e = find({ type: 'structure', alt: 'x', smiles: 'CCO', groups: [{ atoms: [3], label: 'hidroxilo' }], steps: [{ md: 'a', group: 'hidroxilo' }, { md: 'b', group: 'carbonilo' }] }, 'error', '«carbonilo»')
    expect(e?.path).toBe('blocks[0].steps[1].group')
  })
  it('reacciones: se leen y avisa si no está ajustada 1:1', () => {
    expect(issues({ type: 'structure', alt: 'x', smiles: 'CC(=O)O.OCC>>CC(=O)OCC.O' }).filter((i) => i.severity !== 'info')).toEqual([])
    expect(find({ type: 'structure', alt: 'x', smiles: 'CC>>CC=O' }, 'info', 'no está ajustada')).toBeDefined()
  })
  it('varias sustancias con «.»: sin pedir `formula` y sin una fórmula sumada', () => {
    const pair = { type: 'structure', alt: 'butano e isobutano', smiles: 'CCCC.CC(C)C' }
    expect(find(pair, 'info', 'Añade `formula`')).toBeUndefined()
    expect(issues({ ...pair, formula: 'C4H10' }).filter((i) => i.path.endsWith('.formula'))).toEqual([])
    expect(issues({ ...pair, formula: 'C4H10, C4H10' }).filter((i) => i.path.endsWith('.formula'))).toEqual([])
    // la suma de antes sigue valiendo (los cursos que ya la tienen no se rompen)
    expect(issues({ ...pair, formula: 'C8H20' }).filter((i) => i.path.endsWith('.formula'))).toEqual([])
    const wrong = find({ ...pair, formula: 'C5H12' }, 'warning', '2 sustancias (C4H10 · C4H10)')
    expect(wrong?.path).toBe('blocks[0].formula')
    // una sal es una sola sustancia: su fórmula se comprueba como siempre
    expect(find({ type: 'structure', alt: 'sal', smiles: '[Na+].[Cl-]', formula: 'KCl' }, 'error', 'La SMILES da NaCl')).toBeDefined()
  })
  it('lo que ya se dibuja bien no avisa (gem-dimetilo, esteroides, penicilina); la desarrollada encimada sí', () => {
    for (const smiles of ['CC1(C)CCCCC1', 'CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C', 'CC1(C)S[C@@H]2[C@H](C(=O)N2[C@H]1C(=O)O)NC(=O)Cc1ccccc1']) {
      expect(find({ type: 'structure', alt: 'x', smiles }, 'warning', 'deformado'), smiles).toBeUndefined()
      expect(find({ type: 'structure', alt: 'x', smiles }, 'warning', 'encimados'), smiles).toBeUndefined()
    }
    expect(find({ type: 'structure', alt: 'x', smiles: 'CC(C)(C)O', style: 'expanded' }, 'warning', 'encimados')).toBeUndefined()
    const crowded = find({ type: 'structure', alt: 'x', smiles: 'CCC1(C)CCCCC1', style: 'expanded' }, 'warning', 'La fórmula desarrollada de esta molécula sale con átomos encimados')
    expect(crowded?.path).toBe('blocks[0].style')
    // una reacción no se dibuja en desarrollada, pero no porque se pise: se dice el motivo de verdad
    const reaction = issues({ type: 'structure', alt: 'x', smiles: 'C=C.[H][H]>>CC', style: 'expanded' }).filter((i) => i.path.endsWith('.style'))
    expect(reaction.map((i) => i.message)).toEqual(['Las reacciones no se dibujan en fórmula desarrollada: se verá semidesarrollada.'])
  })
  it('un ejercicio de fórmula con una estructura en el enunciado: la clave debe ser su fórmula', () => {
    const ex = (expected: string) => decodeExercise(ContentNormalizer.exercise(JSON.parse(JSON.stringify({
      id: 'e', level: 2, prompt: [{ type: 'text', md: '¿Cuál es su fórmula molecular?' }, { type: 'structure', alt: 'x', smiles: 'CCO', formula: 'C2H6O' }],
      answer: { kind: 'chem', mode: 'formula', expected }, solution: 's'
    })), 's', 'e'))!
    expect(v.checkExercise(ex('C2H6O'), 'e').filter((i) => i.message.includes('estructura del enunciado'))).toEqual([])
    expect(v.checkExercise(ex('C2H4O'), 'e').some((i) => i.message.includes('estructura del enunciado'))).toBe(true)
  })
  it('con varias sustancias en el enunciado, la clave puede ser la de una de ellas', () => {
    const ex = (expected: string) => decodeExercise(ContentNormalizer.exercise(JSON.parse(JSON.stringify({
      id: 'e', level: 2, prompt: [{ type: 'text', md: '¿Cuál es la fórmula del alcohol?' }, { type: 'structure', alt: 'x', smiles: 'CCO.O' }],
      answer: { kind: 'chem', mode: 'formula', expected }, solution: 's'
    })), 's', 'e'))!
    expect(v.checkExercise(ex('C2H6O'), 'e').filter((i) => i.message.includes('estructura del enunciado'))).toEqual([])
    const bad = v.checkExercise(ex('CH4O'), 'e').find((i) => i.message.includes('estructura del enunciado'))
    expect(bad?.message).toContain('C2H6O · H2O')
  })
})
