// Descarga de páginas web (port de WebFetcher.swift): bloqueo de direcciones locales y privadas (SSRF) también en cada
// redirección y en la dirección realmente conectada, límites de tamaño (anunciado y en streaming, también tras descomprimir),
// de tiempo y de redirecciones, y errores claros para el usuario. El transporte es intercambiable (`HttpTransport`).
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import * as zlib from 'node:zlib'
import type { ProgressReporter } from '../core/progress'
import { blockedURL, CancelledError, errorMessage, IngestError, network, tooLarge, unsupportedType } from '../errors'
import { ingestLanguage, L } from '../messages'

// MARK: Seguridad de direcciones

export type Verdict = { allowed: true } | { allowed: false; reason: string }

const ALLOWED: Verdict = { allowed: true }
const blocked = (reason: string): Verdict => ({ allowed: false, reason })

/** Nombres de host que siempre son locales. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa', '.corp', '.intranet', '.private', '.localdomain']

/** IPv4 en las formas que acepta `inet_aton` («127.0.0.1», «127.1», «0x7f.1», «2130706433», «0177.0.0.1»), o `null`. */
export function parseIPv4Literal(host: string): number | null {
  if (!host || !/^[0-9]/.test(host) || !/^[0-9a-fA-FxX.]+$/.test(host)) return null
  const parts = host.split('.')
  if (parts.length > 4 || parts.some((p) => p.length === 0)) return null
  const values: number[] = []
  for (const p of parts) {
    let v: number
    if (/^0[xX][0-9a-fA-F]*$/.test(p)) v = p.length === 2 ? 0 : parseInt(p.slice(2), 16)
    else if (/^0[0-7]*$/.test(p)) v = parseInt(p, 8)
    else if (/^[1-9][0-9]*$/.test(p)) v = parseInt(p, 10)
    else return null
    if (!Number.isFinite(v) || v > 0xffffffff) return null
    values.push(v)
  }
  const last = values[values.length - 1]
  const lead = values.slice(0, -1)
  if (lead.some((v) => v > 255)) return null
  const maxLast = 2 ** (8 * (4 - lead.length)) - 1
  if (last > maxLast) return null
  let out = 0
  lead.forEach((v, i) => { out += v * 2 ** (8 * (3 - i)) })
  return (out + last) >>> 0
}

/** Bytes de una dirección IPv6 (con o sin IPv4 al final), o `null`. */
export function parseIPv6(host: string): number[] | null {
  let s = host
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  if (isIP(s) !== 6) return null
  let tail: number[] = []
  const lastColon = s.lastIndexOf(':')
  const maybeV4 = s.slice(lastColon + 1)
  if (maybeV4.includes('.')) {
    const v = parseIPv4Literal(maybeV4)
    if (v === null) return null
    tail = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  const [headPart, tailPart] = s.includes('::') ? s.split('::') : [s, null]
  const toGroups = (p: string): number[] => (p ? p.split(':').map((g) => parseInt(g, 16)) : [])
  const head = toGroups(headPart)
  const rest = tailPart === null ? [] : toGroups(tailPart)
  const fill = 8 - head.length - rest.length
  if (fill < 0 || (tailPart === null && fill !== 0)) return null
  const groups = [...head, ...Array<number>(fill).fill(0), ...rest]
  const bytes: number[] = []
  for (const g of groups) {
    if (!Number.isFinite(g) || g < 0 || g > 0xffff) return null
    bytes.push((g >> 8) & 255, g & 255)
  }
  if (tail.length) bytes.splice(12, 4, ...tail)
  return bytes
}

export function isNonPublicIPv4(v: number): boolean {
  const a = (v >>> 24) & 255, b = (v >>> 16) & 255, c = (v >>> 8) & 255
  switch (a) {
    case 0: case 10: case 127: return true
    case 100: return b >= 64 && b <= 127                    // CGNAT 100.64/10
    case 169: return b === 254                              // enlace local y metadatos de la nube
    case 172: return b >= 16 && b <= 31
    case 192:
      if (b === 168) return true
      return b === 0 && (c === 0 || c === 2)                // 192.0.0.0/24 y 192.0.2.0/24
    case 198:
      if (b === 18 || b === 19) return true                 // pruebas de rendimiento
      return b === 51 && c === 100
    case 203: return b === 0 && c === 113
    default: return a >= 224                                // multidifusión, reservadas y difusión
  }
}

export function isNonPublicIPv6(b: number[]): boolean {
  if (b.length !== 16) return true
  const zero = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0)
  const v4 = (i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  if (zero(0, 16)) return true                                                      // ::
  if (zero(0, 15) && b[15] === 1) return true                                       // ::1
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isNonPublicIPv4(v4(12)) // ::ffff:a.b.c.d
  if (zero(0, 12)) return true                                                      // ::a.b.c.d (obsoleta)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return isNonPublicIPv4(v4(12))  // NAT64
  if (b[0] === 0xfc || b[0] === 0xfd) return true                                   // fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true                          // fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true                          // fec0::/10
  if (b[0] === 0xff) return true                                                    // multidifusión
  if (b[0] === 0x01 && zero(1, 8)) return true                                      // 100::/64
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true  // 2001:db8::/32
  if (b[0] === 0x20 && b[1] === 0x02) return isNonPublicIPv4(v4(2))                 // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return isNonPublicIPv4(~v4(12) >>> 0)  // Teredo
  return false
}

/** ¿La dirección (texto) con la que se conectó es local o privada? */
export function isNonPublicAddress(text: string): boolean {
  let s = text
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  const v4 = parseIPv4Literal(s)
  if (v4 !== null) return isNonPublicIPv4(v4)
  const v6 = parseIPv6(s)
  if (v6) return isNonPublicIPv6(v6)
  return false
}

/** Veredicto sin red para un nombre de host o una IP escrita de cualquier forma (`null`: hace falta resolverlo). */
function literalVerdict(rawHost: string): Verdict | null {
  let host = rawHost.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  while (host.endsWith('.')) host = host.slice(0, -1)
  const zone = host.indexOf('%')
  if (zone >= 0) host = host.slice(0, zone)
  if (!host) return blocked(L('servidor vacío'))
  if (host === 'localhost' || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return blocked(L('«%@» es una dirección local', rawHost))
  const v4 = parseIPv4Literal(host)
  if (v4 !== null) return isNonPublicIPv4(v4) ? blocked(L('«%@» es una dirección local o privada', rawHost)) : ALLOWED
  if (host.includes(':')) {
    const v6 = parseIPv6(host)
    if (!v6) return blocked(L('dirección IPv6 no válida'))
    return isNonPublicIPv6(v6) ? blocked(L('«%@» es una dirección local o privada', rawHost)) : ALLOWED
  }
  // Nombres de una sola palabra: redes internas («router», «nas»)
  if (!host.includes('.')) return blocked(L('«%@» parece un nombre de la red interna', rawHost))
  return null
}

/** Direcciones de un nombre (vacío si no resuelve). */
export type Resolver = (host: string) => Promise<string[]>

const systemResolver: Resolver = (host) => new Promise((resolve) => {
  dnsLookup(host, { all: true }, (err, addresses: LookupAddress[]) => resolve(err ? [] : addresses.map((a) => a.address)))
})

/** Veredicto para un host: sin red si es una IP o un nombre local; si no, se resuelve y se mira cada dirección. */
export async function verdictForHost(rawHost: string, resolver: Resolver = systemResolver): Promise<Verdict> {
  const quick = literalVerdict(rawHost)
  if (quick) return quick
  const addresses = await resolver(rawHost.toLowerCase().replace(/\.+$/, ''))
  // No resuelve: la descarga fallará con su propio mensaje
  for (const a of addresses) if (isNonPublicAddress(a)) return blocked(L('«%@» apunta a una dirección local o privada', rawHost))
  return ALLOWED
}

/** Comprueba esquema, servidor, credenciales y (salvo `allowPrivate`) que no sea una dirección local o privada. */
export async function validateURL(raw: string | URL, allowPrivate: boolean, resolver?: Resolver): Promise<URL> {
  const url = parseURL(raw)
  if (allowPrivate) return url
  const v = await verdictForHost(url.hostname, resolver)
  if (!v.allowed) throw blockedURL(v.reason)
  return url
}

/** Validación sin red de esquema, servidor y credenciales. */
export function parseURL(raw: string | URL): URL {
  let url: URL
  try {
    url = typeof raw === 'string' ? new URL(raw.trim()) : raw
  } catch {
    throw blockedURL(L('solo se admiten direcciones http y https'))
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw blockedURL(L('solo se admiten direcciones http y https'))
  if (!url.hostname) throw blockedURL(L('la dirección no tiene servidor'))
  if (url.username || url.password) throw blockedURL(L('no se admiten direcciones con usuario y contraseña'))
  return url
}

// MARK: Transporte

export interface HttpRequest {
  url: URL
  headers: Record<string, string>
  signal: AbortSignal
  /** Sin datos durante este tiempo: error de tiempo de espera. */
  idleTimeoutMs: number
  /** Comprueba cada dirección resuelta antes de conectar: `null` si se puede usar o el motivo del bloqueo. */
  checkAddress?: (address: string) => string | null
  /** Resolución de nombres al conectar (por defecto, la del sistema; las pruebas la sustituyen). */
  dnsLookup?: DnsLookup
}

/** Como `dns.lookup` con `all: true`. */
export type DnsLookup = (hostname: string, options: { all: true; family?: number | string }, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void

export interface HttpResponse {
  status: number
  /** Cabeceras con el nombre en minúsculas. */
  headers: Record<string, string>
  /** Dirección IP con la que se conectó (si se sabe). */
  remoteAddress?: string
  /** Cuerpo (ya descomprimido si venía con gzip, deflate o br). */
  body: AsyncIterable<Uint8Array>
  /** Cierra la conexión sin leer el resto. */
  abort(): void
}

/** Transporte HTTP: una sola petición GET, SIN seguir redirecciones (las sigue y valida el descargador). */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>
}

class TransportTimeout extends Error {
  constructor() { super('timeout'); this.name = 'TransportTimeout' }
}

function headerRecord(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  return out
}

/** Transporte por defecto: node:http/https, sin cookies ni caché, con DNS validado en el momento de conectar. */
export const nodeTransport: HttpTransport = {
  request(req: HttpRequest): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const mod = req.url.protocol === 'https:' ? https : http
      const lookup = req.checkAddress ? guardedLookup(req.checkAddress, req.dnsLookup) : undefined
      const request = mod.request(req.url, { method: 'GET', headers: req.headers, agent: false, signal: req.signal, lookup, timeout: req.idleTimeoutMs }, (res) => {
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim()
        let body: NodeJS.ReadableStream & AsyncIterable<Uint8Array> = res
        const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
          : encoding === 'deflate' ? zlib.createInflate()
            : encoding === 'br' ? zlib.createBrotliDecompress() : null
        if (decoder) {
          res.on('error', (e) => decoder.destroy(e))
          body = res.pipe(decoder)
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: headerRecord(res.headers),
          remoteAddress: res.socket?.remoteAddress ?? undefined,
          body,
          abort: () => { res.destroy(); decoder?.destroy(); request.destroy() }
        })
      })
      request.on('timeout', () => request.destroy(new TransportTimeout()))
      request.on('error', reject)
      request.end()
    })
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** `lookup` que rechaza las direcciones locales o privadas (contra cambios de DNS entre la comprobación y la conexión). */
const systemLookup: DnsLookup = (hostname, options, callback) => dnsLookup(hostname, options as { all: true }, callback)

function guardedLookup(check: (address: string) => string | null, resolve: DnsLookup = systemLookup) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback): void => {
    resolve(hostname, { ...options, all: true } as { all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, '')
      for (const a of addresses) {
        const why = check(a.address)
        if (why) return callback(blockedURL(why) as unknown as NodeJS.ErrnoException, '')
      }
      if (options.all) callback(null, addresses)
      else callback(null, addresses[0]?.address ?? '', addresses[0]?.family ?? 4)
    })
  }
}

// MARK: Descarga

export interface DownloadOptions {
  maxBytes: number
  allowPrivate: boolean
  signal?: AbortSignal
  transport?: HttpTransport
  progress?: ProgressReporter
  /** Resolución de nombres para la comprobación previa (pruebas). */
  resolver?: Resolver
  /** Tiempo máximo sin recibir datos (20 s) y de toda la descarga (90 s). */
  idleTimeoutMs?: number
  totalTimeoutMs?: number
  maxRedirects?: number
}

export interface Download {
  data: Uint8Array
  status: number
  headers: Record<string, string>
  /** Tipo MIME en minúsculas, sin parámetros («text/html»). Vacío si no vino. */
  mime: string
  charset: string | null
  finalURL: URL
}

/** Cabecera `Accept-Language`: el idioma de la interfaz y, de respaldo, el inglés («es,en;q=0.8», «pt-BR,pt;q=0.9,en;q=0.8»). */
export function acceptLanguage(interfaceCode: string = ingestLanguage()): string {
  const tags: string[] = []
  const base = interfaceCode.split(/[-_]/)[0]
  for (const tag of [interfaceCode.replace(/_/g, '-'), base, 'en']) if (tag && !tags.includes(tag)) tags.push(tag)
  return tags.map((tag, i) => (i === 0 ? tag : tag + (tag === 'en' ? ';q=0.8' : ';q=0.9'))).join(',')
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const megabytes = (n: number): number => Math.floor(n / (1024 * 1024))

/** `Content-Type` → tipo y juego de caracteres. */
export function parseContentType(value: string | undefined): { mime: string; charset: string | null } {
  if (!value) return { mime: '', charset: null }
  const [type, ...params] = value.split(';')
  let charset: string | null = null
  for (const p of params) {
    const m = /^\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(p)
    if (m) charset = m[1]
  }
  return { mime: type.trim().toLowerCase(), charset }
}

/** Descarga una página con límites de tamaño, tiempo y redirecciones, validando cada dirección. */
export async function download(start: URL, options: DownloadOptions): Promise<Download> {
  if (options.signal?.aborted) throw new CancelledError()
  const transport = options.transport ?? nodeTransport
  const controller = new AbortController()
  let timedOut = false
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.totalTimeoutMs ?? 90_000)
  timer.unref?.()
  const check = options.allowPrivate ? undefined : (address: string): string | null => (isNonPublicAddress(address) ? L('el servidor respondió desde una dirección local o privada') : null)
  const headers = {
    'User-Agent': 'Aula/2.0 (app de estudio)',
    Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    'Accept-Language': acceptLanguage(),
    'Accept-Encoding': 'gzip, deflate, br'
  }
  try {
    let url = start
    let redirects = 0
    for (;;) {
      url = await validateURL(url, options.allowPrivate, options.resolver)
      if (controller.signal.aborted) throw new CancelledError()
      let res: HttpResponse
      try {
        res = await transport.request({ url, headers, signal: controller.signal, idleTimeoutMs: options.idleTimeoutMs ?? 20_000, checkAddress: check })
      } catch (e) {
        throw mapNetworkError(e, timedOut, options.signal)
      }
      if (REDIRECTS.has(res.status) && res.headers.location) {
        res.abort()
        redirects++
        if (redirects > (options.maxRedirects ?? 6)) throw network(L('demasiadas redirecciones'))
        let next: URL
        try { next = new URL(res.headers.location, url) } catch { throw network(L('respuesta no válida del servidor')) }
        url = parseURL(next)
        continue
      }
      // La dirección realmente usada también debe ser pública
      if (!options.allowPrivate && res.remoteAddress && isNonPublicAddress(res.remoteAddress)) {
        res.abort()
        throw blockedURL(L('el servidor respondió desde una dirección local o privada'))
      }
      const { mime, charset } = parseContentType(res.headers['content-type'])
      const announced = Number(res.headers['content-length'] ?? -1)
      if (Number.isFinite(announced) && announced > options.maxBytes) {
        res.abort()
        throw tooLarge(L('la página ocupa más de %lld MB', megabytes(options.maxBytes)))
      }
      if (mime.startsWith('video/') || mime.startsWith('audio/')) {
        res.abort()
        throw unsupportedType(L('el servidor devolvió contenido de tipo «%@»', mime))
      }
      const data = await readBody(res, options, announced, () => mapNetworkError(new Error('aborted'), timedOut, options.signal))
      return { data, status: res.status, headers: res.headers, mime, charset, finalURL: url }
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

async function readBody(res: HttpResponse, options: DownloadOptions, announced: number, aborted: () => Error): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of res.body) {
      size += chunk.length
      if (size > options.maxBytes) {
        res.abort()
        throw tooLarge(L('la página ocupa más de %lld MB', megabytes(options.maxBytes)))
      }
      parts.push(chunk)
      if (announced > 0) options.progress?.report(0.02 + 0.28 * Math.min(1, size / announced), L('Descargando la página…'))
    }
  } catch (e) {
    if (e instanceof IngestError) throw e
    if (options.signal?.aborted) throw new CancelledError()
    throw e instanceof Error && (e.name === 'AbortError' || e.name === 'TransportTimeout') ? aborted() : mapNetworkError(e, false, options.signal)
  }
  const out = new Uint8Array(size)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const CERT_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'HOSTNAME_MISMATCH'])

/** Error de red → mensaje para el usuario (o cancelación). */
function mapNetworkError(e: unknown, timedOut: boolean, signal?: AbortSignal): Error {
  if (e instanceof IngestError) return e
  if (signal?.aborted) return new CancelledError()
  if (timedOut || (e instanceof Error && e.name === 'TransportTimeout')) return network(L('el servidor tardó demasiado en responder'))
  const code = (e as { code?: string } | null)?.code ?? ''
  if (e instanceof Error && e.name === 'AbortError') return new CancelledError()
  switch (code) {
    case 'ENOTFOUND': case 'EAI_NONAME': case 'EAI_NODATA': return network(L('no se encontró el servidor'))
    case 'EAI_AGAIN': case 'ENETUNREACH': case 'ENETDOWN': case 'EHOSTUNREACH': return network(L('no hay conexión a internet'))
    case 'ECONNREFUSED': return network(L('el servidor rechazó la conexión'))
    case 'ETIMEDOUT': case 'ESOCKETTIMEDOUT': return network(L('el servidor tardó demasiado en responder'))
    default: break
  }
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS_') || CERT_CODES.has(code)) return network(L('el certificado de seguridad del servidor no es válido'))
  return network(errorMessage(e))
}

/** Motivo para un estado HTTP que no es de éxito. */
export function statusReason(status: number): string {
  switch (status) {
    case 401: return L('la página exige iniciar sesión (código 401)')
    case 403: return L('el servidor no permite el acceso (código 403)')
    case 404: case 410: return L('la página no existe (código %@)', String(status))
    case 429: return L('demasiadas peticiones; prueba más tarde (código 429)')
    default:
      if (status >= 500 && status <= 599) return L('error del servidor (código %@)', String(status))
      return L('respuesta inesperada del servidor (código %@)', String(status))
  }
}

/** Extensión para guardar un documento descargado (PDF, Word, imagen…) y leerlo como un archivo local. */
export function downloadedFileExtension(mime: string, url: URL, known: (ext: string) => boolean): string {
  let name = url.pathname.split('/').pop() ?? ''
  try { name = decodeURIComponent(name) } catch { /* se usa tal cual */ }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (ext && known(ext)) return '.' + ext
  switch (mime) {
    case 'application/pdf': return '.pdf'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return '.docx'
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation': return '.pptx'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': return '.xlsx'
    case 'application/epub+zip': return '.epub'
    case 'application/rtf': case 'text/rtf': return '.rtf'
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/heic': return '.heic'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    case 'image/tiff': return '.tiff'
    default: return ''
  }
}
