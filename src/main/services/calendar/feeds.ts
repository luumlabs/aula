// Descarga de calendarios .ics (ICSFeed.swift) con `fetch`: Canvas «Fuente del calendario», Moodle, Google Calendar, Outlook,
// Apple Calendar… No lleva credenciales: la propia dirección es el secreto, así que nunca se registra ni se muestra completa
// (los errores solo nombran el servidor). Solo https (o http hacia localhost), como mucho 5 redirecciones y 10 MB.
// Redirecciones: las decide el servidor remoto, así que, salvo que sigan en el mismo servidor que la dirección que dio el
// estudiante, no pueden llevar a este ordenador ni a la red local (router, impresoras, servicios internos): cada salto se
// comprueba (también resolviendo el nombre) antes de seguirlo. La primera dirección sí puede ser local o privada (un NAS, la
// intranet del centro, un servidor en este ordenador): la eligió el estudiante.
import { feedHost, isAllowedFeedURL, looksLikeCalendar, parseICS, upgradeFeedURL, type StudyEvent } from '@engine/calendar/ics'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { verdictForHost, type Resolver } from '../ingest/extract/web'

/** Tamaño máximo aceptado para el archivo. */
export const ICS_MAX_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

export type CalendarFeedErrorCode =
  | 'calendar_invalid_url' | 'calendar_private' | 'calendar_not_found' | 'rate_limited' | 'calendar_server' | 'calendar_http' | 'not_a_calendar'
  | 'too_large' | 'offline' | 'timed_out' | 'host_not_found' | 'secure_connection' | 'network' | 'cancelled' | 'calendar_private_redirect'

/** Error al leer un calendario, con código estable y una frase para el estudiante (sin la dirección secreta). */
export class CalendarFeedError extends AulaError {
  constructor(code: CalendarFeedErrorCode, message: string, details?: unknown) {
    super(code, message, details)
    this.name = 'CalendarFeedError'
  }
  get feedCode(): CalendarFeedErrorCode { return this.code as CalendarFeedErrorCode }
}

const MB = (n: number) => `${Math.round(n / (1024 * 1024))} MB`

// Funciones (no constantes): cada mensaje sale en el idioma de la interfaz en el momento del error
export const FeedErrors = {
  invalidURL: (host: string) => new CalendarFeedError('calendar_invalid_url',
    tr(
      `El enlace del calendario «${host}» no es válido. Debe empezar por https:// o webcal:// y terminar en .ics (o ser la dirección iCal que da tu calendario).`,
      `The calendar link “${host}” isn’t valid. It must start with https:// or webcal:// and end in .ics (or be the iCal address your calendar gives you).`
    )),
  private: () => new CalendarFeedError('calendar_private',
    tr(
      'Ese calendario es privado y no se puede leer sin iniciar sesión. Usa la dirección secreta en formato iCal (en Google Calendar: Configuración → Integrar calendario → «Dirección secreta en formato iCal»; en Canvas: Calendario → «Fuente del calendario»).',
      'That calendar is private and can’t be read without signing in. Use its secret address in iCal format (in Google Calendar: Settings → Integrate calendar → “Secret address in iCal format”; in Canvas: Calendar → “Calendar Feed”).'
    )),
  privateRedirect: (host: string) => new CalendarFeedError('calendar_private_redirect',
    tr(
      `El calendario redirige a «${host}», una dirección de este ordenador o de la red local, y Aula no la sigue.`,
      `The calendar redirects to “${host}”, an address on this computer or the local network, and Aula doesn’t follow it.`
    )),
  notFound: () => new CalendarFeedError('calendar_not_found', tr(
    'El enlace del calendario ya no existe o caducó. Genera uno nuevo y vuelve a pegarlo.',
    'The calendar link no longer exists or has expired. Generate a new one and paste it again.'
  )),
  rateLimited: (retryAfter: number | null) => new CalendarFeedError('rate_limited', retryAfter !== null && retryAfter >= 1
    ? tr(
      `El calendario está limitando las peticiones (demasiadas en poco tiempo). Espera unos ${Math.ceil(retryAfter)} segundos e inténtalo de nuevo.`,
      `The calendar is limiting requests (too many in a short time). Wait about ${Math.ceil(retryAfter)} seconds and try again.`
    )
    : tr(
      'El calendario está limitando las peticiones (demasiadas en poco tiempo). Espera un minuto e inténtalo de nuevo.',
      'The calendar is limiting requests (too many in a short time). Wait a minute and try again.'
    ), { retryAfter }),
  server: (status: number) => new CalendarFeedError('calendar_server', tr(
    `El servidor del calendario tuvo un problema interno (error ${status}). Inténtalo de nuevo en unos minutos.`,
    `The calendar’s server had an internal problem (error ${status}). Try again in a few minutes.`
  ), { status }),
  http: (status: number) => new CalendarFeedError('calendar_http', tr(`El servidor del calendario respondió con el error ${status}.`, `The calendar’s server answered with error ${status}.`), { status }),
  notACalendar: () => new CalendarFeedError('not_a_calendar',
    tr(
      'El enlace no devolvió un calendario .ics válido. Comprueba que sea la dirección pública o secreta en formato iCal (no la página web del calendario).',
      'The link didn’t return a valid .ics calendar. Check that it’s the public or secret address in iCal format (not the calendar’s web page).'
    )),
  tooLarge: (limit: number) => new CalendarFeedError('too_large', tr(`La respuesta supera el tamaño máximo permitido (${MB(limit)}).`, `The response is over the maximum allowed size (${MB(limit)}).`), { limitBytes: limit }),
  offline: () => new CalendarFeedError('offline', tr('No hay conexión a internet. Revisa tu red e inténtalo de nuevo.', 'No internet connection. Check your network and try again.')),
  timedOut: () => new CalendarFeedError('timed_out', tr('El calendario tardó demasiado en responder. Inténtalo de nuevo en un momento.', 'The calendar took too long to respond. Try again in a moment.')),
  hostNotFound: (host: string) => new CalendarFeedError('host_not_found', tr(
    `No se encontró el servidor «${host}». Revisa que la dirección del calendario esté bien escrita.`,
    `The server “${host}” wasn’t found. Check that the calendar address is spelled right.`
  )),
  secure: (host: string) => new CalendarFeedError('secure_connection',
    tr(
      `No se pudo establecer una conexión segura con «${host}». Revisa la dirección y que el certificado del sitio sea válido.`,
      `Couldn’t make a secure connection to “${host}”. Check the address and that the site’s certificate is valid.`
    )),
  network: (detail: string) => new CalendarFeedError('network', `${tr('Error de red', 'Network error')}: ${detail}`),
  cancelled: () => new CalendarFeedError('cancelled', tr('Cancelado', 'Cancelled'))
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface FeedFetchOptions {
  fetch?: FetchLike
  /** Referencia para acotar las series sin fin. */
  now?: Date
  /** Zona de las horas flotantes y de los eventos de todo el día. */
  timeZone?: string
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
  /** Resolución de nombres para comprobar las redirecciones (por defecto, la del sistema; las pruebas la sustituyen). */
  resolver?: Resolver
}

/** ¿Se puede seguir esta redirección? Como la primera (https, o http hacia localhost) y, si sale del servidor que dio el
 *  estudiante, a un servidor público (ni localhost, ni red privada, ni enlace local, ni un nombre que resuelva a ellos). */
async function redirectVerdict(next: string, start: string, resolver?: Resolver): Promise<'ok' | 'invalid' | 'private'> {
  if (!isAllowedFeedURL(next)) return 'invalid'
  const target = new URL(next)
  if (target.origin === new URL(start).origin) return 'ok'
  return (await verdictForHost(target.hostname, resolver)).allowed ? 'ok' : 'private'
}

/** Segundos de `Retry-After` (entero o fecha HTTP). */
export function retryAfterSeconds(value: string | null, now: Date = new Date()): number | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  const d = Date.parse(raw)
  return Number.isNaN(d) ? null : Math.max(0, (d - now.getTime()) / 1000)
}

function errorCode(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } } }
  return String(e?.cause?.code ?? e?.code ?? e?.cause?.cause?.code ?? '')
}

/** Traduce un fallo de red de `fetch` a un error accionable. */
export function translateNetworkError(err: unknown, host: string, aborted: 'timeout' | 'external' | null): CalendarFeedError {
  if (err instanceof CalendarFeedError) return err
  if (aborted === 'external') return FeedErrors.cancelled()
  if (aborted === 'timeout') return FeedErrors.timedOut()
  const code = errorCode(err)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') return FeedErrors.hostNotFound(host)
  if (code === 'ENETUNREACH' || code === 'ENETDOWN' || code === 'EHOSTUNREACH' || code === 'ECONNREFUSED') return FeedErrors.offline()
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return FeedErrors.timedOut()
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return FeedErrors.secure(host)
  const name = (err as { name?: string })?.name
  if (name === 'AbortError') return FeedErrors.cancelled()
  const detail = err instanceof Error ? err.message : String(err)
  return FeedErrors.network(detail.replace(/https?:\/\/\S+/g, host))
}

/** Lee el cuerpo con un tope de bytes (por `Content-Length` y mientras llega). */
async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined)
    throw FeedErrors.tooLarge(maxBytes)
  }
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw FeedErrors.tooLarge(maxBytes)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

/** Descarga el calendario (sigue las redirecciones seguras) y devuelve sus bytes ya comprobados. */
export async function fetchICSBytes(url: string, opts: FeedFetchOptions = {}): Promise<Uint8Array> {
  const start = upgradeFeedURL(url)
  if (!start) throw FeedErrors.invalidURL(feedHost(url) === '?' ? tr('dirección sin servidor', 'address without a server') : feedHost(url))
  const doFetch: FetchLike = opts.fetch ?? ((u, init) => fetch(u, init))
  const maxBytes = opts.maxBytes ?? ICS_MAX_BYTES
  let current = start
  let redirects = 0
  for (;;) {
    const host = feedHost(current)
    const controller = new AbortController()
    let aborted: 'timeout' | 'external' | null = null
    const timer = setTimeout(() => { aborted = 'timeout'; controller.abort() }, opts.timeoutMs ?? TIMEOUT_MS)
    const onAbort = () => { aborted = 'external'; controller.abort() }
    if (opts.signal?.aborted) onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let res: Response
      try {
        res = await doFetch(current, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'Aula/2 (Calendario)' },
          signal: controller.signal
        })
      } catch (err) {
        throw translateNetworkError(err, host, aborted)
      }
      const status = res.status
      if (status >= 200 && status < 300) {
        let data: Uint8Array
        try {
          data = await readLimited(res, maxBytes)
        } catch (err) {
          throw translateNetworkError(err, host, aborted)
        }
        if (!looksLikeCalendar(data)) throw FeedErrors.notACalendar()
        return data
      }
      await res.body?.cancel().catch(() => undefined)
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.get('location')
        let next: string | null = null
        try { next = location ? new URL(location, current).toString() : null } catch { next = null }
        if (redirects >= MAX_REDIRECTS || !next) throw FeedErrors.invalidURL(host)
        const verdict = await redirectVerdict(next, start, opts.resolver)
        if (verdict === 'invalid') throw FeedErrors.invalidURL(host)
        if (verdict === 'private') throw FeedErrors.privateRedirect(feedHost(next))
        redirects += 1
        current = next
        continue
      }
      if (status === 401 || status === 403) throw FeedErrors.private()
      if (status === 404 || status === 410) throw FeedErrors.notFound()
      if (status === 429) throw FeedErrors.rateLimited(retryAfterSeconds(res.headers.get('retry-after')))
      if (status >= 500 && status < 600) throw FeedErrors.server(status)
      throw FeedErrors.http(status)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** Descarga el calendario y devuelve sus eventos ordenados por fecha. */
export async function fetchICSFeed(url: string, opts: FeedFetchOptions = {}): Promise<StudyEvent[]> {
  const data = await fetchICSBytes(url, opts)
  return parseICS(data, { now: opts.now, timeZone: opts.timeZone })
}
