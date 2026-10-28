// Puntos notables de la función elegida: corte con el eje y, raíces, máximos y mínimos locales y cortes con las demás.
// Portado de GraphMath (la app Swift anterior: Sources/StudyUI/Tools/GraphingView.swift).

export type NotableKind = 'yIntercept' | 'root' | 'maximum' | 'minimum' | 'intersection'

export interface Notable {
  id: string
  kind: NotableKind
  x: number
  y: number
  /** Nombre de la otra función (cortes). */
  other?: string
}

type F = (x: number) => number

const ok = (y: number) => Number.isFinite(y)

/** Búsqueda de la sección áurea del máximo o mínimo en [a, b]. */
export function golden(f: F, a0: number, b0: number, maximize: boolean): number {
  const g = (Math.sqrt(5) - 1) / 2
  let a = a0
  let b = b0
  for (let i = 0; i < 60; i++) {
    const c = b - g * (b - a)
    const d = a + g * (b - a)
    const fc = f(c)
    const fd = f(d)
    if (!ok(fc) || !ok(fd)) break
    if (maximize ? fc > fd : fc < fd) b = d
    else a = c
  }
  return (a + b) / 2
}

/**
 * Ceros de f en [lo, hi]: cambios de signo (bisección) y, si `tangency`, mínimos que tocan el cero (x² en 0). Un salto
 * enorme con cambio de signo es una asíntota (tan x, 1/x), no una raíz.
 */
export function roots(f: F, lo: number, hi: number, span: number, tangency = true): number[] {
  const n = 720
  const out: number[] = []
  const samples: [number, number][] = []
  let prev: [number, number] | null = null
  let zeros: number[] = []
  const closeZeros = () => {
    if (zeros.length === 1) out.push(zeros[0])
    zeros = []
  }
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    const y = f(x)
    if (!ok(y)) {
      closeZeros()
      prev = null
      continue
    }
    samples.push([x, y])
    if (y === 0) zeros.push(x)
    else closeZeros()
    if (y !== 0 && prev && prev[1] !== 0 && prev[1] < 0 !== y < 0 && Math.abs(y - prev[1]) < (Number.isFinite(span) ? span * 4 : Infinity)) {
      let a = prev[0]
      let b = x
      let fa = prev[1]
      for (let k = 0; k < 80; k++) {
        const m = (a + b) / 2
        const fm = f(m)
        if (!ok(fm)) break
        if (fm < 0 === fa < 0) {
          a = m
          fa = fm
        } else b = m
      }
      const r = (a + b) / 2
      const fr = f(r)
      if (ok(fr) && Math.abs(fr) < Math.max(1e-7, Math.abs(prev[1]) * 1e-3)) out.push(r)
    }
    prev = [x, y]
  }
  closeZeros()
  if (tangency && samples.length > 2) {
    const tol = Math.max(1e-12, (Number.isFinite(span) ? span : 1) * 1e-9)
    for (let i = 1; i < samples.length - 1; i++) {
      const y = samples[i][1]
      const a = samples[i - 1][1]
      const b = samples[i + 1][1]
      if (a !== 0 && b !== 0 && Math.abs(y) < (Math.abs(a) + Math.abs(b)) * 0.5 && ((y <= a && y <= b && y >= 0) || (y >= a && y >= b && y <= 0))) {
        const r = golden(f, samples[i - 1][0], samples[i + 1][0], y < 0)
        const fr = f(r)
        if (ok(fr) && Math.abs(fr) < tol && !out.some((o) => Math.abs(o - r) < (hi - lo) * 1e-6)) out.push(r)
      }
    }
  }
  return out.sort((a, b) => a - b)
}

/** Extremos locales por muestreo (cuando no hay derivada). */
export function extremaSampled(f: F, lo: number, hi: number): { x: number; max: boolean }[] {
  const n = 600
  const v: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    const y = f(x)
    if (ok(y)) v.push([x, y])
  }
  const out: { x: number; max: boolean }[] = []
  for (let i = 2; i < v.length - 2; i++) {
    const y = v[i][1]
    if (y > v[i - 1][1] && y >= v[i + 1][1] && y > v[i - 2][1] && y > v[i + 2][1]) out.push({ x: golden(f, v[i - 1][0], v[i + 1][0], true), max: true })
    if (y < v[i - 1][1] && y <= v[i + 1][1] && y < v[i - 2][1] && y < v[i + 2][1]) out.push({ x: golden(f, v[i - 1][0], v[i + 1][0], false), max: false })
  }
  return out
}

/** Todos los puntos notables de f en el rango visible. `df` es su derivada (si se sabe calcular). */
export function notablePoints(f: F, df: F | null, others: { name: string; g: F }[], range: { xMin: number; xMax: number; yMin: number; yMax: number }): Notable[] {
  const { xMin: lo, xMax: hi } = range
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const span = range.yMax - range.yMin
  const out: Notable[] = []
  const used = new Set<string>()
  const add = (kind: NotableKind, x: number, y: number, other?: string) => {
    const id = `${kind}-${other ?? ''}-${x.toPrecision(6)}`
    if (used.has(id)) return
    used.add(id)
    out.push({ id, kind, x, y, other })
  }
  if (lo <= 0 && 0 <= hi) {
    const y0 = f(0)
    if (ok(y0)) add('yIntercept', 0, y0)
  }
  for (const x of roots(f, lo, hi, span).slice(0, 6)) add('root', Math.abs(x) < 1e-12 ? 0 : x, 0)
  if (df) {
    for (const x of roots(df, lo, hi, Infinity, false).slice(0, 6)) {
      const y = f(x)
      const h = 1e-4 * Math.max(1, Math.abs(x))
      const a = f(x - h)
      const b = f(x + h)
      if (!ok(y) || !ok(a) || !ok(b)) continue
      if (y >= a && y >= b) add('maximum', x, y)
      else if (y <= a && y <= b) add('minimum', x, y)
    }
  } else {
    for (const e of extremaSampled(f, lo, hi).slice(0, 6)) {
      const y = f(e.x)
      if (ok(y)) add(e.max ? 'maximum' : 'minimum', e.x, y)
    }
  }
  let cuts = 0
  for (const { name, g } of others) {
    const d = (x: number) => f(x) - g(x)
    for (const x of roots(d, lo, hi, span, false)) {
      if (cuts >= 6) break
      const y = f(x)
      if (!ok(y)) continue
      add('intersection', x, y, name)
      cuts++
    }
  }
  return out
}
