// Idioma de los mensajes del motor (correcciones, química, matemáticas, tr()): el mismo de la interfaz, en los dos procesos.
import { setMathLanguage } from './math'
import { setChemLanguage } from './chem'
import { setAILocale } from '@shared/ai/i18n'

export type EngineLanguage = 'es' | 'en'

/** «es-ES», «en_US», «system»… → 'es' o 'en' (el resto de idiomas, inglés). */
export function engineLanguage(code: string | null | undefined, fallback = 'en'): EngineLanguage {
  const c = (code && code !== 'system' ? code : fallback).toLowerCase()
  return c.startsWith('es') ? 'es' : 'en'
}

export function applyEngineLanguage(code: string | null | undefined, fallback?: string): EngineLanguage {
  const lang = engineLanguage(code, fallback)
  setMathLanguage(lang)
  setChemLanguage(lang)
  // los textos con tr() (permisos del navegador, errores, avisos) siguen el mismo idioma en los dos procesos
  setAILocale(lang)
  return lang
}
