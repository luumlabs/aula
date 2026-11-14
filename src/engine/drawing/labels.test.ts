import { describe, expect, it } from 'vitest'
import { overlaps, type Box } from './geometry'
import { drawingLayout, paintOrder, placeLabel } from './labels'
import { drawItemShape, labelBox } from './shapes'

describe('etiquetas que se colocan solas', () => {
  const canvas = { w: 400, h: 300 }
  it('dentro de una forma cerrada cuando cabe', () => {
    const s = drawItemShape({ kind: 'rect', x: 100, y: 100, w: 200, h: 100 })
    const { box, leader } = placeLabel({ w: 40, h: 16 }, s, [], s.outline, canvas)
    expect(box.x).toBeCloseTo(180)
    expect(box.y).toBeCloseTo(142)
    expect(leader).toBeUndefined()
  })
  it('fuera cuando no cabe, a la derecha primero', () => {
    const s = drawItemShape({ kind: 'circle', cx: 100, cy: 100, r: 10 })
    const { box } = placeLabel({ w: 60, h: 16 }, s, [], s.outline, canvas)
    expect(box.x).toBeGreaterThan(110)
  })
  it('evita una caja ya ocupada', () => {
    const s = drawItemShape({ kind: 'circle', cx: 100, cy: 100, r: 10 })
    const right: Box = { x: 110, y: 80, w: 100, h: 40 }
    const { box } = placeLabel({ w: 60, h: 16 }, s, [right], s.outline, canvas)
    expect(overlaps(box, right)).toBe(false)
    expect(box.x + box.w).toBeLessThan(100)
  })
  it('respeta el orden de preferencia de los lados', () => {
    const s = drawItemShape({ kind: 'circle', cx: 100, cy: 100, r: 10 })
    const { box } = placeLabel({ w: 30, h: 14 }, s, [], s.outline, canvas, [8, 34], ['bottom'])
    expect(box.y).toBeGreaterThan(110)
  })
  it('la línea guía solo en el anillo de fuera', () => {
    const s = drawItemShape({ kind: 'circle', cx: 100, cy: 100, r: 10 })
    // los cuatro lados cercanos ocupados: tiene que ir al anillo lejano
    const near: Box[] = [{ x: 60, y: 60, w: 80, h: 80 }]
    const { box, leader } = placeLabel({ w: 20, h: 12 }, s, near, s.outline, canvas)
    expect(leader).toBeDefined()
    expect(overlaps(box, near[0])).toBe(false)
  })
  it('se queda dentro del lienzo si hay sitio', () => {
    const s = drawItemShape({ kind: 'circle', cx: 390, cy: 150, r: 6 })
    const { box } = placeLabel({ w: 60, h: 16 }, s, [], s.outline, canvas)
    expect(box.x + box.w).toBeLessThanOrEqual(400)
  })
  it('las etiquetas automáticas no pisan los textos puestos a mano', () => {
    const shapes = drawingLayout([
      { kind: 'text', x: 220, y: 100, text: 'Texto fijo', anchor: 'left' },
      { kind: 'object', object: 'ball', x: 200, y: 100, w: 30, label: 'Pelota' }
    ], 400, 300)
    const fixed = labelBox(shapes[0].labels[0])
    const auto = labelBox(shapes[1].labels[0])
    expect(overlaps(fixed, auto)).toBe(false)
  })
  it('la rejilla se pinta siempre al fondo', () => {
    expect(paintOrder([{ kind: 'line' }, { kind: 'grid' }, { kind: 'circle' }])).toEqual([1, 0, 2])
  })
})
