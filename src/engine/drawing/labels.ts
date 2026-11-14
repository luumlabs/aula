// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (placeLabel y composeDraw).
// Etiquetas que se colocan solas: dentro de su forma si cabe; si no, en el sitio más libre alrededor (o en los extremos de
// una línea abierta), con una línea guía cuando queda lejos. Se colocan una vez, con el dibujo en reposo; el movimiento solo
// las desplaza con su elemento. Lógica pura.
import type { DrawItem } from '@shared/schema/common'
import { labelHeight, labelWidth } from './measure'
import { overlaps, type Box, type Pt } from './geometry'
import { DEFAULT_SHAPE_CONTEXT, drawingShapes, labelBox, type DrawLabel, type DrawShape, type LabelSide, type ShapeContext } from './shapes'

export type Leader = [number, number, number, number]

interface Candidate { box: Box; leader?: Leader; rank: number }

const SIDES: LabelSide[] = ['right', 'left', 'top', 'bottom']

/**
 * Dónde va una etiqueta de `size` (unidades del lienzo): candidatos dentro de la forma cerrada y a cada lado de lo que la
 * rodea (y de sus otros sitios), a dos distancias; gana el de menor coste (orden de preferencia + 1000 por pisar otra
 * etiqueta + 6 por cada punto de línea debajo + 0,15 por unidad fuera del lienzo).
 */
export function placeLabel(size: { w: number; h: number }, shape: DrawShape, taken: readonly Box[], outline: readonly Pt[], canvas: { w: number; h: number }, gaps: [number, number] = [8, 34], prefer: readonly LabelSide[] = SIDES): { box: Box; leader?: Leader } {
  const candidates: Candidate[] = []
  const b = shape.around ?? { x: 0, y: 0, w: 0, h: 0 }
  if (shape.closed && size.w + 10 < b.w && size.h + 6 < b.h) candidates.push({ box: { x: b.x + (b.w - size.w) / 2, y: b.y + (b.h - size.h) / 2, ...size }, rank: 0 })
  const order = [...prefer, ...SIDES.filter((s) => !prefer.includes(s))]
  ;[b, ...(shape.alternatives ?? [])].forEach((a, spotIndex) => {
    gaps.forEach((gap, ring) => {
      const midX = a.x + a.w / 2, midY = a.y + a.h / 2
      const sides: Record<LabelSide, [Box, Leader]> = {
        right: [{ x: a.x + a.w + gap, y: midY - size.h / 2, ...size }, [a.x + a.w + gap - 3, midY, a.x + a.w + 2, midY]],
        left: [{ x: a.x - gap - size.w, y: midY - size.h / 2, ...size }, [a.x - gap + 3, midY, a.x - 2, midY]],
        top: [{ x: midX - size.w / 2, y: a.y - gap - size.h, ...size }, [midX, a.y - gap + 2, midX, a.y - 2]],
        bottom: [{ x: midX - size.w / 2, y: a.y + a.h + gap, ...size }, [midX, a.y + a.h + gap - 2, midX, a.y + a.h + 2]]
      }
      order.forEach((side, k) => {
        const [box, leader] = sides[side]
        const rank = 1 + k * 0.1 + spotIndex * 2 + ring * 4
        candidates.push(ring ? { box, leader, rank } : { box, rank })
      })
    })
  })
  const cost = (cand: Candidate): number => {
    const { box } = cand
    let total = cand.rank
    for (const other of taken) if (overlaps(box, other)) total += 1000
    for (const [x, y] of outline) if (x > box.x - 3 && x < box.x + box.w + 3 && y > box.y - 3 && y < box.y + box.h + 3) total += 6
    // salirse un poco del lienzo es mejor que cruzar una línea
    const outside = Math.max(0, -box.x) + Math.max(0, -box.y) + Math.max(0, box.x + box.w - canvas.w) + Math.max(0, box.y + box.h - canvas.h)
    return total + outside * 0.15
  }
  let best = candidates[0]
  let bestCost = cost(best)
  for (const cand of candidates.slice(1)) {
    const k = cost(cand)
    if (k < bestCost) { best = cand; bestCost = k }
  }
  return best.leader ? { box: best.box, leader: best.leader } : { box: best.box }
}

/** Las formas con sus etiquetas automáticas ya colocadas (los textos a mano y las etiquetas fijas se respetan primero). */
export function placeAutoLabels(shapes: readonly DrawShape[], W: number, H: number, ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): DrawShape[] {
  if (!shapes.some((s) => s.auto)) return shapes.slice()
  const taken: Box[] = []
  for (const s of shapes) for (const l of s.labels) taken.push(labelBox(l, ctx))
  const outline: Pt[] = shapes.flatMap((s) => s.outline)
  const k = ctx.unitsPerPx
  const gaps: [number, number] = [6 * k + 2, 28 * k + 4]
  return shapes.map((s) => {
    if (!s.auto) return s
    const size = { w: labelWidth(s.auto.text, s.auto.size, ctx.measure) * k + 4 * k, h: labelHeight(s.auto.text, s.auto.size) * k }
    const { box, leader } = placeLabel(size, s, taken, outline, { w: W, h: H }, gaps, s.auto.prefer)
    taken.push(box)
    const label: DrawLabel = { x: box.x + box.w / 2, y: box.y + box.h / 2, text: s.auto.text, size: s.auto.size, anchor: 'center', color: s.auto.color }
    if (leader) label.leader = leader
    return { ...s, labels: [...s.labels, label] }
  })
}

/** El orden de pintado: la rejilla siempre al fondo, el resto como se escribió. */
export function paintOrder(items: readonly DrawItem[]): number[] {
  const idx = items.slice(0, 500).map((_, i) => i)
  return [...idx.filter((i) => items[i].kind === 'grid'), ...idx.filter((i) => items[i].kind !== 'grid')]
}

/** Las formas de un dibujo listas para pintar: geometría de cada elemento y etiquetas automáticas colocadas en reposo. */
export function drawingLayout(items: DrawItem[], W: number, H: number, ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): DrawShape[] {
  return placeAutoLabels(drawingShapes(items, ctx), W, H, ctx)
}
