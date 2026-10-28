// Índice de búsqueda BM25 (k1 = 1,2; b = 0,75) sobre fragmentos, como SearchIndex.swift: sin tildes ni mayúsculas, sin
// palabras vacías, raíz ligera, números y fórmulas como términos, frases entre comillas, prefijos (`deriv*`) y respaldo por
// bigramas para las preguntas CJK sin espacios. Resultados deterministas.
import * as zlib from 'node:zlib'
import type { SourceChunk } from '@shared/ingest'
import { corrupt, tooLarge } from '../ingest/errors'
import { L } from '../ingest/messages'
import { charCount } from '../ingest/text/unicode'
import {
  codePoints, containsCJK, fold, fromCodePoints, isAlphabeticCP, isSingleCJK, isWhitespaceCP, stemWord, STOPWORDS, terms, tokenize,
  withoutScripts, withoutSuperscripts, type Token
} from './text'

/** Un resultado: el fragmento, su puntuación BM25 y ≈ 200 caracteres alrededor de la coincidencia con `**negrita**`. */
export interface SearchHit {
  chunk: SourceChunk
  score: number
  snippet: string
}

export interface SearchOptions {
  limit?: number
  /** Si se indica, solo se busca en esas fuentes. */
  sourceIDs?: Iterable<string>
}

interface Posting { doc: number; tf: number }
interface Doc { chunk: SourceChunk; length: number }
interface Analysis { counts: Map<string, number>; length: number }

const K1 = 1.2
const B = 0.75

export class SearchIndex {
  private docs: Array<Doc | null> = []
  private lengths: number[] = []
  private byChunkID = new Map<string, number>()
  private bySource = new Map<string, Set<number>>()
  private postings = new Map<string, Posting[]>()
  private liveCount = 0
  private totalLength = 0
  private sortedTermsCache: string[] | null = null

  constructor(chunks: SourceChunk[] = []) {
    this.add(chunks)
  }

  /** Número de fragmentos indexados. */
  get count(): number {
    return this.liveCount
  }

  /** Todos los fragmentos, en orden de alta. */
  get chunks(): SourceChunk[] {
    const out: SourceChunk[] = []
    for (const d of this.docs) if (d) out.push(d.chunk)
    return out
  }

  // MARK: Altas y bajas

  /** Añade fragmentos. Si ya existe uno con el mismo `id`, se sustituye. */
  add(chunks: SourceChunk[]): void {
    if (chunks.length === 0) return
    const existing: number[] = []
    for (const c of chunks) { const id = this.byChunkID.get(c.id); if (id !== undefined) existing.push(id) }
    if (existing.length) this.removeDocs(new Set(existing))
    for (const chunk of chunks) {
      const old = this.byChunkID.get(chunk.id)
      if (old !== undefined) this.removeDocs(new Set([old]))          // ids repetidos dentro de la misma tanda
      const analysis = analyze(chunk)
      const id = this.docs.length
      this.docs.push({ chunk, length: analysis.length })
      this.lengths.push(analysis.length)
      this.byChunkID.set(chunk.id, id)
      let set = this.bySource.get(chunk.sourceID)
      if (!set) { set = new Set(); this.bySource.set(chunk.sourceID, set) }
      set.add(id)
      for (const [term, tf] of analysis.counts) {
        let list = this.postings.get(term)
        if (!list) { list = []; this.postings.set(term, list) }
        list.push({ doc: id, tf })
      }
      this.liveCount++
      this.totalLength += analysis.length
    }
    this.sortedTermsCache = null
  }

  /** Quita todos los fragmentos de una fuente. */
  remove(sourceID: string): void {
    const ids = this.bySource.get(sourceID)
    if (!ids || ids.size === 0) return
    this.removeDocs(new Set(ids))
    this.compactIfNeeded()
  }

  private removeDocs(ids: Set<number>): void {
    if (ids.size === 0) return
    for (const id of ids) {
      const d = this.docs[id]
      if (!d) continue
      this.byChunkID.delete(d.chunk.id)
      const set = this.bySource.get(d.chunk.sourceID)
      set?.delete(id)
      if (set && set.size === 0) this.bySource.delete(d.chunk.sourceID)
      this.totalLength -= d.length
      this.liveCount--
      this.docs[id] = null
      this.lengths[id] = 0
    }
    for (const [term, list] of this.postings) {
      const kept = list.filter((p) => !ids.has(p.doc))
      if (kept.length === 0) this.postings.delete(term)
      else if (kept.length !== list.length) this.postings.set(term, kept)
    }
    this.sortedTermsCache = null
  }

  /** Renumera los documentos cuando quedan muchos huecos por bajas. */
  private compactIfNeeded(): void {
    if (!(this.docs.length > 256 && this.liveCount * 2 < this.docs.length)) return
    const remap = new Int32Array(this.docs.length).fill(-1)
    const newDocs: Doc[] = []
    const newLengths: number[] = []
    this.docs.forEach((d, old) => {
      if (!d) return
      remap[old] = newDocs.length
      newDocs.push(d)
      newLengths.push(d.length)
    })
    const newByChunk = new Map<string, number>()
    const newBySource = new Map<string, Set<number>>()
    newDocs.forEach((d, i) => {
      newByChunk.set(d.chunk.id, i)
      let set = newBySource.get(d.chunk.sourceID)
      if (!set) { set = new Set(); newBySource.set(d.chunk.sourceID, set) }
      set.add(i)
    })
    for (const [term, list] of this.postings) this.postings.set(term, list.map((p) => ({ doc: remap[p.doc], tf: p.tf })))
    this.docs = newDocs
    this.lengths = newLengths
    this.byChunkID = newByChunk
    this.bySource = newBySource
  }

  // MARK: Búsqueda

  /**
   * Busca fragmentos relevantes. La consulta admite palabras sueltas, `"frases entre comillas"` (obligatorias) y prefijos
   * (`deriv*`). Una palabra CJK se busca como frase y, si no sale nada, por bigramas con BM25.
   */
  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const limit = options.limit ?? 8
    if (!(limit > 0)) return []
    const sourceIDs = options.sourceIDs !== undefined ? new Set(options.sourceIDs) : null
    if (sourceIDs && sourceIDs.size === 0) return []
    const parsed = parseQuery(query)
    if (isEmptyQuery(parsed)) return []
    if (this.liveCount === 0) return []
    const strict = this.searchParsed(parsed, Math.floor(limit), sourceIDs)
    if (strict.length || !parsed.hasCJKWords) return strict
    const relaxed = relaxedQuery(parsed)
    if (isEmptyQuery(relaxed)) return []
    return this.searchParsed(relaxed, Math.floor(limit), sourceIDs)
  }

  private searchParsed(parsed: ParsedQuery, limit: number, sourceIDs: Set<string> | null): SearchHit[] {
    const n = this.liveCount
    const avgLength = Math.max(this.totalLength / n, 1)
    const slots = this.docs.length

    // Documentos permitidos (máscara densa)
    let allowed: Uint8Array | null = null
    if (sourceIDs) {
      const mask = new Uint8Array(slots)
      let any = false
      for (const s of sourceIDs) { const ids = this.bySource.get(s); if (ids) for (const id of ids) { mask[id] = 1; any = true } }
      if (!any) return []
      allowed = mask
    }
    const isAllowed = (d: number): boolean => allowed === null || allowed[d] === 1

    // Puntuación BM25 acumulada por documento
    const accum = new Float64Array(slots)
    const touched: number[] = []
    const idf = (df: number): number => Math.log(1 + (n - df + 0.5) / (df + 0.5))
    const accumulate = (list: Posting[], weight: number, only?: Set<number>): void => {
      const w = weight * idf(list.length)
      for (const p of list) {
        const d = p.doc
        if (!isAllowed(d)) continue
        if (only && !only.has(d)) continue
        const tf = p.tf
        const norm = K1 * (1 - B + (B * this.lengths[d]) / avgLength)
        const add = (w * tf * (K1 + 1)) / (tf + norm)
        if (accum[d] === 0) touched.push(d)
        accum[d] += add
      }
    }

    // Términos sueltos y prefijos (en orden fijo para que el resultado sea determinista)
    const highlightExact = new Set<string>()
    const highlightPrefixes: string[] = []
    for (const term of parsed.exactTerms) {
      const list = this.postings.get(term)
      if (list) {
        accumulate(list, 1)
        highlightExact.add(term)
      } else if (charCount(term) >= 3 && allLetters(term)) {
        // Sin coincidencia exacta: se prueba como comienzo de palabra ("trigonom" → "trigonometría")
        for (const t of this.expandPrefix(term)) { const l = this.postings.get(t); if (l) { accumulate(l, 0.7); highlightExact.add(t) } }
        highlightPrefixes.push(term)
      }
    }
    for (const prefix of parsed.prefixes) {
      for (const t of this.expandPrefix(prefix)) { const l = this.postings.get(t); if (l) { accumulate(l, 0.9); highlightExact.add(t) } }
      highlightPrefixes.push(prefix)
    }

    // Frases: candidatos con todas sus palabras; la comprobación de que van seguidas se hace después
    let required: Set<number> | null = null
    for (const phrase of parsed.phrases) {
      let docsWithAll: Set<number> | null = null
      for (const t of phrase.indexTerms) {
        const list = this.postings.get(t)
        if (!list) return []
        const docsOfTerm = new Set<number>()
        for (const p of list) if (isAllowed(p.doc)) docsOfTerm.add(p.doc)
        docsWithAll = docsWithAll ? intersect(docsWithAll, docsOfTerm) : docsOfTerm
        if (docsWithAll.size === 0) return []
      }
      const all: Set<number> = docsWithAll ?? new Set<number>()
      required = required ? intersect(required, all) : all
      if (required.size === 0) return []
    }
    // Con una palabra CJK (frase implícita), las demás palabras también se exigen (con su comienzo de palabra)
    if (required !== null && parsed.requireAllTerms) {
      const docsOf = (term: string, prefixSearch: boolean): Set<number> | null => {
        const out = new Set<number>()
        const list = prefixSearch ? undefined : this.postings.get(term)
        if (list) {
          for (const p of list) if (isAllowed(p.doc)) out.add(p.doc)
          return out
        }
        if (!(prefixSearch || (charCount(term) >= 3 && allLetters(term)))) return null
        for (const t of this.expandPrefix(term)) {
          const l = this.postings.get(t)
          if (l) for (const p of l) if (isAllowed(p.doc)) out.add(p.doc)
        }
        return out.size ? out : null
      }
      for (const term of parsed.exactTerms) {
        const d = docsOf(term, false)
        if (!d) return []
        required = intersect(required, d)
        if (required.size === 0) return []
      }
      for (const prefix of parsed.prefixes) {
        const d = docsOf(prefix, true)
        if (!d) return []
        required = intersect(required, d)
        if (required.size === 0) return []
      }
    }
    if (required !== null) {
      for (const phrase of parsed.phrases) {
        for (const t of phrase.indexTerms) {
          const list = this.postings.get(t)
          if (list) { accumulate(list, 1.5, required); highlightExact.add(t) }
        }
      }
    }

    // Orden: puntuación y, a igualdad, fuente, ordinal e id
    const better = (a: { id: number; score: number }, b: { id: number; score: number }): boolean => {
      if (a.score !== b.score) return a.score > b.score
      const ca = this.docs[a.id]?.chunk, cb = this.docs[b.id]?.chunk
      if (!ca || !cb) return a.id < b.id
      if (ca.sourceID !== cb.sourceID) return ca.sourceID < cb.sourceID
      if (ca.ordinal !== cb.ordinal) return ca.ordinal < cb.ordinal
      return ca.id < cb.id
    }

    let chosen: Array<{ id: number; score: number }> = []
    if (required !== null) {
      // Con frases: se ordenan los candidatos y se comprueba la frase hasta tener `limit` que la cumplan
      const ranked = [...required].map((id) => ({ id, score: accum[id] })).sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
      for (const cand of ranked) {
        const chunk = this.docs[cand.id]?.chunk
        if (!chunk) continue
        const tt = tokenize(chunk.text, true).map((t) => t.term)
        const ht = chunk.heading !== undefined ? tokenize(chunk.heading, true).map((t) => t.term) : []
        if (parsed.phrases.every((p) => containsPhrase(tt, p.fullTerms) || containsPhrase(ht, p.fullTerms))) {
          chosen.push(cand)
          if (chosen.length === limit) break
        }
      }
    } else {
      // Sin frases: los `limit` mejores en una pasada
      for (const id of touched) {
        const cand = { id, score: accum[id] }
        if (!(cand.score > 0)) continue
        if (chosen.length === limit && !better(cand, chosen[chosen.length - 1])) continue
        let lo = 0, hi = chosen.length
        while (lo < hi) { const mid = (lo + hi) >> 1; if (better(chosen[mid], cand)) lo = mid + 1; else hi = mid }
        chosen.splice(lo, 0, cand)
        if (chosen.length > limit) chosen = chosen.slice(0, limit)
      }
    }

    // Los ideogramas de una palabra CJK se resaltan solo cuando van seguidos; uno buscado solo sí se resalta suelto
    const snippetExact = new Set([...highlightExact].filter((t) => !isSingleCJK(t) || parsed.cjkSingles.has(t)))
    const hits: SearchHit[] = []
    for (const cand of chosen) {
      const chunk = this.docs[cand.id]?.chunk
      if (!chunk) continue
      hits.push({ chunk, score: cand.score, snippet: snippet(chunk.text, snippetExact, highlightPrefixes, parsed.cjkSequences) })
    }
    return hits
  }

  /** Términos del vocabulario que empiezan por `prefix` (o por su raíz), los más frecuentes primero, hasta 40. */
  private expandPrefix(prefix: string): string[] {
    if (!this.sortedTermsCache) this.sortedTermsCache = [...this.postings.keys()].sort()
    const sorted = this.sortedTermsCache
    const starts = new Set([prefix])
    const stemmed = stemWord(prefix)
    if (charCount(stemmed) >= 3) starts.add(stemmed)
    const found = new Set<string>()
    for (const p of starts) {
      let lo = 0, hi = sorted.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < p) lo = mid + 1; else hi = mid }
      for (let i = lo; i < sorted.length && sorted[i].startsWith(p); i++) found.add(sorted[i])
    }
    return [...found].sort((a, b) => {
      const da = this.postings.get(a)?.length ?? 0, db = this.postings.get(b)?.length ?? 0
      return da !== db ? db - da : a < b ? -1 : a > b ? 1 : 0
    }).slice(0, 40)
  }

  // MARK: Persistencia

  /**
   * Serializa el índice: cabecera «AULA_IDX» + versión (1) + opciones + JSON `{chunks}`. Bit 1 de las opciones: JSON
   * comprimido con DEFLATE (esta versión); bit 0: LZFSE (app de macOS). Sin comprimir lo lee también la app Swift.
   */
  data(options: { compress?: boolean } = {}): Uint8Array {
    const json = Buffer.from(JSON.stringify({ chunks: this.chunks }), 'utf8')
    const head = Buffer.from(MAGIC)
    if (options.compress ?? true) {
      const packed = zlib.deflateRawSync(json, { level: 6 })
      if (packed.length < json.length) return Buffer.concat([head, Buffer.from([1, FLAG_DEFLATE]), packed])
    }
    return Buffer.concat([head, Buffer.from([1, 0]), json])
  }

  /** Reconstruye un índice guardado con `data()`. También acepta un JSON plano con la lista de fragmentos. */
  static load(data: Uint8Array, maxDecodedBytes = MAX_DECODED_BYTES): SearchIndex {
    return new SearchIndex(decodeIndexChunks(data, maxDecodedBytes))
  }
}

/** Cabecera de 8 bytes de los índices guardados (y la de versiones anteriores, que se lee igual). */
const MAGIC = 'AULA_IDX'
const LEGACY_MAGIC = 'MIMIRIDX'
const FLAG_LZFSE = 1
const FLAG_DEFLATE = 2
/** Tamaño máximo del JSON descomprimido al cargar un índice (1 GB). */
export const MAX_DECODED_BYTES = 1 << 30

function startsWithAscii(data: Uint8Array, s: string): boolean {
  if (data.length < s.length) return false
  for (let i = 0; i < s.length; i++) if (data[i] !== s.charCodeAt(i)) return false
  return true
}

/** Fragmentos de un índice guardado; lanza `corrupt`/`tooLarge` si no es válido. */
export function decodeIndexChunks(data: Uint8Array, maxDecodedBytes = MAX_DECODED_BYTES): SourceChunk[] {
  const invalid = (): Error => corrupt(L('el índice de búsqueda guardado no es válido'))
  let payload: Uint8Array
  if (startsWithAscii(data, MAGIC) || startsWithAscii(data, LEGACY_MAGIC)) {
    if (data.length < MAGIC.length + 2) throw invalid()
    const version = data[MAGIC.length], flags = data[MAGIC.length + 1]
    if (version !== 1) throw corrupt(L('el índice de búsqueda es de otra versión de la app'))
    payload = data.subarray(MAGIC.length + 2)
    if (flags & FLAG_LZFSE) throw corrupt(L('el índice de búsqueda guardado no es válido'))
    if (flags & FLAG_DEFLATE) {
      if (payload.length === 0) throw invalid()
      try {
        payload = zlib.inflateRawSync(payload, { maxOutputLength: Math.max(1, maxDecodedBytes) })
      } catch (e) {
        if (e instanceof RangeError || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge(L('el índice de búsqueda guardado ocupa demasiado'))
        throw invalid()
      }
    }
  } else {
    payload = data
  }
  if (payload.length > maxDecodedBytes) throw tooLarge(L('el índice de búsqueda guardado ocupa demasiado'))
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('utf8'))
  } catch {
    throw invalid()
  }
  const list = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === 'object' ? (parsed as { chunks?: unknown }).chunks : undefined
  if (!Array.isArray(list)) throw invalid()
  const chunks: SourceChunk[] = []
  for (const raw of list) {
    const c = validChunk(raw)
    if (!c) throw invalid()
    chunks.push(c)
  }
  return chunks
}

/** Un fragmento con el formato de `chunks.json` (claves obligatorias y tipos), o `null`. */
export function validChunk(raw: unknown): SourceChunk | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.sourceID !== 'string' || typeof o.text !== 'string') return null
  if (typeof o.ordinal !== 'number' || !Number.isInteger(o.ordinal)) return null
  const c: SourceChunk = { id: o.id, sourceID: o.sourceID, ordinal: o.ordinal, text: o.text }
  for (const k of ['page', 'pageEnd'] as const) {
    if (o[k] === undefined || o[k] === null) continue
    if (typeof o[k] !== 'number' || !Number.isInteger(o[k])) return null
    c[k] = o[k] as number
  }
  if (o.heading !== undefined && o.heading !== null) {
    if (typeof o.heading !== 'string') return null
    c.heading = o.heading
  }
  return c
}

// MARK: Análisis de fragmentos

/** Términos de un fragmento con su frecuencia. Los del título cuentan doble. */
function analyze(chunk: SourceChunk): Analysis {
  const counts = new Map<string, number>()
  const body = terms(chunk.text)
  for (const t of body) counts.set(t, (counts.get(t) ?? 0) + 1)
  // Alias sin marcas voladas: «H_2O» también es «h2o»; sin el superíndice si queda una fórmula («SO_4^{2−}» → «so4»).
  // Solo los alias que no existían: contar dos veces los términos normales alteraría el BM25.
  const addAliases = (text: string, weight: number): void => {
    if (!text.includes('^') && !text.includes('_')) return
    for (const t of terms(withoutScripts(text))) if (!counts.has(t)) counts.set(t, weight)
    for (const t of terms(withoutSuperscripts(text))) if (!counts.has(t) && /\p{N}/u.test(t) && /\p{Alphabetic}/u.test(t)) counts.set(t, weight)
  }
  // Bigramas CJK para la búsqueda de respaldo; no cuentan en la longitud del fragmento
  const addBigrams = (text: string, weight: number): void => {
    if (!containsCJK(text)) return
    const ts = tokenize(text, true).map((t) => t.term)
    for (let k = 1; k < ts.length; k++) {
      if (isSingleCJK(ts[k - 1]) && isSingleCJK(ts[k])) {
        const key = ts[k - 1] + ts[k]
        counts.set(key, (counts.get(key) ?? 0) + weight)
      }
    }
  }
  addAliases(chunk.text, 1)
  addBigrams(chunk.text, 1)
  let length = body.length
  if (chunk.heading !== undefined) {
    const ht = terms(chunk.heading)
    for (const t of ht) counts.set(t, (counts.get(t) ?? 0) + 2)
    addAliases(chunk.heading, 2)
    addBigrams(chunk.heading, 2)
    length += ht.length
  }
  for (const [k, v] of counts) if (v > 65_535) counts.set(k, 65_535)
  return { counts, length: Math.min(length, 2_147_483_647) }
}

function allLetters(term: string): boolean {
  for (const ch of term) if (!isAlphabeticCP(ch.codePointAt(0) ?? 0)) return false
  return true
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  const out = new Set<number>()
  for (const x of small) if (large.has(x)) out.add(x)
  return out
}

function containsPhrase(ts: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || ts.length < phrase.length) return false
  outer: for (let i = 0; i <= ts.length - phrase.length; i++) {
    for (let k = 0; k < phrase.length; k++) if (ts[i + k] !== phrase[k]) continue outer
    return true
  }
  return false
}

// MARK: Consulta

interface PhraseQuery {
  /** Términos indexados de la frase (sin palabras vacías), para elegir candidatos. */
  indexTerms: string[]
  /** Todos los términos, con las palabras vacías, para comprobar que van seguidos. */
  fullTerms: string[]
}

interface ParsedQuery {
  exactTerms: string[]
  prefixes: string[]
  phrases: PhraseQuery[]
  /** Las frases entre comillas (obligatorias también en la búsqueda de respaldo). */
  explicitPhrases: PhraseQuery[]
  hasCJKWords: boolean
  requireAllTerms: boolean
  relaxedTerms: string[]
  relaxedSequences: string[][]
  /** Secuencias CJK de dos o más caracteres que se resaltan juntas. */
  cjkSequences: string[][]
  /** Ideogramas buscados solos: se resaltan sueltos. */
  cjkSingles: Set<string>
}

const isEmptyQuery = (q: ParsedQuery): boolean => q.exactTerms.length === 0 && q.prefixes.length === 0 && q.phrases.length === 0

const sameTerms = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** La consulta de respaldo: bigramas CJK con OR y BM25, palabras latinas opcionales, solo las frases entre comillas. */
function relaxedQuery(q: ParsedQuery): ParsedQuery {
  return {
    ...q,
    exactTerms: [...q.relaxedTerms].sort(),
    phrases: q.explicitPhrases,
    requireAllTerms: false,
    hasCJKWords: false,
    cjkSequences: [...q.cjkSequences.filter((seq) => q.explicitPhrases.some((p) => sameTerms(p.fullTerms, seq))), ...q.relaxedSequences]
  }
}

const QUOTE_MARKS = new Set(['"', '“', '”', '«', '»'])

function parseQuery(query: string): ParsedQuery {
  const q: ParsedQuery = {
    exactTerms: [], prefixes: [], phrases: [], explicitPhrases: [], hasCJKWords: false, requireAllTerms: false,
    relaxedTerms: [], relaxedSequences: [], cjkSequences: [], cjkSingles: new Set()
  }
  let outside = ''
  let phraseText = ''
  let inQuote = false
  const closePhrase = (): void => {
    const index = terms(phraseText)
    // Una frase solo de palabras vacías ("de la") no se puede buscar y se ignora
    if (index.length) {
      const phrase: PhraseQuery = { indexTerms: index, fullTerms: tokenize(phraseText, true).map((t) => t.term) }
      q.phrases.push(phrase)
      q.explicitPhrases.push(phrase)
      if (phrase.fullTerms.some(isSingleCJK)) q.cjkSequences.push(phrase.fullTerms)
    }
    phraseText = ''
  }
  for (const ch of query) {
    if (QUOTE_MARKS.has(ch)) {
      if (inQuote) closePhrase()
      inQuote = !inQuote
      outside += ' '
    } else if (inQuote) phraseText += ch
    else outside += ch
  }
  if (inQuote) closePhrase()

  const seen = new Set<string>()
  const relaxedSeen = new Set<string>()
  const addRelaxed = (t: string): void => { if (!relaxedSeen.has(t)) { relaxedSeen.add(t); q.relaxedTerms.push(t) } }
  const addExact = (t: string): void => { if (!seen.has(t)) { seen.add(t); q.exactTerms.push(t) } }
  for (const word of outside.split(/\p{White_Space}+/u)) {
    if (!word) continue
    let w = word
    if (containsCJK(w)) {
      // Una palabra CJK se busca como frase, también si lleva `*`
      while (w.endsWith('*')) w = w.slice(0, -1)
      const full = tokenize(w, true).map((t) => t.term)
      if (full.length) {
        q.phrases.push({ indexTerms: terms(w), fullTerms: full })
        q.hasCJKWords = true
        q.requireAllTerms = true
      }
      for (const t of terms(w)) addExact(t)
      // Respaldo: cada tramo de ideogramas seguidos da sus bigramas (o el ideograma, si va solo)
      let run: string[] = []
      const flush = (): void => {
        if (run.length === 1) { addRelaxed(run[0]); q.cjkSingles.add(run[0]) }
        else if (run.length > 1) {
          q.cjkSequences.push(run)
          for (let k = 1; k < run.length; k++) {
            addRelaxed(run[k - 1] + run[k])
            q.relaxedSequences.push([run[k - 1], run[k]])
          }
        }
        run = []
      }
      for (const t of full) {
        if (isSingleCJK(t)) { run.push(t); continue }
        flush()
        if (!STOPWORDS.has(t)) addRelaxed(stemWord(t))
      }
      flush()
    } else if (w.endsWith('*') && !w.endsWith('**')) {
      while (w.endsWith('*')) w = w.slice(0, -1)
      const parts = tokenize(w, true, false)
      for (const t of parts.slice(0, -1)) {
        const s = stemWord(t.term)
        if (!STOPWORDS.has(t.term)) { addRelaxed(s); addExact(s) }
      }
      const last = parts[parts.length - 1]
      if (last) {
        const folded = fold(last.term)
        if (folded.length >= 1 && !q.prefixes.includes(folded)) q.prefixes.push(folded)
      }
    } else {
      for (const t of terms(w)) { addRelaxed(t); addExact(t) }
    }
  }
  q.exactTerms.sort()
  return q
}

// MARK: Fragmentos de texto resaltados

function snippet(text: string, exact: Set<string>, prefixes: string[], sequences: string[][], width = 200): string {
  const scalars = codePoints(text)
  // Con palabras vacías: la cola de una fórmula («H_2» + «O») puede ser una palabra vacía y hace falta para el alias
  const tokens = tokenize(text, true)
  const inSequence = new Uint8Array(tokens.length)
  for (const seq of sequences) {
    if (seq.length < 2 || seq.length > tokens.length) continue
    for (let start = 0; start <= tokens.length - seq.length; start++) {
      let ok = true
      for (let k = 0; k < seq.length; k++) if (tokens[start + k].term !== seq[k]) { ok = false; break }
      if (ok) for (let k = 0; k < seq.length; k++) inSequence[start + k] = 1
    }
  }
  const matchesPrefix = (t: string): boolean => prefixes.some((p) => t.startsWith(p))
  // Alias: los términos marcados («H_2», «O») cuentan como su forma sin marcas («h2o»), uniendo tokens contiguos
  const matches: Token[] = []
  let ti = 0
  while (ti < tokens.length) {
    const t = tokens[ti]
    if (inSequence[ti] || exact.has(t.term) || matchesPrefix(t.term)) { matches.push(t); ti++; continue }
    let flat = withoutScripts(t.term)
    let end = t.hi
    let matched = exact.has(flat) || matchesPrefix(flat)
    let tj = ti + 1
    while (!matched && tj < tokens.length && tokens[tj].lo === end && charCount(flat) < 40) {
      flat += withoutScripts(tokens[tj].term)
      end = tokens[tj].hi
      matched = exact.has(flat) || matchesPrefix(flat)
      tj++
    }
    if (matched) { matches.push({ term: flat, lo: t.lo, hi: end }); ti = tj } else ti++
  }

  // Ventana con más términos distintos
  let anchor = 0
  if (matches.length) {
    let best = -1, bestIndex = 0
    for (let a = 0; a < matches.length; a++) {
      const m = matches[a]
      const distinct = new Set<string>()
      for (let k = a; k < matches.length && matches[k].hi <= m.lo + width - 40; k++) distinct.add(matches[k].term)
      if (distinct.size > best) { best = distinct.size; bestIndex = a }
    }
    anchor = matches[bestIndex].lo
  }
  let start = Math.max(0, anchor - 40)
  let end = Math.min(scalars.length, start + width)
  if (end - start < width) start = Math.max(0, end - width)
  // A límites de palabra
  let back = 0
  while (start > 0 && back < 14 && !isWhitespaceCP(scalars[start - 1])) { start--; back++ }
  let forward = 0
  while (end < scalars.length && forward < 14 && !isWhitespaceCP(scalars[end])) { end++; forward++ }

  const out: number[] = []
  if (start > 0) out.push(0x2026)
  let idx = start
  let m = matches.findIndex((x) => x.lo >= start)
  if (m < 0) m = matches.length
  let lastSpace = true
  const put = (u: number): void => {
    if (isWhitespaceCP(u)) { if (!lastSpace) out.push(32); lastSpace = true }
    else { out.push(u === 42 ? 0x2217 : u); lastSpace = false }
  }
  while (idx < end) {
    if (m < matches.length && matches[m].lo === idx && matches[m].hi <= end) {
      out.push(42, 42)
      for (let k = matches[m].lo; k < matches[m].hi; k++) put(scalars[k])
      out.push(42, 42)
      idx = matches[m].hi
      m++
      continue
    }
    while (m < matches.length && matches[m].lo < idx) m++
    put(scalars[idx])
    idx++
  }
  // Los resaltados contiguos se funden: "**a** **b**" → "**a b**" y "**入****門**" → "**入門**"
  let result = trimSpaces(fromCodePoints(out))
  result = result.split('** **').join(' ')
  result = result.split('****').join('')
  if (end < scalars.length) result += '…'
  return result
}

function trimSpaces(s: string): string {
  return s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')
}
