// Pintura a mano para el vídeo, con el MISMO pincel que la app (src/renderer/src/design/paint: silueta con presión,
// temblor, remate romo, hebras secas y el ritmo de la mano): pinceladas que barren el cuadro y descubren el plano
// siguiente, palabras que se revelan a pincel, subrayados y rodeos que caen en el pulso, y salpicaduras con mesura.
// Todo con semilla fija (el mismo dibujo en cada pasada) y función pura del tiempo.
//
// Ojo: este módulo importa el kit de la app (con importaciones sin extensión), así que solo lo carga el compositor
// (empaquetado); render.ts lo recibe en `assets.paint` y solo importa sus tipos.
import { inkStroke, type InkStroke } from '../../../src/renderer/src/design/paint/drawings.ts'
import { brushOutline, dryBrush, handLine, handLoop, pressureProfile, resample, type Pt } from '../../../src/renderer/src/design/paint/brush.ts'
import { createNoise } from '../../../src/renderer/src/design/paint/noise.ts'
import { gauss, rngFrom, seedOf, type Rng } from '../../../src/renderer/src/design/paint/random.ts'
import { deform, ellipse, type Vertex } from '../../../src/renderer/src/design/paint/shapes.ts'

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
export type WipeDir = 'right' | 'left' | 'down' | 'up'

/** Una pincelada lista para dibujarse en el lienzo: la de la app (silueta, eje, huecos secos, ritmo) y su caja. */
export interface Stroke {
  ink: InkStroke
  spine: Pt[]
  len: number
  box: [number, number, number, number]
  /** Mechones del pincel: ejes paralelos al del trazo, cada uno con su adelanto (fracción del ancho): la punta que avanza
   *  no es un círculo sino un frente de cerdas desigual. */
  lanes: { pts: Pt[]; w: number; lead: number }[]
}

/** El frente del pincel: cuántos mechones, cuánto se adelantan los del centro y cuánto varía cada uno (fracción del
 *  ancho). Un pincel ancho (el barrido) tiene el frente casi recto y muy desigual; uno de letra, algo redondeado. */
interface Front {
  lanes: number
  centre: number
  jitter: number
}
const NARROW: Front = { lanes: 11, centre: 0.1, jitter: 0.14 }
void (0 as unknown as Front)

const tools = (seed: string | number) => {
  const s = seedOf(String(seed))
  return { rng: rngFrom(s), noise: createNoise(s ^ 0x5bd1e995) }
}

function strokeOf(ink: InkStroke, path: Pt[], seed: string | number = 0, front: Front = NARROW): Stroke {
  const spine = resample(path, 2)
  let len = 0
  for (let i = 1; i < spine.length; i++) len += Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y)
  const pad = ink.reach
  const xs = spine.map((p) => p.x)
  const ys = spine.map((p) => p.y)
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  // los mechones: desplazados a lo ancho del pincel, con un adelanto desigual (los del centro van algo por delante)
  const rng = rngFrom(seedOf(`lanes:${seed}:${len.toFixed(0)}`))
  const lanes: Stroke['lanes'] = []
  const n = spine.length
  const L = front.lanes
  for (let k = 0; k < L; k++) {
    const v = ((k + 0.5) / L - 0.5) * ink.reach
    const pts = spine.map((p, i) => {
      const a = spine[Math.max(0, i - 2)]
      const b = spine[Math.min(n - 1, i + 2)]
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: p.x - ((b.y - a.y) / tl) * v, y: p.y + ((b.x - a.x) / tl) * v }
    })
    const centre = 1 - Math.abs((k + 0.5) / L - 0.5) * 2
    lanes.push({ pts, w: (ink.reach / L) * 1.9, lead: (front.centre * centre + (rng() - 0.5) * front.jitter) * ink.reach })
  }
  return { ink, spine, len, box: [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0], lanes }
}

/** Cuánto del trazo ha recorrido la mano en la fracción de tiempo `p` (0…1), con su ritmo (arranca, frena en las curvas). */
export function reach(s: Stroke, p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  const pace = s.ink.pace
  for (let i = 1; i < pace.length; i++) {
    const [t1, q1] = pace[i]
    const [t0, q0] = pace[i - 1]
    if (p <= t1) return q0 + ((q1 - q0) * (p - t0)) / Math.max(1e-9, t1 - t0)
  }
  return 1
}

// ───────────── geometría (pura) ─────────────

/** Un trazo del barrido: su silueta (cuerpo y hebras de la salida), los huecos secos (rayas de cerdas, como gaps) y por
 *  dónde avanza (de `from` a `to` a lo largo de `dir`, en px del vídeo). */
export interface WipeStroke {
  /** La pincelada recorrida hasta `q` (0…1 del largo): el cuerpo pintado hasta ahí con la PUNTA del pincel delante
   *  (ovalada y algo afilada, no un círculo ni un corte recto). En 1, la silueta entera con sus hebras. */
  outline(q: number): Pt[][]
  polys: Pt[][]
  streaks: { pts: Pt[]; w: number }[]
  dir: Pt
  origin: Pt
  len: number
  /** Fracción del barrido (0…1) en que empieza y acaba de avanzar. */
  span: [number, number]
}

export interface Wipe {
  strokes: WipeStroke[]
  /** Desenfoque del frente (px): el pincel va rápido. */
  blur: number
}

/** Cuántos trazos y de qué ancho, según la proporción del cuadro a lo ancho del avance. */
export function wipeLayout(long: number, perp: number): { n: number; width: number } {
  const a = perp / long
  const n = a < 1.2 ? 3 : a < 1.6 ? 4 : 5
  return { n, width: (perp / n) * 1.5 }
}

/** Barrido de pincel: 3–5 pinceladas largas de pincel seco que cruzan el cuadro una tras otra (escalonadas), se solapan y
 *  lo cubren. Cada una se posa roma fuera del cuadro, corre con presión variable, se abre en hebras al salir y lleva rayas
 *  secas de cerdas; el borde es el de la silueta de la app (orgánico, continuo). `dir`: hacia dónde van. */
export function wipeStrokes(W: number, H: number, dir: WipeDir, seed: string | number): Wipe {
  const { rng, noise } = tools(`wipe2:${seed}:${dir}:${W}x${H}`)
  const across = dir === 'right' || dir === 'left'
  const flip = dir === 'left' || dir === 'up'
  const long = across ? W : H
  const perp = across ? H : W
  const { n, width } = wipeLayout(long, perp)
  const map = (p: Pt): Pt => {
    const a = flip ? long - p.x : p.x
    return across ? { x: a, y: p.y } : { x: p.y, y: a }
  }
  const strokes: WipeStroke[] = []
  // orden de las pasadas: del centro hacia fuera alternando, para que el cuadro se llene sin una «persiana»
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b)
  order.forEach((slot, k) => {
    const c = (perp * (slot + 0.5)) / n + gauss(rng) * width * 0.04
    const tilt = (rng() - 0.5) * 0.12
    const local = handLine(-long * 0.14, long * 1.14, c, rng, 0.05, 0)
    const path = local.map((p) => map({ x: p.x, y: p.y + (p.x - long / 2) * tilt }))
    const swell = rng() * 6
    const pressure = (t: number) => (0.62 + 0.38 * Math.min(1, t / 0.12)) * (1 + 0.08 * Math.sin(t * 7 + swell)) * (t > 0.78 ? Math.max(0.4, 1 - ((t - 0.78) / 0.22) * 0.6) : 1)
    const o = { width, pressure, tremor: width * 0.025, tremorScale: width * 0.9, jitter: 0.08, step: 4 }
    const polys = dryBrush(path, o, noise, rng, 0.8, 6)
    // rayas secas: huecos largos y finos a lo largo del trazo, más hacia la salida y hacia los bordes
    const sp = resample(path, 8)
    const streaks: WipeStroke['streaks'] = []
    for (let q = 0; q < 12; q++) {
      const v = (rng() - 0.5) * 0.86
      const from = Math.floor(sp.length * (0.3 + rng() * 0.45 - Math.abs(v) * 0.25))
      const to = Math.min(sp.length - 1, from + Math.floor(sp.length * (0.15 + rng() * 0.4)))
      const pts: Pt[] = []
      for (let i = Math.max(1, from); i <= to; i++) {
        const a = sp[Math.max(0, i - 1)]
        const b = sp[Math.min(sp.length - 1, i + 1)]
        const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const w = width * pressure(i / (sp.length - 1))
        pts.push({ x: sp[i].x - ((b.y - a.y) / tl) * v * w * 0.5, y: sp[i].y + ((b.x - a.x) / tl) * v * w * 0.5 })
      }
      if (pts.length > 2) streaks.push({ pts, w: Math.max(2, width * (0.006 + rng() * 0.014)) })
    }
    const full = resample(path, 4)
    const total = (full.length - 1) * 4
    const outline = (q: number): Pt[][] => {
      if (q >= 1) return polys
      if (q <= 0) return []
      // el tramo recorrido (con el último punto interpolado) y su presión, más la punta: los últimos 0,7 anchos se
      // estrechan en óvalo, como la cabeza cargada de un pincel que empuja la pintura
      const at = q * (full.length - 1)
      const k = Math.floor(at)
      const part = full.slice(0, k + 1)
      if (k < full.length - 1) {
        const a = full[k]
        const b = full[k + 1]
        part.push({ x: a.x + (b.x - a.x) * (at - k), y: a.y + (b.y - a.y) * (at - k) })
      }
      if (part.length < 3) return []
      const len = at * 4
      const head = width * 0.7
      const press = (t: number) => {
        const sAlong = t * len
        const fromEnd = len - sAlong
        const tip = fromEnd < head ? Math.sqrt(Math.max(0.02, 1 - ((head - fromEnd) / head) ** 2)) : 1
        return pressure((t * len) / total) * tip
      }
      return [brushOutline(part, { ...o, pressure: press }, noise).outline]
    }
    const d = map({ x: 1, y: 0 })
    const o0 = map({ x: 0, y: 0 })
    const dv = { x: d.x - o0.x, y: d.y - o0.y }
    const start = path[0]
    // escalonadas: la última acaba en el 70 % del barrido (luego la pintura se levanta y deja la escena nueva)
    const gap = n > 1 ? 0.2 / (n - 1) : 0
    strokes.push({ outline, polys, streaks, dir: dv, origin: start, len: long * 1.28, span: [k * gap, k * gap + 0.5] })
  })
  return { strokes, blur: Math.min(W, H) * 0.012 }
}

/** La pincelada que descubre una palabra: a lo largo de su línea, de izquierda a derecha, algo más ancha que la letra. */
export function wordStroke(x: number, y: number, w: number, size: number, seed: string | number): Stroke {
  const { rng, noise } = tools(`word:${seed}`)
  const mid = y - size * 0.32
  const path = handLine(x - size * 0.25, x + w + size * 0.2, mid, rng, 0.02, 0.02)
  const pressure = pressureProfile(0.75, 0.05, 0.8, 0.35)
  const ink = inkStroke(path, { tool: 'brush', width: size * 1.45, pressure, tines: 4, dryness: 0.5, speed: 2600, minMs: 160, maxMs: 420 }, noise, rng)
  return strokeOf(ink, path)
}

/** Subrayado a pincel bajo [x, x+w] en la línea base y: se posa romo, corre, se levanta en hebras. */
export function underlineStroke(x: number, y: number, w: number, size: number, seed: string | number): Stroke {
  const { rng, noise } = tools(`under:${seed}`)
  const path = handLine(x - size * 0.06, x + w + size * 0.1, y + size * 0.16, rng, 0.04, 0.02)
  const swell = rng() * 6
  const pressure = (t: number) => pressureProfile(0.8, 0.04, 0.6, 0.1)(t) * (1 + 0.1 * Math.sin(t * 5 + swell))
  const ink = inkStroke(path, { tool: 'brush', width: Math.max(6, size * 0.15), pressure, tines: 4, speed: 1800, minMs: 260, maxMs: 520 }, noise, rng)
  return strokeOf(ink, path)
}

/** Rodeo a mano alrededor de una caja (algo más de una vuelta, sin cerrar del todo). */
export function ringStroke(x: number, y: number, w: number, h: number, line: number, seed: string | number): Stroke {
  const { rng, noise } = tools(`ring:${seed}`)
  const path = handLoop(x + w / 2, y + h / 2, w / 2 + line * 1.6, h / 2 + line * 1.6, rng, 1.12)
  const pressure = (t: number) => (0.55 + 0.45 * Math.min(1, t / 0.1)) * (1 + 0.2 * Math.sin(t * Math.PI * 2.2 + 2.2)) * (t > 0.82 ? Math.max(0.25, 1 - ((t - 0.82) / 0.18) * 0.75) : 1)
  const ink = inkStroke(path, { tool: 'brush', width: line, pressure, tines: 3, dryness: 0.35, speed: 2200, minMs: 320, maxMs: 620 }, noise, rng)
  return strokeOf(ink, path)
}

/** Un trazo suelto (adorno): una línea a mano de `from` a `to`, algo arqueada. */
export function freeStroke(from: Pt, to: Pt, width: number, seed: string | number): Stroke {
  const { rng, noise } = tools(`free:${seed}`)
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  const a = Math.atan2(to.y - from.y, to.x - from.x)
  const local = handLine(0, len, 0, rng, 0.08, 0.02)
  const path = local.map((p) => ({ x: from.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: from.y + p.x * Math.sin(a) + p.y * Math.cos(a) }))
  const ink = inkStroke(path, { tool: 'brush', width, pressure: pressureProfile(0.7, 0.05, 0.62, 0.12), tines: 4, speed: 1600, minMs: 240, maxMs: 520 }, noise, rng)
  return strokeOf(ink, path)
}

/** Una salpicadura: la mancha (borde cortado a mano, con su humedad) y unas gotas que salen hacia fuera. */
export interface Splash {
  blob: Vertex[]
  drops: { x: number; y: number; poly: Vertex[] }[]
}

export function splash(r: number, seed: string | number, drops = 5): Splash {
  const rng: Rng = rngFrom(seedOf(`splash:${seed}`))
  const blob = deform(ellipse(0, 0, r, r * (0.78 + rng() * 0.18), 9, rng, [0.1, 0.32], rng() * Math.PI), 3, rng, 1, 0.72)
  const out: Splash['drops'] = []
  const a0 = rng() * Math.PI * 2
  for (let i = 0; i < drops; i++) {
    const a = a0 + (i / drops) * Math.PI * 2 + gauss(rng) * 0.35
    const d = r * (1.25 + rng() * 0.6)
    const dr = r * (0.06 + rng() * 0.1)
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    // la gota, alrededor de su propio centro (se coloca al dibujarla)
    out.push({ x, y, poly: deform(ellipse(0, 0, dr, dr * (0.7 + rng() * 0.3), 6, rng, [0.1, 0.2], a), 2, rng, 1, 0.7) })
  }
  return { blob, drops: out }
}

// ───────────── dibujo ─────────────

const path2d = new Map<string, Path2D>()
const P2 = (d: string) => {
  let p = path2d.get(d)
  if (!p) {
    p = new Path2D(d)
    if (path2d.size > 2000) path2d.clear()
    path2d.set(d, p)
  }
  return p
}

/** Deja en `l` (en coordenadas del vídeo, con su transformación) la máscara de la pincelada recorrida hasta `q` (0…1 del
 *  largo): el eje a lo ancho del pincel, recortado por la silueta y sin los huecos secos. Opaco donde hay pintura. */
export function strokeMask(l: Ctx2D, s: Stroke, q: number): void {
  if (q <= 0) return
  l.save()
  l.lineCap = 'round'
  l.lineJoin = 'round'
  l.strokeStyle = '#000'
  if (q >= 1) {
    l.lineWidth = s.ink.reach
    l.beginPath()
    l.moveTo(s.spine[0].x, s.spine[0].y)
    for (const p of s.spine.slice(1)) l.lineTo(p.x, p.y)
    l.stroke()
  } else {
    // cada mechón llega hasta donde va la mano, más su adelanto: un frente de cerdas, no un círculo
    for (const lane of s.lanes) {
      const reachLen = Math.max(0, s.len * q + lane.lead * Math.min(1, (s.len * q) / Math.max(1, s.ink.reach)))
      if (reachLen <= 0) continue
      l.lineWidth = lane.w
      l.setLineDash([reachLen, s.len * 3])
      l.beginPath()
      l.moveTo(lane.pts[0].x, lane.pts[0].y)
      for (const p of lane.pts.slice(1)) l.lineTo(p.x, p.y)
      l.stroke()
    }
    l.setLineDash([])
  }
  l.globalCompositeOperation = 'destination-in'
  l.fillStyle = '#000'
  l.fill(P2(s.ink.d))
  if (s.ink.dry) {
    l.globalCompositeOperation = 'destination-out'
    l.lineWidth = s.ink.dryWidth
    l.stroke(P2(s.ink.dry))
  }
  l.restore()
}

let scratch: OffscreenCanvas | null = null
function layer(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!scratch || scratch.width < w || scratch.height < h) scratch = new OffscreenCanvas(Math.max(w, scratch?.width ?? 0), Math.max(h, scratch?.height ?? 0))
  const l = scratch.getContext('2d')!
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-over'
  l.globalAlpha = 1
  l.clearRect(0, 0, w, h)
  return l
}

/** Pinta la pincelada hasta la fracción de tiempo `p` (con el ritmo de la mano), del color dado. */
export function drawStroke(ctx: Ctx2D, s: Stroke, p: number, color: string, alpha = 1): void {
  const q = reach(s, p)
  if (q <= 0 || alpha <= 0) return
  const [bx, by, bw, bh] = s.box
  const w = Math.ceil(bw) + 2
  const h = Math.ceil(bh) + 2
  const l = layer(w, h)
  l.translate(-bx, -by)
  strokeMask(l, s, q)
  l.setTransform(1, 0, 0, 1, 0, 0)
  l.globalCompositeOperation = 'source-in'
  l.fillStyle = color
  l.fillRect(0, 0, w, h)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.drawImage(scratch!, 0, 0, w, h, bx, by, w, h)
  ctx.restore()
}

/** Dibuja algo (`paint` pinta en la capa, en coordenadas del vídeo) solo donde la pincelada ya pasó: una palabra que se
 *  revela a pincel. */
export function drawThroughStroke(ctx: Ctx2D, s: Stroke, p: number, paint: (l: OffscreenCanvasRenderingContext2D) => void, alpha = 1): void {
  const q = reach(s, p)
  if (q <= 0 || alpha <= 0) return
  const [bx, by, bw, bh] = s.box
  const w = Math.ceil(bw) + 2
  const h = Math.ceil(bh) + 2
  const l = layer(w, h)
  l.translate(-bx, -by)
  strokeMask(l, s, q)
  l.globalCompositeOperation = 'source-in'
  paint(l)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.drawImage(scratch!, 0, 0, w, h, bx, by, w, h)
  ctx.restore()
}

/** Contorno suave de un polígono a mano (curvas por los puntos medios). */
function trace(ctx: Ctx2D, poly: Vertex[], k: number, ox: number, oy: number): void {
  const n = poly.length
  if (n < 3) return
  const mid = (a: Vertex, b: Vertex) => [ox + ((a.x + b.x) / 2) * k, oy + ((a.y + b.y) / 2) * k]
  const m0 = mid(poly[n - 1], poly[0])
  ctx.moveTo(m0[0], m0[1])
  for (let i = 0; i < n; i++) {
    const p = poly[i]
    const m = mid(p, poly[(i + 1) % n])
    ctx.quadraticCurveTo(ox + p.x * k, oy + p.y * k, m[0], m[1])
  }
  ctx.closePath()
}

/** La salpicadura en (x, y) a `local` s de caer: la mancha se abre en 120 ms (con un poco de rebote) y las gotas salen
 *  disparadas y se posan; `fade` (0…1) la apaga al final. */
export function drawSplash(ctx: Ctx2D, sp: Splash, x: number, y: number, local: number, color: string, alpha = 1): void {
  if (local < 0 || alpha <= 0) return
  const open = Math.min(1, local / 0.12)
  const k = open < 1 ? 0.35 + 0.75 * open : 1 + 0.06 * Math.exp(-(local - 0.12) * 18) * Math.sin((local - 0.12) * 40)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = color
  ctx.beginPath()
  trace(ctx, sp.blob, k, x, y)
  ctx.fill()
  const fly = Math.min(1, local / 0.18)
  const e = 1 - (1 - fly) ** 3
  for (const d of sp.drops) {
    // la gota sale del centro y se posa en su sitio, creciendo hasta su tamaño
    ctx.beginPath()
    trace(ctx, d.poly, Math.min(1, 0.4 + fly), x + d.x * e, y + d.y * e)
    ctx.fill()
  }
  ctx.restore()
}

/** El kit que recibe el compositor (render.ts) en `assets.paint`. */
export const paintKit = { wipeStrokes, wordStroke, underlineStroke, ringStroke, freeStroke, splash, strokeMask, drawStroke, drawThroughStroke, drawSplash, reach }
export type PaintKit = typeof paintKit
