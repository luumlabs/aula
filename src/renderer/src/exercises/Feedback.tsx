// Lo que pasa al comprobar (port de ExerciseFeedback.swift): el resultado en una palabra con su icono (la marca de acierto
// se dibuja píxel a píxel), el diagnóstico, la explicación del error con una raya fina de su color, las pistas, la
// solución paso a paso y «Otra forma de verlo».
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Block } from '@shared/schema/blocks'
import type { Exercise } from '@shared/schema/exercises'
import { StaticBlocks } from './Blocks'
import type { BlockContext } from '@renderer/blocks/types'
import { RichText } from '@renderer/lib/RichText'
import { fmtPercent } from '@renderer/lib/format'
import { Button, cx, Icon, PixelCheck } from '@renderer/design'
import type { GradeResult } from './types'
import { StatusWord, ToneRule } from './ui'

const reveal = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1] as const } }

export function toneOf(r: GradeResult): string {
  return r.status === 'correct' ? 'var(--success)' : r.status === 'partial' ? 'var(--warning)' : 'var(--danger)'
}

const pct = (x: number): string => fmtPercent(x)

/** Resultado de la comprobación, sin caja de color. */
export function FeedbackPanel({ exercise, result, revealed, stale, hints, attempts, onAskTutor, checkRef, children }: {
  exercise: Exercise
  result: GradeResult
  revealed: boolean
  stale: boolean
  hints: number
  attempts: number
  onAskTutor?: () => void
  checkRef?: (el: HTMLSpanElement | null) => void
  children?: ReactNode
}) {
  const { t } = useTranslation('study')
  const [steps, setSteps] = useState(false)
  const ok = result.status === 'correct'
  const tone = toneOf(result)
  const inline = exercise.answer.kind === 'choice' ? new Set(exercise.answer.options.map((o) => o.why).filter(Boolean)) : new Set<string>()
  const explanation = result.feedback.filter((f) => f.kind !== 'praise' && f.markdown.trim() && !inline.has(f.markdown))
  const seen = new Set<string>()
  const diagnosis = result.diagnosis.map((d) => t(`diag.${d}`, { defaultValue: '' })).filter((x) => x && !seen.has(x) && (seen.add(x), true))
  if (result.matchedWrong) diagnosis.push(t('ex.typical'))
  const effort: string[] = []
  if (ok && hints > 0) effort.push(t('ex.withHints', { count: hints }))
  if (ok && attempts > 1) effort.push(t('ex.attempts', { count: attempts }))
  const title = ok ? t('ex.correct') : result.status === 'partial' ? t('ex.partial', { pct: pct(result.credit) }) : revealed ? t('ex.notThat') : t('ex.notYet')

  return (
    <motion.div {...reveal} className={cx('flex flex-col gap-2', stale && 'opacity-60 saturate-0')} aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {ok ? (
          <span className="inline-flex items-center gap-2 t-headline" style={{ color: tone }}>
            <span ref={checkRef} className="inline-grid h-5 w-5 place-items-center">
              <PixelCheck size={18} />
            </span>
            {title}
          </span>
        ) : (
          <StatusWord tone={result.status === 'partial' ? 'warning' : 'danger'} icon={result.status === 'partial' ? 'alert' : 'alert-circle'}>
            {title}
          </StatusWord>
        )}
        {!ok && diagnosis.length > 0 && <span className="t-ui text-text2">· {diagnosis.join(' · ')}</span>}
        {effort.length > 0 && <span className="ml-auto t-ui text-text3">{effort.join(' · ')}</span>}
      </div>
      {(explanation.length > 0 || (ok && steps)) && (
        <ToneRule color={tone} className="ml-[26px] flex flex-col gap-1.5">
          {explanation.map((l, i) => (
            <div key={i} className="t-body text-text">
              <RichText text={l.markdown} />
            </div>
          ))}
          <AnimatePresence initial={false}>
            {ok && steps && exercise.solution.length > 0 && (
              <motion.div key="steps" {...reveal}>
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        </ToneRule>
      )}
      {((!ok && !revealed && onAskTutor) || (ok && exercise.solution.length > 0)) && (
        <div className="ml-[26px] flex flex-wrap gap-1.5 pt-0.5">
          {!ok && !revealed && onAskTutor && (
            <Button size="sm" variant="secondary" icon={<Icon name="tutor" size={14} />} onClick={onAskTutor}>
              {t('ex.explainMine')}
            </Button>
          )}
          {ok && exercise.solution.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSteps((v) => !v)}>
              {steps ? t('ex.hideSteps') : t('ex.showSteps')}
            </Button>
          )}
        </div>
      )}
      {stale && <div className="ml-[26px] t-footnote text-text2">{t('ex.stale')}</div>}
    </motion.div>
  )
}

/** «No pude leer tu respuesta» (un problema de formato), separado del error típico que reconoció el autor. */
export function InvalidNotice({ result }: { result: GradeResult }) {
  const { t } = useTranslation('study')
  const typical = result.matchedWrong?.why?.trim()
  const format = result.feedback.find((f) => f.markdown && f.markdown !== typical && (f.kind === 'warning' || f.kind === 'error' || f.kind === 'info'))?.markdown
  return (
    <motion.div {...reveal} className="flex flex-col gap-2">
      {typical && (
        <div className="flex gap-2.5 rounded-[14px] bg-fill1 px-4 py-3">
          <Icon name="lightbulb" size={16} className="mt-0.5 shrink-0 text-text2" />
          <div className="min-w-0">
            <div className="t-ui font-semibold text-text2">{t('ex.invalid.typical')}</div>
            <div className="t-callout"><RichText text={typical} /></div>
          </div>
        </div>
      )}
      {(format || !typical) && (
        <div className="flex gap-2.5 rounded-[14px] bg-warning-soft px-4 py-3">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <div className="t-ui font-semibold" style={{ color: 'var(--warning)' }}>{t('ex.invalid.title')}</div>
            <div className="t-callout text-text"><RichText text={format || t('ex.invalid.body')} /></div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/** Resultado de una parte (a, b, c…). */
export function PartFeedback({ result }: { result: GradeResult }) {
  const { t } = useTranslation('study')
  const ok = result.status === 'correct', partial = result.status === 'partial'
  return (
    <ToneRule color={toneOf(result)} className="flex flex-col gap-1">
      {ok ? (
        <StatusWord tone="success" icon="check-circle" className="t-callout! font-semibold">{t('ex.part.good')}</StatusWord>
      ) : partial ? (
        <StatusWord tone="warning" icon="alert" className="t-callout! font-semibold">{t('ex.part.almost')}</StatusWord>
      ) : (
        <StatusWord tone="danger" icon="alert-circle" className="t-callout! font-semibold">{t('ex.part.check')}</StatusWord>
      )}
      {result.feedback.filter((f) => f.kind !== 'praise' && f.markdown).map((l, i) => (
        <div key={i} className="t-callout"><RichText text={l.markdown} /></div>
      ))}
    </ToneRule>
  )
}

/** Pistas progresivas, numeradas («Pista 1 de 3»). La bombilla sin color de aviso: una pista no es un error. */
export function HintList({ hints, shown }: { hints: string[]; shown: number }) {
  const { t } = useTranslation('study')
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {hints.slice(0, shown).map((h, i) => (
          <motion.div key={i} {...reveal} className="flex gap-2.5 rounded-[14px] bg-fill1 px-4 py-3">
            <Icon name="lightbulb" size={16} className="mt-0.5 shrink-0 text-text2" />
            <div className="min-w-0">
              <div className="t-ui font-semibold text-text2">{hints.length > 1 ? t('ex.hintOf', { n: i + 1, total: hints.length }) : t('ex.hint')}</div>
              <div className="t-body text-text"><RichText text={h} /></div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** La respuesta correcta, la solución paso a paso y, si hay, otra forma de verlo. */
export function SolutionPanel({ exercise, answerMd, ctx, alternate, onAskTutor }: { exercise: Exercise; answerMd: string; ctx: BlockContext; alternate?: Block[]; onAskTutor?: () => void }) {
  const { t } = useTranslation('study')
  const [other, setOther] = useState(false)
  const altBlocks = alternate ?? []
  return (
    <motion.div {...reveal} className="flex flex-col gap-3 rounded-[18px] bg-sunken p-5">
      <div className="flex items-center gap-2 t-ui font-semibold text-text2">
        <Icon name="book" size={15} />
        {t('ex.solution')}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="t-headline text-text2">{t('ex.answer')}</span>
        <span className="t-reading text-text"><RichText text={answerMd} inline /></span>
      </div>
      {exercise.solution.length > 0 && (
        <div className="border-t-[0.5px] border-line pt-3">
          <StaticBlocks blocks={exercise.solution} ctx={{ ...ctx, mode: 'chat' }} />
        </div>
      )}
      {(altBlocks.length > 0 || onAskTutor) && (
        <div className="border-t-[0.5px] border-line pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {altBlocks.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Icon name={other ? 'chevron-up' : 'lightbulb'} size={14} />} onClick={() => setOther((v) => !v)}>
                {t('ex.otherWay')}
              </Button>
            )}
            {onAskTutor && (
              <Button size="sm" variant="ghost" icon={<Icon name="tutor" size={14} />} onClick={onAskTutor}>
                {t('ex.askAnother')}
              </Button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {other && altBlocks.length > 0 && (
              <motion.div key="alt" {...reveal} className="mt-3">
                <StaticBlocks blocks={altBlocks} ctx={{ ...ctx, mode: 'chat' }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}
