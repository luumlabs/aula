// Recta numérica: marcas (también en múltiplos de π), intervalos con extremos abiertos o cerrados que se extienden desde su
// inicio, flechas al infinito y puntos que caen en su sitio.
import { useRef } from 'react'
import { motion } from 'motion/react'
import { useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { BlockProps } from './types'
import { Caption, FigLabel, Figure, useAnimate, useBlocksT, useSeen, useWidth } from './shared'
import { namedColor } from './colors'
import { evalNumber } from './plot/evaluate'
import { displayFractions } from './text'
import { numberTicks, piTicks, sane, formatNumber } from './plot/ticks'

const H = 104
const LINE_Y = 64

export function NumberLineBlockView({ block, ctx }: BlockProps<BlockOf<'numberline'>>) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const [lo, hi] = sane(block.min, block.max, [-5, 5])
  const pad = 30
  const X = (v: number) => Math.max(-1e4, Math.min(1e4, pad + ((v - lo) / (hi - lo)) * (width - 2 * pad)))
  const ticks = block.pi ? piTicks(lo, hi, Math.max(4, Math.floor(width / 80))) : numberTicks(lo, hi, Math.max(4, Math.floor(width / 64)), ctx.language, block.step)
  const intervals = block.intervals.slice(0, 100).map((iv) => ({ iv, a: evalNumber(iv.from), z: evalNumber(iv.to), color: namedColor(iv.color, ctx.hue, dark) }))
  const points = block.points.slice(0, 300).map((p) => ({ p, v: evalNumber(p.value), color: namedColor(p.color, ctx.hue, dark) })).filter((x) => x.v !== undefined)
  const axis = 'var(--text2)'
  const ease = [0.2, 0.7, 0.2, 1] as const
  const draw = animate ? { initial: { pathLength: 0, opacity: 0 }, animate: seen ? { pathLength: 1, opacity: 1 } : undefined } : {}
  return (
    <Figure ctx={ctx} caption={<Caption text={block.caption} />}>
      <div ref={ref} className="relative w-full select-none" style={{ height: H }} role="img" aria-label={t('numberline.label')}>
        <svg width={width} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
          {/* eje con flechas */}
          <line x1={8} x2={width - 8} y1={LINE_Y} y2={LINE_Y} stroke={axis} strokeWidth={1.5} strokeLinecap="round" />
          <path d={`M ${width - 16} ${LINE_Y - 4.5} L ${width - 8} ${LINE_Y} L ${width - 16} ${LINE_Y + 4.5}`} fill="none" stroke={axis} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M 16 ${LINE_Y - 4.5} L 8 ${LINE_Y} L 16 ${LINE_Y + 4.5}`} fill="none" stroke={axis} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          {ticks.map((tk, i) => (
            <g key={i}>
              <line x1={X(tk.value)} x2={X(tk.value)} y1={LINE_Y - 5} y2={LINE_Y + 5} stroke={axis} strokeWidth={1.1} />
              <text x={X(tk.value)} y={LINE_Y + 21} textAnchor="middle" className="tabular" fontSize={12} fill="var(--text2)" fontFamily={block.pi ? 'var(--font-serif)' : undefined}>
                {tk.label}
              </text>
            </g>
          ))}
          {/* intervalos */}
          {intervals.map(({ iv, a, z, color }, i) => {
            const x0 = a !== undefined ? X(a) : 10
            const x1 = z !== undefined ? X(z) : width - 10
            const delay = 0.15 + i * 0.18
            return (
              <g key={i}>
                <motion.line x1={x0} x2={x1} y1={LINE_Y} y2={LINE_Y} stroke={color} strokeWidth={6} strokeLinecap="butt" strokeOpacity={0.9} {...draw} transition={{ duration: 0.7, delay, ease }} />
                {a === undefined && <motion.path d={`M 20 ${LINE_Y - 7} L 9 ${LINE_Y} L 20 ${LINE_Y + 7}`} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ delay: delay + 0.5 }} />}
                {z === undefined && <motion.path d={`M ${width - 20} ${LINE_Y - 7} L ${width - 9} ${LINE_Y} L ${width - 20} ${LINE_Y + 7}`} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ delay: delay + 0.5 }} />}
                {a !== undefined && <EndDot x={x0} open={iv.fromOpen} color={color} delay={delay} animate={animate} seen={seen} />}
                {z !== undefined && <EndDot x={x1} open={iv.toOpen} color={color} delay={delay + 0.55} animate={animate} seen={seen} />}
              </g>
            )
          })}
          {points.map(({ p, v, color }, i) => (
            <EndDot key={i} x={X(v!)} open={p.open} color={color} delay={0.3 + intervals.length * 0.18 + i * 0.08} animate={animate} seen={seen} drop />
          ))}
        </svg>
        {/* etiquetas (con fórmulas) encima de su intervalo o punto */}
        {intervals.map(({ iv, a, z, color }, i) =>
          iv.label?.trim() ? (
            <motion.div key={`il${i}`} className="absolute -translate-x-1/2 t-callout font-semibold text-text" style={{ left: ((a !== undefined ? X(a) : 10) + (z !== undefined ? X(z) : width - 10)) / 2, bottom: H - LINE_Y + 12 }} initial={animate ? { opacity: 0, y: 4 } : false} animate={seen ? { opacity: 1, y: 0 } : undefined} transition={{ delay: 0.6 + i * 0.18 }}>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
                <FigLabel text={displayFractions(iv.label)} />
              </span>
            </motion.div>
          ) : null
        )}
        {points.map(({ p, v }, i) =>
          p.label?.trim() ? (
            <motion.div key={`pl${i}`} className="absolute -translate-x-1/2 t-callout font-semibold text-text" style={{ left: X(v!), bottom: H - LINE_Y + 12 }} initial={animate ? { opacity: 0, y: 4 } : false} animate={seen ? { opacity: 1, y: 0 } : undefined} transition={{ delay: 0.5 + intervals.length * 0.18 + i * 0.08 }}>
              <FigLabel text={displayFractions(p.label)} />
            </motion.div>
          ) : null
        )}
      </div>
      <span className="sr-only">{spoken(block, ctx.language)}</span>
    </Figure>
  )
}

/** Extremo o punto: lleno si está incluido, hueco (con el papel dentro) si no. */
function EndDot({ x, open, color, delay, animate, seen, drop }: { x: number; open: boolean; color: string; delay: number; animate: boolean; seen: boolean; drop?: boolean }) {
  return (
    <motion.circle
      cx={x}
      cy={LINE_Y}
      r={6}
      fill={open ? 'var(--surface)' : color}
      stroke={color}
      strokeWidth={open ? 2.4 : 0}
      initial={animate ? { opacity: 0, scale: 0, y: drop ? -14 : 0 } : false}
      animate={seen ? { opacity: 1, scale: 1, y: 0 } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 20, delay }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    />
  )
}

/** Lo que lee un lector de pantalla: intervalos en notación («[1, 3)», «(−∞, 0]») y puntos. */
function spoken(b: BlockOf<'numberline'>, lang: string): string {
  const sep = lang.startsWith('es') ? '; ' : ', '
  const v = (s: string) => {
    const n = evalNumber(s)
    return n === undefined ? s : formatNumber(n, lang)
  }
  const parts: string[] = []
  if (b.caption?.trim()) parts.push(b.caption.trim())
  for (const iv of b.intervals.slice(0, 20)) {
    const m = (iv.from === undefined || iv.fromOpen ? '(' : '[') + (iv.from !== undefined ? v(iv.from) : '−∞') + sep + (iv.to !== undefined ? v(iv.to) : '∞') + (iv.to === undefined || iv.toOpen ? ')' : ']')
    parts.push(iv.label ? `${iv.label.replace(/\$/g, '')}: ${m}` : m)
  }
  for (const p of b.points.slice(0, 20)) parts.push(p.label ? `${p.label.replace(/\$/g, '')} = ${v(p.value)}` : v(p.value))
  return parts.join('; ')
}
