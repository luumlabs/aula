// Redes con proxy (las de muchos centros y empresas): el `fetch` de Node no lo usa y la IA por clave de API, la búsqueda
// en internet o las imágenes fallarían. Si el sistema tiene un proxy configurado, las peticiones del proceso principal van
// por la red de Chromium (`net.fetch`), que sí lo respeta. Sin proxy no cambia nada.
// Las peticiones con redirecciones a mano (el lector de páginas públicas valida cada salto) usan `net.request`, porque
// `net.fetch` no devuelve el 3xx con `redirect: 'manual'`: con su cuerpo y SIN cookies (una sesión en memoria compartida no
// debe ir guardando y reenviando las cookies de las páginas que se leen). Solo http(s) en los dos caminos.
import { net, session } from 'electron'
import { log } from '@main/services/log'
import { setSystemProxyActive } from '@main/services/network'
import type { HttpFetch, HttpRequestInit } from '@main/services/platforms/http'
import { sessionFetch } from './browser/fetch'

/** Lo que el lector de páginas mira de la respuesta (el resto de cabeceras no hace falta). */
const KEPT_HEADERS = ['location', 'content-type', 'content-length', 'content-disposition', 'last-modified', 'etag']
/** Tope del cuerpo con redirecciones a mano: el lector pone el suyo (de 3 a 6 MB). */
const MANUAL_MAX_BYTES = 8_000_000

function headerObject(h: RequestInit['headers'] | Headers): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  new Headers(h).forEach((v, k) => { out[k] = v })
  return out
}

/** Solo direcciones web: `net.fetch` también abriría file:// (cualquier archivo del equipo) o los protocolos de la app. */
export function webAddress(input: string | URL | Request): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TypeError('Dirección no válida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError(`Solo se admiten direcciones http y https (no ${url.protocol})`)
  return url.toString()
}

/** El `fetch` por la red de Chromium. `manual`: el de las redirecciones a mano (sin cookies); `netFetch`: el resto. */
export function chromiumFetch(manual: HttpFetch, netFetch: (input: string | Request, init?: RequestInit) => Promise<Response>): typeof fetch {
  const viaChromium = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = webAddress(input)
    if (init?.redirect === 'manual' && (typeof input === 'string' || input instanceof URL)) {
      // el cuerpo y sus cabeceras (p. ej. el content-type de un formulario) como los pondría fetch
      const request = new Request(url, init)
      const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined
      const r = await manual(url, {
        method: request.method as HttpRequestInit['method'], headers: headerObject(request.headers), redirect: 'manual',
        maxBytes: MANUAL_MAX_BYTES, ...(body ? { body } : {}), ...(init.signal ? { signal: init.signal } : {})
      })
      const headers = new Headers()
      for (const k of KEPT_HEADERS) { const v = r.headers.get(k); if (v !== null) headers.set(k, v) }
      const noBody = r.status === 204 || r.status === 304 || (r.status >= 300 && r.status < 400)
      return new Response(noBody ? null : r.body, { status: r.status, headers })
    }
    return netFetch(input instanceof URL ? url : input, init)
  }
  return viaChromium as typeof fetch
}

/** Si hay un proxy del sistema, `fetch` va por la red de Chromium. Devuelve la regla del proxy (o null si no hay). */
export async function useSystemProxy(): Promise<string | null> {
  let rule = 'DIRECT'
  try {
    rule = (await session.defaultSession.resolveProxy('https://www.wikipedia.org/')).trim()
  } catch {
    return null
  }
  if (!rule || rule.toUpperCase() === 'DIRECT') return null
  // sesión en memoria y sin cookies: nada de lo que respondan unas páginas se envía a otras (ni a la misma más tarde)
  const manual = sessionFetch(session.fromPartition('aula-red'), { cookies: false })
  globalThis.fetch = chromiumFetch(manual, (input, init) => net.fetch(input, init as never))
  setSystemProxyActive(true)
  log.info(`[red] proxy del sistema (${rule}): las peticiones del proceso principal van por la red de Chromium`)
  return rule
}
