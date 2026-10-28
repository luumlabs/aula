import { describe, expect, it } from 'vitest'
import { decodeBlock, type BlockOf } from '@shared/schema/blocks'
import { decodeMap } from '@shared/schema/visual'
import { basisPath, clipToNode, effectiveEdges, layoutDiagram, rankOrder, stepHighlight, type NodeBox } from './diagramLayout'
import { arcPath, arrowHead, canvasSize, drawItemShape, polarPoint } from './drawing'
import { fitProjection, isWorldView, mapBounds, needsDetail, regionFeature, regionIndexAt, routeMidpoint, sanitizeMap } from './mapGeo'
import { FIT_FACTORS, deckTransition, initialFit, keyAction, slideTheme, updateFit } from './slides'
import { geoArea } from 'd3-geo'

const diagram = (raw: Record<string, unknown>): BlockOf<'diagram'> => decodeBlock({ type: 'diagram', ...raw }) as BlockOf<'diagram'>
const overlap = (a: NodeBox, b: NodeBox): boolean => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h

describe('disposición de diagramas', () => {
  const flow = diagram({
    kind: 'flow', nodes: [{ id: 'a', label: 'Inicio' }, { id: 'b', label: '¿Es par?', shape: 'diamond' }, { id: 'c', label: 'Sí' }, { id: 'd', label: 'No' }, { id: 'e', label: 'Fin' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'sí' }, { from: 'b', to: 'd', label: 'no' }, { from: 'c', to: 'e' }, { from: 'd', to: 'e' }, { from: 'e', to: 'a', dashed: true }]
  })
  it('flujo de arriba abajo: capas en orden y sin nodos solapados', () => {
    const l = layoutDiagram(flow)
    const y = Object.fromEntries(l.nodes.map((n) => [n.id, n.y]))
    expect(y.a).toBeLessThan(y.b)
    expect(y.b).toBeLessThan(y.c)
    expect(y.c).toBeLessThan(y.e)
    for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) expect(overlap(l.nodes[i], l.nodes[j])).toBe(false)
    expect(l.edges).toHaveLength(6)
    expect(l.edges.every((e) => e.d.startsWith('M'))).toBe(true)
    expect(l.edges.find((e) => e.key === 'b>c')?.labelAt).toBeDefined()
    expect(l.width).toBeGreaterThan(0)
  })
  it('de izquierda a derecha con direction "lr"', () => {
    const l = layoutDiagram({ ...flow, direction: 'lr' })
    const x = Object.fromEntries(l.nodes.map((n) => [n.id, n.x]))
    expect(x.a).toBeLessThan(x.b)
    expect(x.b).toBeLessThan(x.e)
  })
  it('ciclo: nodos sobre una elipse y flechas entre consecutivos si no hay escritas', () => {
    const c = diagram({ kind: 'cycle', nodes: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, label: id })) })
    expect(effectiveEdges(c).map((e) => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C', 'C>D', 'D>E', 'E>A'])
    const l = layoutDiagram(c)
    expect(l.cycle).toBeDefined()
    const { cx, cy, rx, ry } = l.cycle!
    for (const n of l.nodes) expect(((n.x - cx) / rx) ** 2 + ((n.y - cy) / ry) ** 2).toBeCloseTo(1, 6)
    expect(l.nodes[0].y).toBeLessThan(cy)
    expect(l.edges).toHaveLength(5)
  })
  it('capas apiladas', () => {
    const l = layoutDiagram(diagram({ kind: 'layers', nodes: [{ id: 'a', label: 'Corteza' }, { id: 'b', label: 'Manto' }, { id: 'c', label: 'Núcleo' }] }))
    expect(l.nodes[0].y).toBeLessThan(l.nodes[1].y)
    expect(new Set(l.nodes.map((n) => n.w)).size).toBe(1)
  })
  it('como mucho 60 nodos, sin ids repetidos', () => {
    const big = diagram({ nodes: Array.from({ length: 90 }, (_, i) => ({ id: `n${i % 70}`, label: `N${i}` })) })
    expect(layoutDiagram(big).nodes).toHaveLength(60)
  })
  it('pasos: los nodos del paso y las flechas que llegan desde el anterior', () => {
    const c = diagram({ kind: 'cycle', nodes: ['A', 'B', 'C'].map((id) => ({ id, label: id })), steps: [{ md: '1', nodes: ['A'] }, { md: '2', nodes: ['B'] }, { md: '3', nodes: ['B', 'C'] }] })
    expect(stepHighlight(c, null)).toBeUndefined()
    expect([...stepHighlight(c, 1)!.edges]).toEqual(['A>B'])
    expect([...stepHighlight(c, 2)!.edges]).toEqual(['B>C'])
    expect(stepHighlight(c, 9)).toBeUndefined()
  })
  it('orden de aparición por niveles desde las fuentes', () => {
    const o = rankOrder(flow, flow.edges)
    expect(o.get('a')).toBe(0)
    expect(o.get('e')).toBeGreaterThan(o.get('c')!)
  })
  it('recorta los extremos en el borde real de rombos y elipses', () => {
    const box = (shape: 'box' | 'diamond' | 'circle'): NodeBox => ({ id: 'x', node: { id: 'x', label: 'x', shape }, x: 0, y: 0, w: 100, h: 60, order: 0 })
    expect(clipToNode(box('box'), [100, 0])).toEqual([50, 0])
    const d = clipToNode(box('diamond'), [100, 100])
    expect(Math.abs(d[0]) / 50 + Math.abs(d[1]) / 30).toBeCloseTo(1, 9)
    const e = clipToNode(box('circle'), [100, 100])
    expect((e[0] / 50) ** 2 + (e[1] / 30) ** 2).toBeCloseTo(1, 9)
  })
  it('curva suave que empieza y acaba en sus extremos', () => {
    const d = basisPath([[0, 0], [10, 20], [30, 20], [40, 0]])
    expect(d.startsWith('M0 0')).toBe(true)
    expect(d.endsWith('L40 0')).toBe(true)
  })
})

describe('dibujo vectorial', () => {
  it('lienzo con medidas razonables', () => {
    expect(canvasSize(1e308, -3)).toEqual({ W: 4000, H: 300 })
    expect(canvasSize(Number.NaN, 0)).toEqual({ W: 400, H: 300 })
    expect(canvasSize(800, 600)).toEqual({ W: 800, H: 600 })
  })
  it('ángulos antihorarios como en matemáticas (y de la pantalla hacia abajo)', () => {
    const [x, y] = polarPoint(0, 0, 10, 90)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(-10)
    expect(arcPath(0, 0, 10, 0, 90)).toMatch(/A10 10 0 0 0 0 -10$/)
    expect(arcPath(0, 0, 10, 0, 270)).toContain('A10 10 0 1 0')
  })
  it('flecha con punta, rectángulo con radio acotado, polígono relleno', () => {
    const arrow = drawItemShape({ kind: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, label: 'F' })
    expect(arrow.heads).toHaveLength(1)
    expect(arrow.labels[0]).toMatchObject({ x: 50, y: -12, text: 'F' })
    const rect = drawItemShape({ kind: 'rect', x: 0, y: 0, w: 20, h: 10, r: 99, fill: 'blue' })
    expect(rect.paths[0].d).toContain('A5 5')
    expect(rect.paths[0].fill).toEqual({ color: 'blue', opacity: 0.22 })
    expect(drawItemShape({ kind: 'polygon', points: [[0, 0], [1]] }).paths).toHaveLength(0)
    expect(arrowHead(0, 0, 10, 0, 5)).toMatch(/^M10 0L/)
  })
  it('texto con su ancla y números absurdos acotados', () => {
    expect(drawItemShape({ kind: 'text', x: 5, y: 6, text: '$x$', anchor: 'left' }).labels[0]).toMatchObject({ anchor: 'left', size: 14 })
    expect(drawItemShape({ kind: 'line', x1: Number.NaN, y1: 1e12, x2: 1, y2: 1 }).paths[0].d).toBe('M0 100000L1 1')
  })
})

describe('mapa', () => {
  const med = decodeMap({
    markers: [{ title: 'Roma', lat: 41.9, lon: 12.5 }, { title: 'Atenas', lat: 37.98, lon: 23.73 }, { title: 'Alejandría', lat: 31.2, lon: 29.92 }, { title: 'Mal', lat: 999, lon: 0 }],
    regions: [{ name: 'Sicilia', points: [[38.3, 12.4], [38.2, 15.6], [36.7, 15.1], [37.5, 12.6]] }],
    routes: [{ points: [[41.9, 12.5], [40.6, 17.9]] }]
  })!
  it('quita coordenadas imposibles', () => {
    expect(sanitizeMap(med).markers).toHaveLength(3)
  })
  it('encuadra el contenido con margen; sin nada, el mundo', () => {
    const b = mapBounds(sanitizeMap(med))
    expect(b.latMin).toBeLessThan(31.2)
    expect(b.latMax).toBeGreaterThan(41.9)
    expect(b.lonMin).toBeLessThan(12.5)
    expect(b.lonMax).toBeGreaterThan(29.92)
    expect(isWorldView(b)).toBe(false)
    expect(needsDetail(b)).toBe(true)
    expect(isWorldView(mapBounds(decodeMap({})!))).toBe(true)
    const c = mapBounds(decodeMap({ lat: 40, lon: -3, span: 10 })!)
    expect(c.latMax - c.latMin).toBeCloseTo(10)
  })
  it('la proyección ajustada deja todos los marcadores dentro de la ventana', () => {
    for (const [w, h] of [[880, 460], [360, 300]]) {
      const m = sanitizeMap(med)
      const p = fitProjection(mapBounds(m), w, h)
      for (const k of m.markers) {
        const [x, y] = p([k.lon, k.lat])!
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(w)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(h)
      }
    }
    const world = fitProjection(mapBounds(decodeMap({})!), 800, 400)
    const [x0] = world([-179, 0])!, [x1] = world([179, 0])!
    expect(x0).toBeGreaterThan(0)
    expect(x1).toBeLessThan(800)
  })
  it('regiones con el sentido correcto (su área, no la del resto del mundo)', () => {
    const r = regionFeature(med.regions[0])
    expect(geoArea(r)).toBeLessThan(0.01)
    const reversed = regionFeature({ ...med.regions[0], points: [...med.regions[0].points].reverse() })
    expect(geoArea(reversed)).toBeCloseTo(geoArea(r), 9)
  })
  it('región que contiene un punto y punto medio de una ruta', () => {
    expect(regionIndexAt(37.5, 14, med.regions)).toBe(0)
    expect(regionIndexAt(45, 14, med.regions)).toBeUndefined()
    const mid = routeMidpoint([[0, 0], [0, 10]])!
    expect(mid[1]).toBeCloseTo(5)
  })
})

describe('presentaciones', () => {
  it('temas de la app original', () => {
    expect(slideTheme('pizarra').name).toBe('chalk')
    expect(slideTheme('chalk').dark).toBe(true)
    expect(slideTheme('academico').titleFont).toBe('serif')
    expect(slideTheme(undefined).name).toBe('aula')
    expect(slideTheme('minimal').detail).toBe('topBar')
  })
  it('teclas y transiciones', () => {
    expect(keyAction('ArrowRight')).toBe('next')
    expect(keyAction('PageUp')).toBe('previous')
    expect(keyAction(' ')).toBe('next')
    expect(keyAction('n')).toBe('notes')
    expect(keyAction('Escape')).toBe('close')
    expect(keyAction('x')).toBeUndefined()
    expect(deckTransition('push')).toBe('slide')
    expect(deckTransition(undefined)).toBe('fade')
  })
  it('la letra baja hasta que el contenido cabe y no oscila', () => {
    let f = updateFit(initialFit(), 800, 400)
    expect(FIT_FACTORS[f.step]).toBeLessThanOrEqual(0.5 + 0.05)
    // ya cabe: no vuelve a subir al tamaño que desbordó
    f = updateFit(f, 800 * FIT_FACTORS[f.step], 400)
    expect(f.step).toBe(FIT_FACTORS.length - 1)
    let g = updateFit(initialFit(), 300, 400)
    expect(g.step).toBe(0)
    g = updateFit(g, 460, 400)
    expect(g.step).toBe(1)
  })
})
