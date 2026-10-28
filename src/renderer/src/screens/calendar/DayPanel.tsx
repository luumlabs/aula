// Panel del día elegido: título en serif y sus eventos como tarjetas (con «Preparar este examen» y casillas de tareas).
// Tocar una tarjeta abre su hoja; el «+» añade un evento ese día.
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { isSameDay } from 'date-fns'
import { Button, Card, CourseIcon, Icon, IconButton, PixelCheck, cx, useTheme, pixelBurst } from '@renderer/design'
import type { CalEvent } from './data'
import { toggleTask, useEventColor } from './data'
import { eventsOn, isAssessment, KIND_ICON } from './util'
import { capitalize, fmtDate, fmtTime } from '@renderer/lib/format'
import { useCourses } from '@renderer/lib/courses'
import { navigate } from '@renderer/app/router'
import { openEventSheet, openNewEventSheet } from './sheet'

export { KIND_ICON } from './util'

export function DayPanel({ day, events, onToggled, bare }: { day: Date; events: CalEvent[]; onToggled: (e: CalEvent) => void; bare?: boolean }) {
  const { t } = useTranslation(['calendar', 'common'])
  const list = eventsOn(events, day)
  const isToday = isSameDay(day, new Date())
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className={cx('t-ui font-semibold', isToday ? 'text-accent-text' : 'text-text3')}>{isToday ? t('today') : capitalize(fmtDate(day, { weekday: 'long' }))}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={day.toDateString()} className="t-title1" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              {fmtDate(day, { day: 'numeric', month: 'long' })}
            </motion.div>
          </AnimatePresence>
        </div>
        {!bare && (
          <IconButton label={t('addOnDay', { day: fmtDate(day, { day: 'numeric', month: 'long' }) })} variant="filled" className="mt-1" onClick={() => openNewEventSheet(day)}>
            <Icon name="plus" size={16} />
          </IconButton>
        )}
      </div>
      <div className={cx('mt-4 flex min-h-0 flex-1 flex-col gap-2.5 pb-4 pr-1', !bare && 'overflow-y-auto')}>
        {/* vacío discreto, sin la marca: la marca de Aula queda para el vacío principal (la agenda) */}
        {list.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-[16px] border border-dashed border-line px-4 py-5 text-center">
            <div className="t-callout font-medium text-text2">{t('noEvents')}</div>
            <div className="t-ui text-text3 mt-1">{t('noEventsBody')}</div>
            <button className="mt-2 t-ui font-medium text-accent-text hover:underline underline-offset-2" onClick={() => openNewEventSheet(day)}>
              {t('newEvent')}
            </button>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {list.map((e, i) => (
            <EventCard key={e.id} e={e} index={i} onToggled={onToggled} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function EventCard({ e, index, onToggled }: { e: CalEvent; index: number; onToggled: (e: CalEvent) => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const { dark } = useTheme()
  const color = useEventColor()(e, dark)
  const course = useCourses((s) => s.courses.find((c) => c.id === e.packId))
  const isTask = e.done !== undefined
  const time = e.allDay ? t('allDay') : e.kind === 'assignment' ? t('until', { time: fmtTime(e.start) }) : `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}`
  const open = () => openEventSheet(e.id, e.view)
  return (
    <motion.div layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.28, delay: index * 0.04 }}>
      <Card
        padded="sm"
        mark={color}
        markSize="sm"
        interactive
        className="pl-5 cursor-pointer outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-wash)]"
        role="button"
        tabIndex={0}
        aria-label={t('openEvent', { title: e.title })}
        onClick={open}
        onKeyDown={(ev) => {
          if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) {
            ev.preventDefault()
            open()
          }
        }}
      >
        <div className="flex items-start gap-3">
          {course ? <CourseIcon icon={course.icon} hue={course.hue} size={34} radius={10} title={course.title} /> : <span className="grid place-items-center w-[34px] h-[34px] rounded-[10px] bg-tile text-text2"><Icon name={KIND_ICON[e.kind]} size={17} /></span>}
          <div className="min-w-0 flex-1">
            <div className={cx('t-headline', e.done && 'line-through text-text3')}>{e.title}</div>
            <div className="t-ui text-text2 mt-0.5">{time}</div>
            <div className="t-ui text-text3 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{t(`kinds.${e.kind}`)}</span>
              {e.course && <span>· {e.course}</span>}
              {e.location && <span>· {e.location}</span>}
              {e.platform && <span>· {t('fromPlatform', { platform: e.platform })}</span>}
            </div>
          </div>
          {!e.editable && <Icon name={e.subscription ? 'link' : 'lock'} size={13} className="text-text3 mt-1" />}
          {e.recurring && e.editable && <Icon name="repeat" size={13} className="text-text3 mt-1" />}
        </div>
        {isTask && (
          <button
            className="mt-2.5 ml-[46px] flex items-center gap-2 t-ui text-text2 hover:text-text"
            role="checkbox"
            aria-checked={!!e.done}
            onClick={async (ev) => {
              ev.stopPropagation()
              const el = ev.currentTarget
              if (!e.done) pixelBurst(el, { count: 10, colors: ['var(--success)', 'var(--sun)'] })
              onToggled({ ...e, done: !e.done })
              try {
                await toggleTask(e, !e.done)
              } catch {
                /* modo demostración */
              }
            }}
          >
            <span className={cx('grid place-items-center w-[18px] h-[18px] rounded-[5px] border-[1.5px]', e.done ? 'border-success bg-success-soft' : 'border-line-strong')}>{e.done && <PixelCheck size={11} />}</span>
            {e.done ? t('done') : t('notDone')}
          </button>
        )}
        {isAssessment(e) && e.start > new Date() && (
          <div className="mt-3 ml-[46px]" onClick={(ev) => ev.stopPropagation()}>
            <Button size="sm" variant={e.packId ? 'secondary' : 'primary'} icon={<Icon name="create" size={14} />} onClick={() => (e.packId ? navigate({ name: 'course', id: e.packId }) : navigate({ name: 'create', prefill: { title: e.title, examDate: e.start.toISOString(), eventId: e.id } }))}>
              {e.packId ? course?.title ?? t('preparing') : t('prepare')}
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
