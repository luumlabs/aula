// Regresiones de robustez (port de RobustnessTests.swift y HostileMediaTests.swift): límites, entradas hostiles, archivos
// especiales, títulos y avisos acotados, imágenes y PDF dañados, índices de búsqueda corruptos y cancelación.
import { execFileSync } from 'node:child_process'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fullText, type SourceChunk } from '@shared/ingest'
import { SearchIndex } from '../search/searchIndex'
import { fold } from '../search/text'
import { chunkDocument } from './chunker'
import { decodeEntities } from './core/htmlEntities'
import { parseXml } from './core/miniXml'
import { IngestError, isIngestError } from './errors'
import { isGenericName } from './extract/image'
import { extractHTML, visibleCount } from './extract/htmlExtractor'
import { parseHTML } from './extract/htmlParser'
import type { OcrEngine } from './extract/ocr'
import { readDocument, tidyDocument, tidyTitle } from './pipeline'
import { png, tempDir, type TempDir } from './testing/files'
import { cell, docx, epub, HEADING_STYLES, listP, p, pptx, row, sp, xhtml, xlsx } from './testing/office'
import { buildPDF, LOREM, paragraph } from './testing/pdf'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())
const elapsed = (t0: number): number => (performance.now() - t0) / 1000
const u8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'))

/** TIFF mínimo (solo cabeceras) con `frames` páginas de `w` × `h`. */
function tiff(frames: number, w = 40, h = 40): Uint8Array {
  const bytes: number[] = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]
  for (let f = 0; f < frames; f++) {
    const at = bytes.length
    const next = f === frames - 1 ? 0 : at + 2 + 2 * 12 + 4
    bytes.push(2, 0)
    bytes.push(0, 1, 3, 0, 1, 0, 0, 0, w & 255, w >> 8, 0, 0)        // ancho
    bytes.push(1, 1, 3, 0, 1, 0, 0, 0, h & 255, h >> 8, 0, 0)        // alto
    bytes.push(next & 255, (next >> 8) & 255, 0, 0)
  }
  return new Uint8Array(bytes)
}

/** PDF escrito a mano, objeto a objeto (para estructuras que el generador normal no hace). */
function rawPDF(objects: string[]): Uint8Array {
  let out = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}
const stream = (dict: string, content: string): string => `<< ${dict} /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`

function nestedForms(depth: number, cyclic = false): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /X 6 0 R >> >> >>',
    stream('', 'BT /F1 18 Tf 72 720 Td (Texto antes de los formularios anidados) Tj ET /X Do'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let i = 0; i < depth; i++) {
    const me = 6 + i
    const next = i === depth - 1 ? (cyclic ? 6 : null) : me + 1
    const resources = next !== null ? `/Resources << /Font << /F1 5 0 R >> /XObject << /X ${next} 0 R >> >>` : '/Resources << /Font << /F1 5 0 R >> >>'
    const content = next !== null ? 'q 1 0 0 1 0.1 0.1 cm /X Do Q' : 'BT /F1 12 Tf 72 600 Td (fondo) Tj ET'
    objects.push(stream(`/Type /XObject /Subtype /Form /BBox [0 0 612 792] ${resources}`, content))
  }
  return rawPDF(objects)
}

describe('MiniXML y HTML: casos de robustez', () => {
  it('atributos con y sin prefijo', () => {
    const root = parseXml(u8('<a xmlns:r="urn:r" xmlns:w="urn:w" xmlns:x="urn:x"><b w:id="7" r:id="rId3" id="propio"/><c w:id="9" x:id="rId8"/><d w:val="v" xml:space="preserve"/></a>')).root
    const b = root?.child('b'), c = root?.child('c'), d = root?.child('d')
    expect(b?.attr('id')).toBe('propio')
    expect(b?.attr('r:id')).toBe('rId3')
    expect(b?.attr('w:id')).toBe('7')
    expect(b?.relationshipID).toBe('rId3')
    expect(c?.relationshipID).toBe('rId8')
    expect(d?.relationshipID).toBeNull()
    expect(d?.attr('val')).toBe('v')
    expect(d?.attr('space')).toBe('preserve')
    expect(d?.attr('nada')).toBeNull()
    expect(d?.attr('r:val')).toBeNull()
  })

  it('subárboles descartados', () => {
    const r = parseXml(u8('<doc><p><rPr><b/><sz val="24"/><t>no</t></rPr><r><rPr><i/></rPr><t>sí</t></r></p><sectPr><pgSz/></sectPr><p><t>dos</t></p></doc>'), { skipping: new Set(['rPr', 'sectPr']) })
    expect(r.error).toBeNull()
    expect(r.root?.firstDescendant('rPr')).toBeNull()
    expect(r.root?.firstDescendant('sz')).toBeNull()
    expect(r.root?.child('sectPr')).toBeNull()
    expect(r.root?.descendants('t').map((n) => n.text)).toEqual(['sí', 'dos'])
    expect(parseXml(u8('<rPr><x/></rPr>'), { skipping: new Set(['rPr']) }).root?.children).toHaveLength(1)
    const deep = '<a><rPr>' + '<x>'.repeat(300) + '</x>'.repeat(300) + '</rPr></a>'
    expect(parseXml(u8(deep), { maxDepth: 256, skipping: new Set(['rPr']) }).error).not.toBeNull()
    const wide = parseXml(u8('<a><rPr>' + '<x/>'.repeat(5000) + '</rPr><b/></a>'), { maxNodes: 10, skipping: new Set(['rPr']) })
    expect(wide.error).toBeNull()
    expect(wide.root?.child('b')).not.toBeNull()
  })

  it('un Word con mucho formato conserva su texto', async () => {
    const rPr = '<w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:sz w:val="24"/><w:lang w:val="es-ES"/></w:rPr>'
    const body = `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${rPr}</w:pPr><w:r>${rPr}<w:t>Título</w:t></w:r></w:p>` +
      `<w:p><w:proofErr w:type="spellStart"/><w:r>${rPr}<w:t xml:space="preserve">Texto </w:t></w:r><w:del><w:r><w:delText>borrado</w:delText></w:r></w:del>` +
      '<w:ins><w:r><w:t>insertado</w:t></w:r></w:ins><w:bookmarkStart w:id="0" w:name="x"/></w:p><w:sectPr><w:pgSz/></w:sectPr>'
    expect((await readDocument(tmp.write('formato.docx', docx({ body, styles: HEADING_STYLES })))).pages[0].text).toBe('# Título\n\nTexto insertado')
  })

  it('entidades en los bordes, cierres sin pareja y texto visible', () => {
    const cases: Array<[string, string]> = [['&', '&'], ['&;', '&;'], ['&amp', '&amp'], ['a&amp;b', 'a&b'], ['ñ&eacute;ñ', 'ñéñ'], ['&#x1F600;&#128512;', '😀😀'],
      ['&#0;&#xD800;&#x110000;', '���'], ['&#150;', '–'], ['&&amp;&', '&&&'], ['&amp &lt;', '&amp <'], ['&' + 'a'.repeat(40) + ';', '&' + 'a'.repeat(40) + ';'], ['日本&nbsp;語', '日本 語'], ['&ñ;', '&ñ;']]
    for (const [input, expected] of cases) expect(decodeEntities(input), input).toBe(expected)
    const html = '<div><p>uno </x></y><b>dos</div><div><ul><li>a<li>b</ul><p>tres<p>cuatro</div></z></div><p>fin</p>'
    const root = parseHTML(html)
    const divs = root.elements('div')
    expect(divs).toHaveLength(2)
    expect(root.elements('li')).toHaveLength(2)
    expect(divs[1].children.filter((c) => c.tag === 'p')).toHaveLength(2)
    expect(root.children[root.children.length - 1].tag).toBe('p')
    expect(extractHTML(html, { isolateMainContent: false }).text).toBe('uno dos\n\n- a\n- b\n\ntres\n\ncuatro\n\nfin')
    expect(parseHTML('<p>a</script><title>t</title><script>if (a<b) {}</script><p>b').elements('p')).toHaveLength(2)
    expect(visibleCount('a b\tc\n')).toBe(3)
    expect(visibleCount('  ​  　﻿x')).toBe(1)
    expect(visibleCount('ñandú 日本 😀')).toBe(8)
    expect(visibleCount('')).toBe(0)
  })

  it('una lista que empieza en 0 avanza', async () => {
    const numbering = '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    expect((await readDocument(tmp.write('cero.docx', docx({ numbering, body: listP('cero', 1) + listP('uno', 1) + listP('dos', 1) })))).pages[0].text).toBe('0. cero\n1. uno\n2. dos')
  })

  it('nombres genéricos de cámara (y títulos que no lo son); sigma final', () => {
    for (const g of ['IMG 2034', 'IMG_2034', 'img 2034 2', 'IMG 2034(1)', 'DSC01234', 'PXL 20231004 123456789', 'Screenshot 2023-10-04 at 10.00.00', 'Captura de pantalla 2023-10-04 a las 10.00.00', 'WhatsApp Image 2023-10-04 at 10.00.00', 'photo 2023-10-04 10-00-00', 'scan0012', 'foto', '12345', 'a1']) expect(isGenericName(g), g).toBe(true)
    for (const t of ['Photosynthesis notes', 'Imagenología tema 3', 'Scanning electron microscopy', 'Picasso', 'Camera obscura', 'Examen de física']) expect(isGenericName(t), t).toBe(false)
    const index = new SearchIndex([{ id: 'g', sourceID: 's', ordinal: 0, text: 'Ο Πυθαγόρας και ο λόγος ΠΥΘΑΓΟΡΑΣ.' }])
    for (const q of ['πυθαγορας', 'πυθαγορασ', 'Πυθαγόρας', 'ΠΥΘΑΓΌΡΑΣ']) expect(index.search(q), q).toHaveLength(1)
    expect(fold('Πυθαγόρας')).toBe('πυθαγορασ')
  })
})

describe('Opciones y parámetros fuera de rango', () => {
  it('maxPages cero o negativo nunca rompe nada', async () => {
    const files: Array<[string, Uint8Array]> = [
      ['a.pdf', buildPDF({ pages: [1, 2, 3].map((i) => ({ texts: [{ text: `Página ${i} con texto suficiente para no hacer OCR.`, x: 72, y: 700 }] })) })],
      ['b.pptx', pptx([{ shapes: sp(['Uno'], 'title') }, { shapes: sp(['Dos'], 'title') }])],
      ['c.xlsx', xlsx([{ name: 'A', rowsXML: row(1, cell('A1', '1')) }, { name: 'B', rowsXML: row(1, cell('A1', '2')) }])],
      ['d.epub', epub({ chapters: [{ file: 'c1.xhtml', html: xhtml('<p>Capítulo uno.</p>') }, { file: 'c2.xhtml', html: xhtml('<p>Capítulo dos.</p>') }] })],
      ['e.tiff', tiff(2)],
      ['f.docx', docx({ body: p('Uno') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('Dos') })]
    ]
    for (const maxPages of [0, -5, Number.MIN_SAFE_INTEGER, -Infinity, NaN]) {
      for (const [name, data] of files) {
        const doc = await readDocument(tmp.write(name, data), { maxPages, ocrWhenTextShorterThan: -10, ocr: false })
        expect(doc.pages, `${name} con maxPages = ${maxPages}`).toHaveLength(1)
      }
    }
  })

  it('el troceado con parámetros absurdos', () => {
    const d = { pages: [{ number: 1, text: Array.from({ length: 200 }, (_, i) => `Frase ${i + 1} de prueba con varias palabras.`).join(' '), usedOCR: false, hasFigures: false }] }
    for (const [target, maxChars, overlap] of [[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [Number.MAX_SAFE_INTEGER, 10, 5], [50, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]]) {
      expect(chunkDocument(d, 's', { target, maxChars, overlap }).length).toBeGreaterThan(0)
    }
  })
})

describe('Archivos especiales', () => {
  it('una tubería con nombre se rechaza sin bloquearse', async () => {
    const fifo = join(tmp.path, 'tuberia.txt')
    try { execFileSync('mkfifo', [fifo]) } catch { return }
    const t0 = performance.now()
    const e = await readDocument(fifo).catch((x: unknown) => x)
    expect(isIngestError(e, 'unsupportedType') && (e as Error).message.includes('no es un archivo normal'), String(e)).toBe(true)
    const link = join(tmp.path, 'enlace.pdf')
    symlinkSync(fifo, link)
    expect(isIngestError(await readDocument(link).catch((x: unknown) => x), 'unsupportedType')).toBe(true)
    expect(elapsed(t0)).toBeLessThan(2)
  })

  it('un enlace simbólico conserva el nombre que eligió el usuario', async () => {
    const target = tmp.write('x9f3k.txt', 'Apuntes de clase.')
    const link = join(tmp.path, 'Apuntes de física.txt')
    symlinkSync(target, link)
    const doc = await readDocument(link)
    expect(doc.title).toBe('Apuntes de física')
    expect(doc.metadata.sourceFile).toBe('Apuntes de física.txt')
  })
})

describe('Títulos, metadatos y avisos acotados', () => {
  it('DocumentTidy', () => {
    const tidy = tidyDocument({
      title: 'Título\n\u0000muy largo '.repeat(100_000), kind: 'web', pages: [],
      metadata: { author: 'a'.repeat(50_000), toc: 'x\n'.repeat(10_000) },
      warnings: Array.from({ length: 500 }, (_, i) => `Aviso número ${i + 1} ` + '·'.repeat(i === 0 ? 2000 : 1))
    }, 'reserva')
    expect(tidy.pages).toHaveLength(1)
    expect(Array.from(tidy.title).length).toBeLessThanOrEqual(201)
    expect(tidy.title.startsWith('Título muy largo Título')).toBe(true)
    expect(tidy.title.includes('\u0000') || tidy.title.includes('\n')).toBe(false)
    expect(tidy.metadata.author.length).toBeLessThanOrEqual(4001)
    expect(tidy.metadata.toc.length).toBe(20_000)
    expect(tidy.warnings).toHaveLength(30)
    expect(tidy.warnings[29]).toContain('471 avisos más')
    expect(Array.from(tidy.warnings[0]).length).toBeLessThanOrEqual(401)
    expect(tidyTitle(' \n\t ', '  ')).toBe('Sin título')
    expect(tidyTitle('', 'apuntes')).toBe('apuntes')
  })

  it('por el canal completo: título HTML enorme y muchos avisos', async () => {
    const doc = await readDocument(tmp.write('titulo.html', '<html><head><title>' + 'Título enorme '.repeat(80_000) + '</title></head><body><p>Contenido.</p></body></html>'))
    expect(Array.from(doc.title).length).toBeLessThanOrEqual(201)
    const sheets = [...Array.from({ length: 120 }, (_, i) => ({ name: `Oculta ${i}`, rowsXML: '', hidden: true })), { name: 'Visible', rowsXML: row(1, cell('A1', '1')) }]
    const book = await readDocument(tmp.write('ocultas.xlsx', xlsx(sheets)))
    expect(book.warnings).toHaveLength(30)
    expect(book.warnings[29].startsWith('Hay ')).toBe(true)
  })
})

describe('Imágenes hostiles', () => {
  const failing: OcrEngine = { name: 'falso', recognize: async () => { throw new Error('motor roto') } }

  it('imágenes cortadas o dañadas: error claro o aviso', async () => {
    const image = png(600, 200)
    const cases: Array<[string, Uint8Array]> = [
      ['cortada.png', image.subarray(0, Math.floor(image.length / 2))], ['cabecera.png', image.subarray(0, 40)],
      ['firma.jpg', new Uint8Array([0xff, 0xd8, 0xff, ...new Array(5000).fill(0)])], ['firma.gif', new Uint8Array([...Buffer.from('GIF89a'), ...new Array(100).fill(0xff)])],
      ['ceros.heic', new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), ...new Array(2000).fill(0)])]
    ]
    for (const engine of [false as const, failing]) {
      for (const [name, data] of cases) {
        try {
          const doc = await readDocument(tmp.write(name, data), { ocr: engine })
          expect(doc.kind, name).toBe('image')
          expect(doc.warnings.length === 0 && fullText(doc) === '', name).toBe(false)
        } catch (e) {
          expect(isIngestError(e, 'corrupt') || isIngestError(e, 'tooLarge'), `${name}: ${String(e)}`).toBe(true)
        }
      }
    }
  })

  it('imágenes diminutas o de proporciones extremas', async () => {
    let calls = 0
    const engine: OcrEngine = { name: 'falso', recognize: async () => { calls++; return { width: 1, height: 1, lines: [] } } }
    for (const [w, h] of [[1, 1], [3, 2000], [6000, 4], [9, 9]]) expect((await readDocument(tmp.write(`tira-${w}x${h}.png`, png(w, h, 50)), { ocr: engine })).pages).toHaveLength(1)
    expect(calls).toBe(1)                        // solo la de 9 × 9 pasa al OCR
  })

  it('OCR de una foto con poca confianza', async () => {
    const engine: OcrEngine = { name: 'falso', recognize: async () => ({ width: 800, height: 600, lines: [{ text: 'Apuntes de química orgánica', bbox: { x: 40, y: 40, width: 600, height: 50 }, confidence: 0.3 }] }) }
    const doc = await readDocument(tmp.write('IMG_2034.png', png(800, 600)), { ocr: engine })
    expect(doc.pages[0]).toMatchObject({ usedOCR: true, lowConfidence: true, ocrConfidence: 0.3 })
    expect(doc.title).toBe('Apuntes de química orgánica')
    expect(doc.warnings.some((w) => w.includes('borrosa'))).toBe(true)
  })
})

describe('PDF hostiles', () => {
  it('muchas páginas en blanco son rápidas', async () => {
    const pages = Array.from({ length: 60 }, (_, i) => (i === 30 ? { texts: [{ text: 'La única página con texto de todo el documento.', x: 72, y: 700 }] } : {}))
    const t0 = performance.now()
    const doc = await readDocument(tmp.write('blancas.pdf', buildPDF({ pages })))
    expect(elapsed(t0)).toBeLessThan(6)
    expect(doc.pages).toHaveLength(60)
    expect(doc.pages.filter((x) => x.text)).toHaveLength(1)
  })

  it('páginas de tamaño absurdo y gigantes sin texto', async () => {
    for (const [w, h] of [[14_400, 14_400], [2, 2], [5000, 20]]) {
      const doc = await readDocument(tmp.write(`rara-${w}x${h}.pdf`, buildPDF({ pages: [{ width: w, height: h, texts: [{ text: 'Texto en una página rara', x: 1, y: Math.max(1, h / 2), size: Math.max(1, Math.min(40, h / 3)) }] }] })))
      expect(doc.pages).toHaveLength(1)
    }
    for (const box of ['0 0 100000000000000000000 792', '0 0 612 100000000000000000000', '0 0 1e20 792']) {
      const data = rawPDF(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /Contents 4 0 R >>`, stream('', '0 0 0 rg 10 10 200 200 re f')])
      try { await readDocument(tmp.write('gigante.pdf', data), { rasterizer: { renderPdfPage: async () => null }, ocr: { name: 'x', recognize: async () => ({ width: 1, height: 1, lines: [] }) } }) } catch (e) { expect(e).toBeInstanceOf(IngestError) }
    }
  })

  it('PDF estropeados o cortados nunca se cuelgan', async () => {
    const good = buildPDF({ pages: [1, 2, 3].map((i) => ({ texts: paragraph(LOREM + ` Página ${i}.`, 72, 720, 468) })) })
    let seed = 7
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const inputs: Uint8Array[] = []
    for (let cut = 0.1; cut <= 0.95; cut += 0.17) inputs.push(good.subarray(0, Math.floor(good.length * cut)))
    for (let k = 0; k < 4; k++) { const m = good.slice(); for (let j = 0; j < 40; j++) m[rnd(m.length)] = rnd(256); inputs.push(m) }
    inputs.push(new Uint8Array([...Buffer.from('%PDF-1.7\n'), ...Array.from({ length: 50_000 }, () => rnd(256))]))
    const t0 = performance.now()
    for (const [i, data] of inputs.entries()) {
      try { await readDocument(tmp.write(`fuzz${i}.pdf`, data)) } catch (e) { expect(e, String(e)).toBeInstanceOf(IngestError) }
    }
    expect(elapsed(t0)).toBeLessThan(25)
  })

  it('formularios anidados muy hondos o en ciclo', async () => {
    for (const [name, data] of [['anidado.pdf', nestedForms(3000)], ['ciclo.pdf', nestedForms(3, true)]] as const) {
      const t0 = performance.now()
      const doc = await readDocument(tmp.write(name, data))
      expect(elapsed(t0)).toBeLessThan(15)
      expect(doc.pages[0].text).toContain('Texto antes')
    }
  })
})

describe('Índice de búsqueda guardado y dañado', () => {
  const chunks = (n: number, text: (i: number) => string): SourceChunk[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, sourceID: 's', ordinal: i, text: text(i) }))

  it('datos dañados nunca rompen nada', () => {
    const good = new SearchIndex(chunks(50, (i) => `Fragmento ${i} de prueba con derivadas.`)).data()
    let seed = 3
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const magic = Array.from(Buffer.from('AULA_IDX'))
    const inputs: Uint8Array[] = [new Uint8Array(), new Uint8Array(magic), new Uint8Array([...magic, 1, 1]), new Uint8Array([...magic, 9, 0, ...Buffer.from('[]')]), u8('{"chunks":[{"id":1}]}'), u8('['), new Uint8Array(100_000).fill(0x5b)]
    for (let cut = 0.05; cut < 1; cut += 0.15) inputs.push(good.subarray(0, Math.floor(good.length * cut)))
    for (let k = 0; k < 6; k++) { const m = new Uint8Array(good); for (let j = 0; j < 10; j++) m[10 + rnd(m.length - 10)] = rnd(256); inputs.push(m) }
    for (const data of inputs) {
      let loaded: SearchIndex | null = null
      try { loaded = SearchIndex.load(data) } catch (e) { expect(e).toBeInstanceOf(IngestError) }
      loaded?.search('derivadas')
    }
    expect(SearchIndex.load(good).count).toBe(50)
  })

  it('la descompresión de un índice está acotada', () => {
    const data = new SearchIndex(chunks(400, () => 'texto repetido '.repeat(60))).data()
    expect(data[9]).not.toBe(0)
    expect(() => SearchIndex.load(data, 50_000)).toThrow()
    expect(SearchIndex.load(data, 50_000_000).count).toBe(400)
  })
})

describe('Cancelación y lecturas en paralelo', () => {
  it('una lectura ya cancelada no empieza', async () => {
    const file = tmp.write('grande.html', '<html><body>' + '<p>Párrafo de prueba con texto suficiente para tardar un poco.</p>'.repeat(60_000) + '</body></html>')
    const controller = new AbortController()
    controller.abort()
    await expect(readDocument(file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('muchas lecturas a la vez terminan todas', async () => {
    const files = Array.from({ length: 40 }, (_, i) => tmp.write(`p${i}.html`, `<html><body><h1>Página ${i}</h1><p>Texto de la página número ${i}.</p></body></html>`))
    const titles = await Promise.all(files.map(async (f) => (await readDocument(f)).title))
    expect(new Set(titles)).toEqual(new Set(Array.from({ length: 40 }, (_, i) => `Página ${i}`)))
  })
})
