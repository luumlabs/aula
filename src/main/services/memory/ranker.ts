// Memoria · búsqueda híbrida (port de MemoryRanker.swift, adaptado de Luna): similitud + recencia + confianza + palabras con IDF,
// suelo relativo al mejor candidato y sin gemelos. Sin modelo de vectores, por palabras con IDF + recencia + confianza.
import { contentHash, contentTokens, cosine, entities, hardTokens, NEGATION, fold } from '@engine/assistant'
import { kindTitle, type MemoryHit, type MemoryRecord } from './models'

export const RANK_WEIGHTS = {
  semantic: 0.55, lexical: 0.25, recency: 0.1, confidence: 0.1,
  /** Sin vectores. */
  lexicalOnly: 0.7, recencyOnly: 0.15, confidenceOnly: 0.15,
  /** Lo del curso del que se habla. */
  sameCourse: 0.08
}
/** Vida media de la recencia: un hecho del estudiante no envejece deprisa. */
export const HALF_LIFE_DAYS = 120
const SEMANTIC_FLOOR = 0.6, SEMANTIC_SPAN = 0.25
const SEMANTIC_ONLY_MIN = 0.7, RELATIVE_MARGIN = 0.05
const TWIN = 0.95
/** Relevancia frente a variedad al elegir (λ de Luna: 0 = solo variedad, 1 = solo relevancia). */
export const MMR_LAMBDA = 0.72

export function recency(iso: string, now: Date): number {
  const t = Date.parse(iso)
  const days = Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 86_400_000) : 0
  return Math.pow(0.5, days / HALF_LIFE_DAYS)
}

/** Términos de la consulta: palabras de contenido y datos duros (sin la marca de polaridad). */
export function queryTerms(q: string): Set<string> {
  const out = contentTokens(q)
  for (const h of hardTokens(q)) if (h !== NEGATION) out.add(fold(h))
  return out
}

function recordTerms(r: MemoryRecord): Set<string> {
  const t = queryTerms(r.text)
  if (r.courseTitle) for (const x of contentTokens(r.courseTitle)) t.add(x)
  for (const x of contentTokens(kindTitle(r.kind))) t.add(x)
  return t
}

function termMatches(term: string, set: Set<string>): boolean {
  if (set.has(term)) return true
  if (Array.from(term).length < 5) return false
  const p = term.slice(0, 5)
  for (const x of set) if (Array.from(x).length >= 5 && x.startsWith(p)) return true
  return false
}

export function rankMemories(query: string, records: readonly MemoryRecord[], vectors: ReadonlyMap<string, number[]>, queryVector: number[] | undefined, now: Date,
  courseID?: string): MemoryHit[] {
  if (!records.length) return []
  const w = RANK_WEIGHTS
  const q = queryTerms(query)
  const docTerms = records.map(recordTerms)
  // IDF sobre los propios recuerdos: una palabra que está en todos no distingue a ninguno
  const df = new Map<string, number>()
  for (const t of docTerms) for (const x of t) df.set(x, (df.get(x) ?? 0) + 1)
  const n = records.length
  const idf = (t: string): number => Math.log(1 + n / (1 + (df.get(t) ?? 0))) + 0.05
  let qWeight = 0
  for (const t of q) qWeight += idf(t)
  const scored: MemoryHit[] = []
  let bestSem = 0
  records.forEach((r, i) => {
    let lex = 0
    if (qWeight > 0) {
      let s = 0
      for (const t of q) if (termMatches(t, docTerms[i])) s += idf(t)
      lex = s / qWeight
    }
    let sem: number | undefined
    const v = vectors.get(r.id)
    if (queryVector && v && v.length === queryVector.length) sem = cosine(queryVector, v)
    if (sem !== undefined) bestSem = Math.max(bestSem, sem)
    const rec = recency(r.updatedAt, now)
    let score: number
    if (sem !== undefined) {
      const sn = Math.min(1, Math.max(0, (sem - SEMANTIC_FLOOR) / SEMANTIC_SPAN))
      score = w.semantic * sn + w.lexical * lex + w.recency * rec + w.confidence * r.confidence
    } else {
      score = w.lexicalOnly * lex + w.recencyOnly * rec + w.confidenceOnly * r.confidence
    }
    if (courseID && r.courseID === courseID) score += w.sameCourse
    const hit: MemoryHit = { record: r, score, lexical: lex }
    if (sem !== undefined) hit.semantic = sem
    scored.push(hit)
  })
  // relevancia: comparte palabras con la consulta, o se parece de verdad por significado
  const relevant = scored.filter((h) => h.lexical > 0 || (h.semantic !== undefined && h.semantic >= SEMANTIC_ONLY_MIN && h.semantic >= bestSem - RELATIVE_MARGIN))
  // sin gemelos: dos recuerdos casi idénticos gastan contexto sin aportar nada
  const out: MemoryHit[] = []
  for (const h of relevant.sort((a, b) => b.score - a.score)) {
    const hv = vectors.get(h.record.id)
    const twin = out.some((o) => {
      const ov = vectors.get(o.record.id)
      if (hv && ov && hv.length === ov.length) return cosine(hv, ov) >= TWIN
      return contentHash(o.record.text) === contentHash(h.record.text)
    })
    if (!twin) out.push(h)
  }
  return out
}

/** Jaccard de dos conjuntos (0…1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n / (a.size + b.size - n)
}

/**
 * Relevancia marginal máxima (port de `LunaMemory._mmr`, backend/luna/memory.py): de los mejores candidatos elige `limit`
 * penalizando al que repite lo ya elegido, para no gastar el contexto en cinco frases que dicen lo mismo. El parecido entre dos
 * recuerdos es el coseno de sus vectores si los dos lo tienen y, si no, el Jaccard de sus entidades (datos duros y palabras
 * largas). Un gemelo (≥ 0,95) de algo ya elegido nunca entra: mejor devolver menos.
 */
export function diversify(hits: readonly MemoryHit[], vectors: ReadonlyMap<string, number[]>, limit: number): MemoryHit[] {
  const pool = hits.slice(0, Math.max(limit * 4, 20))
  const ents = pool.map((h) => entities(h.record.text))
  const vecs = pool.map((h) => vectors.get(h.record.id))
  const chosen: number[] = []
  const left = pool.map((_, i) => i)
  while (left.length && chosen.length < limit) {
    let best = -1
    let bestVal = -Infinity
    for (const i of left) {
      let red = 0
      for (const j of chosen) {
        const vi = vecs[i], vj = vecs[j]
        const sim = vi && vj && vi.length === vj.length ? cosine(vi, vj) : jaccard(ents[i], ents[j])
        red = Math.max(red, sim)
      }
      if (red >= TWIN) continue
      const val = MMR_LAMBDA * pool[i].score - (1 - MMR_LAMBDA) * red
      if (val > bestVal) { bestVal = val; best = i }
    }
    if (best < 0) break
    chosen.push(best)
    left.splice(left.indexOf(best), 1)
  }
  return chosen.map((i) => pool[i])
}
