// Caché de los catálogos de modelos en <datos>/Cache/ai-models/<proveedor>.json, con caducidad. Si la API falla y hay una copia
// (aunque esté vieja), se devuelve esa con el motivo: mejor una lista de ayer que la de modelos conocidos.
import { join } from 'node:path'
import type { ModelCatalog } from '@shared/ai/types'
import { paths } from '../../paths'
import { readJSON, writeJSONAtomic } from '../../fs'
import { log } from '../../log'
import type { ProviderConfig } from '../providers/config'
import type { ProviderDeps } from '../providers/base'
import { fetchModelCatalog } from './catalogs'

/** Seis horas: los catálogos cambian poco y pedirlos cuesta una petición (y la de OpenRouter es grande). */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000

interface CacheFile {
  schema: 1
  /** Huella de lo que afecta a la lista (dirección y tipo): si cambia, la copia no vale. */
  signature: string
  catalog: ModelCatalog
}

const memory = new Map<string, CacheFile>()

function cacheDir(): string | null {
  try {
    return join(paths.cache(), 'ai-models')
  } catch {
    return null // sin carpeta de datos (pruebas): solo en memoria
  }
}

const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')
const signatureOf = (c: ProviderConfig) => `${c.kind}|${c.baseURL ?? ''}`

function readCache(id: string): CacheFile | null {
  const mem = memory.get(id)
  if (mem) return mem
  const dir = cacheDir()
  if (!dir) return null
  const f = readJSON<CacheFile>(join(dir, safeName(id) + '.json'))
  if (!f || f.schema !== 1 || !f.catalog || !Array.isArray(f.catalog.models)) return null
  memory.set(id, f)
  return f
}

function writeCache(id: string, f: CacheFile): void {
  memory.set(id, f)
  const dir = cacheDir()
  if (!dir) return
  try {
    writeJSONAtomic(join(dir, safeName(id) + '.json'), f, false)
  } catch (err) {
    log.warn('IA: no se pudo guardar el catálogo de modelos', err)
  }
}

export interface CatalogOptions {
  /** Pedirlo a la API aunque la copia esté al día. */
  refresh?: boolean
  deps?: ProviderDeps
  signal?: AbortSignal
  ttlMs?: number
  now?: number
}

/** El catálogo de un proveedor: la copia si está al día; si no, la API (y si falla, la copia vieja o los modelos conocidos). */
export async function providerCatalog(config: ProviderConfig, opts: CatalogOptions = {}): Promise<ModelCatalog> {
  const now = opts.now ?? Date.now()
  const ttl = opts.ttlMs ?? CATALOG_TTL_MS
  const signature = signatureOf(config)
  const cached = readCache(config.id)
  const valid = cached && cached.signature === signature ? cached : null
  if (valid && !opts.refresh && now - valid.catalog.fetchedAt < ttl && valid.catalog.source === 'api') return valid.catalog
  const fresh = await fetchModelCatalog(config, opts.deps, opts.signal, now)
  if (fresh.source === 'api') {
    writeCache(config.id, { schema: 1, signature, catalog: fresh })
    return fresh
  }
  if (valid && valid.catalog.source === 'api') return { ...valid.catalog, problem: fresh.problem }
  return fresh
}

/** La copia guardada (sin red), si la hay. */
export function cachedCatalog(config: ProviderConfig): ModelCatalog | null {
  const c = readCache(config.id)
  return c && c.signature === signatureOf(config) ? c.catalog : null
}

/** Para pruebas. */
export function clearCatalogMemory(): void {
  memory.clear()
}
