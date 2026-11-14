// Cursos de idiomas: los agentes saben qué idioma se aprende (aparte del de las explicaciones) y el planificador lo guarda en
// `exam_language`.
import { describe, expect, it } from 'vitest'
import { makePack, type Pack } from '@shared/schema'
import { makeRequest, type GenerationRequest } from './model'
import { courseContext, learnedLanguageOf, planPrompt, type PromptCourse } from './prompts'

const course = (pack: Pack): PromptCourse => ({ pack, firstChunk: () => undefined, digests: [] })
const request = (p: Partial<GenerationRequest> & { title: string }): GenerationRequest => makeRequest({ packID: 'p', allowWeb: false, topics: 'x', ...p })

describe('el idioma que se aprende en los prompts', () => {
  it('un curso de idiomas lo dice en el contexto, aparte del idioma de las explicaciones', () => {
    const r = request({ title: 'Deutsch A2', language: 'tr' })
    const s = courseContext(r, course(makePack({ id: 'p', title: 'Deutsch A2', language: 'tr' })), false)
    expect(s).toContain('- Student-facing language: tr (`tr`)')
    expect(s).toMatch(/- Language being learned \(the TARGET language[^)]*\): German \(`de`\)/)
  })

  it('lo que guardó el plan manda sobre el nombre, también fuera de los 12 idiomas de curso', () => {
    const r = request({ title: 'Mi curso de idiomas de verano', language: 'es', goalKind: 'language' })
    const pack = makePack({ id: 'p', title: r.title, examLanguage: 'nl' })
    expect(learnedLanguageOf(r, pack)).toBe('nl')
    expect(courseContext(r, course(pack), false)).toContain('Language being learned (the TARGET language of examples, texts and exercises): Dutch (`nl`)')
  })

  it('en un curso que no es de idiomas no aparece (ni aunque el examen esté en otro idioma)', () => {
    const r = request({ title: 'Cálculo I', language: 'es' })
    const pack = makePack({ id: 'p', title: 'Cálculo I', examLanguage: 'en' })
    expect(learnedLanguageOf(r, pack)).toBeUndefined()
    expect(courseContext(r, course(pack), false)).not.toContain('Language being learned')
    expect(planPrompt(r, course(pack))).not.toContain('exam_language')
  })

  it('el planificador guarda el idioma que se aprende en `exam_language`', () => {
    const r = request({ title: 'Alemán A2', language: 'es' })
    const p = planPrompt(r, course(makePack({ id: 'p', title: 'Alemán A2' })))
    expect(p).toContain('language `es`, `exam_language` = the code of the language being LEARNED (`de`, unless the materials clearly show another one) — never the language of the explanations')
  })

  it('curso de inmersión (se aprende el idioma de las explicaciones): sin «nunca el de las explicaciones», que se contradecía', () => {
    const r = request({ title: 'IELTS Academic', language: 'en' })
    const p = planPrompt(r, course(makePack({ id: 'p', title: r.title, language: 'en' })))
    expect(p).toContain('language `en`, `exam_language` = the code of the language being LEARNED (`en`, unless the materials clearly show another one) — here the same as the explanation language: an immersion course')
    expect(p).not.toContain('never the language of the explanations')
    // con región en uno de los dos también es inmersión
    const pt = request({ title: 'Português do Brasil para estrangeiros', language: 'pt', goalKind: 'language' })
    expect(planPrompt(pt, course(makePack({ id: 'p', title: pt.title, language: 'pt' })))).toContain('(`pt-BR`, unless the materials clearly show another one) — here the same')
  })

  it('«IELTS preparation for Chinese students» explicado en inglés: se aprende inglés, no chino', () => {
    const r = request({ title: 'IELTS preparation for Chinese students', language: 'en' })
    const pack = makePack({ id: 'p', title: r.title, language: 'en' })
    expect(learnedLanguageOf(r, pack)).toBe('en')
    expect(courseContext(r, course(pack), false)).toMatch(/- Language being learned \(the TARGET language[^)]*\): English \(`en`\)/)
  })

  it('si el nombre no dice cuál, el planificador lo decide (y lo guarda igual)', () => {
    const r = request({ title: 'Idiomas para el verano', language: 'es', goalKind: 'language' })
    const pack = makePack({ id: 'p', title: r.title })
    expect(learnedLanguageOf(r, pack)).toBeUndefined()
    expect(planPrompt(r, course(pack))).toContain('`exam_language` = the code of the language being LEARNED (BCP-47, e.g. `de` for German, `en` for English)')
  })
})
