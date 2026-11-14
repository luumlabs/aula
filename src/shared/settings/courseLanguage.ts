// El idioma de los cursos nuevos (`general.courseLanguage`): 'auto' o uno de los idiomas en los que Aula escribe cursos. Lo
// resuelven igual el formulario de «Nuevo curso», el servicio que crea cursos (chat, servidor) y el asistente.
import { CourseLanguages } from '@engine/base/language'

/** Lo que puede valer el ajuste: 'auto' o el id de un idioma de curso («es», «pt-BR», «zh-Hans»…). */
export const COURSE_LANGUAGE_CHOICES: readonly string[] = ['auto', ...CourseLanguages.all.map((l) => l.id)]

/** Los idiomas que también tiene la interfaz. */
const UI_LANGUAGES: readonly string[] = ['es', 'en']

/**
 * 'auto': el primer idioma preferido del sistema en el que Aula escribe cursos; si no hay ninguno, el de la interfaz. Si ese
 * idioma del sistema es uno de la interfaz y la persona eligió a mano el otro para la interfaz (sistema en inglés, Aula en
 * español), manda el que eligió. Puro.
 */
export function autoCourseLanguage(systemLanguages: readonly string[], uiPreference: string | undefined, uiLanguage: string): string {
  const first = systemLanguages.map((code) => CourseLanguages.find(code)).find((l) => l !== undefined)
  const turnedDown = !!first && !!uiPreference && uiPreference !== 'system' && UI_LANGUAGES.includes(first.id) && first.id !== uiPreference
  if (first && !turnedDown) return first.id
  return CourseLanguages.find(uiLanguage)?.id ?? 'es'
}

/** El idioma de un curso nuevo cuando no se elige otro: el del ajuste o, con 'auto' (o un valor desconocido), `autoCourseLanguage`. Puro. */
export function resolveCourseLanguage(setting: string | undefined, systemLanguages: readonly string[], uiPreference: string | undefined, uiLanguage: string): string {
  const chosen = setting && setting !== 'auto' ? CourseLanguages.find(setting) : undefined
  return chosen?.id ?? autoCourseLanguage(systemLanguages, uiPreference, uiLanguage)
}
