import { describe, expect, it } from 'vitest'
import { addPoint, prune, ribbon, ripple, TRAIL_HEAD, TRAIL_MS, type TrailPoint } from './trail'

const pts = (...xs: [number, number][]): TrailPoint[] => xs.map(([x, t]) => ({ x, y: 0, t }))

describe('la cola del cursor-sol', () => {
  it('olvida los puntos más viejos que TRAIL_MS y no alarga la cola con el cursor quieto', () => {
    let p: TrailPoint[] = []
    p = addPoint(p, { x: 0, y: 0, t: 0 })
    p = addPoint(p, { x: 10, y: 0, t: 16 })
    p = addPoint(p, { x: 10.2, y: 0, t: 32 })
    expect(p.map((q) => q.x)).toEqual([0, 10.2])
    p = addPoint(p, { x: 40, y: 0, t: TRAIL_MS + 20 })
    expect(p.map((q) => q.x)).toEqual([10.2, 40])
    expect(prune(p, 10_000)).toEqual([])
  })

  it('es una cinta que se afina: cero en la punta vieja y casi el diámetro del sol junto a él; se recoge con la edad', () => {
    const r = ribbon(pts([0, 40], [20, 60], [40, 80], [60, 100]), 100)!
    expect(r.outline).toHaveLength(8)
    const width = (i: number): number => Math.abs(r.outline[i][1] - r.outline[r.outline.length - 1 - i][1])
    expect(width(0)).toBe(0)
    for (let i = 1; i < 4; i++) expect(width(i)).toBeGreaterThan(width(i - 1))
    expect(width(3)).toBeCloseTo(TRAIL_HEAD)
    expect(r.alpha).toBeCloseTo(0.85)
    expect(r.head.x).toBe(60)
    expect(r.tail.x).toBe(0)
    // con el cursor quieto, se apaga
    expect(ribbon(pts([0, 0], [20, 10]), 10 + TRAIL_MS)).toBeNull()
    expect(ribbon(pts([0, 0]), 0)).toBeNull()
  })

  it('la onda al pulsar crece y se apaga en RIPPLE_MS', () => {
    expect(ripple(0, 0)).toEqual({ r: 6, alpha: 0.55 })
    const mid = ripple(0, 200)!
    expect(mid.r).toBeGreaterThan(6)
    expect(mid.alpha).toBeLessThan(0.55)
    expect(ripple(0, 450)).toBeNull()
    expect(ripple(100, 50)).toBeNull()
  })
})
