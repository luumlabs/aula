// `fetch` falso para las pruebas de los clientes (Canvas, Moodle, comprobación de la sesión): una tabla de respuestas por
// dirección (o «MÉTODO dirección») y la lista de llamadas. Sin red. Solo lo importan las pruebas.
import { HttpError, textResponse, type HttpFetch, type HttpRequestInit, type HttpResponse } from './http'

export interface FakeCall {
  url: string
  init: HttpRequestInit
}

export type FakeRoute = HttpResponse | ((url: string, init: HttpRequestInit, n: number) => HttpResponse | Promise<HttpResponse>)

export interface FakeHttp {
  fetch: HttpFetch
  calls: FakeCall[]
  /** Añade o cambia una ruta. */
  route(key: string, r: FakeRoute): void
}

/** Las claves son «https://…» (cualquier método) o «POST https://…». Sin ruta: error de red. */
export function fakeHttp(routes: Record<string, FakeRoute> = {}): FakeHttp {
  const table = new Map(Object.entries(routes))
  const calls: FakeCall[] = []
  const hits = new Map<string, number>()
  const fetch: HttpFetch = async (url, init = {}) => {
    calls.push({ url, init })
    const key = table.has(`${init.method ?? 'GET'} ${url}`) ? `${init.method ?? 'GET'} ${url}` : url
    const r = table.get(key)
    if (!r) throw new HttpError('network', `sin ruta: ${url}`)
    const n = (hits.get(key) ?? 0) + 1
    hits.set(key, n)
    return typeof r === 'function' ? r(url, init, n) : r
  }
  return { fetch, calls, route: (k, r) => table.set(k, r) }
}

export function json(url: string, data: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return textResponse(status, url, JSON.stringify(data), { 'content-type': 'application/json', ...headers })
}

export function html(url: string, body: string, status = 200, redirects: string[] = []): HttpResponse {
  return textResponse(status, url, body, { 'content-type': 'text/html' }, redirects)
}

export function redirectTo(url: string, location: string, status = 302): HttpResponse {
  return textResponse(status, url, '', { location })
}
