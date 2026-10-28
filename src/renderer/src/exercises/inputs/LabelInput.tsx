// Rotular una figura (imagen del curso o dibujo vectorial): escribir el nombre de cada alfiler, elegirlo de una lista,
// arrastrar las etiquetas a su alfiler o señalar la parte que se pide con un clic.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { AnswerOf } from '@shared/schema/exercises'
import { effectiveLabelMode } from '@shared/schema/exercises'
import { effectiveAspect } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import { DrawingCanvas } from '@renderer/blocks/visual/shared/DrawingCanvas'
import { cx, Select, spring, useTheme } from '@renderer/design'
import { SeededShuffler } from '../model'
import { formatPoint, parsePoint } from '../normalize'
import { partTone, type InputProps } from './shared'

type LabelProps = InputProps<AnswerOf<'label'>>

function Figure({ answer, ctx, children, onClick, cursor }: Pick<LabelProps, 'answer' | 'ctx'> & { children?: ReactNode; onClick?: (x: number, y: number) => void; cursor?: string }) {
  const { reducedMotion } = useTheme()
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const aspect = effectiveAspect(answer)
  return (
    <figure className="m-0 mx-auto w-full" style={{ maxWidth: Math.round(440 * aspect) }}>
      <div
        ref={(el) => {
          ref.current = el
          if (el && el.clientWidth && el.clientWidth !== w) setW(el.clientWidth)
        }}
        className="relative w-full overflow-hidden rounded-[18px] border-[0.5px] border-line bg-sunken"
        style={{ aspectRatio: String(aspect), cursor }}
        onClick={(e) => {
          if (!onClick) return
          const r = e.currentTarget.getBoundingClientRect()
          onClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        }}
      >
        {answer.drawing ? (
          <DrawingCanvas items={answer.drawing.items} W={answer.drawing.width} H={answer.drawing.height} pixelWidth={w} animate={!reducedMotion} />
        ) : answer.asset ? (
          <img src={ctx.assetUrl(answer.asset)} alt={answer.alt} draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center t-callout text-text3">{answer.alt}</div>
        )}
        {children}
      </div>
      {answer.credit && <figcaption className="mt-1.5 t-footnote text-text3">{answer.credit}</figcaption>}
    </figure>
  )
}

function Pin({ x, y, n, tone, active, onClick }: { x: number; y: number; n: number; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <motion.button
      type="button"
      tabIndex={onClick ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={spring.bouncy}
      className={cx('absolute grid h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[12px] font-bold tabular shadow-[var(--e2)]', active && 'ring-4 ring-accent-wash')}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: tone ?? (active ? 'var(--accent)' : 'var(--raised)'), color: tone || active ? 'var(--on-accent)' : 'var(--text)', borderColor: tone ?? (active ? 'var(--accent)' : 'var(--text)') }}
      data-pin={n - 1}
    >
      {n}
    </motion.button>
  )
}

export function LabelInput(props: LabelProps) {
  const mode = effectiveLabelMode(props.answer)
  if (mode === 'locate') return <LocateInput {...props} />
  if (mode === 'drag') return <DragLabelInput {...props} />
  return <TypeLabelInput {...props} bank={mode === 'bank'} />
}

const setLabel = (set: LabelProps['set'], i: number, v: string): void =>
  set((d) => {
    const labels = [...d.labels]
    while (labels.length <= i) labels.push('')
    labels[i] = v
    return { ...d, labels }
  })

function TypeLabelInput({ answer, draft, set, locked, reveal, result, ctx, onSubmit, exam, bank }: LabelProps & { bank: boolean }) {
  const { t } = useTranslation('study')
  const [focus, setFocus] = useState<number | null>(null)
  const tone = (i: number): string | undefined => (!exam && reveal !== 'none' ? partTone(result?.parts[i]) : undefined)
  return (
    <div className="flex flex-col gap-3">
      <Figure answer={answer} ctx={ctx}>
        {answer.spots.map((s, i) => <Pin key={i} x={s.x} y={s.y} n={i + 1} tone={tone(i)} active={focus === i} />)}
      </Figure>
      <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
        {answer.spots.map((s, i) => (
          <label key={i} className="flex items-center gap-2.5">
            <span className="inline-grid h-[26px] min-w-[26px] place-items-center rounded-full bg-fill2 text-[12px] font-bold tabular text-text2">{i + 1}</span>
            {bank ? (
              <div className="flex-1" onFocus={() => setFocus(i)}>
                <Select value={draft.labels[i] || null} placeholder={t('ex.label.choose')} options={answer.wordBank.map((w) => ({ value: w, label: w }))} onChange={(v) => !locked && setLabel(set, i, v)} />
              </div>
            ) : (
              <input
                value={draft.labels[i] ?? ''}
                readOnly={locked}
                placeholder={s.hint ?? t('ex.label.name')}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                onChange={(e) => setLabel(set, i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !locked) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                className="h-10 flex-1 rounded-[11px] border bg-field px-3 text-[15px] outline-none transition focus:shadow-[0_0_0_3px_var(--accent-wash)]"
                style={{ borderColor: tone(i) ?? 'color-mix(in oklab, var(--line-strong) 40%, transparent)' }}
              />
            )}
            {reveal === 'all' && !exam && result?.parts[i]?.status !== 'correct' && <span className="t-footnote text-success">{s.accepted[0]}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

function DragLabelInput({ answer, draft, set, locked, reveal, result, ctx, exerciseId, exam }: LabelProps) {
  const { t } = useTranslation('study')
  const [held, setHeld] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ word: string; x: number; y: number } | null>(null)
  const chips = useMemo(() => {
    const words = answer.wordBank.length ? answer.wordBank : answer.spots.map((s) => s.accepted[0] ?? '')
    return new SeededShuffler(exerciseId).shuffled(Array.from(new Set(words.filter(Boolean))))
  }, [answer, exerciseId])
  const used = new Set(draft.labels.filter(Boolean))
  const place = (i: number, word: string): void => {
    if (locked) return
    set((d) => {
      const labels = d.labels.map((l) => (l === word ? '' : l))
      while (labels.length <= i) labels.push('')
      labels[i] = word
      return { ...d, labels }
    })
    setHeld(null)
  }
  const startDrag = (word: string) => (e: React.PointerEvent) => {
    if (locked) return
    e.preventDefault()
    setHeld(word)
    setDrag({ word, x: e.clientX, y: e.clientY })
    const move = (ev: PointerEvent): void => setDrag({ word, x: ev.clientX, y: ev.clientY })
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      const pin = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-pin]') as HTMLElement | null
      if (pin?.dataset.pin !== undefined) place(Number(pin.dataset.pin), word)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const tone = (i: number): string | undefined => (!exam && reveal !== 'none' ? partTone(result?.parts[i]) : undefined)
  return (
    <div className="flex flex-col gap-3">
      <div className="t-ui text-text2">{t('ex.label.dragHelp')}</div>
      <Figure answer={answer} ctx={ctx}>
        {answer.spots.map((s, i) => (
          <div key={i}>
            <Pin x={s.x} y={s.y} n={i + 1} tone={tone(i)} active={!!held && !draft.labels[i]} onClick={held ? () => place(i, held) : draft.labels[i] && !locked ? () => setLabel(set, i, '') : undefined} />
            <AnimatePresence>
              {draft.labels[i] && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="pointer-events-none absolute -translate-y-1/2 whitespace-nowrap rounded-[8px] border-[0.5px] border-line bg-raised px-2 py-0.5 t-ui font-semibold shadow-[var(--e2)]"
                  style={{ left: `calc(${s.x * 100}% + 18px)`, top: `${s.y * 100}%`, color: tone(i) ?? 'var(--text)' }}
                >
                  {draft.labels[i]}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        ))}
      </Figure>
      <div className="flex flex-wrap justify-center gap-2">
        {chips.map((w) => (
          <button
            key={w}
            type="button"
            disabled={locked}
            onPointerDown={startDrag(w)}
            onClick={() => setHeld(held === w ? null : w)}
            className={cx('h-9 rounded-full border px-3.5 t-ui font-medium touch-none transition-[opacity,border-color,background-color]', held === w ? 'border-accent bg-accent-wash text-accent-text' : 'border-line bg-surface text-text', used.has(w) && 'opacity-40', !locked && 'cursor-grab')}
            style={{ boxShadow: 'var(--e1)' }}
          >
            {w}
          </button>
        ))}
      </div>
      {drag && (
        <div className="pointer-events-none fixed z-[120] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-raised px-3.5 py-1.5 t-ui font-semibold shadow-[var(--e3)]" style={{ left: drag.x, top: drag.y }}>
          {drag.word}
        </div>
      )}
      {reveal === 'all' && !exam && (
        <div className="t-footnote text-text2">{answer.spots.map((s, i) => `${i + 1}. ${s.accepted[0] ?? ''}`).join(' · ')}</div>
      )}
    </div>
  )
}

function LocateInput({ answer, draft, set, locked, reveal, result, ctx, exam }: LabelProps) {
  const { t } = useTranslation('study')
  const firstEmpty = draft.labels.findIndex((l) => !l)
  const [current, setCurrent] = useState(firstEmpty < 0 ? 0 : firstEmpty)
  const tone = (i: number): string | undefined => (!exam && reveal !== 'none' ? partTone(result?.parts[i]) : undefined)
  const name = (i: number): string => answer.spots[i]?.accepted[0] ?? ''
  return (
    <div className="flex flex-col gap-3">
      {!locked && (
        <div className="t-headline">
          {t('ex.label.locate')} <span className="text-accent-text"><RichText text={name(current)} inline /></span>
        </div>
      )}
      <Figure
        answer={answer}
        ctx={ctx}
        cursor={locked ? undefined : 'crosshair'}
        onClick={(x, y) => {
          if (locked) return
          setLabel(set, current, formatPoint(x, y))
          const next = draft.labels.findIndex((l, k) => !l && k !== current)
          if (next >= 0) setCurrent(next)
        }}
      >
        {draft.labels.map((l, i) => {
          const p = parsePoint(l)
          return p ? <Pin key={i} x={p.x} y={p.y} n={i + 1} tone={tone(i)} active={i === current && !locked} /> : null
        })}
        {reveal === 'all' && !exam &&
          answer.spots.map((s, i) =>
            result?.parts[i]?.status !== 'correct' ? (
              <span key={`ok${i}`} className="absolute h-[30px] w-[30px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-success" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }} />
            ) : null
          )}
      </Figure>
      {answer.spots.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {answer.spots.map((_, i) => (
            <button
              key={i}
              type="button"
              disabled={locked}
              onClick={() => setCurrent(i)}
              className={cx('inline-flex h-8 items-center gap-2 rounded-full border px-3 t-ui', i === current && !locked ? 'border-accent bg-accent-wash text-accent-text' : 'border-line bg-surface text-text2')}
              style={{ borderColor: tone(i) }}
            >
              <span className="tabular font-bold">{i + 1}</span>
              <RichText text={name(i)} inline />
              {draft.labels[i] && <span aria-hidden>·</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
