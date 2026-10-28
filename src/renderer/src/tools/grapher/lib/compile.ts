// Graficadora (puro): lee lo que escribe el estudiante (y = …, f(x) = …, x = 2, curvas paramétricas y polares), lo
// convierte en una función de JavaScript rápida y la muestrea en trozos sin cruzar asíntotas.
import { MathParser } from '@engine/math/parse/parser'
import { freeVariables, type Expr } from '@engine/math/core/expr'
import { constantValue, MathError } from '@engine/math/core/types'
import { Numerics } from '@engine/math/eval/numerics'
import { toLatex } from '@engine/math/print/latex'

export type FnKind = 'fx' | 'param' | 'polar'

/** Lo que se sabe de una función ya analizada. */
export interface Compiled {
  kind: FnKind | 'vertical'
  /** Expresiones: [f] en fx/polar/vertical, [x(t), y(t)] en paramétricas. */
  exprs: Expr[]
  tex: string | null
  /** Parámetros libres (a, b, k…), sin la variable. */
  params: string[]
  /** Clave del error (para i18n) o mensaje del motor. */
  error: { key: string; message?: string } | null
  empty: boolean
}

const MAX_PARAMS = 4
const VARIABLE: Record<FnKind, string[]> = { fx: ['x'], param: ['t'], polar: ['θ', 't'] }

function parse(text: string): Expr {
  return MathParser.parse(text)
}

function errorOf(e: unknown): { key: string; message?: string } {
  return e instanceof MathError ? { key: 'engine', message: e.message } : { key: 'unreadable' }
}

function paramsOf(exprs: Expr[], vars: string[]): string[] {
  const s = new Set<string>()
  for (const e of exprs) for (const v of freeVariables(e)) if (!vars.includes(v)) s.add(v)
  return [...s].sort()
}

/** Analiza una función de la graficadora. `b` solo se usa en las paramétricas (y(t)). */
export function compileFn(kind: FnKind, a: string, b = ''): Compiled {
  const none: Compiled = { kind, exprs: [], tex: null, params: [], error: null, empty: true }
  const text = a.trim()
  if (kind === 'param') {
    const bt = b.trim()
    if (!text && !bt) return none
    if (!text || !bt) return { ...none, empty: false, error: { key: 'paramBoth' } }
    try {
      const ex = parse(text.replace(/^\s*x\s*\(\s*t\s*\)\s*=|^\s*x\s*=/, ''))
      const ey = parse(bt.replace(/^\s*y\s*\(\s*t\s*\)\s*=|^\s*y\s*=/, ''))
      const params = paramsOf([ex, ey], ['t'])
      if (params.length > MAX_PARAMS) return { ...none, empty: false, error: { key: 'tooMany' } }
      return { kind, exprs: [ex, ey], tex: `\\begin{cases} x = ${toLatex(ex)} \\\\ y = ${toLatex(ey)} \\end{cases}`, params, error: null, empty: false }
    } catch (e) {
      return { ...none, empty: false, error: errorOf(e) }
    }
  }
  if (!text) return none
  if (kind === 'polar') {
    try {
      const e = parse(text.replace(/^\s*r\s*(\(\s*(θ|theta|t)\s*\))?\s*=/i, ''))
      const params = paramsOf([e], VARIABLE.polar)
      if (params.length > MAX_PARAMS) return { ...none, empty: false, error: { key: 'tooMany' } }
      return { kind, exprs: [e], tex: `r = ${toLatex(e)}`, params, error: null, empty: false }
    } catch (e) {
      return { ...none, empty: false, error: errorOf(e) }
    }
  }
  // «x = 2»: recta vertical
  const vertical = /^\s*x\s*=\s*(.+)$/.exec(text)
  if (vertical) {
    try {
      const e = parse(vertical[1])
      if (freeVariables(e).has('x')) return { ...none, empty: false, error: { key: 'solveY' } }
      return { kind: 'vertical', exprs: [e], tex: `x = ${toLatex(e)}`, params: paramsOf([e], []), error: null, empty: false }
    } catch (e) {
      return { ...none, empty: false, error: errorOf(e) }
    }
  }
  const body = text.replace(/^\s*(y|[A-Za-z]\s*\(\s*x\s*\))\s*=\s*/, '')
  if (body.includes('=')) return { ...none, empty: false, error: { key: 'rightSide' } }
  try {
    const e = parse(body)
    const params = paramsOf([e], ['x'])
    if (params.includes('y')) return { ...none, empty: false, error: { key: 'solveY' } }
    if (params.length > MAX_PARAMS) return { ...none, empty: false, error: { key: 'tooMany' } }
    return { kind: 'fx', exprs: [e], tex: toLatex(e), params, error: null, empty: false }
  } catch (e) {
    return { ...none, empty: false, error: errorOf(e) }
  }
}

// MARK: Función rápida

export type Env = Record<string, number>
export type NumFn = (env: Env) => number

/** Convierte una expresión en una función de JavaScript (los dominios fuera de rango dan NaN en vez de lanzar). */
export function toClosure(e: Expr): NumFn {
  const f = build(e)
  return (env) => {
    try {
      return f(env)
    } catch {
      return NaN
    }
  }
}

function build(e: Expr): NumFn {
  switch (e.type) {
    case 'number': {
      const v = e.value.doubleValue
      return () => v
    }
    case 'real': {
      const v = e.value
      return () => v
    }
    case 'constant': {
      const v = constantValue(e.name)
      return () => v
    }
    case 'variable': {
      const n = e.name
      return (env) => {
        const v = env[n]
        if (v === undefined) throw new Error(n)
        return v
      }
    }
    case 'unary': {
      const a = build(e.arg)
      switch (e.op) {
        case 'neg':
          return (env) => -a(env)
        case 'plus':
          return a
        case 'percent':
          return (env) => a(env) / 100
        case 'degree':
          return (env) => (a(env) * Math.PI) / 180
        case 'factorial':
          return (env) => Numerics.factorial(a(env))
      }
      return a
    }
    case 'binary': {
      const l = build(e.left)
      const r = build(e.right)
      switch (e.op) {
        case 'add':
          return (env) => l(env) + r(env)
        case 'sub':
          return (env) => l(env) - r(env)
        case 'mul':
          return (env) => l(env) * r(env)
        case 'div':
          return (env) => {
            const d = r(env)
            return d === 0 ? NaN : l(env) / d
          }
        case 'pow':
          return (env) => Numerics.power(l(env), r(env))
        case 'mod':
          return (env) => Numerics.mod(l(env), r(env))
      }
      return l
    }
    case 'call': {
      const args = e.args.map(build)
      const name = e.name
      if (args.length === 1) {
        const a0 = args[0]
        return (env) => Numerics.apply(name, [a0(env)], 'radians')
      }
      return (env) => Numerics.apply(
        name,
        args.map((a) => a(env)),
        'radians'
      )
    }
  }
}

// MARK: Muestreo

export type Pt = [number, number]

export interface Range {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/**
 * Muestrea y = f(x) en trozos continuos: corta donde no está definida y en los saltos enormes (asíntotas de tan x o
 * 1/x). Refina una vez donde la curva gira mucho para que no se vea quebrada.
 */
export function sampleFx(f: (x: number) => number, r: Range, n = 600): Pt[][] {
  const out: Pt[][] = []
  let seg: Pt[] = []
  const span = r.yMax - r.yMin
  const limit = span * 8
  let prev: Pt | null = null
  const dx = (r.xMax - r.xMin) / n
  const push = (p: Pt) => {
    if (prev && Math.abs(p[1] - prev[1]) > limit && Math.sign(p[1]) !== Math.sign(prev[1])) {
      if (seg.length > 1) out.push(seg)
      seg = []
    }
    seg.push(p)
    prev = p
  }
  for (let i = 0; i <= n; i++) {
    const x = r.xMin + i * dx
    const y = f(x)
    if (!Number.isFinite(y)) {
      if (seg.length > 1) out.push(seg)
      seg = []
      prev = null
      continue
    }
    // refina entre la muestra anterior y esta si el salto vertical es grande pero continuo
    if (prev && Math.abs(y - prev[1]) > span * 0.08 && Math.abs(y - prev[1]) < limit) {
      const x0 = prev[0]
      for (let k = 1; k < 6; k++) {
        const xm = x0 + (dx * k) / 6
        const ym = f(xm)
        if (Number.isFinite(ym)) push([xm, ym])
      }
    }
    push([x, y])
  }
  if (seg.length > 1) out.push(seg)
  return out
}

/** Muestrea una curva paramétrica (o polar ya pasada a x, y) entre t0 y t1. */
export function sampleParam(fx: (t: number) => number, fy: (t: number) => number, t0: number, t1: number, n = 900, r?: Range): Pt[][] {
  const out: Pt[][] = []
  let seg: Pt[] = []
  const jump = r ? Math.max(r.xMax - r.xMin, r.yMax - r.yMin) * 2 : Infinity
  let prev: Pt | null = null
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n
    const x = fx(t)
    const y = fy(t)
    if (!Number.isFinite(x) || !Number.isFinite(y) || (prev && Math.hypot(x - prev[0], y - prev[1]) > jump)) {
      if (seg.length > 1) out.push(seg)
      seg = []
      prev = null
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    }
    seg.push([x, y])
    prev = [x, y]
  }
  if (seg.length > 1) out.push(seg)
  return out
}
