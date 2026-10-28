// Estadística (puro): lectura tolerante de listas pegadas (con coma decimal o no), resumen descriptivo con cuartiles,
// histograma con clases «bonitas», regresión lineal y probabilidades de la normal. La media, la mediana, la varianza y
// la desviación típica salen del motor (src/engine/math/eval/statistics); los cuartiles y la regresión, de aquí.
import { Statistics } from '@engine/math/eval/statistics'
import { parseNumber } from '../../shared/lib/num'

/**
 * Lee una lista de números pegada de cualquier sitio: separados por saltos de línea, espacios, tabuladores, «;» o
 * comas. Con `comma` (español), «1,5» es un decimal salvo que la coma vaya seguida de un espacio («1, 2, 3»).
 */
export function parseList(text: string, comma: boolean): { values: number[]; bad: string[] } {
  const values: number[] = []
  const bad: string[] = []
  let src = text.replace(/[−–]/g, '-')
  // «1, 2, 3» o «1,2,3» (en inglés): la coma separa
  src = comma ? src.replace(/,\s+/g, ' ') : src.replace(/,/g, ' ')
  for (const tok of src.split(/[\s;]+/)) {
    if (!tok) continue
    const v = parseNumber(tok)
    if (v === null || !Number.isFinite(v)) bad.push(tok)
    else values.push(v)
  }
  return { values, bad }
}

/** Pares (x, y) por líneas: «1 2», «1;2», «1\t2» (y «1, 2» en inglés). */
export function parsePairs(text: string, comma: boolean): { pairs: [number, number][]; bad: number } {
  const pairs: [number, number][] = []
  let bad = 0
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) continue
    const { values } = parseList(line, comma)
    if (values.length === 2) pairs.push([values[0], values[1]])
    else bad++
  }
  return { pairs, bad }
}

/** Mediana de una lista ya ordenada. */
function medianSorted(s: number[]): number {
  const n = s.length
  if (!n) return NaN
  const m = Math.floor(n / 2)
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Summary {
  n: number
  sum: number
  mean: number
  median: number
  modes: number[]
  min: number
  max: number
  range: number
  q1: number
  q3: number
  iqr: number
  varSample: number
  varPop: number
  sdSample: number
  sdPop: number
  outliers: number[]
  /** Bigotes del diagrama de caja (dato más extremo dentro de 1,5·RIC). */
  whiskers: [number, number]
}

/** Resumen descriptivo. Cuartiles por medianas de las mitades (sin la mediana si n es impar), como las calculadoras TI. */
export function summarize(xs: number[]): Summary | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  const half = Math.floor(n / 2)
  const lower = s.slice(0, half)
  const upper = s.slice(n % 2 ? half + 1 : half)
  const q1 = n > 1 ? medianSorted(lower) : s[0]
  const q3 = n > 1 ? medianSorted(upper) : s[0]
  const iqr = q3 - q1
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  const inside = s.filter((x) => x >= lo && x <= hi)
  // moda: los valores más repetidos (ninguna si todos aparecen una vez)
  const counts = new Map<number, number>()
  for (const x of s) counts.set(x, (counts.get(x) ?? 0) + 1)
  const top = Math.max(...counts.values())
  const modes = top > 1 ? [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v) : []
  const safe = (name: string) => {
    try {
      return Statistics.apply(name, s)
    } catch {
      return NaN
    }
  }
  return {
    n,
    sum: s.reduce((a, b) => a + b, 0),
    mean: safe('mean'),
    median: safe('median'),
    modes,
    min: s[0],
    max: s[n - 1],
    range: s[n - 1] - s[0],
    q1,
    q3,
    iqr,
    varSample: n > 1 ? safe('var') : NaN,
    varPop: safe('pvar'),
    sdSample: n > 1 ? safe('stdev') : NaN,
    sdPop: safe('pstdev'),
    outliers: s.filter((x) => x < lo || x > hi),
    whiskers: [inside[0] ?? s[0], inside[inside.length - 1] ?? s[n - 1]]
  }
}

export interface Bin {
  lo: number
  hi: number
  count: number
}

/** Histograma con `k` clases de anchura «bonita» (1, 2, 2,5 o 5 × 10ⁿ) que cubren todos los datos. */
export function histogram(xs: number[], k?: number): Bin[] {
  if (!xs.length) return []
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const bins = Math.max(1, Math.min(40, k ?? Math.ceil(Math.log2(xs.length) + 1)))
  if (max === min) return [{ lo: min - 0.5, hi: max + 0.5, count: xs.length }]
  const raw = (max - min) / bins
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const width = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((w) => w >= raw * 0.999) ?? raw
  const start = Math.floor(min / width) * width
  const count = Math.max(1, Math.ceil((max - start) / width + 1e-9))
  const out: Bin[] = Array.from({ length: count }, (_, i) => ({ lo: start + i * width, hi: start + (i + 1) * width, count: 0 }))
  for (const x of xs) {
    let i = Math.floor((x - start) / width + 1e-9)
    if (i >= count) i = count - 1
    out[i].count++
  }
  return out
}

export interface Regression {
  slope: number
  intercept: number
  r: number
  r2: number
  n: number
  meanX: number
  meanY: number
}

/** Recta de regresión por mínimos cuadrados (y = a·x + b) y coeficiente de correlación de Pearson. */
export function linearRegression(pairs: [number, number][]): Regression | null {
  const n = pairs.length
  if (n < 2) return null
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n
  const my = pairs.reduce((a, p) => a + p[1], 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pairs) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const r = syy === 0 ? 1 : sxy / Math.sqrt(sxx * syy)
  return { slope, intercept: my - slope * mx, r, r2: r * r, n, meanX: mx, meanY: my }
}

/** Densidad de la normal. */
export function normalPdf(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
}

/** P(a ≤ X ≤ b) para X ~ N(μ, σ). Los límites pueden ser ±∞. */
export function normalProb(a: number, b: number, mu: number, sigma: number): number {
  if (!(sigma > 0)) return NaN
  const za = a === -Infinity ? -Infinity : (a - mu) / sigma
  const zb = b === Infinity ? Infinity : (b - mu) / sigma
  const cdf = (z: number) => (z === -Infinity ? 0 : z === Infinity ? 1 : Statistics.normalCDF(z))
  return Math.max(0, cdf(zb) - cdf(za))
}

/** Valor x con P(X ≤ x) = p. */
export function normalQuantile(p: number, mu: number, sigma: number): number {
  if (!(p > 0 && p < 1) || !(sigma > 0)) return NaN
  return mu + sigma * Statistics.inverseNormal(p)
}
