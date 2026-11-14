// Lectura y escritura de las partes nuevas del dibujo: lo nuevo sobrevive a un ciclo de guardado y un dibujo de siempre sale
// idéntico (sin claves de más).
import { describe, expect, it } from 'vitest'
import { parseJSON, stringifyJSON, type JSONObject } from '@engine/base/json'
import { drawItemShape } from '@engine/drawing'
import { decodeBlock, encodeBlock, type BlockOf } from './blocks'
import { decodeDrawing, encodeDrawing, decodeDrawItem, encodeDrawItem, type DrawItem } from './common'
import { ANGLE_RADIUS } from './drawing'

const rt = (json: string): unknown => encodeBlock(decodeBlock(parseJSON(json))!)

describe('dibujo: campos nuevos', () => {
  it('un dibujo de siempre se guarda igual (sin claves nuevas)', () => {
    const json = '{"type":"drawing","id":"d1","width":300,"height":200,"items":[{"kind":"polygon","points":[[1,2],[3,4],[5,6]],"fill":"blue"},{"kind":"text","x":1,"y":2,"text":"$a$"},{"kind":"rightAngle","cx":70,"cy":240,"r":16},{"kind":"angle","cx":330,"cy":240,"r":42,"start":147,"end":180,"label":"$\\\\alpha$"},{"kind":"rect","x":1,"y":2,"w":3,"h":4,"r":1,"fill":"amber"}],"caption":"c"}'
    expect(rt(json)).toEqual(parseJSON(json))
  })

  it('marcas, objetos, curvas suaves, rayado, nombres y etapas sobreviven al ciclo', () => {
    const items = [
      { kind: 'measure', x1: 0, y1: 0, x2: 10, y2: 0, offset: 12, label: '4 cm' },
      { kind: 'brace', x1: 0, y1: 0, x2: 0, y2: 10, depth: 6 },
      { kind: 'axes', x: 10, y: 90, w: 80, h: 70, step: 10, xLabel: 't', yLabel: 'v', full: true },
      { kind: 'grid', x: 0, y: 0, w: 100, h: 100, step: 20 },
      { kind: 'object', id: 'car', name: 'coche', object: 'car', x: 40, y: 50, w: 60, rotate: 15, flip: true, fill: 'blue', stage: 2 },
      { kind: 'polygon', points: [[0, 0], [10, 0], [5, 8]], smooth: true, fill: 'gray', fillStyle: 'hatch' },
      { kind: 'angle', points: [[10, 0], [0, 0], [0, 10]], r: 24 },
      { kind: 'dot', cx: 1, cy: 1, motion: { along: 'orbit', at: 't/4', orient: true, dx: '2', dy: 3, turn: 'a', pivot: [1, 2, 9] } }
    ]
    const back = rt(stringifyJSON({ type: 'drawing', id: 'd', width: 100, height: 100, items }))
    const got = (back as { items: unknown[] }).items
    expect(got[0]).toEqual(items[0])
    expect(got[1]).toEqual(items[1])
    expect(got[2]).toEqual(items[2])
    // en disco, el objeto va como texto (lo que pinta una versión antigua) y el ángulo lleva también su arco
    expect(got[4]).toEqual({ ...items[4], kind: 'text' })
    expect(got[5]).toEqual(items[5])
    expect(got[6]).toEqual({ ...items[6], cx: 0, cy: 0, start: 0, end: -90 })
    // y al leerlo vuelve a ser lo mismo
    const again = (decodeBlock(back as never) as BlockOf<'drawing'>).items
    expect(again[4]).toEqual(items[4])
    expect(again[6]).toEqual(items[6])
    expect(encodeBlock(decodeBlock(back as never)!)).toEqual(back)
    // las expresiones se leen como texto aunque vengan como números; el pivote, dos números
    expect(got[7]).toEqual({ kind: 'dot', cx: 1, cy: 1, motion: { dx: '2', dy: '3', turn: 'a', pivot: [1, 2], along: 'orbit', at: 't/4', orient: true } })
  })

  it('deslizadores, reloj, pasos y estilo', () => {
    const json = stringifyJSON({
      type: 'drawing', id: 'd', width: 400, height: 300, items: [{ kind: 'circle', cx: 1, cy: 1, r: 2 }],
      params: [{ name: 'v', label: 'Velocidad', min: 0, max: 10, step: 1, value: 2, unit: 'm/s' }],
      time: { name: 't', min: '0', max: '4', speed: 1, loop: true, autoplay: true },
      steps: [{ title: 'Uno', md: 'El coche', show: 1, params: { v: 5 }, highlight: ['car'] }, 'Solo texto', { md: 'Con items', items: ['a', 3] }],
      style: 'hand'
    })
    const b = decodeBlock(parseJSON(json)) as BlockOf<'drawing'>
    expect(b.params).toHaveLength(1)
    expect(b.time?.autoplay).toBe(true)
    expect(b.steps?.map((s) => s.highlight)).toEqual([['car'], undefined, ['a', '3']])
    expect(b.style).toBe('hand')
    const again = decodeBlock(parseJSON(stringifyJSON(encodeBlock(b)))) as BlockOf<'drawing'>
    expect(again).toEqual(b)
  })

  it('tolerante: claves raras o de tipo equivocado se ignoran sin perder el dibujo', () => {
    const d = decodeDrawing({ width: 100, height: 100, items: [{ kind: 'object', object: 'CAR', stage: '2', motion: 'nada', fillStyle: 'zigzag', smooth: 'sí' }], params: 'x', steps: [1, { md: 'ok', params: { __proto__: 3, v: '2,5' } }], style: 'rough' })!
    expect(d.items[0]).toEqual({ kind: 'object', object: 'car', stage: 2 })
    expect(d.steps).toEqual([{ md: 'ok', params: { v: 2.5 } }])
    expect(d.style).toBeUndefined()
    expect(d.params).toBeUndefined()
    expect(encodeDrawing(d)).toEqual({ width: 100, height: 100, items: [{ kind: 'text', object: 'car', stage: 2 }], steps: [{ md: 'ok', params: { v: 2.5 } }] })
    expect(encodeDrawItem(decodeDrawItem({ kind: 'line', x1: 1 })!)).toEqual({ kind: 'line', x1: 1 })
  })
})

// Lo que lee Aula 0.2.4: su decodificador solo conoce estas claves (y un tipo desconocido pasa a «line»), y pinta con las
// ramas de siempre de drawItemShape (idénticas byte a byte a las suyas, ver engine/drawing/fixtures/legacy.ts).
const OLD_KINDS = ['line', 'arrow', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'arc', 'text', 'dot', 'angle', 'rightAngle', 'curve', 'tick']
const OLD_KEYS = ['x1', 'y1', 'x2', 'y2', 'x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'rx', 'ry', 'start', 'end', 'size', 'width', 'opacity', 'points', 'text', 'anchor', 'stroke', 'fill', 'label', 'dashed']
function oldRead(json: JSONObject): DrawItem {
  const kind = OLD_KINDS.includes(String(json.kind)) ? (json.kind as DrawItem['kind']) : 'line'
  const out: Record<string, unknown> = { kind }
  for (const k of OLD_KEYS) if (json[k] !== undefined) out[k] = json[k]
  // sus ángulos no miran los puntos
  if (kind === 'angle' || kind === 'rightAngle') delete out.points
  return out as unknown as DrawItem
}
const save = (it: DrawItem): JSONObject => parseJSON(stringifyJSON(encodeDrawItem(it))) as JSONObject
const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('dibujo: lo que ve una versión antigua (0.2.4) de un curso nuevo', () => {
  it('un ángulo de tres puntos se pinta en su sitio: el mismo arco que la marca nueva, no un cuarto de círculo en 0,0', () => {
    const it0: DrawItem = { kind: 'angle', points: [[104.7, 215], [180.9, 51.7], [295.3, 215]], label: '$\\alpha$' }
    const disk = save(it0)
    expect(disk).toMatchObject({ cx: 180.9, cy: 51.7, r: ANGLE_RADIUS })
    const old = drawItemShape(oldRead(disk))
    const now = drawItemShape(decodeDrawItem(disk)!)
    // antes (sin cx, cy, start ni end) la antigua lo pintaba en 0,0
    expect(drawItemShape(oldRead({ kind: 'angle', points: it0.points! })).paths[0].d.startsWith('M0 0L')).toBe(true)
    // la cuña del relleno: mismo vértice, mismo radio y mismos extremos del arco
    const a = nums(old.paths[0].d), b = nums(now.paths[0].d)
    expect(a).toHaveLength(b.length)
    a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 1))
    // la etiqueta va por la bisectriz, cerca de la nueva (la antigua, a r + 14 del vértice)
    expect(old.labels[0].y).toBeGreaterThan(51.7)
    expect(Math.hypot(old.labels[0].x - now.labels[0].x, old.labels[0].y - now.labels[0].y)).toBeLessThan(20)
  })

  it('en un ángulo de tres puntos mandan los puntos: lo de las versiones antiguas no se lee y se recalcula al guardar', () => {
    const stale = decodeDrawItem({ kind: 'angle', points: [[10, 0], [0, 0], [0, -10]], cx: 500, cy: 500, start: 10, end: 20, r: 30 })!
    expect(stale).toEqual({ kind: 'angle', points: [[10, 0], [0, 0], [0, -10]], r: 30 })
    expect(save(stale)).toMatchObject({ cx: 0, cy: 0, start: 0, end: 90, r: 30 })
    expect(drawItemShape(stale).center).toEqual([0, 0])
    // un ángulo de siempre (sin puntos) no cambia
    expect(save({ kind: 'angle', cx: 5, cy: 5, start: 0, end: 45 })).toEqual({ kind: 'angle', cx: 5, cy: 5, start: 0, end: 45 })
  })

  it('un rightAngle de tres puntos lleva su vértice (el cuadradito sale en él, no en 0,0)', () => {
    const disk = save({ kind: 'rightAngle', points: [[0, 50], [20, 30], [50, 30]] })
    expect(disk).toEqual({ kind: 'rightAngle', points: [[0, 50], [20, 30], [50, 30]], cx: 20, cy: 30 })
    expect(drawItemShape(oldRead(disk)).paths[0].d).toBe('M32 30L32 18L20 18')
    expect(decodeDrawItem(disk)).toEqual({ kind: 'rightAngle', points: [[0, 50], [20, 30], [50, 30]] })
  })

  it('un objeto se ve como su etiqueta donde está (no una línea y la etiqueta en la esquina); la versión nueva lo dibuja', () => {
    const car: DrawItem = { kind: 'object', id: 'car', name: 'Coche', object: 'car', x: 70, y: 150, w: 90, label: 'Coche', fill: 'blue', motion: { dx: 's' } }
    const disk = save(car)
    expect(disk.kind).toBe('text')
    const old = drawItemShape(oldRead(disk))
    expect(old.paths).toEqual([])
    expect(old.labels).toEqual([{ x: 70, y: 150, text: 'Coche', size: 14, anchor: 'center', color: undefined }])
    expect(decodeDrawItem(disk)).toEqual(car)
    // situado con cx, cy: también lleva x, y para la antigua
    const byCentre = save({ kind: 'object', object: 'tree', cx: 40, cy: 60, label: 'Árbol' })
    expect(drawItemShape(oldRead(byCentre)).labels[0]).toMatchObject({ x: 40, y: 60, text: 'Árbol' })
    expect(decodeDrawItem(byCentre)).toEqual({ kind: 'object', object: 'tree', cx: 40, cy: 60, label: 'Árbol' })
    // sin etiqueta, la antigua no pinta nada (antes, un punto en la esquina)
    const bare = drawItemShape(oldRead(save({ kind: 'object', object: 'tree', x: 40, y: 60 })))
    expect([...bare.paths, ...bare.labels]).toEqual([])
    // un objeto sin `object` no tiene nada que guardar como texto
    expect(save({ kind: 'object', x: 1, y: 2 }).kind).toBe('object')
  })

  it('el papel va como estilo de relleno: la antigua no pinta relleno (antes, una aguada ladrillo); la nueva, papel', () => {
    const hollow: DrawItem = { kind: 'circle', cx: 100, cy: 200, r: 5, fill: 'paper', stroke: 'ink' }
    const disk = save(hollow)
    expect(disk).toEqual({ kind: 'circle', cx: 100, cy: 200, r: 5, stroke: 'ink', fillStyle: 'paper' })
    expect(drawItemShape(oldRead(disk)).paths[0].fill).toBeUndefined()
    expect(decodeDrawItem(disk)).toEqual(hollow)
    // «papel» también; un velo de papel conserva su opacidad
    expect(decodeDrawItem(save({ kind: 'rect', x: 0, y: 0, w: 9, h: 9, fill: 'Papel', opacity: 0.6 }))).toEqual({ kind: 'rect', x: 0, y: 0, w: 9, h: 9, fill: 'paper', opacity: 0.6 })
    // rayado de papel y otros colores, como siempre
    expect(save({ kind: 'rect', fill: 'paper', fillStyle: 'hatch' })).toEqual({ kind: 'rect', fill: 'paper', fillStyle: 'hatch' })
    expect(save({ kind: 'rect', fill: 'blue' })).toEqual({ kind: 'rect', fill: 'blue' })
    // un color escrito gana a un estilo «paper»
    expect(decodeDrawItem({ kind: 'rect', fill: 'blue', fillStyle: 'paper' })).toEqual({ kind: 'rect', fill: 'blue' })
  })
})
