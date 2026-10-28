// Punto de extensión para la búsqueda híbrida (palabras + significado), como EmbedKit/AulaSemantic de la app Swift.
// El modelo de vectores queda fuera: aquí está el contrato (`Embedder`, `VectorSearcher`) y la fusión (Reciprocal Rank Fusion).
import type { SourceChunk, SourceHit } from '@shared/ingest'

/** Tipo de texto que se convierte en vector (algunos modelos usan instrucciones distintas para cada uno). */
export type EmbeddingRole = 'query' | 'question' | 'document'

/** Modelo de vectores (p. ej. EmbeddingGemma). Lo implementa otro servicio; la búsqueda funciona sin él. */
export interface Embedder {
  /** Identificador del modelo y su versión (los vectores de modelos distintos no se mezclan). */
  readonly modelID: string
  readonly dimensions: number
  embed(texts: string[], role: EmbeddingRole, signal?: AbortSignal): Promise<Float32Array[]>
}

/** Un resultado de la búsqueda por vectores. */
export interface VectorHit {
  id: string
  sourceID: string
  /** Coseno con la consulta (de −1 a 1). */
  score: number
}

/** Índice de vectores de un curso: busca los fragmentos más parecidos a una consulta. */
export interface VectorSearcher {
  search(query: string, options: { role: EmbeddingRole; limit: number; sourceIDs?: Iterable<string>; signal?: AbortSignal }): Promise<VectorHit[]>
}

export interface FusedResult {
  id: string
  /** Puntuación RRF. */
  score: number
  /** Puesto en la lista de palabras (1 = el primero), si salió. */
  lexicalRank?: number
  semanticRank?: number
  /** Coseno con la consulta, si salió en la lista de vectores. */
  semanticScore?: number
}

export interface HybridOptions {
  /** Constante de suavizado de RRF (más alta = los primeros puestos pesan menos). 60 por defecto (Cormack et al., 2009). */
  k?: number
  lexicalWeight?: number
  semanticWeight?: number
  /** Un fragmento que solo trae la lista de vectores entra si su coseno llega a esto. Sin valor: siempre entra. */
  minSemanticOnlyScore?: number
  limit?: number
}

/**
 * Fusiona los ids de BM25 (en su orden) con los resultados de vectores: cada lista aporta `peso / (k + puesto)`.
 * Los ids repetidos dentro de una lista cuentan una vez (en su mejor puesto). Port de `HybridRanker.fuse`.
 */
export function fuseRankings(lexical: string[], semantic: VectorHit[], options: HybridOptions = {}): FusedResult[] {
  const k = Math.max(0, options.k ?? 60)
  const lw = Math.max(0, options.lexicalWeight ?? 1)
  const sw = Math.max(0, options.semanticWeight ?? 1)
  const limit = options.limit ?? 8
  const byID = new Map<string, FusedResult>()
  const order: string[] = []
  const entry = (id: string): FusedResult => {
    let r = byID.get(id)
    if (!r) { r = { id, score: 0 }; byID.set(id, r); order.push(id) }
    return r
  }
  let rank = 0
  for (const id of lexical) {
    const r = entry(id)
    if (r.lexicalRank !== undefined) continue
    rank++
    r.lexicalRank = rank
    r.score += lw / (k + rank)
  }
  rank = 0
  for (const hit of semantic) {
    const r = entry(hit.id)
    if (r.semanticRank !== undefined) continue
    rank++
    r.semanticRank = rank
    r.semanticScore = hit.score
    r.score += sw / (k + rank)
  }
  let results = order.map((id) => byID.get(id) as FusedResult)
  const min = options.minSemanticOnlyScore
  if (min !== undefined) results = results.filter((r) => r.lexicalRank !== undefined || (r.semanticScore ?? -1) >= min)
  const BIG = Number.MAX_SAFE_INTEGER
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const ba = Math.min(a.lexicalRank ?? BIG, a.semanticRank ?? BIG), bb = Math.min(b.lexicalRank ?? BIG, b.semanticRank ?? BIG)
    if (ba !== bb) return ba - bb
    const la = a.lexicalRank ?? BIG, lb = b.lexicalRank ?? BIG
    if (la !== lb) return la - lb
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return results.slice(0, Math.max(0, limit))
}

/** RRF general sobre varias listas de ids con sus pesos. */
export function reciprocalRankFusion(lists: string[][], weights?: number[], k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  lists.forEach((list, l) => {
    const w = weights !== undefined && l < weights.length ? weights[l] : 1
    const seen = new Set<string>()
    let rank = 0
    for (const id of list) {
      if (seen.has(id)) continue
      seen.add(id)
      rank++
      scores.set(id, (scores.get(id) ?? 0) + w / (k + rank))
      if (!firstSeen.has(id)) firstSeen.set(id, firstSeen.size)
    }
  })
  return [...scores.entries()].map(([id, score]) => ({ id, score }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0)))
}

/**
 * Búsqueda híbrida: fusiona los resultados de BM25 con los de vectores. Los que vienen de BM25 conservan su fragmento
 * resaltado (con la puntuación RRF); los que solo trae la lista de vectores se completan con `lookup` (el fragmento del
 * curso) y llevan como fragmento sus primeros 260 caracteres. Como `LiveSemantic.hybrid` de la app Swift.
 */
export function hybridSearch(
  bm25Results: SourceHit[],
  vectorResults: VectorHit[],
  lookup: (chunkID: string, sourceID: string) => (SourceChunk & { sourceTitle?: string }) | null | undefined,
  options: HybridOptions = {}
): SourceHit[] {
  if (vectorResults.length === 0) return bm25Results.slice(0, options.limit ?? 8)
  const fused = fuseRankings(bm25Results.map((h) => h.chunkID), vectorResults, options)
  const byID = new Map<string, SourceHit>()
  for (const h of bm25Results) if (!byID.has(h.chunkID)) byID.set(h.chunkID, h)
  const out: SourceHit[] = []
  for (const r of fused) {
    const lexical = byID.get(r.id)
    if (lexical) { out.push({ ...lexical, score: r.score }); continue }
    const hit = vectorResults.find((v) => v.id === r.id)
    const c = hit ? lookup(r.id, hit.sourceID) : null
    if (!c) continue
    const s: SourceHit = { chunkID: c.id, sourceID: c.sourceID, snippet: Array.from(c.text).slice(0, 260).join(''), score: r.score }
    if (c.sourceTitle !== undefined) s.sourceTitle = c.sourceTitle
    if (c.page !== undefined) s.page = c.page
    if (c.pageEnd !== undefined) s.pageEnd = c.pageEnd
    if (c.heading !== undefined) s.heading = c.heading
    out.push(s)
  }
  return out
}
