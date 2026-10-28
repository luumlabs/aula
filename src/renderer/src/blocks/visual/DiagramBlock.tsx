// Diagrama (`diagram`): diagrama de flujo, mapa conceptual, árbol, ciclo o capas, con disposición automática (port de
// StudyUI/Blocks/DiagramView.swift). Los nodos son tarjetas de papel con fórmulas; las flechas se trazan siguiendo el sentido
// del diagrama al entrar en la vista. Con `steps`, un proceso animado (mitosis, ciclo de Krebs…) con reproducir/pausa y una
// barra de pasos. Los diagramas grandes se amplían y se mueven (Ctrl + rueda o pellizco, arrastrar).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, cx, useTheme, type IconName } from '@renderer/design'
import type { BlockOf, DiagramBlock as DiagramData } from '@shared/schema/blocks'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import { cappedDiagram, layoutDiagram, stepHighlight, type EdgeRoute, type NodeBox } from './lib/diagramLayout'
import { vizColor, wash } from './shared/colors'
import { canvasMeasure, useFontsReady } from './shared/measure'
import { usePanZoom } from './shared/usePanZoom'
import { BlockHeader, Caption, ZoomControls, canvasWell, useInView, useInk, useSize } from './shared/ui'

const KIND_ICON: Record<DiagramData['kind'], IconName> = { flow: 'flow', concept: 'share', tree: 'flow', cycle: 'repeat', layers: 'layers' }
const STEP_MS = 2800

export default function DiagramBlock({ block, ctx }: BlockProps<BlockOf<'diagram'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const b = useMemo(() => cappedDiagram(block), [block])
  const fonts = useFontsReady()
  // se vuelve a medir cuando cargan las letras
  const layout = useMemo(() => (fonts ? layoutDiagram(b, canvasMeasure) : layoutDiagram(b, canvasMeasure)), [b, fonts])
  const printing = ctx.mode === 'print'
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const hl = stepHighlight(b, step)

  // medidas: ajustada al ancho (sin agrandar), con un alto máximo; si queda demasiado pequeña, se mueve
  const [box, size] = useSize<HTMLDivElement>()
  const maxH = printing ? 900 : ctx.mode === 'chat' ? 380 : 560
  const cw = Math.max(1, layout.width), ch = Math.max(1, layout.height)
  const avail = Math.max(120, size.width)
  let fit = Math.min(1, avail / cw, maxH / ch)
  if (!printing) fit = Math.max(fit, Math.min(1, 0.62))
  if (printing) fit = Math.min(1, avail / cw)
  const fitted = useMemo(() => ({ width: cw * fit, height: ch * fit }), [cw, ch, fit])
  const viewport = useMemo(() => ({ width: avail, height: Math.min(ch * fit, printing ? ch * fit : maxH) }), [avail, ch, fit, maxH, printing])
  const view = useRef<HTMLDivElement>(null)
  const pz = usePanZoom(view, fitted, viewport, { enabled: !printing, maxScale: 4 })
  const seen = useInView(box, true, '-60px')
  const animate = !printing && !reducedMotion
  const run = !animate || seen

  // reproducir el proceso: un paso cada 2,8 s hasta el último
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setStep((k) => {
        const next = (k ?? -1) + 1
        if (next >= b.steps.length - 1) setPlaying(false)
        return Math.min(next, b.steps.length - 1)
      })
    }, STEP_MS)
    return () => clearInterval(id)
  }, [playing, b.steps.length])

  const go = useCallback((k: number) => {
    setPlaying(false)
    setStep(Math.max(0, Math.min(b.steps.length - 1, k)))
    ctx.onInteract?.(block.id, 'diagram-step')
  }, [b.steps.length, block.id, ctx])
  const togglePlay = (): void => {
    if (playing) return setPlaying(false)
    if (step === null || step >= b.steps.length - 1) setStep(0)
    setPlaying(true)
    ctx.onInteract?.(block.id, 'diagram-play')
  }

  if (!b.nodes.length) return null
  const s = fit * pz.t.scale
  const showZoom = !printing && (fit < 0.98 || pz.t.scale > 1.001)
  const eyebrow = b.steps.length ? t('diagram.process') : t(`diagram.kind.${b.kind}`)
  const order = (n: number): number => Math.min(n, 14) * 0.09
  const incident = (e: EdgeRoute): boolean => hover !== null && (e.from === hover || e.to === hover)
  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={b.title ?? t('diagram.label')}>
      <BlockHeader icon={KIND_ICON[b.kind]} eyebrow={eyebrow} title={b.title} />
      <div ref={box} className="w-full">
        <div
          ref={view}
          className={cx(canvasWell, 'viz-dots', pz.pannable && 'viz-grab')}
          style={{ height: viewport.height + 2, touchAction: pz.pannable ? 'none' : undefined }}
          {...pz.bind}
        >
          {size.width > 0 && (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: cw, height: ch, transform: `translate(${pz.t.x}px, ${pz.t.y}px) scale(${s})`, transition: pz.smooth && !pz.dragging ? 'transform 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}
            >
              <svg width={cw} height={ch} className="absolute inset-0 overflow-visible" aria-hidden>
                {layout.cycle && (
                  <ellipse cx={layout.cycle.cx} cy={layout.cycle.cy} rx={layout.cycle.rx} ry={layout.cycle.ry} fill="none" stroke="var(--line)" strokeWidth={1.2} strokeDasharray="2 7" strokeLinecap="round" />
                )}
                {layout.edges.map((e) => (
                  <Edge key={e.key} e={e} on={hl?.edges.has(e.key) ?? false} dim={hl !== undefined && !hl.edges.has(e.key)} near={incident(e)} animate={animate} run={run} delay={order(e.order) + 0.25} />
                ))}
              </svg>
              {layout.cycle && (
                <div className="absolute grid place-items-center pointer-events-none" style={{ left: layout.cycle.cx - 60, top: layout.cycle.cy - 40, width: 120, height: 80 }}>
                  {step !== null && b.steps.length ? (
                    <motion.div key={step} initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} className="text-center">
                      <div className="font-serif text-[34px] leading-[38px] tabular text-text">{step + 1}</div>
                      <div className="t-caption">{t('diagram.ofSteps', { count: b.steps.length })}</div>
                    </motion.div>
                  ) : (
                    <Icon name="repeat" size={26} className="text-text3 opacity-60" />
                  )}
                </div>
              )}
              {layout.edges.map((e) =>
                e.label && e.labelAt ? (
                  <motion.div
                    key={`l-${e.key}`}
                    className="absolute"
                    style={{ left: e.labelAt[0], top: e.labelAt[1] }}
                    initial={animate ? { opacity: 0 } : false}
                    animate={run ? { opacity: 1 } : undefined}
                    transition={{ duration: 0.3, delay: animate ? order(e.order) + 0.6 : 0 }}
                  >
                    <span
                      className={cx('viz-label block -translate-x-1/2 -translate-y-1/2 whitespace-nowrap truncate rounded-full px-2 py-[1px] t-caption font-medium border-[0.5px] transition-[opacity,background-color,color] duration-300', hl?.edges.has(e.key) ? 'bg-accent-wash text-accent-text border-accent-line' : 'bg-surface text-text2 border-line')}
                      style={{ opacity: hl && !hl.edges.has(e.key) ? 0.4 : 1, maxWidth: 200 }}
                    >
                      <RichText text={e.label} inline />
                    </span>
                  </motion.div>
                ) : null
              )}
              {layout.nodes.map((n) => (
                <Node
                  key={n.id}
                  n={n}
                  on={hl?.nodes.has(n.id) ?? false}
                  dim={hl !== undefined && !hl.nodes.has(n.id)}
                  hovered={hover === n.id}
                  layers={b.kind === 'layers'}
                  animate={animate}
                  run={run}
                  delay={order(n.order)}
                  onHover={(h) => setHover(h ? n.id : null)}
                />
              ))}
            </div>
          )}
          {showZoom && (
            <div className="absolute right-2 top-2" onPointerDown={(e) => e.stopPropagation()}>
              <ZoomControls scale={pz.t.scale} onZoom={pz.zoomBy} onReset={pz.reset} max={4} />
            </div>
          )}
          {pz.pannable && pz.t.scale <= 1.001 && !printing && <div className="pointer-events-none absolute left-2.5 bottom-2 t-caption text-text3 bg-raised/70 rounded-full px-2 py-0.5">{t('diagram.panHint', { mod: /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl' })}</div>}
        </div>
      </div>
      {b.steps.length > 0 && (printing ? <PrintedSteps b={b} /> : <StepsPanel b={b} step={step} playing={playing} onGo={go} onToggle={togglePlay} onAll={() => { setPlaying(false); setStep(null) }} reduced={reducedMotion} />)}
      <Caption text={b.caption} />
    </section>
  )
}

function Edge({ e, on, dim, near, animate, run, delay }: { e: EdgeRoute; on: boolean; dim: boolean; near: boolean; animate: boolean; run: boolean; delay: number }) {
  const color = on ? 'var(--accent)' : near ? 'var(--text2)' : 'var(--text3)'
  const opacity = dim ? 0.3 : on || near ? 1 : 0.8
  const width = on ? 2.4 : near ? 1.9 : 1.4
  const style = { transition: 'stroke 300ms, stroke-width 300ms, opacity 300ms, fill 300ms' }
  return (
    <g style={{ opacity, transition: 'opacity 300ms' }}>
      {animate && !e.dashed ? (
        <motion.path d={e.d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" style={style} initial={{ pathLength: 0 }} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 0.6, delay, ease: [0.4, 0, 0.2, 1] }} />
      ) : (
        <motion.path d={e.d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={e.dashed ? '5 4' : undefined} style={style} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.4, delay }} />
      )}
      {on && <path d={e.d} fill="none" stroke="var(--surface)" strokeWidth={1.4} strokeLinecap="round" className="viz-flow" opacity={0.9} />}
      {e.head && (
        <motion.path d={e.head} fill={color} style={style} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.2, delay: animate ? delay + 0.5 : 0 }} />
      )}
    </g>
  )
}

function Node({ n, on, dim, hovered, layers, animate, run, delay, onHover }: { n: NodeBox; on: boolean; dim: boolean; hovered: boolean; layers: boolean; animate: boolean; run: boolean; delay: number; onHover: (h: boolean) => void }) {
  const tint = n.node.color ? vizColor(n.node.color) : undefined
  const ring = on ? (tint ?? 'var(--accent)') : tint ? wash(tint, 55) : 'var(--line-strong)'
  const bg = on ? wash(tint ?? 'var(--accent)', 16) : tint ? wash(tint, 9) : n.node.shape === 'note' ? wash('var(--sun)', 12) : 'var(--surface)'
  const diamond = n.node.shape === 'diamond'
  const radius = n.node.shape === 'round' ? 999 : n.node.shape === 'circle' ? '50%' : n.node.shape === 'note' ? '4px 14px 4px 4px' : 12
  const detail = n.node.detail?.trim()
  return (
    <motion.div
      className="absolute"
      style={{ left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w, height: n.h }}
      initial={animate ? { opacity: 0, y: 8, scale: 0.96 } : false}
      animate={run ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={{ duration: 0.45, delay, ease: [0.2, 0.7, 0.2, 1] }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div className="absolute inset-0" style={{ opacity: dim ? 0.38 : 1, transition: 'opacity 300ms' }}>
      {diamond && (
        <svg className="absolute inset-0 overflow-visible" width={n.w} height={n.h} aria-hidden>
          <path d={`M${n.w / 2} 1L${n.w - 1} ${n.h / 2}L${n.w / 2} ${n.h - 1}L1 ${n.h / 2}Z`} fill="var(--surface)" stroke="none" />
          <path d={`M${n.w / 2} 1L${n.w - 1} ${n.h / 2}L${n.w / 2} ${n.h - 1}L1 ${n.h / 2}Z`} fill={bg} stroke={ring} strokeWidth={on ? 1.8 : 1} strokeLinejoin="round" style={{ transition: 'fill 300ms, stroke 300ms' }} />
        </svg>
      )}
      <div
        className={cx('viz-label relative h-full w-full flex flex-col items-center justify-center text-center', diamond ? 'px-[18%]' : 'px-3.5 py-2', layers && 'items-center')}
        style={
          diamond
            ? undefined
            : {
                background: bg === 'var(--surface)' ? 'var(--surface)' : `linear-gradient(${bg}, ${bg}), var(--surface)`,
                border: `${on ? 1.6 : 0.75}px solid ${ring}`,
                borderRadius: radius,
                boxShadow: on || hovered ? 'var(--e2)' : 'var(--e1)',
                transition: 'background 300ms, border-color 300ms, box-shadow 250ms'
              }
        }
      >
        <div className="text-[14px] leading-[19px] font-semibold text-text line-clamp-6 break-words">
          <RichText text={n.node.label} inline />
        </div>
        {detail && (
          <div className="mt-1 text-[12px] leading-4 text-text2 line-clamp-3">
            <RichText text={detail} inline />
          </div>
        )}
      </div>
      </div>
    </motion.div>
  )
}

// MARK: Proceso animado

function StepsPanel({ b, step, playing, onGo, onToggle, onAll, reduced }: { b: DiagramData; step: number | null; playing: boolean; onGo: (k: number) => void; onToggle: () => void; onAll: () => void; reduced: boolean }) {
  const { t } = useTranslation('visual')
  const n = b.steps.length
  const cur = step !== null ? b.steps[step] : undefined
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <IconButton size="sm" label={t('diagram.prev')} onClick={() => onGo((step ?? 0) - 1)} disabled={(step ?? 0) <= 0}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        <Button size="sm" variant="secondary" icon={<Icon name={playing ? 'pause' : 'play'} size={13} />} onClick={onToggle}>
          {playing ? t('pause') : step === null ? t('diagram.watch') : t('play')}
        </Button>
        <IconButton size="sm" label={t('diagram.next')} onClick={() => onGo((step ?? -1) + 1)} disabled={(step ?? -1) >= n - 1}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        <StepScrubber n={n} step={step} onGo={onGo} />
        <span className="t-footnote tabular text-text3 whitespace-nowrap">{step !== null ? t('diagram.stepOf', { k: step + 1, n }) : t('diagram.steps', { count: n })}</span>
        {step !== null && (
          <Button size="sm" variant="ghost" onClick={onAll}>
            {t('diagram.all')}
          </Button>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {cur && step !== null && (
          <motion.div
            key={step}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
            className="flex gap-3 rounded-[14px] bg-fill1 px-4 py-3"
            aria-live="polite"
          >
            <span className="font-serif text-[20px] leading-7 tabular text-text3">{step + 1}.</span>
            <div className="min-w-0 flex-1">
              {cur.title && (
                <div className="t-headline text-text">
                  <RichText text={cur.title} inline />
                </div>
              )}
              <div className="t-reading text-[16px] leading-[25px] text-text">
                <RichText text={cur.md} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Barra de pasos: un punto por paso; se pulsa o se arrastra (y con ← →). */
function StepScrubber({ n, step, onGo }: { n: number; step: number | null; onGo: (k: number) => void }) {
  const { t } = useTranslation('visual')
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const pick = (clientX: number): void => {
    const r = track.current?.getBoundingClientRect()
    if (!r || n < 1) return
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    onGo(Math.round(f * (n - 1)))
  }
  const down = (e: RPointerEvent<HTMLDivElement>): void => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    pick(e.clientX)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onGo((step ?? -1) + 1) }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onGo((step ?? 1) - 1) }
    if (e.key === 'Home') onGo(0)
    if (e.key === 'End') onGo(n - 1)
  }
  const frac = step === null || n <= 1 ? 0 : step / (n - 1)
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('diagram.scrubber')}
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={(step ?? 0) + 1}
      className="relative flex-1 min-w-[120px] h-7 mx-1.5 cursor-pointer outline-none group"
      onPointerDown={down}
      onPointerMove={(e) => dragging.current && pick(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={key}
    >
      <div ref={track} className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-fill3">
        <motion.div className="absolute left-0 top-0 h-full rounded-full bg-accent" animate={{ width: `${frac * 100}%` }} transition={{ type: 'spring', stiffness: 439, damping: 36 }} />
        {Array.from({ length: n }, (_, i) => {
          const done = step !== null && i <= step
          return (
            <span
              key={i}
              className={cx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200', i === step ? 'w-3 h-3 bg-accent shadow-[0_0_0_3px_var(--accent-wash)]' : done ? 'w-[7px] h-[7px] bg-accent' : 'w-[7px] h-[7px] bg-surface border border-line-strong')}
              style={{ left: `${n <= 1 ? 0 : (i / (n - 1)) * 100}%` }}
            />
          )
        })}
      </div>
    </div>
  )
}

function PrintedSteps({ b }: { b: DiagramData }) {
  return (
    <ol className="flex flex-col gap-2 m-0 p-0 list-none">
      {b.steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="font-serif text-[16px] tabular text-text3 w-6 text-right">{i + 1}.</span>
          <div className="min-w-0 flex-1 t-callout">
            {s.title && <div className="font-semibold"><RichText text={s.title} inline /></div>}
            <RichText text={s.md} />
          </div>
        </li>
      ))}
    </ol>
  )
}
