// V6 · personajes que se dibujan a pincel, en la página del compositor: cada fotograma, el plan de trazos dice cuánto
// lleva cada pieza y el pintor de la app la pinta a medio hacer (la punta avanza con su presión y se seca al final; las
// aguadas barren su mancha). Al acabar, la línea hierve (otro dibujo cada 1/8 s) o el personaje cobra vida con su
// historia. Los dibujos ya acabados se guardan (solo se pinta lo que cambia).
import { aliveBoard, paintAlive, paintSubject, subjectOf, type Subject } from './drawn-kit.ts'
import { DRAW_DUR, drawPlan, drawProgress, drawingLocal, type DrawPlan } from '../montage/draw.ts'
import type { Drawing } from '../montage/types.ts'
import type { Painting } from '../../../src/renderer/src/design/pixel/brush/painter.ts'

export interface DrawnKit {
  /** El dibujo en el instante t (a su tamaño, fondo transparente) y su opacidad, o null si no se ve. */
  frame(d: Drawing, t: number, dark: boolean): { image: OffscreenCanvas; alpha: number } | null
}

/** Hervor de la línea al acabar: dibujos por segundo. */
const BOIL_FPS = 8
const FADE = 0.3

function toCanvas(p: Painting, into?: OffscreenCanvas): OffscreenCanvas {
  const c = into && into.width === p.width ? into : new OffscreenCanvas(p.width, p.height)
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0)
  return c
}

export function drawnKit(): DrawnKit {
  const plans = new Map<string, DrawPlan>()
  const still = new Map<string, OffscreenCanvas>()
  const live = new Map<string, OffscreenCanvas>()
  const planOf = (d: Drawing, s: Subject) => {
    const key = `${d.who}:${d.tone ?? ''}:${d.dur ?? DRAW_DUR}`
    let p = plans.get(key)
    if (!p) plans.set(key, (p = drawPlan(s.pieces, d.dur ?? DRAW_DUR)))
    return p
  }
  return {
    frame(d, t, dark) {
      const local = drawingLocal(d, t)
      if (local < 0 || (d.until !== undefined && t >= d.until)) return null
      const alpha = d.until !== undefined ? Math.min(1, Math.max(0, (d.until - t) / FADE)) : 1
      const s = subjectOf(d.who, d.tone)
      const W = Math.max(16, Math.round(d.size))
      const dur = d.dur ?? DRAW_DUR
      if (local < dur) {
        // a medio dibujar: se pinta cada fotograma (en su propio lienzo, reutilizado)
        const id = `${d.who}:${d.tone ?? ''}:${d.t}:${W}`
        const image = toCanvas(paintSubject(s, W, dark, 0, drawProgress(planOf(d, s), local)), live.get(id))
        live.set(id, image)
        return { image, alpha }
      }
      const since = local - dur
      const after = d.after ?? 'boil'
      const variant = after === 'still' ? 0 : Math.floor(since * BOIL_FPS) % 3
      // cobra vida: su historia «hover» en bucle (tras un respiro), con el mismo hervor
      const board = after === 'alive' && since > 0.4 ? aliveBoard(s, since - 0.4) : null
      const key = `${d.who}:${d.tone ?? ''}:${W}:${dark}:${variant}:${board ? s.anim.clips.hover!.frames.findIndex((f) => f.px === board) : -1}`
      let image = still.get(key)
      if (!image) {
        image = toCanvas(board ? paintAlive(s, board, W, dark, variant) : paintSubject(s, W, dark, variant))
        still.set(key, image)
      }
      return { image, alpha }
    }
  }
}
