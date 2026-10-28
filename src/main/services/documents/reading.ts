// Leer un documento por páginas (el resto de DocumentReading.swift): primero las páginas que guardó la lectura del material
// (`sources/<id>/pages.json`, con la página real de cada PDF y el OCR de las escaneadas); si no las hay (materiales de la app
// Swift), los fragmentos agrupados por página; y si el documento no tiene nada guardado (un documento creado por Aula), se
// lee el archivo. El resultado se guarda en caché por documento y huella de sus archivos.
import { join } from 'node:path'
import type { DocumentPageText, DocumentView } from '@shared/documents'
import { loadChunks, loadSourcePages, readInput } from '../ingest'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'
import { SafePath } from '../store'
import { contentSignature, type LocatedDocument } from './locate'
import { cleanPageText, MAX_PAGES, outlineFromChunks, outlineFromHeadings, pagesFromChunks, type DocumentPages } from './pages'

const cache = new Map<string, { signature: string; pages: DocumentPages }>()
const CACHE_SIZE = 12

function remember(key: string, signature: string, pages: DocumentPages): void {
  cache.delete(key)
  cache.set(key, { signature, pages })
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
}

export function clearPagesCache(): void {
  cache.clear()
}

/** Las páginas guardadas por la lectura del material, si las hay. */
function fromStoredPages(doc: LocatedDocument): DocumentPages | undefined {
  if (!doc.sourcesRoot || !doc.sourceId) return undefined
  const stored = loadSourcePages(doc.sourcesRoot, doc.sourceId)
  if (!stored || !stored.pages.length) return undefined
  const last = Math.min(MAX_PAGES, Math.max(...stored.pages.map((p) => p.number)))
  const pages: string[] = Array.from({ length: Math.max(1, last) }, () => '')
  const headings: (string | undefined)[] = pages.map(() => undefined)
  const ocr = new Set<number>()
  for (const p of stored.pages) {
    if (p.number < 1 || p.number > pages.length) continue
    pages[p.number - 1] = cleanPageText(p.text)
    headings[p.number - 1] = p.heading
    if (p.usedOCR) ocr.add(p.number)
  }
  const chunks = loadChunks(doc.sourcesRoot, doc.sourceId)
  const outline = chunks.some((c) => c.heading) ? outlineFromChunks(chunks, pages.length) : outlineFromHeadings(headings)
  return { title: doc.title, pages, headings, outline, ocrPages: ocr }
}

function fromChunks(doc: LocatedDocument): DocumentPages | undefined {
  if (!doc.sourcesRoot || !doc.sourceId) return undefined
  return pagesFromChunks(doc.title, loadChunks(doc.sourcesRoot, doc.sourceId))
}

/** Lee el archivo con la lectura de materiales (PDF, Word, Markdown…), en el lector aparte si lo hay (A2-P1-3: un PDF hostil de un
 * curso importado congelaba el proceso principal). */
async function fromFile(doc: LocatedDocument): Promise<DocumentPages | undefined> {
  if (!doc.filePath) return undefined
  const read = await readInput({ type: 'file', path: doc.filePath }, { ocr: false })
  const pages = read.pages.slice(0, MAX_PAGES).map((p) => cleanPageText(p.text))
  const headings = read.pages.slice(0, MAX_PAGES).map((p) => p.heading)
  return { title: doc.title, pages: pages.length ? pages : [''], headings, outline: outlineFromHeadings(headings), ocrPages: new Set() }
}

/** El texto del documento por páginas. Lanza `document_unreadable` si no hay forma de leerlo. */
export async function loadPages(doc: LocatedDocument): Promise<DocumentPages> {
  const signature = contentSignature(doc)
  const hit = cache.get(doc.key)
  if (hit && hit.signature === signature) return hit.pages
  const pages = fromStoredPages(doc) ?? fromChunks(doc) ?? (await fromFile(doc).catch(() => undefined))
  if (!pages || pages.pages.every((p) => !p.trim())) {
    // un PDF escaneado sin texto todavía se puede ver (no se puede resumir)
    if (doc.mode !== 'text' && pages) return pages
    throw new AulaError('document_unreadable', tr(`«${doc.title}» no tiene texto que se pueda leer.`, `“${doc.title}” has no text that can be read.`))
  }
  remember(doc.key, signature, pages)
  return pages
}

/** Las páginas para la interfaz. */
export function pagesForView(p: DocumentPages): DocumentPageText[] {
  return p.pages.map((text, i) => {
    const out: DocumentPageText = { number: i + 1, text }
    const h = p.headings[i]
    if (h) out.heading = h
    if (p.ocrPages.has(i + 1)) out.ocr = true
    return out
  })
}

/** La vista del lector (sin la entrada de biblioteca, que pone `library.ts`). */
export async function readView(doc: LocatedDocument): Promise<Omit<DocumentView, 'entry'>> {
  let pages: DocumentPages
  try {
    pages = await loadPages(doc)
  } catch (err) {
    // un PDF o una foto sin texto se puede abrir igual (sin acciones de Aula)
    if (doc.mode === 'text') throw err
    pages = { title: doc.title, pages: [''], headings: [undefined], outline: [], ocrPages: new Set() }
  }
  const warnings = doc.meta?.warnings ?? []
  const out: Omit<DocumentView, 'entry'> = { pages: pagesForView(pages), outline: pages.outline, warnings }
  const lang = doc.pack?.language
  if (lang) out.language = lang
  return out
}

/** Carpeta del material (para comprobaciones). */
export function sourceFolder(doc: LocatedDocument): string | undefined {
  return doc.sourcesRoot && doc.sourceId ? join(doc.sourcesRoot, 'sources', SafePath.component(doc.sourceId)) : undefined
}
