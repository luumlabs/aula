// Respuesta abierta: un texto que crece, con el recuento de palabras (y su límite). La corrige Aula con la rúbrica si hay
// IA; si no, el estudiante se autoevalúa con la respuesta modelo y marcando lo que cumplió de la rúbrica.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { AnswerOf } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { Button, cx, Icon } from '@renderer/design'
import { wordCount } from '../normalize'
import type { GradeResult } from '../types'
import { KeyCap } from '../ui'
import type { InputProps } from './shared'

export function OpenInput({ answer, draft, set, locked, autoFocus, onSubmit }: InputProps<AnswerOf<'open'>>) {
  const { t } = useTranslation('study')
  const ref = useRef<HTMLTextAreaElement>(null)
  const words = wordCount(draft.text)
  const over = answer.maxWords !== undefined && words > answer.maxWords
  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 140), 520)}px`
  }
  useEffect(grow, [draft.text])
  useEffect(() => {
    if (autoFocus && !locked) requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
  }, [autoFocus, locked])
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={draft.text}
        readOnly={locked}
        aria-label={t('ex.yourAnswer')}
        placeholder={t('ex.ph.open')}
        onChange={(e) => set((d) => ({ ...d, text: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit()
          }
        }}
        className={cx(
          'min-h-[140px] w-full resize-none rounded-[16px] border bg-field px-4 py-3.5 font-serif text-[17px] leading-[27px] text-text outline-none transition placeholder:text-text3',
          'focus:shadow-[0_0_0_3px_var(--accent-wash)]',
          over ? 'border-warning' : 'border-line-strong/40'
        )}
      />
      <div className="flex items-center justify-between t-footnote text-text3 px-1">
        <span className={cx('tabular', over && 'text-warning')}>{answer.maxWords ? t('ex.open.wordsOf', { count: words, max: answer.maxWords }) : t('ex.open.words', { count: words })}</span>
        {!locked && (
          <span className="inline-flex items-center gap-1">
            <KeyCap>{mac ? '⌘' : 'Ctrl'}</KeyCap>
            <KeyCap>↩</KeyCap>
            <span className="ml-1">{t('ex.open.toCheck')}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/** Autoevaluación: la respuesta modelo y la rúbrica para marcar lo que se cumplió (sin rúbrica: Bien · A medias · Mal). */
export function SelfReviewPanel({ answer, onGrade }: { answer: AnswerOf<'open'> | AnswerOf<'short'>; onGrade: (credit: number) => void }) {
  const { t } = useTranslation('study')
  const rubric = answer.kind === 'open' ? answer.rubric : []
  const model = answer.kind === 'open' ? answer.modelAnswer : answer.accepted[0] ?? ''
  const [met, setMet] = useState<boolean[]>(() => rubric.map(() => false))
  const total = rubric.reduce((a, r) => a + r.points, 0)
  const got = rubric.reduce((a, r, i) => a + (met[i] ? r.points : 0), 0)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 rounded-[18px] bg-sunken p-5">
      <div>
        <div className="t-ui font-semibold text-text2">{t('ex.self.title')}</div>
        <div className="t-callout text-text2 mt-0.5">{t('ex.self.lead')}</div>
      </div>
      {model && (
        <div>
          <div className="t-eyebrow mb-1.5">{t('ex.self.model')}</div>
          <div className="t-reading text-text"><RichText text={model} /></div>
        </div>
      )}
      {rubric.length > 0 ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="t-eyebrow mb-0.5">{t('ex.self.rubric')}</div>
            {rubric.map((r, i) => (
              <button
                key={i}
                type="button"
                role="checkbox"
                aria-checked={met[i]}
                onClick={() => setMet((m) => m.map((x, k) => (k === i ? !x : x)))}
                className={cx('flex items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors', met[i] ? 'bg-success-soft' : 'bg-surface hover:bg-fill1')}
              >
                <span className={cx('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px]', met[i] ? 'border-success bg-success text-white dark:text-black' : 'border-line-strong')}>
                  {met[i] && <Icon name="check" size={11} />}
                </span>
                <span className="min-w-0 flex-1 t-callout"><RichText text={r.text} inline /></span>
                <span className="t-footnote tabular text-text3">{t('ex.points', { count: r.points })}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="t-callout text-text2 tabular">{t('ex.self.score', { got, total })}</span>
            <Button variant="primary" size="lg" onClick={() => onGrade(total > 0 ? got / total : 0)}>{t('ex.self.grade')}</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-callout text-text2 mr-1">{t('ex.self.how')}</span>
          <Button variant="secondary" onClick={() => onGrade(1)} icon={<Icon name="check" size={14} />}>{t('ex.self.good')}</Button>
          <Button variant="secondary" onClick={() => onGrade(0.5)}>{t('ex.self.half')}</Button>
          <Button variant="secondary" onClick={() => onGrade(0)}>{t('ex.self.bad')}</Button>
        </div>
      )}
    </motion.div>
  )
}

/** La rúbrica que calificó Aula, criterio por criterio, con lo que faltó. */
export function GradedRubric({ result }: { result: GradeResult }) {
  const { t } = useTranslation('study')
  const review = result.review
  if (!review?.criteria.length) return null
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-sunken p-5">
      <div className="t-eyebrow">{t('ex.ai.title')}</div>
      {review.criteria.map((c, i) => {
        const full = c.points >= c.max - 1e-9
        return (
          <div key={i} className="flex items-start gap-2.5 t-callout">
            <Icon name={full ? 'check-circle' : c.points > 0 ? 'alert' : 'alert-circle'} size={16} className={cx('mt-0.5 shrink-0', full ? 'text-success' : c.points > 0 ? 'text-warning' : 'text-text3')} />
            <span className="min-w-0 flex-1">
              <RichText text={c.text} inline />
              {c.comment && <span className="block t-footnote text-text2"><RichText text={c.comment} inline /></span>}
            </span>
            <span className="t-footnote tabular text-text2">{t('ex.ai.points', { got: c.points, max: c.max })}</span>
          </div>
        )
      })}
      {review.missing.length > 0 && (
        <div className="t-callout text-text2 border-t-[0.5px] border-line pt-2">
          <span className="font-semibold">{t('ex.ai.missing')}</span> <RichText text={review.missing.join(' · ')} inline />
        </div>
      )}
    </div>
  )
}
