// El recorrido guiado de una figura etiquetada (`labeled.steps`), la parte pura: qué partes rodea cada paso, la caja de
// la zona de cada parte (para el lazo a pluma) y qué capas hay que encender para que se vean.
import type { FigureLayer, FigurePart, LabeledStep } from '@shared/schema/visual'
import { scaledSize, toView, type ViewTransform } from './viewTransform'

export interface PartBox {
  x: number
  y: number
  width: number
  height: number
}

/** La caja de la zona de una parte en la ventana (polígono, rectángulo o círculo); sin zona, un cuadrado alrededor del punto. */
export function partBox(p: FigurePart, t: ViewTransform, fallback = 13): PartBox {
  const fin = (q: number[] | undefined): q is number[] => !!q && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1])
  const poly = (p.polygon ?? []).filter(fin)
  if (poly.length >= 3) {
    const pts = poly.map((q) => toView(t, q[0], q[1]))
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  const r = p.rect
  if (r && r.length >= 4 && r.every(Number.isFinite)) {
    const a = toView(t, r[0], r[1]), b = toView(t, r[0] + r[2], r[1] + r[3])
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
  }
  const c = toView(t, p.x, p.y)
  const rr = p.r !== undefined && p.r > 0 && Number.isFinite(p.r) ? Math.min(2, p.r) * scaledSize(t).width : fallback
  return { x: c.x - rr, y: c.y - rr, width: rr * 2, height: rr * 2 }
}

/** Las partes que rodea un paso (las que existen y se ven, sin repetir); ninguna: la figura entera. */
export function tourFocus(step: LabeledStep | undefined, parts: FigurePart[]): FigurePart[] {
  if (!step) return []
  const out: FigurePart[] = []
  for (const id of step.parts) {
    const p = parts.find((q) => q.id === id)
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** Las capas que hay que encender para ver las partes de un paso (las que existen y están apagadas). */
export function tourLayers(step: LabeledStep | undefined, all: FigurePart[], layers: FigureLayer[], visible: ReadonlySet<string>): string[] {
  if (!step) return []
  const known = new Set(layers.map((l) => l.id))
  const need = new Set<string>()
  for (const id of step.parts) {
    const layer = all.find((p) => p.id === id)?.layer
    if (layer && known.has(layer) && !visible.has(layer)) need.add(layer)
  }
  return [...need]
}

/** La ventana sin zoom ni desplazamiento: la figura a su tamaño (coordenadas de lo que se amplía). */
export const fittedTransform = (fitted: { width: number; height: number }): ViewTransform => ({ fitted, viewport: fitted, scale: 1, x: 0, y: 0 })
