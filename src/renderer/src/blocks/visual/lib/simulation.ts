// Motor de las simulaciones (port de StudyEngine/Content/SimulationEngine.swift y StudyUI/…/SimulationClock.swift): compila
// las expresiones una vez (nombres de varias letras: v0, theta, Vmax) y calcula, para unos valores de los deslizadores y un
// instante, las magnitudes derivadas y los objetos que se dibujan. Lógica pura: se prueba sin dibujar.
import { MathParser } from '@engine/math/parse/parser'
import { tryEvaluateDouble } from '@engine/math/eval/evaluate'
import { freeVariables, type Expr } from '@engine/math/core/expr'
import type { SimParam, SimulationBlock } from '@shared/schema/visual'

export type Env = Record<string, number>

/** Lo que se dibuja en un instante (coordenadas ya calculadas). */
export type Resolved =
  | { kind: 'point'; x: number; y: number; label?: string; color?: string }
  | { kind: 'segment'; x1: number; y1: number; x2: number; y2: number; color?: string; dashed: boolean; arrow: boolean; label?: string }
  | { kind: 'polyline'; points: Array<[number, number]>; color?: string; dashed: boolean; trail: boolean }
  | { kind: 'label'; x: number; y: number; text: string; color?: string }

/** Nombre canónico de una variable (theta → θ), el mismo que da el analizador. */
export const simKey = (name: string): string => MathParser.canonicalVariableName(name)

export class SimulationEngine {
  readonly block: SimulationBlock
  private cache = new Map<string, Expr | null>()

  constructor(block: SimulationBlock) {
    this.block = block
  }

  /** Expresión compilada (null si el analizador no la entiende). */
  compile(text: string): Expr | null {
    const hit = this.cache.get(text)
    if (hit !== undefined) return hit
    let e: Expr | null = null
    try {
      e = MathParser.parse(text, { wordVariables: true })
    } catch {
      e = null
    }
    this.cache.set(text, e)
    return e
  }

  /** Valor de una expresión (undefined si no se puede calcular o no es finito). */
  value(text: string | undefined, env: Env): number | undefined {
    if (text === undefined || text.trim() === '') return undefined
    const e = this.compile(text)
    if (!e) return undefined
    const v = tryEvaluateDouble(e, env)
    return v !== null && Number.isFinite(v) ? v : undefined
  }

  /** Variables libres de una expresión (nombres canónicos), o null si no compila. */
  freeVariables(text: string): Set<string> | null {
    const e = this.compile(text)
    return e ? freeVariables(e) : null
  }

  /** Valores iniciales de los deslizadores. */
  get initialParams(): Env {
    const out: Env = {}
    for (const p of this.block.params) if (!(p.name in out)) out[p.name] = p.value
    return out
  }

  /** Entorno completo (claves canónicas): constantes, parámetros, reloj y derivadas (cada una puede usar las anteriores). */
  environment(params: Env, time: number | undefined): Env {
    const env: Env = {}
    for (const c of this.block.constants) if (Number.isFinite(c.value)) env[simKey(c.name)] = c.value
    for (const p of this.block.params) env[simKey(p.name)] = params[p.name] ?? p.value
    const tm = this.block.time
    if (tm) env[simKey(tm.name)] = time ?? this.value(tm.min, env) ?? 0
    for (const d of this.block.derived) {
      const v = this.value(d.expr, env)
      if (v !== undefined) env[simKey(d.name)] = v
    }
    return env
  }

  /** Intervalo del reloj con estos parámetros (los extremos pueden depender de ellos: el tiempo de vuelo). */
  timeBounds(params: Env): [number, number] | undefined {
    const tm = this.block.time
    if (!tm) return undefined
    const env = this.environment(params, undefined)
    const lo = this.value(tm.min, env) ?? 0
    const hi = this.value(tm.max, env) ?? lo + 10
    if (!(hi > lo) || hi - lo >= 1e7) return [lo, lo + 1]
    return [lo, hi]
  }

  /** Muestras de una curva paramétrica (como máximo 240; se salta lo que no se puede calcular). */
  sample(fx: string | undefined, fy: string | undefined, variable: string, from: number, to: number, env: Env, samples = 160): Array<[number, number]> {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return []
    const n = Math.max(8, Math.min(240, samples))
    const k = simKey(variable)
    const out: Array<[number, number]> = []
    const e: Env = { ...env }
    for (let i = 0; i <= n; i++) {
      e[k] = from + ((to - from) * i) / n
      const x = this.value(fx, e)
      const y = this.value(fy, e)
      if (x !== undefined && y !== undefined) out.push([x, y])
    }
    return out
  }

  /** Lo que se dibuja en este instante. */
  resolve(params: Env, time: number | undefined): Resolved[] {
    const env = this.environment(params, time)
    const out: Resolved[] = []
    const tm = this.block.time
    for (const o of this.block.objects) {
      switch (o.kind) {
        case 'point': {
          const x = this.value(o.x, env), y = this.value(o.y, env)
          if (x === undefined || y === undefined) continue
          if (o.trail && tm && time !== undefined) {
            const t0 = this.value(tm.min, env)
            if (t0 !== undefined && time > t0) {
              const trail = this.sample(o.x, o.y, tm.name, t0, time, env, 120)
              if (trail.length >= 2) out.push({ kind: 'polyline', points: trail, color: o.color, dashed: false, trail: true })
            }
          }
          out.push({ kind: 'point', x, y, label: o.text, color: o.color })
          break
        }
        case 'vector': {
          const x = this.value(o.x, env), y = this.value(o.y, env), dx = this.value(o.dx, env), dy = this.value(o.dy, env)
          if (x === undefined || y === undefined || dx === undefined || dy === undefined) continue
          out.push({ kind: 'segment', x1: x, y1: y, x2: x + dx, y2: y + dy, color: o.color, dashed: o.dashed, arrow: true, label: o.text })
          break
        }
        case 'segment': {
          const x1 = this.value(o.x1, env), y1 = this.value(o.y1, env), x2 = this.value(o.x2, env), y2 = this.value(o.y2, env)
          if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue
          out.push({ kind: 'segment', x1, y1, x2, y2, color: o.color, dashed: o.dashed, arrow: false, label: o.text })
          break
        }
        case 'path': {
          const a = this.value(o.from ?? '0', env), b = this.value(o.to ?? '1', env)
          if (a === undefined || b === undefined) continue
          const pts = this.sample(o.x, o.y, o.variable ?? 's', Math.min(a, b), Math.max(a, b), env)
          if (pts.length >= 2) out.push({ kind: 'polyline', points: pts, color: o.color, dashed: o.dashed, trail: false })
          break
        }
        case 'function': {
          const a = this.value(o.from ?? '0', env), b = this.value(o.to ?? '1', env)
          if (a === undefined || b === undefined) continue
          const pts = this.sample('x', o.y, 'x', Math.min(a, b), Math.max(a, b), env)
          if (pts.length >= 2) out.push({ kind: 'polyline', points: pts, color: o.color, dashed: o.dashed, trail: false })
          break
        }
        case 'label': {
          const x = this.value(o.x, env), y = this.value(o.y, env)
          if (x === undefined || y === undefined || !o.text) continue
          out.push({ kind: 'label', x, y, text: o.text, color: o.color })
          break
        }
        default:
          continue
      }
    }
    return out
  }
}

/** Texto de una magnitud con sus decimales (coma decimal en «es»). */
export function formatSimValue(v: number, decimals: number | undefined, decimalSep = ','): string {
  if (!Number.isFinite(v)) return '—'
  let s: string
  if (decimals !== undefined) s = v.toFixed(Math.max(0, Math.min(8, decimals)))
  else if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)) s = v.toPrecision(3).replace(/\.?0+e/, 'e')
  else {
    s = v.toFixed(3)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  }
  if (s === '-0') s = '0'
  s = s.replace('-', '−')
  return decimalSep === '.' ? s : s.replace('.', decimalSep)
}

/** Decimales que hacen falta para escribir exacto un número de la rejilla del deslizador (0,25 → 2; 2,5 → 1). */
export function decimalsFor(x: number): number {
  if (!Number.isFinite(x)) return 0
  for (let d = 0; d <= 4; d++) {
    const k = Math.abs(x) * 10 ** d
    if (Math.abs(k - Math.round(k)) < 1e-6 * Math.max(1, k)) return d
  }
  return 4
}

/** Deslizadores con valores seguros: min < max, paso > 0 y menor que el rango, valor dentro (como `ExploreView.saneParams`). */
export function saneParams(ps: SimParam[]): SimParam[] {
  const seen = new Set<string>()
  return ps.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true))).map((p) => {
    let min = Number.isFinite(p.min) ? p.min : 0
    let max = Number.isFinite(p.max) ? p.max : min + 10
    if (!(max > min)) [min, max] = max < min ? [max, min] : [min, min + 1]
    let step = Number.isFinite(p.step) && p.step > 0 ? p.step : (max - min) / 100
    if (step > max - min) step = (max - min) / 10
    const value = Math.min(max, Math.max(min, Number.isFinite(p.value) ? p.value : min))
    return { ...p, min, max, step, value }
  })
}

/** Valor del deslizador ajustado a su rejilla. */
export function snapToStep(v: number, p: SimParam): number {
  const k = Math.round((v - p.min) / p.step)
  const out = p.min + k * p.step
  return Math.min(p.max, Math.max(p.min, Number(out.toFixed(10))))
}

/**
 * Reloj de una simulación: pasa el tiempo dentro de [lo, hi] con la velocidad indicada, con bucle o parando al final.
 * Arranca en su límite inferior (la app Swift arrancaba a veces en 0 aunque `min` fuera otro).
 */
export const SimulationClock = {
  initial(lo: number): number {
    return lo
  },
  /** Instante tras `elapsed` segundos de reproducción desde `start`, siempre dentro de [lo, hi]. */
  time(start: number, elapsed: number, speed: number, lo: number, hi: number, loops: boolean): number {
    if (![start, elapsed, speed, lo, hi].every(Number.isFinite)) return Number.isFinite(lo) ? lo : 0
    if (!(hi > lo)) return lo
    const base = Math.min(Math.max(start, lo), hi)
    const span = hi - lo
    if (span < 1e-9) return base
    const wrap = (v: number): number => {
      const off = (v - lo) % span
      return lo + (off < 0 ? off + span : off)
    }
    const t = base + elapsed * speed
    if (t < lo) return loops ? wrap(t) : lo
    if (t > hi) return loops ? wrap(t) : hi
    return t
  }
}
