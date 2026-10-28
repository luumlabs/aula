// Leer materiales y calcular (port de ResearchTools.swift y de las herramientas de cálculo): `list_sources`, `search_sources`,
// `read_source` sobre un almacén de materiales (los del curso en el tutor; los adjuntos en el chat), `calculate` y `chemistry`.
// Lo que se lee de un material va dentro de la valla anti-inyección: es DATO, nunca órdenes para la IA.
import { wrapUntrusted } from '@engine/base/untrustedFence'
import { LiveCalculator } from '@engine/math/services'
import { runChemistryTool, CHEMISTRY_TOOL } from '@engine/chem/chemistry-tool'
import type { JSONObject, JSONSchema } from '@shared/ai/json'
import type { SourceChunk, SourceHit } from '@shared/ingest'
import type { AgentTool } from '../../ai/model'
import { plainSnippet, searchCourse } from '../../search/course'
import type { VectorSearcher } from '../../search/hybrid'
import type { PackStore } from '../../store/packStore'
import { outError, outJSON, Schema, tool, type ToolArgs } from '../toolkit'

function safePack(store: PackStore) {
  try { return store.loadPack() } catch { return undefined }
}

export function listSourcesTool(store: () => PackStore, name = 'list_sources', description = 'List the study materials the user gave for this course (PDFs, notes, photos of review exams, books…). Start here to learn what you can read.'): AgentTool {
  return tool(name, description, Schema.object([]), () => {
    const pack = safePack(store())
    if (!pack) return outJSON({ ok: true, count: 0, sources: [], tip: 'There are no materials here yet.' })
    const items = pack.sources.map((s) => ({ id: s.id, title: s.title, kind: s.kind, pages: s.pages, characters: s.characters, trust: s.trust, note: s.note ?? null, warnings: s.warnings }))
    return outJSON({ ok: true, count: items.length, sources: items, tip: 'trust=official means material from the instructor/exam (highest priority). Use search_sources then read_source.' })
  })
}

/** Respaldo cuando no hay índice: puntuación por términos presentes. */
function naiveSearch(store: PackStore, q: string, limit: number, ids?: Set<string>): SourceHit[] {
  const pack = safePack(store)
  if (!pack) return []
  const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1)
  if (!terms.length) return []
  const scored: SourceHit[] = []
  for (const s of pack.sources) {
    if (ids && !ids.has(s.id)) continue
    for (const c of store.loadChunks(s.id)) {
      const low = c.text.toLowerCase()
      const score = terms.reduce((acc, t) => acc + (low.includes(t) ? 1 + Math.sqrt(low.split(t).length - 1) * 0.2 : 0), 0)
      if (score <= 0) continue
      const at = Math.max(0, low.indexOf(terms[0]) - 80)
      const hit: SourceHit = { chunkID: c.id, sourceID: s.id, sourceTitle: s.title, snippet: (at > 0 ? '…' : '') + c.text.slice(at, at + 260).replace(/\n/g, ' ').replace(/\*/g, '∗'), score }
      if (c.page !== undefined) hit.page = c.page
      if (c.heading !== undefined) hit.heading = c.heading
      scored.push(hit)
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

export async function searchMaterials(store: PackStore, a: ToolArgs, vectors?: VectorSearcher): Promise<JSONObject | string> {
  const q = a.string('query')
  if (!q) return "Missing required argument 'query'."
  const limit = Math.min(12, Math.max(1, a.int('limit') ?? 6))
  const ids = a.strings('source_ids')
  const idSet = ids ? new Set(ids) : undefined
  let hits: SourceHit[]
  try {
    hits = await searchCourse(store.directory, q, { limit, sourceIDs: idSet, vectors })
  } catch {
    hits = []
  }
  if (!hits.length) hits = naiveSearch(store, q, limit, idSet)
  const titles = new Map((safePack(store)?.sources ?? []).map((s) => [s.id, s.title] as const))
  const results = hits.slice(0, limit).map((h) => ({
    chunk_id: h.chunkID, source_id: h.sourceID, source_title: h.sourceTitle ?? titles.get(h.sourceID) ?? h.sourceID, page: h.page ?? null, heading: h.heading ?? null,
    snippet: plainSnippet(h.snippet), score: Math.round(h.score * 100) / 100
  }))
  return { ok: true, query: q, count: results.length, results }
}

export function searchSourcesTool(store: () => PackStore, vectors?: (dir: string) => VectorSearcher | undefined, name = 'search_sources',
  description = "Search the user's materials (by words, and by meaning across languages when the meaning model is installed). Returns the best passages with source id, page and a snippet. Use specific terms (a concept name, a formula, a question phrase). Then call read_source with the chunk_id or page range for the full text."): AgentTool {
  return tool(name, description, Schema.object([
    ['query', Schema.string('What to look for, in the language of the materials or the course.')], ['limit', Schema.integer('Max results (default 6, max 12)', 1, 12)],
    ['source_ids', Schema.array(Schema.string(), 'Restrict to these sources')]
  ], ['query']), async (a) => {
    const s = store()
    const r = await searchMaterials(s, a, vectors?.(s.directory))
    return typeof r === 'string' ? outError(r) : outJSON(r)
  })
}

export function readMaterial(store: PackStore, a: ToolArgs): JSONObject | string {
  const sid = a.string('source_id')
  if (!sid) return "Missing required argument 'source_id'."
  let chunks: SourceChunk[]
  try { chunks = store.loadChunks(sid) } catch { chunks = [] }
  if (!chunks.length) return `Source '${sid}' not found or has no text. Use list_sources.`
  let sel = chunks
  const cid = a.string('chunk_id')
  const p0 = a.int('page_from')
  const i = cid ? chunks.findIndex((c) => c.id === cid) : -1
  if (i >= 0) sel = chunks.slice(Math.max(0, i - 1), Math.min(chunks.length, i + 2))
  else if (p0 !== undefined) {
    const p1 = a.int('page_to') ?? p0
    sel = chunks.filter((c) => c.page !== undefined && (c.pageEnd ?? c.page) >= p0 && c.page <= p1)
  }
  let text = ''
  let lastPage: number | undefined
  for (const c of sel) {
    if (c.page !== undefined && c.page !== lastPage) { text += `\n[p.${c.page}] `; lastPage = c.page }
    if (c.heading && !text.endsWith(c.heading)) text += `(${c.heading}) `
    text += c.text + '\n'
  }
  const offset = Math.max(0, a.int('offset') ?? 0)
  const maxChars = Math.min(12000, Math.max(500, a.int('max_chars') ?? 6000))
  const chars = Array.from(text)
  const slice = chars.slice(offset, offset + maxChars).join('')
  const sliceLen = Math.min(maxChars, Math.max(0, chars.length - offset))
  const more = offset + sliceLen < chars.length
  // los materiales (un PDF de un compañero, unas diapositivas descargadas) son datos, nunca órdenes para la IA
  const o: JSONObject = { ok: true, source_id: sid, text: wrapUntrusted(slice, 'material', [['source_id', sid]]), total_chars: chars.length, truncated: more }
  if (more) o.next_offset = offset + sliceLen
  return o
}

export function readSourceTool(store: () => PackStore, name = 'read_source',
  description = "Read text from one of the user's materials. Give a chunk_id (from search_sources) or a page range. Long texts are paginated: use next_offset to continue. Text keeps [p.N] page markers."): AgentTool {
  return tool(name, description, Schema.object([
    ['source_id', Schema.string('Source id from list_sources')], ['chunk_id', Schema.string('Read exactly this chunk (plus a little context)')], ['page_from', Schema.integer()],
    ['page_to', Schema.integer()], ['offset', Schema.integer('Character offset to continue from (default 0)')], ['max_chars', Schema.integer('Max characters to return (default 6000, max 12000)', 500, 12000)]
  ], ['source_id']), (a) => {
    const r = readMaterial(store(), a)
    return typeof r === 'string' ? outError(r) : outJSON(r)
  })
}

export function calculateTool(): AgentTool {
  return tool('calculate',
    'Exact calculator. Use it to verify every number you put in an answer. Syntax like a calculator: 3/4+1/6, sqrt(2)/2, sin(pi/6), 2^10, 6.02e23, nCr(10,3), log(8,2); Greek names (theta, alpha) and Spanish names (sen, tg) work; it is NOT symbolic—only numbers. Statistics like a TI calculator: mean/median/mode/stdev/var (sample), pstdev/pvar (population) on lists {1,2,3}; normalcdf(a,b,μ,σ), invnorm(p,μ,σ), binompdf(n,p,k), binomcdf(n,p,k). Returns an exact fraction when possible plus a decimal. Comparisons return true/false: sin(pi/4) == sqrt(2)/2. Several calculations at once: separate them with ; or , (e.g. sin(pi/6); cos(pi/6)).',
    Schema.object([['expression', Schema.string('e.g. 3/4 + 1/6')], ['degrees', Schema.boolean('Interpret sin/cos/tan in degrees (default false = radians)')]], ['expression']),
    (a) => {
      const e = a.string('expression', ['expr', 'input'])
      if (!e) return outError("Missing required argument 'expression'.")
      const r = LiveCalculator.calculate(e, a.bool('degrees') ?? false)
      if (r.error !== undefined) return outError(r.error)
      const o: JSONObject = { ok: true, expression: e, result: r.text }
      if (r.decimal !== undefined && Number.isFinite(r.decimal)) o.decimal = r.decimal
      if (r.latex !== undefined) o.latex = r.latex
      return outJSON(o)
    })
}

export function chemistryTool(): AgentTool {
  return {
    name: CHEMISTRY_TOOL.name, description: CHEMISTRY_TOOL.description, inputSchema: CHEMISTRY_TOOL.parameters as unknown as JSONSchema,
    run: (args) => {
      const out = runChemistryTool(args)
      return { text: out.text, isError: out.isError }
    }
  }
}
