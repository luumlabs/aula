// La hoja de un evento: se abre al tocar un evento en cualquier vista (y con «Nuevo evento»). Los propios y la fecha de
// examen de un curso se cambian aquí mismo: nombre, tipo, curso de Aula, cuándo, si se repite, lugar, notas y si la tarea
// está hecha. En una repetición se elige arriba a cuáles afecta el cambio. Lo que viene de una plataforma o de una
// suscripción se enseña de solo lectura, diciendo de dónde viene. Guarda con el mismo servicio que usa el chat.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { CALENDAR_EVENT_KINDS, fullEventID, type CalendarEditScope, type CalendarEventView } from '@shared/calendar'
import {
  emptyEventForm, eventDraftFromForm, eventFormFromView, eventPatchFromForms, isoWeekdayOf, moveFormStart, patchTouchesSeries, type EventForm, type RepeatMode
} from '@engine/calendar/editor'
import { localTimeZone } from '@engine/calendar/time'
import { Button, CourseIcon, Dialog, Drawer, Icon, IconButton, PixelCheck, SegmentedTabs, Select, Spinner, Switch, TextArea, TextField, cx, toast, useTheme, type IconName } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useCourses } from '@renderer/lib/courses'
import { addDays, capitalize, fmtDate, fmtTime, weekdayLetters } from '@renderer/lib/format'
import { navigate } from '@renderer/app/router'
import { fromWire, toggleTask, useEventColor } from './data'
import { useEventSheet, type EventSheetRequest } from './sheet'
import { KIND_ICON } from './util'

const INPUT = 'h-9 rounded-[10px] bg-field border-[0.5px] border-line-strong/40 px-2.5 t-ui text-text tabular outline-none transition focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)] disabled:opacity-50'
const SCOPES: CalendarEditScope[] = ['thisOccurrence', 'thisAndFollowing', 'allOccurrences']

/** La hoja (una para toda la pantalla); se abre con `openEventSheet` / `openNewEventSheet`. */
export function EventSheetHost() {
  const { request, seq, close } = useEventSheet()
  // mientras se cierra, sigue enseñando lo último (si no, la hoja saldría vacía al deslizarse)
  const last = useRef<{ request: EventSheetRequest; seq: number } | null>(null)
  if (request) last.current = { request, seq }
  const [nested, setNested] = useState(false)
  // al salir de la pantalla, la hoja se cierra
  useEffect(() => () => useEventSheet.getState().close(), [])
  return (
    <Drawer open={!!request} onClose={() => !nested && close()} width={440}>
      {last.current && <SheetContent key={last.current.seq} request={last.current.request} onClose={close} onNested={setNested} />}
    </Drawer>
  )
}

function SheetContent({ request, onClose, onNested }: { request: EventSheetRequest; onClose: () => void; onNested: (open: boolean) => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const [view, setView] = useState<CalendarEventView | null | undefined>(request.mode === 'event' ? request.view : undefined)
  useEffect(() => {
    if (request.mode !== 'event' || request.view) return
    let alive = true
    api.invoke('calendar.get', { id: request.id }).then((v) => alive && setView(v), () => alive && setView(null))
    return () => { alive = false }
  }, [request])
  if (request.mode === 'new') return <EventEditor start={request.start} allDay={request.allDay} onClose={onClose} onNested={onNested} />
  if (view === undefined) {
    return (
      <SheetFrame title={t('sheet.loading')} onClose={onClose}>
        <div className="grid place-items-center py-16"><Spinner size={18} /></div>
      </SheetFrame>
    )
  }
  if (view === null) {
    return (
      <SheetFrame title={t('sheet.missingTitle')} onClose={onClose} footer={<Button size="lg" className="ml-auto" onClick={onClose}>{t('common:actions.close')}</Button>}>
        <p className="t-callout text-text2">{t('sheet.missing')}</p>
      </SheetFrame>
    )
  }
  return view.editable ? <EventEditor view={view} onClose={onClose} onNested={onNested} /> : <EventDetails view={view} onClose={onClose} />
}

// MARK: - Piezas

function SheetFrame({ icon, title, subtitle, children, footer, onClose }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const { t } = useTranslation('common')
  return (
    <div className="flex h-full flex-col" data-event-sheet>
      <div className="flex items-start gap-3 px-6 pt-6 pb-4">
        {icon}
        <div className="min-w-0 flex-1">
          <h2 className="t-title2 break-words">{title}</h2>
          {subtitle && <div className="t-ui text-text2 mt-1">{subtitle}</div>}
        </div>
        <IconButton label={t('actions.close')} size="sm" data-close onClick={onClose}>
          <Icon name="close" size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      {footer && <div className="flex items-center gap-2 border-t-[0.5px] border-line px-6 py-4">{footer}</div>}
    </div>
  )
}

function KindTile({ view, kind }: { view?: CalendarEventView; kind: CalendarEventView['kind'] }) {
  const { dark } = useTheme()
  const color = useEventColor()
  const course = useCourses((s) => s.courses.find((c) => c.id === view?.packID))
  if (course) return <CourseIcon icon={course.icon} hue={course.hue} size={40} radius={12} title={course.title} />
  const ev = view ? fromWire(view) : null
  const c = ev ? color(ev, dark) : 'var(--accent)'
  return (
    <span className="grid place-items-center w-10 h-10 shrink-0 rounded-[12px]" style={{ background: `color-mix(in oklab, ${c} 15%, transparent)`, color: c }}>
      <Icon name={KIND_ICON[kind]} size={19} />
    </span>
  )
}

function Field({ label, hint, trailing, children, locked }: { label: ReactNode; hint?: ReactNode; trailing?: ReactNode; children: ReactNode; locked?: boolean }) {
  return (
    <section className="mt-5 first:mt-0">
      <div className="mb-1.5 flex min-h-6 items-center justify-between gap-3">
        <span className="t-ui font-semibold text-text2">{label}</span>
        {trailing}
      </div>
      <div className={cx(locked && 'pointer-events-none opacity-50')} aria-disabled={locked || undefined}>
        {children}
      </div>
      {hint && <p className="t-footnote text-text3 mt-1.5">{hint}</p>}
    </section>
  )
}

function DateInput({ value, onChange, label, min }: { value: string; onChange: (v: string) => void; label: string; min?: string }) {
  return <input type="date" aria-label={label} value={value} min={min} onChange={(e) => e.target.value && onChange(e.target.value)} className={cx(INPUT, 'w-[142px]')} />
}

function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="time" aria-label={label} value={value} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange(e.target.value)} className={cx(INPUT, 'w-[112px]')} />
}

/** Casilla de «Hecha» (la de las tarjetas del día). */
function DoneBox({ done, onToggle, label }: { done: boolean; onToggle: (el: HTMLElement) => void; label: string }) {
  return (
    <button role="checkbox" aria-checked={done} className="flex items-center gap-2 t-ui text-text2 hover:text-text" onClick={(e) => onToggle(e.currentTarget)}>
      <span className={cx('grid place-items-center w-[18px] h-[18px] rounded-[5px] border-[1.5px]', done ? 'border-success bg-success-soft' : 'border-line-strong')}>{done && <PixelCheck size={11} />}</span>
      {label}
    </button>
  )
}

function ErrorNote({ text }: { text: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {text && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-3.5 py-2.5 t-ui text-text">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warning" />
            <span>{text}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** «Lunes, 26 de octubre · 10:00–11:30» (o con los dos días si acaba otro día). */
export function whenText(v: Pick<CalendarEventView, 'start' | 'end' | 'allDay' | 'kind'>, t: (k: string, o?: Record<string, unknown>) => string): string {
  const start = new Date(v.start)
  const end = v.end ? new Date(v.end) : null
  const day = (d: Date) => capitalize(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))
  const short = (d: Date) => fmtDate(d, { day: 'numeric', month: 'short' })
  if (v.allDay) {
    const last = end ? addDays(end, -1) : start
    return last.toDateString() !== start.toDateString() && last > start ? `${short(start)} – ${short(last)} · ${t('allDay')}` : `${day(start)} · ${t('allDay')}`
  }
  if (!end || end <= start) return v.kind === 'assignment' ? `${day(start)} · ${t('until', { time: fmtTime(start) })}` : `${day(start)} · ${fmtTime(start)}`
  if (end.toDateString() !== start.toDateString()) return `${short(start)}, ${fmtTime(start)} – ${short(end)}, ${fmtTime(end)}`
  return `${day(start)} · ${fmtTime(start)}–${fmtTime(end)}`
}

function isUpcomingAssessment(v: Pick<CalendarEventView, 'kind' | 'start'>): boolean {
  return (v.kind === 'exam' || v.kind === 'quiz') && new Date(v.start) > new Date()
}

function prepareExam(v: CalendarEventView): void {
  useEventSheet.getState().close()
  if (v.packID) navigate({ name: 'course', id: v.packID })
  else navigate({ name: 'create', prefill: { title: v.title, examDate: v.start, eventId: fullEventID(v) } })
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

// MARK: - Editar (propios y fecha de examen de un curso)

function EventEditor({ view, start, allDay, onClose, onNested }: { view?: CalendarEventView; start?: Date; allDay?: boolean; onClose: () => void; onNested: (open: boolean) => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const tz = useMemo(() => localTimeZone(), [])
  const courses = useCourses((s) => s.courses)
  const initial = useMemo(() => (view ? eventFormFromView(view, tz) : emptyEventForm(start ?? new Date(), tz, { allDay })), [view, start, allDay, tz])
  const [form, setForm] = useState<EventForm>(initial)
  const [scope, setScope] = useState<CalendarEditScope>('thisOccurrence')
  const [done, setDone] = useState(view?.task?.done ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isNew = !view
  const occurrence = !!view?.occurrenceKey
  const courseExam = view?.origin === 'course'
  const seriesLocked = occurrence && scope === 'thisOccurrence'
  const due = form.kind === 'assignment'
  const letters = weekdayLetters()
  const set = (p: Partial<EventForm>) => setForm((f) => ({ ...f, ...p }))
  const askConfirm = (open: boolean) => { setConfirm(open); onNested(open) }

  // con «solo esta vez», lo que es de toda la serie vuelve a como estaba
  const changeScope = (s: CalendarEditScope) => {
    setScope(s)
    if (s === 'thisOccurrence') set({ repeat: initial.repeat, weekdays: initial.weekdays, until: initial.until, customRule: initial.customRule, isTask: initial.isTask, packID: initial.packID })
  }
  const setStart = (p: Partial<Pick<EventForm, 'startDate' | 'startTime'>>) => setForm((f) => moveFormStart(f, { startDate: p.startDate ?? f.startDate, startTime: p.startTime ?? f.startTime }, tz))
  const plusHour = (date: string, time: string) => {
    const d = new Date(`${date}T${time}`)
    d.setHours(d.getHours() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    return { endDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, endTime: `${p(d.getHours())}:${p(d.getMinutes())}` }
  }
  const setAllDay = (v: boolean) => setForm((f) => (v ? { ...f, allDay: true, hasEnd: false, endDate: f.startDate } : { ...f, allDay: false, hasEnd: true, ...plusHour(f.startDate, f.startTime) }))
  const setRepeat = (r: RepeatMode) => set({ repeat: r, ...(r === 'weekly' && !form.weekdays.length ? { weekdays: [isoWeekdayOf(form.startDate)] } : {}) })
  const toggleDay = (d: number) => set({ weekdays: form.weekdays.includes(d) ? (form.weekdays.length > 1 ? form.weekdays.filter((x) => x !== d) : form.weekdays) : [...form.weekdays, d].sort((a, b) => a - b) })
  const threeMonths = () => {
    const d = new Date(`${form.startDate}T12:00`)
    d.setMonth(d.getMonth() + 3)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const save = async () => {
    if (busy) return
    setError(null)
    if (isNew) {
      const draft = eventDraftFromForm(form, tz)
      if (typeof draft === 'string') return setError(t(`sheet.errors.${draft}`))
      setBusy(true)
      try {
        await api.invoke('calendar.add', draft)
        toast.success(t('added'), draft.title)
        onClose()
      } catch (err) {
        setError(errorText(err))
      } finally {
        setBusy(false)
      }
      return
    }
    const patch = eventPatchFromForms(initial, form, tz)
    if (typeof patch === 'string') return setError(t(`sheet.errors.${patch}`))
    if (seriesLocked && patchTouchesSeries(patch)) return setError(t('sheet.errors.seriesOnly'))
    const id = fullEventID(view)
    const doneChanged = view.isTask && done !== (view.task?.done ?? false)
    if (!Object.keys(patch).length && !doneChanged) return onClose()
    setBusy(true)
    try {
      // «Hecha» antes: guardar «esta y las siguientes» puede cambiar el id de esta repetición
      if (doneChanged) await toggleTask({ id }, done)
      if (Object.keys(patch).length) await api.invoke('calendar.update', { id, patch, ...(occurrence ? { scope } : {}) })
      toast.success(t('sheet.saved'), form.title.trim())
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s?: CalendarEditScope) => {
    if (!view) return
    askConfirm(false)
    setBusy(true)
    try {
      await api.invoke('calendar.delete', { id: fullEventID(view), ...(s ? { scope: s } : {}) })
      toast.success(courseExam ? t('sheet.examDateRemoved') : t('sheet.deleted'), view.title)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const courseTitle = courses.find((c) => c.id === view?.packID)?.title
  const title = isNew ? t('sheet.titleNew') : courseExam ? t('sheet.titleCourseExam') : t('sheet.titleEdit')
  const subtitle = view?.recurrenceText ? (
    <span className="inline-flex items-center gap-1.5"><Icon name="repeat" size={13} />{view.recurrenceText}</span>
  ) : courseExam && courseTitle ? t('sheet.courseExamNote', { course: courseTitle }) : undefined
  const repeatOptions = [
    { value: 'none' as RepeatMode, label: t('sheet.repeatNone') },
    { value: 'daily' as RepeatMode, label: t('sheet.repeatDaily') },
    { value: 'weekly' as RepeatMode, label: t('sheet.repeatWeekly') },
    ...(initial.repeat === 'custom' ? [{ value: 'custom' as RepeatMode, label: t('sheet.repeatCustom'), hint: view?.recurrenceText }] : [])
  ]
  const weekdayNames = Array.from({ length: 7 }, (_, i) => capitalize(fmtDate(new Date(2024, 0, 1 + i), { weekday: 'long' })))

  return (
    <>
      <SheetFrame
        icon={<KindTile view={view} kind={form.kind} />}
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        footer={
          <>
            {view && (
              <Button size="lg" variant="ghost" className="text-danger! -ml-2" icon={<Icon name="trash" size={15} />} onClick={() => askConfirm(true)} disabled={busy}>
                {courseExam ? t('sheet.removeExamDate') : t('sheet.delete')}
              </Button>
            )}
            <span className="flex-1" />
            <Button size="lg" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button size="lg" variant="primary" loading={busy} onClick={() => void save()}>{isNew ? t('sheet.add') : t('common:actions.save')}</Button>
          </>
        }
      >
        <ErrorNote text={error} />
        {occurrence && (
          <Field label={t('sheet.scope')}>
            <SegmentedTabs size="sm" fill value={scope} onChange={changeScope} items={SCOPES.map((s) => ({ id: s, label: t(`sheet.scopes.${s}`) }))} />
          </Field>
        )}
        <Field label={t('sheet.name')}>
          <TextField autoFocus={isNew} value={form.title} placeholder={t('sheet.namePlaceholder')} aria-label={t('sheet.name')} maxLength={200}
            onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </Field>
        {!courseExam && (
          <Field label={t('sheet.kind')}>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('sheet.kind')}>
              {CALENDAR_EVENT_KINDS.map((k) => (
                <button key={k} role="radio" aria-checked={form.kind === k} onClick={() => set({ kind: k, ...(k === 'assignment' ? { isTask: true } : {}) })}
                  className={cx('inline-flex h-7 items-center gap-1.5 rounded-full px-3 t-ui font-medium transition-colors', form.kind === k ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text2 hover:bg-fill3 hover:text-text')}>
                  <Icon name={KIND_ICON[k]} size={13} />
                  {t(`kinds.${k}`)}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={cx('t-ui text-text2', (due || seriesLocked) && 'opacity-50')}>{t('sheet.task')}</span>
              <Switch size="sm" label={t('sheet.task')} checked={form.isTask || due} disabled={due || seriesLocked} onChange={(v) => set({ isTask: v })} />
            </div>
            {view?.isTask && (form.isTask || due) && (
              <div className="mt-2.5">
                <DoneBox done={done} label={done ? t('done') : t('notDone')} onToggle={() => setDone((d) => !d)} />
              </div>
            )}
          </Field>
        )}
        <Field
          label={t('sheet.when')}
          trailing={!courseExam && (
            <span className="flex items-center gap-2 t-ui text-text2">
              {t('allDay')}
              <Switch size="sm" label={t('allDay')} checked={form.allDay} onChange={setAllDay} />
            </span>
          )}
        >
          <div className="grid grid-cols-[76px_1fr] items-center gap-x-3 gap-y-2">
            <span className="t-ui text-text3">{due ? t('sheet.due') : t('sheet.starts')}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <DateInput label={due ? t('sheet.due') : t('sheet.starts')} value={form.startDate} onChange={(d) => setStart({ startDate: d })} />
              {!form.allDay && <TimeInput label={t('sheet.startTime')} value={form.startTime} onChange={(v) => setStart({ startTime: v })} />}
            </span>
            {!due && form.hasEnd && (
              <>
                <span className="t-ui text-text3">{form.allDay ? t('sheet.lastDay') : t('sheet.ends')}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <DateInput label={form.allDay ? t('sheet.lastDay') : t('sheet.ends')} value={form.endDate} min={form.startDate} onChange={(d) => set({ endDate: d })} />
                  {!form.allDay && <TimeInput label={t('sheet.endTime')} value={form.endTime} onChange={(v) => set({ endTime: v })} />}
                  {!courseExam && (
                    <IconButton label={t('sheet.removeEnd')} size="sm" onClick={() => set({ hasEnd: false })}>
                      <Icon name="close" size={13} />
                    </IconButton>
                  )}
                </span>
              </>
            )}
          </div>
          {!due && !form.hasEnd && (
            <button className="mt-2 ml-[88px] inline-flex items-center gap-1.5 t-ui font-medium text-accent-text hover:underline underline-offset-2"
              onClick={() => (form.allDay ? set({ hasEnd: true, endDate: form.startDate }) : set({ hasEnd: true, ...plusHour(form.startDate, form.startTime) }))}>
              <Icon name="plus" size={13} />
              {form.allDay ? t('sheet.addLastDay') : t('sheet.addEnd')}
            </button>
          )}
        </Field>
        {!courseExam && (
          <Field label={t('sheet.repeat')} locked={seriesLocked} hint={seriesLocked ? t('sheet.seriesLocked') : undefined}>
            <Select value={form.repeat} options={repeatOptions} onChange={setRepeat} />
            {form.repeat === 'weekly' && (
              <div className="mt-2.5 flex gap-1.5" role="group" aria-label={t('sheet.repeatOn')}>
                {letters.map((l, i) => {
                  const d = i + 1
                  const on = form.weekdays.includes(d)
                  return (
                    <button key={d} aria-pressed={on} aria-label={weekdayNames[i]} title={weekdayNames[i]} onClick={() => toggleDay(d)}
                      className={cx('grid h-8 w-8 place-items-center rounded-full t-ui font-semibold uppercase transition-colors', on ? 'bg-accent-wash text-accent-text ring-1 ring-accent-line' : 'bg-fill2 text-text2 hover:bg-fill3')}>
                      {l}
                    </button>
                  )
                })}
              </div>
            )}
            {(form.repeat === 'daily' || form.repeat === 'weekly') && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Select className="w-[170px]" value={form.until ? 'until' : 'never'} onChange={(v) => set({ until: v === 'until' ? form.until || threeMonths() : '' })}
                  options={[{ value: 'never', label: t('sheet.repeatForever') }, { value: 'until', label: t('sheet.repeatUntil') }]} />
                {form.until && <DateInput label={t('sheet.repeatUntil')} value={form.until} min={form.startDate} onChange={(d) => set({ until: d })} />}
              </div>
            )}
          </Field>
        )}
        {!courseExam && (
          <Field label={t('sheet.course')} locked={seriesLocked}>
            <Select value={form.packID ?? ''} onChange={(v) => set({ packID: v || null })}
              options={[{ value: '', label: t('sheet.noCourse') }, ...courses.map((c) => ({ value: c.id, label: c.title, icon: <CourseIcon icon={c.icon} hue={c.hue} size={20} radius={6} /> }))]} />
          </Field>
        )}
        <Field label={t('sheet.location')}>
          <TextField value={form.location} placeholder={t('sheet.locationPlaceholder')} aria-label={t('sheet.location')} maxLength={300} onChange={(e) => set({ location: e.target.value })} />
        </Field>
        <Field label={t('sheet.notes')}>
          <TextArea autoGrow rows={3} value={form.notes} placeholder={t('sheet.notesPlaceholder')} aria-label={t('sheet.notes')} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {view && isUpcomingAssessment(view) && (
          <div className="mt-6 flex items-center gap-3 rounded-[16px] bg-sunken px-4 py-3">
            <Icon name="create" size={18} className="text-accent-text shrink-0" />
            <span className="t-ui text-text2 flex-1">{view.packID ? t('sheet.prepareLinked') : t('sheet.prepareHint')}</span>
            <Button size="sm" variant="secondary" onClick={() => prepareExam(view)}>{view.packID ? t('sheet.openCourse') : t('prepare')}</Button>
          </div>
        )}
      </SheetFrame>
      {view && <DeleteDialog open={confirm} view={view} occurrence={occurrence} courseExam={courseExam} onClose={() => askConfirm(false)} onDelete={(s) => void remove(s)} />}
    </>
  )
}

function DeleteDialog({ open, view, occurrence, courseExam, onClose, onDelete }: { open: boolean; view: CalendarEventView; occurrence: boolean; courseExam: boolean; onClose: () => void; onDelete: (s?: CalendarEditScope) => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const title = courseExam ? t('sheet.confirmDelete.titleExam') : t('sheet.confirmDelete.title', { title: view.title })
  const body = courseExam ? t('sheet.confirmDelete.bodyExam') : occurrence ? t('sheet.confirmDelete.bodySeries') : t('sheet.confirmDelete.body')
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={title} description={body}
      footer={occurrence ? (
        <div className="flex w-full flex-col gap-2">
          <Button size="lg" variant="secondary" full className="text-danger!" onClick={() => onDelete('thisOccurrence')}>{t('sheet.confirmDelete.only')}</Button>
          <Button size="lg" variant="secondary" full className="text-danger!" onClick={() => onDelete('thisAndFollowing')}>{t('sheet.confirmDelete.following')}</Button>
          <Button size="lg" variant="danger" full onClick={() => onDelete('allOccurrences')}>{t('sheet.confirmDelete.all')}</Button>
          <Button size="lg" variant="ghost" full onClick={onClose}>{t('common:actions.cancel')}</Button>
        </div>
      ) : (
        <>
          <Button size="lg" variant="ghost" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button size="lg" variant="danger" onClick={() => onDelete()}>{courseExam ? t('sheet.confirmDelete.confirmExam') : t('sheet.confirmDelete.confirm')}</Button>
        </>
      )}
    />
  )
}

// MARK: - Solo lectura (plataformas y suscripciones)

function DetailRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-t-[0.5px] border-line-soft first:border-t-0">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-text3" />
      <div className="min-w-0 flex-1">
        <div className="sr-only">{label}</div>
        <div className="t-callout text-text break-words">{children}</div>
      </div>
    </div>
  )
}

function EventDetails({ view, onClose }: { view: CalendarEventView; onClose: () => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const courses = useCourses((s) => s.courses)
  const [done, setDone] = useState(view.task?.done ?? false)
  const [packID, setPackID] = useState(view.packID ?? '')
  const from = view.platformLabel ?? t('sheet.yourPlatform')
  const note = view.subscriptionID ? t('sheet.readOnlySubscription', { name: from }) : t('sheet.readOnlyPlatform', { platform: from })
  const subtitle = [t(`kinds.${view.kind}`), view.course].filter(Boolean).join(' · ')
  const exam = isUpcomingAssessment(view)

  const toggle = async () => {
    const next = !done
    setDone(next)
    try {
      await toggleTask({ id: fullEventID(view) }, next)
    } catch (err) {
      setDone(!next)
      toast.error(t('sheet.saveFailed'), errorText(err))
    }
  }
  const link = async (v: string) => {
    const before = packID
    setPackID(v)
    try {
      await api.invoke('calendar.link', { eventID: fullEventID(view), packID: v || null })
    } catch (err) {
      setPackID(before)
      toast.error(t('sheet.saveFailed'), errorText(err))
    }
  }

  return (
    <SheetFrame
      icon={<KindTile view={{ ...view, packID: packID || undefined }} kind={view.kind} />}
      title={view.title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <span className="flex-1" />
          {exam ? (
            <>
              <Button size="lg" variant="secondary" onClick={onClose}>{t('common:actions.close')}</Button>
              <Button size="lg" variant="primary" autoFocus icon={<Icon name="create" size={15} />} onClick={() => prepareExam({ ...view, packID: packID || undefined })}>
                {packID ? t('sheet.openCourse') : t('prepare')}
              </Button>
            </>
          ) : (
            <Button size="lg" variant="primary" autoFocus onClick={onClose}>{t('common:actions.close')}</Button>
          )}
        </>
      }
    >
      <div className="flex items-start gap-2.5 rounded-[14px] bg-sunken px-3.5 py-3 t-ui text-text2">
        <Icon name={view.subscriptionID ? 'link' : 'lock'} size={15} className="mt-0.5 shrink-0 text-text3" />
        <span>{note}</span>
      </div>
      <div className="mt-4">
        <DetailRow icon="clock" label={t('sheet.when')}>{whenText(view, t)}</DetailRow>
        {view.recurrenceText && <DetailRow icon="repeat" label={t('sheet.repeat')}>{view.recurrenceText}</DetailRow>}
        {view.location && <DetailRow icon="place" label={t('sheet.location')}>{view.location}</DetailRow>}
        {view.notes && <DetailRow icon="note" label={t('sheet.notes')}><p className="whitespace-pre-wrap t-ui text-text2">{view.notes}</p></DetailRow>}
        {view.url && /^https?:\/\//i.test(view.url) && (
          <DetailRow icon="external" label={t('sheet.link')}>
            <button className="text-accent-text font-medium hover:underline underline-offset-2" onClick={() => void api.invoke('app.openExternal', { url: view.url! })}>
              {view.subscriptionID ? t('sheet.openLinkGeneric') : t('sheet.openLink', { platform: from })}
            </button>
          </DetailRow>
        )}
      </div>
      {view.isTask && (
        <div className="mt-3">
          <DoneBox done={done} label={done ? t('done') : t('notDone')} onToggle={() => void toggle()} />
        </div>
      )}
      <Field label={t('sheet.course')}>
        <Select value={packID} onChange={(v) => void link(v)}
          options={[{ value: '', label: t('sheet.noCourse') }, ...courses.map((c) => ({ value: c.id, label: c.title, icon: <CourseIcon icon={c.icon} hue={c.hue} size={20} radius={6} /> }))]} />
      </Field>
    </SheetFrame>
  )
}
