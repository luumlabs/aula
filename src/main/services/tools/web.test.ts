// Lector web de los agentes: solo direcciones públicas, también contra «DNS rebinding» (el nombre se valida como público y,
// al conectar, resuelve a 127.0.0.1, a la red local o a los metadatos de la nube). Con un servidor local de verdad.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LookupAddress } from 'node:dns'
import type { DnsLookup } from '../ingest'
import { setSystemProxyActive } from '../network'
import { getPublic, guardedFetch } from './web'

let server: Server
let port = 0
let hits: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/salta') { res.writeHead(302, { location: '/final' }); res.end(); return }
    if (req.url === '/metadatos') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return }
    if (req.url === '/grande') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(5000)); return }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`hola ${req.url}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(() => { hits = []; setSystemProxyActive(false); vi.unstubAllGlobals() })

/** Un DNS que, al conectar, responde con `address` (el de verdad dijo antes que era pública). */
const resolvesTo = (address: string): DnsLookup => (_host, _opts, cb) => cb(null, [{ address, family: address.includes(':') ? 6 : 4 } satisfies LookupAddress])
/** La validación previa ya dijo que es pública (la primera resolución). */
const validatedAsPublic = async (u: string): Promise<URL> => new URL(u)

describe('getPublic · DNS rebinding', () => {
  for (const address of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.10', '::1', '::ffff:127.0.0.1']) {
    it(`un nombre que al conectar resuelve a ${address} se rechaza (sin llegar a conectar)`, async () => {
      const opts = { validate: validatedAsPublic, fetch: guardedFetch({ dnsLookup: resolvesTo(address) }) }
      await expect(getPublic(`http://rebind.example.com:${port}/secreto`, 100_000, opts)).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringContaining('bloqueada') })
      expect(hits).toEqual([])
    })
  }

  it('por defecto (sin proxy) también: «localhost» validado como público no llega a conectar', async () => {
    await expect(getPublic(`http://localhost:${port}/secreto`, 100_000, { validate: validatedAsPublic })).rejects.toMatchObject({ kind: 'unsupported' })
    expect(hits).toEqual([])
  })

  it('cada salto se valida antes de seguirlo (una redirección a los metadatos de la nube se para)', async () => {
    const validate = vi.fn(async (u: string) => {
      const url = new URL(u)
      if (url.hostname === '169.254.169.254') throw new Error('bloqueada: dirección de enlace local')
      return url
    })
    const opts = { validate, fetch: guardedFetch({ isBlocked: () => false }) }
    await expect(getPublic(`http://127.0.0.1:${port}/metadatos`, 100_000, opts)).rejects.toThrow()
    expect(hits).toEqual(['/metadatos'])
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it('el transporte funciona: sigue redirecciones validadas, lee el cuerpo y respeta el tamaño máximo', async () => {
    const opts = { validate: validatedAsPublic, fetch: guardedFetch({ isBlocked: () => false }) }
    const r = await getPublic(`http://127.0.0.1:${port}/salta`, 100_000, opts)
    expect(r.status).toBe(200)
    expect(new TextDecoder().decode(r.data)).toBe('hola /final')
    expect(r.mime).toBe('text/plain')
    expect(r.finalURL.pathname).toBe('/final')
    await expect(getPublic(`http://127.0.0.1:${port}/grande`, 1000, opts)).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('con el proxy del sistema usa el fetch global (la red de Chromium) y sigue validando cada salto', async () => {
    setSystemProxyActive(true)
    const viaProxy = vi.fn(async (u: string) => (u.endsWith('/uno') ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/dos' } }) : new Response('ok')))
    vi.stubGlobal('fetch', viaProxy)
    const validate = vi.fn(async (u: string) => {
      if (new URL(u).hostname === '10.0.0.1') throw new Error('privada')
      return new URL(u)
    })
    await expect(getPublic('https://ejemplo.org/uno', 1000, { validate })).rejects.toThrow()
    expect(viaProxy).toHaveBeenCalledTimes(1)
    expect(validate).toHaveBeenCalledTimes(2)
  })
})
