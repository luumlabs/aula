// Tu ritmo: promedio por día con estudio, el mejor día de la semana y la semana más larga (pares clave-valor), y abajo
// los minutos por día de la semana en columnas de píxeles que caen en su sitio.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, SectionTitle, Icon, StaggerItem, Stagger, cx, type IconName } from '@renderer/design'
import { capitalize, fmtDate, fmtMinutes, weekdayLetters } from '@renderer/lib/format'
import type { StatsDay } from '@shared/ipc/stats'
import { heatLevel, keyToDate, rhythm } from './derive'

/** Píxeles de la columna más alta. */
const STACK = 8

export function RhythmCard({ days }: { days: StatsDay[] }) {
  const { t } = useTranslation('stats')
  const r = rhythm(days)
  const items: { icon: IconName; label: string; value: string }[] = []
  if (r.avgActive != null) items.push({ icon: 'clock', label: t('rhythm.avg'), value: fmtMinutes(r.avgActive) })
  if (r.bestWeekday != null) items.push({ icon: 'today', label: t('rhythm.bestDay'), value: weekdayName(r.bestWeekday) })
  if (r.bestWeek) items.push({ icon: 'calendar', label: t('rhythm.bestWeek'), value: t('rhythm.weekOf', { minutes: fmtMinutes(r.bestWeek.minutes), date: fmtDate(keyToDate(r.bestWeek.start), { day: 'numeric', month: 'short' }) }) })
  return (
    <Card enterAnim className="h-full flex flex-col">
      <SectionTitle title={t('rhythm.title')} />
      {items.length === 0 ? (
        <p className="t-body text-text2">{t('rhythm.empty')}</p>
      ) : (
        <>
          <Stagger className="flex flex-col gap-0.5 -mx-3" gap={0.06}>
            {items.map((it) => (
              <StaggerItem key={it.label}>
                <div className="flex items-center gap-3.5 rounded-[14px] px-3 py-2.5 hover:bg-fill1 transition-colors">
                  <span className="grid place-items-center h-9 w-9 rounded-[11px] bg-tile text-text2 shrink-0">
                    <Icon name={it.icon} size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="t-footnote text-text3">{it.label}</div>
                    <div className="font-serif text-[20px] leading-[25px] text-text tabular truncate">{it.value}</div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
          <WeekdayPixels byWeekday={r.byWeekday} best={r.bestWeekday} label={t('rhythm.byWeekday')} />
        </>
      )}
    </Card>
  )
}

/** Minutos por día de la semana como columnas de píxeles (cada píxel con el color del calor de su altura). */
function WeekdayPixels({ byWeekday, best, label }: { byWeekday: number[]; best: number | null; label: string }) {
  const letters = weekdayLetters()
  const max = Math.max(...byWeekday)
  if (!(max > 0)) return null
  return (
    <div className="mt-auto pt-4" role="img" aria-label={label}>
      <div className="t-footnote text-text3 mb-2">{label}</div>
      <div className="grid grid-cols-7 gap-2">
        {byWeekday.map((m, wd) => {
          const n = m > 0 ? Math.max(1, Math.round((m / max) * STACK)) : 0
          return (
            <div key={wd} className="flex flex-col items-center gap-1.5">
              <div className="flex flex-col-reverse gap-[3px] h-[calc(8*11px+7*3px)] justify-start">
                {Array.from({ length: n }, (_, k) => (
                  <motion.span
                    key={k}
                    className="block h-[11px] w-[15px] rounded-[3px]"
                    style={{ background: `var(--heat-${pixelLevel(k)})` }}
                    initial={{ opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 24, delay: 0.35 + wd * 0.05 + k * 0.045 }}
                  />
                ))}
              </div>
              <span className={cx('t-caption', wd === best ? 'text-text font-semibold' : 'text-text3')}>{letters[wd]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** El color sube con la altura: los píxeles de abajo, suaves; los de arriba, intensos. */
function pixelLevel(k: number): number {
  return Math.max(1, heatLevel(((k + 1) / STACK) * 60))
}

/** Nombre del día con el lunes = 0, en el idioma de la interfaz. */
function weekdayName(wd: number): string {
  const monday = new Date(2024, 0, 1, 12)
  return capitalize(fmtDate(new Date(monday.getTime() + wd * 86400000), { weekday: 'long' }))
}
