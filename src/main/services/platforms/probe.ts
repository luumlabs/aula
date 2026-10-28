// Sondeo de una dirección SIN sesión (port de StudyPlatformProbe.swift): descarga la página pública (normalmente la de acceso)
// sin cookies, apuntando cada redirección, y la pasa por el detector. Sirve para proponer el tipo y el nombre al añadirla.
import type { PlatformProbeResult } from '@shared/platforms/types'
import { closedPlatformNotice, detectFromHops, hostOf, normalizePlatformURL, pageTitle } from '@engine/platforms'
import { pick, tr } from '@shared/ai/i18n'
import { createNodeHttpFetch, type HttpFetch, HttpError } from './http'

export async function probePlatform(rawURL: string, fetch: HttpFetch = createNodeHttpFetch(), opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<PlatformProbeResult> {
  const url = normalizePlatformURL(rawURL)
  if (!url) return { url: rawURL, finalURL: rawURL, kind: null, confidence: null, error: tr('La dirección no es válida.', 'That address isn’t valid.') }
  const notice = closedPlatformNotice(hostOf(url) ?? '')
  const base: PlatformProbeResult = { url, finalURL: url, kind: null, confidence: null, ...(notice ? { notice: pick(notice) } : {}) }
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      redirect: 'follow', maxRedirects: 10, maxBytes: opts.maxBytes ?? 600_000, truncate: true, timeoutMs: opts.timeoutMs ?? 15_000
    })
    const html = res.text()
    const title = pageTitle(html)
    const hops = [url, ...res.redirects]
    const d = detectFromHops(hops, html, title)
    return { ...base, finalURL: res.url, httpStatus: res.status, ...(title ? { title } : {}), kind: d?.kind ?? null, confidence: d?.confidence ?? null }
  } catch (err) {
    // sin red se detecta igual por la dirección
    const d = detectFromHops([url], null, null)
    const msg = err instanceof HttpError && err.code === 'too_large' ? tr('La página es demasiado grande.', 'The page is too large.') : err instanceof Error ? err.message : String(err)
    return { ...base, kind: d?.kind ?? null, confidence: d?.confidence ?? null, error: `${tr('No pude abrir la página', 'I couldn’t open the page')}: ${msg}` }
  }
}
