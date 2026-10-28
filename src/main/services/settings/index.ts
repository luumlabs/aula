// settings.json: carga con valores por defecto, parches profundos, escritura atómica (con fsync y copia de la versión anterior,
// `.settings.json.bak`) y aviso de cambios. Un settings.json dañado no se sustituye en silencio por los valores por defecto: se
// copia al lado (`settings.json.damaged-…`) y se usa la versión anterior si la hay.
import { existsSync } from 'node:fs'
import { defaultSettings, type AppSettings, type SettingsPatch } from '@shared/settings'
import { paths } from '../paths'
import { readWithBackup, writeJSONAtomic } from '../fs'
import { log } from '../log'

type Listener = (s: AppSettings, prev: AppSettings) => void
let current: AppSettings | null = null
const listeners = new Set<Listener>()

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Mezcla profunda: los objetos se combinan; los arrays y valores simples se sustituyen. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isObject(out[k]) && isObject(v) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/** ¿Son ajustes de esta app? (versión 2 o una más nueva: lo que no conoce se conserva tal cual) */
const isOurs = (raw: unknown): raw is Record<string, unknown> => isObject(raw) && typeof raw.version === 'number' && raw.version >= 2

export function loadSettings(): AppSettings {
  if (current) return current
  const file = paths.settings()
  // Los ajustes de la app Swift (version ausente) no se reutilizan salvo lo que tenga equivalente claro.
  const read = existsSync(file) ? readWithBackup(file, (text) => {
    const raw = JSON.parse(text) as unknown
    if (!isObject(raw)) throw new Error('settings.json no es un objeto')
    return raw
  }) : undefined
  if (read?.fromBackup) log.warn(`settings.json estaba dañado; uso su versión anterior${read.damagedCopy ? ' (copia del dañado al lado)' : ''}`)
  else if (!read && existsSync(file)) log.warn('settings.json no se puede leer y no hay versión anterior: uso los valores por defecto (el dañado queda copiado al lado)')
  const raw = read?.value
  const base = defaultSettings()
  current = isOurs(raw) ? withoutRetired(deepMerge(base, raw)) : base
  return current
}

/** Ajustes que ya no existen (interruptores que no hacían nada): se olvidan al cargar. */
const RETIRED: Record<string, string[]> = { data: ['semanticSearch'], general: ['sounds'] }

export function withoutRetired(s: AppSettings): AppSettings {
  for (const [section, keys] of Object.entries(RETIRED)) {
    const obj = (s as unknown as Record<string, unknown>)[section]
    if (isObject(obj)) for (const k of keys) delete obj[k]
  }
  return s
}

export function getSettings(): AppSettings {
  return current ?? loadSettings()
}

export function updateSettings(patch: SettingsPatch | ((s: AppSettings) => AppSettings)): AppSettings {
  const prev = getSettings()
  const next = typeof patch === 'function' ? patch(structuredClone(prev)) : deepMerge(prev, patch)
  // una versión más nueva de Aula no baja de número al guardar aquí
  next.version = Math.max(2, typeof prev.version === 'number' ? prev.version : 2) as AppSettings['version']
  current = next
  try {
    writeJSONAtomic(paths.settings(), next, true, { backup: true })
  } catch (err) {
    log.error('No se pudieron guardar los ajustes', err)
  }
  for (const fn of listeners) fn(next, prev)
  return next
}

export function onSettingsChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Solo para pruebas. */
export function resetSettingsCache(): void {
  current = null
}
