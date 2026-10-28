// Figura etiquetada (`labeled`): imagen o dibujo con partes que se exploran (pasar el ratón o pulsar muestra el nombre y la
// explicación), capas que se encienden y apagan, zoom y desplazamiento, y dos prácticas con corrección exacta: «Señala» (Aula
// nombra una parte y hay que pulsarla; zonas con polígonos, rectángulos o círculos como FigureGeometry) y «Arrastra» (cada
// nombre a su hueco). Port de StudyUI/Blocks/Figure/LabeledFigureView.swift y FigureCanvas.swift.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, PixelCheck, ProgressBar, SegmentedTabs, cx, pixelBurst, spring, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import { effectiveAspect, type FigurePart } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import type { BlockProps } from '../types'
import {
  activeParts, dragChips, dragScore, gutterFits, gutterWidth, labelsAsNumbers, locateCorrect, nameMatches, partAt, placeGutterLabels, regionPath, shuffle
} from './lib/figure'
import { canvasSize } from './lib/drawing'
import { fittedSize, scaledSize, toView, type ViewTransform } from './lib/viewTransform'
import { DrawingCanvas } from './shared/DrawingCanvas'
import { INK, vizColor, wash } from './shared/colors'
import { usePanZoom } from './shared/usePanZoom'
import { BlockHeader, Caption, Credit, GlassBar, GlassButton, ZoomControls, useInView, useInk, useSize } from './shared/ui'

type Mode = 'explore' | 'locate' | 'drag'
type Mark = 'idle' | 'correct' | 'wrong'
interface LocateFeedback { x: number; y: number; ok: boolean; hitName?: string; target: string }

export default function LabeledBlock({ block, ctx }: BlockProps<BlockOf<'labeled'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const printing = ctx.mode === 'print'
  const b = useMemo(() => ({ ...block, parts: block.parts.slice(0, 80), layers: block.layers.slice(0, 12) }), [block])
  const [visible, setVisible] = useState(() => new Set(b.layers.filter((l) => l.visible).map((l) => l.id)))
  const [mode, setModeState] = useState<Mode>('explore')
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [showNames, setShowNames] = useState(b.labels !== 'hidden')

  // la base: imagen del curso, dibujo vectorial o nada
  const [imgAspect, setImgAspect] = useState<number | undefined>()
  const [imgFailed, setImgFailed] = useState(false)
  const base: 'image' | 'drawing' | 'missing' = b.asset && !imgFailed ? 'image' : b.drawing ? 'drawing' : 'missing'
  const aspect = base === 'image' ? (imgAspect ?? effectiveAspect(b)) : effectiveAspect(b)
  const parts = useMemo(() => activeParts(b.parts, b.layers, visible), [b.parts, b.layers, visible])

  // medidas: márgenes con los nombres (atlas) si caben; si no, nombres junto a los puntos o números con leyenda
  const [box, size] = useSize<HTMLDivElement>()
  const W = Math.max(160, size.width)
  const numbers = labelsAsNumbers(b.labels, parts.length, W, printing)
  const maxFigH = base === 'missing' ? 180 : printing ? 420 : ctx.mode === 'chat' ? 360 : 520
  const g0 = gutterWidth(W)
  const gutters = mode === 'explore' && showNames && !numbers && W >= 580 && parts.length > 0 && gutterFits(parts, g0, fittedSize(W - 2 * g0, aspect, maxFigH).height)
  const g = gutters ? g0 : 0
  const vpW = Math.max(40, W - 2 * g)
  const fitted = useMemo(() => fittedSize(vpW, aspect, maxFigH), [vpW, aspect, maxFigH])
  const viewport = useMemo(() => ({ width: vpW, height: fitted.height }), [vpW, fitted.height])
  const viewRef = useRef<HTMLDivElement>(null)
  const pz = usePanZoom(viewRef, fitted, viewport, { enabled: !printing })
  const tf = pz.t
  const seen = useInView(box, true, '-40px')
  const canPractice = b.practice && !printing && parts.length >= 2 && base !== 'missing'

  // «Señala»
  const [quiz, setQuiz] = useState<string[]>([])
  const [quizIndex, setQuizIndex] = useState(0)
  const [results, setResults] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState<LocateFeedback | null>(null)
  // «Arrastra»
  const [placed, setPlaced] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null)
  const round = useRef(0)

  const setMode = useCallback((m: Mode) => {
    round.current++
    setModeState(m)
    setSelected(null)
    setHovered(null)
    setFeedback(null)
    if (m === 'locate') {
      setQuiz(shuffle(parts.map((p) => p.id)))
      setQuizIndex(0)
      setResults({})
    }
    if (m === 'drag') {
      setPlaced({})
      setPicked(null)
      setChecked(false)
    }
    if (m !== 'explore') ctx.onInteract?.(block.id, `labeled-${m}`)
  }, [parts, ctx, block.id])

  const tint = (p: FigurePart): string => {
    if (p.color) return vizColor(p.color)
    const ly = p.layer ? b.layers.find((l) => l.id === p.layer) : undefined
    return ly?.color ? vizColor(ly.color) : INK
  }

  const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = viewRef.current?.getBoundingClientRect()
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 }
  }

  // MARK: interacción con la figura

  const target = quizIndex < quiz.length ? b.parts.find((p) => p.id === quiz[quizIndex]) : undefined

  const answerLocate = (hit: FigurePart | undefined, x: number, y: number): void => {
    if (!target || feedback) return
    const ok = locateCorrect(target, hit)
    setResults((r) => ({ ...r, [target.id]: ok }))
    setFeedback({ x, y, ok, hitName: hit?.name, target: target.id })
    const my = round.current
    setTimeout(() => {
      if (round.current !== my) return
      setFeedback(null)
      setQuizIndex((i) => i + 1)
    }, ok ? 750 : 1700)
  }

  const place = (partId: string, name: string): void => {
    if (checked) return
    setPlaced((cur) => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(cur)) if (v !== name) next[k] = v
      next[partId] = name
      return next
    })
    setPicked(null)
  }

  const onFigureClick = (e: RPointerEvent<HTMLDivElement>): void => {
    if (pz.wasDrag()) return
    const p = localPoint(e)
    const hit = partAt(parts, tf, p.x, p.y, aspect)
    if (mode === 'explore') setSelected((s) => (hit ? (s === hit.id ? null : hit.id) : null))
    else if (mode === 'locate') answerLocate(hit, p.x, p.y)
    else if (hit && picked) place(hit.id, picked)
  }

  const onFigureMove = (e: RPointerEvent<HTMLDivElement>): void => {
    pz.bind.onPointerMove(e)
    if (mode !== 'explore' || pz.dragging) return
    const p = localPoint(e)
    const hit = partAt(parts, tf, p.x, p.y, aspect)?.id ?? null
    if (hit !== hovered) setHovered(hit)
  }

  // arrastrar un nombre: un fantasma sigue al puntero; al soltar sobre un hueco (o su zona) se coloca
  const holeAt = useCallback((clientX: number, clientY: number): string | null => {
    const r = viewRef.current?.getBoundingClientRect()
    if (!r) return null
    const x = clientX - r.left, y = clientY - r.top
    if (x < -20 || y < -20 || x > r.width + 20 || y > r.height + 20) return null
    let best: [string, number] | null = null
    for (const p of parts) {
      const a = toView(tf, p.x, p.y)
      const d = Math.hypot(a.x - x, a.y - y)
      if (d < 34 && (!best || d < best[1])) best = [p.id, d]
    }
    return best?.[0] ?? partAt(parts, tf, x, y, aspect)?.id ?? null
  }, [parts, tf, aspect])

  const startChipDrag = (e: RPointerEvent<HTMLButtonElement>, name: string): void => {
    if (checked || e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    let moving = false
    const move = (ev: PointerEvent): void => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      moving = true
      setGhost({ name, x: ev.clientX, y: ev.clientY })
      setDropTarget(holeAt(ev.clientX, ev.clientY))
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGhost(null)
      setDropTarget(null)
      if (!moving) {
        setPicked((p) => (p === name ? null : name))
        return
      }
      const hole = holeAt(ev.clientX, ev.clientY)
      if (hole) place(hole, name)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tapHole = (id: string): void => {
    if (checked) return
    if (picked) place(id, picked)
    else if (placed[id] !== undefined) setPlaced((cur) => { const n = { ...cur }; delete n[id]; return n })
  }

  const markFor = (p: FigurePart): Mark => {
    if (!checked) return 'idle'
    const v = placed[p.id]
    return v !== undefined && nameMatches(p, v) ? 'correct' : 'wrong'
  }

  // MARK: dibujo

  const showGutter = gutters && tf.scale <= 1.001
  const regionFill: Array<{ p: FigurePart; color: string; alpha: number }> = []
  if (mode === 'explore') {
    for (const id of new Set([hovered, selected].filter((x): x is string => x !== null))) {
      const p = parts.find((q) => q.id === id)
      if (p) regionFill.push({ p, color: tint(p), alpha: id === selected ? 28 : 18 })
    }
  } else if (mode === 'locate' && feedback && !feedback.ok) {
    const p = b.parts.find((q) => q.id === feedback.target)
    if (p) regionFill.push({ p, color: 'var(--success)', alpha: 30 })
  } else if (mode === 'drag' && dropTarget) {
    const p = parts.find((q) => q.id === dropTarget)
    if (p) regionFill.push({ p, color: 'var(--accent)', alpha: 20 })
  }

  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={b.title ?? b.alt}>
      <BlockHeader
        icon="hand"
        eyebrow={t('labeled.eyebrow')}
        title={b.title}
        actions={
          canPractice ? (
            <SegmentedTabs
              size="sm"
              value={mode}
              onChange={setMode}
              items={[
                { id: 'explore', label: t('labeled.explore'), icon: <Icon name="eye" size={13} /> },
                { id: 'locate', label: t('labeled.locate'), icon: <Icon name="place" size={13} /> },
                { id: 'drag', label: t('labeled.drag'), icon: <Icon name="hand" size={13} /> }
              ]}
            />
          ) : undefined
        }
      />
      {b.layers.length > 0 && !printing && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="t-caption text-text3 mr-1">{t('labeled.layers')}</span>
          {b.layers.map((ly) => {
            const on = visible.has(ly.id)
            const c = vizColor(ly.color)
            return (
              <button
                key={ly.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setVisible((v) => {
                    const n = new Set(v)
                    if (n.has(ly.id)) n.delete(ly.id)
                    else n.add(ly.id)
                    return n
                  })
                  if (mode !== 'explore') setMode('explore')
                }}
                className={cx('inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full t-ui transition-colors', on ? 'font-semibold text-text' : 'text-text2 bg-fill2 hover:bg-fill3')}
                style={on ? { background: wash(c, 16) } : undefined}
              >
                <span className="w-2 h-2 rounded-full transition-colors" style={{ background: on ? c : 'transparent', boxShadow: `inset 0 0 0 1.5px ${c}` }} />
                {ly.name}
              </button>
            )
          })}
        </div>
      )}

      <div ref={box} className="relative isolate w-full" style={{ height: viewport.height }}>
        <div
          ref={viewRef}
          className={cx('absolute top-0 overflow-hidden rounded-[16px] border-[0.5px] border-line bg-sunken select-none', pz.pannable && mode === 'explore' && 'viz-grab', mode === 'locate' && 'cursor-crosshair')}
          style={{ left: g, width: vpW, height: viewport.height, touchAction: pz.pannable ? 'none' : undefined }}
          onPointerDown={pz.bind.onPointerDown}
          onPointerMove={onFigureMove}
          onPointerUp={(e) => {
            pz.bind.onPointerUp(e)
            onFigureClick(e)
          }}
          onPointerCancel={pz.bind.onPointerCancel}
          onPointerLeave={() => mode === 'explore' && setHovered(null)}
        >
          {size.width > 0 && (
            <>
              <FigureBase block={b} base={base} tf={tf} smooth={pz.smooth && !pz.dragging} visible={visible} assetUrl={ctx.assetUrl} animate={!printing && !reducedMotion} play={seen} onImage={(a) => setImgAspect(a)} onImageError={() => setImgFailed(true)} />
              <svg className="absolute inset-0 pointer-events-none" width={vpW} height={viewport.height} aria-hidden>
                <AnimatePresence>
                  {regionFill.map(({ p, color, alpha }) => (
                    <motion.path key={p.id} d={regionPath(p, tf)} fill={wash(color, alpha)} stroke={color} strokeWidth={2} strokeLinejoin="round" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
                  ))}
                </AnimatePresence>
              </svg>
              {mode !== 'locate' &&
                parts.map((p, i) => {
                  const pt = toView(tf, p.x, p.y)
                  if (pt.x < -4 || pt.y < -4 || pt.x > vpW + 4 || pt.y > viewport.height + 4) return null
                  return mode === 'explore' ? (
                    <ExploreMarker
                      key={p.id}
                      part={p}
                      x={pt.x}
                      y={pt.y}
                      tint={tint(p)}
                      number={numbers ? i + 1 : undefined}
                      active={hovered === p.id || selected === p.id}
                      pill={showNames && !numbers && !showGutter}
                      flip={pt.x > vpW * 0.68}
                      dy={pt.y < 13 ? 13 - pt.y : pt.y > viewport.height - 13 ? viewport.height - 13 - pt.y : 0}
                      index={i}
                      animate={!printing && !reducedMotion}
                      play={seen}
                      onSelect={() => setSelected((s) => (s === p.id ? null : p.id))}
                      onHover={(h) => setHovered(h ? p.id : null)}
                    />
                  ) : (
                    <DragHole key={p.id} x={pt.x} y={pt.y} number={i + 1} value={placed[p.id]} mark={markFor(p)} target={dropTarget === p.id} onTap={() => tapHole(p.id)} />
                  )
                })}
              <AnimatePresence>{mode === 'locate' && feedback && <Pulse key={`${feedback.x}-${feedback.y}`} x={feedback.x} y={feedback.y} ok={feedback.ok} />}</AnimatePresence>
              {base === 'missing' && (
                <div className="absolute inset-0 grid place-items-center text-center px-6">
                  <div className="flex flex-col items-center gap-2 t-footnote text-text2">
                    <Icon name="image" size={24} className="text-text3" />
                    {t('labeled.missing')}
                  </div>
                </div>
              )}
              {!printing && base !== 'missing' && (
                <div className="absolute right-2 top-2 flex gap-1.5" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
                  {mode === 'explore' && !numbers && (
                    <GlassBar>
                      <GlassButton label={showNames ? t('labeled.hideNames') : t('labeled.showNames')} onClick={() => setShowNames((v) => !v)} active={!showNames}>
                        <Icon name={showNames ? 'eye' : 'eye-off'} size={13} />
                      </GlassButton>
                    </GlassBar>
                  )}
                  <ZoomControls scale={tf.scale} onZoom={pz.zoomBy} onReset={pz.reset} />
                </div>
              )}
            </>
          )}
        </div>
        {showGutter && size.width > 0 && (
          <GutterLabels parts={parts} tf={tf} gutter={g} width={W} hovered={hovered} selected={selected} tint={tint} onSelect={(id) => setSelected((s) => (s === id ? null : id))} onHover={setHovered} animate={!printing && !reducedMotion} play={seen} />
        )}
      </div>

      {mode === 'explore' && base !== 'missing' && (
        <ExploreInfo
          parts={parts}
          all={b.parts}
          layers={b.layers}
          numbers={numbers}
          focus={selected ?? hovered}
          tint={tint}
          printing={printing}
          practice={canPractice}
          onSelect={(id) => setSelected((s) => (s === id ? null : id))}
        />
      )}
      {mode === 'locate' && (
        <LocatePanel
          target={target}
          index={quizIndex}
          total={quiz.length}
          results={results}
          feedback={feedback}
          onSkip={() => {
            if (!target || feedback) return
            setResults((r) => ({ ...r, [target.id]: false }))
            setQuizIndex((i) => i + 1)
          }}
          onRetryMissed={() => {
            round.current++
            setQuiz(shuffle(quiz.filter((id) => results[id] === false)))
            setQuizIndex(0)
            setResults({})
            setFeedback(null)
          }}
          onAgain={() => setMode('locate')}
          onFinish={(right, total) => ctx.onInteract?.(block.id, `labeled-locate-${right}/${total}`)}
        />
      )}
      {mode === 'drag' && (
        <DragPanel
          chips={dragChips(parts, `${block.id}chips`)}
          placed={placed}
          picked={picked}
          checked={checked}
          total={parts.length}
          right={dragScore(parts, placed)}
          onChipDown={startChipDrag}
          onCheck={() => {
            setChecked(true)
            ctx.onInteract?.(block.id, `labeled-drag-${dragScore(parts, placed)}/${parts.length}`)
          }}
          onFix={() => {
            setPlaced((cur) => Object.fromEntries(Object.entries(cur).filter(([id, v]) => { const p = parts.find((q) => q.id === id); return p ? nameMatches(p, v) : false })))
            setChecked(false)
          }}
          onAgain={() => setMode('drag')}
        />
      )}
      <Caption text={b.caption} />
      <Credit text={b.credit} />
      {ghost && (
        <div className="fixed z-[200] pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: ghost.x, top: ghost.y }}>
          <Pill text={ghost.name} active />
        </div>
      )}
    </section>
  )
}

// MARK: Base y capas

function FigureBase({ block, base, tf, smooth, visible, assetUrl, animate, play, onImage, onImageError }: {
  block: BlockOf<'labeled'>
  base: 'image' | 'drawing' | 'missing'
  tf: ViewTransform
  smooth: boolean
  visible: Set<string>
  assetUrl: (p: string) => string
  animate: boolean
  play: boolean
  onImage: (aspect: number) => void
  onImageError: () => void
}) {
  const s = scaledSize(tf)
  const d = block.drawing ? canvasSize(block.drawing.width, block.drawing.height) : undefined
  // capas vectoriales: coordenadas del dibujo base (o 1000 de ancho sobre una imagen)
  const layerW = d?.W ?? 1000
  const layerH = d ? d.H : 1000 / (s.width > 0 ? s.width / s.height : 4 / 3)
  return (
    <div
      className="absolute left-0 top-0"
      style={{ width: s.width, height: s.height, transform: `translate(${tf.x}px, ${tf.y}px)`, transition: smooth ? 'transform 260ms cubic-bezier(.2,.7,.2,1), width 260ms cubic-bezier(.2,.7,.2,1), height 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}
    >
      {base === 'image' && block.asset && (
        // una imagen con transparencia (tinta negra sobre nada) va sobre papel claro también en oscuro
        <img
          src={assetUrl(block.asset)}
          alt={block.alt}
          draggable={false}
          className="absolute inset-0 w-full h-full rounded-[6px] bg-[#faf8f3] object-fill"
          onLoad={(e) => {
            const im = e.currentTarget
            if (im.naturalWidth > 0 && im.naturalHeight > 0) onImage(im.naturalWidth / im.naturalHeight)
          }}
          onError={onImageError}
        />
      )}
      {base === 'drawing' && block.drawing && d && (
        <div className="absolute inset-0 bg-surface">
          <DrawingCanvas items={block.drawing.items} W={d.W} H={d.H} pixelWidth={tf.fitted.width} textScale={Math.min(1.6, Math.max(1, Math.sqrt(tf.scale)))} animate={animate} play={play} />
        </div>
      )}
      <AnimatePresence>
        {block.layers
          .filter((l) => visible.has(l.id))
          .map((l) => (
            <motion.div key={l.id} className="absolute inset-0 pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: l.opacity !== undefined ? Math.min(1, Math.max(0, l.opacity)) : 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              {l.asset && <img src={assetUrl(l.asset)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-fill" />}
              {l.items.length > 0 && <DrawingCanvas items={l.items} W={layerW} H={layerH} pixelWidth={tf.fitted.width} textScale={Math.min(1.6, Math.max(1, Math.sqrt(tf.scale)))} animate={false} />}
            </motion.div>
          ))}
      </AnimatePresence>
    </div>
  )
}

// MARK: Marcadores y etiquetas

function Dot({ tint, number, active, mark = 'idle' }: { tint: string; number?: number; active: boolean; mark?: Mark }) {
  const fill = mark === 'correct' ? 'var(--success)' : mark === 'wrong' ? 'var(--danger)' : tint
  const d = number === undefined ? 12 : 20
  return (
    <motion.span
      className="grid place-items-center rounded-full text-[11px] font-bold tabular text-white"
      style={{ width: d, height: d, background: fill, boxShadow: `0 0 0 ${number === undefined ? 2 : 1.6}px rgba(255,255,255,.95), 0 0 0 ${number === undefined ? 2.5 : 2.1}px rgba(32,30,26,.3)` }}
      animate={{ scale: active ? 1.25 : 1 }}
      transition={spring.bouncy}
    >
      {number}
    </motion.span>
  )
}

function Pill({ text, active, tint, mark = 'idle' }: { text: string; active?: boolean; tint?: string; mark?: Mark }) {
  const stroke = mark === 'correct' ? 'var(--success)' : mark === 'wrong' ? 'var(--danger)' : active ? (tint ?? 'var(--text2)') : 'var(--line-strong)'
  return (
    <span
      className={cx('viz-label inline-block max-w-[200px] rounded-[7px] px-[7px] py-[2px] text-[12.5px] leading-[16px] text-text bg-raised/95 whitespace-normal', active || mark !== 'idle' ? 'font-semibold' : 'font-medium')}
      style={{ boxShadow: `inset 0 0 0 ${active || mark !== 'idle' ? 1.4 : 0.75}px ${stroke}` }}
    >
      <RichText text={text} inline />
    </span>
  )
}

function ExploreMarker({ part, x, y, tint, number, active, pill, flip, dy, index, animate, play, onSelect, onHover }: {
  part: FigurePart; x: number; y: number; tint: string; number?: number; active: boolean; pill: boolean; flip: boolean; dy: number; index: number; animate: boolean; play: boolean
  onSelect: () => void; onHover: (h: boolean) => void
}) {
  return (
    <motion.button
      type="button"
      aria-label={part.name}
      title={part.name}
      className="absolute -translate-x-1/2 -translate-y-1/2 outline-none"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onSelect}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      initial={animate ? { scale: 0, opacity: 0 } : false}
      animate={play ? { scale: 1, opacity: 1 } : undefined}
      transition={{ ...spring.bouncy, delay: animate ? 0.2 + Math.min(index, 20) * 0.045 : 0 }}
    >
      <Dot tint={tint} number={number} active={active} />
      {pill && (
        <span className="absolute top-1/2 pointer-events-none whitespace-nowrap" style={flip ? { right: '100%', marginRight: 7, transform: `translateY(calc(-50% + ${dy}px))` } : { left: '100%', marginLeft: 7, transform: `translateY(calc(-50% + ${dy}px))` }}>
          <Pill text={part.name} active={active} tint={tint} />
        </span>
      )}
    </motion.button>
  )
}

function GutterLabels({ parts, tf, gutter, width, hovered, selected, tint, onSelect, onHover, animate, play }: {
  parts: FigurePart[]; tf: ViewTransform; gutter: number; width: number; hovered: string | null; selected: string | null; tint: (p: FigurePart) => string
  onSelect: (id: string) => void; onHover: (id: string | null) => void; animate: boolean; play: boolean
}) {
  const placed = placeGutterLabels(parts, tf, gutter)
  const vw = tf.viewport.width
  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg className="absolute inset-0" width={width} height={tf.viewport.height} aria-hidden>
        {placed.map((p, i) => {
          const on = hovered === p.part.id || selected === p.part.id
          const sx = p.left ? gutter - 4 : gutter + vw + 4
          const ex = p.left ? gutter + 6 : gutter + vw - 6
          return (
            <motion.path
              key={p.part.id}
              d={`M${sx} ${p.y}L${ex} ${p.y}L${p.anchor.x} ${p.anchor.y}`}
              fill="none"
              stroke={on ? tint(p.part) : 'var(--text2)'}
              strokeOpacity={on ? 0.95 : 0.5}
              strokeWidth={on ? 1.5 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={animate ? { pathLength: 0 } : false}
              animate={play ? { pathLength: 1 } : undefined}
              transition={{ duration: 0.5, delay: animate ? 0.3 + Math.min(i, 20) * 0.04 : 0 }}
            />
          )
        })}
      </svg>
      {placed.map((p, i) => {
        const on = hovered === p.part.id || selected === p.part.id
        return (
          <motion.button
            key={p.part.id}
            type="button"
            className={cx('absolute pointer-events-auto flex outline-none', p.left ? 'justify-end' : 'justify-start')}
            style={{ left: p.left ? 0 : gutter + vw + 6, width: gutter - 10, top: p.y, translateY: '-50%' }}
            onClick={() => onSelect(p.part.id)}
            onPointerEnter={() => onHover(p.part.id)}
            onPointerLeave={() => onHover(null)}
            initial={animate ? { opacity: 0, x: p.left ? -6 : 6 } : false}
            animate={play ? { opacity: 1, x: 0 } : undefined}
            transition={{ duration: 0.35, delay: animate ? 0.4 + Math.min(i, 20) * 0.04 : 0 }}
          >
            <Pill text={p.part.name} active={on} tint={tint(p.part)} />
          </motion.button>
        )
      })}
    </div>
  )
}

function DragHole({ x, y, number, value, mark, target, onTap }: { x: number; y: number; number: number; value?: string; mark: Mark; target: boolean; onTap: () => void }) {
  return (
    <button
      type="button"
      className="absolute -translate-x-1/2 -translate-y-1/2 outline-none"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onTap}
      aria-label={value ?? String(number)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {value !== undefined ? (
          <motion.span key="v" className="block" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.bouncy}>
            <Pill text={value} active={target} mark={mark} />
          </motion.span>
        ) : (
          <motion.span
            key="h"
            className="grid place-items-center w-6 h-6 rounded-full bg-raised/90 text-[11px] font-bold tabular text-text2"
            style={{ boxShadow: 'var(--e1)', outline: `1.6px dashed ${target ? 'var(--accent)' : mark === 'wrong' ? 'var(--danger)' : 'var(--text2)'}`, outlineOffset: -1.6 }}
            animate={{ scale: target ? 1.2 : 1 }}
            transition={spring.snappy}
          >
            {number}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

function Pulse({ x, y, ok }: { x: number; y: number; ok: boolean }) {
  const c = ok ? 'var(--success)' : 'var(--danger)'
  return (
    <motion.div className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.span className="absolute left-1/2 top-1/2 w-[34px] h-[34px] -ml-[17px] -mt-[17px] rounded-full" style={{ boxShadow: `inset 0 0 0 3px ${c}` }} initial={{ scale: 0.5, opacity: 0.2 }} animate={{ scale: 1.15, opacity: 0.95 }} transition={spring.bouncy} />
      <span className="relative grid place-items-center w-5 h-5 rounded-full text-white" style={{ background: c }}>
        <Icon name={ok ? 'check' : 'close'} size={11} />
      </span>
    </motion.div>
  )
}

// MARK: Debajo de la figura

function ExploreInfo({ parts, all, layers, numbers, focus, tint, printing, practice, onSelect }: {
  parts: FigurePart[]; all: FigurePart[]; layers: BlockOf<'labeled'>['layers']; numbers: boolean; focus: string | null; tint: (p: FigurePart) => string; printing: boolean; practice: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('visual')
  const p = focus ? all.find((q) => q.id === focus) : undefined
  const layer = p?.layer ? layers.find((l) => l.id === p.layer) : undefined
  return (
    <>
      {numbers && (
        <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {parts.map((q, i) => (
            <button key={q.id} type="button" disabled={printing} onClick={() => onSelect(q.id)} className={cx('flex items-baseline gap-1.5 text-left rounded-md px-1 -mx-1 hover:bg-fill1', focus === q.id && 'bg-fill2')}>
              <span className="t-caption font-bold tabular" style={{ color: tint(q) }}>{i + 1}</span>
              <span className="t-ui text-text2"><RichText text={q.name} inline /></span>
            </button>
          ))}
        </div>
      )}
      {!printing && (
        <div className="min-h-[46px] rounded-[14px] bg-fill1 px-3.5 py-2.5">
          <AnimatePresence mode="wait" initial={false}>
            {p ? (
              <motion.div key={p.id} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: tint(p) }} />
                  <span className="t-headline"><RichText text={p.name} inline /></span>
                  {layer && <span className="t-caption">{layer.name}</span>}
                  {p.aliases.length > 0 && <span className="t-footnote text-text3 truncate">· {p.aliases.join(', ')}</span>}
                </div>
                {p.detail && (
                  <div className="t-callout text-text2 mt-1">
                    <RichText text={p.detail} />
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.p key="hint" className="t-footnote text-text3 flex items-center gap-2 m-0 py-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon name="cursor" size={13} />
                {practice ? t('labeled.hintPractice') : t('labeled.hint')}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  )
}

function LocatePanel({ target, index, total, results, feedback, onSkip, onRetryMissed, onAgain, onFinish }: {
  target?: FigurePart; index: number; total: number; results: Record<string, boolean>; feedback: LocateFeedback | null
  onSkip: () => void; onRetryMissed: () => void; onAgain: () => void; onFinish: (right: number, total: number) => void
}) {
  const { t } = useTranslation('visual')
  const ref = useRef<HTMLDivElement>(null)
  const right = Object.values(results).filter(Boolean).length
  const done = !target && total > 0
  useEffect(() => {
    if (!done) return
    onFinish(right, total)
    if (right === total && ref.current) pixelBurst(ref.current, { count: 18 })
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps
  if (target) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5 flex-wrap rounded-[14px] bg-fill1 px-3.5 py-2.5">
          <Icon name="place" size={15} className="text-accent-text" />
          <span className="t-callout text-text2">{t('labeled.pointTo')}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={target.id} className="t-headline text-text" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              <RichText text={target.name} inline />
            </motion.span>
          </AnimatePresence>
          <span className="flex-1" />
          <AnimatePresence>
            {feedback && (
              <motion.span key="fb" className={cx('t-callout font-semibold', feedback.ok ? 'text-success' : 'text-danger')} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                {feedback.ok ? t('labeled.right') : feedback.hitName ? t('labeled.thatIs', { name: feedback.hitName }) : t('labeled.nothing')}
              </motion.span>
            )}
          </AnimatePresence>
          <span className="t-footnote tabular text-text3">{Math.min(index + 1, total)}/{total}</span>
          <Button size="sm" variant="ghost" onClick={onSkip} disabled={feedback !== null}>
            {t('labeled.skip')}
          </Button>
        </div>
        <ProgressBar value={total > 0 ? index / total : 0} height={3} />
      </div>
    )
  }
  if (!done) return null
  const perfect = right === total
  return (
    <div ref={ref} className={cx('flex items-center gap-2.5 flex-wrap rounded-[14px] px-3.5 py-2.5', perfect ? 'bg-success-soft' : 'bg-fill1')}>
      {perfect ? <PixelCheck size={18} /> : <Icon name="flag" size={16} className="text-text2" />}
      <span className="t-callout font-semibold">
        {t('labeled.score', { right, total })}
      </span>
      <span className="flex-1" />
      {!perfect && (
        <Button size="sm" variant="secondary" icon={<Icon name="undo" size={13} />} onClick={onRetryMissed}>
          {t('labeled.retryMissed')}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onAgain}>
        {t('labeled.again')}
      </Button>
    </div>
  )
}

function DragPanel({ chips, placed, picked, checked, total, right, onChipDown, onCheck, onFix, onAgain }: {
  chips: string[]; placed: Record<string, string>; picked: string | null; checked: boolean; total: number; right: number
  onChipDown: (e: RPointerEvent<HTMLButtonElement>, name: string) => void; onCheck: () => void; onFix: () => void; onAgain: () => void
}) {
  const { t } = useTranslation('visual')
  const ref = useRef<HTMLDivElement>(null)
  const used = new Set(Object.values(placed).map((v) => v.toLowerCase()))
  const count = Object.keys(placed).length
  useEffect(() => {
    if (checked && right === total && total > 0 && ref.current) pixelBurst(ref.current, { count: 18 })
  }, [checked]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-2.5">
      {!checked && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => {
              const isUsed = used.has(c.toLowerCase())
              const on = picked === c
              return (
                <motion.button
                  key={c}
                  type="button"
                  layout
                  onPointerDown={(e) => onChipDown(e, c)}
                  className={cx('h-7 px-3 rounded-full t-ui font-medium touch-none cursor-grab active:cursor-grabbing transition-colors', on ? 'bg-accent-wash text-accent-text' : isUsed ? 'bg-fill2 text-text3' : 'bg-raised text-text hover:bg-fill1')}
                  style={{ boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 0.75px var(--line-strong)', opacity: isUsed ? 0.55 : 1 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <RichText text={c} inline />
                </motion.button>
              )
            })}
          </div>
          <p className="t-footnote text-text3 m-0">{t('labeled.dragHint')}</p>
        </>
      )}
      <div ref={ref} className={cx('flex items-center gap-2.5 flex-wrap rounded-[14px] px-3.5 py-2.5', checked && right === total ? 'bg-success-soft' : 'bg-fill1')}>
        {checked ? (
          <>
            {right === total ? <PixelCheck size={18} /> : <Icon name="flag" size={16} className="text-text2" />}
            <span className="t-callout font-semibold">{t('labeled.inPlace', { right, total })}</span>
            <span className="flex-1" />
            {right < total && (
              <Button size="sm" variant="secondary" icon={<Icon name="undo" size={13} />} onClick={onFix}>
                {t('labeled.fixMistakes')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onAgain}>
              {t('labeled.again')}
            </Button>
          </>
        ) : (
          <>
            <span className="t-footnote tabular text-text3">{t('labeled.placedCount', { count, total })}</span>
            <span className="flex-1" />
            <Button size="sm" variant="primary" icon={<Icon name="check" size={13} />} onClick={onCheck} disabled={count === 0}>
              {t('labeled.check')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
