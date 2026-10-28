// Pruebas del separador decimal e idiomas (port de NumberStyleTests en la app Swift anterior: Tests/BaseKitTests y de las pruebas
// de CourseLanguage en StudyEngineTests).
import { afterEach, describe, expect, it } from 'vitest'
import { AppLanguage, CourseLanguages } from './language'
import { NumberStyle } from './numberStyle'

describe('NumberStyle', () => {
  afterEach(() => {
    NumberStyle.apply('auto')
    NumberStyle.setLocale(null)
  })

  it('separadores forzados', () => {
    NumberStyle.apply('comma')
    expect(NumberStyle.decimalComma).toBe(true)
    expect(NumberStyle.isForced).toBe(true)
    expect(NumberStyle.decimalSeparator).toBe(',')
    expect(NumberStyle.decimal(1.5)).toBe('1,5')
    expect(NumberStyle.localize('3.14')).toBe('3,14')
    NumberStyle.apply('point')
    expect(NumberStyle.decimalComma).toBe(false)
    expect(NumberStyle.decimal(1.5)).toBe('1.5')
    expect(NumberStyle.localize('3.14')).toBe('3.14')
  })

  it('el modo automático sigue a la región', () => {
    NumberStyle.apply('auto')
    expect(NumberStyle.isForced).toBe(false)
    NumberStyle.setLocale('es-ES')
    expect(NumberStyle.decimalComma).toBe(true)
    NumberStyle.setLocale('en-US')
    expect(NumberStyle.decimalComma).toBe(false)
    NumberStyle.apply('cualquier otra cosa')
    expect(NumberStyle.isForced).toBe(false)
  })

  it('redondea y quita los ceros sobrantes', () => {
    NumberStyle.apply('point')
    expect(NumberStyle.decimal(2.0)).toBe('2')
    expect(NumberStyle.decimal(12.04)).toBe('12')
    expect(NumberStyle.decimal(3.85)).toBe('3.9')
    expect(NumberStyle.decimal(-1.5)).toBe('-1.5')
    expect(NumberStyle.decimal(-0.04)).toBe('0') // sin «-0»
    expect(NumberStyle.decimal(1234567.25, 2)).toBe('1234567.25') // sin separador de miles
    expect(NumberStyle.decimal(0.5, 0)).toBe('1')
    expect(NumberStyle.decimal(Number.NaN)).toBe('—')
    expect(NumberStyle.decimal(Infinity)).toBe('∞')
    expect(NumberStyle.decimal(1 / 3, 99)).toBe('0.333333333333333') // a lo sumo 15 decimales
  })
})

describe('AppLanguage', () => {
  afterEach(() => AppLanguage.set('es', null))

  it('sin catálogo es el idioma base', () => {
    expect(AppLanguage.code).toBe('es')
    expect(AppLanguage.locale).toBe('es')
    expect(AppLanguage.list(['«Alfa»', '«Beta»'])).toBe('«Alfa» y «Beta»')
    expect(AppLanguage.list(['a'])).toBe('a')
  })

  it('une con la conjunción del idioma y añade la región', () => {
    AppLanguage.set('en', 'US')
    expect(AppLanguage.locale).toBe('en-US')
    expect(AppLanguage.list(['A', 'B'])).toBe('A and B')
    AppLanguage.set('pt-BR')
    expect(AppLanguage.locale).toBe('pt-BR')
  })
})

describe('CourseLanguages', () => {
  it('encuentra los 12 idiomas por su código', () => {
    expect(CourseLanguages.all).toHaveLength(12)
    expect(CourseLanguages.find('pt')?.id).toBe('pt-BR')
    expect(CourseLanguages.find('zh-Hant-TW')?.id).toBe('zh-Hans')
    expect(CourseLanguages.find('es-MX')?.nativeName).toBe('Español')
    expect(CourseLanguages.find('xx')).toBeUndefined()
    expect(CourseLanguages.of(undefined).id).toBe('es')
    expect(CourseLanguages.preferred(['xx', 'fr-CA', 'en']).id).toBe('fr')
  })

  it('palabras del curso en su idioma', () => {
    expect(CourseLanguages.sectionTitle(CourseLanguages.of('en'), 2)).toBe('Section 2')
    expect(CourseLanguages.examTitle(CourseLanguages.of('es'))).toBe('Examen')
    expect(CourseLanguages.speechLanguage(CourseLanguages.of('zh'))).toBe('zh-CN')
    expect(CourseLanguages.of('ar').isRTL).toBe(true)
  })
})
