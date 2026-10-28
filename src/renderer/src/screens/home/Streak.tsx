// Racha: la llamita pixel-art (se mueve cuando la racha está viva), la cifra en serif y los siete días de la semana.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, AnimatedNumber, PixelFlame, cx } from '@renderer/design'
import { weekdayLetters } from '@renderer/lib/format'
import type { HomeSummary } from '@shared/ipc/home'

export function StreakCard({ data }: { data: HomeSummary }) {
  const { t } = useTranslation('home')
  const letters = weekdayLetters()
  const todayIdx = (new Date().getDay() + 6) % 7
  const active = data.streak.days > 0
  return (
    <Card enterAnim className="h-full">
      <div className="flex items-start justify-between">
        <div>
          <div className="t-ui font-semibold text-text2">{t('streak')}</div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-serif text-[44px] leading-[48px] tracking-[-0.02em] tabular">
              <AnimatedNumber value={data.streak.days} />
            </span>
            <span className="t-callout text-text2">{t('streakDays', { count: data.streak.days })}</span>
          </div>
          <div className="t-footnote text-text3">{active ? t('streakBest', { count: data.streak.best }) : t('streakStart')}</div>
        </div>
        <div className="pt-1 pr-1">
          <PixelFlame size={30} lit={active} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 mt-4">
        {letters.map((l, i) => {
          const done = data.streak.week[i]
          const isToday = i === todayIdx
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 439, damping: 22, delay: 0.2 + i * 0.04 }}
                className={cx('h-6 w-full max-w-7 rounded-[7px]', done ? 'bg-accent' : 'bg-fill2', isToday && !done && 'ring-[1.5px] ring-accent-line')}
              />
              <span className={cx('t-caption', isToday && 'text-text font-semibold')}>{l}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
