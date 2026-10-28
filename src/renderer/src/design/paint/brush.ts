// El trazo a mano (puro, sin DOM): un camino se convierte en la silueta de una pincelada de grosor variable — se posa
// (principio romo), corre con la presión de la mano, tiembla un poco y se levanta afilándose. También los caminos que dibuja
// una mano: una línea casi recta, un círculo que no cierra del todo, el contorno de una losa.
import type { Noise } from './noise'
import { gauss, type Rng } from './random'

export interface Pt {
  x: number
  y: number
}

/** Remuestrea una polilínea a pasos iguales de `step` px (la pincelada necesita puntos regulares). */
export function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    let d = step - carry
    while (d <= len) {
      const t = d / len
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      d += step
    }
    carry = len - (d - step)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > step * 0.3) out.push(last)
  return out
}

export function pathLength(pts: Pt[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return s
}

export interface BrushOpts {
  /** Grosor máximo (px). */
  width: number
  /** Presión a lo largo del trazo (t de 0 a 1 → 0…1). */
  pressure: (t: number) => number
  /** Temblor de la mano: cuánto se aparta el trazo (px) y cada cuánto cambia (px). */
  tremor: number
  tremorScale: number
  /** Variación del grosor (0–1). */
  jitter: number
  /** Paso del remuestreo (en las mismas unidades que el camino; 1 px por defecto). */
  step?: number
}

/** Presión de una pincelada: se posa con el pincel cargado (romo), corre y se levanta afilándose. */
export function pressureProfile(land = 0.62, attack = 0.06, liftAt = 0.62, tip = 0.12): (t: number) => number {
  return (t) => {
    const a = land + (1 - land) * Math.min(1, t / attack)
    const l = t > liftAt ? Math.max(tip, 1 - ((t - liftAt) / (1 - liftAt)) ** 1.5 * (1 - tip)) : 1
    return a * l
  }
}

/** El eje de la pincelada, punto a punto: dónde pasa (con el temblor), hacia dónde mira y cuánto mide de ancho. */
export interface Spine {
  c: Pt[]
  n: Pt[]
  w: number[]
}

/**
 * La silueta de la pincelada (un polígono cerrado): borde izquierdo de ida, punta, borde derecho de vuelta y el remate
 * redondo donde se posó el pincel; y su eje (para las cerdas). `noise` da el temblor y la variación del grosor.
 */
export function brushOutline(path: Pt[], o: BrushOpts, noise: Noise): { outline: Pt[]; spine: Spine } {
  const step = o.step ?? 1
  const pts = resample(path, step)
  const n = pts.length
  if (n < 2) return { outline: [], spine: { c: [], n: [], w: [] } }
  const left: Pt[] = []
  const right: Pt[] = []
  const widths: number[] = []
  const centers: Pt[] = []
  const normals: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 2)]
    const b = pts[Math.min(n - 1, i + 2)]
    let tx = b.x - a.x
    let ty = b.y - a.y
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = -ty
    const ny = tx
    const t = i / (n - 1)
    // temblor: una onda lenta y un pulso fino, siempre perpendicular al avance
    const d = i * step
    const wob = (noise.at(d / o.tremorScale, 3.7) - 0.5) * 2 * o.tremor + (noise.at(d / (o.tremorScale * 0.18), 9.1) - 0.5) * 0.5 * o.tremor
    const c = { x: pts[i].x + nx * wob, y: pts[i].y + ny * wob }
    const w = Math.max(0.15 * step, o.width * o.pressure(t) * (1 + (noise.at(d / (o.tremorScale * 0.2), 21.3) - 0.5) * 2 * o.jitter))
    centers.push(c)
    normals.push({ x: nx, y: ny })
    widths.push(w)
    left.push({ x: c.x + (nx * w) / 2, y: c.y + (ny * w) / 2 })
    right.push({ x: c.x - (nx * w) / 2, y: c.y - (ny * w) / 2 })
  }
  // remate de salida (redondo, del grosor que quede) y de entrada (el pincel posado)
  const cap = (c: Pt, nrm: Pt, w: number, from: number): Pt[] => {
    const out: Pt[] = []
    const base = Math.atan2(nrm.y, nrm.x)
    for (let k = 1; k < 8; k++) {
      const a = base + from * (k / 8) * Math.PI
      out.push({ x: c.x + (Math.cos(a) * w) / 2, y: c.y + (Math.sin(a) * w) / 2 })
    }
    return out
  }
  const endCap = cap(centers[n - 1], normals[n - 1], widths[n - 1], -1)
  const startCap = cap(centers[0], { x: -normals[0].x, y: -normals[0].y }, widths[0] * 1.06, -1)
  return { outline: [...left, ...endCap, ...right.reverse(), ...startCap], spine: { c: centers, n: normals, w: widths } }
}

/** Una línea casi recta de (x0,y) a (x1,y), apenas arqueada y algo inclinada, como la traza una mano. */
export function handLine(x0: number, x1: number, y: number, rng: Rng, bow = 0.04, tilt = 0.012): Pt[] {
  const len = x1 - x0
  const b = len * bow * (0.4 + Math.abs(gauss(rng)) * 0.3) * (rng() < 0.65 ? 1 : -1)
  const r = len * tilt * gauss(rng)
  const out: Pt[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    out.push({ x: x0 + len * t, y: y + b * Math.sin(Math.PI * t) + r * (t - 0.5) })
  }
  return out
}

/**
 * Un círculo hecho a mano alrededor de algo: empieza arriba a la derecha, da algo más de una vuelta y no cierra donde
 * empezó (el radio se va abriendo un poco), como cuando se rodea una fecha en un calendario de papel.
 */
export function handLoop(cx: number, cy: number, rx: number, ry: number, rng: Rng, turns = 1.12): Pt[] {
  const a0 = -Math.PI * (0.18 + rng() * 0.12)
  const tilt = gauss(rng) * 0.12
  const grow = 0.06 + rng() * 0.05
  const out: Pt[] = []
  const N = 90
  for (let i = 0; i <= N; i++) {
    const t = i / N
    // la mano gira en sentido contrario a las agujas (de arriba a la derecha hacia la izquierda)
    const a = a0 - t * turns * Math.PI * 2
    const k = 1 + grow * (t - 0.5) * 2
    const x = Math.cos(a) * rx * k
    const y = Math.sin(a) * ry * k
    out.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) })
  }
  return out
}

/**
 * El contorno de una losa (rectángulo de puntas redondas) dibujado de una vez: empieza en una esquina, da la vuelta y se
 * pasa un poco al cerrar. `inset` lo mete hacia dentro (px).
 */
export function handRoundRect(x: number, y: number, w: number, h: number, r: number, rng: Rng, overlap = 0.05): Pt[] {
  const rr = Math.max(1, Math.min(r, w / 2, h / 2))
  const seg: Pt[] = []
  const arc = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2)
      seg.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
    }
  }
  // en el sentido de las agujas desde arriba a la izquierda
  seg.push({ x: x + rr, y })
  seg.push({ x: x + w - rr, y })
  arc(x + w - rr, y + rr, -Math.PI / 2)
  seg.push({ x: x + w, y: y + h - rr })
  arc(x + w - rr, y + h - rr, 0)
  seg.push({ x: x + rr, y: y + h })
  arc(x + rr, y + h - rr, Math.PI / 2)
  seg.push({ x, y: y + rr })
  arc(x + rr, y + rr, Math.PI)
  const loop = resample(seg, 2)
  // empieza en un punto al azar de la vuelta y se pasa un poco al cerrar
  const start = Math.floor(rng() * loop.length)
  const total = Math.round(loop.length * (1 + overlap))
  const out: Pt[] = []
  for (let i = 0; i <= total; i++) out.push(loop[(start + i) % loop.length])
  // al pasarse, la mano ya no va justo encima: se abre un pelo hacia fuera
  const drift = Math.max(0.6, Math.min(w, h) * 0.012)
  const cx = x + w / 2
  const cy = y + h / 2
  return out.map((p, i) => {
    const t = i / total
    const k = t > 1 - overlap * 1.6 ? ((t - (1 - overlap * 1.6)) / (overlap * 1.6)) * drift : 0
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / d) * k, y: p.y + (dy / d) * k }
  })
}

/**
 * Pincelada que acaba en seco: el cuerpo hasta `splitAt` y, desde ahí, el pincel se abre en `count` hebras con papel entre
 * ellas; cada hebra acaba a su altura. Devuelve varios polígonos (el cuerpo y las hebras).
 */
export function dryBrush(path: Pt[], o: BrushOpts, noise: Noise, rng: Rng, splitAt = 0.78, count = 4): Pt[][] {
  const pts = resample(path, o.step ?? 1)
  const n = pts.length
  const cut = Math.floor((n - 1) * splitAt)
  if (n < 8 || count < 1 || cut > n - 6) return [brushOutline(path, o, noise).outline]
  const body = brushOutline(pts.slice(0, cut + 2), { ...o, pressure: (t) => o.pressure((t * (cut + 1)) / (n - 1)) }, noise).outline
  const out: Pt[][] = [body]
  for (let k = 0; k < count; k++) {
    // hebras repartidas por el ancho, algo desiguales; acaban antes cuanto más al borde
    const v = ((k + 0.5) / count - 0.5) * 0.92 + gauss(rng) * 0.04
    const reach = Math.min(1, 0.93 + rng() * 0.07 - Math.abs(v) * 0.12)
    const end = Math.min(n - 1, Math.max(cut + 3, Math.floor((n - 1) * reach)))
    const seg: Pt[] = []
    for (let i = cut - 2; i <= end; i++) {
      const a = pts[Math.max(0, i - 2)]
      const b = pts[Math.min(n - 1, i + 2)]
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = -(b.y - a.y) / tl
      const ny = (b.x - a.x) / tl
      const w = o.width * o.pressure(i / (n - 1))
      seg.push({ x: pts[i].x + nx * v * w, y: pts[i].y + ny * v * w })
    }
    const share = 1.2 / count
    const tine = brushOutline(seg, { ...o, tremor: o.tremor * 0.6, pressure: (t) => Math.max(0.12, o.pressure(((cut - 2 + t * (end - cut + 2)) / (n - 1))) * share * (1 - 0.75 * t ** 2)) }, noise).outline
    out.push(tine)
  }
  return out
}

/** Polígonos a datos de un `<path>` de SVG (con 2 decimales). */
export function toPathData(polys: Pt[][]): string {
  return polys
    .filter((p) => p.length > 2)
    .map((p) => 'M' + p.map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join('L') + 'Z')
    .join('')
}
