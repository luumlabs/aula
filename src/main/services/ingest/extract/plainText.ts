// TXT, Markdown, CSV y RTF (con un analizador RTF propio: ignora destinos y entiende `\'hh`, `\uN`, `\par`, `\tab`…).
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { SourceDocument, SourceKind } from '@shared/ingest'
import type { IngestContext } from '../core/progress'
import { decodeText, normalizeNewlines, strictUTF8 } from '../core/textDecoding'
import { corrupt, errorMessage, tooLarge, unreadable } from '../errors'
import { L } from '../messages'
import { trimSet, trimWS, trimWSNL } from '../text/unicode'
import { usableTitle } from './ooxml'

export const MAX_TEXT_BYTES = 50 * 1024 * 1024

export function readTextFile(path: string): Uint8Array {
  let size = 0
  try { size = statSync(path).size } catch { size = 0 }
  if (size > MAX_TEXT_BYTES) throw tooLarge(L('«%@» ocupa más de %lld MB de texto', basename(path), Math.floor(MAX_TEXT_BYTES / (1024 * 1024))))
  try {
    return readFileSync(path)
  } catch (e) {
    throw unreadable(errorMessage(e))
  }
}

export async function extractPlainText(path: string, kind: SourceKind, ctx: IngestContext): Promise<SourceDocument> {
  const data = readTextFile(path)
  ctx.progress.report(0.3, L('Leyendo el texto…'))
  const decoded = decodeText(data)
  const meta: Record<string, string> = { encoding: decoded.encodingName }
  const text = tidyText(decoded.text)
  if (!text) ctx.warnings.add(L('El archivo no contiene texto.'))
  return buildTextDocument(text, kind, ctx.fallbackTitle, meta, ctx.warnings.all)
}

/** Documento de una sola página para texto plano o Markdown (con la cabecera YAML del Markdown como metadatos). */
export function buildTextDocument(text: string, kind: SourceKind, fallbackTitle: string, metadata: Record<string, string>, warnings: string[]): SourceDocument {
  let body = text
  let title: string | null = null
  if (kind === 'markdown' && body.startsWith('---\n')) {
    const end = body.indexOf('\n---', 4)
    if (end >= 0) {
      const front = body.slice(4, end)
      for (const line of front.split('\n')) {
        if (!line) continue
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const key = trimWS(line.slice(0, colon))
        const raw = trimWS(line.slice(colon + 1))
        if (!raw) continue
        const value = trimSet(raw, '"\'')
        switch (key.toLowerCase()) {
          case 'title': case 'titulo': case 'título': title = value; metadata.title = value; break
          case 'author': case 'autor': metadata.author = value; break
          case 'date': case 'fecha': metadata.created = value; break
          case 'tags': case 'keywords': metadata.keywords = value; break
          default: break
        }
      }
      body = trimWSNL(body.slice(end + 4))
    }
  }
  const heading = firstMarkdownHeading(body)
  const finalTitle = title ?? heading ?? (fallbackTitle || L('Sin título'))
  const hasFigures = body.includes('![') || /<img\s/i.test(body)
  return {
    title: finalTitle,
    kind,
    pages: [{ number: 1, text: body, usedOCR: false, heading: heading ?? undefined, hasFigures }],
    metadata,
    warnings
  }
}

export function firstMarkdownHeading(text: string): string | null {
  let inFence = false
  let seen = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    if (++seen > 400) break
    const t = trimWS(line)
    if (t.startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    if (t.startsWith('#')) {
      const stripped = t.replace(/^#+/, '')
      if (stripped.startsWith(' ')) {
        const h = trimSet(stripped, '#', true)
        if (h) return h
      }
    }
  }
  return null
}

/** Quita espacios finales y caracteres de control, y colapsa las líneas en blanco de más. */
export function tidyText(s: string): string {
  const lines: string[] = []
  let blank = 0
  for (const raw of s.split('\n')) {
    let line = raw.replace(/[ \t ]+$/, '')
    // eslint-disable-next-line no-control-regex
    line = line.replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, '')
    if (!line) { blank++; if (blank <= 1) lines.push('') } else { blank = 0; lines.push(line) }
  }
  return trimWSNL(lines.join('\n'))
}

// MARK: RTF

export async function extractRTF(path: string, ctx: IngestContext): Promise<SourceDocument> {
  const data = readTextFile(path)
  ctx.progress.report(0.3, L('Leyendo el documento RTF…'))
  const meta: Record<string, string> = {}
  const parsed = rtfText(data)
  if (parsed.title) meta.title = parsed.title
  if (parsed.author) meta.author = parsed.author
  if (!parsed.text && !Buffer.from(data.subarray(0, 64)).toString('latin1').includes('{\\rtf')) throw corrupt(L('no es un documento RTF válido'))
  const cleaned = tidyText(normalizeNewlines(parsed.text).replace(/\u2028/g, '\n').replace(/\u2029/g, '\n\n').replace(/￼/g, ''))
  if (!cleaned) ctx.warnings.add(L('El documento RTF no contiene texto.'))
  const title = usableTitle(meta.title)
  const doc = buildTextDocument(cleaned, 'rtf', ctx.fallbackTitle, meta, ctx.warnings.all)
  if (title) doc.title = title
  return doc
}

const IGNORED_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'object', 'datafield', 'themedata',
  'colorschememapping', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'fldinst', 'bkmkstart', 'bkmkend', 'template', 'private', 'revtbl',
  'mmathPr', 'wgrffmtfilter', 'factoidname', 'info'])

/** Profundidad máxima de grupos `{…}` que se siguen (los de más se cuentan sin ocupar memoria). */
export const RTF_MAX_GROUP_DEPTH = 4_096

const CP1252_HIGH = [0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178]

function cp1252(b: number): number {
  if (b >= 0xa0 || b < 0x80) return b
  return CP1252_HIGH[b - 0x80]
}

function hex(b: number): number | null {
  if (b >= 48 && b <= 57) return b - 48
  if (b >= 65 && b <= 70) return b - 55
  if (b >= 97 && b <= 102) return b - 87
  return null
}

const isLetterByte = (b: number): boolean => (b >= 65 && b <= 90) || (b >= 97 && b <= 122)

/** Texto de un RTF. Tolera bytes de 8 bits sin escapar (UTF-8 si es válido; si no, Windows-1252). */
export function rtfText(bytes: Uint8Array): { text: string; title: string | null; author: string | null } {
  const n = bytes.length
  const out: string[] = []
  let outChunk = ''
  let title: string | null = null, author: string | null = null
  const stack: Array<{ ignore: boolean; destination: string | null }> = [{ ignore: false, destination: null }]
  let overflowDepth = 0
  let destBuffer = ''
  let unicodeSkip = 1
  let skipPending = 0
  let highSurrogate: number | null = null
  let i = 0

  const emit = (u: number): void => {
    const top = stack[stack.length - 1]
    const ch = String.fromCodePoint(u)
    if (top.destination !== null) destBuffer += ch
    else if (!top.ignore) {
      outChunk += ch
      if (outChunk.length > 16384) { out.push(outChunk); outChunk = '' }
    }
  }

  while (i < n) {
    const b = bytes[i]
    if (skipPending > 0 && b !== 92 && b !== 123 && b !== 125) { skipPending--; i++; continue }
    if (b === 123) {
      if (stack.length >= RTF_MAX_GROUP_DEPTH) overflowDepth++
      else stack.push({ ignore: stack[stack.length - 1].ignore, destination: null })
      i++
    } else if (b === 125) {
      if (overflowDepth > 0) overflowDepth--
      else if (stack.length > 1) {
        const g = stack.pop() as { ignore: boolean; destination: string | null }
        if (g.destination !== null) {
          const value = trimWSNL(destBuffer)
          if (g.destination === 'title' && title === null) title = value
          else if (g.destination === 'author' && author === null) author = value
          destBuffer = ''
        }
      }
      i++
    } else if (b === 92) {
      i++
      if (i >= n) break
      const c = bytes[i]
      if (c === 39) {
        // \'hh
        if (skipPending > 0) { skipPending--; i += Math.min(3, n - i) }
        else {
          const h = i + 2 < n ? hex(bytes[i + 1]) : null, l = i + 2 < n ? hex(bytes[i + 2]) : null
          if (h !== null && l !== null) { emit(cp1252((h << 4) | l)); i += 3 } else i++
        }
      } else if (c === 42) {
        // \* destino opcional
        stack[stack.length - 1].ignore = true
        i++
      } else if (isLetterByte(c)) {
        let j = i
        while (j < n && isLetterByte(bytes[j])) j++
        const word = Buffer.from(bytes.subarray(i, j)).toString('latin1')
        let k = j
        let param: number | null = null
        if (k < n && (bytes[k] === 45 || (bytes[k] >= 48 && bytes[k] <= 57))) {
          const neg = bytes[k] === 45
          if (neg) k++
          let v = 0
          let digits = 0
          // Se consumen todas las cifras; un parámetro de más de 9 cifras no es válido
          while (k < n && bytes[k] >= 48 && bytes[k] <= 57) {
            if (digits < 9) v = v * 10 + (bytes[k] - 48)
            digits++
            k++
          }
          if (digits > 0 && digits <= 9) param = neg ? -v : v
        }
        if (k < n && bytes[k] === 32) k++
        i = k
        if (word !== 'u') highSurrogate = null
        switch (word) {
          case 'par': case 'line': case 'sect': case 'page': case 'row': emit(10); break
          case 'tab': emit(9); break
          case 'cell': emit(32); break
          case 'emdash': emit(0x2014); break
          case 'endash': emit(0x2013); break
          case 'bullet': emit(0x2022); break
          case 'lquote': emit(0x2018); break
          case 'rquote': emit(0x2019); break
          case 'ldblquote': emit(0x201c); break
          case 'rdblquote': emit(0x201d); break
          case 'uc': unicodeSkip = Math.min(Math.max(0, param ?? 1), 8); break
          case 'u': {
            // \uN es un entero de 16 bits con signo (los negativos son U+8000…U+FFFF)
            if (param !== null && param >= -32_768 && param <= 65_535) {
              const unit = param < 0 ? param + 65_536 : param
              if (unit >= 0xd800 && unit <= 0xdbff) highSurrogate = unit
              else if (unit >= 0xdc00 && unit <= 0xdfff) {
                if (highSurrogate !== null) emit(0x10000 + ((highSurrogate - 0xd800) << 10) + (unit - 0xdc00))
                highSurrogate = null
              } else {
                highSurrogate = null
                emit(unit)
              }
              skipPending = unicodeSkip
            }
            break
          }
          case 'title': case 'author': stack[stack.length - 1].destination = word; break
          default: if (IGNORED_DESTINATIONS.has(word)) stack[stack.length - 1].ignore = true
        }
      } else {
        switch (c) {
          case 126: emit(0xa0); break
          case 95: emit(0x2d); break
          case 45: break
          case 92: case 123: case 125: emit(c); break
          case 10: case 13: emit(10); break
          default: break
        }
        i++
      }
    } else if (b === 10 || b === 13) {
      i++
    } else if (b < 128) {
      emit(b)
      i++
    } else {
      // Byte de 8 bits sin escapar: UTF-8 si forma una secuencia válida; si no, Windows-1252
      const need = b >= 0xf0 && b <= 0xf4 ? 4 : b >= 0xe0 ? 3 : b >= 0xc2 && b <= 0xdf ? 2 : 0
      let decoded: string | null = null
      if (need > 0 && i + need <= n) {
        let ok = true
        for (let q = 1; q < need; q++) if ((bytes[i + q] & 0xc0) !== 0x80) { ok = false; break }
        if (ok) decoded = strictUTF8(bytes.subarray(i, i + need))
      }
      if (decoded) { emit(decoded.codePointAt(0) ?? 0xfffd); i += need }
      else { emit(cp1252(b)); i++ }
    }
  }
  out.push(outChunk)
  return { text: out.join(''), title, author }
}
