// Base del corto animado de Aula: medidas, tiempo, azar con semilla, ruido y color. Todo determinista: el mismo
// fotograma sale igual siempre (no se usa Math.random ni el reloj).

/** Lienzo del máster. La imagen va en panorámico (2,39:1) con franjas negras que se abren en el clímax. */
export const W = 1920
export const H = 1080
export const FPS = 24

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** 0→1 entre a y b (recortado). */
export const seg = (t: number, a: number, b: number): number => clamp((t - a) / (b - a))
export const smooth = (t: number): number => {
  const x = clamp(t)
  return x * x * (3 - 2 * x)
}
export const ease = {
  io: (t: number): number => {
    const x = clamp(t)
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  },
  out: (t: number): number => 1 - Math.pow(1 - clamp(t), 3),
  in: (t: number): number => Math.pow(clamp(t), 3),
  outExpo: (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t))),
  outBack: (t: number): number => {
    const x = clamp(t) - 1
    return 1 + 2.2 * x * x * x + 1.2 * x * x
  }
}
/** Campana: sube de a a b, se queda y baja de c a d. */
export const bell = (t: number, a: number, b: number, c: number, d: number): number => Math.min(seg(t, a, b), 1 - seg(t, c, d))

/** Generador con semilla (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Azar fijo de un entero: [0, 1). */
export function hash(n: number, seed = 0): number {
  let h = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Ruido suave en una dimensión: [-1, 1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1
}

/** Ruido suave en dos dimensiones: [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const h = (a: number, b: number): number => hash(a + b * 57, seed)
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v) * 2 - 1
}

/** Ruido de varias octavas: [-1, 1] aprox. */
export function fbm(x: number, y: number, seed = 0, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * f, y * f, seed + o * 17) * amp
    amp *= 0.5
    f *= 2
  }
  return sum
}

export type RGB = [number, number, number]
export function rgb(hex: string): RGB {
  // también acepta lo que devuelven `mix` y `col` («rgba(r,g,b,a)»)
  if (hex.startsWith('rgb')) {
    const n = hex.slice(hex.indexOf('(') + 1).split(',').map(Number)
    return [n[0], n[1], n[2]]
  }
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
export const css = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+a.toFixed(4)})`
export const col = (hex: string, a = 1): string => css(rgb(hex), a)
export function mix(a: string, b: string, t: number, alpha = 1): string {
  const A = rgb(a)
  const B = rgb(b)
  const k = clamp(t)
  return css([lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)], alpha)
}

/** Paleta del corto: la noche fría, la luz de Aula y el amanecer de acuarela. */
export const P = {
  night0: '#0b0e1a', night1: '#131a2e', night2: '#1f2a44', night3: '#33405f', mist: '#5d6a8a',
  ink: '#16130f', inkSoft: '#2a2520', paper: '#f6efe2', paper2: '#e9dfcc', paperShade: '#cdbfa6',
  brick: '#bf5a36', brickDeep: '#8f3b20', brickLight: '#ea9a6c', sun: '#f2b24a', sunCore: '#fff1cf', glow: '#f7c877',
  dawn0: '#fbe9d2', dawn1: '#f6cfae', dawn2: '#e9a98c', dawn3: '#b7c4d6', dawn4: '#8ea4c0', sky: '#dfe7ee',
  leaf: '#7f9a78', sea: '#6f93a8'
}

export interface Pt { x: number; y: number }

/** Pasa una lista de puntos a una curva suave (Catmull-Rom → Bézier) en un Path2D. */
export function smoothPath(pts: Pt[], closed = false): Path2D {
  const p = new Path2D()
  const n = pts.length
  if (n < 2) return p
  const at = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)])
  p.moveTo(pts[0].x, pts[0].y)
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    p.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y)
  }
  if (closed) p.closePath()
  return p
}

/** Hace temblar un contorno con ruido (el pulso de la mano). `boil` cambia la semilla para que el trazo «hierva». */
export function wobble(pts: Pt[], amp: number, freq = 0.02, seed = 1): Pt[] {
  return pts.map((q, i) => ({ x: q.x + noise2(q.x * freq, q.y * freq + i * 0.13, seed) * amp, y: q.y + noise2(q.y * freq + 31.7, q.x * freq + i * 0.11, seed + 5) * amp }))
}

/** Reparte N puntos a lo largo de una polilínea. */
export function resample(pts: Pt[], n: number): Pt[] {
  const d: number[] = [0]
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = d[d.length - 1] || 1
  const out: Pt[] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    while (j < pts.length - 1 && d[j] < target) j++
    const t = (target - d[j - 1]) / (d[j] - d[j - 1] || 1)
    out.push({ x: lerp(pts[j - 1].x, pts[j].x, t), y: lerp(pts[j - 1].y, pts[j].y, t) })
  }
  return out
}
