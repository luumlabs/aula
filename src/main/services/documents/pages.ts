// El texto de un documento por páginas (port de DocumentPages en DocumentReading.swift): búsqueda, capítulos, extractos con
// marcas «[p. N]» para la IA y las citas. Puro (sin disco): lo carga `reading.ts`.
import type { DocumentHit, DocumentOutlineEntry } from '@shared/documents'
import type { SourceChunk } from '@shared/schema'

export interface DocumentPages {
  title: string
  /** Texto de cada página (índice 0 = página 1). */
  pages: string[]
  /** Título de cada página, si lo tiene. */
  headings: (string | undefined)[]
  outline: DocumentOutlineEntry[]
  /** Páginas que vienen del OCR. */
  ocrPages: Set<number>
}

export const MAX_PAGES = 3000

export function pageCount(doc: DocumentPages): number {
  return doc.pages.length
}

export function pageText(doc: DocumentPages, page: number): string {
  return doc.pages[page - 1] ?? ''
}

/** Texto limpio de una página: sin guiones de corte de línea, espacios repetidos ni muchas líneas en blanco. */
export function cleanPageText(s: string): string {
  let t = s.replace(/\r\n?/g, '\n')
  t = t.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
  t = t.replace(/[ \t]{2,}/g, ' ')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

/**
 * Pliega mayúsculas y diacríticos conservando la longitud (cada unidad UTF-16 da exactamente una): así las posiciones de una
 * coincidencia en el texto plegado sirven en el original.
 */
export function foldSameLength(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const code = ch.charCodeAt(0)
    if (code < 0x80) { out += ch.toLowerCase(); continue }
    if (code >= 0xd800 && code <= 0xdfff) { out += ch; continue }
    const base = ch.normalize('NFD')[0] ?? ch
    const low = base.toLowerCase()
    out += low.length === 1 ? low : base
  }
  return out
}

/** Pliega para comparar (sin mayúsculas ni diacríticos; la longitud puede cambiar). */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

function snippet(t: string, start: number, end: number, radius = 90): string {
  const a = Math.max(0, start - radius), b = Math.min(t.length, end + radius)
  let s = t.slice(a, b).replace(/\n/g, ' ')
  if (a > 0) s = '…' + s
  if (b < t.length) s += '…'
  return s
}

/** Busca (sin acentos ni mayúsculas) y devuelve cada coincidencia con su página y un trozo alrededor. */
export function searchPages(doc: DocumentPages, query: string, limit = 30): DocumentHit[] {
  const q = query.trim()
  if (Array.from(q).length < 2 && !/[぀-ヿ㐀-鿿가-힯]/.test(q)) return []
  const fq = foldSameLength(q)
  const words = fq.split(/\s+/).filter(Boolean)
  const hits: DocumentHit[] = []
  for (let i = 0; i < doc.pages.length; i++) {
    const t = doc.pages[i]
    const ft = foldSameLength(t)
    let from = 0, found = 0
    while (found < 4) {
      const at = ft.indexOf(fq, from)
      if (at < 0) break
      hits.push({ page: i + 1, snippet: snippet(t, at, at + fq.length) })
      found++
      from = at + fq.length
      if (hits.length >= limit) return hits
    }
    // todas las palabras en la página aunque no seguidas
    if (found === 0 && words.length > 1 && words.every((w) => ft.includes(w))) {
      const at = ft.indexOf(words[0])
      hits.push({ page: i + 1, snippet: snippet(t, at, at + words[0].length) })
      if (hits.length >= limit) return hits
    }
  }
  return hits
}

/** El capítulo (entrada del índice) que contiene una página: el más profundo y el último que empieza antes. */
export function chapterContaining(doc: DocumentPages, page: number): DocumentOutlineEntry | undefined {
  let best: DocumentOutlineEntry | undefined
  for (const e of doc.outline) {
    if (e.page <= page && page <= e.endPage && (!best || e.level > best.level || (e.level === best.level && e.page > best.page))) best = e
  }
  return best
}

/** Texto de un rango de páginas con marcas «[p. N]», recortado a `maxChars` (para la IA y las citas). */
export function excerpt(doc: DocumentPages, from: number, to: number, maxChars = 12_000): { text: string; lastPage: number; truncated: boolean } {
  const a = Math.max(1, from), b = Math.min(doc.pages.length, Math.max(a, to))
  if (a > b) return { text: '', lastPage: 0, truncated: false }
  let out = ''
  let last = a - 1
  for (let p = a; p <= b; p++) {
    const t = pageText(doc, p)
    const piece = `[p. ${p}]\n${t === '' ? '(—)' : t}\n\n`
    if (out.length + piece.length > maxChars) {
      if (out === '') { out = piece.slice(0, maxChars); last = p }
      return { text: out, lastPage: last, truncated: true }
    }
    out += piece
    last = p
  }
  return { text: out, lastPage: last, truncated: false }
}

/** Índice a partir de los títulos de los fragmentos (como `headings(chunks)` de Swift): un título nuevo, una entrada. */
export function outlineFromChunks(chunks: SourceChunk[], pageTotal: number): DocumentOutlineEntry[] {
  const out: DocumentOutlineEntry[] = []
  let last: string | undefined
  for (const c of chunks) {
    const h = c.heading?.trim()
    if (h && h !== last && c.page !== undefined) {
      out.push({ title: h, page: c.page, endPage: c.page, level: 0 })
      last = h
    }
  }
  const maxPage = Math.max(pageTotal, ...chunks.map((c) => c.pageEnd ?? c.page ?? 0))
  for (let i = 0; i < out.length; i++) out[i].endPage = i + 1 < out.length ? Math.max(out[i].page, out[i + 1].page - 1) : Math.max(out[i].page, maxPage)
  return out.slice(0, 400)
}

/** Índice a partir de los títulos de las páginas (sin repetir el de la página anterior). */
export function outlineFromHeadings(headings: (string | undefined)[]): DocumentOutlineEntry[] {
  const out: DocumentOutlineEntry[] = []
  let last: string | undefined
  headings.forEach((h, i) => {
    const t = h?.trim()
    if (t && t !== last && Array.from(t).length <= 120) out.push({ title: t, page: i + 1, endPage: i + 1, level: 0 })
    if (t) last = t
  })
  for (let i = 0; i < out.length; i++) out[i].endPage = i + 1 < out.length ? Math.max(out[i].page, out[i + 1].page - 1) : Math.max(out[i].page, headings.length)
  return out.slice(0, 400)
}

/** Páginas a partir de los fragmentos (Swift): por su página si la tienen; si no, «páginas» de unos 3 000 caracteres. */
export function pagesFromChunks(title: string, raw: SourceChunk[]): DocumentPages | undefined {
  const chunks = [...raw].sort((a, b) => a.ordinal - b.ordinal)
  if (!chunks.length) return undefined
  if (chunks.some((c) => c.page !== undefined)) {
    // al menos una página: con `page` 0 o negativo (fragmentos dañados) el arreglo tenía tamaño negativo
    const last = Math.max(1, ...chunks.map((c) => c.pageEnd ?? c.page ?? 1))
    const pages: string[] = Array.from({ length: Math.min(last, MAX_PAGES) }, () => '')
    let carry = 1
    for (const c of chunks) {
      const p = Math.min(Math.max(1, c.page ?? carry), pages.length)
      carry = p
      pages[p - 1] += (pages[p - 1] === '' ? '' : '\n\n') + c.text
    }
    return { title, pages, headings: pages.map(() => undefined), outline: outlineFromChunks(chunks, pages.length), ocrPages: new Set() }
  }
  const pages: string[] = []
  let current = ''
  for (const c of chunks) {
    if (current.length + c.text.length > 3000 && current !== '') { pages.push(current); current = '' }
    current += (current === '' ? '' : '\n\n') + c.text
  }
  if (current !== '') pages.push(current)
  return { title, pages: pages.slice(0, MAX_PAGES), headings: pages.map(() => undefined), outline: [], ocrPages: new Set() }
}

/** «Páginas» de 3 000 caracteres de un texto largo (recorriéndolo una sola vez). */
export function pagesFromText(title: string, text: string): DocumentPages {
  const pages: string[] = []
  for (let i = 0; i < text.length && pages.length < MAX_PAGES; i += 3000) pages.push(text.slice(i, i + 3000))
  if (!pages.length) pages.push('')
  return { title, pages, headings: pages.map(() => undefined), outline: [], ocrPages: new Set() }
}
