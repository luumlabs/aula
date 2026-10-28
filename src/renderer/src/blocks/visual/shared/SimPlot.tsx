// Gráfica de una simulación en SVG: retícula, ejes con marcas, curvas que dependen de los deslizadores (en las gráficas
// «contra el tiempo», trazadas hasta el instante actual), rectas de referencia, regiones y los objetos del instante (puntos con
// su rastro, vectores, segmentos y etiquetas con fórmulas).
import { memo, useId, useMemo } from 'react'
import type { PlotSpec } from '@shared/schema/plot'
import { RichText } from '@renderer/lib/RichText'
import { formatSimValue, type Env, type Resolved, type SimulationEngine } from '../lib/simulation'
import { plotFrame, plotNumber, polylinePath, sampleFunction, ticks, type PlotFrame, type PlotRange } from '../lib/simPlot'
import { INK, mathify, vizColor, wash } from './colors'

export interface SimPlotProps {
  engine: SimulationEngine
  spec: PlotSpec
  env: Env
  objects: Resolved[]
  range: PlotRange
  width: number
  height: number
  /** Instante actual en una gráfica contra el tiempo (las curvas se trazan hasta aquí). */
  sweepX?: number
  decimalSep: string
}

const PAD = { left: 46, right: 16, top: 14, bottom: 34 }

function tickLabel(v: number, step: number, sep: string): string {
  const dec = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step) - 1e-9))
  return formatSimValue(Number(v.toFixed(dec)), dec, sep)
}

export const SimPlot = memo(function SimPlot({ engine, spec, env, objects, range, width, height, sweepX, decimalSep }: SimPlotProps) {
  const id = useId().replace(/:/g, '')
  const f = useMemo(() => plotFrame(range, width, height, { ...PAD, left: spec.axes || spec.grid ? PAD.left : 14, bottom: spec.axes || spec.grid ? PAD.bottom : 14 }, spec.equalAspect), [range, width, height, spec.axes, spec.grid, spec.equalAspect])
  const xt = useMemo(() => ticks(range.xMin, range.xMax, Math.max(3, Math.round(f.plotW / 90)), spec.xTickStep), [range, f.plotW, spec.xTickStep])
  const yt = useMemo(() => ticks(range.yMin, range.yMax, Math.max(3, Math.round(f.plotH / 56)), spec.yTickStep), [range, f.plotH, spec.yTickStep])
  const xStep = xt.length > 1 ? xt[1] - xt[0] : 1, yStep = yt.length > 1 ? yt[1] - yt[0] : 1
  const yLim = (range.yMax - range.yMin) * 50
  const curves = spec.curves.slice(0, 12).map((c) => ({ c, segs: sampleFunction(engine, c.expr, env, Math.max(range.xMin, c.domainMin ?? range.xMin), Math.min(range.xMax, c.domainMax ?? range.xMax), { degrees: c.degrees, samples: Math.min(600, Math.round(f.plotW)), yLimit: yLim }) }))
  const x0 = range.xMin <= 0 && range.xMax >= 0 ? f.sx(0) : f.left
  const y0 = range.yMin <= 0 && range.yMax >= 0 ? f.sy(0) : f.top + f.plotH
  const sweep = sweepX !== undefined && Number.isFinite(sweepX) ? Math.min(f.left + f.plotW, Math.max(f.left, f.sx(sweepX))) : undefined
  const labels: Array<{ x: number; y: number; text: string; color: string; dx: number; dy: number }> = []

  return (
    <div className="relative" style={{ width, height }}>
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <defs>
          <clipPath id={`plot-${id}`}>
            <rect x={f.left} y={f.top} width={f.plotW} height={f.plotH} />
          </clipPath>
          {sweep !== undefined && (
            <clipPath id={`sweep-${id}`}>
              <rect x={f.left - 2} y={f.top - 4} width={sweep - f.left + 2} height={f.plotH + 8} />
            </clipPath>
          )}
        </defs>
        {spec.grid && (
          <g stroke="var(--line)" strokeWidth={0.75}>
            {xt.map((v) => <line key={`gx${v}`} x1={f.sx(v)} x2={f.sx(v)} y1={f.top} y2={f.top + f.plotH} />)}
            {yt.map((v) => <line key={`gy${v}`} x1={f.left} x2={f.left + f.plotW} y1={f.sy(v)} y2={f.sy(v)} />)}
          </g>
        )}
        {spec.axes && (
          <g>
            <line x1={f.left} x2={f.left + f.plotW} y1={y0} y2={y0} stroke="var(--text3)" strokeWidth={1} />
            <line x1={x0} x2={x0} y1={f.top} y2={f.top + f.plotH} stroke="var(--text3)" strokeWidth={1} />
            {xt.map((v) => (
              <text key={`tx${v}`} x={f.sx(v)} y={f.top + f.plotH + 16} textAnchor="middle" className="fill-text3" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                {tickLabel(v, xStep, decimalSep)}
              </text>
            ))}
            {yt.map((v) => (
              <text key={`ty${v}`} x={f.left - 7} y={f.sy(v) + 3.5} textAnchor="end" className="fill-text3" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                {tickLabel(v, yStep, decimalSep)}
              </text>
            ))}
          </g>
        )}
        <g clipPath={`url(#plot-${id})`}>
          {spec.regions.slice(0, 8).map((r, i) => <Region key={`r${i}`} engine={engine} env={env} f={f} r={r} />)}
          {curves.map(({ c, segs }) => {
            const color = vizColor(c.color)
            const d = segs.map((s) => polylinePath(s, f)).join('')
            const common = { d, fill: 'none', stroke: color, strokeWidth: Math.min(5, Math.max(1, c.width)), strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeDasharray: c.dashed ? '6 5' : undefined }
            if (sweep === undefined) return <path key={c.id} {...common} />
            // la curva se va trazando: lo que falta, tenue
            return (
              <g key={c.id}>
                <path {...common} strokeOpacity={0.22} />
                <path {...common} clipPath={`url(#sweep-${id})`} />
              </g>
            )
          })}
          {spec.lines.slice(0, 20).map((l, i) => {
            const color = vizColor(l.color, 'var(--text2)')
            let x1: number | undefined, y1: number | undefined, x2: number | undefined, y2: number | undefined
            if (l.kind === 'vertical') { const x = plotNumber(engine, l.x, env); if (x !== undefined) { x1 = x2 = x; y1 = range.yMin; y2 = range.yMax } }
            else if (l.kind === 'horizontal') { const y = plotNumber(engine, l.y, env); if (y !== undefined) { y1 = y2 = y; x1 = range.xMin; x2 = range.xMax } }
            else {
              x1 = plotNumber(engine, l.x1, env); y1 = plotNumber(engine, l.y1, env); x2 = plotNumber(engine, l.x2, env); y2 = plotNumber(engine, l.y2, env)
              if (l.kind === 'line' && x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined && (x1 !== x2 || y1 !== y2)) {
                const dx = x2 - x1, dy = y2 - y1, k = ((range.xMax - range.xMin) + (range.yMax - range.yMin)) * 4 / Math.hypot(dx, dy)
                ;[x1, y1, x2, y2] = [x1 - dx * k, y1 - dy * k, x2 + dx * k, y2 + dy * k]
              }
            }
            if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null
            if (l.label) labels.push({ x: f.sx(l.kind === 'horizontal' ? range.xMax : x2), y: f.sy(y2), text: mathify(l.label), color, dx: l.kind === 'horizontal' ? -6 : 6, dy: l.kind === 'horizontal' ? -10 : l.kind === 'vertical' ? 12 : -8 })
            return <line key={`l${i}`} x1={f.sx(x1)} y1={f.sy(y1)} x2={f.sx(x2)} y2={f.sy(y2)} stroke={color} strokeWidth={1.3} strokeDasharray={l.dashed ? '5 4' : undefined} />
          })}
          {objects.map((o, i) => objectView(o, f, labels, `o${i}`))}
          {spec.points.slice(0, 40).map((p, i) => {
            const x = plotNumber(engine, p.x, env), y = plotNumber(engine, p.y, env)
            if (x === undefined || y === undefined) return null
            const color = vizColor(p.color)
            if (p.label) labels.push({ x: f.sx(x), y: f.sy(y), text: p.label, color: 'var(--text)', dx: 9, dy: -11 })
            return <circle key={`p${i}`} cx={f.sx(x)} cy={f.sy(y)} r={4.5} fill={p.style === 'open' ? 'var(--surface)' : color} stroke={color} strokeWidth={1.6} />
          })}
        </g>
      </svg>
      {spec.xLabel && spec.axes && (
        <div className="viz-label absolute t-caption text-text2" style={{ right: PAD.right, top: f.top + f.plotH + 18 }}>
          <RichText text={mathify(spec.xLabel)} inline />
        </div>
      )}
      {spec.yLabel && spec.axes && (
        <div className="viz-label absolute t-caption text-text2 bg-surface/80 rounded px-1" style={{ left: f.left + 6, top: f.top + 2 }}>
          <RichText text={mathify(spec.yLabel)} inline />
        </div>
      )}
      {spec.labels.slice(0, 30).map((l, i) => {
        const x = plotNumber(engine, l.x, env), y = plotNumber(engine, l.y, env)
        if (x === undefined || y === undefined) return null
        return (
          <div key={`sl${i}`} className="viz-label absolute -translate-x-1/2 -translate-y-1/2 text-[13px] whitespace-nowrap" style={{ left: f.sx(x), top: f.sy(y), color: vizColor(l.color, 'var(--text)') }}>
            <RichText text={l.tex.includes('$') ? l.tex : `$${l.tex}$`} inline />
          </div>
        )
      })}
      {labels.map((l, i) => (
        <div key={`ol${i}`} className="viz-label absolute whitespace-nowrap text-[12.5px] font-medium pointer-events-none" style={{ left: l.x + l.dx, top: l.y + l.dy, color: l.color, transform: `translate(${l.dx < 0 ? '-100%' : '0'}, -50%)` }}>
          <RichText text={l.text} inline />
        </div>
      ))}
    </div>
  )
})

function Region({ engine, env, f, r }: { engine: SimulationEngine; env: Env; f: PlotFrame; r: PlotSpec['regions'][number] }) {
  const a = plotNumber(engine, r.from, env), b = plotNumber(engine, r.to, env)
  if (a === undefined || b === undefined || !(b > a)) return null
  const up = sampleFunction(engine, r.upper, env, a, b, { samples: 120 }).flat()
  const lo = sampleFunction(engine, r.lower, env, a, b, { samples: 120 }).flat()
  if (up.length < 2 || lo.length < 2) return null
  const d = polylinePath([...up, ...lo.reverse()], f) + 'Z'
  return <path d={d} fill={wash(vizColor(r.color), Math.round(Math.min(1, Math.max(0, r.opacity)) * 100))} stroke="none" />
}

/** Un objeto del instante (función, no componente: sus etiquetas se recogen en la misma pasada). */
function objectView(o: Resolved, f: PlotFrame, labels: Array<{ x: number; y: number; text: string; color: string; dx: number; dy: number }>, key: string) {
  switch (o.kind) {
    case 'polyline': {
      const color = vizColor(o.color, o.trail ? INK : 'var(--text3)')
      return <path key={key} d={polylinePath(o.points, f)} fill="none" stroke={color} strokeWidth={o.trail ? 2.2 : 1.4} strokeOpacity={o.trail ? 0.55 : 0.9} strokeDasharray={o.dashed ? '5 5' : undefined} strokeLinecap="round" strokeLinejoin="round" />
    }
    case 'segment': {
      const color = vizColor(o.color, 'var(--text)')
      const x1 = f.sx(o.x1), y1 = f.sy(o.y1), x2 = f.sx(o.x2), y2 = f.sy(o.y2)
      const len = Math.hypot(x2 - x1, y2 - y1)
      if (o.label) labels.push({ x: x2, y: y2, text: o.label, color, dx: 6, dy: -10 })
      if (!o.arrow || len < 2) return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={o.dashed ? '5 4' : undefined} />
      const a = Math.atan2(y2 - y1, x2 - x1), h = Math.min(11, len * 0.45)
      const bx = x2 - h * 0.8 * Math.cos(a), by = y2 - h * 0.8 * Math.sin(a)
      return (
        <g key={key}>
          <line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeDasharray={o.dashed ? '5 4' : undefined} />
          <path d={`M${x2} ${y2}L${x2 - h * Math.cos(a - 0.42)} ${y2 - h * Math.sin(a - 0.42)}L${x2 - h * Math.cos(a + 0.42)} ${y2 - h * Math.sin(a + 0.42)}Z`} fill={color} />
        </g>
      )
    }
    case 'point': {
      const color = vizColor(o.color)
      if (o.label) labels.push({ x: f.sx(o.x), y: f.sy(o.y), text: o.label, color: 'var(--text)', dx: 10, dy: -12 })
      return (
        <g key={key}>
          <circle cx={f.sx(o.x)} cy={f.sy(o.y)} r={11} fill={wash(color, 16)} />
          <circle cx={f.sx(o.x)} cy={f.sy(o.y)} r={6.5} fill={color} stroke="var(--surface)" strokeWidth={2.2} />
        </g>
      )
    }
    case 'label':
      labels.push({ x: f.sx(o.x), y: f.sy(o.y), text: o.text, color: vizColor(o.color, 'var(--text)'), dx: 0, dy: 0 })
      return null
  }
}
