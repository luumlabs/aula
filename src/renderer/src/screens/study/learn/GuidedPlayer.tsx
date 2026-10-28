// «Aprender paso a paso» (port del modo guiado de LessonPlayer.swift y GuidedLessonModel): cada concepto empieza con su
// explicación; después se comprueba con preguntas independientes (dos aciertos a la primera, sin pistas, con preguntas
// distintas). Un fallo o una pista llevan a «Veámoslo de otra forma» (la explicación del error, la solución comprobada y
// otro ejemplo resuelto) y luego a una pregunta nueva. El resultado se queda a la vista hasta «Continuar».
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Block, Exercise, Skill, SkillProgress, StudyProgress } from '@shared/schema'
import {
  acknowledgeExplanation, completeLesson, continueWithoutChecks, isSkillMasteredGuided, learningOverview, lessonConcepts, prepareCheck, recordAttempt,
  recordAssistance, recordCheck, remediationBlocks, withSkillProgress, type LearningStep
} from '@engine/study'
import { BlockList } from '@renderer/blocks/BlockView'
import type { BlockContext } from '@renderer/blocks/types'
import { Button, cx, Icon, IconButton, Menu, Tooltip, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { ExerciseView, finalCredit, gradeLang, hintsUsed, inputSummary, elapsedSeconds, StatusWord, useExercise, type GradeResult, type RunState } from '@renderer/exercises'
import { isTypingTarget } from '@renderer/exercises/normalize'
import i18n from '@renderer/i18n'
import { StudyFrame, GlassCapsule, ProgressDots, TopCapsule, CapsuleDivider, type DotState } from '../Chrome'
import { updateProgress, useStudyStore, type CourseData, type SyncOp } from '../data'
import { gradeOpenWithAI } from '../ai'
import { askTutor, attemptOp, exerciseContext, recordTime, whyOf } from '../kit'
import { blocksSpeech, canSpeak, useSpeech } from '../speech'
import { PrepareMore } from './PrepareMore'
import { RemediationView } from './Remediation'

export interface LearnFinish {
  concepts: number
  unchecked: number
  answered: number
  correct: number
}

const page = { initial: { opacity: 0, x: 28 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -28 }, transition: { duration: 0.32, ease: [0.2, 0.7, 0.2, 1] as const } }

export function GuidedPlayer({ data, skill, ctx, ink, modeMenu, onExit, onFinish }: {
  data: CourseData
  skill: Skill
  ctx: BlockContext
  ink: string
  modeMenu: ReactNode
  onExit: () => void
  onFinish: (f: LearnFinish) => void
}) {
  const { t } = useTranslation('study')
  const { reducedMotion } = useTheme()
  const packId = data.pack.id
  const lang = gradeLang(i18n.language)
  const sp = data.progress.skills[skill.id]
  const concepts = useMemo(() => lessonConcepts(skill), [skill])
  const views = useMemo(() => learningOverview(skill, sp), [skill, sp])
  const firstOpen = views.findIndex((v) => !v.canAdvance)
  const reachable = firstOpen < 0 ? Math.max(0, views.length - 1) : firstOpen
  const [index, setIndex] = useState(reachable)
  const [assessment, setAssessment] = useState<Exercise | undefined>()
  const [holding, setHolding] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const [assisted, setAssisted] = useState(false)
  const [tally, setTally] = useState({ answered: 0, correct: 0 })
  const draftRef = useRef<unknown>(undefined)
  const speech = useSpeech()

  const concept = concepts[index]
  const view = views[index]
  const phase = view?.phase ?? 'needsPractice'
  const presented = holding && assessment ? 'check' : phase
  const isLast = index >= concepts.length - 1

  // MARK: Pasos del motor (cada uno devuelve el progreso nuevo de la habilidad)

  /**
   * Aplica un paso del motor a la copia local (y lo que lo acompañe: el intento) y lo manda al proceso principal: el
   * intento, el estado guiado de la habilidad y, si con esto se dominó la lección, que está terminada.
   */
  const apply = useCallback((fn: (s: SkillProgress | undefined, p: StudyProgress) => LearningStep, extra?: { change: (p: StudyProgress) => StudyProgress; op: SyncOp }): LearningStep | undefined => {
    let out: LearningStep | undefined
    const ops: SyncOp[] = extra ? [extra.op, { kind: 'learning', skillId: skill.id }] : [{ kind: 'learning', skillId: skill.id }]
    updateProgress(packId, (p) => {
      const step = fn(p.skills[skill.id], p)
      out = step
      let np = withSkillProgress(p, skill.id, step.progress)
      if (extra) np = extra.change(np)
      const s = np.skills[skill.id]
      if (isSkillMasteredGuided(skill, s) && !s?.lessonDone) {
        np = completeLesson(np, skill.id, new Date())
        ops.push({ kind: 'completeLesson', skillId: skill.id })
      }
      return np
    }, ops)
    return out
  }, [packId, skill])

  const freshPhase = (): string => {
    const s = useStudyStore.getState().courses[packId]?.progress.skills[skill.id]
    return learningOverview(skill, s)[index]?.phase ?? 'needsPractice'
  }

  // la pregunta que toca (también al volver: la misma sin responder)
  useEffect(() => {
    if (phase !== 'check' || assessment || holding || !concept) return
    const step = apply((s, p) => prepareCheck(concept, skill, s, { attempts: p.attempts, lang }))
    if (step?.exercise) {
      setAssessment(step.exercise)
      setRecorded(false)
      setAssisted(false)
    }
  }, [phase, assessment, holding, concept, skill, apply, lang])

  /** Lo escrito en la pregunta activa se guarda al cambiar de concepto o salir (vuelve igual al reabrir). */
  const persistDraft = useCallback(() => {
    if (!assessment || recorded || !concept || draftRef.current === undefined) return
    const snap = draftRef.current
    updateProgress(packId, (p) => {
      const s = p.skills[skill.id]
      const st = s?.learning[concept.id]
      if (!s || !st || st.activeExercise?.id !== assessment.id) return p
      return withSkillProgress(p, skill.id, { ...s, learning: { ...s.learning, [concept.id]: { ...st, activeInput: snap as never } } })
    }, { kind: 'learning', skillId: skill.id })
  }, [assessment, recorded, concept, packId, skill.id])
  const persistRef = useRef(persistDraft)
  persistRef.current = persistDraft
  useEffect(() => () => persistRef.current(), [])

  // tiempo de lectura (las preguntas ya guardan el suyo)
  const readingSince = useRef<number | null>(Date.now())
  useEffect(() => {
    if (presented === 'check') {
      if (readingSince.current) recordTime(packId, (Date.now() - readingSince.current) / 1000)
      readingSince.current = null
    } else if (!readingSince.current) readingSince.current = Date.now()
  }, [presented, packId])
  useEffect(() => () => {
    if (readingSince.current) recordTime(packId, (Date.now() - readingSince.current) / 1000)
  }, [packId])

  const reset = (): void => {
    setAssessment(undefined)
    setHolding(false)
    setRecorded(false)
    setAssisted(false)
    draftRef.current = undefined
  }

  const select = (i: number): void => {
    if (i < 0 || i >= concepts.length || i > reachable || i === index) return
    persistDraft()
    speech.stop()
    reset()
    setIndex(i)
    updateProgress(packId, (p) => withSkillProgress(p, skill.id, { ...(p.skills[skill.id] ?? ({ alpha: 1, beta: 1, attempts: 0, streak: 0, lessonStep: 0, lessonDone: false, learning: {} } as SkillProgress)), lessonStep: i }), { kind: 'learning', skillId: skill.id })
  }

  const finish = (): void => {
    const all = learningOverview(skill, useStudyStore.getState().courses[packId]?.progress.skills[skill.id])
    onFinish({ concepts: all.length, unchecked: all.filter((v) => v.unchecked).length, answered: tally.answered, correct: tally.correct })
  }

  const advance = (): void => {
    if (isLast) finish()
    else {
      reset()
      setIndex(index + 1)
    }
  }

  /** «Practicar esta idea» / «Probar otra pregunta»: tras leer, la primera pregunta (nueva). */
  const beginCheck = (): void => {
    if (!concept) return
    speech.stop()
    const step = apply((s, p) => acknowledgeExplanation(concept, skill, s, { attempts: p.attempts, lang }))
    reset()
    if (step?.exercise) setAssessment(step.exercise)
    // un concepto sin preguntas se supera leyéndolo
    if (step?.phase === 'mastered') advance()
  }

  const onFirstResult = (ex: Exercise) => (result: GradeResult, run: RunState): void => {
    if (!concept || recorded || result.status === 'invalid' || result.needsReview) return
    setRecorded(true)
    const hints = hintsUsed(run)
    const record = { credit: finalCredit(result, hints), hints, seconds: Math.round(elapsedSeconds(run)), mode: 'lesson' as const, input: inputSummary(ex.answer, run.draft), why: result.status === 'correct' ? undefined : whyOf(result) }
    apply(
      (s) => recordCheck(concept, skill, ex, result, { hints, revealed: run.revealed, firstAttempt: run.attempts <= 1, lang }, s),
      { change: (p) => recordAttempt(p, ex, record, new Date()), op: attemptOp(packId, ex, record, result) }
    )
    setTally((x) => ({ answered: x.answered + 1, correct: x.correct + (result.status === 'correct' && run.attempts <= 1 && hints === 0 ? 1 : 0) }))
    setHolding(true)
  }

  const onAssist = (ex: Exercise) => (run: RunState): void => {
    if (!concept || recorded) return
    const step = apply((s) => recordAssistance(concept, skill, ex, { hints: hintsUsed(run), revealed: run.revealed }, s))
    if (step && step.phase !== 'check') {
      setHolding(true)
      setAssisted(true)
    }
  }

  const continueUnchecked = (): void => {
    if (!concept) return
    const step = apply((s) => continueWithoutChecks(concept, skill, s))
    reset()
    if (step?.phase === 'mastered') advance()
  }

  /** «Continuar» con el resultado a la vista: lo que decidió el motor. */
  const release = (): void => {
    const ph = freshPhase()
    reset()
    if (ph === 'mastered') advance()
  }

  // MARK: Acción principal (barra de abajo)

  const primary: { label: string; run: () => void; disabled?: boolean } | null = (() => {
    if (holding) {
      const ph = freshPhase()
      const label = ph === 'check' ? t('learn.anotherCheck') : ph === 'reteach' ? t('learn.seeAnother') : ph === 'mastered' ? (isLast ? t('learn.finishLesson') : t('learn.nextConcept')) : t('learn.continue')
      return { label, run: release }
    }
    switch (phase) {
      case 'explanation': return { label: view?.checkKind === 'none' ? (isLast ? t('learn.finishLesson') : t('learn.continue')) : t('learn.practiceIdea'), run: beginCheck }
      case 'reteach': return { label: t('learn.tryAnother'), run: beginCheck }
      case 'mastered': return { label: isLast ? t('learn.finishLesson') : t('learn.nextConcept'), run: advance }
      default: return null
    }
  })()

  // ← → y espacio para moverse; ↩ sigue con el resultado a la vista
  const primaryRef = useRef(primary)
  primaryRef.current = primary
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement as HTMLElement | null)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        select(index - 1)
      } else if (e.key === 'ArrowRight' && view?.canAdvance && !holding) {
        e.preventDefault()
        if (index < reachable) select(index + 1)
        else primaryRef.current?.run()
      } else if ((e.key === 'Enter' && holding) || (e.key === ' ' && primaryRef.current && presented !== 'check')) {
        e.preventDefault()
        primaryRef.current?.run()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  })

  // MARK: Contenido

  const remediation: Block[] = useMemo(() => (phase === 'reteach' && concept ? remediationBlocks(concept, skill, sp, data.progress.attempts, lang) : []), [phase, concept, skill, sp, data.progress.attempts, lang])
  const checkpoints = (concept?.checkpointBlocks ?? []).filter((b) => b.type === 'predict' || b.type === 'spot')
  const snapshot = assessment && concept && sp?.learning[concept.id]?.activeExercise?.id === assessment.id ? sp.learning[concept.id].activeInput : undefined

  const states: DotState[] = views.map((v, i) => (v.unchecked ? 'warn' : v.canAdvance ? 'done' : i > reachable ? 'locked' : 'todo'))
  const lead = assisted ? t('learn.assistedLead') : (view?.required ?? 2) <= 1 ? t('learn.openLead') : t('learn.checkLead', { n: view?.successes ?? 0, m: view?.required ?? 2 })

  const conceptsMenu = (
    <Menu
      align="end"
      trigger={(open) => (
        <Tooltip label={t('learn.contents')} side="bottom">
          <IconButton label={t('learn.contents')} size="sm" onClick={open} className="rounded-full!">
            <Icon name="checklist" size={15} />
          </IconButton>
        </Tooltip>
      )}
      items={views.map((v, i) => ({
        label: (
          <span className="flex min-w-0 max-w-[340px] items-center gap-2">
            <span className="w-5 shrink-0 text-right tabular text-text3">{i + 1}</span>
            <span className={cx('truncate', i === index && 'text-accent-text')}><RichText text={v.title} inline /></span>
          </span>
        ),
        icon: v.unchecked ? <Icon name="alert" size={13} className="text-warning" /> : v.canAdvance ? <Icon name="check" size={13} className="text-success" /> : i > reachable ? <Icon name="lock" size={13} className="text-text3" /> : undefined,
        disabled: i > reachable,
        onSelect: () => select(i)
      }))}
    />
  )

  const capsule = (
    <TopCapsule
      icon="learn"
      label={<RichText text={skill.title} inline />}
      onExit={onExit}
      trailing={
        <>
          {canSpeak() && (
            <Tooltip label={speech.speaking ? t('learn.stopReading') : t('learn.readAloud')} side="bottom">
              <IconButton
                label={speech.speaking ? t('learn.stopReading') : t('learn.readAloud')}
                size="sm"
                active={speech.speaking}
                className="rounded-full!"
                onClick={() => (speech.speaking ? speech.stop() : speech.speak(blocksSpeech(presented === 'reteach' ? remediation : concept?.teachingBlocks ?? []), data.pack.language))}
              >
                <Icon name="audio" size={15} />
              </IconButton>
            </Tooltip>
          )}
          {conceptsMenu}
          {modeMenu}
        </>
      }
    >
      <ProgressDots states={states} current={index} ink={ink} onPick={select} />
      <span className="t-ui tabular text-text2 whitespace-nowrap">{t('learn.conceptOf', { n: index + 1, m: concepts.length })}</span>
    </TopCapsule>
  )

  const bottom = (
    <GlassCapsule>
      <Tooltip label={t('learn.prev')}>
        <IconButton label={t('learn.prev')} disabled={index === 0} onClick={() => select(index - 1)} className="rounded-full!">
          <Icon name="chevron-left" size={16} />
        </IconButton>
      </Tooltip>
      {presented === 'check' && !holding && <span className="px-2 t-ui text-text2">{t('learn.answerToGo')}</span>}
      {presented === 'needsPractice' && <span className="px-2 t-ui text-text2">{t('learn.noQuestions')}</span>}
      {primary && (
        <>
          <CapsuleDivider />
          <Button variant="primary" size="md" className="rounded-full! px-4" onClick={primary.run} disabled={primary.disabled}>
            {primary.label}
          </Button>
        </>
      )}
    </GlassCapsule>
  )

  if (!concept)
    return (
      <StudyFrame capsule={capsule} onExit={onExit}>
        <div className="t-body text-text2">{t('learn.empty')}</div>
      </StudyFrame>
    )

  return (
    <StudyFrame capsule={capsule} bottom={bottom} onExit={onExit} scrollKey={`${index}-${presented}-${assessment?.id ?? ''}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${index}-${presented === 'check' ? `check-${assessment?.id ?? ''}` : presented}`} {...(reducedMotion ? {} : page)} className="flex flex-col gap-7">
          {presented === 'check' && (
            <>
              <header className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="t-title1">{t('learn.checkTitle')}</h2>
                  <SuccessPips have={view.successes} need={view.required} ink={ink} />
                </div>
                <p className="t-callout text-text2">{lead}</p>
              </header>
              {assessment && (
                <div className="mx-auto w-full max-w-[720px]">
                  <GuidedCheck
                    key={assessment.id}
                    exercise={assessment}
                    ctx={ctx}
                    snapshot={snapshot}
                    onDraft={(s) => (draftRef.current = s)}
                    onFirstResult={onFirstResult(assessment)}
                    onAssist={onAssist(assessment)}
                    packId={packId}
                  />
                </div>
              )}
              {holding && freshPhase() === 'mastered' && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex w-full max-w-[720px] flex-wrap items-baseline gap-2">
                  <StatusWord tone="success" icon="check-circle">{t('learn.conceptChecked')}</StatusWord>
                  <span className="t-callout text-text2">{(view.required ?? 2) <= 1 ? t('learn.masteredOpen') : t('learn.masteredN', { count: view.required })}</span>
                </motion.div>
              )}
            </>
          )}
          {presented === 'reteach' && (
            <>
              <header className="mx-auto flex w-full max-w-[720px] flex-col gap-1">
                <h2 className="t-title1">{t('learn.reteachTitle')}</h2>
                <p className="t-callout text-text2">{t('learn.reteachLead')}</p>
              </header>
              <RemediationView blocks={remediation} ctx={ctx} />
            </>
          )}
          {presented === 'needsPractice' && (
            <>
              <header className="mx-auto flex w-full max-w-[720px] flex-col gap-3">
                <div>
                  <h2 className="t-title1">{t('learn.exhaustedTitle')}</h2>
                  <p className="t-callout text-text2 mt-1">{view.checkKind === 'selfAssessed' ? t('learn.exhaustedOpen') : t('learn.exhausted')}</p>
                </div>
                <PrepareMore packId={packId} skillId={skill.id} conceptId={concept.id} focus={concept.title} onPrepared={beginCheck} onContinueUnchecked={continueUnchecked} />
              </header>
              <BlockList blocks={concept.teachingBlocks} ctx={ctx} />
            </>
          )}
          {presented === 'mastered' && (
            <>
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-1">
                {view.unchecked ? (
                  <>
                    <StatusWord tone="warning" icon="alert">{t('learn.unchecked')}</StatusWord>
                    <span className="t-callout text-text2">{t('learn.uncheckedBody')}</span>
                  </>
                ) : (
                  <>
                    <StatusWord tone="success" icon="check-circle">{t('learn.conceptChecked')}</StatusWord>
                    <span className="t-callout text-text2">{view.checkKind === 'none' ? t('learn.masteredReading') : view.required <= 1 ? t('learn.masteredOpen') : t('learn.masteredN', { count: view.required })}</span>
                  </>
                )}
              </div>
              <BlockList blocks={concept.teachingBlocks} ctx={ctx} />
            </>
          )}
          {presented === 'explanation' && <BlockList blocks={[...concept.teachingBlocks, ...checkpoints]} ctx={ctx} />}
        </motion.div>
      </AnimatePresence>
    </StudyFrame>
  )
}

/** Aciertos por tu cuenta: cuadraditos pixel-art que se llenan con la tinta del curso. */
function SuccessPips({ have, need, ink }: { have: number; need: number; ink: string }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: need }, (_, i) => (
        <motion.span
          key={`${i}-${i < have}`}
          className="block h-3 w-3 rounded-[2px]"
          initial={i < have ? { scale: 0.2 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 14 }}
          style={{ background: i < have ? ink : 'var(--fill3)', boxShadow: i < have ? `0 0 0 3px color-mix(in oklab, ${ink} 18%, transparent)` : undefined }}
        />
      ))}
    </span>
  )
}

/** La comprobación: un solo intento; las pistas avisan de que la pregunta deja de contar. */
function GuidedCheck({ exercise, ctx, snapshot, onDraft, onFirstResult, onAssist, packId }: {
  exercise: Exercise
  ctx: BlockContext
  snapshot: unknown
  onDraft: (s: unknown) => void
  onFirstResult: (r: GradeResult, run: RunState) => void
  onAssist: (run: RunState) => void
  packId: string
}) {
  const { t } = useTranslation('study')
  const c = useExercise(exercise, { mode: 'guided', snapshot, onDraft, onFirstResult, onAssist, exactText: ctx.exactText, gradeOpen: (e, text) => gradeOpenWithAI(packId, e, text) })
  return (
    <ExerciseView
      controller={c}
      ctx={ctx}
      onAskTutor={() => {
        onAssist(c.run)
        askTutor(t('learn.tutorPrompt'), exerciseContext(packId, exercise, c.run, 'lesson'))
      }}
    />
  )
}
