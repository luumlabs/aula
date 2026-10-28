// Word (.docx): párrafos, títulos (por estilo o nivel de esquema), listas, tablas, notas al pie, hipervínculos, cuadros de
// texto, ecuaciones (OMML → texto lineal) y superíndices/subíndices. Las páginas siguen los saltos de página del documento.
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, type IngestContext } from '../core/progress'
import { XNode } from '../core/miniXml'
import type { ZipArchive } from '../core/zipArchive'
import { corrupt } from '../errors'
import { L } from '../messages'
import { charCount, trimWS, trimWSNL } from '../text/unicode'
import { Markers } from './markers'
import { ommlText } from './mathLinearizer'
import {
  coreProperties, mainPart, MAX_PART_BYTES, openPackage, parsePart, PartName, readAuxiliaryPart, relationships, renderBlocks,
  ScriptedText, tidy, usableTitle, wordScript, WORD_SKIPPED, type Block, type ScriptPosition
} from './ooxml'

export async function extractDOCX(path: string, ctx: IngestContext): Promise<SourceDocument> {
  const zip = openPackage(path, ctx.options)
  return extractDOCXFromZip(zip, ctx)
}

export function extractDOCXFromZip(zip: ZipArchive, ctx: IngestContext): SourceDocument {
  const mainPath = mainPart(zip, '/officeDocument', 'word/document.xml')
  if (!zip.contains(mainPath)) throw corrupt(L('no es un documento de Word válido (falta «word/document.xml»)'))
  ctx.progress.report(0.05, L('Abriendo el documento de Word…'), true)
  const rels = relationships(mainPath, zip)
  const target = (suffix: string, fallback: string): string => rels.find((r) => r.type.endsWith(suffix) && !r.isExternal)?.target ?? fallback

  const data = zip.read(mainPath, MAX_PART_BYTES)
  const docRoot = data ? parsePart(data, mainPath, ctx, { label: PartName.document, required: true, skipping: WORD_SKIPPED }) : null
  if (!data || !docRoot) throw corrupt(L('no se pudo leer el contenido del documento'))
  const hasRenderedBreaks = Buffer.from(data.buffer, data.byteOffset, data.byteLength).indexOf('lastRenderedPageBreak') >= 0
  ctx.progress.report(0.25, L('Leyendo estilos y listas…'))
  checkContext(ctx)

  // Estilos, numeración y notas son auxiliares: una parte dañada deja un aviso y el texto se importa igual
  const styles = new Styles(readAuxiliaryPart(zip, target('/styles', 'word/styles.xml'), ctx, PartName.styles, WORD_SKIPPED))
  const numbering = new Numbering(readAuxiliaryPart(zip, target('/numbering', 'word/numbering.xml'), ctx, PartName.numbering, WORD_SKIPPED))
  const links = new Map<string, string>()
  for (const r of rels) if (r.isExternal && r.type.endsWith('/hyperlink')) links.set(r.id, r.target)

  const reader = new Reader(styles, numbering, links, !hasRenderedBreaks, ctx)
  reader.footnotes = readNotes(zip, target('/footnotes', 'word/footnotes.xml'), 'footnote', reader, ctx)
  reader.endnotes = readNotes(zip, target('/endnotes', 'word/endnotes.xml'), 'endnote', reader, ctx)

  ctx.progress.report(0.4, L('Leyendo el texto…'))
  const body = docRoot.child('body')
  if (body) reader.readContainer(body)
  else ctx.warnings.add(L('El documento de Word no tiene cuerpo de texto.'))
  checkContext(ctx)

  const pages: SourcePage[] = []
  for (const page of reader.pages) {
    const text = renderBlocks(page.blocks) + page.footnoteText()
    if (!trimWSNL(text)) continue
    pages.push({ number: pages.length + 1, text, usedOCR: false, heading: page.firstHeading ?? undefined, hasFigures: page.hasFigures })
  }
  if (pages.length === 0) ctx.warnings.add(L('El documento de Word no contiene texto (¿solo imágenes?).'))

  const meta = coreProperties(zip)
  meta.pageCount = String(pages.length)
  const title = usableTitle(meta.title) ?? reader.titleCandidate ?? ctx.fallbackTitle
  meta.title = title
  return { title, kind: 'docx', pages, metadata: meta, warnings: ctx.warnings.all }
}

function readNotes(zip: ZipArchive, path: string, element: string, reader: Reader, ctx: IngestContext): Map<string, string> {
  const map = new Map<string, string>()
  if (!zip.contains(path)) return map
  const root = readAuxiliaryPart(zip, path, ctx, PartName.notes, WORD_SKIPPED)
  if (!root) return map
  for (const n of root.childrenNamed(element)) {
    const type = n.attr('type') ?? 'normal'
    const id = n.attr('id')
    if (type !== 'normal' || id === null) continue
    const parts: string[] = []
    for (const p of n.childrenNamed('p')) {
      const t = reader.plainParagraph(p)
      if (t) parts.push(t)
    }
    if (parts.length) map.set(id, parts.join(' '))
  }
  return map
}

/** Entero de un atributo como `Int(…)` de Swift (`null` si no es un entero de 64 bits). */
function parseIntStrict(s: string | null | undefined): number | null {
  if (s === null || s === undefined || !/^[+-]?\d+$/.test(s)) return null
  const v = Number(s)
  if (!Number.isFinite(v) || Math.abs(v) > 9.223372036854776e18) return null
  return v
}

// MARK: Estilos

interface StyleInfo { name: string; basedOn: string | null; outline: number | null }

export class Styles {
  readonly map = new Map<string, StyleInfo>()

  constructor(root: XNode | null) {
    if (!root) return
    for (const s of root.childrenNamed('style')) {
      const id = s.attr('styleId')
      if (id === null) continue
      const name = s.child('name')?.attr('val') ?? id
      const outline = parseIntStrict(s.child('pPr')?.child('outlineLvl')?.attr('val'))
      this.map.set(id, { name, basedOn: s.child('basedOn')?.attr('val') ?? null, outline })
    }
  }

  /** Nivel de título (1…6) de un estilo, siguiendo la herencia. */
  headingLevel(styleID: string | null): number | null {
    let id = styleID
    let hops = 0
    while (id !== null && hops < 10) {
      const info = this.map.get(id)
      if (!info) return Styles.levelFromName(id)
      const lv = Styles.levelFromName(info.name)
      if (lv !== null) return lv
      if (info.outline !== null && info.outline >= 0 && info.outline < 9) return Math.min(info.outline + 1, 6)
      id = info.basedOn
      hops++
    }
    return null
  }

  static levelFromName(raw: string): number | null {
    const name = raw.toLowerCase().replace(/ /g, '')
    if (name === 'title' || name === 'título' || name === 'titulo' || name === 'ttulo') return 1
    if (name === 'subtitle' || name === 'subtítulo' || name === 'subtitulo') return 2
    for (const prefix of ['heading', 'título', 'titulo', 'ttulo', 'überschrift', 'titre', 'rubrik']) {
      if (!name.startsWith(prefix)) continue
      const digits = name.slice(prefix.length)
      if (digits.length === 1 && /^\d$/.test(digits) && Number(digits) >= 1) return Math.min(Number(digits), 6)
    }
    return null
  }

  isBulletStyle(styleID: string | null): boolean | null {
    if (styleID === null) return null
    const info = this.map.get(styleID)
    if (!info) return null
    const n = info.name.toLowerCase()
    if (n.startsWith('list bullet') || n.startsWith('lista con viñetas') || n.startsWith('listbullet')) return true
    if (n.startsWith('list number') || n.startsWith('lista numerada') || n.startsWith('listnumber')) return false
    return null
  }
}

// MARK: Numeración

interface Level { format: string; text: string; start: number }

export class Numbering {
  /** Valor de inicio máximo aceptado (un `w:start` hostil no desborda el contador). */
  static readonly maxStart = 999_999
  private readonly abstractLevels = new Map<string, Map<number, Level>>()
  private readonly numToAbstract = new Map<string, string>()
  private readonly overrides = new Map<string, Map<number, number>>()
  private readonly counters = new Map<string, Array<number | null>>()
  readonly isEmpty: boolean

  constructor(root: XNode | null) {
    if (!root) { this.isEmpty = true; return }
    for (const a of root.childrenNamed('abstractNum')) {
      const id = a.attr('abstractNumId')
      if (id === null) continue
      const levels = new Map<number, Level>()
      for (const l of a.childrenNamed('lvl')) {
        const ilvl = parseIntStrict(l.attr('ilvl') ?? '0')
        if (ilvl === null || ilvl < 0 || ilvl >= 9) continue
        levels.set(ilvl, {
          format: l.child('numFmt')?.attr('val') ?? 'decimal',
          text: l.child('lvlText')?.attr('val') ?? `%${ilvl + 1}.`,
          start: Numbering.clampStart(parseIntStrict(l.child('start')?.attr('val') ?? '1') ?? 1)
        })
      }
      this.abstractLevels.set(id, levels)
    }
    for (const n of root.childrenNamed('num')) {
      const id = n.attr('numId'), abs = n.child('abstractNumId')?.attr('val')
      if (id === null || abs === null || abs === undefined) continue
      this.numToAbstract.set(id, abs)
      for (const o of n.childrenNamed('lvlOverride')) {
        const il = parseIntStrict(o.attr('ilvl') ?? '')
        const v = parseIntStrict(o.child('startOverride')?.attr('val'))
        if (il !== null && il >= 0 && il < 9 && v !== null) {
          if (!this.overrides.has(id)) this.overrides.set(id, new Map())
          this.overrides.get(id)?.set(il, Numbering.clampStart(v))
        }
      }
    }
    this.isEmpty = this.abstractLevels.size === 0
  }

  static clampStart(value: number): number {
    return Math.min(Math.max(value, 0), Numbering.maxStart)
  }

  level(numID: string, ilvl: number): Level | null {
    const abs = this.numToAbstract.get(numID)
    if (abs === undefined) return null
    return this.abstractLevels.get(abs)?.get(ilvl) ?? null
  }

  private startValue(numID: string, ilvl: number): number {
    return this.overrides.get(numID)?.get(ilvl) ?? this.level(numID, ilvl)?.start ?? 1
  }

  /** Etiqueta del siguiente elemento de la lista ("1.", "a)", "•"…) y si es de viñetas. */
  next(numID: string, ilvl: number): { label: string; bullet: boolean } {
    const il = Math.min(Math.max(ilvl, 0), 8)
    const lv = this.level(numID, il)
    if (!lv) return { label: '-', bullet: true }
    if (lv.format === 'bullet' || lv.format === 'none') return { label: '-', bullet: true }
    const c = this.counters.get(numID) ?? new Array<number | null>(9).fill(null)
    const cur = c[il]
    c[il] = cur !== null ? cur + 1 : this.startValue(numID, il)
    for (let d = il + 1; d < 9; d++) c[d] = null
    this.counters.set(numID, c)
    // Sustituye %1…%9 por el contador de cada nivel con su formato
    let label = ''
    const chars = Array.from(lv.text)
    for (let i = 0; i < chars.length;) {
      const d = i + 1 < chars.length ? chars[i + 1] : ''
      if (chars[i] === '%' && /^[1-9]$/.test(d)) {
        const idx = Number(d) - 1
        const fmt = this.level(numID, idx)?.format ?? 'decimal'
        const value = c[idx] ?? this.startValue(numID, idx)
        label += Numbering.format(value, fmt)
        i += 2
      } else {
        label += chars[i]
        i++
      }
    }
    return { label: trimWS(label), bullet: false }
  }

  static format(n: number, fmt: string): string {
    switch (fmt) {
      case 'lowerLetter': return letters(n, false)
      case 'upperLetter': return letters(n, true)
      case 'lowerRoman': return roman(n).toLowerCase()
      case 'upperRoman': return roman(n)
      case 'decimalZero': return n < 10 ? `0${n}` : `${n}`
      default: return `${n}`
    }
  }
}

function letters(n: number, upper: boolean): string {
  let k = Math.max(n, 1) - 1
  let s = ''
  do {
    s = String.fromCharCode((upper ? 65 : 97) + (k % 26)) + s
    k = Math.floor(k / 26) - 1
  } while (k >= 0)
  return s
}

function roman(n: number): string {
  let k = Math.min(Math.max(n, 1), 3999)
  let out = ''
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  for (const [v, s] of table) while (k >= v) { out += s; k -= v }
  return out
}

// MARK: Lector

class PageBuilder {
  blocks: Block[] = []
  hasFigures = false
  firstHeading: string | null = null
  notes: Array<[number, string]> = []

  footnoteText(): string {
    if (this.notes.length === 0) return ''
    return '\n\n' + Markers.footnotes + '\n' + this.notes.map(([n, t]) => `[${n}] ${t}`).join('\n')
  }
}

/** Piezas de un párrafo: segmentos separados por saltos de página, figuras, cuadros de texto y llamadas a notas. */
class Pieces {
  segments: ScriptedText[] = [new ScriptedText()]
  figure = false
  figureAlt: string[] = []
  extra: string[] = []
  noteRefs: Array<[number, string]> = []

  private get current(): ScriptedText { return this.segments[this.segments.length - 1] }
  add(s: string): void { this.current.add(s) }
  addScripted(text: string, position: ScriptPosition): void { this.current.addScripted(text, position) }
  breakPage(): void { this.current.flush(); this.segments.push(new ScriptedText()) }
  finish(): void { this.current.flush() }
  texts(): string[] { return this.segments.map((s) => s.out) }
}

class Reader {
  footnotes = new Map<string, string>()
  endnotes = new Map<string, string>()
  pages: PageBuilder[] = [new PageBuilder()]
  titleCandidate: string | null = null
  private noteCounter = 0
  private nodeBudget = 6_000_000
  private tableCounter = 0
  /** Se están leyendo los cuadros de texto de un dibujo: los dibujos de dentro no vuelven a recorrer los suyos. */
  private readingTextBoxes = false

  constructor(readonly styles: Styles, readonly numbering: Numbering, readonly links: Map<string, string>, readonly usePageBreaks: boolean, readonly ctx: IngestContext) {}

  get current(): PageBuilder { return this.pages[this.pages.length - 1] }

  newPage(): void {
    if (this.pages.length < 20_000 && !(this.current.blocks.length === 0 && this.current.notes.length === 0)) this.pages.push(new PageBuilder())
  }

  /** Contenedores: cuerpo, celdas, controles de contenido, cuadros de texto. */
  readContainer(node: XNode): void {
    for (const c of node.children) {
      this.nodeBudget--
      if (this.nodeBudget < 0) { this.ctx.warnings.add(L('El documento es muy grande; se leyó solo una parte.')); return }
      switch (c.name) {
        case 'p': this.paragraph(c); break
        case 'tbl': this.table(c); break
        case 'sdt': { const content = c.child('sdtContent'); if (content) this.readContainer(content); break }
        case 'sdtContent': case 'customXml': case 'ins': case 'moveTo': case 'smartTag': this.readContainer(c); break
        case 'AlternateContent': { const choice = c.child('Choice') ?? c.child('Fallback'); if (choice) this.readContainer(choice); break }
        default: break
      }
    }
  }

  /** Texto de un párrafo sin estructura (celdas y notas). */
  plainParagraph(p: XNode): string {
    const pieces = new Pieces()
    this.runs(p, pieces, false)
    pieces.finish()
    return tidy(pieces.texts().join(' '))
  }

  private paragraph(p: XNode): void {
    const pPr = p.child('pPr')
    const styleID = pPr?.child('pStyle')?.attr('val') ?? null
    const pieces = new Pieces()
    const pbb = pPr?.child('pageBreakBefore')
    if (this.usePageBreaks && pbb && (pbb.attr('val') ?? '1') !== '0') pieces.breakPage()
    this.runs(p, pieces, true)
    pieces.finish()

    let level = this.styles.headingLevel(styleID)
    // Nivel de esquema propio: 0…8 son títulos y 9 es «texto independiente»; lo demás se ignora
    const o = parseIntStrict(pPr?.child('outlineLvl')?.attr('val'))
    if (o !== null) {
      if (o >= 0 && o < 9) level = Math.min(o + 1, 6)
      else if (o === 9) level = null
    }
    let listPrefix: string | null = null
    let isBullet = false
    const numPr = pPr?.child('numPr')
    const numID = numPr?.child('numId')?.attr('val')
    if (numID !== null && numID !== undefined && numID !== '0') {
      const ilvl = Math.min(Math.max(parseIntStrict(numPr?.child('ilvl')?.attr('val') ?? '0') ?? 0, 0), 8)
      if (this.numbering.isEmpty) {
        listPrefix = '  '.repeat(ilvl) + '-'
        isBullet = true
      } else {
        const r = this.numbering.next(numID, ilvl)
        listPrefix = (level === null ? '  '.repeat(ilvl) : '') + r.label
        isBullet = r.bullet
      }
    } else {
      const bulletStyle = this.styles.isBulletStyle(styleID)
      if (bulletStyle !== null && level === null) {
        listPrefix = bulletStyle ? '-' : '1.'
        isBullet = bulletStyle
      }
    }

    let first = true
    pieces.texts().forEach((seg, i) => {
      if (i > 0) this.newPage()
      const text = tidy(seg)
      if (!text) return
      if (first) {
        first = false
        if (level !== null) {
          const label = listPrefix !== null ? (isBullet ? '' : listPrefix + ' ') : ''
          this.addBlock({ kind: 'heading', text: '#'.repeat(level) + ' ' + label + text })
          if (this.current.firstHeading === null) this.current.firstHeading = label + text
          if (this.titleCandidate === null && level === 1) this.titleCandidate = charCount(text) <= 150 ? text : null
        } else if (listPrefix !== null) {
          this.addBlock({ kind: 'listItem', text: listPrefix + ' ' + text })
        } else {
          this.addBlock({ kind: 'paragraph', text })
          if (this.titleCandidate === null && this.pages.length === 1 && this.current.blocks.length === 1 && charCount(text) <= 120) this.titleCandidate = text
        }
      } else {
        this.addBlock({ kind: 'paragraph', text })
      }
    })
    if (pieces.figure) {
      this.current.hasFigures = true
      for (const alt of pieces.figureAlt) this.addBlock({ kind: 'note', text: Markers.figure(alt) })
    }
    for (const n of pieces.noteRefs) this.current.notes.push(n)
    for (const extra of pieces.extra) this.addBlock({ kind: 'paragraph', text: extra })
  }

  private addBlock(b: Block): void {
    this.current.blocks.push(b)
  }

  /** Contenido en línea de un párrafo (o de un hipervínculo). */
  private runs(node: XNode, pieces: Pieces, allowBreaks: boolean): void {
    for (const c of node.children) {
      switch (c.name) {
        case 'r': this.run(c, pieces, allowBreaks); break
        case 'hyperlink': {
          const inner = new Pieces()
          this.runs(c, inner, false)
          inner.finish()
          const text = inner.texts().join('')
          let out = text
          const rid = c.relationshipID
          const url = rid !== null ? this.links.get(rid) : undefined
          if (url !== undefined) {
            const shown = url.startsWith('mailto:') ? url.slice(7) : url
            const plain = trimWSNL(text)
            const bare = (s: string): string => trimSlashes(s.replace(/https:\/\//g, '').replace(/http:\/\//g, '')).toLowerCase()
            const same = bare(plain) === bare(shown)
            if (!plain) out = shown
            else if (!same && (url.startsWith('http') || url.startsWith('mailto:'))) out = text + ' (' + shown + ')'
          }
          pieces.add(out)
          pieces.figure = pieces.figure || inner.figure
          pieces.extra.push(...inner.extra)
          break
        }
        case 'fldSimple': case 'ins': case 'moveTo': case 'smartTag': case 'customXml': case 'bdo': case 'dir': case 'sdtContent':
          this.runs(c, pieces, allowBreaks)
          break
        case 'sdt': { const content = c.child('sdtContent'); if (content) this.runs(content, pieces, allowBreaks); break }
        case 'oMath': case 'oMathPara': { const m = ommlText(c); if (m) pieces.add(' ' + m + ' '); break }
        case 'AlternateContent': { const choice = c.child('Choice') ?? c.child('Fallback'); if (choice) this.runs(choice, pieces, allowBreaks); break }
        default: break
      }
    }
  }

  private run(r: XNode, pieces: Pieces, allowBreaks: boolean): void {
    const script = wordScript(r.child('rPr')?.child('vertAlign')?.attr('val') ?? null)
    for (const c of r.children) {
      switch (c.name) {
        case 't': pieces.addScripted(c.text, script); break
        case 'tab': case 'ptab': pieces.add('\t'); break
        case 'br': {
          const type = c.attr('type')
          if (type === 'page') { if (this.usePageBreaks && allowBreaks) pieces.breakPage() }
          else if (type === 'column') pieces.add('\t')
          else pieces.add('\n')
          break
        }
        case 'cr': pieces.add('\n'); break
        case 'noBreakHyphen': pieces.add('-'); break
        case 'lastRenderedPageBreak': if (!this.usePageBreaks && allowBreaks) pieces.breakPage(); break
        case 'footnoteReference': case 'endnoteReference': {
          const id = c.attr('id')
          const text = id !== null ? (c.name === 'footnoteReference' ? this.footnotes : this.endnotes).get(id) : undefined
          if (text !== undefined) {
            this.noteCounter++
            pieces.add(`[${this.noteCounter}]`)
            pieces.noteRefs.push([this.noteCounter, text])
          }
          break
        }
        case 'drawing': case 'pict': case 'object': {
          pieces.figure = true
          const alt = trimWSNL(c.firstDescendant('docPr')?.attr('descr') ?? '')
          if (charCount(alt) >= 8) pieces.figureAlt.push(alt.replace(/\n/g, ' '))
          // Cuadros de texto: `descendants` ya trae también los anidados; dentro de uno no se vuelve a entrar
          if (this.readingTextBoxes) break
          this.readingTextBoxes = true
          try {
            for (const box of c.descendants('txbxContent')) {
              const parts: string[] = []
              for (const p of box.childrenNamed('p')) { const t = this.plainParagraph(p); if (t) parts.push(t) }
              if (parts.length) pieces.extra.push(parts.join('\n'))
            }
          } finally {
            this.readingTextBoxes = false
          }
          break
        }
        case 'AlternateContent': {
          const choice = c.child('Choice') ?? c.child('Fallback')
          if (choice) {
            const tmp = new XNode('r')
            tmp.children = choice.children
            this.run(tmp, pieces, allowBreaks)
          }
          break
        }
        default: break
      }
    }
  }

  // MARK: Tablas

  private table(t: XNode): void {
    this.tableCounter++
    for (const cells of this.tableCells(t)) this.addBlock({ kind: 'tableRow', text: cells.join(' | '), group: this.tableCounter })
    if (t.firstDescendant('drawing')) this.current.hasFigures = true
  }

  /** Filas como listas de celdas (sin las celdas vacías del final); las filas vacías se omiten. */
  private tableCells(t: XNode): string[][] {
    const rows: string[][] = []
    for (const tr of t.childrenNamed('tr')) {
      const cells: string[] = []
      for (const tc of tr.childrenNamed('tc')) {
        const parts: string[] = []
        for (const c of tc.children) {
          if (c.name === 'p') {
            const s = this.plainParagraph(c)
            if (s) parts.push(s.replace(/\|/g, '¦'))
          } else if (c.name === 'tbl') {
            // Una tabla dentro de una celda se aplana: celdas y filas separadas por "; "
            const nested = this.tableCells(c).flat().filter((x) => x.length > 0)
            if (nested.length) parts.push(nested.join('; '))
          }
        }
        cells.push(parts.join(' '))
        const span = parseIntStrict(tc.child('tcPr')?.child('gridSpan')?.attr('val') ?? '')
        if (span !== null && span > 1 && span < 40) for (let k = 1; k < span; k++) cells.push('')
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop()
      if (cells.length === 0 || cells.every((c) => c === '')) continue
      rows.push(cells)
    }
    return rows
  }
}

function trimSlashes(s: string): string {
  let a = 0, b = s.length
  while (a < b && s[a] === '/') a++
  while (b > a && s[b - 1] === '/') b--
  return s.slice(a, b)
}
