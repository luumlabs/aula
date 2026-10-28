// PowerPoint (.pptx): una «página» por diapositiva en el orden de la presentación: título, viñetas por nivel, tablas,
// ecuaciones, superíndices/subíndices y notas del orador. Ignora números de diapositiva, fechas y pies.
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, type IngestContext } from '../core/progress'
import type { XNode } from '../core/miniXml'
import type { ZipArchive } from '../core/zipArchive'
import { corrupt, IngestError } from '../errors'
import { L } from '../messages'
import { charCount, trimWSNL } from '../text/unicode'
import { Markers } from './markers'
import { ommlText } from './mathLinearizer'
import {
  coreProperties, drawingScript, mainPart, openPackage, PartName, readAuxiliaryPart, readXmlPart, relationships, renderBlocks,
  ScriptedText, SLIDE_SKIPPED, tidy, usableTitle, type Block
} from './ooxml'

export async function extractPPTX(path: string, ctx: IngestContext): Promise<SourceDocument> {
  return extractPPTXFromZip(openPackage(path, ctx.options), ctx)
}

function numericSuffix(path: string): number {
  const digits = path.replace(/\D/g, '')
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER
}

export function extractPPTXFromZip(zip: ZipArchive, ctx: IngestContext): SourceDocument {
  ctx.progress.report(0.03, L('Abriendo la presentación…'), true)
  const mainPath = mainPart(zip, '/officeDocument', 'ppt/presentation.xml')

  // Orden de diapositivas según presentation.xml (si está dañada, aviso y orden de los archivos)
  let slidePaths: string[] = []
  const pres = zip.contains(mainPath) ? readAuxiliaryPart(zip, mainPath, ctx, PartName.presentation) : null
  if (pres) {
    const byID = new Map<string, string>()
    for (const r of relationships(mainPath, zip)) if (!r.isExternal && !byID.has(r.id)) byID.set(r.id, r.target)
    const seen = new Set<string>()
    for (const id of pres.child('sldIdLst')?.childrenNamed('sldId') ?? []) {
      // Una diapositiva listada dos veces (archivo manipulado) se lee una sola vez
      const rid = id.relationshipID
      const path = rid !== null ? byID.get(rid) : undefined
      if (path !== undefined && zip.contains(path) && !seen.has(path)) { seen.add(path); slidePaths.push(path) }
    }
  }
  if (slidePaths.length === 0) {
    slidePaths = zip.fileNames.filter((n) => n.startsWith('ppt/slides/slide') && n.endsWith('.xml')).sort((a, b) => numericSuffix(a) - numericSuffix(b))
    if (slidePaths.length) ctx.warnings.add(L('No se pudo leer el orden de las diapositivas; se usó el orden de los archivos.'))
  }
  if (slidePaths.length === 0) throw corrupt(L('la presentación no tiene diapositivas'))
  const totalSlides = slidePaths.length
  if (slidePaths.length > ctx.options.maxPages) {
    ctx.warnings.add(L('La presentación tiene %lld diapositivas; solo se leyeron las primeras %lld.', slidePaths.length, ctx.options.maxPages))
    slidePaths = slidePaths.slice(0, ctx.options.maxPages)
  }

  const pages: SourcePage[] = []
  let firstTitle: string | null = null
  const seenNotes = new Set<string>()
  slidePaths.forEach((path, i) => {
    checkContext(ctx)
    ctx.progress.report(0.05 + (0.93 * i) / slidePaths.length, L('Leyendo diapositiva %@ de %@…', String(i + 1), String(slidePaths.length)))
    const slide = readSlide(zip, path, i + 1, seenNotes, ctx)
    if (firstTitle === null && slide.title !== null) firstTitle = slide.title
    pages.push({ number: i + 1, text: slide.text, usedOCR: false, heading: slide.title ?? undefined, hasFigures: slide.hasFigures })
  })
  if (pages.every((p) => !p.text)) ctx.warnings.add(L('La presentación no contiene texto (¿solo imágenes?).'))

  const meta = coreProperties(zip)
  meta.slideCount = String(Math.min(totalSlides, slidePaths.length))
  meta.pageCount = String(slidePaths.length)
  const title = usableTitle(meta.title) ?? firstTitle ?? ctx.fallbackTitle
  meta.title = title
  return { title, kind: 'pptx', pages, metadata: meta, warnings: ctx.warnings.all }
}

interface Slide { title: string | null; text: string; hasFigures: boolean }

/** Lee una diapositiva. Un fallo deja una advertencia y una página vacía; solo una entrada cifrada detiene la lectura. */
function readSlide(zip: ZipArchive, path: string, number: number, seenNotes: Set<string>, ctx: IngestContext): Slide {
  const empty: Slide = { title: null, text: '', hasFigures: false }
  let root: XNode | null
  try {
    root = readXmlPart(zip, path, ctx, { label: PartName.slide(number), skipping: SLIDE_SKIPPED })
  } catch (e) {
    if (e instanceof IngestError) {
      if (e.kind === 'passwordProtected') throw e
      ctx.warnings.add(L('No se pudo leer la diapositiva %@: %@', String(number), e.message))
      return empty
    }
    throw e
  }
  const tree = root?.child('cSld')?.child('spTree')
  if (!tree) return empty
  const builder = new SlideBuilder(false)
  builder.walk(tree)

  const blocks: Block[] = []
  if (builder.title !== null) blocks.push({ kind: 'heading', text: '# ' + builder.title })
  blocks.push(...builder.blocks)

  if (ctx.options.includeSpeakerNotes) {
    const notesRel = relationships(path, zip).find((r) => r.type.endsWith('/notesSlide') && !r.isExternal)
    if (notesRel && !seenNotes.has(notesRel.target)) {
      seenNotes.add(notesRel.target)
      const notesRoot = readAuxiliaryPart(zip, notesRel.target, ctx, PartName.notes, SLIDE_SKIPPED)
      const notesTree = notesRoot?.child('cSld')?.child('spTree')
      if (notesTree) {
        const nb = new SlideBuilder(true)
        nb.walk(notesTree)
        const notes = nb.blocks.map((b) => b.text).filter((t) => t.length > 0).join('\n')
        if (notes) blocks.push({ kind: 'note', text: Markers.speakerNotes + '\n' + notes })
      }
    }
  }
  return { title: builder.title, text: renderBlocks(blocks), hasFigures: builder.hasFigures }
}

class SlideBuilder {
  title: string | null = null
  blocks: Block[] = []
  hasFigures = false
  private tableCounter = 0

  constructor(readonly notesMode: boolean) {}

  walk(parent: XNode): void {
    for (const c of parent.children) {
      switch (c.name) {
        case 'sp': this.shape(c); break
        case 'graphicFrame': this.frame(c); break
        case 'grpSp': this.walk(c); break
        case 'pic': {
          this.hasFigures = true
          const alt = trimWSNL(c.firstDescendant('cNvPr')?.attr('descr') ?? '')
          if (charCount(alt) >= 8) this.blocks.push({ kind: 'note', text: Markers.figure(alt.replace(/\n/g, ' ')) })
          break
        }
        case 'AlternateContent': { const choice = c.child('Choice') ?? c.child('Fallback'); if (choice) this.walk(choice); break }
        default: break
      }
    }
  }

  private shape(sp: XNode): void {
    const ph = sp.child('nvSpPr')?.child('nvPr')?.child('ph') ?? null
    const phType = ph?.attr('type') ?? null
    if (phType !== null && ['sldNum', 'dt', 'ftr', 'hdr', 'sldImg'].includes(phType)) return
    const body = sp.child('txBody')
    if (!body) return
    if (this.notesMode && phType !== null && phType !== 'body') return
    const isTitle = phType === 'title' || phType === 'ctrTitle'
    const isContentPlaceholder = ph !== null && (phType === null || phType === 'body' || phType === 'obj')

    const titleParts: string[] = []
    for (const p of body.childrenNamed('p')) {
      const text = this.paragraph(p)
      if (!text) continue
      if (isTitle && this.title === null) { titleParts.push(text.replace(/\n/g, ' ')); continue }
      // Nivel de sangría válido: 0…8 (lo que se salga cuenta como nivel 0)
      const pPr = p.child('pPr')
      const rawLevel = parseLevel(pPr?.attr('lvl') ?? '0')
      const level = rawLevel >= 0 && rawLevel <= 8 ? rawLevel : 0
      const hasBullet = pPr?.child('buChar') != null || pPr?.child('buAutoNum') != null || pPr?.child('buBlip') != null
      const noBullet = pPr?.child('buNone') != null
      if (!noBullet && (hasBullet || (isContentPlaceholder && !this.notesMode))) {
        const indent = '  '.repeat(Math.min(level, 6))
        const marker = pPr?.child('buAutoNum') != null ? '1.' : '-'
        this.blocks.push({ kind: 'listItem', text: indent + marker + ' ' + text.replace(/\n/g, ' ') })
      } else {
        this.blocks.push({ kind: 'paragraph', text })
      }
    }
    if (titleParts.length) this.title = titleParts.join(' ')
    if (phType === 'pic') this.hasFigures = true
  }

  private paragraph(p: XNode): string {
    const acc = new ScriptedText()
    const visit = (n: XNode): void => {
      for (const c of n.children) {
        switch (c.name) {
          case 'r': { const t = c.child('t'); if (t) acc.addScripted(t.text, drawingScript(c.child('rPr')?.attr('baseline') ?? null)); break }
          case 'br': acc.add('\n'); break
          case 'fld': {
            const type = (c.attr('type') ?? '').toLowerCase()
            if (type.startsWith('slidenum') || type.startsWith('datetime')) break
            const t = c.child('t')
            if (t) acc.addScripted(t.text, 'normal')
            break
          }
          case 'm': case 'oMathPara': case 'oMath': {
            const m = c.child('oMathPara') ?? c.child('oMath') ?? (c.name.startsWith('oMath') ? c : null)
            if (m) { const t = ommlText(m); if (t) acc.add(' ' + t + ' ') }
            break
          }
          case 'AlternateContent': { const choice = c.child('Choice') ?? c.child('Fallback'); if (choice) visit(choice); break }
          default: break
        }
      }
    }
    visit(p)
    acc.flush()
    return tidy(acc.out)
  }

  /** Tablas, gráficos y otros objetos. */
  private frame(gf: XNode): void {
    const data = gf.child('graphic')?.child('graphicData')
    if (!data) return
    const tbl = data.child('tbl')
    if (!tbl) { this.hasFigures = true; return }
    this.tableCounter++
    for (const tr of tbl.childrenNamed('tr')) {
      const cells: string[] = []
      for (const tc of tr.childrenNamed('tc')) {
        const parts: string[] = []
        for (const p of tc.child('txBody')?.childrenNamed('p') ?? []) {
          const t = this.paragraph(p).replace(/\n/g, ' ')
          if (t) parts.push(t)
        }
        cells.push(parts.join(' ').replace(/\|/g, '¦'))
        const span = parseLevel(tc.attr('gridSpan') ?? '')
        if (span > 1 && span < 40) for (let k = 1; k < span; k++) cells.push('')
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop()
      if (cells.length === 0 || cells.every((c) => c === '')) continue
      this.blocks.push({ kind: 'tableRow', text: cells.join(' | '), group: this.tableCounter })
    }
  }
}

/** `Int(…)` de Swift para niveles (enteros de 64 bits; lo demás cuenta como 0). */
function parseLevel(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) return 0
  const v = Number(s)
  return Math.abs(v) > 9.2e18 ? 0 : v
}
