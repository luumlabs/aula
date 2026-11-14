// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: viewer/src/steps.ts (drawHighlights: rodear en
// rojo lo que importa en cada paso). Aquí, con la pluma de Aula: algo más de una vuelta a mano, en ladrillo, que no cierra
// donde empezó (como cuando se rodea una fecha en un calendario de papel). Puro.
import { handLoop, type Pt } from '@renderer/design/paint/brush'
import { inkStroke, type InkDrawing } from '@renderer/design/paint/drawings'
import { createNoise } from '@renderer/design/paint/noise'
import { rngFrom, seedOf } from '@renderer/design/paint/random'

const cache = new Map<string, InkDrawing>()

/** Un número por cada conjunto destacado distinto (cada vez que se entra en un paso hay uno nuevo). */
const focusIds = new WeakMap<object, number>()
let focusCount = 0

/**
 * Clave de dibujo (`drawKey` de Ink) del rodeado del elemento `item` mientras dura el mismo destacado (`focus`): se traza a
 * mano al entrar en el paso y, si después lo rodeado se mueve o cambia de tamaño (un giro, un deslizador, el reloj), se
 * redibuja al instante con la misma semilla en lugar de esconderse y volver a trazarse. Al volver a entrar, se traza de nuevo.
 */
export function loopDrawKey(scope: string, item: number, focus: object): string {
  let id = focusIds.get(focus)
  if (id === undefined) {
    id = ++focusCount
    focusIds.set(focus, id)
  }
  return `${scope}:loop:${item}:${id}`
}

/** Rodeado a mano de `w`×`h` px (la línea cabe dentro de la caja). Mismo tamaño y semilla = el mismo trazo. */
export function loopInk(w: number, h: number, seed: string, line = 2.2): InkDrawing {
  const W = Math.max(16, Math.round(w / 4) * 4), H = Math.max(16, Math.round(h / 4) * 4)
  const key = `${seed}:${W}x${H}:${line}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = seedOf(seed)
  const rng = rngFrom(s)
  const noise = createNoise(s ^ 0x5bd1e995)
  const path: Pt[] = handLoop(W / 2, H / 2, W / 2 - line * 1.6, H / 2 - line * 1.6, rng, 1.1)
  // carga al posarse, aprieta abajo y se suelta al cerrar
  const pressure = (t: number): number => (0.55 + 0.45 * Math.min(1, t / 0.1)) * (1 + 0.18 * Math.sin(t * Math.PI * 2.2 + 2)) * (t > 0.84 ? Math.max(0.3, 1 - ((t - 0.84) / 0.16) * 0.7) : 1)
  const stroke = inkStroke(path, { tool: 'pen', width: line, pressure, dryness: 0.3, speed: 560, minMs: 360, maxMs: 640 }, noise, rng)
  const drawing: InkDrawing = { w: W, h: H, strokes: [stroke], ms: stroke.ms }
  if (cache.size > 200) cache.clear()
  cache.set(key, drawing)
  return drawing
}
