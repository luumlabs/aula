// Búsqueda y lectura web para los agentes que no traen la suya (port de StudyEngine/AI/LiveWebAccess.swift): DuckDuckGo sin
// clave, páginas y PDF legibles (con el lector de materiales), descargas binarias para las imágenes y Wikimedia Commons. Solo
// direcciones públicas: cada redirección se comprueba ANTES de seguirla (nada de este equipo ni de una red privada) y, sin
// proxy, la conexión va por node:http(s) con el nombre resuelto y comprobado AL CONECTAR (un DNS que cambia entre la
// comprobación y la conexión —«DNS rebinding»— no lleva a 127.0.0.1, a la red local ni a 169.254.169.254). Con un proxy del
// sistema va por la red de Chromium (el proxy resuelve los nombres) y queda la comprobación de cada salto.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isJSONObject } from '@engine/base/json'
import { fullText } from '@shared/ingest'
import { AIError } from '../ai'
import { isIngestError, isNonPublicAddress, nodeTransport, readInput, validateURL, type DnsLookup, type HttpResponse, type HttpTransport } from '../ingest'
import { blockedURL, errorMessage } from '../ingest/errors'
import { systemProxyActive } from '../network'
import type { ImageResult, WebAccess, WebResult } from './context'
import { decodeEntities, stripTags } from './research'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

export interface FetchedBytes { data: Uint8Array; mime: string; finalURL: URL; status: number }

/** Lo que hace las peticiones (las pruebas lo sustituyen). Debe NO seguir redirecciones: las sigue y valida `getPublic`. */
export type FetchFn = (url: string, init: { headers: Record<string, string>; redirect: 'manual'; signal?: AbortSignal }) => Promise<Response>

export interface LiveWebOptions {
  fetch?: FetchFn
  /** Valida cada dirección (por defecto, la del lector de materiales: solo públicas). */
  validate?: (url: string) => Promise<URL>
  acceptLanguage?: string
}

export interface GuardedFetchOptions {
  transport?: HttpTransport
  /** ¿Se rechaza esta dirección IP? (por defecto, las locales, privadas, de enlace local y reservadas) */
  isBlocked?: (address: string) => boolean
  /** Resolución de nombres al conectar (pruebas). */
  dnsLookup?: DnsLookup
}

const NULL_BODY = new Set([204, 205, 304])

/** El cuerpo de la respuesta del transporte como flujo web (cancelarlo cierra la conexión). */
function webBody(res: HttpResponse): ReadableStream<Uint8Array> {
  const it = res.body[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        const { done, value } = await it.next()
        if (done) ctl.close()
        else ctl.enqueue(value)
      } catch (err) {
        ctl.error(err)
      }
    },
    cancel() { res.abort() }
  })
}

/** `fetch` directo (sin proxy) por node:http(s): cada nombre se resuelve y se comprueba al conectar, y la dirección con la
 *  que se conectó también debe ser pública. Una sola petición, sin seguir redirecciones (las sigue y valida `getPublic`). */
export function guardedFetch(opts: GuardedFetchOptions = {}): FetchFn {
  const transport = opts.transport ?? nodeTransport
  const blocked = opts.isBlocked ?? isNonPublicAddress
  const why = 'el servidor está en una dirección local o privada'
  return async (url, init) => {
    const res = await transport.request({
      url: new URL(url),
      headers: { ...init.headers, 'accept-encoding': 'gzip, deflate, br' },
      signal: init.signal ?? new AbortController().signal,
      idleTimeoutMs: 20_000,
      checkAddress: (address) => (blocked(address) ? why : null),
      ...(opts.dnsLookup ? { dnsLookup: opts.dnsLookup } : {})
    })
    if ((res.remoteAddress && blocked(res.remoteAddress)) || res.status < 200 || res.status > 599) {
      res.abort()
      if (res.status < 200 || res.status > 599) throw new AIError('badResponse', `Respuesta no válida del servidor (${res.status}).`)
      throw blockedURL(why)
    }
    if (NULL_BODY.has(res.status)) res.abort()
    return new Response(NULL_BODY.has(res.status) ? null : webBody(res), { status: res.status, headers: res.headers })
  }
}

/** Cómo se conecta por defecto: con proxy, el `fetch` global (la red de Chromium); sin él, `guardedFetch`. */
function defaultFetch(): FetchFn {
  return systemProxyActive() ? (u, init) => fetch(u, init) : guardedFetch()
}

/** GET de una dirección pública con límite de tamaño y de redirecciones (cada salto se valida antes de seguirlo). */
export async function getPublic(start: string, maxBytes: number, opts: LiveWebOptions = {}, signal?: AbortSignal, timeoutMs = 25_000): Promise<FetchedBytes> {
  const doFetch: FetchFn = opts.fetch ?? defaultFetch()
  const validate = opts.validate ?? ((u: string) => validateURL(u, false))
  const ctl = new AbortController()
  const onAbort = (): void => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    let url = await validate(start)
    for (let hop = 0; hop <= 6; hop++) {
      const res = await doFetch(url.toString(), { headers: { 'user-agent': USER_AGENT, 'accept-language': opts.acceptLanguage ?? 'es,en;q=0.8' }, redirect: 'manual', signal: ctl.signal })
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        void res.body?.cancel().catch(() => undefined)
        const loc = res.headers.get('location')
        if (!loc) throw new AIError('http', 'Redirección sin destino.', { status: res.status })
        url = await validate(new URL(loc, url).toString())
        continue
      }
      const declared = Number(res.headers.get('content-length') ?? '0')
      if (declared > maxBytes) throw new AIError('unsupported', `El archivo es demasiado grande (${Math.round(declared / 1_000_000)} MB; máximo ${Math.round(maxBytes / 1_000_000)} MB).`)
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = res.body?.getReader()
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) { void reader.cancel(); throw new AIError('unsupported', `El archivo es demasiado grande (máximo ${Math.round(maxBytes / 1_000_000)} MB).`) }
          chunks.push(value)
        }
      }
      const data = new Uint8Array(size)
      let off = 0
      for (const c of chunks) { data.set(c, off); off += c.byteLength }
      const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      return { data, mime, finalURL: url, status: res.status }
    }
    throw new AIError('http', 'Demasiadas redirecciones.')
  } catch (err) {
    if (signal?.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
    if (ctl.signal.aborted) throw new AIError('timeout', 'La página tardó demasiado en responder.')
    if (err instanceof AIError) throw err
    if (isIngestError(err, 'blockedURL')) throw new AIError('unsupported', errorMessage(err))
    throw new AIError('network', `No pude conectar: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function parseDuckDuckGo(html: string, limit: number): WebResult[] {
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const snips = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
  const out: WebResult[] = []
  links.forEach((m, i) => {
    if (out.length >= limit) return
    let href = decodeEntities(m[1])
    if (href.startsWith('//')) href = 'https:' + href
    try { const u = new URL(href); const real = u.searchParams.get('uddg'); if (real) href = real } catch { /* tal cual */ }
    if (!href.startsWith('http') || href.includes('duckduckgo.com/y.js')) return // anuncios
    out.push({ title: stripTags(m[2]), url: href, snippet: i < snips.length ? stripTags(snips[i][1]) : '' })
  })
  return out
}

const TEXT_TYPES = (mime: string): boolean => mime.startsWith('text/plain') || mime.includes('json') || (mime.includes('xml') && !mime.includes('html'))

function extensionFor(mime: string, url: URL): string {
  if (mime.includes('pdf') || url.pathname.toLowerCase().endsWith('.pdf')) return '.pdf'
  if (mime.includes('html') || mime === '') return '.html'
  if (mime.includes('wordprocessingml')) return '.docx'
  if (mime.includes('presentationml')) return '.pptx'
  if (mime.startsWith('text/')) return '.txt'
  return ''
}

/** La web real: DuckDuckGo, páginas legibles, descargas y Commons. */
export class LiveWebAccess implements WebAccess {
  constructor(private readonly opts: LiveWebOptions = {}) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<WebResult[]> {
    const q = query.trim()
    if (!q) return []
    const u = new URL('https://html.duckduckgo.com/html/')
    u.searchParams.set('q', q)
    const r = await getPublic(u.toString(), 3_000_000, this.opts, signal, 20_000)
    if (r.status !== 200) throw new AIError('http', `DuckDuckGo respondió ${r.status}.`, { status: r.status })
    const html = new TextDecoder().decode(r.data)
    const out = parseDuckDuckGo(html, limit)
    if (!out.length && (html.includes('anomaly') || html.includes('captcha'))) throw new AIError('rateLimited', 'DuckDuckGo pide verificación (demasiadas búsquedas). Espera un momento.')
    return out
  }

  async fetch(url: string, maxChars: number, signal?: AbortSignal): Promise<string> {
    const r = await getPublic(url, 6_000_000, this.opts, signal)
    if (r.status < 200 || r.status >= 300) throw new AIError('http', `La página respondió ${r.status}.`, { status: r.status })
    let text: string
    if (TEXT_TYPES(r.mime)) text = new TextDecoder().decode(r.data)
    else {
      const ext = extensionFor(r.mime, r.finalURL)
      if (!ext) throw new AIError('unsupported', `Tipo de contenido no admitido: ${r.mime}.`)
      const dir = join(tmpdir(), `aula-web-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })
      try {
        const file = join(dir, 'pagina' + ext)
        writeFileSync(file, r.data)
        // en el lector aparte si lo hay (A2-P1-3: un PDF hostil enlazado desde una página congelaba el proceso principal)
        const doc = await readInput({ type: 'file', path: file }, { signal, ocr: false, maxPages: 60 })
        text = doc.pages.length > 1 ? doc.pages.map((p) => `[p.${p.number}]\n${p.text}`).join('\n\n') : fullText(doc)
        if (doc.title && !text.startsWith('#')) text = `# ${doc.title}\n\n${text}`
      } finally {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* nada */ }
      }
    }
    text = text.trim()
    const chars = Array.from(text)
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') + `\n\n[…recortado a ${maxChars} caracteres]` : text
  }

  async fetchData(url: string, maxBytes: number, signal?: AbortSignal): Promise<{ data: Uint8Array; mimeType: string }> {
    const r = await getPublic(url, maxBytes, this.opts, signal, 30_000)
    if (r.status < 200 || r.status >= 300) throw new AIError('http', `El servidor respondió ${r.status}.`, { status: r.status })
    return { data: r.data, mimeType: r.mime }
  }

  /** Búsqueda en Wikimedia Commons (sin clave): miniaturas de ~1200 px con su licencia y autoría. */
  async searchImages(query: string, limit: number, signal?: AbortSignal): Promise<ImageResult[]> {
    const u = new URL('https://commons.wikimedia.org/w/api.php')
    for (const [k, v] of [['action', 'query'], ['format', 'json'], ['generator', 'search'], ['gsrnamespace', '6'], ['gsrsearch', `filetype:bitmap|drawing ${query}`],
      ['gsrlimit', String(Math.min(Math.max(limit, 1), 12))], ['prop', 'imageinfo'], ['iiprop', 'url|size|mime|extmetadata'], ['iiurlwidth', '1200'],
      ['iiextmetadatafilter', 'LicenseShortName|Artist|ImageDescription'], ['iiextmetadatalanguage', 'es']]) u.searchParams.set(k, v)
    const r = await getPublic(u.toString(), 3_000_000, this.opts, signal, 20_000)
    if (r.status < 200 || r.status >= 300) throw new AIError('http', `Wikimedia Commons respondió ${r.status}.`, { status: r.status })
    return parseCommonsImages(new TextDecoder().decode(r.data))
  }
}

export function parseCommonsImages(json: string): ImageResult[] {
  let root: unknown
  try { root = JSON.parse(json) } catch { return [] }
  const pages = isJSONObject(root) && isJSONObject(root.query) && isJSONObject(root.query.pages) ? Object.values(root.query.pages) : []
  const sorted = pages.filter(isJSONObject).sort((a, b) => (typeof a.index === 'number' ? a.index : 0) - (typeof b.index === 'number' ? b.index : 0))
  const out: ImageResult[] = []
  for (const page of sorted) {
    const info = Array.isArray(page.imageinfo) && isJSONObject(page.imageinfo[0]) ? page.imageinfo[0] : undefined
    if (!info || typeof info.url !== 'string') continue
    const meta = isJSONObject(info.extmetadata) ? info.extmetadata : {}
    const m = (k: string): string => { const x = meta[k]; return isJSONObject(x) && typeof x.value === 'string' ? stripTags(x.value).trim() : '' }
    const mime = typeof info.mime === 'string' ? info.mime : ''
    const thumb = typeof info.thumburl === 'string' ? info.thumburl : undefined
    // los SVG (la mayoría de los diagramas de anatomía) se descargan como su miniatura PNG
    if (!mime.startsWith('image/') || (mime.includes('svg') && !thumb)) continue
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
    out.push({
      title: (typeof page.title === 'string' ? page.title : '').replace('File:', ''), url: thumb ?? info.url, pageURL: typeof info.descriptionurl === 'string' ? info.descriptionurl : '',
      width: num(info.thumbwidth) || num(info.width), height: num(info.thumbheight) || num(info.height), mimeType: mime, license: m('LicenseShortName'),
      author: Array.from(m('Artist')).slice(0, 120).join(''), description: Array.from(m('ImageDescription')).slice(0, 300).join('')
    })
  }
  return out
}
