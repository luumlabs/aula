// Un solo idioma de interfaz para todo el proceso principal: el de la interfaz de Aula. Con «system», el del sistema si es
// español; cualquier otro idioma del sistema (francés, alemán…) es inglés, igual que hace la interfaz (`pickLanguage`).
// Lo fija `src/main/index.ts` antes de registrar los handlers, y lo siguen tr(), el motor (matemáticas, química), las
// listas («A y B» / «A and B»), los documentos, el estudio, los diálogos y el menú.
import { aiLocale, type AILocale } from '@shared/ai/i18n'
import { applyEngineLanguage } from '@engine/language'
import { AppLanguage } from '@engine/base/language'
import { getSettings, onSettingsChange } from './index'

/** 'es' | 'en' a partir de la preferencia guardada ('system', 'es', 'en'…) y del locale del sistema. */
export function resolveUILanguage(pref: string | null | undefined, systemLocale: string | null | undefined): AILocale {
  const code = (pref && pref !== 'system' ? pref : systemLocale || 'en').toLowerCase()
  return code.startsWith('es') ? 'es' : 'en'
}

/** La región del sistema («es-MX» → «MX»), para formatear listas y fechas dentro de las frases. */
function regionOf(locale: string | null | undefined): string | null {
  const m = /^[a-z]{2,3}[-_]([A-Za-z]{2}|\d{3})\b/.exec(locale ?? '')
  return m ? m[1].toUpperCase() : null
}

/** Fija el idioma en todos los módulos que generan textos. Devuelve el idioma elegido. */
export function applyUILanguage(pref: string | null | undefined, systemLocale: string | null | undefined): AILocale {
  const lang = resolveUILanguage(pref, systemLocale)
  applyEngineLanguage(lang)
  AppLanguage.set(lang, regionOf(systemLocale))
  return lang
}

/** Lo llama el arranque una vez: fija el idioma y lo sigue cuando cambian los ajustes. */
export function installUILanguage(systemLocale: () => string): AILocale {
  const lang = applyUILanguage(getSettings().general.language, systemLocale())
  onSettingsChange((next, prev) => {
    if (next.general.language !== prev.general.language) applyUILanguage(next.general.language, systemLocale())
  })
  return lang
}

/** El idioma de la interfaz que usan los textos del proceso principal. */
export function uiLanguage(): AILocale {
  return aiLocale()
}
