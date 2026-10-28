import { describe, expect, it } from 'vitest'
import { integratedLoudness, master, truePeak } from './loudness.ts'

const R = 48000
const sine = (f: number, amp: number, secs: number, phase = 0) => Float32Array.from({ length: R * secs }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / R + phase))

describe('sonoridad BS.1770', () => {
  it('un seno de 997 Hz a −20 dBFS en los dos canales mide −20 LUFS', () => {
    const a = sine(997, 0.1, 10)
    expect(integratedLoudness([a, a.slice()], R)).toBeCloseTo(-20, 1)
  })
  it('las puertas ignoran el silencio', () => {
    const a = new Float32Array(R * 20)
    a.set(sine(997, 0.1, 10))
    // los bloques del borde (medio en silencio) pasan la puerta: unas centésimas, como en cualquier medidor R128
    expect(Math.abs(integratedLoudness([a, a.slice()], R) + 20)).toBeLessThan(0.1)
  })
  it('el pico verdadero ve el pico entre muestras', () => {
    // fs/4 con fase de 45°: las muestras valen 0,707·A, el pico real es A
    const a = sine(R / 4, 0.5, 1, Math.PI / 4)
    expect(truePeak([a])).toBeGreaterThan(20 * Math.log10(0.5) - 0.3)
  })
  it('master deja −14 LUFS con el pico verdadero por debajo de −1 dBTP', () => {
    const x = sine(220, 0.9, 6)
    const y = sine(330, 0.9, 6)
    for (let i = 0; i < x.length; i += 4800) x[i] = 1
    const r = master([x, y], R, -14, -1.5)
    expect(r.lufs).toBeCloseTo(-14, 0)
    expect(r.truePeak).toBeLessThanOrEqual(-1)
  })
})

describe('limitador', () => {
  it('no pasa del techo y la ganancia no da escalones (ni clics)', async () => {
    const { limit } = await import('./loudness.ts')
    const x = sine(220, 0.3, 2)
    for (let i = 48000; i < 48000 + 2000; i++) x[i] *= 3 // un golpe fuerte
    const y = x.slice()
    limit([y], R, -6)
    const ceil = Math.pow(10, -6 / 20)
    expect(Math.max(...Array.from(y, Math.abs))).toBeLessThanOrEqual(ceil + 1e-6)
    // la ganancia aplicada cambia poco de una muestra a la siguiente
    let step = 0
    for (let i = 1; i < y.length; i++) if (Math.abs(x[i]) > 0.05 && Math.abs(x[i - 1]) > 0.05) step = Math.max(step, Math.abs(y[i] / x[i] - y[i - 1] / x[i - 1]))
    expect(step).toBeLessThan(0.01)
  })
})
