// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/chart.ts (nombres junto a los
// puntos de una dispersión, también en papel).
// Nombres junto a los puntos de una dispersión: cada nombre prueba cuatro sitios alrededor de su punto (derecha, izquierda,
// encima, debajo) sin pisar otro nombre ni ningún punto; si no cabe, se queda solo en la lectura al pasar el ratón. Los
// destacados se colocan primero. Lógica pura.
import { boxAt, intersects, type Box, type Candidate } from '../plot/labels'
import { isNumericLabel, type TextWidth } from './scale'

export interface LabelledPoint {
  x: number
  y: number
  label?: string
  highlight?: boolean
}

export interface PlacedLabel {
  /** Índice del punto. */
  index: number
  text: string
  at: Candidate
  w: number
  h: number
}

/** Los cuatro sitios alrededor de un punto de radio r. */
export function scatterLabelCandidates(x: number, y: number, r = 5): Candidate[] {
  const g = r + 3
  return [
    { x: x + g, y, ax: 0, ay: 0.5 },
    { x: x - g, y, ax: 1, ay: 0.5 },
    { x, y: y - g, ax: 0.5, ay: 1 },
    { x, y: y + g, ax: 0.5, ay: 0 }
  ]
}

/** ¿Lleva nombre que escribir? (un nombre de verdad, no un número) */
export const namedPoint = (p: LabelledPoint): boolean => !!p.label && p.label.trim() !== '' && !isNumericLabel(p.label)

/**
 * Coloca los nombres de los puntos dentro de `frame`. Si hay más de `max` puntos con nombre no se escribe ninguno (salvo
 * con `always`, en papel: allí no se puede pasar el ratón). Lo que no cabe se omite.
 */
export function placeScatterLabels(points: LabelledPoint[], measure: TextWidth, frame: Box, opts: { max?: number; always?: boolean; size?: number } = {}): PlacedLabel[] {
  const named = points.map((p, index) => ({ p, index })).filter(({ p }) => namedPoint(p))
  if (!named.length || (!opts.always && named.length > (opts.max ?? 30))) return []
  const h = Math.round((opts.size ?? 11.5) * 1.35)
  // los puntos son tinta que ningún nombre pisa
  const placed: Box[] = points.map((p) => ({ x: p.x - 5.5, y: p.y - 5.5, w: 11, h: 11 }))
  const inside = (b: Box): boolean => b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h
  const order = [...named].sort((a, b) => Number(!!b.p.highlight) - Number(!!a.p.highlight))
  const out: PlacedLabel[] = []
  for (const { p, index } of order) {
    const text = p.label!.trim()
    const w = measure(text) + 2
    const at = scatterLabelCandidates(p.x, p.y, p.highlight ? 6.5 : 5).find((c) => {
      const b = boxAt(c, w, h)
      return inside(b) && !placed.some((q) => intersects(q, b))
    })
    if (!at) continue
    placed.push(boxAt(at, w, h))
    out.push({ index, text, at, w, h })
  }
  return out.sort((a, b) => a.index - b.index)
}
