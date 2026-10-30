import { describe, expect, it } from 'vitest'
import { clipLocalOf, clipSource, minSpeed, unwarp, warp, warpSpeed } from './ramp.ts'
import type { Ramp } from './types.ts'

describe('cámara lenta con rampa', () => {
  const r: Ramp = { from: 2, to: 5, at: 3.5, slow: 0.2, width: 0.4 }
  it('lo de fuera no se mueve y el momento cae a su hora', () => {
    expect(warp([r], 1.7)).toBe(1.7)
    expect(warp([r], 5.3)).toBe(5.3)
    expect(warp([r], 3.5)).toBeCloseTo(3.5, 3)
    expect(warp([r], 2)).toBe(2)
    expect(warp([r], 4.9999)).toBeCloseTo(5, 3)
  })
  it('rápido, muy lento en el momento y rápido otra vez; sin tirones en los bordes', () => {
    expect(warpSpeed([r], 3.5)).toBeCloseTo(0.2, 2)
    expect(warpSpeed([r], 2.55)).toBeGreaterThan(1.2)
    expect(warpSpeed([r], 4.5)).toBeGreaterThan(1.2)
    expect(warpSpeed([r], 2.001)).toBeCloseTo(1, 1)
    expect(warpSpeed([r], 4.999)).toBeCloseTo(1, 1)
    // monótono y continuo: el tiempo nunca vuelve atrás ni salta
    let prev = warp([r], 1.9)
    let maxStep = 0
    for (let t = 1.9; t <= 5.1; t += 1 / 240) {
      const v = warp([r], t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      maxStep = Math.max(maxStep, v - prev)
      prev = v
    }
    expect(maxStep).toBeLessThan(0.02)
    // la velocidad tampoco salta (aceleración acotada)
    let prevS = warpSpeed([r], 1.9)
    for (let t = 1.9; t <= 5.1; t += 1 / 240) {
      const s = warpSpeed([r], t)
      expect(Math.abs(s - prevS)).toBeLessThan(0.08)
      prevS = s
    }
  })
  it('la inversa: el instante del vídeo en que se ve un segundo de la toma', () => {
    for (const tau of [2.3, 3.1, 3.5, 3.8, 4.6]) expect(warp([r], unwarp([r], tau))).toBeCloseTo(tau, 6)
    const clip = { from: 10, speed: 0.5, ramps: [r] }
    expect(clipSource(clip, 1)).toBeCloseTo(10.5, 9)
    expect(clipLocalOf(clip, clipSource(clip, 3.9))).toBeCloseTo(3.9, 6)
    expect(minSpeed(clip)).toBeCloseTo(0.1, 9)
  })
})
