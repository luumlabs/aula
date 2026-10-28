// Ordenar: se arrastran las tarjetas (con su asa) o, con el teclado, espacio para tomar una y ↑ ↓ para moverla
// (también ⌥↑ ⌥↓ sin tomarla). Tras comprobar, cada posición en verde o rojo.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Reorder, useDragControls } from 'motion/react'
import type { AnswerOf } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { cx, Icon, spring } from '@renderer/design'
import { moveItem } from '../normalize'
import type { InputProps } from './shared'

export function OrderingInput({ answer, draft, set, locked, reveal, exam }: InputProps<AnswerOf<'ordering'>>) {
  const { t } = useTranslation('study')
  const [grabbed, setGrabbed] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const refs = useRef(new Map<string, HTMLLIElement>())

  const reorder = (order: string[]): void => {
    if (!locked) set((d) => ({ ...d, order, orderTouched: true }))
  }
  const move = (item: string, delta: number): void => {
    const from = draft.order.indexOf(item)
    const to = Math.max(0, Math.min(draft.order.length - 1, from + delta))
    if (from < 0 || from === to) return
    reorder(moveItem(draft.order, from, to))
    setAnnounce(t('ex.order.moved', { pos: to + 1, total: draft.order.length }))
    requestAnimationFrame(() => refs.current.get(item)?.focus())
  }

  const tone = (item: string, i: number): string | undefined => {
    if (exam || reveal === 'none') return undefined
    const ok = answer.items[i] === item
    if (reveal === 'mistakesOnly') return ok ? undefined : 'var(--danger)'
    return ok ? 'var(--success)' : 'var(--danger)'
  }

  return (
    <div>
      <div className="t-ui text-text2 mb-2">{draft.orderTouched ? t('ex.order.help') : t('ex.order.start')}</div>
      <Reorder.Group axis="y" values={draft.order} onReorder={reorder} className="flex flex-col gap-2" aria-label={t('ex.order.label')}>
        {draft.order.map((item, i) => (
          <OrderItem
            key={item}
            item={item}
            index={i}
            total={draft.order.length}
            locked={locked}
            grabbed={grabbed === item}
            tone={tone(item, i)}
            correctIndex={reveal === 'all' && !exam ? answer.items.indexOf(item) : undefined}
            refFn={(el) => (el ? refs.current.set(item, el) : refs.current.delete(item))}
            onKey={(e) => {
              if (locked) return
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                setGrabbed((g) => (g === item ? null : item))
                setAnnounce(grabbed === item ? t('ex.order.dropped') : t('ex.order.grabbed'))
              } else if (e.key === 'ArrowUp' && (e.altKey || grabbed === item)) {
                e.preventDefault()
                move(item, -1)
              } else if (e.key === 'ArrowDown' && (e.altKey || grabbed === item)) {
                e.preventDefault()
                move(item, 1)
              } else if (e.key === 'Escape') setGrabbed(null)
            }}
            onMove={(d) => move(item, d)}
            labels={{ up: t('ex.order.up'), down: t('ex.order.down'), handle: t('ex.order.handle') }}
          />
        ))}
      </Reorder.Group>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  )
}

function OrderItem({ item, index, total, locked, grabbed, tone, correctIndex, refFn, onKey, onMove, labels }: {
  item: string
  index: number
  total: number
  locked: boolean
  grabbed: boolean
  tone?: string
  correctIndex?: number
  refFn: (el: HTMLLIElement | null) => void
  onKey: (e: React.KeyboardEvent) => void
  onMove: (delta: number) => void
  labels: { up: string; down: string; handle: string }
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={item}
      ref={refFn}
      dragListener={false}
      dragControls={controls}
      transition={spring.snappy}
      whileDrag={{ scale: 1.02, boxShadow: 'var(--e3)', zIndex: 5 }}
      tabIndex={locked ? -1 : 0}
      onKeyDown={onKey}
      aria-roledescription="sortable"
      aria-label={`${index + 1}`}
      className={cx(
        'group relative flex items-center gap-3 rounded-[16px] border bg-surface px-3 py-3 outline-none transition-[border-color,background-color]',
        'focus-visible:ring-2 focus-visible:ring-accent-line',
        grabbed && 'ring-2 ring-accent'
      )}
      style={{ boxShadow: 'var(--e1)', borderColor: tone ? `color-mix(in oklab, ${tone} 55%, transparent)` : 'var(--line)', background: tone ? `color-mix(in oklab, ${tone} 8%, var(--surface))` : undefined }}
    >
      <span
        aria-label={labels.handle}
        onPointerDown={(e) => !locked && controls.start(e)}
        className={cx('grid h-8 w-6 shrink-0 place-items-center rounded-[8px] text-text3 touch-none', !locked && 'cursor-grab hover:bg-fill1 hover:text-text active:cursor-grabbing')}
      >
        <Icon name="grip" size={16} />
      </span>
      <span className="inline-grid h-[26px] min-w-[26px] place-items-center rounded-[8px] bg-fill2 text-[13px] font-semibold tabular text-text2">{index + 1}</span>
      <span className="min-w-0 flex-1 t-body text-text">
        <RichText text={item} inline />
        {correctIndex !== undefined && correctIndex !== index && <span className="ml-2 t-footnote text-success">→ {correctIndex + 1}</span>}
      </span>
      {!locked && (
        <span className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <button type="button" tabIndex={-1} aria-label={labels.up} disabled={index === 0} onClick={() => onMove(-1)} className="grid h-4 w-6 place-items-center text-text3 hover:text-text disabled:opacity-30">
            <Icon name="chevron-up" size={12} />
          </button>
          <button type="button" tabIndex={-1} aria-label={labels.down} disabled={index === total - 1} onClick={() => onMove(1)} className="grid h-4 w-6 place-items-center text-text3 hover:text-text disabled:opacity-30">
            <Icon name="chevron-down" size={12} />
          </button>
        </span>
      )}
    </Reorder.Item>
  )
}
