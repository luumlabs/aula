// Mensajes entre el proceso principal y el proceso de lectura (`ingest-worker`). Todo viaja con el algoritmo de clonado
// estructurado (los bytes, como `Uint8Array`); las funciones y objetos con métodos (progreso, cancelación, dibujante de
// páginas) se sustituyen por mensajes.
import type { IngestInput, SourceDocument } from '@shared/ingest'
import { AulaError } from '../../errors'
import { CancelledError, IngestError, type IngestErrorKind } from '../errors'
import type { IngestOptions } from '../options'
import { EmptySourceError } from '../sourceStore'

/** Ajustes del proceso de lectura; se reenvían cuando cambian. */
export interface WorkerSettings {
  /** Idioma de la interfaz (avisos, progreso y errores). */
  uiLanguage: string
  /** Caché y origen de los datos de idioma de Tesseract (los mismos que configura el proceso principal). */
  ocr: { cachePath?: string; langPath?: string; idleMs?: number }
}

/** Parte serializable de `IngestOptions`. */
export interface WireOptions {
  language?: string
  ocrLanguages?: string[]
  /** `ocr: false` (sin OCR). */
  ocrOff?: boolean
  ocrWhenTextShorterThan?: number
  maxPages?: number
  includeSpeakerNotes?: boolean
  allowPrivate?: boolean
  maxArchiveBytes?: number
  maxArchiveEntries?: number
  maxWebBytes?: number
  /** El proceso principal puede dibujar páginas de PDF (`renderPdfPage`) y convertir imágenes (`imageToPng`). */
  rasterPdf: boolean
  rasterImage: boolean
  /** Hay quien escucha el progreso. */
  progress: boolean
}

export interface WireError {
  name: string
  code: string
  kind?: string
  reason?: string
  message: string
}

/** Del proceso principal al de lectura. */
export type ToWorker =
  | { type: 'init'; settings: WorkerSettings }
  | { type: 'read'; id: number; input: IngestInput; options: WireOptions }
  | { type: 'cancel'; id: number }
  | { type: 'raster-result'; id: number; png: Uint8Array | null; missing?: boolean }

export type RasterRequest =
  | { type: 'raster'; id: number; call: number; op: 'pdf'; key: string; pdf?: Uint8Array; page: number; maxDimension: number }
  | { type: 'raster'; id: number; call: number; op: 'image'; image: Uint8Array; maxDimension: number }

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/** Del proceso de lectura al principal. */
export type FromWorker =
  | { type: 'ready' }
  | { type: 'progress'; id: number; fraction: number; message: string }
  | { type: 'result'; id: number; result: SourceDocument }
  | ({ type: 'error'; id: number } & WireError)
  | RasterRequest
  | { type: 'log'; level: LogLevel; text: string }

/** Un extremo del canal (process.parentPort, un UtilityProcess o, en las pruebas, un canal en memoria). */
export interface Endpoint<In, Out> {
  post(message: Out): void
  listen(handler: (message: In) => void): void
}

// MARK: Opciones

const NUMERIC_KEYS = ['ocrWhenTextShorterThan', 'maxPages', 'maxArchiveBytes', 'maxArchiveEntries', 'maxWebBytes'] as const
const BOOLEAN_KEYS = ['includeSpeakerNotes', 'allowPrivate'] as const

/** Opciones → parte serializable. El dibujante de páginas se resuelve aquí (el propio o el instalado por defecto). */
export function toWireOptions(options: Partial<IngestOptions>, rasterizer = options.rasterizer): WireOptions {
  const wire: WireOptions = { rasterPdf: !!rasterizer, rasterImage: !!rasterizer?.imageToPng, progress: !!options.onProgress }
  if (typeof options.language === 'string') wire.language = options.language
  if (Array.isArray(options.ocrLanguages)) wire.ocrLanguages = options.ocrLanguages.filter((l) => typeof l === 'string')
  if (options.ocr === false) wire.ocrOff = true
  for (const k of NUMERIC_KEYS) if (typeof options[k] === 'number') wire[k] = options[k]
  for (const k of BOOLEAN_KEYS) if (typeof options[k] === 'boolean') wire[k] = options[k]
  return wire
}

/** Parte serializable → opciones del proceso de lectura (con su cancelación, progreso y dibujante puente). */
export function fromWireOptions(wire: WireOptions, local: Pick<IngestOptions, 'signal' | 'onProgress' | 'rasterizer'>): Partial<IngestOptions> {
  const options: Partial<IngestOptions> = { signal: local.signal, onProgress: local.onProgress, rasterizer: local.rasterizer }
  if (typeof wire.language === 'string') options.language = wire.language
  if (Array.isArray(wire.ocrLanguages)) options.ocrLanguages = wire.ocrLanguages.filter((l) => typeof l === 'string')
  if (wire.ocrOff === true) options.ocr = false
  for (const k of NUMERIC_KEYS) if (typeof wire[k] === 'number') options[k] = wire[k]
  for (const k of BOOLEAN_KEYS) if (typeof wire[k] === 'boolean') options[k] = wire[k]
  return options
}

// MARK: Errores

/** Error → datos (nombre, código, tipo de error de lectura y mensaje ya localizado). */
export function serializeError(e: unknown): WireError {
  if (e instanceof CancelledError || (e instanceof Error && e.name === 'AbortError')) return { name: 'AbortError', code: 'cancelled', message: e.message }
  if (e instanceof IngestError) return { name: 'IngestError', code: e.code, kind: e.kind, reason: e.reason, message: e.message }
  if (e instanceof EmptySourceError) return { name: 'EmptySourceError', code: e.code, message: e.message }
  if (e instanceof AulaError) return { name: 'AulaError', code: e.code, message: e.message }
  if (e instanceof Error) return { name: e.name || 'Error', code: 'internal', message: e.message }
  return { name: 'Error', code: 'internal', message: String(e) }
}

const INGEST_KINDS: ReadonlySet<string> = new Set<IngestErrorKind>(['fileNotFound', 'unreadable', 'unsupportedType', 'passwordProtected', 'corrupt', 'tooLarge', 'archiveLimit', 'blockedURL', 'network'])

/** Datos → el mismo tipo de error (para que quien llama vea `IngestError`, `EmptySourceError` o `CancelledError`). */
export function rebuildError(w: WireError): Error {
  const message = typeof w.message === 'string' ? w.message : ''
  let e: Error
  if (w.name === 'AbortError' || w.code === 'cancelled') e = new CancelledError()
  else if (w.name === 'IngestError' && typeof w.kind === 'string' && INGEST_KINDS.has(w.kind)) e = new IngestError(w.kind as IngestErrorKind, typeof w.reason === 'string' ? w.reason : '')
  else if (w.name === 'EmptySourceError') e = new EmptySourceError('')
  else if (w.name === 'AulaError' || (typeof w.code === 'string' && w.code !== 'internal')) e = new AulaError(w.code, message)
  else {
    e = new Error(message)
    if (typeof w.name === 'string' && w.name) e.name = w.name
  }
  if (message) e.message = message
  return e
}

// MARK: Comprobación de mensajes

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

const hasID = (m: Record<string, unknown>): boolean => typeof m.id === 'number'

export function isToWorker(v: unknown): v is ToWorker {
  if (!isRecord(v)) return false
  switch (v.type) {
    case 'init': return isRecord(v.settings)
    case 'read': return hasID(v) && isRecord(v.input) && isRecord(v.options)
    case 'cancel': return hasID(v)
    case 'raster-result': return hasID(v) && (v.png === null || v.png instanceof Uint8Array)
    default: return false
  }
}

export function isFromWorker(v: unknown): v is FromWorker {
  if (!isRecord(v)) return false
  switch (v.type) {
    case 'ready': return true
    case 'progress': return hasID(v) && typeof v.fraction === 'number' && typeof v.message === 'string'
    case 'result': return hasID(v) && isRecord(v.result) && Array.isArray(v.result.pages)
    case 'error': return hasID(v) && typeof v.message === 'string'
    case 'raster': return hasID(v) && typeof v.call === 'number' && (v.op === 'pdf' || v.op === 'image')
    case 'log': return typeof v.text === 'string'
    default: return false
  }
}
