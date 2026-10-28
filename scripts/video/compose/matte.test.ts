import { describe, expect, it } from 'vitest'
import { EDGE, LIFT_EDGE, fillGaps, liftField, matteAt, type Matte } from './matte.ts'

describe('barrido como matte', () => {
  it('los huecos que ningún trazo cubre heredan la llegada de sus vecinos (todo el cuadro queda cubierto)', () => {
    const gw = 6
    const gh = 3
    const T = new Float32Array(gw * gh).fill(-1)
    T[0] = 0.1
    T[gw * gh - 1] = 0.4
    fillGaps(T, gw, gh)
    for (const v of T) expect(v).toBeGreaterThanOrEqual(0)
    expect(T[1]).toBeGreaterThan(0.1)
    expect(T[1]).toBeLessThan(0.12)
  })
  it('cada píxel pasa de viejo a ladrillo y de ladrillo a nuevo: nunca nuevo sin haber estado pintado, nunca dos escenas', () => {
    const gw = 40
    const gh = 1
    const T = new Float32Array(gw).map((_, i) => (i / gw) * 0.7)
    const L = liftField(T, gw, gh, { x: 1, y: 0 }, 7)
    const m: Matte = { gw, gh, scale: 1, T, L, gap: new Float32Array(gw) }
    for (let i = 0; i < gw; i++) {
      expect(L[i]).toBeGreaterThan(T[i])
      expect(L[i]).toBeLessThanOrEqual(1 - 2 * LIFT_EDGE + 1e-6)
    }
    const paint = new Uint8ClampedArray(gw * 4)
    const scene = new Uint8ClampedArray(gw * 4)
    for (let p = 0; p <= 1.0001; p += 1 / 120) {
      matteAt(m, p, paint, scene)
      for (let i = 0; i < gw; i++) {
        const pa = paint[i * 4 + 3]
        const sc = scene[i * 4 + 3]
        // la escena nueva solo donde la pintura ya llegó
        if (sc > 0) expect(p).toBeGreaterThanOrEqual(T[i] - EDGE)
        // fuera de los bordes blandos, o es pintura o es escena (nunca las dos a medias)
        if (Math.abs(p - L[i]) > LIFT_EDGE && Math.abs(p - T[i]) > EDGE) expect(pa === 0 || sc === 0).toBe(true)
      }
    }
    // al final, todo es escena nueva y nada de pintura
    matteAt(m, 1, paint, scene)
    for (let i = 0; i < gw; i++) {
      expect(scene[i * 4 + 3]).toBe(255)
      expect(paint[i * 4 + 3]).toBe(0)
    }
  })
  it('el borde que se levanta son cerdas de varios px (no un peine de agujas de 1–2 px) y nunca muy largas', () => {
    const gh = 1200
    const L = liftField(new Float32Array(gh), 1, gh, { x: 1, y: 0 }, 3)
    const mean = L.reduce((a, b) => a + b, 0) / gh
    let runs = 0
    for (let y = 1; y < gh; y++) if (L[y] > mean !== L[y - 1] > mean) runs++
    expect(gh / Math.max(1, runs)).toBeGreaterThanOrEqual(4)
    // la diferencia entre cerdas vecinas (largo de la «aguja», en fracción del barrido) es pequeña
    let maxStep = 0
    for (let y = 1; y < gh; y++) maxStep = Math.max(maxStep, Math.abs(L[y] - L[y - 1]))
    expect(maxStep).toBeLessThan(0.01)
    expect(Math.max(...L) - Math.min(...L)).toBeLessThan(0.04)
  })
})
