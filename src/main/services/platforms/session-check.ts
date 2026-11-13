// ¿Sigue iniciada la sesión? Una petición barata con la sesión de la cuenta (que además la mantiene viva en el servidor).
// Sin cookies en el registro y sin el cuerpo: solo el veredicto y su motivo. Las redirecciones se siguen a mano y se para
// ANTES de la página de acceso o del SSO: una comprobación de fondo nunca empieza otro inicio de sesión (Microsoft, OIDC…).
import type { PlatformAccount } from '@shared/settings/platforms'
import {
  accountContains, extractMoodleSesskey, hostOf, interpretSessionCheck, isAccountLoginURL, isIdentityHost, isMoodleSessionError, moodleAjaxRequest,
  parseMoodleAjaxResponse, platformRoot, sessionCheckTargets, type SessionCheckTarget, type SessionVerdict
} from '@engine/platforms'
import { tr } from '@shared/ai/i18n'
import type { HttpFetch, HttpResponse } from './http'
import { HttpError, isRedirect, nextHop } from './http'

export interface SessionCheckResult extends SessionVerdict {
  /** Dirección final de la última comprobación (para depurar; sin consulta). */
  checkedURL?: string
}

export interface SessionCheckOptions {
  signal?: AbortSignal
  /** Sin el atajo `core_session_touch` de Moodle (funciona aunque haya un paso pendiente): se mira la página. */
  skipTouch?: boolean
}

/** Saltos que se siguen como mucho en una comprobación. */
const MAX_HOPS = 10

/** Caché de la sesskey de Moodle por cuenta (para el «toque» AJAX barato). Solo en memoria. */
const moodleSesskeys = new Map<string, string>()

export function rememberMoodleSesskey(accountId: string, sesskey: string | null): void {
  if (sesskey) moodleSesskeys.set(accountId, sesskey)
  else moodleSesskeys.delete(accountId)
}

export function cachedMoodleSesskey(accountId: string): string | null {
  return moodleSesskeys.get(accountId) ?? null
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return ''
  }
}

const cancelled = (): SessionCheckResult => ({ state: 'unknown', reason: 'cancelled' })

/**
 * Comprueba la sesión. Moodle: primero `core_session_touch` (alarga la sesión sin cargar una página) si se conoce la sesskey
 * y no se pide `skipTouch`; si no, o si falla, la página «Área personal» (que de paso da una sesskey nueva).
 */
export async function checkSession(account: PlatformAccount, fetch: HttpFetch, opts: SessionCheckOptions = {}): Promise<SessionCheckResult> {
  if (opts.signal?.aborted) return cancelled()
  if (account.kind === 'moodle' && !opts.skipTouch) {
    const touched = await moodleTouch(account, fetch, opts.signal)
    if (touched) return touched
  }
  let last: SessionCheckResult = { state: 'unknown', reason: 'no check' }
  for (const target of sessionCheckTargets(account)) {
    // una petición cortada no deja seguir con el siguiente destino (la señal ya no volvería a avisar)
    if (opts.signal?.aborted) return cancelled()
    let walk: HopWalk
    try {
      walk = await walkHops(account, target, fetch, opts.signal)
    } catch (err) {
      if (opts.signal?.aborted) return cancelled()
      last = { state: 'unknown', reason: err instanceof HttpError ? err.code : 'network' }
      continue
    }
    const verdict = interpretSessionCheck(account, target, {
      status: walk.status, finalURL: walk.finalURL, redirects: walk.redirects, contentType: walk.contentType, body: walk.body
    })
    if (account.kind === 'moodle' && verdict.state === 'signedIn') rememberMoodleSesskey(account.id, extractMoodleSesskey(walk.body))
    if (account.kind === 'moodle' && verdict.state === 'signedOut') rememberMoodleSesskey(account.id, null)
    last = { ...verdict, checkedURL: stripQuery(walk.finalURL) }
    // un paso pendiente lo dirá también el siguiente destino: no hace falta pedirlo
    if (verdict.state !== 'unknown' || verdict.pendingStep) return last
  }
  return last
}

/** Lo que queda tras seguir los saltos de un destino (o pararse antes del acceso). */
interface HopWalk {
  status: number
  finalURL: string
  /** Saltos seguidos (sin la primera dirección), como `HttpResponse.redirects`. */
  redirects: string[]
  contentType: string | null
  body: string
}

/** ¿Este salto es la página de acceso o el SSO? Entonces no se pide (el veredicto ya es «cerrada»). */
export function stopsBeforeHop(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  if (isAccountLoginURL(account, url)) return true
  const host = hostOf(url)
  return !!host && !accountContains(account, url) && isIdentityHost(host)
}

/** Sigue a mano las redirecciones de un destino (hasta 10); los demás saltos (http→https, otro host del campus) se siguen. */
async function walkHops(account: PlatformAccount, target: SessionCheckTarget, fetch: HttpFetch, signal?: AbortSignal): Promise<HopWalk> {
  const redirects: string[] = []
  let current = target.url
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      method: 'GET', headers: target.headers, redirect: 'manual', maxBytes: 2 * 1024 * 1024, timeoutMs: 20_000, signal
    })
    // un `fetch` que siguió solo las redirecciones las trae apuntadas
    redirects.push(...res.redirects)
    current = res.url || current
    const next = isRedirect(res.status) ? nextHop(current, res.headers.get('location')) : null
    if (!next) return finished(res, current, redirects)
    // la cadena que se interpreta lleva ese salto como dirección final (sin pedirlo)
    if (stopsBeforeHop(account, next)) return { status: res.status, finalURL: next, redirects, contentType: null, body: '' }
    if (hop >= MAX_HOPS) throw new HttpError('too_many_redirects', tr('Demasiadas redirecciones', 'Too many redirects'))
    redirects.push(next)
    current = next
  }
}

function finished(res: HttpResponse, url: string, redirects: string[]): HopWalk {
  // el cuerpo entero (ya viene con el tope de la petición): la prueba de usuario de Moodle puede ir al final
  return { status: res.status, finalURL: url, redirects, contentType: res.headers.get('content-type'), body: res.text() }
}

async function moodleTouch(account: PlatformAccount, fetch: HttpFetch, signal?: AbortSignal): Promise<SessionCheckResult | null> {
  const sesskey = cachedMoodleSesskey(account.id)
  if (!sesskey) return null
  const { url, body } = moodleAjaxRequest(platformRoot('moodle', account.baseURL), sesskey, [{ methodname: 'core_session_touch', args: {} }])
  try {
    const res = await fetch(url, {
      method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      redirect: 'manual', maxBytes: 256 * 1024, timeoutMs: 15_000, signal
    })
    if (res.status !== 200) return null
    const [r] = parseMoodleAjaxResponse(res.text())
    if (r?.ok) return { state: 'signedIn', reason: 'Moodle: core_session_touch' }
    if (r && isMoodleSessionError(r.errorcode)) {
      rememberMoodleSesskey(account.id, null)
      return null // se confirma con la página (puede ser solo una sesskey vieja)
    }
    return null
  } catch {
    return null
  }
}
