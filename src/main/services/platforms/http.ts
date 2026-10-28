// Peticiones HTTP de las plataformas con una interfaz común: la del navegador de Aula (con la sesión de la cuenta, en
// src/main/electron/browser/fetch.ts) y la de Node (sin cookies: sondeo y modo token). Así los clientes de Canvas y Moodle se
// prueban con un `fetch` falso. Redirecciones a mano (se apunta cada salto), tope de tamaño y de tiempo.
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'

export interface HttpRequestInit {
  method?: 'GET' | 'POST' | 'HEAD' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string | Uint8Array
  /** 'follow' (por defecto) sigue hasta `maxRedirects` saltos apuntándolos; 'manual' devuelve el 3xx con su Location. */
  redirect?: 'follow' | 'manual'
  maxRedirects?: number
  /** Tope del cuerpo (bytes); por defecto 64 MB. */
  maxBytes?: number
  /** Al llegar al tope, devolver lo leído en vez de fallar (para leer solo el principio de una página). */
  truncate?: boolean
  /** Tope de tiempo (ms); por defecto 30 s. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HttpHeaders {
  get(name: string): string | null
}

export interface HttpResponse {
  status: number
  /** Dirección final (tras las redirecciones seguidas). */
  url: string
  /** Saltos seguidos (sin la primera dirección). */
  redirects: string[]
  headers: HttpHeaders
  body: Uint8Array
  text(): string
  json<T = unknown>(): T
}

export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>

export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
export const DEFAULT_TIMEOUT_MS = 30_000

export class HttpError extends AulaError {
  constructor(code: 'network' | 'timeout' | 'too_large' | 'cancelled' | 'invalid_url' | 'too_many_redirects', message: string, details?: unknown) {
    super(code, message, details)
    this.name = 'HttpError'
  }
}

/** Cabeceras a partir de un objeto (claves en minúsculas; los valores repetidos se unen con «, »). */
export function headersFrom(raw: Record<string, string | string[] | undefined>): HttpHeaders {
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue
    map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : v)
  }
  return { get: (name) => map.get(name.toLowerCase()) ?? null }
}

/** Respuesta en memoria (también la usan las pruebas para fabricar respuestas). */
export function makeResponse(status: number, url: string, headers: HttpHeaders, body: Uint8Array, redirects: string[] = []): HttpResponse {
  let decoded: string | null = null
  return {
    status, url, redirects, headers, body,
    text() {
      if (decoded == null) decoded = new TextDecoder('utf-8', { fatal: false }).decode(body)
      return decoded
    },
    json<T>() {
      return JSON.parse(this.text()) as T
    }
  }
}

/** Respuesta de texto para las pruebas y los adaptadores. */
export function textResponse(status: number, url: string, text: string, headers: Record<string, string> = {}, redirects: string[] = []): HttpResponse {
  return makeResponse(status, url, headersFrom(headers), new TextEncoder().encode(text), redirects)
}

export function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Siguiente salto de una redirección (solo http/https); null si no vale. */
export function nextHop(current: string, location: string | null): string | null {
  if (!location) return null
  try {
    const u = new URL(location, current)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

async function readLimited(res: Response, maxBytes: number, truncate = false): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel() } catch { /* nada */ }
    throw new HttpError('too_large', tr('La respuesta es demasiado grande', 'The response is too large'), { limitBytes: maxBytes })
  }
  if (!res.body) return new Uint8Array()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.byteLength > maxBytes) {
      try { await reader.cancel() } catch { /* nada */ }
      if (!truncate) throw new HttpError('too_large', tr('La respuesta es demasiado grande', 'The response is too large'), { limitBytes: maxBytes })
      chunks.push(value.subarray(0, maxBytes - total))
      total = maxBytes
      break
    }
    total += value.byteLength
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

/**
 * `fetch` de Node SIN cookies (para sondear direcciones y para el modo token de Canvas). Las redirecciones se siguen a mano:
 * así se apunta cada salto y quien llama decide (p. ej. no reenviar un token a otro dominio, con `redirect: 'manual'`).
 */
export function createNodeHttpFetch(fetchImpl: typeof fetch = globalThis.fetch): HttpFetch {
  return async (url, init = {}) => {
    const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxRedirects = init.maxRedirects ?? 10
    const follow = (init.redirect ?? 'follow') === 'follow'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new HttpError('timeout', tr('La página tardó demasiado en responder', 'The page took too long to respond'))), timeoutMs)
    const onAbort = (): void => controller.abort(init.signal?.reason)
    init.signal?.addEventListener('abort', onAbort, { once: true })
    const redirects: string[] = []
    let current = url
    let method = init.method ?? 'GET'
    let body = init.body
    try {
      for (let hop = 0; ; hop++) {
        let res: Response
        try {
          res = await fetchImpl(current, { method, headers: init.headers, body, redirect: 'manual', signal: controller.signal })
        } catch (err) {
          if (controller.signal.aborted) {
            const reason = controller.signal.reason
            if (reason instanceof HttpError) throw reason
            throw new HttpError('cancelled', tr('Cancelado', 'Cancelled'))
          }
          throw new HttpError('network', tr(`No se pudo conectar con ${safeHost(current)}`, `Couldn’t connect to ${safeHost(current)}`), { cause: err instanceof Error ? err.message : String(err) })
        }
        const headers = headersFrom(Object.fromEntries(res.headers.entries()))
        if (follow && isRedirect(res.status)) {
          const next = nextHop(current, res.headers.get('location'))
          try { await res.body?.cancel() } catch { /* nada */ }
          if (!next) return makeResponse(res.status, current, headers, new Uint8Array(), redirects)
          if (hop >= maxRedirects) throw new HttpError('too_many_redirects', tr('Demasiadas redirecciones', 'Too many redirects'))
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
            method = 'GET'
            body = undefined
          }
          redirects.push(next)
          current = next
          continue
        }
        const bytes = method === 'HEAD' ? new Uint8Array() : await readLimited(res, maxBytes, init.truncate === true)
        return makeResponse(res.status, current, headers, bytes, redirects)
      }
    } catch (err) {
      if (err instanceof HttpError) throw err
      const reason: unknown = controller.signal.reason
      if (controller.signal.aborted) throw reason instanceof HttpError ? reason : new HttpError('cancelled', tr('Cancelado', 'Cancelled'))
      throw new HttpError('network', tr(`Se cortó la conexión con ${safeHost(current)}`, `The connection to ${safeHost(current)} was cut off`), { cause: err instanceof Error ? err.message : String(err) })
    } finally {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onAbort)
    }
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return tr('el sitio', 'the site')
  }
}
