import { describe, expect, it } from 'vitest'
import { unionDrawingBounds } from './drawingBounds'
describe('encuadre completo Drawing', () => {
  it('une lienzo, overflow negativo y texto real sin usar el viewport', () => {
    expect(unionDrawingBounds([{ x: 0, y: 0, width: 600, height: 450 }, { x: -80.2, y: -12.3, width: 90, height: 10 }, { x: 580, y: 440, width: 220.7, height: 61.1 }])).toEqual({ x: -83, y: -15, width: 886, height: 519 })
  })
  it('una geometría grande no se recorta para cumplir la resolución; ésta se elige después', () => {
    expect(unionDrawingBounds([{ x: -5000, y: 0, width: 10_000, height: 100 }]).width).toBe(10_004)
  })
  it.each([NaN, Infinity, -Infinity])('rechaza una caja no finita (%s)', (value) => {
    expect(() => unionDrawingBounds([{ x: value, y: 0, width: 1, height: 1 }])).toThrow()
  })
})
