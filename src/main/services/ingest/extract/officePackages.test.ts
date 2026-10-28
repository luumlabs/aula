import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fullText } from '@shared/ingest'
import { ZipArchive } from '../core/zipArchive'
import { isIngestError, type IngestErrorKind } from '../errors'
import type { IngestOptions } from '../options'
import { readDocument } from '../pipeline'
import { ProgressLog, tempDir, type TempDir } from '../testing/files'
import { cell, CONTENT_TYPES, epub, p, pptx, row, sp, W_NS, xhtml, xlsx, xml, type Chapter, type Sheet, type Slide } from '../testing/office'
import { ZipForge } from '../testing/zipForge'
import { excelDate, formatNumber, isDateFormatCode } from './xlsx'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

async function rejectsKind(promise: Promise<unknown>, kind: IngestErrorKind, check?: (e: Error) => boolean): Promise<void> {
  const e = await promise.then(() => null, (x: unknown) => x)
  expect(isIngestError(e, kind), String(e)).toBe(true)
  if (check) expect(check(e as Error), (e as Error).message).toBe(true)
}

describe('PowerPoint', () => {
  const deck = (slides: Slide[], order?: number[], title?: string, options: Partial<IngestOptions> = {}, name = 'clase.pptx') => readDocument(tmp.write(name, pptx(slides, order, title)), options)

  it('título, viñetas y niveles', async () => {
    const shapes = sp(['Funciones trigonométricas'], 'title') + sp(['Seno y coseno', 'Definición en el círculo unidad', 'Periodo 2π'], 'body', true) + sp(['Detalle del periodo'], 'body', true, 1)
    const doc = await deck([{ shapes }], undefined, 'Curso de precálculo')
    expect(doc.kind).toBe('pptx')
    expect(doc.title).toBe('Curso de precálculo')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].heading).toBe('Funciones trigonométricas')
    expect(doc.pages[0].text).toBe('# Funciones trigonométricas\n\n- Seno y coseno\n- Definición en el círculo unidad\n- Periodo 2π\n  - Detalle del periodo')
    expect(doc.metadata.slideCount).toBe('1')
  })

  it('el orden lo da la presentación, no los archivos', async () => {
    const doc = await deck([1, 2, 3].map((n) => ({ shapes: sp([`Diapositiva ${n}`], 'title') })), [2, 0, 1])
    expect(doc.pages.map((x) => x.heading)).toEqual(['Diapositiva 3', 'Diapositiva 1', 'Diapositiva 2'])
    expect(doc.pages.map((x) => x.number)).toEqual([1, 2, 3])
    expect(doc.title).toBe('Diapositiva 3')
  })

  it('sin orden: por el nombre de los archivos, con aviso', async () => {
    const zip = new ZipArchive(pptx([1, 2, 3].map((n) => ({ shapes: sp([`S${n}`], 'title') }))))
    const forge = new ZipForge()
    for (const n of zip.fileNames) if (n !== 'ppt/presentation.xml') forge.add(n, zip.read(n) as Uint8Array)
    forge.add('ppt/presentation.xml', xml('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'))
    const doc = await readDocument(tmp.write('sinorden.pptx', forge.build()))
    expect(doc.pages.map((x) => x.heading)).toEqual(['S1', 'S2', 'S3'])
    expect(doc.warnings.some((w) => w.includes('orden de las diapositivas'))).toBe(true)
  })

  it('notas del orador', async () => {
    const file = tmp.write('notas.pptx', pptx([{ shapes: sp(['Con notas'], 'title'), notes: 'Recordar el ejemplo de la rueda de la fortuna.' }]))
    expect((await readDocument(file)).pages[0].text).toBe('# Con notas\n\nNotas del orador:\nRecordar el ejemplo de la rueda de la fortuna.')
    expect((await readDocument(file, { includeSpeakerNotes: false })).pages[0].text).toBe('# Con notas')
  })

  it('cuadros de texto, tablas, grupos e imágenes', async () => {
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Tabla"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>sen x</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>0</a:t></a:r></a:p></a:txBody></a:tc><a:tc gridSpan="1"><a:txBody><a:p><a:r><a:t>0</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Grupo"/></p:nvGrpSpPr><p:grpSpPr/>${sp(['Texto dentro de un grupo'])}</p:grpSp>`
    const pic = '<p:pic><p:nvPicPr><p:cNvPr id="7" name="Imagen" descr="Diagrama del círculo unidad con los ángulos notables"/></p:nvPicPr></p:pic>'
    const doc = await deck([{ shapes: sp(['Título'], 'title') + sp(['Cuadro de texto libre']) + table + group + pic }])
    expect(doc.pages[0].text).toBe('# Título\n\nCuadro de texto libre\n\nx | sen x\n0 | 0\n\nTexto dentro de un grupo\n\n[Figura: Diagrama del círculo unidad con los ángulos notables]')
    expect(doc.pages[0].hasFigures).toBe(true)
  })

  it('pies, números de diapositiva y campos se ignoran', async () => {
    const shapes = sp(['Contenido real'], 'body', true) + sp(['7'], 'sldNum') + sp(['Pie de página repetido'], 'ftr') + sp(['07/10/2026'], 'dt') +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Número: </a:t></a:r><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld><a:br/><a:r><a:t>segunda línea</a:t></a:r></a:p></p:txBody></p:sp>'
    expect((await deck([{ shapes }])).pages[0].text).toBe('- Contenido real\n\nNúmero:\nsegunda línea')
  })

  it('ecuaciones en las diapositivas', async () => {
    const math = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Eq"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><mc:AlternateContent><mc:Choice Requires="a14"><a14:m><m:oMathPara><m:oMath><m:sSup><m:e><m:r><m:t>a</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>=</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></a14:m></mc:Choice><mc:Fallback><a:r><a:t>a2+b2=c2</a:t></a:r></mc:Fallback></mc:AlternateContent></a:p></p:txBody></p:sp>'
    expect((await deck([{ shapes: sp(['Pitágoras'], 'title') + math }])).pages[0].text).toBe('# Pitágoras\n\na^2+b^2=c^2')
  })

  it('diapositivas vacías o solo con imagen conservan su número', async () => {
    const picture = '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Foto"/></p:nvPicPr></p:pic>'
    const doc = await deck([{ shapes: sp(['Primera'], 'title') }, { shapes: picture }, { shapes: sp(['Tercera'], 'title') }])
    expect(doc.pages).toHaveLength(3)
    expect(doc.pages[1].text).toBe('')
    expect(doc.pages[1].hasFigures).toBe(true)
    expect(doc.pages[2].number).toBe(3)
    expect(doc.pages[2].heading).toBe('Tercera')
    expect((await deck([{ shapes: picture }], undefined, undefined, {}, 'vacia.pptx')).warnings.some((w) => w.includes('no contiene texto'))).toBe(true)
  })

  it('máximo de páginas, títulos basura y paquetes que no son presentaciones', async () => {
    const doc = await deck([1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ shapes: sp([`Diapositiva ${n}`], 'title') })), undefined, undefined, { maxPages: 5 })
    expect(doc.pages).toHaveLength(5)
    expect(doc.warnings.some((w) => w.includes('8 diapositivas') && w.includes('primeras 5')), JSON.stringify(doc.warnings)).toBe(true)
    expect((await deck([{ shapes: sp(['Límites'], 'title') }], undefined, 'PowerPoint Presentation', {}, 'basura.pptx')).title).toBe('Límites')
    await rejectsKind(readDocument(tmp.write('raro.pptx', new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'algo.xml': '<x/>' }).build())), 'corrupt')
  })

  it('mensajes de progreso en español', async () => {
    const slides = Array.from({ length: 1500 }, (_, i) => ({ shapes: sp([`Diapositiva ${i + 1}`], 'title') + sp(['texto '.repeat(100)], 'body', true) }))
    const log = new ProgressLog()
    // el progreso sale como mucho cada 50 ms: con un reloj falso no depende de lo rápido que sea el ordenador
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 100))
    try {
      await deck(slides, undefined, undefined, { onProgress: log.callback }, 'grande.pptx')
    } finally {
      now.mockRestore()
    }
    expect(log.messages.some((m) => m.startsWith('Leyendo diapositiva'))).toBe(true)
    expect(log.fractions[log.fractions.length - 1]).toBe(1)
  })
})

describe('Excel', () => {
  const book = (sheets: Sheet[], strings: string[] = [], date1904 = false, name = 'datos.xlsx') => readDocument(tmp.write(name, xlsx(sheets, strings, undefined, date1904)))
  const letters = (n: number): string => { let s = ''; let k = n; while (k > 0) { k--; s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26) } return s }

  it('hojas como páginas con cadenas compartidas y números', async () => {
    const s1: Sheet = { name: 'Notas', rowsXML: row(1, cell('A1', '0', 's') + cell('B1', '1', 's') + cell('C1', '2', 's')) + row(2, cell('A2', '3', 's') + cell('B2', '8.5') + cell('C2', '10')) + row(3, cell('A3', '4', 's') + cell('B3', '0.30000000000000004') + cell('C3', '-2.50')) }
    const doc = await book([s1, { name: 'Resumen', rowsXML: row(1, cell('A1', '5', 's')) }], ['Alumno', 'Examen 1', 'Examen 2', 'Ana', 'Luis', 'Total'])
    expect(doc.kind).toBe('xlsx')
    expect(doc.pages.map((x) => x.heading)).toEqual(['Notas', 'Resumen'])
    expect(doc.pages[0].text).toBe('# Notas\n\nAlumno | Examen 1 | Examen 2\nAna | 8.5 | 10\nLuis | 0.3 | -2.5')
    expect(doc.pages[1].text).toBe('# Resumen\n\nTotal')
    expect(doc.metadata.sheetNames).toBe('Notas | Resumen')
    expect(doc.warnings).toEqual([])
  })

  it('tipos de celda', async () => {
    const cells = cell('A1', '1', 'b') + cell('B1', '0', 'b') + cell('C1', '#DIV/0!', 'e') + cell('D1', 'texto de fórmula', 'str', undefined, 'A2&B2') +
      '<c r="E1" t="inlineStr"><is><t>en línea</t></is></c>' + cell('F1', '', undefined, undefined, 'SUM(A1:A5)') + cell('G1', '1000000') + cell('H1', '1.5E-7')
    expect((await book([{ name: 'Tipos', rowsXML: row(1, cells) }])).pages[0].text).toBe('# Tipos\n\nTRUE | FALSE | #DIV/0! | texto de fórmula | en línea | =SUM(A1:A5) | 1000000 | 1.5e-07')
  })

  it('celdas sueltas conservan su columna', async () => {
    const rows = row(1, cell('A1', '1') + cell('D1', '4')) + row(2, cell('C2', '3')) + row(5, '') + row(7, cell('B7', '2'))
    expect((await book([{ name: 'Huecos', rowsXML: rows }])).pages[0].text).toBe('# Huecos\n\n1 |  |  | 4\n |  | 3\n | 2')
  })

  it('fechas según el formato de la celda (y el sistema 1904)', async () => {
    const cells = cell('A1', '45000', undefined, 1) + cell('B1', '45000.5', undefined, 2) + cell('C1', '45000', undefined, 0) + cell('D1', '0.75', undefined, 1) + cell('E1', '36526', undefined, 1)
    expect((await book([{ name: 'Fechas', rowsXML: row(1, cells) }])).pages[0].text).toBe('# Fechas\n\n2023-03-15 | 2023-03-15 12:00 | 45000 | 18:00 | 2000-01-01')
    expect((await book([{ name: 'Mac', rowsXML: row(1, cell('A1', '1000', undefined, 1)) }], [], true, 'mac.xlsx')).pages[0].text).toBe('# Mac\n\n1906-09-27')
  })

  it('las hojas ocultas se saltan con aviso', async () => {
    const doc = await book([{ name: 'Visible', rowsXML: row(1, cell('A1', '1')) }, { name: 'Oculta', rowsXML: row(1, cell('A1', '2')), hidden: true }])
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].heading).toBe('Visible')
    expect(doc.warnings.some((w) => w.includes('hoja oculta «Oculta»'))).toBe(true)
  })

  it('límites de filas y columnas', async () => {
    let rows = ''
    for (let r = 1; r <= 250; r++) {
      let cells = ''
      for (let c = 1; c <= 35; c++) cells += cell(`${letters(c)}${r}`, String(r * 100 + c))
      rows += row(r, cells)
    }
    const doc = await book([{ name: 'Grande', rowsXML: rows }])
    const lines = doc.pages[0].text.split('\n').slice(1).filter(Boolean)
    expect(lines).toHaveLength(200)
    expect(lines[0].split('|')).toHaveLength(30)
    expect(lines[0].startsWith('101 | 102')).toBe(true)
    expect(lines[lines.length - 1].startsWith('20001 | 20002')).toBe(true)
    expect(doc.warnings.some((w) => w.includes('más de 200 filas'))).toBe(true)
    expect(doc.warnings.some((w) => w.includes('más de 30 columnas'))).toBe(true)
  })

  it('una hoja rala lee sus filas con datos', async () => {
    const doc = await book([{ name: 'Rala', rowsXML: row(1, cell('A1', '1')) + row(900, cell('A900', '2')) + row(5000, cell('A5000', '3')) }])
    expect(doc.pages[0].text).toBe('# Rala\n\n1\n2\n3')
    expect(doc.warnings.some((w) => w.includes('más de 200 filas'))).toBe(false)
  })

  it('una hoja enorme solo se lee al principio', async () => {
    const rows = Array.from({ length: 120_000 }, (_, i) => row(i + 1, cell(`A${i + 1}`, String(i + 1)) + `<c r="B${i + 1}" t="inlineStr"><is><t>dato ${i + 1}</t></is></c>`)).join('')
    const t0 = performance.now()
    const doc = await book([{ name: 'Enorme', rowsXML: rows }])
    expect(performance.now() - t0).toBeLessThan(8000)
    const lines = doc.pages[0].text.split('\n').slice(1).filter(Boolean)
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe('1 | dato 1')
  })

  it('libro vacío y libro sin workbook', async () => {
    const doc = await book([{ name: 'Vacía', rowsXML: '' }])
    expect(doc.warnings.some((w) => w.includes('no contiene datos'))).toBe(true)
    expect(doc.pages[0].text).toBe('')
    expect(doc.pages[0].heading).toBe('Vacía')
    await rejectsKind(readDocument(tmp.write('malo.xlsx', new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'x/y.xml': '<a/>' }).build())), 'corrupt')
  })

  it('formatos de fecha y de número', () => {
    for (const code of ['yyyy-mm-dd', 'dd/mm/yyyy', 'd-mmm-yy', 'h:mm AM/PM', 'hh:mm:ss', '[$-409]mmmm d, yyyy', 'yyyy\\-mm\\-dd\\ hh:mm', 'dd"/"mm']) expect(isDateFormatCode(code), code).toBe(true)
    for (const code of ['General', '0.00', '#,##0', '0.00E+00', '0%', '"día" 0', '[Red]0.00', '@']) expect(isDateFormatCode(code), code).toBe(false)
    expect(formatNumber('8.5')).toBe('8.5')
    expect(formatNumber('10')).toBe('10')
    expect(formatNumber('10.0')).toBe('10')
    expect(formatNumber('0.1')).toBe('0.1')
    expect(formatNumber('0.30000000000000004')).toBe('0.3')
    expect(formatNumber('-2.50')).toBe('-2.5')
    expect(formatNumber('1e3')).toBe('1000')
    expect(formatNumber('no es número')).toBe('no es número')
    expect(excelDate(45000, false)).toBe('2023-03-15')
    expect(excelDate(0.5, false)).toBe('12:00')
    expect(excelDate(-5, false)).toBeNull()
    expect(excelDate(NaN, false)).toBeNull()
  })
})

describe('EPUB', () => {
  const chapters = (): Chapter[] => [
    { file: 'c1.xhtml', html: xhtml('<h1>Capítulo 1: Ángulos</h1><p>Un ángulo mide la abertura entre dos semirrectas con un vértice común.</p><ul><li>Agudo</li><li>Recto</li></ul>') },
    { file: 'text/c2.xhtml', html: xhtml('<h1>Capítulo 2: Círculo</h1><p>El círculo unidad tiene radio 1 &amp; centro en el origen. Aquí: x<sup>2</sup> + y<sup>2</sup> = 1.</p>') },
    { file: 'c3.xhtml', html: xhtml('<h2>Sin título en el índice</h2><p>Contenido del tercer capítulo.</p><table><tr><td>a</td><td>b</td></tr></table>') }
  ]
  const id = (c: Chapter): string => c.file.replace(/\./g, '_').replace(/\//g, '_')

  it('capítulos en el orden de lectura con los nombres del índice', async () => {
    const doc = await readDocument(tmp.write('libro.epub', epub({ chapters: chapters(), nav: [['c1.xhtml', 'Ángulos'], ['text/c2.xhtml', 'El círculo'], ['text/c2.xhtml#sec', 'Subsección del círculo']] })))
    expect(doc.kind).toBe('epub')
    expect(doc.title).toBe('Mi libro')
    expect(doc.metadata.author).toBe('Ana Pérez')
    expect(doc.metadata.language).toBe('es')
    expect(doc.pages.map((x) => x.number)).toEqual([1, 2, 3])
    expect(doc.pages.map((x) => x.heading)).toEqual(['Ángulos', 'El círculo', 'Sin título en el índice'])
    expect(doc.pages[0].text).toBe('# Capítulo 1: Ángulos\n\nUn ángulo mide la abertura entre dos semirrectas con un vértice común.\n\n- Agudo\n- Recto')
    expect(doc.pages[1].text).toContain('radio 1 & centro')
    expect(doc.pages[1].text).toContain('x^2 + y^2 = 1')
    expect(doc.pages[2].text).toContain('a | b')
    expect(doc.metadata.toc).toBe('Ángulos\nEl círculo\nSubsección del círculo')
  })

  it('el spine manda; índice NCX de EPUB 2; el índice no es un capítulo', async () => {
    const ch = chapters()
    const ordered = await readDocument(tmp.write('orden.epub', epub({ chapters: ch, spineOrder: [id(ch[2]), id(ch[0])] })))
    expect(ordered.pages).toHaveLength(2)
    expect(ordered.pages[0].text).toContain('tercer capítulo')
    expect(ordered.pages[1].text).toContain('Capítulo 1')
    const ncx = await readDocument(tmp.write('viejo.epub', epub({ chapters: chapters(), ncx: [['c1.xhtml', 'Uno'], ['text/c2.xhtml', 'Dos'], ['c3.xhtml', 'Tres']] })))
    expect(ncx.pages.map((x) => x.heading)).toEqual(['Uno', 'Dos', 'Tres'])
    expect(ncx.metadata.toc).toBe('Uno\nDos\nTres')
    const nav = await readDocument(tmp.write('nav.epub', epub({ chapters: chapters(), nav: [['c1.xhtml', 'Ángulos']] })))
    expect(nav.pages).toHaveLength(3)
    expect(fullText(nav)).not.toContain('Índice')
  })

  it('capítulos solo con imagen, no lineales y que faltan', async () => {
    const withCover = [{ file: 'cover.xhtml', html: xhtml('<div><img src="images/cover.png" alt="Portada"/></div>') }, ...chapters()]
    const cover = await readDocument(tmp.write('portada.epub', epub({ chapters: withCover })))
    expect(cover.pages).toHaveLength(3)
    expect(cover.pages[0].text).toContain('Capítulo 1')
    const nonLinear = chapters()
    nonLinear[2].linear = false
    expect((await readDocument(tmp.write('nolineal.epub', epub({ chapters: nonLinear })))).pages).toHaveLength(3)
    const zip = new ZipArchive(epub({ chapters: chapters() }))
    const forge = new ZipForge()
    for (const n of zip.fileNames) if (n !== 'OEBPS/c3.xhtml') forge.add(n, zip.read(n) as Uint8Array, n === 'mimetype' ? 'stored' : 'deflate')
    const missing = await readDocument(tmp.write('falta.epub', forge.build()))
    expect(missing.pages).toHaveLength(2)
    expect(missing.warnings.some((w) => w.includes('c3.xhtml'))).toBe(true)
  })

  it('DRM (y la ofuscación de fuentes, que no lo es)', async () => {
    const drm = xml('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>')
    await rejectsKind(readDocument(tmp.write('drm.epub', epub({ chapters: chapters(), encryption: drm }))), 'unsupportedType', (e) => e.message.includes('DRM'))
    const fonts = xml('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>')
    expect((await readDocument(tmp.write('fuentes.epub', epub({ chapters: chapters(), encryption: fonts })))).pages).toHaveLength(3)
  })

  it('paquetes rotos, entidades y etiquetas XHTML cerradas', async () => {
    await rejectsKind(readDocument(tmp.write('vacio.epub', new ZipForge({ mimetype: 'application/epub+zip' }).build())), 'corrupt')
    await rejectsKind(readDocument(tmp.write('falso.epub', 'no es un zip')), 'corrupt')
    const html = xhtml('<p>Caf&#233; &mdash; <em>niño</em><br/>segunda línea<span/>.</p><p/><p>Fin &lt;3</p>')
    expect((await readDocument(tmp.write('entidades.epub', epub({ chapters: [{ file: 'c.xhtml', html }] })))).pages[0].text).toBe('Café — niño\nsegunda línea.\n\nFin <3')
  })

  it('un libro grande es rápido', async () => {
    const body = Array.from({ length: 400 }, (_, i) => `<p>Párrafo ${i} de un capítulo largo con bastante texto de relleno para el libro de prueba.</p>`).join('')
    const chs = Array.from({ length: 80 }, (_, i) => ({ file: `cap${i + 1}.xhtml`, html: xhtml(`<h1>Capítulo ${i + 1}</h1>` + body) }))
    const t0 = performance.now()
    const doc = await readDocument(tmp.write('grande.epub', epub({ chapters: chs })))
    expect(doc.pages).toHaveLength(80)
    expect(performance.now() - t0).toBeLessThan(15_000)
  })
})

describe('Paquetes incompletos o hechos a mano', () => {
  const SL = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

  it('PPTX solo con las diapositivas', async () => {
    const forge = new ZipForge()
    for (const n of [1, 2, 10]) forge.add(`ppt/slides/slide${n}.xml`, xml(`<p:sld ${SL}><p:cSld><p:spTree>${sp([`Título ${n}`], 'title')}${sp([`Texto de la diapositiva ${n}`], 'body', true)}</p:spTree></p:cSld></p:sld>`))
    const doc = await readDocument(tmp.write('minima.pptx', forge.build()))
    expect(doc.pages.map((x) => x.heading)).toEqual(['Título 1', 'Título 2', 'Título 10'])
    expect(doc.pages[0].text).toBe('# Título 1\n\n- Texto de la diapositiva 1')
  })

  it('XLSX solo con las hojas', async () => {
    const forge = new ZipForge()
    forge.add('xl/worksheets/sheet1.xml', xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hola</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>'))
    forge.add('xl/worksheets/sheet2.xml', xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'))
    const doc = await readDocument(tmp.write('minima.xlsx', forge.build()))
    expect(doc.pages.map((x) => x.text)).toEqual(['# Hoja1\n\nHola | 42', '# Hoja2\n\n7'])
    expect(doc.warnings.some((w) => w.includes('lista de hojas'))).toBe(true)
  })

  it('EPUB sin contenedor o sin OPF', async () => {
    const a = new ZipForge()
    a.add('libro/contenido.opf', xml('<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sin contenedor</dc:title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'))
    a.add('libro/a.xhtml', xhtml('<p>Capítulo A con contenido de prueba.</p>'))
    a.add('libro/b.xhtml', xhtml('<p>Capítulo B con contenido de prueba.</p>'))
    const doc = await readDocument(tmp.write('sincontenedor.epub', a.build()))
    expect(doc.title).toBe('Sin contenedor')
    expect(doc.pages.map((x) => x.text)).toEqual(['Capítulo B con contenido de prueba.', 'Capítulo A con contenido de prueba.'])
    const b = new ZipForge()
    b.add('mimetype', 'application/epub+zip', 'stored')
    b.add('OEBPS/cap2.xhtml', xhtml('<p>Segundo capítulo del libro de prueba.</p>'))
    b.add('OEBPS/cap1.xhtml', xhtml('<p>Primer capítulo del libro de prueba.</p>'))
    const noOPF = await readDocument(tmp.write('sinopf.epub', b.build()))
    expect(noOPF.pages.map((x) => x.text)).toEqual(['Primer capítulo del libro de prueba.', 'Segundo capítulo del libro de prueba.'])
    expect(noOPF.warnings.some((w) => w.includes('sin índice') || w.includes('no tiene índice')), JSON.stringify(noOPF.warnings)).toBe(true)
  })

  it('DOCX sin relaciones y con prefijos raros', async () => {
    const min = await readDocument(tmp.write('minimo.docx', new ZipForge({ 'word/document.xml': xml(`<w:document ${W_NS}><w:body>${p('Word mínimo sin relaciones.')}</w:body></w:document>`) }).build()))
    expect(min.pages[0].text).toBe('Word mínimo sin relaciones.')
    expect(min.kind).toBe('docx')
    const plain = '<?xml version="1.0"?><document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><body><p><r><t>Sin prefijos.</t></r></p></body></document>'
    const odd = '<?xml version="1.0"?><ns1:document xmlns:ns1="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><ns1:body><ns1:p><ns1:r><ns1:t>Prefijo raro.</ns1:t></ns1:r></ns1:p></ns1:body></ns1:document>'
    expect((await readDocument(tmp.write('a.docx', new ZipForge({ 'word/document.xml': plain }).build()))).pages[0].text).toBe('Sin prefijos.')
    expect((await readDocument(tmp.write('b.docx', new ZipForge({ 'word/document.xml': odd }).build()))).pages[0].text).toBe('Prefijo raro.')
  })
})
