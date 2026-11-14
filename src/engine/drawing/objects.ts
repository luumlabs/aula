// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/objects.ts (los dibujos de los
// objetos) y src/figures/draw.ts (objectParts, placePart y la rama de objetos de drawShape).
// Objetos hechos para los dibujos (una persona, un coche, un árbol, el sol…), dibujados con las mismas formas que todo lo
// demás sobre un marco de −50 a 50 alrededor de su centro (y hacia abajo), con la tinta y la paleta de Aula: rellenos como
// aguadas sobre papel (tapan lo que queda detrás) y la línea siempre a mano. Se escalan, se giran y se voltean.
import type { DrawItem } from '@shared/schema/common'
import { isPaperColor } from '@shared/schema/drawing'
import { boundsOf, ellipsePoints, arcPoints, roundedRectPoints, type Pt } from './geometry'
import { clampCoord as c, drawItemShape, type DrawShape, type ShapeContext } from './shapes'

/** Una parte de un objeto; `tint`: toma el relleno que se elija para el objeto (`fill`). */
export type ObjectPart = DrawItem & { tint?: boolean }

const round = (n: number): number => Math.round(n * 10) / 10
const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [round(Math.cos(a) * r), round(Math.sin(a) * r)]
}

const circle = (cx: number, cy: number, r: number, more: Partial<ObjectPart> = {}): ObjectPart => ({ kind: 'circle', cx, cy, r, ...more })
const rect = (x: number, y: number, w: number, h: number, more: Partial<ObjectPart> = {}): ObjectPart => ({ kind: 'rect', x, y, w, h, ...more })
const line = (pts: number[][], more: Partial<ObjectPart> = {}): ObjectPart =>
  pts.length === 2 ? { kind: 'line', x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], ...more } : { kind: 'polyline', points: pts, ...more }
const shape = (pts: number[][], more: Partial<ObjectPart> = {}): ObjectPart => ({ kind: 'polygon', points: pts, ...more })
const blob = (pts: number[][], more: Partial<ObjectPart> = {}): ObjectPart => ({ kind: 'polygon', points: pts, smooth: true, ...more })
const curve = (pts: number[][], more: Partial<ObjectPart> = {}): ObjectPart => ({ kind: 'polyline', points: pts, smooth: true, ...more })
const text = (x: number, y: number, s: string, size = 12): ObjectPart => ({ kind: 'text', x, y, text: s, size })

function gear(): ObjectPart[] {
  const points: number[][] = []
  for (let i = 0; i < 8; i++) {
    const a = i * 45
    points.push(polar(34, a - 15), polar(46, a - 9), polar(46, a + 9), polar(34, a + 15))
  }
  return [shape(points, { fill: 'gray', tint: true }), circle(0, 0, 13, { fill: 'paper' })]
}

function sun(): ObjectPart[] {
  const rays = Array.from({ length: 8 }, (_, i) => line([polar(30, i * 45), polar(46, i * 45)], { width: 2 }))
  return [circle(0, 0, 23, { fill: 'amber', tint: true }), ...rays]
}

function spring(): ObjectPart[] {
  // muelle horizontal: un tramo recto, ocho espiras en zigzag y otro tramo recto
  const pts: number[][] = [[-50, 0], [-38, 0]]
  for (let i = 0; i < 16; i++) pts.push([-34 + i * 4.5, i % 2 ? 10 : -10])
  pts.push([38, 0], [50, 0])
  return [line(pts, { width: 2 })]
}

/** Los objetos, por nombre (en inglés, como los escribe la IA). */
export const OBJECTS: Readonly<Record<string, readonly ObjectPart[]>> = {
  person: [
    circle(0, -36, 12, { fill: 'paper' }),
    line([[0, -24], [0, 14]]),
    line([[0, -12], [-22, 4]]),
    line([[0, -12], [22, 4]]),
    line([[0, 14], [-16, 48]]),
    line([[0, 14], [16, 48]])
  ],
  tree: [
    rect(-7, 8, 14, 40, { fill: 'brown' }),
    blob([[0, -48], [30, -30], [37, 0], [18, 18], [-18, 18], [-37, 0], [-30, -30]], { fill: 'green', tint: true })
  ],
  cloud: [blob([[-44, 12], [-34, -12], [-14, -16], [0, -32], [22, -20], [32, -8], [47, 4], [36, 20], [-30, 20]], { fill: 'paper', tint: true })],
  house: [
    rect(-32, -4, 64, 50, { fill: 'paper' }),
    shape([[-42, -2], [0, -42], [42, -2]], { fill: 'terracotta', tint: true }),
    rect(-9, 18, 18, 28, { fill: 'brown' }),
    rect(13, 6, 12, 12, { fill: 'blue' })
  ],
  car: [
    shape([[-48, 12], [-48, -6], [-30, -8], [-14, -26], [16, -26], [30, -8], [48, -4], [48, 12]], { fill: 'terracotta', tint: true }),
    shape([[-24, -9], [-12, -21], [0, -21], [0, -9]], { fill: 'blue' }),
    shape([[5, -9], [5, -21], [15, -21], [25, -9]], { fill: 'blue' }),
    circle(-26, 14, 11, { fill: 'paper' }),
    circle(26, 14, 11, { fill: 'paper' })
  ],
  bike: [
    circle(-30, 18, 22),
    circle(30, 18, 22),
    line([[-30, 18], [-8, -16], [20, -16], [-2, 18], [-30, 18]]),
    line([[20, -16], [30, 18]]),
    line([[-8, -16], [-12, -26]]),
    line([[-20, -26], [-4, -26]]),
    line([[20, -16], [18, -30], [28, -32]])
  ],
  gear: gear(),
  sun: sun(),
  bulb: [
    circle(0, -14, 28, { fill: 'amber', tint: true }),
    rect(-11, 14, 22, 20, { fill: 'gray' }),
    line([[-11, 21], [11, 21]]),
    line([[-11, 27], [11, 27]]),
    curve([[-9, -8], [-4, -20], [0, -8], [4, -20], [9, -8]])
  ],
  battery: [
    rect(-42, -21, 76, 42, { fill: 'paper' }),
    rect(34, -9, 8, 18, { fill: 'ink' }),
    rect(-37, -16, 42, 32, { fill: 'green', tint: true })
  ],
  laptop: [
    rect(-34, -32, 68, 48, { fill: 'paper' }),
    rect(-28, -26, 56, 36, { fill: 'blue', tint: true }),
    shape([[-42, 16], [42, 16], [50, 28], [-50, 28]], { fill: 'gray' })
  ],
  phone: [rect(-20, -44, 40, 88, { fill: 'paper', r: 6 }), rect(-15, -35, 30, 62, { fill: 'blue', tint: true }), circle(0, 36, 3)],
  server: [
    rect(-34, -44, 68, 26, { fill: 'paper' }),
    rect(-34, -13, 68, 26, { fill: 'paper' }),
    rect(-34, 18, 68, 26, { fill: 'paper' }),
    circle(22, -31, 3, { fill: 'green', tint: true }),
    circle(22, 0, 3, { fill: 'green', tint: true }),
    circle(22, 31, 3, { fill: 'green', tint: true }),
    line([[-26, -31], [4, -31]]),
    line([[-26, 0], [4, 0]]),
    line([[-26, 31], [4, 31]])
  ],
  book: [shape([[-46, -30], [0, -20], [0, 34], [-46, 24]], { fill: 'paper', tint: true }), shape([[46, -30], [0, -20], [0, 34], [46, 24]], { fill: 'paper', tint: true })],
  heart: [blob([[0, 44], [-40, 4], [-36, -30], [-12, -36], [0, -18], [12, -36], [36, -30], [40, 4]], { fill: 'terracotta', tint: true })],
  drop: [blob([[0, -46], [20, -10], [26, 18], [0, 42], [-26, 18], [-20, -10]], { fill: 'blue', tint: true })],
  flame: [
    blob([[0, -48], [20, -20], [30, 10], [14, 42], [-14, 42], [-30, 10], [-12, -12]], { fill: 'terracotta', tint: true }),
    blob([[0, -6], [12, 14], [6, 38], [-6, 38], [-12, 14]], { fill: 'amber' })
  ],
  mountain: [shape([[-50, 40], [-14, -30], [8, 6], [24, -16], [50, 40]], { fill: 'gray', tint: true })],
  flask: [
    shape([[-10, -44], [10, -44], [10, -12], [36, 40], [-36, 40], [-10, -12]], { fill: 'paper' }),
    shape([[-22, 12], [22, 12], [36, 40], [-36, 40]], { fill: 'green', tint: true })
  ],
  rocket: [
    shape([[-14, 20], [-32, 42], [-14, 36]], { fill: 'terracotta', tint: true }),
    shape([[14, 20], [32, 42], [14, 36]], { fill: 'terracotta', tint: true }),
    blob([[0, -48], [15, -20], [15, 36], [-15, 36], [-15, -20]], { fill: 'paper' }),
    circle(0, -10, 7, { fill: 'blue' })
  ],
  lock: [
    { kind: 'arc', cx: 0, cy: -6, r: 18, start: 0, end: 180, width: 3 },
    line([[-18, -6], [-18, 4]], { width: 3 }),
    line([[18, -6], [18, 4]], { width: 3 }),
    rect(-27, 2, 54, 40, { fill: 'amber', tint: true })
  ],
  key: [
    circle(-28, 0, 16, { fill: 'amber', tint: true }),
    line([[-12, 0], [44, 0]], { width: 2.5 }),
    line([[32, 0], [32, 12]], { width: 2.5 }),
    line([[42, 0], [42, 10]], { width: 2.5 })
  ],
  // ─── Para las lecciones (dibujados para Aula en el mismo marco) ───
  ground: [rect(-50, 0, 100, 9, { fill: 'gray', fillStyle: 'hatch', width: 0, tint: true }), line([[-50, 0], [50, 0]], { width: 2 })],
  wall: [rect(-9, -50, 9, 100, { fill: 'gray', fillStyle: 'hatch', width: 0, tint: true }), line([[0, -50], [0, 50]], { width: 2 })],
  block: [rect(-30, -22, 60, 44, { fill: 'blue', tint: true, r: 2 })],
  ball: [circle(0, 0, 30, { fill: 'terracotta', tint: true }), { kind: 'arc', cx: 0, cy: 0, r: 21, start: 100, end: 160, width: 1.4 }],
  pulley: [
    line([[0, -48], [0, 0]], { width: 2 }),
    line([[-12, -48], [12, -48]], { width: 2.5 }),
    circle(0, 0, 30, { fill: 'paper' }),
    circle(0, 0, 22),
    circle(0, 0, 5, { fill: 'ink' })
  ],
  magnet: [
    rect(-44, -13, 44, 26, { fill: 'terracotta', tint: true }),
    rect(0, -13, 44, 26, { fill: 'blue' }),
    text(-22, 0, 'N'),
    text(22, 0, 'S')
  ],
  beaker: [
    rect(-28, 4, 56, 40, { fill: 'blue', tint: true, width: 0 }),
    line([[-34, -44], [-28, -40], [-28, 44], [28, 44], [28, -40], [34, -44]]),
    line([[-28, -20], [-18, -20]], { width: 1.2 }),
    line([[-28, 4], [-18, 4]], { width: 1.2 }),
    line([[-28, 28], [-18, 28]], { width: 1.2 })
  ],
  thermometer: [
    rect(-7, -48, 14, 80, { fill: 'paper', r: 7 }),
    circle(0, 36, 12, { fill: 'terracotta', tint: true }),
    rect(-2.5, -20, 5, 50, { fill: 'terracotta', tint: true, width: 0, opacity: 0.75 }),
    line([[7, -36], [13, -36]], { width: 1.2 }),
    line([[7, -22], [13, -22]], { width: 1.2 }),
    line([[7, -8], [13, -8]], { width: 1.2 }),
    line([[7, 6], [13, 6]], { width: 1.2 })
  ],
  planet: [
    circle(0, 0, 30, { fill: 'blue', tint: true }),
    curve([[-28, -8], [-8, -3], [12, -9], [28, -6]], { width: 1.3 }),
    circle(11, 13, 5, { width: 1.2 })
  ],
  spring: spring()
}

export const OBJECT_NAMES: readonly string[] = Object.keys(OBJECTS)

/** ¿Es el nombre de un objeto? */
export const isObjectName = (name: string | undefined): boolean => !!name && Object.hasOwn(OBJECTS, name.trim().toLowerCase())

/** Tamaño por defecto de un objeto (ancho del marco de 100, en unidades del lienzo). */
export const OBJECT_SIZE = 60

interface Placement { x: number; y: number; k: number; deg: number; flip: boolean }

/** Lleva una parte al lienzo: escala, giro (antihorario) y volteo; lo girado o volteado pasa a polígonos y polilíneas. */
export function placePart(part: ObjectPart, at: Placement): ObjectPart {
  const { x, y, k, deg, flip } = at
  const { tint: _tint, ...p } = part
  if (!deg && !flip) {
    switch (p.kind) {
      case 'circle': return { ...p, cx: x + (p.cx ?? 0) * k, cy: y + (p.cy ?? 0) * k, r: (p.r ?? 0) * k }
      case 'ellipse': return { ...p, cx: x + (p.cx ?? 0) * k, cy: y + (p.cy ?? 0) * k, rx: (p.rx ?? 0) * k, ry: (p.ry ?? 0) * k }
      case 'rect': return { ...p, x: x + (p.x ?? 0) * k, y: y + (p.y ?? 0) * k, w: (p.w ?? 0) * k, h: (p.h ?? 0) * k, r: p.r !== undefined ? p.r * k : undefined }
      case 'arc': return { ...p, cx: x + (p.cx ?? 0) * k, cy: y + (p.cy ?? 0) * k, r: (p.r ?? 0) * k }
      case 'line': return { ...p, x1: x + (p.x1 ?? 0) * k, y1: y + (p.y1 ?? 0) * k, x2: x + (p.x2 ?? 0) * k, y2: y + (p.y2 ?? 0) * k }
      case 'text': return { ...p, x: x + (p.x ?? 0) * k, y: y + (p.y ?? 0) * k }
      default: return { ...p, points: (p.points ?? []).map(([px, py]) => [x + px * k, y + py * k]) }
    }
  }
  const a = (deg * Math.PI) / 180
  const map = ([px, py]: readonly number[]): number[] => {
    const fx = (flip ? -px : px) * k, fy = py * k
    return [x + fx * Math.cos(a) + fy * Math.sin(a), y - fx * Math.sin(a) + fy * Math.cos(a)]
  }
  const poly = (pts: readonly Pt[], closed: boolean): ObjectPart => {
    const { cx: _cx, cy: _cy, r: _r, rx: _rx, ry: _ry, x: _x, y: _y, w: _w, h: _h, start: _s, end: _e, ...rest } = p
    return { ...rest, kind: closed ? 'polygon' : 'polyline', points: pts.map(map) }
  }
  switch (p.kind) {
    case 'circle': return poly(ellipsePoints(p.cx ?? 0, p.cy ?? 0, p.r ?? 0, p.r ?? 0), true)
    case 'ellipse': return poly(ellipsePoints(p.cx ?? 0, p.cy ?? 0, p.rx ?? 0, p.ry ?? 0), true)
    case 'rect': {
      const x0 = p.x ?? 0, y0 = p.y ?? 0, w = p.w ?? 0, h = p.h ?? 0
      // girado o volteado conserva sus esquinas redondeadas (el tubo del termómetro, el móvil)
      const r = Math.min(Math.max(p.r ?? 0, 0), Math.min(Math.abs(w), Math.abs(h)) / 2)
      return poly(r > 0 ? roundedRectPoints(x0, y0, w, h, r) : [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], true)
    }
    case 'arc': return poly(arcPoints(p.cx ?? 0, p.cy ?? 0, p.r ?? 0, p.start ?? 0, p.end ?? 90), false)
    case 'line': {
      const [x1, y1] = map([p.x1 ?? 0, p.y1 ?? 0]), [x2, y2] = map([p.x2 ?? 0, p.y2 ?? 0])
      return { ...p, x1, y1, x2, y2 }
    }
    case 'text': {
      const [tx, ty] = map([p.x ?? 0, p.y ?? 0])
      return { ...p, x: tx, y: ty }
    }
    default: return { ...p, points: (p.points ?? []).map(map) }
  }
}

/** Opacidad por defecto del relleno de una parte: papel y tinta tapan; los colores son aguadas. */
const partOpacity = (fill: string | undefined): number => (isPaperColor(fill) ? 1 : fill === 'ink' ? 0.85 : 0.4)

/**
 * Lo que dibuja un objeto: sus partes en el lienzo (x, y = centro; `w`, o `h`, = tamaño del marco de 100). Un trazo elegido
 * colorea todas las partes; un relleno elegido, solo las que llevan el color del objeto (`tint`).
 */
export function objectShape(it: DrawItem, ctx: ShapeContext): DrawShape {
  const out: DrawShape = { paths: [], heads: [], labels: [], outline: [], closed: false }
  const parts = it.object ? OBJECTS[it.object.trim().toLowerCase()] : undefined
  if (!parts || !Object.hasOwn(OBJECTS, (it.object ?? '').trim().toLowerCase())) return out
  const sizeOf = (v: number | undefined): number | undefined => { const s = c(v); return s !== undefined && s > 0 ? Math.min(s, 4000) : undefined }
  const size = sizeOf(it.w) ?? sizeOf(it.h) ?? OBJECT_SIZE
  const x = c(it.x) ?? c(it.cx) ?? 0, y = c(it.y) ?? c(it.cy) ?? 0
  const rot = c(it.rotate)
  const at: Placement = { x, y, k: size / 100, deg: rot !== undefined ? rot : 0, flip: !!it.flip }
  for (const part of parts) {
    const placed = placePart(part, at)
    const fill = part.tint && it.fill ? it.fill : placed.fill
    const styled: DrawItem = {
      ...placed,
      stroke: it.stroke ?? placed.stroke,
      fill,
      opacity: placed.fill === undefined ? undefined : part.tint && it.fill ? (it.opacity ?? partOpacity(fill)) : (placed.opacity ?? partOpacity(fill)),
      width: placed.width ?? it.width ?? 1.8,
      dashed: it.dashed || placed.dashed,
      fillStyle: placed.fillStyle ?? (part.tint && it.fillStyle ? it.fillStyle : undefined)
    }
    const s = drawItemShape(styled, ctx)
    for (const p of s.paths) out.paths.push({ ...p, hand: true, paper: !!p.fill })
    out.heads.push(...s.heads)
    out.labels.push(...s.labels.map((l) => ({ ...l, color: l.color ?? it.stroke })))
    out.outline.push(...s.outline)
  }
  const box = boundsOf(out.outline) ?? { x: x - size / 2, y: y - size / 2, w: size, h: size }
  out.around = box
  out.center = [x, y]
  const label = it.label?.slice(0, 2000)
  if (label) out.auto = { text: label, size: it.size !== undefined && Number.isFinite(it.size) ? Math.min(Math.max(it.size, 4), 120) : 13, color: undefined, prefer: ['bottom', 'right', 'left', 'top'] }
  return out
}
