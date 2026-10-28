// «El plan de hoy»: lista agrupada de todos los cursos, ordenada por lo que más sube la nota.
import { useTranslation } from 'react-i18next'
import { Card, CourseIcon, Group, Row, ProgressBar, SectionTitle, Icon, InkStrike, type IconName } from '@renderer/design'
import type { HomePlanItem, PlanKind } from '@shared/ipc/home'
import { startPlanItem } from './actions'

const KIND_ICON: Record<PlanKind, IconName> = { cards: 'cards', mistakes: 'mistakes', learn: 'learn', practice: 'practice', exam: 'exam', review: 'repeat' }

export function PlanCard({ plan, minutesDone, minutesGoal }: { plan: HomePlanItem[]; minutesDone: number; minutesGoal: number }) {
  const { t } = useTranslation('home')
  const total = plan.reduce((a, p) => a + p.minutes, 0)
  return (
    <Card enterAnim padded="lg" className="h-full">
      <SectionTitle
        title={t('plan')}
        detail={plan.length ? t('planDetail', { minutes: total }) : undefined}
        action={
          <div className="flex items-center gap-2.5 text-text2 whitespace-nowrap">
            <span className="tabular">{t('minutesOf', { done: minutesDone, goal: minutesGoal })}</span>
            <ProgressBar value={minutesDone / Math.max(1, minutesGoal)} className="w-20" />
          </div>
        }
      />
      {plan.length === 0 ? (
        <p className="t-body text-text2 py-4">{t('planEmpty')}</p>
      ) : (
        <Group inset={60} className="mt-3 shadow-none!">
          {plan.slice(0, 6).map((p, i) => (
            <Row
              key={p.id}
              index={i}
              onClick={() => startPlanItem(p)}
              className={p.done ? 'opacity-50' : undefined}
              leading={<CourseIcon icon={p.icon} hue={p.hue} size={32} radius={9} title={p.courseTitle} animation="drop" />}
              title={
                <span className="flex items-center gap-1.5 min-w-0">
                  <Icon name={KIND_ICON[p.kind]} size={14} className="text-text3 shrink-0" />
                  {p.done ? (
                    // hecho: tachado a mano (se dibuja la primera vez que se ve hecho)
                    <InkStrike seed={p.id} className="min-w-0">
                      <span className="block truncate">{p.title}</span>
                    </InkStrike>
                  ) : (
                    <span className="truncate">{p.title}</span>
                  )}
                </span>
              }
              subtitle={`${p.courseTitle} · ${p.detail}`}
              trailing={`${p.minutes} min`}
              chevron
            />
          ))}
        </Group>
      )}
    </Card>
  )
}
