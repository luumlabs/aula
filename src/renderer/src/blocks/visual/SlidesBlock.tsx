// Presentaciones: `SlideDeckView` reproduce una presentación (`Deck`) con los temas de la app original (aula, minimal, academic,
// midnight, chalk) en la paleta nueva, sus diseños (portada, sección, contenido, imagen, dos columnas, comparación, fórmula,
// cita), teclado, transiciones suaves y «Presentar» a pantalla completa con notas y vista del orador. `SlidesBlock` es el bloque
// de lección con una presentación dentro (JSON `{"type": "slides", "slides": […]}`). Port de StudyUI/Blocks/Slides/*.swift.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, ProgressBar, cx, spring, useTheme } from '@renderer/design'
import type { Block, BlockOf } from '@shared/schema/blocks'
import { decodeDeck, type Deck, type Slide } from '@shared/schema/cards'
import { RichText } from '@renderer/lib/RichText'
import type { BlockContext, BlockProps } from '../types'
import { BlockList } from '../BlockView'
import { FIT_FACTORS, FONT_STACK, SLIDE_H, SLIDE_W, deckTransition, initialFit, keyAction, slideTheme, updateFit, type SlideTheme } from './lib/slides'
import { useSize } from './shared/ui'

/** Bloque de lección con una presentación dentro (un tipo que el modelo aún no conoce: llega como `unknown`). */
export default function SlidesBlock({ block, ctx }: BlockProps<BlockOf<'unknown'>>) {
  const deck = useMemo(() => (block.raw ? decodeDeck({ id: block.id, ...block.raw }) : undefined), [block])
  if (!deck) return null
  return <SlideDeckView deck={deck} ctx={ctx} compact={ctx.mode === 'chat'} />
}

// MARK: Reproductor

export function SlideDeckView({ deck, ctx, compact = false, startIndex = 0 }: { deck: Deck; ctx: BlockContext; compact?: boolean; startIndex?: number }) {
  const { t } = useTranslation('visual')
  const { reducedMotion } = useTheme()
  const count = deck.slides.length
  const [index, setIndex] = useState(() => Math.max(0, Math.min(count - 1, startIndex)))
  const [dir, setDir] = useState(1)
  const [notes, setNotes] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const transition = reducedMotion ? 'none' : deckTransition(deck.transition)
  const hasNotes = deck.slides.some((s) => (s.notes ?? '').trim() !== '')

  const go = useCallback((i: number) => {
    const j = Math.max(0, Math.min(count - 1, i))
    setIndex((cur) => {
      if (j !== cur) setDir(j > cur ? 1 : -1)
      return j
    })
    ctx.onInteract?.(deck.id, 'slide')
  }, [count, ctx, deck.id])

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    const a = keyAction(e.key)
    if (!a || a === 'close' || a === 'presenter') return
    e.preventDefault()
    if (a === 'next') go(index + 1)
    else if (a === 'previous') go(index - 1)
    else if (a === 'first') go(0)
    else if (a === 'last') go(count - 1)
    else if (a === 'notes') setNotes((v) => !v)
    else if (a === 'present') setPresenting(true)
  }

  if (count === 0) {
    return (
      <div className="rounded-[18px] bg-fill1 px-4 py-6 text-center t-callout text-text3">{t('slides.empty')}</div>
    )
  }
  const slide = deck.slides[index]
  const print = ctx.mode === 'print'
  if (print) {
    return (
      <div className="flex flex-col gap-4">
        {deck.slides.map((s, i) => (
          <SlideFrame key={s.id + i} slide={s} deck={deck} index={i} ctx={ctx} />
        ))}
      </div>
    )
  }
  return (
    <section className="flex flex-col gap-2.5 outline-none" tabIndex={0} onKeyDown={onKey} aria-roledescription={t('slides.deck')} aria-label={deck.title}>
      <div className="relative">
        <div className="relative overflow-hidden rounded-[14px] border-[0.5px] border-line shadow-[var(--e2)]" style={{ aspectRatio: '16 / 9' }}>
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={index}
              className="absolute inset-0"
              custom={dir}
              initial={transition === 'none' ? false : transition === 'slide' ? { x: `${dir * 100}%` } : { opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={transition === 'none' ? { opacity: 0, transition: { duration: 0 } } : transition === 'slide' ? { x: `${-dir * 100}%` } : { opacity: 0 }}
              transition={transition === 'slide' ? spring.smooth : { duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <SlideFrame slide={slide} deck={deck} index={index} ctx={ctx} framed={false} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Icon name="layers" size={14} className="text-text3 shrink-0" />
        <span className="t-footnote font-semibold text-text2 truncate">{deck.title}</span>
        <span className="flex-1" />
        <span className="t-footnote tabular text-text3 mr-1">{index + 1} / {count}</span>
        <IconButton size="sm" label={t('slides.prev')} onClick={() => go(index - 1)} disabled={index === 0}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        <IconButton size="sm" label={t('slides.next')} onClick={() => go(index + 1)} disabled={index >= count - 1}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        {hasNotes && (
          <IconButton size="sm" label={t('slides.notes')} active={notes} onClick={() => setNotes((v) => !v)}>
            <Icon name="note" size={14} />
          </IconButton>
        )}
        <Button size="sm" variant="secondary" icon={<Icon name="expand" size={13} />} onClick={() => setPresenting(true)} title={t('slides.presentHint')}>
          {t('slides.present')}
        </Button>
      </div>
      {!compact && count > 1 && <Thumbnails deck={deck} index={index} onPick={go} />}
      <AnimatePresence initial={false}>
        {notes && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
            <div className="rounded-[14px] bg-sunken px-4 py-3">
              <div className="t-caption mb-1">{t('slides.speakerNotes')}</div>
              <div className="t-callout text-text">{slide.notes?.trim() ? <RichText text={slide.notes} /> : <span className="text-text3">{t('slides.noNotes')}</span>}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {presenting && <Presentation deck={deck} ctx={ctx} index={index} dir={dir} transition={transition} onGo={go} onClose={() => setPresenting(false)} />}
    </section>
  )
}

/** Miniaturas: el tema, el título y el esquema del diseño (sin dibujar los bloques: ni 3D ni mapas en vivo en cada una). */
function Thumbnails({ deck, index, onPick }: { deck: Deck; index: number; onPick: (i: number) => void }) {
  const { t } = useTranslation('visual')
  const theme = slideTheme(deck.theme)
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = strip.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [index])
  return (
    <div ref={strip} className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 pt-0.5 [scrollbar-width:none]">
      {deck.slides.map((s, i) => (
        <button
          key={s.id + i}
          type="button"
          onClick={() => onPick(i)}
          aria-label={t('slides.slideN', { n: i + 1 })}
          aria-current={i === index}
          className={cx('relative shrink-0 w-[128px] rounded-[8px] overflow-hidden transition-[box-shadow,opacity] duration-200', theme.dark ? 'viz-dark' : 'viz-light', i === index ? 'opacity-100' : 'opacity-75 hover:opacity-100')}
          style={{ aspectRatio: '16 / 9', boxShadow: i === index ? 'inset 0 0 0 2px var(--accent), var(--e1)' : 'inset 0 0 0 0.75px var(--line)', background: `var(--${theme.background})` }}
        >
          <span className="absolute left-2 right-2 top-[9px] text-left text-[7.5px] leading-[9px] font-semibold text-text line-clamp-2" style={{ fontFamily: FONT_STACK[theme.titleFont] }}>
            {plain(s.title ?? (i === 0 ? deck.title : ''))}
          </span>
          {s.layout !== 'title' && s.layout !== 'section' && (
            <span className="absolute left-2 right-2 bottom-2 top-[30px] flex flex-col gap-[3px]">
              {[0.9, 0.7, 0.8].map((w, k) => <span key={k} className="h-[2px] rounded-full bg-fill4" style={{ width: `${w * (s.layout === 'twoColumn' || s.layout === 'comparison' ? 45 : 90)}%` }} />)}
            </span>
          )}
          <span className="absolute left-2 top-[3px] h-[2px] w-4 rounded-full" style={{ background: theme.tone }} />
          <span className="absolute right-1.5 bottom-1 text-[7px] tabular text-text3">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

const plain = (s: string): string => s.replace(/\$\$?([^$]*)\$\$?/g, '$1').replace(/[*_`]/g, '')

// MARK: Diapositiva

/** Una diapositiva con su tema, escalada al ancho disponible (16:9). */
export function SlideFrame({ slide, deck, index, ctx, framed = true }: { slide: Slide; deck: Deck; index: number; ctx: BlockContext; framed?: boolean }) {
  const [box, size] = useSize<HTMLDivElement>()
  const k = size.width > 0 ? size.width / SLIDE_W : 0
  return (
    <div ref={box} className={cx('relative w-full', framed && 'overflow-hidden rounded-[12px] border-[0.5px] border-line')} style={{ aspectRatio: '16 / 9' }}>
      {k > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${k})` }}>
          <SlideCanvas slide={slide} deck={deck} index={index} ctx={ctx} />
        </div>
      )}
    </div>
  )
}

function SlideCanvas({ slide, deck, index, ctx, showFooter = true }: { slide: Slide; deck: Deck; index: number; ctx: BlockContext; showFooter?: boolean }) {
  const theme = slideTheme(deck.theme)
  const blockCtx: BlockContext = useMemo(() => ({ ...ctx, mode: ctx.mode === 'print' ? 'print' : 'chat' }), [ctx])
  return (
    <div
      className={cx('viz-slide relative overflow-hidden', theme.dark ? 'viz-dark' : 'viz-light')}
      style={{ width: SLIDE_W, height: SLIDE_H, background: `var(--${theme.background})`, fontFamily: FONT_STACK[theme.bodyFont], ['--slide-tone' as string]: theme.tone } as CSSProperties}
    >
      <ThemeDetail theme={theme} />
      <div className="absolute inset-0 flex flex-col" style={{ padding: `46px 60px ${showFooter && slide.layout !== 'title' ? 56 : 42}px` }}>
        <SlideContent slide={slide} deck={deck} theme={theme} ctx={blockCtx} />
      </div>
      {showFooter && slide.layout !== 'title' && (
        <div className="absolute left-[60px] right-[60px] flex items-center justify-between text-[12px] font-medium text-text3" style={{ bottom: theme.detail === 'doubleRule' ? 10 : theme.detail === 'frame' ? 22 : 18 }}>
          <span className="truncate">{plain(deck.title)}</span>
          <span className="tabular font-semibold">{index + 1} / {deck.slides.length}</span>
        </div>
      )}
    </div>
  )
}

/** El detalle fino de cada tema: la raya de arriba, la doble raya académica o el marco de la pizarra. Siempre plano. */
function ThemeDetail({ theme }: { theme: SlideTheme }) {
  switch (theme.detail) {
    case 'topBar': return <div className="absolute left-0 right-0 top-0 h-[5px]" style={{ background: theme.tone }} />
    case 'doubleRule':
      return (
        <div className="absolute left-[60px] right-[60px] bottom-[30px] flex flex-col gap-[3px]">
          <span className="h-[2px]" style={{ background: theme.tone }} />
          <span className="h-px" style={{ background: theme.tone }} />
        </div>
      )
    case 'frame':
      return (
        <>
          <div className="absolute inset-0" style={{ background: `color-mix(in oklab, ${theme.tone} 9%, transparent)` }} />
          <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 0 11px color-mix(in oklab, ${theme.tone} 70%, #1b1712)` }} />
        </>
      )
    default: return null
  }
}

function Title({ text, theme, size = 36 }: { text?: string; theme: SlideTheme; size?: number }) {
  if (!text) return null
  return (
    <div className="mb-5 shrink-0">
      <h2 className="m-0 text-text font-semibold tracking-[-0.4px]" style={{ fontFamily: FONT_STACK[theme.titleFont], fontSize: size, lineHeight: 1.15, fontWeight: theme.titleFont === 'serif' ? 500 : 650 }}>
        <RichText text={text} inline />
      </h2>
      <span className="block mt-2.5 h-[4px] w-11 rounded-full" style={{ background: theme.tone }} />
    </div>
  )
}

function SlideContent({ slide, deck, theme, ctx }: { slide: Slide; deck: Deck; theme: SlideTheme; ctx: BlockContext }) {
  const { t } = useTranslation('visual')
  const titleFont = { fontFamily: FONT_STACK[theme.titleFont], fontWeight: theme.titleFont === 'serif' ? 500 : 700 }
  switch (slide.layout) {
    case 'title':
      return (
        <div className="flex-1 flex flex-col justify-center gap-4 min-h-0">
          <span className="block h-[6px] w-16 rounded-full" style={{ background: theme.tone }} />
          <h1 className="m-0 text-text tracking-[-0.8px]" style={{ ...titleFont, fontSize: 54, lineHeight: 1.08 }}>
            <RichText text={slide.title ?? deck.title} inline />
          </h1>
          {slide.subtitle && <p className="m-0 text-[24px] leading-[32px] text-text2"><RichText text={slide.subtitle} inline /></p>}
          {slide.blocks.length > 0 && <FitBlocks blocks={slide.blocks} ctx={ctx} zoom={1.3} maxHeight={150} />}
          {deck.summary && !slide.subtitle && <p className="m-0 mt-6 text-[16px] text-text3 line-clamp-2">{deck.summary}</p>}
        </div>
      )
    case 'section':
      return (
        <div className="flex-1 flex flex-col justify-center gap-3.5">
          <span className="text-[15px] font-semibold uppercase tracking-[2px]" style={{ color: theme.tone }}>{t('slides.section')}</span>
          <h1 className="m-0 text-text tracking-[-0.6px]" style={{ ...titleFont, fontSize: 48, lineHeight: 1.1 }}>
            <RichText text={slide.title ?? ''} inline />
          </h1>
          {slide.subtitle && <p className="m-0 text-[22px] text-text2"><RichText text={slide.subtitle} inline /></p>}
          <span className="block h-[4px] w-32 rounded-full mt-2" style={{ background: theme.tone }} />
        </div>
      )
    case 'quote': {
      const big = slide.title && !slide.blocks.length
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 min-h-0">
          <Icon name="quote" size={46} style={{ color: theme.tone }} />
          {big ? (
            <p className="m-0 font-serif italic text-text max-w-[820px]" style={{ fontSize: 34, lineHeight: 1.3 }}><RichText text={slide.title ?? ''} inline /></p>
          ) : (
            <>
              {slide.title && <div className="text-[22px] font-semibold text-text2" style={{ fontFamily: FONT_STACK[theme.titleFont] }}><RichText text={slide.title} inline /></div>}
              <div className="w-full max-w-[820px] flex-1 min-h-0 font-serif italic"><FitBlocks blocks={slide.blocks} ctx={ctx} zoom={1.8} center /></div>
            </>
          )}
          {slide.subtitle && <p className="m-0 font-serif text-[20px] text-text2">— <RichText text={slide.subtitle} inline /></p>}
        </div>
      )
    }
    case 'image':
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <Title text={slide.title} theme={theme} />
          {slide.image ? (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img src={ctx.assetUrl(slide.image)} alt={plain(slide.title ?? '')} className="max-w-full max-h-full object-contain rounded-[12px]" draggable={false} />
            </div>
          ) : (
            <div className="flex-1 min-h-0"><FitBlocks blocks={slide.blocks} ctx={ctx} /></div>
          )}
          {slide.image && slide.blocks.length > 0 && <div className="shrink-0 mt-3"><FitBlocks blocks={slide.blocks} ctx={ctx} zoom={1.2} maxHeight={96} /></div>}
          {slide.credit && <p className="m-0 mt-2 text-[11px] text-text3 truncate">© {slide.credit}</p>}
        </div>
      )
    case 'twoColumn': case 'comparison': {
      const cmp = slide.layout === 'comparison'
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <Title text={slide.title} theme={theme} />
          <div className="flex-1 min-h-0 flex gap-8">
            <Column blocks={slide.blocks} header={cmp ? slide.leftTitle : undefined} tint={theme.tone} ctx={ctx} />
            {!cmp && <span className="w-px shrink-0 bg-line-strong opacity-50" />}
            <Column blocks={slide.right} header={cmp ? slide.rightTitle : undefined} tint={theme.dark ? 'var(--viz-blue)' : 'var(--viz-blue)'} ctx={ctx} />
          </div>
        </div>
      )
    }
    case 'focus':
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <Title text={slide.title} theme={theme} />
          <div className="flex-1 min-h-0 flex items-center"><FitBlocks blocks={slide.blocks} ctx={ctx} zoom={2.2} center /></div>
        </div>
      )
    default:
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <Title text={slide.title} theme={theme} />
          <div className="flex-1 min-h-0 flex gap-7">
            <div className="flex-1 min-w-0 min-h-0"><FitBlocks blocks={slide.blocks} ctx={ctx} /></div>
            {slide.image && (
              <div className="w-[330px] shrink-0 flex flex-col gap-1.5">
                <img src={ctx.assetUrl(slide.image)} alt="" className="w-full max-h-[340px] object-contain rounded-[12px]" draggable={false} />
                {slide.credit && <p className="m-0 text-[10.5px] text-text3 line-clamp-2">{slide.credit}</p>}
              </div>
            )}
          </div>
        </div>
      )
  }
}

function Column({ blocks, header, tint, ctx }: { blocks: Block[]; header?: string; tint: string; ctx: BlockContext }) {
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
      {header && (
        <div className="shrink-0 rounded-[12px] px-4 py-2 text-center text-[21px] font-semibold" style={{ color: tint, background: `color-mix(in oklab, ${tint} 12%, transparent)` }}>
          <RichText text={header} inline />
        </div>
      )}
      <div className="flex-1 min-h-0"><FitBlocks blocks={blocks} ctx={ctx} zoom={1.45} /></div>
    </div>
  )
}

/**
 * Los bloques de la diapositiva a escala de proyección; si no caben en el hueco, la letra baja (una sola copia del contenido:
 * lo que el estudiante hizo en un bloque interactivo no se pierde al cambiar de tamaño).
 */
function FitBlocks({ blocks, ctx, zoom = 1.6, maxHeight, center }: { blocks: Block[]; ctx: BlockContext; zoom?: number; maxHeight?: number; center?: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(initialFit)
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current
    if (!o || !i) return
    const measure = (): void => setFit((f) => {
      const n = updateFit(f, i.offsetHeight, maxHeight ?? o.clientHeight)
      return n.step === f.step && n.overflowed === f.overflowed && n.available === f.available && n.natural === f.natural ? f : n
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [maxHeight])
  if (!blocks.length) return null
  return (
    <div ref={outer} className={cx('w-full overflow-hidden', maxHeight === undefined && 'h-full', center && 'flex flex-col justify-center')} style={maxHeight !== undefined ? { maxHeight } : undefined}>
      <div ref={inner} style={{ zoom: zoom * FIT_FACTORS[fit.step] }} className={cx(center && 'text-center')}>
        <BlockList blocks={blocks} ctx={ctx} />
      </div>
    </div>
  )
}

// MARK: Pantalla completa

function Presentation({ deck, ctx, index, dir, transition, onGo, onClose }: { deck: Deck; ctx: BlockContext; index: number; dir: number; transition: 'fade' | 'slide' | 'none'; onGo: (i: number) => void; onClose: () => void }) {
  const { t } = useTranslation('visual')
  const root = useRef<HTMLDivElement>(null)
  const [notes, setNotes] = useState(false)
  const [presenter, setPresenter] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  const count = deck.slides.length

  useEffect(() => {
    const el = root.current
    el?.focus()
    el?.requestFullscreen?.().catch(() => undefined)
    const onFs = (): void => { if (!document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', onFs)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      clearInterval(tick)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [onClose])

  // la barra se esconde 2,5 s después del último movimiento del ratón (si no, parpadea delante del público)
  const wake = (): void => {
    setChrome(true)
    if (hide.current) clearTimeout(hide.current)
    hide.current = setTimeout(() => setChrome(false), 2500)
  }
  useEffect(() => { wake(); return () => { if (hide.current) clearTimeout(hide.current) } }, [])

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const a = keyAction(e.key)
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    if (a === 'next') onGo(index + 1)
    else if (a === 'previous') onGo(index - 1)
    else if (a === 'first') onGo(0)
    else if (a === 'last') onGo(count - 1)
    else if (a === 'notes') setNotes((v) => !v)
    else if (a === 'presenter') setPresenter((v) => !v)
    else if (a === 'close') onClose()
  }
  const slide = deck.slides[index]
  const secs = Math.floor((now - started) / 1000)
  const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`

  const stage = (
    <AnimatePresence initial={false} custom={dir} mode="popLayout">
      <motion.div
        key={index}
        className="w-full"
        initial={transition === 'none' ? false : transition === 'slide' ? { x: `${dir * 60}%`, opacity: 0 } : { opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={transition === 'none' ? { opacity: 0, transition: { duration: 0 } } : transition === 'slide' ? { x: `${-dir * 60}%`, opacity: 0 } : { opacity: 0 }}
        transition={transition === 'slide' ? spring.smooth : { duration: 0.35 }}
      >
        <SlideFrame slide={slide} deck={deck} index={index} ctx={ctx} framed={false} />
      </motion.div>
    </AnimatePresence>
  )

  return createPortal(
    <div ref={root} tabIndex={-1} className="fixed inset-0 z-[300] bg-black outline-none select-none" onKeyDown={onKey} onMouseMove={wake} role="dialog" aria-label={deck.title}>
      {presenter ? (
        <div className="viz-dark absolute inset-0 grid grid-cols-[minmax(0,1fr)_340px] gap-6 p-6" style={{ background: 'var(--canvas)' }}>
          <div className="flex flex-col gap-3 min-w-0 justify-center">
            <div className="t-caption">{t('slides.now')}</div>
            <div className="rounded-[10px] overflow-hidden">{stage}</div>
          </div>
          <div className="flex flex-col gap-4 min-h-0">
            <div className="font-serif text-[40px] leading-[44px] tabular text-text">{clock}</div>
            <div className="t-headline tabular text-text2">{index + 1} / {count}</div>
            {index + 1 < count && (
              <div className="flex flex-col gap-1.5">
                <div className="t-caption">{t('slides.upNext')}</div>
                <div className="pointer-events-none"><SlideFrame slide={deck.slides[index + 1]} deck={deck} index={index + 1} ctx={{ ...ctx, mode: 'print' }} /></div>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto t-body text-text">
              {slide.notes?.trim() ? <RichText text={slide.notes} /> : <span className="text-text3">{t('slides.noNotes')}</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Icon name="chevron-left" size={14} />} onClick={() => onGo(index - 1)} disabled={index === 0}>{t('slides.prev')}</Button>
              <Button variant="primary" iconRight={<Icon name="chevron-right" size={14} />} onClick={() => onGo(index + 1)} disabled={index >= count - 1}>{t('slides.next')}</Button>
              <span className="flex-1" />
              <Button variant="ghost" onClick={onClose}>{t('slides.end')}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" onClick={() => onGo(index + 1)}>
          <div className="w-full" style={{ maxWidth: `calc(100vh * 16 / 9)` }}>{stage}</div>
        </div>
      )}
      {!presenter && (
        <AnimatePresence>
          {notes && slide.notes?.trim() && (
            <motion.div className="viz-dark absolute left-1/2 bottom-16 w-[min(900px,90vw)] -translate-x-1/2 max-h-[30vh] overflow-y-auto rounded-[16px] bg-black/70 backdrop-blur-md px-6 py-4 t-body text-text" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
              <RichText text={slide.notes} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      <AnimatePresence>
        {chrome && !presenter && (
          <motion.div className="absolute left-1/2 bottom-5 -translate-x-1/2 flex items-center gap-4 rounded-full bg-black/55 px-4 py-2 text-[12.5px] font-medium text-white/75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="tabular">{index + 1} / {count}</span>
            <span className="w-[200px]"><ProgressBar value={(index + 1) / count} height={3} color="rgba(255,255,255,.8)" /></span>
            <span>{t('slides.keysHint')}</span>
            <button type="button" className="ml-1 rounded-full px-2 py-0.5 hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onClose() }}>{t('slides.exit')}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  ) as ReactNode
}
