// Port de CanvasKitTests/ICSFeedTests.swift con un `fetch` simulado (sin red real).
import { describe, expect, it } from 'vitest'
import { looksLikeCalendar, normalizeFeedURL } from '@engine/calendar/ics'
import { fetchICSFeed, ICS_MAX_BYTES, retryAfterSeconds, translateNetworkError, CalendarFeedError, type FetchLike } from './feeds'

const FEED = 'https://school.instructure.com/feeds/calendars/user_AbCdEf123456.ics'
const PATH = '/feeds/calendars/user_AbCdEf123456.ics'
const now = new Date('2024-10-15T12:00:00Z')
const NY = 'America/New_York'

const CANVAS_ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Instructure//Canvas//EN', 'BEGIN:VEVENT', 'UID:event-assignment-9001', 'DTSTART:20241021T035900Z',
  'DTEND:20241021T035900Z', 'SUMMARY:Examen 2 [MATH112-12345]', 'URL;VALUE=URI:https://school.instructure.com/courses/123/assignments/9001', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:event-assignment-9002', 'DTSTART;VALUE=DATE:20241024', 'SUMMARY:Homework 5 [MATH112-12345]', 'END:VEVENT', 'END:VCALENDAR'
].join('\n')

interface Reply { status?: number; headers?: Record<string, string>; body?: Uint8Array | string; chunks?: number; error?: unknown; hangs?: boolean }
interface Recorded { url: URL; method: string; headers: Headers }

/** Servidor simulado: responde por servidor + ruta y apunta las peticiones. */
class MockServer {
  readonly requests: Recorded[] = []
  private routes = new Map<string, () => Reply>()

  route(path: string, reply: Reply | (() => Reply), host = 'school.instructure.com'): this {
    this.routes.set(`${host}${path}`, typeof reply === 'function' ? reply : () => reply)
    return this
  }

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url)
    this.requests.push({ url: u, method: init.method ?? 'GET', headers: new Headers(init.headers) })
    const handler = this.routes.get(`${u.hostname}${u.pathname}`)
    const r: Reply = handler ? handler() : { status: 404 }
    if (r.error) throw r.error
    if (r.hangs) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    }
    const data = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : r.body ?? new Uint8Array()
    const n = Math.max(1, r.chunks ?? 1)
    const size = Math.ceil(data.length / n)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < data.length; i += size) c.enqueue(data.subarray(i, i + size))
        c.close()
      }
    })
    const status = r.status ?? 200
    const nullBody = [101, 204, 205, 304].includes(status) || (status >= 300 && status < 400 && !data.length)
    return new Response(nullBody ? null : stream, { status, headers: r.headers })
  }
}

const text = (body: string, contentType = 'text/calendar'): Reply => ({ body, headers: { 'Content-Type': contentType } })
/** DNS simulado: los nombres de las pruebas son públicos salvo los de `PRIVATE_NAMES`. */
const PRIVATE_NAMES: Record<string, string> = { 'rebind.example.com': '10.0.0.7', 'metadata.example.com': '169.254.169.254', 'intranet.example.com': '192.168.1.20' }
const resolver = async (host: string): Promise<string[]> => [PRIVATE_NAMES[host] ?? '93.184.216.34']
const feed = (server: MockServer, url = FEED) => fetchICSFeed(url, { fetch: server.fetch, now, timeZone: NY, resolver })

async function feedError(p: Promise<unknown>): Promise<CalendarFeedError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(CalendarFeedError)
    return err as CalendarFeedError
  }
  throw new Error('debía fallar')
}

describe('ICSFeed · casos felices', () => {
  it('descarga y lee los eventos', async () => {
    const server = new MockServer().route(PATH, text(CANVAS_ICS))
    const events = await feed(server)
    expect(events.map((e) => e.title)).toEqual(['Examen 2', 'Homework 5'])
    expect(events[0].kind).toBe('exam')
    expect(events[1].allDay).toBe(true)
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].method).toBe('GET')
    expect(server.requests[0].headers.get('authorization')).toBeNull()
    expect(server.requests[0].headers.get('user-agent')).toContain('Aula')
  })

  it('webcal:// pasa a https://', async () => {
    const server = new MockServer().route('/cal.ics', text(CANVAS_ICS), 'calendar.example.com')
    for (const scheme of ['webcal', 'WEBCAL', 'webcals']) expect(await feed(server, `${scheme}://calendar.example.com/cal.ics`), scheme).toHaveLength(2)
    expect(server.requests.every((r) => r.url.protocol === 'https:')).toBe(true)
  })

  it('http a secas se rechaza sin hacer ninguna petición', async () => {
    const server = new MockServer().route('/cal.ics', text(CANVAS_ICS), 'calendar.example.com')
    expect((await feedError(feed(server, 'http://calendar.example.com/cal.ics'))).code).toBe('calendar_invalid_url')
    expect(server.requests).toHaveLength(0)
  })

  it('otros esquemas se rechazan', async () => {
    const server = new MockServer()
    for (const u of ['ftp://x.com/cal.ics', 'file:///tmp/cal.ics', 'javascript:alert(1)']) expect((await feedError(feed(server, u))).code, u).toBe('calendar_invalid_url')
    expect(server.requests).toHaveLength(0)
  })

  it('http hacia localhost se permite (pruebas)', async () => {
    const server = new MockServer().route('/cal.ics', text(CANVAS_ICS), 'localhost')
    expect(await feed(server, 'http://localhost:8080/cal.ics')).toHaveLength(2)
  })

  it('un feed en Latin-1', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:l\r\nDTSTART:20241101T120000Z\r\nSUMMARY:Examen de Matemáticas\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    const server = new MockServer().route(PATH, { body: Uint8Array.from(Array.from(ics, (c) => c.charCodeAt(0))) })
    expect((await feed(server))[0]?.title).toBe('Examen de Matemáticas')
  })

  it('un calendario vacío no es un error', async () => {
    expect(await feed(new MockServer().route(PATH, text('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')))).toEqual([])
  })
})

describe('ICSFeed · redirecciones', () => {
  it('sigue las redirecciones https', async () => {
    const server = new MockServer().route(PATH, { status: 302, headers: { Location: 'https://cdn.example.com/final.ics' } }).route('/final.ics', text(CANVAS_ICS), 'cdn.example.com')
    expect(await feed(server)).toHaveLength(2)
    expect(server.requests).toHaveLength(2)
  })

  it('redirección relativa', async () => {
    const server = new MockServer().route(PATH, { status: 301, headers: { Location: '/otro.ics' } }).route('/otro.ics', text(CANVAS_ICS))
    expect(await feed(server)).toHaveLength(2)
  })

  it('una redirección a http se rechaza', async () => {
    const server = new MockServer().route(PATH, { status: 302, headers: { Location: 'http://evil.example.com/steal.ics' } })
    expect((await feedError(feed(server))).code).toBe('calendar_invalid_url')
    expect(server.requests).toHaveLength(1)
  })

  it('un bucle de redirecciones se para', async () => {
    const server = new MockServer().route(PATH, { status: 302, headers: { Location: PATH } })
    expect((await feedError(feed(server))).code).toBe('calendar_invalid_url')
    expect(server.requests).toHaveLength(6)
  })

  it('una redirección a este ordenador o a la red local se rechaza sin pedirla (también por el nombre)', async () => {
    for (const target of ['https://127.0.0.1/x.ics', 'https://localhost/x.ics', 'http://localhost:8080/x.ics', 'https://[::1]/x.ics', 'https://10.1.2.3/x.ics',
      'https://192.168.0.1/admin.ics', 'https://169.254.169.254/latest/meta-data', 'https://router/x.ics', 'https://nas.local/x.ics',
      'https://rebind.example.com/x.ics', 'https://metadata.example.com/x.ics']) {
      const server = new MockServer().route(PATH, { status: 302, headers: { Location: target } })
      const err = await feedError(feed(server))
      expect(['calendar_private_redirect', 'calendar_invalid_url'], target).toContain(err.code)
      expect(server.requests, target).toHaveLength(1)
    }
    const server = new MockServer().route(PATH, { status: 302, headers: { Location: 'https://192.168.0.1/admin.ics' } })
    expect((await feedError(feed(server))).code).toBe('calendar_private_redirect')
  })

  it('la primera dirección la elige el estudiante: una de su red local vale, y sus redirecciones dentro del mismo servidor también', async () => {
    const start = 'https://intranet.example.com/cal/horario.ics'
    const server = new MockServer()
      .route('/cal/horario.ics', { status: 302, headers: { Location: '/cal/horario-2026.ics' } }, 'intranet.example.com')
      .route('/cal/horario-2026.ics', text(CANVAS_ICS), 'intranet.example.com')
    expect(await feed(server, start)).toHaveLength(2)
    // pero no salta a OTRO servidor privado
    const other = new MockServer().route('/cal/horario.ics', { status: 302, headers: { Location: 'https://10.0.0.9/x.ics' } }, 'intranet.example.com')
    expect((await feedError(feed(other, start))).code).toBe('calendar_private_redirect')
  })

  it('redirección sin Location', async () => {
    expect((await feedError(feed(new MockServer().route(PATH, { status: 302 })))).code).toBe('calendar_invalid_url')
  })
})

describe('ICSFeed · errores HTTP y contenido', () => {
  it('cada estado da un error accionable', async () => {
    const cases: [number, string][] = [[401, 'calendar_private'], [403, 'calendar_private'], [404, 'calendar_not_found'], [410, 'calendar_not_found'],
      [500, 'calendar_server'], [503, 'calendar_server'], [418, 'calendar_http']]
    for (const [status, code] of cases) {
      const err = await feedError(feed(new MockServer().route(PATH, { status })))
      expect(err.code, String(status)).toBe(code)
      if (code === 'calendar_server' || code === 'calendar_http') expect(err.details).toEqual({ status })
    }
  })

  it('demasiadas peticiones', async () => {
    const err = await feedError(feed(new MockServer().route(PATH, { status: 429, headers: { 'Retry-After': '12' } })))
    expect(err.code).toBe('rate_limited')
    expect(err.details).toEqual({ retryAfter: 12 })
    expect(retryAfterSeconds('Wed, 21 Oct 2015 07:28:10 GMT', new Date('2015-10-21T07:28:00Z'))).toBe(10)
    expect(retryAfterSeconds(null)).toBeNull()
  })

  it('lo que no es un calendario se rechaza', async () => {
    for (const body of ['<!DOCTYPE html><html><body>Inicia sesión</body></html>', '', '{"error":"x"}', 'BEGIN:VEVENT\nEND:VEVENT', '   \n\n']) {
      expect((await feedError(feed(new MockServer().route(PATH, text(body, 'text/html'))))).code, body).toBe('not_a_calendar')
    }
  })

  it('tope de tamaño por Content-Length y mientras llega', async () => {
    const big = new Uint8Array(ICS_MAX_BYTES + 1024).fill(65)
    expect((await feedError(feed(new MockServer().route(PATH, { body: big, headers: { 'Content-Length': String(big.length) }, chunks: 8 })))).code).toBe('too_large')
    expect((await feedError(feed(new MockServer().route(PATH, { body: big, chunks: 64 })))).code).toBe('too_large')
  })

  it('un feed justo por debajo del tope se acepta', async () => {
    const parts = ['BEGIN:VCALENDAR\r\n']
    const filler = 'X-FILL:' + 'a'.repeat(900) + '\r\n'
    let size = parts[0].length
    while (size < ICS_MAX_BYTES - 200_000) { parts.push(filler); size += filler.length }
    parts.push('BEGIN:VEVENT\r\nUID:ok\r\nDTSTART:20241101T120000Z\r\nSUMMARY:Cabe\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
    const events = await feed(new MockServer().route(PATH, { body: parts.join(''), chunks: 16 }))
    expect(events.map((e) => e.title)).toEqual(['Cabe'])
  })
})

describe('ICSFeed · fallos de red', () => {
  it('se traducen', async () => {
    const netErr = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) })
    const cases: [string, string][] = [['ENETUNREACH', 'offline'], ['ETIMEDOUT', 'timed_out'], ['ENOTFOUND', 'host_not_found'], ['EAI_AGAIN', 'host_not_found'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'secure_connection'], ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'secure_connection']]
    for (const [code, expected] of cases) {
      const err = await feedError(feed(new MockServer().route(PATH, { error: netErr(code) })))
      expect(err.code, code).toBe(expected)
      if (expected === 'host_not_found' || expected === 'secure_connection') expect(err.message).toContain('school.instructure.com')
      expect(err.message).not.toContain('user_AbCdEf123456')
    }
    expect(translateNetworkError(new Error('x https://a.b/secret.ics'), 'a.b', null).message).not.toContain('secret')
  })

  it('se puede cancelar y caduca', async () => {
    const server = new MockServer().route(PATH, { hangs: true })
    const ctrl = new AbortController()
    const p = fetchICSFeed(FEED, { fetch: server.fetch, now, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 50)
    expect((await feedError(p)).code).toBe('cancelled')
    expect((await feedError(fetchICSFeed(FEED, { fetch: server.fetch, now, timeoutMs: 50 }))).code).toBe('timed_out')
  })
})

describe('ICSFeed · direcciones', () => {
  it('normalizar lo que pega el estudiante', () => {
    expect(normalizeFeedURL('webcal://calendar.example.com/a.ics')).toBe('https://calendar.example.com/a.ics')
    expect(normalizeFeedURL('  https://calendar.example.com/a.ics \n')).toBe('https://calendar.example.com/a.ics')
    expect(normalizeFeedURL('calendar.example.com/a.ics')).toBe('https://calendar.example.com/a.ics')
    expect(normalizeFeedURL('WEBCALS://x.com/a.ics')).toBe('https://x.com/a.ics')
    expect(normalizeFeedURL('http://localhost:3000/a.ics')).toBe('http://localhost:3000/a.ics')
    for (const bad of ['', '   ', 'http://example.com/a.ics', 'ftp://x.com/a.ics', 'javascript:alert(1)', 'https://', 'hola mundo.ics', 'https://user:pw@x.com/a.ics', 'file:///etc/passwd']) {
      expect(normalizeFeedURL(bad), bad).toBeNull()
    }
  })

  it('¿parece un calendario?', () => {
    expect(looksLikeCalendar('﻿  begin:vcalendar\r\n')).toBe(true)
    expect(looksLikeCalendar(new TextEncoder().encode('BEGIN:VCALENDAR'))).toBe(true)
    expect(looksLikeCalendar('<html>')).toBe(false)
  })

  it('el enlace de la Fuente del calendario de Canvas sirve tal cual', async () => {
    const server = new MockServer().route(PATH, text(CANVAS_ICS))
    expect(await fetchICSFeed(normalizeFeedURL(FEED)!, { fetch: server.fetch, now, timeZone: NY })).toHaveLength(2)
  })
})
