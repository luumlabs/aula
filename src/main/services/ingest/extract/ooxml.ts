// Utilidades comunes a DOCX, PPTX, XLSX y EPUB (paquetes ZIP con partes XML): rutas y relaciones OPC, lectura de partes
// con avisos, propiedades del documento, títulos basura y el montaje de bloques en texto.
import type { IngestContext } from '../core/progress'
import { parseXml, type XNode } from '../core/miniXml'
import { ZipArchive, zipLimits } from '../core/zipArchive'
import { corrupt, IngestError } from '../errors'
import { L } from '../messages'
import { charCount, isNumber, trimWS, trimWSNL } from '../text/unicode'
import type { IngestOptions } from '../options'

// MARK: OPC

export interface Relationship {
  id: string
  type: string
  /** Ruta ya resuelta dentro del paquete (internos) o la URL (externos). */
  target: string
  isExternal: boolean
}

/** Resuelve un destino relativo ("../media/a.png") respecto a la ruta de una parte ("ppt/slides/slide1.xml"). */
export function resolvePart(target: string, relativeTo: string): string {
  let t = target
  try {
    t = decodeURIComponent(t)
  } catch {
    /* se deja tal cual */
  }
  t = t.replace(/\\/g, '/')
  const hash = t.indexOf('#')
  if (hash >= 0) t = t.slice(0, hash)
  const parts: string[] = t.startsWith('/') ? [] : relativeTo.split('/').filter((x) => x.length > 0).slice(0, -1)
  for (const seg of t.split('/').filter((x) => x.length > 0)) {
    if (seg === '.') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  return parts.join('/')
}

/** "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels". */
export function relsPath(part: string): string {
  const slash = part.lastIndexOf('/')
  if (slash < 0) return `_rels/${part}.rels`
  return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`
}

/** Relaciones de una parte (vacío si no tiene o está dañada). */
export function relationships(part: string, zip: ZipArchive): Relationship[] {
  let data: Uint8Array | null
  try {
    data = zip.read(relsPath(part), 8 * 1024 * 1024)
  } catch {
    return []
  }
  const root = data ? parseXml(data).root : null
  if (!root) return []
  const out: Relationship[] = []
  for (const r of root.childrenNamed('Relationship')) {
    const id = r.attr('Id'), target = r.attr('Target')
    if (id === null || target === null) continue
    const external = (r.attr('TargetMode') ?? '').toLowerCase() === 'external'
    out.push({ id, type: r.attr('Type') ?? '', target: external ? target : resolvePart(target, part), isExternal: external })
  }
  return out
}

// MARK: Apertura y partes

export function openPackage(path: string, options: IngestOptions): ZipArchive {
  const limits = zipLimits(options.maxArchiveEntries, options.maxArchiveBytes)
  return ZipArchive.open(path, limits)
}

/** Tamaño máximo de una parte XML que se lee en memoria. */
export const MAX_PART_BYTES = 64 * 1024 * 1024

/** Elementos de Word que ningún extractor lee (se descartan al analizar). `rPr` sí se lee: de ahí sale el superíndice. */
export const WORD_SKIPPED: ReadonlySet<string> = new Set(['sectPr', 'tblPr', 'tblGrid', 'trPr', 'proofErr', 'bookmarkStart', 'bookmarkEnd',
  'commentRangeStart', 'commentRangeEnd', 'permStart', 'permEnd', 'del', 'moveFrom', 'spPr', 'blipFill', 'bodyPr', 'extLst'])
/** Lo mismo para PowerPoint. `a:rPr` se conserva para leer `baseline`. */
export const SLIDE_SKIPPED: ReadonlySet<string> = new Set(['endParaRPr', 'defRPr', 'spPr', 'grpSpPr', 'bodyPr', 'lstStyle', 'style', 'blipFill', 'extLst'])

export interface PartOptions {
  label?: string
  required?: boolean
  skipping?: ReadonlySet<string>
}

/** Lee y analiza una parte XML. Si está dañada devuelve lo que se pudo leer y deja un aviso. */
export function readXmlPart(zip: ZipArchive, part: string, ctx: IngestContext, opts: PartOptions = {}): XNode | null {
  const data = zip.read(part, MAX_PART_BYTES)
  if (!data) {
    if (opts.required) throw corrupt(L('falta la parte «%@»', part))
    return null
  }
  return parsePart(data, part, ctx, opts)
}

/** Lee una parte auxiliar (estilos, numeración, notas…): si no se puede leer, aviso y `null`. Solo el cifrado detiene. */
export function readAuxiliaryPart(zip: ZipArchive, part: string, ctx: IngestContext, label: string, skipping?: ReadonlySet<string>): XNode | null {
  try {
    return readXmlPart(zip, part, ctx, { label, skipping })
  } catch (e) {
    if (e instanceof IngestError) {
      if (e.kind === 'passwordProtected') throw e
      ctx.warnings.add(L('No se pudo leer «%@»: %@', label, e.message))
      return null
    }
    throw e
  }
}

/** Analiza el contenido ya leído de una parte XML. */
export function parsePart(data: Uint8Array, part: string, ctx: IngestContext, opts: PartOptions = {}): XNode | null {
  const result = parseXml(data, { skipping: opts.skipping })
  if (result.error) {
    const name = opts.label ?? part
    if (!result.root) {
      if (opts.required) throw corrupt(L('la parte «%@» está dañada (%@)', name, result.error))
      ctx.warnings.add(L('No se pudo leer «%@»: %@', name, result.error))
      return null
    }
    ctx.warnings.add(L('Una parte del archivo (%@) está incompleta o dañada; se leyó solo lo que se pudo (%@).', name, result.error))
  }
  return result.root
}

/** Nombres de las partes con los que se citan en los avisos. */
export const PartName = {
  get document(): string { return L('el documento') },
  get styles(): string { return L('los estilos') },
  get numbering(): string { return L('la numeración') },
  get notes(): string { return L('las notas') },
  get presentation(): string { return L('la presentación') },
  slide: (n: number): string => L('la diapositiva %@', String(n)),
  get workbook(): string { return L('el libro') },
  get container(): string { return L('el contenedor') },
  get bookIndex(): string { return L('el índice del libro') }
}

/** Ruta de la parte principal según `_rels/.rels`, con una por defecto. */
export function mainPart(zip: ZipArchive, typeSuffix: string, fallback: string): string {
  try {
    const data = zip.read('_rels/.rels', 1024 * 1024)
    const root = data ? parseXml(data).root : null
    if (root) {
      for (const r of root.childrenNamed('Relationship')) {
        const type = r.attr('Type'), target = r.attr('Target')
        if (type !== null && type.endsWith(typeSuffix) && target !== null) {
          const path = resolvePart(target, '')
          if (zip.contains(path)) return path
        }
      }
    }
  } catch {
    /* sin relaciones: la ruta por defecto */
  }
  return fallback
}

/** `docProps/core.xml` → metadatos. */
export function coreProperties(zip: ZipArchive): Record<string, string> {
  const path = mainPart(zip, '/core-properties', 'docProps/core.xml')
  let root: XNode | null = null
  try {
    const data = zip.read(path, 1024 * 1024)
    root = data ? parseXml(data).root : null
  } catch {
    root = null
  }
  const meta: Record<string, string> = {}
  if (!root) return meta
  const take = (element: string, key: string): void => {
    const t = trimWSNL(root?.child(element)?.text ?? '')
    if (t) meta[key] = t
  }
  take('title', 'title')
  take('creator', 'author')
  take('subject', 'subject')
  take('keywords', 'keywords')
  take('description', 'description')
  take('language', 'language')
  take('created', 'created')
  take('modified', 'modified')
  take('lastModifiedBy', 'lastModifiedBy')
  return meta
}

const JUNK_TITLES = ['untitled', 'sin título', 'sin titulo', 'documento', 'document', 'presentación', 'presentacion', 'presentation', 'powerpoint presentation',
  'presentación de powerpoint', 'microsoft word', 'microsoft powerpoint', 'microsoft excel', 'libro1', 'book1', 'hoja1', 'sheet1', 'diapositiva 1', 'slide 1']

/** Descarta títulos basura ("Documento1", "Presentación de PowerPoint", "Untitled"…). */
export function usableTitle(raw: string | null | undefined): string | null {
  const t = trimWSNL(raw ?? '')
  if (!t) return null
  const lower = t.toLowerCase()
  for (const j of JUNK_TITLES) {
    if (lower === j) return null
    if (lower.startsWith(j) && Array.from(lower.slice(j.length)).every((c) => isNumber(c) || c === ' ' || c === '-' || c === '_')) return null
  }
  if (lower.startsWith('microsoft word - ') || lower.startsWith('microsoft powerpoint - ') || lower.startsWith('microsoft excel - ')) {
    const dash = t.indexOf('-')
    const rest = dash >= 0 ? trimWS(t.slice(dash + 1)) : t
    // Sin la extensión, como `deletingPathExtension`
    const base = rest.replace(/\.[A-Za-z0-9]{1,8}$/, '')
    return usableTitle(base)
  }
  return t
}

// MARK: Superíndices y subíndices

export type ScriptPosition = 'normal' | 'superscript' | 'subscript'

/** `w:vertAlign/@w:val` de Word. */
export function wordScript(value: string | null): ScriptPosition {
  switch ((value ?? '').toLowerCase()) {
    case 'superscript': return 'superscript'
    case 'subscript': return 'subscript'
    default: return 'normal'
  }
}

/** `a:rPr/@baseline` de DrawingML: positivo = superíndice, negativo = subíndice. */
export function drawingScript(value: string | null): ScriptPosition {
  const n = value !== null && /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isFinite(n) || n === 0) return 'normal'
  return n > 0 ? 'superscript' : 'subscript'
}

/** Marca un texto volado: `x^2`, `y_1`, `^{12}`, `_{ij}`. */
export function scripted(text: string, position: ScriptPosition): string {
  if (position === 'normal' || !text) return text
  const mark = position === 'superscript' ? '^' : '_'
  return charCount(text) === 1 ? mark + text : `${mark}{${text}}`
}

/** Acumula texto de runs; los contiguos con la misma posición volada se agrupan en una sola marca («HF_{(aq)}»). */
export class ScriptedText {
  out = ''
  private pending: { position: ScriptPosition; text: string } | null = null

  add(s: string): void {
    this.flush()
    this.out += s
  }

  /** Texto de un run que puede ser superíndice o subíndice. Un run de solo espacios no deja marca. */
  addScripted(text: string, position: ScriptPosition): void {
    if (!text) return
    if (position === 'normal' || trimWS(text).length === 0) { this.add(text); return }
    if (this.pending && this.pending.position === position) this.pending.text += text
    else { this.flush(); this.pending = { position, text } }
  }

  flush(): void {
    const p = this.pending
    if (!p) return
    this.pending = null
    const core = trimWS(p.text)
    if (!core) { this.out += p.text; return }
    // Los espacios de los extremos se quedan fuera de la marca (10^4 lb, no 10^4lb)
    const leading = /^\s*/u.exec(p.text)?.[0] ?? ''
    const trailing = /\s*$/u.exec(p.text)?.[0] ?? ''
    this.out += leading + scripted(core, p.position) + trailing
  }
}

// MARK: Bloques

export type BlockKind = 'heading' | 'paragraph' | 'listItem' | 'tableRow' | 'note'

export interface Block {
  kind: BlockKind
  text: string
  /** Tabla a la que pertenece una fila (0 si no es de tabla): dos tablas seguidas no se funden. */
  group?: number
}

/** Une bloques: las listas y filas de tabla seguidas van en líneas consecutivas; lo demás, con una línea en blanco. */
export function renderBlocks(blocks: Block[]): string {
  let out = ''
  let prev: Block | null = null
  for (const b of blocks) {
    if (!b.text) continue
    if (prev) {
      const tight = (prev.kind === 'listItem' && b.kind === 'listItem') || (prev.kind === 'tableRow' && b.kind === 'tableRow' && (prev.group ?? 0) === (b.group ?? 0))
      out += tight ? '\n' : '\n\n'
    }
    out += b.text
    prev = b
  }
  return out
}

/** Normaliza una línea: tabuladores y espacios repetidos a uno, sin espacios en los extremos ni invisibles. */
export function tidy(s: string): string {
  let out = ''
  let last = ''                        // último carácter (`endsWith` sobre una cadena hecha con `+=` es cuadrático en V8)
  let space = false
  for (const ch of s) {
    const v = ch.codePointAt(0) ?? 0
    if (v === 9 || v === 32 || v === 0xa0) { space = true; continue }
    if (v === 0x200b || v === 0xfeff || v === 0xad) continue
    if (space && out.length > 0 && last !== '\n') out += ' '
    space = false
    out += ch
    last = ch
  }
  if (out.includes('\n')) out = out.split('\n').map((l) => trimWS(l)).join('\n')
  return trimWSNL(out)
}
