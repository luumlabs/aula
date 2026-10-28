// Datos del calendario para la interfaz. El motor del calendario (src/main/services/calendar) los da por IPC; si aún no
// está disponible, en modo demostración se usan eventos de ejemplo. Toda conversión vive aquí.
import { useCallback, useEffect, useState } from 'react'
import { fullEventID, type CalendarEventView } from '@shared/calendar'
import { api } from '@renderer/lib/api'
import { demoText as L, isDemo } from '@renderer/lib/demo'
import { useCourses } from '@renderer/lib/courses'
import { toneForHue, toast } from '@renderer/design'
import i18n from '@renderer/i18n'

export type CalKind = 'exam' | 'quiz' | 'assignment' | 'lecture' | 'study' | 'event'

export interface CalEvent {
  id: string
  title: string
  kind: CalKind
  start: Date
  end: Date | null
  allDay: boolean
  /** Código del curso («ÁLG-101») o nombre corto. */
  course?: string
  packId?: string
  origin: 'platform' | 'course' | 'own'
  platform?: string
  location?: string
  notes?: string
  /** Tareas: hecha o no (undefined = no es tarea). */
  done?: boolean
  recurring?: boolean
  editable: boolean
  /** Viene de una suscripción (su id). */
  subscription?: string
  /** Lo que llegó del proceso principal (para abrir su hoja). */
  view: CalendarEventView
}


export function fromWire(raw: CalendarEventView): CalEvent | null {
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.start !== 'string') return null
  return {
    id: fullEventID(raw),
    title: raw.title,
    kind: (['exam', 'quiz', 'assignment', 'lecture', 'study', 'event'].includes(raw.kind) ? raw.kind : 'event') as CalKind,
    start: new Date(raw.start),
    end: typeof raw.end === 'string' ? new Date(raw.end) : null,
    allDay: !!raw.allDay,
    course: raw.course || undefined,
    packId: raw.packID || undefined,
    origin: raw.origin ?? 'own',
    platform: raw.platformLabel || undefined,
    location: raw.location || undefined,
    notes: raw.notes || undefined,
    done: raw.task ? !!raw.task.done : raw.kind === 'assignment' ? false : undefined,
    recurring: !!raw.recurrence,
    editable: raw.origin !== 'platform',
    subscription: raw.subscriptionID || undefined,
    view: raw
  }
}

/** La vista de un evento de ejemplo (modo demostración, sin el proceso principal). */
function demoView(e: Omit<CalEvent, 'view'>): CalendarEventView {
  const v: CalendarEventView = {
    id: e.id, title: e.title, kind: e.kind, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null, allDay: e.allDay, origin: e.origin,
    reminders: [], isTask: e.done !== undefined, editable: e.editable
  }
  if (e.course) v.course = e.course
  if (e.packId) v.packID = e.packId
  if (e.location) v.location = e.location
  if (e.platform) v.platformLabel = e.platform
  if (e.done !== undefined) v.task = { done: e.done }
  return v
}

let warnedProblem: string | undefined

export function useCalendarEvents(from: Date, to: Date) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const key = `${from.toISOString()}|${to.toISOString()}`
  const load = useCallback(async () => {
    try {
      const snap = await api.invoke('calendar.snapshot', { from: from.toISOString(), to: to.toISOString() })
      setEvents(snap.events.map(fromWire).filter((e): e is CalEvent => !!e))
      // A3-P2-9: el calendario no se pudo leer (ni su copia): se avisa al abrirlo, una vez
      if (snap.fileProblem && snap.fileProblem !== warnedProblem) {
        warnedProblem = snap.fileProblem
        toast.warning(i18n.t('calendar:unreadable'), snap.fileProblem)
      }
    } catch {
      if (isDemo()) setEvents(demoEvents())
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    void load()
    return api.on('calendar.changed', () => void load())
  }, [load])
  return { events, loading, reload: load, setEvents }
}

/** Marca o desmarca una tarea (`id` completo: también una repetición o una entrega de una plataforma). */
export async function toggleTask(ev: Pick<CalEvent, 'id'>, done?: boolean): Promise<void> {
  await api.invoke('calendar.toggleTask', { id: ev.id, ...(done !== undefined ? { done } : {}) })
}

export async function quickAdd(text: string, commit: boolean): Promise<{ summary: string; event?: CalEvent } | null> {
  try {
    const r = await api.invoke('calendar.quickAdd', { text, commit })
    if (!r) return null
    return { summary: r.summary ?? '', event: r.event ? fromWire(r.event) ?? undefined : undefined }
  } catch {
    return null
  }
}

/** Color de identidad de un evento: el tono de su curso; si no tiene, uno sobrio según el tipo. */
export function useEventColor(): (e: CalEvent, dark: boolean) => string {
  const courses = useCourses((s) => s.courses)
  return (e, dark) => {
    const c = e.packId ? courses.find((x) => x.id === e.packId) : undefined
    if (c) {
      const tone = toneForHue(c.hue)
      return dark ? tone.inkDark : tone.inkLight
    }
    return e.kind === 'exam' || e.kind === 'quiz' ? 'var(--accent)' : e.kind === 'assignment' ? 'var(--info)' : e.kind === 'study' ? 'var(--sun)' : e.kind === 'lecture' ? 'var(--text3)' : 'var(--success)'
  }
}

function demoEvents(): CalEvent[] {
  const at = (days: number, h: number, m = 0, dur = 60) => {
    const s = new Date()
    s.setDate(s.getDate() + days)
    s.setHours(h, m, 0, 0)
    return { start: s, end: new Date(s.getTime() + dur * 60000) }
  }
  const out: CalEvent[] = []
  let n = 0
  const add = (e: Omit<CalEvent, 'id' | 'editable' | 'view'> & { editable?: boolean }) => {
    const ev = { id: `d${n++}`, editable: e.origin !== 'platform', ...e }
    out.push({ ...ev, view: demoView(ev) })
  }
  for (let w = -3; w <= 4; w++) {
    for (const dow of [1, 3]) {
      const base = new Date()
      const delta = w * 7 + ((dow - base.getDay() + 7) % 7)
      add({ title: L('Clase de MATH 101', 'MATH 101 lecture'), kind: 'lecture', ...at(delta, 11, 0, 75), allDay: false, course: 'MATH 101', packId: 'exam-2-math112', origin: 'platform', platform: 'Canvas', location: L('Aula 2.14', 'Room 214') })
    }
    const thu = (4 - new Date().getDay() + 7) % 7
    add({ title: L('Laboratorio de química', 'Chemistry lab'), kind: 'lecture', ...at(w * 7 + thu, 15, 0, 120), allDay: false, course: 'QUI-110', packId: 'demo-quimica', origin: 'platform', platform: 'Moodle' })
  }
  add({ title: L('Entrega: problemas 4.2', 'Due: problem set 4.2'), kind: 'assignment', ...at(1, 23, 59, 0), allDay: false, course: 'MATH 101', packId: 'exam-2-math112', origin: 'platform', platform: 'Canvas', done: false })
  add({ title: 'Exam #2 · Trigonometry', kind: 'exam', ...at(3, 9, 0, 75), allDay: false, course: 'MATH 101', packId: 'exam-2-math112', origin: 'platform', platform: 'Canvas', location: L('Aula magna', 'Building C · room 104') })
  add({ title: L('Repasar con Ana', 'Study session with Ana'), kind: 'study', ...at(5, 17, 0, 90), allDay: false, origin: 'own' })
  add({ title: L('Examen final de química', 'Chemistry final exam'), kind: 'exam', ...at(9, 10, 0, 120), allDay: false, course: 'QUI-110', packId: 'demo-quimica', origin: 'own' })
  add({ title: L('Informe de laboratorio', 'Lab report'), kind: 'assignment', ...at(6, 23, 59, 0), allDay: false, course: 'QUI-110', packId: 'demo-quimica', origin: 'platform', platform: 'Moodle', done: true })
  add({ title: L('Speaking test', 'Oral exam'), kind: 'quiz', ...at(16, 12, 0, 30), allDay: false, course: L('ENG B2', 'SPAN 201'), packId: 'demo-ingles', origin: 'own' })
  add({ title: L('Quiz de vocabulario', 'Vocabulary quiz'), kind: 'quiz', ...at(-4, 9, 0, 20), allDay: false, course: L('ENG B2', 'SPAN 201'), packId: 'demo-ingles', origin: 'own' })
  add({ title: L('Día del estudiante', 'Student day'), kind: 'event', ...at(12, 0), allDay: true, origin: 'own' })
  return out
}
