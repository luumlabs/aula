import { describe, expect, it } from 'vitest'
import { lightOffset } from './glassLightMath'

const box = { width: 400, height: 200 }
const center = { x: 60, y: 100 }

describe('lightOffset', () => {
  it('recorre una fracción del camino hacia el puntero', () => {
    expect(lightOffset({ x: 260, y: 100 }, box, center, 0.5)).toEqual({ x: 100, y: 0 })
  })
  it('no saca el centro de la luz de la tarjeta', () => {
    const o = lightOffset({ x: 400, y: 200 }, box, center, 1)
    expect(center.x + o.x).toBeLessThanOrEqual(400 * 0.92)
    expect(center.y + o.y).toBeLessThanOrEqual(200 * 0.92)
  })
  it('con el puntero en el centro de la luz no se mueve', () => {
    expect(lightOffset(center, box, center)).toEqual({ x: 0, y: 0 })
  })
  it('aguanta cajas vacías y valores no finitos', () => {
    expect(lightOffset({ x: 10, y: 10 }, { width: 0, height: 100 }, center)).toEqual({ x: 0, y: 0 })
    const o = lightOffset({ x: Number.NaN, y: Infinity }, box, center)
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true)
  })
  it('un puntero fuera de la tarjeta cuenta como su borde', () => {
    expect(lightOffset({ x: -500, y: 100 }, box, { x: 200, y: 100 }, 0.5)).toEqual({ x: -100, y: 0 })
  })
})
