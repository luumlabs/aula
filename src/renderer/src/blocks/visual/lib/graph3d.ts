// Gráfica en ejes 3D: de la descripción del bloque (superficies z = f(x, y), curvas, vectores y puntos, con z hacia arriba)
// a la geometría que pinta la escena. Puro: quien lo usa le da cómo evaluar las expresiones.
import type { Graph3D, Triple } from '@shared/schema/visual'

/** Muestras por lado de una superficie (la malla tiene SAMPLES² vértices). */
export const SAMPLES = 49
/** Cada cuántas muestras se dibuja una línea de la retícula sobre la superficie. */
export const GRID_EVERY = 4
/** Tamaño de la gráfica en la escena: el lado mayor del suelo mide esto. */
export const FLOOR = 6
/** Altura máxima en la escena: una función que crece mucho se aplasta en z para que se vea entera. */
export const MAX_HEIGHT = 4.2

export type XY = (x: number, y: number) => number | null
export type OfT = (t: number) => number | null

export interface SurfaceMesh {
  /** Vértices en coordenadas de la escena (x, alto, fondo). */
  positions: Float32Array
  indices: Uint32Array
  /** Segmentos de la retícula (pares de puntos). */
  grid: Float32Array
}

export interface GraphLayout {
  zMin: number
  zMax: number
  /** De coordenadas de la gráfica (z arriba) a la escena de three (y arriba). */
  toScene: (x: number, y: number, z: number) => Triple
  surfaces: Array<SurfaceMesh | null>
  curves: Triple[][]
  /** Centro y radio de lo dibujado, en la escena. */
  center: Triple
  radius: number
  /** Dónde pasan los ejes (el origen si cae dentro; si no, el borde más cercano). */
  origin: Triple
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Rango de z: el que se dio o el que alcanzan las superficies, las curvas, los vectores y los puntos. */
export function zRange(g: Graph3D, values: number[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  if (!Number.isFinite(lo)) { lo = -1; hi = 1 }
  // el plano z = 0 a la vista cuando queda cerca: se entiende mejor dónde está «el suelo»
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0
  if (hi < 0 && -hi < (hi - lo) * 0.6) hi = 0
  if (hi - lo < 1e-9) { lo -= 1; hi += 1 }
  return [g.zMin ?? lo, g.zMax ?? hi]
}

/**
 * Calcula la gráfica. `surface(expr)` y `curve(expr)` compilan una expresión (null si no se entiende): una superficie que
 * no compila deja su hueco (`null`) y el resto se dibuja.
 */
export function layoutGraph(g: Graph3D, surface: (expr: string) => XY | null, curve: (expr: string) => OfT | null): GraphLayout {
  const xr = Math.max(1e-9, g.xMax - g.xMin)
  const yr = Math.max(1e-9, g.yMax - g.yMin)
  const n = SAMPLES

  // 1) se muestrean las superficies y las curvas en coordenadas de la gráfica
  const heights = g.surfaces.map((s) => {
    const f = surface(s.expr)
    if (!f) return null
    const z = new Float64Array(n * n).fill(NaN)
    for (let j = 0; j < n; j++) {
      const y = g.yMin + (yr * j) / (n - 1)
      for (let i = 0; i < n; i++) {
        const v = f(g.xMin + (xr * i) / (n - 1), y)
        if (finite(v)) z[j * n + i] = v
      }
    }
    return z
  })
  const paths = g.curves.map((c) => {
    const fx = curve(c.x), fy = curve(c.y), fz = curve(c.z)
    const out: Triple[] = []
    if (!fx || !fy || !fz) return out
    const steps = 240
    for (let k = 0; k <= steps; k++) {
      const t = c.tMin + ((c.tMax - c.tMin) * k) / steps
      const x = fx(t), y = fy(t), z = fz(t)
      if (finite(x) && finite(y) && finite(z)) out.push([x, y, z])
    }
    return out
  })

  // 2) el rango de z y la escala (z se aplasta si hace falta; x e y comparten escala)
  const zs: number[] = []
  for (const z of heights) if (z) {
    const sorted = Array.from(z).filter(Number.isFinite).sort((a, b) => a - b)
    if (!sorted.length) continue
    const lo = sorted[Math.floor(sorted.length * 0.02)]
    const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.98))]
    // con una asíntota (1/x, tan) unos pocos valores se disparan: entonces manda el 96 % central; si no, todo el rango
    const spiky = sorted[sorted.length - 1] - sorted[0] > 6 * Math.max(1e-9, hi - lo)
    zs.push(spiky ? lo : sorted[0], spiky ? hi : sorted[sorted.length - 1])
  }
  for (const p of paths) for (const q of p) zs.push(q[2])
  for (const v of g.vectors) zs.push(v.from[2], v.to[2])
  for (const p of g.points) zs.push(p.z)
  const [zMin, zMax] = zRange(g, zs)
  const s = FLOOR / Math.max(xr, yr)
  const zr = zMax - zMin
  const sz = zr * s > MAX_HEIGHT ? MAX_HEIGHT / zr : s
  const cx = (g.xMin + g.xMax) / 2
  const cy = (g.yMin + g.yMax) / 2
  const toScene = (x: number, y: number, z: number): Triple => [(x - cx) * s, (z - zMin) * sz, -(y - cy) * s]

  // 3) mallas: las celdas con sus cuatro esquinas definidas y alguna dentro del rango (las que cruzan el límite se
  //    aplanan contra él: el corte queda limpio, no en dientes de sierra)
  const inside = (v: number): boolean => Number.isFinite(v) && v >= zMin - 1e-9 && v <= zMax + 1e-9
  const surfaces = heights.map((z): SurfaceMesh | null => {
    if (!z) return null
    const positions = new Float32Array(n * n * 3)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        const p = toScene(g.xMin + (xr * i) / (n - 1), g.yMin + (yr * j) / (n - 1), inside(z[k]) ? z[k] : clamp(Number.isFinite(z[k]) ? z[k] : zMin, zMin, zMax))
        positions.set(p, k * 3)
      }
    const indices: number[] = []
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1
        const defined = Number.isFinite(z[a]) && Number.isFinite(z[b]) && Number.isFinite(z[c]) && Number.isFinite(z[d])
        if (defined && (inside(z[a]) || inside(z[b]) || inside(z[c]) || inside(z[d]))) indices.push(a, c, b, b, c, d)
      }
    const grid: number[] = []
    const seg = (a: number, b: number): void => {
      if (!inside(z[a]) || !inside(z[b])) return
      grid.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2], positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2])
    }
    for (let j = 0; j < n; j += GRID_EVERY) for (let i = 0; i < n - 1; i++) seg(j * n + i, j * n + i + 1)
    for (let i = 0; i < n; i += GRID_EVERY) for (let j = 0; j < n - 1; j++) seg(j * n + i, (j + 1) * n + i)
    return { positions, indices: new Uint32Array(indices), grid: new Float32Array(grid) }
  })

  const height = zr * sz
  const half: Triple = [(xr * s) / 2, height / 2, (yr * s) / 2]
  const origin: Triple = [clamp(0, g.xMin, g.xMax), clamp(0, g.yMin, g.yMax), clamp(0, zMin, zMax)]
  return {
    zMin, zMax, toScene, surfaces,
    curves: paths.map((p) => p.map(([x, y, z]) => toScene(x, y, clamp(z, zMin, zMax)))),
    center: [0, height / 2, 0],
    // algo menos que la esfera que lo envuelve: una caja vista en diagonal no llena su esfera y quedaría pequeña
    radius: Math.hypot(half[0], half[1], half[2]) * 0.8 + 0.35,
    origin
  }
}

/** Texto corto de un número de eje («2», «−1,5», «3,14»). */
export function axisNumber(v: number, format: (v: number) => string): string {
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100
  return format(Object.is(r, -0) ? 0 : r)
}

const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ' }
const SYMBOLS: Record<string, string> = { nabla: '∇', partial: '∂', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', lambda: 'λ', cdot: '·', times: '×', vec: '', mathbf: '', sqrt: '√', infty: '∞', le: '≤', ge: '≥', neq: '≠' }

/**
 * Una etiqueta de la escena 3D, legible sin KaTeX (van sobre el lienzo, en texto llano): «$z = x^2 - y^2$» → «z = x² − y²»,
 * «\\nabla f» → «∇f», «2*x» → «2·x». Lo que no se sabe traducir se deja sin barras ni llaves.
 */
export function plainMathLabel(label: string): string {
  return label
    .replace(/\$/g, '')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\([a-zA-Z]+)\s?/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/\^\{?(-?[0-9n+]+)\}?/g, (_, exp: string) => [...exp].map((c) => SUPERSCRIPT[c] ?? c).join(''))
    .replace(/[{}]/g, '')
    .replace(/\s*\*\s*/g, '·')
    .replace(/ - /g, ' − ')
    .replace(/\s+/g, ' ')
    .trim()
}

