// Lo que «Marcar» cuenta del bloque al tutor: en el enunciado de un ejercicio sin resolver no da la respuesta.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type Block } from '@shared/schema/blocks'
import { askLabel } from '../visual/shared/DrawingCanvas'
import { blockInfo } from './AskLayer'

const block = (o: object): Block => decodeBlock(o)!

describe('blockInfo', () => {
  it('una molécula del enunciado sin resolver no lleva su nombre (ni su texto alternativo)', () => {
    const b = block({ id: 'm', type: 'structure', smiles: 'CCO', title: 'Etanol', alt: 'Estructura del etanol', caption: 'Mira el grupo OH' })
    expect(blockInfo(b, true)).toEqual({ kind: 'structure', title: undefined, caption: 'Mira el grupo OH' })
    expect(blockInfo(b, false).title).toBe('Etanol')
    const onlyAlt = block({ id: 'm2', type: 'structure', smiles: 'CCO', alt: 'Estructura del etanol' })
    expect(blockInfo(onlyAlt, true).title).toBeUndefined()
    expect(blockInfo(onlyAlt).title).toBe('Estructura del etanol')
  })

  it('las demás figuras enseñan su título también en el enunciado: se queda', () => {
    const d = block({ id: 'd', type: 'diagram', kind: 'flow', title: 'De la glucosa al ATP', nodes: [{ id: 'a', label: 'A' }], edges: [] })
    expect(blockInfo(d, true).title).toBe('De la glucosa al ATP')
  })
})

describe('askLabel de un dibujo', () => {
  it("con 'visible' solo usa lo que se ve escrito: la etiqueta o el texto, no el nombre", () => {
    expect(askLabel({ kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, name: 'Normal' } as never)).toBe('Normal')
    expect(askLabel({ kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, name: 'Normal' } as never, true)).toBeUndefined()
    expect(askLabel({ kind: 'arrow', x1: 0, y1: 0, x2: 10, y2: 0, name: 'Normal', label: 'F₁' } as never, true)).toBe('F₁')
    expect(askLabel({ kind: 'text', x: 0, y: 0, text: 'P' } as never, true)).toBe('P')
  })
})
