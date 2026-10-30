import { describe, expect, it } from 'vitest'
import { SR } from './dsp.ts'
import { levelDb, phoneBand, profile } from './profile.ts'
import { hitTransient, makeBuses, whoosh, type Ctx, type WhooshStyle } from './voices.ts'

function solo(f: (ctx: Ctx) => void, secs = 1.2) {
  const b = makeBuses(Math.round(secs * SR))
  let s = 1
  f({ b, seed: () => (s = (s * 1103515245 + 12345) >>> 0) })
  return profile([b.fx.L, b.fx.R], SR)
}

describe('voces', () => {
  it('el aire de cada gesto tiene su color: barrido brillante, empujón grave', () => {
    const c = (style: WhooshStyle) => solo((ctx) => whoosh(ctx, 0.1, 0.8, 0.5, 0.5, 76, 0.8, -0.5, 0.5, style)).centroid
    expect(c('whip')).toBeGreaterThan(c('air'))
    expect(c('air')).toBeGreaterThan(c('push'))
    expect(c('paper')).toBeGreaterThan(c('push'))
  })

  it('el golpe tiene su energía por encima de 300 Hz (lo que suena en un móvil)', () => {
    const b = makeBuses(Math.round(0.8 * SR))
    let s = 1
    hitTransient({ b, seed: () => (s = (s * 1103515245 + 12345) >>> 0) }, 0.05, 1, 0)
    const all = levelDb([b.fx.L, b.fx.R], SR, 0, 0.8)
    const phone = levelDb(phoneBand([b.fx.L, b.fx.R], SR), SR, 0, 0.8)
    expect(phone - all).toBeGreaterThan(-1.5)
  })
})

describe('mezcla', () => {
  it('la estantería aguda exacta quita lo que dice por encima de 4 kHz (la calidez del día)', async () => {
    const { highShelf } = await import('./mix.ts')
    const { Stereo, noise } = await import('./dsp.ts')
    const hf = (d: number) => {
      const s = new Stereo(SR * 2)
      const n = noise(5)
      for (let i = 0; i < s.L.length; i++) s.L[i] = s.R[i] = n() * 0.1
      highShelf(s, 4000, () => d)
      return levelDb(phoneBand([s.L, s.R], SR, 6000), SR, 0.3, 2)
    }
    expect(hf(-2) - hf(0)).toBeCloseTo(-2, 0)
  })
})
