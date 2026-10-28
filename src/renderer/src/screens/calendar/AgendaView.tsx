// Agenda: los próximos días como lista, con los exámenes destacados y su cuenta atrás. Tocar un evento abre su hoja.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { addDays, isSameDay, startOfDay } from 'date-fns'
import { Button, Card, CourseIcon, EmptyState, Icon, SectionTitle, useTheme, AnimatedNumber, cx } from '@renderer/design'
import type { CalEvent } from './data'
import { useEventColor } from './data'
import { isAssessment, KIND_ICON } from './util'
import { openEventSheet, openNewEventSheet } from './sheet'
import { capitalize, daysUntil, fmtDate, fmtTime, relativeDay } from '@renderer/lib/format'
import { useCourses } from '@renderer/lib/courses'

export function AgendaView({ events }: { events: CalEvent[] }) {
  const { t } = useTranslation('calendar')
  const { dark } = useTheme()
  const color = useEventColor()
  const courses = useCourses((s) => s.courses)
  const from = startOfDay(new Date())
  const upcoming = events.filter((e) => e.start >= from && e.start < addDays(from, 30)).sort((a, b) => a.start.getTime() - b.start.getTime())
  const days: Date[] = []
  for (const e of upcoming) if (!days.some((d) => isSameDay(d, e.start))) days.push(startOfDay(e.start))
  if (!upcoming.length) {
    return (
      <div className="grid h-full min-h-[360px] place-items-center">
        <EmptyState
          title={t('agendaEmpty')}
          body={t('agendaEmptyBody')}
          className="py-6"
          action={<Button variant="secondary" icon={<Icon name="plus" size={14} />} onClick={() => openNewEventSheet()}>{t('newEvent')}</Button>}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-5 pb-6">
      {days.map((d, di) => (
        <motion.section key={d.toISOString()} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: di * 0.04 }}>
          <SectionTitle title={capitalize(relativeDay(d))} detail={capitalize(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))} />
          <div className="flex flex-col gap-2 mt-2">
            {upcoming
              .filter((e) => isSameDay(e.start, d))
              .map((e) => {
                const course = courses.find((c) => c.id === e.packId)
                const big = isAssessment(e)
                const n = daysUntil(e.start)
                return (
                  <Card
                    key={e.id}
                    interactive
                    padded="sm"
                    mark={color(e, dark)}
                    markSize="sm"
                    className="pl-5 cursor-pointer outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]"
                    role="button"
                    tabIndex={0}
                    aria-label={t('openEvent', { title: e.title })}
                    onClick={() => openEventSheet(e.id, e.view)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        openEventSheet(e.id, e.view)
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {course ? <CourseIcon icon={course.icon} hue={course.hue} size={34} radius={10} title={course.title} /> : <span className="grid place-items-center w-[34px] h-[34px] rounded-[10px] bg-tile text-text2"><Icon name={KIND_ICON[e.kind]} size={17} /></span>}
                      <div className="min-w-0 flex-1">
                        <div className={cx(big ? 't-headline' : 't-callout', e.done && 'line-through text-text3')}>{e.title}</div>
                        <div className="t-ui text-text3">
                          {e.allDay ? t('allDayShort') : fmtTime(e.start)} · {t(`kinds.${e.kind}`)}
                          {e.course ? ` · ${e.course}` : ''}
                        </div>
                      </div>
                      {big && n > 1 && (
                        <span className="font-serif text-[30px] leading-none tabular" style={{ color: n <= 3 ? 'var(--accent-text)' : color(e, dark) }}>
                          <AnimatedNumber value={n} />
                          <span className="t-caption ml-1">d</span>
                        </span>
                      )}
                    </div>
                  </Card>
                )
              })}
          </div>
        </motion.section>
      ))}
    </div>
  )
}
