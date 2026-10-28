// Una fecha de una plataforma de estudio (examen, quiz, tarea o evento), leída de un .ics o de la API de Canvas.
// Portado de CanvasKit/Core/StudyEvent.swift.

export type StudyEventKind = 'exam' | 'quiz' | 'assignment' | 'event' | 'other'

export interface StudyEvent {
  /** Estable dentro de su origen (UID del .ics; `uid#20241014T120000Z` en las repeticiones). */
  id: string
  /** Sin el código de curso entre corchetes del feed de Canvas. */
  title: string
  /** Código corto del curso (`MATH112`) si se conoce. */
  course: string | null
  /** Inicio o fecha límite. En los de todo el día, la medianoche local del primer día. */
  start: Date
  /** Fin (exclusivo en los de todo el día). */
  end: Date | null
  allDay: boolean
  kind: StudyEventKind
  /** Evaluación para la que hay que estudiar (examen, parcial, quiz, prueba). */
  isExam: boolean
  url: string | null
  /** Descripción en texto limpio (Markdown ligero), recortada. */
  descriptionText: string | null
  location: string | null
  /** «ics» o «canvas». */
  source: string
  courseID: number | null
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

/** Orden natural: por inicio y, a igualdad, por título (sin mayúsculas) y por id. */
export function chronological(a: StudyEvent, b: StudyEvent): number {
  const d = a.start.getTime() - b.start.getTime()
  if (d !== 0) return d
  const t = collator.compare(a.title, b.title)
  if (t !== 0) return t
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Recorta un texto largo en un límite de palabra, añadiendo «…». */
export function clipped(text: string | null | undefined, limit = 2000): string | null {
  if (text === null || text === undefined) return null
  const t = text.trim()
  if (!t) return null
  const chars = Array.from(t)
  if (chars.length <= limit) return t
  const prefix = chars.slice(0, limit).join('')
  const cut = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'))
  if (cut >= 0 && Array.from(prefix.slice(0, cut)).length > limit / 2) return prefix.slice(0, cut).trim() + '…'
  return prefix + '…'
}
