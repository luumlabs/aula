// Las cifras en frases: minutos de estudio, días con estudio, acierto y racha (serif que cuenta), con la llamita pixel-art.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, AnimatedNumber, PixelFlame, cx } from '@renderer/design'
import { STATS_WINDOW_DAYS, type StatsDay } from '@shared/ipc/stats'
import { streak, totals } from './derive'

export function SummaryCard({ days, today }: { days: StatsDay[]; today: string }) {
  const { t } = useTranslation('stats')
  const tot = totals(days)
  const s = streak(days, today)
  const hours = Math.floor(Math.round(tot.minutes) / 60)
  const mins = Math.round(tot.minutes) % 60
  const details: string[] = []
  if (s.current > 1) details.push(s.best > s.current ? t('summary.streakBest', { current: s.current, best: s.best }) : t('summary.streakIsBest', { current: s.current }))
  else if (s.current === 1 && s.best <= 1) details.push(t('summary.streakOne'))
  else if (s.best > 1) details.push(t('summary.bestOnly', { best: s.best }))
  if (tot.attempts > 0) details.push(t('summary.exercises', { count: tot.attempts }))

  const figures = [
    {
      key: 'time',
      value: (
        <>
          {hours > 0 && (
            <>
              <AnimatedNumber value={hours} />
              <span className="text-[0.55em] text-text2 ml-1 mr-2">h</span>
            </>
          )}
          <AnimatedNumber value={mins} />
          <span className="text-[0.55em] text-text2 ml-1">min</span>
        </>
      ),
      label: t('summary.study')
    },
    {
      key: 'days',
      value: (
        <>
          <AnimatedNumber value={tot.activeDays} />
          <span className="text-[0.55em] text-text2 ml-1.5">/ {STATS_WINDOW_DAYS}</span>
        </>
      ),
      label: t('summary.activeDaysLabel')
    },
    ...(tot.accuracy != null
      ? [
          {
            key: 'acc',
            value: (
              <>
                <AnimatedNumber value={Math.round(tot.accuracy * 100)} />
                <span className="text-[0.55em] text-text2 ml-0.5">%</span>
              </>
            ),
            label: t('summary.accuracy')
          }
        ]
      : []),
    {
      key: 'streak',
      value: (
        <span className="inline-flex items-center gap-2.5">
          <AnimatedNumber value={s.current} />
          <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="inline-block -mt-1">
            <PixelFlame size={26} lit={s.current > 0} />
          </motion.span>
        </span>
      ),
      label: t('summary.streak', { count: s.current })
    }
  ]

  return (
    <Card enterAnim padded={false} className="h-full">
      <div className={cx('grid', figures.length === 4 ? 'grid-cols-2 @3xl:grid-cols-4' : 'grid-cols-3')}>
        {figures.map((f, i) => (
          <div key={f.key} className="relative px-6 pt-6 pb-4">
            {i > 0 && <span aria-hidden className="absolute left-0 top-6 bottom-4 w-[0.5px] bg-line hidden @3xl:block" />}
            <div className="font-serif text-[40px] leading-[46px] tracking-[-0.02em] tabular text-text whitespace-nowrap">{f.value}</div>
            <div className="t-callout text-text2 mt-0.5">{f.label}</div>
          </div>
        ))}
      </div>
      {details.length > 0 && <div className="px-6 pb-5 t-ui text-text2">{details.join(' · ')}</div>}
    </Card>
  )
}
