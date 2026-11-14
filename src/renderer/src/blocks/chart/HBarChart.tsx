// Barras horizontales: para clasificaciones y nombres largos («Enfermedades cardiovasculares»), que bajo una barra vertical
// no se leerían. Los nombres van a la izquierda (en una o dos líneas), las barras crecen desde el cero y la cifra va al
// final de cada barra. Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/chart.ts (hbar).
import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { ChartBlock, ChartSeries } from '@shared/schema/blocks'
import type { BlockContext } from '../types'
import { useAnimate, useSeen, useWidth } from '../shared'
import { withAlpha } from '../colors'
import { formatNumber } from '../plot/ticks'
import { canvasMeasure, useFontsReady } from '../visual/shared/measure'
import { categoryLabels, compactNumber, labelLines, niceDomain, valueExtent } from './scale'

type Fmt = (v: number) => string

const ease = [0.2, 0.7, 0.2, 1] as const
const FONT = 12
const measureAt = (size: number, bold = false) => (s: string): number => canvasMeasure(s, size, bold)

/** Barra horizontal con el extremo de datos redondeado (hacia la derecha si es positiva) y la base recta. */
export function hbarPath(x: number, y: number, w: number, h: number, right: boolean, round: number): string {
  if (h <= 0 || w <= 0) return ''
  const r = Math.min(round, h / 2, w)
  if (right) return `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z`
  return `M${x + w} ${y}H${x + r}Q${x} ${y} ${x} ${y + r}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w}Z`
}

export function HBarChart({ b, series, colors, fmt, ctx, ink }: { b: ChartBlock; series: ChartSeries[]; colors: string[]; fmt: Fmt; ctx: BlockContext; ink: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const fonts = useFontsReady()
  const [hover, setHover] = useState<number | null>(null)
  void fonts
  const stacked = b.stacked && series.length > 1
  const groups = stacked ? 1 : series.length
  const labels = categoryLabels(series, (v) => formatNumber(v, ctx.language))
  const n = labels.length
  const hl = labels.map((_, i) => series.some((s) => s.points[i]?.highlight))
  const anyHl = hl.some(Boolean)
  const single = series.length === 1
  const measure = measureAt(FONT)
  // la cifra al final de la barra, con «%» si la unidad es un porcentaje
  const pct = b.unit?.trim() === '%' ? (ctx.language.startsWith('es') ? ' %' : '%') : ''
  const valueText = (v: number): string => compactNumber(v, ctx.language) + pct
  const measureBold = measureAt(FONT, true)
  // columna de nombres: lo que mida el más largo (en dos líneas si hace falta), como mucho el 42 % del ancho
  const maxCol = Math.max(80, width * 0.42)
  const lines = labels.map((l, i) => labelLines(l, maxCol - 12, hl[i] ? measureBold : measure))
  const labelW = Math.min(maxCol, Math.max(40, ...lines.flat().map((l) => measureBold(l))) + 14)
  const twoLines = lines.some((ls) => ls.length > 1)
  const rowH = Math.max(twoLines ? 36 : 28, groups * 13 + 14)
  const barH = Math.max(6, Math.min(18, (rowH - 12) / groups - (groups > 1 ? 2 : 0)))
  const top = b.xLabel ? 22 : 6
  const plotH = n * rowH
  const [lo, hi] = valueExtent(series, stacked)
  // hueco a la derecha para la cifra de la barra más larga
  const values = b.showValues && !stacked
  const valueW = values || anyHl ? Math.max(...series.flatMap((s) => s.points.map((p) => measure(valueText(p.y))))) + 10 : 12
  // con negativos, la cifra de su barra va a la izquierda: también hace falta sitio allí
  const plotX = labelW + (lo < 0 && (values || anyHl) ? valueW : 0)
  const plotW = Math.max(40, width - plotX - valueW)
  const dom = niceDomain(lo, hi, Math.max(2, Math.floor(plotW / 80)))
  const X = (v: number): number => plotX + ((v - dom.lo) / (dom.hi - dom.lo)) * plotW
  const axisY = top + plotH
  const height = axisY + 22 + (b.yLabel ? 18 : 0)
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="img" aria-label={b.title ?? ''}>
        {/* rejilla y marcas debajo, el cero más marcado */}
        <g stroke="var(--line)" strokeWidth={1}>
          {dom.ticks.map((v, i) => <line key={i} x1={X(v)} x2={X(v)} y1={top - 2} y2={axisY} stroke={Math.abs(v) < 1e-12 ? 'var(--line-strong)' : undefined} strokeOpacity={Math.abs(v) < 1e-12 ? 0.7 : 1} />)}
        </g>
        <g fontSize={11} fill="var(--text3)" className="tabular" textAnchor="middle">
          {dom.ticks.map((v, i) => <text key={i} x={X(v)} y={axisY + 15}>{compactNumber(v, ctx.language)}</text>)}
        </g>
        {b.xLabel && <text x={4} y={12} fontSize={11.5} fill="var(--text2)" fontWeight={500}>{b.xLabel}</text>}
        {b.yLabel && <text x={plotX + plotW / 2} y={height - 4} fontSize={11.5} fill="var(--text2)" fontWeight={500} textAnchor="middle">{b.yLabel}</text>}
        {/* la fila destacada (con varias series) y la que está bajo el cursor */}
        {!single && hl.map((on, i) => on && <rect key={`hb${i}`} x={2} y={top + i * rowH + 1} width={width - 4} height={rowH - 2} rx={7} fill={withAlpha(ink, 10)} />)}
        {hover !== null && <rect x={2} y={top + hover * rowH + 1} width={width - 4} height={rowH - 2} rx={7} fill="var(--fill1)" />}
        <g fontSize={FONT} textAnchor="end">
          {lines.map((ls, i) => {
            const cy = top + i * rowH + rowH / 2
            return (
              <text key={i} x={labelW - 10} y={cy - ((ls.length - 1) * 14) / 2 + 4.2} fill={hl[i] ? 'var(--text)' : 'var(--text2)'} fontWeight={hl[i] ? 600 : 400}>
                {ls.map((l, k) => <tspan key={k} x={labelW - 10} dy={k ? 14 : 0}>{l}</tspan>)}
              </text>
            )
          })}
        </g>
        {labels.map((_, i) => {
          let pos = 0
          let neg = 0
          const vals = series.map((s) => s.points[i]?.y ?? 0)
          const right = stacked ? vals.filter((v) => v > 0).reduce((a, v) => a + v, 0) : Math.max(0, ...vals)
          const left = stacked ? vals.filter((v) => v < 0).reduce((a, v) => a + v, 0) : Math.min(0, ...vals)
          const x0 = X(left)
          const x1 = X(right)
          const origin = x1 - x0 > 0 ? (X(0) - x0) / (x1 - x0) : 0
          const y0 = top + i * rowH + (rowH - (barH * groups + 2 * (groups - 1))) / 2
          return (
            <motion.g
              key={i}
              initial={animate ? { scaleX: 0 } : false}
              animate={seen ? { scaleX: 1 } : undefined}
              transition={{ duration: 0.7, delay: 0.1 + Math.min(i, 30) * 0.045, ease }}
              style={{ transformBox: 'fill-box', originX: origin }}
            >
              {series.map((s, k) => {
                const v = s.points[i]?.y
                if (v === undefined || v === 0) return null
                let a: number
                let z: number
                if (stacked) {
                  if (v > 0) { a = X(pos); z = X(pos + v); pos += v } else { a = X(neg + v); z = X(neg); neg += v }
                } else {
                  a = X(Math.min(v, 0))
                  z = X(Math.max(v, 0))
                }
                const y = stacked ? y0 : y0 + k * (barH + 2)
                const isEnd = !stacked || k === lastWithSign(series, i, v > 0)
                // en una pila, 2 px de papel entre trozos (en el lado que se aleja del cero)
                const gap = isEnd ? 0 : 2
                const x = v > 0 ? a : a + gap
                const color = single && anyHl && !hl[i] ? withAlpha(colors[k], 38) : colors[k]
                return (
                  <path
                    key={k}
                    d={hbarPath(x, y, Math.max(0, z - a - gap), barH, v > 0, isEnd ? 4 : 0)}
                    fill={color}
                    data-ask-part={`bar:${i}:${k}`}
                    data-ask-label={single ? labels[i] : `${labels[i]} · ${s.name}`}
                  />
                )
              })}
            </motion.g>
          )
        })}
        {(values || anyHl) && (
          <motion.g fontSize={11} className="tabular" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ delay: 0.5 + Math.min(n, 30) * 0.045, duration: 0.3 }}>
            {labels.map((_, i) => {
              // la cifra al final de cada barra; en una pila, solo el total de la fila destacada
              if (!values && !hl[i]) return null
              if (stacked) {
                const total = series.reduce((a, q) => a + Math.max(0, q.points[i]?.y ?? 0), 0)
                return (
                  <text key={i} x={X(total) + 5} y={top + i * rowH + rowH / 2 + 3.8} fill="var(--text)" fontWeight={600}>
                    {valueText(total)}
                  </text>
                )
              }
              return series.map((s, k) => {
                const v = s.points[i]?.y
                if (v === undefined) return null
                const y = top + i * rowH + (rowH - (barH * groups + 2 * (groups - 1))) / 2 + k * (barH + 2) + barH / 2 + 3.8
                return (
                  <text key={`${i}-${k}`} x={v >= 0 ? X(v) + 5 : X(v) - 5} y={y} textAnchor={v >= 0 ? 'start' : 'end'} fill={hl[i] ? 'var(--text)' : 'var(--text2)'} fontWeight={hl[i] ? 600 : 400}>
                    {valueText(v)}
                  </text>
                )
              })
            })}
          </motion.g>
        )}
        {/* zonas de cursor: la fila entera */}
        {labels.map((_, i) => <rect key={`h${i}`} x={0} y={top + i * rowH} width={width} height={rowH} fill="transparent" onPointerEnter={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute z-10 rounded-[10px] border-[0.5px] border-line bg-raised px-2.5 py-1.5 t-footnote shadow-[var(--e2)] whitespace-nowrap" style={{ top: Math.max(0, top + hover * rowH + rowH), right: 8 }}>
          <div className="mb-0.5 font-semibold text-text">{labels[hover]}</div>
          {series.map((s, k) =>
            s.points[hover] ? (
              <div key={k} className="flex items-center gap-1.5 text-text2">
                {series.length > 1 && <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: colors[k] }} />}
                <span>{series.length > 1 ? s.name : b.yLabel ?? ''}</span>
                <span className="ml-auto pl-3 tabular font-semibold text-text">{fmt(s.points[hover].y)}</span>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  )
}

/** La última serie con valor del signo dado en la fila (la que lleva el extremo redondeado en una pila). */
function lastWithSign(series: ChartSeries[], i: number, positive: boolean): number {
  for (let k = series.length - 1; k >= 0; k--) {
    const v = series[k].points[i]?.y ?? 0
    if (positive ? v > 0 : v < 0) return k
  }
  return -1
}
