// Geometría de las gráficas (port de PlotCompiler.swift, PlotView.trace y PlotGeometry.swift): rango de los ejes, tramos
// continuos de una función (cortando en asíntotas) y recorte de rectas. No dibuja nada: es lógica pura y se prueba aparte.
import type { ExploreParam, PlotCurve, PlotSpec } from '@shared/schema/plot'
import { compileFn, evalNumber, type Params, type RealFn } from './evaluate'
import { sane } from './ticks'

export interface Range {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Topes de lo que se dibuja (miles de curvas congelarían la lección). */
export const LIMITS = { curves: 40, points: 600, lines: 300, regions: 40, labels: 300 }

export function sanitized(r: Range): Range {
  const [xMin, xMax] = sane(r.xMin, r.xMax, [-6.5, 6.5])
  const [yMin, yMax] = sane(r.yMin, r.yMax, [-5, 5])
  return { xMin, xMax, yMin, yMax }
}

export const curveFn = (c: PlotCurve, params: Params): RealFn | null => compileFn(c.expr, 'x', params, { degrees: c.degrees })

/** Rango de la gráfica: el del autor y, lo que falte, a partir de las curvas (con recorte robusto de asíntotas). */
export function plotRange(spec: PlotSpec, params: Params = {}): Range {
  let x0 = spec.xMin
  let x1 = spec.xMax
  if (x0 === undefined || x1 === undefined) {
    const doms = spec.curves.filter((c) => c.domainMin !== undefined && c.domainMax !== undefined).map((c) => [c.domainMin!, c.domainMax!] as const)
    const lo = Math.min(...doms.map((d) => d[0]))
    const hi = Math.max(...doms.map((d) => d[1]))
    if (spec.curves.length > 0 && doms.length === spec.curves.length && hi > lo) {
      const pad = (hi - lo) * 0.08
      x0 ??= lo - pad
      x1 ??= hi + pad
    } else if (spec.xPi) {
      x0 ??= -2 * Math.PI
      x1 ??= 2 * Math.PI
    } else if (spec.polar.length || spec.parametric.length) {
      x0 ??= -4
      x1 ??= 4
    } else {
      x0 ??= -6.5
      x1 ??= 6.5
    }
  }
  const [xa, xb] = sane(x0, x1, [-6.5, 6.5])
  let y0 = spec.yMin
  let y1 = spec.yMax
  if (y0 === undefined || y1 === undefined) {
    const ys = sampleYs(spec, params, xa, xb)
    if (ys.length >= 3) {
      ys.sort((a, b) => a - b)
      // recorte robusto: ignora asíntotas (tan x, 1/x) que se disparan
      let a = ys[Math.floor((ys.length - 1) * 0.02)]
      let b = ys[Math.floor((ys.length - 1) * 0.98)]
      if (b - a < 1e-9) {
        a -= 1
        b += 1
      }
      const pad = (b - a) * 0.12
      a -= pad
      b += pad
      if (spec.xPi) {
        a = Math.min(a, -0.5)
        b = Math.max(b, 0.5)
      }
      y0 ??= Math.max(-1e4, a)
      y1 ??= Math.min(1e4, b)
    } else {
      y0 ??= -5
      y1 ??= 5
    }
  }
  let [ya, yb] = sane(y0, y1, [-5, 5])
  if (spec.equalAspect && (spec.yMin === undefined || spec.yMax === undefined)) {
    const c = (ya + yb) / 2
    const half = Math.max((yb - ya) / 2, (xb - xa) * 0.3)
    ya = c - half
    yb = c + half
  }
  return sanitized({ xMin: xa, xMax: xb, yMin: ya, yMax: yb })
}

/** Valores de y por los que pasa lo que se dibuja (para encuadrar el eje y). */
function sampleYs(spec: PlotSpec, params: Params, xa: number, xb: number): number[] {
  const ys: number[] = []
  for (const c of spec.curves.slice(0, LIMITS.curves)) {
    const f = curveFn(c, params)
    if (!f) continue
    const lo = Math.max(xa, c.domainMin ?? xa)
    const hi = Math.min(xb, c.domainMax ?? xb)
    if (!(hi > lo)) continue
    for (let i = 0; i <= 240; i++) {
      const y = f(lo + ((hi - lo) * i) / 240)
      if (y !== null) ys.push(y)
    }
  }
  for (const p of spec.points.slice(0, LIMITS.points)) {
    const y = evalNumber(p.y, params)
    if (y !== undefined) ys.push(y)
  }
  for (const p of spec.parametric.slice(0, LIMITS.curves)) {
    const fx = compileFn(p.x, 't', params)
    const fy = compileFn(p.y, 't', params)
    if (!fx || !fy || !Number.isFinite(p.tMin) || !Number.isFinite(p.tMax)) continue
    for (let i = 0; i <= 200; i++) {
      const t = p.tMin + ((p.tMax - p.tMin) * i) / 200
      const y = fy(t)
      if (y !== null && fx(t) !== null) ys.push(y)
    }
  }
  for (const p of spec.polar.slice(0, LIMITS.curves)) {
    const f = compileFn(p.r, 'theta', params)
    if (!f || !Number.isFinite(p.thetaMin) || !Number.isFinite(p.thetaMax)) continue
    for (let i = 0; i <= 200; i++) {
      const t = p.thetaMin + ((p.thetaMax - p.thetaMin) * i) / 200
      const r = f(t)
      if (r !== null) ys.push(r * Math.sin(t))
    }
  }
  return ys
}

/** Valores de los deslizadores con límites seguros (finito, ordenado, paso razonable, valor dentro) y nombres únicos. */
export function saneParams(ps: ExploreParam[]): ExploreParam[] {
  const seen = new Set<string>()
  const out: ExploreParam[] = []
  for (const p of ps) {
    if (out.length >= 12 || seen.has(p.name)) continue
    seen.add(p.name)
    let lo = Number.isFinite(p.min) ? Math.min(Math.max(p.min, -1e9), 1e9) : -5
    let hi = Number.isFinite(p.max) ? Math.min(Math.max(p.max, -1e9), 1e9) : 5
    if (hi < lo) [lo, hi] = [hi, lo]
    if (hi - lo < 1e-9) hi = lo + 1
    const span = hi - lo
    const step = Math.min(Math.max(Number.isFinite(p.step) && p.step > 0 ? p.step : 0.1, span / 10_000), span)
    const value = Number.isFinite(p.value) ? Math.min(Math.max(p.value, lo), hi) : lo
    out.push({ ...p, min: lo, max: hi, step, value })
  }
  return out
}

export const paramValues = (ps: ExploreParam[]): Record<string, number> => Object.fromEntries(ps.map((p) => [p.name, p.value]))

/** Rango estable de `explore`: la unión de los rangos con cada parámetro en su mínimo, su centro y su máximo (los ejes no saltan). */
export function stableRange(spec: PlotSpec, params: ExploreParam[]): Range {
  const defaults = paramValues(params)
  const union = plotRange(spec, defaults)
  for (const p of params) {
    for (const v of [p.min, p.max, (p.min + p.max) / 2]) {
      const r = plotRange(spec, { ...defaults, [p.name]: v })
      union.yMin = Math.min(union.yMin, r.yMin)
      union.yMax = Math.max(union.yMax, r.yMax)
    }
  }
  if (spec.yMin === undefined) union.yMin = Math.max(union.yMin, -1e3)
  if (spec.yMax === undefined) union.yMax = Math.min(union.yMax, 1e3)
  const pad = (union.yMax - union.yMin) * 0.04
  if (spec.yMin === undefined) union.yMin -= pad
  if (spec.yMax === undefined) union.yMax += pad
  return sanitized(union)
}

export interface Pt {
  x: number
  y: number
}

/**
 * Tramos continuos de y = f(x) en [lo, hi]. Un salto de más de una décima de la altura visible entre dos muestras se
 * comprueba con el punto medio; si no cae entre los dos valores, hay un polo o un salto: se biseca hasta él y se corta.
 * Los bordes del dominio se afinan con bisección (ln x baja hasta el borde; √x empieza en 0).
 */
export function trace(f: RealFn, lo: number, hi: number, samples: number, yMin: number, yMax: number): Pt[][] {
  if (!(samples > 0) || !(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const span = yMax - yMin
  const jump = span * 0.1
  let budget = 300
  const out: Pt[][] = []
  let cur: Pt[] = []
  const close = () => {
    if (cur.length > 1) out.push(cur)
    cur = []
  }
  const edge = (def: number, undef: number): Pt | null => {
    let a = def
    let b = undef
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2
      if (f(m) !== null) a = m
      else b = m
    }
    const y = f(a)
    return y === null ? null : { x: a, y }
  }
  let prev: Pt | null = null
  let lastUndefined: number | null = null
  for (let i = 0; i <= samples; i++) {
    const x = i === samples ? hi : lo + ((hi - lo) * i) / samples
    const y = f(x)
    if (y === null) {
      if (prev) {
        const e = edge(prev.x, x)
        if (e && e.x > prev.x) cur.push(e)
      }
      close()
      prev = null
      lastUndefined = x
      continue
    }
    if (!prev && lastUndefined !== null) {
      const e = edge(x, lastUndefined)
      if (e && e.x < x) cur.push(e)
    }
    if (prev && Math.abs(y - prev.y) > jump) {
      const my = f((prev.x + x) / 2)
      const between = my !== null && my >= Math.min(prev.y, y) && my <= Math.max(prev.y, y)
      if (!between && budget <= 0) {
        if (Math.abs(y - prev.y) > span * 2.5) close()
      } else if (!between) {
        budget--
        let a: Pt = prev
        let b: Pt = { x, y }
        let hole: number | null = null
        for (let k = 0; k < 30; k++) {
          const m = (a.x + b.x) / 2
          const ym = f(m)
          if (ym === null) {
            hole = m
            break
          }
          if (Math.abs(ym - a.y) > Math.abs(b.y - ym)) b = { x: m, y: ym }
          else a = { x: m, y: ym }
        }
        if (hole !== null) {
          const e1 = edge(a.x, hole)
          if (e1) cur.push(e1)
          close()
          const e2 = edge(b.x, hole)
          if (e2) cur.push(e2)
        } else if (Math.abs(b.y - a.y) > jump) {
          cur.push(a)
          close()
          cur.push(b)
        }
      }
    }
    cur.push({ x, y })
    prev = { x, y }
  }
  close()
  return out
}

/**
 * Parámetros t de entrada y salida de p + t·v dentro de la vista, limitados a [tMin, tMax] (0…∞ para una semirrecta).
 * null si el trazo no corta la vista (Liang–Barsky).
 */
export function clip(x: number, y: number, dx: number, dy: number, r: Range, tMin = -Infinity, tMax = Infinity): [number, number] | null {
  if (![x, y, dx, dy, r.xMin, r.xMax, r.yMin, r.yMax].every(Number.isFinite) || !(r.xMax > r.xMin) || !(r.yMax > r.yMin)) return null
  if (Math.abs(dx) <= 1e-12 && Math.abs(dy) <= 1e-12) return null
  let t0 = tMin
  let t1 = tMax
  const p = [-dx, dx, -dy, dy]
  const q = [x - r.xMin, r.xMax - x, y - r.yMin, r.yMax - y]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null
    } else {
      const s = q[i] / p[i]
      if (p[i] < 0) {
        if (s > t1) return null
        if (s > t0) t0 = s
      } else {
        if (s < t0) return null
        if (s < t1) t1 = s
      }
    }
  }
  return t1 >= t0 ? [t0, t1] : null
}

/** Zoom alrededor de un punto (factor < 1 acerca). Mantiene fijo el punto (cx, cy) en coordenadas de datos. */
export function zoomRange(r: Range, factor: number, cx = (r.xMin + r.xMax) / 2, cy = (r.yMin + r.yMax) / 2): Range {
  const f = Math.min(Math.max(factor, 0.05), 20)
  const next = {
    xMin: cx - (cx - r.xMin) * f,
    xMax: cx + (r.xMax - cx) * f,
    yMin: cy - (cy - r.yMin) * f,
    yMax: cy + (r.yMax - cy) * f
  }
  // sin pasarse: ni un ancho microscópico ni uno astronómico
  const w = next.xMax - next.xMin
  if (w < 1e-6 || w > 1e8) return r
  return sanitized(next)
}

/** Desplaza la vista (dx, dy en unidades de datos). */
export function panRange(r: Range, dx: number, dy: number): Range {
  return sanitized({ xMin: r.xMin + dx, xMax: r.xMax + dx, yMin: r.yMin + dy, yMax: r.yMax + dy })
}
