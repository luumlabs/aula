// ¿Sigue iniciada la sesión? Una petición barata con la sesión de la cuenta (que además la mantiene viva en el servidor).
// Sin cookies en el registro y sin el cuerpo: solo el veredicto y su motivo.
import type { PlatformAccount } from '@shared/settings/platforms'
import { extractMoodleSesskey, interpretSessionCheck, isMoodleSessionError, moodleAjaxRequest, parseMoodleAjaxResponse, platformRoot, sessionCheckTargets, type SessionVerdict } from '@engine/platforms'
import type { HttpFetch } from './http'
import { HttpError } from './http'

export interface SessionCheckResult extends SessionVerdict {
  /** Dirección final de la última comprobación (para depurar; sin consulta). */
  checkedURL?: string
}

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

/**
 * Comprueba la sesión. Moodle: primero `core_session_touch` (alarga la sesión sin cargar una página) si se conoce la sesskey;
 * si no, o si falla, la página «Área personal» (que de paso da una sesskey nueva).
 */
export async function checkSession(account: PlatformAccount, fetch: HttpFetch, opts: { signal?: AbortSignal } = {}): Promise<SessionCheckResult> {
  if (account.kind === 'moodle') {
    const touched = await moodleTouch(account, fetch, opts.signal)
    if (touched) return touched
  }
  let last: SessionCheckResult = { state: 'unknown', reason: 'no check' }
  for (const target of sessionCheckTargets(account)) {
    let res
    try {
      res = await fetch(target.url, { method: 'GET', headers: target.headers, redirect: 'follow', maxBytes: 2 * 1024 * 1024, timeoutMs: 20_000, signal: opts.signal })
    } catch (err) {
      last = { state: 'unknown', reason: err instanceof HttpError ? err.code : 'network' }
      continue
    }
    const body = res.text().slice(0, 200_000)
    const verdict = interpretSessionCheck(account, target, {
      status: res.status, finalURL: res.url, redirects: res.redirects, contentType: res.headers.get('content-type'), body
    })
    if (account.kind === 'moodle' && verdict.state === 'signedIn') rememberMoodleSesskey(account.id, extractMoodleSesskey(body))
    if (account.kind === 'moodle' && verdict.state === 'signedOut') rememberMoodleSesskey(account.id, null)
    last = { ...verdict, checkedURL: stripQuery(res.url) }
    if (verdict.state !== 'unknown') return last
  }
  return last
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
