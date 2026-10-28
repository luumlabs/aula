// Calendario: el mes como una hoja de papel que flota (se pasan las páginas al cambiar de mes), la semana con la línea
// de «ahora» y la agenda; a la derecha, el día elegido; abajo, la cápsula para añadir hablando normal. Cada evento abre su
// hoja (verlo, cambiarlo, borrarlo); «Nuevo evento» abre la hoja vacía; el menú de al lado suscribe a calendarios .ics,
// importa un archivo .ics y exporta. En ventanas estrechas (sin el panel del día), tocar un día lo abre en un diálogo.
import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { addDays, addMonths, addWeeks, endOfMonth, startOfMonth, subDays } from 'date-fns'
import { Chip, Dialog, Icon, IconButton, Button, SegmentedTabs, Menu, toast, toneForHue, useTheme } from '@renderer/design'
import { useRoute, navigate } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { api, isAulaError } from '@renderer/lib/api'
import { useCourses } from '@renderer/lib/courses'
import { capitalize, fmtDate, quoted, relativeDay } from '@renderer/lib/format'
import { useCalendarEvents } from './data'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { AgendaView } from './AgendaView'
import { DayPanel } from './DayPanel'
import { QuickAdd } from './QuickAdd'
import { EventSheetHost } from './EventSheet'
import { SubscriptionsDialog } from './Subscriptions'
import { openNewEventSheet, useEventSheet } from './sheet'
import { isAssessment } from './util'
import { showsAsSample } from '@renderer/lib/sample'

type View = 'agenda' | 'week' | 'month'

/** Ancho (px) desde el que se ve el panel del día a la derecha (`@5xl` = 64rem). */
const PANEL_MIN_WIDTH = 1024

/** ¿Cabe el panel del día? (mide el contenedor de la pantalla) */
function useWide(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWide(el.clientWidth >= PANEL_MIN_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, wide]
}

export default function CalendarScreen() {
  const { t } = useTranslation(['calendar', 'common'])
  const route = useRoute()
  const initial = route.name === 'calendar' && route.date ? new Date(route.date) : new Date()
  const [view, setView] = useState<View>(route.name === 'calendar' && route.view ? route.view : 'month')
  const [anchor, setAnchor] = useState(initial)
  const [selected, setSelected] = useState(initial)
  const [dir, setDir] = useState(0)
  const [dayDialog, setDayDialog] = useState<Date | null>(null)
  const [subsOpen, setSubsOpen] = useState(false)
  const [containerRef, wide] = useWide()
  const { dark } = useTheme()
  useScreenTitle(t('title'))
  // con el calendario ya abierto, otra ruta («ver este día», «semana») también se obedece (J2-20)
  const routeDate = route.name === 'calendar' ? route.date : undefined
  const routeView = route.name === 'calendar' ? route.view : undefined
  const firstRoute = useRef(true)
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false
      return
    }
    if (routeView) setView(routeView)
    if (routeDate) {
      const d = new Date(routeDate)
      if (!Number.isNaN(d.getTime())) {
        setAnchor(d)
        setSelected(d)
      }
    }
  }, [routeDate, routeView])

  const range = useMemo(() => ({ from: subDays(startOfMonth(anchor), 7), to: addDays(endOfMonth(addMonths(anchor, 1)), 7) }), [anchor])
  const { events, setEvents, reload } = useCalendarEvents(range.from, range.to)
  const courses = useCourses((s) => s.courses)

  // al abrir la hoja de un evento, el diálogo del día se cierra (si no, la taparía)
  useEffect(() => useEventSheet.subscribe((s) => { if (s.request) setDayDialog(null) }), [])

  const step = (n: number) => {
    setDir(n)
    if (view === 'month') setAnchor((a) => addMonths(a, n))
    else if (view === 'week') setAnchor((a) => addWeeks(a, n))
    else setAnchor((a) => addDays(a, n * 14))
  }
  const goTo = (d: Date) => {
    setDir(d > anchor ? 1 : -1)
    setAnchor(d)
    setSelected(d)
  }
  const goToday = () => goTo(new Date())
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // con una hoja o un diálogo abiertos, las flechas y la «t» son de ellos
      if (useEventSheet.getState().request || subsOpen || dayDialog || document.querySelector('[role="dialog"]')) return
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
      if (e.key.toLowerCase() === 't') goToday()
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openNewEventSheet(selected)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // en ventanas estrechas no hay panel del día: el día se abre en un diálogo
  const selectDay = (d: Date) => {
    setSelected(d)
    if (!wide) setDayDialog(d)
  }
  const moreOnDay = (d: Date) => {
    setSelected(d)
    if (!wide) setDayDialog(d)
  }

  const refreshFeeds = async () => {
    try {
      const r = await api.invoke('calendar.refreshFeeds')
      if (r.platformError) toast.warning(t('refreshFailed'), r.platformError)
      else toast.success(t('refreshed'))
    } catch (err) {
      toast.error(t('refreshFailed'), err instanceof Error ? err.message : String(err))
    }
    void reload()
  }
  const exportICS = async () => {
    try {
      const r = await api.invoke('calendar.exportICS')
      if (r.saved) toast.success(t('exported'), r.path)
    } catch (err) {
      toast.error(t('exportFailed'), err instanceof Error ? err.message : String(err))
    }
  }
  const importICS = async () => {
    try {
      const r = await api.invoke('calendar.importICS')
      if (!r) return
      const file = quoted(r.fileName ?? '.ics')
      const extra = [r.recurring ? t('import.recurring', { count: r.recurring }) : '', r.skipped ? t('import.skipped', { count: r.skipped }) : ''].filter(Boolean).join(' ')
      if (!r.added) return void toast.info(t('import.nothing', { file }), extra || undefined)
      const first = r.firstStart ? new Date(r.firstStart) : null
      if (first) toast.action(t('import.done', { count: r.added, file }), { label: t('import.show'), run: () => { setView('month'); goTo(first) } }, extra || undefined)
      else toast.success(t('import.done', { count: r.added, file }), extra || undefined)
      void reload()
    } catch (err) {
      toast.error(t('import.failed'), isAulaError(err) ? t(`import.errors.${err.code}`, { defaultValue: err.message }) : String(err))
    }
  }

  // el examen de un curso de ejemplo no cuenta en el resumen (A4-P1-1)
  const soon = events.filter((e) => isAssessment(e) && !showsAsSample(e.packId) && e.start > new Date() && e.start < addDays(new Date(), 14)).sort((a, b) => a.start.getTime() - b.start.getTime())
  const summary = soon.length ? t('summary', { count: soon.length, first: soon[0].title, when: relativeDay(soon[0].start).toLowerCase() }) : t('summary_none')
  const legend = courses.filter((c) => events.some((e) => e.packId === c.id))
  const feeds = useMemo(() => {
    const out = new Map<string, boolean>()
    for (const e of events) if (e.platform && !out.has(e.platform)) out.set(e.platform, !!e.subscription)
    return [...out.entries()].map(([label, subscription]) => ({ label, subscription }))
  }, [events])
  const title = capitalize(fmtDate(anchor, { month: 'long', year: 'numeric' }))
  const onToggled = (e: (typeof events)[number]) => setEvents((list) => list.map((x) => (x.id === e.id ? e : x)))

  return (
    <div ref={containerRef} className="@container relative flex min-h-0 flex-1 flex-col px-6 pt-1">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <motion.h1 key={title} className="t-title1 text-[32px] leading-[38px]" initial={{ opacity: 0, y: dir >= 0 ? 8 : -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            {title}
          </motion.h1>
          <p className="t-callout text-text2 mt-1">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label={t('prev')} onClick={() => step(-1)}>
            <Icon name="chevron-left" size={16} />
          </IconButton>
          <Button size="md" onClick={goToday}>
            {t('today')}
          </Button>
          <IconButton label={t('next')} onClick={() => step(1)}>
            <Icon name="chevron-right" size={16} />
          </IconButton>
          <SegmentedTabs value={view} onChange={setView} items={(['agenda', 'week', 'month'] as View[]).map((v) => ({ id: v, label: t(`views.${v}`) }))} className="ml-2" />
          <Button size="md" variant="secondary" icon={<Icon name="plus" size={14} />} onClick={() => openNewEventSheet(selected)} title={t('newEventHint')}>
            {t('newEvent')}
          </Button>
          <Menu
            trigger={(open) => (
              <IconButton label={t('moreActions')} onClick={open}>
                <Icon name="more" size={16} />
              </IconButton>
            )}
            items={[
              { label: t('menu.subscribe'), icon: <Icon name="link" size={15} />, onSelect: () => setSubsOpen(true) },
              { label: t('menu.import'), icon: <Icon name="upload" size={15} />, onSelect: () => void importICS() },
              { label: t('export'), icon: <Icon name="download" size={15} />, onSelect: () => void exportICS() },
              { label: t('refresh'), icon: <Icon name="refresh" size={15} />, onSelect: () => void refreshFeeds(), separatorBefore: true }
            ]}
          />
        </div>
      </div>
      {(legend.length > 0 || feeds.length > 0) && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <div className="flex flex-wrap gap-1.5">
            {legend.map((c) => {
              const tone = toneForHue(c.hue)
              return (
                <Chip key={c.id} onClick={() => navigate({ name: 'course', id: c.id })} icon={<span className="w-2 h-2 rounded-full" style={{ background: dark ? tone.inkDark : tone.inkLight }} />}>
                  {c.title}
                </Chip>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {feeds.map((f) =>
              f.subscription ? (
                <Chip key={f.label} onClick={() => setSubsOpen(true)} icon={<Icon name="link" size={12} />}>
                  {f.label}
                </Chip>
              ) : (
                <Chip key={f.label} icon={<Icon name="plug" size={12} />}>
                  {f.label}
                </Chip>
              )
            )}
          </div>
        </div>
      )}
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-5 pb-24 @5xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-[460px] short:min-h-0">
          {view === 'month' && <MonthView month={anchor} dir={dir} events={events} selected={selected} onSelect={selectDay} onMore={moreOnDay} />}
          {view === 'week' && <WeekView anchor={anchor} events={events} selected={selected} onSelect={selectDay} />}
          {view === 'agenda' && (
            <div className="h-full overflow-y-auto pr-1">
              <AgendaView events={events} />
            </div>
          )}
        </div>
        <div className="min-h-0 @5xl:block hidden">
          <DayPanel day={selected} events={events} onToggled={onToggled} />
        </div>
      </div>
      {/* la cápsula flota abajo; la rejilla deja libre su hueco (pb-24) y en ventanas bajas se encoge para no quedar debajo */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
        <QuickAdd onAdded={() => void reload()} />
      </div>
      <Dialog open={!!dayDialog && !wide} onClose={() => setDayDialog(null)} size="sm">
        {dayDialog && (
          <div className="-mt-1">
            <DayPanel day={dayDialog} events={events} onToggled={onToggled} bare />
            <Button variant="secondary" size="lg" full icon={<Icon name="plus" size={14} />} onClick={() => { const d = dayDialog; setDayDialog(null); openNewEventSheet(d) }}>
              {t('newEvent')}
            </Button>
          </div>
        )}
      </Dialog>
      <SubscriptionsDialog open={subsOpen} onClose={() => setSubsOpen(false)} />
      <EventSheetHost />
    </div>
  )
}
