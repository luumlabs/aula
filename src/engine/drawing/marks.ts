// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (drawMark).
// Marcas de geometría del dibujo: ángulo de tres puntos (con el cuadradito si es recto), cota con flechas, llave, ejes con
// marcas y rejilla de fondo. Son exactas: nunca tiemblan a mano. Coordenadas del lienzo, con y hacia abajo.
import type { DrawItem } from '@shared/schema/common'
import { ANGLE_RADIUS, angleSweep } from '@shared/schema/drawing'
import { arcPoints, densify, fmt as f, smoothPath, smoothPoints, spot, unit, type Pt } from './geometry'
import { labelHeight, labelWidth } from './measure'
import {
  arcPath, arrowHead, clampCoord as c, fillOpacityOf, lineWidth, polarPoint, textSize, validPoints, type DrawPath, type DrawShape, type LabelSide, type ShapeContext
} from './shapes'

// el radio por defecto y el barrido del ángulo de tres puntos están en el esquema: también los usa el guardado para las
// versiones antiguas (el mismo arco con cx, cy, start y end)
export { ANGLE_RADIUS, angleSweep }

/** Paso por defecto de la rejilla. */
export const GRID_STEP = 20
const MAX_TICKS = 100
const MAX_GRID_LINES = 200

const empty = (): DrawShape => ({ paths: [], heads: [], labels: [], outline: [], closed: false })
const pathOf = (pts: readonly Pt[]): string => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')

export function markShape(it: DrawItem, ctx: ShapeContext): DrawShape {
  switch (it.kind) {
    case 'angle': case 'rightAngle': return angleMark(it, ctx)
    case 'measure': return measureMark(it)
    case 'brace': return braceMark(it)
    case 'axes': return axesMark(it)
    case 'grid': return gridMark(it)
    default: return empty()
  }
}

/** Ángulo de tres puntos (brazo, vértice, brazo): arco del menor ángulo o el cuadradito si es recto; la etiqueta en la bisectriz. */
function angleMark(it: DrawItem, ctx: ShapeContext): DrawShape {
  const out = empty()
  const [a, v, b] = validPoints(it.points)
  if (!a || !v || !b) return out
  const lw = lineWidth(it, 1.5)
  const base = { stroke: it.stroke, width: lw, dashed: it.dashed ?? false, crisp: true }
  const wash = { color: it.fill ?? 'accent', opacity: fillOpacityOf(it, 0.16) }
  const { from, sweep } = angleSweep(a, v, b)
  const square = it.kind === 'rightAngle' || Math.abs(Math.abs(sweep) - 90) < 1
  const r = Math.max(2, Math.min(400, c(it.r) ?? ANGLE_RADIUS))
  if (square) {
    // el cuadradito del ángulo recto, en la orientación de los brazos
    const ua = unit(v, a), ub = unit(v, b)
    // rightAngle: r es el lado (12 por defecto, como siempre); en un ángulo de 90°, el lado es 0,7 del radio
    const s = it.kind === 'rightAngle' ? Math.max(2, Math.min(400, c(it.r) ?? 12)) : r * 0.7
    const p1: Pt = [v[0] + ua[0] * s, v[1] + ua[1] * s]
    const p2: Pt = [v[0] + (ua[0] + ub[0]) * s, v[1] + (ua[1] + ub[1]) * s]
    const p3: Pt = [v[0] + ub[0] * s, v[1] + ub[1] * s]
    out.paths.push({ d: pathOf([v, p1, p2, p3]) + 'Z', width: 0, dashed: false, fill: wash, fillOnly: true, crisp: true })
    out.paths.push({ ...base, d: pathOf([p1, p2, p3]), pts: [p1, p2, p3] })
    out.outline = densify([p1, p2, p3], false)
  } else {
    const arc = arcPoints(v[0], v[1], r, from, from + sweep)
    out.paths.push({ d: arcPath(v[0], v[1], r, from, from + sweep, true), width: 0, dashed: false, fill: wash, fillOnly: true, crisp: true })
    out.paths.push({ ...base, d: arcPath(v[0], v[1], r, from, from + sweep), pts: arc })
    out.outline = densify(arc, false)
  }
  out.center = v
  const label = it.label?.slice(0, 2000)
  if (label) {
    // en la bisectriz, por fuera del arco; en ángulos estrechos, más lejos para que quepa entre los brazos
    const size = textSize(it) ?? 13
    const lw2 = labelWidth(label, size, ctx.measure) * ctx.unitsPerPx + 4
    const lh = labelHeight(label, size) * ctx.unitsPerPx + 2
    let reach = (square ? (it.kind === 'rightAngle' ? (c(it.r) ?? 12) : r * 0.7) * Math.SQRT2 : r) + Math.max(lw2, lh) / 2 + 1
    const half = (Math.abs(sweep) * Math.PI) / 360
    if (Math.sin(half) > 0.02) reach = Math.max(reach, (lh / 2 + 2) / Math.sin(half))
    reach = Math.min(reach, r + 80)
    const [lx, ly] = polarPoint(v[0], v[1], reach, from + sweep / 2)
    out.labels.push({ x: lx, y: ly, text: label, size, anchor: 'center', color: it.stroke })
  }
  return out
}

/** El lado preferido para una etiqueta según una dirección (la de fuera de una cota o de una llave). */
function sidesToward(dir: Pt): LabelSide[] {
  const first: LabelSide = Math.abs(dir[1]) >= Math.abs(dir[0]) ? (dir[1] > 0 ? 'bottom' : 'top') : dir[0] > 0 ? 'right' : 'left'
  const opposite: Record<LabelSide, LabelSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const rest = (['right', 'left', 'top', 'bottom'] as LabelSide[]).filter((s) => s !== first && s !== opposite[first])
  return [first, ...rest, opposite[first]]
}

/** Cota: línea con flechas en los dos extremos, separada `offset` a la derecha del sentido 1→2, con líneas de referencia. */
function measureMark(it: DrawItem): DrawShape {
  const out = empty()
  if ([it.x1, it.y1, it.x2, it.y2].some((x) => c(x) === undefined)) return out
  const a: Pt = [c(it.x1)!, c(it.y1)!], b: Pt = [c(it.x2)!, c(it.y2)!]
  const lw = lineWidth(it, 1.4)
  const offset = Math.max(-400, Math.min(400, c(it.offset) ?? 0))
  const u = unit(a, b)
  const side: Pt = [-u[1], u[0]]
  const shifted = (p: Pt, k: number): Pt => [p[0] + side[0] * k, p[1] + side[1] * k]
  if (Math.abs(offset) > 0.5) {
    const dir = Math.sign(offset)
    for (const p of [a, b]) {
      const ext: Pt[] = [shifted(p, dir * 2), shifted(p, offset + dir * 4)]
      out.paths.push({ d: pathOf(ext), stroke: 'gray', width: 1, dashed: false, pts: ext, crisp: true })
    }
  }
  const p: Pt = shifted(a, offset), q: Pt = shifted(b, offset)
  out.paths.push({ d: pathOf([p, q]), stroke: it.stroke, width: lw, dashed: it.dashed ?? false, pts: [p, q], crisp: true })
  if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1) {
    out.heads.push({ d: arrowHead(p[0], p[1], q[0], q[1], 7 + lw), color: it.stroke })
    out.heads.push({ d: arrowHead(q[0], q[1], p[0], p[1], 7 + lw), color: it.stroke })
  }
  out.outline = densify([p, q], false)
  const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  out.center = mid
  out.around = spot(mid)
  const label = it.label?.slice(0, 2000)
  if (label) out.auto = { text: label, size: textSize(it) ?? 13, color: it.stroke, prefer: sidesToward(offset < 0 ? [-side[0], -side[1]] : side) }
  return out
}

/** Llave: curva de nueve puntos de control, a la derecha del sentido 1→2 y algo separada de lo que abarca. */
function braceMark(it: DrawItem): DrawShape {
  const out = empty()
  if ([it.x1, it.y1, it.x2, it.y2].some((x) => c(x) === undefined)) return out
  const a: Pt = [c(it.x1)!, c(it.y1)!], b: Pt = [c(it.x2)!, c(it.y2)!]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < 1) return out
  const depth = Math.max(-200, Math.min(200, c(it.depth) ?? Math.min(14, length * 0.12)))
  const u = unit(a, b)
  const side: Pt = [-u[1], u[0]]
  const at = (along: number, outward: number): Pt => [
    a[0] + u[0] * length * along + side[0] * depth * outward,
    a[1] + u[1] * length * along + side[1] * depth * outward
  ]
  // un pequeño hueco separa la llave de la línea que mide
  const g0 = 0.35
  const ctrl: Pt[] = [at(0, g0), at(0.06, g0 + 0.45), at(0.25, g0 + 0.5), at(0.44, g0 + 0.55), at(0.5, g0 + 1), at(0.56, g0 + 0.55), at(0.75, g0 + 0.5), at(0.94, g0 + 0.45), at(1, g0)]
  const pts = smoothPoints(ctrl, false, 8)
  out.paths.push({ d: smoothPath(ctrl, false), stroke: it.stroke, width: lineWidth(it, 1.5), dashed: it.dashed ?? false, pts, crisp: true })
  out.outline = densify(pts, false)
  const tip = at(0.5, g0 + 1.6)
  out.center = at(0.5, g0 + 1)
  out.around = spot(tip)
  const label = it.label?.slice(0, 2000)
  if (label) out.auto = { text: label, size: textSize(it) ?? 13, color: it.stroke, prefer: sidesToward(depth < 0 ? [-side[0], -side[1]] : side) }
  return out
}

/** Ejes: origen en x,y; el eje x hacia la derecha `w` y el y hacia arriba `h`, con marcas cada `step` y nombres en las puntas. */
function axesMark(it: DrawItem): DrawShape {
  const out = empty()
  const x = c(it.x) ?? c(it.cx), y = c(it.y) ?? c(it.cy)
  if (x === undefined || y === undefined) return out
  const w = Math.max(1, Math.min(4000, Math.abs(c(it.w) ?? 100))), h = Math.max(1, Math.min(4000, Math.abs(c(it.h) ?? 100)))
  const lw = lineWidth(it, 1.5)
  const full = !!it.full
  const xAxis: Pt[] = [[full ? x - w : x, y], [x + w, y]]
  const yAxis: Pt[] = [[x, full ? y + h : y], [x, y - h]]
  const base = { stroke: it.stroke, width: lw, dashed: it.dashed ?? false, crisp: true }
  out.paths.push({ ...base, d: pathOf(xAxis), pts: xAxis }, { ...base, d: pathOf(yAxis), pts: yAxis })
  out.heads.push({ d: arrowHead(xAxis[0][0], y, x + w, y, 8 + lw), color: it.stroke }, { d: arrowHead(x, yAxis[0][1], x, y - h, 8 + lw), color: it.stroke })
  const step = c(it.step) ?? 0
  if (step > 0) {
    // marcas cada `step` (sin llegar a la punta de la flecha), como mucho 100 por eje y sentido
    const tick = 4
    const segs: string[] = []
    const along = (len: number, mark: (k: number) => string): void => {
      for (let k = step, n = 0; k < len - step * 0.4 && n < MAX_TICKS; k += step, n++) segs.push(mark(k))
    }
    along(w, (k) => `M${f(x + k)} ${f(y - tick)}L${f(x + k)} ${f(y + tick)}`)
    along(h, (k) => `M${f(x - tick)} ${f(y - k)}L${f(x + tick)} ${f(y - k)}`)
    if (full) {
      along(w, (k) => `M${f(x - k)} ${f(y - tick)}L${f(x - k)} ${f(y + tick)}`)
      along(h, (k) => `M${f(x - tick)} ${f(y + k)}L${f(x + tick)} ${f(y + k)}`)
    }
    if (segs.length) out.paths.push({ d: segs.join(''), stroke: it.stroke, width: 1, dashed: false, crisp: true, fade: true })
  }
  const size = textSize(it) ?? 13
  const xName = it.xLabel?.slice(0, 200), yName = it.yLabel?.slice(0, 200)
  if (xName) out.labels.push({ x: x + w, y: y + 9 + size * 0.6, text: xName, size, anchor: 'right', color: it.stroke })
  if (yName) out.labels.push({ x: x + 9, y: y - h + size * 0.4, text: yName, size, anchor: 'left', color: it.stroke })
  out.outline = [...densify(xAxis, false), ...densify(yAxis, false)]
  out.center = [x, y]
  out.around = spot([x + w / 2, y])
  const label = it.label?.slice(0, 2000)
  if (label) out.auto = { text: label, size, color: it.stroke, prefer: ['bottom', 'top', 'right', 'left'] }
  return out
}

/** Rejilla de fondo: x,y es la esquina de arriba a la izquierda; líneas cada `step` (como mucho 200 por dirección). */
function gridMark(it: DrawItem): DrawShape {
  const out = empty()
  const x = c(it.x) ?? 0, y = c(it.y) ?? 0
  const w = Math.max(0, Math.min(4000, c(it.w) ?? 0)), h = Math.max(0, Math.min(4000, c(it.h) ?? 0))
  if (!(w > 0 && h > 0)) return out
  const raw = c(it.step) ?? GRID_STEP
  const step = raw > 0 ? raw : GRID_STEP
  const segs: string[] = []
  for (let k = 0; k <= Math.min(MAX_GRID_LINES, Math.floor(w / step + 1e-9)); k++) segs.push(`M${f(x + k * step)} ${f(y)}V${f(y + h)}`)
  for (let k = 0; k <= Math.min(MAX_GRID_LINES, Math.floor(h / step + 1e-9)); k++) segs.push(`M${f(x)} ${f(y + k * step)}H${f(x + w)}`)
  const path: DrawPath = { d: segs.join(''), stroke: it.stroke ?? 'gray', width: lineWidth(it, 0.7), dashed: it.dashed ?? false, crisp: true, fade: true, alpha: 0.18 }
  out.paths.push(path)
  // la rejilla es fondo: las etiquetas pueden ir encima
  out.around = { x, y, w, h }
  out.center = [x + w / 2, y + h / 2]
  return out
}

/** Cuántas líneas tiene una rejilla (para las pruebas y el validador). */
export const gridLineCount = (d: string): number => (d.match(/M/g) ?? []).length
