// Versiones que no se pudieron instalar: no se reintentan solas (sin bucles de descargas). Una descarga dañada sí se
// reintenta, hasta MAX_CORRUPT veces (puede ser la red); una firma no válida, un fallo al colocarla o una versión que no
// llegó a abrirse, nunca: Ajustes lo explica (y «Buscar actualizaciones» lo intenta otra vez).
// Se apunta también la huella de lo publicado (los SHA-512 de sus archivos): si esa misma versión se vuelve a subir
// corregida, ya es otra cosa y se intenta sola (A1-P2-9).
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { UpdateErrorCode } from '@shared/ipc/updates'
import { readJSON, writeJSONAtomic } from '../fs'

export interface FailedInstall {
  version: string
  /** 'corrupt' | 'signature' | 'install' | 'permission' | 'disk' | 'system' | 'start' (lo escribe el vigilante) | … */
  reason: string
  attempts?: number
  at?: string
  /** Huella de lo que se ofreció (fingerprintOf). */
  fingerprint?: string
}

export const MAX_CORRUPT = 3

export function readFailed(file: string): FailedInstall | null {
  const f = readJSON<FailedInstall>(file)
  return f && typeof f.version === 'string' && typeof f.reason === 'string' ? f : null
}

/** Huella de una versión publicada: los SHA-512 de sus archivos (de latest-*.yml), en orden. */
export function fingerprintOf(info: { files?: unknown; sha512?: unknown }): string | undefined {
  const files = Array.isArray(info.files) ? info.files : []
  const shas = files.map((f) => (f && typeof f === 'object' ? (f as { sha512?: unknown }).sha512 : undefined)).filter((s): s is string => typeof s === 'string' && s.length > 0)
  if (!shas.length && typeof info.sha512 === 'string' && info.sha512) shas.push(info.sha512)
  return shas.length ? shas.sort().join(',') : undefined
}

function sameOffer(f: FailedInstall, version: string, fingerprint?: string): boolean {
  if (f.version !== version) return false
  return !(f.fingerprint && fingerprint && f.fingerprint !== fingerprint)
}

export function recordFailure(file: string, version: string, reason: string, fingerprint?: string): FailedInstall {
  const prev = readFailed(file)
  const attempts = prev && sameOffer(prev, version, fingerprint) ? (prev.attempts ?? 1) + 1 : 1
  const next: FailedInstall = { version, reason, attempts, at: new Date().toISOString(), ...(fingerprint ? { fingerprint } : {}) }
  mkdirSync(dirname(file), { recursive: true })
  writeJSONAtomic(file, next)
  return next
}

/** ¿Hay que dejar de intentar sola esta versión (con esta huella)? */
export function blocksAutoRetry(f: FailedInstall | null, version: string, fingerprint?: string): boolean {
  if (!f || !sameOffer(f, version, fingerprint)) return false
  if (f.reason === 'corrupt') return (f.attempts ?? 1) >= MAX_CORRUPT
  return true
}

/** El código que la interfaz explica para un fallo apuntado. */
export function errorOfFailure(reason: string): UpdateErrorCode {
  if (reason === 'signature' || reason === 'corrupt' || reason === 'permission' || reason === 'disk' || reason === 'system') return reason
  return 'install' // 'install', 'start' (no llegó a abrirse) y lo demás
}
