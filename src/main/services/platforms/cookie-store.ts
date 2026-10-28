// Copia cifrada de las cookies de cada cuenta en el almacén de secretos (`platform.cookies.<id>`). Los valores nunca se
// registran: solo el resumen de `describeSnapshot`.
import { platformSecretKeys } from '@shared/settings/platforms'
import { describeSnapshot, makeSnapshot, parseSnapshot, planRestore, serializeSnapshot, type CookieLike, type CookieSetDetails, type CookieSnapshot, type RestoreOptions, type SnapshotOptions } from '@engine/platforms'
import { secrets } from '../secrets'
import { log } from '../log'

export function loadCookieSnapshot(accountId: string): CookieSnapshot | null {
  return parseSnapshot(secrets().get(platformSecretKeys.cookies(accountId)))
}

/** Guarda la copia si cambió (evita reescribir el almacén cifrado cada 5 minutos sin motivo). Devuelve true si escribió. */
export function saveCookieSnapshot(accountId: string, cookies: CookieLike[], now = Date.now(), opts: SnapshotOptions = {}): boolean {
  const previous = loadCookieSnapshot(accountId)
  const snap = makeSnapshot(cookies, now, opts, previous)
  if (previous && sameCookies(previous, snap) && now - previous.savedAt < 6 * 3600_000) return false
  if (snap.cookies.length === 0 && !previous) return false
  secrets().set(platformSecretKeys.cookies(accountId), serializeSnapshot(snap))
  log.debug(`[platforms] cookies guardadas (${accountId}): ${describeSnapshot(snap)}`)
  return true
}

export function clearCookieSnapshot(accountId: string): void {
  secrets().delete(platformSecretKeys.cookies(accountId))
}

/** Cookies que hay que reponer en la sesión al arrancar (las que faltan, con la caducidad que toca). */
export function cookiesToRestore(accountId: string, existing: CookieLike[], now = Date.now(), opts: RestoreOptions = {}): CookieSetDetails[] {
  return planRestore(loadCookieSnapshot(accountId), existing, now, opts)
}

function sameCookies(a: CookieSnapshot, b: CookieSnapshot): boolean {
  if (a.cookies.length !== b.cookies.length) return false
  const key = (c: CookieSnapshot['cookies'][number]): string => `${c.name}\u0000${c.domain}\u0000${c.path}\u0000${c.value}\u0000${c.session}\u0000${c.expirationDate ?? ''}`
  const set = new Set(a.cookies.map(key))
  return b.cookies.every((c) => set.has(key(c)))
}
