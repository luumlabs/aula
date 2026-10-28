// Informe del simulacro: la nota en serif grande que cuenta hasta su valor (medalla y ráfaga de píxeles si es buena), por
// secciones y por tema, qué repasar (con enlaces) y cada pregunta con tu respuesta, la correcta y su explicación.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Exercise } from '@shared/schema'
import { answerSummary } from '@engine/study'
import { AnimatedNumber, Button, Card, Floating, Icon, PixelMedal, ProgressBar, SectionTitle, Stagger, StaggerItem, cx, pixelBurst } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtPercent } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { correctAnswer, StaticBlocks } from '@renderer/exercises'
import i18n from '@renderer/i18n'
import { StudyFrame, TopCapsule } from '../Chrome'
import type { CourseData } from '../data'
import { useBlockCtx, useInk } from '../kit'
import { PlanContinue } from '../Summary'
import type { Finished } from './ExamMode'
import { formatClock } from './ExamRunView'

export function verdictKey(pct: number, pass?: number): string {
  if (pass) {
    if (pct >= 0.9) return 'excellent'
    if (pct >= pass + 0.1) return 'passWide'
    if (pct >= pass) return 'passNarrow'
    return pct >= pass - 0.1 ? 'almost' : 'notYet'
  }
  if (pct >= 0.9) return 'excellent'
  if (pct >= 0.8) return 'veryGood'
  if (pct >= 0.65) return 'good'
  if (pct >= 0.5) return 'justOk'
  return 'notYet'
}

export function ExamReportView({ data, done, onExit, onPractice, onAgain }: { data: CourseData; done: Finished; onExit: () => void; onPractice: (ex: Exercise[]) => void; onAgain: () => void }) {
  const { t } = useTranslation('study')
  const ink = useInk(data.pack)
  const medal = useRef<HTMLDivElement>(null)
  const { report, run, graded, exercises, inputs } = done
  const pass = data.pack.blueprint?.passPercent
  const good = report.percent >= Math.max(0.7, pass ?? 0)
  const missed = report.wrongItems.map((id) => exercises[id]).filter((e): e is Exercise => !!e)
  useEffect(() => {
    if (!good) return
    const id = setTimeout(() => medal.current && pixelBurst(medal.current, { count: 22 }), 700)
    return () => clearTimeout(id)
  }, [good])
  const perfect = run.items.filter((it) => (graded.grades[it.exerciseID]?.credit ?? 0) >= 0.999).length
  return (
    <StudyFrame wide capsule={<TopCapsule icon="exam" label={t('exam.reportTitle')} onExit={onExit} />} onExit={onExit}>
      <Stagger className="grid grid-cols-12 gap-4" gap={0.06}>
        <StaggerItem className="col-span-12 @4xl:col-span-7">
          <Card padded="lg" className="h-full">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="t-ui font-semibold text-text2">{t('exam.score')}</div>
                <div className="mt-1 flex items-end gap-2">
                  <span className="font-serif text-[88px] leading-[84px] tracking-[-0.03em] tabular">
                    <AnimatedNumber value={Math.round(report.percent * 100)} duration={1.4} />
                  </span>
                  <span className="mb-2 font-serif text-[38px] text-text2">%</span>
                </div>
                <div className="t-title2 mt-2" style={{ color: good ? 'var(--success)' : report.percent >= 0.5 ? 'var(--text)' : 'var(--warning)' }}>
                  {t(`exam.verdict.${verdictKey(report.percent, pass)}`, { pass: fmtPercent(pass ?? 0) })}
                </div>
              </div>
              <motion.div ref={medal} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.5 }}>
                {good ? <PixelMedal size={76} /> : null}
              </motion.div>
            </div>
            <p className="t-body text-text2 mt-3 max-w-[520px]">{good ? t('exam.goodBody') : t('exam.workBody')}</p>
            <div className="mt-6 grid grid-cols-3 gap-4 border-t-[0.5px] border-line-soft pt-5">
              {[
                { text: t('common.aOfB', { a: fmtPts(report.score), b: fmtPts(report.total) }), l: t('exam.points') },
                { text: t('common.aOfB', { a: perfect, b: run.items.length }), l: t('exam.perfect') },
                { text: formatClock(report.durationSeconds), l: run.durationMinutes ? t('exam.ofTime', { time: formatClock(run.durationMinutes * 60) }) : t('exam.total') }
              ].map((x, i) => (
                <div key={i} className="flex flex-col">
                  <span className="t-number text-[26px] leading-[30px]">{x.text}</span>
                  <span className="t-caption">{x.l}</span>
                </div>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12 @4xl:col-span-5">
          <Floating amplitude={2} duration={10} className="h-full">
            <Card padded="lg" mark={ink} className="h-full">
              <SectionTitle title={t('exam.toReview')} />
              {report.review.length === 0 ? (
                <p className="t-callout text-text2 mt-1">{t('exam.nothingToReview')}</p>
              ) : (
                <div className="mt-1 flex flex-col">
                  {report.review.map((r) => (
                    <div key={r.skillId} className="border-t-[0.5px] border-line-soft py-3 first:border-t-0">
                      <div className="t-headline"><RichText text={r.title} inline /></div>
                      <div className="t-callout text-text2 mt-0.5"><RichText text={r.reason} inline /></div>
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'study', id: data.pack.id, mode: 'practice', skill: r.skillId })}>{t('exam.practiceSkill')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'study', id: data.pack.id, mode: 'learn', skill: r.skillId })}>{t('exam.reviewLesson')}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {missed.length > 0 && (
                <div className="mt-4">
                  <Button variant="primary" size="lg" full onClick={() => onPractice(missed)}>{t('exam.practiceMissed', { count: missed.length })}</Button>
                  <div className="t-footnote mt-1.5 text-center">{t('exam.practiceMissedHelp')}</div>
                </div>
              )}
            </Card>
          </Floating>
        </StaggerItem>

        <StaggerItem className="col-span-12 @4xl:col-span-6">
          <Card padded="lg" className="h-full">
            <SectionTitle title={t('exam.bySection')} />
            <div className="mt-2 flex flex-col gap-3.5">
              {report.sections.map((s, i) => (
                <div key={i}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="t-callout truncate"><RichText text={s.title} inline /></span>
                    <span className="t-ui tabular text-text2">{t('common.aOfB', { a: fmtPts(s.points), b: fmtPts(s.total) })}</span>
                  </div>
                  <ProgressBar value={s.percent} color={s.percent >= 0.7 ? ink : s.percent >= 0.5 ? 'var(--warning)' : 'var(--danger)'} height={7} />
                </div>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12 @4xl:col-span-6">
          <Card padded="lg" className="h-full">
            <SectionTitle title={t('exam.bySkill')} />
            <div className="mt-2 flex flex-col gap-3.5">
              {report.skills.map((s) => (
                <button key={s.skillId} type="button" onClick={() => navigate({ name: 'study', id: data.pack.id, mode: 'practice', skill: s.skillId })} className="group text-left">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="t-callout truncate group-hover:text-accent-text"><RichText text={s.title} inline /></span>
                    <span className="t-ui tabular text-text2">{fmtPercent(s.percent)}</span>
                  </div>
                  <ProgressBar value={s.percent} color={s.percent >= 0.7 ? ink : s.percent >= 0.5 ? 'var(--warning)' : 'var(--danger)'} height={7} />
                </button>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12">
          <Card padded="lg">
            <SectionTitle title={t('exam.questionsTitle')} detail={t('exam.questionsDetail')} />
            <div className="mt-2 flex flex-col">
              {run.items.map((it, i) => (
                <ReviewRow key={it.exerciseID} data={data} number={i + 1} exercise={exercises[it.exerciseID]} points={it.points} credit={graded.grades[it.exerciseID]?.credit ?? 0} feedback={graded.grades[it.exerciseID]?.feedback.map((f) => f.markdown) ?? []} input={inputs[it.exerciseID] ? answerSummary(inputs[it.exerciseID]) : undefined} />
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12 flex justify-center">
          <div className="w-full max-w-[640px]"><PlanContinue packId={data.pack.id} /></div>
        </StaggerItem>
        <StaggerItem className="col-span-12 flex flex-wrap justify-center gap-2 pt-2">
          <Button variant="secondary" size="lg" icon={<Icon name="repeat" size={15} />} onClick={onAgain}>{t('exam.another')}</Button>
          <Button variant="ghost" size="lg" onClick={onExit}>{t('common.backToCourse')}</Button>
        </StaggerItem>
      </Stagger>
    </StudyFrame>
  )
}

const fmtPts = (x: number): string => (Math.round(x * 10) / 10).toLocaleString(i18n.language === 'es' ? 'es-ES' : 'en-US')

function ReviewRow({ data, number, exercise, points, credit, input, feedback }: { data: CourseData; number: number; exercise?: Exercise; points: number; credit: number; input?: string; feedback: string[] }) {
  const { t } = useTranslation('study')
  const [open, setOpen] = useState(false)
  const ctx = useBlockCtx(data.pack, exercise?.skill)
  if (!exercise) return null
  const ok = credit >= 0.999, part = credit > 0 && !ok
  const prompt = exercise.prompt.map((b) => (b.type === 'text' ? b.md : '')).join(' ').replace(/\n+/g, ' ')
  return (
    <div className="border-t-[0.5px] border-line-soft first:border-t-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-fill1 rounded-[10px] px-2 -mx-2">
        <Icon name={ok ? 'check-circle' : part ? 'alert' : 'alert-circle'} size={17} className={ok ? 'text-success' : part ? 'text-warning' : 'text-danger'} />
        <span className="w-6 t-ui tabular text-text3">{number}</span>
        <span className="min-w-0 flex-1 t-callout truncate"><RichText text={prompt || exercise.id} inline /></span>
        <span className="t-ui tabular text-text2">{t('exam.ptsOf', { got: fmtPts(points * credit), total: fmtPts(points) })}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="text-text3" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 pb-4 pl-11">
              <StaticBlocks blocks={exercise.prompt} ctx={{ ...ctx, mode: 'chat' }} />
              <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 t-callout">
                <span className="text-text3">{t('exam.yourAnswer')}</span>
                <span className={cx(ok ? 'text-success' : 'text-text')}>{input ? <RichText text={input} inline /> : <span className="text-text3">{t('exam.unanswered')}</span>}</span>
                {!ok && (
                  <>
                    <span className="text-text3">{t('ex.answer')}</span>
                    <span className="text-success"><RichText text={correctAnswer(exercise, i18n.language)} inline /></span>
                  </>
                )}
              </div>
              {!ok && feedback.filter(Boolean).length > 0 && <div className="t-callout text-text2">{feedback.filter(Boolean).map((f, i) => <RichText key={i} text={f} />)}</div>}
              {exercise.solution.length > 0 && (
                <div className="rounded-[14px] bg-sunken p-4">
                  <StaticBlocks blocks={exercise.solution} ctx={{ ...ctx, mode: 'chat' }} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
