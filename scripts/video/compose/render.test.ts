import { describe, expect, it } from 'vitest'
import { FINALE_STEPS, PROLOGUE_STEPS, clipViews } from './render.ts'
import type { Montage, TakeMeta } from '../montage/types.ts'
import { ease } from '../montage/ease.ts'

/** Toma sintética: 600 fotogramas, una marca quieta. */
function meta(take: string, mark: [number, number, number, number]): TakeMeta {
  const frames = 600
  return { take, hash: '', fps: 60, frames, viewport: [1440, 900], scale: 2, cursor: Array(frames).fill(null), marks: { el: Array(frames).fill(mark) }, frameHashes: [], timing: { bootMs: 0, setupMs: 0, recordMs: 0, perFrameMs: 0 } }
}
const takes = { a: meta('a', [100, 200, 120, 20]), b: meta('b', [400, 60, 300, 50]) }
const base = (over: Partial<Montage>): Montage => ({ name: 't', fps: 60, size: [1920, 1080], theme: 'light', duration: 10, takes: { a: { duration: 10 }, b: { duration: 10 } }, clips: [], ...over })
const center = (v: ReturnType<typeof clipViews>[number], r: [number, number, number, number]) => [v.x + (r[0] + r[2] / 2) * v.zoom, v.y + (r[1] + r[3] / 2) * v.zoom]

describe('planos y transiciones', () => {
  it('la curva única de la cámara es suave en los extremos y simétrica', () => {
    expect(ease('smooth', 0.5)).toBeCloseTo(0.5)
    expect(ease('smooth', 0.05)).toBeLessThan(0.002)
    expect(ease('smooth', 1)).toBe(1)
  })
  it('«content»: el contenido nuevo funde dentro de la ventana del plano anterior, que sigue debajo aunque haya acabado', () => {
    const m = base({ clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, enter: { kind: 'content', dur: 0.25 } }] })
    const v = clipViews(m, takes, 4.125)
    expect(v.map((x) => x.clip.take)).toEqual(['b', 'a'].reverse())
    expect(v[1].content).toBeCloseTo(0.5, 1)
    expect(v[1].x).toBeCloseTo(v[0].x)
    expect(v[1].zoom).toBeCloseTo(v[0].zoom)
    expect(clipViews(m, takes, 4.3).length).toBe(1)
    // el anterior queda quieto en su último fotograma (para tapar una transición de la app)
    expect(v[0].frame).toBe(Math.round((4 - 1e-6) * 60))
  })
  it('«theme»: la ventana entera cambia en 5 fotogramas en el pulso fuerte; el papel, en 2 pulsos', () => {
    const m = base({ clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, enter: { kind: 'theme', dur: 1.04 } }] })
    const at = (t: number) => clipViews(m, takes, t)
    const win = (t: number) => at(t).find((v) => v.clip.take === 'b')?.content ?? 1
    const paper = (t: number) => at(t).find((v) => v.clip.take === 'b')?.paper ?? 1
    // ventana: arranca en el pulso, entera al 5.º fotograma; nunca dos contenidos a medias más de 4 fotogramas
    expect(win(4)).toBe(0)
    let mixed = 0
    for (let f = 0; f < 62; f++) { const c = win(4 + f / 60); if (c > 0.02 && c < 0.98) mixed++ }
    expect(mixed).toBeLessThanOrEqual(4)
    expect(win(4 + 5 / 60)).toBeGreaterThan(0.99)
    // pasada la ventana, el plano anterior solo cuenta para el papel (no se dibuja)
    const after = at(4.3)
    expect(after.find((v) => v.clip.take === 'a')?.ghost).toBe(true)
    expect(after.find((v) => v.clip.take === 'b')?.content).toBeUndefined()
    // papel: sigue a medias a mitad de los 2 pulsos, sin salto de un fotograma
    expect(paper(4.52)).toBeCloseTo(0.5, 1)
    for (let t = 4; t < 5.04; t += 1 / 60) expect(Math.abs(paper(t + 1 / 60) - paper(t))).toBeLessThan(0.05)
    // acabado el cambio, solo el plano nuevo
    expect(at(5.1).map((v) => v.clip.take)).toEqual(['b'])
    // `window` explícito
    const m2 = base({ clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, enter: { kind: 'theme', dur: 1.04, window: 0.1 } }] })
    expect(clipViews(m2, takes, 4.05).find((v) => v.clip.take === 'b')?.content).toBeCloseTo(0.5, 2)
  })
  it('«match»: el elemento del plano nuevo arranca donde estaba el del anterior y luego vuelve a su cámara', () => {
    const m = base({ clips: [{ take: 'a', start: 0, dur: 4 }, { take: 'b', start: 4, dur: 4, enter: { kind: 'match', dur: 1, from: 'mark:el', to: 'mark:el' } }] })
    const out = clipViews(m, takes, 3.99)[0]
    const at = clipViews(m, takes, 4)[0]
    expect(at.clip.take).toBe('b')
    const [ox, oy] = center(out, takes.a.marks.el[0]!)
    const [ix, iy] = center(at, takes.b.marks.el[0]!)
    expect(ix).toBeCloseTo(ox, 0)
    expect(iy).toBeCloseTo(oy, 0)
    const own = clipViews(base({ clips: [{ take: 'b', start: 4, dur: 4 }] }), takes, 5.2)[0]
    const end = clipViews(m, takes, 5.2)[0]
    expect(end.zoom).toBeCloseTo(own.zoom)
    expect(end.x).toBeCloseTo(own.x)
  })
  it('el final parte de la ventana del último plano aunque ese plano ya haya acabado', () => {
    const m = base({ clips: [{ take: 'a', start: 0, dur: 4 }], finale: { start: 4, dur: 2 } })
    const v = clipViews(m, takes, 4.5)
    expect(v.length).toBe(1)
    expect(v[0].clip.take).toBe('a')
    expect(clipViews(base({ clips: [{ take: 'a', start: 0, dur: 4 }] }), takes, 4.5)).toEqual([])
  })
  it('con banda de rótulos, la ventana descansa encima y nunca baja de ella aunque la cámara se acerque abajo', () => {
    const m = base({ captionBand: 950, clips: [{ take: 'a', start: 0, dur: 4, camera: [{ t: 0, zoom: 'fit' }, { t: 1, zoom: 1.4, focus: [720, 880] }] }] })
    const fit = clipViews(m, takes, 0)[0]
    expect(fit.y).toBeCloseTo(40, 0)
    expect(fit.y + 900 * fit.zoom).toBeLessThanOrEqual(938 + 1e-6)
    const zoomed = clipViews(m, takes, 2)[0]
    expect(zoomed.y + 900 * zoomed.zoom).toBeLessThanOrEqual(938 + 1e-6)
  })
  it('es determinista', () => {
    const m = base({ clips: [{ take: 'a', start: 0, dur: 4, camera: [{ t: 0, zoom: 'fit' }, { t: 2, zoom: 1.3, focus: 'mark:el' }] }] })
    expect(clipViews(m, takes, 1.234)).toEqual(clipViews(m, takes, 1.234))
  })
  it('los gestos icono↔ventana nunca pasan por una losa vacía: lo que entra empieza con lo que sale aún al 30 % o más (y nunca baja todo del 15 %)', () => {
    const span = (q: number, [a, b]: readonly [number, number]) => ease('inOut', Math.min(1, Math.max(0, (q - a) / (b - a))))
    for (let q = 0; q <= 1; q += 0.005) {
      // final: la ventana que se apaga, el arco que se pinta, el icono que funde
      const fin = Math.max(1 - span(q, FINALE_STEPS.content), span(q, FINALE_STEPS.arch), span(q, FINALE_STEPS.icon))
      expect(fin).toBeGreaterThanOrEqual(0.15)
      // prólogo: el icono (canto, sol, tinta) que se va y la app que entra
      const pro = Math.max(1 - span(q, PROLOGUE_STEPS.sun), 1 - span(q, PROLOGUE_STEPS.arch), span(q, PROLOGUE_STEPS.app))
      expect(pro).toBeGreaterThanOrEqual(0.15)
    }
    // el arco empieza a pintarse con la ventana aún por encima del 30 %, y la app entra con el arco aún entero
    const first = (f: (q: number) => number) => {
      let q = 0
      while (q < 1 && f(q) < 0.02) q += 0.001
      return q
    }
    expect(1 - span(first((q) => span(q, FINALE_STEPS.arch)), FINALE_STEPS.content)).toBeGreaterThanOrEqual(0.3)
    expect(1 - span(first((q) => span(q, PROLOGUE_STEPS.app)), PROLOGUE_STEPS.arch)).toBeGreaterThanOrEqual(0.9)
  })
})
