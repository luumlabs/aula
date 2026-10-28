// IPC del dominio «platforms»: cuentas de plataformas, inicio de sesión (una vez: la sesión se guarda y se mantiene viva),
// cursos, calendario y permisos. Al registrar arranca el navegador (reposición de cookies + mantener la sesión) y se instala
// la copia final de las cookies al salir.
import { handle, emit } from '../rpc'
import { invalidArgs } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { log } from '@main/services/log'
import { PLATFORM_KINDS, type PlatformKind } from '@shared/settings/platforms'
import { installQuitHook, platformBrowser } from '../browser'

function id(args: unknown, key = 'accountId'): string {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw invalidArgs(tr('Falta la cuenta', 'The account is missing'))
  return v
}

function url(args: unknown): string {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>).url : undefined
  if (typeof v !== 'string' || !v.trim() || v.length > 2048) throw invalidArgs(tr('Falta la dirección', 'The address is missing'))
  return v.trim()
}

function optString(args: unknown, key: string, max: number): string | undefined {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined
  if (v == null) return undefined
  if (typeof v !== 'string' || v.length > max) throw invalidArgs(`${tr('Valor no válido', 'Invalid value')}: ${key}`)
  return v
}

function optKind(args: unknown): PlatformKind | undefined {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>).kind : undefined
  if (v == null) return undefined
  if (typeof v !== 'string' || !(PLATFORM_KINDS as readonly string[]).includes(v)) throw invalidArgs(tr('Tipo de plataforma no válido', 'Invalid platform type'))
  return v as PlatformKind
}

export function register(): void {
  const browser = platformBrowser()
  const c = browser.controller

  handle('platforms.list', () => c.list())
  handle('platforms.probe', (args) => c.probe(url(args)))
  handle('platforms.add', (args) => c.add({ url: url(args), kind: optKind(args), label: optString(args, 'label', 120) }))
  handle('platforms.signIn', (args) => c.signIn(id(args)))
  handle('platforms.confirmSignIn', (args) => c.confirmSignIn(id(args)))
  handle('platforms.signOut', (args) => c.signOut(id(args)))
  handle('platforms.remove', (args) => c.remove(id(args)))
  handle('platforms.update', (args) => c.update(id(args), { label: optString(args, 'label', 120), notes: optString(args, 'notes', 2000) }))
  handle('platforms.check', (args) => c.check(id(args)))
  handle('platforms.courses', (args) => c.courses(id(args)))
  handle('platforms.connectCalendar', (args) => c.connectCalendar(id(args)))
  handle('platforms.setCanvasToken', (args) => {
    const raw = args && typeof args === 'object' ? (args as Record<string, unknown>).token : undefined
    if (raw != null && (typeof raw !== 'string' || raw.length > 400)) throw invalidArgs(tr('Token no válido', 'Invalid token'))
    return c.setCanvasToken(id(args), typeof raw === 'string' && raw.trim() ? raw : null)
  })
  handle('platforms.approve', (args) => {
    const allow = args && typeof args === 'object' ? (args as Record<string, unknown>).allow : undefined
    if (typeof allow !== 'boolean') throw invalidArgs(tr('Falta la respuesta', 'The answer is missing'))
    browser.approve(id(args, 'id'), allow)
  })
  handle('platforms.approvals', () => browser.approvals())

  c.on('status', (view) => emit('platforms.status', view))
  c.on('signedIn', (view) => emit('platforms.signedIn', { accountId: view.id, account: view }))
  browser.onApproval((e) => emit('platforms.approval', e))

  installQuitHook(browser)
  void browser.start().catch((err) => log.error('[platforms] arranque del navegador de plataformas', err))
}
