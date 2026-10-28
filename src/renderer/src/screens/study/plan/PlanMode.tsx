// «Estudiar ahora»: el plan de hoy del curso en orden (tarjetas → errores → aprender → practicar → simulacro), cada paso
// con su porqué y sus minutos. Se hace paso a paso; al terminar cada modo se vuelve aquí (o se sigue directamente).
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { dailyPlan, studyStats } from '@engine/study'
import type { PlanItem } from '@engine/learn'
import { Button, Card, cx, EmptyState, Icon, InkCheck, InkStrike, Stagger, StaggerItem, type IconName } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { gradeLang } from '@renderer/exercises'
import i18n from '@renderer/i18n'
import { CapsuleProgress, StudyFrame, TopCapsule } from '../Chrome'
import type { CourseData } from '../data'
import { SessionSummary } from '../Summary'
import { activePlan, endPlan, runStep, startPlan, usePlanStore } from './session'
import { navigate } from '@renderer/app/router'

const KIND_ICON: Record<PlanItem['kind'], IconName> = { review: 'cards', mistakes: 'mistakes', learn: 'learn', practice: 'practice', mock: 'exam', diagnostic: 'practice', rest: 'clock' }

export function PlanMode({ data }: { data: CourseData }) {
  const { t } = useTranslation('study')
  const packId = data.pack.id
  const session = usePlanStore((s) => s.session)
  const plan = session && activePlan(packId) ? session : null
  const onExit = (): void => {
    endPlan()
    navigate({ name: 'course', id: packId }, { replace: true })
  }
  const built = useRef(false)
  const items = useMemo(() => {
    try {
      return dailyPlan(data.pack, data.skills, data.progress, data.progress.settings.dailyMinutes || 45, new Date(), gradeLang(i18n.language))
    } catch {
      return []
    }
    // el plan se calcula al entrar (después, la sesión lo conserva)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId])
  useEffect(() => {
    if (!plan && !built.current) {
      built.current = true
      startPlan(packId, items)
    }
  }, [plan, packId, items])

  const stats = useMemo(() => {
    try {
      return studyStats(data.progress, new Date())
    } catch {
      return null
    }
  }, [data.progress])

  if (!plan) return null
  const steps = plan.items
  const doneCount = plan.done.filter(Boolean).length
  const total = steps.reduce((a, s) => a + s.minutes, 0)
  const nextIndex = plan.done.findIndex((d) => !d)
  const capsule = (
    <TopCapsule icon="today" label={t('plan.title')} onExit={onExit}>
      <CapsuleProgress value={doneCount} total={steps.length} label={t('plan.stepsDone', { n: doneCount, m: steps.length })} />
      {stats && <span className="t-ui tabular text-text2 whitespace-nowrap">{t('plan.minutesToday', { n: Math.round(stats.minutesToday), m: data.progress.settings.dailyMinutes || 45 })}</span>}
    </TopCapsule>
  )

  if (!steps.length)
    return (
      <StudyFrame capsule={capsule} onExit={onExit}>
        <EmptyState title={t('plan.emptyTitle')} body={t('plan.emptyBody')} action={<Button variant="primary" onClick={() => navigate({ name: 'study', id: packId, mode: 'practice' }, { replace: true })}>{t('plan.practiceAnyway')}</Button>} />
      </StudyFrame>
    )

  if (nextIndex < 0)
    return (
      <StudyFrame capsule={capsule} onExit={onExit}>
        <SessionSummary
          title={t('plan.doneTitle')}
          body={t('plan.doneBody')}
          stats={[
            { value: steps.length, label: t('plan.statSteps', { count: steps.length }) },
            ...(stats ? [{ value: Math.round(stats.minutesToday), label: t('plan.statMinutes') }, { value: stats.streak.current, label: t('plan.statStreak', { count: stats.streak.current }) }] : [])
          ]}
          actions={<Button variant="primary" size="lg" onClick={onExit}>{t('common.backToCourse')}</Button>}
        />
      </StudyFrame>
    )

  return (
    <StudyFrame capsule={capsule} onExit={onExit}>
      <Stagger className="flex flex-col gap-6" gap={0.05}>
        <StaggerItem>
          <div className="t-eyebrow">{data.pack.title}</div>
          <h1 className="t-display mt-1">{doneCount ? t('plan.keepGoing') : t('plan.today')}</h1>
          <p className="t-body text-text2 mt-1.5">{t('plan.lead', { minutes: total })}</p>
        </StaggerItem>
        <div className="relative flex flex-col gap-3">
          <span aria-hidden className="absolute left-[27px] top-6 bottom-6 w-[2px] rounded-full bg-fill2" />
          {steps.map((s, i) => {
            const done = plan.done[i]
            const current = i === nextIndex
            return (
              <StaggerItem key={s.id}>
                <Card
                  padded={false}
                  interactive={!done}
                  onClick={() => runStep(packId, i)}
                  className={cx('relative flex items-center gap-4 px-4 py-4', current && 'ring-1 ring-accent-line')}
                  style={current ? { background: 'color-mix(in oklab, var(--accent) 6%, var(--surface))' } : undefined}
                >
                  <span className={cx('relative z-[1] grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border-[0.5px] border-line', done ? 'bg-success-soft' : current ? 'bg-accent text-on-accent' : 'bg-raised text-text2')}>
                    {/* hecho: un visto bueno a mano (se dibuja la primera vez que se ve hecho) */}
                    {done ? <InkCheck seed={s.id} size={20} className="relative! block" /> : <Icon name={KIND_ICON[s.kind]} size={17} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    {done ? (
                      // y tachado a mano, como en una lista de papel
                      <InkStrike seed={s.id} color="var(--text3)" alpha={0.75} className="block t-headline text-text2 w-fit">
                        <RichText text={s.title} inline />
                      </InkStrike>
                    ) : (
                      <span className="block t-headline"><RichText text={s.title} inline /></span>
                    )}
                    <span className="block t-callout text-text2 mt-0.5"><RichText text={s.reason} inline /></span>
                  </span>
                  <span className="t-number-inline tabular text-text2 shrink-0">{t('plan.min', { count: s.minutes })}</span>
                  {current && (
                    <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                      <Button variant="primary" size="lg" iconRight={<Icon name="arrow-right" size={15} />} onClick={(e) => { e.stopPropagation(); runStep(packId, i) }}>
                        {doneCount ? t('plan.continue') : t('plan.start')}
                      </Button>
                    </motion.span>
                  )}
                </Card>
              </StaggerItem>
            )
          })}
        </div>
        <StaggerItem className="flex justify-center">
          <span className="t-footnote">{t('plan.footer')}</span>
        </StaggerItem>
      </Stagger>
    </StudyFrame>
  )
}
