// La graficadora exacta del chat (port de GraphAnalysis de AssistantStudyTools.swift): para y = f(x) encuentra ceros, máximos y
// mínimos, el corte con el eje y y los saltos o asíntotas en [x_min, x_max], y arma un bloque `plot` listo para dibujar.
import type { JSONObject, JSONValue } from '@engine/base/json'
import { MathParser, derivative, evaluateDouble, freeVariables, NumberFormat, type Expr } from '@engine/math'

export interface KeyPoint { x: number; y: number; kind: 'maximum' | 'minimum' }

export interface GraphResult {
  expr: string
  label: string
  zeros: number[]
  extrema: KeyPoint[]
  yIntercept?: number
  breaks: number[]
  yRange?: [number, number]
  piTicks: boolean
}

/** Un número o una expresión sin variables («2pi», «-3/2», «sqrt(2)»). */
export function graphNumber(s: string): number | undefined {
  const t = s.trim()
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return Number(t)
  try {
    const e = MathParser.parse(t)
    if (freeVariables(e).size > 0) return undefined
    const v = evaluateDouble(e)
    return Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

function bisect(g: (x: number) => number | undefined, a0: number, b0: number): number | undefined {
  let a = a0, b = b0
  let fa = g(a)
  const fb = g(b)
  if (fa === undefined || fb === undefined || fa * fb > 0) return undefined
  if (fa === 0) return a
  if (fb === 0) return b
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2
    const fm = g(m)
    if (fm === undefined) return undefined
    if (fm === 0) return m
    if (fa * fm < 0) b = m
    else { a = m; fa = fm }
  }
  return (a + b) / 2
}

function dedupe(xs: number[], tol: number): number[] {
  const out: number[] = []
  for (const x of [...xs].sort((p, q) => p - q)) if (!out.some((o) => Math.abs(o - x) <= tol)) out.push(x)
  return out
}

export function analyzeGraph(text: string, lo: number, hi: number, degrees: boolean, label: string | undefined, piTicks: boolean): GraphResult {
  const src = text.replace(/y=/g, '').replace(/f\(x\)=/g, '').trim()
  const e: Expr = MathParser.parse(src)
  const vars = [...freeVariables(e)].filter((v) => v !== 'x')
  if (vars.length) throw new Error(`Use only the variable x (found: ${vars.sort().join(', ')}).`)
  const angle = degrees ? 'degrees' : 'radians'
  const f = (x: number): number | undefined => {
    try {
      const v = evaluateDouble(e, { x }, angle)
      return Number.isFinite(v) ? v : undefined
    } catch {
      return undefined
    }
  }
  let d: Expr | null = null
  if (!degrees) {
    try { d = derivative(e, 'x') } catch { d = null }
  }
  const df = (x: number): number | undefined => {
    if (d) {
      try {
        const v = evaluateDouble(d, { x }, angle)
        if (Number.isFinite(v)) return v
      } catch {
        /* derivada numérica */
      }
    }
    const h = Math.max(1e-6, Math.abs(x) * 1e-6)
    const a = f(x + h), b = f(x - h)
    if (a === undefined || b === undefined) return undefined
    return (a - b) / (2 * h)
  }
  const n = 1200
  const step = (hi - lo) / n
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + i * step)
  const ys = xs.map(f)
  const finite = ys.filter((y): y is number => y !== undefined)
  // escala típica (sin los valores enormes de una asíntota)
  const sortedAbs = finite.map(Math.abs).sort((a, b) => a - b)
  const typical = sortedAbs.length ? Math.max(1e-9, sortedAbs[Math.min(sortedAbs.length - 1, Math.floor(sortedAbs.length * 0.9))]) : 1

  let zeros: number[] = []
  const breaks: number[] = []
  for (let i = 0; i < n; i++) {
    const a = ys[i], b = ys[i + 1]
    if (a === undefined || b === undefined) {
      if ((a === undefined) !== (b === undefined)) breaks.push(a === undefined ? xs[i + 1] : xs[i])
      continue
    }
    if (a === 0) { zeros.push(xs[i]); continue }
    if (a * b < 0) {
      // un cambio de signo con un salto enorme es una asíntota, no un cero
      if (Math.abs(a - b) > 20 * typical && Math.max(Math.abs(a), Math.abs(b)) > 5 * typical) { breaks.push((xs[i] + xs[i + 1]) / 2); continue }
      const r = bisect(f, xs[i], xs[i + 1])
      if (r !== undefined) zeros.push(r)
    } else if (Math.abs(a - b) > 40 * typical) breaks.push((xs[i] + xs[i + 1]) / 2)
  }
  if (ys[n] === 0) zeros.push(xs[n])
  // extremos: cambios de signo de la derivada (una derivada exactamente 0 en la rejilla no esconde el extremo)
  const extrema: KeyPoint[] = []
  let last: { i: number; d: number } | undefined
  for (let i = 0; i <= n; i++) {
    const c = df(xs[i])
    if (c === undefined || ys[i] === undefined) { last = undefined; continue }
    if (c === 0) continue
    if (last && last.d * c < 0) {
      const y0 = ys[last.i], y1 = ys[i]
      if (y0 !== undefined && y1 !== undefined && Math.abs(y0 - y1) < 20 * typical) {
        const r = bisect((x) => df(x), xs[last.i], xs[i])
        const y = r !== undefined ? f(r) : undefined
        if (r !== undefined && y !== undefined) {
          extrema.push({ x: r, y, kind: last.d > 0 ? 'maximum' : 'minimum' })
          // un cero doble (tangente al eje) no cambia de signo: el extremo en y≈0 también es un cero
          if (Math.abs(y) < 1e-9 * Math.max(1, typical) && !zeros.some((z) => Math.abs(z - r) < step)) zeros.push(r)
        }
      }
    }
    last = { i, d: c }
  }
  zeros = dedupe(zeros, step / 2).filter((z) => z >= lo - 1e-9 && z <= hi + 1e-9)
  let yRange: [number, number] | undefined
  if (finite.length) {
    const vals = [...finite].sort((a, b) => a - b)
    const lowQ = vals[Math.floor((vals.length - 1) * 0.02)], highQ = vals[Math.floor((vals.length - 1) * 0.98)]
    let mn = Math.min(lowQ, extrema.length ? Math.min(...extrema.map((p) => p.y)) : lowQ, 0)
    let mx = Math.max(highQ, extrema.length ? Math.max(...extrema.map((p) => p.y)) : highQ, 0)
    if (mx - mn < 1e-9) { mn -= 1; mx += 1 }
    const pad = (mx - mn) * 0.15
    yRange = [mn - pad, mx + pad]
  }
  const yInt = lo <= 0 && 0 <= hi ? f(0) : undefined
  const out: GraphResult = {
    expr: src, label: label ?? `y = ${src}`, zeros: zeros.slice(0, 12), extrema: extrema.slice(0, 12), breaks: dedupe(breaks, step * 2).slice(0, 8), piTicks
  }
  if (yInt !== undefined) out.yIntercept = yInt
  if (yRange) out.yRange = yRange
  return out
}

/** 2 → «2», 0.5 → «1/2», 1.5707963… → «π/2 ≈ 1.5708» (con `pi`), si no, 6 cifras. */
export function prettyNumber(x: number, pi: boolean): string {
  if (!Number.isFinite(x)) return NumberFormat.significant(x, 6)
  if (Math.abs(x) < 1e-10) return '0'
  if (Math.abs(x) < 1e15 && Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x))
  if (Math.abs(x) >= 1e12) return NumberFormat.significant(x, 6)
  for (let q = 2; q <= 12; q++) {
    const p = x * q
    if (Math.abs(p - Math.round(p)) < 1e-8 * q) return `${Math.round(p)}/${q}`
  }
  if (pi) {
    const k = x / Math.PI
    for (const q of [1, 2, 3, 4, 6, 12]) {
      const p = k * q
      if (Math.abs(p - Math.round(p)) < 1e-8) {
        const nn = Math.round(p)
        const num = nn === 1 ? 'π' : nn === -1 ? '-π' : `${nn}π`
        return (q === 1 ? num : `${num}/${q}`) + ' ≈ ' + NumberFormat.significant(x, 6)
      }
    }
  }
  return NumberFormat.significant(x, 6)
}

export function graphResultJSON(r: GraphResult): JSONObject {
  const o: JSONObject = {
    expression: r.expr, label: r.label,
    zeros: r.zeros.map((z) => prettyNumber(z, r.piTicks)),
    extrema: r.extrema.map((p) => ({ kind: p.kind, x: prettyNumber(p.x, r.piTicks), y: prettyNumber(p.y, false) }))
  }
  if (r.yIntercept !== undefined) o.y_intercept = prettyNumber(r.yIntercept, false)
  if (r.breaks.length) o.discontinuities_or_asymptotes_near_x = r.breaks.map((b) => prettyNumber(b, r.piTicks))
  if (!r.yRange) o.note = 'Not defined (no real values) in this range.'
  return o
}

const beforeApprox = (s: string): string => s.split(' ≈')[0] ?? s

/** Bloque `plot` con las curvas y sus puntos clave (ceros, extremos, corte con el eje y). */
export function plotBlockFor(curves: GraphResult[], lo: number, hi: number, degrees: boolean, piTicks: boolean): JSONObject {
  const mins = curves.flatMap((c) => (c.yRange ? [c.yRange[0]] : [])), maxs = curves.flatMap((c) => (c.yRange ? [c.yRange[1]] : []))
  const yMin = mins.length ? Math.min(...mins) : -5, yMax = maxs.length ? Math.max(...maxs) : 5
  const colors = ['accent', 'blue', 'green', 'purple']
  const num = (x: number): string => NumberFormat.significant(x, 8)
  const points: JSONValue[] = []
  for (const c of curves) {
    for (const z of c.zeros.slice(0, 6)) points.push({ x: num(z), y: '0', label: `(${beforeApprox(prettyNumber(z, c.piTicks))}, 0)` })
    for (const e of c.extrema.slice(0, 6)) points.push({ x: num(e.x), y: num(e.y), label: `(${beforeApprox(prettyNumber(e.x, c.piTicks))}, ${prettyNumber(e.y, false)})` })
    if (c.yIntercept !== undefined && !c.zeros.some((z) => Math.abs(z) < 1e-9)) points.push({ x: '0', y: num(c.yIntercept), label: `(0, ${prettyNumber(c.yIntercept, false)})` })
  }
  const lines: JSONValue[] = []
  for (const c of curves) for (const b of c.breaks.slice(0, 4)) lines.push({ kind: 'vertical', x: num(b), dashed: true })
  const o: JSONObject = {
    type: 'plot', xMin: lo, xMax: hi, yMin: Math.round(yMin * 100) / 100, yMax: Math.round(yMax * 100) / 100, xPi: piTicks,
    curves: curves.map((c, i) => ({ expr: c.expr, degrees, label: c.label, color: colors[i % colors.length] }))
  }
  if (points.length) o.points = points.slice(0, 16)
  if (lines.length) o.lines = lines
  return o
}

/** Bloque `plot` (JSON compacto) con las curvas y sus puntos clave; undefined si no se puede. */
export function plotBlockJSON(exprs: string[], lo: number, hi: number, degrees = false): string | undefined {
  const trig = !degrees && exprs.some((e) => ['sin', 'cos', 'tan'].some((t) => e.toLowerCase().includes(t)))
  try {
    const curves = exprs.map((e) => analyzeGraph(e, lo, hi, degrees, undefined, trig))
    return JSON.stringify(plotBlockFor(curves, lo, hi, degrees, trig))
  } catch {
    return undefined
  }
}
