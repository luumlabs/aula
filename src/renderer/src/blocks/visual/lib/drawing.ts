// Geometría del dibujo vectorial (port de DrawingPainter en StudyUI/Blocks/DrawingView.swift): cada `DrawItem` se convierte en
// caminos SVG, puntas de flecha y etiquetas en coordenadas del lienzo. Lógica pura; los colores siguen siendo nombres.
import type { DrawItem } from '@shared/schema/common'

export interface DrawPath {
  d: string
  /** Nombre del color del trazo (undefined = tinta). */
  stroke?: string
  /** Relleno: nombre del color y opacidad. */
  fill?: { color?: string; opacity: number }
  width: number
  dashed: boolean
  /** Solo relleno (un punto): sin trazo. */
  fillOnly?: boolean
}

export interface DrawLabel { x: number; y: number; text: string; size: number; anchor: 'left' | 'center' | 'right'; color?: string }

export interface DrawShape { paths: DrawPath[]; heads: Array<{ d: string; color?: string }>; labels: DrawLabel[] }

/** Lienzo con medidas razonables (10…4000): con 1e308, negativas o 0 el dibujo no sería finito. */
export function canvasSize(width: number, height: number): { W: number; H: number } {
  const W = Number.isFinite(width) && width >= 10 ? Math.min(width, 4000) : 400
  const H = Number.isFinite(height) && height >= 10 ? Math.min(height, 4000) : 300
  return { W, H }
}

/** Coordenada acotada (NaN → undefined): números gigantes no deben llegar al dibujo. */
const c = (v: number | undefined): number | undefined => (v === undefined || Number.isNaN(v) ? undefined : Math.max(-1e5, Math.min(1e5, v)))
const pos = (v: number | undefined): number | undefined => { const x = c(v); return x === undefined ? undefined : Math.max(0, x) }
const f = (v: number): string => (Math.round(v * 100) / 100).toString()

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

const anchorOf = (a: string | undefined): DrawLabel['anchor'] => {
  const s = (a ?? '').toLowerCase()
  return s.includes('left') ? 'left' : s.includes('right') ? 'right' : 'center'
}

/** Lo que dibuja un elemento (caminos, puntas y etiquetas). */
export function drawItemShape(raw: DrawItem): DrawShape {
  const it = raw
  const out: DrawShape = { paths: [], heads: [], labels: [] }
  const lw = it.width !== undefined && Number.isFinite(it.width) ? Math.min(Math.max(it.width, 0), 40) : 2
  const dashed = it.dashed ?? false
  const size = it.size !== undefined && Number.isFinite(it.size) ? Math.min(Math.max(it.size, 4), 120) : undefined
  const fillOpacity = it.opacity !== undefined && Number.isFinite(it.opacity) ? Math.min(Math.max(it.opacity, 0), 1) : 0.22
  const fill = it.fill !== undefined ? { color: it.fill, opacity: fillOpacity } : undefined
  const text = (s: string | undefined): string | undefined => (s === undefined ? undefined : s.slice(0, 2000))
  const label = text(it.label)
  const stroke = it.stroke
  const base = { stroke, width: lw, dashed }
  switch (it.kind) {
    case 'line': case 'arrow': case 'tick': {
      const ax = c(it.x1) ?? 0, ay = c(it.y1) ?? 0, zx = c(it.x2) ?? 0, zy = c(it.y2) ?? 0
      out.paths.push({ ...base, d: `M${f(ax)} ${f(ay)}L${f(zx)} ${f(zy)}` })
      if (it.kind === 'arrow' && (ax !== zx || ay !== zy)) out.heads.push({ d: arrowHead(ax, ay, zx, zy, 10 + lw), color: stroke })
      if (label) out.labels.push({ x: (ax + zx) / 2, y: (ay + zy) / 2 - 12, text: label, size: size ?? 13, anchor: 'center', color: stroke })
      break
    }
    case 'polyline': case 'polygon': {
      const pts = validPoints(it.points)
      if (pts.length < 2) break
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (it.kind === 'polygon' ? 'Z' : '')
      out.paths.push({ ...base, d, fill: it.kind === 'polygon' ? fill : undefined })
      if (label) {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
        out.labels.push({ x: cx, y: cy, text: label, size: size ?? 13, anchor: 'center' })
      }
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
      out.paths.push({ ...base, d, fill })
      if (label) out.labels.push({ x: x + w / 2, y: y + h / 2, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'circle': case 'dot': {
      const r = it.kind === 'dot' ? (pos(it.r) ?? 4) : (pos(it.r) ?? 20)
      const cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0
      const d = circlePath(cx, cy, r)
      if (it.kind === 'dot') out.paths.push({ d, stroke, width: 0, dashed: false, fill: { color: it.fill ?? stroke, opacity: 1 }, fillOnly: true })
      else out.paths.push({ ...base, d, fill })
      if (label) out.labels.push({ x: cx, y: it.kind === 'dot' ? cy - r - 10 : cy, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'ellipse': {
      const rx = pos(it.rx) ?? 40, ry = pos(it.ry) ?? 25, cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0
      const d = `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
      out.paths.push({ ...base, d, fill })
      if (label) out.labels.push({ x: cx, y: cy, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'arc': case 'angle': {
      const cx = c(it.cx) ?? 0, cy = c(it.cy) ?? 0, r = pos(it.r) ?? 24
      const s = c(it.start) ?? 0, e = c(it.end) ?? 90
      const angle = it.kind === 'angle'
      out.paths.push({ ...base, d: arcPath(cx, cy, r, s, e, angle), fill: angle ? (fill ?? { color: 'accent', opacity: 0.18 }) : undefined })
      if (label) {
        const [lx, ly] = polarPoint(cx, cy, r + 14, (s + e) / 2)
        out.labels.push({ x: lx, y: ly, text: label, size: size ?? 13, anchor: 'center' })
      }
      break
    }
    case 'rightAngle': {
      const cx = c(it.cx) ?? c(it.x) ?? 0, cy = c(it.cy) ?? c(it.y) ?? 0, s = pos(it.r) ?? 12
      out.paths.push({ ...base, d: `M${f(cx + s)} ${f(cy)}L${f(cx + s)} ${f(cy - s)}L${f(cx)} ${f(cy - s)}` })
      break
    }
    case 'curve': {
      const pts = validPoints(it.points)
      if (pts.length < 3) break
      out.paths.push({ ...base, d: `M${f(pts[0][0])} ${f(pts[0][1])}Q${f(pts[1][0])} ${f(pts[1][1])} ${f(pts[2][0])} ${f(pts[2][1])}` })
      if (label) out.labels.push({ x: pts[1][0], y: pts[1][1] - 10, text: label, size: size ?? 13, anchor: 'center' })
      break
    }
    case 'text': {
      const s = text(it.text) ?? label ?? ''
      if (s) out.labels.push({ x: c(it.x) ?? 0, y: c(it.y) ?? 0, text: s, size: size ?? 14, anchor: anchorOf(it.anchor), color: stroke })
      break
    }
  }
  return out
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`
}

/** Las formas de todos los elementos (como mucho 500, como la app Swift). */
export function drawingShapes(items: DrawItem[]): DrawShape[] {
  return items.slice(0, 500).map(drawItemShape)
}
