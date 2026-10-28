// Completar huecos: el texto con «[[1]]», «[[2]]»… y un campo en línea en cada hueco que crece con lo que se escribe.
// Tras comprobar, cada hueco con el color de su resultado.
import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnswerOf } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { cx } from '@renderer/design'
import { blankWidth } from '../normalize'
import { partTone, type InputProps } from './shared'

/** Trozos del texto: texto y huecos (índice desde 0). */
export function clozeSegments(text: string): ({ kind: 'text'; text: string } | { kind: 'blank'; index: number })[] {
  const out: ({ kind: 'text'; text: string } | { kind: 'blank'; index: number })[] = []
  let last = 0
  for (const m of text.matchAll(/\[\[(\d+)\]\]/g)) {
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    out.push({ kind: 'blank', index: Number(m[1]) - 1 })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

export function ClozeInput({ answer, draft, set, locked, reveal, result, onSubmit, autoFocus, exam, source }: InputProps<AnswerOf<'cloze'>> & { source: string }) {
  const { t } = useTranslation('study')
  const first = useRef<HTMLInputElement>(null)
  const text = answer.text || source
  const segments = clozeSegments(text)
  useEffect(() => {
    // al volver a intentarlo, el primer hueco queda seleccionado: lo que escribas lo sustituye
    if (autoFocus && !locked) requestAnimationFrame(() => { first.current?.focus({ preventScroll: true }); first.current?.select() })
  }, [autoFocus, locked])
  const setBlank = (i: number, v: string): void => set((d) => {
    const blanks = [...d.blanks]
    while (blanks.length <= i) blanks.push('')
    blanks[i] = v
    return { ...d, blanks }
  })
  let firstSeen = false
  return (
    <div className="t-reading text-text leading-[2.3]">
      {segments.map((s, k) => {
        if (s.kind === 'text') return <RichText key={k} text={s.text} inline />
        const i = s.index
        const value = draft.blanks[i] ?? ''
        const hint = answer.blanks[i]?.hint
        const tone = !exam && reveal !== 'none' ? partTone(result?.parts[i]) : undefined
        const isFirst = !firstSeen
        firstSeen = true
        return (
          <Fragment key={k}>
            <input
              ref={isFirst ? first : undefined}
              value={value}
              readOnly={locked}
              aria-label={t('ex.blank', { n: i + 1 })}
              placeholder={hint ?? `${i + 1}`}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setBlank(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !locked) {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              style={{ width: `calc(${blankWidth(value, hint ?? '')}ch + 22px)`, borderColor: tone, background: tone ? `color-mix(in oklab, ${tone} 8%, transparent)` : undefined }}
              className={cx(
                'mx-1 inline-block h-[34px] rounded-[9px] border-[1.5px] border-dashed border-line-strong/50 bg-field px-2 text-center font-sans text-[16px] align-baseline text-text outline-none transition placeholder:text-text3',
                'focus:border-solid focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-wash)]',
                tone && 'border-solid',
                locked && 'cursor-default'
              )}
            />
            {reveal === 'all' && !exam && result?.parts[i] && result.parts[i].status !== 'correct' && answer.blanks[i]?.accepted[0] && (
              <span className="mr-1 t-callout text-success">({answer.blanks[i].accepted[0]})</span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
