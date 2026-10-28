// Reconocimiento óptico de caracteres (OCR). El motor es intercambiable (`OcrEngine`); por defecto, Tesseract
// (tesseract.js, cargado solo cuando hace falta: los datos de cada idioma se descargan la primera vez y se guardan en
// caché). Los idiomas salen del idioma del curso y del de la interfaz. Sin motor, la lectura sigue: las páginas quedan
// marcadas como `needsOCR`.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CancelledError, errorMessage } from '../errors'
import { L } from '../messages'
import { buildLayout, readingOrder, type Rect, type TextLine } from '../text/layoutBuilder'
import { charCount, trimWSNL } from '../text/unicode'
import { imageInfo } from './imageInfo'

/** Una línea reconocida, con su caja en píxeles de la imagen (origen arriba a la izquierda) y su confianza (0…1). */
export interface OcrLine {
  text: string
  bbox: Rect
  confidence: number
}

export interface OcrRawResult {
  /** Tamaño de la imagen reconocida, en píxeles. */
  width: number
  height: number
  lines: OcrLine[]
}

/** Motor de OCR. */
export interface OcrEngine {
  readonly name: string
  /** Reconoce el texto de una imagen (PNG, JPEG, BMP, TIFF, GIF, WebP…). `languages` en códigos de Tesseract («spa», «eng»…). */
  recognize(image: Uint8Array, languages: string[], signal?: AbortSignal): Promise<OcrRawResult>
  /** ¿Ya está cargado? (para avisar de la espera de la primera vez). */
  readonly isWarm?: boolean
  /** Libera recursos (procesos de trabajo). */
  dispose?(): Promise<void>
}

/** Resultado de una página, con el texto ya reconstruido por geometría. */
export interface OcrPageResult {
  text: string
  firstHeading: string | null
  /** Confianza media (0…1) ponderada por la longitud de cada línea. 0 si no se reconoció nada. */
  averageConfidence: number
  characterCount: number
  /** Líneas en orden de lectura con su caja normalizada (0…1, origen arriba a la izquierda). */
  normalizedLines: OcrLine[]
}

// MARK: Idiomas

/** Códigos de idioma de la app (y otros habituales) → datos de Tesseract. */
const TESSERACT_CODES: Record<string, string> = {
  es: 'spa', en: 'eng', pt: 'por', fr: 'fra', de: 'deu', it: 'ita', ja: 'jpn', ko: 'kor', ru: 'rus', ar: 'ara', hi: 'hin',
  ca: 'cat', gl: 'glg', eu: 'eus', nl: 'nld', pl: 'pol', tr: 'tur', el: 'ell', he: 'heb', iw: 'heb', sv: 'swe', da: 'dan', no: 'nor', nb: 'nor', nn: 'nor',
  fi: 'fin', cs: 'ces', sk: 'slk', ro: 'ron', hu: 'hun', uk: 'ukr', bg: 'bul', sr: 'srp', hr: 'hrv', sl: 'slv', vi: 'vie', th: 'tha', id: 'ind',
  ms: 'msa', la: 'lat', fa: 'fas', ur: 'urd', bn: 'ben', ta: 'tam', te: 'tel', mr: 'mar', gu: 'guj', pa: 'pan', yue: 'chi_tra'
}

/** Código de Tesseract para un código de idioma cualquiera («es», «es_MX», «zh-TW», «spa»…), o `null`. */
export function tesseractLanguage(code: string): string | null {
  const wanted = code.replace(/_/g, '-').trim()
  if (!wanted || wanted.length > 40) return null
  if (/^[a-z]{3}(_[a-z]{3,4})?$/.test(code.trim())) return code.trim()            // ya es un código de Tesseract
  const parts = wanted.toLowerCase().split('-')
  const base = parts[0]
  if (base === 'zh') {
    const traditional = parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo')
    return traditional ? 'chi_tra' : 'chi_sim'
  }
  return TESSERACT_CODES[base] ?? null
}

/**
 * Idiomas del OCR por prioridad: el del curso, los preferidos, el de la interfaz y el inglés. Como mucho tres (Tesseract no
 * detecta el idioma solo, y cada idioma de más lo hace más lento), sin repetir.
 */
export function defaultOcrLanguages(options: { course?: string; interface?: string; preferred?: string[] } = {}): string[] {
  const out: string[] = []
  const add = (code: string | undefined): void => {
    if (!code) return
    const t = tesseractLanguage(code)
    if (t && !out.includes(t)) out.push(t)
  }
  add(options.course)
  for (const p of options.preferred ?? []) add(p)
  add(options.interface)
  add('en')
  return out.slice(0, 3)
}

// MARK: Tesseract

interface TesseractWorker {
  recognize(image: Buffer, options?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: TesseractPage }>
  terminate(): Promise<unknown>
}
interface TesseractBBox { x0: number; y0: number; x1: number; y1: number }
interface TesseractLine { text: string; confidence: number; bbox: TesseractBBox }
interface TesseractPage { blocks: Array<{ paragraphs: Array<{ lines: TesseractLine[] }> }> | null; text: string; confidence: number }
interface TesseractModule { createWorker(langs: string | string[], oem?: number, options?: Record<string, unknown>): Promise<TesseractWorker> }

export interface TesseractOptions {
  /** Carpeta donde se guardan los datos de idioma descargados (por defecto, una carpeta temporal del sistema). */
  cachePath?: string
  /** Origen de los datos de idioma (URL o carpeta local). Por defecto, el CDN de tesseract.js. */
  langPath?: string
  /** Se cierra el proceso de trabajo tras este tiempo sin usarse. */
  idleMs?: number
}

/** OCR con tesseract.js. El módulo y el proceso de trabajo se cargan al reconocer la primera imagen. */
export class TesseractEngine implements OcrEngine {
  readonly name = 'tesseract'
  private worker: Promise<TesseractWorker> | null = null
  private workerLangs = ''
  private idleTimer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: TesseractOptions = {}) {}

  get isWarm(): boolean {
    return this.worker !== null
  }

  async recognize(image: Uint8Array, languages: string[], signal?: AbortSignal): Promise<OcrRawResult> {
    // Un solo reconocimiento a la vez por proceso de trabajo
    const run = this.queue.then(() => this.recognizeNow(image, languages, signal))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async recognizeNow(image: Uint8Array, languages: string[], signal?: AbortSignal): Promise<OcrRawResult> {
    if (signal?.aborted) throw new CancelledError()
    const langs = (languages.length ? languages : ['eng']).join('+')
    const worker = await this.workerFor(langs)
    this.touch()
    let onAbort: (() => void) | null = null
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return
      onAbort = () => { void this.dispose(); reject(new CancelledError()) }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const { data } = await Promise.race([worker.recognize(Buffer.from(image), {}, { text: true, blocks: true }), aborted])
      const info = imageInfo(image)
      const lines: OcrLine[] = []
      let maxX = 0, maxY = 0
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            const text = trimWSNL(line.text ?? '')
            if (!text) continue
            const b = line.bbox
            maxX = Math.max(maxX, b.x1)
            maxY = Math.max(maxY, b.y1)
            lines.push({ text, bbox: { x: b.x0, y: b.y0, width: Math.max(0, b.x1 - b.x0), height: Math.max(0, b.y1 - b.y0) }, confidence: Math.min(1, Math.max(0, (line.confidence ?? 0) / 100)) })
          }
        }
      }
      return { width: info?.width || maxX, height: info?.height || maxY, lines }
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      this.touch()
    }
  }

  private async workerFor(langs: string): Promise<TesseractWorker> {
    if (this.worker && this.workerLangs === langs) return this.worker
    if (this.worker) await this.dispose()
    this.workerLangs = langs
    this.worker = (async () => {
      const mod = (await import('tesseract.js')) as unknown as TesseractModule & { default?: TesseractModule }
      const tesseract: TesseractModule = typeof mod.createWorker === 'function' ? mod : (mod.default as TesseractModule)
      const cachePath = this.options.cachePath ?? join(tmpdir(), 'aula-tesseract')
      try { mkdirSync(cachePath, { recursive: true }) } catch { /* se intentará igual */ }
      const workerOptions: Record<string, unknown> = { cachePath }
      if (this.options.langPath) workerOptions.langPath = this.options.langPath
      return tesseract.createWorker(langs.split('+'), 1, workerOptions)
    })()
    this.worker.catch(() => { this.worker = null })
    return this.worker
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.dispose() }, this.options.idleMs ?? 60_000)
    this.idleTimer.unref?.()
  }

  async dispose(): Promise<void> {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    const w = this.worker
    this.worker = null
    if (w) {
      try { await (await w).terminate() } catch { /* ya cerrado */ }
    }
  }
}

let sharedEngine: OcrEngine | null = null
let sharedOptions: TesseractOptions = {}

/** Configura el motor por defecto (la capa de Electron pone la caché en la carpeta de datos de la app). */
export function configureOcr(options: TesseractOptions): void {
  sharedOptions = options
  void sharedEngine?.dispose?.()
  sharedEngine = null
}

/** Configuración actual del motor por defecto (el proceso de lectura recibe la misma). */
export function ocrConfiguration(): TesseractOptions {
  return { ...sharedOptions }
}

/** Motor de OCR por defecto (Tesseract, perezoso). */
export function defaultOcrEngine(): OcrEngine {
  sharedEngine ??= new TesseractEngine(sharedOptions)
  return sharedEngine
}

// MARK: Canal: imagen → OCR → texto con geometría

export const EMPTY_OCR: OcrPageResult = { text: '', firstHeading: null, averageConfidence: 0, characterCount: 0, normalizedLines: [] }

/** Reconoce una imagen y reconstruye su texto (columnas, filas de tabla, párrafos, títulos por tamaño). */
export async function recognizeImage(image: Uint8Array, engine: OcrEngine, languages: string[], signal?: AbortSignal): Promise<OcrPageResult> {
  const info = imageInfo(image)
  if (info && info.width > 0 && info.height > 0 && (info.width < 8 || info.height < 8)) return EMPTY_OCR
  let raw: OcrRawResult
  try {
    raw = await engine.recognize(image, languages, signal)
  } catch (e) {
    if (e instanceof CancelledError || (e instanceof Error && e.name === 'AbortError')) throw e
    throw new OcrFailure(errorMessage(e))
  }
  return pageFromRaw(raw)
}

export function pageFromRaw(raw: OcrRawResult): OcrPageResult {
  const observations = raw.lines.filter((l) => trimWSNL(l.text).length > 0)
  if (observations.length === 0) return EMPTY_OCR
  const w = raw.width > 0 ? raw.width : Math.max(1, ...observations.map((o) => o.bbox.x + o.bbox.width))
  const h = raw.height > 0 ? raw.height : Math.max(1, ...observations.map((o) => o.bbox.y + o.bbox.height))
  const lines: TextLine[] = observations.map((o) => ({ text: o.text, rect: o.bbox, confidence: o.confidence }))
  const layout = buildLayout(lines, true, 1.5)
  const ordered = readingOrder(lines)
  const normalizedLines = ordered.map((l) => ({
    text: l.text,
    bbox: { x: l.rect.x / w, y: l.rect.y / h, width: l.rect.width / w, height: l.rect.height / h },
    confidence: l.confidence ?? 1
  }))
  let chars = 0, weighted = 0
  for (const o of observations) {
    const n = charCount(o.text)
    chars += n
    weighted += o.confidence * n
  }
  return { text: layout.text, firstHeading: layout.firstHeading, averageConfidence: chars > 0 ? weighted / chars : 0, characterCount: chars, normalizedLines }
}

/** El motor de OCR falló (no por falta de texto). El mensaje ya es el motivo. */
export class OcrFailure extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'OcrFailure'
  }
}

export const lowConfidenceWarning = (): string => L('La foto está borrosa o inclinada; revisa que el texto se haya leído bien.')
