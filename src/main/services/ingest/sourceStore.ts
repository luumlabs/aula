// Guardar materiales en un curso como la app Swift (`LiveImporter.save` + `PackStore.saveSource`):
//   sources/<id>/<original>      copia del archivo original (si lo hay)
//   sources/<id>/chunks.json     fragmentos (claves ordenadas, sin sangría)
//   sources/<id>/pages.json      texto por página, figuras y páginas que necesitan OCR (la app Swift lo ignora)
//   pack.json → sources[]        registro del material (con cerrojo y escritura atómica)
//   sources/index.json           índice de búsqueda, reconstruido
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IDs } from '@engine/base/ids'
import type { IngestResult, SourceChunk, SourceKind, SourceMeta, SourcePage, SourceTrust } from '@shared/ingest'
import { writeFileAtomic } from '../fs'
import { rebuildCourseIndex } from '../search/course'
import { PackStore } from '../store/packStore'
import { SafePath } from '../store/safePath'
import { AulaError } from '../errors'
import { checkCancelled } from './errors'
import { L } from './messages'
import { chunksPath, pagesPath, sortedJSON, sourceDirectory, sourcesDirectory } from './packFiles'
import { charCount } from './text/unicode'

/** Formato de `pages.json`. */
export interface StoredPages {
  version: 1
  sourceID: string
  kind: SourceKind
  title: string
  metadata: Record<string, string>
  pages: SourcePage[]
  /** Páginas que necesitan OCR o su imagen. */
  pagesNeedingOCR: number[]
}

export const PAGES_VERSION = 1

/** Id de un material nuevo, como Swift: «slug-del-titulo-abcd» (y distinto de los que ya hay). */
export function newSourceID(title: string, existing: Iterable<string> = []): string {
  const taken = new Set(existing)
  for (let i = 0; i < 20; i++) {
    const id = IDs.slug(title, 28) + '-' + IDs.short(4)
    if (!taken.has(id)) return id
  }
  return IDs.slug(title, 28) + '-' + IDs.short(10)
}

/** El material no tiene texto (ni páginas que ver como imagen): no se guarda. */
export class EmptySourceError extends AulaError {
  constructor(title: string) {
    super('ingest_empty', L('«%@» no tiene texto que pueda leer.', title))
    this.name = 'EmptySourceError'
  }
}

export interface SaveSourceOptions {
  trust?: SourceTrust
  note?: string
  /** Archivo original que se copia a `sources/<id>/` (solo si no existe ya). */
  originalPath?: string
  url?: string
  /** Registrar el material en `pack.json` (por defecto, si existe). En un área de preparación sin curso, `false`. */
  register?: boolean
  /** Reconstruir `sources/index.json` (por defecto, sí). */
  reindex?: boolean
  /** Almacén del curso que ya usa la app (con su historial y su aviso de cambios). Por defecto, uno nuevo sobre `packDir`. */
  store?: PackStore
  signal?: AbortSignal
}

/** Material ya guardado. */
export interface SavedSource {
  meta: SourceMeta
  /** Carpeta `sources/<id>/`. */
  directory: string
}

/** Escribe un material ya leído en `<packDir>/sources/<id>/` y lo registra en el curso. */
export function saveIngestedSource(packDir: string, result: IngestResult, options: SaveSourceOptions = {}): SavedSource {
  checkCancelled(options.signal)
  const characters = result.pages.reduce((n, p) => n + charCount(p.text), 0)
  if (characters === 0 && result.pagesNeedingOCR.length === 0) throw new EmptySourceError(result.title)
  const id = result.sourceID
  const dir = sourceDirectory(packDir, id)
  mkdirSync(dir, { recursive: true })
  const meta: SourceMeta = {
    id,
    title: result.title,
    kind: result.kind,
    addedAt: new Date().toISOString(),
    pages: result.pages.length,
    characters,
    status: 'ready',
    trust: options.trust ?? 'other',
    warnings: result.warnings.slice(0, 4)
  }
  if (options.note) meta.note = options.note
  if (options.url) meta.url = options.url
  if (options.originalPath) {
    const name = basename(options.originalPath)
    if (SafePath.isComponent(name)) {
      const dest = join(dir, name)
      if (!existsSync(dest)) cpSync(options.originalPath, dest, { dereference: true })
      meta.filename = name
    }
  }
  writeChunksFile(packDir, id, result.chunks)
  const stored: StoredPages = { version: PAGES_VERSION, sourceID: id, kind: result.kind, title: result.title, metadata: result.metadata, pages: result.pages, pagesNeedingOCR: result.pagesNeedingOCR }
  writeFileAtomic(pagesPath(packDir, id), JSON.stringify(stored))
  const register = options.register ?? existsSync(join(packDir, 'pack.json'))
  if (register) registerSource(packDir, meta, options.store)
  if (options.reindex ?? true) rebuildCourseIndex(packDir)
  return { meta, directory: dir }
}

/** `chunks.json` como lo escribe Swift (claves ordenadas, sin sangría, sin claves vacías). */
export function writeChunksFile(packDir: string, sourceID: string, chunks: SourceChunk[]): void {
  writeFileAtomic(chunksPath(packDir, sourceID), sortedJSON(chunks))
}

/** Añade (o sustituye) el material en `pack.json → sources[]` (con el cerrojo del curso). */
export function registerSource(packDir: string, meta: SourceMeta, store: PackStore = new PackStore(basename(packDir), packDir)): void {
  store.updatePack((p) => {
    const i = p.sources.findIndex((s) => s.id === meta.id)
    if (i >= 0) p.sources[i] = meta
    else p.sources.push(meta)
  })
}

/** Páginas guardadas de un material (`null` si no hay `pages.json` legible, p. ej. en materiales de la app Swift). */
export function loadSourcePages(packDir: string, sourceID: string): StoredPages | null {
  try {
    const raw = JSON.parse(readFileSync(pagesPath(packDir, sourceID), 'utf8')) as Partial<StoredPages>
    if (raw.version !== PAGES_VERSION || !Array.isArray(raw.pages)) return null
    const pages = raw.pages.filter((p): p is SourcePage => !!p && typeof p === 'object' && Number.isInteger((p as SourcePage).number) && typeof (p as SourcePage).text === 'string')
    return {
      version: PAGES_VERSION,
      sourceID,
      kind: (typeof raw.kind === 'string' ? raw.kind : 'unknown') as SourceKind,
      title: typeof raw.title === 'string' ? raw.title : sourceID,
      metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
      pages,
      pagesNeedingOCR: Array.isArray(raw.pagesNeedingOCR) ? raw.pagesNeedingOCR.filter((n): n is number => Number.isInteger(n)) : []
    }
  } catch {
    return null
  }
}

/** Borra un material: su carpeta (solo si está de verdad dentro de `sources/`), su registro y lo reindexa. */
export function removeSourceFromPack(packDir: string, sourceID: string, store?: PackStore): void {
  const dir = sourceDirectory(packDir, sourceID)
  if (SafePath.isInside(dir, sourcesDirectory(packDir))) rmSync(dir, { recursive: true, force: true })
  if (existsSync(join(packDir, 'pack.json'))) {
    (store ?? new PackStore(basename(packDir), packDir)).updatePack((p) => { p.sources = p.sources.filter((s) => s.id !== sourceID) })
  }
  rebuildCourseIndex(packDir)
}

/**
 * Pasa un material de una carpeta (p. ej. el área de preparación de «Crear curso») a un curso: mueve `sources/<id>/`,
 * lo registra en `pack.json` y reindexa los dos.
 */
export function moveSourceToPack(fromDir: string, meta: SourceMeta, toPackDir: string, store?: PackStore): SourceMeta {
  const from = sourceDirectory(fromDir, meta.id)
  const to = sourceDirectory(toPackDir, meta.id)
  if (!SafePath.isInside(from, sourcesDirectory(fromDir))) throw new AulaError('ingest_corrupt', L('El archivo está dañado o no tiene el formato esperado: %@', meta.id))
  mkdirSync(sourcesDirectory(toPackDir), { recursive: true })
  if (existsSync(to)) rmSync(to, { recursive: true, force: true })
  try {
    renameSync(from, to)
  } catch {
    cpSync(from, to, { recursive: true })               // otro disco: copia y borra
    rmSync(from, { recursive: true, force: true })
  }
  if (existsSync(join(toPackDir, 'pack.json'))) registerSource(toPackDir, meta, store)
  rebuildCourseIndex(toPackDir)
  if (existsSync(sourcesDirectory(fromDir))) rebuildCourseIndex(fromDir)
  return meta
}
