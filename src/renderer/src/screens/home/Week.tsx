// «Tu semana»: un calendario pequeño que flota. Hoy en ladrillo, puntos con el tono de cada curso y las fechas más cercanas
// (tocar una abre su hoja, la misma del calendario).
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Card, Companion, Floating, SectionTitle, Icon, InkRing, type IconName } from '@renderer/design'
import type { HomeEvent } from '@shared/ipc/home'
import { capitalize, daysFrom, daysUntil, fmtDate, fmtTime, relativeDay, startOfDay } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { EventSheetHost } from '@renderer/screens/calendar/EventSheet'
import { openEventSheet } from '@renderer/screens/calendar/sheet'
import { SampleTag, showsAsSample } from '@renderer/lib/sample'

export const EVENT_ICONS: Record<HomeEvent['kind'], IconName> = { exam: 'exam', assignment: 'checklist', class: 'users', event: 'calendar', task: 'check-circle', study: 'learn' }
export const EVENT_TONES: Record<HomeEvent['kind'], string> = {
  exam: 'var(--accent)',
  assignment: 'var(--info)',
  class: 'var(--text3)',
  event: 'var(--success)',
  task: 'var(--warning)',
  study: 'var(--sun)'
}

export function WeekCard({ events }: { events: HomeEvent[] }) {
  const { t } = useTranslation(['home', 'common', 'calendar'])
  const today = startOfDay(new Date())
  // días civiles: sumar 24 h repetía el domingo 1 cuando cambia la hora (J2-1)
  const days = daysFrom(today, 7)
  return (
    <Floating amplitude={3} duration={9} className="h-full">
      <Card enterAnim padded="lg" elevation={2} className="h-full flex flex-col">
        <SectionTitle
          title={t('week')}
          action={
            <button className="text-accent-text font-medium hover:underline underline-offset-2" onClick={() => navigate({ name: 'calendar' })}>
              {t('openCalendar')}
            </button>
          }
        />
        <div className="grid grid-cols-7 gap-1 mt-3">
          {days.map((d, i) => {
            const evs = events.filter((e) => daysUntil(e.start, today) === i)
            const isToday = i === 0
            return (
              <motion.button
                key={i}
                onClick={() => navigate({ name: 'calendar', date: d.toISOString() })}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + i * 0.035 }}
                whileHover={{ y: -2 }}
                className="flex flex-col items-center rounded-[12px] py-2 hover:bg-fill1"
              >
                <span className="t-caption uppercase">{fmtDate(d, { weekday: 'short' }).replace('.', '')}</span>
                {isToday ? (
                  // hoy, rodeado a mano con un trazo de pincel ladrillo
                  <InkRing seed="today" size={32} delay={950} className="mt-1 font-serif text-[17px] tabular text-text">{d.getDate()}</InkRing>
                ) : (
                  <span className="mt-1 grid place-items-center w-8 h-8 rounded-full font-serif text-[17px] tabular text-text">{d.getDate()}</span>
                )}
                <span className="flex gap-[3px] h-1.5 mt-1.5">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className="w-[5px] h-[5px] rounded-full" style={{ background: EVENT_TONES[e.kind] }} />
                  ))}
                </span>
              </motion.button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-col">
          {events.length === 0 && <p className="t-callout text-text3 py-3">{t('noEvents')}</p>}
          {events.slice(0, 4).map((e, i) => (
            <motion.button
              key={e.id}
              type="button"
              onClick={() => openEventSheet(e.id)}
              aria-label={t('calendar:openEvent', { title: e.title })}
              className="flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left outline-none hover:bg-fill1 focus-visible:bg-fill1"
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.3 + i * 0.05 }}
            >
              {/* el tipo de evento en una loseta pastel de su color (antes, una raya de color a la izquierda) */}
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px]" style={{ background: `color-mix(in oklab, ${EVENT_TONES[e.kind]} 16%, transparent)`, color: `color-mix(in oklab, ${EVENT_TONES[e.kind]} 80%, var(--text))` }}>
                <Icon name={EVENT_ICONS[e.kind]} size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="t-callout truncate">{e.title}</div>
                <div className="t-ui text-text3 flex items-center gap-1.5 min-w-0">
                  <span className="truncate">
                    {capitalize(relativeDay(e.start))}
                    {!e.allDay && ` · ${fmtTime(e.start)}`}
                  </span>
                  {showsAsSample(e.courseId) && <SampleTag />}
                </div>
              </div>
              <Icon name="chevron-right" size={14} className="text-text3 shrink-0" />
            </motion.button>
          ))}
        </div>
        {/* semana tranquila: el farol invita a apuntar lo que viene (Aula reparte el estudio) */}
        {events.length < 3 && (
          <div className="mt-auto pt-4 flex items-center gap-3">
            <Companion role="planner" size={44} />
            <p className="t-footnote text-text3 flex-1">{t('weekHint')}</p>
            <button className="t-ui text-accent-text font-medium hover:underline underline-offset-2 shrink-0" onClick={() => navigate({ name: 'calendar' })}>
              {t('weekAdd')}
            </button>
          </div>
        )}
      </Card>
      <EventSheetHost />
    </Floating>
  )
}
