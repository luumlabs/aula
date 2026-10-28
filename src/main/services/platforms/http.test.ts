import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, createNodeHttpFetch, headersFrom, isRedirect, nextHop, textResponse } from './http'

type Call = { url: string; method: string; body?: string; headers?: RequestInit['headers'] }
type Input = Parameters<typeof fetch>[0]

/** `fetch` falso: una tabla de respuestas por dirección. */
function fakeFetch(routes: Record<string, () => Response>, calls: Call[] = []): typeof fetch {
  return (async (input: Input, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined, headers: init?.headers })
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const r = routes[url]
    if (!r) throw new TypeError('fetch failed')
    return r()
  }) as typeof fetch
}

const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } })
const ok = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers })

describe('fetch de Node (sin cookies)', () => {
  afterEach(() => vi.useRealTimers())

  it('sigue las redirecciones apuntando cada salto', async () => {
    const f = createNodeHttpFetch(fakeFetch({
      'https://a.edu/': redirect('/login'),
      'https://a.edu/login': redirect('https://sso.a.edu/idp'),
      'https://sso.a.edu/idp': ok('<title>SSO</title>', { 'content-type': 'text/html' })
    }))
    const res = await f('https://a.edu/')
    expect(res.status).toBe(200)
    expect(res.url).toBe('https://sso.a.edu/idp')
    expect(res.redirects).toEqual(['https://a.edu/login', 'https://sso.a.edu/idp'])
    expect(res.text()).toContain('SSO')
    expect(res.headers.get('Content-Type')).toBe('text/html')
  })

  it('303 (y 302 tras POST) pasan a GET sin cuerpo', async () => {
    const calls: Call[] = []
    const f = createNodeHttpFetch(fakeFetch({ 'https://a.edu/form': redirect('/done', 303), 'https://a.edu/done': ok('hecho') }, calls))
    await f('https://a.edu/form', { method: 'POST', body: 'x=1' })
    expect(calls.map((c) => [c.method, c.body])).toEqual([['POST', 'x=1'], ['GET', undefined]])
  })

  it('modo manual: devuelve el 3xx', async () => {
    const f = createNodeHttpFetch(fakeFetch({ 'https://a.edu/': redirect('/login') }))
    const res = await f('https://a.edu/', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('demasiadas redirecciones', async () => {
    const f = createNodeHttpFetch(fakeFetch({ 'https://a.edu/x': redirect('/x') }))
    await expect(f('https://a.edu/x', { maxRedirects: 3 })).rejects.toMatchObject({ code: 'too_many_redirects' })
  })

  it('tope de tamaño: falla o recorta', async () => {
    const f = createNodeHttpFetch(fakeFetch({ 'https://a.edu/big': ok('x'.repeat(5000)) }))
    await expect(f('https://a.edu/big', { maxBytes: 100 })).rejects.toBeInstanceOf(HttpError)
    const r = await f('https://a.edu/big', { maxBytes: 100, truncate: true })
    expect(r.body.byteLength).toBe(100)
    const declared = createNodeHttpFetch(fakeFetch({ 'https://a.edu/d': () => new Response('abc', { headers: { 'content-length': '999999' } }) }))
    await expect(declared('https://a.edu/d', { maxBytes: 10 })).rejects.toMatchObject({ code: 'too_large' })
  })

  it('error de red y tiempo agotado', async () => {
    const f = createNodeHttpFetch(fakeFetch({}))
    await expect(f('https://nada.edu/')).rejects.toMatchObject({ code: 'network' })
    const slow = createNodeHttpFetch(((_u: Input, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })) as typeof fetch)
    // tiempo agotado con reloj falso: nada de esperas reales
    vi.useFakeTimers()
    const late = slow('https://lento.edu/', { timeoutMs: 30_000 })
    const settled = expect(late).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(29_999)
    let done = false
    void late.catch(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await settled
    vi.useRealTimers()
    const ctl = new AbortController()
    const p = slow('https://lento.edu/', { timeoutMs: 5000, signal: ctl.signal })
    ctl.abort()
    await expect(p).rejects.toMatchObject({ code: 'cancelled' })
  })
})

describe('piezas', () => {
  it('saltos y cabeceras', () => {
    expect(isRedirect(307)).toBe(true)
    expect(isRedirect(304)).toBe(false)
    expect(nextHop('https://a.edu/x/y', '../z')).toBe('https://a.edu/z')
    expect(nextHop('https://a.edu/', 'javascript:alert(1)')).toBeNull()
    expect(nextHop('https://a.edu/', null)).toBeNull()
    expect(headersFrom({ 'Set-Cookie': ['a=1', 'b=2'], X: 'y', Z: undefined }).get('set-cookie')).toBe('a=1, b=2')
    const r = textResponse(200, 'https://a.edu/', '{"a":1}')
    expect(r.json()).toEqual({ a: 1 })
  })
})
