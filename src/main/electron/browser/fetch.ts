// `fetchWithSession`: peticiones con la red de Chromium y las cookies de la sesión de una cuenta (como haría la propia página).
// Las respuestas pueden traer cookies nuevas (Set-Cookie) y se guardan en la sesión: así la caducidad se desliza. Con
// `cookies: false` (la red de Chromium del proxy) no se envían ni se guardan cookies; la autenticación del proxy sigue.
// Redirecciones a mano (se apuntan los saltos para saber si se acabó en la página de acceso o en el SSO).
import { net, type Session } from 'electron'
import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, HttpError, headersFrom, makeResponse, type HttpFetch, type HttpResponse } from '@main/services/platforms/http'

/** Cabeceras que la página no puede fijar (las pone Chromium). */
const FORBIDDEN_HEADERS = new Set(['host', 'cookie', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization'])

export interface SessionFetchOptions {
  /** Enviar y guardar las cookies de la sesión (por defecto, sí: es la sesión de la cuenta de una plataforma). */
  cookies?: boolean
}

export function sessionFetch(ses: Session, opts: SessionFetchOptions = {}): HttpFetch {
  const cookies = opts.cookies ?? true
  return async (url, init = {}) => {
    const maxRedirects = init.maxRedirects ?? 10
    const follow = (init.redirect ?? 'follow') === 'follow'
    const redirects: string[] = []
    let current = url
    let method: string = init.method ?? 'GET'
    let body = init.body
    for (let hop = 0; ; hop++) {
      const r = await once(ses, current, method, body, init, cookies)
      if (r.redirect) {
        if (!follow) return r.response
        if (hop >= maxRedirects) throw new HttpError('too_many_redirects', 'Demasiadas redirecciones')
        const status = r.response.status
        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
        }
        redirects.push(r.redirect)
        current = r.redirect
        continue
      }
      return makeResponse(r.response.status, current, r.response.headers, r.response.body, redirects)
    }
  }
}

interface OnceResult {
  response: HttpResponse
  /** Dirección a la que redirige (si es una redirección http(s)). */
  redirect?: string
}

function once(ses: Session, url: string, method: string, body: string | Uint8Array | undefined, init: Parameters<HttpFetch>[1] & object, cookies: boolean): Promise<OnceResult> {
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<OnceResult>((resolve, reject) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      reject(new HttpError('invalid_url', 'Dirección no válida'))
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new HttpError('invalid_url', 'Solo se abren direcciones web'))
      return
    }
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // sin cookies: ni `credentials` ni las de la sesión (sin `credentials`, Electron no usa cookies pero sí la autenticación
    // de la sesión, p. ej. la del proxy de un centro; con «omit» tampoco iría)
    const jar = cookies ? { useSessionCookies: true, credentials: 'include' as const } : { useSessionCookies: false }
    const req = net.request({ method, url, session: ses, ...jar, redirect: 'manual', cache: 'no-store' })
    for (const [k, v] of Object.entries(init.headers ?? {})) if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) req.setHeader(k, v)
    const timer = setTimeout(() => {
      done(() => reject(new HttpError('timeout', 'La página tardó demasiado en responder')))
      try { req.abort() } catch { /* nada */ }
    }, timeoutMs)
    const onAbort = (): void => {
      done(() => reject(new HttpError('cancelled', 'Cancelado')))
      try { req.abort() } catch { /* nada */ }
    }
    init.signal?.addEventListener('abort', onAbort, { once: true })
    // sin credenciales HTTP (Basic/NTLM): se cancela y llega el 401
    req.on('login', (_info, callback) => callback())
    req.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      let next: string | undefined
      try {
        const u = new URL(redirectUrl, url)
        if (u.protocol === 'https:' || u.protocol === 'http:') next = u.toString()
      } catch { /* sin destino */ }
      const headers = headersFrom(responseHeaders as Record<string, string | string[]>)
      done(() => resolve({ response: makeResponse(statusCode, url, headers, new Uint8Array()), ...(next ? { redirect: next } : {}) }))
      // no se sigue aquí: cada salto es una petición nueva (así se apunta y se decide)
      try { req.abort() } catch { /* nada */ }
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (chunk: Buffer) => {
        if (settled) return
        total += chunk.length
        if (total > maxBytes) {
          done(() => reject(new HttpError('too_large', 'La respuesta es demasiado grande', { limitBytes: maxBytes })))
          try { req.abort() } catch { /* nada */ }
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const headers = headersFrom(res.headers as Record<string, string | string[]>)
        const buf = Buffer.concat(chunks)
        done(() => resolve({ response: makeResponse(res.statusCode, url, headers, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)) }))
      })
      res.on('error', (err: Error) => done(() => reject(new HttpError('network', 'Se cortó la conexión', { cause: err.message }))))
    })
    req.on('error', (err) => {
      done(() => reject(new HttpError('network', `No se pudo conectar con ${parsed.hostname}`, { cause: err.message })))
    })
    if (body != null) req.write(typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength))
    req.end()
  })
}
