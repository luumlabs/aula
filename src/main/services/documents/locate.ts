// Dónde está cada documento en disco, validado: nada de lo que llegue de la interfaz (ids de curso, de material o de archivo
// importado) puede salir de la carpeta de datos de Aula. Los materiales de un curso viven en `Packs/<curso>/sources/<id>/`,
// los importados en `<datos>/Documents/sources/<id>/` y los documentos que creó Aula en `Packs/<curso>/documents/`.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Hashing, IDs } from '@engine/base/ids'
import type { DocumentMode, DocumentRef, SavedDocument } from '@shared/documents'
import { docKey } from '@shared/documents'
import type { Pack, SourceMeta } from '@shared/schema'
import { decodeSourceMeta } from '@shared/schema'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'
import { paths } from '../paths'
import { getLibrary, SafePath, type PackStore } from '../store'
import { listCourseDocuments, savedDocumentPath } from './saving'

/** Un documento ya encontrado en disco. */
export interface LocatedDocument {
  ref: DocumentRef
  key: string
  title: string
  kind: string
  mode: DocumentMode
  /** El original (dentro de la carpeta de Aula). */
  filePath?: string
  fileUrl?: string
  /** Carpeta que contiene `sources/<id>/` (el curso o `<datos>/Documents`). */
  sourcesRoot?: string
  sourceId?: string
  meta?: SourceMeta
  saved?: SavedDocument
  store?: PackStore
  pack?: Pack
  /** Archivo y clave de las anotaciones. */
  annotationsFile: string
  annotationsKey: string
}

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'])

export function documentsRoot(): string {
  return paths.documents()
}

export function importsIndexPath(): string {
  return join(documentsRoot(), 'library.json')
}

/** Los archivos importados en Documentos (`<datos>/Documents/library.json`, mismo formato que `pack.json → sources[]`). */
export function loadImports(): SourceMeta[] {
  try {
    const raw = JSON.parse(readFileSync(importsIndexPath(), 'utf8')) as { items?: unknown }
    if (!Array.isArray(raw.items)) return []
    return raw.items.flatMap((x) => { const m = decodeSourceMeta(x); return m && SafePath.isComponent(m.id) ? [m] : [] })
  } catch {
    return []
  }
}

/** Cómo se lee un archivo según su extensión (y si existe). */
export function modeFor(filePath: string | undefined): DocumentMode {
  if (!filePath) return 'text'
  const ext = extname(filePath).slice(1).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'text'
}

/** URL servible por el protocolo aula-asset:// (cada parte codificada). */
export function assetUrl(host: 'pack' | 'doc', parts: string[]): string {
  return `aula-asset://${host}/${parts.map((p) => encodeURIComponent(p)).join('/')}`
}

/** El original de un material: solo un nombre suelto y dentro de la carpeta del material (sin enlaces que salgan). */
function originalIn(root: string, meta: SourceMeta): string | undefined {
  const f = meta.filename
  if (!f || !SafePath.isComponent(f)) return undefined
  const dir = join(root, 'sources', SafePath.component(meta.id))
  const p = join(dir, f)
  return existsSync(p) && SafePath.isInside(p, dir) ? p : undefined
}

function notFound(): AulaError {
  return new AulaError('not_found', tr('Ese documento ya no está.', 'That document is no longer there.'))
}

/** Clave de las anotaciones de un archivo suelto (la de Swift: `Hashing.stableID` de su ruta). */
export function fileAnnotationsKey(path: string): string {
  return Hashing.stableID(path)
}

function fileAnnotations(path: string | undefined, title: string): { annotationsFile: string; annotationsKey: string } {
  const key = path ? fileAnnotationsKey(path) : Hashing.stableID(title)
  return { annotationsFile: join(documentsRoot(), 'annotations', `${key}.json`), annotationsKey: key }
}

/** Un material de un curso ya cargado (sin volver a leer `pack.json`). */
export function locatedSource(store: PackStore, pack: Pack, meta: SourceMeta): LocatedDocument {
  const ref: DocumentRef = { kind: 'source', packId: store.id, sourceId: meta.id }
  const filePath = originalIn(store.directory, meta)
  return {
    ref, key: docKey(ref), title: meta.title, kind: meta.kind, mode: modeFor(filePath), filePath,
    fileUrl: filePath && meta.filename ? assetUrl('pack', [store.id, 'sources', meta.id, meta.filename]) : undefined,
    sourcesRoot: store.directory, sourceId: meta.id, meta, store, pack,
    annotationsFile: join(store.directory, 'annotations', `${IDs.slug(meta.id, 80)}.json`), annotationsKey: `${store.id}/${meta.id}`
  }
}

/** Un archivo importado en Documentos. */
export function locatedImport(meta: SourceMeta): LocatedDocument {
  const ref: DocumentRef = { kind: 'import', docId: meta.id }
  const root = documentsRoot()
  const filePath = originalIn(root, meta)
  return {
    ref, key: docKey(ref), title: meta.title, kind: meta.kind, mode: modeFor(filePath), filePath,
    fileUrl: filePath && meta.filename ? assetUrl('doc', ['sources', meta.id, meta.filename]) : undefined,
    sourcesRoot: root, sourceId: meta.id, meta, ...fileAnnotations(filePath, meta.title)
  }
}

/** Un documento que creó Aula en un curso (undefined si su archivo no está dentro de la carpeta del curso). */
export function locatedSaved(store: PackStore, pack: Pack | undefined, saved: SavedDocument): LocatedDocument | undefined {
  const filePath = savedDocumentPath(saved, store)
  if (!filePath) return undefined
  const ref: DocumentRef = { kind: 'saved', packId: store.id, savedId: saved.id }
  const kind = saved.format === 'markdown' ? 'markdown' : saved.format
  // aula-asset:// solo sirve `assets/` y `sources/` de un curso: el lector pide los bytes por IPC (`documents.fileData`)
  return { ref, key: docKey(ref), title: saved.title, kind, mode: modeFor(filePath), filePath, saved, store, pack, ...fileAnnotations(filePath, saved.title) }
}

/** Encuentra un documento (lanza `not_found` si no existe o la referencia no sirve). */
export function locate(ref: DocumentRef): LocatedDocument {
  switch (ref.kind) {
    case 'source': {
      const store = getLibrary().openPack(ref.packId)
      if (!store) throw notFound()
      let pack: Pack
      try { pack = store.loadPack() } catch { throw notFound() }
      const meta = pack.sources.find((s) => s.id === ref.sourceId)
      if (!meta || !SafePath.isComponent(meta.id)) throw notFound()
      return locatedSource(store, pack, meta)
    }
    case 'import': {
      if (!SafePath.isComponent(ref.docId)) throw notFound()
      const meta = loadImports().find((m) => m.id === ref.docId)
      if (!meta) throw notFound()
      return locatedImport(meta)
    }
    case 'saved': {
      const store = getLibrary().openPack(ref.packId)
      if (!store) throw notFound()
      const saved = listCourseDocuments(store).find((d) => d.id === ref.savedId)
      let pack: Pack | undefined
      try { pack = store.loadPack() } catch { pack = undefined }
      const doc = saved ? locatedSaved(store, pack, saved) : undefined
      if (!doc) throw notFound()
      return doc
    }
  }
}

/** Huella de lo que se lee de un documento (para la caché del texto). */
export function contentSignature(doc: LocatedDocument): string {
  const files: string[] = []
  if (doc.sourcesRoot && doc.sourceId) {
    const dir = join(doc.sourcesRoot, 'sources', SafePath.component(doc.sourceId))
    files.push(join(dir, 'pages.json'), join(dir, 'chunks.json'))
  }
  if (doc.filePath) files.push(doc.filePath)
  return files.map((f) => {
    try { const st = statSync(f); return `${st.size}:${st.mtimeMs}` } catch { return '-' }
  }).join('|')
}
