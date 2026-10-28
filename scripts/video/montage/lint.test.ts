import { describe, expect, it } from 'vitest'
import { lintMontage } from './lint.ts'
import type { Montage } from './types.ts'
import type { GridJson } from './grid.ts'

const grid: GridJson = { track: 'x', bpm: 120, beat: 0.5, beatsPerBar: 4, downbeat: 0, duration: 32, confidence: 10, sections: [], bars: [] }
const base = (over: Partial<Montage>): Montage => ({
  name: 't', fps: 60, size: [1920, 1080], theme: 'light', duration: 32,
  takes: { a: { duration: 10 }, b: { duration: 10 } },
  clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, enter: { kind: 'content', dur: 0.2 } }],
  music: { bpm: 120, root: 62, cues: [], track: { grid } },
  ...over
})

describe('revisión del guion', () => {
  it('un guion limpio no da avisos', () => {
    expect(lintMontage(base({}))).toEqual([])
  })
  it('avisa de zoom excesivo, cortes fuera del pulso, rótulos que se pisan o cortos y transiciones viejas', () => {
    const w = lintMontage(base({
      clips: [{ take: 'a', start: 0, dur: 4, camera: [{ t: 0, zoom: 'fit' }, { t: 1.3, zoom: 2 }] }, { take: 'b', start: 4.1, dur: 4, enter: { kind: 'sunrise', dur: 1 } }],
      titles: [{ start: 2, dur: 4, text: 'Uno', style: 'caption' }, { start: 5, dur: 1, text: 'Dos', style: 'caption' }]
    }))
    expect(w.some((x) => x.includes('zoom'))).toBe(true)
    expect(w.some((x) => x.includes('clave de cámara fuera del pulso'))).toBe(true)
    expect(w.some((x) => x.includes('el cambio cae fuera del pulso'))).toBe(true)
    expect(w.some((x) => x.includes('se pisa'))).toBe(true)
    expect(w.some((x) => x.includes('< 2 compases'))).toBe(true)
    expect(w.some((x) => x.includes('«sunrise»'))).toBe(true)
  })
})

describe('revisión de la cámara y de los rótulos sobre la acción', () => {
  it('avisa de claves desordenadas, movimientos sin respiro, movimiento en el pulso de un fundido y rótulo sobre el cursor', () => {
    const w = lintMontage(
      base({
        clips: [
          { take: 'a', start: 0, dur: 4, camera: [{ t: 0, zoom: 'fit' }, { t: 1, zoom: 1.2 }, { t: 2, zoom: 1.0 }, { t: 1.5, zoom: 1.0 }] },
          { take: 'b', start: 4, dur: 4, enter: { kind: 'content', dur: 0.2 }, camera: [{ t: 0, zoom: 1 }, { t: 1, zoom: 1.2 }] }
        ],
        titles: [{ start: 4, dur: 4, text: 'Uno', style: 'caption' }]
      }),
      { cursorAt: () => [[960, 0.86 * 1080]] }
    )
    expect(w.some((x) => x.includes('desordenadas'))).toBe(true)
    expect(w.some((x) => x.includes('sin respiro'))).toBe(true)
    expect(w.some((x) => x.includes('mismo pulso que un fundido'))).toBe(true)
    expect(w.some((x) => x.includes('tapa la acción'))).toBe(true)
  })
})

describe('cambios de tema', () => {
  it('«theme» de 2 pulsos en pulso fuerte no se marca; en pulso débil, con ventana lenta o como content largo, sí', () => {
    const clips = (kind: 'theme' | 'content', start: number, dur: number) => [{ take: 'a', start: 0, dur: start }, { take: 'b', start, dur: 32 - start, enter: { kind, dur } }]
    expect(lintMontage(base({ clips: clips('theme', 4, 1) }))).toEqual([])
    expect(lintMontage(base({ clips: clips('content', 4, 1) })).some((x) => x.includes("kind:'theme'"))).toBe(true)
    const slow = [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 28, enter: { kind: 'theme' as const, dur: 1, window: 0.5 } }]
    expect(lintMontage(base({ clips: slow })).some((x) => x.includes('velo gris'))).toBe(true)
    expect(lintMontage(base({ clips: clips('theme', 4.5, 1) })).some((x) => x.includes('pulso fuerte'))).toBe(true)
    expect(lintMontage(base({ clips: clips('content', 4.5, 1) })).some((x) => x.includes('fundido de contenido'))).toBe(true)
  })
})
