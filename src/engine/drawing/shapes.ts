// Geometría del dibujo vectorial (port de DrawingPainter en StudyUI/Blocks/DrawingView.swift): cada `DrawItem` se convierte en
// caminos SVG, puntas de flecha y etiquetas en coordenadas del lienzo, más su contorno (para recorridos, solapes y etiquetas
// automáticas). Lógica pura; los colores siguen siendo nombres. Los tipos de siempre dan exactamente los mismos caminos.
import type { DrawItem } from '@shared/schema/common'
import { isPaperColor } from '@shared/schema/drawing'
import { arcPoints, boundsOf, densify, ellipsePoints, fmt as f, roundedRectPoints, smoothPath, smoothPoints, spot, type Box, type Pt } from './geometry'
import { labelHeight, labelWidth, estimateText, type TextMeasure } from './measure'
import { markShape } from './marks'
import { objectShape } from './objects'

export interface DrawPath {
  d: string
  /** Nombre del color del trazo (undefined = tinta). */
  stroke?: string
  /** Relleno: nombre del color, opacidad y si va rayado. */
  fill?: { color?: string; opacity: number; hatch?: boolean }
  width: number
  dashed: boolean
  /** Solo relleno (un punto): sin trazo. */
  fillOnly?: boolean
  /** Los puntos del trazo, para dibujarlo a mano alzada (y si se cierra). */
  pts?: Pt[]
  closed?: boolean
  /** Marca de geometría (ángulos, cotas, ejes, rejilla): exacta, nunca tiembla. */
  crisp?: boolean
  /** Siempre a mano (las partes de un objeto hecho). */
  hand?: boolean
  /** Papel debajo del relleno: tapa lo que queda detrás (rayados y objetos). */
  paper?: boolean
  /** Opacidad del trazo (la rejilla va tenue). */
  alpha?: number
  /** Aparece fundiéndose en lugar de trazarse (la rejilla). */
  fade?: boolean
}

export type LabelAnchor = 'left' | 'center' | 'right'

export interface DrawLabel {
  x: number
  y: number
  text: string
  size: number
  anchor: LabelAnchor
  color?: string
  /** Línea guía de la etiqueta a su elemento [x1, y1, x2, y2] (cuando queda lejos). */
  leader?: [number, number, number, number]
}

export type LabelSide = 'right' | 'left' | 'top' | 'bottom'

/** Etiqueta que se coloca sola, lejos de las líneas (la coloca `drawingLayout`). */
export interface AutoLabel {
  text: string
  size: number
  color?: string
  /** Lados preferidos (por defecto derecha, izquierda, arriba, abajo). */
  prefer?: LabelSide[]
}

export interface DrawShape {
  paths: DrawPath[]
  heads: Array<{ d: string; color?: string }>
  labels: DrawLabel[]
  /** Contorno denso del elemento (vacío en textos y rejillas). */
  outline: Pt[]
  closed: boolean
  /** Lo que rodea la etiqueta automática. */
  around?: Box
  /** Otros sitios para la etiqueta de una línea abierta (sus extremos). */
  alternatives?: Box[]
  /** Centro del elemento (giros y recorridos). */
  center?: Pt
  auto?: AutoLabel
}

/** Cómo medir los textos al construir las formas: la medida (px) y cuántas unidades del lienzo ocupa un px. */
export interface ShapeContext {
  measure: TextMeasure
  unitsPerPx: number
}

export const DEFAULT_SHAPE_CONTEXT: ShapeContext = { measure: estimateText, unitsPerPx: 1 }

/** Lienzo con medidas razonables (10…4000): con 1e308, negativas o 0 el dibujo no sería finito. */
export function canvasSize(width: number, height: number): { W: number; H: number } {
  const W = Number.isFinite(width) && width >= 10 ? Math.min(width, 4000) : 400
  const H = Number.isFinite(height) && height >= 10 ? Math.min(height, 4000) : 300
  return { W, H }
}

/** Coordenada acotada (NaN → undefined): números gigantes no deben llegar al dibujo. */
export const clampCoord = (v: number | undefined): number | undefined => (v === undefined || Number.isNaN(v) ? undefined : Math.max(-1e5, Math.min(1e5, v)))
const c = clampCoord
const pos = (v: number | undefined): number | undefined => { const x = c(v); return x === undefined ? undefined : Math.max(0, x) }

/** Puntos [[x, y], …] válidos (los que tienen menos de dos números se saltan). */
export function validPoints(p: number[][] | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const q of (p ?? []).slice(0, 2000)) {
    if (q.length < 2) continue
    const x = c(q[0]), y = c(q[1])
    if (x !== undefined && y !== undefined) out.push([x, y])
  }
  return out
}

/** Punto de una circunferencia a `deg` grados (0° = derecha, antihorario como en matemáticas; el eje y de la pantalla baja). */
export function polarPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)]
}

/** Arco SVG de `start` a `end` grados (antihorario si end > start). */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number, fromCenter = false): string {
  let sweep = end - start
  if (Math.abs(sweep) >= 360) sweep = sweep > 0 ? 359.99 : -359.99
  const [x0, y0] = polarPoint(cx, cy, r, start)
  const [x1, y1] = polarPoint(cx, cy, r, start + sweep)
  const large = Math.abs(sweep) > 180 ? 1 : 0
  // antihorario en pantalla (y hacia abajo) = sweep-flag 0
  const flag = sweep > 0 ? 0 : 1
  const head = fromCenter ? `M${f(cx)} ${f(cy)}L${f(x0)} ${f(y0)}` : `M${f(x0)} ${f(y0)}`
  return `${head}A${f(r)} ${f(r)} 0 ${large} ${flag} ${f(x1)} ${f(y1)}${fromCenter ? 'Z' : ''}`
}

/** Punta de flecha (triángulo) en `z` llegando desde `a`. */
export function arrowHead(ax: number, ay: number, zx: number, zy: number, length: number, spread = 0.4): string {
  const ang = Math.atan2(zy - ay, zx - ax)
  const p1 = [zx - length * Math.cos(ang - spread), zy - length * Math.sin(ang - spread)]
  const p2 = [zx - length * Math.cos(ang + spread), zy - length * Math.sin(ang + spread)]
  return `M${f(zx)} ${f(zy)}L${f(p1[0])} ${f(p1[1])}L${f(p2[0])} ${f(p2[1])}Z`
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`
}

const anchorOf = (a: string | undefined): LabelAnchor => {
  const s = (a ?? '').toLowerCase()
  return s.includes('left') ? 'left' : s.includes('right') ? 'right' : 'center'
}

/** ¿La etiqueta se coloca sola? (`anchor: "auto"`). */
const wantsAuto = (it: DrawItem): boolean => (it.anchor ?? '').toLowerCase() === 'auto'

/** Grosor de línea acotado (2 por defecto). */
export const lineWidth = (it: DrawItem, def = 2): number => (it.width !== undefined && Number.isFinite(it.width) ? Math.min(Math.max(it.width, 0), 40) : def)

/** Tamaño de letra acotado (o undefined). */
export const textSize = (it: DrawItem): number | undefined => (it.size !== undefined && Number.isFinite(it.size) ? Math.min(Math.max(it.size, 4), 120) : undefined)

/** Opacidad de un relleno: la pedida (acotada) o, sin ella, `def`; el papel, sin opacidad pedida, tapa del todo. */
export function fillOpacityOf(it: DrawItem, def: number): number {
  if (it.opacity !== undefined && Number.isFinite(it.opacity)) return Math.min(Math.max(it.opacity, 0), 1)
  return isPaperColor(it.fill) ? 1 : def
}

/** Relleno de un elemento (con su rayado). */
export function fillOf(it: DrawItem, def = 0.22): DrawPath['fill'] {
  if (it.fill === undefined) return undefined
  const opacity = fillOpacityOf(it, def)
  return it.fillStyle === 'hatch' ? { color: it.fill, opacity: it.opacity !== undefined ? opacity : 0.75, hatch: true } : { color: it.fill, opacity }
}

const clip = (s: string | undefined): string | undefined => (s === undefined ? undefined : s.slice(0, 2000))

/** Lo que dibuja un elemento (caminos, puntas y etiquetas). */
export function drawItemShape(raw: DrawItem, ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): DrawShape {
  const it = raw
  const out: DrawShape = { paths: [], heads: [], labels: [], outline: [], closed: false }
  const lw = lineWidth(it)
  const dashed = it.dashed ?? false
  const size = textSize(it)
  const fill = fillOf(it)
  const label = clip(it.label)
  const stroke = it.stroke
  const base = { stroke, width: lw, dashed }
  const hatchPaper = fill?.hatch ? { paper: true } : {}
  // etiqueta automática (lejos de las líneas) en lugar de la posición fija de siempre
  const auto = label && wantsAuto(it) ? { text: label, size: size ?? 13, color: undefined } : undefined
  switch (it.kind) {
    case 'line': case 'arrow': case 'tick': {
      // sin ninguna coordenada no se dibuja nada (antes salía un punto en 0,0)
      if ([it.x1, it.y1, it.x2, it.y2].every((v) => v === undefined)) break
      const ax = c(it.x1) ?? 0, ay = c(it.y1) ?? 0, zx = c(it.x2) ?? 0, zy = c(it.y2) ?? 0
      const pts: Pt[] = [[ax, ay], [zx, zy]]
      out.paths.push({ ...base, d: `M${f(ax)} ${f(ay)}L${f(zx)} ${f(zy)}`, pts })
      if (it.kind === 'arrow' && (ax !== zx || ay !== zy)) out.heads.push({ d: arrowHead(ax, ay, zx, zy, 10 + lw), color: stroke })
      out.outline = densify(pts, false)
      out.center = [(ax + zx) / 2, (ay + zy) / 2]
      out.around = spot(out.center)
      out.alternatives = [spot(pts[0]), spot(pts[1])]
      if (auto) out.auto = { ...auto, color: stroke }
      else if (label) out.labels.push({ x: (ax + zx) / 2, y: (ay + zy) / 2 - 12, text: label, size: size ?? 13, anchor: 'center', color: stroke })
      break
    }
    case 'polyline': case 'polygon': {
      const pts = validPoints(it.points)
      if (pts.length < 2) break
      const closed = it.kind === 'polygon'
      const smooth = !!it.smooth && pts.length >= 3
      const d = smooth ? smoothPath(pts, closed) : pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (closed ? 'Z' : '')
      const line = smooth ? smoothPoints(pts, closed) : pts
      out.paths.push({ ...base, d, fill: closed ? fill : undefined, pts: line, closed, ...(closed ? hatchPaper : {}) })
      out.outline = densify(line, closed)
      out.closed = closed
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      out.center = [cx, cy]
      if (closed) out.around = boundsOf(line)
      else {
        const mid = out.outline[Math.floor(out.outline.length / 2)]
        out.around = spot(mid)
        out.alternatives = [spot(pts[0]), spot(pts[pts.length - 1])]
      }
      if (auto) out.auto = auto
      else if (label) out.labels.push({ x: cx, y: cy, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'rect': {
      let x = c(it.x) ?? 0, y = c(it.y) ?? 0, w = c(it.w) ?? 50, h = c(it.h) ?? 30
      if (w < 0) { x += w; w = -w }
      if (h < 0) { y += h; h = -h }
      // radio de esquina como mucho la mitad del lado más corto
      const r = Math.min(pos(it.r) ?? 0, Math.min(w, h) / 2)
      const d = r > 0
        ? `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
        : `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`
      // el contorno con sus esquinas redondeadas (lo siguen la línea a mano, los recorridos y las etiquetas)
      const corners: Pt[] = r > 0 ? roundedRectPoints(x, y, w, h, r) : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      out.paths.push({ ...base, d, fill, pts: corners, closed: true, ...hatchPaper })
      out.outline = densify(corners, true)
      out.closed = true
      out.around = { x, y, w, h }
      out.center = [x + w / 2, y + h / 2]
      if (auto) out.auto = auto
      else if (label) out.labels.push({ x: x + w / 2, y: y + h / 2, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'circle': case 'dot': {
      const r = it.kind === 'dot' ? (pos(it.r) ?? 4) : (pos(it.r) ?? 20)
      const cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0
      const d = circlePath(cx, cy, r)
      const ring = ellipsePoints(cx, cy, r, r)
      if (it.kind === 'dot') out.paths.push({ d, stroke, width: 0, dashed: false, fill: { color: it.fill ?? stroke, opacity: 1 }, fillOnly: true, pts: ring, closed: true })
      else out.paths.push({ ...base, d, fill, pts: ring, closed: true, ...hatchPaper })
      out.outline = densify(ring, true)
      out.closed = it.kind === 'circle'
      out.around = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }
      out.center = [cx, cy]
      if (auto) out.auto = auto
      else if (label) out.labels.push({ x: cx, y: it.kind === 'dot' ? cy - r - 10 : cy, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'ellipse': {
      const rx = pos(it.rx) ?? 40, ry = pos(it.ry) ?? 25, cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0
      const d = `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
      const ring = ellipsePoints(cx, cy, rx, ry)
      out.paths.push({ ...base, d, fill, pts: ring, closed: true, ...hatchPaper })
      out.outline = densify(ring, true)
      out.closed = true
      out.around = { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }
      out.center = [cx, cy]
      if (auto) out.auto = auto
      else if (label) out.labels.push({ x: cx, y: cy, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'arc': case 'angle': {
      // ángulo de tres puntos (brazo, vértice, brazo): lo resuelven las marcas; los puntos mandan sobre cx, cy, start y end
      // (al guardar se escriben también estos, calculados de los puntos, para las versiones antiguas)
      if (it.kind === 'angle' && validPoints(it.points).length >= 3) return markShape(it, ctx)
      const cx = c(it.cx) ?? 0, cy = c(it.cy) ?? 0, r = pos(it.r) ?? 24
      const s = c(it.start) ?? 0, e = c(it.end) ?? 90
      const angle = it.kind === 'angle'
      const arc = arcPoints(cx, cy, r, s, e)
      out.paths.push({ ...base, d: arcPath(cx, cy, r, s, e, angle), fill: angle ? (fill ?? { color: 'accent', opacity: 0.18 }) : undefined, pts: angle ? [[cx, cy], ...arc] : arc, closed: angle, crisp: angle })
      out.outline = densify(arc, false)
      out.center = [cx, cy]
      const [mx, my] = polarPoint(cx, cy, r, (s + e) / 2)
      out.around = spot([mx, my])
      if (auto) out.auto = auto
      else if (label) {
        const [lx, ly] = polarPoint(cx, cy, r + 14, (s + e) / 2)
        out.labels.push({ x: lx, y: ly, text: label, size: size ?? 13, anchor: 'center' })
      }
      break
    }
    case 'rightAngle': {
      if (validPoints(it.points).length >= 3) return markShape(it, ctx)
      const cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0, s = pos(it.r) ?? 12
      const pts: Pt[] = [[cx + s, cy], [cx + s, cy - s], [cx, cy - s]]
      out.paths.push({ ...base, d: `M${f(cx + s)} ${f(cy)}L${f(cx + s)} ${f(cy - s)}L${f(cx)} ${f(cy - s)}`, pts, crisp: true })
      out.outline = densify(pts, false)
      out.center = [cx + s / 2, cy - s / 2]
      break
    }
    case 'curve': {
      const pts = validPoints(it.points)
      if (pts.length < 3) break
      out.paths.push({ ...base, d: `M${f(pts[0][0])} ${f(pts[0][1])}Q${f(pts[1][0])} ${f(pts[1][1])} ${f(pts[2][0])} ${f(pts[2][1])}`, pts: quadPoints(pts[0], pts[1], pts[2]) })
      out.outline = densify(quadPoints(pts[0], pts[1], pts[2]), false)
      out.center = quadPoints(pts[0], pts[1], pts[2])[8]
      out.around = spot(out.center)
      out.alternatives = [spot(pts[0]), spot(pts[2])]
      if (auto) out.auto = auto
      else if (label) out.labels.push({ x: pts[1][0], y: pts[1][1] - 10, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'text': {
      const s = clip(it.text) ?? label ?? ''
      const x = c(it.x) ?? 0, y = c(it.y) ?? 0
      if (s) out.labels.push({ x, y, text: s, size: size ?? 14, anchor: anchorOf(it.anchor), color: stroke })
      out.center = [x, y]
      break
    }
    case 'measure': case 'brace': case 'axes': case 'grid':
      return markShape(it, ctx)
    case 'object':
      return objectShape(it, ctx)
  }
  return out
}

/** Muestras de una Bézier cuadrática (17 puntos). */
function quadPoints(a: Pt, q: Pt, b: Pt): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t
    out.push([u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1]])
  }
  return out
}

/** Caja de una etiqueta ya colocada (unidades del lienzo). */
export function labelBox(l: DrawLabel, ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): Box {
  const w = labelWidth(l.text, l.size, ctx.measure) * ctx.unitsPerPx
  const h = labelHeight(l.text, l.size) * ctx.unitsPerPx
  const x = l.anchor === 'left' ? l.x : l.anchor === 'right' ? l.x - w : l.x - w / 2
  return { x, y: l.y - h / 2, w, h }
}

/** Las formas de todos los elementos (como mucho 500, como la app Swift). Las etiquetas automáticas quedan sin colocar. */
export function drawingShapes(items: DrawItem[], ctx: ShapeContext = DEFAULT_SHAPE_CONTEXT): DrawShape[] {
  return items.slice(0, 500).map((it) => drawItemShape(it, ctx))
}
