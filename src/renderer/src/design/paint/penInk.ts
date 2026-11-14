// La pluma de los diagramas (puro, sin DOM): el círculo a mano con el que un paso rodea lo que importa (ladrillo, como el
// boli rojo de quien corrige), las flechas a tinta con la punta abierta en dos trazos, el contorno a mano de un conjunto de
// Venn y el de una pirámide. Mismo pincel que el resto de dibujos (`inkStroke`), semilla fija y en caché.
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: viewer/src/steps.ts drawHighlights() (el
// rodeo con margen de 7 px) y viewer/src/draw.ts arrowHead() (punta abierta, 13 px y 0,45 rad). Sin rough.js: la pluma es
// la de Aula.
import { gauss, rngFrom, seedOf, type Rng } from './random'
import { createNoise, type Noise } from './noise'
import { pressureProfile, resample, type Pt } from './brush'
import { inkStroke, type InkDrawing, type InkStroke } from './drawings'

const memo = new Map<string, InkDrawing>()
function cached(key: string, make: () => InkDrawing): InkDrawing {
  let d = memo.get(key)
  if (!d) {
    d = make()
    if (memo.size > 600) memo.clear()
    memo.set(key, d)
  }
  return d
}
const tools = (seed: string | number): { rng: Rng; noise: Noise } => {
  const s = seedOf(String(seed))
  return { rng: rngFrom(s), noise: createNoise(s ^ 0x2f6b9a1d) }
}
const drawing = (w: number, h: number, strokes: InkStroke[]): InkDrawing => ({ w, h, strokes, ms: Math.max(0, ...strokes.map((s) => s.at + s.ms)) })
const r1 = (v: number): number => Math.round(v * 10) / 10

/**
 * Óvalo a mano que abraza una caja: como `handLoop`, pero con radios de superelipse (|cos|^(2/n)), así que en una caja ancha
 * va pegado a los lados largos en vez de inflarse en un óvalo enorme. Da algo más de una vuelta y no cierra donde empezó.
 */
export function handOval(cx: number, cy: number, rx: number, ry: number, rng: Rng, turns = 1.1, squareness = 2.8, drift = 1): Pt[] {
  const a0 = -Math.PI * (0.16 + rng() * 0.12)
  // `drift`: cuánto se abre la vuelta y se tuerce (en un contorno grande, poco: tiene que casar con su relleno)
  const tilt = gauss(rng) * 0.035 * drift
  const grow = (0.035 + rng() * 0.035) * drift
  const e = 2 / squareness
  const out: Pt[] = []
  const N = 120
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = a0 - t * turns * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const k = 1 + grow * (t - 0.5) * 2
    const x = Math.sign(c) * Math.abs(c) ** e * rx * k
    const y = Math.sign(s) * Math.abs(s) ** e * ry * k
    out.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) })
  }
  return out
}

/** Presión del rodeo: se posa, aprieta abajo (donde empuja la mano) y se suelta al cerrar. */
const loopPressure = (turns: number) => (t: number): number =>
  (0.5 + 0.5 * Math.min(1, t / 0.1)) * (1 + 0.2 * Math.sin(t * Math.PI * 2 * turns + 2.2)) * (t > 0.84 ? Math.max(0.25, 1 - ((t - 0.84) / 0.16) * 0.75) : 1)

/**
 * Rodeado a pluma alrededor de una caja de w×h (el dibujo es algo mayor: `pad` alrededor). Lo que un paso del proceso
 * señala, como el boli rojo de quien corrige.
 */
export function encircleInk(w: number, h: number, seed: string | number, line = 2.2): InkDrawing {
  const W = Math.round(w), H = Math.round(h)
  return cached(`enc:${seed}:${W}x${H}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const pad = line * 2 + 8
    const bw = W + pad * 2, bh = H + pad * 2
    // cuanto más alargada la caja, más cuadrado el óvalo (no se infla)
    const aspect = Math.max(W, H) / Math.max(1, Math.min(W, H))
    const square = Math.min(4.2, 2.2 + aspect * 0.35)
    const path = handOval(bw / 2, bh / 2, W / 2 + pad * 0.62, H / 2 + pad * 0.62, rng, 1.1, square)
    const stroke = inkStroke(path, { tool: 'pen', width: line, pressure: loopPressure(1.1), dryness: 0.3, speed: 520, minMs: 360, maxMs: 620 }, noise, rng)
    return drawing(bw, bh, [stroke])
  })
}

/** Margen del dibujo de `encircleInk` alrededor de la caja (para colocarlo). */
export const encirclePad = (line = 2.2): number => line * 2 + 8

/** Contorno a mano de un círculo de radio r (un conjunto de Venn): algo más de una vuelta, con el pulso de la pluma. */
export function circleLoopInk(r: number, seed: string | number, line = 1.6, turns = 1.06): InkDrawing {
  const R = Math.round(r)
  return cached(`cl:${seed}:${R}:${line}:${turns}`, () => {
    const { rng, noise } = tools(seed)
    const pad = line * 2 + 6
    const box = R * 2 + pad * 2
    const path = handOval(box / 2, box / 2, R, R, rng, turns, 2, Math.min(1, 9 / Math.max(9, R * 0.06)) * 0.35)
    const stroke = inkStroke(path, { tool: 'pen', width: line, pressure: loopPressure(turns), dryness: 0.28, speed: 900, minMs: 520, maxMs: 900 }, noise, rng)
    return drawing(box, box, [stroke])
  })
}

/** Margen del dibujo de `circleLoopInk` alrededor del círculo. */
export const circleLoopPad = (line = 1.6): number => line * 2 + 6

/** Óvalo a pluma de semiejes rx × ry (la idea central de un mapa mental), del mismo pulso que `circleLoopInk`. */
export function ovalInk(rx: number, ry: number, seed: string | number, line = 1.8): InkDrawing {
  const RX = Math.round(rx), RY = Math.round(ry)
  return cached(`ov:${seed}:${RX}x${RY}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const pad = circleLoopPad(line)
    const path = handOval(RX + pad, RY + pad, RX, RY, rng, 1.08, 2, 0.45)
    const stroke = inkStroke(path, { tool: 'pen', width: line, pressure: loopPressure(1.08), dryness: 0.28, speed: 700, minMs: 480, maxMs: 760 }, noise, rng)
    return drawing(RX * 2 + pad * 2, RY * 2 + pad * 2, [stroke])
  })
}

/** Contorno a lápiz de un polígono cerrado (la silueta de una pirámide), en un trazo que se pasa un poco al cerrar. */
export function outlineInk(points: readonly Pt[], w: number, h: number, seed: string | number, line = 1.4): InkDrawing {
  const key = points.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';')
  return cached(`ol:${seed}:${Math.round(w)}x${Math.round(h)}:${key}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const pts = resample([...points, points[0]], 3)
    // al cerrar, la mano se pasa un poco del principio
    const path = [...pts, ...pts.slice(1, Math.max(2, Math.round(pts.length * 0.03)))]
    const stroke = inkStroke(path, { tool: 'pencil', width: line, dryness: 0.4, speed: 1100, minMs: 700, maxMs: 1300 }, noise, rng)
    return drawing(Math.ceil(w), Math.ceil(h), [stroke])
  })
}

/** Las dos barbas de una punta de flecha abierta en `tip`, llegando desde `from` (Sketchy arrowHead: 13 px, 0,45 rad). */
export function openBarbs(from: Pt, tip: Pt, size = 11, spread = 0.45): [Pt, Pt, Pt] {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x)
  return [
    { x: tip.x - size * Math.cos(a - spread), y: tip.y - size * Math.sin(a - spread) },
    tip,
    { x: tip.x - size * Math.cos(a + spread), y: tip.y - size * Math.sin(a + spread) }
  ]
}

export interface PlacedInk { drawing: InkDrawing; x: number; y: number }

/**
 * Flecha a tinta: el trazo (por los puntos ya muestreados de la curva) y, después, la punta abierta en un solo trazo
 * barba → punta → barba. El dibujo va en su propia caja (`x`, `y`): así cada máscara es pequeña.
 */
export function edgeInk(pts: readonly Pt[], barbs: readonly [Pt, Pt, Pt] | undefined, seed: string | number, width = 1.5): PlacedInk | null {
  if (pts.length < 2) return null
  const all = barbs ? [...pts, ...barbs] : [...pts]
  const pad = width * 2 + 6
  const x0 = Math.floor(Math.min(...all.map((p) => p.x)) - pad)
  const y0 = Math.floor(Math.min(...all.map((p) => p.y)) - pad)
  const x1 = Math.ceil(Math.max(...all.map((p) => p.x)) + pad)
  const y1 = Math.ceil(Math.max(...all.map((p) => p.y)) + pad)
  const key = `e:${seed}:${width}:${pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';')}:${barbs ? barbs.map((p) => `${r1(p.x)},${r1(p.y)}`).join(';') : ''}`
  const d = cached(key, () => {
    const { rng, noise } = tools(seed)
    const local = (p: Pt): Pt => ({ x: p.x - x0, y: p.y - y0 })
    const shaft = inkStroke(pts.map(local), { tool: 'pen', width, pressure: pressureProfile(0.55, 0.06, 0.84, 0.45), dryness: 0.12, speed: 620, minMs: 240, maxMs: 720 }, noise, rng)
    const strokes = [shaft]
    if (barbs) {
      const head = resample(barbs.map(local), 1.5)
      strokes.push(inkStroke(head, { tool: 'pen', width: width * 1.05, pressure: pressureProfile(0.45, 0.15, 0.7, 0.5), dryness: 0.08, speed: 240, minMs: 130, maxMs: 200 }, noise, rng, shaft.ms + 40))
    }
    return drawing(x1 - x0, y1 - y0, strokes)
  })
  return { drawing: d, x: x0, y: y0 }
}

/**
 * Línea a lápiz discontinua de w×h (la que une las dos mitades de una analogía): unos trazos cortos, algo arqueados, uno
 * detrás de otro.
 */
export function dashLineInk(w: number, h: number, seed: string | number, dashes = 3, line = 1.4): InkDrawing {
  const W = Math.round(w), H = Math.round(h)
  return cached(`dl:${seed}:${W}x${H}:${dashes}:${line}`, () => {
    const { rng, noise } = tools(seed)
    const x0 = 3, x1 = W - 3
    const gap = Math.min(6, (x1 - x0) * 0.12)
    const len = (x1 - x0 - gap * (dashes - 1)) / dashes
    const bow = (rng() - 0.5) * 2.2
    const strokes: InkStroke[] = []
    let at = 0
    for (let k = 0; k < dashes; k++) {
      const a = x0 + k * (len + gap)
      const pts: Pt[] = Array.from({ length: 9 }, (_, i) => {
        const x = a + (len * i) / 8
        const t = (x - x0) / (x1 - x0)
        return { x, y: H / 2 + bow * Math.sin(Math.PI * t) + gauss(rng) * 0.12 }
      })
      const s = inkStroke(pts, { tool: 'pencil', width: line, dryness: 0.35, speed: 260, minMs: 90, maxMs: 160 }, noise, rng, at)
      strokes.push(s)
      at += s.ms + 50
    }
    return drawing(W, H, strokes)
  })
}
