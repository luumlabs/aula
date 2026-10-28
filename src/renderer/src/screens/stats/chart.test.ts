import { describe, expect, it } from 'vitest'
import { bandPath, monotonePath } from './chart'

describe('monotonePath', () => {
  it('vacío, un punto y una recta', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1,2')
    expect(monotonePath([{ x: 0, y: 0 }, { x: 3, y: 3 }])).toBe('M0,0 C1,1 2,2 3,3')
  })
  it('no se pasa en una meseta (tangentes a cero)', () => {
    const d = monotonePath([{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 0 }])
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]))
    expect(Math.max(...ys)).toBeLessThanOrEqual(10)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
  })
  it('banda cerrada', () => {
    const b = bandPath([{ x: 0, y: 1 }, { x: 1, y: 1 }], [{ x: 0, y: 3 }, { x: 1, y: 3 }])
    expect(b.startsWith('M0,1')).toBe(true)
    expect(b.endsWith('Z')).toBe(true)
    expect(bandPath([{ x: 0, y: 1 }], [])).toBe('')
  })
})
