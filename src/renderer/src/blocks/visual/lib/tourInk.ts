// El lazo a pluma con el que el recorrido guiado de una figura rodea una parte: la mano de `InkRing` (algo más de una
// vuelta, más apretada abajo, suelta al cerrar), pero ovalada para cualquier caja y con forma de superelipse, que abraza
// las zonas anchas sin un óvalo enorme. Puro: el mismo dibujo para la misma semilla y medida (y se guarda).
// La idea de rodear con la pluma roja lo que cuenta cada paso viene de Sketchy (https://github.com/ddkbs/sketchy),
// MIT © 2026 ddkbs: viewer/src/steps.ts (drawHighlights); el trazo es el pincel propio de Aula (design/paint).
import { pressureProfile, type Pt } from '@renderer/design/paint/brush'
import { inkStroke, type InkDrawing } from '@renderer/design/paint/drawings'
import { createNoise } from '@renderer/design/paint/noise'
import { gauss, rngFrom, seedOf, type Rng } from '@renderer/design/paint/random'

/** Exponente de la superelipse para las zonas rectas (rectángulos, polígonos): 2 es una elipse; más, más cuadrada. */
const SQUARE = 2.6

/**
 * Un óvalo a mano: empieza arriba a la derecha, gira en sentido contrario a las agujas algo más de una vuelta y se abre al
 * cerrar. `n`: exponente de la superelipse (2, una elipse).
 */
export function handOval(cx: number, cy: number, rx: number, ry: number, rng: Rng, turns = 1.1, n = 2): Pt[] {
  const a0 = -Math.PI * (0.16 + rng() * 0.12)
  const tilt = gauss(rng) * 0.035
  const grow = 0.05 + rng() * 0.04
  const e = 2 / n
  const out: Pt[] = []
  const N = 120
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = a0 - t * turns * Math.PI * 2
    const k = 1 + grow * (t - 0.5) * 2
    const c = Math.cos(a), s = Math.sin(a)
    const x = Math.sign(c) * Math.pow(Math.abs(c), e) * rx * k
    const y = Math.sign(s) * Math.pow(Math.abs(s), e) * ry * k
    out.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) })
  }
  return out
}

/** Hueco entre la parte y la línea (px). */
export const TOUR_PAD = 7

const memo = new Map<string, InkDrawing>()

/**
 * El dibujo que rodea una caja de `bw` × `bh` px: su lienzo es más grande que la caja (el lazo y su vuelta de más) y va
 * centrado sobre ella. `round`: la zona es un círculo (lazo elíptico); si no, abraza las esquinas. `line`: grosor de la pluma.
 */
export function encircleInk(bw: number, bh: number, seed: string, round = false, line = 2.4): InkDrawing {
  const w0 = Math.max(10, Math.round(bw)), h0 = Math.max(10, Math.round(bh))
  const key = `${seed}:${w0}x${h0}:${round ? 'o' : 's'}:${line}`
  const hit = memo.get(key)
  if (hit) return hit
  const s = seedOf(seed)
  const rng = rngFrom(s)
  const noise = createNoise(s ^ 0x5bd1e995)
  // la curva pasa por fuera de las esquinas de la caja: semiejes × 2^(1/n) (en un círculo, el propio radio)
  const n = round ? 2 : SQUARE
  const corner = round ? 1 : Math.pow(2, 1 / n)
  const rx = (w0 / 2) * corner + TOUR_PAD, ry = (h0 / 2) * corner + TOUR_PAD
  // margen para la vuelta que se abre y el grosor de la línea
  const w = Math.ceil(2 * rx * 1.1 + line * 4), h = Math.ceil(2 * ry * 1.1 + line * 4)
  const path = handOval(w / 2, h / 2, rx, ry, rng, 1.1, n)
  // como el anillo de Hoy: se posa, aprieta abajo y se levanta afilándose al cerrar
  const land = pressureProfile(0.55, 0.08, 0.84, 0.16)
  const pressure = (t: number): number => land(t) * (1 + 0.18 * Math.sin(t * Math.PI * 2 * 1.1 + 2.2))
  const stroke = inkStroke(path, { tool: 'pen', width: line, pressure, dryness: 0.3, speed: 560, minMs: 380, maxMs: 640 }, noise, rng)
  const d: InkDrawing = { w, h, strokes: [stroke], ms: stroke.at + stroke.ms }
  if (memo.size > 300) memo.clear()
  memo.set(key, d)
  return d
}
