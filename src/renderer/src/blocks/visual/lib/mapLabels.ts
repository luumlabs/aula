// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (los 8 sitios que prueba
// cada nombre y los obstáculos: puntos y rutas).
// Nombres del mapa que no se pisan: cada nombre (de una chincheta, una ruta o un país) prueba unos sitios alrededor de su
// punto y se queda con el primero libre (sin salirse ni pisar otro nombre, una chincheta o un control) por el que pase menos
// tinta de ruta. Si no cabe en ninguno, se oculta (su nombre sigue en la ficha y en la etiqueta accesible). Lógica pura.
import { boxAt, intersects, type Box, type Candidate } from '../../plot/labels'

export type { Box, Candidate }

export interface LabelItem {
  /** Sitios en orden de preferencia. */
  candidates: Candidate[]
  w: number
  h: number
}

/** Los 8 sitios de una chincheta (punta en x, y; cabeza 28 px por encima): a la derecha de la cabeza primero. */
export function pinCandidates(x: number, y: number): Candidate[] {
  return [
    { x: x + 14, y: y - 15, ax: 0, ay: 0.5 },
    { x: x - 14, y: y - 15, ax: 1, ay: 0.5 },
    { x, y: y - 32, ax: 0.5, ay: 1 },
    { x, y: y + 5, ax: 0.5, ay: 0 },
    { x: x + 8, y: y - 32, ax: 0, ay: 1 },
    { x: x + 8, y: y + 5, ax: 0, ay: 0 },
    { x: x - 8, y: y - 32, ax: 1, ay: 1 },
    { x: x - 8, y: y + 5, ax: 1, ay: 0 }
  ]
}

/** Sitios alrededor de un punto con un hueco `gap` (debajo, encima, derecha, izquierda y diagonales). */
export function pointCandidates(x: number, y: number, gap = 8): Candidate[] {
  return [
    { x, y: y + gap, ax: 0.5, ay: 0 },
    { x, y: y - gap, ax: 0.5, ay: 1 },
    { x: x + gap, y, ax: 0, ay: 0.5 },
    { x: x - gap, y, ax: 1, ay: 0.5 },
    { x: x + gap * 0.7, y: y + gap * 0.7, ax: 0, ay: 0 },
    { x: x - gap * 0.7, y: y + gap * 0.7, ax: 1, ay: 0 },
    { x: x + gap * 0.7, y: y - gap * 0.7, ax: 0, ay: 1 },
    { x: x - gap * 0.7, y: y - gap * 0.7, ax: 1, ay: 1 }
  ]
}

/** El cuerpo de una chincheta (no se le pone un nombre encima). */
export const pinBody = (x: number, y: number): Box => ({ x: x - 11, y: y - 29, w: 22, h: 31 })

const contains = (outer: Box, b: Box): boolean => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h

/**
 * Coloca los nombres en orden (el primero, el más importante). `obstacles`: lo que ningún nombre puede pisar; `ink`: puntos
 * que mejor no pisar (rutas). Devuelve el sitio elegido de cada uno o null si no cabe en ninguno.
 */
export function placeMapLabels(items: LabelItem[], obstacles: Box[], ink: Array<[number, number]>, frame: Box): Array<Candidate | null> {
  const placed: Box[] = [...obstacles]
  const pad = (b: Box): Box => ({ x: b.x - 2, y: b.y - 1, w: b.w + 4, h: b.h + 2 })
  return items.map((it) => {
    let best: Candidate | null = null
    let bestInk = Infinity
    for (const c of it.candidates) {
      const b = boxAt(c, it.w, it.h)
      if (!contains(frame, b)) continue
      const pb = pad(b)
      if (placed.some((p) => intersects(p, pb))) continue
      let n = 0
      for (const [x, y] of ink) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) n++
      if (n < bestInk) {
        best = c
        bestInk = n
        if (n === 0) break
      }
    }
    if (best) placed.push(pad(boxAt(best, it.w, it.h)))
    return best
  })
}

/**
 * En papel no se puede pulsar una chincheta para leer su nombre: las que lo tienen pero no cupo en el mapa (`placed` dice
 * null) llevan un número (1, 2…, en el orden de los marcadores) que la lista de debajo explica.
 */
export function unnamedPinNumbers(titles: readonly string[], placed: ReadonlyMap<number, Candidate | null>): Map<number, number> {
  const out = new Map<number, number>()
  titles.forEach((title, i) => {
    if (title && placed.get(i) === null) out.set(i, out.size + 1)
  })
  return out
}
