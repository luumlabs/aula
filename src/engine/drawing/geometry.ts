// Geometría básica del dibujo vectorial: puntos, cajas, contornos densos, el punto a una fracción de un recorrido y curvas
// suaves por varios puntos. Lógica pura (sin DOM): la usan la interfaz, el validador y las pruebas.

/** Punto [x, y] en coordenadas del lienzo (y hacia abajo). */
export type Pt = [number, number]

export interface Box { x: number; y: number; w: number; h: number }

/** Número para un camino SVG (dos decimales, sin ceros de más): el mismo formato de siempre. */
export const fmt = (v: number): string => (Math.round(v * 100) / 100).toString()

/** Vector unitario de `a` hacia `b` (un segmento nulo apunta a la derecha). */
export function unit(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  return len > 1e-9 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0]
}

/** ¿Se tocan dos cajas? */
export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Área compartida por dos cajas. */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Caja que encierra unos puntos (undefined sin puntos). */
export function boundsOf(points: readonly Pt[]): Box | undefined {
  if (!points.length) return undefined
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of points) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Caja de un punto (lo que rodea una etiqueta cuando no hay forma: el extremo de una línea). */
export const spot = (p: Pt, w = 4, h = 4): Box => ({ x: p[0] - w / 2, y: p[1] - h / 2, w, h })

export const boxCenter = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2]

// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (densify, pointAlong).
/** Puntos cada pocas unidades por una polilínea (para saber qué cruza una etiqueta y para recorrer el contorno). */
export function densify(points: readonly Pt[], closed: boolean, step = 5): Pt[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]])
  const out: Pt[] = []
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const steps = Math.max(1, Math.min(400, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)))
    for (let k = 0; k < steps; k++) out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps])
  }
  out.push(closed ? [points[0][0], points[0][1]] : [points[points.length - 1][0], points[points.length - 1][1]])
  return out
}

/** Longitud de una polilínea. */
export function polylineLength(points: readonly Pt[]): number {
  let s = 0
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return s
}

/**
 * El punto a una fracción del recorrido de una polilínea y la dirección de la marcha allí (grados, antihorario como en
 * matemáticas: 0° = derecha, 90° = arriba en pantalla). Un recorrido cerrado da la vuelta (1,25 = 0,25); uno abierto se acota.
 * Los tramos de longitud cero se saltan.
 */
export function pointAlong(outline: readonly Pt[], fraction: number, closed: boolean): { at: Pt; deg: number } {
  if (!outline.length) return { at: [0, 0], deg: 0 }
  if (outline.length < 2) return { at: [outline[0][0], outline[0][1]], deg: 0 }
  const f = !Number.isFinite(fraction) ? 0 : closed ? fraction - Math.floor(fraction) : Math.max(0, Math.min(1, fraction))
  const lengths: number[] = []
  for (let i = 1; i < outline.length; i++) lengths.push(Math.hypot(outline[i][0] - outline[i - 1][0], outline[i][1] - outline[i - 1][1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  const headingOf = (i: number): number => {
    // la dirección del tramo con longitud más cercano (un tramo nulo no tiene dirección)
    for (let d = 0; d < lengths.length; d++) {
      for (const j of [i + d, i - d]) {
        if (j >= 0 && j < lengths.length && lengths[j] > 1e-9) {
          const a = outline[j], b = outline[j + 1]
          return (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI + 0
        }
      }
    }
    return 0
  }
  if (total <= 1e-9) return { at: [outline[0][0], outline[0][1]], deg: 0 }
  let remaining = total * f
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] > 1e-9 ? Math.min(1, remaining / lengths[i]) : 0
      const a = outline[i], b = outline[i + 1]
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], deg: headingOf(i) }
    }
    remaining -= lengths[i]
  }
  const last = outline[outline.length - 1]
  return { at: [last[0], last[1]], deg: headingOf(lengths.length - 1) }
}

/** Puntos de una elipse, antihorario desde 0° (la derecha), como los arcos de Aula. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const steps = Math.max(24, Math.min(240, Math.ceil(Math.max(rx, ry) / 2)))
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2
    return [cx + Math.cos(a) * rx, cy - Math.sin(a) * ry] as Pt
  })
}

/** Puntos de un arco de `from` a `to` grados (antihorario si to > from). */
export function arcPoints(cx: number, cy: number, r: number, from: number, to: number): Pt[] {
  const steps = Math.max(6, Math.min(240, Math.ceil(Math.abs(to - from) / 6)))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    return [cx + Math.cos(a) * r, cy - Math.sin(a) * r] as Pt
  })
}

/**
 * Contorno de un rectángulo con las esquinas redondeadas (radio `r` > 0, como mucho la mitad del lado menor): desde la
 * esquina de arriba a la izquierda y en el sentido de las agujas del reloj en pantalla, como el de esquinas vivas.
 */
export function roundedRectPoints(x: number, y: number, w: number, h: number, r: number): Pt[] {
  return [
    ...arcPoints(x + r, y + r, r, 180, 90),
    ...arcPoints(x + w - r, y + r, r, 90, 0),
    ...arcPoints(x + w - r, y + h - r, r, 0, -90),
    ...arcPoints(x + r, y + h - r, r, -90, -180)
  ]
}

// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/draw.ts (spline). Aquí con
// Béziers cúbicas exactas en lugar de muestras.
/** Tramos Bézier cúbicos de una spline de Catmull-Rom uniforme por los puntos (abierta: extremos fijos; cerrada: da la vuelta). */
export function splineSegments(points: readonly Pt[], closed: boolean): Array<[Pt, Pt, Pt, Pt]> {
  const n = points.length
  if (n < 2) return []
  const at = (i: number): Pt => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))])
  const out: Array<[Pt, Pt, Pt, Pt]> = []
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    out.push([p1, c1, c2, p2])
  }
  return out
}

/** Camino SVG suave por los puntos (curva abierta o mancha cerrada). */
export function smoothPath(points: readonly Pt[], closed: boolean): string {
  const segs = splineSegments(points, closed)
  if (!segs.length) return ''
  const p = (q: Pt): string => `${fmt(q[0])} ${fmt(q[1])}`
  return `M${p(segs[0][0])}` + segs.map(([, c1, c2, b]) => `C${p(c1)} ${p(c2)} ${p(b)}`).join('') + (closed ? 'Z' : '')
}

/** Punto de una Bézier cúbica en t. */
export function bezierAt([a, b, c, d]: readonly [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]]
}

/** Muestras de la curva suave (para contornos, temblor a mano y recorridos). */
export function smoothPoints(points: readonly Pt[], closed: boolean, perSegment = 12): Pt[] {
  const segs = splineSegments(points, closed)
  if (!segs.length) return points.map((p) => [p[0], p[1]])
  const out: Pt[] = []
  for (const s of segs) for (let k = 0; k < perSegment; k++) out.push(bezierAt(s, k / perSegment))
  if (!closed) out.push([segs[segs.length - 1][3][0], segs[segs.length - 1][3][1]])
  return out
}

/** Punto girado `deg` grados (antihorario en pantalla) alrededor de `pivot`. */
export function rotatePoint(p: Pt, deg: number, pivot: Pt): Pt {
  if (!deg) return [p[0], p[1]]
  const a = (deg * Math.PI) / 180
  const dx = p[0] - pivot[0], dy = p[1] - pivot[1]
  // y hacia abajo: antihorario en pantalla es (cos, sin) con el signo de y cambiado
  return [pivot[0] + dx * Math.cos(a) + dy * Math.sin(a), pivot[1] - dx * Math.sin(a) + dy * Math.cos(a)]
}
