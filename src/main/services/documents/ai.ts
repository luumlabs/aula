// Aula en el lector de documentos (port de DocumentAI.swift): acciones de un clic sobre lo que el estudiante está leyendo —
// resumir la página o el capítulo, explicar una selección, responder citando páginas, sacar tarjetas o ejercicios de una
// selección y señalar lo que probablemente entra en el examen. Una sola llamada a la IA (sin herramientas) con el texto justo,
// marcado por páginas «[p. N]» para que cite.
import type { DocumentAIAction } from '@shared/documents'
import { citedPages, parseCards } from '@shared/documents'
import type { ImagePart } from '@shared/ai/types'
import { AIError, streamText, type ChatModel } from '../ai'
import { digestFold, digestWords, makeDigest } from './digest'
import { chapterContaining, excerpt, pageText, type DocumentPages } from './pages'

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  zh: 'Chinese (Simplified)', 'zh-hans': 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', ca: 'Catalan', nl: 'Dutch', pl: 'Polish', tr: 'Turkish'
}

/** «es» → «Spanish» (los prompts van en inglés, como en la app Swift). */
export function languageName(code: string): string {
  const c = (code || 'en').toLowerCase()
  return LANGUAGE_NAMES[c] ?? LANGUAGE_NAMES[c.split(/[-_]/)[0]] ?? 'the language of the question'
}

const take = (s: string, n: number): string => Array.from(s).slice(0, n).join('')

/** Prompt del sistema: Aula, en el idioma pedido, solo con el texto del documento y citando páginas. */
export function documentAISystem(language: string): string {
  return `You are **Aula**, the study companion inside the Aula app (your name is Aula). The student is reading a document in Aula's reader and asked you something about it. Reply in ${languageName(language)}. Be clear, concrete and well structured (short headings or bullets when useful). Math in LaTeX: inline $…$, display $$…$$.
- Use ONLY the document text you are given (it is marked by pages as [p. N]). Cite pages as (p. N) right after each claim so the student can jump there.
- If the text does not contain the answer, say so plainly; you may add general knowledge only if you flag it as "fuera del documento" (in the reply language).
- Never invent quotes, page numbers or what the professor said.
- This is for studying: explain and help them understand; do not write work for them to hand in.`
}

/** Lo esencial de un tramo largo: índice, frases clave por página y pistas de examen. */
export function digestText(doc: DocumentPages, range: [number, number], signals = 16): string {
  const n = range[1] - range[0] + 1
  const d = makeDigest(doc, range, n <= 20 ? 3 : n <= 60 ? 2 : 1, signals)
  let s = ''
  const outline = doc.outline.filter((e) => e.page >= range[0] && e.page <= range[1])
  if (outline.length) s += 'Outline:\n' + outline.slice(0, 50).map((e) => `- ${e.title} (p. ${e.page})`).join('\n') + '\n\n'
  s += 'Key sentences by page:\n'
  let budget = 18_000
  for (const { page, lines } of d.pages) {
    const t = `[p. ${page}] ` + lines.map((l) => l.text).join(' ') + '\n'
    budget -= t.length
    if (budget < 0) { s += '…\n'; break }
    s += t
  }
  if (d.examSignals.length) s += '\nPassages that look like exam material:\n' + d.examSignals.map((l) => `[p. ${l.page}] ${l.text}`).join('\n')
  return s
}

/** Las páginas que más tienen que ver con una pregunta (sus palabras en el texto), con su texto. */
export function retrieve(doc: DocumentPages, q: string, maxChars = 14_000): string {
  const terms = digestWords(q)
  const scored: [number, number][] = []
  for (let p = 1; p <= Math.max(1, doc.pages.length); p++) {
    const t = digestFold(pageText(doc, p))
    if (!t) continue
    let sc = 0
    for (const w of terms) {
      const n = t.split(w).length - 1
      if (n > 0) sc += 1 + Math.log(n)
    }
    if (sc > 0) scored.push([p, sc])
  }
  const top = scored.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p).sort((a, b) => a - b)
  if (!top.length) return digestText(doc, [1, Math.max(1, doc.pages.length)])
  let s = ''
  for (const p of top) {
    const piece = `[p. ${p}]\n${pageText(doc, p)}\n\n`
    if (s.length + piece.length > maxChars) { s += piece.slice(0, Math.max(0, maxChars - s.length)); break }
    s += piece
  }
  return s
}

/** El mensaje para la IA de cada acción (los mismos textos que la app Swift). */
export function documentAIPrompt(action: DocumentAIAction, doc: DocumentPages, examContext?: string): string {
  const title = doc.title
  const count = doc.pages.length
  const pages = (a: number, b: number, max = 14_000): string => excerpt(doc, a, b, max).text
  switch (action.type) {
    case 'summarizePage': {
      const p = action.page
      return `Document: «${title}» (${count} pages).\n\nSummarize page ${p} for studying: the main idea in one sentence, then the key points (definitions, formulas, examples) as bullets, citing (p. ${p}). If the page continues an idea from the previous page, use it for context.\n\n` + pages(Math.max(1, p - 1), p, 9000)
    }
    case 'summarizeChapter': {
      const ch = action.from !== undefined && action.to !== undefined ? { title: action.title, page: action.from, endPage: action.to } : chapterContaining(doc, action.page)
      const a = Math.max(1, ch?.page ?? Math.max(1, action.page - 2)), b = Math.min(count, ch?.endPage ?? Math.min(count, action.page + 4))
      const text = b - a <= 10 ? pages(a, b, 22_000) : digestText(doc, [a, b])
      const what = ch?.title ? `the chapter «${ch.title}» (pages ${a}–${b})` : `pages ${a}–${b}`
      return `Document: «${title}». Summarize ${what} for studying: structure with short headings, key ideas, definitions and formulas, and a final list of 3–6 review questions, titled in the reply language (“To review”, «Para repasar»…),. Cite pages.\n\n` + text
    }
    case 'summarizeDocument': {
      const text = count <= 8 ? pages(1, count, 24_000) : digestText(doc, [1, Math.max(1, count)])
      return `Document: «${title}» (${count} pages). Summarize the whole document for studying: what it is, its structure (with page ranges), the key ideas, definitions and formulas, and a final list of 4–6 review questions, titled in the reply language (“To review”, «Para repasar»…),. Cite pages.\n\n` + text
    }
    case 'explain':
      return `Document: «${title}». The student selected this passage on page ${action.page} and wants it explained simply, step by step, with an example if it helps:\n\n«${take(action.selection, 3000)}»\n\nContext (the page):\n\n` + pages(action.page, action.page, 6000) + '\n\nExplain it so they really understand. End with one short question to check understanding.'
    case 'ask':
      return `Document: «${title}» (${count} pages). The student asks:\n\n${action.question}\n\nRelevant pages:\n\n` + retrieve(doc, action.question) + "\n\nAnswer citing pages (p. N). If the pages above don't answer it, say which part of the document might (from the outline) or that it is not in the document."
    case 'cards':
      return `Document: «${title}», page ${action.page}. Make 3–6 flashcards (one idea each, question on the front, short answer on the back; $LaTeX$ for math) from this passage:\n\n«${take(action.selection, 4000)}»\n\nReply ONLY with a JSON array, no other text: [{"front": "…", "back": "…"}]`
    case 'practice':
      return `Document: «${title}», page ${action.page}. Write 3 practice questions about this passage (one easy, one medium, one exam-like), each with its answer and a one-line explanation hidden under a «Solución» heading at the end:\n\n«${take(action.selection, 4000)}»`
    case 'examFocus': {
      let s = `Document: «${title}» (${count} pages). Which parts are most likely to be on the exam? Give a ranked list (5–10 items): what, why (definition, emphasized, formula, typical question…), and the page (p. N). Then 3 example exam questions.\n`
      if (examContext) s += `\nWhat we know about the exam:\n${examContext}\n`
      return s + '\n' + digestText(doc, [1, Math.max(1, count)], 24)
    }
  }
}

/** ¿La acción lleva la imagen de la página (si el modelo ve)? Solo resumir la página y explicar (como en Swift). */
export function actionWantsPageImage(action: DocumentAIAction): boolean {
  return action.type === 'summarizePage' || action.type === 'explain'
}

export interface DocumentAIRunOptions {
  model: ChatModel
  language: string
  examContext?: string
  /** JPEG de la página (base64). Solo se manda si el modelo ve. */
  pageImage?: string
  signal?: AbortSignal
  /** Texto acumulado mientras llega. */
  onText?: (text: string) => void
}

export interface DocumentAIResult {
  text: string
  cards: { front: string; back: string }[]
  cited: number[]
}

/** Pide a Aula la acción sobre el documento (una llamada, con streaming). Lanza `AIError` si la IA no devuelve nada. */
export async function runDocumentAI(action: DocumentAIAction, doc: DocumentPages, opts: DocumentAIRunOptions): Promise<DocumentAIResult> {
  const images: ImagePart[] = opts.pageImage && actionWantsPageImage(action) && opts.model.capabilities.vision ? [{ mediaType: 'image/jpeg', base64: opts.pageImage }] : []
  let acc = ''
  const res = await streamText(opts.model, {
    system: documentAISystem(opts.language),
    prompt: documentAIPrompt(action, doc, opts.examContext),
    images,
    temperature: 0.3,
    maxTokens: 2200,
    timeoutSec: 240
  }, {
    signal: opts.signal,
    onText: (t) => {
      acc += t
      opts.onText?.(acc)
    }
  })
  const text = (res.text.trim() ? res.text : acc).trim()
  if (!text) {
    const es = opts.language.toLowerCase().startsWith('es')
    throw new AIError('badResponse', es ? 'Aula no respondió. Prueba otra vez o cambia de IA en Ajustes.' : "Aula didn't answer. Try again or pick another AI in Settings.")
  }
  return { text, cards: action.type === 'cards' ? parseCards(text) : [], cited: citedPages(text, doc.pages.length) }
}
