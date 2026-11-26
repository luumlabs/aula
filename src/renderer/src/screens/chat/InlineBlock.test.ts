// Un bloque visual en un mensaje del chat o del tutor pasa por el normalizador, como en las lecciones: las formas abreviadas
// que documenta la guía (un Venn con `sets`/`items`, un mapa mental con `root`, un `process`) se dibujan, no quedan en blanco.
import { describe, expect, it } from 'vitest'
import { decodeBlock } from '@shared/schema/blocks'
import { drawItemShape } from '@engine/drawing/shapes'
import { chatFigureContext, inlineBlockOf } from './InlineBlock'

const nodesOf = (raw: unknown): number => {
  const b = inlineBlockOf(raw)
  return b?.type === 'diagram' ? b.nodes.length : -1
}

describe('bloques del chat', () => {
  it('un dibujo guardado con alias y extremos sigue mostrando sus líneas', () => {
    const b = inlineBlockOf({ type: 'drawing', width: 400, height: 300, items: [
      { kind: 'axis', x1: 40, y1: 260, x2: 380, y2: 260 },
      { kind: 'ground', x1: 20, y1: 250, x2: 380, y2: 250 },
      { kind: 'grid', x1: 0, y1: 0, x2: 400, y2: 300 }
    ] })
    expect(b?.type).toBe('drawing')
    if (b?.type !== 'drawing') throw new Error('no es un dibujo')
    expect(b.items.map((it) => drawItemShape(it).paths.map((p) => p.d))).toEqual([
      ['M40 260L380 260'], ['M20 250L380 250'], ['M0 0L400 300']
    ])
  })

  it('un Venn abreviado (sets/items) tiene sus conjuntos y sus elementos', () => {
    const venn = { type: 'diagram', form: 'venn', title: 'Mitosis y meiosis', sets: [{ id: 'mi', label: 'Mitosis' }, { id: 'me', label: 'Meiosis' }], items: [{ label: 'Replica el ADN', in: ['mi', 'me'] }, { label: '4 células hijas', in: ['me'] }] }
    // sin normalizar no había nada que dibujar
    const plain = decodeBlock(venn)
    expect(plain?.type === 'diagram' ? plain.nodes.length : 0).toBe(0)
    expect(nodesOf(venn)).toBe(4)
  })

  it('un mapa mental abreviado (root/children) tiene sus ramas', () => {
    expect(nodesOf({ type: 'diagram', form: 'mindmap', title: 'La célula', root: { label: 'La célula', children: [{ label: 'Núcleo', children: ['ADN', 'Nucléolo'] }, 'Membrana'] } })).toBe(5)
  })

  it('un bloque normal sale igual; lo que no se puede leer, undefined (se enseña como código)', () => {
    expect(inlineBlockOf({ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] })?.type).toBe('table')
    expect(inlineBlockOf('no es un bloque')).toBeUndefined()
    expect(inlineBlockOf(null)).toBeUndefined()
  })

  it('el contexto de «Marcar y preguntar» en una figura del chat conserva la procedencia y el curso si lo hay', () => {
    const marked = { studentText: '¿Por qué aquí?', context: 'En el diagrama «Mitosis»: «Anafase».' }
    expect(chatFigureContext(null, 'blk-1', marked)).toEqual({
      screen: 'chat',
      blockID: 'blk-1',
      markedFigure: marked
    })
    expect(chatFigureContext('bio-101', 'blk-2', marked)).toEqual({
      courseID: 'bio-101',
      screen: 'chat',
      blockID: 'blk-2',
      markedFigure: marked
    })
  })
})
