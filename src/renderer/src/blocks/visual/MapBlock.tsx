// Mapa (`map`): plano propio del mundo sin conexión (Natural Earth con d3-geo), encuadrado en su contenido, con marcadores que
// caen en su sitio, regiones, rutas que se trazan y una ficha con la explicación (Markdown) al pulsar. Con `practice`,
// «¿Dónde está…?». Zoom con los botones, Ctrl + rueda o el pellizco; arrastrar para moverse. Port de StudyUI/Blocks/Map/MapBlockView.swift.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { geoGraticule10, geoPath } from 'd3-geo'
import { Button, Icon, IconButton, PixelCheck, cx, pixelBurst, spring, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { MapBlock as MapData } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import { fitProjection, mapBounds, needsDetail, regionFeature, regionIndexAt, routeFeature, routeMidpoint, sanitizeMap } from './lib/mapGeo'
import { shuffle } from './lib/figure'
import { vizColor, wash } from './shared/colors'
import { usePanZoom } from './shared/usePanZoom'
import { loadWorld, type World } from './shared/worldData'
import { BlockHeader, Caption, ZoomControls, useInView, useInk, useSize } from './shared/ui'

type Sel = { kind: 'marker' | 'region'; index: number; x?: number; y?: number } | null
interface Feedback { tapped: number; correct: number; ok: boolean }

export default function MapBlock({ block, ctx }: BlockProps<BlockOf<'map'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const printing = ctx.mode === 'print'
  const b = useMemo(() => sanitizeMap(block), [block])
  const bounds = useMemo(() => mapBounds(b), [b])
  const detail = needsDetail(bounds)
  const [world, setWorld] = useState<World | null>(null)
  useEffect(() => {
    let alive = true
    void loadWorld(detail).then((w) => alive && setWorld(w))
    return () => {
      alive = false
    }
  }, [detail])

  const [box, size] = useSize<HTMLDivElement>()
  const W = Math.max(200, size.width)
  const H = printing ? 320 : ctx.mode === 'chat' ? 300 : Math.round(Math.min(460, Math.max(300, W * 0.56)))
  const proj = useMemo(() => fitProjection(bounds, W, H), [bounds, W, H])
  const path = useMemo(() => geoPath(proj), [proj])
  const viewRef = useRef<HTMLDivElement>(null)
  const frame = useMemo(() => ({ width: W, height: H }), [W, H])
  const pz = usePanZoom(viewRef, frame, frame, { enabled: !printing, maxScale: 8 })
  const tf = pz.t
  const seen = useInView(box, true, '-40px')
  const animate = !printing && !reducedMotion
  const run = !animate || seen

  const [sel, setSel] = useState<Sel>(null)
  // práctica «¿Dónde está…?»
  const [practicing, setPracticing] = useState(false)
  const [quiz, setQuiz] = useState<number[]>([])
  const [qi, setQi] = useState(0)
  const [right, setRight] = useState(0)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const round = useRef(0)

  const screen = (lat: number, lon: number): { x: number; y: number } | null => {
    const p = proj([lon, lat])
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    return { x: tf.x + p[0] * tf.scale, y: tf.y + p[1] * tf.scale }
  }

  const startQuiz = (): void => {
    round.current++
    setPracticing(true)
    setQuiz(shuffle(b.markers.map((_, i) => i)))
    setQi(0)
    setRight(0)
    setFeedback(null)
    setSel(null)
    ctx.onInteract?.(block.id, 'map-practice')
  }

  const tapMarker = (i: number): void => {
    if (practicing) {
      if (qi >= quiz.length || feedback) return
      const target = quiz[qi]
      const ok = target === i || b.markers[i].title.toLowerCase() === b.markers[target].title.toLowerCase()
      if (ok) setRight((r) => r + 1)
      setFeedback({ tapped: i, correct: ok ? i : target, ok })
      const my = round.current
      setTimeout(() => {
        if (round.current !== my) return
        setFeedback(null)
        setQi((k) => k + 1)
      }, ok ? 700 : 1500)
      return
    }
    setSel((s) => (s?.kind === 'marker' && s.index === i ? null : { kind: 'marker', index: i }))
    ctx.onInteract?.(block.id, 'map-marker')
  }

  const onMapUp = (e: RPointerEvent<HTMLDivElement>): void => {
    pz.bind.onPointerUp(e)
    if (pz.wasDrag() || practicing) return
    const r = viewRef.current?.getBoundingClientRect()
    if (!r) return
    const x = e.clientX - r.left, y = e.clientY - r.top
    const geo = proj.invert?.([(x - tf.x) / tf.scale, (y - tf.y) / tf.scale])
    const i = geo ? regionIndexAt(geo[1], geo[0], b.regions) : undefined
    setSel(i === undefined ? null : { kind: 'region', index: i, x, y })
  }

  const regionPaths = useMemo(() => b.regions.map((r) => path(regionFeature(r)) ?? ''), [b.regions, path])
  const routePaths = useMemo(() => b.routes.map((r) => path(routeFeature(r)) ?? ''), [b.routes, path])
  const landPaths = useMemo(() => (world ? world.countries.map((c) => path(c) ?? '') : []), [world, path])
  const borderPath = useMemo(() => (world ? path(world.borders) ?? '' : ''), [world, path])
  const gratPath = useMemo(() => path(geoGraticule10()) ?? '', [path])

  const target = practicing && qi < quiz.length ? b.markers[quiz[qi]] : undefined
  const hasInfo = b.markers.some((m) => m.md) || b.regions.some((r) => r.md)
  const markerState = (i: number): 'idle' | 'correct' | 'wrong' => (!feedback ? 'idle' : i === feedback.correct ? 'correct' : i === feedback.tapped && !feedback.ok ? 'wrong' : 'idle')

  // ficha de lo elegido: junto al marcador o donde se pulsó la región
  let pop: { x: number; y: number; title: string; md?: string; color: string } | null = null
  if (sel?.kind === 'marker' && b.markers[sel.index]) {
    const m = b.markers[sel.index]
    const p = screen(m.lat, m.lon)
    if (p) pop = { x: p.x, y: p.y - 22, title: m.title, md: m.md, color: vizColor(m.color) }
  } else if (sel?.kind === 'region' && b.regions[sel.index] && sel.x !== undefined && sel.y !== undefined) {
    const r = b.regions[sel.index]
    pop = { x: sel.x, y: sel.y - 6, title: r.name, md: r.md, color: vizColor(r.color) }
  }

  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={b.title ?? t('map.eyebrow')}>
      <BlockHeader
        icon="globe"
        eyebrow={t('map.eyebrow')}
        title={b.title}
        actions={
          !printing && b.practice && b.markers.length >= 3 ? (
            <Button size="sm" variant="secondary" icon={<Icon name="place" size={13} />} onClick={startQuiz}>
              {practicing ? t('labeled.again') : t('map.whereIs')}
            </Button>
          ) : undefined
        }
      />
      <div ref={box} className="w-full">
        <div
          ref={viewRef}
          className={cx('relative isolate overflow-hidden rounded-[18px] border-[0.5px] border-line select-none', pz.pannable && 'viz-grab')}
          style={{ height: H, background: 'var(--viz-sea)', touchAction: pz.pannable ? 'none' : undefined }}
          onPointerDown={pz.bind.onPointerDown}
          onPointerMove={pz.bind.onPointerMove}
          onPointerUp={onMapUp}
          onPointerCancel={pz.bind.onPointerCancel}
        >
          {size.width > 0 && (
            <svg width={W} height={H} className="absolute inset-0" aria-hidden>
              <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.scale})`} style={{ transition: pz.smooth && !pz.dragging ? 'transform 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}>
                <path d={gratPath} fill="none" stroke="var(--text3)" strokeOpacity={0.14} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                <motion.g initial={animate ? { opacity: 0 } : false} animate={{ opacity: world ? 1 : 0 }} transition={{ duration: 0.5 }}>
                  {landPaths.map((d, i) => <path key={i} d={d} fill="var(--viz-land)" stroke="none" />)}
                  <path d={borderPath} fill="none" stroke="var(--viz-land-line)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </motion.g>
                {b.regions.map((r, i) => {
                  const c = vizColor(r.color)
                  const on = sel?.kind === 'region' && sel.index === i
                  return (
                    <motion.path
                      key={`r${i}`}
                      d={regionPaths[i]}
                      fill={wash(c, on ? 40 : 24)}
                      stroke={c}
                      strokeWidth={on ? 2.4 : 1.4}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      style={{ transition: 'fill 200ms, stroke-width 200ms' }}
                      initial={animate ? { opacity: 0 } : false}
                      animate={run ? { opacity: 1 } : undefined}
                      transition={{ duration: 0.5, delay: 0.2 + i * 0.08 }}
                    />
                  )
                })}
                {b.routes.map((r, i) => {
                  const c = vizColor(r.color)
                  const common = { d: routePaths[i], fill: 'none', stroke: c, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const }
                  if (!animate || r.dashed) return <motion.path key={`w${i}`} {...common} strokeDasharray={r.dashed ? '6 5' : undefined} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.6, delay: 0.4 + i * 0.25 }} />
                  return <motion.path key={`w${i}`} {...common} initial={{ pathLength: 0 }} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 1.4, delay: 0.4 + i * 0.3, ease: [0.4, 0, 0.2, 1] }} />
                })}
              </g>
            </svg>
          )}
          {size.width > 0 && !practicing && W >= 480 &&
            b.routes.map((r, i) => {
              const mid = r.label ? routeMidpoint(r.points) : undefined
              const p = mid ? screen(mid[0], mid[1]) : null
              if (!p || !r.label) return null
              return (
                <motion.div key={`rl${i}`} className="absolute pointer-events-none -translate-x-1/2" style={{ left: p.x, top: p.y + 9 }} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ delay: 1.2 + i * 0.3 }}>
                  <span className="viz-label inline-block rounded-[7px] px-[7px] py-[1px] text-[12px] font-medium text-text bg-raised/90" style={{ boxShadow: 'inset 0 0 0 0.75px var(--line-strong)' }}>
                    <RichText text={r.label} inline />
                  </span>
                </motion.div>
              )
            })}
          {size.width > 0 &&
            b.markers.map((m, i) => {
              const p = screen(m.lat, m.lon)
              if (!p || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) return null
              const active = sel?.kind === 'marker' && sel.index === i
              return (
                <Pin
                  key={`m${i}`}
                  x={p.x}
                  y={p.y}
                  color={vizColor(m.color)}
                  title={practicing ? undefined : m.title}
                  active={active}
                  state={markerState(i)}
                  delay={animate ? 0.5 + Math.min(i, 24) * 0.06 : 0}
                  animate={animate}
                  run={run}
                  flip={p.x > W - 150}
                  onTap={() => tapMarker(i)}
                />
              )
            })}
          <AnimatePresence>
            {pop && !practicing && (
              <motion.div
                key={`${sel?.kind}-${sel?.index}`}
                className={cx('absolute z-10 w-max max-w-[280px] -translate-x-1/2', pop.y > 130 && '-translate-y-full')}
                style={{ left: Math.min(W - 150, Math.max(150, pop.x)), top: pop.y > 130 ? pop.y : pop.y + (sel?.kind === 'marker' ? 34 : 18) }}
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={spring.snappy}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <div className="rounded-[14px] bg-raised border-[0.5px] border-line shadow-[var(--e3)] px-3.5 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-[7px] w-2 h-2 rounded-full shrink-0" style={{ background: pop.color }} />
                    <div className="t-headline flex-1 min-w-0"><RichText text={pop.title} inline /></div>
                    <IconButton size="sm" label={t('map.close')} onClick={() => setSel(null)} className="-mr-1.5 -mt-1 h-6 w-6">
                      <Icon name="close" size={12} />
                    </IconButton>
                  </div>
                  {pop.md && (
                    <div className="t-callout text-text2 mt-1">
                      <RichText text={pop.md} />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!printing && (
            <div className="absolute right-2 top-2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <ZoomControls scale={tf.scale} onZoom={pz.zoomBy} onReset={pz.reset} max={8} />
            </div>
          )}
          <div className="pointer-events-none absolute left-2.5 bottom-2 t-caption text-text3 bg-raised/70 rounded-full px-2 py-0.5">{t('map.attribution')}</div>
        </div>
      </div>
      {practicing ? (
        <QuizPanel target={target?.title} index={qi} total={quiz.length} right={right} feedback={feedback} onEnd={() => { round.current++; setPracticing(false); setFeedback(null) }} />
      ) : (
        !printing && hasInfo && !sel && (
          <p className="t-footnote text-text3 flex items-center gap-2 m-0">
            <Icon name="cursor" size={13} />
            {t('map.hint')}
          </p>
        )
      )}
      {printing && <PrintedLegend b={b} />}
      <Caption text={b.caption} />
    </section>
  )
}

function Pin({ x, y, color, title, active, state, delay, animate, run, flip, onTap }: {
  x: number; y: number; color: string; title?: string; active: boolean; state: 'idle' | 'correct' | 'wrong'; delay: number; animate: boolean; run: boolean; flip: boolean; onTap: () => void
}) {
  const fill = state === 'correct' ? 'var(--success)' : state === 'wrong' ? 'var(--danger)' : color
  return (
    <motion.button
      type="button"
      aria-label={title ?? ''}
      className="absolute outline-none group"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onTap}
      initial={animate ? { y: -22, opacity: 0 } : false}
      animate={run ? { y: 0, opacity: 1 } : undefined}
      transition={{ ...spring.bouncy, delay }}
    >
      {/* sombra en el suelo y la chincheta (punta en el lugar exacto) */}
      <span className="absolute -translate-x-1/2 -translate-y-1/2 w-[10px] h-[4px] rounded-full bg-[rgba(32,30,26,.22)]" />
      <motion.svg width="22" height="28" viewBox="0 0 22 28" className="absolute -translate-x-1/2 -translate-y-full overflow-visible" style={{ originX: 0.5, originY: 1 }} animate={{ scale: active ? 1.18 : 1 }} transition={spring.bouncy}>
        <path d="M11 27 C11 27 2.5 17.2 2.5 10.6 A8.5 8.5 0 0 1 19.5 10.6 C19.5 17.2 11 27 11 27Z" fill={fill} stroke="rgba(255,255,255,.95)" strokeWidth="1.8" style={{ transition: 'fill 200ms' }} />
        <path d="M11 27 C11 27 2.5 17.2 2.5 10.6 A8.5 8.5 0 0 1 19.5 10.6 C19.5 17.2 11 27 11 27Z" fill="none" stroke="rgba(32,30,26,.3)" strokeWidth="0.5" />
        <circle cx="11" cy="10.5" r="3.2" fill="rgba(255,255,255,.95)" />
      </motion.svg>
      {title && (
        <span className={cx('absolute -top-[23px] whitespace-nowrap pointer-events-none', flip ? 'right-[11px]' : 'left-[11px]')}>
          <span className={cx('viz-label inline-block rounded-[7px] px-[7px] py-[1px] text-[12.5px] leading-[17px] text-text bg-raised/95 transition-shadow', active ? 'font-semibold' : 'font-medium')} style={{ boxShadow: `inset 0 0 0 ${active ? 1.4 : 0.75}px ${active ? fill : 'var(--line-strong)'}` }}>
            <RichText text={title} inline />
          </span>
        </span>
      )}
    </motion.button>
  )
}

function QuizPanel({ target, index, total, right, feedback, onEnd }: { target?: string; index: number; total: number; right: number; feedback: Feedback | null; onEnd: () => void }) {
  const { t } = useTranslation('visual')
  const ref = useRef<HTMLDivElement>(null)
  const done = target === undefined && total > 0
  useEffect(() => {
    if (done && right === total && ref.current) pixelBurst(ref.current, { count: 18 })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={cx('flex items-center gap-2.5 flex-wrap rounded-[14px] px-3.5 py-2.5', done && right === total ? 'bg-success-soft' : 'bg-fill1')}>
      {target !== undefined ? (
        <>
          <Icon name="place" size={15} className="text-accent-text" />
          <span className="t-callout text-text2">{t('map.whereIs')}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={target + index} className="t-headline" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              <RichText text={target} inline />
            </motion.span>
          </AnimatePresence>
          <span className="flex-1" />
          {feedback && <span className={cx('t-callout font-semibold', feedback.ok ? 'text-success' : 'text-danger')}>{feedback.ok ? t('labeled.right') : t('map.notThere')}</span>}
          <span className="t-footnote tabular text-text3">{index + 1}/{total}</span>
        </>
      ) : (
        <>
          {right === total ? <PixelCheck size={18} /> : <Icon name="flag" size={16} className="text-text2" />}
          <span className="t-callout font-semibold">{t('labeled.score', { right, total })}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onEnd}>
            {t('map.finish')}
          </Button>
        </>
      )}
    </div>
  )
}

/** En papel no se puede pulsar: la explicación de los marcadores, las regiones y los nombres de las rutas, en una lista. */
function PrintedLegend({ b }: { b: MapData }) {
  const items: Array<[string, string]> = [
    ...b.markers.filter((m) => m.md).map((m) => [m.title, m.md ?? ''] as [string, string]),
    ...b.regions.filter((r) => r.md).map((r) => [r.name, r.md ?? ''] as [string, string]),
    ...b.routes.filter((r) => r.label).map((r) => [r.label ?? '', ''] as [string, string])
  ]
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1">
      {items.map(([k, v], i) => (
        <div key={i} className="t-ui flex gap-1.5 items-baseline">
          <span className="font-semibold"><RichText text={k} inline /></span>
          {v && <span className="text-text2"><RichText text={v} inline /></span>}
        </div>
      ))}
    </div>
  )
}
