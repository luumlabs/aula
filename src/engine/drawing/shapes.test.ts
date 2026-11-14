import { describe, expect, it } from 'vitest'
import type { DrawItem } from '@shared/schema/common'
import { LEGACY_EXPECTED, LEGACY_ITEMS } from './fixtures/legacy'
import { drawItemShape, drawingShapes } from './shapes'
import { bezierAt, ellipsePoints, pointAlong, smoothPath, splineSegments, type Pt } from './geometry'

describe('dibujo: los tipos de siempre no cambian', () => {
  it('caminos, puntas y etiquetas idénticos byte a byte (Pitágoras de la galería y uno de cada tipo)', () => {
    const shapes = drawingShapes(LEGACY_ITEMS)
    expect(shapes).toHaveLength(LEGACY_EXPECTED.length)
    shapes.forEach((s, i) => {
      const want = LEGACY_EXPECTED[i]
      expect(s.paths.map((p) => p.d)).toEqual(want.paths.map((p) => p.d))
      expect(s.paths.map((p) => ({ stroke: p.stroke, fill: p.fill, width: p.width, dashed: p.dashed, fillOnly: p.fillOnly }))).toEqual(
        want.paths.map((p) => ({ stroke: p.stroke, fill: p.fill, width: p.width, dashed: p.dashed, fillOnly: p.fillOnly }))
      )
      expect(s.heads).toEqual(want.heads)
      expect(s.labels).toEqual(want.labels)
    })
  })

  it('una línea sin ninguna coordenada (un tipo que una versión vieja no conoce) no dibuja un punto en 0,0', () => {
    expect(drawItemShape({ kind: 'line' }).paths).toHaveLength(0)
    expect(drawItemShape({ kind: 'line', x2: 4 }).paths).toHaveLength(1)
  })
})

describe('dibujo: contornos', () => {
  it('rect: cuatro esquinas, cerrado y su caja', () => {
    const s = drawItemShape({ kind: 'rect', x: 10, y: 20, w: 40, h: 30 })
    expect(s.closed).toBe(true)
    expect(s.around).toEqual({ x: 10, y: 20, w: 40, h: 30 })
    expect(s.outline[0]).toEqual([10, 20])
    expect(s.outline[s.outline.length - 1]).toEqual([10, 20])
    expect(s.center).toEqual([30, 35])
  })
  it('circle: empieza a la derecha y va antihorario (hacia arriba en pantalla)', () => {
    const s = drawItemShape({ kind: 'circle', cx: 100, cy: 100, r: 20 })
    expect(s.closed).toBe(true)
    expect(s.outline[0]).toEqual([120, 100])
    expect(s.outline[3][1]).toBeLessThan(100)
    expect(s.around).toEqual({ x: 80, y: 80, w: 40, h: 40 })
  })
  it('polyline: abierta, con los extremos como sitios para la etiqueta', () => {
    const s = drawItemShape({ kind: 'polyline', points: [[0, 0], [50, 0], [50, 50]] })
    expect(s.closed).toBe(false)
    expect(s.alternatives).toHaveLength(2)
    expect(s.outline[0]).toEqual([0, 0])
    expect(s.outline[s.outline.length - 1]).toEqual([50, 50])
  })
})

describe('dibujo: curvas suaves y rayado', () => {
  const pts: Pt[] = [[0, 0], [40, 30], [80, 0], [120, 40]]
  it('la curva suave pasa por todos los puntos', () => {
    const segs = splineSegments(pts, false)
    expect(segs).toHaveLength(3)
    segs.forEach((s, i) => {
      expect(bezierAt(s, 0)).toEqual(pts[i])
      expect(bezierAt(s, 1)).toEqual(pts[i + 1])
    })
  })
  it('una mancha cerrada termina en Z sin repetir el primer punto', () => {
    const d = smoothPath(pts, true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(4)
    expect(d.startsWith('M0 0C')).toBe(true)
  })
  it('polygon con smooth da una mancha; polyline con smooth una curva abierta', () => {
    expect(drawItemShape({ kind: 'polygon', points: pts, smooth: true }).paths[0].d).toMatch(/C.*Z$/)
    expect(drawItemShape({ kind: 'polyline', points: pts, smooth: true }).paths[0].d).not.toMatch(/Z$/)
  })
  it('el relleno rayado lleva papel debajo', () => {
    const p = drawItemShape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'gray', fillStyle: 'hatch' }).paths[0]
    expect(p.fill).toMatchObject({ color: 'gray', hatch: true })
    expect(p.paper).toBe(true)
    expect(drawItemShape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'gray' }).paths[0].paper).toBeUndefined()
  })
})

describe('dibujo: recorridos', () => {
  const line: Pt[] = [[0, 0], [100, 0]]
  it('pointAlong en una línea: 0, la mitad y el final', () => {
    expect(pointAlong(line, 0, false).at).toEqual([0, 0])
    expect(pointAlong(line, 0.5, false).at).toEqual([50, 0])
    expect(pointAlong(line, 1, false).at).toEqual([100, 0])
    expect(pointAlong(line, 7, false).at).toEqual([100, 0])
  })
  it('en el perímetro de un rectángulo (cerrado: da la vuelta)', () => {
    const s = drawItemShape({ kind: 'rect', x: 0, y: 0, w: 100, h: 100 })
    const half = pointAlong(s.outline, 0.5, true).at
    expect(half[0]).toBeCloseTo(100)
    expect(half[1]).toBeCloseTo(100)
    expect(pointAlong(s.outline, 1.25, true).at[0]).toBeCloseTo(100)
  })
  it('en una circunferencia empieza a la derecha y sube (antihorario)', () => {
    const ring = [...ellipsePoints(0, 0, 10, 10), ellipsePoints(0, 0, 10, 10)[0]]
    const q = pointAlong(ring, 0.25, true)
    expect(q.at[0]).toBeCloseTo(0, 0)
    expect(q.at[1]).toBeCloseTo(-10, 0)
    // la tangente arriba del todo apunta a la izquierda (180°)
    expect(Math.abs(q.deg)).toBeGreaterThan(170)
  })
  it('una polilínea con tramos de longitud cero no se rompe', () => {
    const r = pointAlong([[0, 0], [0, 0], [10, 0], [10, 0]], 0.5, false)
    expect(r.at).toEqual([5, 0])
    expect(r.deg).toBe(0)
  })
})

describe('dibujo: tolerante', () => {
  it('coordenadas no finitas no rompen nada', () => {
    const items: DrawItem[] = [{ kind: 'object', object: 'car', x: Number.NaN, y: 1e12 }, { kind: 'measure', x1: 0, y1: 0, x2: Number.NaN, y2: 1 }, { kind: 'grid', x: 0, y: 0, w: 1e9, h: 10, step: 0.0001 }]
    for (const s of drawingShapes(items)) for (const p of s.paths) expect(p.d).not.toMatch(/NaN|Infinity/)
  })
})

describe('dibujo: relleno de papel', () => {
  it('«paper» tapa lo que queda detrás (opaco) si no se pide otra opacidad; los demás colores, la aguada de siempre', () => {
    // un extremo abierto de una recta numérica y una máscara sobre una línea
    expect(drawItemShape({ kind: 'circle', cx: 100, cy: 200, r: 5, fill: 'paper', stroke: 'ink' }).paths[0].fill).toEqual({ color: 'paper', opacity: 1 })
    expect(drawItemShape({ kind: 'rect', x: 5, y: 5, w: 30, h: 20, fill: ' Papel ', width: 0 }).paths[0].fill?.opacity).toBe(1)
    // un velo de papel pedido a propósito
    expect(drawItemShape({ kind: 'rect', x: 0, y: 0, w: 9, h: 9, fill: 'paper', opacity: 0.6 }).paths[0].fill?.opacity).toBe(0.6)
    expect(drawItemShape({ kind: 'rect', x: 0, y: 0, w: 9, h: 9, fill: 'amber' }).paths[0].fill?.opacity).toBe(0.22)
    // la cuña de un ángulo de papel, también
    const wash = drawItemShape({ kind: 'angle', points: [[10, 0], [0, 0], [7, -7]], fill: 'paper' }).paths.find((p) => p.fillOnly)
    expect(wash?.fill).toEqual({ color: 'paper', opacity: 1 })
  })
})

describe('dibujo: rectángulo redondeado a mano', () => {
  it('el contorno (y la línea a mano) sigue las esquinas redondeadas; el camino exacto no cambia', () => {
    const s = drawItemShape({ kind: 'rect', x: 0, y: 0, w: 100, h: 60, r: 30 })
    expect(s.paths[0].d).toBe('M30 0H70A30 30 0 0 1 100 30V30A30 30 0 0 1 70 60H30A30 30 0 0 1 0 30V30A30 30 0 0 1 30 0Z')
    const pts = s.paths[0].pts!
    expect(pts.length).toBeGreaterThan(20)
    // ninguna esquina viva: todo punto queda dentro de la cápsula
    for (const [x, y] of pts) {
      const cx = Math.min(Math.max(x, 30), 70)
      expect(Math.hypot(x - cx, y - 30)).toBeLessThanOrEqual(30.001)
    }
    expect(pts).not.toContainEqual([0, 0])
    // empieza junto a la esquina de arriba a la izquierda y va en el sentido de las agujas del reloj, como el de esquinas vivas
    expect(pts[0][0]).toBeCloseTo(0)
    expect(pts[0][1]).toBeCloseTo(30)
    // la esquina de arriba a la izquierda acaba arriba y sigue hacia la derecha
    expect(pts[15][0]).toBeCloseTo(30)
    expect(pts[15][1]).toBeCloseTo(0)
    expect(pts[16][0]).toBeCloseTo(70)
    expect(pts[16][1]).toBeCloseTo(0)
    expect(s.outline[s.outline.length - 1]).toEqual(pts[0])
    expect(drawItemShape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }).paths[0].pts).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })

  it('el tubo del termómetro (un objeto, siempre a mano) es una cápsula, también girado', () => {
    for (const rotate of [0, 30]) {
      const tube = drawItemShape({ kind: 'object', object: 'thermometer', x: 100, y: 100, w: 100, rotate }).paths[0]
      expect(tube.hand).toBe(true)
      expect(tube.pts!.length, `rotate ${rotate}`).toBeGreaterThan(20)
    }
    const flat = drawItemShape({ kind: 'object', object: 'thermometer', x: 100, y: 100, w: 100 }).paths[0].pts!
    expect(flat).not.toContainEqual([93, 52])
  })
})

describe('dibujo: ángulo de tres puntos', () => {
  it('los puntos mandan aunque haya cx, cy, start y end (los que se guardan para las versiones antiguas)', () => {
    const points = [[110, 100], [100, 100], [100, 80]]
    const both = drawItemShape({ kind: 'angle', points, cx: 0, cy: 0, start: 0, end: 90 })
    expect(both).toEqual(drawItemShape({ kind: 'angle', points }))
    expect(both.center).toEqual([100, 100])
    const right = drawItemShape({ kind: 'rightAngle', points, cx: 0, cy: 0, x: 5, y: 5 })
    expect(right).toEqual(drawItemShape({ kind: 'rightAngle', points }))
    // sin tres puntos, cx, cy, start y end como siempre
    expect(drawItemShape({ kind: 'angle', points: [[1, 1]], cx: 5, cy: 5 }).center).toEqual([5, 5])
  })
})
