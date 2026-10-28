// Hoy en cifras: tarjetas pendientes, errores por corregir y minutos estudiados (cifras en serif que cuentan).
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, AnimatedNumber, Icon, type IconName } from '@renderer/design'
import type { HomeSummary } from '@shared/ipc/home'
import { navigate } from '@renderer/app/router'

export function TodayStats({ data }: { data: HomeSummary }) {
  const { t } = useTranslation('home')
  const withCards = data.courses.find((c) => c.dueCards > 0)
  const withMistakes = data.courses.find((c) => c.mistakes > 0)
  const items: { icon: IconName; value: number; label: string; go?: () => void }[] = [
    { icon: 'cards', value: data.dueCards, label: t('kinds.cards'), go: withCards ? () => navigate({ name: 'study', id: withCards.id, mode: 'cards' }) : undefined },
    { icon: 'mistakes', value: data.mistakes, label: t('kinds.mistakes'), go: withMistakes ? () => navigate({ name: 'study', id: withMistakes.id, mode: 'mistakes' }) : undefined },
    { icon: 'clock', value: data.today.minutesDone, label: t('minutesToday') }
  ]
  return (
    <Card enterAnim padded={false} className="h-full">
      <div className="grid h-full grid-cols-3">
        {items.map((it, i) => (
          <motion.button
            key={i}
            disabled={!it.go}
            onClick={it.go}
            whileHover={it.go ? { y: -2 } : undefined}
            whileTap={it.go ? { scale: 0.97 } : undefined}
            className="relative flex flex-col items-center justify-center gap-1 py-5 rounded-[22px] enabled:hover:bg-fill1 transition-colors disabled:cursor-default"
          >
            {i > 0 && <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[0.5px] bg-line" />}
            <Icon name={it.icon} size={18} className="text-text3" />
            <span className="t-number mt-1">
              <AnimatedNumber value={it.value} />
            </span>
            <span className="t-caption">{it.label}</span>
          </motion.button>
        ))}
      </div>
    </Card>
  )
}
