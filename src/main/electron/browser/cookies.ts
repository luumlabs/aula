// Copia y reposición de las cookies de la sesión de una cuenta (la clave para no volver a iniciar sesión tras reiniciar):
// al salir, cada 5 minutos y tras iniciar sesión se guarda una copia cifrada; al arrancar se reponen las que faltan con una
// caducidad (las de sesión, 30 días; las del servidor, la suya). Nunca se registran los valores.
import type { Cookie } from 'electron'
import type { PlatformAccount } from '@shared/settings/platforms'
import { hostOf, platformInfo, type CookieLike } from '@engine/platforms'
import { cookiesToRestore, saveCookieSnapshot } from '@main/services/platforms/cookie-store'
import { platformSettings } from '@main/services/platforms/accounts'
import { log } from '@main/services/log'
import { platformSession } from './sessions'

function toLike(c: Cookie): CookieLike {
  return {
    name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
    session: c.session, expirationDate: c.expirationDate, sameSite: c.sameSite
  }
}

/** Hosts que van primero si hay que recortar la copia (el de la plataforma y sus hosts en la nube). */
function priorityHosts(account: PlatformAccount): string[] {
  const out = [hostOf(account.baseURL) ?? '']
  for (const p of platformInfo(account.kind).hostPatterns) out.push(p.replace(/^\*\./, ''))
  out.push('login.microsoftonline.com', 'accounts.google.com')
  return out.filter(Boolean)
}

/** Guarda la copia de las cookies de la cuenta (si cambió). */
export async function snapshotCookies(account: PlatformAccount): Promise<boolean> {
  const ses = platformSession(account.id)
  try {
    const all = await ses.cookies.get({})
    return saveCookieSnapshot(account.id, all.map(toLike), Date.now(), { priorityHosts: priorityHosts(account) })
  } catch (err) {
    log.warn(`[platforms] no se pudieron copiar las cookies (${account.id}):`, err instanceof Error ? err.message : String(err))
    return false
  }
}

/** Repone las cookies que falten (al arrancar, antes de cualquier petición). Devuelve cuántas repuso. */
export async function restoreCookies(account: PlatformAccount): Promise<number> {
  const ses = platformSession(account.id)
  let existing: Cookie[] = []
  try {
    existing = await ses.cookies.get({})
  } catch { /* sesión vacía */ }
  const plan = cookiesToRestore(account.id, existing.map(toLike), Date.now(), { sessionCookieDays: platformSettings().sessionCookieDays })
  let ok = 0
  for (const details of plan) {
    try {
      await ses.cookies.set(details)
      ok++
    } catch {
      // una cookie que Chromium rechaza (dominio raro, prefijo) no impide las demás; sin valores en el registro
    }
  }
  if (plan.length) {
    log.info(`[platforms] ${ok}/${plan.length} cookies repuestas (${account.id})`)
    try { await ses.cookies.flushStore() } catch { /* nada */ }
  }
  return ok
}
