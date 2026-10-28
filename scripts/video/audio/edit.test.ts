import { describe, expect, it } from 'vitest'
import { editTrack } from './edit.ts'

describe('montaje de la pista', () => {
  it('suena cada tramo en su sitio y cose el corte sin hueco', () => {
    const rate = 1000
    const src = Float32Array.from({ length: 10000 }, (_, i) => i / 10000) // rampa: el valor dice de dónde viene
    const out = editTrack([src], rate, [{ video: 0, from: 1, to: 3 }, { video: 2, from: 6, to: 10 }], 6, 0.02)[0]
    expect(out.length).toBe(6000)
    expect(out[500]).toBeCloseTo(src[1500])
    expect(out[3000]).toBeCloseTo(src[7000])
    // en el corte (2 s del vídeo) suenan los dos tramos a medias: nunca silencio
    for (let i = 1990; i < 2010; i++) expect(out[i]).toBeGreaterThan(0.25)
  })
  it('el final es el de la pista (sin fundido inventado)', () => {
    const src = new Float32Array(5000).fill(0.5)
    const out = editTrack([src], 1000, [{ video: 0, from: 0, to: 5 }], 5)[0]
    expect(out[4999]).toBeCloseTo(0.5)
  })
})
