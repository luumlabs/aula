// Paquetes de Office y EPUB hostiles o mal formados (port de HostileOfficeTests.swift), más un fuzzing determinista.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullText } from '@shared/ingest'
import { parseXml } from './core/miniXml'
import { ZipArchive } from './core/zipArchive'
import { IngestError, isIngestError } from './errors'
import { readDocument } from './pipeline'
import { tempDir, type TempDir } from './testing/files'
import { cell, CONTENT_TYPES, docx, epub, HEADING_STYLES, listP, p, pptx, R_NS, rels, row, sp, table, W_NS, xhtml, xlsx, xml, type DocxSpec } from './testing/office'
import { ZipForge } from './testing/zipForge'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const NUMBERING = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="9223372036854775807"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="-9223372036854775808"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="-9223372036854775807"/></w:lvlOverride></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="9223372036854775806"/></w:lvlOverride></w:num>'

const word = (spec: DocxSpec, name = 'hostil.docx') => readDocument(tmp.write(name, docx(spec)))
const elapsed = (t0: number): number => (performance.now() - t0) / 1000

function replacingEntry(data: Uint8Array, name: string, text: string): Uint8Array {
  const zip = new ZipArchive(data)
  const forge = new ZipForge()
  for (const n of zip.fileNames) forge.add(n, n === name ? text : (zip.read(n) as Uint8Array))
  return forge.build()
}

describe('Word hostil', () => {
  it('niveles de esquema negativos o absurdos se ignoran', async () => {
    const doc = await word({
      styles: '<w:style w:type="paragraph" w:styleId="Raro"><w:name w:val="Raro"/><w:pPr><w:outlineLvl w:val="-7"/></w:pPr></w:style>',
      body: p('Párrafo con nivel negativo', undefined, '<w:outlineLvl w:val="-3"/>') + p('Estilo con nivel negativo', 'Raro') + p('Nivel absurdo', undefined, '<w:outlineLvl w:val="99999999999999999999"/>') +
        p('Nivel de cuerpo', undefined, '<w:outlineLvl w:val="9"/>') + p('Título de nivel 2', undefined, '<w:outlineLvl w:val="1"/>')
    })
    expect(doc.pages[0].text).toBe('Párrafo con nivel negativo\n\nEstilo con nivel negativo\n\nNivel absurdo\n\nNivel de cuerpo\n\n## Título de nivel 2')
  })

  it('niveles de lista fuera de rango se acotan', async () => {
    for (const withNumbering of [false, true]) {
      const t0 = performance.now()
      const doc = await word({ numbering: withNumbering ? NUMBERING : undefined, body: listP('nivel negativo', 2, -1) + listP('nivel gigante', 2, 2_000_000_000) + listP('nivel normal', 2, 1) }, `niveles-${withNumbering}.docx`)
      expect(elapsed(t0)).toBeLessThan(5)
      for (const item of ['nivel negativo', 'nivel gigante', 'nivel normal']) expect(doc.pages[0].text).toContain(item)
      expect(doc.pages[0].text.length).toBeLessThan(200)
    }
  })

  it('inicios de lista extremos no desbordan el contador', async () => {
    const body = [1, 2, 3].map((n) => listP(`max ${n}`, 1)).join('') + [1, 2, 3].map((n) => listP(`min ${n}`, 1, 1)).join('') +
      [1, 2, 3].map((n) => listP(`override negativo ${n}`, 2)).join('') + [1, 2, 3].map((n) => listP(`override enorme ${n}`, 3)).join('')
    const lines = (await word({ numbering: NUMBERING, body })).pages[0].text.split('\n')
    expect(lines).toHaveLength(12)
    for (const l of lines) expect(l.length).toBeLessThan(60)
    expect(new Set(lines.slice(0, 3).map((l) => l.split(' ')[0])).size).toBe(3)
  })

  it('cuadros de texto anidados se leen una vez y rápido', async () => {
    let inner = '<w:p><w:r><w:t>caja-fondo</w:t></w:r></w:p>'
    for (let i = 0; i < 30; i++) inner = `<w:p><w:r><w:t>caja-${i}-fin</w:t></w:r><w:r><w:drawing><w:txbxContent>${inner}</w:txbxContent></w:drawing></w:r></w:p>`
    const t0 = performance.now()
    const doc = await word({ body: inner })
    expect(elapsed(t0)).toBeLessThan(5)
    const text = doc.pages.map((x) => x.text).join('\n')
    for (let i = 0; i < 30; i++) expect(text.split(`caja-${i}-fin`)).toHaveLength(2)
    expect(text.split('caja-fondo')).toHaveLength(2)
  })

  it('tablas, ecuaciones y contenedores en línea muy anidados', async () => {
    let tables = '<w:p><w:r><w:t>centro de la tabla</w:t></w:r></w:p>'
    for (let i = 0; i < 120; i++) tables = `<w:tbl><w:tr><w:tc>${tables}</w:tc></w:tr></w:tbl><w:p/>`
    const t = await word({ body: p('Antes de la tabla') + tables + p('Después de la tabla') }, 'tablas.docx')
    const text = t.pages.map((x) => x.text).join('\n')
    expect(text).toContain('Antes de la tabla')
    expect(t.warnings.length > 0 && text.length > 0).toBe(true)
    let math = '<m:r><m:t>x</m:t></m:r>'
    for (let i = 0; i < 110; i++) math = i % 2 === 0 ? `<m:f><m:num>${math}</m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${math}</m:e></m:rad>`
    expect((await word({ body: `<w:p><w:r><w:t>Ecuación: </w:t></w:r><m:oMath>${math}</m:oMath></w:p>` + p('Fin del documento.') }, 'eq.docx')).pages.map((x) => x.text).join('')).toContain('Ecuación')
    let inline = '<w:r><w:t>texto anidado</w:t></w:r>'
    for (let i = 0; i < 150; i++) inline = i % 3 === 0 ? `<w:hyperlink>${inline}</w:hyperlink>` : i % 3 === 1 ? `<w:smartTag>${inline}</w:smartTag>` : `<w:sdt><w:sdtContent>${inline}</w:sdtContent></w:sdt>`
    const nested = await word({ body: `<w:p>${inline}</w:p>` + p('Párrafo final.') }, 'inline.docx')
    expect(nested.pages[0].text).toBe('texto anidado\n\nPárrafo final.')
    expect(nested.warnings).toEqual([])
    let deeper = '<w:r><w:t>demasiado hondo</w:t></w:r>'
    for (let i = 0; i < 400; i++) deeper = `<w:smartTag>${deeper}</w:smartTag>`
    const cut = await word({ body: p('Primer párrafo.') + `<w:p>${deeper}</w:p>` }, 'corte.docx')
    expect(fullText(cut).startsWith('Primer párrafo.')).toBe(true)
    expect(cut.warnings.some((w) => w.includes('incompleta o dañada')), JSON.stringify(cut.warnings)).toBe(true)
  })

  it('declaraciones de entidades tras un prólogo largo', async () => {
    const padding = '<!--' + 'relleno '.repeat(200_000) + '-->'
    const laughs = '<!DOCTYPE w:document [<!ENTITY a "jajajajajaja"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>'
    const doc = '<?xml version="1.0"?>' + padding + laughs + `<w:document ${W_NS}><w:body><w:p><w:r><w:t>&c;</w:t></w:r></w:p></w:body></w:document>`
    expect(parseXml(new Uint8Array(Buffer.from(doc))).error).not.toBeNull()
    const e = await readDocument(tmp.write('risas.docx', new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': doc }).build())).catch((x: unknown) => x)
    expect(isIngestError(e, 'corrupt'), String(e)).toBe(true)
    const sheet = xml(padding + '<!DOCTYPE worksheet [<!ENTITY a "x">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&a;</t></is></c></row></sheetData></worksheet>')
    const book = replacingEntry(xlsx([{ name: 'Hoja', rowsXML: '' }]), 'xl/worksheets/sheet1.xml', sheet)
    expect(fullText(await readDocument(tmp.write('risas.xlsx', book)))).not.toContain('x |')
  })
})

describe('PowerPoint y Excel hostiles', () => {
  it('niveles de viñeta negativos y enormes', async () => {
    const shape = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="C"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>' +
      '<a:p><a:pPr lvl="-2"/><a:r><a:t>nivel negativo</a:t></a:r></a:p><a:p><a:pPr lvl="99999999999"/><a:r><a:t>nivel enorme</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>nivel uno</a:t></a:r></a:p></p:txBody></p:sp>'
    const doc = await readDocument(tmp.write('niveles.pptx', pptx([{ shapes: sp(['Diapositiva rara'], 'title') + shape }])))
    expect(doc.pages[0].text).toBe('# Diapositiva rara\n\n- nivel negativo\n- nivel enorme\n  - nivel uno')
  })

  it('relaciones que escapan del paquete son inofensivas', async () => {
    const forge = new ZipForge()
    forge.add('[Content_Types].xml', CONTENT_TYPES)
    forge.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: '../../../../../../etc/passwd' }]))
    forge.add('ppt/presentation.xml', xml(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${R_NS}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`))
    forge.add('ppt/_rels/presentation.xml.rels', rels([{ id: 'rId1', type: `${R_NS}/slide`, target: '../../../../etc/passwd' }, { id: 'rId2', type: `${R_NS}/slide`, target: 'presentation.xml' }]))
    forge.add('ppt/slides/slide1.xml', xml('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' + sp(['Diapositiva de respaldo'], 'title') + '</p:spTree></p:cSld></p:sld>'))
    const doc = await readDocument(tmp.write('escape.pptx', forge.build()))
    expect(fullText(doc).includes('Diapositiva de respaldo') || doc.pages.every((x) => !x.text)).toBe(true)
    expect(fullText(doc)).not.toContain('root:')
  })

  it('referencias de celda absurdas y filas extremas', async () => {
    const rows = row(1, '<c r="AAAAAAAAAAAAAAAAAAAAAAAA1" t="inlineStr"><is><t>muy lejos</t></is></c><c r="A1" t="inlineStr"><is><t>cerca</t></is></c>') +
      row(2, '<c r="B99999999999999999999999"><v>7</v></c><c r="ZZZZZZZZZZZZZZZZZZZZ"><v>8</v></c><c r="Ñ2"><v>9</v></c><c r=""><v>10</v></c>') +
      '<row r="-5"><c t="inlineStr"><is><t>fila negativa</t></is></c></row><row r="99999999999999999999999"><c><v>11</v></c></row>'
    const text = (await readDocument(tmp.write('celdas.xlsx', xlsx([{ name: 'Rara', rowsXML: rows }])))).pages[0].text
    expect(text).toContain('cerca')
    expect(text).not.toContain('muy lejos')
    expect(text).toContain('fila negativa')
    const extreme = '<row r="9223372036854775807"><c t="inlineStr"><is><t>fila máxima</t></is></c></row><row><c t="inlineStr"><is><t>fila sin número</t></is></c></row>'
    expect((await readDocument(tmp.write('filas.xlsx', xlsx([{ name: 'Filas', rowsXML: extreme }])))).pages[0].text).toContain('fila sin número')
  })

  it('cientos de hojas con nombres raros', async () => {
    const sheets = Array.from({ length: 300 }, (_, i) => ({ name: i % 2 === 0 ? 'Igual' : `Hoja ${i}`, rowsXML: '' }))
    sheets.push({ name: 'Nombre largo '.repeat(400), rowsXML: row(1, cell('A1', '0', 's')) })
    const doc = await readDocument(tmp.write('hojas.xlsx', xlsx(sheets, ['dato real'])))
    expect(doc.pages).toHaveLength(301)
    expect(doc.pages[doc.pages.length - 1].text).toContain('dato real')
  })

  it('partes repetidas se leen una vez (hojas y notas)', async () => {
    const filler = '<!--' + 'relleno '.repeat(300_000) + '-->'
    const rows = Array.from({ length: 50 }, (_, i) => row(i + 1, cell(`A${i + 1}`, String(i + 1)))).join('')
    const count = 1500
    const book = new ZipForge()
    book.add('[Content_Types].xml', CONTENT_TYPES)
    book.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'xl/workbook.xml' }]))
    book.add('xl/workbook.xml', xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><sheets>${Array.from({ length: count }, (_, i) => `<sheet name="Hoja ${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`))
    book.add('xl/_rels/workbook.xml.rels', rels(Array.from({ length: count }, (_, i) => ({ id: `rId${i + 1}`, type: `${R_NS}/worksheet`, target: 'worksheets/sheet1.xml' }))))
    book.add('xl/worksheets/sheet1.xml', xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${filler}</worksheet>`))
    let t0 = performance.now()
    const sheetsDoc = await readDocument(tmp.write('repetidas.xlsx', book.build()))
    expect(elapsed(t0)).toBeLessThan(10)
    expect(sheetsDoc.pages).toHaveLength(1)
    expect(sheetsDoc.pages[0].text).toContain('50')

    const SL = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    const deck = new ZipForge()
    deck.add('[Content_Types].xml', CONTENT_TYPES)
    deck.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'ppt/presentation.xml' }]))
    const ids = Array.from({ length: 800 }, (_, k) => `<p:sldId id="${256 + k}" r:id="rId${k + 1 <= 400 ? 1 : 2}"/>`).join('')
    deck.add('ppt/presentation.xml', xml(`<p:presentation ${SL} xmlns:r="${R_NS}"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`))
    deck.add('ppt/_rels/presentation.xml.rels', rels([{ id: 'rId1', type: `${R_NS}/slide`, target: 'slides/slide1.xml' }, { id: 'rId2', type: `${R_NS}/slide`, target: 'slides/slide2.xml' }]))
    for (const i of [1, 2]) {
      deck.add(`ppt/slides/slide${i}.xml`, xml(`<p:sld ${SL}><p:cSld><p:spTree>` + sp([`Diapositiva ${i}`], 'title') + '</p:spTree></p:cSld></p:sld>'))
      deck.add(`ppt/slides/_rels/slide${i}.xml.rels`, rels([{ id: 'rId1', type: `${R_NS}/notesSlide`, target: '../notesSlides/notes.xml' }]))
    }
    deck.add('ppt/notesSlides/notes.xml', xml(`<p:notes ${SL}><p:cSld><p:spTree>${sp(['Nota larga del orador. '.repeat(100_000)], 'body')}</p:spTree></p:cSld></p:notes>`))
    t0 = performance.now()
    const slides = await readDocument(tmp.write('repetidas.pptx', deck.build()))
    expect(elapsed(t0)).toBeLessThan(10)
    expect(slides.pages.map((x) => x.heading)).toEqual(['Diapositiva 1', 'Diapositiva 2'])
    expect(slides.pages.filter((x) => x.text.includes('Notas del orador'))).toHaveLength(1)
  })

  it('el presupuesto de descompresión corta las lecturas repetidas', () => {
    const zip = new ZipArchive(new ZipForge({ 'a.txt': new Uint8Array(1_000_000).fill(0x61) }).build(), { maxEntries: 10, maxTotalUncompressed: 1_500_000, maxEntryUncompressed: 1_500_000 })
    for (let i = 0; i < 3; i++) expect(zip.read('a.txt')?.length).toBe(1_000_000)
    let error: unknown = null
    try { zip.read('a.txt') } catch (e) { error = e }
    expect(isIngestError(error, 'archiveLimit')).toBe(true)
  })
})

describe('EPUB hostil', () => {
  it('capítulo muy anidado', async () => {
    const deep = '<div><blockquote><ul><li>'.repeat(2000) + 'núcleo del capítulo' + '</li></ul></blockquote></div>'.repeat(2000)
    const doc = await readDocument(tmp.write('profundo.epub', epub({ chapters: [{ file: 'c1.xhtml', html: xhtml('<h1>Capítulo profundo</h1>' + deep) }, { file: 'c2.xhtml', html: xhtml('<p>Segundo capítulo normal y corriente.</p>') }] })))
    expect(doc.pages).toHaveLength(2)
    expect(doc.pages[1].text).toContain('Segundo capítulo')
  })

  it('un spine con bucles y escapes', async () => {
    const forge = new ZipForge()
    forge.add('mimetype', 'application/epub+zip', 'stored')
    forge.add('META-INF/container.xml', xml('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="../../OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'))
    forge.add('OEBPS/content.opf', xml(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bucles</dc:title></metadata>
<manifest><item id="opf" href="content.opf" media-type="application/xhtml+xml"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="fuera" href="../../../../etc/passwd" media-type="application/xhtml+xml"/><item id="cont" href="../META-INF/container.xml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/><itemref idref="opf"/><itemref idref="fuera"/><itemref idref="c1"/><itemref idref="cont"/><itemref idref="nada"/></spine></package>`))
    forge.add('OEBPS/c1.xhtml', xhtml('<p>Capítulo uno con texto suficiente.</p>'))
    const doc = await readDocument(tmp.write('bucles.epub', forge.build()))
    expect(doc.title).toBe('Bucles')
    expect(doc.pages[0]?.text).toContain('Capítulo uno')
    expect(fullText(doc)).not.toContain('root:')
  })
})

describe('Fuzzing determinista', () => {
  it('los paquetes estropeados al azar nunca rompen la lectura', async () => {
    let state = 2026n
    const next = (): number => {
      state ^= (state << 13n) & 0xffffffffffffffffn; state ^= state >> 7n; state ^= (state << 17n) & 0xffffffffffffffffn
      return Number(state & 0xffffffffn)
    }
    const rnd = (n: number): number => next() % n
    const alphabet = [...Buffer.from('<>/="\' &;#:xw\u0000'), 0xc3, 0xa9, 0xff]
    const mutate = (text: string, edits: number): string => {
      const bytes = Array.from(Buffer.from(text))
      for (let e = 0; e < edits && bytes.length; e++) {
        const i = rnd(bytes.length)
        switch (rnd(4)) {
          case 0: bytes.splice(i, 1); break
          case 1: bytes.splice(i, 0, alphabet[rnd(alphabet.length)]); break
          case 2: bytes[i] = alphabet[rnd(alphabet.length)]; break
          default: { const j = Math.min(bytes.length, i + 1 + rnd(40)); bytes.splice(i, 0, ...bytes.slice(i, j)) }
        }
      }
      return Buffer.from(bytes).toString('utf8')
    }
    const check = async (data: Uint8Array, name: string): Promise<void> => {
      try { await readDocument(tmp.write(name, data), { ocr: false }) } catch (e) { if (!(e instanceof IngestError)) throw e }
    }
    const body = p('Título', 'Heading1') + listP('uno', 1) + table([['a', 'b'], ['1', '2']]) + '<w:p><w:r><w:t>Texto</w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></w:p>'
    const slide = sp(['Título'], 'title') + sp(['uno', 'dos'], 'body', true)
    const rows = row(1, cell('A1', '0', 's') + cell('B1', '3.5')) + row(2, cell('A2', '44000', undefined, 1))
    const chapter = xhtml('<h1>Capítulo</h1><p>Texto con <b>negrita</b> y <a href="#x">enlace</a>.</p><ul><li>uno</li></ul>')
    const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    const t0 = performance.now()
    for (let i = 0; i < 25; i++) {
      const edits = 1 + (i % 6)
      await check(docx({ body: mutate(body, edits), styles: mutate(HEADING_STYLES, edits), numbering: mutate(numbering, edits) }), `f${i}.docx`)
      await check(pptx([{ shapes: mutate(slide, edits), notes: mutate('Notas', 1) }]), `f${i}.pptx`)
      await check(xlsx([{ name: mutate('Hoja', 1), rowsXML: mutate(rows, edits) }], ['texto']), `f${i}.xlsx`)
      await check(epub({ chapters: [{ file: 'c1.xhtml', html: mutate(chapter, edits) }] }), `f${i}.epub`)
      await check(new Uint8Array(Buffer.from(mutate('{\\rtf1\\ansi {\\b negrita} \\u233? texto\\par fin}', edits))), `f${i}.rtf`)
      await check(new Uint8Array(Buffer.from(mutate('<html><body><table><tr><td>a<td>b</table><math><mfrac><mi>x</mi><mn>2</mn></mfrac></math></body></html>', edits))), `f${i}.html`)
    }
    expect(elapsed(t0)).toBeLessThan(30)
  })
})
