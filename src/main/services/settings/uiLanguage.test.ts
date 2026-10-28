import { afterEach, describe, expect, it } from 'vitest'
import { applyUILanguage, resolveUILanguage, uiLanguage } from './uiLanguage'
import { AppLanguage } from '@engine/base/language'
import { tr } from '@shared/ai/i18n'

describe('idioma de la interfaz en el proceso principal', () => {
  afterEach(() => { applyUILanguage('es', 'es-ES') })

  it('resuelve «system» como la interfaz: español solo si el sistema es español', () => {
    expect(resolveUILanguage('system', 'es-MX')).toBe('es')
    expect(resolveUILanguage('system', 'en-US')).toBe('en')
    expect(resolveUILanguage('system', 'fr-FR')).toBe('en')
    expect(resolveUILanguage('system', 'de')).toBe('en')
    expect(resolveUILanguage('system', '')).toBe('en')
    expect(resolveUILanguage('es', 'en-US')).toBe('es')
    expect(resolveUILanguage('en', 'es-ES')).toBe('en')
  })

  it('un Mac en francés con «system» da inglés en tr(), en las listas y en uiLanguage()', () => {
    applyUILanguage('system', 'fr-FR')
    expect(uiLanguage()).toBe('en')
    expect(tr('Hola', 'Hello')).toBe('Hello')
    expect(AppLanguage.list(['Canvas', 'Moodle'])).toBe('Canvas and Moodle')
  })

  it('en español une con «y»', () => {
    applyUILanguage('es', 'es-ES')
    expect(tr('Hola', 'Hello')).toBe('Hola')
    expect(AppLanguage.list(['Canvas', 'Moodle'])).toBe('Canvas y Moodle')
  })
})
