// Sondeo de una dirección SIN sesión (port de StudyPlatformProbe.swift): descarga la página pública (normalmente la de acceso)
// sin cookies, apuntando cada redirección, y la pasa por el detector. Sirve para proponer el tipo y el nombre al añadirla.
// Las redirecciones se siguen a mano y se para ANTES de un salto que empezaría un inicio de sesión (el proveedor de
// identidad o el arranque del SSO de la plataforma, p. ej. /auth/oidc/): el alta nunca empieza un acceso de Microsoft.
import type { PlatformProbeResult } from '@shared/platforms/types'
import { closedPlatformNotice, detectFromHops, extractMoodleConfig, hostOf, normalizePlatformURL, pageTitle, startsSignIn } from '@engine/platforms'
import { pick, tr } from '@shared/ai/i18n'
import { createNodeHttpFetch, type HttpFetch, type HttpResponse, HttpError, isRedirect, nextHop } from './http'

/** Saltos que se siguen como mucho. */
const MAX_HOPS = 10

/** El sondeo con lo que solo usa el proceso principal: el `wwwroot` de Moodle de la página final (su raíz de verdad). */
export interface PlatformProbeOutcome extends PlatformProbeResult {
  wwwroot?: string
}

/** `M.cfg.wwwroot` de la página, si es una dirección web válida. */
export function probeWwwroot(html: string): string | null {
  const w = extractMoodleConfig(html).wwwroot
  if (!w) return null
  try {
    const u = new URL(w)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? w : null
  } catch {
    return null
  }
}

export async function probePlatform(rawURL: string, fetch: HttpFetch = createNodeHttpFetch(), opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<PlatformProbeOutcome> {
  const url = normalizePlatformURL(rawURL)
  if (!url) return { url: rawURL, finalURL: rawURL, kind: null, confidence: null, error: tr('La dirección no es válida.', 'That address isn’t valid.') }
  const notice = closedPlatformNotice(hostOf(url) ?? '')
  const base: PlatformProbeResult = { url, finalURL: url, kind: null, confidence: null, ...(notice ? { notice: pick(notice) } : {}) }
  try {
    const walk = await walkProbe(url, fetch, opts)
    // parado antes de un inicio de sesión: no hay HTML de la plataforma (el del 3xx no dice nada)
    const html = walk.stopped ? '' : walk.res.text()
    const title = pageTitle(html)
    const d = detectFromHops(walk.hops, html || null, title)
    const wwwroot = probeWwwroot(html)
    return {
      ...base, finalURL: walk.finalURL, httpStatus: walk.res.status, ...(title ? { title } : {}), kind: d?.kind ?? null,
      confidence: d?.confidence ?? null, ...(wwwroot ? { wwwroot } : {})
    }
  } catch (err) {
    // sin red se detecta igual por la dirección
    const d = detectFromHops([url], null, null)
    const msg = err instanceof HttpError && err.code === 'too_large' ? tr('La página es demasiado grande.', 'The page is too large.') : err instanceof Error ? err.message : String(err)
    return { ...base, kind: d?.kind ?? null, confidence: d?.confidence ?? null, error: `${tr('No pude abrir la página', 'I couldn’t open the page')}: ${msg}` }
  }
}

/** Lo que queda tras seguir las redirecciones del sondeo: las direcciones (la primera incluida) y la última respuesta. */
interface ProbeWalk {
  hops: string[]
  res: HttpResponse
  /** La última dirección pedida (si se paró, la página de la plataforma de antes del salto: nunca la del proveedor). */
  finalURL: string
  /** Se paró antes de un salto que empezaría un inicio de sesión (es la última de `hops`, sin pedirla). */
  stopped: boolean
}

async function walkProbe(url: string, fetch: HttpFetch, opts: { timeoutMs?: number; maxBytes?: number }): Promise<ProbeWalk> {
  const hops = [url]
  let current = url
  // el tope de tiempo es para todo el sondeo, no para cada salto
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000)
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      redirect: 'manual', maxBytes: opts.maxBytes ?? 600_000, truncate: true, timeoutMs: Math.max(1000, deadline - Date.now())
    })
    // un `fetch` que siguió solo las redirecciones las trae apuntadas
    hops.push(...res.redirects)
    current = res.url || current
    if (hops[hops.length - 1] !== current) hops.push(current)
    const next = isRedirect(res.status) ? nextHop(current, res.headers.get('location')) : null
    if (!next) return { hops, res, finalURL: current, stopped: false }
    hops.push(next)
    if (startsSignIn(current, next)) return { hops, res, finalURL: current, stopped: true }
    if (hop >= MAX_HOPS) throw new HttpError('too_many_redirects', tr('Demasiadas redirecciones', 'Too many redirects'))
    current = next
  }
}
