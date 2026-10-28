// i18n de la interfaz: es (base) y en. Cada pantalla tiene su espacio de nombres en locales/<idioma>/<espacio>.json.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const files = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<string, { default: Record<string, unknown> }>
const resources: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, mod] of Object.entries(files)) {
  const m = /\.\/locales\/([\w-]+)\/([\w-]+)\.json$/.exec(path)
  if (!m) continue
  const [, lang, ns] = m
  ;(resources[lang] ??= {})[ns] = mod.default
}

export const SUPPORTED = ['es', 'en'] as const
export type UILang = (typeof SUPPORTED)[number]

export function pickLanguage(pref: string | undefined, system: string): UILang {
  if (pref === 'es' || pref === 'en') return pref
  const s = (system || 'en').toLowerCase()
  return s.startsWith('es') ? 'es' : 'en'
}

void i18n.use(initReactI18next).init({
  resources,
  lng: pickLanguage(undefined, navigator.language),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: Object.keys(resources.es ?? {}),
  interpolation: { escapeValue: false },
  returnNull: false
})

export function setLanguage(lang: UILang): void {
  if (i18n.language !== lang) void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

export default i18n
