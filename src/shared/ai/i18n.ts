// Idioma de los textos que genera la capa de IA (errores, avisos, ayudas). Español por defecto, como la app Swift.
// El proceso principal lo fija con `setAILocale` según los ajustes (la interfaz traduce lo suyo con i18next).
export type AILocale = 'es' | 'en'

let current: AILocale = 'es'

/** Fija el idioma ('es', 'es-ES', 'en-US'…): todo lo que no sea español es inglés. */
export function setAILocale(locale: string | null | undefined): void {
  current = (locale ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function aiLocale(): AILocale {
  return current
}

/** El texto en el idioma actual. */
export function tr(es: string, en: string): string {
  return current === 'en' ? en : es
}

/** Texto en los dos idiomas (ayudas de los presets, que se eligen al mostrarlos). */
export interface Bilingual {
  es: string
  en: string
}

export function pick(text: Bilingual | undefined): string {
  if (!text) return ''
  return current === 'en' ? text.en : text.es
}
