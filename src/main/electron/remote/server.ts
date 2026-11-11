// Servidor remoto de Aula: lo que permite usar Aula desde el iPad o el iPhone del estudiante mientras todo (cursos, IA,
// datos) sigue en su Mac. Escucha SOLO en este ordenador (127.0.0.1); desde fuera se llega por la red privada de Tailscale
// del propio estudiante (el proceso auxiliar `aula-tsnet` reenvía las conexiones de sus dispositivos hasta aquí).
//  · Sirve la misma interfaz (los archivos de `out/renderer`) con un puente que habla HTTP en vez del IPC de la ventana.
//  · `/rpc`: los mismos métodos que la ventana, pero solo los de la lista de remote/policy.ts y solo de un dispositivo
//    emparejado (ficha en una cookie o en `Authorization`).
//  · `/events`: los eventos de la app, uno por línea. `/asset/…`: imágenes, materiales y grabaciones (con rangos).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { PairingError, type DeviceRegistry, type RemoteDeviceView } from '@main/services/remote/devices'
import { noopValue, remoteCall, rewriteAssets } from '@main/services/remote/policy'
import { pairingPage, REMOTE_BRIDGE_JS, REMOTE_MANIFEST } from '@main/services/remote/bridge'
import { UploadError, type UploadStore } from '@main/services/remote/uploads'
import { log } from '@main/services/log'
import { tr } from '@shared/ai/i18n'
import { APP_CSP, mimeFor, resolveAppUrl, resolveAssetUrl } from '../protocol'
import { dispatchRemote, onEmit } from '../rpc'

export const DEVICE_COOKIE = 'aula_device'
/** Cabeceras que solo puede poner el proceso auxiliar de Tailscale (con su clave); de un cliente se ignoran. */
export const PROXY_KEY_HEADER = 'x-aula-proxy-key'
export const TAILNET_USER_HEADER = 'x-aula-tailnet-user'
const MAX_BODY = 2 * 1024 * 1024
const COOKIE_DAYS = 90

export interface RemoteServerOptions {
  devices: DeviceRegistry
  /** Archivos que suben los dispositivos (materiales, adjuntos del chat). */
  uploads: UploadStore
  /** Carpeta de la interfaz compilada (`out/renderer`). */
  rendererRoot: string
  /** El icono de Aula (PNG), para «Añadir a la pantalla de inicio». */
  icon?: string
  language: () => 'es' | 'en'
  version: string
  /** Clave compartida con el proceso auxiliar de Tailscale: demuestra que una conexión llega por él. */
  proxyKey: string
  /** Puerto fijo (pruebas); por defecto, uno libre. */
  port?: number
  /** Avisa de que cambió algo que la interfaz del Mac enseña (un dispositivo nuevo). */
  onChange?: () => void
}

export class RemoteServer {
  private server: Server | null = null
  private streams = new Set<ServerResponse>()
  private stopTap: (() => void) | null = null
  port = 0

  constructor(private readonly o: RemoteServerOptions) {}

  get running(): boolean { return this.server !== null }

  async start(): Promise<number> {
    if (this.server) return this.port
    const server = createServer((req, res) => { void this.route(req, res).catch((err) => { log.warn('[remoto] petición', err); this.fail(res, 500, 'internal') }) })
    server.keepAliveTimeout = 65_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.o.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    this.stopTap = onEmit((event, payload) => this.broadcast(event, payload))
    return this.port
  }

  async stop(): Promise<void> {
    this.stopTap?.()
    this.stopTap = null
    for (const s of this.streams) { try { s.end() } catch { /* ya cerrado */ } }
    this.streams.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.() })
  }

  /** Cuántos dispositivos están escuchando ahora mismo. */
  get listeners(): number { return this.streams.size }

  private broadcast(event: string, payload: unknown): void {
    if (!this.streams.size) return
    let line: string
    try { line = rewriteAssets(JSON.stringify({ event, payload })) + '\n' } catch { return }
    for (const s of this.streams) { try { s.write(line) } catch { this.streams.delete(s) } }
  }

  // MARK: Quién llama

  /** ¿Llega por el proceso auxiliar de Tailscale (trae su clave)? */
  private viaTailnet(req: IncomingMessage): boolean {
    const got = req.headers[PROXY_KEY_HEADER]
    const key = this.o.proxyKey
    return typeof got === 'string' && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key))
  }

  /** Sin la clave del proceso auxiliar solo vale una petición a este mismo ordenador (corta el «DNS rebinding»). */
  private hostAllowed(req: IncomingMessage): boolean {
    if (this.viaTailnet(req)) return true
    const host = (req.headers.host ?? '').toLowerCase()
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}` || host === `[::1]:${this.port}`
  }

  private device(req: IncomingMessage): RemoteDeviceView | undefined {
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) return this.o.devices.authenticate(auth.slice(7).trim())
    const cookie = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(DEVICE_COOKIE + '='))
    return cookie ? this.o.devices.authenticate(decodeURIComponent(cookie.slice(DEVICE_COOKIE.length + 1))) : undefined
  }

  // MARK: Rutas

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.hostAllowed(req)) return this.fail(res, 421, 'forbidden')
    const url = new URL(req.url ?? '/', 'http://aula')
    const path = url.pathname
    const method = req.method ?? 'GET'
    if (path === '/health') {
      // el proceso auxiliar comprueba que al otro lado está Aula (y no otro programa en ese puerto) antes de reenviar nada:
      // manda un número al azar y espera su firma con la clave que solo comparten los dos (native/tsnet/upstream.go)
      const challenge = url.searchParams.get('challenge') ?? ''
      const proof = /^[A-Za-z0-9_-]{16,128}$/.test(challenge) ? { proxy: createHmac('sha256', this.o.proxyKey).update('aula-health:v1:' + challenge).digest('base64url') } : undefined
      return this.json(res, 200, { ok: true, app: 'aula', version: this.o.version, ...(proof ? { proof } : {}) })
    }
    if (path === '/manifest.webmanifest') return this.send(res, 200, 'application/manifest+json; charset=utf-8', REMOTE_MANIFEST, { 'cache-control': 'no-cache' })
    if (path === '/apple-touch-icon.png' || path === '/apple-touch-icon-precomposed.png' || path === '/favicon.ico') {
      try { const data = readFileSync(this.o.icon ?? ''); res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(data.length), 'cache-control': 'public, max-age=86400' }); res.end(data) } catch { this.fail(res, 404, 'not_found') }
      return
    }
    if (path === '/remote-bridge.js') return this.send(res, 200, 'text/javascript; charset=utf-8', REMOTE_BRIDGE_JS, { 'cache-control': 'no-cache' })
    if (path === '/pair' && method === 'GET') {
      const nonce = randomBytes(16).toString('base64')
      return this.send(res, 200, 'text/html; charset=utf-8', pairingPage(this.o.language(), nonce), {
        'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'cache-control': 'no-store'
      })
    }
    if (path === '/pair/complete' && method === 'POST') return this.pair(req, res)

    const device = this.device(req)
    if (path === '/rpc' && method === 'POST') return device ? this.rpc(req, res, device) : this.fail(res, 401, 'forbidden')
    if (path === '/events' && method === 'GET') return device ? this.events(req, res) : this.fail(res, 401, 'forbidden')
    if (path.startsWith('/asset/')) return device ? this.asset(req, res, path) : this.fail(res, 401, 'forbidden')
    if (path.startsWith('/upload/') && method === 'PUT') return device ? this.upload(req, res, path, device) : this.fail(res, 401, 'forbidden')
    if (method !== 'GET' && method !== 'HEAD') return this.fail(res, 405, 'invalid_args')
    return this.page(res, path, !!device, method === 'HEAD')
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.body(req, res)
    if (body === undefined) return
    const b = (body ?? {}) as { code?: unknown; name?: unknown; platform?: unknown }
    try {
      const r = this.o.devices.completePairing(String(b.code ?? ''), String(b.name ?? ''), String(b.platform ?? 'web'))
      this.o.onChange?.()
      this.json(res, 200, { ok: true, token: r.token, device: r.device }, {
        'set-cookie': `${DEVICE_COOKIE}=${encodeURIComponent(r.token)}; Path=/; Max-Age=${COOKIE_DAYS * 86_400}; HttpOnly; SameSite=Strict`,
        'cache-control': 'no-store'
      })
    } catch (err) {
      if (err instanceof PairingError) { this.o.onChange?.(); return this.json(res, 403, { ok: false, error: err.code }) }
      throw err
    }
  }

  private async rpc(req: IncomingMessage, res: ServerResponse, device: RemoteDeviceView): Promise<void> {
    const body = await this.body(req, res)
    if (body === undefined) return
    const call = body as { method?: unknown; args?: unknown } | null
    const method = typeof call?.method === 'string' ? call.method : ''
    // los métodos acotados (ajustes, olvidar un recuerdo, elegir la IA) pasan solo con los argumentos ya comprobados
    const { verdict, args } = remoteCall(method, call?.args ?? undefined)
    if (verdict === 'deny') return this.json(res, 200, { ok: false, error: { message: tr('Esto solo se puede hacer desde Aula en tu Mac.', 'This can only be done from Aula on your Mac.'), code: 'forbidden' } })
    if (verdict === 'noop') return this.json(res, 200, { ok: true, value: noopValue(method) })
    const envelope = await dispatchRemote(method, this.o.uploads.resolve(device.id, args), device.id)
    this.send(res, 200, 'application/json; charset=utf-8', rewriteAssets(JSON.stringify(envelope) ?? '{"ok":true}'), { 'cache-control': 'no-store' })
  }

  /** Un archivo elegido en el dispositivo: se copia al Mac y queda como «dado por el estudiante» (remote/uploads.ts). */
  private async upload(req: IncomingMessage, res: ServerResponse, path: string, device: RemoteDeviceView): Promise<void> {
    // cabecera propia: una página de otro sitio no puede mandarla sin permiso previo (y la cookie es SameSite=Strict)
    const header = req.headers['x-aula-filename']
    let name = ''
    try { name = decodeURIComponent(typeof header === 'string' ? header : '') } catch { /* nombre mal escrito */ }
    if (!name) return this.fail(res, 400, 'invalid_args')
    try {
      await this.o.uploads.receive(device.id, path.slice('/upload/'.length), name, req)
      this.json(res, 200, { ok: true })
    } catch (err) {
      if (!(err instanceof UploadError)) throw err
      // el cuerpo puede seguir llegando: se corta la conexión para no leer gigas que no se van a guardar
      res.once('finish', () => req.destroy())
      this.fail(res, err.code === 'tooBig' ? 413 : 400, 'invalid_args')
    }
  }

  private events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' })
    res.write('\n')
    this.streams.add(res)
    // una línea vacía cada poco mantiene viva la conexión por la red privada
    const beat = setInterval(() => { try { res.write('\n') } catch { /* cerrado */ } }, 20_000)
    const close = (): void => { clearInterval(beat); this.streams.delete(res) }
    req.on('close', close)
    res.on('error', close)
  }

  private asset(req: IncomingMessage, res: ServerResponse, path: string): void {
    // «/asset/pack/<curso>/…» → la misma resolución (y los mismos límites) que el protocolo aula-asset:// de la ventana
    const file = resolveAssetUrl('aula-asset://' + path.slice('/asset/'.length))
    let size: number
    try {
      if (!file) throw new Error('fuera')
      const st = statSync(file)
      if (!st.isFile()) throw new Error('no es un archivo')
      size = st.size
    } catch { return this.fail(res, 404, 'not_found') }
    const headers: Record<string, string> = { 'content-type': mimeFor(file!), 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=60' }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (!(start <= end) || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) })
      if (req.method === 'HEAD') { res.end(); return }
      createReadStream(file!, { start, end }).on('error', () => res.destroy()).pipe(res)
      return
    }
    res.writeHead(200, { ...headers, 'content-length': String(size) })
    if (req.method === 'HEAD') { res.end(); return }
    createReadStream(file!).on('error', () => res.destroy()).pipe(res)
  }

  /** La interfaz: sus archivos tal cual; la página, con el puente delante y solo para un dispositivo emparejado. */
  private page(res: ServerResponse, path: string, paired: boolean, head: boolean): void {
    const file = resolveAppUrl('app://aula' + path, this.o.rendererRoot)
    if (!file) return this.fail(res, 404, 'not_found')
    const type = mimeFor(file)
    if (type.startsWith('text/html')) {
      if (!paired) { res.writeHead(302, { location: '/pair', 'cache-control': 'no-store' }); res.end(); return }
      let html: string
      try { html = readFileSync(file, 'utf8') } catch { return this.fail(res, 404, 'not_found') }
      // la página trae su propia política en una etiqueta <meta>; aquí vale la del servidor, y el puente va antes que la app
      html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i, '').replace(/<head>/i, '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Aula"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><script src="/remote-bridge.js"></script>')
      return this.send(res, 200, type, head ? '' : html, { 'content-security-policy': REMOTE_CSP, 'cache-control': 'no-store' })
    }
    let size: number
    try { size = statSync(file).size } catch { return this.fail(res, 404, 'not_found') }
    res.writeHead(200, { 'content-type': type, 'content-length': String(size), 'x-content-type-options': 'nosniff', 'cache-control': /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache' })
    if (head) { res.end(); return }
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
  }

  // MARK: Utilidades

  private async body(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    // solo JSON: una página de otro sitio no puede enviar este tipo sin permiso previo (y la cookie es SameSite=Strict)
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { this.fail(res, 415, 'invalid_args'); return undefined }
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) { this.fail(res, 413, 'invalid_args'); return undefined }
      chunks.push(chunk as Buffer)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') as unknown } catch { this.fail(res, 400, 'invalid_args'); return undefined }
  }

  private send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
    const data = Buffer.from(body, 'utf8')
    res.writeHead(status, { 'content-type': type, 'content-length': String(data.length), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers })
    res.end(data)
  }

  private json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
    this.send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), { 'cache-control': 'no-store', ...headers })
  }

  private fail(res: ServerResponse, status: number, code: string): void {
    if (res.headersSent) { res.end(); return }
    this.json(res, status, { ok: false, error: { message: code, code } })
  }
}

/** La política de la ventana, sin los esquemas propios de Electron (aquí todo es del mismo origen). */
export const REMOTE_CSP = APP_CSP.replace(/ aula-asset:/g, '').replace(/app:\/\/aula/g, "'self'")
