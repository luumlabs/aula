import { describe, expect, it } from 'vitest'
import { filmGrid, shortCuts, type GridJson } from './grid.ts'

const G: GridJson = {
  track: 'x', bpm: 120, beat: 0.5, beatsPerBar: 4, downbeat: 0.25, duration: 0.25 + 40 * 2 + 1.5, confidence: 10, sections: [],
  bars: Array.from({ length: 41 }, (_, i) => ({ bar: i + 1, t: 0.25 + i * 2, rmsDb: -15 - i, lowDb: 40, novelty: 0 }))
}

describe('rejilla de la película', () => {
  it('sin cortes, V da compás y pulso', () => {
    const f = filmGrid(G)
    expect(f.V(1)).toBe(0.25)
    expect(f.V(3, 2)).toBeCloseTo(0.25 + 4 + 0.5)
    expect(f.V(2, 1, 0.5)).toBeCloseTo(2.5)
    expect(f.duration).toBeCloseTo(G.duration)
    expect(f.snap(2.6)).toBeCloseTo(2.75)
    expect(f.snap(3.3, 'bar')).toBeCloseTo(4.25)
  })
  it('quitar 8 compases acorta 16 s y salta en la pista', () => {
    const f = filmGrid(G, [[17, 25]])
    expect(f.duration).toBeCloseTo(G.duration - 16)
    expect(f.trackBar(16)).toBe(16)
    expect(f.trackBar(17)).toBe(25)
    expect(f.cuts).toEqual([f.V(17)])
    expect(f.toTrack(f.V(17) + 0.1)).toBeCloseTo(0.25 + 24 * 2 + 0.1)
    expect(f.bars.find((b) => b.bar === 17)?.rmsDb).toBe(-15 - 24)
    expect(f.segments).toEqual([
      { video: 0, from: 0, to: 0.25 + 16 * 2 },
      { video: 0.25 + 16 * 2, from: 0.25 + 24 * 2, to: G.duration }
    ])
  })
  it('rechaza cortes solapados o fraccionarios', () => {
    expect(() => filmGrid(G, [[5, 9], [8, 12]])).toThrow()
    expect(() => filmGrid(G, [[5.5, 9]])).toThrow()
  })
})

describe('inicio del vídeo dentro de la pista', () => {
  it('start salta el silencio inicial: V(1) se adelanta y la pista suena desde start', () => {
    const f = filmGrid(G, [], 0.2)
    expect(f.V(1)).toBeCloseTo(0.05)
    expect(f.toTrack(0)).toBeCloseTo(0.2)
    expect(f.duration).toBeCloseTo(G.duration - 0.2)
  })
})

describe('final y secciones', () => {
  it('acaba 0,8 s después de la última nota y da las secciones en compases del vídeo', () => {
    const g = { ...G, lastSound: 70, sections: [20, 30] }
    const f = filmGrid(g, [[17, 25]])
    expect(f.duration).toBeCloseTo(70.8 - 16)
    // la sección 20 de la pista cae dentro del corte; la 30 pasa a ser el compás 22 del vídeo
    expect(f.sections).toEqual([22])
  })
})

describe('versión corta', () => {
  it('un corte [1, b) empieza el vídeo en el compás b de la pista, con el mismo pulso de entrada', () => {
    const f = filmGrid(G, shortCuts(9, 4, 33), 0.2)
    expect(f.trackBar(1)).toBe(9)
    expect(f.trackBar(4)).toBe(12)
    expect(f.trackBar(5)).toBe(33)
    expect(f.V(1)).toBeCloseTo(0.05)
    // la pista suena desde 0,05 s antes del compás 9 y acaba en su final real
    expect(f.segments[0]).toEqual({ video: 0, from: 0.2 + 8 * 2, to: 0.25 + 12 * 2 })
    expect(f.segments[1].from).toBeCloseTo(0.25 + 32 * 2)
    expect(f.segments[1].to).toBe(G.duration)
    expect(f.duration).toBeCloseTo(0.05 + 4 * 2 + (G.duration - (0.25 + 32 * 2)))
    expect(f.toTrack(f.V(2))).toBeCloseTo(0.25 + 9 * 2)
  })
  it('shortCuts sin hueco cuando el tramo llega al final', () => {
    expect(shortCuts(25, 8, 33)).toEqual([[1, 25]])
    expect(() => shortCuts(30, 8, 33)).toThrow()
  })
})
