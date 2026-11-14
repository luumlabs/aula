// Un bloque visual en un mensaje del chat o del tutor pasa por el normalizador, como en las lecciones: las formas abreviadas
// que documenta la guía (un Venn con `sets`/`items`, un mapa mental con `root`, un `process`) se dibujan, no quedan en blanco.
import { describe, expect, it } from 'vitest'
import { decodeBlock } from '@shared/schema/blocks'
import { inlineBlockOf } from './InlineBlock'

const nodesOf = (raw: unknown): number => {
  const b = inlineBlockOf(raw)
  return b?.type === 'diagram' ? b.nodes.length : -1
}

describe('bloques del chat', () => {
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
})
