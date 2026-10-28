// EPUB: capítulos en el orden del `spine`, cada uno como una «página»; el índice (`nav` de EPUB 3 o `toc.ncx` de EPUB 2)
// va en los metadatos (`toc`) y da nombre a los capítulos.
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, type IngestContext } from '../core/progress'
import { parseXml, XNode } from '../core/miniXml'
import { decodeHTML } from '../core/textDecoding'
import type { ZipArchive } from '../core/zipArchive'
import { corrupt, IngestError, unsupportedType } from '../errors'
import { L } from '../messages'
import { trimWSNL } from '../text/unicode'
import { collapse, extractHTML } from './htmlExtractor'
import { parseHTML, type HNode } from './htmlParser'
import { Markers } from './markers'
import { MAX_PART_BYTES, openPackage, PartName, readXmlPart, resolvePart, usableTitle } from './ooxml'

interface ManifestItem { id: string; href: string; mediaType: string; properties: string }
interface Package { opfPath: string; root: XNode; manifest: Map<string, ManifestItem>; spine: Array<{ idref: string; linear: boolean }> }
interface TOCEntry { title: string; depth: number; path: string }
interface TOC { entries: TOCEntry[]; titleByPath: Map<string, string> }

export async function extractEPUB(path: string, ctx: IngestContext): Promise<SourceDocument> {
  return extractEPUBFromZip(openPackage(path, ctx.options), ctx)
}

export function extractEPUBFromZip(zip: ZipArchive, ctx: IngestContext): SourceDocument {
  ctx.progress.report(0.03, L('Abriendo el libro…'), true)
  rejectDRM(zip)
  const pkg = readPackage(zip, ctx)

  // Metadatos
  const meta: Record<string, string> = {}
  const md = pkg.root.child('metadata')
  const dc = (name: string): string | null => {
    const first = md?.childrenNamed(name)[0]
    const t = first ? trimWSNL(first.text) : ''
    return t || null
  }
  const title0 = dc('title')
  if (title0) meta.title = title0
  const creators = (md?.childrenNamed('creator') ?? []).map((c) => trimWSNL(c.text)).filter((c) => c.length > 0)
  if (creators.length) meta.author = creators.join(', ')
  const lang = dc('language'); if (lang) meta.language = lang
  const pub = dc('publisher'); if (pub) meta.publisher = pub
  const desc = dc('description'); if (desc) meta.description = desc
  const date = dc('date'); if (date) meta.created = date
  const ident = dc('identifier'); if (ident) meta.identifier = ident

  // Índice
  const toc = readTOC(zip, pkg)
  if (toc.entries.length) meta.toc = toc.entries.map((e) => '  '.repeat(e.depth) + e.title).join('\n')

  // Capítulos
  let spineItems: ManifestItem[] = []
  const seenHrefs = new Set<string>()
  for (const ref of pkg.spine) {
    // Un capítulo repetido en el orden de lectura (o el propio OPF) se lee una sola vez
    const item = pkg.manifest.get(ref.idref)
    if (!item || item.href === pkg.opfPath || seenHrefs.has(item.href)) continue
    seenHrefs.add(item.href)
    if (item.properties.split(' ').includes('nav')) continue
    const type = item.mediaType.toLowerCase()
    if (!(type.includes('html') || (type.includes('xml') && !type.includes('ncx') && !type.includes('opf')))) continue
    spineItems.push(item)
  }
  if (spineItems.length === 0) throw corrupt(L('el EPUB no tiene capítulos'))
  if (spineItems.length > ctx.options.maxPages) {
    ctx.warnings.add(L('El libro tiene %lld capítulos; solo se leyeron los primeros %lld.', spineItems.length, ctx.options.maxPages))
    spineItems = spineItems.slice(0, ctx.options.maxPages)
  }

  const pages: SourcePage[] = []
  const figurePattern = Markers.figurePattern
  spineItems.forEach((item, i) => {
    checkContext(ctx)
    ctx.progress.report(0.08 + (0.9 * i) / spineItems.length, L('Leyendo capítulo %@ de %@…', String(i + 1), String(spineItems.length)))
    try {
      const data = zip.read(item.href, MAX_PART_BYTES)
      if (!data) { ctx.warnings.add(L('No se encontró el capítulo «%@».', item.href)); return }
      const html = decodeHTML(data).text
      const content = extractHTML(html, { isolateMainContent: false })
      const text = trimWSNL(content.text)
      // Una portada o un capítulo que solo trae imágenes no es texto de estudio
      if (!trimWSNL(text.replace(figurePattern, ''))) return
      const tocTitle = toc.titleByPath.get(item.href)
      pages.push({ number: pages.length + 1, text, usedOCR: false, heading: tocTitle ?? content.firstHeading ?? undefined, hasFigures: content.hasFigures })
    } catch (e) {
      if (!(e instanceof IngestError)) throw e
      if (e.kind === 'passwordProtected') throw e
      ctx.warnings.add(L('No se pudo leer el capítulo «%@»: %@', item.href, e.message))
    }
  })
  if (pages.length === 0) ctx.warnings.add(L('El EPUB no contiene texto (¿es un libro de imágenes?).'))
  meta.pageCount = String(pages.length)
  const title = usableTitle(meta.title) ?? ctx.fallbackTitle
  meta.title = title
  return { title, kind: 'epub', pages, metadata: meta, warnings: ctx.warnings.all }
}

/** Los EPUB con DRM (Adobe, FairPlay…) no se pueden leer: se avisa con claridad. La ofuscación de tipografías es normal. */
function rejectDRM(zip: ZipArchive): void {
  if (zip.contains('META-INF/rights.xml') || zip.contains('META-INF/sinf.xml')) throw unsupportedType(L('este EPUB tiene protección DRM y no se puede leer'))
  let root: XNode | null = null
  try {
    const data = zip.read('META-INF/encryption.xml', 4 * 1024 * 1024)
    root = data ? parseXml(data).root : null
  } catch {
    root = null
  }
  if (!root) return
  const fontAlgorithms = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']
  for (const enc of root.descendants('EncryptedData')) {
    const algorithm = enc.firstDescendant('EncryptionMethod')?.attr('Algorithm') ?? ''
    const uri = (enc.firstDescendant('CipherReference')?.attr('URI') ?? '').toLowerCase()
    const isFont = ['.otf', '.ttf', '.woff', '.woff2'].some((e) => uri.endsWith(e))
    if (!fontAlgorithms.includes(algorithm) && !isFont) throw unsupportedType(L('este EPUB tiene protección DRM y no se puede leer'))
  }
}

function readPackage(zip: ZipArchive, ctx: IngestContext): Package {
  let opfPath: string | null = null
  if (zip.contains('META-INF/container.xml')) {
    const container = readXmlPart(zip, 'META-INF/container.xml', ctx, { label: PartName.container })
    const full = container?.firstDescendant('rootfile')?.attr('full-path')
    if (full) opfPath = resolvePart(full, '')
  }
  if (opfPath === null || !zip.contains(opfPath)) opfPath = zip.fileNames.find((n) => n.toLowerCase().endsWith('.opf')) ?? null
  const opf = opfPath !== null ? readXmlPart(zip, opfPath, ctx, { label: PartName.bookIndex }) : null
  if (opfPath === null || !opf) {
    // Sin OPF: los capítulos XHTML por orden de nombre
    const chapters = zip.fileNames.filter((n) => { const l = n.toLowerCase(); return l.endsWith('.xhtml') || l.endsWith('.html') || l.endsWith('.htm') }).sort()
    if (chapters.length === 0) throw corrupt(L('no es un EPUB válido (falta «META-INF/container.xml»)'))
    ctx.warnings.add(L('El EPUB no tiene índice de lectura; se leyeron los capítulos por orden de nombre.'))
    const manifest = new Map<string, ManifestItem>()
    chapters.forEach((path, i) => manifest.set(`c${i}`, { id: `c${i}`, href: path, mediaType: 'application/xhtml+xml', properties: '' }))
    return { opfPath: '', root: new XNode('package'), manifest, spine: chapters.map((_, i) => ({ idref: `c${i}`, linear: true })) }
  }
  const manifest = new Map<string, ManifestItem>()
  for (const item of opf.child('manifest')?.childrenNamed('item') ?? []) {
    const id = item.attr('id'), href = item.attr('href')
    if (id === null || href === null) continue
    manifest.set(id, { id, href: resolvePart(href, opfPath), mediaType: item.attr('media-type') ?? '', properties: item.attr('properties') ?? '' })
  }
  let spine: Array<{ idref: string; linear: boolean }> = []
  for (const ref of opf.child('spine')?.childrenNamed('itemref') ?? []) {
    const idref = ref.attr('idref')
    if (idref !== null) spine.push({ idref, linear: (ref.attr('linear') ?? 'yes') !== 'no' })
  }
  if (spine.length === 0) {
    // Respaldo: todos los XHTML del manifiesto, en su orden
    spine = (opf.child('manifest')?.childrenNamed('item') ?? []).filter((it) => it.attr('id') !== null && (it.attr('media-type') ?? '').includes('html')).map((it) => ({ idref: it.attr('id') as string, linear: true }))
    if (spine.length) ctx.warnings.add(L('El EPUB no declara el orden de lectura; se usó el orden del manifiesto.'))
  }
  return { opfPath, root: opf, manifest, spine }
}

function readTOC(zip: ZipArchive, pkg: Package): TOC {
  const toc: TOC = { entries: [], titleByPath: new Map() }
  // EPUB 3: documento de navegación
  const navItem = [...pkg.manifest.values()].find((it) => it.properties.split(' ').includes('nav'))
  if (navItem) {
    try {
      const data = zip.read(navItem.href, MAX_PART_BYTES)
      if (data) {
        const root = parseHTML(decodeHTML(data).text)
        const navs = root.elements('nav')
        const tocNav = navs.find((nv) => (nv.attr('epub:type') ?? nv.attr('type') ?? '').includes('toc')) ?? navs[0]
        const list = tocNav ? tocNav.firstElement('ol') ?? tocNav.firstElement('ul') : null
        if (list) walkNavList(list, 0, navItem.href, toc)
      }
    } catch {
      /* sin índice */
    }
  }
  // EPUB 2: toc.ncx
  if (toc.entries.length === 0) {
    let ncxItem = [...pkg.manifest.values()].find((it) => it.mediaType === 'application/x-dtbncx+xml')
    const tocID = pkg.root.child('spine')?.attr('toc')
    if (!ncxItem && tocID) ncxItem = pkg.manifest.get(tocID)
    if (ncxItem) {
      try {
        const data = zip.read(ncxItem.href, MAX_PART_BYTES)
        const map = data ? parseXml(data).root?.child('navMap') : null
        if (map) walkNCX(map, 0, ncxItem.href, toc)
      } catch {
        /* sin índice */
      }
    }
  }
  return toc
}

function walkNavList(list: HNode, depth: number, base: string, toc: TOC): void {
  if (depth >= 8 || toc.entries.length >= 5000) return
  for (const li of list.children) {
    if (li.tag !== 'li') continue
    let title = ''
    let href: string | undefined
    for (const c of li.children) {
      if (c.isText) continue
      if ((c.tag === 'a' || c.tag === 'span') && !title) {
        title = collapse(c.plainText)
        href = c.attr('href')
      }
    }
    if (title) {
      const path = href !== undefined ? resolvePart(href, base) : ''
      toc.entries.push({ title, depth, path })
      if (path && !toc.titleByPath.has(path)) toc.titleByPath.set(path, title)
    }
    for (const sub of li.children) if (sub.tag === 'ol' || sub.tag === 'ul') walkNavList(sub, depth + 1, base, toc)
  }
}

function walkNCX(parent: XNode, depth: number, base: string, toc: TOC): void {
  if (depth >= 8 || toc.entries.length >= 5000) return
  for (const point of parent.childrenNamed('navPoint')) {
    const title = collapse(point.child('navLabel')?.child('text')?.text ?? '')
    const src = point.child('content')?.attr('src')
    if (title) {
      const path = src !== null && src !== undefined ? resolvePart(src, base) : ''
      toc.entries.push({ title, depth, path })
      if (path && !toc.titleByPath.has(path)) toc.titleByPath.set(path, title)
    }
    walkNCX(point, depth + 1, base, toc)
  }
}
