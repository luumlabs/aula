// Diagrama (`diagram`): diagrama de flujo, mapa conceptual, árbol, ciclo o capas, con disposición automática (port de
// StudyUI/Blocks/DiagramView.swift), y las formas ya hechas (`form`): pirámide, embudo, Venn y mapa mental. Los nodos son
// tarjetas de papel con fórmulas; las flechas se dibujan a tinta, con la punta abierta, siguiendo el sentido del diagrama al
// entrar en la vista. Con `steps`, un proceso animado (mitosis, ciclo de Krebs…) con reproducir/pausa, una barra de pasos y
// ← → / Esc: cada paso rodea a pluma lo que señala y apaga lo demás; con `build`, los pasos van construyendo la figura. Los
// diagramas grandes se amplían y se mueven (Ctrl + rueda o pellizco, arrastrar).
// El rodeo de cada paso y las flechas a tinta están adaptados de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026
// ddkbs: viewer/src/steps.ts drawHighlights() y viewer/src/render.ts drawEdge().
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, cx, useTheme, type IconName } from '@renderer/design'
import { Ink } from '@renderer/design/paint/Ink'
import { edgeInk } from '@renderer/design/paint/penInk'
import { revealedAt } from '@engine/content/diagram-forms'
import type { BlockOf, DiagramBlock as DiagramData } from '@shared/schema/blocks'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import { cappedDiagram, layoutDiagram, stepHighlight, type EdgeRoute, type NodeBox } from './lib/diagramLayout'
import { layoutForm, type FormLayout } from './lib/diagramForms'
import { DIM, MindmapView, PenRing, PyramidView, VennView } from './diagram/FormViews'
import { vizColor, wash } from './shared/colors'
import { canvasMeasure, useFontsReady } from './shared/measure'
import { usePanZoom } from './shared/usePanZoom'
import { BlockHeader, Caption, ZoomControls, canvasWell, useInView, useInk, useSize } from './shared/ui'

const KIND_ICON: Record<DiagramData['kind'], IconName> = { flow: 'flow', concept: 'share', tree: 'flow', cycle: 'repeat', layers: 'layers' }
const FORM_ICON: Record<NonNullable<DiagramData['form']>, IconName> = { pyramid: 'pyramid', funnel: 'funnel', venn: 'venn', mindmap: 'mindmap' }
const STEP_MS = 2800
/** Con más flechas, se trazan como vectores (las máscaras de la tinta costarían demasiado). */
const MAX_INK_EDGES = 40
/** Por debajo de este ancho, las explicaciones de una pirámide van dentro de cada fila. */
const DETAILS_BESIDE_MIN = 560

export default function DiagramBlock({ block, ctx }: BlockProps<BlockOf<'diagram'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const b = useMemo(() => cappedDiagram(block), [block])
  const fonts = useFontsReady()
  const printing = ctx.mode === 'print'
  const [box, size] = useSize<HTMLDivElement>()
  const beside = printing || size.width === 0 || size.width >= DETAILS_BESIDE_MIN
  // una forma ya hecha (si se puede dibujar como tal); si no, el diagrama de su tipo de base
  const form: FormLayout | undefined = useMemo(() => (fonts ? layoutForm(b, canvasMeasure, { detailsBeside: beside }) : layoutForm(b, canvasMeasure, { detailsBeside: beside })), [b, fonts, beside])
  // se vuelve a medir cuando cargan las letras
  const layout = useMemo(() => (form ? undefined : fonts ? layoutDiagram(b, canvasMeasure) : layoutDiagram(b, canvasMeasure)), [b, fonts, form])
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const hl = stepHighlight(b, step)
  const revealed = revealedAt(b, step)

  // medidas: ajustada al ancho (sin agrandar), con un alto máximo; si queda demasiado pequeña, se mueve
  const maxH = printing ? 900 : ctx.mode === 'chat' ? 380 : 560
  const cw = Math.max(1, form?.width ?? layout?.width ?? 1), ch = Math.max(1, form?.height ?? layout?.height ?? 1)
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
  const showAll = (): void => { setPlaying(false); setStep(null) }
  // ← → cambian de paso y Esc enseña la figura entera (solo dentro del bloque; nunca desde un campo de texto). Esc también
  // desde la barra de pasos (que lleva sus propias flechas): si no, llegaría a la lección y la cerraría
  const onKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (!b.steps.length || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (e.key === 'Escape') {
      if (step !== null) { e.preventDefault(); e.stopPropagation(); showAll() }
      return
    }
    if (target.closest('[role="slider"]')) return
    if (e.key === 'ArrowRight') { e.preventDefault(); go((step ?? -1) + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go((step ?? 1) - 1) }
  }

  if (!b.nodes.length) return null
  const s = fit * pz.t.scale
  const showZoom = !printing && (fit < 0.98 || pz.t.scale > 1.001)
  const eyebrow = b.form && form ? t(`diagram.form.${b.form}`) : b.steps.length ? t('diagram.process') : t(`diagram.kind.${b.kind}`)
  const icon = b.form && form ? FORM_ICON[b.form] : KIND_ICON[b.kind]
  const formProps = { b, blockId: block.id, hl, revealed, step, animate, run, printing }
  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={b.title ?? t('diagram.label')} onKeyDown={onKey} aria-keyshortcuts={b.steps.length ? 'ArrowLeft ArrowRight Escape' : undefined}>
      <BlockHeader icon={icon} eyebrow={eyebrow} title={b.title} />
      <div ref={box} className="w-full">
        <div
          ref={view}
          className={cx(canvasWell, 'viz-dots outline-none', pz.pannable && 'viz-grab')}
          style={{ height: viewport.height + 2, touchAction: pz.pannable ? 'none' : undefined }}
          tabIndex={b.steps.length && !printing ? -1 : undefined}
          aria-description={b.steps.length && !printing ? t('diagram.keysHint') : undefined}
          {...pz.bind}
        >
          {size.width > 0 && (
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: cw, height: ch, transform: `translate(${pz.t.x}px, ${pz.t.y}px) scale(${s})`, transition: pz.smooth && !pz.dragging ? 'transform 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}
            >
              {form?.form === 'pyramid' || form?.form === 'funnel' ? (
                <PyramidView layout={form} {...formProps} />
              ) : form?.form === 'venn' ? (
                <VennView layout={form} hover={hover} onHover={setHover} {...formProps} />
              ) : form?.form === 'mindmap' ? (
                <MindmapView layout={form} {...formProps} />
              ) : layout ? (
                <GraphCanvas layout={layout} b={b} blockId={block.id} hl={hl} revealed={revealed} step={step} hover={hover} onHover={setHover} animate={animate} run={run} printing={printing} />
              ) : null}
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
      {b.steps.length > 0 && (printing ? <PrintedSteps b={b} /> : <StepsPanel b={b} step={step} playing={playing} onGo={go} onToggle={togglePlay} onAll={showAll} reduced={reducedMotion} />)}
      <Caption text={b.caption} />
    </section>
  )
}

// MARK: Flujo, mapa conceptual, árbol, ciclo y capas

interface GraphProps {
  layout: NonNullable<ReturnType<typeof layoutDiagram>>
  b: DiagramData
  blockId: string
  hl: ReturnType<typeof stepHighlight>
  revealed: Set<string> | undefined
  step: number | null
  hover: string | null
  onHover: (id: string | null) => void
  animate: boolean
  run: boolean
  printing: boolean
}

function GraphCanvas({ layout, b, blockId, hl, revealed, step, hover, onHover, animate, run, printing }: GraphProps) {
  const { t } = useTranslation('visual')
  const order = (n: number): number => Math.min(n, 14) * 0.09
  const incident = (e: EdgeRoute): boolean => hover !== null && (e.from === hover || e.to === hover)
  const shown = (id: string): boolean => !revealed || revealed.has(id)
  const edgeShown = (e: EdgeRoute): boolean => shown(e.from) && shown(e.to)
  // a tinta, con la punta abierta (a mano); impreso o con muchas flechas, los vectores de siempre
  const inked = !printing && layout.edges.length <= MAX_INK_EDGES
  const lit = (e: EdgeRoute): boolean => hl?.edges.has(e.key) ?? false
  return (
    <>
      <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" aria-hidden>
        {layout.cycle && (
          <ellipse cx={layout.cycle.cx} cy={layout.cycle.cy} rx={layout.cycle.rx} ry={layout.cycle.ry} fill="none" stroke="var(--line)" strokeWidth={1.2} strokeDasharray="2 7" strokeLinecap="round" />
        )}
        {layout.edges.map((e) =>
          edgeShown(e) && (!inked || e.dashed) ? (
            <Edge key={e.key} e={e} on={lit(e)} dim={hl !== undefined && !lit(e)} near={incident(e)} animate={animate} run={run} delay={order(e.order) + 0.25} />
          ) : null
        )}
      </svg>
      {inked && layout.edges.map((e) =>
        !e.dashed && edgeShown(e) ? <InkEdge key={e.key} e={e} seed={`diag:${blockId}:${e.key}`} on={lit(e)} dim={hl !== undefined && !lit(e)} near={incident(e)} delay={animate ? (order(e.order) + 0.25) * 1000 : 0} /> : null
      )}
      {inked && hl && (
        // la flecha encendida «corre» en su sentido, encima de la tinta
        <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible pointer-events-none" aria-hidden>
          {layout.edges.map((e) => (lit(e) && !e.dashed && edgeShown(e) ? <path key={e.key} d={e.d} fill="none" stroke="var(--surface)" strokeWidth={1.2} strokeLinecap="round" className="viz-flow" opacity={0.85} /> : null))}
        </svg>
      )}
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
        e.label && e.labelAt && edgeShown(e) ? (
          <motion.div
            key={`l-${e.key}`}
            className="absolute"
            style={{ left: e.labelAt[0], top: e.labelAt[1] }}
            initial={animate ? { opacity: 0 } : false}
            animate={run ? { opacity: 1 } : undefined}
            transition={{ duration: 0.3, delay: animate ? order(e.order) + 0.6 : 0 }}
          >
            <span
              className={cx('viz-label block -translate-x-1/2 -translate-y-1/2 whitespace-nowrap truncate rounded-full px-2 py-[1px] t-caption font-medium border-[0.5px] transition-[opacity,background-color,color] duration-300', lit(e) ? 'bg-accent-wash text-accent-text border-accent-line' : 'bg-surface text-text2 border-line')}
              style={{ opacity: hl && !lit(e) ? 0.3 : 1, maxWidth: 200 }}
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
          hidden={!shown(n.id)}
          hovered={hover === n.id}
          layers={b.kind === 'layers'}
          animate={animate}
          run={run}
          delay={order(n.order)}
          onHover={(h) => onHover(h ? n.id : null)}
        />
      ))}
      {hl && step !== null &&
        layout.nodes.filter((n) => hl.focus.has(n.id) && shown(n.id)).slice(0, 4).map((n, i) => (
          <PenRing key={`${step}:${n.id}`} box={{ x: n.x - n.w / 2 - 3, y: n.y - n.h / 2 - 3, w: n.w + 6, h: n.h + 6 }} seed={`${blockId}:${n.id}`} delay={i * 180} printing={printing} />
        ))}
    </>
  )
}

/** Una flecha a tinta: el trazo y, después, la punta abierta (se dibuja una vez por sesión). */
function InkEdge({ e, seed, on, dim, near, delay }: { e: EdgeRoute; seed: string; on: boolean; dim: boolean; near: boolean; delay: number }) {
  const placed = useMemo(() => edgeInk(e.pts.map(([x, y]) => ({ x, y })), e.barbs?.map(([x, y]) => ({ x, y })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] | undefined, seed, on ? 1.9 : 1.6), [e, seed, on])
  if (!placed) return null
  const color = on ? 'var(--accent)' : near ? 'var(--text2)' : 'var(--text3)'
  return (
    <div className="absolute left-0 top-0" style={{ opacity: dim ? 0.2 : 1, transition: 'opacity 300ms' }}>
      <Ink drawing={placed.drawing} color={color} drawKey={seed} delay={delay} className="ink-fixed" style={{ left: placed.x, top: placed.y, width: placed.drawing.w, height: placed.drawing.h, transition: 'color 300ms' }} />
    </div>
  )
}

function Edge({ e, on, dim, near, animate, run, delay }: { e: EdgeRoute; on: boolean; dim: boolean; near: boolean; animate: boolean; run: boolean; delay: number }) {
  const color = on ? 'var(--accent)' : near ? 'var(--text2)' : 'var(--text3)'
  const opacity = dim ? 0.2 : on || near ? 1 : 0.8
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

/**
 * Un nodo del diagrama. Con `hidden` (aún no ha salido en un paso que construye la figura) no se ve, no recibe el puntero y
 * no se puede señalar ni nombrar (sin `data-ask-*` y oculto para los lectores de pantalla).
 */
export function Node({ n, on, dim, hidden, hovered, layers, animate, run, delay, onHover }: { n: NodeBox; on: boolean; dim: boolean; hidden: boolean; hovered: boolean; layers: boolean; animate: boolean; run: boolean; delay: number; onHover: (h: boolean) => void }) {
  const tint = n.node.color ? vizColor(n.node.color) : undefined
  // lo encendido conserva su velo; la luz es el rodeo a pluma, así que el borde vuelve a ser fino
  const ring = tint ? wash(tint, 55) : 'var(--line-strong)'
  const bg = on ? wash(tint ?? 'var(--accent)', 14) : tint ? wash(tint, 9) : n.node.shape === 'note' ? wash('var(--sun)', 12) : 'var(--surface)'
  const diamond = n.node.shape === 'diamond'
  const radius = n.node.shape === 'round' ? 999 : n.node.shape === 'circle' ? '50%' : n.node.shape === 'note' ? '4px 14px 4px 4px' : 12
  const detail = n.node.detail?.trim()
  // al ocultarse, la visibilidad espera al fundido de 300 ms
  return (
    <motion.div
      className="absolute"
      style={{ left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w, height: n.h, pointerEvents: hidden ? 'none' : undefined, visibility: hidden ? 'hidden' : undefined, transition: 'visibility 300ms' }}
      initial={animate ? { opacity: 0, y: 8, scale: 0.96 } : false}
      animate={run ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={{ duration: 0.45, delay, ease: [0.2, 0.7, 0.2, 1] }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      {...(hidden ? { 'aria-hidden': true } : { 'data-ask-part': n.id, 'data-ask-label': n.node.label })}
    >
      <div className="absolute inset-0" style={{ opacity: hidden ? 0 : dim ? DIM : 1, transition: 'opacity 300ms' }}>
      {diamond && (
        <svg className="absolute inset-0 overflow-visible" width={n.w} height={n.h} aria-hidden>
          <path d={`M${n.w / 2} 1L${n.w - 1} ${n.h / 2}L${n.w / 2} ${n.h - 1}L1 ${n.h / 2}Z`} fill="var(--surface)" stroke="none" />
          <path d={`M${n.w / 2} 1L${n.w - 1} ${n.h / 2}L${n.w / 2} ${n.h - 1}L1 ${n.h / 2}Z`} fill={bg} stroke={ring} strokeWidth={1} strokeLinejoin="round" style={{ transition: 'fill 300ms, stroke 300ms' }} />
        </svg>
      )}
      <div
        className={cx('viz-label relative h-full w-full flex flex-col items-center justify-center text-center', diamond ? 'px-[18%]' : 'px-3.5 py-2', layers && 'items-center')}
        style={
          diamond
            ? undefined
            : {
                background: 'var(--surface)',
                boxShadow: `inset 0 0 0 ${Math.ceil(Math.max(n.w, n.h))}px ${bg === 'var(--surface)' ? 'transparent' : bg}, ${on || hovered ? 'var(--e2)' : 'var(--e1)'}`,
                border: `0.75px solid ${ring}`,
                borderRadius: radius,
                transition: 'box-shadow 250ms, border-color 300ms'
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
export function StepScrubber({ n, step, onGo }: { n: number; step: number | null; onGo: (k: number) => void }) {
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
  // arrastrarlo no selecciona el texto de al lado (la columna de estudio se selecciona) ni desplaza la página en táctil
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('diagram.scrubber')}
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={(step ?? 0) + 1}
      className="relative flex-1 min-w-[120px] h-7 mx-1.5 cursor-pointer outline-none group select-none touch-none"
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
