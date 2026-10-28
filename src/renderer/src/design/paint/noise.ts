// Ruido de valor con semilla (2D): el moteado del pigmento, el grano del papel y el diente que rompe los bordes.
import { rngFrom } from './random'

const SIZE = 256
const MASK = SIZE - 1

export interface Noise {
  /** Ruido suave en [0, 1] (una octava). */
  at(x: number, y: number): number
  /** Suma de octavas en [0, 1]: rasgos grandes con detalle encima. */
  fbm(x: number, y: number, octaves?: number): number
  /** Ruido blanco estable por píxel en [0, 1] (las motas sueltas de la granulación). */
  hash(x: number, y: number): number
}

export function createNoise(seed: number): Noise {
  const rng = rngFrom(seed)
  const values = new Float32Array(SIZE)
  for (let i = 0; i < SIZE; i++) values[i] = rng()
  const perm = new Uint8Array(SIZE * 2)
  const p = Array.from({ length: SIZE }, (_, i) => i)
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < SIZE * 2; i++) perm[i] = p[i & MASK]
  const lattice = (ix: number, iy: number) => values[perm[(perm[ix & MASK] + iy) & 0x1ff]]

  const at = (x: number, y: number) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = lattice(x0, y0)
    const b = lattice(x0 + 1, y0)
    const c = lattice(x0, y0 + 1)
    const d = lattice(x0 + 1, y0 + 1)
    const top = a + (b - a) * sx
    const bottom = c + (d - c) * sx
    return top + (bottom - top) * sy
  }
  const fbm = (x: number, y: number, octaves = 4) => {
    let sum = 0
    let amp = 0.5
    let norm = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      // cada octava, desplazada, para que no se alineen sus rejillas
      sum += amp * at(x * f + o * 17.3, y * f - o * 9.1)
      norm += amp
      amp *= 0.5
      f *= 2.03
    }
    return sum / norm
  }
  const hash = (x: number, y: number) => {
    let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) + seed, 0x9e3779b1)
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
    h ^= h >>> 13
    return (h >>> 0) / 4294967296
  }
  return { at, fbm, hash }
}

/**
 * Campo de ruido fractal de w×h muestreado en una rejilla gruesa (cada `step` píxeles) e interpolado: para los rasgos grandes
 * (el moteado) no hace falta evaluar cada píxel. `scale` es el tamaño del rasgo en píxeles.
 */
export function fbmField(noise: Noise, w: number, h: number, scale: number, octaves = 3, step = 4, scaleY = scale): Float32Array {
  const gw = Math.ceil(w / step) + 2
  const gh = Math.ceil(h / step) + 2
  const grid = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) grid[gy * gw + gx] = noise.fbm((gx * step) / scale, (gy * step) / scaleY, octaves)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const gyf = y / step
    const gy = Math.floor(gyf)
    const ty = gyf - gy
    for (let x = 0; x < w; x++) {
      const gxf = x / step
      const gx = Math.floor(gxf)
      const tx = gxf - gx
      const i = gy * gw + gx
      const a = grid[i] + (grid[i + 1] - grid[i]) * tx
      const b = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * tx
      out[y * w + x] = a + (b - a) * ty
    }
  }
  return out
}
