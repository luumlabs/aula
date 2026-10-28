import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZipArchive } from '../core/zipArchive'
import { isIngestError, type IngestErrorKind } from '../errors'
import type { IngestOptions } from '../options'
import { readDocument } from '../pipeline'
import { ProgressLog, tempDir, type TempDir } from '../testing/files'
import { CONTENT_TYPES, docx, HEADING_STYLES, listP, p, R_NS, rels, table, W_NS, xml, type DocxSpec } from '../testing/office'
import { ZipForge } from '../testing/zipForge'

let tmp: TempDir
beforeEach(() => { tmp = tempDir() })
afterEach(() => tmp.cleanup())

const read = (spec: DocxSpec, name = 'doc.docx', options: Partial<IngestOptions> = {}) => readDocument(tmp.write(name, docx(spec)), options)
async function rejectsKind(promise: Promise<unknown>, kind: IngestErrorKind, check?: (e: Error) => boolean): Promise<void> {
  const e = await promise.then(() => null, (x: unknown) => x)
  expect(isIngestError(e, kind), String(e)).toBe(true)
  if (check) expect(check(e as Error)).toBe(true)
}

const NUMBERING = `
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>`

const BR = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

describe('DOCX: texto y metadatos', () => {
  it('párrafos y metadatos', async () => {
    const doc = await read({ body: p('Primer párrafo.') + p('Segundo párrafo con ñ, tildes y & símbolos <raros>.') + '<w:p/>' + p('   ') + p('Tercero.'), title: 'Mis apuntes', author: 'Ana Pérez' })
    expect(doc.kind).toBe('docx')
    expect(doc.title).toBe('Mis apuntes')
    expect(doc.metadata.author).toBe('Ana Pérez')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toBe('Primer párrafo.\n\nSegundo párrafo con ñ, tildes y & símbolos <raros>.\n\nTercero.')
    expect(doc.pages[0].usedOCR).toBe(false)
    expect(doc.warnings).toEqual([])
  })

  it('título: estilo Título, luego primer texto, luego el archivo', async () => {
    expect((await read({ body: p('Teoría de límites', 'Title') + p('texto'), styles: HEADING_STYLES })).title).toBe('Teoría de límites')
    expect((await read({ body: p('Texto sin estilos de título') }, 'Mis_apuntes_de_algebra.docx')).title).toBe('Texto sin estilos de título')
    expect((await read({ body: '', title: 'Documento1' }, 'Notas_clase.docx')).title).toBe('Notas clase')
  })

  it('títulos por estilo y por esquema', async () => {
    const body = p('Capítulo uno', 'Heading1') + p('Texto del capítulo.') + p('Sección', 'Heading2') + p('Subsección', 'Heading3') + p('En español', 'Ttulo1') + p('Heredado', 'MiTitulo') +
      p('Por esquema', 'Esquema') + p('Esquema directo', undefined, '<w:outlineLvl w:val="1"/>') + p('Cuerpo normal')
    const doc = await read({ body, styles: HEADING_STYLES })
    expect(doc.pages[0].text).toBe('# Capítulo uno\n\nTexto del capítulo.\n\n## Sección\n\n### Subsección\n\n# En español\n\n## Heredado\n\n### Por esquema\n\n## Esquema directo\n\nCuerpo normal')
    expect(doc.pages[0].heading).toBe('Capítulo uno')
    expect((await read({ body: p('Título', 'Heading1') + p('Sub', 'Heading2') + p('Otro', 'Ttulo3') })).pages[0].text).toBe('# Título\n\n## Sub\n\n### Otro')
  })
})

describe('DOCX: listas', () => {
  it('viñetas y numeradas', async () => {
    const body = p('Lista:') + listP('Uno', 1) + listP('Dos', 1) + listP('Sub dos', 1, 1) + p('Pasos:') + listP('Primero', 2) + listP('Segundo', 2) + listP('Detalle a', 2, 1) + listP('Detalle b', 2, 1) + listP('Tercero', 2) + listP('De nuevo a', 2, 1)
    expect((await read({ body, numbering: NUMBERING })).pages[0].text).toBe('Lista:\n\n- Uno\n- Dos\n  - Sub dos\n\nPasos:\n\n1. Primero\n2. Segundo\n  a) Detalle a\n  b) Detalle b\n3. Tercero\n  a) De nuevo a')
  })

  it('inicio cambiado y números romanos', async () => {
    const body = listP('cinco', 4) + listP('seis', 4) + listP('i', 2, 2) + listP('ii', 2, 2)
    expect((await read({ body, numbering: NUMBERING })).pages[0].text).toBe('5. cinco\n6. seis\n    i. i\n    ii. ii')
  })

  it('sin numeración y viñetas por estilo', async () => {
    expect((await read({ body: listP('sin definiciones', 9) + p('viñeta por estilo', 'ListBullet'), styles: HEADING_STYLES })).pages[0].text).toBe('- sin definiciones\n- viñeta por estilo')
  })

  it('títulos numerados', async () => {
    const body = listP('Introducción', 3, 0, 'Heading1') + listP('Contexto', 3, 1, 'Heading2') + listP('Objetivos', 3, 1, 'Heading2') + listP('Desarrollo', 3, 0, 'Heading1') + listP('Primer paso', 3, 1, 'Heading2')
    const doc = await read({ body, styles: HEADING_STYLES, numbering: NUMBERING })
    expect(doc.pages[0].text).toBe('# 1 Introducción\n\n## 1.1 Contexto\n\n## 1.2 Objetivos\n\n# 2 Desarrollo\n\n## 2.1 Primer paso')
    expect(doc.pages[0].heading).toBe('1 Introducción')
  })
})

describe('DOCX: tablas, enlaces y notas', () => {
  it('tablas (también con celdas combinadas y anidadas)', async () => {
    const nested = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>n1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>n2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const body = p('Antes') + table([['x', 'sen x', 'cos x'], ['0', '0', '1'], ['a|b', '', '']]) +
      `<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Ancha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Normal</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Con tabla</w:t></w:r></w:p>${nested}</w:tc></w:tr></w:tbl>` + p('Después')
    expect((await read({ body })).pages[0].text).toBe('Antes\n\nx | sen x | cos x\n0 | 0 | 1\na¦b\n\nAncha |  | Normal\nCon tabla n1; n2\n\nDespués')
  })

  it('enlaces', async () => {
    const body = '<w:p><w:r><w:t xml:space="preserve">Lee </w:t></w:r><w:hyperlink r:id="rId10"><w:r><w:t>esta teoría</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> y </w:t></w:r><w:hyperlink r:id="rId11"><w:r><w:t>www.khanacademy.org</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> o escribe a </w:t></w:r><w:hyperlink r:id="rId12"><w:r><w:t>la profesora</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve">; mira </w:t></w:r><w:hyperlink w:anchor="seccion2"><w:r><w:t>la sección 2</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>\n<w:p><w:hyperlink r:id="rId10"><w:r><w:t></w:t></w:r></w:hyperlink></w:p>'
    const doc = await read({ body, hyperlinks: { rId10: 'https://example.com/teoria', rId11: 'https://www.khanacademy.org/', rId12: 'mailto:profe@uni.edu' } })
    expect(doc.pages[0].text).toBe('Lee esta teoría (https://example.com/teoria) y www.khanacademy.org o escribe a la profesora (profe@uni.edu); mira la sección 2.\n\nhttps://example.com/teoria')
  })

  it('notas al pie', async () => {
    const footnotes = `
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:r><w:t>Definición formal en el apéndice.</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="3"><w:p><w:r><w:t xml:space="preserve">Véase Stewart, </w:t></w:r><w:r><w:t>cap. 3.</w:t></w:r></w:p></w:footnote>`
    const body = '<w:p><w:r><w:t>El límite existe</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> y es único</w:t></w:r><w:r><w:footnoteReference w:id="3"/></w:r><w:r><w:t>.</w:t></w:r></w:p>'
    expect((await read({ body, footnotes })).pages[0].text).toBe('El límite existe[1] y es único[2].\n\nNotas al pie:\n[1] Definición formal en el apéndice.\n[2] Véase Stewart, cap. 3.')
  })

  it('tabuladores, saltos de línea y guiones especiales', async () => {
    const body = '<w:p><w:r><w:t>Col A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Col B</w:t></w:r></w:p><w:p><w:r><w:t>línea uno</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>línea dos</w:t></w:r></w:p><w:p><w:r><w:t>semi</w:t><w:softHyphen/><w:t>guion y no</w:t><w:noBreakHyphen/><w:t>separable</w:t></w:r></w:p>'
    expect((await read({ body })).pages[0].text).toBe('Col A Col B\n\nlínea uno\nlínea dos\n\nsemiguion y no-separable')
  })
})

describe('DOCX: páginas', () => {
  it('saltos de página explícitos', async () => {
    const doc = await read({ body: p('Página uno.') + BR + p('Página dos.') + p('Más de la dos.') + BR + BR + p('Página tres.') })
    expect(doc.pages.map((x) => x.text)).toEqual(['Página uno.', 'Página dos.\n\nMás de la dos.', 'Página tres.'])
    expect(doc.pages.map((x) => x.number)).toEqual([1, 2, 3])
    expect(doc.metadata.pageCount).toBe('3')
  })

  it('los saltos que dibujó Word mandan', async () => {
    const body = p('Texto de la primera página.') + '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:lastRenderedPageBreak/><w:t>Texto de la segunda página.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Sigue en la segunda.</w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t> Y ya empieza la tercera.</w:t></w:r></w:p>'
    const doc = await read({ body })
    expect(doc.pages).toHaveLength(3)
    expect(doc.pages[0].text).toBe('Texto de la primera página.')
    expect(doc.pages[1].text.startsWith('Texto de la segunda página.')).toBe(true)
    expect(doc.pages[1].text).toContain('Sigue en la segunda.')
    expect(doc.pages[2].text).toBe('Y ya empieza la tercera.')
  })

  it('salto antes del párrafo y título de cada página', async () => {
    expect((await read({ body: p('Uno.') + p('Dos.', undefined, '<w:pageBreakBefore/>') + p('Tres.') })).pages.map((x) => x.text)).toEqual(['Uno.', 'Dos.\n\nTres.'])
    const doc = await read({ styles: HEADING_STYLES, body: p('Intro', 'Heading1') + p('a') + BR + p('continúa sin título') + BR + p('Final', 'Heading1') })
    expect(doc.pages.map((x) => x.heading)).toEqual(['Intro', undefined, 'Final'])
  })
})

describe('DOCX: contenido incrustado', () => {
  it('cuadros de texto y contenido alternativo (una sola vez)', async () => {
    const body = '<w:p><w:r><w:t>Texto principal</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:docPr id="1" name="Cuadro" descr="Un cuadro de texto con una nota"/><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Nota dentro del cuadro</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox xmlns:v="urn:v"><w:txbxContent><w:p><w:r><w:t>Nota dentro del cuadro</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>'
    const doc = await read({ body })
    expect(doc.pages[0].text.split('Nota dentro del cuadro')).toHaveLength(2)
    expect(doc.pages[0].text.startsWith('Texto principal')).toBe(true)
    expect(doc.pages[0].hasFigures).toBe(true)
    expect(doc.pages[0].text).toContain('[Figura: Un cuadro de texto con una nota]')
  })

  it('ecuaciones de Word (OMML) en forma lineal', async () => {
    const frac = '<m:oMath><m:f><m:num><m:r><m:t>a+b</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>'
    const power = '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>+</m:t></m:r><m:sSub><m:e><m:r><m:t>y</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub></m:oMath>'
    const root = '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:sSup><m:e><m:r><m:t>a</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:e></m:rad></m:oMath>'
    const sum = '<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary></m:oMath>'
    const fn = '<m:oMath><m:func><m:fName><m:r><m:t>sin</m:t></m:r></m:fName><m:e><m:d><m:e><m:r><m:t>θ</m:t></m:r></m:e></m:d></m:e></m:func></m:oMath>'
    const body = `<w:p><w:r><w:t xml:space="preserve">Media: </w:t></w:r>${frac}</w:p><w:p>${power}</w:p><w:p><m:oMathPara>${root}</m:oMathPara></w:p><w:p>${sum}</w:p><w:p>${fn}</w:p>`
    expect((await read({ body })).pages[0].text).toBe('Media: (a+b)/2\n\nx^2+y_n\n\n√(a^2+b^2)\n\n∑_(i=1)^n i\n\nsin(θ)')
  })

  it('imágenes, cambios controlados y controles de contenido', async () => {
    const img = await read({ body: p('Con imagen') + '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="Imagen 1" descr="Gráfica de la función seno"/></wp:inline></w:drawing></w:r></w:p>' + p('Sin imagen', undefined, '<w:pageBreakBefore/>') })
    expect(img.pages.map((x) => x.hasFigures)).toEqual([true, false])
    expect(img.pages[0].text).toContain('[Figura: Gráfica de la función seno]')
    expect((await read({ body: '<w:p><w:r><w:t>Se queda </w:t></w:r><w:del w:id="1"><w:r><w:delText>borrado </w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>insertado</w:t></w:r></w:ins></w:p>' })).pages[0].text).toBe('Se queda insertado')
    expect((await read({ body: '<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Dentro de un control</w:t></w:r></w:p></w:sdtContent></w:sdt><w:p><w:sdt><w:sdtContent><w:r><w:t>en línea</w:t></w:r></w:sdtContent></w:sdt></w:p>' })).pages[0].text).toBe('Dentro de un control\n\nen línea')
  })
})

describe('DOCX: errores y límites', () => {
  it('un documento vacío avisa y deja una página', async () => {
    const doc = await read({ body: '<w:p/>' })
    expect(doc.warnings.some((w) => w.includes('no contiene texto'))).toBe(true)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toBe('')
  })

  it('sin la parte principal, o sin ser un ZIP: dañado', async () => {
    await rejectsKind(readDocument(tmp.write('malo.docx', new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'word/otro.xml': '<x/>' }).build())), 'corrupt')
    await rejectsKind(readDocument(tmp.write('falso.docx', 'esto no es un zip')), 'corrupt')
  })

  it('un document.xml cortado conserva lo que puede', async () => {
    const zip = new ZipArchive(docx({ body: p('Uno.') + p('Dos.') + p('Tres.') }))
    const forge = new ZipForge()
    for (const name of zip.fileNames) {
      const data = zip.read(name) as Uint8Array
      forge.add(name, name === 'word/document.xml' ? data.subarray(0, data.length - 60) : data)
    }
    const doc = await readDocument(tmp.write('cortado.docx', forge.build()))
    expect(doc.pages[0].text.startsWith('Uno.')).toBe(true)
    expect(doc.warnings.some((w) => w.includes('incompleta') || w.includes('dañada')), JSON.stringify(doc.warnings)).toBe(true)
  })

  it('bombas zip y demasiadas entradas', async () => {
    const forge = new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': xml(`<w:document ${W_NS}><w:body>${p('hola')}</w:body></w:document>`) })
    forge.add('word/media/bomba.bin', new Uint8Array(30 * 1024 * 1024))
    const file = tmp.write('bomba.docx', forge.build())
    await rejectsKind(readDocument(file, { maxArchiveBytes: 10 * 1024 * 1024 }), 'archiveLimit')
    expect((await readDocument(file)).pages[0].text).toBe('hola')
    const many = new ZipForge({ 'word/document.xml': xml(`<w:document ${W_NS}><w:body>${p('x')}</w:body></w:document>`) })
    for (let i = 0; i < 200; i++) many.add(`word/media/i${i}.png`, 'x', 'stored')
    await rejectsKind(readDocument(tmp.write('muchas.docx', many.build()), { maxArchiveEntries: 100 }), 'archiveLimit')
  })

  it('XML con entidades declaradas: se rechaza', async () => {
    const evil = xml(`<!DOCTYPE d [<!ENTITY x "AAAAAAAAAAAAAAAAAAAAAAAA">]><w:document ${W_NS}><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`)
    await rejectsKind(readDocument(tmp.write('xxe.docx', new ZipForge({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': evil }).build())), 'corrupt')
  })

  it('Office con contraseña y Word antiguo', async () => {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    const encrypted = new Uint8Array([...ole, ...new Array(512).fill(0), ...Buffer.from('EncryptedPackage', 'utf16le'), ...new Array(512).fill(0)])
    await rejectsKind(readDocument(tmp.write('protegido.docx', encrypted)), 'passwordProtected')
    await rejectsKind(readDocument(tmp.write('viejo.doc', new Uint8Array([...ole, ...new Array(600).fill(0)]))), 'unsupportedType', (e) => e.message.includes('.doc'))
  })

  it('compatibilidad con un ZIP hecho por otra herramienta', async () => {
    const z = new JSZip()
    z.file('[Content_Types].xml', CONTENT_TYPES)
    z.file('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'word/document.xml' }]))
    z.file('word/document.xml', xml(`<w:document ${W_NS}><w:body>${p('Creado con otra herramienta.') + p('relleno '.repeat(4000))}</w:body></w:document>`))
    const doc = await readDocument(tmp.write('sistema.docx', await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } })))
    expect(doc.pages[0].text.startsWith('Creado con otra herramienta.')).toBe(true)
    expect(doc.pages[0].text.length).toBeGreaterThan(30_000)
  })

  it('un documento grande es rápido y el progreso acaba en 1', async () => {
    const body = Array.from({ length: 20_000 }, (_, i) => p(`Párrafo número ${i} con algo de texto de relleno para el documento grande.`)).join('')
    const t0 = performance.now()
    const doc = await read({ body }, 'grande.docx')
    expect(performance.now() - t0).toBeLessThan(10_000)
    expect(doc.pages[0].text).toContain('número 19999')
    const log = new ProgressLog()
    const small = await read({ body: p('a') }, 'p.docx', { onProgress: log.callback })
    expect(log.fractions[0]).toBe(0)
    expect(log.fractions[log.fractions.length - 1]).toBe(1)
    expect(small.metadata.pageCount).toBe('1')
  })
})
