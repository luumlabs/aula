// Relacionar: dos columnas y líneas que las unen. Se arrastra desde el punto de un elemento de la izquierda hasta uno de la
// derecha, o se pulsa uno y luego el otro (también con el teclado). Cada pareja lleva el número de su elemento de la
// izquierda; tras comprobar, las líneas en verde o rojo.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { AnswerOf } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { cx } from '@renderer/design'
import { rightsOrder } from '../model'
import type { InputProps } from './shared'

interface Pt { x: number; y: number }

export function MatchingInput({ answer, draft, set, locked, reveal, exerciseId, exam }: InputProps<AnswerOf<'matching'>>) {
  const { t } = useTranslation('study')
  const lefts = useMemo(() => answer.pairs.map((p) => p.left), [answer])
  const rights = useMemo(() => rightsOrder(exerciseId, answer), [exerciseId, answer])
  const box = useRef<HTMLDivElement>(null)
  const leftEls = useRef(new Map<string, HTMLElement>())
  const rightEls = useRef(new Map<string, HTMLElement>())
  const [anchors, setAnchors] = useState<{ l: Record<string, Pt>; r: Record<string, Pt> }>({ l: {}, r: {} })
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ left: string; to: Pt } | null>(null)
  const matches = draft.matches

  const measure = useCallback(() => {
    const c = box.current?.getBoundingClientRect()
    if (!c) return
    const l: Record<string, Pt> = {}
    const r: Record<string, Pt> = {}
    leftEls.current.forEach((el, k) => {
      const b = el.getBoundingClientRect()
      l[k] = { x: b.right - c.left, y: b.top + b.height / 2 - c.top }
    })
    rightEls.current.forEach((el, k) => {
      const b = el.getBoundingClientRect()
      r[k] = { x: b.left - c.left, y: b.top + b.height / 2 - c.top }
    })
    setAnchors({ l, r })
  }, [])

  useLayoutEffect(measure, [measure, matches, reveal])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const pair = (left: string, right: string): void => {
    if (locked) return
    set((d) => {
      const m = { ...d.matches }
      if (m[left] === right) {
        delete m[left]
        return { ...d, matches: m }
      }
      for (const k of Object.keys(m)) if (m[k] === right) delete m[k]
      m[left] = right
      return { ...d, matches: m }
    })
  }

  const pairOk = (left: string): boolean => answer.pairs.find((p) => p.left === left)?.right === matches[left]
  const lineColor = (left: string): string => {
    if (!exam && reveal !== 'none') {
      if (pairOk(left)) return reveal === 'all' ? 'var(--success)' : 'var(--text3)'
      return 'var(--danger)'
    }
    return selected === left ? 'var(--accent)' : 'color-mix(in oklab, var(--text2) 70%, transparent)'
  }
  const leftOf = (right: string): string | undefined => Object.keys(matches).find((k) => matches[k] === right)

  const onPointerDown = (left: string) => (e: React.PointerEvent) => {
    if (locked) return
    e.preventDefault()
    const c = box.current!.getBoundingClientRect()
    setSelected(left)
    setDrag({ left, to: { x: e.clientX - c.left, y: e.clientY - c.top } })
    const moveFn = (ev: PointerEvent): void => setDrag({ left, to: { x: ev.clientX - c.left, y: ev.clientY - c.top } })
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', moveFn)
      window.removeEventListener('pointerup', up)
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-right]') as HTMLElement | null
      const right = target?.dataset.right
      if (right !== undefined) {
        pair(left, right)
        setSelected(null)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', moveFn)
    window.addEventListener('pointerup', up)
  }

  const curve = (a: Pt, b: Pt): string => {
    const dx = Math.max(24, (b.x - a.x) * 0.5)
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
  }

  return (
    <div>
      <div className="t-ui text-text2 mb-2.5">{t('ex.match.help')}</div>
      <div ref={box} className="relative flex items-start select-none">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {lefts.map((l, i) => {
            const paired = matches[l] !== undefined
            const wrong = !exam && reveal !== 'none' && paired && !pairOk(l)
            const missing = !exam && reveal === 'all' && !pairOk(l)
            return (
              <button
                key={l}
                type="button"
                ref={(el) => {
                  if (el) leftEls.current.set(l, el)
                  else leftEls.current.delete(l)
                }}
                aria-pressed={selected === l}
                onClick={() => !locked && setSelected(selected === l ? null : l)}
                className={cx(
                  'relative flex min-h-[48px] items-center gap-2.5 rounded-[14px] border bg-surface py-2.5 pl-3 pr-5 text-left outline-none transition-[border-color,box-shadow]',
                  'focus-visible:ring-2 focus-visible:ring-accent-line',
                  selected === l ? 'border-accent shadow-[0_0_0_3px_var(--accent-wash)]' : 'border-line'
                )}
                style={{ boxShadow: selected === l ? undefined : 'var(--e1)', borderColor: wrong ? 'color-mix(in oklab, var(--danger) 55%, transparent)' : undefined }}
              >
                <span className={cx('inline-grid h-[22px] min-w-[22px] place-items-center rounded-[7px] text-[12px] font-semibold tabular', paired ? 'bg-text text-paper' : 'bg-fill2 text-text2')}>{i + 1}</span>
                <span className="min-w-0 flex-1 t-body">
                  <RichText text={l} inline />
                  {missing && <span className="mt-0.5 block t-footnote text-success">→ <RichText text={answer.pairs[i].right} inline /></span>}
                </span>
                <span
                  aria-hidden
                  onPointerDown={onPointerDown(l)}
                  className={cx('absolute -right-[7px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full border-2 bg-surface touch-none', !locked && 'cursor-crosshair')}
                  style={{ borderColor: paired || selected === l ? lineColor(l) : 'var(--line-strong)' }}
                />
              </button>
            )
          })}
        </div>
        <div className="w-14 shrink-0 @lg:w-24" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {rights.map((r) => {
            const from = leftOf(r)
            return (
              <button
                key={r}
                type="button"
                data-right={r}
                ref={(el) => {
                  if (el) rightEls.current.set(r, el)
                  else rightEls.current.delete(r)
                }}
                onClick={() => {
                  if (locked) return
                  if (selected) {
                    pair(selected, r)
                    setSelected(null)
                  } else if (from) setSelected(from)
                }}
                className={cx(
                  'relative flex min-h-[48px] items-center gap-2.5 rounded-[14px] border border-line bg-surface py-2.5 pl-5 pr-3 text-left outline-none transition-[border-color,background-color]',
                  'focus-visible:ring-2 focus-visible:ring-accent-line',
                  selected && !locked && 'hover:border-accent-line hover:bg-accent-wash'
                )}
                style={{ boxShadow: 'var(--e1)' }}
              >
                <span aria-hidden className="absolute -left-[7px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 rounded-full border-2 bg-surface" style={{ borderColor: from ? lineColor(from) : 'var(--line-strong)' }} />
                <span className="min-w-0 flex-1 t-body"><RichText text={r} inline /></span>
                {from && <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-[7px] bg-text text-[12px] font-semibold tabular text-paper">{lefts.indexOf(from) + 1}</span>}
              </button>
            )
          })}
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {Object.entries(matches).map(([l, r]) => {
            const a = anchors.l[l], b = anchors.r[r]
            if (!a || !b) return null
            return <motion.path key={`${l}→${r}`} d={curve(a, b)} fill="none" stroke={lineColor(l)} strokeWidth={2} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }} />
          })}
          {drag && anchors.l[drag.left] && <path d={curve(anchors.l[drag.left], drag.to)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />}
        </svg>
      </div>
    </div>
  )
}
