// Lienzo de una gráfica en SVG (port de PlotView.swift): rejilla y ejes con marcas limpias (o en múltiplos de π), curvas que
// se dibujan de izquierda a derecha, paramétricas, polares, puntos, rectas (asíntotas), regiones sombreadas y etiquetas que
// no se pisan. Pasa el cursor para leer las coordenadas; arrastra para mover, ⌘/Ctrl + rueda (o los botones) para acercar.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cx, Icon, IconButton, useTheme } from '@renderer/design'
import type { PlotSpec } from '@shared/schema/plot'
import type { BlockContext } from '../types'
import { FigLabel, useAnimate, useBlocksT, useSeen, useWidth } from '../shared'
import { namedColor } from '../colors'
import { compileFn, evalNumber, type Params, type RealFn } from './evaluate'
import { clip, curveFn, LIMITS, panRange, plotRange, trace, zoomRange, type Range } from './compile'
import { formatNumber, numberTicks, piTicks, type Tick } from './ticks'
import { boxAt, labelSize, placeLabel, type Box, type Candidate } from './labels'

const EMPTY: Params = {}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface OverlayLabel {
  text: string
  x: number
  y: number
  ax: number
  ay: number
  color: string
  weight: number
  size: number
}

interface Geometry {
  curves: Array<{ d: string; color: string; width: number; dashed: boolean; ends: Array<{ x: number; y: number; open: boolean }> }>
  extra: Array<{ d: string; color: string; dashed: boolean }>
  regions: Array<{ d: string; color: string; opacity: number }>
  lines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dashed: boolean; arrow?: string; faint: boolean }>
  points: Array<{ x: number; y: number; style: string; color: string }>
  labels: OverlayLabel[]
  xTicks: Tick[]
  yTicks: Tick[]
}

const clampPx = (v: number): number => (Number.isNaN(v) ? -1e5 : Math.max(-1e5, Math.min(1e5, v)))

/** Misma escala en x e y: se ensancha el eje que se queda corto (nunca se recorta lo que se ve). */
function equalize(r: Range, rect: Rect): Range {
  const ux = rect.w / (r.xMax - r.xMin)
  const uy = rect.h / (r.yMax - r.yMin)
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return r
  if (ux > uy) {
    const half = rect.w / uy / 2
    const c = (r.xMin + r.xMax) / 2
    return { ...r, xMin: c - half, xMax: c + half }
  }
  const half = rect.h / ux / 2
  const c = (r.yMin + r.yMax) / 2
  return { ...r, yMin: c - half, yMax: c + half }
}

function pathOf(segs: Array<Array<{ x: number; y: number }>>): string {
  let d = ''
  for (const s of segs) {
    if (s.length < 2) continue
    d += `M${s[0].x.toFixed(1)} ${s[0].y.toFixed(1)}`
    for (let i = 1; i < s.length; i++) d += `L${s[i].x.toFixed(1)} ${s[i].y.toFixed(1)}`
  }
  return d
}

/** Todo lo que se dibuja, en píxeles: se recalcula al cambiar la vista, el tamaño o los parámetros. */
function buildGeometry(spec: PlotSpec, params: Params, fns: Array<RealFn | null>, r: Range, rect: Rect, size: { w: number; h: number }, color: (n?: string) => string, lang: string): Geometry {
  const dx = r.xMax - r.xMin
  const dy = r.yMax - r.yMin
  const X = (x: number) => clampPx(rect.x + ((x - r.xMin) / dx) * rect.w)
  const Y = (y: number) => clampPx(rect.y + rect.h - ((y - r.yMin) / dy) * rect.h)
  const num = (s?: string) => evalNumber(s, params)
  const g: Geometry = { curves: [], extra: [], regions: [], lines: [], points: [], labels: [], xTicks: [], yTicks: [] }

  g.xTicks = spec.xPi ? piTicks(r.xMin, r.xMax, Math.max(4, Math.floor(rect.w / 70))) : numberTicks(r.xMin, r.xMax, Math.max(4, Math.floor(rect.w / 80)), lang, spec.xTickStep)
  g.yTicks = numberTicks(r.yMin, r.yMax, Math.max(3, Math.floor(rect.h / 60)), lang, spec.yTickStep)

  for (const reg of spec.regions.slice(0, LIMITS.regions)) {
    const a = num(reg.from)
    const b = num(reg.to)
    if (a === undefined || b === undefined || !(b > a)) continue
    const up = reg.upper.trim().toLowerCase()
    const lo = reg.lower.trim().toLowerCase()
    const upper: RealFn = up === 'inf' || up === 'top' ? () => r.yMax : compileFn(reg.upper, 'x', params) ?? (() => null)
    const lower: RealFn = lo === '-inf' || lo === 'bottom' ? () => r.yMin : compileFn(reg.lower, 'x', params) ?? (() => null)
    const top: string[] = []
    const bottom: string[] = []
    for (let i = 0; i <= 200; i++) {
      const x = a + ((b - a) * i) / 200
      const u = upper(x)
      const l = lower(x)
      if (u === null || l === null) continue
      top.push(`${X(x).toFixed(1)} ${Y(u).toFixed(1)}`)
      bottom.push(`${X(x).toFixed(1)} ${Y(l).toFixed(1)}`)
    }
    if (top.length < 2) continue
    const op = Number.isFinite(reg.opacity) ? Math.min(Math.max(reg.opacity, 0), 1) : 0.18
    g.regions.push({ d: `M${top.join('L')}L${bottom.reverse().join('L')}Z`, color: color(reg.color), opacity: op })
  }

  const ends = (kind: string, l: (typeof spec.lines)[number]): [number, number, number, number] | null => {
    if (kind === 'vertical') {
      const x = num(l.x)
      return x === undefined ? null : [X(x), rect.y + rect.h, X(x), rect.y]
    }
    if (kind === 'horizontal') {
      const y = num(l.y)
      return y === undefined ? null : [rect.x, Y(y), rect.x + rect.w, Y(y)]
    }
    const x1 = num(l.x1)
    const y1 = num(l.y1)
    const x2 = num(l.x2)
    const y2 = num(l.y2)
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null
    if (kind === 'segment') return [X(x1), Y(y1), X(x2), Y(y2)]
    const c = clip(x1, y1, x2 - x1, y2 - y1, r, kind === 'ray' ? 0 : -Infinity)
    if (!c) return null
    const a = [X(x1 + (x2 - x1) * c[0]), Y(y1 + (y2 - y1) * c[0])]
    const b = [X(x1 + (x2 - x1) * c[1]), Y(y1 + (y2 - y1) * c[1])]
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) return null
    return [a[0], a[1], b[0], b[1]]
  }
  const lineEnds = spec.lines.slice(0, LIMITS.lines).map((l) => ({ l, e: ends(l.kind, l) }))
  for (const { l, e } of lineEnds) {
    if (!e) continue
    const [x1, y1, x2, y2] = e
    let arrow: string | undefined
    if (l.arrow) {
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const s = 9
      arrow = `M${x2} ${y2}L${x2 - s * Math.cos(ang - 0.4)} ${y2 - s * Math.sin(ang - 0.4)}M${x2} ${y2}L${x2 - s * Math.cos(ang + 0.4)} ${y2 - s * Math.sin(ang + 0.4)}`
    }
    g.lines.push({ x1, y1, x2, y2, color: color(l.color), dashed: l.dashed, arrow, faint: (l.color ?? 'gray') === 'gray' })
  }

  const ink: Array<{ x: number; y: number }> = []
  const samples = Math.max(240, Math.round(rect.w * 1.3))
  spec.curves.slice(0, LIMITS.curves).forEach((c, i) => {
    const f = fns[i]
    if (!f) return
    const lo = Math.max(r.xMin, c.domainMin ?? r.xMin)
    const hi = Math.min(r.xMax, c.domainMax ?? r.xMax)
    if (!(hi > lo)) return
    const segs = trace(f, lo, hi, samples, r.yMin, r.yMax).map((s) => s.map((p) => ({ x: X(p.x), y: Y(p.y) })))
    for (const s of segs) for (let k = 0; k < s.length; k += 3) if (s[k].y >= rect.y && s[k].y <= rect.y + rect.h) ink.push(s[k])
    const dots: Array<{ x: number; y: number; open: boolean }> = []
    for (const [x, open] of [[c.domainMin, c.domainMinOpen], [c.domainMax, c.domainMaxOpen]] as Array<[number | undefined, boolean]>) {
      if (x === undefined || x < r.xMin || x > r.xMax) continue
      const y = f(x) ?? f(x + (x === c.domainMin ? 1e-6 : -1e-6))
      if (y !== null) dots.push({ x: X(x), y: Y(y), open })
    }
    const w = Number.isFinite(c.width) ? Math.min(Math.max(c.width, 0.5), 12) : 2.2
    g.curves.push({ d: pathOf(segs), color: color(c.color), width: w, dashed: c.dashed, ends: dots })
  })
  for (const p of spec.parametric.slice(0, LIMITS.curves)) {
    const fx = compileFn(p.x, 't', params)
    const fy = compileFn(p.y, 't', params)
    if (!fx || !fy || !Number.isFinite(p.tMin) || !Number.isFinite(p.tMax)) continue
    const seg: Array<Array<{ x: number; y: number }>> = [[]]
    for (let i = 0; i <= 600; i++) {
      const tt = p.tMin + ((p.tMax - p.tMin) * i) / 600
      const x = fx(tt)
      const y = fy(tt)
      if (x === null || y === null) {
        seg.push([])
        continue
      }
      seg[seg.length - 1].push({ x: X(x), y: Y(y) })
    }
    g.extra.push({ d: pathOf(seg), color: color(p.color), dashed: p.dashed })
  }
  for (const p of spec.polar.slice(0, LIMITS.curves)) {
    const f = compileFn(p.r, 'theta', params)
    if (!f || !Number.isFinite(p.thetaMin) || !Number.isFinite(p.thetaMax)) continue
    const seg: Array<Array<{ x: number; y: number }>> = [[]]
    for (let i = 0; i <= 720; i++) {
      const th = p.thetaMin + ((p.thetaMax - p.thetaMin) * i) / 720
      const rr = f(th)
      if (rr === null) {
        seg.push([])
        continue
      }
      seg[seg.length - 1].push({ x: X(rr * Math.cos(th)), y: Y(rr * Math.sin(th)) })
    }
    g.extra.push({ d: pathOf(seg), color: color(p.color), dashed: false })
  }
  const pts = spec.points.slice(0, LIMITS.points).map((p) => ({ p, x: num(p.x), y: num(p.y) }))
  for (const { p, x, y } of pts) if (x !== undefined && y !== undefined) g.points.push({ x: X(x), y: Y(y), style: p.style, color: color(p.color) })

  // etiquetas: primero las del autor (fijas), luego rectas, curvas y puntos; ninguna pisa a otra ni a los nombres de los ejes
  const placed: Box[] = []
  const bounds: Box = { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 4 }
  if (spec.xLabel) placed.push({ x: rect.x + rect.w - labelSize(spec.xLabel, 12).w - 4, y: size.h - 18, w: labelSize(spec.xLabel, 12).w + 4, h: 18 })
  if (spec.yLabel) placed.push({ x: 0, y: 0, w: labelSize(spec.yLabel, 12).w + 8, h: 18 })
  const put = (text: string, cands: Candidate[], colorValue: string, weight: number, fontSize: number) => {
    const s = labelSize(text, fontSize)
    const c = placeLabel(cands, s.w, s.h, placed, bounds, ink)
    if (c) g.labels.push({ text, x: c.x, y: c.y, ax: c.ax, ay: c.ay, color: colorValue, weight, size: fontSize })
  }
  for (const lb of spec.labels.slice(0, LIMITS.labels)) {
    const x = num(lb.x)
    const y = num(lb.y)
    if (x === undefined || y === undefined || !lb.tex.trim()) continue
    const a = lb.anchor.toLowerCase()
    const ax = a.includes('left') ? 0 : a.includes('right') ? 1 : 0.5
    const ay = a.includes('top') ? 0 : a.includes('bottom') ? 1 : 0.5
    const s = labelSize(lb.tex, 13.5)
    placed.push(boxAt({ x: X(x), y: Y(y), ax, ay }, s.w, s.h))
    g.labels.push({ text: lb.tex, x: X(x), y: Y(y), ax, ay, color: color(lb.color), weight: 500, size: 13.5 })
  }
  for (const { l, e } of lineEnds) {
    if (!l.label?.trim() || !e) continue
    const [x1, y1, x2, y2] = e
    let cands: Candidate[]
    if (l.kind === 'vertical') {
      cands = [{ x: x1 + 5, y: rect.y + 14, ax: 0, ay: 0.5 }, { x: x1 - 5, y: rect.y + 14, ax: 1, ay: 0.5 }, { x: x1 + 5, y: rect.y + rect.h - 14, ax: 0, ay: 0.5 }, { x: x1 - 5, y: rect.y + rect.h - 14, ax: 1, ay: 0.5 }]
    } else if (l.kind === 'horizontal') {
      cands = [{ x: rect.x + rect.w - 6, y: y1 - 3, ax: 1, ay: 1 }, { x: rect.x + rect.w - 6, y: y1 + 3, ax: 1, ay: 0 }, { x: rect.x + 6, y: y1 - 3, ax: 0, ay: 1 }, { x: rect.x + 6, y: y1 + 3, ax: 0, ay: 0 }]
      for (let f = 0.1; f <= 0.8; f += 0.1) cands.push({ x: rect.x + rect.w * f, y: y1 - 3, ax: 0, ay: 1 }, { x: rect.x + rect.w * f, y: y1 + 3, ax: 0, ay: 0 })
    } else {
      const k = l.kind === 'ray' ? 0.3 : 0.5
      const mx = x1 + (x2 - x1) * k
      const my = y1 + (y2 - y1) * k
      cands = [{ x: mx, y: my - 4, ax: 0.5, ay: 1 }, { x: mx, y: my + 4, ax: 0.5, ay: 0 }]
    }
    put(l.label, cands, (l.color ?? 'gray') === 'gray' ? 'var(--text2)' : color(l.color), 500, 12)
  }
  spec.curves.slice(0, LIMITS.curves).forEach((c, i) => {
    const f = fns[i]
    if (!c.label?.trim() || !f) return
    const lo = Math.max(r.xMin, c.domainMin ?? r.xMin)
    const hi = Math.min(r.xMax, c.domainMax ?? r.xMax)
    if (!(hi > lo)) return
    const visible = (fraction: number): { x: number; y: number } | null => {
      for (let k = Math.floor(240 * fraction); k >= 0; k--) {
        const x = lo + ((hi - lo) * k) / 240
        const y = f(x)
        if (y === null) continue
        const px = X(x)
        const py = Y(y)
        if (px >= rect.x + 2 && px <= rect.x + rect.w - 2 && py >= rect.y + 8 && py <= rect.y + rect.h - 8) return { x: px, y: py }
      }
      return null
    }
    const cands: Candidate[] = []
    for (const fr of [1, 0.82, 0.64, 0.46, 0.28]) {
      const p = visible(fr)
      if (!p) continue
      const right = p.x > rect.x + rect.w - 70
      const x = right ? p.x - 4 : p.x + 6
      cands.push({ x, y: p.y - 9, ax: right ? 1 : 0, ay: 1 }, { x, y: p.y + 9, ax: right ? 1 : 0, ay: 0 })
    }
    put(c.label, cands, color(c.color), 600, 13)
  })
  pts.forEach(({ p, x, y }) => {
    if (!p.label?.trim() || x === undefined || y === undefined) return
    const cx = X(x)
    const cy = Y(y)
    const right = cx < rect.x + rect.w - 70
    const up = cy > rect.y + 24
    const cands: Candidate[] = []
    for (const [rr, uu] of [[right, up], [right, !up], [!right, up], [!right, !up]]) cands.push({ x: cx + (rr ? 8 : -8), y: cy + (uu ? -8 : 8), ax: rr ? 0 : 1, ay: uu ? 1 : 0 })
    put(p.label, cands, 'var(--text)', 500, 12.5)
  })
  return g
}

export interface PlotCanvasProps {
  spec: PlotSpec
  ctx: BlockContext
  params?: Params
  /** Rango fijo (explore: los ejes no saltan al mover los deslizadores). */
  baseRange?: Range
  maxHeight?: number
}

export function PlotCanvas({ spec, ctx, params = EMPTY, baseRange, maxHeight }: PlotCanvasProps) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const wrap = useRef<HTMLDivElement>(null)
  const width = useWidth(wrap)
  const animate = useAnimate(ctx)
  const seen = useSeen(wrap, ctx)
  const interactive = ctx.mode !== 'print'
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const auto = useMemo(() => baseRange ?? plotRange(spec, params), [spec, params, baseRange])
  const [view, setView] = useState<Range | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; r: Range } | null>(null)
  const [hint, setHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [revealed, setRevealed] = useState(!animate)

  const fallbackRatio = spec.equalAspect ? Math.min(1.1, Math.max(0.35, (auto.yMax - auto.yMin) / (auto.xMax - auto.xMin))) : 0.62
  const ratio = spec.aspectRatio !== undefined && Number.isFinite(spec.aspectRatio) ? Math.min(1.4, Math.max(0.25, spec.aspectRatio)) : fallbackRatio
  const maxH = maxHeight ?? (ctx.mode === 'chat' ? 300 : 440)
  const height = Math.round(Math.min(maxH, Math.max(170, width * ratio)))
  const rect: Rect = useMemo(() => ({ x: 40, y: 12, w: Math.max(10, width - 56), h: Math.max(10, height - 40) }), [width, height])
  const range = useMemo(() => (spec.equalAspect ? equalize(view ?? auto, rect) : view ?? auto), [spec.equalAspect, view, auto, rect])
  const fns = useMemo(() => spec.curves.slice(0, LIMITS.curves).map((c) => curveFn(c, params)), [spec.curves, params])
  const color = useMemo(() => (n?: string) => namedColor(n, ctx.hue, dark), [ctx.hue, dark])
  const g = useMemo(() => buildGeometry(spec, params, fns, range, rect, { w: width, h: height }, color, ctx.language), [spec, params, fns, range, rect, width, height, color, ctx.language])

  // ⌘/Ctrl + rueda (o pellizco en el trackpad) acerca; la rueda sola deja pasar el desplazamiento de la lección con un aviso
  useEffect(() => {
    const el = wrap.current
    if (!el || !interactive) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true)
        if (hintTimer.current) clearTimeout(hintTimer.current)
        hintTimer.current = setTimeout(() => setHint(false), 1300)
        return
      }
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const px = e.clientX - box.left
      const py = e.clientY - box.top
      setView((v) => {
        const cur = v ?? auto
        const cx = cur.xMin + ((px - rect.x) / rect.w) * (cur.xMax - cur.xMin)
        const cy = cur.yMin + ((rect.y + rect.h - py) / rect.h) * (cur.yMax - cur.yMin)
        return zoomRange(cur, Math.exp(e.deltaY * 0.01), cx, cy)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (hintTimer.current) clearTimeout(hintTimer.current)
    }
  }, [interactive, auto, rect])

  const toData = (px: number, py: number, r: Range) => ({ x: r.xMin + ((px - rect.x) / rect.w) * (r.xMax - r.xMin), y: r.yMin + ((rect.y + rect.h - py) / rect.h) * (r.yMax - r.yMin) })
  const local = (e: ReactPointerEvent) => {
    const box = wrap.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const p = local(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ x: p.x, y: p.y, r: range })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    const p = local(e)
    if (drag) {
      const dxData = ((p.x - drag.x) / rect.w) * (drag.r.xMax - drag.r.xMin)
      const dyData = ((p.y - drag.y) / rect.h) * (drag.r.yMax - drag.r.yMin)
      setView(panRange(drag.r, -dxData, dyData))
      setHover(null)
      return
    }
    setHover(p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h ? p : null)
  }
  const endDrag = () => setDrag(null)
  const zoom = (f: number) => setView((v) => zoomRange(v ?? range, f))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    const span = { x: range.xMax - range.xMin, y: range.yMax - range.yMin }
    const keys: Record<string, () => void> = {
      '+': () => zoom(0.8), '=': () => zoom(0.8), '-': () => zoom(1.25), '0': () => setView(null),
      ArrowLeft: () => setView(panRange(range, -span.x * 0.1, 0)), ArrowRight: () => setView(panRange(range, span.x * 0.1, 0)),
      ArrowUp: () => setView(panRange(range, 0, span.y * 0.1)), ArrowDown: () => setView(panRange(range, 0, -span.y * 0.1))
    }
    const fn = keys[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  }

  const zeroX = range.xMin <= 0 && range.xMax >= 0
  const zeroY = range.yMin <= 0 && range.yMax >= 0
  const X = (x: number) => clampPx(rect.x + ((x - range.xMin) / (range.xMax - range.xMin)) * rect.w)
  const Y = (y: number) => clampPx(rect.y + rect.h - ((y - range.yMin) / (range.yMax - range.yMin)) * rect.h)
  const axisX = zeroY ? Y(0) : rect.y + rect.h
  const axisY = zeroX ? X(0) : rect.x
  const changed = view !== null

  // lectura bajo el cursor
  const reading = useMemo(() => {
    if (!hover) return null
    const d = toData(hover.x, hover.y, range)
    const rows: Array<{ label?: string; y: number; py: number; color: string }> = []
    spec.curves.slice(0, LIMITS.curves).forEach((c, i) => {
      const f = fns[i]
      if (!f || d.x < (c.domainMin ?? -Infinity) || d.x > (c.domainMax ?? Infinity)) return
      const y = f(d.x)
      const span = range.yMax - range.yMin
      if (y === null || y < range.yMin - span * 0.5 || y > range.yMax + span * 0.5) return
      rows.push({ label: c.label, y, py: Y(y), color: color(c.color) })
    })
    return { x: d.x, y: d.y, rows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, range, fns, spec.curves, color])

  const ease = [0.45, 0, 0.25, 1] as const
  const xName = spec.xLabel?.trim()
  const yName = spec.yLabel?.trim()

  return (
    <div
      ref={wrap}
      className={cx('group/plot relative w-full select-none outline-none rounded-[12px] focus-visible:ring-2 focus-visible:ring-accent-line', interactive && (drag ? 'cursor-grabbing' : 'cursor-crosshair'))}
      style={{ height, touchAction: interactive ? 'none' : undefined }}
      tabIndex={interactive ? 0 : undefined}
      role="img"
      aria-label={summary(spec, range, ctx.language, t)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => interactive && setView(null)}
      onKeyDown={onKey}
    >
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <clipPath id={`f${ids}`}>
            <rect x={rect.x - 0.5} y={rect.y - 0.5} width={rect.w + 1} height={rect.h + 1} />
          </clipPath>
          <clipPath id={`r${ids}`}>
            {revealed ? (
              <rect x={0} y={0} width={width} height={height} />
            ) : (
              <motion.rect x={0} y={0} width={width} height={height} initial={{ scaleX: 0 }} animate={seen ? { scaleX: 1 } : undefined} transition={{ duration: 1.3, ease, delay: 0.1 }} style={{ originX: 0, originY: 0 }} onAnimationComplete={() => seen && setRevealed(true)} />
            )}
          </clipPath>
        </defs>
        {/* rejilla */}
        {spec.grid && (
          <g stroke="var(--line)" strokeWidth={1}>
            {g.xTicks.map((tk, i) => <line key={`gx${i}`} x1={X(tk.value)} x2={X(tk.value)} y1={rect.y} y2={rect.y + rect.h} />)}
            {g.yTicks.map((tk, i) => <line key={`gy${i}`} x1={rect.x} x2={rect.x + rect.w} y1={Y(tk.value)} y2={Y(tk.value)} />)}
          </g>
        )}
        <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke="var(--line)" strokeWidth={1} rx={2} />
        {/* ejes con flecha */}
        {spec.axes && (
          <g stroke="var(--text2)" strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {zeroY && <path d={`M${rect.x} ${axisX}H${rect.x + rect.w}M${rect.x + rect.w - 7} ${axisX - 3.5}L${rect.x + rect.w} ${axisX}L${rect.x + rect.w - 7} ${axisX + 3.5}`} />}
            {zeroX && <path d={`M${axisY} ${rect.y + rect.h}V${rect.y}M${axisY - 3.5} ${rect.y + 7}L${axisY} ${rect.y}L${axisY + 3.5} ${rect.y + 7}`} />}
          </g>
        )}
        {/* contenido: recortado al área y descubierto de izquierda a derecha */}
        <g clipPath={`url(#f${ids})`}>
          <g clipPath={`url(#r${ids})`}>
            {g.regions.map((rg, i) => <path key={`rg${i}`} d={rg.d} fill={rg.color} fillOpacity={rg.opacity} />)}
            {g.lines.map((l, i) => (
              <g key={`l${i}`} stroke={l.color} strokeOpacity={l.faint ? 0.75 : 1} fill="none" strokeLinecap="round">
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={1.6} strokeDasharray={l.dashed ? '6 4' : undefined} />
                {l.arrow && <path d={l.arrow} strokeWidth={1.8} />}
              </g>
            ))}
            {g.curves.map((c, i) => <path key={`c${i}`} d={c.d} fill="none" stroke={c.color} strokeWidth={c.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={c.dashed ? '6 4' : undefined} />)}
            {g.extra.map((c, i) => <path key={`e${i}`} d={c.d} fill="none" stroke={c.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={c.dashed ? '6 4' : undefined} />)}
          </g>
        </g>
        {/* marcas y números junto a los ejes (encima de las curvas, con un halo de papel)*/}
        <g fontSize={11} fill="var(--text2)" className="tabular" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
          {g.xTicks.map((tk, i) => {
            if (tk.label === '0' && zeroX && zeroY) return null
            const px = X(tk.value)
            if (xName && px > rect.x + rect.w - labelSize(xName, 12).w - 14) return null
            const py = Math.min(rect.y + rect.h, Math.max(rect.y, axisX))
            return (
              <g key={`tx${i}`}>
                <line x1={px} x2={px} y1={py - 3} y2={py + 3} stroke="var(--text2)" strokeWidth={1} />
                <text x={px} y={py + 15} textAnchor="middle" fontFamily={spec.xPi ? 'var(--font-serif)' : undefined} fontSize={spec.xPi ? 12.5 : 11}>
                  {tk.label}
                </text>
              </g>
            )
          })}
          {g.yTicks.map((tk, i) => {
            if (Math.abs(tk.value) < 1e-12 && zeroX && zeroY) return null
            const py = Y(tk.value)
            if (yName && py < rect.y + 16) return null
            const px = Math.min(rect.x + rect.w, Math.max(rect.x, axisY))
            return (
              <g key={`ty${i}`}>
                <line x1={px - 3} x2={px + 3} y1={py} y2={py} stroke="var(--text2)" strokeWidth={1} />
                <text x={px - 6} y={py + 3.8} textAnchor="end">
                  {tk.label}
                </text>
              </g>
            )
          })}
          {zeroX && zeroY && (
            <text x={axisY - 5} y={axisX + 14} textAnchor="end">
              0
            </text>
          )}
        </g>
        <g clipPath={`url(#f${ids})`}>
          <motion.g initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ duration: 0.4, delay: 0.95 }}>
            {g.curves.flatMap((c, i) => c.ends.map((e, k) => <circle key={`d${i}-${k}`} cx={e.x} cy={e.y} r={4.2} fill={e.open ? 'var(--surface)' : c.color} stroke={c.color} strokeWidth={e.open ? 1.8 : 0} />))}
            {g.points.map((p, i) => <PointMark key={`p${i}`} {...p} />)}
          </motion.g>
        </g>
        {/* lectura bajo el cursor */}
        {reading && (
          <g pointerEvents="none">
            <line x1={hover!.x} x2={hover!.x} y1={rect.y} y2={rect.y + rect.h} stroke="var(--text3)" strokeOpacity={0.7} strokeDasharray="3 3" />
            {reading.rows.map((rw, i) => rw.py >= rect.y && rw.py <= rect.y + rect.h && <circle key={i} cx={hover!.x} cy={rw.py} r={4.5} fill={rw.color} stroke="var(--surface)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {/* etiquetas (fórmulas con KaTeX) */}
      <motion.div className="pointer-events-none absolute inset-0" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ duration: 0.45, delay: 1.05 }}>
        {g.labels.map((l, i) => (
          <div key={i} className="absolute" style={{ left: l.x, top: l.y, transform: `translate(${-l.ax * 100}%, ${-l.ay * 100}%)`, color: l.color, fontWeight: l.weight, fontSize: l.size }}>
            <span className="rounded-[4px] px-0.5" style={{ background: 'color-mix(in oklab, var(--surface) 78%, transparent)' }}>
              <FigLabel text={l.text} />
            </span>
          </div>
        ))}
        {xName && (
          <div className="absolute t-footnote text-text2" style={{ right: width - rect.x - rect.w, bottom: 0 }}>
            <FigLabel text={xName} />
          </div>
        )}
        {yName && (
          <div className="absolute t-footnote text-text2" style={{ left: 2, top: -2 }}>
            <FigLabel text={yName} />
          </div>
        )}
      </motion.div>
      {reading && (
        <div className="pointer-events-none absolute z-10 rounded-[10px] border-[0.5px] border-line bg-raised px-2.5 py-1.5 t-footnote shadow-[var(--e2)]" style={{ top: rect.y + 8, ...(hover!.x > rect.x + rect.w / 2 ? { right: width - hover!.x + 12 } : { left: hover!.x + 12 }) }}>
          <div className="tabular font-semibold text-text whitespace-nowrap">x = {formatNumber(reading.x, ctx.language)}</div>
          {reading.rows.slice(0, 4).map((rw, i) => (
            <div key={i} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-text2">
              <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: rw.color }} />
              {rw.label ? <FigLabel text={rw.label} className="text-text2" /> : <span>y</span>}
              <span className="tabular font-semibold text-text">{formatNumber(rw.y, ctx.language)}</span>
            </div>
          ))}
          {reading.rows.length === 0 && <div className="tabular text-text2 whitespace-nowrap">y = {formatNumber(reading.y, ctx.language)}</div>}
        </div>
      )}
      {interactive && (
        <div className={cx('absolute right-[22px] top-[18px] z-10 flex items-center gap-0.5 rounded-[10px] border-[0.5px] border-line bg-raised/95 p-0.5 shadow-[var(--e2)] transition-opacity duration-200', changed ? 'opacity-100' : 'opacity-0 group-hover/plot:opacity-100 group-focus-within/plot:opacity-100')}>
          <IconButton size="sm" label={t('plot.zoomIn')} onClick={() => zoom(0.7)}>
            <Icon name="plus" size={14} />
          </IconButton>
          <IconButton size="sm" label={t('plot.zoomOut')} onClick={() => zoom(1 / 0.7)}>
            <Icon name="minus" size={14} />
          </IconButton>
          <AnimatePresence initial={false}>
            {changed && (
              <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden">
                <IconButton size="sm" label={t('plot.reset')} onClick={() => setView(null)}>
                  <Icon name="undo" size={14} />
                </IconButton>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
      <AnimatePresence>
        {hint && (
          <motion.div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <span className="rounded-full bg-text px-3 py-1 t-footnote font-semibold text-paper shadow-[var(--e2)]">{t('plot.wheelHint', { mod: /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl' })}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PointMark({ x, y, style, color }: { x: number; y: number; style: string; color: string }) {
  const r = 5
  switch (style) {
    case 'open':
      return <circle cx={x} cy={y} r={r} fill="var(--surface)" stroke={color} strokeWidth={2} />
    case 'cross':
      return <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    default:
      return <circle cx={x} cy={y} r={r} fill={color} stroke="var(--surface)" strokeWidth={2} />
  }
}

/** Resumen para lectores de pantalla: las curvas y el rango visible. */
function summary(spec: PlotSpec, r: Range, lang: string, t: ReturnType<typeof useBlocksT>): string {
  const curves = spec.curves.slice(0, 6).map((c) => (c.label ?? `y = ${c.expr}`).replace(/\$/g, ''))
  const f = (v: number) => formatNumber(v, lang, 2)
  return t('plot.summary', { title: spec.title?.replace(/\$/g, '') ?? '', curves: curves.join('; '), x0: f(r.xMin), x1: f(r.xMax), y0: f(r.yMin), y1: f(r.yMax) })
}
