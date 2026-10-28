// Inicio del simulacro: el modelo del examen (preguntas, duración, puntos, nota de corte), sus secciones, los simulacros
// anteriores con su nota y, si hay uno a medias, continuarlo o descartarlo.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import type { ExamRun } from '@shared/schema'
import { examPercent } from '@shared/schema'
import { examBlueprint } from '@engine/study'
import { AnimatedNumber, Button, Card, ConfirmDialog, Floating, Icon, ProgressBar, SectionTitle, Stagger, StaggerItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { fmtDate, fmtPercent, percentSuffix } from '@renderer/lib/format'
import { StudyFrame, TopCapsule } from '../Chrome'
import type { CourseData } from '../data'
import { useInk } from '../kit'

/** Cuántos ejercicios (y plantillas) tiene el curso para un simulacro. */
export function examExerciseCount(skills: ReadonlyArray<{ exercises: readonly unknown[]; templates?: readonly unknown[] }>): number {
  return skills.reduce((n, s) => n + s.exercises.length + (s.templates?.length ?? 0), 0)
}

export function ExamStart({ data, pending, busy, onStart, onResume, onDiscard, onExit }: { data: CourseData; pending?: ExamRun; busy?: boolean; onStart: () => void; onResume?: () => void; onDiscard?: () => void; onExit: () => void }) {
  const { t } = useTranslation('study')
  const ink = useInk(data.pack)
  const [confirm, setConfirm] = useState<'new' | 'discard' | null>(null)
  const bp = examBlueprint(data.pack)
  // los ejercicios que hay de verdad: sin ninguno, el modelo del examen no se puede montar (A3-P2-8)
  const available = examExerciseCount(data.skills)
  const questions = available ? bp.sections.reduce((a, s) => a + s.count, 0) : 0
  const points = available ? bp.sections.reduce((a, s) => a + s.count * s.pointsEach, 0) : 0
  const past = [...data.progress.exams].filter((e) => e.kind !== 'diagnostic').sort((a, b) => (a.date < b.date ? 1 : -1))
  const answered = pending?.items.filter((i) => i.answer !== undefined && i.answer !== null).length ?? 0
  const left = pending ? Math.max(0, pending.durationMinutes * 60 - pending.items.reduce((a, i) => a + i.seconds, 0)) : 0
  const title = (id: string): string => data.skills.find((s) => s.id === id)?.title ?? data.pack.skills.find((s) => s.id === id)?.title ?? id
  return (
    <StudyFrame wide capsule={<TopCapsule icon="exam" label={t('exam.title')} onExit={onExit} />} onExit={onExit}>
      <Stagger className="grid grid-cols-12 gap-4" gap={0.06}>
        <StaggerItem className="col-span-12 @4xl:col-span-7">
          <Card padded="lg" className="h-full">
            <div className="t-eyebrow">{data.pack.exam?.title ?? t('exam.title')}</div>
            <h1 className="t-display mt-1 text-[36px] leading-[42px]">{t('exam.mockTitle')}</h1>
            <p className="t-body text-text2 mt-2 max-w-[520px]">{t('exam.lead')}</p>
            {!available && !pending && (
              <div role="status" data-testid="exam-no-exercises" className="mt-5 flex items-start gap-2.5 rounded-[14px] bg-sunken p-3.5">
                <Icon name="info" size={16} className="mt-[2px] shrink-0 text-text3" />
                <div>
                  <div className="t-headline">{t('exam.noExercises')}</div>
                  <div className="t-callout text-text2 mt-0.5">{t('exam.noExercisesBody')}</div>
                </div>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-4 border-t-[0.5px] border-line-soft pt-5 @lg:grid-cols-4">
              {[
                { v: questions, l: t('exam.questions', { count: questions }) },
                { v: bp.durationMinutes, l: t('exam.minutes'), s: '' },
                { v: Math.round(points), l: t('exam.points') },
                ...(bp.passPercent ? [{ v: Math.round(bp.passPercent * 100), l: t('exam.toPass'), s: percentSuffix() }] : [])
              ].map((x, i) => (
                <div key={i} className="flex flex-col">
                  <span className="t-number text-[30px] leading-[34px]"><AnimatedNumber value={x.v} suffix={x.s ?? ''} /></span>
                  <span className="t-caption">{x.l}</span>
                </div>
              ))}
            </div>
            {bp.instructions && (
              <div className="mt-5 rounded-[14px] bg-sunken p-3.5 t-callout text-text2">
                <RichText text={bp.instructions} />
              </div>
            )}
            {pending && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-5 flex flex-wrap items-center gap-3 rounded-[16px] bg-accent-wash px-4 py-3">
                <Icon name="clock" size={17} className="text-accent-text" />
                <div className="min-w-0 flex-1">
                  <div className="t-headline">{t('exam.pendingTitle')}</div>
                  <div className="t-callout text-text2">{t('exam.pendingBody', { answered, total: pending.items.length, minutes: Math.ceil(left / 60) })}</div>
                </div>
                <Button variant="ghost" onClick={() => setConfirm('discard')}>{t('exam.discard')}</Button>
              </motion.div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              {pending ? (
                <>
                  <Button variant="primary" size="xl" icon={<Icon name="play" size={16} />} onClick={onResume}>{t('exam.resume')}</Button>
                  <Button variant="secondary" size="xl" loading={busy} onClick={() => setConfirm('new')}>{t('exam.startNew')}</Button>
                </>
              ) : (
                <Button variant="primary" size="xl" icon={<Icon name="play" size={16} />} onClick={onStart} loading={busy} disabled={questions === 0}>{t('exam.start')}</Button>
              )}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="col-span-12 @4xl:col-span-5">
          <Floating amplitude={2} duration={10} className="h-full">
            <Card padded="lg" mark={ink} className="h-full">
              <SectionTitle title={t('exam.sections')} />
              <div className="mt-2 flex flex-col">
                {bp.sections.map((s, i) => (
                  <div key={i} className="border-t-[0.5px] border-line-soft py-3 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="t-headline"><RichText text={s.title} inline /></span>
                      <span className="t-ui tabular text-text2 shrink-0">{t('exam.sectionMeta', { count: s.count, points: s.pointsEach })}</span>
                    </div>
                    <div className="t-footnote mt-0.5 line-clamp-2">{s.skillIDs.map(title).join(' · ')}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Floating>
        </StaggerItem>

        <StaggerItem className="col-span-12">
          <Card padded="lg">
            <SectionTitle title={t('exam.past')} detail={past.length ? t('exam.pastCount', { count: past.length }) : undefined} />
            {past.length === 0 ? (
              <p className="t-callout text-text3 mt-1">{t('exam.noPast')}</p>
            ) : (
              <div className="mt-2 flex flex-col">
                {past.slice(0, 8).map((e) => {
                  const pct = examPercent(e)
                  return (
                    <div key={e.id} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-4 border-t-[0.5px] border-line-soft py-2.5 first:border-t-0">
                      <span className="t-callout text-text2">{fmtDate(e.date, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                      <ProgressBar value={pct} color={bp.passPercent && pct < bp.passPercent ? 'var(--warning)' : ink} height={6} />
                      <span className="t-number-inline tabular">{fmtPercent(pct)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </StaggerItem>
      </Stagger>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === 'discard') onDiscard?.()
          else onStart()
        }}
        title={confirm === 'discard' ? t('exam.discardTitle') : t('exam.newTitle')}
        description={confirm === 'discard' ? t('exam.discardBody') : t('exam.newBody')}
        confirmLabel={confirm === 'discard' ? t('exam.discard') : t('exam.startNew')}
        cancelLabel={t('common.cancel')}
        danger={confirm === 'discard'}
      />
    </StudyFrame>
  )
}
