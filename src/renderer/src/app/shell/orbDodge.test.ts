import { describe, expect, it } from 'vitest'
import { coveredFraction, coversAControl, overlapCenter } from './orbDodge'

// la gota a 1000×680: 44 px a 24 px de la esquina
const orb = { left: 1000 - 68, top: 680 - 68, right: 1000 - 24, bottom: 680 - 24 }

describe('A4-P2-13 · la gota no tapa controles', () => {
  it('un interruptor medio debajo de la gota cuenta como tapado', () => {
    const quietHours = { left: 1000 - 75, top: 680 - 60, right: 1000 - 35, bottom: 680 - 36 }
    expect(coveredFraction(orb, quietHours)).toBeGreaterThan(0.5)
    expect(coversAControl(orb, [quietHours])).toBe(true)
  })
  it('una tarjeta grande que se pulsa no: se puede pulsar en otro sitio', () => {
    const card = { left: 500, top: 300, right: 1000 - 35, bottom: 680 - 10 }
    expect(coversAControl(orb, [card])).toBe(false)
  })
  it('lo que queda lejos no cuenta', () => {
    expect(coveredFraction(orb, { left: 10, top: 10, right: 60, bottom: 40 })).toBe(0)
  })
  it('mira en el centro de la parte tapada, aunque sea una franja del borde (antes 5 puntos fijos no la veían)', () => {
    const edge = { left: 1000 - 30, top: 680 - 60, right: 1000 - 2, bottom: 680 - 40 }
    const [x, y] = overlapCenter(orb, edge)!
    expect(x).toBeGreaterThan(edge.left)
    expect(x).toBeLessThan(orb.right)
    expect(y).toBe(680 - 50)
    expect(overlapCenter(orb, { left: 10, top: 10, right: 60, bottom: 40 })).toBeNull()
  })
})
