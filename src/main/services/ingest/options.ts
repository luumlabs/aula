// Opciones de lectura (como `IngestOptions` de Swift) y sus valores por defecto.
import type { PageRasterizer } from '@shared/ingest'
import type { ProgressCallback } from './core/progress'
import type { OcrEngine } from './extract/ocr'
import type { HttpTransport } from './extract/web'

export interface IngestOptions {
  /** Idioma del curso («es», «ja», «pt-BR»…): el OCR lo pone primero. */
  language?: string
  /** Idiomas del OCR (códigos de Tesseract o de idioma: «spa», «es»…). Por defecto: el del curso, el de la interfaz e inglés. */
  ocrLanguages?: string[]
  /** Motor de OCR. Por defecto, Tesseract (tesseract.js, cargado solo cuando hace falta). `false` desactiva el OCR. */
  ocr?: OcrEngine | false
  /** Dibuja páginas de PDF para el OCR de las escaneadas (lo da la capa de Electron). Sin él, quedan con `needsOCR`. */
  rasterizer?: PageRasterizer
  /** Caracteres por página de PDF por debajo de los cuales se hace OCR de la página. */
  ocrWhenTextShorterThan: number
  /** Máximo de páginas a leer (el resto se ignora con una advertencia). */
  maxPages: number
  /** Incluir las notas del orador de las diapositivas. */
  includeSpeakerNotes: boolean
  /** Progreso 0…1 con un mensaje en el idioma de la interfaz. */
  onProgress?: ProgressCallback
  /** Cancelación. */
  signal?: AbortSignal
  /** Permite descargar páginas de direcciones locales o privadas (127.0.0.1, 192.168.x.x…). Por defecto, no. */
  allowPrivate: boolean
  /** Límite de bytes descomprimidos de un archivo comprimido (docx, pptx, xlsx, epub). */
  maxArchiveBytes: number
  /** Límite de entradas de un archivo comprimido. */
  maxArchiveEntries: number
  /** Límite de bytes de una página web descargada. */
  maxWebBytes: number
  /** Transporte HTTP (pruebas o la red de Electron). Por defecto, node:http/https con DNS validado. */
  transport?: HttpTransport
}

let defaultRasterizer: PageRasterizer | undefined

/** La capa de Electron instala aquí su dibujante de páginas: así todas las lecturas pueden hacer OCR de lo escaneado. */
export function setDefaultRasterizer(r: PageRasterizer | undefined): void {
  defaultRasterizer = r
}

export function defaultOptions(): IngestOptions {
  return {
    rasterizer: defaultRasterizer,
    ocrWhenTextShorterThan: 40,
    maxPages: 2000,
    includeSpeakerNotes: true,
    allowPrivate: false,
    maxArchiveBytes: 200 * 1024 * 1024,
    maxArchiveEntries: 5_000,
    maxWebBytes: 15 * 1024 * 1024
  }
}

/** Opciones completas con los valores imposibles corregidos (`maxPages` ≤ 0…). */
export function resolveOptions(partial: Partial<IngestOptions> = {}): IngestOptions {
  const o: IngestOptions = { ...defaultOptions() }
  for (const [k, v] of Object.entries(partial)) if (v !== undefined) (o as unknown as Record<string, unknown>)[k] = v
  o.maxPages = Number.isFinite(o.maxPages) ? Math.max(1, Math.floor(o.maxPages)) : 1
  o.ocrWhenTextShorterThan = Number.isFinite(o.ocrWhenTextShorterThan) ? Math.max(0, o.ocrWhenTextShorterThan) : 40
  o.maxArchiveBytes = Math.max(0, o.maxArchiveBytes)
  o.maxArchiveEntries = Math.max(0, o.maxArchiveEntries)
  o.maxWebBytes = Math.max(0, o.maxWebBytes)
  return o
}
