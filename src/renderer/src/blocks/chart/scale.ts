// Escalas de los gráficos de datos (barras, líneas, sectores, dispersión): datos seguros, dominio con marcas limpias, bandas
// de las barras y sectores. Lógica pura (se prueba aparte).
import type { ChartPoint, ChartSeries } from '@shared/schema/blocks'
import { niceStep, ticks } from '../plot/ticks'

const clampNum = (v: number, lo: number, hi: number, fallback: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback)

/** Datos seguros: como mucho 12 series × 500 puntos, valores acotados a ±1e12 y nombres de serie únicos. */
export function safeSeries(series: ChartSeries[]): ChartSeries[] {
  const seen = new Set<string>()
  return series.slice(0, 12).map((s) => {
    let name = s.name
    let k = 2
    while (seen.has(name)) name = `${s.name} (${k++})`
    seen.add(name)
    const points: ChartPoint[] = s.points.slice(0, 500).map((p) => ({
      ...p,
      y: clampNum(p.y, -1e12, 1e12, 0),
      x: p.x === undefined ? undefined : clampNum(p.x, -1e12, 1e12, 0)
    }))
    return { ...s, name, points }
  })
}

/** ¿Eje x de categorías? Ningún punto trae `x` y alguno trae `label`. */
export function isCategoricalX(series: ChartSeries[]): boolean {
  return !series.some((s) => s.points.some((p) => p.x !== undefined)) && series.some((s) => s.points.some((p) => !!p.label))
}

/** Nombre de la categoría i-ésima: la etiqueta del primer punto que la tenga, o la x, o su número. */
export function categoryLabels(series: ChartSeries[], fmt: (v: number) => string = String): string[] {
  const n = Math.max(0, ...series.map((s) => s.points.length))
  return Array.from({ length: n }, (_, i) => {
    for (const s of series) {
      const p = s.points[i]
      if (p?.label) return p.label
    }
    for (const s of series) {
      const p = s.points[i]
      if (p?.x !== undefined) return fmt(p.x)
    }
    return String(i + 1)
  })
}

export interface Domain {
  lo: number
  hi: number
  step: number
  ticks: number[]
}

/** Dominio con marcas limpias que contiene [min, max]; con `zero`, incluye el 0 (barras y áreas nacen en la base). */
export function niceDomain(min: number, max: number, target: number, zero = true): Domain {
  let lo = Number.isFinite(min) ? min : 0
  let hi = Number.isFinite(max) ? max : 1
  if (zero) {
    lo = Math.min(lo, 0)
    hi = Math.max(hi, 0)
  }
  if (hi - lo < 1e-12) {
    if (hi === 0) hi = 1
    else if (hi > 0) lo = zero ? 0 : hi - Math.abs(hi) * 0.5 - 1
    else hi = 0
  }
  const step = niceStep(hi - lo, Math.max(2, target))
  const a = Math.floor(lo / step + 1e-9) * step
  const b = Math.ceil(hi / step - 1e-9) * step
  return { lo: a, hi: b > a ? b : a + step, step, ticks: ticks(a, b > a ? b : a + step, step) }
}

/** Extremos de los valores (con apilado: la suma de positivos y la de negativos por categoría). */
export function valueExtent(series: ChartSeries[], stacked: boolean): [number, number] {
  if (!series.length) return [0, 1]
  if (stacked) {
    const n = Math.max(...series.map((s) => s.points.length))
    let lo = 0
    let hi = 0
    for (let i = 0; i < n; i++) {
      let pos = 0
      let neg = 0
      for (const s of series) {
        const y = s.points[i]?.y ?? 0
        if (y >= 0) pos += y
        else neg += y
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    }
    return [lo, hi]
  }
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite)
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1]
}

/** Extremos de las x numéricas (la x que falta es su posición). */
export function xExtent(series: ChartSeries[]): [number, number] {
  const xs = series.flatMap((s) => s.points.map((p, i) => p.x ?? i)).filter(Number.isFinite)
  if (!xs.length) return [0, 1]
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1]
}

export interface Band {
  /** Inicio de la banda de la categoría (px). */
  start: number
  width: number
  /** Ancho de cada barra y su separación dentro del grupo. */
  bar: number
  gap: number
}

/**
 * Bandas de un gráfico de barras: `n` categorías con `groups` barras cada una en `width` px. Las barras miden como mucho
 * `maxBar` px (el resto de la banda es aire); en un histograma llenan la banda con 2 px de separación.
 */
export function bands(n: number, groups: number, width: number, opts: { histogram?: boolean; maxBar?: number } = {}): Band[] {
  if (n <= 0 || width <= 0) return []
  const g = Math.max(1, groups)
  const slot = width / n
  if (opts.histogram) {
    const gap = 2
    const bar = Math.max(1, (slot - gap) / g)
    return Array.from({ length: n }, (_, i) => ({ start: i * slot + gap / 2, width: slot, bar, gap: 0 }))
  }
  const maxBar = opts.maxBar ?? 28
  const inner = 2
  const usable = slot * 0.72
  const bar = Math.max(2, Math.min(maxBar, (usable - inner * (g - 1)) / g))
  const groupW = bar * g + inner * (g - 1)
  return Array.from({ length: n }, (_, i) => ({ start: i * slot + (slot - groupW) / 2, width: slot, bar, gap: inner }))
}

export interface Slice {
  index: number
  value: number
  share: number
  a0: number
  a1: number
}

/** Sectores (ángulos en radianes desde arriba, en sentido horario). Solo cuentan los valores positivos; como mucho 60. */
export function pieSlices(values: number[]): Slice[] {
  const vs = values.slice(0, 60).map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = vs.reduce((a, b) => a + b, 0)
  if (total <= 0) return []
  const out: Slice[] = []
  let a = 0
  vs.forEach((v, index) => {
    if (v <= 0) return
    const share = v / total
    const a1 = a + share * Math.PI * 2
    out.push({ index, value: v, share, a0: a, a1 })
    a = a1
  })
  return out
}

/** Camino SVG de un sector de corona (r0 = 0: sector lleno). Ángulos desde las 12 en sentido horario. */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = Math.min(a1 - a0, Math.PI * 2 - 1e-6)
  if (span <= 0) return ''
  const e = a0 + span
  const pt = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`
  const large = span > Math.PI ? 1 : 0
  if (r0 <= 0) return `M ${cx} ${cy} L ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, e)} Z`
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, e)} L ${pt(r0, e)} A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`
}

/** Cifra compacta para el eje (1200 → «1,2 mil» / «1.2K»). */
export function compactNumber(v: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang || 'en', { notation: Math.abs(v) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 })
      .format(v)
      .replace('-', '−')
  } catch {
    return String(v)
  }
}

/**
 * Camino suave que pasa por los puntos sin pasarse (cúbica monótona de Fritsch–Carlson): no inventa máximos ni mínimos
 * entre dos datos, a diferencia de Catmull-Rom. Los puntos van ordenados por x.
 */
export function smoothPath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x} ${pts[0].y}`
  if (n === 2) return `M${pts[0].x} ${pts[0].y}L${pts[1].x} ${pts[1].y}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x)
    m.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i])
  }
  const tan: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]))
  tan.push(m[n - 2])
  const f = (v: number) => (Math.round(v * 10) / 10).toString()
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${f(pts[i].x + h)} ${f(pts[i].y + tan[i] * h)} ${f(pts[i + 1].x - h)} ${f(pts[i + 1].y - tan[i + 1] * h)} ${f(pts[i + 1].x)} ${f(pts[i + 1].y)}`
  }
  return d
}

/** Junta los sectores pequeños en «Otros» para no pasar de `max` colores (la novena serie nunca es un color nuevo). */
export function foldSlices(items: Array<{ label: string; value: number }>, max: number, otherLabel: string): Array<{ label: string; value: number; other?: boolean }> {
  const positive = items.filter((x) => Number.isFinite(x.value) && x.value > 0)
  if (positive.length <= max) return positive
  const sorted = [...positive].sort((a, b) => b.value - a.value)
  const keep = new Set(sorted.slice(0, max - 1))
  const rest = sorted.slice(max - 1).reduce((a, b) => a + b.value, 0)
  return [...positive.filter((x) => keep.has(x)), { label: otherLabel, value: rest, other: true }]
}
