// Corregir un ejercicio en la interfaz con el corrector del motor (src/engine/grading, puro e isomorfo): instantáneo y
// local. Solo las respuestas abiertas con IA pasan por el proceso principal (`study.gradeOpen`).
import type { Exercise } from '@shared/schema/exercises'
import { correctAnswerMarkdown, grade, type GradeLang } from '@engine/grading'
import { makeResult, type AnswerInput, type GradeResult } from './types'

/** Idioma de los mensajes del corrector: el de la interfaz (es o en). */
export function gradeLang(lang: string | undefined): GradeLang {
  return (lang ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Corrige lo escrito. Nunca lanza: si algo falla, «no se pudo leer». `exactText`: la corrección del curso (idiomas: exacta). */
export function gradeExercise(ex: Exercise, input: AnswerInput, lang?: string, exactText?: boolean): GradeResult {
  try {
    return grade(ex, input, exactText ? { lang: gradeLang(lang), exactText } : { lang: gradeLang(lang) })
  } catch (e) {
    console.warn('[aula] corrector:', e)
    return makeResult('invalid', 0)
  }
}

/** La respuesta correcta en Markdown (con fórmulas). */
export function correctAnswer(ex: Exercise, lang?: string): string {
  try {
    return correctAnswerMarkdown(ex, gradeLang(lang))
  } catch {
    return ''
  }
}
