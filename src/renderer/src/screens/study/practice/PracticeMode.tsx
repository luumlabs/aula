// Práctica: una sesión de 10 ejercicios adaptativa e intercalada (el siguiente se elige con el dominio ya actualizado:
// si fallas, baja; si aciertas, sube hacia el nivel examen). La racha de aciertos a la primera enciende la llamita; las
// acciones flotan abajo en una cápsula. Al terminar, el resumen con lo que subió el dominio y repetir los fallados.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Block, Exercise } from '@shared/schema'
import { buildPractice, refillPractice, skillMastery, type PracticeRequest } from '@engine/study'
import { AnimatedNumber, Button, EmptyState, Icon, PixelFlame, Tooltip, cx, pixelBurst, useTheme } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtPercent } from '@renderer/lib/format'
import { isDemo } from '@renderer/lib/demo'
import { navigate } from '@renderer/app/router'
import { ExerciseActions, ExerciseView, useExercise, type GradeResult, type RunState } from '@renderer/exercises'
import { CapsuleProgress, GlassCapsule, StudyFrame, TopCapsule } from '../Chrome'
import { updateProgress, useStudyStore, type CourseData } from '../data'
import { askTutor, exerciseContext, exitTo, recordResult, useBlockCtx, useInk } from '../kit'
import { gradeOpenWithAI } from '../ai'
import { SessionSummary } from '../Summary'
import { GALLERY_SKILL, galleryExercises } from './gallery'

interface Outcome {
  exercise: Exercise
  result: GradeResult
  hints: number
  firstTry: boolean
}

/** Otra forma de verlo: un ejemplo resuelto de la lección del tema (distinto del enunciado). */
export function alternateFor(data: CourseData, ex: Exercise): Block[] | undefined {
  const lesson = data.skills.find((s) => s.id === ex.skill)?.lesson ?? []
  const prompt = ex.prompt.map((b) => (b.type === 'text' ? b.md : '')).join(' ')
  const examples = lesson.filter((b): b is Extract<Block, { type: 'example' }> => b.type === 'example' && b.steps.length > 0 && b.problem.trim() !== prompt.trim())
  return examples.length ? [examples[examples.length - 1]] : undefined
}

/** Diagnóstico inicial (el primer paso del plan de un curso sin datos). */
export const DIAGNOSTIC_SKILL = '__diagnostic'

export interface SessionOptions {
  /** Cómo se anota el intento (práctica, repaso de errores o diagnóstico). */
  attemptMode?: 'practice' | 'review' | 'diagnostic'
  /** Pestaña del curso a la que se vuelve. */
  exitTab?: 'practice' | 'mistakes' | 'exam'
  /** Lo que va encima del ejercicio (en el repaso de errores: lo que escribiste la otra vez). */
  before?: (ex: Exercise) => React.ReactNode
  icon?: 'practice' | 'mistakes'
}

export function PracticeMode({ data, skillId, initial, title, options = {} }: { data: CourseData; skillId?: string; initial?: Exercise[]; title?: React.ReactNode; options?: SessionOptions }) {
  const { t } = useTranslation('study')
  const packId = data.pack.id
  const gallery = skillId === GALLERY_SKILL && isDemo()
  const diagnostic = skillId === DIAGNOSTIC_SKILL
  const request: PracticeRequest = diagnostic ? { kind: 'diagnostic' } : skillId && !gallery ? { kind: 'skill', skillId } : { kind: 'weakest' }
  if (diagnostic) options = { ...options, attemptMode: 'diagnostic' }
  const [round, setRound] = useState<{ queue: Exercise[]; key: number }>(() => ({ key: 0, queue: initial ?? (gallery ? galleryExercises(data.skills[0]?.id ?? GALLERY_SKILL) : buildSafe()) }))
  const before = useRef(masteryBySkill())
  const onExit = (): void => exitTo(packId, options.exitTab ?? 'practice')
  const skillName = skillId && !gallery && !diagnostic ? data.skills.find((s) => s.id === skillId)?.title : undefined

  function buildSafe(): Exercise[] {
    try {
      return buildPractice(data.pack, data.skills, data.progress, request, { count: 10, now: new Date() })
    } catch (e) {
      console.warn('[aula] práctica:', e)
      return []
    }
  }
  function masteryBySkill(): Record<string, number> {
    const now = new Date()
    return Object.fromEntries(data.skills.map((s) => [s.id, skillMastery(data.progress.skills[s.id], now) ?? 0]))
  }

  const label = title ?? (skillName ? <RichText text={skillName} inline /> : gallery ? t('practice.gallery') : diagnostic ? t('practice.diagnostic') : t('practice.mixed'))

  if (!round.queue.length)
    return (
      <StudyFrame capsule={<TopCapsule icon={options.icon ?? 'practice'} label={label} onExit={onExit} />} onExit={onExit}>
        <EmptyState title={t('practice.emptyTitle')} body={t('practice.emptyBody')} action={<Button onClick={onExit}>{t('common.backToCourse')}</Button>} />
      </StudyFrame>
    )

  return (
    <PracticeSession
      key={round.key}
      data={data}
      queue0={round.queue}
      request={gallery || initial ? undefined : request}
      label={label}
      onExit={onExit}
      masteryBefore={before.current}
      options={options}
      onAgain={(queue) => {
        before.current = masteryBySkill()
        setRound((r) => ({ key: r.key + 1, queue: queue ?? buildSafe() }))
      }}
    />
  )
}

function PracticeSession({ data, queue0, request, label, onExit, masteryBefore, onAgain, options }: {
  data: CourseData
  queue0: Exercise[]
  request?: PracticeRequest
  label: React.ReactNode
  onExit: () => void
  masteryBefore: Record<string, number>
  onAgain: (queue?: Exercise[]) => void
  options: SessionOptions
}) {
  const { t } = useTranslation('study')
  const packId = data.pack.id
  const [queue, setQueue] = useState(queue0)
  const [index, setIndex] = useState(0)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(0)
  const [finished, setFinished] = useState(false)
  const flame = useRef<HTMLSpanElement>(null)

  const ex = queue[index]
  const onFirstResult = (r: GradeResult, run: RunState): void => {
    recordResult(packId, ex, r, run, options.attemptMode ?? 'practice')
    const firstTry = r.status === 'correct' && run.attempts <= 1 && run.hintsShown === 0 && !run.revealed
    setOutcomes((o) => [...o, { exercise: ex, result: r, hints: run.hintsShown, firstTry }])
    const s = firstTry ? streak + 1 : 0
    setStreak(s)
    setBest((b) => Math.max(b, s))
    if (firstTry && s >= 3 && flame.current) pixelBurst(flame.current, { count: 10 })
    // sesión adaptativa: el siguiente con el dominio ya actualizado
    if (request && index + 1 < queue.length) {
      try {
        const fresh = useStudyStore.getState().courses[packId]?.progress ?? data.progress
        const next = refillPractice(index + 1, queue, data.pack, data.skills, fresh, request, { now: new Date() })
        if (next) setQueue((q) => q.map((e, i) => (i === index + 1 ? next : e)))
      } catch {
        /* se queda el que había */
      }
    }
  }
  const onContinue = (): void => {
    if (index + 1 >= queue.length) setFinished(true)
    else setIndex(index + 1)
  }

  if (finished) return <PracticeSummary data={data} outcomes={outcomes} best={best} label={label} onExit={onExit} masteryBefore={masteryBefore} onAgain={onAgain} options={options} />

  return (
    <PracticeExercise
      key={`${index}-${ex.id}`}
      data={data}
      exercise={ex}
      index={index}
      total={queue.length}
      label={label}
      streak={streak}
      flameRef={flame}
      onExit={onExit}
      onFirstResult={onFirstResult}
      onContinue={onContinue}
      options={options}
    />
  )
}

function PracticeExercise({ data, exercise, index, total, label, streak, flameRef, onExit, onFirstResult, onContinue, options }: {
  data: CourseData
  exercise: Exercise
  index: number
  total: number
  label: React.ReactNode
  streak: number
  flameRef: React.RefObject<HTMLSpanElement | null>
  onExit: () => void
  onFirstResult: (r: GradeResult, run: RunState) => void
  onContinue: () => void
  options: SessionOptions
}) {
  const { t } = useTranslation('study')
  const ctx = useBlockCtx(data.pack, exercise.skill)
  const c = useExercise(exercise, { mode: options.attemptMode === 'review' ? 'review' : 'practice', onFirstResult, onContinue, exactText: ctx.exactText, gradeOpen: (e, text) => gradeOpenWithAI(data.pack.id, e, text) })
  const skill = data.skills.find((s) => s.id === exercise.skill)
  const alternate = useMemo(() => alternateFor(data, exercise), [data, exercise])
  const last = index + 1 >= total
  return (
    <StudyFrame
      onExit={onExit}
      scrollKey={index}
      capsule={
        <TopCapsule icon={options.icon ?? 'practice'} label={label} onExit={onExit} trailing={<StreakBadge streak={streak} flameRef={flameRef} />}>
          <CapsuleProgress value={index + (c.finished ? 1 : 0)} total={total} label={t('common.nOfM', { n: index + 1, m: total })} />
        </TopCapsule>
      }
      bottom={
        <GlassCapsule className="px-2">
          <ExerciseActions controller={c} variant="bar" continueLabel={last ? t('practice.seeResults') : t('practice.next')} />
        </GlassCapsule>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={exercise.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}>
          {options.before?.(exercise)}
          <ExerciseView
            controller={c}
            ctx={ctx}
            actions="none"
            skillTitle={skill?.title}
            alternate={alternate}
            onAskTutor={() => askTutor(t('practice.tutorPrompt'), exerciseContext(data.pack.id, exercise, c.run, 'practice'))}
          />
        </motion.div>
      </AnimatePresence>
    </StudyFrame>
  )
}

/** Racha de aciertos a la primera: la llamita se enciende a partir de 2. */
function StreakBadge({ streak, flameRef }: { streak: number; flameRef: React.RefObject<HTMLSpanElement | null> }) {
  const { t } = useTranslation('study')
  const { reducedMotion } = useTheme()
  return (
    <Tooltip label={t('practice.streakHelp')} side="bottom">
      <span ref={flameRef} className={cx('flex h-7 items-center gap-1 rounded-full px-2', streak >= 2 ? 'text-accent-text' : 'text-text3')}>
        <PixelFlame size={14} lit={streak >= 2} />
        <motion.span key={streak} className="pt-[3px] font-serif text-[17px] leading-none tabular" initial={reducedMotion ? false : { y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          {streak}
        </motion.span>
      </span>
    </Tooltip>
  )
}

function PracticeSummary({ data, outcomes, best, label, onExit, masteryBefore, onAgain, options }: {
  data: CourseData
  outcomes: Outcome[]
  best: number
  label: React.ReactNode
  onExit: () => void
  masteryBefore: Record<string, number>
  onAgain: (queue?: Exercise[]) => void
  options: SessionOptions
}) {
  const { t } = useTranslation('study')
  const ink = useInk(data.pack)
  const review = options.attemptMode === 'review'
  useEffect(() => {
    if (options.attemptMode === 'diagnostic' && outcomes.length && !data.progress.diagnosticDone) updateProgress(data.pack.id, (p) => ({ ...p, diagnosticDone: true }), { kind: 'save' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const progress = useStudyStore((s) => s.courses[data.pack.id]?.progress) ?? data.progress
  const answered = outcomes.length
  const first = outcomes.filter((o) => o.firstTry).length
  const missed = outcomes.filter((o) => o.result.status !== 'correct' || o.hints > 0).map((o) => o.exercise)
  const hints = outcomes.reduce((a, o) => a + o.hints, 0)
  const now = new Date()
  const skillIds = [...new Set(outcomes.map((o) => o.exercise.skill))].filter((id) => data.skills.some((s) => s.id === id))
  const changes = skillIds.map((id) => ({ id, title: data.skills.find((s) => s.id === id)?.title ?? id, before: masteryBefore[id] ?? 0, after: skillMastery(progress.skills[id], now) ?? 0 }))
  return (
    <StudyFrame capsule={<TopCapsule icon={options.icon ?? 'practice'} label={label} onExit={onExit} />} onExit={onExit}>
      <SessionSummary
          packId={data.pack.id}
        medal={answered > 0 && first / Math.max(1, answered) >= 0.6}
        icon={answered > 0 && first / Math.max(1, answered) < 0.6 ? <PixelFlame size={56} lit={best >= 2} /> : undefined}
        title={answered ? (review ? t('mistakes.doneTitle') : t('practice.doneTitle')) : t('practice.noAnswersTitle')}
        body={answered ? (review ? (missed.length ? t('mistakes.doneMissed') : t('mistakes.doneClean')) : missed.length ? t('practice.doneMissed') : t('practice.doneClean')) : t('practice.noAnswersBody')}
        stats={answered ? [
          { value: first, text: t('common.aOfB', { a: first, b: answered }), label: t('practice.statFirstTry') },
          { value: best, label: t('practice.statBest') },
          { value: hints, label: t('practice.statHints', { count: hints }) },
          { value: missed.length, label: t('practice.statSaved', { count: missed.length }) }
        ] : undefined}
        actions={
          <>
            {missed.length > 0 && <Button variant="primary" size="lg" onClick={() => onAgain(missed)}>{t('practice.retryMissed', { count: missed.length })}</Button>}
            {!review && <Button variant={missed.length ? 'secondary' : 'primary'} size="lg" onClick={() => onAgain()}>{t('practice.again')}</Button>}
            <Button variant="ghost" size="lg" onClick={onExit}>{t('common.backToCourse')}</Button>
          </>
        }
      >
        {changes.length > 0 && (
          <div className="flex flex-col gap-3 rounded-[22px] border-[0.5px] border-line bg-surface p-5" style={{ boxShadow: 'var(--e1)' }}>
            <div className="t-ui font-semibold text-text2">{t('practice.masteryTitle')}</div>
            {changes.map((c) => {
              const delta = Math.round((c.after - c.before) * 100)
              return (
                <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
                  <span className="t-callout truncate"><RichText text={c.title} inline /></span>
                  <span className={cx('t-ui tabular', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-text3')}>
                    {delta > 0 ? '+' : ''}
                    <AnimatedNumber value={delta} /> %
                  </span>
                  <span className="relative col-span-2 h-[6px] overflow-hidden rounded-full bg-fill2">
                    <span className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: `${c.before * 100}%`, background: ink }} />
                    <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: ink }} initial={{ width: `${c.before * 100}%` }} animate={{ width: `${c.after * 100}%` }} transition={{ duration: 1.1, delay: 0.4, ease: [0.2, 0.7, 0.2, 1] }} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {outcomes.length > 0 && (
          <div className="mt-4 flex flex-col overflow-hidden rounded-[22px] border-[0.5px] border-line bg-surface" style={{ boxShadow: 'var(--e1)' }}>
            {outcomes.map((o, i) => (
              <div key={i} className="flex items-center gap-3 border-t-[0.5px] border-line-soft px-4 py-3 first:border-t-0">
                <Icon name={o.firstTry ? 'check-circle' : o.result.status === 'correct' ? 'check' : 'alert-circle'} size={16} className={o.firstTry ? 'text-success' : o.result.status === 'correct' ? 'text-text3' : 'text-danger'} />
                <span className="min-w-0 flex-1 t-callout truncate">
                  <RichText text={o.exercise.prompt.map((b) => (b.type === 'text' ? b.md : '')).join(' ').replace(/\n+/g, ' ') || o.exercise.id} inline />
                </span>
                <span className="t-footnote tabular text-text3">{fmtPercent(o.result.credit)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" icon={<Icon name="mistakes" size={14} />} onClick={() => navigate({ name: 'course', id: data.pack.id, tab: 'mistakes' })}>{t('practice.openNotebook')}</Button>
        </div>
      </SessionSummary>
    </StudyFrame>
  )
}
