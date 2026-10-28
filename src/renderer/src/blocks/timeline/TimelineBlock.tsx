// Línea de tiempo (port de TimelineBlockView.swift): si las fechas se entienden, a escala — eras de fondo, hechos como puntos
// o barras (si duran) en carriles sin solapes, colores por tema, zoom — y los hechos aparecen en orden al llegar a ellos; al
// pulsar uno se ve qué pasó. Si no (o al imprimir), una lista vertical.
import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cx, Icon, IconButton, useTheme } from '@renderer/design'
import type { BlockOf, TimelineEvent } from '@shared/schema/blocks'
import type { BlockContext, BlockProps } from '../types'
import { Caption, Figure, Inline, Prose, useAnimate, useBlocksT, useSeen, useWidth } from '../shared'
import { inkColor, namedColor, seriesColors, withAlpha } from '../colors'
import { axisTicks, dateText, isProportional, labelWidth, lanes, monthText, periodItems, periodLanes, timelineItems, timelineSpan, xOf, yearText, type TimelineItem } from './layout'

const LANE = 32
const PERIOD = 22

export function TimelineBlockView({ block, ctx }: BlockProps<BlockOf<'timeline'>>) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const [asList, setAsList] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const items = useMemo(() => timelineItems(block.events), [block.events])
  const periods = useMemo(() => periodItems(block.periods), [block.periods])
  const print = ctx.mode === 'print'
  const scaled = !print && !asList && isProportional(block.layout, block.events.length, items.length)
  const canScale = !print && block.layout !== 'vertical' && items.length >= 2
  const categories = useMemo(() => Array.from(new Set(block.events.map((e) => e.category).filter((c): c is string => !!c))), [block.events])
  const catColors = seriesColors(categories.length, ctx.hue, dark)
  const ink = inkColor(ctx.hue, dark)
  const colorOf = (e: TimelineEvent): string => {
    if (e.color) return namedColor(e.color, ctx.hue, dark)
    if (e.category && categories.length > 1) return catColors[categories.indexOf(e.category)]
    return inkColor(ctx.hue, dark)
  }
  // eras: la tinta y el gris cálido alternos (las nombra su rótulo; el color solo las separa)
  const periodColor = (i: number, c?: string) => (c ? namedColor(c, ctx.hue, dark) : i % 2 === 0 ? ink : 'var(--viz-neutral)')
  const words = { bc: (n: string) => t('timeline.bc', { n }), ma: (n: string) => t('timeline.ma', { n }) }
  const dt = (s: string) => dateText(s, ctx.language)
  return (
    <Figure
      ctx={ctx}
      title={block.title}
      tools={
        canScale && (
          <>
            {scaled && (
              <>
                <IconButton size="sm" label={t('timeline.zoomOut')} disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
                  <Icon name="minus" size={14} />
                </IconButton>
                <IconButton size="sm" label={t('timeline.zoomIn')} disabled={zoom >= 12} onClick={() => setZoom((z) => Math.min(12, z * 1.5))}>
                  <Icon name="plus" size={14} />
                </IconButton>
              </>
            )}
            <IconButton size="sm" label={asList ? t('timeline.asScale') : t('timeline.asList')} onClick={() => setAsList((v) => !v)}>
              <Icon name={asList ? 'chart' : 'checklist'} size={14} />
            </IconButton>
          </>
        )
      }
      caption={<Caption text={block.caption} />}
    >
      {scaled ? (
        <Scaled items={items} periods={periods} zoom={zoom} ctx={ctx} colorOf={colorOf} periodColor={periodColor} words={words} dt={dt} selected={selected} setSelected={setSelected} />
      ) : (
        <ListView block={block} ctx={ctx} colorOf={colorOf} periodColor={periodColor} dt={dt} />
      )}
      {scaled && (
        <>
          {block.events.length > items.length && (
            <div className="mt-2 flex items-start gap-1.5 t-footnote text-text3">
              <Icon name="calendar" size={13} className="mt-[1px]" />
              <span>{t('timeline.undated', { list: block.events.slice(0, 200).filter((_, i) => !items.some((it) => it.index === i)).map((e) => e.title).join(' · ') })}</span>
            </div>
          )}
          {categories.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {categories.map((c, i) => (
                <span key={c} className="inline-flex items-center gap-1.5 t-ui text-text2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: catColors[i] }} />
                  {c}
                </span>
              ))}
            </div>
          )}
          <Detail event={selected !== null ? block.events[selected] : undefined} ctx={ctx} color={selected !== null && block.events[selected] ? colorOf(block.events[selected]) : undefined} dt={dt} />
        </>
      )}
    </Figure>
  )
}

interface ScaledProps {
  items: TimelineItem[]
  periods: ReturnType<typeof periodItems>
  zoom: number
  ctx: BlockContext
  colorOf: (e: TimelineEvent) => string
  periodColor: (i: number, c?: string) => string
  words: { bc: (n: string) => string; ma: (n: string) => string }
  dt: (s: string) => string
  selected: number | null
  setSelected: (i: number | null) => void
}

function Scaled({ items, periods, zoom, ctx, colorOf, periodColor, words, dt, selected, setSelected }: ScaledProps) {
  const ref = useRef<HTMLDivElement>(null)
  const outer = useWidth(ref)
  const animate = useAnimate(ctx)
  const seen = useSeen(ref, ctx)
  const width = Math.max(outer, outer * zoom)
  const [lo, hi] = timelineSpan(items, periods)
  const laneOf = lanes(items, lo, hi, width, dt)
  const pl = periodLanes(periods)
  const axisY = pl.count * (PERIOD + 4) + 26
  const nLanes = Math.max(0, ...Array.from(laneOf.values())) + 1
  const height = axisY + 16 + nLanes * LANE + 6
  const X = (v: number) => xOf(v, lo, hi, width)
  const order = [...items].sort((a, b) => a.start - b.start).map((it) => it.index)
  const ticks = axisTicks(lo, hi, width)
  return (
    <div ref={ref} className={cx('relative -mx-1 px-1', zoom > 1 ? 'overflow-x-auto' : 'overflow-hidden')}>
      <div className="relative" style={{ width, height }}>
        {/* eras: una banda muy suave de fondo y su nombre arriba */}
        {periods.map((p) => {
          const x0 = X(p.start)
          const x1 = X(p.end)
          const c = periodColor(p.index, p.period.color)
          const lane = pl.lane.get(p.index) ?? 0
          return (
            <motion.div key={`p${p.index}`} className="absolute" style={{ left: x0, width: Math.max(8, x1 - x0), top: 0, bottom: 0 }} initial={animate ? { opacity: 0 } : false} animate={seen ? { opacity: 1 } : undefined} transition={{ duration: 0.5, delay: 0.05 * p.index }}>
              <div className="absolute inset-x-0 bottom-0 rounded-[6px]" style={{ top: 4 + (lane % Math.max(1, pl.count)) * (PERIOD + 4), background: withAlpha(c, 5) }} />
              <div className="absolute inset-x-0 flex items-center overflow-hidden rounded-[6px] px-2 t-caption font-semibold text-text" style={{ top: 4 + (lane % Math.max(1, pl.count)) * (PERIOD + 4), height: PERIOD, background: withAlpha(c, 16), boxShadow: `inset 0 0 0 0.75px ${withAlpha(c, 50)}` }} title={`${p.period.title} · ${p.period.from}–${p.period.to}`}>
                <span className="truncate">{p.period.title}</span>
              </div>
            </motion.div>
          )
        })}
        <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden>
          <motion.line x1={6} x2={width - 6} y1={axisY} y2={axisY} stroke="var(--text2)" strokeOpacity={0.7} strokeWidth={1.2} initial={animate ? { pathLength: 0 } : false} animate={seen ? { pathLength: 1 } : undefined} transition={{ duration: 0.9, ease: [0.45, 0, 0.25, 1] }} />
          {ticks.map((tk, i) => (
            <g key={i}>
              <line x1={X(tk.value)} x2={X(tk.value)} y1={axisY - 4} y2={axisY + 4} stroke="var(--text3)" />
              <text x={X(tk.value)} y={axisY - 8} textAnchor="middle" fontSize={11} fill="var(--text3)" className="tabular">
                {tk.kind === 'month' ? monthText(tk.value, ctx.language) : yearText(tk.value, words, ctx.language)}
              </text>
            </g>
          ))}
          {items.map((it) => {
            const x = X(it.start)
            const y = axisY + 16 + (laneOf.get(it.index) ?? 0) * LANE + LANE / 2 - 3
            return <line key={`s${it.index}`} x1={x} x2={x} y1={axisY} y2={y} stroke={colorOf(it.event)} strokeOpacity={selected === it.index ? 0.9 : 0.35} strokeDasharray="2 2" />
          })}
        </svg>
        {items.map((it) => {
          const x = X(it.start)
          const c = colorOf(it.event)
          const on = selected === it.index
          const rank = order.indexOf(it.index)
          const date = dt(it.event.when)
          const w = labelWidth(it.event, date)
          const left = Math.min(x - 8, width - w - 4)
          const y = axisY + 16 + (laneOf.get(it.index) ?? 0) * LANE
          return (
            <motion.div key={it.index} initial={animate ? { opacity: 0, y: -6 } : false} animate={seen ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 0.35, delay: 0.25 + rank * 0.07, ease: [0.2, 0.7, 0.2, 1] }}>
              {it.end !== undefined && <div className="absolute h-[6px] rounded-full" style={{ left: x, width: Math.max(6, X(it.end) - x), top: axisY - 3, background: c, opacity: on ? 0.9 : 0.5 }} />}
              <div className="absolute rounded-full" style={{ left: x - (on ? 6 : 4.5), top: axisY - (on ? 6 : 4.5), width: on ? 12 : 9, height: on ? 12 : 9, background: c, boxShadow: '0 0 0 2px var(--surface)' }} />
              <button
                type="button"
                onClick={() => setSelected(on ? null : it.index)}
                className={cx('absolute flex items-center gap-1.5 rounded-full px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-line', !on && 'hover:bg-fill2')}
                style={{ left, top: y + 3, height: LANE - 6, maxWidth: w, background: on ? withAlpha(c, 14) : 'var(--raised)', boxShadow: `inset 0 0 0 ${on ? 1.2 : 0.75}px ${on ? c : 'var(--line)'}` }}
                title={`${date} · ${it.event.title}`}
                aria-pressed={on}
              >
                <span className="shrink-0 t-caption font-semibold tabular text-text2">{date}</span>
                <span className={cx('truncate t-footnote text-text', on ? 'font-semibold' : 'font-medium')}>{it.event.title}</span>
              </button>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function Detail({ event, ctx, color, dt }: { event?: TimelineEvent; ctx: BlockContext; color?: string; dt: (s: string) => string }) {
  const t = useBlocksT()
  return (
    <AnimatePresence mode="wait" initial={false}>
      {event ? (
        <motion.div key={event.when + event.title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mt-3 flex items-start gap-3 rounded-[14px] bg-sunken px-4 py-3">
          {event.asset && <img src={ctx.assetUrl(event.asset)} alt="" className="h-[72px] w-[96px] shrink-0 rounded-[10px] object-cover" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 t-ui font-semibold tabular text-text2">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
              {dt(event.when)}
              {event.end && ` – ${dt(event.end)}`}
            </div>
            <div className="mt-0.5 font-serif text-[17px] font-medium leading-[24px] text-text"><Inline text={event.title} /></div>
            {event.md?.trim() && <div className="mt-1"><Prose text={event.md} ctx={ctx} size="small" /></div>}
          </div>
        </motion.div>
      ) : (
        <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-1.5 t-footnote text-text3">
          <Icon name="hand" size={13} />
          {t('timeline.hint')}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ListView({ block, ctx, colorOf, periodColor, dt }: { block: BlockOf<'timeline'>; ctx: BlockContext; colorOf: (e: TimelineEvent) => string; periodColor: (i: number, c?: string) => string; dt: (s: string) => string }) {
  const animate = useAnimate(ctx)
  const events = block.events.slice(0, 200)
  return (
    <div>
      {block.periods.length > 0 && (
        <div className="mb-4 flex flex-col gap-1">
          {block.periods.slice(0, 40).map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-3.5 rounded-[3px]" style={{ background: withAlpha(periodColor(i, p.color), 55) }} />
              <span className="t-ui font-semibold text-text">{p.title}</span>
              <span className="t-footnote tabular text-text2">· {dt(p.from)}–{dt(p.to)}</span>
            </div>
          ))}
        </div>
      )}
      <ol className="m-0 list-none p-0">
        {events.map((e, i) => {
          const last = i === events.length - 1
          return (
            <motion.li key={i} className="relative flex gap-3" initial={animate ? { opacity: 0, y: 6 } : false} whileInView={animate ? { opacity: 1, y: 0 } : undefined} viewport={{ once: true, margin: '-30px' }} transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.04 }}>
              <div className="w-[88px] shrink-0 pt-[3px] text-right t-footnote font-semibold tabular text-text2">
                {dt(e.when)}
                {e.end && <span className="block font-normal text-text3">– {dt(e.end)}</span>}
              </div>
              <div className="relative flex w-4 shrink-0 justify-center">
                <span className="relative z-[1] mt-[6px] h-[9px] w-[9px] rounded-full" style={{ background: colorOf(e), boxShadow: '0 0 0 4px var(--fill2)' }} />
                {!last && <span aria-hidden className="absolute bottom-0 top-[18px] w-[1.5px] bg-line" />}
              </div>
              <div className={cx('min-w-0 flex-1', last ? 'pb-0' : 'pb-5')}>
                <div className="t-headline text-text"><Inline text={e.title} /></div>
                {e.md?.trim() && <div className="mt-0.5 text-text2"><Prose text={e.md} ctx={ctx} size="small" /></div>}
              </div>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}
