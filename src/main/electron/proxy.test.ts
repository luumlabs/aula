// Con un proxy del sistema, `fetch` va por la red de Chromium: solo http(s) (net.fetch también abriría file://), y las
// redirecciones a mano (el lector web) llevan su cuerpo y NO usan las cookies de la sesión compartida.
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

interface FakeRequest extends EventEmitter { options: Record<string, unknown>; headers: Record<string, string>; written: Buffer[]; setHeader(k: string, v: string): void; write(c: string | Buffer): void; end(): void; abort(): void }
const requests: FakeRequest[] = []

vi.mock('electron', () => ({
  net: {
    fetch: vi.fn(),
    request: (options: Record<string, unknown>) => {
      const req = new EventEmitter() as FakeRequest
      req.options = options
      req.headers = {}
      req.written = []
      req.setHeader = (k, v) => { req.headers[k.toLowerCase()] = v }
      req.write = (c) => { req.written.push(Buffer.from(c)) }
      req.abort = () => undefined
      req.end = () => {
        // responde enseguida con un 200 vacío
        setImmediate(() => {
          const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
          res.statusCode = 200
          res.headers = { 'content-type': 'text/plain' }
          req.emit('response', res)
          res.emit('data', Buffer.from('ok'))
          res.emit('end')
        })
      }
      requests.push(req)
      return req
    }
  },
  session: { fromPartition: vi.fn(), defaultSession: { resolveProxy: vi.fn() } }
}))

describe('red de Chromium con proxy', () => {
  it('rechaza todo lo que no sea http(s), por los dos caminos', async () => {
    const { chromiumFetch } = await import('./proxy')
    const manual = vi.fn()
    const netFetch = vi.fn(async () => new Response('x'))
    const f = chromiumFetch(manual, netFetch)
    for (const url of ['file:///etc/passwd', 'aula-asset://pack/curso/x.png', 'javascript:alert(1)', 'ftp://ejemplo.org/a', '/relativa']) {
      await expect(f(url)).rejects.toThrow(TypeError)
      await expect(f(url, { redirect: 'manual' })).rejects.toThrow(TypeError)
    }
    await expect(f(new Request('file:///etc/passwd'))).rejects.toThrow(TypeError)
    expect(manual).not.toHaveBeenCalled()
    expect(netFetch).not.toHaveBeenCalled()
    await f('https://ejemplo.org/a')
    expect(netFetch).toHaveBeenCalledTimes(1)
  })

  it('las redirecciones a mano llevan el cuerpo (y su content-type) y no usan cookies', async () => {
    const { chromiumFetch } = await import('./proxy')
    const { sessionFetch } = await import('./browser/fetch')
    requests.length = 0
    const f = chromiumFetch(sessionFetch({} as never, { cookies: false }), vi.fn())
    const res = await f('https://ejemplo.org/token', { method: 'POST', body: new URLSearchParams({ a: '1', b: 'dos' }), redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req.options.method).toBe('POST')
    expect(req.options.useSessionCookies).toBe(false)
    expect(req.options.credentials).toBeUndefined()
    expect(Buffer.concat(req.written).toString()).toBe('a=1&b=dos')
    expect(req.headers['content-type']).toContain('application/x-www-form-urlencoded')
  })

  it('el navegador de las plataformas sigue con las cookies de su sesión', async () => {
    const { sessionFetch } = await import('./browser/fetch')
    requests.length = 0
    await sessionFetch({} as never)('https://campus.ejemplo.edu/', { method: 'POST', body: 'x=1' })
    expect(requests[0].options.useSessionCookies).toBe(true)
    expect(requests[0].options.credentials).toBe('include')
    expect(Buffer.concat(requests[0].written).toString()).toBe('x=1')
  })
})
