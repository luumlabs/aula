// API pública de la lectura de materiales (port de IngestKit): archivo, página web o texto → páginas, texto y fragmentos;
// y guardado en un curso (`sources/<id>/{original, chunks.json, pages.json}`, `pack.json → sources[]`, `sources/index.json`).
// Todo se puede cancelar con `signal` e informa del progreso con `onProgress(fracción 0…1, mensaje)`. Si hay un lector
// aparte (`setIngestRunner`, el proceso de utilidad de Electron), la lectura se hace allí; el guardado, siempre aquí.
import type { IngestInput, IngestResult, SourceDocument, SourceTrust } from '@shared/ingest'
import { fullText } from '@shared/ingest'
import { chunkDocument, type ChunkOptions } from './chunker'
import { checkCancelled } from './errors'
import { L } from './messages'
import type { IngestOptions } from './options'
import { documentFromText, tidyTitle } from './pipeline'
import { readInputHere } from './read'
import { canDelegate, ingestRunner } from './runner'
import { newSourceID, saveIngestedSource, type SavedSource } from './sourceStore'
import { sourceIDs } from './packFiles'
import type { PackStore } from '../store/packStore'

export interface IngestCallOptions extends Partial<IngestOptions> {
  /** Id de la fuente para los fragmentos. Por defecto, «slug-del-titulo-abcd» como en la app Swift. */
  sourceID?: string
  /** Título que pone el usuario (sustituye al detectado). */
  title?: string
  /** Tamaños de los fragmentos (por defecto los de Swift: 1400 / 2200 / 120). */
  chunk?: ChunkOptions
}

/** Documento ya leído → resultado con texto, fragmentos y páginas que necesitan OCR. */
export function resultFromDocument(doc: SourceDocument, options: Pick<IngestCallOptions, 'sourceID' | 'title' | 'chunk'> = {}): IngestResult {
  const title = options.title !== undefined && options.title.trim() ? tidyTitle(options.title, doc.title) : doc.title
  const sourceID = options.sourceID ?? newSourceID(title)
  const named = { ...doc, title }
  return {
    sourceID,
    kind: doc.kind,
    title,
    pages: doc.pages,
    text: fullText(doc),
    chunks: chunkDocument(named, sourceID, options.chunk),
    warnings: doc.warnings,
    metadata: doc.metadata,
    pagesNeedingOCR: doc.pages.filter((p) => p.needsOCR).map((p) => p.number)
  }
}

/** Lee un archivo (PDF, Word, PowerPoint, Excel, EPUB, HTML, Markdown, texto, RTF, imagen…) o una dirección http(s). */
export async function ingestFile(path: string, options: IngestCallOptions = {}): Promise<IngestResult> {
  return resultFromDocument(await readInput({ type: 'file', path }, options), options)
}

/** Descarga y lee una página web (o un documento enlazado: PDF, Word, imagen…). */
export async function ingestURL(url: string, options: IngestCallOptions = {}): Promise<IngestResult> {
  return resultFromDocument(await readInput({ type: 'url', url }, options), options)
}

/** Texto pegado como material (una sola página). */
export function ingestText(text: string, title = '', options: Pick<IngestCallOptions, 'sourceID' | 'chunk'> = {}): IngestResult {
  return resultFromDocument(documentFromText(text, title), options)
}

/** Documento de cualquier entrada (archivo, dirección o texto), sin fragmentar. Usa el lector aparte si lo hay. */
export async function readInput(input: IngestInput, options: Partial<IngestOptions> = {}): Promise<SourceDocument> {
  const runner = ingestRunner()
  if (runner && canDelegate(options)) {
    checkCancelled(options.signal)
    return runner.read(input, options)
  }
  return readInputHere(input, options)
}

/** Lee cualquier entrada (archivo, dirección o texto). */
export async function ingest(input: IngestInput, options: IngestCallOptions = {}): Promise<IngestResult> {
  const doc = await readInput(input, options)
  return resultFromDocument(doc, { ...options, title: input.title ?? options.title })
}

export interface ImportOptions extends IngestCallOptions {
  /** Confianza del material (oficial del profesor, libro, apuntes…). Por defecto «other». */
  trust?: SourceTrust
  note?: string
  /** Registrar el material en `pack.json` (por defecto, si existe). En un área de preparación sin curso, `false`. */
  register?: boolean
  /** Copiar el archivo original a `sources/<id>/` (por defecto, sí). */
  copyOriginal?: boolean
  /** Almacén del curso que ya usa la app (historial y aviso de cambios); por defecto, uno nuevo sobre `packDir`. */
  store?: PackStore
}

export interface ImportedSource extends SavedSource {
  result: IngestResult
}

/**
 * Lee un material y lo guarda en el curso (`packDir` = `Packs/<id>`, o cualquier carpeta con `sources/`): copia el original,
 * escribe `chunks.json` y `pages.json`, lo registra en `pack.json` y reconstruye `sources/index.json`.
 * Lanza `IngestError` (archivo dañado, con contraseña…), `EmptySourceError` (sin texto) o `CancelledError`.
 */
export async function importSourceIntoPack(packDir: string, input: IngestInput, options: ImportOptions = {}): Promise<ImportedSource> {
  const outer = options.onProgress
  const doc = await readInput(input, { ...options, onProgress: outer ? (f, m) => outer(Math.min(0.9, f * 0.9), m) : undefined })
  checkCancelled(options.signal)
  const title = input.title ?? options.title
  // Id a partir del título leído, como Swift («slug-del-titulo-abcd»), distinto de los que ya hay en el curso
  const named = title !== undefined && title.trim() ? tidyTitle(title, doc.title) : doc.title
  const sourceID = options.sourceID ?? newSourceID(named, sourceIDs(packDir))
  const result = resultFromDocument(doc, { sourceID, title: named, chunk: options.chunk })
  outer?.(0.93, L('Preparando para buscar…'))
  const saved = saveIngestedSource(packDir, result, {
    trust: options.trust,
    note: options.note,
    register: options.register,
    originalPath: input.type === 'file' && (options.copyOriginal ?? true) ? input.path : undefined,
    url: input.type === 'url' ? (result.metadata.url ?? input.url) : undefined,
    store: options.store,
    signal: options.signal
  })
  outer?.(1, L('Listo'))
  return { ...saved, result }
}

// MARK: Reexportaciones

export type { IngestInput, IngestProgress, IngestResult, PageRasterizer, SourceChunk, SourceDocument, SourceHit, SourceKind, SourceMeta, SourcePage, SourceTrust } from '@shared/ingest'
export { locationLabel, fullText } from '@shared/ingest'
export { defaultOptions, resolveOptions, type IngestOptions } from './options'
export { IngestError, CancelledError, isCancelled, isIngestError, type IngestErrorKind } from './errors'
export { setIngestLanguage, ingestLanguage } from './messages'
export { chunkDocument, chunkID, DEFAULT_CHUNK, type ChunkOptions } from './chunker'
export { detectKind, kindForExtension, isWebAddress } from './kind'
export { readDocument, readWeb, documentFromText, tidyDocument } from './pipeline'
export { EmptySourceError, loadSourcePages, moveSourceToPack, newSourceID, registerSource, removeSourceFromPack, saveIngestedSource, type SavedSource, type SaveSourceOptions, type StoredPages } from './sourceStore'
export { loadChunks, allChunks, sourceDirectory, chunksPath, pagesPath, searchIndexPath, SOURCES_DIR, CHUNKS_FILE, PAGES_FILE, INDEX_FILE } from './packFiles'
export { configureOcr, ocrConfiguration, defaultOcrEngine, defaultOcrLanguages, tesseractLanguage, TesseractEngine, type OcrEngine, type OcrLine, type OcrRawResult, type TesseractOptions } from './extract/ocr'
export { isNonPublicAddress, nodeTransport, validateURL, type DnsLookup, type HttpRequest, type HttpResponse, type HttpTransport } from './extract/web'
export type { ProgressCallback } from './core/progress'
export { setDefaultRasterizer } from './options'
export { setIngestRunner, ingestRunner, canDelegate, type IngestRunner } from './runner'
export { readInputHere } from './read'
