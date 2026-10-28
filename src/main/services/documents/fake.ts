// Aula en el lector con la IA simulada (`AULA_FAKE_AI=1`: pruebas, capturas y vídeo). Sin guion, la IA simulada contesta
// «Respuesta simulada de Aula.» a todo: el panel parecía no responder. Aquí cada acción tiene su respuesta, armada con las
// frases de verdad del documento y sus páginas citadas «(p. N)», y llega poco a poco, como la de una IA real.
import type { DocumentAIAction } from '@shared/documents'
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { emptyUsage, messageText } from '@shared/ai/types'
import { responseFromEvents } from '../ai/core/toolCalls'
import { cancelledError } from '../ai/errors'
import { FAKE_PROVIDER_ID, hasFakeAIScript } from '../ai/fake'
import type { ChatModel, CompleteOptions } from '../ai/model'
import { fakeChunks } from '../assistant/fake'
import { digestFold, digestSentences, digestWords, makeDigest } from './digest'
import { chapterContaining, pageText, type DocumentPages } from './pages'

type Say = (es: string, en: string) => string

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
/** Sin el punto final (la cita va detrás). */
const bare = (s: string): string => s.trim().replace(/[.;:,]+$/, '')
/** Recortada a `n` caracteres, sin partir palabras. */
function short(s: string, n: number): string {
  if (Array.from(s).length <= n) return s
  const cut = Array.from(s).slice(0, n - 1).join('')
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n / 2)).trimEnd() + '…'
}

/** Las frases de un texto (las de `digestSentences`, o el texto entero si es corto). */
function sentences(text: string): string[] {
  const out = digestSentences(text)
  return out.length ? out : text.trim() ? [text.trim()] : []
}

/** «Exam 2 covers chapters 3 and 4: a, b, c and d.» → la idea y su lista (tres cosas o más, cortas y sin cuentas); si no, solo
 *  la idea. */
export function splitList(sentence: string): { lead: string; items: string[] } {
  const m = /^([^:]{8,160}):\s+(.+)$/.exec(sentence.trim())
  const items = m ? bare(m[2]).split(/,\s*(?:and\s+|or\s+|y\s+|o\s+)?|;\s*/).map((x) => x.trim()).filter(Boolean) : []
  const list = items.length >= 3 && items.every((x) => Array.from(x).length <= 70 && !/[=|<>]/.test(x))
  return m && list ? { lead: m[1].trim(), items: items.map(cap) } : { lead: sentence.trim(), items: [] }
}

/** Lo esencial de una página: su idea (la primera frase) y lo demás (la lista de esa frase o las otras frases). */
function pagePoints(doc: DocumentPages, page: number): { lead: string; rest: string[] } | undefined {
  const ss = sentences(pageText(doc, page))
  if (!ss.length) return undefined
  const first = splitList(ss[0])
  return { lead: bare(first.lead), rest: [...first.items, ...ss.slice(1).map(bare)] }
}

/** Una pregunta para repasar la idea de una página. */
const review = (say: Say, lead: string, page: number): string => `${say('Explica con tus palabras', 'Explain in your own words')}: «${short(lead, 90)}» (p. ${page})`

function summarizePage(say: Say, doc: DocumentPages, page: number): string {
  const p = pagePoints(doc, page)
  if (!p) return say(`En la página ${page} no hay texto que pueda leer (¿es una imagen?).`, `Page ${page} has no text I can read (is it an image?).`)
  let s = `**${say('La idea', 'The main idea')}:** ${p.lead} (p. ${page}).`
  if (p.rest.length) s += `\n\n**${say('Lo clave', 'Key points')}**\n\n` + p.rest.slice(0, 7).map((x) => `- ${cap(x)}`).join('\n')
  return s
}

function summarizeRange(say: Say, doc: DocumentPages, a: number, b: number, title: string): string {
  const pages: { page: number; lead: string }[] = []
  for (let p = a; p <= b && pages.length < 8; p++) {
    const pt = pagePoints(doc, p)
    if (pt) pages.push({ page: p, lead: pt.lead })
  }
  if (!pages.length) return say(`En «${title}» no hay texto que pueda leer.`, `There's no text I can read in “${title}”.`)
  return `### ${title}\n\n` + pages.map((x) => `- ${cap(x.lead)} (p. ${x.page})`).join('\n') +
    `\n\n**${say('Para repasar', 'To review')}**\n\n` + pages.slice(0, 4).map((x, i) => `${i + 1}. ${review(say, x.lead, x.page)}`).join('\n')
}

function summarizeDocument(say: Say, doc: DocumentPages): string {
  const n = doc.pages.length
  const structure = doc.outline.length
    ? doc.outline.filter((e) => e.level === 0).slice(0, 8).map((e) => `- ${e.title} (p. ${e.page})`)
    : Array.from({ length: Math.min(n, 8) }, (_, i) => i + 1).flatMap((p) => { const pt = pagePoints(doc, p); return pt ? [`- ${cap(pt.lead)} (p. ${p})`] : [] })
  const ideas = makeDigest(doc).pages.flatMap((x) => x.lines).sort((x, y) => y.score - x.score).slice(0, 4).sort((x, y) => x.page - y.page)
  let s = `**${say('Qué es', 'What it is')}:** «${doc.title}», ${n} ${n === 1 ? say('página', 'page') : say('páginas', 'pages')}.`
  if (structure.length) s += `\n\n**${say('Cómo está organizado', 'How it is organized')}**\n\n${structure.join('\n')}`
  if (ideas.length) s += `\n\n**${say('Las ideas clave', 'Key ideas')}**\n\n` + ideas.map((l) => `- ${bare(l.text)} (p. ${l.page})`).join('\n')
  if (ideas.length) s += `\n\n**${say('Para repasar', 'To review')}**\n\n` + ideas.slice(0, 3).map((l, i) => `${i + 1}. ${review(say, bare(splitList(l.text).lead), l.page)}`).join('\n')
  return s
}

function examFocus(say: Say, doc: DocumentPages): string {
  const d = makeDigest(doc, undefined, 2, 24)
  const seen = new Set<string>()
  const picks = [...d.examSignals, ...d.pages.flatMap((x) => x.lines).sort((x, y) => y.score - x.score)].filter((l) => !seen.has(l.text) && (seen.add(l.text), true)).slice(0, 5)
  if (!picks.length) return say('No encuentro en el documento pistas de lo que entra en el examen.', "I can't find hints in the document about what's on the exam.")
  const why = (t: string): string => {
    const f = digestFold(t)
    if (/exam|prueba|parcial|test/.test(f)) return say('el documento dice que entra', 'the document says it’s on the exam')
    if (/defin|se llama|is called/.test(f)) return say('es una definición', 'it’s a definition')
    if (/=|\d/.test(t)) return say('es una fórmula o un dato que se pregunta', 'it’s a formula or fact that gets asked')
    return say('es la idea clave de la página', 'it’s the key idea of the page')
  }
  // los temas de una lista piden un ejemplo; una frase suelta, el porqué
  const topics = picks.flatMap((l) => splitList(l.text).items.map((x) => `${say('Pon un ejemplo de', 'Give an example of')} ${x.charAt(0).toLowerCase() + x.slice(1)} ${say('y resuélvelo paso a paso', 'and work it out step by step')} (p. ${l.page})`))
  const questions = (topics.length ? topics : picks.map((l) => `${say('Explica por qué', 'Explain why')}: «${short(bare(l.text), 90)}» (p. ${l.page})`)).slice(0, 3)
  return `**${say('Lo más probable en el examen', 'Most likely on the exam')}**\n\n` + picks.map((l, i) => `${i + 1}. **${short(bare(splitList(l.text).lead), 90)}** — ${why(l.text)} (p. ${l.page})`).join('\n') +
    `\n\n**${say('Preguntas de ejemplo', 'Example questions')}**\n\n` + questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
}

function explain(say: Say, doc: DocumentPages, selection: string, page: number): string {
  const ss = sentences(selection)
  const first = splitList(ss[0] ?? selection)
  const steps = (first.items.length ? first.items : ss.slice(1).map(bare)).slice(0, 5)
  let s = `**${say('En pocas palabras', 'In short')}:** ${bare(first.lead)} (p. ${page}).`
  if (steps.length) s += `\n\n**${say('Paso a paso', 'Step by step')}**\n\n` + steps.map((x, i) => `${i + 1}. ${cap(x)}`).join('\n')
  // lo que rodea a la selección en la página
  const around = sentences(pageText(doc, page)).find((x) => !digestFold(selection).includes(digestFold(x).slice(0, 40)))
  if (around) s += `\n\n**${say('En contexto', 'In context')}:** ${bare(around)} (p. ${page}).`
  return s + `\n\n**${say('Comprueba', 'Check')}:** ${say('¿sabrías explicarlo sin mirar, con un ejemplo tuyo?', 'could you explain it without looking, with an example of your own?')}`
}

function ask(say: Say, doc: DocumentPages, question: string): string {
  const terms = digestWords(question)
  const scored = doc.pages.flatMap((text, i) => sentences(text).map((x) => {
    const f = digestFold(x)
    return { page: i + 1, text: x, score: terms.filter((w) => f.includes(w)).length }
  })).filter((x) => x.score > 0).sort((x, y) => y.score - x.score || x.page - y.page).slice(0, 3)
  if (!scored.length) {
    const first = pagePoints(doc, 1)
    return say('No lo encuentro en el documento.', "I can't find that in the document.") + (first ? ` ${say('Empieza con esto', 'It starts with this')}: ${first.lead} (p. 1).` : '')
  }
  return `${say('Esto es lo que dice el documento', 'Here’s what the document says')}:\n\n` + scored.sort((x, y) => x.page - y.page).map((x) => `- ${bare(x.text)} (p. ${x.page})`).join('\n')
}

/** Tarjetas en JSON (lo que pide el prompt): una lista se pregunta entera; una frase, con su palabra clave en blanco. */
function cards(say: Say, selection: string): string {
  const out: { front: string; back: string }[] = []
  for (const x of sentences(selection)) {
    const sp = splitList(x)
    if (sp.items.length) {
      out.push({ front: `${bare(sp.lead)}: ${say('¿qué incluye?', 'what does it include?')}`, back: sp.items.join(', ') })
      continue
    }
    const words = x.split(/\s+/)
    const at = words.map((w, i) => ({ w: w.replace(/[^\p{L}\p{N}-]/gu, ''), i })).filter(({ w }) => Array.from(w).length >= 5 && digestWords(w).length > 0).pop()
    if (!at) continue
    out.push({ front: `${say('Completa', 'Fill in the blank')}: ${words.map((w, i) => (i === at.i ? w.replace(at.w, '___') : w)).join(' ')}`, back: at.w })
    if (out.length >= 6) break
  }
  return JSON.stringify(out.length ? out : [{ front: say('¿Qué dice este fragmento?', 'What does this passage say?'), back: short(bare(selection), 300) }])
}

function practice(say: Say, selection: string, page: number): string {
  const ss = sentences(selection).map(bare)
  const a = ss[0] ?? bare(selection), b = ss[1] ?? a
  const topic = splitList(a).items[0] ?? short(splitList(a).lead, 60)
  return `1. **${say('Fácil', 'Easy')}.** ${say('¿Verdadero o falso?', 'True or false?')} ${a}.\n` +
    `2. **${say('Media', 'Medium')}.** ${say('Explica con tus palabras', 'Explain in your own words')}: «${short(b, 120)}».\n` +
    `3. **${say('Como en el examen', 'Exam-style')}.** ${say('Inventa un problema sobre', 'Write a problem about')} ${topic.charAt(0).toLowerCase() + topic.slice(1)} ${say('y resuélvelo paso a paso', 'and solve it step by step')}.\n\n` +
    `### ${say('Solución', 'Solution')}\n\n1. ${say('Verdadero', 'True')}: ${say('lo dice la página', 'the page says so')} (p. ${page}).\n2. ${b} (p. ${page}).\n3. ${say('Comprueba tu problema con lo que dice la página', 'Check your problem against the page')} (p. ${page}).`
}

/** Lo que responde la IA simulada a una acción del lector, en el idioma pedido (español o, si no, inglés). */
export function fakeDocumentAnswer(action: DocumentAIAction, doc: DocumentPages, language: string): string {
  const es = language.toLowerCase().startsWith('es')
  const say: Say = (a, b) => (es ? a : b)
  const n = Math.max(1, doc.pages.length)
  switch (action.type) {
    case 'summarizePage': return summarizePage(say, doc, Math.min(n, action.page))
    case 'summarizeChapter': {
      const ch = action.from !== undefined && action.to !== undefined ? { title: action.title, page: action.from, endPage: action.to } : chapterContaining(doc, action.page)
      const a = Math.max(1, ch?.page ?? action.page - 2), b = Math.min(n, ch?.endPage ?? action.page + 4)
      return summarizeRange(say, doc, a, b, ch?.title ?? say(`Páginas ${a}–${b}`, `Pages ${a}–${b}`))
    }
    case 'summarizeDocument': return summarizeDocument(say, doc)
    case 'examFocus': return examFocus(say, doc)
    case 'explain': return explain(say, doc, action.selection, action.page)
    case 'ask': return ask(say, doc, action.question)
    case 'cards': return cards(say, action.selection)
    case 'practice': return practice(say, action.selection, action.page)
  }
}

/** Pausa entre trozos (`AULA_FAKE_AI_DELAY_MS`, como el chat simulado). */
function fakeDelayMs(): number {
  const n = Number(process.env.AULA_FAKE_AI_DELAY_MS)
  return Number.isFinite(n) && n > 0 && n <= 2000 ? n : 30
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(cancelledError()); return }
  const onAbort = (): void => { clearTimeout(t); reject(cancelledError()) }
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
  signal?.addEventListener('abort', onAbort, { once: true })
})

/** Con la IA simulada (y sin un guion propio de pruebas), un modelo que responde la acción con el documento, a trozos. Con
 *  cualquier otra IA, la misma. */
export function withDocumentFake(model: ChatModel, action: DocumentAIAction, doc: DocumentPages, language: string, delayMs = fakeDelayMs()): ChatModel {
  if (model.providerId !== FAKE_PROVIDER_ID || hasFakeAIScript()) return model
  return {
    ...model,
    async complete(request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
      if (opts.signal?.aborted) throw cancelledError()
      const text = fakeDocumentAnswer(action, doc, language)
      const events: ChatEvent[] = []
      const emit = (e: ChatEvent): void => { events.push(e); opts.onDelta?.(e) }
      for (const chunk of fakeChunks(text)) {
        if (delayMs > 0) await sleep(delayMs, opts.signal)
        emit({ type: 'text', text: chunk })
      }
      emit({ type: 'usage', usage: { ...emptyUsage(), promptTokens: request.messages.map(messageText).join('').length, completionTokens: text.length } })
      emit({ type: 'finished', finish: 'stop' })
      return responseFromEvents(events)
    }
  }
}
