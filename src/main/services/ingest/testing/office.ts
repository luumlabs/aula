// Solo para pruebas: paquetes DOCX / PPTX / XLSX / EPUB mínimos en memoria (port de OfficeBuilders.swift).
import { ZipForge } from './zipForge'

export const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CORE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'

export const xml = (body: string): string => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body
export const escapeXML = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function core(title?: string, author?: string, extra = ''): string {
  return xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">' +
    (title !== undefined ? `<dc:title>${title}</dc:title>` : '') + (author !== undefined ? `<dc:creator>${author}</dc:creator>` : '') + extra + '</cp:coreProperties>')
}

export interface Rel { id: string; type: string; target: string; external?: boolean }
export function rels(items: Rel[]): string {
  return xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    items.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') + '</Relationships>')
}

export const CONTENT_TYPES = xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>')

// MARK: DOCX

export interface DocxSpec {
  body: string
  styles?: string
  numbering?: string
  footnotes?: string
  endnotes?: string
  /** rId → URL */
  hyperlinks?: Record<string, string>
  title?: string
  author?: string
  extraFiles?: Array<[string, string | Uint8Array]>
}

export function docx(spec: DocxSpec): Uint8Array {
  const rel: Rel[] = []
  if (spec.styles !== undefined) rel.push({ id: 'rIdS', type: `${R_NS}/styles`, target: 'styles.xml' })
  if (spec.numbering !== undefined) rel.push({ id: 'rIdN', type: `${R_NS}/numbering`, target: 'numbering.xml' })
  if (spec.footnotes !== undefined) rel.push({ id: 'rIdF', type: `${R_NS}/footnotes`, target: 'footnotes.xml' })
  if (spec.endnotes !== undefined) rel.push({ id: 'rIdE', type: `${R_NS}/endnotes`, target: 'endnotes.xml' })
  for (const [id, url] of Object.entries(spec.hyperlinks ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) rel.push({ id, type: `${R_NS}/hyperlink`, target: url, external: true })
  const zip = new ZipForge()
  zip.add('[Content_Types].xml', CONTENT_TYPES)
  zip.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'word/document.xml' }, { id: 'rId2', type: CORE_REL, target: 'docProps/core.xml' }]))
  zip.add('docProps/core.xml', core(spec.title, spec.author))
  zip.add('word/document.xml', xml(`<w:document ${W_NS}><w:body>${spec.body}</w:body></w:document>`))
  zip.add('word/_rels/document.xml.rels', rels(rel))
  if (spec.styles !== undefined) zip.add('word/styles.xml', xml(`<w:styles ${W_NS}>${spec.styles}</w:styles>`))
  if (spec.numbering !== undefined) zip.add('word/numbering.xml', xml(`<w:numbering ${W_NS}>${spec.numbering}</w:numbering>`))
  if (spec.footnotes !== undefined) zip.add('word/footnotes.xml', xml(`<w:footnotes ${W_NS}>${spec.footnotes}</w:footnotes>`))
  if (spec.endnotes !== undefined) zip.add('word/endnotes.xml', xml(`<w:endnotes ${W_NS}>${spec.endnotes}</w:endnotes>`))
  for (const [n, d] of spec.extraFiles ?? []) zip.add(n, d)
  return zip.build()
}

/** `<w:p>` con un solo texto. */
export function p(text: string, style?: string, extraPPr = ''): string {
  const ppr = (style !== undefined ? `<w:pStyle w:val="${style}"/>` : '') + extraPPr
  return '<w:p>' + (ppr ? `<w:pPr>${ppr}</w:pPr>` : '') + `<w:r><w:t xml:space="preserve">${escapeXML(text)}</w:t></w:r></w:p>`
}

export function listP(text: string, numId: number, ilvl = 0, style?: string): string {
  return p(text, style, `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`)
}

export function table(rows: string[][]): string {
  return '<w:tbl>' + rows.map((row) => '<w:tr>' + row.map((c) => `<w:tc><w:p><w:r><w:t>${escapeXML(c)}</w:t></w:r></w:p></w:tc>`).join('') + '</w:tr>').join('') + '</w:tbl>'
}

export const HEADING_STYLES = `
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="Título 1"/></w:style>
<w:style w:type="paragraph" w:styleId="MiTitulo"><w:name w:val="Mi título"/><w:basedOn w:val="Heading2"/></w:style>
<w:style w:type="paragraph" w:styleId="Esquema"><w:name w:val="Esquema"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
`

// MARK: PPTX

export interface Slide { shapes: string; notes?: string }

export function sp(text: string[], placeholder?: string, bullets = false, level = 0): string {
  const ph = placeholder !== undefined ? `<p:nvPr><p:ph type="${placeholder}"/></p:nvPr>` : '<p:nvPr/>'
  const paras = text.map((t) => {
    let ppr = '<a:pPr' + (level > 0 ? ` lvl="${level}"` : '') + '>'
    if (bullets) ppr += '<a:buChar char="•"/>'
    ppr += '</a:pPr>'
    return `<a:p>${ppr}<a:r><a:t>${escapeXML(t)}</a:t></a:r></a:p>`
  }).join('')
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Forma"/><p:cNvSpPr/>${ph}</p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`
}

export function pptx(slides: Slide[], order?: number[], title?: string): Uint8Array {
  const zip = new ZipForge()
  zip.add('[Content_Types].xml', CONTENT_TYPES)
  zip.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'ppt/presentation.xml' }, { id: 'rId2', type: CORE_REL, target: 'docProps/core.xml' }]))
  zip.add('docProps/core.xml', core(title))
  zip.add('ppt/_rels/presentation.xml.rels', rels(slides.map((_, i) => ({ id: `rId${i + 1}`, type: `${R_NS}/slide`, target: `slides/slide${i + 1}.xml` }))))
  const sequence = order ?? slides.map((_, i) => i)
  const ids = sequence.map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')
  zip.add('ppt/presentation.xml', xml(`<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${R_NS}"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`))
  slides.forEach((s, i) => {
    zip.add(`ppt/slides/slide${i + 1}.xml`, xml(`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><p:cSld><p:spTree>${s.shapes}</p:spTree></p:cSld></p:sld>`))
    if (s.notes !== undefined) {
      zip.add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([{ id: 'rId1', type: `${R_NS}/notesSlide`, target: `../notesSlides/notesSlide${i + 1}.xml` }]))
      zip.add(`ppt/notesSlides/notesSlide${i + 1}.xml`, xml(`<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${sp(['1'], 'sldNum')}${sp([s.notes], 'body')}</p:spTree></p:cSld></p:notes>`))
    }
  })
  return zip.build()
}

// MARK: XLSX

export interface Sheet { name: string; rowsXML: string; hidden?: boolean }

export function cell(ref: string, value: string, type?: string, style?: number, formula?: string): string {
  const t = type !== undefined ? ` t="${type}"` : ''
  const s = style !== undefined ? ` s="${style}"` : ''
  const f = formula !== undefined ? `<f>${escapeXML(formula)}</f>` : ''
  return !value && formula === undefined ? `<c r="${ref}"${s}/>` : `<c r="${ref}"${t}${s}>${f}${value ? `<v>${value}</v>` : ''}</c>`
}

export const row = (n: number, cells: string): string => `<row r="${n}">${cells}</row>`

export function xlsx(sheets: Sheet[], sharedStrings: string[] = [], stylesXML?: string, date1904 = false): Uint8Array {
  const zip = new ZipForge()
  zip.add('[Content_Types].xml', CONTENT_TYPES)
  zip.add('_rels/.rels', rels([{ id: 'rId1', type: `${R_NS}/officeDocument`, target: 'xl/workbook.xml' }, { id: 'rId2', type: CORE_REL, target: 'docProps/core.xml' }]))
  zip.add('docProps/core.xml', core())
  const wbRels: Rel[] = sheets.map((_, i) => ({ id: `rId${i + 1}`, type: `${R_NS}/worksheet`, target: `worksheets/sheet${i + 1}.xml` }))
  wbRels.push({ id: 'rIdSS', type: `${R_NS}/sharedStrings`, target: 'sharedStrings.xml' }, { id: 'rIdST', type: `${R_NS}/styles`, target: 'styles.xml' })
  zip.add('xl/_rels/workbook.xml.rels', rels(wbRels))
  const tags = sheets.map((s, i) => `<sheet name="${escapeXML(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')
  zip.add('xl/workbook.xml', xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${tags}</sheets></workbook>`))
  sheets.forEach((s, i) => zip.add(`xl/worksheets/sheet${i + 1}.xml`, xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rowsXML}</sheetData></worksheet>`)))
  zip.add('xl/sharedStrings.xml', xml(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` + sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXML(s)}</t></si>`).join('') + '</sst>'))
  zip.add('xl/styles.xml', stylesXML ?? xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts></styleSheet>'))
  return zip.build()
}

// MARK: EPUB

export interface Chapter { file: string; html: string; linear?: boolean }
const chapterID = (c: Chapter): string => c.file.replace(/\./g, '_').replace(/\//g, '_')

export function xhtml(body: string, title = 'Capítulo'): string {
  return xml(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`)
}

export interface EpubSpec {
  title?: string
  author?: string
  language?: string
  chapters: Chapter[]
  nav?: Array<[string, string]>
  ncx?: Array<[string, string]>
  encryption?: string
  extra?: Array<[string, string | Uint8Array]>
  cover?: Uint8Array
  spineOrder?: string[]
}

export function epub(spec: EpubSpec): Uint8Array {
  const { title = 'Mi libro', author = 'Ana Pérez', language = 'es', chapters } = spec
  const zip = new ZipForge()
  zip.add('mimetype', 'application/epub+zip', 'stored')
  zip.add('META-INF/container.xml', xml('<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'))
  if (spec.encryption !== undefined) zip.add('META-INF/encryption.xml', spec.encryption)
  let manifest = chapters.map((c) => `<item id="${chapterID(c)}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('')
  if (spec.nav) manifest += '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
  if (spec.ncx) manifest += '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
  if (spec.cover) manifest += '<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>'
  const ids = spec.spineOrder ?? chapters.map(chapterID)
  const spine = ids.map((id) => {
    const linear = chapters.find((c) => chapterID(c) === id)?.linear ?? true
    return `<itemref idref="${id}"${linear ? '' : ' linear="no"'}/>`
  }).join('')
  zip.add('OEBPS/content.opf', xml(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:1234</dc:identifier><dc:title>${escapeXML(title)}</dc:title><dc:creator>${escapeXML(author)}</dc:creator><dc:language>${language}</dc:language></metadata><manifest>${manifest}</manifest><spine${spec.ncx ? ' toc="ncx"' : ''}>${spine}</spine></package>`))
  for (const c of chapters) zip.add(`OEBPS/${c.file}`, c.html)
  if (spec.nav) {
    const items = spec.nav.map(([href, label]) => `<li><a href="${href}">${escapeXML(label)}</a></li>`).join('')
    zip.add('OEBPS/nav.xhtml', xhtml(`<nav epub:type="toc"><ol>${items}</ol></nav>`, 'Índice'))
  }
  if (spec.ncx) {
    const points = spec.ncx.map(([src, label], i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${escapeXML(label)}</text></navLabel><content src="${src}"/></navPoint>`).join('')
    zip.add('OEBPS/toc.ncx', xml(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${points}</navMap></ncx>`))
  }
  if (spec.cover) zip.add('OEBPS/images/cover.png', spec.cover, 'stored')
  for (const [n, d] of spec.extra ?? []) zip.add(n, d)
  return zip.build()
}
