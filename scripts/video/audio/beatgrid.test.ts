import { describe, expect, it } from 'vitest'
import { analyzeTrack } from './beatgrid.ts'

/** Pista sintética: bombo en cada pulso, un acorde que cambia cada compás (en el tiempo fuerte) y algo de ruido. */
function synth(bpm: number, downbeat: number, secs: number, rate = 48000): Float32Array {
  const x = new Float32Array(Math.round(secs * rate))
  const beat = 60 / bpm
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
  for (let i = 0; i < x.length; i++) x[i] = 0.01 * rnd()
  const chords = [220, 277, 330, 247]
  for (let n = 0; ; n++) {
    const t = downbeat - beat + n * beat // un pulso de anacrusa
    if (t >= secs) break
    if (t < 0) continue
    const s0 = Math.round(t * rate)
    for (let k = 0; k < rate * 0.12 && s0 + k < x.length; k++) x[s0 + k] += 0.6 * Math.sin((2 * Math.PI * 55 * k) / rate) * Math.exp(-k / (rate * 0.03))
  }
  const barDur = beat * 4
  for (let b = 0; ; b++) {
    const t = downbeat + b * barDur
    if (t >= secs) break
    const f = chords[b % 4]
    const s0 = Math.round(t * rate)
    for (let k = 0; k < barDur * rate && s0 + k < x.length; k++) x[s0 + k] += 0.12 * Math.sin((2 * Math.PI * f * k) / rate) + 0.06 * Math.sin((2 * Math.PI * f * 1.5 * k) / rate)
  }
  return x
}

describe('rejilla de pulsos', () => {
  it('encuentra el tempo, el primer pulso y el tiempo fuerte', () => {
    const g = analyzeTrack(synth(115.5, 0.73, 40), 48000)
    expect(Math.abs(g.bpm - 115.5)).toBeLessThan(0.03)
    expect(Math.abs(g.downbeat - 0.73)).toBeLessThan(0.012)
    expect(g.confidence).toBeGreaterThan(3)
    expect(g.bars[0].bar).toBe(1)
  })
  it('es determinista', () => {
    const x = synth(120, 0.5, 20)
    expect(analyzeTrack(x, 48000)).toEqual(analyzeTrack(x, 48000))
  })
})
