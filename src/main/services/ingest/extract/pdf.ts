// PDF (port de PDFExtractor.swift con pdf.js): capa de texto con su geometría → orden de lectura, columnas, tablas y títulos
// por tamaño; cabeceras, pies y números de página repetidos fuera; páginas escaneadas o con texto ilegible → OCR de la página
// dibujada (si la capa de Electron da un `PageRasterizer` y hay motor de OCR) o, si no, marcadas con `needsOCR`.
// Los números de página son los reales, para citar «(p. 3)».
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, yieldToEventLoop, type IngestContext } from '../core/progress'
import { CancelledError, corrupt, errorMessage, isCancelled, passwordProtected } from '../errors'
import { L } from '../messages'
import { firstHeading } from '../text/headingDetector'
import { filterHeadersAndFooters } from '../text/headerFooter'
import { buildLayout, type Rect, type TextLine } from '../text/layoutBuilder'
import { finalizeText, looksLikeGarbage, reflow } from '../text/textCleaner'
import { charCount, trimSet, trimWSNL } from '../text/unicode'
import { ocrEngineFor, ocrLanguagesFor } from './image'
import { recognizeImage, type OcrEngine, type OcrPageResult } from './ocr'
import { usableTitle } from './ooxml'

// MARK: pdf.js (cargado al leer el primer PDF)

interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean; dir?: string }
interface PdfViewport { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] }
interface PdfOperatorList { fnArray: number[]; argsArray: unknown[][] }
interface PdfPage {
  view: number[]
  rotate: number
  getViewport(params: { scale: number }): PdfViewport
  getTextContent(params?: Record<string, unknown>): Promise<{ items: Array<PdfTextItem | { type: string }> }>
  getOperatorList(params?: Record<string, unknown>): Promise<PdfOperatorList>
  cleanup(): boolean
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  getMetadata(): Promise<{ info?: Record<string, unknown> }>
  destroy(): Promise<void>
}
interface PdfLoadingTask { promise: Promise<PdfDocument>; destroy(): Promise<void> }
interface PdfjsModule {
  getDocument(params: Record<string, unknown>): PdfLoadingTask
  OPS: Record<string, number>
  PDFDateString?: { toDateObject(input: string): Date | null }
}

let pdfjsModule: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsModule ??= importPdfjs().catch((e: unknown) => {
    pdfjsModule = null
    throw e
  })
  return pdfjsModule
}

/**
 * pdf.js decide al cargarse si está en Node mirando `process.type`: en el proceso de utilidad de Electron («utility») se
 * creería en un navegador (sin DOMMatrix ni lectura de CMap y fuentes desde archivos). Mientras se carga, se presenta como
 * el proceso principal («browser»), que pdf.js sí trata como Node.
 */
async function importPdfjs(): Promise<PdfjsModule> {
  const proc = process as unknown as { type?: string }
  const desc = Object.getOwnPropertyDescriptor(process, 'type')
  const patch = !!process.versions.electron && !!desc?.configurable && 'value' in desc && typeof proc.type === 'string' && proc.type !== 'browser'
  if (patch) Object.defineProperty(process, 'type', { ...desc, value: 'browser' })
  installDomShims()
  try {
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule
  } finally {
    if (patch && desc) Object.defineProperty(process, 'type', desc)
  }
}

/**
 * La app instalada no lleva @napi-rs/canvas (es nativo, uno por sistema y arquitectura: rompe la app universal de macOS
 * y falta en los instaladores compilados en otro sistema). Sin él, pdf.js no llega a cargar en Node: crea un DOMMatrix al
 * cargarse. Para leer texto y operadores (lo único que se hace aquí: las páginas se dibujan en una ventana oculta, ver
 * electron/rasterizer.ts) bastan unos sustitutos mínimos. Con el paquete presente (desarrollo, pruebas) no se tocan.
 */
function installDomShims(): void {
  const g = globalThis as Record<string, unknown>
  if (typeof g.DOMMatrix !== 'undefined' || canvasAvailable()) return
  g.DOMMatrix = class DOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0
  }
  g.Path2D ??= class Path2D {}
  g.ImageData ??= class ImageData {
    constructor(readonly width = 0, readonly height = 0) {}
  }
}

function canvasAvailable(): boolean {
  const bases = [typeof __filename === 'string' ? __filename : '', join(process.cwd(), 'package.json')].filter(Boolean)
  for (const base of bases) {
    try {
      const pdfjsDir = dirname(createRequire(base).resolve('pdfjs-dist/package.json'))
      createRequire(join(pdfjsDir, 'package.json'))('@napi-rs/canvas') // con su parte nativa: lo mismo que hará pdf.js
      return true
    } catch { /* siguiente */ }
  }
  return false
}

let assets: { cMapUrl?: string; standardFontDataUrl?: string } | null = null

/** Carpeta del paquete pdfjs-dist (para los mapas CMap de las fuentes CJK y las fuentes estándar). */
function pdfjsAssets(): { cMapUrl?: string; standardFontDataUrl?: string } {
  assets ??= findPdfjsAssets()
  return assets
}

function findPdfjsAssets(): { cMapUrl?: string; standardFontDataUrl?: string } {
  const bases = [typeof __filename === 'string' ? __filename : '', join(process.cwd(), 'package.json')].filter(Boolean)
  for (const base of bases) {
    try {
      const dir = dirname(createRequire(base).resolve('pdfjs-dist/package.json'))
      return { cMapUrl: join(dir, 'cmaps') + '/', standardFontDataUrl: join(dir, 'standard_fonts') + '/' }
    } catch { /* siguiente */ }
  }
  return {}
}

/** Abre un PDF con contraseña vacía; lanza los errores claros para el usuario. */
async function openPDF(data: Uint8Array, name: string): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),         // copia como Uint8Array normal (pdf.js rechaza los Buffer y puede quedarse con el búfer)
    password: '',
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    cMapPacked: true,
    verbosity: 0,
    ...pdfjsAssets()
  })
  let doc: PdfDocument
  try {
    doc = await task.promise
  } catch (e) {
    void task.destroy().catch(() => undefined)
    const kind = e instanceof Error ? e.name : ''
    if (kind === 'PasswordException') throw passwordProtected(name)
    throw corrupt(L('no se pudo abrir el PDF (¿está dañado o incompleto?)'))
  }
  if (doc.numPages <= 0) {
    await doc.destroy().catch(() => undefined)
    throw corrupt(L('el PDF no tiene páginas'))
  }
  return doc
}

// MARK: Capa de texto

interface NativePage {
  lines: TextLine[]
  rawString: string
  /** Tamaño de la página ya rotada, en puntos. */
  width: number
  height: number
  needsOCR: boolean
  garbage: boolean
  hasFigures: boolean
  scanLikeImage: boolean
  /** Se miró el contenido dibujado (imágenes y trazados). */
  probed: boolean
  /** Tiene algo dibujado además del texto: imágenes grandes o bastantes trazados. */
  hasDrawing: boolean
}

/** Línea en construcción, en el espacio de la página (origen abajo a la izquierda, sin rotar). */
interface LineBuilder {
  text: string
  x0: number
  x1: number
  baseline: number
  size: number
  bottom: number
  top: number
  horizontal: boolean
  corners: number[][]
}

const nonSpaceCount = (s: string): number => {
  let n = 0
  for (const ch of s) if (!/\s/u.test(ch)) n++
  return n
}

/** Esquinas del rectángulo de un fragmento de texto (espacio de la página): base con descendentes y ascendentes. */
function itemCorners(item: PdfTextItem): { corners: number[][]; size: number; horizontal: boolean; x: number; y: number } {
  const [a, b, c, d, e, f] = item.transform
  const size = Math.hypot(c, d) || Math.abs(item.height) || Math.hypot(a, b) || 1
  const run = Math.hypot(a, b) || 1
  const ux = (a / run) * item.width, uy = (b / run) * item.width
  const up = Math.hypot(c, d) || 1
  const vx = (c / up) * size, vy = (d / up) * size
  const horizontal = Math.abs(b) <= 1e-3 * Math.max(Math.abs(a), 1e-9) && Math.abs(c) <= 1e-3 * Math.max(Math.abs(d), 1e-9) && a > 0 && d > 0 && item.dir !== 'ttb'
  const lo = -0.22, hi = 0.78
  const corners = [
    [e + lo * vx, f + lo * vy], [e + ux + lo * vx, f + uy + lo * vy],
    [e + hi * vx, f + hi * vy], [e + ux + hi * vx, f + uy + hi * vy]
  ]
  return { corners, size, horizontal, x: e, y: f }
}

function displayRect(corners: number[][], viewport: PdfViewport): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of corners) {
    const [vx, vy] = viewport.convertToViewportPoint(x, y)
    minX = Math.min(minX, vx); maxX = Math.max(maxX, vx)
    minY = Math.min(minY, vy); maxY = Math.max(maxY, vy)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Agrupa los fragmentos de texto de pdf.js en líneas (como `selectionsByLine` de PDFKit): mismos renglón y dirección y sin un
 * hueco grande entre ellos (una calle entre columnas o una celda de tabla separan líneas). Los índices y exponentes, más
 * pequeños y desplazados, se pegan a su línea sin espacio.
 */
export function linesFromItems(items: PdfTextItem[], viewport: PdfViewport): TextLine[] {
  const out: TextLine[] = []
  let cur: LineBuilder | null = null
  const flush = (): void => {
    if (cur && trimWSNL(cur.text)) out.push({ text: trimWSNL(cur.text), rect: displayRect(cur.corners, viewport) })
    cur = null
  }
  for (const item of items) {
    const str = item.str ?? ''
    if (!str || !trimWSNL(str) || !Array.isArray(item.transform) || item.transform.length < 6 || !item.transform.every(Number.isFinite)) {
      if (item.hasEOL && cur && !(cur as LineBuilder).horizontal) flush()
      continue
    }
    const g = itemCorners(item)
    const bottom = g.y - 0.22 * g.size, top = g.y + 0.78 * g.size
    const width = Number.isFinite(item.width) ? Math.max(0, item.width) : 0
    const line = cur as LineBuilder | null
    if (line && line.horizontal && g.horizontal) {
      const gap = g.x - line.x1
      const sameRow = Math.abs(g.y - line.baseline) <= 0.3 * Math.min(g.size, line.size)
      const scripted = g.size < 0.85 * line.size && bottom < line.top && top > line.bottom && Math.abs(gap) <= 0.3 * line.size
      if ((sameRow && gap >= -0.5 * line.size && gap <= 0.6 * Math.max(g.size, line.size)) || scripted) {
        const needsSpace = !scripted && gap > 0.15 * Math.min(g.size, line.size) && !/\s$/u.test(line.text) && !/^\s/u.test(str)
        line.text += (needsSpace ? ' ' : '') + str
        line.x1 = Math.max(line.x1, g.x + width)
        line.bottom = Math.min(line.bottom, bottom)
        line.top = Math.max(line.top, top)
        line.corners.push(...g.corners)
        continue
      }
    }
    flush()
    cur = { text: str, x0: g.x, x1: g.x + width, baseline: g.y, size: g.size, bottom, top, horizontal: g.horizontal, corners: [...g.corners] }
    if (!g.horizontal) flush()
  }
  flush()
  return out
}

/** Texto de la capa nativa tal cual (para contar caracteres y como respaldo sin geometría). */
function rawText(items: PdfTextItem[]): string {
  let s = ''
  for (const it of items) {
    s += it.str ?? ''
    if (it.hasEOL) s += '\n'
  }
  return s
}

// MARK: Imágenes grandes (figuras)

interface ImageProbe { largeImages: number; fullPageImage: boolean; /** Trazados dibujados (texto convertido en curvas, diagramas…). */ paths: number }

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
]
const asMatrix = (v: unknown): Matrix | null => {
  if (!v || typeof v !== 'object' || !('length' in v)) return null
  const a = Array.from(v as ArrayLike<number>)
  return a.length >= 6 && a.slice(0, 6).every(Number.isFinite) ? (a.slice(0, 6) as Matrix) : null
}

/**
 * Cuenta las imágenes grandes (≥ 120 × 120 píxeles, sin las máscaras) de la lista de operaciones de una página y si alguna
 * cubre casi toda la página (típico de un escaneo).
 */
export function probeImages(list: PdfOperatorList, OPS: Record<string, number>, pageWidth: number, pageHeight: number): ImageProbe {
  const result: ImageProbe = { largeImages: 0, fullPageImage: false, paths: 0 }
  let ctm: Matrix = IDENTITY
  const stack: Matrix[] = []
  const n = Math.min(list.fnArray.length, 2_000_000)
  for (let k = 0; k < n; k++) {
    const fn = list.fnArray[k]
    const args = list.argsArray[k] ?? []
    if (fn === OPS.constructPath) { result.paths++; continue }
    if (fn === OPS.save) { if (stack.length < 1000) stack.push(ctm) }
    else if (fn === OPS.restore) { ctm = stack.pop() ?? IDENTITY }
    else if (fn === OPS.transform) { const m = asMatrix(args); if (m) ctm = multiply(ctm, m) }
    else if (fn === OPS.paintFormXObjectBegin) {
      if (stack.length < 1000) stack.push(ctm)
      const m = asMatrix(args[0])
      if (m) ctm = multiply(ctm, m)
    } else if (fn === OPS.paintFormXObjectEnd) { ctm = stack.pop() ?? IDENTITY }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintInlineImageXObject) {
      let w = 0, h = 0
      if (fn === OPS.paintInlineImageXObject) {
        const img = args[0] as { width?: number; height?: number } | undefined
        w = Number(img?.width ?? 0); h = Number(img?.height ?? 0)
      } else {
        w = Number(args[1] ?? 0); h = Number(args[2] ?? 0)
      }
      if (!(w >= 120 && h >= 120)) continue
      result.largeImages++
      // Tamaño dibujado: el cuadrado unidad transformado por la matriz actual
      const drawnW = Math.hypot(ctm[0], ctm[1]), drawnH = Math.hypot(ctm[2], ctm[3])
      if (drawnW >= 0.8 * pageWidth && drawnH >= 0.8 * pageHeight) result.fullPageImage = true
      if (result.largeImages > 400) break
    }
  }
  return result
}

/** Tiempo total que se dedica a buscar figuras (pdf.js decodifica las imágenes para listarlas): los escaneos largos no esperan. */
const FIGURE_PROBE_BUDGET_MS = 20_000

/**
 * Tiempo total para la capa de texto (A2-P1-3). Lo normal son milisegundos por página; un PDF hostil (un flujo de 100 MB
 * comprimido a 100 KB y compartido por todas sus páginas) tardaba ~8 s por página y hasta horas con 2000 páginas. Pasado el
 * tope se deja de leer, con aviso: lo leído se guarda.
 */
let textBudgetMs = 120_000

/** Para las pruebas: otro tope de tiempo de la capa de texto (devuelve el anterior). */
export function setPdfTextBudgetForTests(ms: number): number {
  const before = textBudgetMs
  textBudgetMs = ms
  return before
}

async function readNative(doc: PdfDocument, pageNumber: number, OPS: Record<string, number>, budget: { ms: number }): Promise<NativePage> {
  const native: NativePage = { lines: [], rawString: '', width: 612, height: 792, needsOCR: false, garbage: false, hasFigures: false, scanLikeImage: false, probed: false, hasDrawing: true }
  let page: PdfPage
  try {
    page = await doc.getPage(pageNumber)
  } catch {
    return native
  }
  try {
    const viewport = page.getViewport({ scale: 1 })
    if (viewport.width >= 1 && viewport.height >= 1 && Number.isFinite(viewport.width) && Number.isFinite(viewport.height)) {
      native.width = viewport.width
      native.height = viewport.height
    }
    try {
      const content = await page.getTextContent({ includeMarkedContent: false })
      const items = content.items.filter((i): i is PdfTextItem => typeof (i as PdfTextItem).str === 'string')
      native.rawString = rawText(items)
      native.lines = linesFromItems(items, viewport)
    } catch {
      native.rawString = ''
    }
    if (budget.ms > 0) {
      const started = performance.now()
      try {
        const list = await page.getOperatorList()
        const w = Math.abs((page.view[2] ?? 612) - (page.view[0] ?? 0)), h = Math.abs((page.view[3] ?? 792) - (page.view[1] ?? 0))
        const probe = probeImages(list, OPS, w, h)
        native.hasFigures = probe.largeImages > 0
        native.scanLikeImage = probe.fullPageImage && probe.largeImages === 1
        native.hasDrawing = probe.largeImages > 0 || probe.paths >= 20
        native.probed = true
      } catch { /* sin figuras */ }
      budget.ms -= performance.now() - started
    }
  } finally {
    try { page.cleanup() } catch { /* nada */ }
  }
  return native
}

// MARK: Extracción

export async function extractPDF(data: Uint8Array, ctx: IngestContext, fileName: string): Promise<SourceDocument> {
  const doc = await openPDF(data, fileName)
  try {
    return await extractOpened(doc, data, ctx)
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

async function extractOpened(doc: PdfDocument, data: Uint8Array, ctx: IngestContext): Promise<SourceDocument> {
  const options = ctx.options
  const pdfjs = await loadPdfjs()
  const total = Math.min(doc.numPages, Math.max(options.maxPages, 1))
  if (doc.numPages > total) ctx.warnings.add(L('El PDF tiene %lld páginas; solo se leyeron las primeras %lld.', doc.numPages, total))
  ctx.progress.report(0.01, L('Abriendo el PDF…'), true)

  // 1. Capa de texto de cada página
  const natives: NativePage[] = []
  const ocrIndexes: number[] = []
  const budget = { ms: FIGURE_PROBE_BUDGET_MS }
  const canOCR = !!options.rasterizer && options.ocr !== false
  const started = performance.now()
  for (let i = 0; i < total; i++) {
    // cada página cede el hilo (pdf.js no lo hace dentro: solo encadena promesas) para que lleguen la cancelación y el resto
    if (i > 0) await yieldToEventLoop()
    checkContext(ctx)
    if (i > 0 && performance.now() - started > textBudgetMs) {
      ctx.warnings.add(L('El PDF tarda demasiado en leerse; solo se leyeron las primeras %lld páginas.', i))
      break
    }
    ctx.progress.report(0.02 + (0.23 * i) / total, L('Leyendo página %@ de %@…', String(i + 1), String(total)))
    const native = await readNative(doc, i + 1, pdfjs.OPS, budget)
    const significant = nonSpaceCount(native.rawString)
    native.garbage = significant > 0 && looksLikeGarbage(native.rawString)
    // Sin texto: con quien dibuje la página, el OCR dirá si hay algo; sin él, solo las que tienen algo dibujado
    if (native.garbage) native.needsOCR = true
    else if (significant === 0) native.needsOCR = canOCR || native.hasDrawing
    // Poco texto: solo se hace OCR si la página tiene imágenes además del texto (o si no se pudo mirar)
    else if (significant < options.ocrWhenTextShorterThan) native.needsOCR = native.hasFigures || budget.ms <= 0
    if (native.needsOCR) ocrIndexes.push(i)
    natives.push(native)
  }

  // 2. Cabeceras, pies y números de página repetidos (solo páginas con capa de texto)
  const nativeIdx = natives.map((_, i) => i).filter((i) => natives[i].lines.length > 0 && !natives[i].garbage)
  const filtered = filterHeadersAndFooters(nativeIdx.map((i) => natives[i].lines), nativeIdx.map((i) => natives[i].height))
  nativeIdx.forEach((i, k) => { natives[i].lines = filtered[k] })

  // Texto de la capa nativa de todas las páginas; en las que necesitan OCR sirve de respaldo si el OCR no lo mejora
  const pages: SourcePage[] = natives.map((n, i) => {
    let text = ''
    let heading: string | null = null
    if (!n.garbage) {
      const layout = buildLayout(n.lines)
      text = layout.text
      heading = layout.firstHeading
      if (!text && n.rawString) text = finalizeText(reflow(n.rawString))
    }
    heading ??= firstHeading(text)
    const page: SourcePage = { number: i + 1, text, usedOCR: false, hasFigures: n.hasFigures && !(n.needsOCR && n.scanLikeImage) }
    if (heading) page.heading = heading
    return page
  })

  // 3. OCR de las páginas sin texto (o, sin quien las dibuje, marcadas para verlas como imagen)
  if (ocrIndexes.length) await recognizePages(ocrIndexes, data, natives, pages, total, ctx)
  ctx.progress.report(0.99, L('Terminando…'))

  // 4. Metadatos y título
  const meta = await metadataOf(doc, pdfjs)
  const first = pages.find((p) => p.text.length > 0)?.heading
  const title = pdfTitle(meta.title) ?? (first ? shortTitle(first) : null) ?? ctx.fallbackTitle
  meta.title = title
  const ocrCount = pages.filter((p) => p.usedOCR).length
  if (ocrCount > 0) meta.ocrPages = String(ocrCount)
  if (pages.every((p) => p.text.length === 0)) {
    if (ocrIndexes.length === 0) ctx.warnings.add(L('El PDF no contiene texto.'))
    else if (pages.some((p) => p.needsOCR)) { /* el aviso de las páginas sin leer ya lo explica */ }
    else ctx.warnings.add(L('No se pudo reconocer texto en el PDF (¿páginas en blanco o imágenes sin texto?).'))
  }
  return { title, kind: 'pdf', pages, metadata: meta, warnings: ctx.warnings.all }
}

async function metadataOf(doc: PdfDocument, pdfjs: PdfjsModule): Promise<Record<string, string>> {
  const meta: Record<string, string> = { pageCount: String(doc.numPages) }
  let info: Record<string, unknown> = {}
  try { info = (await doc.getMetadata()).info ?? {} } catch { info = {} }
  const str = (key: string): string | null => {
    const v = info[key]
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t ? t : null
  }
  const date = (key: string): string | null => {
    const raw = str(key)
    if (!raw) return null
    try {
      const d = pdfjs.PDFDateString?.toDateObject(raw)
      return d && !Number.isNaN(d.getTime()) ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null
    } catch {
      return null
    }
  }
  const set = (k: string, v: string | null): void => { if (v) meta[k] = v }
  set('title', str('Title'))
  set('author', str('Author'))
  set('subject', str('Subject'))
  set('keywords', str('Keywords'))
  set('creator', str('Creator'))
  set('created', date('CreationDate'))
  set('modified', date('ModDate'))
  return meta
}

// MARK: OCR

/** Lado largo (px) con el que se dibuja una página para el OCR: ≈ 200 ppp, entre 1000 y 3600. */
export function ocrRenderSide(width: number, height: number): number {
  const px = (Math.max(width, height) * 200) / 72
  return Math.round(Math.min(3600, Math.max(1000, Number.isFinite(px) ? px : 1000)))
}

async function recognizePages(indexes: number[], data: Uint8Array, natives: NativePage[], pages: SourcePage[], total: number, ctx: IngestContext): Promise<void> {
  const rasterizer = ctx.options.rasterizer
  const engine: OcrEngine | null = rasterizer ? ocrEngineFor(ctx) : null
  if (!rasterizer || !engine) {
    markUnread(indexes, pages, ctx)
    return
  }
  const languages = ocrLanguagesFor(ctx)
  ctx.progress.report(0.25, L('Preparando el reconocimiento de texto (OCR)…'), true)
  if (engine.isWarm === false) ctx.progress.report(0.25, L('Preparando el reconocimiento de texto (la primera vez puede tardar hasta medio minuto)…'), true)

  const results = new Map<number, OcrPageResult>()
  const failures: string[] = []
  const failed: number[] = []
  let done = 0
  for (const index of indexes) {
    checkContext(ctx)
    try {
      const png = await rasterizer.renderPdfPage(data, index + 1, ocrRenderSide(natives[index].width, natives[index].height))
      checkContext(ctx)
      if (!png) { failures.push(L('no se pudo dibujar la página')); failed.push(index) }
      else results.set(index, await recognizeImage(png, engine, languages, ctx.signal))
    } catch (e) {
      if (isCancelled(e) || ctx.signal?.aborted) throw new CancelledError()
      failures.push(errorMessage(e))
      failed.push(index)
    }
    done++
    ctx.progress.report(0.25 + (0.73 * done) / indexes.length, L('Reconociendo texto (OCR) en la página %@ de %@…', String(index + 1), String(total)))
  }
  if (failures.length) ctx.warnings.add(L('El reconocimiento de texto (OCR) falló en %lld página(s): %@', failures.length, failures[0]))

  // Cabeceras y pies repetidos también en páginas escaneadas
  const order: number[] = []
  const ocrLines: TextLine[][] = []
  for (const i of indexes) {
    const r = results.get(i)
    if (!r || r.normalizedLines.length === 0) continue
    const { width, height } = natives[i]
    ocrLines.push(r.normalizedLines.map((l) => ({
      text: l.text,
      rect: { x: l.bbox.x * width, y: l.bbox.y * height, width: l.bbox.width * width, height: l.bbox.height * height },
      confidence: l.confidence
    })))
    order.push(i)
  }
  const filtered = filterHeadersAndFooters(ocrLines, order.map((i) => natives[i].height))
  let lowConfidence = 0
  order.forEach((i, k) => {
    const r = results.get(i) as OcrPageResult
    let text = r.text
    let heading = r.firstHeading
    if (filtered[k].length !== ocrLines[k].length) {
      // Se quitaron líneas repetidas: se reconstruye el texto con la misma geometría
      const layout = buildLayout(filtered[k], true, 1.5)
      text = layout.text
      heading = layout.firstHeading
    }
    // El OCR solo sustituye al texto nativo si aporta más
    if (nonSpaceCount(text) <= nonSpaceCount(pages[i].text)) return
    const low = r.averageConfidence < 0.5 && r.characterCount > 0
    if (low) lowConfidence++
    const page: SourcePage = { number: i + 1, text, usedOCR: true, hasFigures: natives[i].hasFigures && !natives[i].scanLikeImage }
    const h = heading ?? firstHeading(text)
    if (h) page.heading = h
    page.ocrConfidence = Math.round(r.averageConfidence * 100) / 100
    if (low) page.lowConfidence = true
    pages[i] = page
  })
  if (lowConfidence > 0) {
    ctx.warnings.add(lowConfidence === 1 ? L('Una página escaneada se leyó con poca confianza: revisa su texto.')
      : L('%lld páginas escaneadas se leyeron con poca confianza: revisa su texto.', lowConfidence))
  }
  // Las que no se pudieron leer necesitan su imagen
  for (const i of failed) if (!pages[i].usedOCR && nonSpaceCount(pages[i].text) < ctx.options.ocrWhenTextShorterThan) pages[i].needsOCR = true
}

/** Sin OCR disponible: las páginas escaneadas (o con poco texto e imágenes) quedan marcadas para verlas como imagen. */
function markUnread(indexes: number[], pages: SourcePage[], ctx: IngestContext): void {
  let unread = 0
  for (const i of indexes) {
    pages[i].needsOCR = true
    if (nonSpaceCount(pages[i].text) === 0) unread++
  }
  if (unread > 0) {
    ctx.warnings.add(unread === 1
      ? L('Una página parece escaneada y no se pudo leer su texto; se usará su imagen.')
      : L('%lld páginas parecen escaneadas y no se pudo leer su texto; se usarán sus imágenes.', unread))
  }
}

// MARK: Título

const TITLE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.tex', '.dvi', '.indd', '.pptx', '.odt', '.rtf', '.txt']

function pdfTitle(raw: string | undefined): string | null {
  let t = usableTitle(raw)
  if (!t) return null
  for (const ext of TITLE_EXTENSIONS) if (t.toLowerCase().endsWith(ext)) t = t.slice(0, t.length - ext.length)
  t = trimWSNL(t)
  return t || null
}

function shortTitle(heading: string): string | null {
  const t = trimSet(heading, '# ', true)
  return !t || charCount(t) > 120 ? null : t
}

