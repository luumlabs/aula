// Fichas de los archivos de un curso y páginas de materiales, leídas del disco (port de AssetCatalog y de
// `ContentValidator.bound(to:)`): el validador y el enriquecimiento las usan para comprobar que las imágenes existen, sus
// medidas y su crédito, y que una página de un material se puede dibujar como figura.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { SourceMeta, SourceRef } from '@shared/schema'
import { MODEL_EXTENSIONS } from '@shared/schema'
import { ContentValidator, decodeAssetMeta, imageSize, locateSourcePage, type AssetLookup, type AssetMeta, type ValidatorOptions } from '@engine/content'
import { writeJSONAtomic } from '../fs'
import type { PackStore } from '../store'

/** Los primeros bytes de un archivo (las cabeceras de imagen están al principio). */
function head(file: string, bytes = 256 * 1024): Uint8Array {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(bytes, statSync(file).size))
    readSync(fd, buf, 0, buf.length, 0)
    return new Uint8Array(buf)
  } finally { closeSync(fd) }
}

const metaPath = (store: PackStore, id: string): string => `${store.assetsDirectory}/${basename(id)}.meta.json`

/** Guarda la ficha de un archivo traído con add_image / add_model. */
export function saveAssetMeta(store: PackStore, id: string, meta: AssetMeta): void {
  writeJSONAtomic(metaPath(store, id), meta)
}

/** La ficha guardada o, si no hay, las medidas leídas de la imagen. */
export function loadAssetMeta(store: PackStore, id: string): AssetMeta | undefined {
  try {
    const saved = decodeAssetMeta(JSON.parse(readFileSync(metaPath(store, id), 'utf8')))
    if (saved) return saved
  } catch { /* sin ficha */ }
  const file = store.assetPath(id)
  if (!file) return undefined
  if (MODEL_EXTENSIONS.has(extname(file).slice(1).toLowerCase())) return { kind: 'model' }
  try {
    const size = imageSize(head(file))
    return size ? { kind: 'image', width: size[0], height: size[1] } : undefined
  } catch { return undefined }
}

/** El original de un material (si se guardó), para dibujar una de sus páginas. */
function sourceOriginal(store: PackStore, sources: readonly SourceMeta[], ref: SourceRef): { meta: SourceMeta; ext: string; bytes: Uint8Array } | undefined {
  const meta = sources.find((s) => s.id === ref.source)
  const file = meta ? store.originalPath(meta) : undefined
  if (!meta || !file) return undefined
  try {
    const ext = extname(file).slice(1).toLowerCase()
    // un PDF se lee entero (las páginas están repartidas); de una foto basta la cabecera
    const bytes = ext === 'pdf' ? new Uint8Array(readFileSync(file)) : head(file)
    return { meta, ext, bytes }
  } catch { return undefined }
}

/** Lo que el enriquecimiento necesita del curso. */
export function assetLookup(store: PackStore): AssetLookup {
  let sources: SourceMeta[] | undefined
  const list = (): SourceMeta[] => { if (!sources) { try { sources = store.loadPack().sources } catch { sources = [] } } return sources }
  return {
    meta: (id) => loadAssetMeta(store, id),
    sourceAspect: (ref) => locateSourcePage(ref, sourceOriginal(store, list(), ref))?.aspect
  }
}

/** El validador ligado a un curso: comprueba de verdad los archivos, sus fichas y las páginas de los materiales. */
export function boundValidator(store: PackStore, base: ValidatorOptions = {}): ContentValidator {
  let sources: SourceMeta[] = []
  try { sources = store.loadPack().sources } catch { /* curso ilegible: sin materiales */ }
  const ids = new Set(sources.map((s) => s.id))
  return ContentValidator.withMath({
    ...base,
    assetExists: (id) => store.assetPath(id) !== undefined,
    assetInfo: (id) => loadAssetMeta(store, id),
    sourceExists: (id) => ids.has(id),
    sourcePageDrawable: (ref) => locateSourcePage(ref, sourceOriginal(store, sources, ref)) !== undefined
  })
}
