// Nombres de las secciones de Ajustes, en una sola fuente: los mismos textos que `settings.json → <sección>.title` (es/en).
// Los usan los mensajes del proceso principal, los prompts y las pruebas de los textos, para que «Ajustes → …» lleve
// siempre a una sección que existe. Si cambias un título en settings.json, cámbialo aquí (lo comprueba una prueba).
import { aiLocale, type AILocale } from '../ai/i18n'

export type SettingsSection = 'ai' | 'platforms' | 'memory' | 'data' | 'about' | 'appearance' | 'general' | 'persistent'

export const SETTINGS_TITLE: Record<AILocale, string> = { es: 'Ajustes', en: 'Settings' }

export const SETTINGS_SECTION_NAMES: Record<SettingsSection, Record<AILocale, string>> = {
  ai: { es: 'Tu IA', en: 'Your AI' },
  platforms: { es: 'Tus plataformas', en: 'Your platforms' },
  memory: { es: 'Lo que Aula recuerda', en: 'What Aula remembers' },
  data: { es: 'Privacidad y datos', en: 'Privacy and data' },
  about: { es: 'Acerca de Aula', en: 'About Aula' },
  appearance: { es: 'Apariencia', en: 'Appearance' },
  general: { es: 'Idioma y avisos', en: 'Language and reminders' },
  persistent: { es: 'Aula siempre activa', en: 'Aula always on' }
}

/** «Ajustes → Tu IA» / «Settings → Your AI» (en el idioma de la interfaz si no se indica otro). */
export function settingsPath(section: SettingsSection, lang: AILocale = aiLocale()): string {
  return `${SETTINGS_TITLE[lang]} → ${SETTINGS_SECTION_NAMES[section][lang]}`
}

/** Las dos versiones de la ruta, para escribir mensajes con `tr(…)`. */
export function settingsPaths(section: SettingsSection): { es: string; en: string } {
  return { es: settingsPath(section, 'es'), en: settingsPath(section, 'en') }
}
