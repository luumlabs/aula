// Cuentas de plataformas (settings.json → platforms.accounts): alta, baja y cambios. Los secretos (cookies, calendario, token)
// van al almacén cifrado con las claves de `platformSecretKeys`; aquí solo hay referencias.
import { randomBytes } from 'node:crypto'
import type { PlatformAccount, PlatformKind, PlatformSettings } from '@shared/settings/platforms'
import { platformSecretKeys } from '@shared/settings/platforms'
import { accountDisplayName, detectPlatform, normalizePlatformURL, originOf, parsePlatformKind } from '@engine/platforms'
import { getSettings, updateSettings } from '../settings'
import { secrets } from '../secrets'
import { AulaError, invalidArgs } from '../errors'
import { tr } from '@shared/ai/i18n'

export function platformSettings(): PlatformSettings {
  return getSettings().platforms
}

export function listAccounts(): PlatformAccount[] {
  return (platformSettings().accounts ?? []).map(sanitizeAccount).filter((a): a is PlatformAccount => a !== null)
}

export function getAccount(id: string): PlatformAccount | null {
  return listAccounts().find((a) => a.id === id) ?? null
}

export function requireAccount(id: unknown): PlatformAccount {
  if (typeof id !== 'string' || !id) throw invalidArgs(tr('Falta la cuenta', 'The account is missing'))
  const a = getAccount(id)
  if (!a) throw new AulaError('not_found', tr('No encuentro esa plataforma', 'I can’t find that platform'))
  return a
}

/** Lectura tolerante de una cuenta guardada (de esta versión o escrita a mano). */
export function sanitizeAccount(raw: unknown): PlatformAccount | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id)) return null
  const baseURL = typeof o.baseURL === 'string' ? normalizePlatformURL(o.baseURL) : null
  if (!baseURL) return null
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  const lastState = o.lastState === 'signedIn' || o.lastState === 'needsSignIn' ? o.lastState : undefined
  return {
    id: o.id,
    kind: parsePlatformKind(o.kind),
    label: typeof o.label === 'string' ? o.label : '',
    baseURL,
    calendarSecretRef: str(o.calendarSecretRef),
    tokenSecretRef: str(o.tokenSecretRef),
    notes: str(o.notes),
    lastState,
    lastCheckedAt: str(o.lastCheckedAt),
    lastSignedInAt: str(o.lastSignedInAt),
    createdAt: str(o.createdAt)
  }
}

/** Id corto y seguro para la partición (`persist:platform-<id>`). */
export function newAccountId(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Crea la cuenta por su dirección (o devuelve la que ya tiene ese sitio, actualizando tipo y nombre si se dan). El tipo se
 * detecta por la dirección si no se indica (o con lo que diga el sondeo).
 */
export function addAccount(input: { url: string; kind?: PlatformKind; label?: string }): PlatformAccount {
  const baseURL = normalizePlatformURL(input.url ?? '')
  if (!baseURL) throw invalidArgs(
      tr('La dirección no es válida. Escribe algo como campus.tuuniversidad.edu', 'That address isn’t valid. Type something like campus.youruniversity.edu')
    )
  const origin = originOf(baseURL)
  const existing = listAccounts().find((a) => originOf(a.baseURL) === origin)
  if (existing) {
    if (!input.kind && !input.label) return existing
    return updateAccount(existing.id, {
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.label ? { label: input.label.trim().slice(0, 120) } : {})
    })
  }
  const kind = input.kind ? parsePlatformKind(input.kind) : detectPlatform({ url: baseURL })?.kind ?? 'other'
  const account: PlatformAccount = {
    id: newAccountId(),
    kind,
    label: (input.label ?? '').trim().slice(0, 120),
    baseURL,
    lastState: 'unknown',
    createdAt: new Date().toISOString()
  }
  if (!account.label) account.label = accountDisplayName(account)
  updateSettings((s) => {
    s.platforms.accounts = [...(s.platforms.accounts ?? []), account]
    return s
  })
  return account
}

export function updateAccount(id: string, patch: Partial<Omit<PlatformAccount, 'id'>>): PlatformAccount {
  let updated: PlatformAccount | null = null
  updateSettings((s) => {
    s.platforms.accounts = (s.platforms.accounts ?? []).map((a) => {
      if (a.id !== id) return a
      updated = { ...a, ...patch, id }
      return updated
    })
    return s
  })
  if (!updated) throw new AulaError('not_found', tr('No encuentro esa plataforma', 'I can’t find that platform'))
  return updated
}

/** Quita la cuenta y sus secretos (cookies guardadas, calendario, token). El almacenamiento del navegador lo borra el llamador. */
export function removeAccount(id: string): void {
  const a = getAccount(id)
  updateSettings((s) => {
    s.platforms.accounts = (s.platforms.accounts ?? []).filter((x) => x.id !== id)
    return s
  })
  forgetAccountSecrets(id, a)
}

export function forgetAccountSecrets(id: string, a?: PlatformAccount | null, opts: { keepCalendar?: boolean; keepToken?: boolean } = {}): void {
  const store = secrets()
  store.delete(platformSecretKeys.cookies(id))
  if (!opts.keepCalendar) {
    store.delete(platformSecretKeys.calendar(id))
    if (a?.calendarSecretRef) store.delete(a.calendarSecretRef)
  }
  if (!opts.keepToken) {
    store.delete(platformSecretKeys.canvasToken(id))
    if (a?.tokenSecretRef) store.delete(a.tokenSecretRef)
  }
}

/** Token de Canvas (modo token, opcional). Nunca sale del proceso principal. */
export function canvasToken(account: PlatformAccount): string | null {
  if (!account.tokenSecretRef) return null
  return secrets().get(account.tokenSecretRef)
}

export function setCanvasToken(accountId: string, token: string | null): PlatformAccount {
  const key = platformSecretKeys.canvasToken(accountId)
  if (token && token.trim()) {
    const t = token.trim()
    if (!/^[A-Za-z0-9~_.-]{20,200}$/.test(t)) throw invalidArgs(tr('El token de acceso tiene caracteres no válidos. Cópialo de nuevo, sin espacios.', 'The access token has invalid characters. Copy it again, without spaces.'))
    secrets().set(key, t)
    return updateAccount(accountId, { tokenSecretRef: key })
  }
  secrets().delete(key)
  return updateAccount(accountId, { tokenSecretRef: undefined })
}
