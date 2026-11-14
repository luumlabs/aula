// Flechas de los diagramas: en un ciclo van por la pista y se cortan en las cajas (Sketchy cycle()/reach()), la pista crece
// hasta que ningún par de vecinos se toca, y cada flecha trae sus puntos y su punta abierta para dibujarla a tinta.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { layoutDiagram, stepHighlight, type NodeBox, type Pt } from './diagramLayout'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const overlap = (a: NodeBox, b: NodeBox): boolean => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h
const inBox = (p: Pt, n: NodeBox, gap = 0): boolean => Math.abs(p[0] - n.x) <= n.w / 2 + gap && Math.abs(p[1] - n.y) <= n.h / 2 + gap
/** Distancia de un punto al borde de la caja (0 si está dentro). */
const toBox = (p: Pt, n: NodeBox): number => Math.hypot(Math.max(0, Math.abs(p[0] - n.x) - n.w / 2), Math.max(0, Math.abs(p[1] - n.y) - n.h / 2))

describe('ciclo: flechas por la pista', () => {
  const wide = 'Etiqueta bastante larga del paso'
  for (let n = 3; n <= 12; n++) {
    it(`${n} nodos anchos: sin solaparse, flechas sobre la elipse que empiezan y acaban junto a las cajas`, () => {
      const l = layoutDiagram(diagram({ kind: 'cycle', nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `${wide} ${i + 1}` })) }))
      for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) expect(overlap(l.nodes[i], l.nodes[j])).toBe(false)
      const { cx, cy, rx, ry } = l.cycle!
      expect(ry).toBeGreaterThanOrEqual(rx * 0.72 - 0.01)
      expect(l.edges).toHaveLength(n)
      const byId = new Map(l.nodes.map((x) => [x.id, x]))
      for (const e of l.edges) {
        const a = byId.get(e.from)!, z = byId.get(e.to)!
        const first = e.pts[0], last = e.pts[e.pts.length - 1]
        expect(inBox(first, a)).toBe(false)
        expect(inBox(last, z)).toBe(false)
        expect(toBox(first, a)).toBeLessThanOrEqual(12)
        expect(toBox(last, z)).toBeLessThanOrEqual(12)
        // sobre la elipse (±2 px)
        for (const p of e.pts) {
          const t = Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx)
          expect(Math.hypot(p[0] - (cx + rx * Math.cos(t)), p[1] - (cy + ry * Math.sin(t)))).toBeLessThanOrEqual(2)
        }
        // ninguna flecha cruza otra caja
        for (const other of l.nodes) for (const p of e.pts) expect(inBox(p, other)).toBe(false)
        expect(e.barbs).toBeDefined()
        expect(e.barbs![1]).toEqual(last)
      }
    })
  }
  it('las flechas que no unen vecinos siguen dibujándose (por dentro, en curva)', () => {
    const l = layoutDiagram(diagram({ kind: 'cycle', nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, label: id })), edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }, { from: 'A', to: 'C', dashed: true }] }))
    expect(l.edges.map((e) => e.key)).toContain('A>C')
    expect(l.edges.find((e) => e.key === 'A>C')!.d).toMatch(/Q/)
  })
})

describe('flechas a tinta en los diagramas de flujo', () => {
  it('los puntos van del borde de una caja a la punta y la punta abierta es simétrica', () => {
    const l = layoutDiagram(diagram({ nodes: [{ id: 'a', label: 'Inicio' }, { id: 'b', label: 'Fin' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', arrow: false }] }))
    const e = l.edges.find((x) => x.key === 'a>b')!
    const [p1, tip, p2] = e.barbs!
    expect(tip).toEqual(e.pts[e.pts.length - 1])
    const d1 = Math.hypot(p1[0] - tip[0], p1[1] - tip[1]), d2 = Math.hypot(p2[0] - tip[0], p2[1] - tip[1])
    expect(d1).toBeCloseTo(d2, 6)
    expect(l.edges.find((x) => x.key === 'b>a')!.barbs).toBeUndefined()
  })
})

describe('pasos: lo rodeado y lo encendido', () => {
  it('los nodos del paso se rodean; los extremos de sus flechas solo se encienden', () => {
    const d = diagram({ nodes: ['a', 'b', 'c'].map((id) => ({ id, label: id })), edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], steps: [{ md: 'x', nodes: ['a'], edges: [['b', 'c']] }, { md: 'y' }] })
    const h = stepHighlight(d, 0)!
    expect([...h.focus]).toEqual(['a'])
    expect([...h.nodes].sort()).toEqual(['a', 'b', 'c'])
    expect(h.edges.has('b>c')).toBe(true)
    expect(h.edges.has('a>b')).toBe(true)
    // un paso sin nodos ni flechas es la vista general: no apaga nada
    expect(stepHighlight(d, 1)).toBeUndefined()
  })
})
