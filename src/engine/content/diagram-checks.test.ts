// Validación de los topes y de las explicaciones largas, y atajos de la IA que no pierden nodos ni cambian de forma sin querer.
import { describe, expect, it } from 'vitest'
import { parseBlock } from '@engine/assistant/parser'
import type { JSONValue } from '@engine/base/json'
import { decodeBlock, type BlockOf } from '@shared/schema'
import { checkDiagramForm } from './diagram-checks'
import { DIAGRAM_MAX_NODES, mindmapTree } from './diagram-forms'
import { normalizeBlock } from './normalizer'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => {
  const b = decodeBlock(normalizeBlock({ type: 'diagram', ...raw } as JSONValue))
  if (b?.type !== 'diagram') throw new Error('no es un diagrama')
  return b
}
const nodes = (n: number): Array<{ id: string; label: string }> => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Nodo ${i}` }))

describe('lo que pasa del tope no se pierde sin avisar', () => {
  it(`más de ${DIAGRAM_MAX_NODES} nodos avisa (solo se dibujan ${DIAGRAM_MAX_NODES}), en cualquier diagrama`, () => {
    for (const form of [undefined, 'pyramid', 'venn', 'mindmap']) {
      const d = diagram({ form, nodes: nodes(DIAGRAM_MAX_NODES + 3) })
      expect(checkDiagramForm(d, 'b').some((i) => i.severity === 'warning' && i.path === 'b.nodes' && /63 nodos/.test(i.message)), String(form)).toBe(true)
    }
    expect(checkDiagramForm(diagram({ nodes: nodes(DIAGRAM_MAX_NODES) }), 'b').some((i) => i.path === 'b.nodes' && /nodos: solo se dibujan/.test(i.message))).toBe(false)
  })
  it('más de 200 flechas avisa', () => {
    const ns = nodes(21)
    const edges = ns.flatMap((a, i) => ns.slice(i + 1).map((z) => ({ from: a.id, to: z.id })))
    expect(edges.length).toBeGreaterThan(200)
    expect(checkDiagramForm(diagram({ nodes: ns, edges }), 'b').some((i) => i.severity === 'warning' && i.path === 'b.edges')).toBe(true)
  })
  it('el chat no descarta un diagrama que pasa del tope: se dibuja con el tope, como antes', () => {
    const children = Array.from({ length: 7 }, (_, i) => ({ label: `Rama ${i}`, children: Array.from({ length: 9 }, (_, j) => `Hoja ${i}.${j}`) }))
    expect(parseBlock(JSON.stringify({ type: 'diagram', form: 'mindmap', root: { label: 'Tema', children } }))?.type).toBe('diagram')
    expect(parseBlock(JSON.stringify({ type: 'diagram', nodes: nodes(DIAGRAM_MAX_NODES + 1) }))?.type).toBe('diagram')
  })
  it('una pirámide de 13 niveles avisa (y se dibujan los 13)', () => {
    const d = diagram({ form: 'pyramid', nodes: nodes(13) })
    expect(checkDiagramForm(d, 'b').some((i) => i.severity === 'warning' && /13 niveles/.test(i.message))).toBe(true)
  })
  it('el mapa mental anidado de la IA guarda todos sus nodos y el validador avisa de los que sobran', () => {
    const children = Array.from({ length: 7 }, (_, i) => ({ label: `Rama ${i}`, children: Array.from({ length: 9 }, (_, j) => `Hoja ${i}.${j}`) }))
    const d = diagram({ form: 'mindmap', root: { label: 'Tema', children } })
    expect(d.nodes).toHaveLength(1 + 7 + 63)
    expect(checkDiagramForm(d, 'b').some((i) => i.severity === 'warning' && /71 nodos/.test(i.message))).toBe(true)
    // y uno hondo (7 niveles) llega entero
    let deep: Record<string, unknown> = { label: 'N7' }
    for (let k = 6; k >= 1; k--) deep = { label: `N${k}`, children: [deep] }
    const t = mindmapTree(diagram({ form: 'mindmap', root: { label: 'N0', children: [deep] } }))!
    expect(t.depth).toBe(7)
  })
})

describe('explicaciones largas en las formas', () => {
  const long = 'x'.repeat(30).split('').map((_, i) => `palabra${i}`).join(' ')
  it('una explicación de más de 200 caracteres avisa en pirámide, embudo y mapa mental', () => {
    for (const form of ['pyramid', 'funnel', 'mindmap']) {
      const d = diagram({ form, nodes: [{ id: 'a', label: 'A', detail: long }, { id: 'b', label: 'B', detail: 'Corta' }], edges: form === 'mindmap' ? [{ from: 'a', to: 'b' }] : [] })
      const issues = checkDiagramForm(d, 'b').filter((i) => i.path.endsWith('.detail'))
      expect(issues.map((i) => [i.severity, i.path]), form).toEqual([['warning', 'b.nodes[0].detail']])
    }
  })
  it('en un diagrama sin forma no (el nodo la corta a 3 líneas con su puntos suspensivos)', () => {
    expect(checkDiagramForm(diagram({ nodes: [{ id: 'a', label: 'A', detail: long }, { id: 'b', label: 'B' }] }), 'b')).toEqual([])
  })
})

describe('«hierarchy» y «jerarquía» no son una pirámide', () => {
  it('un árbol o un organigrama con `kind: "hierarchy"` se sigue leyendo como flujo, con sus flechas', () => {
    for (const kind of ['hierarchy', 'Jerarquía', 'jerarquia']) {
      const d = diagram({ kind, nodes: [{ id: 'r', label: 'Reino' }, { id: 'f1', label: 'Filo 1' }, { id: 'f2', label: 'Filo 2' }], edges: [{ from: 'r', to: 'f1' }, { from: 'r', to: 'f2' }] })
      expect(d.form, kind).toBeUndefined()
      expect(d.kind).toBe('flow')
      expect(d.edges).toHaveLength(2)
      expect(checkDiagramForm(d, 'b')).toEqual([])
    }
  })
  it('las palabras de pirámide siguen dando la forma', () => {
    expect(diagram({ kind: 'pirámide', levels: ['Constitución', 'Leyes'] })).toMatchObject({ kind: 'layers', form: 'pyramid' })
    expect(diagram({ kind: 'pyramid', nodes: nodes(2) }).form).toBe('pyramid')
  })
})
