// Figuras etiquetadas (port de LabeledFigureView.swift y FigureCanvas.swift): qué partes se ven, cuándo van números en vez de
// nombres, etiquetas en los márgenes estilo atlas sin solaparse, contornos de las zonas y las prácticas «Señala» y «Arrastra».
// La geometría exacta del clic (polígonos, rectángulos y círculos) es `FigureGeometry` del modelo: la misma que corrige.
import { learnKitSeed, SplitMix64 } from '@engine/learn/seededRandom'
import { FigureGeometry, figurePartNames, type FigureLayer, type FigurePart } from '@shared/schema/visual'
import { estimateMeasure } from './diagramLayout'
import { scaledSize, toView, type ViewTransform } from './viewTransform'

/** Partes visibles: las de las capas apagadas no se muestran ni se preguntan. */
export function activeParts(parts: FigurePart[], layers: FigureLayer[], visible: Set<string>): FigurePart[] {
  const known = new Set(layers.map((l) => l.id))
  return parts.filter((p) => !p.layer || !known.has(p.layer) || visible.has(p.layer))
}

/**
 * Números y leyenda en vez de nombres: si lo pide el bloque, al imprimir con los nombres ocultos, o si hay muchas partes o la
 * figura es estrecha (el chat), donde los nombres junto a los puntos se pisarían.
 */
export function labelsAsNumbers(labels: string, count: number, width: number, printing: boolean): boolean {
  if (labels === 'numbers') return true
  if (printing && labels === 'hidden') return true
  return labels === 'auto' && (count > 14 || (width < 580 && count > 6))
}

/** Ancho del margen de etiquetas (entre 120 y 180 px). */
export const gutterWidth = (w: number): number => Math.min(180, Math.max(120, w * 0.22))

/** Alto aproximado de una etiqueta del margen (una o dos líneas según su largo). */
export const gutterLabelHeight = (name: string, gutter: number): number => (estimateMeasure(name, 12.5, true) + 18 > gutter - 12 ? 40 : 26)

export interface GutterLabel { part: FigurePart; left: boolean; y: number; anchor: { x: number; y: number }; h: number }

/** Etiquetas de los márgenes: cada parte a su lado (izquierda si x < 0,5), de arriba abajo sin solaparse y sin salirse. */
export function placeGutterLabels(parts: FigurePart[], t: ViewTransform, gutter: number): GutterLabel[] {
  const out: GutterLabel[] = []
  const H = t.viewport.height
  const size = scaledSize(t)
  for (const left of [true, false]) {
    const side = parts
      .filter((p) => p.x < 0.5 === left)
      .map((p) => {
        const a = toView(t, p.x, p.y)
        const ly = p.labelY !== undefined && Number.isFinite(p.labelY) ? Math.min(Math.max(p.labelY, 0), 1) * size.height + t.y : a.y
        return { part: p, left, y: ly, anchor: { x: a.x + gutter, y: a.y }, h: gutterLabelHeight(p.name, gutter) }
      })
      .sort((a, b) => a.y - b.y)
    // de arriba abajo sin solaparse; después, de abajo arriba sin salirse
    for (let i = 0; i < side.length; i++) side[i].y = Math.max(side[i].y, i === 0 ? side[i].h / 2 : side[i - 1].y + (side[i - 1].h + side[i].h) / 2 + 2)
    for (let i = side.length - 1; i >= 0; i--) side[i].y = Math.min(side[i].y, i === side.length - 1 ? H - side[i].h / 2 : side[i + 1].y - (side[i + 1].h + side[i].h) / 2 - 2)
    for (const s of side) s.y = Math.max(s.h / 2, s.y)
    out.push(...side)
  }
  return out
}

/** ¿Caben las etiquetas en los márgenes? (demasiadas por lado: números y leyenda). */
export function gutterFits(parts: FigurePart[], gutter: number, figureHeight: number): boolean {
  const need = (left: boolean): number => parts.filter((p) => p.x < 0.5 === left).reduce((s, p) => s + gutterLabelHeight(p.name, gutter) + 2, 0)
  return Math.max(need(true), need(false)) <= figureHeight + 20
}

/** Contorno SVG de la zona de una parte en la ventana (o un círculo pequeño alrededor del punto si no tiene zona). */
export function regionPath(p: FigurePart, t: ViewTransform, fallbackRadius = 13): string {
  const f = (v: number): string => (Math.round(v * 10) / 10).toString()
  if (p.polygon && p.polygon.length >= 3) {
    const pts = p.polygon.filter((q) => q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1])).map((q) => toView(t, q[0], q[1]))
    if (pts.length >= 3) return pts.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('') + 'Z'
  }
  if (p.rect && p.rect.length >= 4 && p.rect.every(Number.isFinite)) {
    const a = toView(t, p.rect[0], p.rect[1]), b = toView(t, p.rect[0] + p.rect[2], p.rect[1] + p.rect[3])
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y), r = Math.min(4, w / 2, h / 2)
    return `M${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}H${f(x + r)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`
  }
  const c = toView(t, p.x, p.y)
  const rr = p.r !== undefined && p.r > 0 && Number.isFinite(p.r) ? Math.min(2, p.r) * scaledSize(t).width : fallbackRadius
  return `M${f(c.x - rr)} ${f(c.y)}A${f(rr)} ${f(rr)} 0 1 0 ${f(c.x + rr)} ${f(c.y)}A${f(rr)} ${f(rr)} 0 1 0 ${f(c.x - rr)} ${f(c.y)}Z`
}

/** La parte que señala un punto de la ventana (o undefined). */
export function partAt(parts: FigurePart[], t: ViewTransform, px: number, py: number, aspect: number): FigurePart | undefined {
  const s = scaledSize(t)
  if (!(s.width > 0)) return undefined
  const x = (px - t.x) / s.width, y = (py - t.y) / s.height
  if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return undefined
  const i = FigureGeometry.hit(x, y, parts, aspect)
  return i === undefined ? undefined : parts[i]
}

/** ¿El nombre colocado vale para la parte? (nombre o alias, sin mayúsculas). */
export const nameMatches = (p: FigurePart, name: string): boolean => figurePartNames(p).some((n) => n.toLowerCase() === name.trim().toLowerCase())

/** ¿Señaló bien? La misma parte, u otra con el mismo nombre (dos «ventrículos»). */
export const locateCorrect = (target: FigurePart, hit: FigurePart | undefined): boolean => hit !== undefined && (hit.id === target.id || hit.name.toLowerCase() === target.name.toLowerCase())

/** Baraja reproducible (la misma figura sale igual en la misma lección) o al azar si no hay semilla. */
export function shuffle<T>(items: readonly T[], seed?: string): T[] {
  if (seed !== undefined) return new SplitMix64(learnKitSeed(seed)).shuffled(items)
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Los nombres para arrastrar (sin repetidos, barajados). */
export function dragChips(parts: FigurePart[], seed: string): string[] {
  const seen = new Set<string>()
  const names = parts.map((p) => p.name).filter((n) => (seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true)))
  return shuffle(names, seed)
}

/** Puntuación de «Arrastra»: cuántas partes tienen su nombre. */
export function dragScore(parts: FigurePart[], placed: Record<string, string>): number {
  return parts.filter((p) => placed[p.id] !== undefined && nameMatches(p, placed[p.id])).length
}
