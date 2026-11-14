// El idioma de un curso nuevo cuando la petición no dice otro (el chat, el servidor) y el que el asistente cuenta como el de
// siempre: el ajuste `general.courseLanguage`, con 'auto' resuelto igual que en el formulario (`resolveCourseLanguage`). Los
// idiomas preferidos del sistema los da Electron al arrancar (handlers/settings.ts); aquí no se importa electron.
import { aiLocale } from '@shared/ai/i18n'
import { resolveCourseLanguage } from '@shared/settings/courseLanguage'
import { getSettings } from './index'

let source: () => readonly string[] = () => []

/** Lo fija Electron: `app.getPreferredSystemLanguages()`. */
export function setSystemLanguagesSource(fn: () => readonly string[]): void {
  source = fn
}

/** Los idiomas preferidos del sistema («de-DE», «en-US»…), los primeros veinte; vacío si no se saben. */
export function systemLanguages(): string[] {
  try {
    return source().filter((l) => typeof l === 'string' && l.length > 0 && l.length <= 35).slice(0, 20)
  } catch {
    return []
  }
}

/** El idioma de los cursos nuevos («es», «de», «pt-BR»…). */
export function defaultCourseLanguage(): string {
  const g = getSettings().general
  return resolveCourseLanguage(g.courseLanguage, systemLanguages(), g.language, aiLocale())
}
