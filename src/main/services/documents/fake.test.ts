// Aula en el lector con la IA simulada: cada acción responde con el texto del documento y cita sus páginas (antes, a todo
// «Simulated reply from Aula.»), a trozos; un guion propio de las pruebas sigue mandando.
import { afterEach, describe, expect, it } from 'vitest'
import { citedPages, parseCards } from '@shared/documents'
import { createFakeModel, setFakeAIScript } from '../ai'
import { runDocumentAI } from './ai'
import { fakeDocumentAnswer, splitList, withDocumentFake } from './fake'
import type { DocumentPages } from './pages'

const DOC: DocumentPages = {
  title: 'Exam 2 review sheet',
  pages: [
    'Exam 2 covers chapters 3 and 4: angles in degrees and radians, arc length and sector area, the unit circle, and inverse trigonometric functions.',
    'Answer exactly unless the problem says to round. Rationalize denominators and keep π in radian answers. A graphing calculator is allowed for the problems that ask you to find an angle to the nearest degree.'
  ],
  headings: [undefined, undefined],
  outline: [],
  ocrPages: new Set()
}

afterEach(() => setFakeAIScript(null))

describe('Respuestas simuladas del lector', () => {
  it('una frase con lista: la idea y sus partes', () => {
    expect(splitList('Exam 2 covers chapters 3 and 4: a lot, more things, and the rest.')).toEqual({ lead: 'Exam 2 covers chapters 3 and 4', items: ['A lot', 'More things', 'The rest'] })
    expect(splitList('Answer exactly unless the problem says to round.').items).toEqual([])
  })

  it('resumir la página: su idea con la página citada y lo clave', () => {
    const s = fakeDocumentAnswer({ type: 'summarizePage', page: 1 }, DOC, 'en')
    expect(s).toContain('**The main idea:** Exam 2 covers chapters 3 and 4 (p. 1).')
    expect(s).toContain('- Arc length and sector area')
    expect(citedPages(s, 2)).toEqual([1])
    expect(fakeDocumentAnswer({ type: 'summarizePage', page: 1 }, DOC, 'es')).toContain('**La idea:**')
  })

  it('el documento, el capítulo, el examen, explicar y preguntar citan las páginas de donde sale', () => {
    expect(citedPages(fakeDocumentAnswer({ type: 'summarizeDocument' }, DOC, 'en'), 2)).toEqual([1, 2])
    expect(fakeDocumentAnswer({ type: 'summarizeChapter', page: 2 }, DOC, 'en')).toContain('### Pages 1–2')
    const exam = fakeDocumentAnswer({ type: 'examFocus' }, DOC, 'en')
    expect(exam).toContain('**Most likely on the exam**')
    expect(exam).toContain('the document says it’s on the exam (p. 1)')
    expect(fakeDocumentAnswer({ type: 'explain', selection: 'Rationalize denominators and keep π in radian answers.', page: 2 }, DOC, 'es')).toContain('**En pocas palabras:** Rationalize denominators')
    expect(fakeDocumentAnswer({ type: 'ask', question: 'Can I use a calculator?' }, DOC, 'en')).toContain('A graphing calculator is allowed for the problems that ask you to find an angle to the nearest degree (p. 2)')
    expect(fakeDocumentAnswer({ type: 'ask', question: 'zzzz' }, DOC, 'es')).toContain('No lo encuentro en el documento.')
    expect(fakeDocumentAnswer({ type: 'practice', selection: DOC.pages[1], page: 2 }, DOC, 'es')).toContain('### Solución')
  })

  it('las tarjetas son el JSON que lee el lector', () => {
    const cards = parseCards(fakeDocumentAnswer({ type: 'cards', selection: DOC.pages.join(' '), page: 1 }, DOC, 'en'))
    expect(cards.length).toBeGreaterThanOrEqual(3)
    expect(cards[0]).toEqual({ front: 'Exam 2 covers chapters 3 and 4: what does it include?', back: 'Angles in degrees and radians, Arc length and sector area, The unit circle, Inverse trigonometric functions' })
    expect(cards.slice(1).every((c) => c.front.startsWith('Fill in the blank:') && c.front.includes('___'))).toBe(true)
  })

  it('llega a trozos con la IA simulada; un guion propio (pruebas) o una IA de verdad responden ellos', async () => {
    const action = { type: 'summarizePage', page: 1 } as const
    const chunks: string[] = []
    const r = await runDocumentAI(action, DOC, { model: withDocumentFake(createFakeModel(), action, DOC, 'en', 0), language: 'en', onText: (t) => chunks.push(t) })
    expect(r.text).toBe(fakeDocumentAnswer(action, DOC, 'en'))
    expect(chunks.length).toBeGreaterThan(5)
    expect(r.cited).toEqual([1])
    setFakeAIScript(() => 'guion (p. 2)')
    expect((await runDocumentAI(action, DOC, { model: withDocumentFake(createFakeModel(), action, DOC, 'en', 0), language: 'en' })).text).toBe('guion (p. 2)')
    const real = { ...createFakeModel(), providerId: 'anthropic' }
    expect(withDocumentFake(real, action, DOC, 'en')).toBe(real)
  })

  it('cancelar corta la respuesta', async () => {
    const action = { type: 'summarizeDocument' } as const
    const ctrl = new AbortController()
    const p = runDocumentAI(action, DOC, { model: withDocumentFake(createFakeModel(), action, DOC, 'en', 20), language: 'en', signal: ctrl.signal, onText: () => ctrl.abort() })
    await expect(p).rejects.toThrow()
  })
})
