// Imágenes (png, jpg, gif, bmp, webp, tiff…): OCR con el motor configurado (Tesseract por defecto). Las que el OCR no sabe
// leer (HEIC, AVIF) se convierten antes con el `PageRasterizer` de la capa de Electron, si lo hay.
import { readFileSync, statSync } from 'node:fs'
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, type IngestContext } from '../core/progress'
import { corrupt, errorMessage, isCancelled, tooLarge, unreadable } from '../errors'
import { ingestLanguage, L } from '../messages'
import { firstHeading } from '../text/headingDetector'
import { charCount, isLetter } from '../text/unicode'
import { imageInfo } from './imageInfo'
import { defaultOcrEngine, defaultOcrLanguages, lowConfidenceWarning, recognizeImage, type OcrEngine } from './ocr'

export const MAX_IMAGE_BYTES = 200 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 300_000_000

/** Motor de OCR de una lectura (`null` si está desactivado). */
export function ocrEngineFor(ctx: IngestContext): OcrEngine | null {
  if (ctx.options.ocr === false) return null
  return ctx.options.ocr ?? defaultOcrEngine()
}

/** Idiomas del OCR de una lectura. */
export function ocrLanguagesFor(ctx: IngestContext): string[] {
  if (ctx.options.ocrLanguages?.length) return defaultOcrLanguages({ preferred: ctx.options.ocrLanguages, interface: ingestLanguage() })
  return defaultOcrLanguages({ course: ctx.options.language, interface: ingestLanguage() })
}

export async function extractImage(path: string, ctx: IngestContext): Promise<SourceDocument> {
  let size = 0
  try { size = statSync(path).size } catch { size = 0 }
  if (size > MAX_IMAGE_BYTES) throw tooLarge(L('la imagen ocupa más de %lld MB', Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))))
  let data: Uint8Array
  try { data = readFileSync(path) } catch (e) { throw unreadable(errorMessage(e)) }
  const info = imageInfo(data)
  if (!info) throw corrupt(L('no se pudo abrir la imagen (¿está dañada o es de un formato no soportado?)'))
  if (info.frames > 1) {
    // Solo el TIFF es un documento de varias páginas; el OCR lee la primera
    ctx.warnings.add(L('La imagen tiene %lld páginas; solo se leyó la primera.', info.frames))
  }
  if (info.width > 0 && info.height > 0 && info.width * info.height > MAX_IMAGE_PIXELS) {
    throw tooLarge(L('la imagen tiene %lld megapíxeles (el máximo son %lld)', Math.floor((info.width * info.height) / 1_000_000), MAX_IMAGE_PIXELS / 1_000_000))
  }
  ctx.progress.report(0.02, L('Preparando la imagen…'), true)

  const meta: Record<string, string> = {}
  if (info.width > 0) { meta.pixelWidth = String(info.width); meta.pixelHeight = String(info.height) }
  const page: SourcePage = { number: 1, text: '', usedOCR: false, hasFigures: true }

  // HEIC/AVIF: el OCR no los decodifica; se convierten a PNG si hay quien sepa
  let image: Uint8Array | null = data
  if (info.format === 'heif' || info.format === 'avif') {
    image = ctx.options.rasterizer?.imageToPng ? await ctx.options.rasterizer.imageToPng(data, 4500).catch(() => null) : null
    if (!image) {
      ctx.warnings.add(L('No se pudo decodificar la imagen.'))
      page.needsOCR = true
      return finish(page, meta, ctx)
    }
  }

  const engine = ocrEngineFor(ctx)
  if (!engine) {
    page.needsOCR = true
    ctx.warnings.add(L('El reconocimiento de texto (OCR) no está disponible: la imagen se guardó sin texto.'))
    return finish(page, meta, ctx)
  }
  if (engine.isWarm === false) ctx.progress.report(0.03, L('Preparando el reconocimiento de texto (la primera vez puede tardar hasta medio minuto)…'), true)
  ctx.progress.report(0.05, L('Reconociendo el texto de la imagen…'))
  checkContext(ctx)
  try {
    const result = await recognizeImage(image, engine, ocrLanguagesFor(ctx), ctx.signal)
    page.text = result.text
    page.usedOCR = result.text.length > 0
    page.heading = result.firstHeading ?? firstHeading(result.text) ?? undefined
    if (result.text) {
      page.ocrConfidence = Math.round(result.averageConfidence * 100) / 100
      meta.ocrConfidence = result.averageConfidence.toFixed(2)
      if (result.averageConfidence < 0.5) { page.lowConfidence = true; ctx.warnings.add(lowConfidenceWarning()) }
    }
  } catch (e) {
    if (isCancelled(e)) throw e
    page.needsOCR = true
    ctx.warnings.add(L('No se pudo reconocer el texto de la imagen: %@', errorMessage(e)))
  }
  if (!page.text && !page.needsOCR) ctx.warnings.add(L('No se encontró texto en la imagen.'))
  return finish(page, meta, ctx)
}

function finish(page: SourcePage, meta: Record<string, string>, ctx: IngestContext): SourceDocument {
  let firstLine: string | null = null
  if (page.text) {
    if (page.heading !== undefined && charCount(page.heading) <= 100) firstLine = page.heading
    else {
      const line = page.text.split('\n').find((l) => l.length > 0) ?? ''
      const n = charCount(line)
      firstLine = n >= 4 && n <= 70 ? line : null
    }
  }
  const title = isGenericName(ctx.fallbackTitle) ? firstLine ?? ctx.fallbackTitle : ctx.fallbackTitle
  return { title, kind: 'image', pages: [page], metadata: meta, warnings: ctx.warnings.all }
}

const GENERIC_PREFIXES = '(img|dsc|dscn|dscf|pxl|image|imagen|photo|foto|scan|escaneo|screenshot|screen shot|captura|whatsapp image|wp|mvimg|pic|picture|cam|camera|untitled|sin título)'
const GENERIC_TAIL = '[\\s_\\-.()0-9]*((at|a las|a la|à|um|de)[\\s_\\-.()0-9]+)?(\\(\\d+\\))?'
const GENERIC = new RegExp('^' + GENERIC_PREFIXES + GENERIC_TAIL + '$')

/** Nombres de cámara o de capturas ("IMG_2034", "Captura de pantalla…", "scan0012"): no dicen nada del contenido. */
export function isGenericName(name: string): boolean {
  const n = name.toLowerCase().trim()
  if (GENERIC.test(n)) return true
  if (n.startsWith('captura de pantalla') || n.startsWith('screenshot') || n.startsWith('simulator screenshot') || n.startsWith('screen shot')) return true
  return Array.from(n).filter(isLetter).length < 3
}
