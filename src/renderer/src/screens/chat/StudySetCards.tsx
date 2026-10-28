// Cuestionarios y tarjetas dentro de la conversación (port de AssistantStudyCards.swift): lo que Aula crea con `make_quiz` /
// `make_flashcards` se resuelve o se repasa aquí mismo y se puede guardar en una lección.
//
// · Cuestionario: una pregunta a la vez con la misma vista y el mismo corrector que la práctica (pistas, el porqué del error,
//   la solución); al terminar, la nota («3 de 4 bien a la primera»), «Repetir» y «Guardar en el curso…». Hasta pulsar «Empezar»
//   solo se ve la portada, y solo el cuestionario con el que se está trabajando escucha el teclado. Cada primer intento se guarda en
//   la tarjeta (chat.answerCard): al volver a abrir la conversación sigue donde se quedó o enseña la nota.
// · Tarjetas: se giran con un clic o con la barra espaciadora y se pasan con ← →.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import type { AssistantCard, AssistantStudySet } from '@shared/assistant/types'
import type { Exercise } from '@shared/schema/exercises'
import type { SkillRef } from '@shared/schema/pack'
import { AnimatedNumber, Button, Card, CourseIcon, Dialog, Icon, IconButton, ProgressBar, Select, Tooltip, cx, pixelBurst, spring, toast, useTheme, type IconName } from '@renderer/design'
import { ExerciseActions, ExerciseView, inputSummary, useExercise, type GradeResult, type RunState } from '@renderer/exercises'
import { makeBlockContext } from '@renderer/blocks/types'
import { RichText } from '@renderer/lib/RichText'
import { api } from '@renderer/lib/api'
import { useCourses } from '@renderer/lib/courses'
import { useChatActions } from './actions'
import { flashcardFaces, inputForAula, quizMistakes, quizProgress, suggestSaveCourse, suggestSaveLesson } from './studySet'

/** El cuestionario con el que se está trabajando (el único que escucha ↩ y las letras de las opciones). */
const useActiveSet = create<{ id: string | null; activate: (id: string) => void }>((set) => ({ id: null, activate: (id) => set({ id }) }))

interface CardRef {
  card: AssistantCard
  threadId: string
  messageId: string
  packId: string | null
}

/** Guarda en la tarjeta lo respondido o la lección donde guardarla (el proceso principal lo apunta en la conversación). */
async function answerSet({ card, threadId, messageId }: CardRef, payload: Record<string, unknown>): Promise<void> {
  await api.invoke('chat.answerCard', { threadId, messageId, cardId: card.id, answer: JSON.stringify(payload) })
}

export function StudySetCard(props: CardRef) {
  const set = props.card.studySet
  if (!set) return null
  return props.card.kind === 'flashcards' ? <FlashcardsCard {...props} set={set} /> : <QuizCard {...props} set={set} />
}

function SetHeader({ icon, title, meta, trailing }: { icon: IconName; title: string; meta: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-fill1 text-text2">
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="t-headline text-text"><RichText text={title} inline /></div>
        <div className="t-ui text-text2 mt-0.5">{meta}</div>
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2 pt-0.5">{trailing}</div>}
    </div>
  )
}

function SavedWord({ where, plural }: { where: string; plural?: boolean }) {
  const { t } = useTranslation('chat')
  return (
    <Tooltip label={t('save.savedIn', { where })}>
      <span className="inline-flex items-center gap-1 t-ui font-medium text-success">
        <Icon name="check" size={14} />
        {plural ? t('save.savedCards') : t('save.saved')}
      </span>
    </Tooltip>
  )
}

// MARK: Cuestionario

type QuizPhase = 'cover' | 'question' | 'summary'

function QuizCard({ set, ...ref }: CardRef & { set: AssistantStudySet }) {
  const { t, i18n } = useTranslation('chat')
  const { reducedMotion } = useTheme()
  const actions = useChatActions()
  const activeId = useActiveSet((s) => s.id)
  const activate = useActiveSet((s) => s.activate)
  const [firstTry, setFirstTry] = useState<Record<string, boolean>>({})
  const progress = quizProgress(set, firstTry)
  const [phase, setPhase] = useState<QuizPhase>(() => (progress.done ? 'summary' : 'cover'))
  const [index, setIndex] = useState(0)
  const [round, setRound] = useState(0)
  const scoreEl = useRef<HTMLDivElement>(null)
  const ctx = useMemo(() => makeBlockContext(ref.packId, i18n.language, { mode: 'chat' }), [ref.packId, i18n.language])
  const total = set.exercises.length
  const title = set.title || t('quiz.title')
  const ex: Exercise | undefined = set.exercises[index]

  const start = (from: number) => {
    activate(set.id)
    setIndex(Math.max(0, Math.min(total - 1, from)))
    setPhase('question')
  }
  const repeat = () => {
    setFirstTry({})
    setRound((r) => r + 1)
    start(0)
  }
  const record = (e: Exercise, r: GradeResult, run: RunState) => {
    const ok = r.status === 'correct'
    setFirstTry((cur) => ({ ...cur, [e.id]: ok }))
    const input = inputForAula(inputSummary(e.answer, run.draft, { true: t('quiz.true'), false: t('quiz.false') }))
    void answerSet(ref, { results: { [e.id]: ok }, ...(input ? { inputs: { [e.id]: input } } : {}) }).catch(() => undefined)
  }
  const advance = () => {
    if (index < total - 1) setIndex(index + 1)
    else {
      setPhase('summary')
      requestAnimationFrame(() => {
        if (scoreEl.current && !reducedMotion && quizProgress(set, firstTry).right === total) pixelBurst(scoreEl.current, { count: 12 })
      })
    }
  }
  const askMistake = (n: number, e: Exercise, run: RunState) => {
    const input = inputForAula(inputSummary(e.answer, run.draft, { true: t('quiz.true'), false: t('quiz.false') })) ?? '—'
    actions?.ask(t('quiz.askMistake', { n, title, input }))
  }
  const askMistakes = () => {
    const list = quizMistakes(set, firstTry).map((m) => (m.input ? t('quiz.mistakeWithInput', { n: m.n, input: m.input }) : t('quiz.mistake', { n: m.n }))).join('; ')
    actions?.ask(t('quiz.askMistakes', { title, list }))
  }

  const meta = phase === 'question' ? t('quiz.progress', { n: index + 1, total }) : t('quiz.meta', { count: total })
  const fade = reducedMotion ? { duration: 0 } : spring.smooth
  return (
    <Card
      padded="sm"
      data-studyset="quiz"
      className="pl-4"
      onPointerDownCapture={() => phase === 'question' && activate(set.id)}
      onFocusCapture={() => phase === 'question' && activate(set.id)}
      aria-label={t('quiz.label', { title })}
    >
      <SetHeader icon="checklist" title={title} meta={meta} trailing={set.savedTo ? <SavedWord where={set.savedTo} /> : phase === 'question' ? <span className="t-caption tabular text-text3">{index + 1}/{total}</span> : null} />
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'question' && ex ? (
          <motion.div key={`q-${round}-${ex.id}`} className="mt-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={fade}>
            {total > 1 && <ProgressBar value={index / total} className="mb-4" label={t('quiz.progress', { n: index + 1, total })} />}
            <QuizQuestion
              exercise={ex}
              ctx={ctx}
              active={activeId === set.id}
              continueLabel={index < total - 1 ? t('quiz.next') : t('quiz.finish')}
              onFirst={(r, run) => record(ex, r, run)}
              onContinue={advance}
              onAsk={actions ? (run) => askMistake(index + 1, ex, run) : undefined}
            />
          </motion.div>
        ) : phase === 'summary' ? (
          <motion.div key="summary" className="mt-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fade}>
            <div ref={scoreEl} className="flex items-baseline gap-2" aria-live="polite">
              <span className="t-number text-[34px] leading-none text-text">
                <AnimatedNumber value={progress.right} />
              </span>
              <span className="font-serif text-[20px] text-text2">{t('quiz.of', { total })}</span>
              <span className="t-callout text-text2">{t('quiz.scoreLabel')}</span>
            </div>
            <span className="sr-only" data-testid="quiz-score">{t('quiz.score', { right: progress.right, total })}</span>
            <ResultDots set={set} local={firstTry} className="mt-3" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="md" variant="secondary" icon={<Icon name="repeat" size={14} />} onClick={repeat}>{t('quiz.repeat')}</Button>
              {actions && progress.right < total && <Button size="md" variant="ghost" icon={<Icon name="tutor" size={14} />} onClick={askMistakes}>{t('quiz.reviewMistakes')}</Button>}
              <span className="flex-1" />
              {!set.savedTo && <SaveToCourse set={set} cardRef={ref} />}
            </div>
          </motion.div>
        ) : (
          <motion.div key="cover" className="mt-3 flex flex-wrap items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <Button size="md" variant="primary" icon={<Icon name="play" size={13} />} onClick={() => start(progress.next)}>
              {progress.answered > 0 ? t('quiz.resume', { n: progress.next + 1, total }) : t('quiz.start')}
            </Button>
            {progress.answered > 0 && <ResultDots set={set} local={firstTry} />}
            <span className="flex-1" />
            {!set.savedTo && <SaveToCourse set={set} cardRef={ref} />}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

/** Una pregunta con su propio flujo (el de la práctica): las acciones van en una barra compacta abajo. */
function QuizQuestion({ exercise, ctx, active, continueLabel, onFirst, onContinue, onAsk }: {
  exercise: Exercise
  ctx: ReturnType<typeof makeBlockContext>
  active: boolean
  continueLabel: string
  onFirst: (r: GradeResult, run: RunState) => void
  onContinue: () => void
  onAsk?: (run: RunState) => void
}) {
  const { i18n } = useTranslation('chat')
  const c = useExercise(exercise, { mode: 'practice', lang: i18n.language, onFirstResult: onFirst, onContinue })
  return (
    <div data-exercise={exercise.id}>
      <ExerciseView controller={c} ctx={ctx} actions="none" bare active={active} autoFocus={active} continueLabel={continueLabel} onAskTutor={onAsk ? () => onAsk(c.run) : undefined} />
      <div className="mt-4 flex justify-end">
        <ExerciseActions controller={c} continueLabel={continueLabel} variant="bar" />
      </div>
    </div>
  )
}

/** Una casilla por pregunta: verde si salió a la primera, roja si no, vacía si falta (pixel-art discreto). */
function ResultDots({ set, local, className }: { set: AssistantStudySet; local: Record<string, boolean>; className?: string }) {
  const { t } = useTranslation('chat')
  const results = { ...set.results, ...local }
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)} role="list" aria-label={t('quiz.dots')}>
      {set.exercises.map((e, i) => {
        const r = results[e.id]
        const label = r === undefined ? t('quiz.dotPending', { n: i + 1 }) : r ? t('quiz.dotRight', { n: i + 1 }) : t('quiz.dotWrong', { n: i + 1 })
        return (
          <motion.span
            key={e.id}
            role="listitem"
            aria-label={label}
            title={label}
            className={cx('h-2.5 w-2.5 rounded-[3px]', r === undefined ? 'bg-fill3' : r ? 'bg-success' : 'bg-danger')}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring.snappy, delay: i * 0.04 }}
          />
        )
      })}
    </div>
  )
}

// MARK: Tarjetas

function FlashcardsCard({ set, ...ref }: CardRef & { set: AssistantStudySet }) {
  const { t } = useTranslation('chat')
  const { reducedMotion } = useTheme()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const total = set.cards.length
  const card = set.cards[Math.min(index, total - 1)]
  if (!card) return null
  const faces = flashcardFaces(card)
  const go = (d: number) => {
    setIndex((i) => Math.max(0, Math.min(total - 1, i + d)))
    setFlipped(false)
  }
  const face = 'col-start-1 row-start-1 flex min-h-[132px] flex-col gap-2 rounded-[16px] bg-sunken px-5 py-4 [backface-visibility:hidden]'
  return (
    <Card padded="sm" data-studyset="flashcards" className="pl-4" aria-label={t('flashcards.label', { title: set.title })}>
      <SetHeader
        icon="cards"
        title={set.title || t('flashcards.title')}
        meta={t('flashcards.meta', { count: total })}
        trailing={
          <>
            {set.savedTo && <SavedWord where={set.savedTo} plural />}
            <span className="t-caption tabular text-text3" aria-live="polite">{t('flashcards.position', { n: index + 1, total })}</span>
          </>
        }
      />
      <div className="mt-3 [perspective:1400px]">
        <motion.button
          key={card.id}
          type="button"
          data-flipped={flipped ? 'true' : 'false'}
          aria-pressed={flipped}
          aria-label={flipped ? t('flashcards.backLabel') : t('flashcards.frontLabel')}
          title={t('flashcards.flipHelp')}
          onClick={() => setFlipped((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
          }}
          className="grid w-full cursor-pointer text-left outline-none [transform-style:preserve-3d] rounded-[16px] focus-visible:ring-2 focus-visible:ring-accent-line"
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, rotateY: flipped && !reducedMotion ? 180 : 0 }}
          transition={{ rotateY: { type: 'spring', stiffness: 170, damping: 21 }, default: { duration: 0.25 } }}
        >
          <span className={cx(face, reducedMotion && flipped && 'invisible')} aria-hidden={flipped}>
            <span className="t-caption text-text3">{t('flashcards.front')}</span>
            <span className="t-reading text-text"><RichText text={faces.front} /></span>
            {card.hint && <span className="t-footnote text-text3">{t('flashcards.hint', { hint: card.hint })}</span>}
          </span>
          <span className={cx(face, reducedMotion ? (!flipped && 'invisible') : '[transform:rotateY(180deg)]')} aria-hidden={!flipped}>
            <span className="t-caption text-accent-text">{t('flashcards.back')}</span>
            {card.kind !== 'cloze' && <span className="t-footnote text-text3 line-clamp-1"><RichText text={faces.front} inline /></span>}
            <span className="t-reading text-text"><RichText text={faces.back} /></span>
            {faces.note && <span className="t-callout text-text2"><RichText text={faces.note} /></span>}
          </span>
        </motion.button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <IconButton label={t('flashcards.prev')} size="sm" onClick={() => go(-1)} disabled={index === 0}>
          <Icon name="chevron-left" size={15} />
        </IconButton>
        <Button size="sm" variant="secondary" icon={<Icon name="refresh" size={13} />} onClick={() => setFlipped((v) => !v)}>
          {flipped ? t('flashcards.showFront') : t('flashcards.flip')}
        </Button>
        <IconButton label={t('flashcards.next')} size="sm" onClick={() => go(1)} disabled={index >= total - 1}>
          <Icon name="chevron-right" size={15} />
        </IconButton>
        <span className="flex-1" />
        {!set.savedTo && <SaveToCourse set={set} cardRef={ref} plural />}
      </div>
    </Card>
  )
}

// MARK: Guardar en el curso

/** «Guardar en el curso…»: elige curso y lección (los que propuso Aula, si los sabe) y guarda. La pulsación es el permiso. */
function SaveToCourse({ set, cardRef, plural }: { set: AssistantStudySet; cardRef: CardRef; plural?: boolean }) {
  const { t } = useTranslation('chat')
  const courses = useCourses((s) => s.courses)
  const [open, setOpen] = useState(false)
  const [course, setCourse] = useState<string | null>(null)
  const [skill, setSkill] = useState<string | null>(null)
  const [lessons, setLessons] = useState<SkillRef[]>([])
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const loadLessons = async (id: string, preferred?: string) => {
    setLessons([])
    setSkill(null)
    try {
      const pack = await api.invoke('courses.get', { id })
      const list = [...(pack?.skills ?? [])].sort((a, b) => a.order - b.order)
      setLessons(list)
      setSkill(suggestSaveLesson(set, list, preferred))
    } catch {
      setLessons([])
    }
  }
  const prepare = () => {
    setProblem(null)
    // el que dijo Aula, el de la conversación o el que encaja con el tema; si nada encaja, se elige (J2-22)
    const first = suggestSaveCourse(set, courses, cardRef.packId)
    setCourse(first)
    if (first) void loadLessons(first, first === set.courseID ? set.skillID : undefined)
    setOpen(true)
  }
  const save = async () => {
    if (!course || !skill) return
    setSaving(true)
    setProblem(null)
    try {
      await answerSet(cardRef, { save: { courseID: course, skillID: skill } })
      setOpen(false)
      const where = [courses.find((c) => c.id === course)?.title, lessons.find((s) => s.id === skill)?.title].filter(Boolean).join(' · ')
      toast.success(t('save.done', { where }))
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const button = (
    <Button size="md" variant="ghost" icon={<Icon name="download" size={14} />} disabled={!courses.length} onClick={prepare}>
      {t('save.button')}
    </Button>
  )
  return (
    <>
      {courses.length ? button : <Tooltip label={t('save.needCourse')}>{button}</Tooltip>}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={t('save.title')}
        description={plural ? t('save.descriptionCards') : t('save.description')}
        footer={
          <>
            <Button variant="ghost" size="lg" onClick={() => setOpen(false)}>{t('save.cancel')}</Button>
            <Button variant="primary" size="lg" disabled={!course || !skill} loading={saving} onClick={() => void save()}>{t('save.save')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label={t('save.course')}
            value={course}
            placeholder={t('save.pickCourse')}
            options={courses.map((c) => ({ value: c.id, label: c.title, icon: <CourseIcon icon={c.icon} hue={c.hue} size={20} radius={6} title={c.title} /> }))}
            onChange={(id) => {
              setCourse(id)
              void loadLessons(id)
            }}
          />
          <Select
            label={t('save.lesson')}
            value={skill}
            placeholder={course && !lessons.length ? t('save.noLessons') : t('save.pickLesson')}
            options={lessons.map((s) => ({ value: s.id, label: <RichText text={s.title} inline /> }))}
            onChange={setSkill}
          />
          {problem && <p className="t-footnote text-warning">{problem}</p>}
        </div>
      </Dialog>
    </>
  )
}
