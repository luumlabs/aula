// Gráfica de una simulación (lo que hace PlotCompiler.swift para el bloque `simulation`): rango fijo mientras corre el reloj,
// marcas «bonitas», curvas muestreadas con los parámetros, rectas de referencia y los objetos del instante. Lógica pura.
import { tryEvaluateDouble } from '@engine/math/eval/evaluate'
import type { PlotSpec } from '@shared/schema/plot'
import { simKey, type Env, type Resolved, type SimulationEngine } from './simulation'

export interface PlotRange { xMin: number; xMax: number; yMin: number; yMax: number }

/** Paso «bonito» (1, 2, 5 × 10^k) para tener unas `target` marcas en `span`. */
export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !(target > 0)) return 1
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag
}

/** Marcas de un eje (como mucho 30). */
export function ticks(min: number, max: number, target: number, step?: number): number[] {
  const s = step && step > 0 && (max - min) / step <= 30 ? step : niceStep(max - min, target)
  const out: number[] = []
  const first = Math.ceil(min / s - 1e-9) * s
  for (let v = first; v <= max + s * 1e-9 && out.length < 31; v += s) out.push(Math.abs(v) < s * 1e-9 ? 0 : Number(v.toPrecision(12)))
  return out
}

/** Rango con números razonables (finito, no vacío). */
export function saneRange(r: PlotRange): PlotRange {
  const fix = (a: number, b: number, fa: number, fb: number): [number, number] => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [fa, fb]
    if (b < a) [a, b] = [b, a]
    if (b - a < 1e-12) return [a - 1, b + 1]
    return [a, b]
  }
  const [xMin, xMax] = fix(r.xMin, r.xMax, -6.5, 6.5)
  const [yMin, yMax] = fix(r.yMin, r.yMax, -5, 5)
  return { xMin, xMax, yMin, yMax }
}

/** Valor numérico de una expresión de la gráfica («V0», «Vmax/2», «tau»). */
export function plotNumber(engine: SimulationEngine, text: string | undefined, env: Env, degrees = false): number | undefined {
  if (text === undefined || text.trim() === '') return undefined
  const e = engine.compile(text)
  if (!e) return undefined
  const v = tryEvaluateDouble(e, env, degrees ? 'degrees' : 'radians')
  return v !== null && Number.isFinite(v) ? v : undefined
}

/** Muestras de y = f(x) en [a, b], partidas en tramos donde la función no existe o salta (asíntotas). */
export function sampleFunction(engine: SimulationEngine, expr: string, env: Env, a: number, b: number, opts: { degrees?: boolean; samples?: number; yLimit?: number } = {}): Array<Array<[number, number]>> {
  const n = Math.max(16, Math.min(600, opts.samples ?? 240))
  const out: Array<Array<[number, number]>> = []
  if (!(b > a)) return out
  const e = engine.compile(expr)
  if (!e) return out
  const lim = opts.yLimit ?? Infinity
  const scope: Env = { ...env }
  let cur: Array<[number, number]> = []
  let prev: number | undefined
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n
    scope.x = x
    const y = tryEvaluateDouble(e, scope, opts.degrees ? 'degrees' : 'radians')
    const ok = y !== null && Number.isFinite(y) && Math.abs(y) <= lim
    const jump = ok && prev !== undefined && Number.isFinite(lim) && Math.abs((y as number) - prev) > lim * 0.6
    if (!ok || jump) {
      if (cur.length >= 2) out.push(cur)
      cur = []
    }
    if (ok) cur.push([x, y as number])
    prev = ok ? (y as number) : undefined
  }
  if (cur.length >= 2) out.push(cur)
  return out
}

/** Coordenadas (x, y) de los objetos ya resueltos (para encuadrar). */
function objectPoints(objs: Resolved[]): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (const o of objs) {
    if (o.kind === 'point' || o.kind === 'label') pts.push([o.x, o.y])
    else if (o.kind === 'segment') pts.push([o.x1, o.y1], [o.x2, o.y2])
    else pts.push(...o.points)
  }
  return pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
}

/**
 * Rango de la gráfica para estos parámetros (fijo mientras corre el reloj: los ejes no «saltan»). Lo que la gráfica no fija se
 * calcula con las curvas, los puntos y los objetos en siete instantes del reloj (que quepa todo el recorrido) y las rectas
 * horizontales (umbrales: concentración tóxica, Vmax…).
 */
export function simulationRange(engine: SimulationEngine, params: Env): PlotRange {
  const p: PlotSpec = engine.block.plot
  const env = engine.environment(params, undefined)
  if (p.xMin !== undefined && p.xMax !== undefined && p.yMin !== undefined && p.yMax !== undefined) return saneRange({ xMin: p.xMin, xMax: p.xMax, yMin: p.yMin, yMax: p.yMax })
  const bounds = engine.timeBounds(params)
  const objs: Resolved[] = []
  if (bounds) for (let k = 0; k <= 6; k++) objs.push(...engine.resolve(params, bounds[0] + ((bounds[1] - bounds[0]) * k) / 6))
  else objs.push(...engine.resolve(params, undefined))
  const opts = objectPoints(objs)
  let xMin = p.xMin, xMax = p.xMax
  if (xMin === undefined || xMax === undefined) {
    const xs = opts.map((q) => q[0])
    if (xs.length >= 2 && Math.max(...xs) > Math.min(...xs)) {
      const lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.08
      xMin ??= lo - pad
      xMax ??= hi + pad
    } else {
      xMin ??= -6.5
      xMax ??= 6.5
    }
  }
  let yMin = p.yMin, yMax = p.yMax
  if (yMin === undefined || yMax === undefined) {
    const ys: number[] = []
    for (const c of p.curves.slice(0, 12)) {
      const lo = Math.max(xMin, c.domainMin ?? xMin), hi = Math.min(xMax, c.domainMax ?? xMax)
      for (const seg of sampleFunction(engine, c.expr, env, lo, hi, { degrees: c.degrees, samples: 240 })) for (const q of seg) ys.push(q[1])
    }
    for (const q of p.points) { const y = plotNumber(engine, q.y, env); if (y !== undefined) ys.push(y) }
    for (const q of opts) ys.push(q[1])
    let a: number, b: number
    if (ys.length >= 3) {
      ys.sort((u, v) => u - v)
      // recorte robusto: ignora asíntotas (tan x, 1/x) que se disparan
      a = ys[Math.floor((ys.length - 1) * 0.02)]
      b = ys[Math.floor((ys.length - 1) * 0.98)]
      if (b - a < 1e-9) { a -= 1; b += 1 }
      const pad = (b - a) * 0.12
      a = Math.max(-1e6, a - pad)
      b = Math.min(1e6, b + pad)
    } else { a = -5; b = 5 }
    // las rectas horizontales también deben verse
    const hs = p.lines.filter((l) => l.kind === 'horizontal').map((l) => plotNumber(engine, l.y, env)).filter((v): v is number => v !== undefined)
    if (hs.length) {
      const pad = Math.max(1e-9, (Math.max(b, ...hs) - Math.min(a, ...hs)) * 0.06)
      b = Math.max(b, Math.max(...hs) + pad)
      a = Math.min(a, Math.min(...hs) - pad)
    }
    // una magnitud positiva (concentración, población) empieza en 0
    if (a > 0 && a < (b - a) * 0.5) a = 0
    yMin ??= a
    yMax ??= b
  }
  let r = saneRange({ xMin, xMax, yMin, yMax })
  if (p.equalAspect && (p.yMin === undefined || p.yMax === undefined)) {
    const c = (r.yMin + r.yMax) / 2, half = Math.max((r.yMax - r.yMin) / 2, (r.xMax - r.xMin) * 0.3)
    r = { ...r, yMin: c - half, yMax: c + half }
  }
  return r
}

/** Transformación de coordenadas de la gráfica a píxeles (y hacia abajo), con misma escala si se pide. */
export interface PlotFrame {
  width: number
  height: number
  left: number
  top: number
  plotW: number
  plotH: number
  range: PlotRange
  sx: (x: number) => number
  sy: (y: number) => number
  ix: (px: number) => number
}

export function plotFrame(range: PlotRange, width: number, height: number, pad: { left: number; right: number; top: number; bottom: number }, equalAspect: boolean): PlotFrame {
  let plotW = Math.max(10, width - pad.left - pad.right)
  let plotH = Math.max(10, height - pad.top - pad.bottom)
  let left = pad.left, top = pad.top
  if (equalAspect) {
    const k = Math.min(plotW / (range.xMax - range.xMin), plotH / (range.yMax - range.yMin))
    const w = k * (range.xMax - range.xMin), h = k * (range.yMax - range.yMin)
    left += (plotW - w) / 2
    top += (plotH - h) / 2
    plotW = w
    plotH = h
  }
  const sx = (x: number): number => left + ((x - range.xMin) / (range.xMax - range.xMin)) * plotW
  const sy = (y: number): number => top + (1 - (y - range.yMin) / (range.yMax - range.yMin)) * plotH
  const ix = (px: number): number => range.xMin + ((px - left) / plotW) * (range.xMax - range.xMin)
  return { width, height, left, top, plotW, plotH, range, sx, sy, ix }
}

/** Camino SVG de una polilínea (recortando valores absurdos que romperían el dibujo). */
export function polylinePath(pts: Array<[number, number]>, f: PlotFrame): string {
  const clamp = (v: number): number => Math.max(-1e5, Math.min(1e5, v))
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${clamp(f.sx(x)).toFixed(2)} ${clamp(f.sy(y)).toFixed(2)}`).join('')
}

/**
 * ¿La gráfica es «contra el tiempo»? (algún punto tiene x = el reloj, como en el resorte, el condensador o la población): entonces
 * las curvas se dibujan hasta el instante actual y lo que falta queda tenue, como si la gráfica se fuera trazando.
 */
export function isTimePlot(engine: SimulationEngine): boolean {
  const tm = engine.block.time
  if (!tm) return false
  const name = tm.name.trim()
  return engine.block.objects.some((o) => o.kind === 'point' && (o.x ?? '').replace(/\s/g, '') === name)
}

/** Serie que se registra mientras corre el reloj (en simulaciones «de espacio»: proyectil, péndulo, onda). */
export interface TraceSpec {
  /** "derived:<name>" o "point:<i>:x|y". */
  id: string
  derived?: string
  point?: { index: number; axis: 'x' | 'y' }
}

/**
 * Qué conviene registrar en el tiempo: la primera magnitud mostrada que cambia con el reloj; si no hay, la coordenada que más se
 * mueve del primer punto (la altura del proyectil, el vaivén del péndulo).
 */
export function chooseTrace(engine: SimulationEngine, params: Env): TraceSpec | undefined {
  const b = engine.block
  const tm = b.time
  if (!tm || isTimePlot(engine)) return undefined
  const bounds = engine.timeBounds(params)
  if (!bounds) return undefined
  const [lo, hi] = bounds
  const at = (k: number): number => lo + ((hi - lo) * k) / 12
  for (const d of b.derived.filter((x) => x.show)) {
    const vals = Array.from({ length: 13 }, (_, k) => engine.environment(params, at(k))[simKey(d.name)])
    const fin = vals.filter((v): v is number => v !== undefined && Number.isFinite(v))
    if (fin.length >= 6 && Math.max(...fin) - Math.min(...fin) > 1e-9 * Math.max(1, Math.abs(fin[0]))) return { id: `derived:${d.name}`, derived: d.name }
  }
  const pi = b.objects.findIndex((o) => o.kind === 'point')
  if (pi < 0) return undefined
  const xs: number[] = [], ys: number[] = []
  for (let k = 0; k <= 12; k++) {
    const env = engine.environment(params, at(k))
    const o = b.objects[pi]
    const x = engine.value(o.x, env), y = engine.value(o.y, env)
    if (x !== undefined && y !== undefined) { xs.push(x); ys.push(y) }
  }
  if (xs.length < 6) return undefined
  const rx = Math.max(...xs) - Math.min(...xs), ry = Math.max(...ys) - Math.min(...ys)
  if (rx < 1e-12 && ry < 1e-12) return undefined
  const axis: 'x' | 'y' = ry < 0.15 * rx ? 'x' : 'y'
  return { id: `point:${pi}:${axis}`, point: { index: pi, axis } }
}

/** Valor de la serie registrada en un instante. */
export function traceValue(engine: SimulationEngine, spec: TraceSpec, params: Env, time: number): number | undefined {
  const env = engine.environment(params, time)
  if (spec.derived) return env[simKey(spec.derived)]
  if (spec.point) {
    const o = engine.block.objects[spec.point.index]
    return engine.value(spec.point.axis === 'x' ? o.x : o.y, env)
  }
  return undefined
}
