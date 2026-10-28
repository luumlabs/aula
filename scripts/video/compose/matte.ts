// El barrido de pincel como «matte» de verdad: cada píxel del cuadro tiene su instante de llegada de la pintura (T) y su
// instante en que la pintura se levanta (L > T). Antes de T se ve el plano viejo; entre T y L, el ladrillo; después de L,
// el plano nuevo. Así ningún píxel pasa del viejo al nuevo sin que la pintura lo haya tapado, nunca hay dos escenas
// mezcladas ni una pintura translúcida, y todo el cuadro queda cubierto (los huecos entre trazos heredan la llegada de
// sus vecinos). Las rayas de las cerdas hacen el levantamiento desigual, como pintura que se seca a tirones.
//
// Las funciones puras (relleno de huecos, campo de levantamiento, máscaras de un instante) tienen pruebas; `buildMatte`
// rasteriza los trazos con el lienzo del compositor.
import type { Wipe } from './paint.ts'

export interface Matte {
  /** Tamaño de la rejilla (el cuadro a 1/scale) y escala. */
  gw: number
  gh: number
  scale: number
  /** Llegada de la pintura y levantamiento, en fracción del barrido (0…1), por celda. */
  T: Float32Array
  L: Float32Array
  /** Huecos secos de las cerdas (0…1) mientras hay pintura. */
  gap: Float32Array
}

/** Cuánto va la pintura por delante de la escena nueva (fracción del barrido). */
export const LIFT_DELAY = 0.2
/** Borde blando de los frentes (fracción del barrido a cada lado). */
export const EDGE = 0.004
/** Borde del levantamiento, algo más blando: la pintura se seca, no se corta. */
export const LIFT_EDGE = 0.008

/** Los huecos que ningún trazo cubre (valor < 0) heredan la llegada de sus vecinos, algo más tarde: la pintura «se
 *  extiende» hasta ellos y el cuadro queda cubierto entero. */
export function fillGaps(T: Float32Array, gw: number, gh: number, step = 0.0015): void {
  for (let pass = 0; pass < 4000; pass++) {
    let missing = 0
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        if (T[i] >= 0) continue
        let best = Infinity
        if (x > 0 && T[i - 1] >= 0) best = Math.min(best, T[i - 1])
        if (x < gw - 1 && T[i + 1] >= 0) best = Math.min(best, T[i + 1])
        if (y > 0 && T[i - gw] >= 0) best = Math.min(best, T[i - gw])
        if (y < gh - 1 && T[i + gw] >= 0) best = Math.min(best, T[i + gw])
        if (best < Infinity) T[i] = -2 - (best + step)
        else missing++
      }
    // los recién rellenados se fijan después de la pasada (para que crezca una celda por pasada)
    let changed = false
    for (let i = 0; i < T.length; i++)
      if (T[i] <= -2) {
        T[i] = -T[i] - 2
        changed = true
      }
    if (!missing || !changed) {
      if (missing) for (let i = 0; i < T.length; i++) if (T[i] < 0) T[i] = 0.5
      return
    }
  }
}

/** Ruido de cerdas a lo largo del avance: depende solo de la coordenada perpendicular `u` (px del vídeo). Cerdas de 4–8 px
 *  con separación irregular (no un peine de agujas de 1–2 px) sobre una ondulación ancha, como el pincel seco del icono. */
function streak(u: number, seed: number): number {
  const h = (n: number) => {
    let x = (n * 374761393 + seed * 668265263) | 0
    x = Math.imul(x ^ (x >>> 13), 1274126177)
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296
  }
  const v = (s: number, salt: number, at = u) => {
    const i = Math.floor(at / s)
    const f = at / s - i
    const a = h(i * 2 + salt)
    const b = h((i + 1) * 2 + salt)
    return a + (b - a) * f * f * (3 - 2 * f)
  }
  // la cerda: anchura irregular (6 px de media) y su altura propia; encima, mechones de ~40 px
  // separación irregular: la coordenada se deforma suavemente (sin saltos) antes de muestrear las cerdas de 6 px
  return v(6, 1, u + 9 * v(23, 7)) * 0.55 + v(40, 3) * 0.45
}

/** El levantamiento: la llegada más el retraso, desigual por cerdas. Siempre acaba antes del final del barrido. */
export function liftField(T: Float32Array, gw: number, gh: number, dir: { x: number; y: number }, seed: number, scale = 1): Float32Array {
  const L = new Float32Array(T.length)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      // coordenada perpendicular al avance (en px del vídeo)
      const u = (Math.abs(dir.x) > Math.abs(dir.y) ? y : x) * scale
      L[i] = Math.min(1 - LIFT_EDGE * 2, T[i] + LIFT_DELAY + (streak(u, seed) - 0.5) * 0.035)
      if (L[i] < T[i] + 0.05) L[i] = T[i] + 0.05
    }
  return L
}

const smooth = (d: number) => {
  const t = Math.min(1, Math.max(0, (d + EDGE) / (2 * EDGE)))
  return t * t * (3 - 2 * t)
}

const smoothLift = (d: number) => {
  const t = Math.min(1, Math.max(0, (d + LIFT_EDGE) / (2 * LIFT_EDGE)))
  return t * t * (3 - 2 * t)
}

/** Las máscaras del instante `p` (alfa 0…255 en el canal 4 de cada una): `paint` (el ladrillo que se ve) y `scene`
 *  (dónde ya está el plano nuevo). Un píxel es viejo, ladrillo o nuevo; solo los bordes blandos mezclan. */
export function matteAt(m: Matte, p: number, paint: Uint8ClampedArray, scene: Uint8ClampedArray): void {
  for (let i = 0; i < m.T.length; i++) {
    const arrived = smooth(p - m.T[i])
    const lifted = smoothLift(p - m.L[i])
    scene[i * 4 + 3] = Math.round(lifted * 255)
    paint[i * 4 + 3] = Math.round(arrived * (1 - lifted) * (1 - m.gap[i] * 0.85) * 255)
  }
}

/** Rasteriza los trazos del barrido a 1/scale y saca la llegada de cada celda. */
export function buildMatte(wipe: Wipe, W: number, H: number, scale = 2, steps = 220): Matte {
  const gw = Math.ceil(W / scale)
  const gh = Math.ceil(H / scale)
  const T = new Float32Array(gw * gh).fill(-1)
  const c = new OffscreenCanvas(gw, gh)
  const g = c.getContext('2d', { willReadFrequently: true })!
  const path = (polys: { x: number; y: number }[][]) => {
    const p = new Path2D()
    for (const pl of polys) {
      if (pl.length < 3) continue
      p.moveTo(pl[0].x / scale, pl[0].y / scale)
      for (const q of pl.slice(1)) p.lineTo(q.x / scale, q.y / scale)
      p.closePath()
    }
    return p
  }
  for (let k = 1; k <= steps; k++) {
    const p = k / steps
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, gw, gh)
    g.fillStyle = '#000'
    let any = false
    for (const s of wipe.strokes) {
      const q = Math.min(1, Math.max(0, (p - s.span[0]) / (s.span[1] - s.span[0])))
      const e = q * q * q * (q * (q * 6 - 15) + 10)
      if (e <= 0) continue
      g.fill(path(e >= 1 ? s.polys : s.outline(e)))
      any = true
    }
    if (!any) continue
    const d = g.getImageData(0, 0, gw, gh).data
    for (let i = 0; i < T.length; i++) if (T[i] < 0 && d[i * 4 + 3] > 127) T[i] = p - 0.5 / steps
  }
  fillGaps(T, gw, gh)
  // rayas secas del ladrillo
  g.clearRect(0, 0, gw, gh)
  g.strokeStyle = '#000'
  g.lineCap = 'round'
  for (const s of wipe.strokes)
    for (const st of s.streaks) {
      g.lineWidth = Math.max(0.6, st.w / scale)
      g.beginPath()
      g.moveTo(st.pts[0].x / scale, st.pts[0].y / scale)
      for (const q of st.pts.slice(1)) g.lineTo(q.x / scale, q.y / scale)
      g.stroke()
    }
  const sd = g.getImageData(0, 0, gw, gh).data
  const gap = new Float32Array(T.length)
  for (let i = 0; i < gap.length; i++) gap[i] = sd[i * 4 + 3] / 255
  const dir = wipe.strokes[0]?.dir ?? { x: 1, y: 0 }
  return { gw, gh, scale, T, L: liftField(T, gw, gh, dir, gw * 31 + gh, scale), gap }
}
