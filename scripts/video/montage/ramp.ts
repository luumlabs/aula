// V6 · cámara lenta con rampa: el tiempo de una toma, de la cámara del portátil, de un dibujo o de los efectos corre
// rápido, muy lento en el momento clave y rápido otra vez, sin mover lo de fuera (en `from`, `at` y `to` cada cosa va a
// su hora) y sin tirones (velocidad 1 en los extremos, curva suave). Puro: lo usan el compositor, la hoja de efectos y
// las pruebas.
import type { Ramp } from './types.ts'

const N = 1024
const sstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * u * (u * (u * 6 - 15) + 10)
}

interface Table {
  /** Tiempo deformado acumulado (0–1) en N + 1 muestras de [0, 1]. */
  tau: Float64Array
  /** Velocidad en cada muestra. */
  speed: Float64Array
}
const tables = new WeakMap<Ramp, Table>()

/** La velocidad de la rampa (sin normalizar por lado) y su integral, tabuladas. */
function table(r: Ramp): Table {
  let tb = tables.get(r)
  if (tb) return tb
  const L = Math.max(1e-6, r.to - r.from)
  const c = Math.min(0.95, Math.max(0.05, ((r.at ?? (r.from + r.to) / 2) - r.from) / L))
  const w = Math.max(0.01, (r.width ?? 0.18 * L) / L)
  const tr = Math.max(0.04, Math.min(0.22, Math.min(c, 1 - c) - w))
  const e0 = Math.min(0.14, c * 0.5, (1 - c) * 0.5)
  // lentitud (1 junto al momento) y borde (0 en los extremos: velocidad 1)
  const g = (x: number) => 1 - sstep(w, w + tr, Math.abs(x - c))
  const e = (x: number) => sstep(0, e0, x) * sstep(0, e0, 1 - x)
  const xs = Array.from({ length: N + 1 }, (_, i) => i / N)
  // en cada lado, la velocidad rápida F que conserva el tiempo de ese lado (el momento cae a su hora)
  const side = (lo: number, hi: number) => {
    let base = 0
    let fast = 0
    for (let i = 0; i < N; i++) {
      const x = (xs[i] + xs[i + 1]) / 2
      if (x < lo || x > hi) continue
      const ee = e(x)
      const gg = g(x)
      base += ((1 - ee) + ee * r.slow * gg) / N
      fast += (ee * (1 - gg)) / N
    }
    return fast > 1e-9 ? Math.max(0, (hi - lo - base) / fast) : 1
  }
  const FL = side(0, c)
  const FR = side(c, 1)
  const speed = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) {
    const x = xs[i]
    const ee = e(x)
    const gg = g(x)
    speed[i] = (1 - ee) + ee * (r.slow * gg + (x <= c ? FL : FR) * (1 - gg))
  }
  const tau = new Float64Array(N + 1)
  for (let i = 1; i <= N; i++) tau[i] = tau[i - 1] + (speed[i - 1] + speed[i]) / 2 / N
  // corrige el redondeo de la integral por lados: τ(c) = c y τ(1) = 1 exactos
  const ic = Math.round(c * N)
  const kL = c / (tau[ic] || 1)
  const kR = (1 - c) / (tau[N] - tau[ic] || 1)
  const tc = tau[ic]
  for (let i = 0; i <= N; i++) tau[i] = i <= ic ? tau[i] * kL : c + (tau[i] - tc) * kR
  tb = { tau, speed }
  tables.set(r, tb)
  return tb
}

const sample = (arr: Float64Array, x: number) => {
  const f = Math.min(N, Math.max(0, x * N))
  const i = Math.min(N - 1, Math.floor(f))
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i)
}

/** El tiempo deformado por las rampas (fuera de ellas, el mismo). */
export function warp(ramps: Ramp[] | undefined, t: number): number {
  for (const r of ramps ?? []) {
    if (t <= r.from || t >= r.to) continue
    const L = r.to - r.from
    return r.from + L * sample(table(r).tau, (t - r.from) / L)
  }
  return t
}

/** La velocidad (tiempo deformado por segundo) en t. */
export function warpSpeed(ramps: Ramp[] | undefined, t: number): number {
  for (const r of ramps ?? []) {
    if (t <= r.from || t >= r.to) continue
    const h = Math.min(1e-3, (r.to - r.from) / (4 * N))
    return (warp([r], t + h) - warp([r], t - h)) / (2 * h)
  }
  return 1
}

/** El instante sin deformar en que el tiempo deformado vale `tau` (la inversa: para colocar un clic en el vídeo). */
export function unwarp(ramps: Ramp[] | undefined, tau: number): number {
  for (const r of ramps ?? []) {
    if (tau <= r.from || tau >= r.to) continue
    let lo = r.from
    let hi = r.to
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (warp([r], mid) < tau) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  return tau
}

/** El segundo de la toma que se ve en `local` s del plano (con su velocidad y sus rampas). */
export function clipSource(clip: { from?: number; speed?: number; ramps?: Ramp[] }, local: number): number {
  return (clip.from ?? 0) + (clip.speed ?? 1) * warp(clip.ramps, local)
}

/** El instante del plano (s desde su inicio) en que se ve el segundo `src` de la toma. */
export function clipLocalOf(clip: { from?: number; speed?: number; ramps?: Ramp[] }, src: number): number {
  return unwarp(clip.ramps, (src - (clip.from ?? 0)) / (clip.speed ?? 1))
}

/** Velocidad mínima de un plano (la de su tramo más lento). */
export function minSpeed(clip: { speed?: number; ramps?: Ramp[] }): number {
  return (clip.speed ?? 1) * Math.min(1, ...(clip.ramps ?? []).map((r) => r.slow))
}
