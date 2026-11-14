// El idioma de los cursos nuevos en el proceso principal: el ajuste, 'auto' con los idiomas del sistema y los settings.json
// de antes (sin el campo), que quedan en 'auto'.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setAILocale } from '@shared/ai/i18n'
import { setDataRoot } from '../paths'
import { getSettings, resetSettingsCache, updateSettings } from './index'
import { defaultCourseLanguage, setSystemLanguagesSource, systemLanguages } from './courseLanguage'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-course-lang-'))
  setDataRoot(root)
  resetSettingsCache()
})
afterEach(() => {
  setSystemLanguagesSource(() => [])
  setAILocale('es')
  resetSettingsCache()
  rmSync(root, { recursive: true, force: true })
})

describe('idioma de los cursos nuevos (proceso principal)', () => {
  it('un settings.json de antes, sin el campo, queda en «auto»', () => {
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: 'en', name: 'Maya' } }))
    expect(getSettings().general.courseLanguage).toBe('auto')
    expect(getSettings().general.name).toBe('Maya')
  })

  it('«auto»: el idioma del sistema; sin él, el de la interfaz', () => {
    setAILocale('en')
    expect(defaultCourseLanguage()).toBe('en')
    setSystemLanguagesSource(() => ['de-DE', 'en-US'])
    expect(defaultCourseLanguage()).toBe('de')
  })

  it('lo elegido manda sobre el sistema', () => {
    setSystemLanguagesSource(() => ['de-DE'])
    updateSettings({ general: { courseLanguage: 'fr' } })
    expect(defaultCourseLanguage()).toBe('fr')
  })

  it('los idiomas del sistema nunca rompen nada', () => {
    setSystemLanguagesSource(() => { throw new Error('sin sistema') })
    expect(systemLanguages()).toEqual([])
    setAILocale('es')
    expect(defaultCourseLanguage()).toBe('es')
    setSystemLanguagesSource(() => ['', 'x'.repeat(80), 'ja-JP'])
    expect(systemLanguages()).toEqual(['ja-JP'])
  })
})
