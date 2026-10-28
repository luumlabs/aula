import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageRasterizer } from '@shared/ingest'
import { fullText } from '@shared/ingest'
import { isIngestError } from '../errors'
import type { IngestOptions } from '../options'
import { readDocument } from '../pipeline'
import { ProgressLog, png, tempDir, type TempDir } from '../testing/files'
import { buildPDF, LOREM, paragraph, type PdfPageSpec, type PdfSpec, type PdfText } from '../testing/pdf'
import type { OcrEngine, OcrRawResult } from './ocr'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const write = (spec: PdfSpec, name = 'doc.pdf'): string => tmp.write(name, buildPDF(spec))
const read = (spec: PdfSpec, options: Partial<IngestOptions> = {}, name = 'doc.pdf') => readDocument(write(spec, name), { ocr: false, ...options })
const line = (text: string, x: number, y: number, size = 12): PdfText => ({ text, x, y, size })
const pages = (n: number, draw: (i: number) => PdfPageSpec): PdfPageSpec[] => Array.from({ length: n }, (_, i) => draw(i))

describe('PDF: básicos', () => {
  it('lee un PDF sencillo con sus metadatos', async () => {
    const doc = await read({ info: { Title: 'Mi examen', Author: 'Ana' }, pages: [{ texts: [line('Hola mundo, esto es una prueba de texto.', 72, 700)] }] })
    expect(doc.kind).toBe('pdf')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toBe('Hola mundo, esto es una prueba de texto.')
    expect(doc.pages[0].number).toBe(1)
    expect(doc.pages[0].usedOCR).toBe(false)
    expect(doc.pages[0].hasFigures).toBe(false)
    expect(doc.title).toBe('Mi examen')
    expect(doc.metadata.author).toBe('Ana')
    expect(doc.metadata.pageCount).toBe('1')
    expect(doc.metadata.sourceFile).toBe('doc.pdf')
    expect(doc.warnings).toEqual([])
    expect(fullText(doc)).toBe(doc.pages[0].text)
  })

  it('conserva los números de página', async () => {
    const topics = ['senos y cosenos', 'identidades notables', 'ecuaciones', 'triángulos oblicuos']
    const doc = await read({ pages: pages(4, (i) => ({ texts: [
      line(`En esta página número ${i + 1} se estudian ${topics[i]} del curso.`, 72, 700),
      line(`Segunda línea de la página ${i + 1} con más contenido sobre ${topics[(i + 1) % 4]}.`, 72, 680)
    ] })) })
    expect(doc.pages.map((p) => p.number)).toEqual([1, 2, 3, 4])
    doc.pages.forEach((p, i) => {
      expect(p.text).toContain(`página número ${i + 1} se estudian ${topics[i]}`)
      expect(p.text).toContain(`la página ${i + 1} con`)
    })
    expect(fullText(doc).split('\n\n')).toHaveLength(4)
  })

  it('descarta los títulos basura y usa el nombre del archivo', async () => {
    const body = { texts: [line('contenido de prueba para el examen', 72, 700)] }
    expect((await read({ info: { Title: 'Microsoft Word - Examen final.docx' }, pages: [body] }, {}, 'Mi_Examen_Final.pdf')).title).toBe('Examen final')
    expect((await read({ pages: [body] }, {}, 'Mi_Examen_Final.pdf')).title).toBe('Mi Examen Final')
  })

  it('usa el primer título cuando no hay metadatos', async () => {
    const doc = await read({ pages: [{ texts: [line('Guía de funciones trigonométricas', 72, 720, 22), ...paragraph(LOREM, 72, 680, 400, 11)] }] }, {}, 'scan0001.pdf')
    expect(doc.title).toBe('Guía de funciones trigonométricas')
    expect(doc.pages[0].heading).toBe('Guía de funciones trigonométricas')
    expect(doc.pages[0].text.startsWith('# Guía de funciones trigonométricas')).toBe(true)
  })
})

describe('PDF: limpieza', () => {
  it('une las líneas de un párrafo partido por el ancho', async () => {
    const doc = await read({ pages: [{ texts: paragraph(LOREM, 72, 700, 380, 11) }] })
    expect(doc.pages[0].text).toBe(LOREM)
  })

  it('separa los párrafos', async () => {
    const a = 'Primer párrafo del documento con bastante texto para que ocupe varias líneas dentro de la columna de la página.'
    const b = 'Segundo párrafo, que empieza más abajo tras un espacio vertical claro y también ocupa varias líneas del documento.'
    const text = (await read({ pages: [{ texts: [...paragraph(a, 72, 700, 360), ...paragraph(b, 72, 600, 360)] }] })).pages[0].text
    const parts = text.split('\n\n')
    expect(parts).toHaveLength(2)
    expect(parts[0].startsWith('Primer párrafo') && parts[0].endsWith('de la página.')).toBe(true)
    expect(parts[1].startsWith('Segundo párrafo') && parts[1].endsWith('del documento.')).toBe(true)
  })

  it('quita el guion de partición al final de línea', async () => {
    const text = (await read({ pages: [{ texts: [
      line('El teorema de Pitágoras es un resultado fundamental de la matemá-', 72, 700),
      line('tica elemental y se estudia en todos los colegios del mundo.', 72, 686)
    ] }] })).pages[0].text
    expect(text).toContain('la matemática elemental y se estudia')
  })

  it('deja una fórmula por línea', async () => {
    const formulas = ['sen2 + cos2 = 1', '1 + tan2 = sec2', 'sen(a + b) = sen a cos b + cos a sen b', 'tan(2x) = 2 tan x / (1 - tan2 x)']
    const doc = await read({ pages: [{ texts: formulas.map((f, i) => line(f, 72, 700 - i * 18, 13)) }] })
    expect(doc.pages[0].text).toBe(formulas.join('\n'))
  })

  it('quita cabeceras, pies y números de página repetidos', async () => {
    const topics = ['los senos', 'los cosenos', 'las tangentes', 'los radianes', 'las identidades', 'las ecuaciones']
    const doc = await read({ pages: pages(6, (i) => ({ texts: [
      line('Curso de Trigonometría — MATH112', 72, 750, 9),
      ...paragraph(`Contenido de la página ${i + 1}: aquí se explican ${topics[i]} con ejemplos resueltos paso a paso. ` + LOREM, 72, 700, 400, 11),
      line(`Página ${i + 1} de 6`, 280, 40, 9)
    ] })) })
    doc.pages.forEach((p, i) => {
      expect(p.text).not.toContain('Curso de Trigonometría')
      expect(p.text).not.toContain('de 6')
      expect(p.text.startsWith(`Contenido de la página ${i + 1}:`)).toBe(true)
    })
  })

  it('normaliza las viñetas', async () => {
    const text = (await read({ pages: [{ texts: [
      line('Temas del examen final:', 72, 700), line('• Funciones trigonométricas', 90, 680), line('• Identidades y ecuaciones', 90, 664), line('• Triángulos oblicuos', 90, 648)
    ] }] })).pages[0].text
    expect(text).toContain('- Funciones trigonométricas\n- Identidades y ecuaciones\n- Triángulos oblicuos')
  })
})

describe('PDF: columnas, títulos y figuras', () => {
  it('lee dos columnas en orden aunque el PDF las alterne', async () => {
    const left = ['Columna izquierda, primera línea del texto,', 'continúa con la segunda línea del texto,', 'y termina con la tercera línea final.', 'La cuarta línea de la izquierda cierra.']
    const right = ['Columna derecha, primera línea de texto,', 'sigue con la segunda línea de la derecha,', 'y acaba con la tercera línea de la derecha.', 'La cuarta línea de la derecha cierra.']
    const texts: PdfText[] = []
    for (let i = 0; i < 4; i++) texts.push(line(left[i], 72, 700 - i * 16), line(right[i], 330, 700 - i * 16))
    const text = (await read({ pages: [{ texts }] })).pages[0].text
    const r = text.indexOf('Columna derecha')
    expect(text.indexOf('Columna izquierda')).toBeLessThan(r)
    expect(text.indexOf('cuarta línea de la izquierda')).toBeLessThan(r)
  })

  it('maqueta de dos columnas con título', async () => {
    const col = [LOREM, LOREM, LOREM].join(' ')
    const text = (await read({ pages: [{ texts: [
      line('Resumen de trigonometría para el examen', 150, 740, 20), ...paragraph('IZQ ' + col, 54, 700, 240, 10), ...paragraph('DER ' + col, 318, 700, 240, 10)
    ] }] })).pages[0].text
    const t = text.indexOf('Resumen de trigonometría'), l = text.indexOf('IZQ'), r = text.indexOf('DER')
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThan(l)
    expect(l).toBeLessThan(r)
    expect(text.slice(l, r).trimEnd()).not.toContain('\n')
  })

  it('marca los títulos por tamaño', async () => {
    const doc = await read({ pages: pages(2, (i) => ({ texts: [
      line(`Capítulo ${i + 1}: Funciones`, 72, 730, 24), ...paragraph(LOREM, 72, 700, 400, 11),
      line('Ejemplos resueltos', 72, 560, 16), ...paragraph(LOREM, 72, 530, 400, 11)
    ] })) })
    doc.pages.forEach((p, i) => {
      expect(p.heading).toBe(`Capítulo ${i + 1}: Funciones`)
      expect(p.text.startsWith(`# Capítulo ${i + 1}: Funciones\n\n`)).toBe(true)
      expect(p.text.includes('\n## Ejemplos resueltos\n') || p.text.includes('\n### Ejemplos resueltos\n')).toBe(true)
    })
  })

  it('detecta las figuras (no los iconos)', async () => {
    const doc = await read({ pages: pages(3, (i) => ({
      texts: [line(`Página ${i + 1} con texto normal que sirve de contenido de prueba.`, 72, 700)],
      images: i === 1 ? [{ x: 100, y: 300, w: 300, h: 200, pixelsW: 600, pixelsH: 400 }] : i === 2 ? [{ x: 100, y: 300, w: 20, h: 20, pixelsW: 20, pixelsH: 20 }] : []
    })) })
    expect(doc.pages.map((p) => p.hasFigures)).toEqual([false, true, false])
  })

  it('páginas giradas y apaisadas', async () => {
    const doc = await read({ pages: [
      { texts: [line('Texto en la página 1 que se girará noventa grados.', 72, 700)], rotate: 90 },
      { texts: [line('Texto en la página 2 que se girará noventa grados.', 72, 700)] }
    ] })
    expect(doc.pages[0].text).toBe('Texto en la página 1 que se girará noventa grados.')
    expect(doc.pages[1].text).toBe('Texto en la página 2 que se girará noventa grados.')
    const wide = await read({ pages: [{ width: 792, height: 612, texts: [
      line('Diapositiva apaisada con título grande', 60, 540, 30), line('Primer punto de la diapositiva con texto de ejemplo', 60, 480, 18), line('Segundo punto de la diapositiva con más texto', 60, 450, 18)
    ] }] })
    expect(wide.pages[0].text.startsWith('#')).toBe(true)
    expect(wide.pages[0].text).toContain(' Diapositiva apaisada con título grande\n')
    expect(wide.pages[0].heading).toBe('Diapositiva apaisada con título grande')
  })
})

describe('PDF: límites y errores', () => {
  it('respeta el máximo de páginas', async () => {
    const doc = await read({ pages: pages(10, (i) => ({ texts: [line(`Texto de la página ${i + 1} del documento largo.`, 72, 700)] })) }, { maxPages: 3 })
    expect(doc.pages).toHaveLength(3)
    expect(doc.warnings.some((w) => w.includes('10 páginas') && w.includes('primeras 3'))).toBe(true)
    expect(doc.metadata.pageCount).toBe('10')
  })

  it('PDF con contraseña', async () => {
    const file = write({ encrypted: true, pages: [{ texts: [line('contenido reservado de este documento', 72, 700)] }] }, 'protegido.pdf')
    const e = await readDocument(file).catch((x: unknown) => x)
    expect(isIngestError(e, 'passwordProtected')).toBe(true)
    expect((e as Error).message).toContain('contraseña')
    expect((e as Error).message).toContain('protegido.pdf')
  })

  it('PDF dañado', async () => {
    for (const [name, data] of [['roto.pdf', '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nesto está roto y no tiene páginas'], ['falso.pdf', 'esto ni siquiera empieza como un pdf']]) {
      const e = await readDocument(tmp.write(name, data)).catch((x: unknown) => x)
      expect(isIngestError(e), String(e)).toBe(true)
    }
  })

  it('un PDF cortado nunca rompe la lectura', async () => {
    const data = buildPDF({ pages: pages(3, (i) => ({ texts: [line(`Texto de la página ${i + 1} de un PDF que se va a cortar.`, 72, 700)] })) })
    for (const cut of [data.length - 1, Math.floor((data.length * 3) / 4), Math.floor(data.length / 2), Math.floor(data.length / 4), 100]) {
      const file = tmp.write('cortado.pdf', data.subarray(0, cut))
      try { await readDocument(file, { ocr: false }) } catch (e) { expect(isIngestError(e), String(e)).toBe(true) }
    }
  })

  it('las páginas en blanco no se toman por escaneadas', async () => {
    const doc = await read({ pages: [{}, {}, {}] })
    expect(doc.pages).toHaveLength(3)
    expect(doc.pages.every((p) => p.text === '' && !p.usedOCR)).toBe(true)
    expect(doc.pages.every((p) => p.needsOCR === undefined)).toBe(true)
    expect(doc.warnings).toContain('El PDF no contiene texto.')
  })

  it('con OCR, las páginas en blanco se miran y no dan texto', async () => {
    const rasterizer: PageRasterizer = { renderPdfPage: async () => png(50, 60) }
    const engine: OcrEngine = { name: 'falso', recognize: async () => ({ width: 50, height: 60, lines: [] }) }
    const doc = await read({ pages: [{}, {}] }, { rasterizer, ocr: engine })
    expect(doc.pages.every((p) => p.text === '' && !p.usedOCR)).toBe(true)
    expect(doc.warnings.some((w) => w.includes('No se pudo reconocer texto'))).toBe(true)
  })
})

describe('PDF: escaneos y OCR', () => {
  const scan: PdfPageSpec = { images: [{ x: 0, y: 0, w: 612, h: 792, pixelsW: 850, pixelsH: 1100 }] }

  it('sin quien dibuje las páginas, las escaneadas quedan con needsOCR', async () => {
    const doc = await read({ pages: [{ texts: [line('Página normal con bastante texto para no necesitar OCR.', 72, 700)] }, scan] })
    expect(doc.pages[0].needsOCR).toBeUndefined()
    expect(doc.pages[1].needsOCR).toBe(true)
    expect(doc.pages[1].hasFigures).toBe(false)              // la imagen ES la página
    expect(doc.warnings.some((w) => w.includes('escaneada'))).toBe(true)
  })

  it('con un rasterizador y un motor de OCR, lee las páginas escaneadas', async () => {
    const rendered: Array<[number, number]> = []
    const rasterizer: PageRasterizer = { renderPdfPage: async (_pdf, page, side) => { rendered.push([page, side]); return png(100, 130) } }
    const engine: OcrEngine = {
      name: 'falso',
      recognize: async (): Promise<OcrRawResult> => ({ width: 1000, height: 1300, lines: [
        { text: 'Tema 4. Derivadas', bbox: { x: 100, y: 100, width: 600, height: 60 }, confidence: 0.9 },
        { text: 'La derivada mide la rapidez con la que cambia una función en cada punto.', bbox: { x: 100, y: 200, width: 800, height: 30 }, confidence: 0.4 }
      ] })
    }
    const doc = await read({ pages: [{ texts: [line('Página normal con bastante texto para no necesitar OCR.', 72, 700)] }, scan] }, { rasterizer, ocr: engine })
    expect(rendered).toEqual([[2, 2200]])
    expect(doc.pages[1].usedOCR).toBe(true)
    expect(doc.pages[1].text).toContain('La derivada mide la rapidez')
    expect(doc.pages[1].heading).toBe('Tema 4. Derivadas')
    expect(doc.pages[1].needsOCR).toBeUndefined()
    expect(doc.pages[1].lowConfidence).toBe(true)
    expect(doc.metadata.ocrPages).toBe('1')
    expect(doc.warnings.some((w) => w.includes('poca confianza'))).toBe(true)
  })

  it('si el OCR falla, la página queda marcada y hay un aviso', async () => {
    const rasterizer: PageRasterizer = { renderPdfPage: async () => null }
    const engine: OcrEngine = { name: 'falso', recognize: async () => ({ width: 1, height: 1, lines: [] }) }
    const doc = await read({ pages: [scan] }, { rasterizer, ocr: engine })
    expect(doc.pages[0].needsOCR).toBe(true)
    expect(doc.warnings.some((w) => w.includes('OCR') && w.includes('no se pudo dibujar'))).toBe(true)
  })
})

describe('PDF: progreso y cancelación', () => {
  it('el progreso es monótono y acaba en 1', async () => {
    const log = new ProgressLog()
    // el progreso se limita a un aviso cada 50 ms: con un reloj que avanza 100 ms por consulta la prueba no depende de lo
    // rápido que sea el ordenador (en uno rápido, las 60 páginas se leían sin dar tiempo a ningún aviso intermedio)
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
    try {
      await read({ pages: pages(60, (i) => ({ texts: paragraph(`Página ${i + 1}. ` + LOREM + ' ' + LOREM, 54, 738, 504, 10) })) }, { onProgress: log.callback })
    } finally {
      now.mockRestore()
    }
    const f = log.fractions
    expect(f.length).toBeGreaterThan(3)
    expect(f[0]).toBe(0)
    expect(f[f.length - 1]).toBe(1)
    expect(f).toEqual([...f].sort((a, b) => a - b))
    expect(log.messages.some((m) => m.startsWith('Leyendo página') && m.endsWith('de 60…'))).toBe(true)
  })

  it('se puede cancelar a mitad', async () => {
    const controller = new AbortController()
    const file = write({ pages: pages(150, (i) => ({ texts: Array.from({ length: 30 }, (_, l) => line(`Línea ${l} de la página ${i + 1} con algo de texto para que pese un poco.`, 72, 740 - l * 20, 10)) })) })
    let seen = 0
    const p = readDocument(file, { ocr: false, signal: controller.signal, onProgress: () => { if (++seen === 3) controller.abort() } })
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
