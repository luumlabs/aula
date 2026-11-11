// Rellenos planos cortados a mano: cada receta deja en un lienzo fuera de pantalla una máscara alfa (blanco + color en el
// alfa) con una semilla fija y un grano de papel muy suave. Se hacen UNA vez y se guardan (cache.ts); en pantalla son
// imágenes quietas que colorea el CSS. Las LÍNEAS van aparte, en vectores que se dibujan (ink.ts).
import type { Pt } from './brush'
import { deform, superellipse, trace } from './shapes'
import { createNoise, type Noise } from './noise'
import { between, gauss, rngFrom, type Rng } from './random'

export type PaintKind = 'band' | 'tile' | 'swatch' | 'pass'

export interface PaintSpec {
  kind: PaintKind
  seed: number
  /** Tamaño en px de CSS. */
  w: number
  h: number
  /** Píxeles de dispositivo por px de CSS (0,5–2). */
  scale?: number
}

type Ctx = OffscreenCanvasRenderingContext2D

interface Job {
  w: number
  h: number
  s: number
  rng: Rng
  noise: Noise
  canvas: OffscreenCanvas
  ctx: Ctx
}

function job(spec: PaintSpec): Job {
  const s = Math.max(0.5, Math.min(3, spec.scale ?? 1))
  const canvas = new OffscreenCanvas(Math.max(2, Math.round(spec.w * s)), Math.max(2, Math.round(spec.h * s)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx
  // se dibuja en px de CSS
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  // la misma semilla da la misma forma en todas las recetas (relleno y línea de una portada casan)
  return { w: spec.w, h: spec.h, s, rng: rngFrom(spec.seed), noise: createNoise(spec.seed ^ 0x5bd1e995), canvas, ctx }
}

/** Grano del papel: la tinta y el relleno no son de imprenta; el diente del papel se nota apenas. */
function paper(j: Job, amount: number): OffscreenCanvas {
  const { canvas, noise, s } = j
  const W = canvas.width
  const H = canvas.height
  const img = j.ctx.getImageData(0, 0, W, H)
  const d = img.data
  const inv = 1 / (1.3 * s)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3
      if (!d[i]) continue
      const g = noise.at(x * inv + 50, y * inv - 20) * 0.6 + noise.hash(x, y) * 0.4
      d[i] = Math.round(d[i] * (1 - amount * Math.max(0, g - 0.35) * 1.6))
    }
  j.ctx.putImageData(img, 0, 0)
  return canvas
}

/** El borde de abajo de una portada (lo comparten el relleno y la línea de tinta): una ondulación lenta, cortada a mano. */
export function bandEdge(rng: Rng, noise: Noise, w: number, h: number): Pt[] {
  const base = h * between(rng, 0.6, 0.7)
  const amp = h * between(rng, 0.09, 0.13)
  const tilt = h * gauss(rng) * 0.06
  const ph = rng() * 50
  const out: Pt[] = []
  for (let x = -12; x <= w + 12; x += 3) {
    const t = x / w
    out.push({ x, y: base + (noise.fbm(t * 2.4 + ph, 0.5, 2) - 0.5) * 2 * amp + tilt * (t - 0.5) })
  }
  return out
}

// ───────────── Recetas ─────────────

/** Portada: relleno plano que baja del borde de arriba y se corta abajo con una ondulación hecha a mano. */
function band(spec: PaintSpec): OffscreenCanvas {
  const j = job(spec)
  const { w, h, rng, noise, ctx } = j
  const edge = bandEdge(rng, noise, w, h)
  ctx.beginPath()
  ctx.moveTo(-12, -12)
  ctx.lineTo(w + 12, -12)
  for (let i = edge.length - 1; i >= 0; i--) ctx.lineTo(edge[i].x, edge[i].y)
  ctx.closePath()
  ctx.fill()
  return paper(j, 0.1)
}

/** Losa: un cuadrado de puntas redondas recortado a mano (relleno plano), apenas torcido. */
function tile(spec: PaintSpec): OffscreenCanvas {
  const j = job(spec)
  const { w, h, rng, ctx } = j
  const base = superellipse(w / 2, h / 2, w * 0.46, h * 0.46, 4.6, 20, rng, [0.004, 0.014], gauss(rng) * 0.03)
  trace(ctx, deform(base, 3, rng, 1, 0.5))
  ctx.fill()
  return paper(j, 0.12)
}

/**
 * Cerdas: el pincel plano no carga igual en todo su ancho y, donde arranca (lejos de la esquina), ya va seco y deja
 * rayas de papel a lo largo de la pasada. `angle` es la dirección de la pasada; el origen, la esquina de abajo a la derecha.
 */
function bristles(j: Job, angle: number, fromLeft = false): OffscreenCanvas {
  const { canvas, noise, s, w, h } = j
  const W = canvas.width
  const H = canvas.height
  const img = j.ctx.getImageData(0, 0, W, H)
  const d = img.data
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3
      if (!d[i]) continue
      // (con `fromLeft` la pasada entra cargada por la izquierda y llega seca a la derecha)
      const X = fromLeft ? -x / s : x / s - w
      const Y = fromLeft ? y / s - h / 2 : y / s - h
      const along = X * cos + Y * sin
      const across = -X * sin + Y * cos
      // 0 junto a la esquina (pincel cargado), 1 en el arranque (seco)
      const dry = Math.min(1, Math.max(0, -along / w)) ** (fromLeft ? 3.2 : 1.8)
      const load = 1 - 0.14 * noise.at(across * 1.5 + 11, along * 0.02 + 90)
      const hair = noise.at(across * 0.62 + 31, along * 0.011 + 7)
      const bare = hair > 1 - dry * 0.66 ? 0.16 + 0.5 * (1 - dry) : 1
      d[i] = Math.round(d[i] * load * bare)
    }
  j.ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Muestra de pigmento: tres pasadas de pincel plano que entran por la esquina de abajo a la derecha, una sobre otra y
 * cada vez más cortas, como quien prueba un color en el margen del papel. Donde se pisan, el color queda más denso.
 */
function swatch(spec: PaintSpec): OffscreenCanvas {
  const j = job(spec)
  const { w, h, rng, ctx } = j
  const angle = -between(rng, 0.07, 0.15)
  const thick = h * between(rng, 0.36, 0.42)
  ctx.save()
  ctx.translate(w, h)
  ctx.rotate(angle)
  ctx.globalAlpha = 0.8
  for (let i = 0; i < 3; i++) {
    const y = -thick * (0.3 + i * 0.8) + gauss(rng) * thick * 0.05
    const length = w * (1.0 - i * between(rng, 0.17, 0.25))
    const reach = w * 0.16
    const base = superellipse((reach - length) / 2, y, (reach + length) / 2, thick * (0.52 - i * 0.03), 5.2, 22, rng, [0.008, 0.028], gauss(rng) * 0.012)
    trace(ctx, deform(base, 3, rng, 1, 0.55))
    ctx.fill()
  }
  ctx.restore()
  bristles(j, angle)
  return paper(j, 0.16)
}

/**
 * Una pasada: una sola pasada de pincel plano a lo ancho de la caja (la fila elegida de una lista). Entra cargada por la
 * izquierda, con los bordes cortados a mano, y se va quedando seca al final: las últimas cerdas dejan ver el papel.
 */
function pass(spec: PaintSpec): OffscreenCanvas {
  const j = job(spec)
  const { w, h, rng, ctx } = j
  const base = superellipse(w / 2, h / 2, w * 0.497, h * 0.47, 7, 30, rng, [0.003, 0.01], gauss(rng) * 0.004)
  trace(ctx, deform(base, 3, rng, 1, 0.45))
  ctx.fill()
  bristles(j, gauss(rng) * 0.01, true)
  return paper(j, 0.1)
}

const RECIPES: Record<PaintKind, (spec: PaintSpec) => OffscreenCanvas> = { band, tile, swatch, pass }

export function renderPaint(spec: PaintSpec): OffscreenCanvas {
  return RECIPES[spec.kind](spec)
}
