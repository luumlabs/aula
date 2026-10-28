// Gráfico de datos en SVG: barras que crecen desde la base, líneas que se dibujan, áreas, dispersión y sectores que se
// barren. Una serie usa la tinta del curso; varias, la paleta validada en orden (con leyenda). Cursor: lectura del dato.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cx, useTheme } from '@renderer/design'
import type { BlockOf, ChartBlock, ChartSeries } from '@shared/schema/blocks'
import type { BlockContext, BlockProps } from '../types'
import { Caption, Figure, useAnimate, useBlocksT, useProgress, useSeen, useWidth } from '../shared'
import { rampColors, seriesColors, withAlpha } from '../colors'
import { formatNumber } from '../plot/ticks'
import { arcPath, bands, categoryLabels, compactNumber, foldSlices, isCategoricalX, niceDomain, pieSlices, safeSeries, smoothPath, valueExtent, xExtent } from './scale'

type Fmt = (v: number) => string

const percent = (v: number, lang: string, digits: number): string => formatNumber(v, lang, digits) + (lang.startsWith('es') ? ' %' : '%')

const ease = [0.2, 0.7, 0.2, 1] as const

export function ChartBlockView({ block, ctx }: BlockProps<BlockOf<'chart'>>) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const series = useMemo(() => safeSeries(block.series), [block.series])
  const unit = block.unit?.trim()
  const fmt: Fmt = (v) => (unit === '%' ? percent(v, ctx.language, 3) : formatNumber(v, ctx.language, 3) + (unit ? ` ${unit}` : ''))
  const pie = block.kind === 'pie'
  const colors = seriesColors(series.length, ctx.hue, dark)
  const legend = !pie && series.length > 1
  return (
    <Figure ctx={ctx} title={block.title} caption={<Caption text={block.caption} />}>
      {legend && <Legend items={series.map((s, i) => ({ label: s.name, color: colors[i] }))} line={block.kind === 'line' || block.kind === 'scatter'} />}
      {series.length === 0 || series.every((s) => s.points.length === 0) ? (
        <div className="grid h-[160px] place-items-center rounded-[12px] bg-sunken t-callout text-text3">{t('chart.empty')}</div>
      ) : pie ? (
        <PieChart b={block} series={series} colors={colors} fmt={fmt} ctx={ctx} />
      ) : block.kind === 'bar' || block.kind === 'histogram' ? (
        <BarChart b={block} series={series} colors={colors} fmt={fmt} ctx={ctx} />
      ) : (
        <XYChart b={block} series={series} colors={colors} fmt={fmt} ctx={ctx} />
      )}
    </Figure>
  )
}

function Legend({ items, line }: { items: Array<{ label: string; color: string }>; line?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 t-ui text-text2">
          <span aria-hidden className={line ? 'h-[3px] w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Burbuja con la lectura del dato bajo el cursor. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const right = x > width / 2
  return (
    <div className="pointer-events-none absolute z-10 rounded-[10px] border-[0.5px] border-line bg-raised px-2.5 py-1.5 t-footnote shadow-[var(--e2)] whitespace-nowrap" style={{ top: Math.max(0, y), ...(right ? { right: width - x + 12 } : { left: x + 12 }) }}>
      {children}
    </div>
  )
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-text2">
      {color && <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />}
      <span>{label}</span>
      <span className="ml-auto pl-3 tabular font-semibold text-text">{value}</span>
    </div>
  )
}

interface ChartProps {
  b: ChartBlock
  series: ChartSeries[]
  colors: string[]
  fmt: Fmt
  ctx: BlockContext
}

/** Tamaño y márgenes comunes de los gráficos cartesianos. */
function useFrame(ctx: BlockContext, b: ChartBlock) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const height = ctx.mode === 'chat' ? 200 : 250
  const top = b.yLabel ? 26 : 16
  const bottom = b.xLabel ? 44 : 26
  return { ref, width, height, rect: { x: 48, y: top, w: Math.max(10, width - 60), h: Math.max(10, height - top - bottom) } }
}

function Axes({ rect, ticks, Y, lang, b, height }: { rect: { x: number; y: number; w: number; h: number }; ticks: number[]; Y: (v: number) => number; lang: string; b: ChartBlock; height: number }) {
  return (
    <>
      <g stroke="var(--line)" strokeWidth={1}>
        {ticks.map((v, i) => <line key={i} x1={rect.x} x2={rect.x + rect.w} y1={Y(v)} y2={Y(v)} stroke={Math.abs(v) < 1e-12 ? 'var(--line-strong)' : undefined} strokeOpacity={Math.abs(v) < 1e-12 ? 0.6 : 1} />)}
      </g>
      <g fontSize={11} fill="var(--text3)" className="tabular" textAnchor="end">
        {ticks.map((v, i) => (
          <text key={i} x={rect.x - 8} y={Y(v) + 3.8}>
            {compactNumber(v, lang)}
          </text>
        ))}
      </g>
      {b.yLabel && (
        <text x={rect.x - 8} y={11} fontSize={11.5} fill="var(--text2)" fontWeight={500}>
          {b.yLabel}
        </text>
      )}
      {b.xLabel && (
        <text x={rect.x + rect.w / 2} y={height - 4} fontSize={11.5} fill="var(--text2)" fontWeight={500} textAnchor="middle">
          {b.xLabel}
        </text>
      )}
    </>
  )
}

/** Etiquetas de las categorías: se aclaran (una de cada k) si no caben. */
function CategoryLabels({ labels, centers, y, slot }: { labels: string[]; centers: number[]; y: number; slot: number }) {
  const longest = Math.max(1, ...labels.map((l) => Array.from(l).length))
  const every = Math.max(1, Math.ceil((longest * 6.4 + 8) / Math.max(1, slot)))
  return (
    <g fontSize={11.5} fill="var(--text2)" textAnchor="middle">
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={i} x={centers[i]} y={y}>
            {Array.from(l).length > 18 ? Array.from(l).slice(0, 17).join('') + '…' : l}
          </text>
        ) : null
      )}
    </g>
  )
}

/** Barra con el extremo de datos redondeado (4 px) y la base recta. */
function barPath(x: number, yTop: number, w: number, h: number, up: boolean, round: number): string {
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(round, w / 2, h)
  if (up) return `M${x} ${yTop + h}V${yTop + r}Q${x} ${yTop} ${x + r} ${yTop}H${x + w - r}Q${x + w} ${yTop} ${x + w} ${yTop + r}V${yTop + h}Z`
  return `M${x} ${yTop}V${yTop + h - r}Q${x} ${yTop + h} ${x + r} ${yTop + h}H${x + w - r}Q${x + w} ${yTop + h} ${x + w} ${yTop + h - r}V${yTop}Z`
}

function BarChart({ b, series, colors, fmt, ctx }: ChartProps) {
  const { ref, width, height, rect } = useFrame(ctx, b)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const [hover, setHover] = useState<number | null>(null)
  const histogram = b.kind === 'histogram'
  const stacked = b.stacked && series.length > 1
  const labels = categoryLabels(series, (v) => formatNumber(v, ctx.language))
  const n = labels.length
  const [lo, hi] = valueExtent(series, stacked)
  const dom = niceDomain(lo, hi, Math.max(3, Math.floor(rect.h / 46)))
  const Y = (v: number) => rect.y + rect.h - ((v - dom.lo) / (dom.hi - dom.lo)) * rect.h
  const bs = bands(n, stacked ? 1 : series.length, rect.w, { histogram })
  const centers = bs.map((bd) => rect.x + bd.start + (bd.bar * (stacked ? 1 : series.length) + bd.gap * ((stacked ? 1 : series.length) - 1)) / 2 - (histogram ? 1 : 0))
  const showValues = b.showValues && !stacked && n * series.length <= 24 && (bs[0]?.bar ?? 0) >= 14
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={b.title ?? ''}>
        <Axes rect={rect} ticks={dom.ticks} Y={Y} lang={ctx.language} b={b} height={height} />
        {hover !== null && bs[hover] && <rect x={rect.x + hover * (rect.w / n)} y={rect.y} width={rect.w / n} height={rect.h} fill="var(--fill1)" rx={6} />}
        {bs.map((bd, i) => {
          let pos = 0
          let neg = 0
          const vals = series.map((s) => s.points[i]?.y ?? 0)
          const top = stacked ? vals.filter((v) => v > 0).reduce((a, v) => a + v, 0) : Math.max(0, ...vals)
          const bottom = stacked ? vals.filter((v) => v < 0).reduce((a, v) => a + v, 0) : Math.min(0, ...vals)
          const y0 = Y(top)
          const y1 = Y(bottom)
          const origin = y1 - y0 > 0 ? (Y(0) - y0) / (y1 - y0) : 1
          return (
            <motion.g
              key={i}
              initial={animate ? { scaleY: 0 } : false}
              animate={seen ? { scaleY: 1 } : undefined}
              transition={{ duration: 0.7, delay: 0.1 + i * 0.045, ease }}
              style={{ transformBox: 'fill-box', originY: origin }}
            >
              {series.map((s, k) => {
                const v = s.points[i]?.y
                if (v === undefined || v === 0) return null
                const x = rect.x + bd.start + (stacked ? 0 : k * (bd.bar + bd.gap))
                let a: number
                let z: number
                if (stacked) {
                  if (v > 0) {
                    a = Y(pos + v)
                    z = Y(pos)
                    pos += v
                  } else {
                    a = Y(neg)
                    z = Y(neg + v)
                    neg += v
                  }
                } else {
                  a = Y(Math.max(v, 0))
                  z = Y(Math.min(v, 0))
                }
                const gapPx = stacked && ((v > 0 && pos - v > 0) || (v < 0 && neg - v < 0)) ? 2 : 0
                const isEnd = !stacked || (v > 0 ? k === lastIndex(series, i, true) : k === lastIndex(series, i, false))
                const h = Math.max(0, z - a - gapPx)
                return <path key={k} d={barPath(x, v > 0 ? a : a + gapPx, bd.bar, h, v > 0, isEnd && !histogram ? 4 : 0)} fill={colors[k]} />
              })}
            </motion.g>
          )
        })}
        {showValues && (
          <motion.g fontSize={11} fill="var(--text2)" textAnchor="middle" className="tabular" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ delay: 0.5 + n * 0.045, duration: 0.3 }}>
            {bs.map((bd, i) =>
              series.map((s, k) => {
                const v = s.points[i]?.y
                if (v === undefined) return null
                const x = rect.x + bd.start + k * (bd.bar + bd.gap) + bd.bar / 2
                return (
                  <text key={`${i}-${k}`} x={x} y={v >= 0 ? Y(v) - 5 : Y(v) + 13}>
                    {compactNumber(v, ctx.language)}
                  </text>
                )
              })
            )}
          </motion.g>
        )}
        <CategoryLabels labels={labels} centers={centers} y={rect.y + rect.h + 16} slot={rect.w / Math.max(1, n)} />
        {/* zonas de cursor: la banda entera de cada categoría */}
        {Array.from({ length: n }, (_, i) => (
          <rect key={`h${i}`} x={rect.x + i * (rect.w / n)} y={rect.y} width={rect.w / n} height={rect.h + 20} fill="transparent" onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <Tip x={centers[hover] ?? 0} y={rect.y} width={width}>
          <div className="mb-0.5 font-semibold text-text">{labels[hover]}</div>
          {series.map((s, k) => (s.points[hover] ? <TipRow key={k} color={series.length > 1 ? colors[k] : undefined} label={series.length > 1 ? s.name : b.yLabel ?? ''} value={fmt(s.points[hover].y)} /> : null))}
        </Tip>
      )}
    </div>
  )
}

/** La última serie con valor del signo dado en la categoría (la que lleva el extremo redondeado en una pila). */
function lastIndex(series: ChartSeries[], i: number, positive: boolean): number {
  for (let k = series.length - 1; k >= 0; k--) {
    const v = series[k].points[i]?.y ?? 0
    if (positive ? v > 0 : v < 0) return k
  }
  return -1
}

function XYChart({ b, series, colors, fmt, ctx }: ChartProps) {
  const { ref, width, height, rect } = useFrame(ctx, b)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const categorical = isCategoricalX(series)
  const labels = categoryLabels(series, (v) => formatNumber(v, ctx.language))
  const n = labels.length
  const stacked = b.stacked && b.kind === 'area' && series.length > 1
  const [lo, hi] = valueExtent(series, stacked)
  const dom = niceDomain(lo, hi, Math.max(3, Math.floor(rect.h / 46)), b.kind === 'area')
  const [x0, x1] = xExtent(series)
  const xdom = niceDomain(x0, x1, Math.max(3, Math.floor(rect.w / 80)), false)
  const X = (v: number, i: number) => (categorical ? rect.x + (rect.w / Math.max(1, n)) * (i + 0.5) : rect.x + ((v - xdom.lo) / (xdom.hi - xdom.lo)) * rect.w)
  const Y = (v: number) => rect.y + rect.h - ((v - dom.lo) / (dom.hi - dom.lo)) * rect.h
  const scatter = b.kind === 'scatter'
  // cada serie en píxeles (ordenada por x); con apilado, sobre la anterior
  const cum: number[] = []
  const pixel = series.map((s) => {
    const pts = s.points.map((p, i) => {
      const base = stacked ? cum[i] ?? 0 : 0
      const y = base + p.y
      if (stacked) cum[i] = y
      return { x: X(p.x ?? i, i), y: Y(y), base: Y(base), v: p.y, xv: p.x ?? i, i, label: p.label }
    })
    return scatter ? pts : [...pts].sort((a, c) => a.x - c.x)
  })
  const markers = !scatter && Math.max(...series.map((s) => s.points.length)) <= 40
  const near = hover ? nearest(pixel, hover, scatter) : null
  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      onPointerMove={(e) => {
        const box = ref.current!.getBoundingClientRect()
        const p = { x: e.clientX - box.left, y: e.clientY - box.top }
        setHover(p.x >= rect.x - 8 && p.x <= rect.x + rect.w + 8 && p.y >= rect.y - 8 && p.y <= rect.y + rect.h + 8 ? p : null)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={b.title ?? ''}>
        <Axes rect={rect} ticks={dom.ticks} Y={Y} lang={ctx.language} b={b} height={height} />
        {categorical ? (
          <CategoryLabels labels={labels} centers={labels.map((_, i) => X(0, i))} y={rect.y + rect.h + 16} slot={rect.w / Math.max(1, n)} />
        ) : (
          <g fontSize={11} fill="var(--text3)" className="tabular" textAnchor="middle">
            {xdom.ticks.map((v, i) => (
              <text key={i} x={X(v, 0)} y={rect.y + rect.h + 16}>
                {compactNumber(v, ctx.language)}
              </text>
            ))}
          </g>
        )}
        {near && !scatter && <line x1={near.x} x2={near.x} y1={rect.y} y2={rect.y + rect.h} stroke="var(--text3)" strokeOpacity={0.6} strokeDasharray="3 3" />}
        {pixel.map((pts, k) => {
          if (scatter) {
            return (
              <g key={k}>
                {pts.map((p, i) => (
                  <motion.circle key={i} cx={p.x} cy={p.y} r={5} fill={colors[k]} fillOpacity={0.92} stroke="var(--surface)" strokeWidth={2} initial={animate ? { scale: 0 } : false} animate={seen ? { scale: 1 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.1 + Math.min(i, 60) * 0.012 + k * 0.1 }} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }} />
                ))}
              </g>
            )
          }
          const line = smoothPath(pts)
          const area = b.kind === 'area' && pts.length > 1 ? `${line}L${pts[pts.length - 1].x} ${stacked ? pts[pts.length - 1].base : Y(Math.max(dom.lo, 0))}${stacked ? [...pts].reverse().map((p) => `L${p.x} ${p.base}`).join('') : `L${pts[0].x} ${Y(Math.max(dom.lo, 0))}`}Z` : null
          return (
            <g key={k}>
              {area && <motion.path d={area} fill={withAlpha(colors[k], 16)} initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ duration: 0.6, delay: 0.7 + k * 0.12 }} />}
              <motion.path d={line} fill="none" stroke={colors[k]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={animate ? { pathLength: 0 } : false} animate={seen ? { pathLength: 1 } : undefined} transition={{ duration: 1.1, delay: 0.1 + k * 0.12, ease: [0.45, 0, 0.25, 1] }} />
              {markers &&
                pts.map((p, i) => (
                  <motion.circle key={i} cx={p.x} cy={p.y} r={4} fill={colors[k]} stroke="var(--surface)" strokeWidth={2} initial={animate ? { scale: 0 } : false} animate={seen ? { scale: 1 } : undefined} transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.25 + (i / Math.max(1, pts.length)) * 1.0 + k * 0.12 }} style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }} />
                ))}
              {b.showValues && pts.length > 0 && (
                <motion.text x={pts[pts.length - 1].x} y={pts[pts.length - 1].y - 9} fontSize={11} fill="var(--text2)" textAnchor="middle" className="tabular" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ delay: 1.2 + k * 0.12 }}>
                  {compactNumber(pts[pts.length - 1].v, ctx.language)}
                </motion.text>
              )}
            </g>
          )
        })}
        {near && near.points.map((p) => <circle key={`n${p.k}`} cx={p.x} cy={p.y} r={5.5} fill={colors[p.k]} stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />)}
      </svg>
      {near && (
        <Tip x={near.x} y={rect.y} width={width}>
          <div className="mb-0.5 font-semibold text-text">{near.title ?? (categorical ? labels[near.i] : `${b.xLabel ?? 'x'} = ${formatNumber(near.xv, ctx.language)}`)}</div>
          {near.points.map((p) => (
            <TipRow key={p.k} color={series.length > 1 ? colors[p.k] : undefined} label={series.length > 1 ? series[p.k].name : b.yLabel ?? ''} value={fmt(p.v)} />
          ))}
        </Tip>
      )}
    </div>
  )
}

type PixelPt = { x: number; y: number; v: number; xv: number; i: number; label?: string }

/** El dato más cercano al cursor: en dispersión, el punto (a menos de 28 px); si no, la x más cercana en todas las series. */
function nearest(pixel: PixelPt[][], h: { x: number; y: number }, scatter: boolean): { x: number; i: number; xv: number; title?: string; points: Array<{ k: number; x: number; y: number; v: number }> } | null {
  if (scatter) {
    let best: { k: number; p: PixelPt; d: number } | null = null
    pixel.forEach((pts, k) => pts.forEach((p) => {
      const d = Math.hypot(p.x - h.x, p.y - h.y)
      if (d < 28 && (!best || d < best.d)) best = { k, p, d }
    }))
    if (!best) return null
    const { k, p } = best as { k: number; p: PixelPt; d: number }
    return { x: p.x, i: p.i, xv: p.xv, title: p.label, points: [{ k, x: p.x, y: p.y, v: p.v }] }
  }
  let bx: PixelPt | null = null
  for (const pts of pixel) for (const p of pts) if (!bx || Math.abs(p.x - h.x) < Math.abs(bx.x - h.x)) bx = p
  if (!bx) return null
  const target = bx
  const points: Array<{ k: number; x: number; y: number; v: number }> = []
  pixel.forEach((pts, k) => {
    const p = pts.find((q) => Math.abs(q.x - target.x) < 0.5)
    if (p) points.push({ k, x: p.x, y: p.y, v: p.v })
  })
  return { x: target.x, i: target.i, xv: target.xv, points }
}

function PieChart({ b, series, fmt, ctx }: ChartProps) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const p = useProgress(seen, animate, 1100, 100)
  const [hover, setHover] = useState<number | null>(null)
  const pts = series[0]?.points ?? []
  const items = foldSlices(pts.map((q, i) => ({ label: q.label ?? (q.x !== undefined ? formatNumber(q.x, ctx.language) : String(i + 1)), value: q.y })), 8, t('chart.other'))
  const slices = pieSlices(items.map((x) => x.value))
  const colors = rampColors(items.length, ctx.hue, dark)
  const valueColumn = b.showValues && b.unit?.trim() !== '%'
  const total = items.reduce((a, x) => a + x.value, 0)
  const side = width >= 460
  const size = Math.min(ctx.mode === 'chat' ? 180 : 230, side ? width * 0.5 : width)
  const cx0 = size / 2
  const R = size / 2 - 6
  const r0 = R * 0.6
  const sweep = p * Math.PI * 2
  const focus = hover !== null ? slices.find((s) => s.index === hover) : undefined
  return (
    <div ref={ref} className={cx('flex w-full items-center gap-6', side ? 'flex-row' : 'flex-col')}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={b.title ?? ''} onPointerLeave={() => setHover(null)}>
          {slices.map((s) => {
            if (s.a0 >= sweep) return null
            const a1 = Math.min(s.a1, sweep)
            const mid = (s.a0 + s.a1) / 2
            const off = hover === s.index ? 5 : 0
            return (
              <path
                key={s.index}
                d={arcPath(cx0 + Math.sin(mid) * off, cx0 - Math.cos(mid) * off, r0, R, s.a0, a1)}
                fill={colors[s.index % colors.length]}
                stroke="var(--surface)"
                strokeWidth={2}
                strokeLinejoin="round"
                style={{ transition: 'd 0.18s', opacity: hover !== null && hover !== s.index ? 0.55 : 1 }}
                onPointerEnter={() => setHover(s.index)}
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-[60%]">
            <div className="t-caption truncate text-text3">{focus ? items[focus.index].label : t('chart.total')}</div>
            <div className="font-serif text-[22px] leading-[28px] tabular text-text">{focus ? fmt(focus.value) : fmt(total)}</div>
            {focus && <div className="t-caption tabular text-text2">{percent(focus.share * 100, ctx.language, 1)}</div>}
          </div>
        </div>
      </div>
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-col gap-1 p-0 self-stretch justify-center">
        {items.map((it, i) => {
          const share = total > 0 ? it.value / total : 0
          return (
            <motion.li
              key={i}
              className={cx('flex items-center gap-2.5 rounded-[8px] px-2 py-1 t-callout transition-colors', hover === i && 'bg-fill1')}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              initial={animate ? { opacity: 0, x: 6 } : false}
              animate={seen ? { opacity: 1, x: 0 } : undefined}
              transition={{ delay: 0.2 + i * 0.06, duration: 0.3 }}
            >
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colors[i % colors.length] }} />
              <span className="min-w-0 flex-1 truncate text-text">{it.label}</span>
              {valueColumn && <span className="tabular text-text2">{fmt(it.value)}</span>}
              <span className="min-w-12 whitespace-nowrap text-right tabular font-semibold text-text">{percent(share * 100, ctx.language, share < 0.01 ? 2 : share < 0.1 ? 1 : 0)}</span>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
