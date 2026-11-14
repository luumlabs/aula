// Formas ya hechas: modelos (Venn, mapa mental, niveles), atajos de la IA, validación y lo que se ve al construir paso a paso.
import { describe, expect, it } from 'vitest'
import type { JSONValue } from '@engine/base/json'
import { decodeBlock, type BlockOf } from '@shared/schema'
import { checkCompare, checkDiagramForm } from './diagram-checks'
import { mindNodes, mindmapTree, pyramidLevels, regionKey, revealedAt, vennModel, vennRegions } from './diagram-forms'
import { normalizeBlock } from './normalizer'
import { ContentValidator } from './validator'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => {
  const b = decodeBlock(normalizeBlock({ type: 'diagram', ...raw } as JSONValue))
  if (b?.type !== 'diagram') throw new Error('no es un diagrama')
  return b
}
const node = (id: string, label = id, shape?: string): Record<string, unknown> => ({ id, label, ...(shape ? { shape } : {}) })

describe('Venn', () => {
  const v = diagram({
    form: 'venn',
    nodes: [node('mi', 'Mitosis', 'circle'), node('me', 'Meiosis', 'circle'), node('x', '2 células'), node('y', '4 células'), node('z', 'Replica el ADN'), node('w', 'Fotosíntesis')],
    edges: [{ from: 'x', to: 'mi' }, { from: 'y', to: 'me' }, { from: 'z', to: 'mi' }, { from: 'me', to: 'z' }]
  })
  it('los círculos son los conjuntos; los demás, elementos con su pertenencia', () => {
    const m = vennModel(v)
    expect(m.sets.map((s) => s.id)).toEqual(['mi', 'me'])
    expect(Object.fromEntries(m.items.map((i) => [i.node.id, regionKey(i.sets)]))).toEqual({ x: 'mi', y: 'me', z: 'mi&me', w: '' })
    expect(m.stray).toHaveLength(0)
  })
  it('regiones: primero las de un conjunto, luego la intersección y al final lo de fuera', () => {
    expect(vennRegions(vennModel(v)).map((r) => r.key)).toEqual(['mi', 'me', 'mi&me', ''])
  })
  it('validación: 2–3 conjuntos, flechas a conjuntos y regiones no muy llenas', () => {
    expect(checkDiagramForm(v, 'b').filter((i) => i.severity !== 'info')).toEqual([])
    const one = diagram({ form: 'venn', nodes: [node('a', 'A', 'circle'), node('x')], edges: [{ from: 'x', to: 'a' }] })
    expect(checkDiagramForm(one, 'b').some((i) => i.severity === 'error')).toBe(true)
    const four = diagram({ form: 'venn', nodes: ['a', 'b', 'c', 'd'].map((id) => node(id, id, 'circle')) })
    expect(checkDiagramForm(four, 'b').some((i) => i.severity === 'error')).toBe(true)
    const bad = diagram({ form: 'venn', nodes: [node('a', 'A', 'circle'), node('b', 'B', 'circle'), node('x'), node('y')], edges: [{ from: 'x', to: 'y' }, { from: 'x', to: 'a' }] })
    expect(checkDiagramForm(bad, 'b').some((i) => i.severity === 'warning' && i.path === 'b.edges[0]')).toBe(true)
    const crowded = diagram({ form: 'venn', nodes: [node('a', 'A', 'circle'), node('b', 'B', 'circle'), ...Array.from({ length: 7 }, (_, i) => node(`i${i}`))], edges: Array.from({ length: 7 }, (_, i) => ({ from: `i${i}`, to: 'a' })) })
    expect(checkDiagramForm(crowded, 'b').some((i) => i.severity === 'warning' && /7 elementos/.test(i.message))).toBe(true)
  })
  it('atajo de la IA: `sets` + `in` (por id o por nombre) pasa a círculos y flechas', () => {
    const d = diagram({ form: 'venn', sets: [{ id: 'mi', label: 'Mitosis' }, 'Meiosis'], items: [{ label: '2 células', in: ['mi'] }, { label: 'Replica el ADN', in: ['Mitosis', 'meiosis'] }, 'Suelto'] })
    const m = vennModel(d)
    expect(m.sets.map((s) => s.label)).toEqual(['Mitosis', 'Meiosis'])
    expect(m.items.map((i) => [i.node.label, i.sets.length])).toEqual([['2 células', 1], ['Replica el ADN', 2], ['Suelto', 0]])
  })
  it('atajo: elementos dentro de cada conjunto (los repetidos van a la intersección) y `both`', () => {
    const d = diagram({ type: 'venn', sets: [{ label: 'Planta', items: ['Pared celular', 'Núcleo'] }, { label: 'Animal', items: ['Centriolos', 'núcleo'] }], both: ['Mitocondria'] })
    expect(d.form).toBe('venn')
    const regions = Object.fromEntries(vennRegions(vennModel(d)).map((r) => [r.sets.length, r.items.map((i) => i.node.label)]))
    expect(regions[2]).toEqual(['Núcleo', 'Mitocondria'])
  })
})

describe('mapa mental', () => {
  it('raíz = primer nodo sin flecha de entrada; cada rama cuelga de su primer padre', () => {
    const d = diagram({ form: 'mindmap', nodes: [node('a'), node('r'), node('b'), node('c')], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'b', to: 'c' }] })
    const t = mindmapTree(d)!
    expect(t.root.node.id).toBe('r')
    expect(t.roots).toBe(1)
    expect(t.depth).toBe(2)
    expect(mindNodes(t).map((m) => `${m.node.id}${m.depth}`)).toEqual(['r0', 'a1', 'b1', 'c2'])
  })
  it('dos raíces, ciclos y segundos padres: se avisa y no se pierde ningún nodo', () => {
    const d = diagram({ form: 'mindmap', nodes: [node('r'), node('a'), node('b'), node('s'), node('t')], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'r' }, { from: 's', to: 't' }] })
    const t = mindmapTree(d)!
    expect(mindNodes(t)).toHaveLength(5)
    expect(t.cyclic).toBe(true)
    expect(t.extra.length).toBe(2)
    const issues = checkDiagramForm(d, 'b')
    expect(issues.some((i) => /ciclo/.test(i.message))).toBe(true)
    const two = diagram({ form: 'mindmap', nodes: [node('r'), node('a'), node('s')], edges: [{ from: 'r', to: 'a' }] })
    expect(mindmapTree(two)!.roots).toBe(2)
    expect(checkDiagramForm(two, 'b').some((i) => /2 nodos sin flecha/.test(i.message))).toBe(true)
  })
  it('atajo de la IA: árbol anidado (`root` + `children`) con ids únicos', () => {
    const d = diagram({ type: 'mindmap', root: { label: 'La célula', children: [{ label: 'Núcleo', children: ['ADN', 'Nucléolo'] }, { label: 'Orgánulos', children: ['Núcleo'] }] } })
    expect(d.form).toBe('mindmap')
    expect(d.nodes.map((n) => n.label)).toEqual(['La célula', 'Núcleo', 'ADN', 'Nucléolo', 'Orgánulos', 'Núcleo'])
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(6)
    const t = mindmapTree(d)!
    expect(t.root.children.map((c) => c.node.label)).toEqual(['Núcleo', 'Orgánulos'])
    expect(t.depth).toBe(2)
  })
  it('más de 24 nodos avisa; hasta 24 no da el aviso de «más de 14»', () => {
    const many = (n: number): BlockOf<'diagram'> => diagram({ form: 'mindmap', nodes: Array.from({ length: n }, (_, i) => node(`n${i}`)), edges: Array.from({ length: n - 1 }, (_, i) => ({ from: 'n0', to: `n${i + 1}` })) })
    const v = new ContentValidator()
    expect(v.checkBlock(many(20), 'l').some((i) => /14 nodos/.test(i.message))).toBe(false)
    expect(checkDiagramForm(many(26), 'b').some((i) => /26 nodos/.test(i.message))).toBe(true)
  })
})

describe('pirámide y embudo', () => {
  it('niveles de arriba abajo; la lista de la IA pasa a nodos', () => {
    const d = diagram({ kind: 'pirámide', levels: ['Constitución', 'Leyes', { label: 'Reglamentos', detail: 'Del Gobierno' }] })
    expect(d).toMatchObject({ kind: 'layers', form: 'pyramid' })
    expect(pyramidLevels(d).map((n) => n.label)).toEqual(['Constitución', 'Leyes', 'Reglamentos'])
    expect(d.nodes[2].detail).toBe('Del Gobierno')
  })
  it('las flechas no se dibujan (aviso informativo) y más de 9 niveles avisa', () => {
    const d = diagram({ form: 'funnel', nodes: [node('a'), node('b')], edges: [{ from: 'a', to: 'b' }] })
    expect(checkDiagramForm(d, 'b').map((i) => i.severity)).toEqual(['info'])
    const tall = diagram({ form: 'pyramid', nodes: Array.from({ length: 10 }, (_, i) => node(`l${i}`)) })
    expect(checkDiagramForm(tall, 'b').some((i) => i.severity === 'warning')).toBe(true)
  })
})

describe('construir paso a paso (`build`)', () => {
  const steps = [{ md: '1', nodes: ['a'] }, { md: '2', nodes: ['b'] }, { md: '3', edges: [['b', 'c']] }]
  const d = diagram({ build: true, nodes: [node('a'), node('b'), node('c'), node('d')], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], steps })
  it('lo que se ve es acumulado; sin paso o sin build, todo', () => {
    expect([...revealedAt(d, 0)!]).toEqual(['a'])
    expect([...revealedAt(d, 2)!].sort()).toEqual(['a', 'b', 'c'])
    expect(revealedAt(d, null)).toBeUndefined()
    expect(revealedAt({ ...d, build: false }, 1)).toBeUndefined()
  })
  it('en un Venn, un elemento trae su conjunto; en un mapa mental, sus antepasados', () => {
    const v = diagram({ form: 'venn', build: true, nodes: [node('A', 'A', 'circle'), node('B', 'B', 'circle'), node('x')], edges: [{ from: 'x', to: 'B' }], steps: [{ md: '1', nodes: ['x'] }] })
    expect([...revealedAt(v, 0)!].sort()).toEqual(['B', 'x'])
    const m = diagram({ form: 'mindmap', build: true, nodes: [node('r'), node('a'), node('b')], edges: [{ from: 'r', to: 'a' }, { from: 'a', to: 'b' }], steps: [{ md: '1', nodes: ['b'] }] })
    expect([...revealedAt(m, 0)!].sort()).toEqual(['a', 'b', 'r'])
  })
  it('validación: build sin pasos avisa; un nodo que nunca aparece es informativo', () => {
    expect(checkDiagramForm({ ...d, steps: [] }, 'b').some((i) => i.severity === 'warning')).toBe(true)
    const info = checkDiagramForm(d, 'b')
    expect(info.map((i) => i.severity)).toEqual(['info'])
    expect(info[0].message).toMatch(/\bd\b/)
    const empty = diagram({ build: true, nodes: [node('a'), node('b')], steps: [{ md: 'intro' }, { md: '2', nodes: ['a', 'b'] }] })
    expect(checkDiagramForm(empty, 'b').some((i) => i.path === 'b.steps[0]' && i.severity === 'warning')).toBe(true)
  })
  it('un paso que rodea más de 4 nodos es informativo', () => {
    const big = diagram({ nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id)), steps: [{ md: 'todo', nodes: ['a', 'b', 'c', 'd', 'e'] }, { md: 'uno', nodes: ['a'] }] })
    const v = new ContentValidator()
    expect(v.checkBlock(big, 'l').some((i) => i.severity === 'info' && /rodea 5 nodos/.test(i.message))).toBe(true)
  })
})

describe('comparar', () => {
  const cmp = (raw: Record<string, unknown>): BlockOf<'compare'> => {
    const b = decodeBlock(normalizeBlock({ type: 'compare', leftTitle: 'A', rightTitle: 'B', ...raw } as JSONValue))
    if (b?.type !== 'compare') throw new Error('no es una comparación')
    return b
  }
  it('atajos: `key: true`, `emphasis` y el tipo «analogy»', () => {
    const c = cmp({ rows: [{ left: '1', right: '2', key: true }, { left: '3', right: '3', emphasis: 'muted' }, { left: '4', right: '5' }] })
    expect(c.rows.map((r) => r.tone)).toEqual(['key', 'same', undefined])
    const a = decodeBlock(normalizeBlock({ type: 'metaphor', leftTitle: 'Célula', rightTitle: 'Fábrica', rows: [] }))
    expect(a?.type === 'compare' && a.mode).toBe('analogy')
  })
  it('más de la mitad de filas clave avisa; la analogía necesita 2 parejas', () => {
    const c = cmp({ rows: [{ left: '1', right: '2', tone: 'key' }, { left: '1', right: '2', tone: 'key' }, { left: '1', right: '2' }] })
    expect(checkCompare(c, 'b').some((i) => i.severity === 'warning')).toBe(true)
    expect(checkCompare(cmp({ mode: 'analogy', rows: [{ left: 'x', right: 'y' }] }), 'b').length).toBe(1)
  })
})
