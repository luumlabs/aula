// Excel (.xlsx): una «página» por hoja visible con las primeras 200 filas × 30 columnas como filas `a | b | c`.
// Lee en streaming (SAX) y se detiene al llegar al límite: las hojas enormes no cuestan memoria.
import type { SourceDocument, SourcePage } from '@shared/ingest'
import { checkContext, type IngestContext } from '../core/progress'
import { declaresEntities, saxParse, xmlText, type XNode } from '../core/miniXml'
import type { ZipArchive } from '../core/zipArchive'
import { corrupt, IngestError } from '../errors'
import { L } from '../messages'
import { trimWS, trimWSNL } from '../text/unicode'
import { Markers } from './markers'
import { coreProperties, mainPart, openPackage, PartName, readXmlPart, relationships, usableTitle } from './ooxml'

export const MAX_ROWS = 200
export const MAX_COLS = 30
const MAX_SHEET_BYTES = 32 * 1024 * 1024

export async function extractXLSX(path: string, ctx: IngestContext): Promise<SourceDocument> {
  return extractXLSXFromZip(openPackage(path, ctx.options), ctx)
}

function numericSuffix(path: string): number {
  const digits = path.replace(/\D/g, '')
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER
}

export function extractXLSXFromZip(zip: ZipArchive, ctx: IngestContext): SourceDocument {
  ctx.progress.report(0.03, L('Abriendo la hoja de cálculo…'), true)
  const mainPath = mainPart(zip, '/officeDocument', 'xl/workbook.xml')
  const workbook = zip.contains(mainPath) ? readXmlPart(zip, mainPath, ctx, { label: PartName.workbook }) : null
  const sheetFiles = zip.fileNames.filter((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml')).sort((a, b) => numericSuffix(a) - numericSuffix(b))
  if (!workbook && sheetFiles.length === 0) throw corrupt(L('no es una hoja de cálculo de Excel válida (falta «xl/workbook.xml»)'))
  const rels = relationships(mainPath, zip)
  const byID = new Map<string, string>()
  for (const r of rels) if (!r.isExternal && !byID.has(r.id)) byID.set(r.id, r.target)
  const date1904 = ['1', 'true'].includes(workbook?.child('workbookPr')?.attr('date1904') ?? '0')

  // Textos compartidos y estilos de fecha
  let shared: string[] = []
  const sharedPath = rels.find((r) => r.type.endsWith('/sharedStrings') && !r.isExternal)?.target
  try {
    const read = (sharedPath !== undefined ? zip.readPrefix(sharedPath, 64 * 1024 * 1024) : null) ?? zip.readPrefix('xl/sharedStrings.xml', 64 * 1024 * 1024)
    if (read) {
      if (declaresEntities(read.data)) ctx.warnings.add(L('Se omitieron los textos compartidos: contienen definiciones de entidades XML, que no se permiten por seguridad.'))
      else shared = parseSharedStrings(read.data)
    }
  } catch {
    // Un CRC malo o un fichero dañado no puede dejar el material a medias en silencio
    ctx.warnings.add(L('No se pudo leer parte del libro (puede estar dañado): pueden faltar datos.'))
  }
  const dateStyles = dateStyleIndexes(zip, rels, ctx)

  // Hojas
  interface SheetRef { name: string; path: string; hidden: boolean }
  let sheets: SheetRef[] = []
  const seenPaths = new Set<string>()
  for (const s of workbook?.child('sheets')?.childrenNamed('sheet') ?? []) {
    const name = s.attr('name')
    if (name === null) continue
    const rid = s.relationshipID
    const path = rid !== null ? byID.get(rid) : undefined
    if (path === undefined) { ctx.warnings.add(L('No se encontró el contenido de la hoja «%@».', name)); continue }
    // Dos hojas que apuntan al mismo contenido (archivo manipulado): se lee una sola vez
    if (seenPaths.has(path)) continue
    seenPaths.add(path)
    sheets.push({ name, path, hidden: (s.attr('state') ?? 'visible') !== 'visible' })
  }
  if (sheets.length === 0 && sheetFiles.length) {
    sheets = sheetFiles.map((path, i) => ({ name: Markers.sheetName(i + 1), path, hidden: false }))
    ctx.warnings.add(L('No se pudo leer la lista de hojas; se usaron los archivos de las hojas por orden.'))
  }
  if (sheets.length === 0) throw corrupt(L('el libro de Excel no tiene hojas'))

  const pages: SourcePage[] = []
  const names: string[] = []
  let anyData = false
  const visible = sheets.filter((s) => !s.hidden)
  for (const s of sheets) if (s.hidden) ctx.warnings.add(L('Se omitió la hoja oculta «%@».', s.name))
  for (let i = 0; i < visible.length; i++) {
    const sheet = visible[i]
    checkContext(ctx)
    if (pages.length >= ctx.options.maxPages) {
      ctx.warnings.add(L('El libro tiene %lld hojas; solo se leyeron las primeras %lld.', visible.length, ctx.options.maxPages))
      break
    }
    ctx.progress.report(0.1 + (0.88 * i) / Math.max(visible.length, 1), L('Leyendo la hoja «%@» (%@ de %@)…', sheet.name, String(i + 1), String(visible.length)))
    names.push(sheet.name)
    let text = '# ' + sheet.name
    let hasData = false
    try {
      const read = zip.readPrefix(sheet.path, MAX_SHEET_BYTES)
      if (!read) {
        ctx.warnings.add(L('No se encontró el contenido de la hoja «%@».', sheet.name))
        pages.push({ number: pages.length + 1, text: '', usedOCR: false, heading: sheet.name, hasFigures: false })
        continue
      }
      if (read.truncated) ctx.warnings.add(L('La hoja «%@» es enorme; solo se leyó su inicio.', sheet.name))
      if (declaresEntities(read.data)) {
        ctx.warnings.add(L('Se omitió la hoja «%@»: contiene definiciones de entidades XML, que no se permiten por seguridad.', sheet.name))
      }
      const parsed = parseSheet(read.data, shared, dateStyles, date1904)
      if (parsed.rows.length) { text += '\n\n' + parsed.rows.join('\n'); hasData = true }
      if (parsed.rowsTruncated) ctx.warnings.add(L('La hoja «%@» tiene más de %lld filas; solo se leyeron las primeras %lld.', sheet.name, MAX_ROWS, MAX_ROWS))
      if (parsed.colsTruncated) ctx.warnings.add(L('La hoja «%@» tiene más de %lld columnas; solo se leyeron las primeras %lld.', sheet.name, MAX_COLS, MAX_COLS))
    } catch (e) {
      if (!(e instanceof IngestError)) throw e
      if (e.kind === 'passwordProtected') throw e
      ctx.warnings.add(L('No se pudo leer la hoja «%@»: %@', sheet.name, e.message))
    }
    if (hasData) anyData = true
    pages.push({ number: pages.length + 1, text: hasData ? text : '', usedOCR: false, heading: sheet.name, hasFigures: false })
  }
  if (!anyData) ctx.warnings.add(L('El libro de Excel no contiene datos.'))

  const meta = coreProperties(zip)
  meta.sheetNames = names.join(' | ')
  meta.pageCount = String(pages.length)
  const title = usableTitle(meta.title) ?? ctx.fallbackTitle
  meta.title = title
  return { title, kind: 'xlsx', pages, metadata: meta, warnings: ctx.warnings.all }
}

// MARK: Estilos: qué formatos de número son fechas

function dateStyleIndexes(zip: ZipArchive, rels: Array<{ type: string; target: string }>, ctx: IngestContext): Set<number> {
  const path = rels.find((r) => r.type.endsWith('/styles'))?.target ?? 'xl/styles.xml'
  let root: XNode | null
  try {
    root = readXmlPart(zip, path, ctx, { label: PartName.styles })
  } catch {
    ctx.warnings.add(L('No se pudo leer parte del libro (puede estar dañado): pueden faltar datos.'))
    return new Set()
  }
  const result = new Set<number>()
  if (!root) return result
  const custom = new Map<number, string>()
  for (const f of root.child('numFmts')?.childrenNamed('numFmt') ?? []) {
    const id = intOrNull(f.attr('numFmtId')), code = f.attr('formatCode')
    if (id !== null && code !== null) custom.set(id, code)
  }
  ;(root.child('cellXfs')?.childrenNamed('xf') ?? []).forEach((xf, i) => {
    const id = intOrNull(xf.attr('numFmtId'))
    if (id === null) return
    const code = custom.get(id)
    if (isBuiltInDateFormat(id) || (code !== undefined && isDateFormatCode(code))) result.add(i)
  })
  return result
}

function intOrNull(s: string | null | undefined): number | null {
  if (s === null || s === undefined || !/^[+-]?\d+$/.test(s.trim() === s ? s : '#')) return null
  const v = Number(s)
  return Math.abs(v) > 9.2e18 ? null : v
}

export function isBuiltInDateFormat(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)
}

/** ¿El código de formato de número representa una fecha u hora? */
export function isDateFormatCode(code: string): boolean {
  let cleaned = ''
  let inQuote = false, inBracket = false, escape = false
  for (const ch of code) {
    if (escape) { escape = false; continue }
    if (ch === '\\' || ch === '_' || ch === '*') { escape = true; continue }
    if (ch === '"') { inQuote = !inQuote; continue }
    if (inQuote) continue
    if (ch === '[') { inBracket = true; continue }
    if (ch === ']') { inBracket = false; continue }
    if (inBracket) continue
    cleaned += ch
  }
  const lower = cleaned.toLowerCase()
  if (lower.includes('general')) return false
  return /[ymdhs]/.test(lower) && !lower.includes('e+') && !lower.includes('e-')
}

// MARK: Fechas y números

const FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** `%.15g` de C: notación fija o exponencial, sin ceros finales. */
export function formatG(d: number, precision = 15): string {
  if (d === 0) return '0'
  const exp = Number(d.toExponential(precision - 1).split('e')[1])
  if (exp < -4 || exp >= precision) {
    const [mantissa, e] = d.toExponential(precision - 1).split('e')
    const m = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa
    const en = Number(e)
    return `${m}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`
  }
  const fixed = d.toFixed(Math.max(0, precision - 1 - exp))
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

export function formatNumber(raw: string): string {
  const t = trimWS(raw)
  if (!FLOAT.test(t)) return t
  const d = Number(t)
  if (!Number.isFinite(d)) return t
  if (d === Math.round(d) && Math.abs(d) < 1e15) return String(Math.trunc(d) === 0 ? 0 : Math.trunc(d))
  return formatG(d, 15)
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function excelDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= 2_958_466) return null
  if (serial < 1) {
    const minutes = Math.round(serial * 1440)
    return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`
  }
  // Excel incluye un 1900-02-29 ficticio (serial 60): antes de ese serial, el desplazamiento es un día menor
  const epochOffset = date1904 ? 24107 : serial < 60 ? 25568 : 25569
  const seconds = Math.round((serial - epochOffset) * 86400)
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  const base = `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
  const h = date.getUTCHours(), mi = date.getUTCMinutes()
  if (serial !== Math.floor(serial) && (h !== 0 || mi !== 0)) return `${base} ${pad2(h)}:${pad2(mi)}`
  return base
}

// MARK: Textos compartidos (SAX)

export function parseSharedStrings(data: Uint8Array): string[] {
  if (declaresEntities(data)) return []
  const strings: string[] = []
  let inSI = false, inT = false, phoneticDepth = 0
  let current = ''
  saxParse(xmlText(data), {
    start(local) {
      if (local === 'si') { inSI = true; current = '' }
      else if (local === 'rPh') phoneticDepth++
      else if (local === 't' && inSI && phoneticDepth === 0) inT = true
    },
    end(local) {
      if (local === 't') inT = false
      else if (local === 'rPh') phoneticDepth = Math.max(0, phoneticDepth - 1)
      else if (local === 'si') {
        strings.push(current)
        inSI = false
        if (strings.length >= 3_000_000) return false
      }
    },
    text(s) { if (inT) current += s }
  })
  return strings
}

// MARK: Hoja (SAX)

/** "AB12" → columna 28, fila 12. Las letras de sobra se saturan en una columna enorme. */
function position(ref: string): { col: number; row: number } | null {
  let col = 0
  let digits = ''
  for (const ch of ref.toUpperCase()) {
    const a = ch.charCodeAt(0)
    if (ch.length === 1 && a >= 65 && a <= 90 && digits === '') col = Math.min(col * 26 + (a - 64), 1_000_000)
    else if (/^\p{N}$/u.test(ch)) digits += ch
    else return null
  }
  if (col <= 0 || !/^\d+$/.test(digits)) return null
  return { col, row: Number(digits) }
}

export function parseSheet(data: Uint8Array, shared: string[], dateStyles: Set<number>, date1904: boolean): { rows: string[]; rowsTruncated: boolean; colsTruncated: boolean } {
  const out = { rows: [] as string[], rowsTruncated: false, colsTruncated: false }
  if (declaresEntities(data)) return out
  let rowCells = new Map<number, string>()
  let nextCol = 1
  let limitReached = false
  let cellCol = 0, cellType = '', cellStyle = -1
  let inCell = false, inV = false, inF = false, inIS = false, inISText = false
  let v = '', f = '', isText = ''

  const cellValue = (): string => {
    switch (cellType) {
      case 's': {
        const t = trimWS(v)
        const i = /^\d+$/.test(t) ? Number(t) : -1
        return i >= 0 && i < shared.length ? trimWSNL(shared[i]) : ''
      }
      case 'inlineStr': return trimWSNL(isText)
      case 'str': return trimWSNL(v)
      case 'b': return trimWS(v) === '1' ? 'TRUE' : 'FALSE'
      case 'e': case 'd': return trimWSNL(v)
      default: {
        const t = trimWSNL(v)
        if (!t) return f ? '=' + trimWSNL(f) : ''
        if (dateStyles.has(cellStyle) && FLOAT.test(t)) {
          const formatted = excelDate(Number(t), date1904)
          if (formatted !== null) return formatted
        }
        return formatNumber(t)
      }
    }
  }

  saxParse(xmlText(data), {
    start(local, attrs) {
      const attr = (name: string): string | null => attrs.find((a) => a.local === name && a.prefix === null)?.value ?? null
      switch (local) {
        case 'row':
          rowCells = new Map()
          nextCol = 1
          if (out.rows.length >= MAX_ROWS) limitReached = true
          break
        case 'c': {
          inCell = true
          cellType = attr('t') ?? 'n'
          const s = attr('s')
          cellStyle = s !== null && /^\d+$/.test(s) ? Number(s) : -1
          const ref = attr('r')
          const pos = ref !== null ? position(ref) : null
          cellCol = pos ? pos.col : nextCol
          nextCol = cellCol + 1
          v = ''; f = ''; isText = ''
          break
        }
        case 'v': if (inCell) inV = true; break
        case 'f': if (inCell) inF = true; break
        case 'is': if (inCell) inIS = true; break
        case 't': if (inIS) inISText = true; break
        default: break
      }
    },
    end(local) {
      switch (local) {
        case 'v': inV = false; break
        case 'f': inF = false; break
        case 't': inISText = false; break
        case 'is': inIS = false; break
        case 'c': {
          if (!inCell) return
          inCell = false
          if (cellCol > MAX_COLS) { out.colsTruncated = true; return }
          const value = cellValue()
          if (value) {
            if (limitReached) { out.rowsTruncated = true; return false }
            rowCells.set(cellCol, value)
          }
          break
        }
        case 'row': {
          if (rowCells.size === 0) return
          const last = Math.max(...rowCells.keys())
          const cells: string[] = []
          for (let c = 1; c <= last; c++) cells.push((rowCells.get(c) ?? '').replace(/\|/g, '¦').replace(/\n/g, ' '))
          out.rows.push(cells.join(' | '))
          break
        }
        default: break
      }
    },
    text(s) {
      if (inV) v += s
      else if (inISText) isText += s
      else if (inF) f += s
    }
  })
  return out
}
