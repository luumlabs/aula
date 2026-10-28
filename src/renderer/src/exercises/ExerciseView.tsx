// Un ejercicio completo (port de ExerciseView.swift): cabecera (nivel · puntos), enunciado con bloques, el control de
// respuesta de su tipo, pistas que se abren una a una, comprobación con animación (acierto: la marca se dibuja píxel a
// píxel, una ráfaga discreta y un velo verde; fallo: una sacudida suave y la explicación del error), solución paso a paso
// y «Otra forma de verlo». En el simulacro no hay pistas ni corrección: solo se responde.
//
// Teclado: ↩ comprueba / intenta de nuevo / sigue; en opciones, A–Z o 1–9 eligen; en verdadero o falso, 1/2.
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useAnimate } from 'motion/react'
import type { Block } from '@shared/schema/blocks'
import type { Answer, AnswerPart } from '@shared/schema/exercises'
import { StaticBlocks } from './Blocks'
import type { BlockContext } from '@renderer/blocks/types'
import { RichText } from '@renderer/lib/RichText'
import { Button, cx, Icon, pixelBurst, Tooltip, useTheme } from '@renderer/design'
import { correctAnswer } from './grading'
import { partExercise } from './model'
import { FeedbackPanel, HintList, InvalidNotice, PartFeedback, SolutionPanel } from './Feedback'
import { ChoiceInput } from './inputs/ChoiceInput'
import { TrueFalseInput } from './inputs/TrueFalseInput'
import { TextAnswerInput } from './inputs/TextAnswerInput'
import { ClozeInput } from './inputs/ClozeInput'
import { OrderingInput } from './inputs/OrderingInput'
import { MatchingInput } from './inputs/MatchingInput'
import { LabelInput } from './inputs/LabelInput'
import { GradedRubric, OpenInput, SelfReviewPanel } from './inputs/OpenInput'
import { useKeys, type InputProps, type RevealLevel } from './inputs/shared'
import type { ExerciseController } from './useExercise'
import type { GradeResult } from './types'
import { KeyCap } from './ui'

/** Texto con huecos «[[n]]» cuando el ejercicio de completar los trae en el enunciado. */
function clozeSource(prompt: Block[]): string {
  return prompt.flatMap((b) => (b.type === 'text' && b.md.includes('[[') ? [b.md] : [])).join('\n')
}
function promptBlocks(prompt: Block[], answer: Answer): Block[] {
  if (answer.kind !== 'cloze' || answer.text) return prompt
  return prompt.filter((b) => !(b.type === 'text' && b.md.includes('[[')))
}

/** El control de respuesta de cada tipo (los de varias partes los dibuja `ExerciseView`). */
export function AnswerArea(props: InputProps & { prompt: Block[] }) {
  const { answer, prompt, ...rest } = props
  switch (answer.kind) {
    case 'choice': return <ChoiceInput answer={answer} {...rest} />
    case 'truefalse': return <TrueFalseInput answer={answer} {...rest} />
    case 'cloze': return <ClozeInput answer={answer} source={clozeSource(prompt)} {...rest} />
    case 'ordering': return <OrderingInput answer={answer} {...rest} />
    case 'matching': return <MatchingInput answer={answer} {...rest} />
    case 'label': return <LabelInput answer={answer} {...rest} />
    case 'open': return <OpenInput answer={answer} {...rest} />
    case 'multi': return null
    default: return <TextAnswerInput answer={answer} {...rest} />
  }
}

export interface ExerciseViewProps {
  controller: ExerciseController
  ctx: BlockContext
  skillTitle?: string
  /** Texto del botón para seguir («Siguiente», «Continuar»…). */
  continueLabel?: string
  /** 'none': las acciones las dibuja otro (la barra flotante de la práctica). */
  actions?: 'inline' | 'none'
  /** Atajos de teclado activos (solo el ejercicio a la vista). */
  active?: boolean
  autoFocus?: boolean
  /** Otra forma de verlo (un ejemplo resuelto distinto del mismo concepto). */
  alternate?: Block[]
  onAskTutor?: () => void
  /** Sin la tarjeta (dentro de otra superficie). */
  bare?: boolean
  /** Número de la pregunta (simulacro). */
  number?: number
  /** Simulacro: ↩ en un campo pasa a la pregunta siguiente. */
  onExamReturn?: () => void
  /** Simulacro con el tiempo agotado: ya no se puede cambiar. */
  locked?: boolean
  className?: string
}

const LEVEL = ['ex.level1', 'ex.level2', 'ex.level3'] as const

export function ExerciseView({ controller: c, ctx, skillTitle, continueLabel, actions = 'inline', active = true, autoFocus = true, alternate, onAskTutor, bare, number, onExamReturn, locked, className }: ExerciseViewProps) {
  const { t, i18n } = useTranslation('study')
  const { reducedMotion } = useTheme()
  const ex = c.exercise
  const exam = c.mode === 'exam'
  const r = c.run.result
  const level: RevealLevel = exam ? 'none' : c.finished ? 'all' : c.checked ? 'mistakesOnly' : 'none'
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const checkEl = useRef<HTMLSpanElement | null>(null)
  const prompt = useMemo(() => promptBlocks(ex.prompt, ex.answer), [ex])
  const answerMd = useMemo(() => (c.finished && !exam ? correctAnswer(ex, i18n.language) : ''), [c.finished, exam, ex, i18n.language])

  // fallo: una sacudida suave del área de respuesta
  useEffect(() => {
    if (!c.run.errorPulse || reducedMotion || !scope.current) return
    void animate(scope.current, { x: [0, -7, 7, -5, 5, -2, 0] }, { duration: 0.42, ease: 'easeOut' })
  }, [c.run.errorPulse, reducedMotion, animate, scope])
  // acierto: ráfaga discreta desde la marca
  useEffect(() => {
    if (!c.run.successPulse) return
    const id = requestAnimationFrame(() => {
      if (checkEl.current) pixelBurst(checkEl.current, { count: 10, colors: ['var(--success)', 'var(--sun)', '#ffe2a8', 'var(--success)'] })
    })
    return () => cancelAnimationFrame(id)
  }, [c.run.successPulse])

  // ↩ fuera de un campo: lo que diga el botón principal
  useKeys(active && !exam, (e) => {
    if (e.key !== 'Enter') return
    c.primary()
    return true
  })

  const common = (answer: Answer, draft = c.run.draft, set = c.edit, result: GradeResult | undefined = r, id = ex.id): InputProps => ({
    answer, draft, set, locked: !!locked || c.finished || c.run.grading, reveal: level, result, exerciseId: id, lang: ctx.language, ctx, onSubmit: exam ? (onExamReturn ?? (() => {})) : c.primary, autoFocus: autoFocus && !c.finished && !locked, active: active && !locked, exam
  })

  const header = (
    <div className="flex items-center gap-2 t-ui text-text2">
      {number !== undefined && <span className="font-semibold text-text">{t('exam.question', { n: number })}</span>}
      {number !== undefined && <span className="text-text3">·</span>}
      <span className="font-medium">{t(LEVEL[Math.min(3, Math.max(1, ex.level)) - 1])}</span>
      {skillTitle && (
        <>
          <span className="text-text3">·</span>
          <span className="truncate"><RichText text={skillTitle} inline /></span>
        </>
      )}
      {(exam || ex.points !== 1) && (
        <>
          <span className="text-text3">·</span>
          <span className="tabular">{t('ex.points', { count: ex.points })}</span>
        </>
      )}
      <span className="flex-1" />
      {ex.review && ex.review.state !== 'flagged' && !exam && (
        <Tooltip label={t('ex.verified')}>
          <Icon name="check-circle" size={15} className="text-text3" />
        </Tooltip>
      )}
    </div>
  )

  const body = (
    <div className={cx('@container relative flex flex-col gap-5', className)}>
      {header}
      {prompt.length > 0 && (
        <div className="exercise-prompt">
          <StaticBlocks blocks={prompt} ctx={ctx} />
        </div>
      )}
      <div ref={scope}>
        {ex.answer.kind === 'multi' ? (
          <div className="flex flex-col">
            {ex.answer.parts.map((p, i) => (
              <PartRow key={i} index={i} part={p} c={c} common={common} exam={exam} />
            ))}
          </div>
        ) : (
          <AnswerArea {...common(ex.answer)} prompt={ex.prompt} />
        )}
      </div>
      {!exam && (
        <>
          {c.run.grading && (
            <div className="flex items-center gap-2 t-callout text-text2">
              <Icon name="tutor" size={16} />
              {t('ex.grading')}
            </div>
          )}
          {c.selfReview && (ex.answer.kind === 'open' || ex.answer.kind === 'short') && <SelfReviewPanel answer={ex.answer} onGrade={c.selfGrade} />}
          {c.run.hintsShown > 0 && ex.hints.length > 0 && <HintList hints={ex.hints} shown={c.run.hintsShown} />}
          <AnimatePresence initial={false} mode="popLayout">
            {r && r.status === 'invalid' && !c.stale && !c.run.revealed && <InvalidNotice key={`inv-${c.run.attempts}`} result={r} />}
            {r && r.status !== 'invalid' && !c.selfReview && (
              <FeedbackPanel
                key={`fb-${c.run.attempts}-${r.status}`}
                exercise={ex}
                result={r}
                revealed={c.run.revealed}
                stale={c.stale}
                hints={c.run.hintsShown}
                attempts={c.run.attempts}
                onAskTutor={onAskTutor}
                checkRef={(el) => (checkEl.current = el)}
              >
                <StaticBlocks blocks={ex.solution} ctx={{ ...ctx, mode: 'chat' }} />
              </FeedbackPanel>
            )}
          </AnimatePresence>
          {r && <GradedRubric result={r} />}
          <AnimatePresence initial={false}>
            {c.run.revealed && r?.status !== 'correct' && !c.selfReview && (
              <SolutionPanel key="sol" exercise={ex} answerMd={answerMd} ctx={ctx} alternate={alternate} onAskTutor={onAskTutor} />
            )}
          </AnimatePresence>
          {actions === 'inline' && <ExerciseActions controller={c} continueLabel={continueLabel} />}
        </>
      )}
    </div>
  )

  if (bare) return body
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-[22px] border-[0.5px] border-line bg-surface p-6 @container" style={{ boxShadow: 'var(--e1)' }}>
        <AnimatePresence>
          {c.run.successPulse > 0 && !reducedMotion && (
            <motion.div
              key={c.run.successPulse}
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-success-soft"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.35] }}
              transition={{ duration: 1.2, times: [0, 0.25, 1], ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
        {body}
      </div>
    </div>
  )
}

function PartRow({ index, part, c, common, exam }: { index: number; part: AnswerPart; c: ExerciseController; common: (a: Answer, d?: ExerciseController['run']['draft'], set?: ExerciseController['edit'], r?: GradeResult, id?: string) => InputProps; exam: boolean }) {
  const { t } = useTranslation('study')
  const ex = partExercise(c.exercise, part)
  const draft = c.run.draft.parts[index]
  const pr = c.run.result?.parts[index]
  const hints = c.run.partHints[index] ?? 0
  if (!draft) return null
  return (
    <div className={cx('flex gap-3', index > 0 && 'mt-5 border-t-[0.5px] border-line pt-5')}>
      <span className="t-reading min-w-[26px] text-text2">{part.label || index + 1})</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {part.prompt.length > 0 && <StaticBlocks blocks={part.prompt} ctx={common(part.answer).ctx} className="gap-3" />}
        <AnswerArea {...common(part.answer, draft, (fn) => c.editPart(index, fn), pr, ex.id)} autoFocus={index === 0 && !c.finished} prompt={part.prompt} />
        {!exam && pr && pr.status !== 'invalid' && (c.checked || c.finished) && <PartFeedback result={pr} />}
        {!exam && !c.finished && hints > 0 && <HintList hints={part.hints} shown={hints} />}
        {!exam && !c.finished && hints < part.hints.length && (
          <div>
            <Button size="sm" variant="ghost" icon={<Icon name="lightbulb" size={14} />} onClick={() => c.partHint(index)}>
              {t('ex.partHint')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Las acciones del ejercicio: pista · «No lo sé» / «Ver la solución» · «Saltar» … y la principal (la única en ladrillo). */
export function ExerciseActions({ controller: c, continueLabel, variant = 'inline' }: { controller: ExerciseController; continueLabel?: string; variant?: 'inline' | 'bar' }) {
  const { t } = useTranslation('study')
  const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  if (c.mode === 'exam' || (c.finished && (c.run.continued || !c.hasContinue))) return null
  const guided = c.mode === 'guided'
  const secondary = (
    <>
      {c.canHint && (
        <Tooltip label={guided ? t('ex.hintGuided') : t('ex.hintCost')}>
          <Button variant={variant === 'bar' ? 'ghost' : 'secondary'} size={variant === 'bar' ? 'md' : 'lg'} icon={<Icon name="lightbulb" size={15} />} onClick={c.hint}>
            {c.run.hintsShown === 0 ? t('ex.hint') : t('ex.otherHint')}
            {c.exercise.hints.length > 1 && <span className="ml-1 tabular text-text3">{c.run.hintsShown}/{c.exercise.hints.length}</span>}
          </Button>
        </Tooltip>
      )}
      {c.canSayDontKnow && (
        <Tooltip label={t('ex.dontKnowHelp')}>
          <Button variant="ghost" size={variant === 'bar' ? 'md' : 'lg'} onClick={c.reveal}>{t('ex.dontKnow')}</Button>
        </Tooltip>
      )}
      {c.checkedWrong && (
        <>
          <Button variant={variant === 'bar' ? 'ghost' : 'secondary'} size={variant === 'bar' ? 'md' : 'lg'} onClick={c.reveal}>{t('ex.seeSolution')}</Button>
          {c.hasContinue && (
            <Tooltip label={t('ex.skipHelp')}>
              <Button variant="ghost" size={variant === 'bar' ? 'md' : 'lg'} onClick={c.continueNow}>{t('ex.skip')}</Button>
            </Tooltip>
          )}
        </>
      )}
    </>
  )
  let primary: React.ReactNode = null
  if (c.finished) {
    if (c.hasContinue)
      primary = (
        <Button variant="primary" size={variant === 'bar' ? 'md' : 'lg'} onClick={c.continueNow} iconRight={<KeyCap className="bg-white/20! text-on-accent!">↩</KeyCap>}>
          {continueLabel ?? t('ex.continue')}
        </Button>
      )
  } else if (c.selfReview) {
    primary = null
  } else if (c.checkedWrong) {
    primary = (
      <Button variant="primary" size={variant === 'bar' ? 'md' : 'lg'} onClick={c.retry} iconRight={<KeyCap className="bg-white/20! text-on-accent!">↩</KeyCap>}>
        {t('ex.tryAgain')}
      </Button>
    )
  } else {
    primary = (
      <Button variant="primary" size={variant === 'bar' ? 'md' : 'lg'} disabled={!c.canCheck} loading={c.run.grading} onClick={c.submit} iconRight={<KeyCap className="bg-white/20! text-on-accent!">{c.multiline ? (mac ? '⌘↩' : 'Ctrl ↩') : '↩'}</KeyCap>}>
        {t('ex.check')}
      </Button>
    )
  }
  if (variant === 'bar')
    return (
      <div className="flex items-center gap-1">
        {secondary}
        {primary && <span className="mx-1 h-5 w-[0.5px] bg-line" aria-hidden />}
        {primary}
      </div>
    )
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {secondary}
      <span className="flex-1" />
      {primary}
    </div>
  )
}
