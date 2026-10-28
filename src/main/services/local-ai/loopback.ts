// Peticiones a servidores de modelos de ESTE ordenador (Ollama, LM Studio, llama.cpp, el motor de Aula)
// (port de `LocalAIKit/Engines/LoopbackHTTP.swift`). Solo una dirección de bucle local literal (`127.0.0.1` o `::1`;
// `localhost` se convierte en `127.0.0.1`), sin proxies, sin seguir redirecciones, con un tope de bytes y plazos cortos.
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { tr } from '@shared/ai/i18n'

export type LoopbackFailureKind = 'notLoopback' | 'unreachable' | 'status' | 'badResponse'

export class LoopbackError extends Error {
  constructor(
    readonly kind: LoopbackFailureKind,
    readonly status?: number,
    readonly body?: string
  ) {
    super(LoopbackError.describe(kind, status, body))
    this.name = 'LoopbackError'
  }

  static describe(kind: LoopbackFailureKind, status?: number, body?: string): string {
    switch (kind) {
      case 'notLoopback':
        return tr('Esa dirección no es de este ordenador: Aula solo habla con servidores de modelos locales.', 'That address isn’t on this computer: Aula only talks to local model servers.')
      case 'unreachable':
        return tr('El servidor de modelos de este ordenador no responde. ¿Está abierto (Ollama, LM Studio)?', 'The model server on this computer isn’t responding. Is it open (Ollama, LM Studio)?')
      case 'status': {
        const detail = (body ?? '').trim()
        return detail
          ? tr(`El servidor de modelos de este ordenador respondió con un error (${status}): ${detail.slice(0, 300)}`, `The model server on this computer answered with an error (${status}): ${detail.slice(0, 300)}`)
          : tr(`El servidor de modelos de este ordenador respondió con un error (${status}).`, `The model server on this computer answered with an error (${status}).`)
      }
      default:
        return tr('El servidor de modelos de este ordenador dio una respuesta que Aula no entiende.', 'The model server on this computer gave an answer Aula doesn’t understand.')
    }
  }
}

/** `127.0.0.1` / `::1` para una URL de este ordenador; `undefined` para cualquier otra. */
export function loopbackHost(url: URL): string | undefined {
  let host = url.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost') return '127.0.0.1'
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return '::1'
  const parts = host.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255) && parts[0] === '127') return host
  return undefined
}

export interface LoopbackRequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

export class LoopbackHTTP {
  private constructor(
    /** Origen literal, p. ej. `http://127.0.0.1:11434`. */
    readonly origin: string,
    readonly host: string,
    readonly port: number,
    readonly timeoutMs: number,
    readonly maxBody: number
  ) {}

  /** `undefined` si la URL no es de este ordenador. `http://localhost:11434/v1` → origen `http://127.0.0.1:11434`. */
  static create(raw: string, timeoutMs = 2500, maxBody = 8 * 1024 * 1024): LoopbackHTTP | undefined {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return undefined
    }
    if (url.protocol !== 'http:' || url.username || url.password) return undefined
    const host = loopbackHost(url)
    if (!host) return undefined
    const port = url.port ? Number(url.port) : 80
    const origin = `http://${host === '::1' ? '[::1]' : host}:${port}`
    return new LoopbackHTTP(origin, host, port, timeoutMs, maxBody)
  }

  /** Comprueba que `path` no se salga del origen. */
  private resolve(path: string): URL {
    const target = new URL(path, this.origin + '/')
    if (target.origin !== new URL(this.origin).origin || target.username || target.password) throw new LoopbackError('notLoopback')
    return target
  }

  private send(path: string, opts: LoopbackRequestOptions): Promise<IncomingMessage> {
    const target = this.resolve(path)
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: this.host,
          port: this.port,
          path: target.pathname + target.search,
          method: opts.method ?? (body ? 'POST' : 'GET'),
          headers: {
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}),
            ...(opts.headers ?? {})
          },
          agent: false
        },
        (res) => {
          clearTimeout(timer)
          resolve(res)
        }
      )
      const timer = setTimeout(() => req.destroy(new LoopbackError('unreachable')), opts.timeoutMs ?? this.timeoutMs)
      const onAbort = (): void => {
        const err = new Error('Cancelado')
        err.name = 'AbortError'
        req.destroy(err)
      }
      if (opts.signal?.aborted) onAbort()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => opts.signal?.removeEventListener('abort', onAbort))
      req.on('error', (err) => {
        clearTimeout(timer)
        reject(err instanceof LoopbackError || err.name === 'AbortError' ? err : new LoopbackError('unreachable'))
      })
      req.end(body)
    })
  }

  /** Petición con respuesta en bruto (limitada a `maxBody`). Un estado que no sea 2xx (también 3xx) lanza `status`. */
  async data(path: string, opts: LoopbackRequestOptions = {}): Promise<Buffer> {
    const res = await this.send(path, opts)
    const parts: Buffer[] = []
    let size = 0
    await new Promise<void>((resolve, reject) => {
      // el primer desenlace manda (cortar una respuesta demasiado grande también dispara «aborted»)
      let settled = false
      const fail = (err: LoopbackError): void => {
        if (settled) return
        settled = true
        reject(err)
      }
      res.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > this.maxBody) {
          fail(new LoopbackError('badResponse'))
          res.destroy()
          return
        }
        parts.push(chunk)
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      res.on('error', () => fail(new LoopbackError('unreachable')))
      res.on('aborted', () => fail(new LoopbackError('unreachable')))
    })
    const data = Buffer.concat(parts)
    const status = res.statusCode ?? 0
    if (status < 200 || status >= 300) throw new LoopbackError('status', status, data.subarray(0, 400).toString('utf8'))
    return data
  }

  /** Petición con respuesta JSON. */
  async json(path: string, opts: LoopbackRequestOptions = {}): Promise<unknown> {
    const data = await this.data(path, opts)
    try {
      return JSON.parse(data.toString('utf8'))
    } catch {
      throw new LoopbackError('badResponse')
    }
  }

  /** Respuesta por líneas JSON (NDJSON, p. ej. `/api/pull` de Ollama); se puede cancelar con `signal`. */
  async lines(path: string, opts: LoopbackRequestOptions & { idleTimeoutMs?: number }, onLine: (value: unknown) => void): Promise<void> {
    const res = await this.send(path, { method: 'POST', ...opts, timeoutMs: opts.idleTimeoutMs ?? 120_000 })
    const status = res.statusCode ?? 0
    if (status < 200 || status >= 300) {
      const parts: Buffer[] = []
      for await (const chunk of res) {
        parts.push(chunk as Buffer)
        if (Buffer.concat(parts).length > 4000) break
      }
      throw new LoopbackError('status', status, Buffer.concat(parts).toString('utf8'))
    }
    let pending = ''
    for await (const chunk of res) {
      pending += (chunk as Buffer).toString('utf8')
      let nl: number
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).trim()
        pending = pending.slice(nl + 1)
        if (!line || line.length > 1 << 20) continue
        try {
          onLine(JSON.parse(line))
        } catch (err) {
          if (err instanceof SyntaxError) continue
          throw err
        }
      }
    }
  }
}
