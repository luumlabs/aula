// Lo que la corrección necesita saber del curso: en un curso de idiomas los huecos y las respuestas cortas se corrigen exactos
// (las tildes y la ortografía son lo que se practica), salvo que el ejercicio diga `exact: false`.
import { inferGoalKind, type StudyGoalKind } from '@engine/pipeline/goal'
import type { GradeLang, GradeOptions } from './types'

/** Lo justo del curso (`Pack`). */
export interface CourseForGrading {
  title: string
  subject: string
  /** La clase de meta con la que se creó; en los cursos de antes no está y se deduce del título y la asignatura. */
  goalKind?: StudyGoalKind
}

/** ¿Es un curso de idiomas? */
export function isLanguageCourse(c: CourseForGrading | undefined): boolean {
  if (!c) return false
  return (c.goalKind ?? inferGoalKind(c.title, c.subject)) === 'language'
}

/** Opciones de corrección del curso (con el idioma de los mensajes, si se da). */
export function courseGradeOptions(c: CourseForGrading | undefined, lang?: GradeLang): GradeOptions {
  const o: GradeOptions = {}
  if (lang) o.lang = lang
  if (isLanguageCourse(c)) o.exactText = true
  return o
}
