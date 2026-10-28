// Búsqueda en los materiales de un curso (`Packs/<curso>/sources/`). El índice BM25 se guarda en `sources/index.json`
// (caché versionada de los `chunks.json`) y se reconstruye solo cuando cambia el material, como `LiveSearcher` de Swift.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SourceChunk, SourceHit } from '@shared/ingest'
import { writeFileAtomic } from '../fs'
import { log } from '../log'
import { allChunks, chunksSignature, readPackSources, searchIndexPath } from '../ingest/packFiles'
import { decodeIndexChunks, SearchIndex } from './searchIndex'
import { hybridSearch, type EmbeddingRole, type HybridOptions, type VectorSearcher } from './hybrid'

export interface CourseSearchOptions {
  /** Máximo de resultados (8 por defecto). */
  limit?: number
  /** Solo en estas fuentes. */
  sourceIDs?: Iterable<string>
  /** Búsqueda por significado (opcional): se fusiona con BM25 con RRF. */
  vectors?: VectorSearcher
  /** Tipo de consulta para el modelo de vectores («question» si es una pregunta). */
  role?: EmbeddingRole
  hybrid?: HybridOptions
  signal?: AbortSignal
}

interface CacheEntry { signature: string; index: SearchIndex }

const cache = new Map<string, CacheEntry>()
const MAX_CACHED_COURSES = 8

/** Olvida los índices en memoria (de un curso o de todos). */
export function invalidateCourseIndex(packDir?: string): void {
  if (packDir === undefined) cache.clear()
  else cache.delete(resolve(packDir))
}

/** ¿El índice de materiales del curso ya está en memoria y al día? (para saber si cargarlo es instantáneo). */
export function isCourseIndexReady(packDir: string): boolean {
  const hit = cache.get(resolve(packDir))
  return !!hit && hit.signature === chunksSignature(packDir).signature
}

/** Índice BM25 del curso, al día con sus `chunks.json`. */
export function loadCourseIndex(packDir: string): SearchIndex {
  const key = resolve(packDir)
  const { signature, newest } = chunksSignature(packDir)
  const hit = cache.get(key)
  if (hit && hit.signature === signature) {
    // el usado más recientemente pasa al final (se olvida el que lleva más tiempo sin usarse)
    cache.delete(key)
    cache.set(key, hit)
    return hit.index
  }

  let index: SearchIndex | null = null
  const path = searchIndexPath(packDir)
  try {
    const st = statSync(path)
    if (st.mtimeMs >= newest) {
      const chunks = decodeIndexChunks(readFileSync(path))
      if (sameSources(chunks, packDir)) index = new SearchIndex(chunks)
    }
  } catch {
    index = null                           // sin índice guardado, de otra versión o dañado: se reconstruye
  }
  if (!index) {
    index = new SearchIndex(allChunks(packDir))
    saveCourseIndex(packDir, index)
  }
  cache.set(key, { signature: chunksSignature(packDir).signature, index })
  while (cache.size > MAX_CACHED_COURSES) cache.delete(cache.keys().next().value as string)
  return index
}

/** ¿El índice guardado tiene exactamente las fuentes del curso? */
function sameSources(chunks: SourceChunk[], packDir: string): boolean {
  const inIndex = new Set(chunks.map((c) => c.sourceID))
  const expected = new Set(allChunks(packDir).map((c) => c.sourceID))
  if (inIndex.size !== expected.size) return false
  for (const s of expected) if (!inIndex.has(s)) return false
  return true
}

/** Guarda el índice en `sources/index.json` (escritura atómica; un fallo solo se apunta en el registro). */
export function saveCourseIndex(packDir: string, index: SearchIndex): void {
  try {
    writeFileAtomic(searchIndexPath(packDir), index.data())
  } catch (e) {
    log.warn('search: no se pudo guardar sources/index.json', e)
  }
}

/** Reconstruye y guarda el índice del curso (tras importar o borrar un material). */
export function rebuildCourseIndex(packDir: string): SearchIndex {
  invalidateCourseIndex(packDir)
  const index = new SearchIndex(allChunks(packDir))
  saveCourseIndex(packDir, index)
  cache.set(resolve(packDir), { signature: chunksSignature(packDir).signature, index })
  return index
}

/**
 * Busca en los materiales del curso. Devuelve fragmentos con su fuente, página, título de sección y un fragmento de texto
 * con las coincidencias marcadas con `**…**` (los asteriscos del material llegan como «∗»).
 */
export async function searchCourse(packDir: string, query: string, options: CourseSearchOptions = {}): Promise<SourceHit[]> {
  const limit = Math.max(0, Math.floor(options.limit ?? 8))
  if (limit === 0) return []
  const index = loadCourseIndex(packDir)
  const titles = new Map<string, string>()
  for (const s of readPackSources(packDir) ?? []) if (!titles.has(s.id) && typeof s.title === 'string') titles.set(s.id, s.title)
  const pool = options.vectors ? Math.min(36, limit * 3) : limit
  const lexical: SourceHit[] = index.search(query, { limit: pool, sourceIDs: options.sourceIDs }).map((h) => {
    const hit: SourceHit = { chunkID: h.chunk.id, sourceID: h.chunk.sourceID, snippet: h.snippet, score: h.score }
    const title = titles.get(h.chunk.sourceID)
    if (title !== undefined) hit.sourceTitle = title
    if (h.chunk.page !== undefined) hit.page = h.chunk.page
    if (h.chunk.pageEnd !== undefined) hit.pageEnd = h.chunk.pageEnd
    if (h.chunk.heading !== undefined) hit.heading = h.chunk.heading
    return hit
  })
  if (!options.vectors) return lexical.slice(0, limit)
  let vectorHits
  try {
    vectorHits = await options.vectors.search(query, {
      role: options.role ?? (query.includes('?') ? 'question' : 'query'),
      limit: Math.max(limit * 3, 12),
      sourceIDs: options.sourceIDs,
      signal: options.signal
    })
  } catch (e) {
    log.warn('search: falló la búsqueda por significado; se usa solo BM25', e)
    return lexical.slice(0, limit)
  }
  const byID = new Map(index.chunks.map((c) => [c.id, c] as const))
  return hybridSearch(lexical, vectorHits, (id) => {
    const c = byID.get(id)
    if (!c) return null
    const title = titles.get(c.sourceID)
    return title !== undefined ? { ...c, sourceTitle: title } : c
  }, { ...options.hybrid, limit })
}

/** El fragmento sin las marcas de resaltado, con los asteriscos del material devueltos (para la IA). */
export function plainSnippet(snippet: string): string {
  return snippet.split('**').join('').replace(/∗/g, '*')
}
