// Formas ya hechas: todo cabe en su caja, las etiquetas caben en su forma y nada se pisa. Algunas comprobaciones vienen de
// las pruebas de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: test/templates.test.ts y test/callouts.test.ts.
import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { boxInCircle, boxOutCircle, layoutForm, layoutMindmap, layoutPyramid, layoutVenn, stack, type Box } from './diagramForms'
import { estimateMeasure } from './diagramLayout'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const inside = (b: Box, w: number, h: number): boolean => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= w + 0.5 && b.y + b.h <= h + 0.5
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const LONG = 'Reglamentos y disposiciones administrativas de carácter general'

describe('pila sin solapes (stack de Sketchy)', () => {
  it('respeta el hueco y se queda cerca de los centros', () => {
    const tops = stack([{ center: 10, size: 20 }, { center: 12, size: 20 }, { center: 100, size: 10 }], 4)
    expect(tops[1]).toBeGreaterThanOrEqual(tops[0] + 24)
    expect(tops[2]).toBeGreaterThanOrEqual(tops[1] + 24)
    // se recentra solo hacia arriba
    expect(tops[2]).toBeLessThanOrEqual(95)
    expect(tops[2]).toBeGreaterThan(80)
  })
})

describe('pirámide y embudo', () => {
  for (const inverted of [false, true]) {
    for (let n = 1; n <= 9; n++) {
      it(`${inverted ? 'embudo' : 'pirámide'} de ${n}: todo dentro, cada etiqueta en su trapecio y anchos en orden`, () => {
        const nodes = Array.from({ length: n }, (_, i) => ({ id: `l${i}`, label: i % 3 === 0 ? LONG : `Nivel ${i + 1}`, detail: i % 2 ? 'Una explicación algo larga que ocupa varias líneas en la columna' : undefined }))
        for (const beside of [true, false]) {
          const l = layoutPyramid(diagram({ form: inverted ? 'funnel' : 'pyramid', nodes }), estimateMeasure, inverted, beside)
          expect(l.rows).toHaveLength(n)
          for (const r of l.rows) {
            expect(inside(r.label, l.width, l.height)).toBe(true)
            for (const [x, y] of r.points) {
              expect(x).toBeGreaterThanOrEqual(-0.5)
              expect(x).toBeLessThanOrEqual(l.width + 0.5)
              expect(y).toBeLessThanOrEqual(l.height + 0.5)
            }
            if (r.detail) expect(inside(r.detail, l.width, l.height)).toBe(true)
            // la etiqueta cabe en el trapecio a la altura de su borde estrecho (arriba en la pirámide, abajo en el embudo)
            const [tl, tr, br, bl] = r.points
            const halfAt = (y: number): number => ((tr[0] - tl[0]) / 2) + (((br[0] - bl[0]) - (tr[0] - tl[0])) / 2) * ((y - tl[1]) / (bl[1] - tl[1]))
            const edgeY = inverted ? r.label.y + r.label.h : r.label.y
            expect(r.label.w / 2).toBeLessThanOrEqual(halfAt(edgeY) + 0.5)
          }
          const widths = l.rows.map((r) => r.points[2][0] - r.points[3][0])
          for (let i = 1; i < widths.length; i++) expect(inverted ? widths[i] < widths[i - 1] : widths[i] > widths[i - 1]).toBe(true)
          const details = l.rows.flatMap((r) => (r.detail ? [r.detail] : []))
          for (let i = 0; i < details.length; i++) for (let j = i + 1; j < details.length; j++) expect(overlaps(details[i], details[j])).toBe(false)
        }
      })
    }
  }
})

describe('Venn', () => {
  const sets3 = [{ id: 'a', label: 'Plantas', shape: 'circle' }, { id: 'b', label: 'Animales', shape: 'circle' }, { id: 'c', label: 'Hongos', shape: 'circle' }]
  const items = [
    ['x1', 'Pared de celulosa', ['a']], ['x2', 'Centriolos', ['b']], ['x3', 'Quitina', ['c']], ['x4', 'Heterótrofos', ['b', 'c']], ['x5', 'Vacuola grande', ['a', 'c']],
    ['x6', 'Glucógeno', ['b', 'c']], ['x7', 'Núcleo', ['a', 'b', 'c']], ['x8', 'Mitocondrias', ['a', 'b', 'c']], ['x9', 'Cloroplastos', ['a']], ['x10', 'Virus', []]
  ] as const
  const block = (k: 2 | 3, extra: Array<readonly [string, string, readonly string[]]> = []): BlockOf<'diagram'> => {
    const sets = sets3.slice(0, k)
    const ids = new Set(sets.map((s) => s.id))
    const its = [...items, ...extra].map(([id, label, s]) => ({ id, label, sets: s.filter((x) => ids.has(x)) }))
    return diagram({ form: 'venn', nodes: [...sets, ...its.map(({ id, label }) => ({ id, label }))], edges: its.flatMap((i) => i.sets.map((s) => ({ from: i.id, to: s }))) })
  }
  for (const k of [2, 3] as const) {
    it(`${k} conjuntos: cada elemento dentro de sus círculos y fuera de los demás; todo dentro de la caja`, () => {
      const l = layoutVenn(block(k), estimateMeasure)!
      expect(l.circles).toHaveLength(k)
      for (const it of l.items) {
        for (const c of l.circles) {
          if (it.sets.includes(c.id)) expect(boxInCircle(it.box, c.cx, c.cy, c.r), `${it.node.label} en ${c.node.label}`).toBe(true)
          else expect(boxOutCircle(it.box, c.cx, c.cy, c.r), `${it.node.label} fuera de ${c.node.label}`).toBe(true)
        }
        expect(inside(it.box, l.width, l.height)).toBe(true)
      }
      for (const c of l.circles) {
        expect(c.cx - c.r).toBeGreaterThanOrEqual(0)
        expect(c.cy + c.r).toBeLessThanOrEqual(l.height)
        expect(inside(c.title, l.width, l.height)).toBe(true)
        for (const it of l.items) expect(overlaps(c.title, it.box)).toBe(false)
      }
      // se ven todas las etiquetas (las de fuera, debajo)
      expect(l.items.length + (l.outside?.items.length ?? 0)).toBe(items.length)
      expect(l.outside?.items.map((i) => i.node.label)).toEqual(k === 3 ? ['Virus'] : ['Quitina', 'Virus'])
      for (let i = 0; i < l.items.length; i++) for (let j = i + 1; j < l.items.length; j++) expect(overlaps(l.items[i].box, l.items[j].box)).toBe(false)
    })
  }
  it('una región llena agranda los círculos en vez de desbordarse', () => {
    const crowd = Array.from({ length: 8 }, (_, i) => [`c${i}`, `Elemento común ${i + 1}`, ['a', 'b']] as const)
    const small = layoutVenn(block(2), estimateMeasure)!
    const big = layoutVenn(block(2, crowd), estimateMeasure)!
    expect(big.circles[0].r).toBeGreaterThan(small.circles[0].r)
    for (const it of big.items) for (const c of big.circles) if (it.sets.includes(c.id)) expect(boxInCircle(it.box, c.cx, c.cy, c.r)).toBe(true)
  })
  it('sin dos conjuntos no hay Venn (se dibuja como mapa conceptual)', () => {
    expect(layoutForm(diagram({ form: 'venn', nodes: [{ id: 'a', label: 'A', shape: 'circle' }, { id: 'x', label: 'x' }] }), estimateMeasure)).toBeUndefined()
  })
})

describe('mapa mental', () => {
  const cell = diagram({
    form: 'mindmap',
    nodes: [
      { id: 'r', label: 'La célula' }, { id: 'm', label: 'Membrana plasmática', detail: 'Bicapa lipídica con proteínas' }, { id: 'n', label: 'Núcleo' }, { id: 'adn', label: 'ADN' },
      { id: 'nu', label: 'Nucléolo' }, { id: 'o', label: 'Orgánulos' }, { id: 'mi', label: 'Mitocondria', detail: 'Respiración' }, { id: 'ri', label: 'Ribosomas' },
      { id: 're', label: 'Retículo endoplasmático rugoso y liso con sus funciones' }, { id: 't', label: 'Tipos' }, { id: 'p', label: 'Procariota' }, { id: 'e', label: 'Eucariota' }
    ],
    edges: [['r', 'm'], ['r', 'n'], ['n', 'adn'], ['n', 'nu'], ['r', 'o'], ['o', 'mi'], ['o', 'ri'], ['o', 're'], ['r', 't'], ['t', 'p'], ['t', 'e']].map(([from, to]) => ({ from, to }))
  })
  it('dos lados equilibrados, nada se pisa, todo dentro y cada hija más allá del trazo de su madre', () => {
    const l = layoutMindmap(cell, estimateMeasure)!
    expect(l.branches).toHaveLength(11)
    const right = l.branches.filter((x) => x.side > 0), left = l.branches.filter((x) => x.side < 0)
    expect(right.length).toBeGreaterThan(0)
    expect(left.length).toBeGreaterThan(0)
    const extent = (bs: typeof right): number => Math.max(...bs.map((x) => x.label.y + x.label.h)) - Math.min(...bs.map((x) => x.label.y))
    expect(Math.abs(extent(right) - extent(left))).toBeLessThan(200)
    const boxes = [l.root.label, ...l.branches.flatMap((x) => [x.label, ...(x.detail ? [x.detail] : [])])]
    for (const b of boxes) expect(inside(b, l.width, l.height)).toBe(true)
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i} y ${j}`).toBe(false)
    const byId = new Map(l.branches.map((x) => [x.id, x]))
    for (const x of l.branches) {
      expect(x.label.w).toBeLessThanOrEqual(182)
      const parent = byId.get(x.parent)
      if (parent) expect(x.side * (x.underline[0][0] - parent.underline[1][0])).toBeGreaterThan(0)
      else expect(Math.abs(x.underline[0][0] - l.root.cx)).toBeGreaterThan(l.root.rx)
    }
  })
  it('un solo nodo: solo la idea central', () => {
    const l = layoutMindmap(diagram({ form: 'mindmap', nodes: [{ id: 'r', label: 'Tema' }] }), estimateMeasure)!
    expect(l.branches).toHaveLength(0)
    expect(l.width).toBeGreaterThan(0)
  })
})

describe('construir paso a paso', () => {
  it('la figura mide lo mismo con y sin `build` (nada salta al ir apareciendo)', () => {
    const base = { form: 'pyramid', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], steps: [{ md: '1', nodes: ['a'] }, { md: '2', nodes: ['b'] }] }
    const a = layoutForm(diagram(base), estimateMeasure)!
    const b = layoutForm(diagram({ ...base, build: true }), estimateMeasure)!
    expect([b.width, b.height]).toEqual([a.width, a.height])
  })
})
