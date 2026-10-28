// Bloques que se juegan: «¿Qué crees que pasa?» (eliges y se revela con su porqué), «Encuentra el error» (tocas la línea
// con el fallo) y «Pruébalo» (abre los ejercicios). Acertar suelta una ráfaga de píxeles; fallar, un leve temblor.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'motion/react'
import { Button, Card, cx, Icon, pixelBurst, PixelCheck, Sprite, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import type { BlockOf } from '@shared/schema/blocks'
import type { BlockContext, BlockProps } from './types'
import { Eyebrow, Inline, optionLetter, Prose, useAnimate, useBlockMemory, useBlocksT } from './shared'
import { inkColor } from './colors'

/** Interrogación pixel-art que parpadea mientras la pregunta espera respuesta. */
function PixelQuestion({ size = 18, blink }: { size?: number; blink: boolean }) {
  const { reducedMotion } = useTheme()
  const [on, setOn] = useState(true)
  const moving = useAmbient()
  useEffect(() => {
    if (!blink || reducedMotion || !moving) return
    const id = setInterval(() => setOn((v) => !v), 700)
    return () => clearInterval(id)
  }, [blink, reducedMotion, moving])
  const rows = ['.qqq.', 'q...q', '....q', '...q.', '..q..', '..q..', '.....', '..q..']
  return <Sprite rows={rows} legend={{ q: on ? 'var(--accent)' : 'color-mix(in oklab, var(--accent) 45%, transparent)' }} size={size} />
}

/** Superficie común de los bloques de juego: una burbuja con su rótulo en la luz de Aula. */
function GameCard({ ctx, children, onKeyDown }: { ctx: BlockContext; children: ReactNode; onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void }) {
  const chat = ctx.mode === 'chat'
  return (
    <section onKeyDown={onKeyDown} className={cx('relative bg-surface border-[0.5px] border-line', chat ? 'rounded-[16px] p-4' : 'rounded-[22px] p-6')} style={{ boxShadow: ctx.mode === 'lesson' ? 'var(--e1)' : undefined }}>
      {children}
    </section>
  )
}

type Mark = 'none' | 'right' | 'wrong' | 'dimmed'

/** Fila de respuesta: letra o número, el texto y, al revelar, su marca (✓ que se dibuja, ✗ o atenuada). */
function AnswerRow({ badge, mark, locked, onPick, children, detail, animate, mono }: { badge: string; mark: Mark; locked: boolean; onPick: () => void; children: ReactNode; detail?: ReactNode; animate: boolean; mono?: boolean }) {
  const shake = useAnimationControls()
  useEffect(() => {
    if (mark === 'wrong' && animate) void shake.start({ x: [0, -5, 5, -3, 3, 0], transition: { duration: 0.42 } })
  }, [mark, animate, shake])
  const tone =
    mark === 'right'
      ? 'bg-success-soft shadow-[inset_0_0_0_1.5px_var(--success)]'
      : mark === 'wrong'
        ? 'bg-danger-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--danger)_50%,transparent)]'
        : 'bg-surface shadow-[inset_0_0_0_0.5px_var(--line),var(--e1)]'
  return (
    <motion.div animate={shake} className={cx('transition-opacity duration-300', mark === 'dimmed' && 'opacity-50')}>
      <motion.button
        type="button"
        disabled={locked}
        onClick={onPick}
        whileHover={!locked && animate ? { y: -1.5 } : undefined}
        whileTap={!locked ? { scale: 0.985 } : undefined}
        transition={{ type: 'spring', stiffness: 439, damping: 36 }}
        className={cx('group/ans relative flex w-full items-start gap-3 rounded-[14px] px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-line', tone, !locked && 'hover:bg-fill1 cursor-pointer', locked && 'cursor-default')}
      >
        <span
          className={cx(
            'grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-[8px] px-1 t-ui font-bold transition-colors',
            mark === 'right' ? 'bg-success text-white dark:text-[#10241a]' : mark === 'wrong' ? 'bg-danger text-white dark:text-[#2a0d13]' : 'bg-fill2 text-text2 group-hover/ans:bg-fill3',
            mono && 'font-serif font-normal text-[14px] tabular'
          )}
        >
          {mark === 'right' ? <PixelCheck size={14} color="currentColor" /> : mark === 'wrong' ? <Icon name="close" size={13} /> : badge}
        </span>
        <span className="min-w-0 flex-1 pt-[1px]">
          {children}
          <AnimatePresence initial={false}>
            {detail && (
              <motion.span key="d" className="block overflow-hidden" initial={animate ? { height: 0, opacity: 0 } : false} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}>
                <span className="block pt-1.5 t-callout text-text2">{detail}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>
    </motion.div>
  )
}

/** Explicación tras responder: el veredicto con su icono y el porqué. */
function Verdict({ ok, title, children, animate }: { ok: boolean; title: ReactNode; children?: ReactNode; animate: boolean }) {
  return (
    <motion.div initial={animate ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: animate ? 0.12 : 0 }} className={cx('mt-4 rounded-[14px] px-4 py-3', ok ? 'bg-success-soft' : 'bg-fill1')}>
      <div className={cx('flex items-center gap-2 t-headline', ok ? 'text-success' : 'text-text')}>
        <Icon name={ok ? 'check-circle' : 'lightbulb'} size={16} className={ok ? undefined : 'text-text2'} />
        {title}
      </div>
      {children && <div className="mt-1.5">{children}</div>}
    </motion.div>
  )
}

// MARK: ¿Qué crees que pasa?

export function PredictBlockView({ block, ctx }: BlockProps<BlockOf<'predict'>>) {
  const t = useBlocksT()
  const animate = useAnimate(ctx)
  const print = ctx.mode === 'print'
  const [picked, setPicked] = useBlockMemory<number | null>(ctx, block.id, 'predict', null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const options = block.options.slice(0, 12)
  const revealed = picked !== null || print
  const correctIndex = options.findIndex((o) => o.correct)
  const ok = picked !== null && options[picked]?.correct === true

  const pick = (i: number) => {
    if (picked !== null || print || !options[i]) return
    setPicked(i)
    ctx.onInteract?.(block.id, options[i].correct ? 'predict.right' : 'predict.wrong')
    if (options[i].correct && animate) {
      const el = rowRefs.current[i]
      if (el) requestAnimationFrame(() => pixelBurst(el, { count: 16 }))
    }
  }
  const mark = (i: number): Mark => {
    if (!revealed) return 'none'
    if (options[i].correct) return 'right'
    return picked === i ? 'wrong' : 'dimmed'
  }
  const keyIndex = (e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): number => {
    if (revealed || e.metaKey || e.ctrlKey || e.altKey) return -1
    const k = e.key.toUpperCase()
    const i = /^[1-9]$/.test(k) ? Number(k) - 1 : k.length === 1 && k >= 'A' && k <= 'Z' ? k.charCodeAt(0) - 65 : -1
    return i >= 0 && i < options.length ? i : -1
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = keyIndex(e)
    if (i >= 0) {
      e.preventDefault()
      e.stopPropagation()
      pick(i)
    }
  }
  // sin pulsar antes en la pregunta: la primera pregunta sin responder de la página atiende A/B/C y 1/2/3
  // (si no estás escribiendo en un campo)
  const root = useRef<HTMLDivElement>(null)
  const pickRef = useRef(pick)
  pickRef.current = pick
  const keyRef = useRef(keyIndex)
  keyRef.current = keyIndex
  useEffect(() => {
    if (revealed || print || ctx.mode === 'chat') return
    const onWindowKey = (e: globalThis.KeyboardEvent): void => {
      // como los atajos de los ejercicios: nada si otro ya la atendió o hay un diálogo abierto
      if (e.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return
      if (el && el !== document.body && root.current?.contains(el)) return // ya lo atiende onKey
      if (document.querySelector('[data-predict-open]') !== root.current) return
      const i = keyRef.current(e)
      if (i < 0) return
      e.preventDefault()
      pickRef.current(i)
    }
    window.addEventListener('keydown', onWindowKey)
    return () => window.removeEventListener('keydown', onWindowKey)
  }, [revealed, print, ctx.mode])

  return (
    <div ref={root} data-predict-open={revealed ? undefined : ''}>
    <GameCard ctx={ctx} onKeyDown={onKey}>
      <div className="flex items-center gap-2 text-accent-text">
        <Eyebrow icon="help" label={t('predict.eyebrow')} />
        {!print && <span className="ml-auto">{revealed ? (ok ? <PixelCheck size={18} /> : null) : <PixelQuestion blink={animate} />}</span>}
      </div>
      <div className="mt-2">
        <Prose text={block.question} ctx={ctx} />
      </div>
      <div className={cx('mt-4 grid gap-2', options.length >= 4 && options.every((o) => o.md.length < 48) && ctx.mode !== 'chat' && 'sm:grid-cols-2')}>
        {options.map((o, i) => (
          <div key={i} ref={(el) => { rowRefs.current[i] = el }}>
            <AnswerRow
              badge={optionLetter(i)}
              mark={mark(i)}
              locked={revealed}
              onPick={() => pick(i)}
              animate={animate}
              detail={revealed && (picked === i || o.correct) && o.why?.trim() ? <Inline text={o.why} /> : undefined}
            >
              <Prose text={o.md} ctx={ctx} size="small" />
            </AnswerRow>
          </div>
        ))}
      </div>
      {!revealed && <div className="mt-3 t-footnote text-text3">{t('predict.hint')}</div>}
      {revealed && !print && picked !== null && (
        <Verdict ok={ok} animate={animate} title={ok ? t('predict.right') : correctIndex >= 0 ? t('predict.wrong', { letter: optionLetter(correctIndex) }) : t('predict.wrongNoAnswer')}>
          {block.explanation?.trim() && <Prose text={block.explanation} ctx={ctx} size="small" />}
        </Verdict>
      )}
      {print && block.explanation?.trim() && (
        <div className="mt-3"><Prose text={block.explanation} ctx={ctx} size="small" /></div>
      )}
      {revealed && !print && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" icon={<Icon name="refresh" size={14} />} onClick={() => setPicked(null)}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </GameCard>
    </div>
  )
}

// MARK: Encuentra el error

export function SpotBlockView({ block, ctx }: BlockProps<BlockOf<'spot'>>) {
  const t = useBlocksT()
  const animate = useAnimate(ctx)
  const print = ctx.mode === 'print'
  const [stored, setPicked] = useBlockMemory<number | null>(ctx, block.id, 'spot', null)
  const picked = print ? block.wrongIndex : stored
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const lines = block.lines.slice(0, 40)
  const inRange = block.wrongIndex >= 0 && block.wrongIndex < lines.length
  const ok = picked !== null && picked === block.wrongIndex

  const pick = (i: number) => {
    if (picked !== null || print) return
    setPicked(i)
    ctx.onInteract?.(block.id, i === block.wrongIndex ? 'spot.right' : 'spot.wrong')
    if (i === block.wrongIndex && animate) {
      const el = rowRefs.current[i]
      if (el) requestAnimationFrame(() => pixelBurst(el, { count: 16 }))
    }
  }
  const mark = (i: number): Mark => {
    if (picked === null) return 'none'
    if (i === block.wrongIndex) return 'right'
    return i === picked ? 'wrong' : 'dimmed'
  }

  return (
    <GameCard ctx={ctx}>
      <div className="flex items-center gap-2 text-accent-text">
        <Eyebrow icon="search" label={t('spot.eyebrow')} />
        {!print && picked === null && <span className="ml-auto t-caption text-text3">{t('spot.lines', { count: lines.length })}</span>}
      </div>
      <div className="mt-2">
        <Prose text={block.intro} ctx={ctx} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {lines.map((l, i) => (
          <div key={i} ref={(el) => { rowRefs.current[i] = el }}>
            <AnswerRow
              badge={String(i + 1)}
              mono
              mark={mark(i)}
              locked={picked !== null}
              onPick={() => pick(i)}
              animate={animate}
              detail={picked !== null && i === block.wrongIndex && !print ? t('spot.here') : undefined}
            >
              <Prose text={l} ctx={ctx} size="small" />
            </AnswerRow>
          </div>
        ))}
      </div>
      {picked === null && <div className="mt-3 t-footnote text-text3">{t('spot.hint')}</div>}
      {picked !== null && (print ? (
        block.explanation.trim() && <div className="mt-3"><Prose text={block.explanation} ctx={ctx} size="small" /></div>
      ) : (
        <Verdict ok={ok} animate={animate} title={ok ? t('spot.right') : inRange ? t('spot.wrong', { line: block.wrongIndex + 1 }) : t('spot.wrongNoLine')}>
          {block.explanation.trim() && <Prose text={block.explanation} ctx={ctx} size="small" />}
        </Verdict>
      ))}
      {picked !== null && !print && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" icon={<Icon name="refresh" size={14} />} onClick={() => setPicked(null)}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </GameCard>
  )
}

// MARK: Pruébalo

export function TryItBlockView({ block, ctx }: BlockProps<BlockOf<'tryit'>>) {
  const t = useBlocksT()
  const { dark } = useTheme()
  const ids = [...block.exerciseIDs, ...block.inline.map((e) => e.id)]
  const count = ids.length
  const can = !!ctx.onTryIt && count > 0 && ctx.mode !== 'print'
  const ink = inkColor(ctx.hue, dark)
  const title = block.title?.trim() || t('tryit.title')
  const open = () => {
    if (!can) return
    ctx.onInteract?.(block.id, 'tryit.open')
    ctx.onTryIt?.(ids)
  }
  return (
    <Card
      interactive={can}
      padded={ctx.mode === 'chat' ? 'sm' : true}
      elevation={1}
      onClick={can ? open : undefined}
      role={can ? 'button' : undefined}
      tabIndex={can ? 0 : undefined}
      onKeyDown={(e) => {
        if (can && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
      className={cx('flex items-center gap-4 outline-none focus-visible:ring-2 focus-visible:ring-accent-line', can && 'cursor-pointer')}
      aria-label={`${title}: ${t('tryit.count', { count })}`}
    >
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px]" style={{ background: `color-mix(in oklab, ${ink} 14%, transparent)`, color: ink }}>
        <Icon name="practice" size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="t-headline text-text"><Inline text={title} /></div>
        <div className="mt-1 flex items-center gap-2 t-ui text-text2">
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: Math.min(count, 12) }, (_, i) => (
              <motion.span key={i} className="block h-[7px] w-[7px] rounded-[1.5px]" style={{ background: ink }} initial={{ opacity: 0, y: -3 }} whileInView={{ opacity: 0.85, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.05, duration: 0.25 }} />
            ))}
          </span>
          <span>{t('tryit.count', { count })}</span>
          {!ctx.onTryIt && ctx.mode !== 'print' && <span className="text-text3">· {t('tryit.inLesson')}</span>}
        </div>
      </div>
      {can && (
        <span className="inline-flex shrink-0 items-center gap-1.5 t-ui font-semibold text-accent-text">
          {t('tryit.start')}
          <Icon name="arrow-right" size={15} />
        </span>
      )}
    </Card>
  )
}
