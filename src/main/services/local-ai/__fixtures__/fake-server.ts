// Servidor HTTP falso en 127.0.0.1 para las pruebas de los modelos locales (port de `Tests/LocalAIKitTests/Support/FakeServer.swift`):
// respuestas JSON, NDJSON, archivos con `Range`, redirecciones y registro de las peticiones.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Record<string, string | string[] | undefined>
  body: string
  json?: unknown
}

export interface FakeResponse {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer
  /** Trozos enviados uno a uno (con `delayMs` entre ellos). */
  chunks?: (string | Buffer)[]
  delayMs?: number
}

export const reply = {
  json: (value: unknown, status = 200): FakeResponse => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }),
  ndjson: (lines: unknown[], delayMs = 0): FakeResponse => ({ status: 200, headers: { 'content-type': 'application/x-ndjson' }, chunks: lines.map((l) => JSON.stringify(l) + '\n'), delayMs }),
  text: (text: string, status = 200): FakeResponse => ({ status, body: text }),
  notFound: (): FakeResponse => ({ status: 404, body: 'not found' }),
  /** Un archivo con soporte de `Range: bytes=N-` (206 + Content-Range). */
  file(data: Buffer, req: FakeRequest, o: { chunkSize?: number; delayMs?: number } = {}): FakeResponse {
    const range = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''))
    const start = range ? Number(range[1]) : 0
    if (start > data.length) return { status: 416 }
    const body = data.subarray(start)
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'accept-ranges': 'bytes' }
    if (range) headers['content-range'] = `bytes ${start}-${data.length - 1}/${data.length}`
    const size = o.chunkSize ?? body.length
    const chunks: Buffer[] = []
    for (let i = 0; i < body.length; i += Math.max(1, size)) chunks.push(body.subarray(i, i + size))
    return { status: range ? 206 : 200, headers, chunks, delayMs: o.delayMs }
  }
}

export class FakeServer {
  readonly requests: FakeRequest[] = []
  private server?: Server
  private readonly sockets = new Set<import('node:net').Socket>()
  origin = ''

  constructor(private readonly handler: (req: FakeRequest) => FakeResponse | Promise<FakeResponse>) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.serve(req, res))
    this.server.on('connection', (s) => {
      this.sockets.add(s)
      s.on('close', () => this.sockets.delete(s))
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve()))
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    return this.origin
  }

  requestsTo(path: string): FakeRequest[] {
    return this.requests.filter((r) => r.path === path)
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parts: Buffer[] = []
    for await (const c of req) parts.push(c as Buffer)
    const body = Buffer.concat(parts).toString('utf8')
    const url = new URL(req.url ?? '/', 'http://x')
    let json: unknown
    try {
      json = body ? JSON.parse(body) : undefined
    } catch {
      json = undefined
    }
    const request: FakeRequest = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, body, json }
    this.requests.push(request)
    let response: FakeResponse
    try {
      response = await this.handler(request)
    } catch {
      response = { status: 500 }
    }
    res.writeHead(response.status ?? 200, response.headers ?? {})
    if (response.chunks) {
      for (const chunk of response.chunks) {
        if (res.destroyed) return
        res.write(chunk)
        if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs))
      }
      res.end()
    } else {
      res.end(response.body ?? '')
    }
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy()
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
  }
}
