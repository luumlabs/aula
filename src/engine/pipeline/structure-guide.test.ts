import { describe, expect, it } from 'vitest'
import { decodeBlocks } from '@shared/schema/blocks'
import { showItProblems, VISUAL_BLOCK_TYPES } from './audit'
import { AUTHORING_GUIDE, AUTHORING_GUIDE_ADDITIONS, BLOCK_REFERENCE, BLOCK_REFERENCE_TYPES, blockReferenceKey } from './guide'
import { organicStructureProblems } from './structure-guide'

const blocks = (raw: unknown[]) => decodeBlocks(raw, 0)
const text = (md: string) => ({ type: 'text', md })

describe('guía y referencia del bloque structure', () => {
  it('todos los tipos de la referencia tienen su texto; los alias llevan a structure', () => {
    for (const t of BLOCK_REFERENCE_TYPES) expect(BLOCK_REFERENCE[t], t).toBeTruthy()
    for (const alias of ['smiles', 'skeletal', 'structural', 'chemfig']) expect(blockReferenceKey(alias)).toBe('structure')
    expect(blockReferenceKey('molecule')).toBe('model3d')
    expect(BLOCK_REFERENCE.structure).toContain('"type":"structure"')
    expect(BLOCK_REFERENCE.structure).toContain('chemistry {"action":"structure"')
    expect(BLOCK_REFERENCE.model3d).toContain('`structure`')
    // en un enunciado no se nombra la molécula; con «.», sin `formula`
    expect(BLOCK_REFERENCE.structure).toContain('In an exercise prompt')
    expect(BLOCK_REFERENCE.structure).toContain("don't name the molecule or its groups in `alt` or `caption`")
    expect(BLOCK_REFERENCE.structure).toContain('get one formula each, so leave `formula` out')
  })
  it('la guía enseña cuándo usarlo y \\chemfig lleva a él', () => {
    expect(AUTHORING_GUIDE + AUTHORING_GUIDE_ADDITIONS).toContain("a molecule's connectivity")
    expect(AUTHORING_GUIDE).toMatch(/chemfig[^\n]*structure/)
    expect(AUTHORING_GUIDE).toMatch(/Chemistry: `structure`/)
    expect(VISUAL_BLOCK_TYPES).toContain('structure')
  })
})

describe('auditoría: química orgánica sin estructuras', () => {
  const esters = [
    text('Los **ésteres** se forman al reaccionar un ácido carboxílico con un alcohol: es la esterificación.'),
    text('El acetato de etilo, $\\ce{CH3COOCH2CH3}$, es el disolvente de los quitaesmaltes; el grupo funcional éster es –COO–.'),
    text('Las moléculas de los ésteres no forman puentes de hidrógeno entre sí: hierven antes que los alcoholes.')
  ]
  it('una lección de ésteres sin ninguna estructura no pasa', () => {
    const out = organicStructureProblems(blocks(esters), 'es')
    expect(out).toHaveLength(1)
    expect(out[0].forAI).toContain('`structure`')
    expect(out[0].forUser).toBe('La lección es de química orgánica y no dibuja ninguna molécula.')
    expect(showItProblems(blocks(esters), { realPictures: false }, 'en').some((p) => p.forUser.includes('organic chemistry'))).toBe(true)
  })
  it('con una estructura (o un model3d con la molécula) sí pasa', () => {
    expect(organicStructureProblems(blocks([...esters, { type: 'structure', smiles: 'CC(=O)OCC', alt: 'acetato de etilo' }]), 'es')).toEqual([])
    expect(organicStructureProblems(blocks([...esters, { type: 'model3d', formula: 'ethanol' }]), 'es')).toEqual([])
  })
  it('el oxígeno, el hidrógeno y el nitrógeno no son química orgánica (agua, amoniaco, ciclo del carbono, genética)', () => {
    const lessons = [
      [text('Una molécula de agua tiene un átomo de oxígeno unido a dos átomos de hidrógeno mediante enlaces covalentes.'), text('El oxígeno es más electronegativo que el hidrógeno: el oxígeno atrae los electrones y el hidrógeno queda con carga parcial positiva.'), text('$\\ce{2H2 + O2 -> 2H2O}$')],
      [text('En el proceso Haber el nitrógeno y el hidrógeno forman amoniaco, $\\ce{N2 + 3H2 <=> 2NH3}$.'), text('Cada molécula de nitrógeno necesita tres de hidrógeno; el hidrógeno sale del metano… o del agua, y el nitrógeno del aire.')],
      [text('El ciclo del carbono es un fenómeno lento: el carbono recorre un largo camino por el terreno, los océanos y los seres vivos.'), text('El oxígeno y el hidrógeno de la glucosa vuelven al aire; el veneno de un ecosistema es el exceso de nitrógeno.'), text('Un halógeno no es un nutriente; el destino del carbono es volver a la atmósfera.')],
      [text('La molécula de ADN decide el sexo: masculino o femenino.'), text('Es un destino escrito en el núcleo; el hidrógeno de las bases las une; las vitaminas, como la vitamina C, son moléculas pequeñas.'), text('Cada vitamina es distinta; el oxígeno llega a todas las células.')]
    ]
    for (const lesson of lessons) expect(organicStructureProblems(blocks(lesson), 'es')).toEqual([])
  })
  it('los nombres sistemáticos sí cuentan: metano, but-2-eno, propan-2-ol, propanona, ácido etanoico, metilamina', () => {
    const iupac = [
      text('Nombra estas moléculas: metano, etano, 2-metilpropano y ciclohexano.'),
      text('Después vienen el eteno, el but-2-eno, la buta-1,3-dieno y el etino.'),
      text('Y por último: etanol, propan-2-ol, propanal, propanona, ácido etanoico y metilamina.')
    ]
    expect(organicStructureProblems(blocks(iupac), 'es')).toHaveLength(1)
  })
  it('una lección de historia que habla del alcohol no es química', () => {
    const history = [text('La Ley Seca prohibió el alcohol en Estados Unidos entre 1920 y 1933.'), text('El contrabando de alcohol hizo ricos a los gánsteres; los alcoholes destilados se vendían en bares clandestinos.')]
    expect(organicStructureProblems(blocks(history), 'es')).toEqual([])
  })
})
