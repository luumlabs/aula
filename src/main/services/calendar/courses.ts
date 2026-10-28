// Las fechas de examen de los cursos de Aula en el calendario (`origin = 'course'`): cambiarlas cambia la fecha del examen
// del curso; borrarlas la quita (el curso se queda).
import type { Pack } from '@shared/schema'
import { CalendarError, cleanText, makeCalendarEvent, type CalendarEvent, type CalendarEventPatch } from '@engine/calendar'
import { parseISODate } from '@engine/calendar/time'
import type { Library } from '../store/library'

/** Título por defecto del examen de un curso. */
export const DEFAULT_EXAM_TITLE = 'Examen'

/** El examen de un curso como evento (o `null` si no tiene fecha). */
export function courseExamEvent(packID: string, p: Pack): CalendarEvent | null {
  const exam = p.exam
  const date = exam?.date ? parseISODate(exam.date) : null
  if (!exam || !date) return null
  const course = cleanText(p.courseCode) ?? cleanText(p.subject) ?? p.title
  const generic = !exam.title || exam.title === DEFAULT_EXAM_TITLE
  const e = makeCalendarEvent({
    id: `course:${packID}`, title: generic ? p.title : exam.title, kind: 'exam', start: date, course, origin: 'course', packID
  })
  if (exam.durationMinutes !== undefined) e.end = new Date(date.getTime() + exam.durationMinutes * 60_000)
  const notes = cleanText(exam.notes), location = cleanText(exam.location)
  if (notes) e.notes = notes
  if (location) e.location = location
  return e
}

/** Las fechas de examen de todos los cursos. */
export function courseExamEvents(library: Library): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const id of library.packIDs()) {
    const store = library.openPack(id)
    if (!store) continue
    let p: Pack
    try { p = store.loadPack() } catch { continue }
    const e = courseExamEvent(id, p)
    if (e) out.push(e)
  }
  return out
}

/** Cambia la fecha (y el título, las notas, el lugar o la duración) del examen de un curso. */
export function updateCourseExam(library: Library, packID: string, patch: CalendarEventPatch): CalendarEvent {
  const store = library.openPack(packID)
  if (!store) throw CalendarError.notFound('course:' + packID)
  store.updatePack((p) => {
    const e = { ...(p.exam ?? { title: DEFAULT_EXAM_TITLE }) }
    if (patch.start) e.date = patch.start.toISOString()
    const t = cleanText(patch.title)
    if (t !== undefined) e.title = t
    if (patch.notes !== undefined) {
      const n = cleanText(patch.notes)
      if (n === undefined) delete e.notes
      else e.notes = n
    }
    if (patch.location !== undefined) {
      const l = cleanText(patch.location)
      if (l === undefined) delete e.location
      else e.location = l
    }
    const start = e.date ? parseISODate(e.date) : null
    if (patch.end && start && patch.end.getTime() > start.getTime()) e.durationMinutes = Math.floor((patch.end.getTime() - start.getTime()) / 60_000)
    p.exam = e
  })
  const p = store.loadPack()
  const ev = courseExamEvent(packID, p)
  if (!ev) throw CalendarError.notFound('course:' + packID)
  return ev
}

/** Quita la fecha del examen de un curso (el curso se queda). */
export function clearCourseExamDate(library: Library, packID: string): void {
  const store = library.openPack(packID)
  if (!store) throw CalendarError.notFound('course:' + packID)
  store.updatePack((p) => {
    if (p.exam) {
      const e = { ...p.exam }
      delete e.date
      p.exam = e
    }
  })
}
