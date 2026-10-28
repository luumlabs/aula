// Archivos de los materiales de un curso, con el formato de la app Swift (StudyModel/Store.swift):
//   Packs/<curso>/pack.json            → `sources[]` (SourceMeta)
//   Packs/<curso>/sources/<id>/        original + chunks.json
//   Packs/<curso>/sources/index.json   índice de búsqueda (caché derivada de los chunks.json)
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SourceChunk, SourceMeta, SourcePage } from '@shared/ingest'
import { writeFileAtomic } from '../fs'
import { validChunk } from '../search/searchIndex'
import { SafePath } from '../store/safePath'

export const SOURCES_DIR = 'sources'
export const CHUNKS_FILE = 'chunks.json'
export const INDEX_FILE = 'index.json'
/** Páginas del material (texto por página, figuras, OCR) para citar y para ver las páginas escaneadas. */
export const PAGES_FILE = 'pages.json'

export function sourcesDirectory(packDir: string): string {
  return join(packDir, SOURCES_DIR)
}

/** Carpeta de un material (un id que no sirve como nombre de carpeta da una carpeta inexistente dentro de `sources/`). */
export function sourceDirectory(packDir: string, id: string): string {
  return join(sourcesDirectory(packDir), SafePath.component(id))
}

export function chunksPath(packDir: string, id: string): string {
  return join(sourceDirectory(packDir, id), CHUNKS_FILE)
}

export function pagesPath(packDir: string, id: string): string {
  return join(sourceDirectory(packDir, id), PAGES_FILE)
}

export function searchIndexPath(packDir: string): string {
  return join(sourcesDirectory(packDir), INDEX_FILE)
}

/** Fragmentos de una fuente (los que no tienen el formato esperado se ignoran). Vacío si no hay archivo. */
export function loadChunks(packDir: string, sourceID: string): SourceChunk[] {
  const path = chunksPath(packDir, sourceID)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: SourceChunk[] = []
  for (const item of raw) { const c = validChunk(item); if (c) out.push(c) }
  return out
}

/** JSON con las claves ordenadas y sin sangría (como `JSONCoders.makeEncoder(pretty: false)` de Swift). */
export function sortedJSON(value: unknown, pretty = false): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k])
      return out
    }
    return v
  }
  return JSON.stringify(sortKeys(value), null, pretty ? 2 : undefined)
}

export function writeChunks(packDir: string, sourceID: string, chunks: SourceChunk[]): void {
  writeFileAtomic(chunksPath(packDir, sourceID), sortedJSON(chunks))
}

/** Materiales registrados en `pack.json` (o `null` si no hay curso legible). */
export function readPackSources(packDir: string): SourceMeta[] | null {
  try {
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8')) as { sources?: unknown }
    if (!Array.isArray(pack.sources)) return []
    return pack.sources.filter((s): s is SourceMeta => s !== null && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string')
  } catch {
    return null
  }
}

/** Ids de las fuentes del curso: las de `pack.json` en su orden o, sin curso, las carpetas de `sources/`. */
export function sourceIDs(packDir: string): string[] {
  const registered = readPackSources(packDir)
  if (registered !== null) return registered.map((s) => s.id)
  const dir = sourcesDirectory(packDir)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, CHUNKS_FILE))).map((d) => d.name).sort()
  } catch {
    return []
  }
}

/** Todos los fragmentos del curso (como `PackStore.allChunks`). */
export function allChunks(packDir: string): SourceChunk[] {
  return sourceIDs(packDir).flatMap((id) => loadChunks(packDir, id))
}

/** Huella de los `chunks.json` del curso (para saber si el índice guardado sigue al día). */
export function chunksSignature(packDir: string): { signature: string; newest: number } {
  const h = createHash('sha256')
  let newest = 0
  for (const id of sourceIDs(packDir)) {
    h.update(id + '\u001F')
    try {
      const st = statSync(chunksPath(packDir, id))
      h.update(`${st.size}:${st.mtimeMs}\u001E`)
      newest = Math.max(newest, st.mtimeMs)
    } catch {
      h.update('-\u001E')
    }
  }
  return { signature: h.digest('hex'), newest }
}
