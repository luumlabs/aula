import { describe, expect, it } from 'vitest'
import { rngFrom } from './random'
import { circleLoopInk, edgeInk, encircleInk, encirclePad, handOval, openBarbs, outlineInk } from './penInk'

/** Caja de los puntos de un camino SVG «M x y L x y …». */
function bbox(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

describe('pluma de los diagramas', () => {
  it('el rodeo es el mismo con la misma semilla, distinto con otra, y abraza la caja sin salirse del dibujo', () => {
    const a = encircleInk(160, 44, 'diag:n1')
    expect(encircleInk(160, 44, 'diag:n1')).toBe(a)
    expect(encircleInk(160, 44, 'diag:n2').strokes[0].d).not.toBe(a.strokes[0].d)
    expect(a.strokes).toHaveLength(1)
    const pad = encirclePad()
    expect(a.w).toBe(160 + pad * 2)
    expect(a.h).toBe(44 + pad * 2)
    const b = bbox(a.strokes[0].spine)
    // rodea la caja (pasa por fuera de ella) y se queda dentro del dibujo
    expect(b.x0).toBeLessThan(pad)
    expect(b.x1).toBeGreaterThan(pad + 160)
    expect(b.y0).toBeLessThan(pad)
    expect(b.y1).toBeGreaterThan(pad + 44)
    expect(b.x0).toBeGreaterThan(0)
    expect(b.y0).toBeGreaterThan(0)
    expect(b.x1).toBeLessThan(a.w)
    expect(b.y1).toBeLessThan(a.h)
    expect(a.ms).toBeGreaterThanOrEqual(360)
    expect(a.ms).toBeLessThanOrEqual(620)
  })
  it('el óvalo de superelipse se pega a los lados largos de una caja ancha', () => {
    const pts = handOval(0, 0, 300, 20, rngFrom(3), 1, 4)
    // a media altura de la caja, casi todo el ancho
    const near = pts.filter((p) => Math.abs(p.y) > 15)
    expect(Math.max(...near.map((p) => Math.abs(p.x)))).toBeGreaterThan(200)
  })
  it('flecha a tinta: caja propia, trazo y punta abierta después', () => {
    const pts = [{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 200, y: 100 }]
    const barbs = openBarbs(pts[1], pts[2])
    const e = edgeInk(pts, barbs, 'e1')!
    expect(e.x).toBeLessThan(100)
    expect(e.y).toBeLessThan(barbs[0].y)
    expect(e.drawing.strokes).toHaveLength(2)
    expect(e.drawing.strokes[1].at).toBeGreaterThan(e.drawing.strokes[0].ms)
    expect(edgeInk(pts, barbs, 'e1')!.drawing).toBe(e.drawing)
    expect(edgeInk([{ x: 0, y: 0 }], undefined, 'x')).toBeNull()
  })
  it('las barbas son simétricas respecto a la dirección de la flecha', () => {
    const [p1, tip, p2] = openBarbs({ x: 0, y: 0 }, { x: 10, y: 0 }, 10)
    expect(tip).toEqual({ x: 10, y: 0 })
    expect(p1.x).toBeCloseTo(p2.x, 9)
    expect(p1.y).toBeCloseTo(-p2.y, 9)
    expect(p1.x).toBeLessThan(10)
  })
  it('contornos de Venn y de pirámide', () => {
    const c = circleLoopInk(135, 'set-a')
    expect(c.w).toBe(c.h)
    expect(c.strokes).toHaveLength(1)
    const o = outlineInk([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 120, y: 200 }, { x: -20, y: 200 }], 140, 210, 'p')
    expect(o.strokes).toHaveLength(1)
    expect(o.strokes[0].d.length).toBeGreaterThan(50)
  })
})
