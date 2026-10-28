// Parte un documento en fragmentos de tamaño parecido sin cortar frases, respetando títulos, párrafos, listas y tablas.
// Mismos tamaños, solapamiento e ids que el `Chunker` de la app Swift: los `chunks.json` de los cursos existentes siguen valiendo.
import { createHash } from 'node:crypto'
import type { SourceChunk, SourceDocument } from '@shared/ingest'
import { parseHeading } from './text/headingDetector'
import { startsWithBullet } from './text/textCleaner'
import { charCount, chars, foldDiacritics, isLetter, isLowercase, isNumber, isUppercase, isWhitespace, isNewline, suffixChars, trimWS, trimWSNL } from './text/unicode'

export interface ChunkOptions {
  /** Tamaño buscado de cada trozo, en caracteres (grafemas). */
  target?: number
  /** Tamaño máximo (incluido el solapamiento). */
  maxChars?: number
  /** Caracteres del final del trozo anterior que se repiten al empezar el siguiente (dentro de una sección). */
  overlap?: number
}

export const DEFAULT_CHUNK = { target: 1400, maxChars: 2200, overlap: 120 } as const

/** Id estable: primeros 16 hex de sha256("<sourceID>\u001F<ordinal>\u001F<text>"). */
export function chunkID(sourceID: string, ordinal: number, text: string): string {
  return createHash('sha256').update(`${sourceID}\u001F${ordinal}\u001F${text}`, 'utf8').digest('hex').slice(0, 16)
}

function clampInt(v: number | undefined, fallback: number): number {
  if (v === undefined || Number.isNaN(v)) return fallback
  if (v === Infinity) return Number.MAX_SAFE_INTEGER
  if (v === -Infinity) return Number.MIN_SAFE_INTEGER
  return Math.trunc(v)
}

/** Trozos no vacíos, en orden; el texto de todos ellos cubre todo el documento. */
export function chunkDocument(doc: Pick<SourceDocument, 'pages'>, sourceID: string, options: ChunkOptions = {}): SourceChunk[] {
  // Valores saneados: mínimos útiles y máximos que no desbordan los cálculos
  const target = Math.min(Math.max(clampInt(options.target, DEFAULT_CHUNK.target), 40), 1_000_000)
  const maxChars = Math.min(Math.max(clampInt(options.maxChars, DEFAULT_CHUNK.maxChars), target), 4_000_000)
  const overlap = Math.max(0, Math.min(clampInt(options.overlap, DEFAULT_CHUNK.overlap), Math.floor(target / 2), Math.floor(maxChars / 3)))

  // 1. Piezas: títulos y bloques (párrafos, listas, tablas) ya divididos si son demasiado grandes
  const pieces: Piece[] = []
  for (const page of doc.pages) {
    const pageBlocks = blocks(page.text, page.number)
    // Si la página declara un título que su texto no trae como línea, se usa como título desde ahí
    const h = page.heading !== undefined ? trimWSNL(page.heading) : ''
    if (h && pageBlocks.length) {
      const present = pageBlocks.some((b) => b.kind === 'heading' && b.title === h)
      if (!present) pieces.push({ text: '', len: 0, page: page.number, headingTitle: h, join: 'block', isHint: true })
    }
    for (const block of pageBlocks) {
      if (block.kind === 'heading') pieces.push({ text: block.text, len: charCount(block.text), page: block.page, headingTitle: block.title ?? '', join: 'block', isHint: false })
      else pieces.push(...splitBlock(block, target, maxChars))
    }
  }
  if (!pieces.some((p) => !p.isHint)) return []

  // 2. Empaquetado en trozos
  const packer = new Packer(sourceID, target, maxChars, overlap)
  for (const p of pieces) packer.add(p)
  return packer.finish()
}

// MARK: Piezas y bloques

type Join = 'block' | 'paragraph' | 'lines'
const SEPARATOR: Record<Join, string> = { block: '\n\n', paragraph: '', lines: '\n' }

interface Piece {
  text: string
  /** Longitud en grafemas. */
  len: number
  page: number
  headingTitle: string | null
  join: Join
  /** Pieza sin texto que solo anuncia un cambio de título (el de la página). */
  isHint: boolean
}

const isHeadingPiece = (p: Piece): boolean => p.headingTitle !== null && !p.isHint

type BlockKind = 'heading' | 'paragraph' | 'list' | 'table'

interface Block {
  kind: BlockKind
  title?: string
  text: string
  page: number
}

function blocks(text: string, page: number): Block[] {
  const out: Block[] = []
  let lines: string[] = []
  let current: BlockKind = 'paragraph'
  let previousBlank = true
  const flush = (): void => {
    if (lines.length === 0) return
    const t = trimWSNL(lines.join('\n'))
    if (t) out.push({ kind: current, text: t, page })
    lines = []
  }
  for (const line of text.split('\n')) {
    const trimmed = trimWS(line)
    if (!trimmed) { flush(); previousBlank = true; continue }
    // Títulos: los de Markdown siempre; los numerados, de palabra clave o en MAYÚSCULAS solo si empiezan un bloque
    if (trimmed.startsWith('#') || previousBlank) {
      const h = parseHeading(trimmed)
      if (h) {
        flush()
        out.push({ kind: 'heading', title: h.title, text: trimmed, page })
        previousBlank = false
        continue
      }
    }
    previousBlank = false
    const isTable = trimmed.includes(' | ')
    const isList = startsWithBullet(trimmed)
    const lineKind: BlockKind = isTable ? 'table' : isList ? 'list' : 'paragraph'
    if (lines.length === 0) { current = lineKind; lines.push(trimmed); continue }
    if ((current === 'table' && lineKind === 'table') || (current === 'list' && lineKind === 'list') || (current === 'paragraph' && lineKind === 'paragraph')) {
      lines.push(trimmed)
    } else if (current === 'list' && lineKind === 'paragraph' && (line.startsWith(' ') || line.startsWith('\t') || startsLowercase(trimmed))) {
      lines.push(trimmed)                       // continuación de un elemento de lista
    } else {
      flush()
      current = lineKind
      lines.push(trimmed)
    }
  }
  flush()
  return out
}

function startsLowercase(s: string): boolean {
  const first = chars(s.slice(0, 4))[0]
  return first !== undefined && isLowercase(first)
}

// MARK: División de bloques grandes

function splitBlock(block: Block, target: number, maxChars: number): Piece[] {
  const text = block.text
  const textLen = charCount(text)
  if (textLen <= maxChars) return [{ text, len: textLen, page: block.page, headingTitle: null, join: 'block', isHint: false }]
  let units: string[]
  let join: Join
  if (block.kind === 'list' || block.kind === 'table') {
    units = text.split('\n').filter((u) => u.length > 0)
    join = 'lines'
  } else {
    units = sentences(text)
    join = 'paragraph'
  }
  const fitted: string[] = []
  for (const u of units) {
    if (charCount(u) <= maxChars) fitted.push(u)
    else fitted.push(...splitByWords(u, target, maxChars))
  }
  const pieces: Piece[] = []
  let cur = ''
  let curLen = 0
  const emit = (): void => {
    const t = trimWSNL(cur)
    if (t) pieces.push({ text: t, len: charCount(t), page: block.page, headingTitle: null, join: pieces.length === 0 ? 'block' : join, isHint: false })
    cur = ''
    curLen = 0
  }
  const sep = join === 'lines' ? '\n' : ''
  for (const u of fitted) {
    const uLen = charCount(u)
    if (!cur) { cur = u; curLen = uLen; continue }
    if (curLen + sep.length + uLen > target) { emit(); cur = u; curLen = uLen }
    else { cur += sep + u; curLen += sep.length + uLen }
  }
  emit()
  return pieces
}

const ABBREVIATIONS = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'ud', 'uds', 'vd', 'vds', 'prof', 'ing', 'lic', 'arq', 'mr', 'mrs', 'ms', 'st', 'jr', 'vs', 'fig', 'figs',
  'eq', 'eqs', 'ec', 'no', 'num', 'pp', 'p', 'cap', 'caps', 'sec', 'vol', 'ed', 'pag', 'aprox', 'approx', 'ca', 'cf', 'cfr', 'ej', 'eg', 'ie', 'ibid', 'op', 'cit', 'al'
])
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？', '؟', '۔', '।', '॥'])
const UNSPACED_TERMINATORS = new Set(['。', '！', '？'])
const CLOSERS = new Set(['"', "'", '”', '’', '»', ')', ']', '」', '』', '）'])
const OPENERS = new Set(['¿', '¡', '"', '“', '«', '(', '[', '「', '『', '（'])

/**
 * Frases de un texto (cada una conserva los espacios finales). Respeta abreviaturas, iniciales y decimales, y entiende los
 * finales de frase de otras escrituras: `。！？` (sin espacio detrás) y `؟ ۔ ।` (escrituras sin mayúsculas).
 */
export function sentences(s: string): string[] {
  const cs = chars(s)
  const result: string[] = []
  let start = 0
  let i = 0
  while (i < cs.length) {
    const c = cs[i]
    if (!TERMINATORS.has(c)) { i++; continue }
    let j = i + 1
    while (j < cs.length && TERMINATORS.has(cs[j])) j++
    while (j < cs.length && CLOSERS.has(cs[j])) j++
    let k = j
    while (k < cs.length && isWhitespace(cs[k])) k++
    if (UNSPACED_TERMINATORS.has(c) && k < cs.length) {
      // En chino y japonés la frase acaba en el signo aunque no siga ningún espacio
      result.push(cs.slice(start, k).join(''))
      start = k
    } else if (k > j && k < cs.length) {
      const next = cs[k]
      // Empieza otra frase: mayúscula, cifra, signo de apertura o una letra de una escritura sin mayúsculas
      const caseless = isLetter(next) && !isLowercase(next) && !isUppercase(next)
      if (isUppercase(next) || isNumber(next) || OPENERS.has(next) || caseless) {
        if (!(c === '.' && j === i + 1 && isAbbreviation(cs, i))) {
          result.push(cs.slice(start, k).join(''))
          start = k
        }
      }
    }
    i = Math.max(j, i + 1)
  }
  if (start < cs.length) result.push(cs.slice(start).join(''))
  return result
}

/** Ninguna abreviatura reconocida pasa de 6 caracteres: se mira como mucho esto hacia atrás (un bloque base64 enorme…). */
const MAX_ABBREVIATION_LENGTH = 8

function isAbbreviation(cs: string[], i: number): boolean {
  let j = i - 1
  while (j >= 0 && (isLetter(cs[j]) || isNumber(cs[j]))) {
    if (i - j > MAX_ABBREVIATION_LENGTH) return false
    j--
  }
  const wordChars = cs.slice(j + 1, i)
  if (wordChars.length === 0) return false
  if (wordChars.length === 1 && isLetter(wordChars[0])) return true           // inicial: "J. Smith", "p. ej."
  // Número de lista al principio de una línea: "1. Calcula…"
  if (wordChars.length <= 3 && wordChars.every(isNumber)) return j < 0 || cs[j] === '\n'
  if (ABBREVIATIONS.has(foldDiacritics(wordChars.join('')))) return true
  // Siglas con puntos: "EE. UU.", "U. S. A."
  if (wordChars.length <= 4 && wordChars.every(isUppercase)) {
    let k = i + 1
    while (k < cs.length && cs[k] === ' ') k++
    const next: string[] = []
    while (k < cs.length && isLetter(cs[k]) && next.length <= 4) { next.push(cs[k]); k++ }
    if (next.length >= 1 && next.length <= 4 && next.every(isUppercase) && k < cs.length && cs[k] === '.') return true
  }
  return false
}

/**
 * Parte un texto largo en trozos de como mucho `maxChars`, apuntando a `limit`. Corta tras un salto de línea, si no tras
 * un espacio y, en una «palabra» enorme, en seco. Lineal aunque el bloque ocupe megas.
 */
function splitByWords(s: string, limit: number, maxChars: number): string[] {
  const cs = chars(s)
  const out: string[] = []
  let start = 0
  const minimum = Math.max(1, Math.floor(limit / 3))
  while (start < cs.length) {
    let end = start
    let count = 0
    let afterNewline = -1, afterSpace = -1, afterSpaceBeyond = -1
    while (end < cs.length && count < maxChars) {
      const ch = cs[end]
      end++
      count++
      if (!isWhitespace(ch) || count < minimum) continue
      if (count <= limit) {
        afterSpace = end
        if (isNewline(ch)) afterNewline = end
      }
      afterSpaceBeyond = end
    }
    if (end === cs.length) { out.push(cs.slice(start).join('')); break }
    const cut = afterNewline >= 0 ? afterNewline : afterSpace >= 0 ? afterSpace : afterSpaceBeyond >= 0 ? afterSpaceBeyond : end
    out.push(cs.slice(start, cut).join(''))
    start = cut
  }
  return out
}

/** Final del texto (≈ `length` caracteres) alineado al inicio de una frase o, si no, de una palabra. */
function overlapTail(body: string, bodyLen: number, length: number): string {
  if (length <= 0 || bodyLen <= length) return ''
  const tail = suffixChars(body, length)
  const sents = sentences(tail)
  if (sents.length > 1) return trimWSNL(sents.slice(1).join(''))
  const tc = chars(tail)
  const sp = tc.findIndex(isWhitespace)
  if (sp >= 0) return trimWSNL(tc.slice(sp + 1).join(''))
  return ''
}

// MARK: Empaquetado

/** Va acumulando piezas y cierra el trozo al llegar al tamaño buscado, al máximo o a un cambio de sección. */
class Packer {
  private readonly chunks: SourceChunk[] = []
  private current: Piece[] = []
  private currentLen = 0
  private startHeading: string | null = null
  /** Título vigente tras las piezas ya leídas. */
  private running: string | null = null
  /** Solapamiento que se antepone al trozo en curso. */
  private pending = ''
  private pendingLen = 0

  constructor(private readonly sourceID: string, private readonly target: number, private readonly maxChars: number, private readonly overlap: number) {}

  private get prefixLength(): number {
    return this.pending ? this.pendingLen + 2 : 0
  }

  add(piece: Piece): void {
    if (piece.isHint) {
      // Cambio de título sin texto propio: cuenta como el comienzo de una sección
      if (this.current.length && this.currentLen >= Math.max(Math.floor(this.target / 3), 1)) this.close(true, false)
      this.running = piece.headingTitle
      if (this.current.length === 0) this.startHeading = piece.headingTitle
      return
    }
    if (isHeadingPiece(piece)) {
      if (this.current.length && this.currentLen >= Math.max(Math.floor(this.target / 3), 1)) this.close(true, false)
    } else if (this.current.length) {
      const total = this.prefixLength + this.currentLen + SEPARATOR[piece.join].length + piece.len
      if (total > this.maxChars || this.currentLen >= this.target || (total > this.target && this.currentLen >= Math.floor((this.target * 3) / 5))) this.close(false, false)
    }
    const separator = this.current.length === 0 ? 0 : SEPARATOR[piece.join].length
    if (this.prefixLength + this.currentLen + separator + piece.len > this.maxChars) { this.pending = ''; this.pendingLen = 0 }   // sin sitio para el solapamiento
    if (this.current.length === 0) this.startHeading = piece.headingTitle ?? this.running
    this.current.push(piece)
    this.currentLen += separator + piece.len
    if (piece.headingTitle !== null) this.running = piece.headingTitle
  }

  finish(): SourceChunk[] {
    this.close(false, true)
    return this.chunks
  }

  private close(nextStartsSection: boolean, isFinal: boolean): void {
    if (this.current.length === 0) return
    let carry: Piece[] = []
    // Un título no se queda solo al final de un trozo: pasa al siguiente
    if (!isFinal && this.current.length > 1 && isHeadingPiece(this.current[this.current.length - 1])) carry = [this.current.pop() as Piece]
    let body = ''
    this.current.forEach((p, i) => {
      if (i > 0) body += SEPARATOR[p.join]
      body += p.text
    })
    body = trimWSNL(body)
    if (body) {
      const text = this.pending ? this.pending + '\n\n' + body : body
      const first = this.current[0].page, last = this.current[this.current.length - 1].page
      const ordinal = this.chunks.length
      const chunk: SourceChunk = { id: chunkID(this.sourceID, ordinal, text), sourceID: this.sourceID, ordinal, page: first, text }
      if (last !== first) chunk.pageEnd = last
      if (this.startHeading !== null) chunk.heading = this.startHeading
      this.chunks.push(chunk)
      const nextIsHeading = carry.length > 0 && isHeadingPiece(carry[0])
      if (this.overlap > 0 && !nextStartsSection && !nextIsHeading) {
        this.pending = overlapTail(body, charCount(body), this.overlap)
        this.pendingLen = charCount(this.pending)
      } else {
        this.pending = ''
        this.pendingLen = 0
      }
    }
    this.current = carry
    this.currentLen = carry.reduce((a, p) => a + p.len, 0)
    this.startHeading = carry.length ? carry[0].headingTitle ?? this.running : this.running
    if (carry.length) { this.pending = ''; this.pendingLen = 0 }
  }
}
