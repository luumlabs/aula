// Cliente de la API REST de Canvas (solo lectura) SIN token: la API de Canvas acepta las cookies de la sesión del navegador en
// las peticiones GET, así que basta con que el estudiante haya iniciado sesión una vez en la ventana de Aula. Port de
// CanvasKit/REST/CanvasClient*.swift: paginación por `Link`, reintentos en 429/5xx, decodificación tolerante y errores claros.
// Modo token (opcional): el token viaja solo en `Authorization` y solo hacia el servidor de Canvas (nunca tras una redirección
// a otro dominio). Solo GET: este cliente nunca cambia nada en Canvas.
import { hostMatches, isLoginURL, stripJSONGuard } from '@engine/platforms'
import { tr } from '@shared/ai/i18n'
import type { HttpFetch, HttpResponse } from '../platforms/http'
import { HttpError, isRedirect, nextHop } from '../platforms/http'
import { CanvasError, errorForStatus } from './errors'
import {
  decodeAnnouncement, decodeAssignment, decodeCalendarEvent, decodeCourse, decodeFile, decodeModule, decodeModuleItem, decodePage,
  decodePageInfo, decodePlannerItem, decodeProfile, decodeQuiz, profileCalendarFeed,
  type CanvasAnnouncement, type CanvasAssignment, type CanvasCalendarEvent, type CanvasCourse, type CanvasFile, type CanvasModule,
  type CanvasModuleItem, type CanvasPage, type CanvasPageInfo, type CanvasPlannerItem, type CanvasProfile, type CanvasQuiz
} from './models'
import { htmlToMarkdown } from './text/markdown'

export interface CanvasClientOptions {
  /** Dirección de Canvas (se usa su origen). */
  baseURL: string
  /** `fetch` con la sesión de la cuenta (o el de Node en modo token). Inyectable para las pruebas. */
  fetch: HttpFetch
  /** Token personal (modo token, opcional). Sin token se usa la sesión. */
  token?: string | null
  maxPages?: number
  perPage?: number
  maxRetries?: number
  baseRetryDelayMs?: number
  maxRetryDelayMs?: number
  maxConcurrent?: number
  maxResponseBytes?: number
  maxDownloadBytes?: number
  timeoutMs?: number
  /** Espera (inyectable para las pruebas). */
  sleep?: (ms: number) => Promise<void>
  /** Aviso de lo que se omitió (bitácora técnica; sin datos del estudiante). */
  onWarning?: (message: string) => void
}

type Query = [string, string][]

/** Enlaces de `Link: <…>; rel="next", <…>; rel="last"`. */
export function parseLinkHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(/,(?=\s*<)/)) {
    const m = /<([^>]+)>\s*;(.*)/.exec(part.trim())
    if (!m) continue
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(m[2])?.[1]
    if (rel) for (const r of rel.trim().split(/\s+/)) out[r.toLowerCase()] = m[1]
  }
  return out
}

/** `semana-1`, `page_id:7`, `https://x/courses/1/pages/semana-1?module_item_id=3` → identificador de la página. */
export function pageSlug(input: string): string {
  let s = input.trim()
  const q = s.search(/[?#]/)
  if (q >= 0) s = s.slice(0, q)
  const i = s.indexOf('/pages/')
  if (i >= 0) s = s.slice(i + '/pages/'.length)
  if (!s.startsWith('page_id:')) {
    const slash = s.lastIndexOf('/')
    if (slash >= 0) s = s.slice(slash + 1)
  }
  try {
    s = decodeURIComponent(s)
  } catch { /* se queda */ }
  return s.trim()
}

/** ¿Es un enlace de calendario privado válido de este Canvas (`/feeds/calendars/….ics`, mismo sitio o *.instructure.com)? */
export function isValidCanvasFeedURL(url: string, baseURL: string): boolean {
  try {
    const u = new URL(url.replace(/^webcal:/i, 'https:'))
    const base = new URL(baseURL)
    if (u.protocol !== 'https:') return false
    const sameSite = u.hostname.toLowerCase() === base.hostname.toLowerCase() || hostMatches(u.hostname, '*.instructure.com')
    return sameSite && /^\/feeds\/calendars\/[^/]+\.ics$/i.test(u.pathname)
  } catch {
    return false
  }
}

/** Solo las opciones con valor (un `undefined` no pisa el valor por defecto). */
function definedOnly<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

class Gate {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

export class CanvasClient {
  readonly origin: string
  readonly tokenMode: boolean
  private readonly host: string
  private readonly gate: Gate
  private pauseUntil = 0
  private readonly opts: Required<Omit<CanvasClientOptions, 'token' | 'onWarning'>> & Pick<CanvasClientOptions, 'token' | 'onWarning'>

  constructor(options: CanvasClientOptions) {
    let u: URL
    try {
      u = new URL(options.baseURL)
    } catch {
      throw new CanvasError('invalid_args', tr('La dirección de Canvas no es válida.', 'That Canvas address isn’t valid.'))
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) {
      throw new CanvasError('invalid_args', tr('Por seguridad solo se aceptan direcciones https://.', 'For security, only https:// addresses are accepted.'))
    }
    this.origin = u.origin
    this.host = u.hostname.toLowerCase()
    this.tokenMode = !!options.token
    this.opts = {
      maxPages: 50, perPage: 100, maxRetries: 3, baseRetryDelayMs: 1000, maxRetryDelayMs: 30_000, maxConcurrent: 2,
      maxResponseBytes: 64 * 1024 * 1024, maxDownloadBytes: 200 * 1024 * 1024, timeoutMs: 30_000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...definedOnly(options)
    }
    this.gate = new Gate(this.opts.maxConcurrent)
  }

  // MARK: Peticiones

  apiURL(path: string, query: Query = []): string {
    const u = new URL(`${this.origin}/api/v1/${path.replace(/^\/+/, '')}`)
    for (const [k, v] of query) u.searchParams.append(k, v)
    return u.toString()
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json+canvas-string-ids, application/json;q=0.9' }
    if (this.opts.token) h.Authorization = `Bearer ${this.opts.token}`
    return h
  }

  private backoff(attempt: number, retryAfter: number | null): number {
    if (retryAfter != null && retryAfter > 0) return Math.min(retryAfter * 1000, this.opts.maxRetryDelayMs)
    return Math.min(this.opts.baseRetryDelayMs * 2 ** Math.max(0, attempt - 1), this.opts.maxRetryDelayMs)
  }

  /** Una petición GET a la API: reintentos, tope de concurrencia, redirecciones solo dentro de Canvas y errores claros. */
  async getJSON(url: string): Promise<{ data: unknown; res: HttpResponse }> {
    let current = url
    let redirects = 0
    let attempt = 0
    for (;;) {
      const wait = this.pauseUntil - Date.now()
      if (wait > 0) await this.opts.sleep(wait)
      let res: HttpResponse
      try {
        res = await this.gate.run(() => this.opts.fetch(current, {
          method: 'GET', headers: this.headers(), redirect: 'manual', maxBytes: this.opts.maxResponseBytes, timeoutMs: this.opts.timeoutMs
        }))
      } catch (err) {
        if (err instanceof HttpError && (err.code === 'timeout' || err.code === 'network') && attempt < Math.min(2, this.opts.maxRetries)) {
          attempt++
          await this.opts.sleep(this.backoff(attempt, null))
          continue
        }
        if (err instanceof HttpError) {
          if (err.code === 'too_large') throw new CanvasError('too_large', tr('La respuesta de Canvas es demasiado grande.', 'The response from Canvas is too large.'))
          if (err.code === 'cancelled') throw err
          throw new CanvasError('network', err.code === 'timeout' ? tr('Canvas tardó demasiado en responder.', 'Canvas took too long to respond.') : tr('No hay conexión con Canvas. Revisa tu red.', 'Can’t reach Canvas. Check your network.'))
        }
        throw err
      }
      const remaining = Number(res.headers.get('x-rate-limit-remaining') ?? 'NaN')
      if (Number.isFinite(remaining) && remaining < 50) this.pauseUntil = Date.now() + 1000
      const status = res.status
      if (status >= 200 && status < 300) {
        const body = res.text()
        const ct = res.headers.get('content-type') ?? ''
        if (/text\/html/i.test(ct) || /^\s*<(!doctype|html)/i.test(body)) {
          // una página web en vez de JSON: sin sesión (página de acceso) o no es un Canvas
          if (!this.tokenMode && (isLoginURL(res.url, 'canvas') || /type=["']?password|ic-Login|login_form/i.test(body))) {
            throw new CanvasError('needs_sign_in', tr('Tu sesión de Canvas se cerró: inicia sesión de nuevo.', 'Your Canvas session ended: sign in again.'))
          }
          throw new CanvasError('not_canvas', tr('Esa dirección no parece un Canvas (devolvió una página web en vez de datos).', 'That address doesn’t look like Canvas (it returned a web page instead of data).'))
        }
        if (!body.trim()) return { data: null, res }
        try {
          return { data: JSON.parse(stripJSONGuard(body)), res }
        } catch {
          throw new CanvasError('canvas_unexpected', tr('Canvas devolvió una respuesta que no se pudo interpretar.', 'Canvas sent a response that couldn’t be read.'))
        }
      }
      if (isRedirect(status)) {
        const next = nextHop(current, res.headers.get('location'))
        if (!next || redirects >= 5) throw new CanvasError('canvas_unexpected', tr('Canvas devolvió una redirección no válida.', 'Canvas sent an invalid redirect.'))
        const nextHost = new URL(next).hostname.toLowerCase()
        // fuera de Canvas casi siempre es el SSO de la institución: sin sesión (y el token nunca sale del servidor)
        if (nextHost !== this.host || isLoginURL(next, 'canvas')) {
          throw this.tokenMode
            ? new CanvasError('canvas_token_invalid', tr('Canvas pidió iniciar sesión con el token: revisa el token o usa la sesión.', 'Canvas asked to sign in with the token: check the token or use your session.'))
            : new CanvasError('needs_sign_in', tr('Tu sesión de Canvas se cerró: inicia sesión de nuevo.', 'Your Canvas session ended: sign in again.'))
        }
        redirects++
        current = next
        continue
      }
      const body = res.text()
      const retryAfter = Number(res.headers.get('retry-after') ?? 'NaN')
      const ra = Number.isFinite(retryAfter) ? retryAfter : null
      const rateLimited = status === 429 || (status === 403 && /rate limit/i.test(body.slice(0, 512)))
      if (rateLimited) {
        if (attempt < this.opts.maxRetries && (ra ?? 0) * 1000 <= this.opts.maxRetryDelayMs) {
          attempt++
          await this.opts.sleep(this.backoff(attempt, ra))
          continue
        }
        throw new CanvasError('rate_limited', tr('Canvas está limitando las peticiones (demasiadas en poco tiempo). Espera un minuto e inténtalo de nuevo.', 'Canvas is limiting requests (too many in a short time). Wait a minute and try again.'), { retryAfter: ra })
      }
      if ([500, 502, 503, 504].includes(status) && attempt < this.opts.maxRetries) {
        attempt++
        await this.opts.sleep(this.backoff(attempt, ra))
        continue
      }
      throw errorForStatus(status, body, this.tokenMode)
    }
  }

  /** Siguiente página (`Link: rel="next"`): solo del mismo servidor; `http://` del mismo host se sube a https. */
  private nextPage(current: string, res: HttpResponse): string | null {
    const raw = parseLinkHeader(res.headers.get('link')).next
    if (!raw) return null
    let next: URL
    try {
      next = new URL(raw, current)
    } catch {
      return null
    }
    if (next.hostname.toLowerCase() !== this.host) {
      this.opts.onWarning?.('CanvasKit: se ignoró un enlace de paginación hacia otro servidor')
      return null
    }
    if (next.protocol === 'http:' && this.origin.startsWith('https:')) {
      next.protocol = 'https:'
      if (next.port === '80') next.port = ''
    }
    return next.toString()
  }

  /** Recorre todas las páginas de una lista (tope `maxPages`), saltando los elementos defectuosos. */
  async paged<T>(path: string, query: Query, decode: (v: unknown) => T | null): Promise<T[]> {
    const q: Query = query.some(([k]) => k === 'per_page') ? query : [...query, ['per_page', String(this.opts.perPage)]]
    let url: string | null = this.apiURL(path, q)
    const visited = new Set<string>()
    const out: T[] = []
    let pages = 0
    let skipped = 0
    while (url && !visited.has(url)) {
      visited.add(url)
      const { data, res } = await this.getJSON(url)
      pages++
      if (data != null && !Array.isArray(data)) {
        const msg = data && typeof data === 'object' ? (data as Record<string, unknown>).message : undefined
        throw new CanvasError('canvas_unexpected', typeof msg === 'string' ? `${tr('Canvas respondió', 'Canvas answered')}: ${msg.slice(0, 200)}` : tr('Canvas no devolvió una lista.', 'Canvas didn’t return a list.'))
      }
      for (const item of (data as unknown[] | null) ?? []) {
        const v = decode(item)
        if (v == null) skipped++
        else out.push(v)
      }
      if (pages >= this.opts.maxPages) {
        this.opts.onWarning?.(`CanvasKit: tope de ${this.opts.maxPages} páginas en ${path}`)
        break
      }
      url = this.nextPage(url, res)
    }
    if (skipped) this.opts.onWarning?.(`CanvasKit: se omitieron ${skipped} elemento(s) defectuoso(s) en ${path}`)
    return out
  }

  private async object<T>(path: string, query: Query, decode: (v: unknown) => T | null, what: string): Promise<T> {
    const { data } = await this.getJSON(this.apiURL(path, query))
    const v = decode(data)
    if (v == null) throw new CanvasError('canvas_unexpected', tr(`Canvas devolvió una respuesta que no se pudo interpretar (${what}).`, `Canvas sent a response that couldn’t be read (${what}).`))
    return v
  }

  private seg(v: string | number): string {
    const s = String(v)
    if (!/^[A-Za-z0-9_:.~-]{1,200}$/.test(s)) throw new CanvasError('invalid_args', tr('Identificador no válido.', 'Invalid identifier.'))
    return encodeURIComponent(s)
  }

  // MARK: Perfil

  /** Perfil del estudiante (sin el enlace privado del calendario). También sirve de «¿hay sesión?». */
  profile(): Promise<CanvasProfile> {
    return this.object('users/self/profile', [], decodeProfile, tr('perfil', 'profile'))
  }

  /** Enlace privado del calendario (.ics) del perfil, validado. Es un secreto: guárdalo en el almacén cifrado. */
  async calendarFeedURL(): Promise<string | null> {
    const { data } = await this.getJSON(this.apiURL('users/self/profile'))
    const feed = profileCalendarFeed(data)
    if (!feed) return null
    const url = feed.replace(/^webcal:/i, 'https:')
    return isValidCanvasFeedURL(url, this.origin) ? url : null
  }

  // MARK: Cursos

  /** Cursos con inscripción activa (con su periodo), sin los inaccesibles por fechas ni los borrados. */
  async courses(opts: { includeCompleted?: boolean } = {}): Promise<CanvasCourse[]> {
    const q: Query = [['include[]', 'term']]
    if (!opts.includeCompleted) q.push(['enrollment_state', 'active'])
    const list = await this.paged('courses', q, (v) => decodeCourse(v, this.origin))
    return list.filter((c) => !c.accessRestrictedByDate && (c.workflowState ?? '').toLowerCase() !== 'deleted')
  }

  course(courseId: string): Promise<CanvasCourse> {
    return this.object(`courses/${this.seg(courseId)}`, [['include[]', 'term']], (v) => decodeCourse(v, this.origin), tr('curso', 'course'))
  }

  /** Sílabo del curso en Markdown (vacío si no hay). */
  async syllabus(courseId: string): Promise<{ courseId: string; courseName: string; markdown: string }> {
    const { data } = await this.getJSON(this.apiURL(`courses/${this.seg(courseId)}`, [['include[]', 'syllabus_body']]))
    const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    const html = typeof o.syllabus_body === 'string' ? o.syllabus_body : ''
    return { courseId, courseName: typeof o.name === 'string' ? o.name : '', markdown: htmlToMarkdown(html, this.origin) }
  }

  // MARK: Módulos y páginas

  /** Módulos con sus elementos, en el orden del curso (los de módulos grandes se piden aparte). */
  async modules(courseId: string): Promise<CanvasModule[]> {
    const cid = this.seg(courseId)
    const list = await this.paged(`courses/${cid}/modules`, [['include[]', 'items'], ['include[]', 'content_details']], decodeModule)
    for (const m of list) {
      if (m.items.length === 0 && (m.itemsCount ?? 0) > 0) {
        try {
          m.items = await this.moduleItems(courseId, m.id)
        } catch (err) {
          // un módulo cuyos elementos no se pueden leer (permisos, bloqueado) no debe ocultar los demás
          if (err instanceof CanvasError && (err.code === 'needs_sign_in' || err.code === 'canvas_token_invalid' || err.code === 'network')) throw err
          this.opts.onWarning?.('CanvasKit: no se pudieron leer los elementos de un módulo')
        }
      }
      for (const it of m.items) if (!it.moduleId) it.moduleId = m.id
      m.items.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
    }
    return list.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
  }

  moduleItems(courseId: string, moduleId: string): Promise<CanvasModuleItem[]> {
    return this.paged(`courses/${this.seg(courseId)}/modules/${this.seg(moduleId)}/items`, [['include[]', 'content_details']], decodeModuleItem)
  }

  pages(courseId: string): Promise<CanvasPageInfo[]> {
    return this.paged(`courses/${this.seg(courseId)}/pages`, [['sort', 'title']], decodePageInfo)
  }

  /** Una página con su contenido en Markdown. Acepta el slug, `page_id:7` o la dirección completa. */
  page(courseId: string, urlOrSlug: string): Promise<CanvasPage> {
    const slug = pageSlug(urlOrSlug)
    if (!slug) throw new CanvasError('invalid_args', tr('Falta el identificador de la página.', 'The page identifier is missing.'))
    return this.object(`courses/${this.seg(courseId)}/pages/${encodeURIComponent(slug)}`, [], (v) => decodePage(v, this.origin), tr('página', 'page'))
  }

  frontPage(courseId: string): Promise<CanvasPage> {
    return this.object(`courses/${this.seg(courseId)}/front_page`, [], (v) => decodePage(v, this.origin), tr('página principal', 'front page'))
  }

  // MARK: Archivos

  files(courseId: string): Promise<CanvasFile[]> {
    return this.paged(`courses/${this.seg(courseId)}/files`, [['sort', 'name']], decodeFile)
  }

  file(fileId: string): Promise<CanvasFile> {
    return this.object(`files/${this.seg(fileId)}`, [], decodeFile, tr('archivo', 'file'))
  }

  /** Dirección de descarga con la sesión (`/files/<id>/download?download_frd=1`, o la firmada que da Canvas). */
  fileDownloadURL(file: Pick<CanvasFile, 'id' | 'url'>): string {
    if (file.url) {
      try {
        const u = new URL(file.url)
        if (u.protocol === 'https:' && u.hostname.toLowerCase() === this.host) return u.toString()
      } catch { /* sigue */ }
    }
    return `${this.origin}/files/${this.seg(file.id)}/download?download_frd=1`
  }

  /**
   * Descarga un archivo a memoria (pensado para el modo token y las pruebas; con la sesión es mejor PlatformBrowser.download,
   * que guarda a disco con las reglas de seguridad). La redirección al almacenamiento externo se sigue SIN el token.
   */
  async downloadFile(file: Pick<CanvasFile, 'id' | 'url' | 'displayName' | 'contentType'>, maxBytes = this.opts.maxDownloadBytes): Promise<{ bytes: Uint8Array; filename: string; contentType: string | null }> {
    let current = this.fileDownloadURL(file)
    let withToken = true
    for (let hop = 0; hop < 6; hop++) {
      const headers: Record<string, string> = {}
      if (withToken && this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`
      let res: HttpResponse
      try {
        res = await this.opts.fetch(current, { method: 'GET', headers, redirect: 'manual', maxBytes, timeoutMs: 180_000 })
      } catch (err) {
        if (err instanceof HttpError && err.code === 'too_large') throw new CanvasError('too_large', tr('El archivo es demasiado grande.', 'The file is too large.'))
        throw new CanvasError('network', tr('No se pudo descargar el archivo de Canvas.', 'Couldn’t download the file from Canvas.'))
      }
      if (isRedirect(res.status)) {
        const next = nextHop(current, res.headers.get('location'))
        if (!next) break
        if (isLoginURL(next, 'canvas')) throw new CanvasError('needs_sign_in', tr('Tu sesión de Canvas se cerró: inicia sesión de nuevo.', 'Your Canvas session ended: sign in again.'))
        if (new URL(next).hostname.toLowerCase() !== this.host) withToken = false
        current = next
        continue
      }
      if (res.status >= 400) throw errorForStatus(res.status, res.text(), this.tokenMode)
      const ct = res.headers.get('content-type')
      if (ct && /text\/html/i.test(ct) && !/\.html?$/i.test(file.displayName)) {
        throw new CanvasError('needs_sign_in', tr('Llegó una página web en vez del archivo: probablemente hay que iniciar sesión.', 'A web page arrived instead of the file: you probably need to sign in.'))
      }
      return { bytes: res.body, filename: file.displayName, contentType: ct ?? file.contentType ?? null }
    }
    throw new CanvasError('canvas_unexpected', tr('Canvas devolvió demasiadas redirecciones al descargar.', 'Canvas sent too many redirects while downloading.'))
  }

  // MARK: Tareas y cuestionarios (solo información)

  async assignments(courseId: string): Promise<CanvasAssignment[]> {
    const list = await this.paged(`courses/${this.seg(courseId)}/assignments`, [['include[]', 'submission'], ['order_by', 'due_at']], (v) => decodeAssignment(v, this.origin))
    for (const a of list) if (!a.courseId) a.courseId = courseId
    return list.sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt === b.dueAt ? a.name.localeCompare(b.name) : a.dueAt < b.dueAt ? -1 : 1
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return a.name.localeCompare(b.name)
    })
  }

  /** Cuestionarios clásicos (solo sus datos: nunca se abren). Los «New Quizzes» salen en `assignments` con `isQuizLTI`. */
  quizzes(courseId: string): Promise<CanvasQuiz[]> {
    return this.paged(`courses/${this.seg(courseId)}/quizzes`, [], (v) => decodeQuiz(v, this.origin))
  }

  // MARK: Anuncios y calendario

  /** Anuncios de varios cursos de los últimos `days` días, del más reciente al más antiguo. */
  async announcements(courseIds: string[], opts: { days?: number; now?: Date } = {}): Promise<CanvasAnnouncement[]> {
    const ids = [...new Set(courseIds)].map((c) => this.seg(c))
    if (!ids.length) return []
    const now = opts.now ?? new Date()
    const span = Math.max(1, Math.min(opts.days ?? 30, 365))
    const start = new Date(now.getTime() - span * 86_400_000).toISOString()
    const end = new Date(now.getTime() + 86_400_000).toISOString()
    const seen = new Set<string>()
    const all: CanvasAnnouncement[] = []
    for (let i = 0; i < ids.length; i += 10) {
      const q: Query = ids.slice(i, i + 10).map((c) => ['context_codes[]', `course_${c}`] as [string, string])
      q.push(['start_date', start], ['end_date', end], ['active_only', 'true'])
      for (const a of await this.paged('announcements', q, (v) => decodeAnnouncement(v, this.origin))) {
        if (seen.has(a.id)) continue
        seen.add(a.id)
        all.push(a)
      }
    }
    return all.sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  }

  /** Eventos y tareas del calendario entre dos fechas (de los cursos dados o de todos los del estudiante). */
  async calendarEvents(opts: { start: Date; end: Date; courseIds?: string[]; types?: ('event' | 'assignment')[] }): Promise<CanvasCalendarEvent[]> {
    const contexts = (opts.courseIds ?? []).map((c) => `course_${this.seg(c)}`)
    const chunks: string[][] = []
    for (let i = 0; i < contexts.length; i += 10) chunks.push(contexts.slice(i, i + 10))
    if (!chunks.length) chunks.push([])
    const out = new Map<string, CanvasCalendarEvent>()
    for (const type of opts.types ?? ['event', 'assignment']) {
      for (const chunk of chunks) {
        const q: Query = [['type', type], ['start_date', opts.start.toISOString()], ['end_date', opts.end.toISOString()]]
        for (const c of chunk) q.push(['context_codes[]', c])
        for (const e of await this.paged('calendar_events', q, (v) => decodeCalendarEvent(v, this.origin))) out.set(e.id, e)
      }
    }
    return [...out.values()].sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
  }

  /** Próximas fechas del planificador (hoy → hoy + `days`), sin lo ya entregado o marcado como hecho. */
  async upcoming(opts: { days?: number; now?: Date } = {}): Promise<CanvasPlannerItem[]> {
    const now = opts.now ?? new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const days = Math.max(1, Math.min(opts.days ?? 30, 365))
    // días civiles (setDate), no bloques de 24 h: con el cambio de hora el último día perdía o ganaba una hora
    const end = new Date(start)
    end.setDate(end.getDate() + days + 1)
    end.setTime(end.getTime() - 1000)
    let items: CanvasPlannerItem[]
    try {
      items = await this.paged('planner/items', [['start_date', start.toISOString()], ['end_date', end.toISOString()]], (v) => decodePlannerItem(v, this.origin))
    } catch (err) {
      if (!(err instanceof CanvasError) || !['forbidden', 'not_found'].includes(err.code)) throw err
      // sin planificador (no es estudiante o está desactivado): los próximos eventos del usuario
      const events = await this.paged('users/self/upcoming_events', [], (v) => decodeCalendarEvent(v, this.origin))
      items = events.map((e) => ({
        plannableId: e.id, plannableType: e.type === 'assignment' ? 'assignment' : 'calendar_event', title: e.title,
        ...(e.startAt ? { date: e.startAt } : {}), ...(e.courseId ? { courseId: e.courseId } : {}), ...(e.htmlURL ? { htmlURL: e.htmlURL } : {}),
        completed: false, submitted: false
      }))
    }
    return items
      .filter((i) => !i.completed && !i.submitted)
      .filter((i) => !i.date || (i.date >= start.toISOString() && i.date <= end.toISOString()))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  }
}
