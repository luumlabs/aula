// Aula en el lector con la IA simulada: el texto justo con sus páginas marcadas, el idioma, la imagen de la página solo cuando
// toca, las tarjetas leídas de la respuesta y la tarea completa (con su respuesta a trozos y cancelación).
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChatRequest } from '@shared/ai/types'
import { messageText } from '@shared/ai/types'
import type { DocumentAIUpdate } from '@shared/documents'
import { createFakeModel, setFakeAIScript, setModelOverride } from '../ai'
import { setDataRoot } from '../paths'
import { getLibrary } from '../store'
import { documentAIPrompt, documentAISystem, languageName, runDocumentAI } from './ai'
import { locate } from './locate'
import type { DocumentPages } from './pages'
import { DocumentAIJobs, examContext } from './service'

const DOC: DocumentPages = {
  title: 'Trigonometría',
  pages: [
    'El círculo unitario tiene radio uno. Cada punto es (cos θ, sin θ).',
    'Importante: el periodo del seno es 2π. Esto entra en el examen.',
    'La amplitud de y = A sin x es |A|. Se define la fase como el desplazamiento horizontal.'
  ],
  headings: [undefined, undefined, undefined],
  outline: [{ title: 'Gráficas', page: 2, endPage: 3, level: 0 }],
  ocrPages: new Set()
}

let requests: ChatRequest[] = []
beforeEach(() => {
  requests = []
  setFakeAIScript(null)
})

function script(reply: (r: ChatRequest) => string): void {
  setFakeAIScript((r) => { requests.push(r); return reply(r) })
}

describe('Prompts de Aula en el lector', () => {
  it('el sistema pide el idioma y citar páginas', () => {
    const s = documentAISystem('es')
    expect(s).toContain('Reply in Spanish')
    expect(s).toContain('(p. N)')
    expect(languageName('pt-BR')).toBe('Portuguese')
    expect(languageName('xx')).toBe('the language of the question')
  })

  it('cada acción manda el texto justo, marcado por páginas', () => {
    const page = documentAIPrompt({ type: 'summarizePage', page: 2 }, DOC)
    expect(page).toContain('Summarize page 2')
    expect(page).toContain('[p. 1]')            // la anterior, para el contexto
    expect(page).toContain('[p. 2]')
    expect(page).not.toContain('[p. 3]')
    const chapter = documentAIPrompt({ type: 'summarizeChapter', page: 3 }, DOC)
    expect(chapter).toContain('«Gráficas» (pages 2–3)')
    const chosen = documentAIPrompt({ type: 'summarizeChapter', page: 1, from: 1, to: 1, title: 'Intro' }, DOC)
    expect(chosen).toContain('«Intro» (pages 1–1)')
    const ask = documentAIPrompt({ type: 'ask', question: '¿Cuál es la amplitud?' }, DOC)
    expect(ask).toContain('[p. 3]')
    expect(ask).not.toContain('[p. 1]')
    const explain = documentAIPrompt({ type: 'explain', selection: 'periodo del seno', page: 2 }, DOC)
    expect(explain).toContain('«periodo del seno»')
    expect(documentAIPrompt({ type: 'cards', selection: 'x', page: 1 }, DOC)).toContain('JSON array')
    const exam = documentAIPrompt({ type: 'examFocus' }, DOC, 'Exam: Parcial')
    expect(exam).toContain('What we know about the exam:\nExam: Parcial')
    expect(exam).toContain('Passages that look like exam material')
    expect(documentAIPrompt({ type: 'summarizeDocument' }, DOC)).toContain('(3 pages)')
  })
})

describe('runDocumentAI con la IA simulada', () => {
  it('responde con streaming y lee las páginas citadas', async () => {
    script(() => 'El periodo es $2\\pi$ (p. 2) y la amplitud es |A| (p. 3).')
    const chunks: string[] = []
    const r = await runDocumentAI({ type: 'ask', question: 'periodo' }, DOC, { model: createFakeModel(), language: 'es', onText: (t) => chunks.push(t) })
    expect(r.cited).toEqual([2, 3])
    expect(chunks.at(-1)).toBe(r.text)
    expect(requests).toHaveLength(1)
    expect(messageText(requests[0].messages[0])).toContain('Reply in Spanish')
    expect(requests[0].temperature).toBe(0.3)
  })

  it('manda la imagen de la página solo al resumir la página o explicar (si el modelo ve)', async () => {
    script(() => 'ok (p. 1)')
    const model = createFakeModel()
    await runDocumentAI({ type: 'summarizePage', page: 1 }, DOC, { model, language: 'en', pageImage: 'AAAA' })
    await runDocumentAI({ type: 'ask', question: 'q' }, DOC, { model, language: 'en', pageImage: 'AAAA' })
    const parts = (r: ChatRequest): unknown[] => { const last = r.messages[r.messages.length - 1]; return Array.isArray(last.content) ? last.content : [] }
    expect(parts(requests[0]).some((p) => (p as { type: string }).type === 'image')).toBe(true)
    expect(parts(requests[1]).some((p) => (p as { type: string }).type === 'image')).toBe(false)
  })

  it('lee las tarjetas de la respuesta', async () => {
    script(() => '[{"front": "¿Periodo del seno?", "back": "$2\\\\pi$"}]')
    const r = await runDocumentAI({ type: 'cards', selection: 'periodo', page: 2 }, DOC, { model: createFakeModel(), language: 'es' })
    expect(r.cards).toEqual([{ front: '¿Periodo del seno?', back: '$2\\pi$' }])
  })

  it('una respuesta vacía es un error claro', async () => {
    script(() => '   ')
    await expect(runDocumentAI({ type: 'examFocus' }, DOC, { model: createFakeModel(), language: 'es' })).rejects.toThrow(/Aula no respondió/)
  })
})

describe('DocumentAIJobs', () => {
  let home: string
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'aula-docs-ai-'))
    cpSync(resolve('resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
    setDataRoot(home)
    setModelOverride(createFakeModel)
  })
  afterAll(() => {
    setModelOverride(null)
    rmSync(home, { recursive: true, force: true })
  })

  it('responde por eventos con el examen del curso como contexto', async () => {
    script(() => 'Lo más probable: el círculo unitario (p. 1).')
    const updates: DocumentAIUpdate[] = []
    const done = new Promise<void>((ok) => {
      const jobs = new DocumentAIJobs((u) => { updates.push(u); if (u.done) ok() })
      jobs.start({ ref: { kind: 'source', packId: 'exam-2-math112', sourceId: 'unit-3-notes' }, action: { type: 'examFocus' }, language: 'es' })
    })
    await done
    const last = updates.at(-1)!
    expect(last.error).toBeUndefined()
    expect(last.cited).toEqual([1])
    const prompt = messageText(requests[0].messages[requests[0].messages.length - 1])
    expect(prompt).toContain('What we know about the exam')
    expect(prompt).toContain('Covers chapters 3 and 4')
  })

  it('un documento que no existe da un error, no una excepción', async () => {
    const u = await new Promise<DocumentAIUpdate>((ok) => {
      new DocumentAIJobs((x) => { if (x.done) ok(x) }).start({ ref: { kind: 'import', docId: 'nada' }, action: { type: 'summarizeDocument' }, language: 'es' })
    })
    expect(u.error?.code).toBe('not_found')
  })

  it('el contexto del examen sale del curso', () => {
    const pack = getLibrary().openPack('exam-2-math112')!.loadPack()
    expect(examContext(pack)).toContain('Exam: Exam #2 — Trigonometry')
    expect(examContext(undefined)).toBeUndefined()
  })

  it('un enlace simbólico como original no sirve', () => {
    const store = getLibrary().openPack('exam-2-math112')!
    const dir = join(store.directory, 'sources', 'textbook-4-2')
    try { symlinkSync(join(home, 'Packs'), join(dir, 'fuera.pdf')) } catch { return }
    store.updatePack((p) => { p.sources.find((s) => s.id === 'textbook-4-2')!.filename = 'fuera.pdf' })
    expect(locate({ kind: 'source', packId: 'exam-2-math112', sourceId: 'textbook-4-2' }).filePath).toBeUndefined()
  })
})
