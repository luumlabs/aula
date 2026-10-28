// Reconstruye el texto de una página a partir de la geometría de sus líneas (capa de texto de un PDF u OCR): orden de lectura
// en columnas, filas de tabla (`a | b | c`), párrafos reales (une las líneas partidas por el ancho), listas y títulos por
// tamaño de letra (`# Título`). Así las fórmulas, una por línea, no se mezclan con la prosa.
import { charCount, chars, isNumber, isWhitespace, trimWS, trimWSNL } from './unicode'
import { collapseSpaces, finalizeText, isMarkerOnly, isProse, joinLines, normalizeBullet, normalizeCharacters, startsWithBullet } from './textCleaner'

/** Rectángulo con el origen arriba a la izquierda (en cualquier unidad). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Una línea de texto con su posición. */
export interface TextLine {
  text: string
  rect: Rect
  confidence?: number
}

export interface PageLayout {
  text: string
  firstHeading: string | null
  lineCount: number
}

const maxX = (r: Rect): number => r.x + r.width
const maxY = (r: Rect): number => r.y + r.height
const midX = (r: Rect): number => r.x + r.width / 2
const midY = (r: Rect): number => r.y + r.height / 2

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(maxX(a), maxX(b)) - x, height: Math.max(maxY(a), maxY(b)) - y }
}

function unionAll(lines: TextLine[]): Rect {
  let r: Rect | null = null
  for (const l of lines) r = union(r, l.rect)
  return r ?? { x: 0, y: 0, width: 0, height: 0 }
}

const validRect = (r: Rect): boolean =>
  Number.isFinite(r.width) && Number.isFinite(r.height) && Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0

/** - `headingRatio`: cuántas veces mayor que el texto normal debe ser una línea para ser título. */
export function buildLayout(input: TextLine[], markHeadings = true, headingRatio = 1.25): PageLayout {
  const lines: TextLine[] = []
  for (const l of input) {
    const t = trimWSNL(collapseSpaces(normalizeCharacters(l.text)))
    if (!t || !validRect(l.rect)) continue
    lines.push({ text: t.replace(/\n/g, ' '), rect: l.rect, confidence: l.confidence })
  }
  if (lines.length === 0) return { text: '', firstHeading: null, lineCount: 0 }
  const bodyH = bodyHeight(lines)
  const state = { firstHeading: null as string | null }
  const paragraphs: string[] = []
  for (const region of regions(lines, bodyH)) {
    const rows = makeRows(region, bodyH)
    paragraphs.push(...assemble(rows, bodyH, markHeadings, headingRatio, state))
  }
  return { text: finalizeText(paragraphs.join('\n\n')), firstHeading: state.firstHeading, lineCount: lines.length }
}

/** Las líneas en orden de lectura (columnas de izquierda a derecha, filas de arriba abajo). */
export function readingOrder(input: TextLine[]): TextLine[] {
  const lines = input.filter((l) => l.rect.width > 0 && l.rect.height > 0 && Number.isFinite(l.rect.x) && Number.isFinite(l.rect.y) && trimWS(l.text).length > 0)
  if (lines.length === 0) return []
  const bodyH = bodyHeight(lines)
  const out: TextLine[] = []
  for (const region of regions(lines, bodyH)) for (const row of makeRows(region, bodyH)) out.push(...row.boxes)
  return out
}

/** Mediana de las alturas ponderada por caracteres (el texto de cuerpo domina sobre los títulos). */
export function bodyHeight(lines: TextLine[]): number {
  const sorted = [...lines].sort((a, b) => a.rect.height - b.rect.height)
  const counts = sorted.map((l) => charCount(l.text))
  const total = counts.reduce((a, b) => a + b, 0)
  let acc = 0
  for (let i = 0; i < sorted.length; i++) {
    acc += counts[i]
    if (acc * 2 >= total) return Math.max(sorted[i].rect.height, 1)
  }
  return Math.max(sorted[sorted.length - 1]?.rect.height ?? 1, 1)
}

// MARK: Columnas

const isProseLine = (l: TextLine): boolean => charCount(l.text) >= 24 || l.text.split(' ').filter((w) => w.length > 0).length >= 4

function isProseGroup(g: TextLine[], unionWidth: number): boolean {
  if (g.length < 3) return false
  const prose = g.filter(isProseLine).length
  if (prose / g.length < 0.6) return false
  return unionAll(g).width >= 0.15 * unionWidth
}

type Gutter = [number, number]

/** Calles verticales entre columnas. Vacío si la página es de una sola columna. */
function findGutters(narrow: TextLine[], bodyH: number, unionWidth: number): Gutter[] {
  const minGutter = Math.max(0.9 * bodyH, 0.015 * unionWidth)
  const sorted = [...narrow].sort((a, b) => a.rect.x - b.rect.x)
  if (sorted.length === 0) return []
  const gaps: Gutter[] = []
  let end = maxX(sorted[0].rect)
  for (const l of sorted.slice(1)) {
    if (l.rect.x > end + minGutter) gaps.push([end, l.rect.x])
    end = Math.max(end, maxX(l.rect))
  }
  // Cada grupo entre calles debe ser una columna de prosa; si no, se funde con su vecino
  const gutters = gaps
  let guard = 0
  while (gutters.length && guard < 8) {
    guard++
    const groups = partition(narrow, gutters)
    const bad = groups.findIndex((g) => !isProseGroup(g, unionWidth))
    if (bad < 0) return gutters
    if (gutters.length === 1) return []
    const candidates = [bad - 1, bad].filter((k) => k >= 0 && k < gutters.length)
    if (candidates.length === 0) return []
    let drop = candidates[0]
    for (const k of candidates) if (gutters[k][1] - gutters[k][0] < gutters[drop][1] - gutters[drop][0]) drop = k
    gutters.splice(drop, 1)
  }
  return []
}

function partition(lines: TextLine[], gutters: Gutter[]): TextLine[][] {
  const groups: TextLine[][] = Array.from({ length: gutters.length + 1 }, () => [])
  for (const l of lines) {
    const cx = midX(l.rect)
    let idx = 0
    for (const g of gutters) if (cx > (g[0] + g[1]) / 2) idx++
    groups[idx].push(l)
  }
  return groups.filter((g) => g.length > 0)
}

/** Regiones de lectura: bandas de ancho completo y, entre ellas, columnas (izquierda → derecha). */
function regions(lines: TextLine[], bodyH: number): TextLine[][] {
  if (lines.length < 6) return [lines]
  const width = unionAll(lines).width
  if (width <= bodyH * 12) return [lines]
  const narrow = lines.filter((l) => l.rect.width < 0.62 * width)
  if (narrow.length < 6) return [lines]
  const gutters = findGutters(narrow, bodyH, width)
  if (gutters.length === 0) return [lines]

  const isWide = (l: TextLine): boolean => l.rect.width >= 0.62 * width || gutters.some((g) => l.rect.x < g[0] && maxX(l.rect) > g[1])
  const result: TextLine[][] = []
  let wide: TextLine[] = [], columns: TextLine[] = []
  const flushWide = (): void => { if (wide.length) { result.push(wide); wide = [] } }
  const flushColumns = (): void => { if (columns.length) { result.push(...partition(columns, gutters)); columns = [] } }
  for (const l of stableSort(lines, (a, b) => a.rect.y - b.rect.y)) {
    if (isWide(l)) { flushColumns(); wide.push(l) } else { flushWide(); columns.push(l) }
  }
  flushWide()
  flushColumns()
  return result
}

function stableSort<T>(items: T[], cmp: (a: T, b: T) => number): T[] {
  return items.map((v, i) => ({ v, i })).sort((a, b) => cmp(a.v, b.v) || a.i - b.i).map((x) => x.v)
}

// MARK: Filas

interface Row {
  rect: Rect
  text: string
  isTable: boolean
  boxCount: number
  boxes: TextLine[]
}

function makeRows(region: TextLine[], bodyH: number): Row[] {
  const sorted = stableSort(region, (a, b) => midY(a.rect) - midY(b.rect))
  const groups: TextLine[][] = []
  const rects: Rect[] = []
  for (const l of sorted) {
    const last = rects[rects.length - 1]
    if (last) {
      const overlap = Math.min(maxY(last), maxY(l.rect)) - Math.max(last.y, l.rect.y)
      const minH = Math.min(last.height, l.rect.height)
      if (minH > 0 && overlap / minH >= 0.5) {
        groups[groups.length - 1].push(l)
        rects[rects.length - 1] = union(last, l.rect)
        continue
      }
    }
    groups.push([l])
    rects.push({ ...l.rect })
  }
  return groups.map((g, i) => {
    const boxes = stableSort(g, (a, b) => a.rect.x - b.rect.x)
    let text = boxes[0].text
    let table = false
    for (let k = 1; k < boxes.length; k++) {
      const gap = boxes[k].rect.x - maxX(boxes[k - 1].rect)
      if (gap > 2.0 * bodyH && !isMarkerOnly(boxes[k - 1].text)) { text += ' | ' + boxes[k].text; table = true }
      else text += ' ' + boxes[k].text
    }
    return { rect: rects[i], text, isTable: table, boxCount: boxes.length, boxes }
  })
}

// MARK: Párrafos

function headingLevel(row: Row, bodyH: number, ratio: number): number | null {
  const n = charCount(row.text)
  if (row.boxCount !== 1 || n < 2 || n > 120 || row.isTable || !(row.rect.width > row.rect.height)) return null
  const r = row.rect.height / bodyH
  if (r < ratio) return null
  const cs = chars(row.text)
  const last = cs[cs.length - 1]
  if (last === '.' || last === ',' || last === ';') return null
  if (cs.every((c) => isNumber(c) || c === ' ')) return null
  return r >= 1.75 ? 1 : r >= 1.4 ? 2 : 3
}

function assemble(rows: Row[], bodyH: number, markHeadings: boolean, headingRatio: number, state: { firstHeading: string | null }): string[] {
  if (rows.length === 0) return []
  const minX = Math.min(...rows.map((r) => r.rect.x))
  const mx = Math.max(...rows.map((r) => maxX(r.rect)))
  const width = mx - minX

  // Hueco vertical típico entre líneas: un salto de párrafo es un hueco claramente mayor que el habitual
  const gaps: number[] = []
  for (let k = 1; k < rows.length; k++) gaps.push(Math.max(0, rows[k].rect.y - maxY(rows[k - 1].rect)))
  gaps.sort((a, b) => a - b)
  const typicalGap = gaps.length === 0 ? 0 : gaps[Math.floor(gaps.length / 2)]
  const paragraphGap = Math.max(0.65 * bodyH, 1.8 * typicalGap + 0.2 * bodyH)

  const paragraphs: string[][] = []
  let previous: Row | null = null
  let previousWasHeading = false
  for (const row of rows) {
    const level = markHeadings ? headingLevel(row, bodyH, headingRatio) : null
    let text = row.text
    if (level !== null) {
      text = '#'.repeat(level) + ' ' + text
      if (state.firstHeading === null) state.firstHeading = row.text
    } else {
      text = normalizeBullet(text)
    }
    let action: 'new' | 'break' | 'wrap' = 'new'
    if (previous) {
      const p = previous
      const gap = row.rect.y - maxY(p.rect)
      if (row.isTable && p.isTable && gap <= 2.0 * bodyH) action = 'break'
      else if (gap > paragraphGap || level !== null || previousWasHeading) action = 'new'
      else if (row.isTable || p.isTable || startsWithBullet(row.text)) action = 'break'
      else if (row.rect.x - minX > 0.9 * bodyH && !(p.rect.x - minX > 0.9 * bodyH)) action = 'new'
      else if (wraps(p, row, mx, width, bodyH)) action = 'wrap'
      else action = 'break'
    }
    if (action === 'new') paragraphs.push([text])
    else if (action === 'break') paragraphs[paragraphs.length - 1].push(text)
    else {
      const para = paragraphs[paragraphs.length - 1]
      para[para.length - 1] = joinLines(para[para.length - 1], row.text)
    }
    previous = row
    previousWasHeading = level !== null
  }
  return paragraphs.map((p) => p.join('\n'))
}

/** ¿`row` continúa la línea anterior `p` porque esta se partió al llegar al margen? */
function wraps(p: Row, row: Row, mx: number, width: number, bodyH: number): boolean {
  if (width < 14 * bodyH || p.isTable || row.isTable) return false
  if (p.rect.width < 0.55 * width) return false
  // Solo la prosa se parte por el ancho
  if (!(isProse(p.text) || (isProse(p.text.slice(2)) && p.text.startsWith('- ')))) return false
  // Índices con puntos guía y líneas de rellenar no son texto partido
  if (p.text.includes('....') || p.text.includes('____') || p.text.includes('· · ·') || p.text.includes('. . . .')) return false
  const remaining = mx - maxX(p.rect)
  const avg = p.rect.width / Math.max(charCount(p.text), 1)
  let firstWord = 0
  for (const c of chars(row.text)) { if (isWhitespace(c)) break; firstWord++ }
  const needed = avg * (firstWord + 1)
  return remaining < needed + 0.5 * avg
}
