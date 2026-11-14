// Formas de diagrama y comparaciones en Markdown.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema'
import { compareCells, diagramFormMarkdown } from './shapes-markdown'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => {
  const b = decodeBlock({ type: 'diagram', ...raw })
  if (b?.type !== 'diagram') throw new Error('no es un diagrama')
  return b
}

describe('formas en Markdown', () => {
  it('Venn región por región', () => {
    const d = diagram({
      form: 'venn',
      nodes: [{ id: 'mi', label: 'Mitosis', shape: 'circle' }, { id: 'me', label: 'Meiosis', shape: 'circle' }, { id: 'x', label: '2 células' }, { id: 'z', label: 'Replica el ADN' }, { id: 'w', label: 'Nada' }],
      edges: [{ from: 'x', to: 'mi' }, { from: 'z', to: 'mi' }, { from: 'z', to: 'me' }]
    })
    expect(diagramFormMarkdown(d, 'es')).toBe('- **Solo Mitosis:** 2 células\n- **Mitosis y Meiosis:** Replica el ADN\n- **Fuera de los conjuntos:** Nada')
    expect(diagramFormMarkdown(d, 'en')).toContain('- **Only Mitosis:** 2 células')
  })
  it('mapa mental como lista anidada; pirámide numerada de arriba abajo', () => {
    const m = diagram({ form: 'mindmap', nodes: [{ id: 'r', label: 'Célula' }, { id: 'a', label: 'Núcleo', detail: 'ADN' }, { id: 'b', label: 'Nucléolo' }], edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'b' }] })
    expect(diagramFormMarkdown(m, 'es')).toBe('**Célula**\n\n- Núcleo — ADN\n  - Nucléolo')
    const p = diagram({ form: 'pyramid', nodes: [{ id: 'c', label: 'Constitución' }, { id: 'l', label: 'Leyes' }] })
    expect(diagramFormMarkdown(p, 'es')).toBe('1. **Constitución**\n2. **Leyes**')
    expect(diagramFormMarkdown(diagram({ nodes: [{ id: 'a', label: 'A' }] }), 'es')).toBeUndefined()
  })
  it('la fila clave de una comparación va en negrita', () => {
    expect(compareCells({ label: 'Hijas', left: '2', right: '4', tone: 'key' })).toEqual(['**Hijas**', '**2**', '**4**'])
    expect(compareCells({ left: '2', right: '4' })).toEqual(['', '2', '4'])
    // la negrita que ya trae la celda no se anida (**a **b**** no se lee)
    expect(compareCells({ label: 'ADN', left: 'a **b** c', right: '**4**', tone: 'key' })).toEqual(['**ADN**', '**a b c**', '**4**'])
  })
})
