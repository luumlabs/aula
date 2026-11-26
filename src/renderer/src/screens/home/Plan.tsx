// «El plan de hoy» directamente sobre el papel: hilo vertical de tinta con el estado de cada paso y el icono real
// pintado a mano del curso al lado, despierto al pasar el ratón.
import { useTranslation } from 'react-i18next'
import { Card, Group, Row, DrawnTile, PixelIcon, InkStrike, cx, toneForHue, useTheme } from '@renderer/design'
import type { HomePlanItem } from '@shared/ipc/home'
import { startPlanItem } from './actions'
import { mixesCourses, planLeft } from './derive'

/** Dentro de la fila (una línea con «…»): en el teléfono, hasta dos líneas. */
const WRAP = 'block truncate phone:whitespace-normal phone:line-clamp-2'

export function PlanCard({ plan }: { plan: HomePlanItem[] }) {
  const { t } = useTranslation('home')
  const { dark } = useTheme()
  const total = planLeft(plan).minutes
  const several = mixesCourses(plan)
  const items = plan.slice(0, 6)
  const nextIndex = items.findIndex((p) => !p.done)
  return (
    <Card variant="sheet" padded={false} className="border-t-0 pt-1">
      <div className="mb-2.5">
        <h2 className="aula-section-label t-title2 text-text" style={{ ['--aula-hi' as string]: 'var(--hi-ochre)' }}>
          {t('plan')}
        </h2>
        {total > 0 && <div className="t-footnote mt-1">{t('planDetail', { minutes: total })}</div>}
      </div>
      {plan.length === 0 ? (
        <p className="t-body py-4 text-text2">{t('planEmpty')}</p>
      ) : (
        <Group plain inset={56} className="aula-plan-thread mt-1 -mx-4">
          {items.map((p, i) => {
            const isNow = i === nextIndex
            return (
              <Row
                key={p.id}
                index={i}
                data-pixel-hover
                onClick={() => startPlanItem(p)}
                className={cx('rounded-[14px]', p.done && 'opacity-60')}
                leading={<span aria-hidden className={cx('aula-plan-dot', p.done ? 'is-done' : isNow && 'is-now')} />}
                title={
                  p.done ? (
                    <InkStrike seed={p.id} className="min-w-0">
                      <span className="block truncate">{p.title}</span>
                    </InkStrike>
                  ) : (
                    <span className={cx(WRAP, isNow && 'font-medium')}>{p.title}</span>
                  )
                }
                subtitle={
                  <span className={cx(WRAP, isNow && 'font-serif italic text-accent-text')}>
                    {several ? `${p.courseTitle} · ${p.detail}` : p.detail}
                  </span>
                }
                trailing={
                  <span className="flex items-center gap-3">
                    <span>{p.minutes} min</span>
                    <PlanIcon item={p} dark={dark} />
                  </span>
                }
                chevron
              />
            )
          })}
        </Group>
      )}
    </Card>
  )
}

function PlanIcon({ item, dark }: { item: HomePlanItem; dark: boolean }) {
  const tone = toneForHue(item.hue)
  const fill = dark ? tone.fillDark : tone.fillLight
  const ink = dark ? tone.inkDark : tone.inkLight
  return (
    <DrawnTile
      seed={item.courseId}
      size={34}
      radius={11}
      fill={`color-mix(in oklab, ${fill} ${dark ? 22 : 14}%, var(--paper))`}
      ink={ink}
      inkAlpha={dark ? 0.72 : 0.65}
    >
      <PixelIcon icon={item.icon} hue={item.hue} size={24} />
    </DrawnTile>
  )
}
