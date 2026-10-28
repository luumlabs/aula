// Vista de semana: rejilla de horas con los eventos como bloques del tono de su curso y la línea de «ahora» en ladrillo.
// Tocar un evento abre su hoja; tocar la cabecera de un día lo elige.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { addDays, isSameDay, startOfWeek } from 'date-fns'
import { Card, InkRing, cx, useTheme } from '@renderer/design'
import type { CalEvent } from './data'
import { useEventColor } from './data'
import { eventsOn, weekOpts } from './util'
import { fmtDate, fmtTime } from '@renderer/lib/format'
import { openEventSheet } from './sheet'

const START_H = 7
const END_H = 23
const HOUR = 52

export function WeekView({ anchor, events, selected, onSelect }: { anchor: Date; events: CalEvent[]; selected: Date; onSelect: (d: Date) => void }) {
  const { t } = useTranslation('calendar')
  const { dark } = useTheme()
  const color = useEventColor()
  const start = startOfWeek(anchor, weekOpts)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const scroller = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  // Al abrir: hacia la hora actual, pero nunca después del primer evento de la semana (ni de las 8:00 si no hay ninguno);
  // así, de noche, se ven las clases de la mañana y no unas horas vacías.
  const firstHour = (() => {
    const end = addDays(start, 7)
    const hs = events.filter((e) => e.start >= start && e.start < end).map((e) => e.start.getHours())
    return hs.length ? Math.min(...hs) : 8
  })()
  const scrolled = useRef(false)
  useEffect(() => {
    if (scrolled.current || !scroller.current) return
    scrolled.current = true
    const h = Math.max(START_H, Math.min(firstHour, new Date().getHours() - 2))
    scroller.current.scrollTo({ top: (h - START_H) * HOUR, behavior: 'smooth' })
  }, [firstHour])
  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i)
  return (
    <Card floating elevation={2} padded={false} className="h-full flex flex-col overflow-hidden">
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b-[0.5px] border-line px-2 py-2">
        <span />
        {days.map((d) => {
          const today = isSameDay(d, now)
          const sel = isSameDay(d, selected)
          const allDay = eventsOn(events, d).filter((e) => e.allDay)
          return (
            <div key={d.toISOString()} className={cx('flex min-w-0 flex-col items-center gap-0.5 rounded-[12px] py-1', sel ? 'bg-selected' : 'hover:bg-fill1')}>
              <button className="flex flex-col items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent-line rounded-[10px] px-2" onClick={() => onSelect(d)} aria-pressed={sel} aria-label={fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
                <span className="t-caption uppercase">{fmtDate(d, { weekday: 'short' }).replace('.', '')}</span>
                {today ? (
                  <InkRing seed="today" size={32} delay={350} className="font-serif text-[17px] tabular text-text">{d.getDate()}</InkRing>
                ) : (
                  <span className="grid place-items-center w-8 h-8 rounded-full font-serif text-[17px] tabular">{d.getDate()}</span>
                )}
              </button>
              {allDay.map((e) => (
                <button key={e.id} onClick={() => openEventSheet(e.id, e.view)} title={e.title} className="w-[90%] truncate rounded-[6px] px-1.5 t-caption text-text text-left hover:brightness-95" style={{ background: `color-mix(in oklab, ${color(e, dark)} 16%, transparent)` }}>
                  {e.title}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      <div ref={scroller} className="relative flex-1 overflow-y-auto px-2">
        <div className="relative grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height: (END_H - START_H + 1) * HOUR }}>
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-2 t-caption tabular -translate-y-1/2" style={{ top: (h - START_H) * HOUR }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d.toISOString()} className="relative border-l-[0.5px] border-line-soft">
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t-[0.5px] border-line-soft" style={{ top: (h - START_H) * HOUR }} />
              ))}
              {eventsOn(events, d)
                .filter((e) => !e.allDay)
                .map((e, i) => {
                  const startH = e.start.getHours() + e.start.getMinutes() / 60
                  const endD = e.end && e.end > e.start ? e.end : new Date(e.start.getTime() + 30 * 60000)
                  const endH = Math.min(END_H + 1, endD.getHours() + endD.getMinutes() / 60 || 24)
                  const height = Math.max(26, (endH - Math.max(START_H, startH)) * HOUR - 3)
                  // los del final del día (23:59) no se salen por abajo: se apoyan en el borde
                  const top = Math.min((Math.max(START_H, startH) - START_H) * HOUR, (END_H - START_H + 1) * HOUR - height - 2)
                  const c = color(e, dark)
                  return (
                    <motion.button
                      key={e.id}
                      onClick={() => {
                        onSelect(d)
                        openEventSheet(e.id, e.view)
                      }}
                      aria-label={t('openEvent', { title: e.title })}
                      title={`${fmtTime(e.start)} · ${e.title}`}
                      initial={{ opacity: 0, scaleY: 0.6 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 + di * 0.03 + i * 0.02 }}
                      whileHover={{ scale: 1.02 }}
                      className="absolute left-1 right-1 origin-top overflow-hidden rounded-[10px] px-2 py-1 text-left"
                      style={{ top, height, background: eventFill(c, dark) }}
                    >
                      <div className={cx('t-ui font-semibold truncate', e.done && 'line-through opacity-60')}>{e.title}</div>
                      {height > 34 && <div className="t-caption truncate">{fmtTime(e.start)}</div>}
                    </motion.button>
                  )
                })}
              {isSameDay(d, now) && now.getHours() >= START_H && now.getHours() <= END_H && (
                <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: (now.getHours() + now.getMinutes() / 60 - START_H) * HOUR }}>
                  <span className="w-2 h-2 -ml-1 rounded-full bg-accent" />
                  <span className="flex-1 h-[1.5px] bg-accent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

/** Fondo de un evento en la rejilla: su color mate y, arriba a la izquierda, una luz quieta del mismo color (como tras un
 *  cristal; sustituye a la raya de 3 px). Un solo color que se desvanece, sin degradados de varios colores. */
function eventFill(c: string, dark: boolean): string {
  const base = `color-mix(in oklab, ${c} ${dark ? 22 : 12}%, var(--surface))`
  const glow = `color-mix(in oklab, ${c} ${dark ? 30 : 26}%, transparent)`
  return `radial-gradient(120% 140% at 0% 0%, ${glow}, transparent 70%), ${base}`
}
