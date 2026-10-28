import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PageRasterizer } from '@shared/ingest'
import { makeContext } from '../core/progress'
import { setIngestLanguage } from '../messages'
import { resolveOptions } from '../options'
import { readDocument } from '../pipeline'
import { png, tempDir, type TempDir } from '../testing/files'
import { buildPDF } from '../testing/pdf'
import { ocrLanguagesFor } from './image'
import { defaultOcrLanguages, pageFromRaw, recognizeImage, TesseractEngine, tesseractLanguage, type OcrEngine, type OcrLine, type OcrRawResult } from './ocr'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => { tmp.cleanup(); setIngestLanguage('es') })

const line = (text: string, x: number, y: number, w: number, h = 30, confidence = 0.95): OcrLine => ({ text, bbox: { x, y, width: w, height: h }, confidence })
const fixed = (raw: OcrRawResult, seen?: string[][]): OcrEngine => ({ name: 'falso', recognize: async (_img, langs) => { seen?.push(langs); return raw } })

describe('Idiomas del OCR', () => {
  it('códigos de Tesseract para cualquier código de idioma', () => {
    expect(tesseractLanguage('es')).toBe('spa')
    expect(tesseractLanguage('es_MX')).toBe('spa')
    expect(tesseractLanguage('pt-BR')).toBe('por')
    expect(tesseractLanguage('zh-Hans')).toBe('chi_sim')
    expect(tesseractLanguage('zh-TW')).toBe('chi_tra')
    expect(tesseractLanguage('ja')).toBe('jpn')
    expect(tesseractLanguage('spa')).toBe('spa')
    expect(tesseractLanguage('xx')).toBeNull()
    expect(tesseractLanguage('')).toBeNull()
  })

  it('el del curso primero, sin repetir y como mucho tres', () => {
    expect(defaultOcrLanguages({ course: 'ja', interface: 'es' })).toEqual(['jpn', 'spa', 'eng'])
    expect(defaultOcrLanguages({ course: 'es', interface: 'es' })).toEqual(['spa', 'eng'])
    expect(defaultOcrLanguages({ course: 'fr', preferred: ['de', 'it'], interface: 'es' })).toEqual(['fra', 'deu', 'ita'])
    expect(defaultOcrLanguages({ interface: 'en' })).toEqual(['eng'])
    setIngestLanguage('en')
    expect(ocrLanguagesFor(makeContext(resolveOptions({ language: 'ru' }), 'x'))).toEqual(['rus', 'eng'])
    expect(ocrLanguagesFor(makeContext(resolveOptions({ ocrLanguages: ['ara'] }), 'x'))).toEqual(['ara', 'eng'])
  })

  it('el motor de Tesseract se carga solo al usarlo', () => {
    const engine = new TesseractEngine()
    expect(engine.isWarm).toBe(false)
  })
})

describe('Texto por geometría', () => {
  it('orden de lectura en dos columnas, confianza media y título por tamaño', () => {
    const raw: OcrRawResult = { width: 1000, height: 1400, lines: [
      line('Tema 3. Funciones', 200, 60, 600, 60),
      ...Array.from({ length: 6 }, (_, i) => line(`Izquierda línea ${i + 1} con bastante texto aquí`, 60, 200 + i * 40, 400)),
      ...Array.from({ length: 6 }, (_, i) => line(`Derecha línea ${i + 1} con bastante texto aquí`, 540, 200 + i * 40, 400, 30, 0.5))
    ] }
    const r = pageFromRaw(raw)
    expect(r.text.indexOf('Izquierda línea 6')).toBeLessThan(r.text.indexOf('Derecha línea 1'))
    expect(r.firstHeading).toBe('Tema 3. Funciones')
    expect(r.averageConfidence).toBeGreaterThan(0.5)
    expect(r.averageConfidence).toBeLessThan(0.95)
    expect(r.normalizedLines.every((l) => l.bbox.x >= 0 && l.bbox.x <= 1 && l.bbox.y >= 0 && l.bbox.y <= 1)).toBe(true)
  })

  it('filas de tabla conservan sus celdas', () => {
    const r = pageFromRaw({ width: 1000, height: 800, lines: [line('ángulo', 60, 100, 140), line('sen x', 400, 100, 120), line('cos x', 750, 100, 120), line('30°', 60, 150, 60), line('0,5', 400, 150, 60), line('0,87', 750, 150, 80)] })
    expect(r.text).toBe('ángulo | sen x | cos x\n30° | 0,5 | 0,87')
  })

  it('nada reconocido; imágenes diminutas no llegan al motor', async () => {
    expect(pageFromRaw({ width: 10, height: 10, lines: [] }).text).toBe('')
    let calls = 0
    const engine: OcrEngine = { name: 'x', recognize: async () => { calls++; return { width: 1, height: 1, lines: [] } } }
    expect((await recognizeImage(png(4, 4), engine, ['spa'])).text).toBe('')
    expect(calls).toBe(0)
  })
})

describe('Imágenes con OCR', () => {
  it('una foto: texto, idiomas del curso, confianza y título si el nombre es genérico', async () => {
    const seen: string[][] = []
    const engine = fixed({ width: 800, height: 600, lines: [line('Mitosis y meiosis', 40, 40, 500, 60), line('La mitosis produce dos células hijas idénticas.', 40, 140, 700)] }, seen)
    const doc = await readDocument(tmp.write('IMG_2034.png', png(800, 600)), { ocr: engine, language: 'pt' })
    expect(doc.kind).toBe('image')
    expect(doc.pages[0].usedOCR).toBe(true)
    expect(doc.pages[0].text).toContain('La mitosis produce dos células hijas idénticas.')
    expect(doc.title).toBe('Mitosis y meiosis')
    expect(seen[0][0]).toBe('por')
    expect(doc.metadata.pixelWidth).toBe('800')
    expect(doc.metadata.ocrConfidence).toBe('0.95')
    expect(doc.warnings).toEqual([])
    const named = await readDocument(tmp.write('Biología celular.png', png(800, 600)), { ocr: engine })
    expect(named.title).toBe('Biología celular')
  })

  it('confianza justo en el umbral no avisa; un fallo del motor avisa', async () => {
    const borderline = await readDocument(tmp.write('a.png', png(300, 200)), { ocr: fixed({ width: 300, height: 200, lines: [line('Texto leído', 10, 10, 200, 30, 0.5)] }) })
    expect(borderline.pages[0].lowConfidence).toBeUndefined()
    expect(borderline.warnings).toEqual([])
    const broken: OcrEngine = { name: 'roto', recognize: async () => { throw new Error('el motor se cayó') } }
    const failed = await readDocument(tmp.write('b.png', png(300, 200)), { ocr: broken })
    expect(failed.pages[0].needsOCR).toBe(true)
    expect(failed.warnings.some((w) => w.includes('el motor se cayó'))).toBe(true)
    const blank = await readDocument(tmp.write('c.png', png(300, 200)), { ocr: fixed({ width: 300, height: 200, lines: [] }) })
    expect(blank.warnings.some((w) => w.includes('No se encontró texto'))).toBe(true)
  })

  it('HEIC sin conversor queda para verla como imagen; con conversor se lee', async () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), ...new Array(200).fill(0)])
    const engine = fixed({ width: 100, height: 100, lines: [line('Texto en HEIC convertido', 5, 5, 90, 10)] })
    const without = await readDocument(tmp.write('foto.heic', heic), { ocr: engine })
    expect(without.pages[0].needsOCR).toBe(true)
    const rasterizer: PageRasterizer = { renderPdfPage: async () => null, imageToPng: async () => png(100, 100) }
    const converted = await readDocument(tmp.write('foto2.heic', heic), { ocr: engine, rasterizer })
    expect(converted.pages[0].text).toContain('Texto en HEIC convertido')
  })

  it('una cancelación durante el OCR se propaga', async () => {
    const controller = new AbortController()
    const slow: OcrEngine = { name: 'lento', recognize: (_i, _l, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))) }
    const p = readDocument(tmp.write('lenta.png', png(300, 200)), { ocr: slow, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('PDF escaneado con OCR', () => {
  it('solo se hace OCR de las páginas escaneadas; el texto nativo corto se queda si el OCR no aporta más', async () => {
    const scan = { images: [{ x: 0, y: 0, w: 612, h: 792, pixelsW: 850, pixelsH: 1100 }] }
    const rendered: number[] = []
    const rasterizer: PageRasterizer = { renderPdfPage: async (_d, page) => { rendered.push(page); return png(85, 110) } }
    const engine = fixed({ width: 850, height: 1100, lines: [line('Texto escaneado de la página con suficiente contenido.', 50, 100, 700)] })
    const pdf = buildPDF({ pages: [
      { texts: [{ text: 'Página con capa de texto normal y suficiente contenido.', x: 72, y: 700 }] },
      scan,
      { texts: [{ text: 'Pie corto', x: 72, y: 700 }], images: [{ x: 100, y: 300, w: 300, h: 200, pixelsW: 600, pixelsH: 400 }] }
    ] })
    const doc = await readDocument(tmp.write('mixto.pdf', pdf), { rasterizer, ocr: engine })
    expect(rendered).toEqual([2, 3])
    expect(doc.pages[0].usedOCR).toBe(false)
    expect(doc.pages[1].usedOCR).toBe(true)
    expect(doc.pages[1].text).toContain('Texto escaneado')
    expect(doc.pages[2].usedOCR).toBe(true)                       // el OCR aporta más que «Pie corto»
    const weak = fixed({ width: 850, height: 1100, lines: [line('x', 50, 100, 20)] })
    const kept = await readDocument(tmp.write('corto.pdf', buildPDF({ pages: [{ texts: [{ text: 'Pie corto', x: 72, y: 700 }], images: [{ x: 100, y: 300, w: 300, h: 200, pixelsW: 600, pixelsH: 400 }] }] })), { rasterizer, ocr: weak })
    expect(kept.pages[0].text).toBe('Pie corto')
    expect(kept.pages[0].usedOCR).toBe(false)
  })
})

describe.skipIf(!process.env.AULA_TESSERACT)('Tesseract de verdad (AULA_TESSERACT=1; descarga los datos de idioma)', () => {
  it('reconoce una imagen', async () => {
    const engine = new TesseractEngine({ cachePath: tmp.path })
    const doc = await readDocument(tmp.write('blanco.png', png(200, 100)), { ocr: engine })
    expect(doc.pages).toHaveLength(1)
    await engine.dispose()
  }, 120_000)
})
