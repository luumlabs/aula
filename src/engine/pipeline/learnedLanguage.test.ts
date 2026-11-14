import { describe, expect, it } from 'vitest'
import { isLanguageCourse } from '@engine/grading/course'
import { learnedLanguage, learnedLanguageFromName, learnedSpeechLanguage } from './learnedLanguage'

describe('el idioma que se aprende', () => {
  it('se deduce del nombre, en cualquiera de los idiomas en que se escriba', () => {
    expect(learnedLanguageFromName('Alemán A2')).toBe('de')
    expect(learnedLanguageFromName('Deutsch A2')).toBe('de')
    expect(learnedLanguageFromName('Inglés B2 — First Certificate')).toBe('en')
    expect(learnedLanguageFromName('Preparar el DELF B1')).toBe('fr')
    expect(learnedLanguageFromName('HSK 3')).toBe('zh-Hans')
    expect(learnedLanguageFromName('JLPT N4: kanji y gramática')).toBe('ja')
    expect(learnedLanguageFromName('Português para viajar ao Brasil')).toBe('pt-BR')
    expect(learnedLanguageFromName('Portugués A1')).toBe('pt')
    expect(learnedLanguageFromName('Nederlands', 'Neerlandés')).toBe('nl')
    expect(learnedLanguageFromName('Türkisch für Anfänger', 'Turco')).toBe('tr')
    expect(learnedLanguageFromName('Cálculo I')).toBeUndefined()
  })

  it('si el nombre dice dos idiomas, el que no es el de las explicaciones', () => {
    expect(learnedLanguageFromName('Spanish for English speakers', '', 'en')).toBe('es')
    expect(learnedLanguageFromName('Inglés para hispanohablantes', '', 'es')).toBe('en')
    expect(learnedLanguageFromName('Learn German in English', '', 'en')).toBe('de')
    // español para extranjeros explicado en español: el que se aprende es el español
    expect(learnedLanguageFromName('Español para extranjeros', '', 'es')).toBe('es')
    // con guion también son dos idiomas (antes «espanol-aleman» no era ninguno)
    expect(learnedLanguageFromName('Vocabulario español-alemán', '', 'es')).toBe('de')
    expect(learnedLanguageFromName('Celpe-Bras', '', 'es')).toBe('pt-BR')
  })

  it('el idioma del público («for Chinese students») no es el que se aprende, aunque se explique en el que se aprende', () => {
    expect(learnedLanguageFromName('English for Spanish speakers', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('English for Chinese', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('Spanish for English speakers', '', 'es')).toBe('es')
    expect(learnedLanguageFromName('English for Spanish-speaking students', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('Korean learners of English', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('Español para personas de habla inglesa', '', 'es')).toBe('es')
    expect(learnedLanguageFromName('Deutsch für Spanisch Sprecher', '', 'de')).toBe('de')
    // «English speaking practice» es practicar inglés, no un público
    expect(learnedLanguageFromName('English speaking practice for Spanish students', '', 'es')).toBe('en')
    // si solo nombra el del «público», es ese («Prácticas para alemán»)
    expect(learnedLanguageFromName('Prácticas para alemán', '', 'es')).toBe('de')
  })

  it('un examen o una escritura dice solo el idioma, aunque el nombre diga otro', () => {
    expect(learnedLanguageFromName('IELTS preparation for Chinese students', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('TOEFL for Japanese speakers', '', 'en')).toBe('en')
    expect(learnedLanguageFromName('Kanji for Chinese speakers', '', 'zh-Hans')).toBe('ja')
    expect(learnedLanguageFromName('Curso de inglés', 'DELF B2', 'es')).toBe('fr')
    // «Cambridge» también examina de otros idiomas: no manda
    expect(learnedLanguageFromName('Cambridge IGCSE French', '', 'en')).toBe('fr')
    // «ele» es «él» en portugués: no manda
    expect(learnedLanguageFromName('Português: ele e ela', '', 'es')).toBe('pt')
  })

  it('manda el que guardó el plan (`examLanguage`); si no, el del nombre', () => {
    expect(learnedLanguage({ title: 'Mi curso de verano', subject: '', language: 'es', examLanguage: 'it' })).toBe('it')
    expect(learnedLanguage({ title: 'Deutsch A2', subject: '', language: 'tr' })).toBe('de')
    expect(learnedLanguage({ title: 'Deutsch A2', subject: '', language: 'tr', examLanguage: '  ' })).toBe('de')
  })

  it('«Deutsch A2» es un curso de idiomas y «Escuchar» lo lee en alemán (antes se escondía)', () => {
    const pack = { title: 'Deutsch A2', subject: '', language: 'es' }
    expect(isLanguageCourse(pack)).toBe(true)
    expect(learnedSpeechLanguage(pack)).toBe('de')
  })

  it('la voz: la del idioma que se aprende, con la región de la voz si hace falta', () => {
    expect(learnedSpeechLanguage({ title: 'Chino mandarín HSK 2', subject: '', language: 'es' })).toBe('zh-CN')
    expect(learnedSpeechLanguage({ title: 'Curso', subject: '', language: 'es', examLanguage: 'nl' })).toBe('nl')
    expect(learnedSpeechLanguage({ title: 'Portugués A1', subject: '', language: 'es' })).toBe('pt')
    // sin idioma que aprender a la vista: la del curso
    expect(learnedSpeechLanguage({ title: 'Vocabulario', subject: '', language: 'zh-Hans' })).toBe('zh-CN')
    expect(learnedSpeechLanguage({ title: 'Vocabulario', subject: '', language: 'fr' })).toBe('fr')
  })
})
