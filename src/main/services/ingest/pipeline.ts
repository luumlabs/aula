// Canal de lectura (port de Ingest.swift y de `WebIngest` de WebFetcher.swift): comprueba el archivo, detecta su tipo, llama
// al extractor y aplica los retoques comunes (límite de páginas, título razonable, metadatos y avisos acotados).
import { randomUUID } from 'node:crypto'
import { accessSync, constants, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { SourceDocument, SourceKind } from '@shared/ingest'
import { makeContext, ProgressReporter, WarningCollector, type IngestContext } from './core/progress'
import { decodeHTML, looksLikeText, normalizeNewlines } from './core/textDecoding'
import { checkCancelled, corrupt, errorMessage, fileNotFound, network, passwordProtected, tooLarge, unreadable, unsupportedType } from './errors'
import { extractDOCX } from './extract/docx'
import { extractEPUB } from './extract/epub'
import { extractHTML } from './extract/htmlExtractor'
import { extractImage } from './extract/image'
import { extractPDF } from './extract/pdf'
import { buildTextDocument, extractPlainText, extractRTF, readTextFile, tidyText } from './extract/plainText'
import { extractPPTX } from './extract/pptx'
import { download, downloadedFileExtension, statusReason, validateURL } from './extract/web'
import { extractXLSX } from './extract/xlsx'
import { detectKind, indexOfBytes, isWebAddress, kindForExtension, looksLikePDF, OLE_MAGIC } from './kind'
import { L } from './messages'
import { resolveOptions, type IngestOptions } from './options'
import { charCount, collapseWhitespace, prefixChars, trimWSNL, utf8Length } from './text/unicode'

/** Tamaño máximo de un PDF (2 GB). */
export const MAX_PDF_BYTES = 2_000_000_000

/** Nombre de un archivo sin la extensión. */
export function baseName(path: string): string {
  const name = basename(path)
  const ext = extname(name)
  return ext && ext !== name ? name.slice(0, -ext.length) : name
}

/** Título de reserva de un archivo: el nombre sin extensión y con los «_» como espacios. */
export function titleFromFileName(path: string): string {
  return baseName(path).replace(/_/g, ' ')
}

// MARK: Archivos

/** Lee un archivo (o una dirección http/https) y devuelve el documento. */
export async function readDocument(requested: string, partial: Partial<IngestOptions> = {}, fallbackTitle?: string): Promise<SourceDocument> {
  const options = resolveOptions(partial)
  checkCancelled(options.signal)
  if (isWebAddress(requested)) return readWeb(requested, options)
  // Otros esquemas («ftp://», «mailto:»…): ni archivo ni página web (una letra sola es una unidad de Windows)
  if (/^[a-z][a-z0-9+.-]+:/i.test(requested)) throw unsupportedType(L('«%@» no es un archivo ni una página web', requested))
  const name = basename(requested)
  let stat
  try {
    stat = statSync(requested)
  } catch {
    throw fileNotFound(name)
  }
  if (stat.isDirectory()) throw unsupportedType(L('«%@» es una carpeta; añade los archivos de uno en uno', name))
  // Se lee el destino real de los enlaces simbólicos; el nombre (título, metadatos) sigue siendo el que eligió el usuario
  let path: string
  try {
    path = realpathSync(requested)
    stat = statSync(path)
  } catch {
    throw unreadable(L('no se pudo acceder a «%@»', name))
  }
  // Tuberías, sockets o dispositivos: leerlos podría bloquear la app esperando datos que nunca llegan
  if (!stat.isFile()) throw unsupportedType(L('«%@» no es un archivo normal', name))
  try { accessSync(path, constants.R_OK) } catch { throw unreadable(L('no hay permiso para leer «%@»', name)) }
  if (stat.size === 0) throw corrupt(L('el archivo «%@» está vacío', name))

  const kind = detectKind(path)
  const progress = new ProgressReporter(options.onProgress)
  const title = fallbackTitle ?? titleFromFileName(requested)
  const ctx = makeContext(options, title, progress)
  progress.report(0, L('Preparando «%@»…', name), true)
  checkCancelled(options.signal)

  let doc: SourceDocument
  switch (kind) {
    case 'pdf': {
      if (stat.size > MAX_PDF_BYTES) throw tooLarge(L('el PDF ocupa más de 2 GB'))
      let data: Uint8Array
      try { data = readFileSync(path) } catch (e) { throw unreadable(errorMessage(e)) }
      doc = await extractPDF(data, ctx, name)
      break
    }
    case 'image': doc = await extractImage(path, ctx); break
    case 'web': return readWeb(requested, options)
    case 'unknown':
      if (isPasswordProtectedOffice(path)) throw passwordProtected(name)
      throw unsupportedType(unsupportedReason(requested))
    default: doc = await extractStructured(kind, path, ctx)
  }
  checkCancelled(options.signal)        // cancelada mientras se leía: no se entrega un resultado que ya nadie espera
  return finalize(doc, requested, options, progress)
}

/** Formatos estructurados (Word, PowerPoint, Excel, EPUB, HTML, texto, RTF). */
async function extractStructured(kind: SourceKind, path: string, ctx: IngestContext): Promise<SourceDocument> {
  checkCancelled(ctx.signal)
  switch (kind) {
    case 'docx': return extractDOCX(path, ctx)
    case 'pptx': return extractPPTX(path, ctx)
    case 'xlsx': return extractXLSX(path, ctx)
    case 'epub': return extractEPUB(path, ctx)
    case 'rtf': return extractRTF(path, ctx)
    case 'html': {
      const data = readTextFile(path)
      ctx.progress.report(0.3, L('Leyendo la página…'))
      const content = extractHTML(decodeHTML(data).text, { isolateMainContent: true })
      const meta = { ...content.metadata }
      if (content.title) meta.title = content.title
      if (!content.text) ctx.warnings.add(L('No se encontró texto en el archivo HTML.'))
      const page = { number: 1, text: content.text, usedOCR: false, hasFigures: content.hasFigures, ...(content.firstHeading ? { heading: content.firstHeading } : {}) }
      return { title: content.title || ctx.fallbackTitle, kind: 'html', pages: [page], metadata: meta, warnings: ctx.warnings.all }
    }
    default: return extractPlainText(path, kind, ctx)
  }
}

/** Los archivos de Office con contraseña no son ZIP: son un contenedor OLE con un flujo «EncryptedPackage». */
function isPasswordProtectedOffice(path: string): boolean {
  let data: Uint8Array
  try { data = readFileSync(path) } catch { return false }
  if (data.length <= 512 || indexOfBytes(data, OLE_MAGIC, 0, OLE_MAGIC.length) !== 0) return false
  const marker = Array.from(Buffer.from('EncryptedPackage', 'utf16le'))
  return indexOfBytes(data, marker) >= 0
}

/** Mensaje claro para los formatos que no se pueden leer. */
function unsupportedReason(path: string): string {
  const name = basename(path)
  const ext = extname(name).slice(1).toLowerCase()
  switch (ext) {
    case 'doc': case 'dot': return L('los documentos de Word antiguos (.doc) no están soportados; guárdalo como .docx o PDF')
    case 'ppt': case 'pps': return L('las presentaciones antiguas (.ppt) no están soportadas; guárdala como .pptx o PDF')
    case 'xls': return L('las hojas de cálculo antiguas (.xls) no están soportadas; guárdala como .xlsx')
    case 'pages': case 'key': case 'numbers': return L('los archivos de iWork (.%@) no se pueden leer; expórtalo como PDF', ext)
    case 'odt': case 'ods': case 'odp': return L('los archivos de OpenDocument (.%@) no están soportados; expórtalo como PDF o DOCX', ext)
    case 'docx': case 'pptx': case 'xlsx': case 'docm': case 'pptm': case 'xlsm':
      return L('«%@» no es un archivo de Office moderno (parece un formato antiguo); ábrelo y guárdalo de nuevo como .%@ o PDF', name, ext)
    case '': return L('no se reconoce el tipo de «%@»', name)
    default: return L('los archivos .%@ no están soportados', ext)
  }
}

/** Retoques finales comunes: límite de páginas, título razonable, metadatos y avisos acotados y al menos una página. */
function finalize(input: SourceDocument, requested: string, options: IngestOptions, progress: ProgressReporter): SourceDocument {
  let doc = input
  if (doc.pages.length > options.maxPages) {
    const note = L('Solo se leyeron las primeras %lld páginas.', options.maxPages)
    doc = { ...doc, pages: doc.pages.slice(0, options.maxPages), warnings: doc.warnings.includes(note) ? doc.warnings : [...doc.warnings, note] }
  }
  doc = tidyDocument(doc, baseName(requested))
  doc.metadata.sourceFile = basename(requested)
  progress.report(1, L('Listo'), true)
  return doc
}

// MARK: Retoques comunes (DocumentTidy)

export const TIDY_LIMITS = { maxTitle: 200, maxMetadataValue: 4_000, maxTableOfContents: 200_000, maxWarnings: 30, maxWarningLength: 400, maxTotalChars: 10_000_000 } as const

/** Texto total como mucho `max` (A2-P2-13): un docx de 190 KB daba 9 M de caracteres y un PDF de 255 KB, 29 M, que el proceso
 * principal luego trocea y guarda de golpe. Lo que sobra se corta (con aviso); un libro de verdad (3000 páginas densas) cabe. */
function capTotalText(pages: SourceDocument['pages'], max: number): { pages: SourceDocument['pages']; cut: boolean } {
  let total = 0
  for (let i = 0; i < pages.length; i++) {
    const n = pages[i].text.length
    if (total + n <= max) { total += n; continue }
    const kept = pages.slice(0, i)
    const room = max - total
    if (room > 0) kept.push({ ...pages[i], text: pages[i].text.slice(0, room).replace(/[\ud800-\udbff]$/, '') })
    return { pages: kept.length ? kept : [{ ...pages[0], text: '' }], cut: true }
  }
  return { pages, cut: false }
}

/**
 * Al menos una página, un título de una línea y de longitud razonable, y metadatos y avisos acotados (un archivo hostil no
 * puede colar megas en el título ni miles de avisos).
 */
export function tidyDocument(input: SourceDocument, fallbackTitle: string): SourceDocument {
  const doc: SourceDocument = { ...input, pages: input.pages.length ? input.pages : [{ number: 1, text: '', usedOCR: false, hasFigures: false }], metadata: { ...input.metadata } }
  const capped = capTotalText(doc.pages, TIDY_LIMITS.maxTotalChars)
  doc.pages = capped.pages
  doc.title = tidyTitle(doc.title, fallbackTitle)
  for (const [key, value] of Object.entries(doc.metadata)) {
    const limit = key === 'toc' ? TIDY_LIMITS.maxTableOfContents : TIDY_LIMITS.maxMetadataValue
    if (utf8Length(value) > limit && charCount(value) > limit) doc.metadata[key] = prefixChars(value, limit) + '…'
  }
  const raw = capped.cut ? [...input.warnings, L('El documento es demasiado largo; solo se guardó su principio (%lld millones de caracteres).', TIDY_LIMITS.maxTotalChars / 1_000_000)] : input.warnings
  let warnings = raw.map((w) => (charCount(w) > TIDY_LIMITS.maxWarningLength ? prefixChars(w, TIDY_LIMITS.maxWarningLength) + '…' : w))
  if (warnings.length > TIDY_LIMITS.maxWarnings) {
    const hidden = warnings.length - (TIDY_LIMITS.maxWarnings - 1)
    warnings = [...warnings.slice(0, TIDY_LIMITS.maxWarnings - 1), L('Hay %lld avisos más parecidos que no se muestran.', hidden)]
  }
  doc.warnings = warnings
  return doc
}

/** Título en una sola línea, sin caracteres de control y con como mucho 200 caracteres. */
export function tidyTitle(raw: string, fallback: string): string {
  const clean = (s: string): string => {
    // eslint-disable-next-line no-control-regex
    const visible = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    let t = collapseWhitespace(visible)
    if (charCount(t) > TIDY_LIMITS.maxTitle) t = prefixChars(t, TIDY_LIMITS.maxTitle).trim() + '…'
    return t
  }
  // Un título absurdo (megas) solo se mira por el principio
  const head = utf8Length(raw) > 8 * TIDY_LIMITS.maxTitle ? prefixChars(raw, 4 * TIDY_LIMITS.maxTitle) : raw
  const title = clean(head)
  if (title) return title
  const alternative = clean(fallback)
  return alternative || L('Sin título')
}

// MARK: Texto pegado

/** Texto pegado por el usuario como si fuera una fuente (una sola página). */
export function documentFromText(text: string, title: string): SourceDocument {
  const cleaned = tidyText(normalizeNewlines(text))
  const name = trimWSNL(title)
  const pasted = L('Texto pegado')
  const doc = buildTextDocument(cleaned, 'text', name || pasted, {}, cleaned ? [] : [L('El texto está vacío.')])
  if (name) doc.title = name
  return tidyDocument(doc, pasted)
}

// MARK: Páginas web

/** Descarga y lee una página web (HTML) o un documento remoto (PDF, Word, imagen…). */
export async function readWeb(address: string, partial: Partial<IngestOptions> = {}): Promise<SourceDocument> {
  const options = resolveOptions(partial)
  const url = await validateURL(address, options.allowPrivate)
  const progress = new ProgressReporter(options.onProgress)
  const warnings = new WarningCollector()
  progress.report(0, url.hostname ? L('Conectando con %@…', url.hostname) : L('Conectando con el servidor…'), true)
  const out = await download(url, { maxBytes: options.maxWebBytes, allowPrivate: options.allowPrivate, signal: options.signal, transport: options.transport, progress })
  checkCancelled(options.signal)
  if (out.status < 200 || out.status >= 300) throw network(statusReason(out.status))
  if (out.data.length === 0) throw network(L('la página está vacía'))
  progress.report(0.32, L('Leyendo la página…'), true)

  const fallback = webFallbackTitle(out.finalURL)
  const head = out.data.subarray(0, 4096)
  const looksBinary = !(out.mime.includes('html') || out.mime.startsWith('text/') || (out.mime === '' && looksLikeText(head)))
  let doc: SourceDocument
  if (looksBinary || looksLikePDF(out.data.subarray(0, 1024))) {
    // Documentos remotos (PDF, Word, imágenes…): se guardan en un archivo temporal y se leen como si fueran locales
    const ext = downloadedFileExtension(out.mime, out.finalURL, (e) => kindForExtension(e) !== null)
    const dir = join(tmpdir(), `aula-web-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const file = join(dir, 'documento' + ext)
      writeFileSync(file, out.data)
      const inner: Partial<IngestOptions> = { ...options, onProgress: (f, m) => progress.report(0.32 + 0.66 * f, m) }
      doc = await readDocument(file, inner, fallback)
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* nada */ }
    }
    doc.metadata.url = out.finalURL.href
  } else {
    const html = decodeHTML(out.data, out.charset).text
    if (out.mime === 'text/plain' || out.mime === 'text/markdown') {
      doc = buildTextDocument(tidyText(html), out.mime === 'text/markdown' ? 'markdown' : 'text', fallback, {}, [])
      doc.kind = 'web'
    } else {
      const content = extractHTML(html, { isolateMainContent: true })
      const meta = { ...content.metadata }
      if (content.title) meta.title = content.title
      if (charCount(content.text) < 300 && html.split('<script').length > 6) {
        warnings.add(L('Esta página parece cargar su contenido con JavaScript y solo se pudo leer una parte. Prueba a guardarla como PDF o a pegar el texto.'))
      }
      if (!content.text) warnings.add(L('No se encontró texto en la página.'))
      const page = { number: 1, text: content.text, usedOCR: false, hasFigures: content.hasFigures, ...(content.firstHeading ? { heading: content.firstHeading } : {}) }
      doc = { title: content.title || fallback, kind: 'web', pages: [page], metadata: meta, warnings: warnings.all }
    }
    doc.metadata.url = out.finalURL.href
    if (out.finalURL.hostname && doc.metadata.siteName === undefined) doc.metadata.siteName = out.finalURL.hostname
    doc = tidyDocument(doc, fallback)
  }
  progress.report(1, L('Listo'), true)
  return doc
}

function webFallbackTitle(url: URL): string {
  let name = url.pathname.split('/').filter(Boolean).pop() ?? ''
  try { name = decodeURIComponent(name) } catch { /* tal cual */ }
  const ext = extname(name)
  if (ext && ext !== name) name = name.slice(0, -ext.length)
  if (!name) return url.hostname || L('Página web')
  return name.replace(/[-_]/g, ' ')
}
