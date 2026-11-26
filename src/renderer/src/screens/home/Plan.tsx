// «El plan de hoy»: el hilo une las filas, con un sello de curso junto a cada paso.
import { useTranslation } from 'react-i18next'
import { Card, Group, Row, SectionTitle, DrawnTile, PixelIcon, InkStrike, toneForHue, useTheme } from '@renderer/design'
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
  return (
    <Card variant="sheet" padded={false} className="pt-3">
      <SectionTitle title={t('plan')} detail={total > 0 ? t('planDetail', { minutes: total }) : undefined} />
      {plan.length === 0 ? (
        <p className="t-body text-text2 py-4">{t('planEmpty')}</p>
      ) : (
        <Group plain inset={56} className="aula-plan-thread mt-2">
          {plan.slice(0, 6).map((p, i) => (
            <Row
              key={p.id}
              index={i}
              onClick={() => startPlanItem(p)}
              className={p.done ? 'rounded-[12px] opacity-55' : 'rounded-[12px]'}
              leading={<PlanIcon item={p} dark={dark} />}
              title={
                p.done ? (
                  // hecho: tachado a mano (se dibuja la primera vez que se ve hecho)
                  <InkStrike seed={p.id} className="min-w-0">
                    <span className="block truncate">{p.title}</span>
                  </InkStrike>
                ) : (
                  // en el teléfono, hasta dos líneas: cortado a una («Repasa 4 tarjetas y 8 …») no decía qué tocaba
                  <span className={WRAP}>{p.title}</span>
                )
              }
              subtitle={<span className={WRAP}>{several ? `${p.courseTitle} · ${p.detail}` : p.detail}</span>}
              trailing={`${p.minutes} min`}
              chevron
            />
          ))}
        </Group>
      )}
    </Card>
  )
}

function PlanIcon({ item, dark }: { item: HomePlanItem; dark: boolean }) {
  const tone = toneForHue(item.hue)
  return (
    <DrawnTile seed={item.courseId} size={32} fill={dark ? tone.fillDark : tone.fillLight} ink={dark ? tone.inkDark : tone.inkLight}>
      <PixelIcon icon={item.icon} hue={item.hue} size={23} />
    </DrawnTile>
  )
}
