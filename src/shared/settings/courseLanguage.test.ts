import { describe, expect, it } from 'vitest'
import { defaultSettings } from './index'
import { autoCourseLanguage, COURSE_LANGUAGE_CHOICES, resolveCourseLanguage } from './courseLanguage'

describe('idioma de los cursos nuevos', () => {
  it('por defecto es «auto»', () => {
    expect(defaultSettings().general.courseLanguage).toBe('auto')
    expect(COURSE_LANGUAGE_CHOICES).toContain('auto')
    expect(COURSE_LANGUAGE_CHOICES).toContain('de')
    expect(COURSE_LANGUAGE_CHOICES).toHaveLength(13)
  })

  it('«auto»: el primer idioma del sistema en el que Aula escribe cursos', () => {
    // un alemán con la interfaz en inglés (la interfaz solo tiene es/en): cursos en alemán
    expect(autoCourseLanguage(['de-DE', 'en-US'], 'system', 'en')).toBe('de')
    expect(autoCourseLanguage(['tr-TR', 'pt-PT', 'en'], 'system', 'en')).toBe('pt-BR')
    expect(autoCourseLanguage(['es-419'], 'system', 'es')).toBe('es')
    expect(autoCourseLanguage(['zh-Hant-TW'], 'system', 'en')).toBe('zh-Hans')
    expect(autoCourseLanguage(['de_AT'], 'en', 'en')).toBe('de')
  })

  it('«auto» sin idiomas del sistema que Aula escriba: el de la interfaz', () => {
    expect(autoCourseLanguage([], 'system', 'en')).toBe('en')
    expect(autoCourseLanguage(['tr-TR', 'pl'], 'system', 'es')).toBe('es')
    expect(autoCourseLanguage([], 'system', 'xx')).toBe('es')
  })

  it('«auto» respeta el idioma de la interfaz elegido a mano frente al otro idioma de la interfaz', () => {
    // sistema en inglés y Aula en español a propósito: cursos en español
    expect(autoCourseLanguage(['en-US'], 'es', 'es')).toBe('es')
    expect(autoCourseLanguage(['en-US', 'de-DE'], 'es', 'es')).toBe('es')
    // sistema en español y la interfaz en inglés a propósito
    expect(autoCourseLanguage(['es-ES'], 'en', 'en')).toBe('en')
    // con la interfaz «del sistema», manda el sistema
    expect(autoCourseLanguage(['en-US'], 'system', 'en')).toBe('en')
  })

  it('un idioma elegido manda; «auto» o un valor desconocido se resuelven solos', () => {
    expect(resolveCourseLanguage('fr', ['de-DE'], 'system', 'en')).toBe('fr')
    expect(resolveCourseLanguage('pt-BR', [], 'es', 'es')).toBe('pt-BR')
    expect(resolveCourseLanguage('auto', ['de-DE'], 'system', 'en')).toBe('de')
    expect(resolveCourseLanguage(undefined, ['ja-JP'], 'system', 'en')).toBe('ja')
    expect(resolveCourseLanguage('klingon', [], 'system', 'en')).toBe('en')
  })
})
