// Formas ya hechas: el paso de vista general no apaga nada, los textos largos no se pisan, el Venn de tres conjuntos no se
// dispara con etiquetas normales y no se pierde ningún nodo por topes de cada forma.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { boxInCircle, boxOutCircle, fitText, layoutMindmap, layoutPyramid, layoutVenn, type Box } from './diagramForms'
import { estimateMeasure, stepHighlight, wrapLines } from './diagramLayout'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const LONG = 'Esta explicación es deliberadamente larga: describe con detalle el rango de la norma, quién la dicta, cómo se aprueba, qué mayoría exige, qué la puede derogar y qué pasa si contradice a una norma de rango superior, con ejemplos de cada caso y de las excepciones que reconoce la jurisprudencia.'
/** Lo que mide una caja de más de 8 líneas de 16 px (antes se cortaba ahí y el texto se salía). */
const PAST_CAP = 8 * 16

describe('pasos: la vista general', () => {
  const d = diagram({ nodes: ['a', 'b', 'c'].map((id) => ({ id, label: id })), edges: [{ from: 'a', to: 'b' }], steps: [{ md: 'Visión general' }, { md: 'A', nodes: ['a'] }, { md: 'Flecha', edges: [['a', 'b']] }, { md: 'Repaso' }] })
  it('un paso sin nodos ni flechas no apaga nada (como sin paso)', () => {
    expect(stepHighlight(d, 0)).toBeUndefined()
    expect(stepHighlight(d, 3)).toBeUndefined()
  })
  it('un paso con nodos o solo con flechas sigue encendiendo lo suyo', () => {
    expect([...stepHighlight(d, 1)!.nodes]).toEqual(['a'])
    expect([...stepHighlight(d, 2)!.nodes].sort()).toEqual(['a', 'b'])
  })
})

describe('textos largos: la caja mide lo que ocupa el texto', () => {
  it('fitText no corta en 8 líneas (los nodos del grafo sí, con su line-clamp)', () => {
    const real = wrapLines(LONG, 190, 12, false, estimateMeasure, Infinity)
    expect(real).toBeGreaterThan(8)
    expect(wrapLines(LONG, 190, 12, false, estimateMeasure)).toBe(8)
    const f = fitText(LONG, 190, 12, 16, false, estimateMeasure)
    expect(f.lines).toBe(real)
    expect(f.h).toBe(real * 16)
  })
  it('pirámide: las explicaciones largas, al lado o dentro, no se pisan', () => {
    const nodes = [0, 1, 2].map((i) => ({ id: `l${i}`, label: `Nivel ${i + 1}`, detail: LONG }))
    for (const beside of [true, false]) {
      const l = layoutPyramid(diagram({ form: 'pyramid', nodes }), estimateMeasure, false, beside)
      const boxes = beside ? l.rows.map((r) => r.detail!) : l.rows.map((r) => r.label)
      for (const b of boxes) expect(b.h).toBeGreaterThan(PAST_CAP)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false)
      // cada fila contiene su etiqueta y su explicación
      if (!beside) for (const r of l.rows) expect(r.label.y + r.label.h).toBeLessThanOrEqual(r.y + r.h + 0.5)
    }
  })
  it('mapa mental: una rama con explicación larga no pisa la siguiente', () => {
    const m = diagram({ form: 'mindmap', nodes: [{ id: 'r', label: 'Tema' }, { id: 'a', label: 'A', detail: LONG }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', detail: LONG }], edges: [{ from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'r', to: 'c' }] })
    const l = layoutMindmap(m, estimateMeasure)!
    const boxes = l.branches.flatMap((x) => [x.label, ...(x.detail ? [x.detail] : [])])
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false)
    const a = l.branches.find((x) => x.id === 'a')!
    expect(a.detail!.h).toBeGreaterThan(PAST_CAP)
  })
})

describe('Venn de tres conjuntos con etiquetas normales', () => {
  const regions = [['A'], ['B'], ['C'], ['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B', 'C']]
  const venn3 = (labels: string[]): BlockOf<'diagram'> => {
    const nodes: Record<string, unknown>[] = [{ id: 'A', label: 'Mitosis', shape: 'circle' }, { id: 'B', label: 'Meiosis', shape: 'circle' }, { id: 'C', label: 'Fisión binaria', shape: 'circle' }]
    const edges: Record<string, unknown>[] = []
    regions.forEach((sets, i) => {
      nodes.push({ id: `x${i}`, label: labels[i] })
      for (const s of sets) edges.push({ from: `x${i}`, to: s })
    })
    return diagram({ form: 'venn', nodes, edges })
  }
  const check = (l: NonNullable<ReturnType<typeof layoutVenn>>): void => {
    for (const it of l.items) {
      for (const c of l.circles) {
        if (it.sets.includes(c.id)) expect(boxInCircle(it.box, c.cx, c.cy, c.r), `${it.node.label} en ${c.node.label}`).toBe(true)
        else expect(boxOutCircle(it.box, c.cx, c.cy, c.r), `${it.node.label} fuera de ${c.node.label}`).toBe(true)
      }
    }
    for (let i = 0; i < l.items.length; i++) for (let j = i + 1; j < l.items.length; j++) expect(overlaps(l.items[i].box, l.items[j].box)).toBe(false)
  }
  it('etiquetas de 1–3 palabras: los círculos apenas crecen y ninguna palabra se parte', () => {
    const labels = ['Dos células hijas', 'Cuatro gametos', 'Procariotas', 'Huso mitótico', 'Reproducción asexual', 'Sobrecruzamiento', 'Replicación del ADN']
    const l = layoutVenn(venn3(labels), estimateMeasure)!
    check(l)
    // antes llegaba a r ≈ 300 (la figura se veía al 62 %)
    expect(l.circles[0].r).toBeLessThanOrEqual(220)
    for (const it of l.items) {
      const longest = Math.max(...it.node.label.split(' ').map((w) => estimateMeasure(w, 13, false)))
      expect(longest, it.node.label).toBeLessThanOrEqual(it.box.w - 8)
    }
  })
  it('etiquetas cortas: el tamaño de siempre', () => {
    const l = layoutVenn(venn3(['Huso', 'Quiasmas', 'Sin huso', 'ADN se duplica', 'Asexual', 'Haploides', 'División celular']), estimateMeasure)!
    check(l)
    expect(l.circles[0].r).toBeLessThanOrEqual(150)
  })
  it('etiquetas de cinco palabras: cada una en su región, sin pisarse', () => {
    const l = layoutVenn(venn3(Array.from({ length: 7 }, () => 'División del citoplasma en dos')), estimateMeasure)!
    check(l)
    expect(l.circles[0].r).toBeLessThanOrEqual(220)
  })
})

describe('sin topes por forma: todo lo que llega se dibuja', () => {
  it('una pirámide o un embudo de 14 niveles dibuja los 14', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => ({ id: `l${i}`, label: `Nivel ${i + 1}` }))
    for (const inverted of [false, true]) expect(layoutPyramid(diagram({ form: inverted ? 'funnel' : 'pyramid', nodes }), estimateMeasure, inverted, true).rows).toHaveLength(14)
  })
  it('un Venn con 14 elementos en una región y 26 fuera los dibuja todos', () => {
    const inside = Array.from({ length: 14 }, (_, i) => ({ id: `i${i}`, label: `E${i}` }))
    const out = Array.from({ length: 26 }, (_, i) => ({ id: `o${i}`, label: `F${i}` }))
    const d = diagram({ form: 'venn', nodes: [{ id: 'a', label: 'A', shape: 'circle' }, { id: 'b', label: 'B', shape: 'circle' }, ...inside, ...out], edges: inside.map((n) => ({ from: n.id, to: 'a' })) })
    const l = layoutVenn(d, estimateMeasure)!
    expect(l.items).toHaveLength(14)
    expect(l.outside?.items).toHaveLength(26)
  })
})
