// Búsqueda en toda la biblioteca para la paleta (⌘K). Por curso: un índice BM25 de su contenido (lecciones, ejercicios,
// glosario y fórmulas), al día con pack.json y skills/, y el índice de sus materiales (course.ts). Cada consulta tiene un
// presupuesto de tiempo: los cursos que no da tiempo a indexar quedan «pendientes», se siguen indexando en segundo plano
// (de uno en uno, sin bloquear) y la interfaz vuelve a preguntar. Ya indexado, buscar en decenas de cursos tarda milisegundos.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SourceChunk } from '@shared/ingest'
import type { Pack, Skill } from '@shared/schema'
import { LIBRARY_SEARCH_MAX, type LibraryHit, type LibraryHitKind, type LibrarySearchResult } from '@shared/ipc/search'
import { readable } from '@engine/assistant/text'
import { log } from '../log'
import { getLibrary, type Library } from '../store'
import { isCourseIndexReady, loadCourseIndex } from './course'
import { SearchIndex } from './searchIndex'
import { fold } from './text'

export interface LibrarySearchOptions {
  /** Máximo de resultados (20 por defecto, hasta 50). */
  limit?: number
  /** Tiempo para indexar cursos nuevos o cambiados en esta consulta (ms; 120 por defecto). */
  budgetMs?: number
}

type ContentKind = Exclude<LibraryHitKind, 'material'>
/** Con la puntuación BM25 sin los pesos (para quitar el ruido con una regla que no dependa de los pesos). */
type ScoredHit = LibraryHit & { raw: number }

interface ChunkMeta {
  kind: ContentKind
  /** Parte única del id del resultado («lesson/<tema>», «glossary/3»…). */
  key: string
  title: string
  skillID?: string
}

interface CourseEntry {
  signature: string
  title: string
  content: SearchIndex
  meta: Map<string, ChunkMeta>
  /** Las «fuentes» del índice de contenido de cada tipo (para buscar cada tipo por separado). */
  kinds: Map<ContentKind, Set<string>>
  /** Títulos de los materiales (vacío = sin materiales). */
  sources: Map<string, string>
  /** Índice de los materiales, si ya se cargó con esta misma firma. */
  materials?: SearchIndex
  /** Para olvidar primero los materiales menos usados si se pasa del tope de memoria. */
  usedAt: number
}

/** Tamaño de cada trozo de lección (caracteres). */
const LESSON_CHUNK = 900
/** Fragmentos de materiales que se guardan en memoria para la paleta (≈ 40 MB de texto). */
const MAX_MATERIAL_CHUNKS = 40_000
/** Resultados por curso y tipo antes de mezclar. */
const PER_KIND: Record<LibraryHitKind, number> = { lesson: 3, glossary: 3, formula: 2, exercise: 3, material: 4 }
/** Peso de cada tipo al mezclar: la lección y el término antes que un ejercicio suelto que lo menciona. */
const KIND_WEIGHT: Record<LibraryHitKind, number> = { lesson: 1.3, glossary: 1.2, formula: 1.1, material: 1, exercise: 0.8 }
/** Como mucho, dos resultados del mismo material. */
const PER_SOURCE = 2

// MARK: Texto del contenido

/** Campos de los bloques que no son texto para leer (ids, recursos, colores, coordenadas, respuestas…). */
const SKIP_KEYS = new Set([
  'id', 'type', 'rawType', 'asset', 'assets', 'source', 'sources', 'color', 'colour', 'url', 'src', 'credit', 'aspect', 'layer', 'labels',
  'skill', 'ref', 'refs', 'exercise', 'exercises', 'template', 'templates', 'icon', 'hue', 'kind', 'style', 'mode', 'variant', 'd', 'path',
  'points', 'svg', 'fn', 'answer', 'answers', 'correct', 'solution', 'hints', 'wrongs', 'accept', 'expected'
])

function collectText(v: unknown, out: string[], depth = 0): void {
  if (depth > 8 || v === null || v === undefined) return
  if (typeof v === 'string') {
    if (v.trim() && !/^(https?:|data:|aula-asset:|#[0-9a-f]{3,8}$)/i.test(v.trim())) out.push(v)
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) collectText(x, out, depth + 1)
    return
  }
  if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) collectText(x, out, depth + 1)
}

const TEX_SYMBOLS: Record<string, string> = {
  omega: 'ω', Omega: 'Ω', phi: 'φ', varphi: 'φ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', delta: 'δ', Delta: 'Δ', gamma: 'γ',
  rho: 'ρ', tau: 'τ', epsilon: 'ε', varepsilon: 'ε', circ: '°', degree: '°', approx: '≈', pm: '±', to: '→', rightarrow: '→'
}

/** Texto plano para buscar y enseñar: sin Markdown, con el LaTeX más común como símbolos («\frac{a}{b}» → «a/b», «40^\circ» → «40°»). */
export function plainContent(raw: string): string {
  let t = raw.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°').replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
  t = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (m, name: string) => TEX_SYMBOLS[name] ?? m)
  t = readable(t)
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/[#*_`>|~{}]+/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/** Texto de unos bloques (o de cualquier valor) como una sola línea. */
export function textOf(value: unknown): string {
  const out: string[] = []
  collectText(value, out)
  return plainContent(out.join(' \n '))
}

/** La lección de un tema en trozos de ≈ 900 caracteres (por bloques; un bloque larguísimo se corta por palabras). */
export function lessonChunks(skill: Pick<Skill, 'title' | 'summary' | 'objectives' | 'lesson'>): string[] {
  const out: string[] = []
  let cur = plainContent([skill.title, skill.summary ?? '', ...skill.objectives].filter(Boolean).join('. '))
  for (const block of skill.lesson) {
    const t = textOf(block)
    if (!t) continue
    if (cur && cur.length + t.length + 1 > LESSON_CHUNK) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur} ${t}` : t
    while (cur.length > LESSON_CHUNK * 1.5) {
      const cut = cur.lastIndexOf(' ', LESSON_CHUNK)
      const at = cut > LESSON_CHUNK / 2 ? cut : LESSON_CHUNK
      out.push(cur.slice(0, at).trim())
      cur = cur.slice(at).trim()
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Los trozos de contenido de un curso con lo que hace falta para abrir cada resultado. */
export function contentChunks(pack: Pick<Pack, 'glossary' | 'formulaSheet'>, skills: Skill[]): { chunks: SourceChunk[]; meta: Map<string, ChunkMeta> } {
  const chunks: SourceChunk[] = []
  const meta = new Map<string, ChunkMeta>()
  const push = (id: string, sourceID: string, text: string, m: ChunkMeta, heading?: string): void => {
    if (!text) return
    chunks.push({ id, sourceID, ordinal: chunks.length, text, ...(heading ? { heading } : {}) })
    meta.set(id, m)
  }
  for (const s of skills) {
    lessonChunks(s).forEach((text, i) => push(`l:${s.id}:${i}`, `lesson:${s.id}`, text, { kind: 'lesson', key: `lesson/${s.id}`, title: s.title, skillID: s.id }, s.title))
    for (const e of s.exercises) push(`e:${s.id}:${e.id}`, `exercise:${s.id}`, textOf(e.prompt), { kind: 'exercise', key: `exercise/${s.id}/${e.id}`, title: s.title, skillID: s.id }, s.title)
  }
  pack.glossary.forEach((g, i) => {
    const text = plainContent([g.term, g.aliases.join(', '), g.definition].filter(Boolean).join('. '))
    push(`g:${i}`, 'glossary', text, { kind: 'glossary', key: `glossary/${i}`, title: g.term, ...(g.skill ? { skillID: g.skill } : {}) }, g.term)
  })
  pack.formulaSheet.forEach((group, gi) => group.items.forEach((f, i) => {
    const text = plainContent([f.name, f.tex, f.when ?? ''].filter(Boolean).join('. '))
    push(`f:${gi}:${i}`, 'formula', text, { kind: 'formula', key: `formula/${gi}.${i}`, title: f.name || group.title }, group.title)
  }))
  return { chunks, meta }
}

// MARK: Firma del curso

/** Huella barata del contenido: tamaño y fecha de pack.json y de cada archivo de skills/ (null si no hay curso). */
export function contentSignature(packDir: string): string | null {
  const parts: string[] = []
  try {
    const st = statSync(join(packDir, 'pack.json'))
    parts.push(`pack:${st.size}:${st.mtimeMs}`)
  } catch {
    return null
  }
  let names: string[] = []
  try {
    names = readdirSync(join(packDir, 'skills')).filter((n) => n.endsWith('.json')).sort()
  } catch {
    names = []
  }
  for (const n of names) {
    try {
      const st = statSync(join(packDir, 'skills', n))
      parts.push(`${n}:${st.size}:${st.mtimeMs}`)
    } catch {
      /* borrado mientras tanto */
    }
  }
  return parts.join('|')
}

// MARK: Búsqueda

export class LibrarySearch {
  private courses = new Map<string, CourseEntry>()
  private warming: Promise<void> | null = null

  constructor(private readonly library: () => Library = getLibrary) {}

  /** Busca en todos los cursos (las coincidencias, de más a menos relevantes). */
  query(rawQuery: string, opts: LibrarySearchOptions = {}): LibrarySearchResult {
    const q = rawQuery.trim().slice(0, 200)
    const limit = Math.max(1, Math.min(LIBRARY_SEARCH_MAX, Math.floor(opts.limit ?? 20)))
    if (fold(q).replace(/\s/g, '').length < 2) return { hits: [], pending: 0 }
    const started = performance.now()
    const budget = opts.budgetMs ?? 120
    let builds = 0
    // siempre se indexa al menos un curso por consulta (avanza aunque el presupuesto sea muy corto)
    const mayBuild = (): boolean => builds === 0 || performance.now() - started < budget
    const lib = this.library()
    const ids = lib.packIDs()
    this.forgetMissing(ids)
    const hits: ScoredHit[] = []
    let pending = 0
    for (const id of ids) {
      const dir = lib.packDirectory(id)
      let late = false
      let entry = this.courses.get(id)
      const signature = contentSignature(dir)
      if (signature === null) continue
      if (!entry || entry.signature !== signature) {
        if (mayBuild()) {
          entry = this.build(lib, id, signature) ?? entry
          builds++
        } else late = true
      }
      if (!entry) {
        if (late) pending++
        continue
      }
      entry.usedAt = Date.now()
      hits.push(...this.searchContent(id, entry, q))
      if (entry.sources.size) {
        if (!entry.materials && (isCourseIndexReady(dir) || mayBuild())) {
          if (!isCourseIndexReady(dir)) builds++
          entry.materials = this.loadMaterials(dir)
        }
        if (entry.materials) hits.push(...this.searchMaterials(id, entry, q))
        else late = true
      }
      if (late) pending++
    }
    if (pending) void this.warm()
    return { hits: rank(hits).slice(0, limit), pending }
  }

  /** Indexa en segundo plano, de curso en curso, lo que falte o haya cambiado. */
  warm(): Promise<void> {
    if (this.warming) return this.warming
    this.warming = (async () => {
      const lib = this.library()
      for (const id of lib.packIDs()) {
        await new Promise<void>((r) => setImmediate(r))
        try {
          const dir = lib.packDirectory(id)
          const signature = contentSignature(dir)
          if (signature === null) continue
          let entry = this.courses.get(id)
          if (!entry || entry.signature !== signature) entry = this.build(lib, id, signature)
          if (entry && entry.sources.size && !entry.materials) {
            await new Promise<void>((r) => setImmediate(r))
            entry.materials = this.loadMaterials(dir)
          }
        } catch (err) {
          log.warn(`search: no se pudo indexar «${id}»`, err)
        }
      }
      this.trimMaterials()
    })().finally(() => {
      this.warming = null
    })
    return this.warming
  }

  /** Olvida lo indexado (de un curso o de todos). */
  invalidate(courseID?: string): void {
    if (courseID === undefined) this.courses.clear()
    else this.courses.delete(courseID)
  }

  private build(lib: Library, id: string, signature: string): CourseEntry | undefined {
    const store = lib.openPack(id)
    if (!store) return undefined
    let pack: Pack
    try {
      pack = store.loadPack()
    } catch (err) {
      log.warn(`search: curso ilegible «${id}»`, err)
      return undefined
    }
    const skills = store.loadSkills(pack.skills.map((s) => s.id))
    const { chunks, meta } = contentChunks(pack, skills)
    const sources = new Map<string, string>()
    for (const s of pack.sources) if (s.status !== 'failed') sources.set(s.id, s.title)
    const kinds = new Map<ContentKind, Set<string>>()
    for (const c of chunks) {
      const kind = meta.get(c.id)?.kind
      if (!kind) continue
      let set = kinds.get(kind)
      if (!set) kinds.set(kind, (set = new Set()))
      set.add(c.sourceID)
    }
    const entry: CourseEntry = { signature, title: pack.title, content: new SearchIndex(chunks), meta, kinds, sources, usedAt: Date.now() }
    this.courses.set(id, entry)
    return entry
  }

  private loadMaterials(dir: string): SearchIndex | undefined {
    try {
      const index = loadCourseIndex(dir)
      this.trimMaterials()
      return index
    } catch (err) {
      log.warn('search: no se pudieron cargar los materiales', err)
      return undefined
    }
  }

  /** Si los materiales en memoria pasan del tope, se sueltan los de los cursos menos usados. */
  private trimMaterials(): void {
    let total = 0
    for (const e of this.courses.values()) total += e.materials?.count ?? 0
    if (total <= MAX_MATERIAL_CHUNKS) return
    const byAge = [...this.courses.values()].filter((e) => e.materials).sort((a, b) => a.usedAt - b.usedAt)
    for (const e of byAge) {
      if (total <= MAX_MATERIAL_CHUNKS) break
      total -= e.materials?.count ?? 0
      e.materials = undefined
    }
  }

  private forgetMissing(ids: string[]): void {
    if (this.courses.size <= ids.length) return
    const keep = new Set(ids)
    for (const id of [...this.courses.keys()]) if (!keep.has(id)) this.courses.delete(id)
  }

  /** Cada tipo por separado (si no, los ejercicios, cortos y muchos, taparían las lecciones). */
  private searchContent(courseID: string, entry: CourseEntry, q: string): ScoredHit[] {
    const out: ScoredHit[] = []
    for (const [kind, sourceIDs] of entry.kinds) {
      const seen = new Set<string>()
      for (const h of entry.content.search(q, { limit: PER_KIND[kind] * 3, sourceIDs })) {
        const m = entry.meta.get(h.chunk.id)
        if (!m || seen.has(m.key)) continue // una lección, una vez (su mejor trozo)
        seen.add(m.key)
        out.push({
          id: `${courseID}/${m.key}`, kind: m.kind, courseID, courseTitle: entry.title, title: m.title, snippet: h.snippet,
          ...(m.skillID ? { skillID: m.skillID } : {}),
          score: h.score * titleBoost(m.title, q) * KIND_WEIGHT[kind], raw: h.score
        })
        if (seen.size >= PER_KIND[kind]) break
      }
    }
    return out
  }

  private searchMaterials(courseID: string, entry: CourseEntry, q: string): ScoredHit[] {
    const out: ScoredHit[] = []
    const perSource = new Map<string, number>()
    for (const h of entry.materials?.search(q, { limit: PER_KIND.material * 3 }) ?? []) {
      const title = entry.sources.get(h.chunk.sourceID)
      if (title === undefined) continue
      const n = perSource.get(h.chunk.sourceID) ?? 0
      if (n >= PER_SOURCE) continue
      perSource.set(h.chunk.sourceID, n + 1)
      out.push({
        id: `${courseID}/material/${h.chunk.id}`, kind: 'material', courseID, courseTitle: entry.title, title, snippet: h.snippet,
        sourceID: h.chunk.sourceID, ...(h.chunk.page !== undefined ? { page: h.chunk.page } : {}),
        score: h.score * KIND_WEIGHT.material, raw: h.score
      })
      if (out.length >= PER_KIND.material) break
    }
    return out
  }
}

/** Un término o tema cuyo nombre es lo que se busca va antes que un párrafo que solo lo menciona. */
function titleBoost(title: string, q: string): number {
  const t = fold(title).trim()
  const f = fold(q).trim()
  if (!t || !f) return 1
  if (t === f) return 2
  return t.includes(f) ? 1.5 : 1
}

/** Por debajo de esta fracción del mejor resultado, una coincidencia es ruido (una palabra suelta de la consulta). */
const MIN_RELATIVE_SCORE = 0.2

/** De más a menos relevante, sin el ruido; a igual puntuación, orden estable por id (resultados deterministas). */
function rank(hits: ScoredHit[]): LibraryHit[] {
  const best = hits.reduce((m, h) => Math.max(m, h.raw), 0)
  return hits
    .filter((h) => h.raw >= best * MIN_RELATIVE_SCORE)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map(({ raw: _raw, ...h }) => h)
}

let shared: LibrarySearch | null = null

/** La búsqueda de la biblioteca de la carpeta de datos (una por proceso). */
export function librarySearch(): LibrarySearch {
  if (!shared) shared = new LibrarySearch()
  return shared
}
