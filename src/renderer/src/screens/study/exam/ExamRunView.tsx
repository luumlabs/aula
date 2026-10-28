// El simulacro en marcha: una pregunta a la vista con su sección, el reloj en un anillo dentro de la cápsula que flota
// (si sales, se pausa: cuenta el tiempo de cada pregunta), marcar para revisar, el mapa de preguntas y entregar.
// Atajos: ⌥← ⌥→ para moverse, ↩ en un campo pasa a la siguiente, ⇧⌘L marca.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { ExamRun, ExamRunItem, Exercise } from '@shared/schema'
import { examExercises } from '@engine/study'
import { Button, cx, Dialog, Icon, IconButton, LiveDot, ProgressRing, Tooltip } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { ExerciseView, snapshotInput, useExercise } from '@renderer/exercises'
import { inputIsEmpty } from '@renderer/exercises/model'
import { GlassCapsule, StudyFrame, TopCapsule, CapsuleDivider } from '../Chrome'
import { updateProgress, type CourseData } from '../data'
import { useBlockCtx, useInk } from '../kit'

const answeredItem = (it: ExamRunItem, ex: Exercise | undefined): boolean => !!ex && it.answer !== undefined && it.answer !== null && !inputIsEmpty(snapshotInput(ex, it.answer))

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function ExamRunView({ data, run: initial, notice, onExit, onSubmit }: { data: CourseData; run: ExamRun; notice?: string; onExit: () => void; onSubmit: (run: ExamRun) => void }) {
  const { t } = useTranslation('study')
  const packId = data.pack.id
  const ink = useInk(data.pack)
  const [run, setRun] = useState(initial)
  const runRef = useRef(run)
  runRef.current = run
  const exercises = useMemo(() => examExercises(initial, data.skills), [initial, data.skills])
  const index = Math.min(run.currentIndex, run.items.length - 1)
  const item = run.items[index]
  const ex = item ? exercises[item.exerciseID] : undefined
  const [dialog, setDialog] = useState<'map' | 'submit' | null>(null)
  const since = useRef(Date.now())
  const [, setTick] = useState(0)

  // el tiempo corre en la pregunta a la vista
  const commitTime = useCallback((r: ExamRun): ExamRun => {
    const now = Date.now()
    const dt = (now - since.current) / 1000
    since.current = now
    return { ...r, items: r.items.map((it, i) => (i === Math.min(r.currentIndex, r.items.length - 1) ? { ...it, seconds: it.seconds + dt } : it)) }
  }, [])
  const persist = useCallback((r: ExamRun) => {
    updateProgress(packId, (p) => (p.examRun?.id === r.id ? { ...p, examRun: r } : p), { kind: 'save' })
  }, [packId])

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000)
    // cada 10 s se guarda (si se cierra la app, se continúa casi donde se dejó)
    const save = setInterval(() => {
      const r = commitTime(runRef.current)
      runRef.current = r
      setRun(r)
      persist(r)
    }, 10_000)
    return () => {
      clearInterval(id)
      clearInterval(save)
      persist(commitTime(runRef.current))
    }
  }, [commitTime, persist])

  const used = run.items.reduce((a, it) => a + it.seconds, 0) + (Date.now() - since.current) / 1000
  const total = run.durationMinutes * 60
  const left = total > 0 ? total - used : Infinity
  const timeUp = total > 0 && left <= 0
  useEffect(() => {
    if (timeUp) setDialog('submit')
  }, [timeUp])

  const go = (i: number): void => {
    if (i < 0 || i >= run.items.length || i === index) return
    const r = { ...commitTime(runRef.current), currentIndex: i }
    setRun(r)
    persist(r)
  }
  const setItem = (i: number, patch: Partial<ExamRunItem>): void => setRun((r) => ({ ...r, items: r.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) }))
  const toggleFlag = (): void => setItem(index, { flagged: !item.flagged })
  const submit = (): void => {
    const r = commitTime(runRef.current)
    persist(r)
    onSubmit(r)
  }

  const answered = run.items.filter((it) => answeredItem(it, exercises[it.exerciseID])).length
  const flagged = run.items.filter((it) => it.flagged).length

  const keys = useRef({ go, toggleFlag, index })
  keys.current = { go, toggleFlag, index }
  useEffect(() => {
    const fn = (e: KeyboardEvent): void => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        keys.current.go(keys.current.index - 1)
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        keys.current.go(keys.current.index + 1)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        keys.current.toggleFlag()
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const warn = total > 0 && left < 300
  const capsule = (
    <TopCapsule
      icon="exam"
      label={t('exam.title')}
      onExit={onExit}
      trailing={
        <Tooltip label={item?.flagged ? t('exam.unflag') : t('exam.flagHelp')} side="bottom">
          <IconButton label={t('exam.flag')} size="sm" active={item?.flagged} onClick={toggleFlag} className={cx('rounded-full!', item?.flagged && 'text-warning!')}>
            <Icon name="flag" size={15} />
          </IconButton>
        </Tooltip>
      }
    >
      {total > 0 ? (
        <span className="flex items-center gap-2" aria-label={t('exam.timeLeft')}>
          <ProgressRing value={Math.max(0, left) / total} size={26} stroke={3} color={left < 60 ? 'var(--danger)' : warn ? 'var(--warning)' : ink} delay={0} />
          <span className={cx('font-serif text-[17px] tabular leading-none', left < 60 ? 'text-danger' : warn ? 'text-warning' : 'text-text')}>{formatClock(left)}</span>
          {warn && <LiveDot color={left < 60 ? 'var(--danger)' : 'var(--warning)'} size={6} activity />}
        </span>
      ) : (
        <span className="t-ui text-text2">{t('exam.noLimit')}</span>
      )}
      <span className="t-ui tabular text-text2 whitespace-nowrap">{t('exam.answeredOf', { n: answered, m: run.items.length })}</span>
    </TopCapsule>
  )

  const last = index >= run.items.length - 1
  const bottom = (
    <GlassCapsule>
      <Tooltip label={t('exam.prevHelp')}>
        <Button variant="ghost" size="md" className="rounded-full!" icon={<Icon name="chevron-left" size={15} />} disabled={index === 0} onClick={() => go(index - 1)}>
          {t('exam.prev')}
        </Button>
      </Tooltip>
      <Button variant="ghost" size="md" className="rounded-full! tabular" onClick={() => setDialog('map')}>
        {t('exam.questionOf', { n: index + 1, m: run.items.length })}
      </Button>
      <CapsuleDivider />
      {last ? (
        <Button variant="primary" size="md" className="rounded-full! px-4" onClick={() => setDialog('submit')}>{t('exam.submit')}</Button>
      ) : (
        <>
          <Button variant="ghost" size="md" className="rounded-full!" onClick={() => setDialog('submit')}>{t('exam.submit')}</Button>
          <Button variant="primary" size="md" className="rounded-full! px-4" iconRight={<Icon name="chevron-right" size={15} />} onClick={() => go(index + 1)}>{t('exam.next')}</Button>
        </>
      )}
    </GlassCapsule>
  )

  const sectionStart = run.items.findIndex((it) => it.sectionTitle === item?.sectionTitle)
  return (
    <StudyFrame capsule={capsule} bottom={bottom} onExit={onExit} scrollKey={index}>
      {notice && index === 0 && <div className="mb-4 rounded-[14px] bg-fill1 px-4 py-3 t-callout text-text2">{notice}</div>}
      {item?.sectionTitle && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="t-eyebrow">{t('exam.section')}</span>
          <span className="t-ui font-semibold text-text2"><RichText text={item.sectionTitle} inline /></span>
          {index === sectionStart && <span className="t-footnote">· {t('exam.sectionStart')}</span>}
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={item?.exerciseID ?? index} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.26, ease: [0.2, 0.7, 0.2, 1] }}>
          {ex && item ? (
            <ExamQuestion data={data} exercise={ex} item={item} number={index + 1} locked={timeUp} onDraft={(snap) => setItem(index, { answer: snap as ExamRunItem['answer'] })} onNext={() => go(index + 1)} />
          ) : (
            <div className="t-callout text-text2">{t('exam.missingQuestion')}</div>
          )}
        </motion.div>
      </AnimatePresence>

      <Dialog open={dialog === 'map'} onClose={() => setDialog(null)} title={t('exam.mapTitle')} size="md">
        <QuestionMap run={run} exercises={exercises} current={index} ink={ink} onPick={(i) => { go(i); setDialog(null) }} />
      </Dialog>
      <Dialog
        open={dialog === 'submit'}
        onClose={() => !timeUp && setDialog(null)}
        hideClose={timeUp}
        title={timeUp ? t('exam.timeUpTitle') : t('exam.submitTitle')}
        description={timeUp ? t('exam.timeUpBody') : answered === run.items.length ? t('exam.allAnswered') : t('exam.submitBody')}
        size="md"
        footer={
          <>
            {!timeUp && <Button variant="ghost" size="lg" onClick={() => setDialog(null)}>{t('exam.keepReviewing')}</Button>}
            <Button variant="primary" size="lg" onClick={submit}>{t('exam.submit')}</Button>
          </>
        }
      >
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 t-callout">
          <span><b className="tabular">{answered}</b> {t('exam.answered')}</span>
          <span className={answered < run.items.length ? 'text-warning' : 'text-text2'}><b className="tabular">{run.items.length - answered}</b> {t('exam.blank')}</span>
          {flagged > 0 && <span className="text-text2"><b className="tabular">{flagged}</b> {t('exam.flagged')}</span>}
        </div>
        {!timeUp && <QuestionMap run={run} exercises={exercises} current={index} ink={ink} onPick={(i) => { go(i); setDialog(null) }} />}
      </Dialog>
    </StudyFrame>
  )
}

function ExamQuestion({ data, exercise, item, number, locked, onDraft, onNext }: { data: CourseData; exercise: Exercise; item: ExamRunItem; number: number; locked: boolean; onDraft: (s: unknown) => void; onNext: () => void }) {
  const ctx = useBlockCtx(data.pack, exercise.skill)
  const c = useExercise(exercise, { mode: 'exam', snapshot: item.answer, onDraft })
  return <ExerciseView controller={c} ctx={ctx} number={number} actions="none" locked={locked} onExamReturn={onNext} />
}

/** Mapa de preguntas: respondidas con la tinta del curso, marcadas con su bandera, la actual con un anillo. */
function QuestionMap({ run, exercises, current, ink, onPick }: { run: ExamRun; exercises: Record<string, Exercise>; current: number; ink: string; onPick: (i: number) => void }) {
  const { t } = useTranslation('study')
  let lastSection: string | undefined
  return (
    <div className="flex flex-col gap-3">
      {run.items.map((it, i) => {
        const head = it.sectionTitle !== lastSection ? it.sectionTitle : undefined
        lastSection = it.sectionTitle
        return { it, i, head }
      }).reduce<{ head?: string; items: { it: ExamRunItem; i: number }[] }[]>((groups, x) => {
        if (x.head !== undefined || !groups.length) groups.push({ head: x.head, items: [] })
        groups[groups.length - 1].items.push({ it: x.it, i: x.i })
        return groups
      }, []).map((g, gi) => (
        <div key={gi}>
          {g.head && <div className="t-ui font-semibold text-text2 mb-1.5"><RichText text={g.head} inline /></div>}
          <div className="flex flex-wrap gap-1.5">
            {g.items.map(({ it, i }) => {
              const done = answeredItem(it, exercises[it.exerciseID])
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPick(i)}
                  aria-label={t('exam.goTo', { n: i + 1 })}
                  className={cx('relative grid h-10 w-10 place-items-center rounded-[11px] t-ui font-semibold tabular transition-colors', done ? 'text-white dark:text-black' : 'bg-fill2 text-text2 hover:bg-fill3', i === current && 'ring-2 ring-accent ring-offset-2 ring-offset-raised')}
                  style={done ? { background: ink } : undefined}
                >
                  {i + 1}
                  {it.flagged && <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-warning text-white"><Icon name="flag" size={9} /></span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
