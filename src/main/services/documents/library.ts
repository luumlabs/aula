// La biblioteca de documentos: los materiales de cada curso, los archivos importados en Documentos y los documentos que creó
// Aula (guardados en cada curso), con lo último que se abrió («Recientes») y la página donde se dejó. Importar un archivo lo
// lee con la lectura de materiales (texto, páginas y OCR) y lo guarda en `<datos>/Documents/sources/<id>/`.
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DocumentCourse, DocumentEntry, DocumentLibrary, DocumentRef, DocumentSearchHit } from '@shared/documents'
import { docKey } from '@shared/documents'
import type { Pack, SourceMeta } from '@shared/schema'
import { encodeSourceMeta } from '@shared/schema'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'
import { importSourceIntoPack, type ImportOptions } from '../ingest'
import { log } from '../log'
import { rebuildCourseIndex, searchCourse } from '../search'
import { getLibrary, SafePath, writeJSONFile } from '../store'
import { withFileLock } from '../store/lock'
import { DocumentAnnotationStore } from './annotations'
import { assetUrl, documentsRoot, importsIndexPath, loadImports, locate, locatedImport, locatedSaved, locatedSource, modeFor, type LocatedDocument } from './locate'
import { courseDocumentsDir, listCourseDocuments, removeCourseDocument, savedDocumentPath } from './saving'

// MARK: - Recientes

interface RecentItem { key: string; opened: string; page?: number }
const MAX_RECENT = 40

function recentPath(): string {
  return join(documentsRoot(), 'recent.json')
}

export function loadRecent(): RecentItem[] {
  try {
    const raw = JSON.parse(readFileSync(recentPath(), 'utf8')) as { items?: unknown }
    if (!Array.isArray(raw.items)) return []
    return raw.items.flatMap((x) => {
      if (!x || typeof x !== 'object') return []
      const o = x as Record<string, unknown>
      if (typeof o.key !== 'string' || typeof o.opened !== 'string') return []
      const r: RecentItem = { key: o.key, opened: o.opened }
      if (typeof o.page === 'number' && Number.isInteger(o.page) && o.page >= 1) r.page = o.page
      return [r]
    })
  } catch {
    return []
  }
}

/** Apunta que se abrió (y, si se da, la página donde va). */
export function touchRecent(ref: DocumentRef, page?: number): void {
  const key = docKey(ref)
  withFileLock(`${recentPath()}.lock`, () => {
    const all = loadRecent()
    const prev = all.find((r) => r.key === key)
    const item: RecentItem = { key, opened: new Date().toISOString() }
    const p = page ?? prev?.page
    if (p !== undefined) item.page = p
    writeJSONFile(recentPath(), { version: 1, items: [item, ...all.filter((r) => r.key !== key)].slice(0, MAX_RECENT) })
  })
}

// MARK: - Entradas

function entryFrom(doc: LocatedDocument, extra: { courseId?: string; course?: DocumentCourse; recent?: RecentItem }): DocumentEntry {
  const meta = doc.meta
  const entry: DocumentEntry = {
    ref: doc.ref, key: doc.key, title: doc.title, kind: doc.kind, mode: doc.mode, origin: doc.ref.kind,
    pages: meta?.pages ?? doc.saved?.pages ?? 0, characters: meta?.characters ?? 0, added: meta?.addedAt ?? doc.saved?.created ?? new Date(0).toISOString(),
    marks: new DocumentAnnotationStore(doc.annotationsFile, doc.title, doc.annotationsKey).count(), status: meta?.status ?? 'ready', hasFile: !!doc.filePath
  }
  if (doc.fileUrl) entry.fileUrl = doc.fileUrl
  if (meta?.trust) entry.trust = meta.trust
  if (extra.course) {
    entry.courseId = extra.course.id
    entry.courseTitle = extra.course.title
    entry.courseHue = extra.course.hue
    entry.courseIcon = extra.course.icon
  }
  if (extra.recent) {
    entry.opened = extra.recent.opened
    if (extra.recent.page !== undefined) entry.lastPage = extra.recent.page
  }
  return entry
}

/** La entrada de biblioteca de un documento ya encontrado. */
export function entryForLocated(doc: LocatedDocument): DocumentEntry {
  const recent = loadRecent().find((r) => r.key === doc.key)
  const course = doc.pack ? { id: doc.pack.id, title: doc.pack.title, hue: doc.pack.hue, icon: doc.pack.icon } : undefined
  return entryFrom(doc, { course, recent })
}

function courseOf(p: Pack, id: string): DocumentCourse {
  return { id, title: p.title, hue: p.hue, icon: p.icon }
}

/** Todos los documentos: materiales de cada curso, documentos creados por Aula y archivos importados. */
export function listLibrary(): DocumentLibrary {
  const lib = getLibrary()
  const recents = new Map(loadRecent().map((r) => [r.key, r]))
  const items: DocumentEntry[] = []
  const courses: DocumentCourse[] = []
  for (const summary of lib.listPacks()) {
    const store = lib.openPack(summary.id)
    if (!store) continue
    let pack: Pack
    try { pack = store.loadPack() } catch { continue }
    const course = courseOf(pack, store.id)
    courses.push(course)
    for (const meta of pack.sources) {
      if (!SafePath.isComponent(meta.id)) continue
      try {
        const doc = locatedSource(store, pack, meta)
        items.push(entryFrom(doc, { course, recent: recents.get(doc.key) }))
      } catch { /* un material dañado no rompe la lista */ }
    }
    for (const saved of listCourseDocuments(store)) {
      const doc = locatedSaved(store, pack, saved)
      if (doc) items.push(entryFrom(doc, { course, recent: recents.get(doc.key) }))
    }
  }
  for (const meta of loadImports()) {
    try {
      const doc = locatedImport(meta)
      items.push(entryFrom(doc, { recent: recents.get(doc.key) }))
    } catch { /* nada */ }
  }
  return { items, courses }
}

// MARK: - Importar

function saveImports(items: SourceMeta[]): void {
  writeJSONFile(importsIndexPath(), { version: 1, items: items.map(encodeSourceMeta) })
}

export interface ImportOutcome {
  imported: DocumentEntry[]
  failed: { name: string; message: string }[]
}

/** ¿Ya está importado este archivo (mismo nombre y tamaño)? */
function alreadyImported(path: string, existing: SourceMeta[]): SourceMeta | undefined {
  let size = -1
  try { size = statSync(path).size } catch { return undefined }
  const name = basename(path)
  return existing.find((m) => {
    if (m.filename !== name) return false
    try {
      const doc = locate({ kind: 'import', docId: m.id })
      return !!doc.filePath && statSync(doc.filePath).size === size
    } catch {
      return false
    }
  })
}

/**
 * Importa archivos a Documentos: los lee (texto, páginas, OCR), copia el original y lo apunta en `library.json`. Un archivo
 * que ya estaba no se repite. `onProgress` informa por archivo.
 */
export async function importFiles(paths: string[], opts: { onProgress?: (name: string, fraction: number, message: string) => void; signal?: AbortSignal; language?: string } = {}): Promise<ImportOutcome> {
  const root = documentsRoot()
  const out: ImportOutcome = { imported: [], failed: [] }
  for (const path of paths.slice(0, 200)) {
    const name = basename(path)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) throw new AulaError('not_found', name)
      const dup = alreadyImported(path, loadImports())
      if (dup) {
        out.imported.push(entryForLocated(locate({ kind: 'import', docId: dup.id })))
        continue
      }
      const options: ImportOptions = { register: false, signal: opts.signal, onProgress: (f, m) => opts.onProgress?.(name, f, m) }
      if (opts.language) options.language = opts.language
      const saved = await importSourceIntoPack(root, { type: 'file', path }, options)
      withFileLock(`${importsIndexPath()}.lock`, () => {
        const all = loadImports().filter((m) => m.id !== saved.meta.id)
        saveImports([...all, saved.meta])
      })
      out.imported.push(entryForLocated(locate({ kind: 'import', docId: saved.meta.id })))
    } catch (err) {
      log.warn(`[documents] no se pudo importar ${name}`, err)
      out.failed.push({ name, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

/** Quita un documento importado (su carpeta y sus marcas) o uno creado por Aula del curso. */
export function removeDocument(ref: DocumentRef): void {
  const doc = locate(ref)
  if (ref.kind === 'source') throw new AulaError('invalid_args', tr('Los materiales de un curso se quitan desde el curso.', 'A course’s materials are removed from the course.'))
  if (ref.kind === 'import') {
    const dir = join(documentsRoot(), 'sources', SafePath.component(ref.docId))
    if (SafePath.isInside(dir, join(documentsRoot(), 'sources'))) rmSync(dir, { recursive: true, force: true })
    withFileLock(`${importsIndexPath()}.lock`, () => saveImports(loadImports().filter((m) => m.id !== ref.docId)))
    try { rebuildCourseIndex(documentsRoot()) } catch { /* el índice se rehace al buscar */ }
  } else if (ref.kind === 'saved' && doc.store) {
    removeCourseDocument(ref.savedId, doc.store)
  }
  rmSync(doc.annotationsFile, { force: true })
}

/** El original en disco de un documento (para «Mostrar en la carpeta»). */
export function originalPath(ref: DocumentRef): string | undefined {
  const doc = locate(ref)
  if (doc.filePath) return doc.filePath
  if (ref.kind === 'saved' && doc.saved && doc.store) return savedDocumentPath(doc.saved, doc.store) ?? courseDocumentsDir(doc.store)
  return undefined
}

// MARK: - Buscar en todo

/** Busca en el texto de todos los documentos (o de un curso): los materiales de cada curso y los importados. */
export async function searchLibrary(query: string, opts: { courseId?: string; limit?: number } = {}): Promise<DocumentSearchHit[]> {
  const q = query.trim()
  if (Array.from(q).length < 2) return []
  const limit = Math.min(60, Math.max(1, opts.limit ?? 24))
  const lib = getLibrary()
  const hits: DocumentSearchHit[] = []
  const packs = lib.listPacks().filter((p) => !opts.courseId || p.id === opts.courseId)
  for (const summary of packs) {
    const store = lib.openPack(summary.id)
    if (!store) continue
    let pack: Pack
    try { pack = store.loadPack() } catch { continue }
    const found = await searchCourse(store.directory, q, { limit: Math.min(limit, 12) }).catch(() => [])
    for (const h of found) {
      const meta = pack.sources.find((s) => s.id === h.sourceID)
      if (!meta) continue
      const ref: DocumentRef = { kind: 'source', packId: store.id, sourceId: meta.id }
      const hit: DocumentSearchHit = { key: docKey(ref), ref, title: meta.title, courseTitle: pack.title, snippet: h.snippet, score: h.score }
      if (h.page !== undefined) hit.page = h.page
      hits.push(hit)
    }
  }
  if (!opts.courseId) {
    const imports = loadImports()
    if (imports.length) {
      const found = await searchCourse(documentsRoot(), q, { limit: Math.min(limit, 12) }).catch(() => [])
      for (const h of found) {
        const meta = imports.find((m) => m.id === h.sourceID)
        if (!meta) continue
        const ref: DocumentRef = { kind: 'import', docId: meta.id }
        const hit: DocumentSearchHit = { key: docKey(ref), ref, title: meta.title, snippet: h.snippet, score: h.score }
        if (h.page !== undefined) hit.page = h.page
        hits.push(hit)
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** El modo de lectura de un archivo (exportado para las pruebas). */
export { modeFor, assetUrl }
