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

describe('versión corta', () => {
  it('la pincelada dura entre 1 pulso y 1 compás', () => {
    const clips = (dur: number) => [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 28, enter: { kind: 'brush' as const, dur } }]
    expect(lintMontage(base({ clips: clips(1) }))).toEqual([])
    expect(lintMontage(base({ clips: clips(0.25) })).some((x) => x.includes('pincelada'))).toBe(true)
    expect(lintMontage(base({ clips: clips(3) })).some((x) => x.includes('pincelada'))).toBe(true)
  })
  it('adornos con mesura: en el pulso, ≤ 2 por compás y una salpicadura por compás', () => {
    const ok = lintMontage(base({ paint: [{ t: 2, kind: 'splash', at: [0.5, 0.5] }, { t: 3, kind: 'underline', at: [0.5, 0.5] }] }))
    expect(ok).toEqual([])
    const many = lintMontage(base({ paint: [{ t: 2, kind: 'splash', at: [0.5, 0.5] }, { t: 2.5, kind: 'splash', at: [0.5, 0.5] }, { t: 3.25, kind: 'ring', at: [0.5, 0.5] }] }))
    expect(many.some((x) => x.includes('demasiados adornos'))).toBe(true)
    expect(many.some((x) => x.includes('más de una salpicadura'))).toBe(true)
    expect(many.some((x) => x.includes('fuera del pulso'))).toBe(true)
  })
  it('minTitle cambia la duración mínima de los rótulos', () => {
    const titles = [{ start: 2, dur: 1.5, text: 'Hi', style: 'paint' as const }]
    expect(lintMontage(base({ titles })).some((x) => x.includes('dura'))).toBe(true)
    expect(lintMontage(base({ titles, minTitle: 1.2 })).some((x) => x.includes('dura'))).toBe(false)
  })
  it('con bandas se permite más zoom, y en la tarjeta final los rótulos pueden convivir', () => {
    const cam = [{ t: 0, zoom: 1.6 }]
    const clips = [{ take: 'a', start: 0, dur: 32, camera: cam }]
    expect(lintMontage(base({ size: [1080, 1920], bands: { top: 400, bottom: 400, fill: true }, clips: [{ take: 'a', start: 0, dur: 32, camera: [{ t: 0, zoom: 2.4 }] }] })).some((x) => x.includes('zoom'))).toBe(false)
    expect(lintMontage(base({ clips })).some((x) => x.includes('zoom'))).toBe(true)
    const titles = [{ start: 26, dur: 6, text: 'Free', style: 'paint' as const }, { start: 28, dur: 4, text: 'github', style: 'paint' as const }]
    expect(lintMontage(base({ titles, finale: { start: 24, dur: 8 } })).some((x) => x.includes('se pisa'))).toBe(false)
    expect(lintMontage(base({ titles })).some((x) => x.includes('se pisa'))).toBe(true)
  })
  it('V5: avisa de un titular keynote sobre un primer plano', () => {
    const clips = [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, layout: { kind: 'detail' as const } }]
    const w = lintMontage(base({ clips, titles: [{ start: 4.5, dur: 4.5, text: 'Hi', style: 'keynote' as const, side: 'left' as const }] }))
    expect(w.some((x) => x.includes('primer plano'))).toBe(true)
  })
})
