import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isIngestError, type IngestErrorKind } from '../errors'
import { defaultOptions, type IngestOptions } from '../options'
import { readDocument, readWeb } from '../pipeline'
import { ProgressLog } from '../testing/files'
import { docx, p } from '../testing/office'
import { buildPDF } from '../testing/pdf'
import { acceptLanguage, isNonPublicAddress, parseIPv4Literal, parseIPv6, validateURL, verdictForHost, type HttpRequest, type HttpResponse, type HttpTransport } from './web'

async function rejectsKind(promise: Promise<unknown>, kind: IngestErrorKind, check?: (m: string) => boolean): Promise<void> {
  const e = await promise.then(() => null, (x: unknown) => x)
  expect(isIngestError(e, kind), String(e)).toBe(true)
  if (check) expect(check((e as Error).message), (e as Error).message).toBe(true)
}

describe('Seguridad de direcciones (sin red)', () => {
  const noDNS = async (): Promise<string[]> => []
  const blocked = async (h: string): Promise<void> => expect((await verdictForHost(h, noDNS)).allowed, h).toBe(false)
  const allowed = async (h: string): Promise<void> => expect((await verdictForHost(h, noDNS)).allowed, h).toBe(true)

  it('IPv4 locales y privadas', async () => {
    for (const h of ['127.0.0.1', '127.1', '127.255.255.254', '0x7f.0.0.1', '0x7f000001', '2130706433', '0177.0.0.1', '017700000001', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.20.5.5', '172.31.255.255',
      '192.168.0.1', '192.168.255.255', '169.254.169.254', '169.254.0.1', '0.0.0.0', '0.1.2.3', '100.64.0.1', '100.100.100.100', '100.127.255.255', '224.0.0.1', '239.255.255.250', '240.0.0.1',
      '255.255.255.255', '198.18.0.1', '198.19.255.255', '192.0.2.1', '192.0.0.5', '198.51.100.7', '203.0.113.9']) await blocked(h)
  })

  it('IPv4 públicas', async () => {
    for (const h of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.167.1.1', '192.169.0.1', '11.0.0.1', '169.253.1.1', '169.255.0.1', '198.17.0.1',
      '198.20.0.1', '223.255.255.255', '126.255.255.255', '128.0.0.1']) await allowed(h)
  })

  it('IPv6 locales, privadas y públicas', async () => {
    for (const h of ['::1', '::', '[::1]', 'fe80::1', 'fe80::1%en0', 'FE80::ABCD', 'febf::1', 'fc00::1', 'fd12:3456:789a::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:192.168.0.9', '::ffff:7f00:1',
      '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::a00:1', '2001:db8::1', 'ff02::1', 'ff00::', 'fec0::1', '2002:7f00:1::1', '2002:a00:1::', '::127.0.0.1', '100::1']) await blocked(h)
    for (const h of ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2400:cb00::1']) await allowed(h)
  })

  it('nombres locales', async () => {
    for (const h of ['localhost', 'LOCALHOST', 'localhost.', 'foo.localhost', 'a.b.localhost', 'impresora.local', 'mi-mac.local', 'servidor.internal', 'x.lan', 'casa.home', 'router.home.arpa', 'host.corp', 'intranet', 'router', 'nas', 'wiki', 'x.intranet', 'algo.private', 'pc.localdomain']) await blocked(h)
  })

  it('nombres que resuelven a direcciones privadas', async () => {
    expect((await verdictForHost('trampa.example.com', async () => ['93.184.216.34', '10.0.0.7'])).allowed).toBe(false)
    expect((await verdictForHost('bueno.example.com', async () => ['93.184.216.34'])).allowed).toBe(true)
    expect((await verdictForHost('no-resuelve.example.com', noDNS)).allowed).toBe(true)
  })

  it('formas de IPv4 e IPv6 y direcciones de conexión', () => {
    expect(parseIPv4Literal('127.0.0.1')).toBe(0x7f000001)
    expect(parseIPv4Literal('2130706433')).toBe(0x7f000001)
    expect(parseIPv4Literal('0x7f.1')).toBe(0x7f000001)
    for (const s of ['example.com', '1e100.net', '123.example.com', '999.1.1.1', '']) expect(parseIPv4Literal(s), s).toBeNull()
    expect(parseIPv6('::1')).not.toBeNull()
    expect(parseIPv6('no es ipv6')).toBeNull()
    for (const s of ['127.0.0.1', '::1', 'fe80::1%en0', '192.168.1.5', '::ffff:127.0.0.1']) expect(isNonPublicAddress(s), s).toBe(true)
    for (const s of ['8.8.8.8', '2606:4700:4700::1111', 'algo raro']) expect(isNonPublicAddress(s), s).toBe(false)
  })

  it('esquemas, credenciales y servidores', async () => {
    const ok = async (s: string, allowPrivate = false): Promise<boolean> => validateURL(s, allowPrivate, noDNS).then(() => true, () => false)
    expect(await ok('http://8.8.8.8/pagina')).toBe(true)
    expect(await ok('https://8.8.8.8:8443/x?y=1#z')).toBe(true)
    expect(await ok('HTTP://8.8.8.8/')).toBe(true)
    for (const s of ['file:///etc/passwd', 'ftp://8.8.8.8/x', 'javascript:alert(1)', 'data:text/html,hola', 'gopher://8.8.8.8/', 'http://user:clave@8.8.8.8/', 'http://usuario@8.8.8.8/', 'http://127.0.0.1:8080/',
      'http://[::1]:3000/', 'http://localhost/', 'http://2130706433/', 'http://169.254.169.254/latest/meta-data/', 'http:///sin-host', 'no es una dirección']) expect(await ok(s), s).toBe(false)
    expect(await ok('http://127.0.0.1:8080/', true)).toBe(true)
    expect(await ok('http://192.168.1.1/', true)).toBe(true)
    expect(await ok('file:///etc/passwd', true)).toBe(false)
    expect(await ok('http://user:clave@127.0.0.1/', true)).toBe(false)
  })

  it('mensajes en español y Accept-Language', async () => {
    const e = await validateURL('http://127.0.0.1/', false, noDNS).catch((x: unknown) => x as Error)
    expect((e as Error).message).toContain('bloqueada')
    expect((e as Error).message).toContain('127.0.0.1')
    expect(acceptLanguage('es')).toBe('es,en;q=0.8')
    expect(acceptLanguage('pt-BR')).toBe('pt-BR,pt;q=0.9,en;q=0.8')
    expect(acceptLanguage('en')).toBe('en')
  })
})

// MARK: Descarga con un transporte de pruebas (sin sockets)

interface Stub { status: number; headers?: Record<string, string>; body?: Uint8Array | string; chunkSize?: number; delayMs?: number }

class StubTransport implements HttpTransport {
  readonly stubs = new Map<string, Stub>()
  readonly requests: URL[] = []
  set(url: string, stub: Stub): void { this.stubs.set(url, stub) }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req.url)
    const stub = this.stubs.get(req.url.href)
    if (!stub) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    if (stub.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, stub.delayMs)
        req.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }, { once: true })
      })
    }
    const body = typeof stub.body === 'string' ? new Uint8Array(Buffer.from(stub.body)) : stub.body ?? new Uint8Array()
    const size = stub.chunkSize ?? Math.max(1, body.length)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(stub.headers ?? {})) headers[k.toLowerCase()] = v
    let aborted = false
    return {
      status: stub.status,
      headers,
      remoteAddress: req.url.hostname,
      body: (async function* () { for (let i = 0; i < body.length && !aborted; i += size) yield body.subarray(i, i + size) })(),
      abort: () => { aborted = true }
    }
  }
}

describe('Descarga de páginas (transporte de pruebas)', () => {
  const base = 'http://93.184.216.34'
  let stub: StubTransport
  beforeEach(() => { stub = new StubTransport() })
  const html = (body: string, status = 200, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): Stub => ({ status, headers: { 'Content-Type': type, ...extra }, body })
  const web = (path: string, options: Partial<IngestOptions> = {}) => readWeb(base + path, { transport: stub, ...options })

  it('una página HTML', async () => {
    stub.set(base + '/pagina', html('<html lang="es"><head><title>Teorema de Pitágoras</title><meta name="author" content="Prof. Luna"></head><body>\n<nav><a href="/">Inicio</a></nav><div class="cookie-banner">Aceptar cookies</div>\n<article><h1>Teorema de Pitágoras</h1><p>En un triángulo rectángulo, a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup>.</p><ul><li>Cateto</li><li>Hipotenusa</li></ul></article>\n<footer>© 2026</footer></body></html>'))
    const doc = await web('/pagina')
    expect(doc.kind).toBe('web')
    expect(doc.title).toBe('Teorema de Pitágoras')
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].text).toBe('# Teorema de Pitágoras\n\nEn un triángulo rectángulo, a^2 + b^2 = c^2.\n\n- Cateto\n- Hipotenusa')
    expect(doc.metadata).toMatchObject({ url: base + '/pagina', siteName: '93.184.216.34', author: 'Prof. Luna', language: 'es' })
    expect(doc.warnings).toEqual([])
  })

  it('una dirección http por la entrada general', async () => {
    stub.set(base + '/a', html('<html><head><title>Hola</title></head><body><p>Contenido de la página de prueba.</p></body></html>'))
    const doc = await readDocument(base + '/a', { transport: stub })
    expect(doc.kind).toBe('web')
    expect(doc.title).toBe('Hola')
  })

  it('el juego de caracteres de la cabecera; texto y Markdown', async () => {
    stub.set(base + '/viejo', { status: 200, headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' }, body: new Uint8Array(Buffer.from('<html><head><title>Canción</title></head><body><p>El niño comió árboles en la montaña.</p></body></html>', 'latin1')) })
    const doc = await web('/viejo')
    expect(doc.title).toBe('Canción')
    expect(doc.pages[0].text).toContain('El niño comió árboles en la montaña.')
    stub.set(base + '/notas.txt', html('Línea uno de las notas.\n\nLínea dos con ñ.', 200, 'text/plain; charset=utf-8'))
    const txt = await web('/notas.txt')
    expect(txt.kind).toBe('web')
    expect(txt.pages[0].text).toBe('Línea uno de las notas.\n\nLínea dos con ñ.')
    stub.set(base + '/guia.md', html('# Guía\n\nTexto de la guía.', 200, 'text/markdown'))
    expect((await web('/guia.md')).pages[0].heading).toBe('Guía')
  })

  it('un PDF remoto, sin dejar archivos temporales', async () => {
    const pdf = buildPDF({ info: { Title: 'Examen remoto' }, pages: [1, 2].map((i) => ({ texts: [{ text: `Texto de la página ${i} del PDF remoto con contenido suficiente.`, x: 72, y: 700 }] })) })
    stub.set(base + '/docs/examen.pdf', { status: 200, headers: { 'Content-Type': 'application/pdf' }, body: pdf })
    const log = new ProgressLog()
    const doc = await web('/docs/examen.pdf', { onProgress: log.callback })
    expect(doc.kind).toBe('pdf')
    expect(doc.title).toBe('Examen remoto')
    expect(doc.pages).toHaveLength(2)
    expect(doc.metadata.url).toBe(base + '/docs/examen.pdf')
    expect(log.fractions).toEqual([...log.fractions].sort((a, b) => a - b))
    expect(log.fractions[log.fractions.length - 1]).toBe(1)
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('aula-web-'))).toEqual([])
  })

  it('Word remoto y PDF sin tipo', async () => {
    stub.set(base + '/apuntes', { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: docx({ body: p('Documento de Word remoto.') }) })
    const d = await web('/apuntes')
    expect(d.kind).toBe('docx')
    expect(d.pages[0].text).toBe('Documento de Word remoto.')
    stub.set(base + '/descarga', { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body: buildPDF({ pages: [{ texts: [{ text: 'PDF servido como octet-stream con texto suficiente.', x: 72, y: 700 }] }] }) })
    expect((await web('/descarga')).kind).toBe('pdf')
  })

  it('sigue las redirecciones', async () => {
    stub.set(base + '/a', { status: 301, headers: { Location: '/b' } })
    stub.set(base + '/b', { status: 302, headers: { Location: base + '/c' } })
    stub.set(base + '/c', html('<html><head><title>Final</title></head><body><p>Texto de la página final tras redirigir.</p></body></html>'))
    const doc = await web('/a')
    expect(doc.title).toBe('Final')
    expect(doc.metadata.url).toBe(base + '/c')
    expect(stub.requests.map((u) => u.pathname)).toEqual(['/a', '/b', '/c'])
  })

  it('avisos: páginas con JavaScript y páginas vacías', async () => {
    stub.set(base + '/spa', html(`<html><head><title>App</title>${'<script src="app.js"></script>'.repeat(8)}</head><body><div id="root"></div></body></html>`))
    expect((await web('/spa')).warnings.some((w) => w.includes('JavaScript'))).toBe(true)
    stub.set(base + '/vacia', html('<html><body></body></html>'))
    expect((await web('/vacia')).warnings.some((w) => w.includes('No se encontró texto'))).toBe(true)
  })

  it('estados de error, cuerpo vacío y servidor que no existe', async () => {
    for (const [status, fragment] of [[404, 'no existe'], [410, 'no existe'], [403, 'no permite'], [401, 'iniciar sesión'], [429, 'demasiadas peticiones'], [500, 'error del servidor'], [503, 'error del servidor'], [418, 'inesperada']] as const) {
      stub.set(base + `/e${status}`, html('<html><body>error</body></html>', status))
      await rejectsKind(web(`/e${status}`), 'network', (m) => m.includes(fragment))
    }
    stub.set(base + '/nada', { status: 200, headers: { 'Content-Type': 'text/html' }, body: new Uint8Array() })
    await rejectsKind(web('/nada'), 'network', (m) => m.includes('vacía'))
    await rejectsKind(web('/no-registrada'), 'network', (m) => m.includes('no se encontró el servidor'))
  })

  it('límites de tamaño y tipos de contenido', async () => {
    stub.set(base + '/enorme', { status: 200, headers: { 'Content-Type': 'text/html' }, body: new Uint8Array(400_000).fill(0x61), chunkSize: 20_000 })
    await rejectsKind(web('/enorme', { maxWebBytes: 100_000 }), 'tooLarge')
    stub.set(base + '/anunciada', { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Length': '99999999' }, body: '<html></html>' })
    await rejectsKind(web('/anunciada'), 'tooLarge')
    expect(defaultOptions().maxWebBytes).toBe(15 * 1024 * 1024)
    const body = '<html><head><title>Grande</title></head><body><p>' + 'texto '.repeat(15_000) + '</p></body></html>'
    stub.set(base + '/justa', html(body))
    expect((await web('/justa', { maxWebBytes: Buffer.byteLength(body) + 10 })).title).toBe('Grande')
    stub.set(base + '/video', { status: 200, headers: { 'Content-Type': 'video/mp4' }, body: new Uint8Array(1000) })
    await rejectsKind(web('/video'), 'unsupportedType')
  })

  it('direcciones privadas, esquemas y credenciales se rechazan antes de pedir nada', async () => {
    for (const url of ['http://127.0.0.1/', 'http://localhost:8080/x', 'http://192.168.1.10/router', 'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://2130706433/', 'http://nas/',
      'file:///etc/passwd', 'ftp://93.184.216.34/x', 'http://usuario:clave@93.184.216.34/']) {
      await rejectsKind(readWeb(url, { transport: stub }), 'blockedURL')
    }
    expect(stub.requests).toEqual([])
    await rejectsKind(readWeb('file:///etc/hosts', { transport: stub, allowPrivate: true }), 'blockedURL')
  })

  it('las redirecciones a direcciones privadas, locales o de otro esquema se bloquean; los bucles se cortan', async () => {
    stub.set(base + '/malo', { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/iam/' } })
    stub.set('http://169.254.169.254/latest/meta-data/iam/', html('<html><body>SECRETO</body></html>'))
    await rejectsKind(web('/malo'), 'blockedURL')
    expect(stub.requests.some((u) => u.hostname === '169.254.169.254')).toBe(false)
    for (const [path, location] of [['/r1', 'http://localhost:9999/admin'], ['/r2', 'file:///etc/passwd'], ['/r3', 'http://2130706433/']]) {
      stub.set(base + path, { status: 302, headers: { Location: location } })
      await rejectsKind(web(path), 'blockedURL')
    }
    stub.requests.length = 0
    stub.set(base + '/bucle1', { status: 302, headers: { Location: '/bucle2' } })
    stub.set(base + '/bucle2', { status: 302, headers: { Location: '/bucle1' } })
    await rejectsKind(web('/bucle1'), 'network', (m) => m.includes('redirecciones'))
    expect(stub.requests.length).toBeLessThanOrEqual(9)
  })

  it('cancelación mientras espera al servidor, y antes de empezar', async () => {
    stub.set(base + '/lenta', { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body>tarde</body></html>', delayMs: 6000 })
    const controller = new AbortController()
    const promise = web('/lenta', { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 100))
    const t0 = performance.now()
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(performance.now() - t0).toBeLessThan(3000)
    stub.requests.length = 0
    const done = new AbortController()
    done.abort()
    await expect(web('/x', { signal: done.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(stub.requests).toEqual([])
  })
})

// MARK: Servidor real en el bucle local

describe('Servidor real en el bucle local (solo con allowPrivate)', () => {
  let server: Server
  let base = ''
  let connections = 0
  const bigBody = Buffer.alloc(3 * 1024 * 1024, 0x62)
  const pdf = buildPDF({ pages: [{ texts: [{ text: 'PDF servido por un servidor real en el bucle local.', x: 72, y: 700 }] }] })

  beforeEach(async () => {
    connections = 0
    server = createServer((req, res) => {
      switch (req.url) {
        case '/pagina': res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<html><head><title>Servidor local</title></head><body><main><h1>Hola desde el bucle local</h1><p>Contenido servido por la prueba, con acentos: canción y niño.</p></main></body></html>'); break
        case '/viejo': res.writeHead(200, { 'Content-Type': 'text/html; charset=iso-8859-1' }); res.end(Buffer.from('<html><head><title>Canción</title></head><body><p>niño</p></body></html>', 'latin1')); break
        case '/gzip': res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync('<html><head><title>Comprimida</title></head><body><p>Texto comprimido con gzip.</p></body></html>')); break
        case '/bomba': res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61))); break
        case '/redirige': res.writeHead(302, { Location: '/pagina' }); res.end(); break
        case '/grande': res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(bigBody); break
        case '/a.pdf': res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(Buffer.from(pdf)); break
        default: res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no')
      }
    })
    server.on('connection', () => { connections++ })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

  it('petición real con allowPrivate (también comprimida y redirigida)', async () => {
    const doc = await readWeb(base + '/pagina', { allowPrivate: true })
    expect(doc.title).toBe('Servidor local')
    expect(doc.pages[0].text).toContain('canción y niño')
    const moved = await readWeb(base + '/redirige', { allowPrivate: true })
    expect(moved.title).toBe('Servidor local')
    expect(moved.metadata.url).toBe(base + '/pagina')
    expect((await readWeb(base + '/viejo', { allowPrivate: true })).pages[0].text).toBe('niño')
    expect((await readWeb(base + '/gzip', { allowPrivate: true })).title).toBe('Comprimida')
    await rejectsKind(readWeb(base + '/nada', { allowPrivate: true }), 'network', (m) => m.includes('404'))
  })

  it('sin allowPrivate se bloquea sin conectar', async () => {
    await rejectsKind(readWeb(base + '/pagina'), 'blockedURL')
    await rejectsKind(readDocument(base + '/pagina'), 'blockedURL')
    await new Promise((r) => setTimeout(r, 100))
    expect(connections).toBe(0)
  })

  it('respuestas grandes y bombas gzip se cortan; PDF real', async () => {
    await rejectsKind(readWeb(base + '/grande', { allowPrivate: true, maxWebBytes: 1_000_000 }), 'tooLarge')
    await rejectsKind(readWeb(base + '/bomba', { allowPrivate: true, maxWebBytes: 1_000_000 }), 'tooLarge')
    const doc = await readWeb(base + '/a.pdf', { allowPrivate: true })
    expect(doc.kind).toBe('pdf')
    expect(doc.pages[0].text).toContain('servidor real')
  })
})
