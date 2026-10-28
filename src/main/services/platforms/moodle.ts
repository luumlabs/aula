// Moodle con la sesión del estudiante (sin token): la sesskey se lee de una página (M.cfg.sesskey) y se llama a
// /lib/ajax/service.php como hace la propia página. Solo funciones de lectura; todo con red de seguridad (si una función no
// está disponible por AJAX se lee la página del curso). Mejor esfuerzo: los Moodle varían mucho entre versiones.
import {
  classifyAuthPage, extractMoodleConfig, extractMoodleExportURL, isMoodleSessionError, isValidMoodleExportURL, joinRoot, moodleAjaxRequest,
  moodleExportFormBody, moodleExportURLFromToken, parseMoodleAjaxResponse, parseMoodleCoursePage, platformRoot, type MoodleSection
} from '@engine/platforms'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'
import type { HttpFetch, HttpResponse } from './http'
import { cachedMoodleSesskey, rememberMoodleSesskey } from './session-check'

/** Solo funciones de lectura: nunca se llama a otra cosa desde aquí. */
const READ_FUNCTIONS = new Set([
  'core_course_get_enrolled_courses_by_timeline_classification', 'core_course_get_contents', 'core_calendar_get_calendar_export_token',
  'core_session_touch', 'core_session_time_remaining', 'core_calendar_get_action_events_by_timesort', 'core_course_get_recent_courses'
])

export interface MoodleCourse {
  id: number
  fullname: string
  shortname?: string
  category?: string
  url: string
}

export class MoodleClient {
  readonly root: string
  private sesskeyValue: string | null
  private userId: number | null = null

  constructor(private readonly opts: { baseURL: string; fetch: HttpFetch; accountId?: string }) {
    this.root = platformRoot('moodle', opts.baseURL)
    this.sesskeyValue = opts.accountId ? cachedMoodleSesskey(opts.accountId) : null
  }

  private needsSignIn(): AulaError {
    return new AulaError('needs_sign_in', tr('Tu sesión de Moodle se cerró: inicia sesión de nuevo.', 'Your Moodle session ended: sign in again.'))
  }

  private async page(path: string): Promise<{ res: HttpResponse; html: string }> {
    const res = await this.opts.fetch(joinRoot(this.root, path), { headers: { Accept: 'text/html' }, maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 })
    const html = res.text()
    const account = { kind: 'moodle' as const, baseURL: this.root + '/' }
    const auth = classifyAuthPage({ url: res.url, account, html, hasPasswordField: /<input[^>]+type=["']?password/i.test(html) })
    if (res.status === 401 || auth === 'login' || auth === 'sso') throw this.needsSignIn()
    if (res.status >= 400) throw new AulaError('moodle_error', tr(`Moodle respondió con el error ${res.status}.`, `Moodle answered with error ${res.status}.`))
    return { res, html }
  }

  /** La sesskey de la sesión (de la caché o de la página «Área personal»). */
  async sesskey(force = false): Promise<string> {
    if (this.sesskeyValue && !force) return this.sesskeyValue
    const { html } = await this.page('/my/')
    const cfg = extractMoodleConfig(html)
    if (!cfg.sesskey) throw new AulaError('moodle_error', tr('No encuentro la clave de sesión de Moodle en la página.', 'I can’t find the Moodle session key on the page.'))
    this.sesskeyValue = cfg.sesskey
    if (cfg.userId) this.userId = cfg.userId
    if (this.opts.accountId) rememberMoodleSesskey(this.opts.accountId, cfg.sesskey)
    return cfg.sesskey
  }

  /** Una llamada AJAX de lectura; reintenta una vez con una sesskey nueva si la vieja caducó. */
  async ajax<T = unknown>(methodname: string, args: Record<string, unknown>): Promise<T> {
    if (!READ_FUNCTIONS.has(methodname)) throw new AulaError('forbidden', `${tr('Función de Moodle no permitida', 'Moodle function not allowed')}: ${methodname}`)
    for (let attempt = 0; attempt < 2; attempt++) {
      const sesskey = await this.sesskey(attempt > 0)
      const { url, body } = moodleAjaxRequest(this.root, sesskey, [{ methodname, args }])
      const res = await this.opts.fetch(url, {
        method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        redirect: 'manual', maxBytes: 32 * 1024 * 1024, timeoutMs: 30_000
      })
      if (res.status >= 300 && res.status < 400) throw this.needsSignIn()
      if (res.status !== 200) throw new AulaError('moodle_error', tr(`Moodle respondió con el error ${res.status}.`, `Moodle answered with error ${res.status}.`))
      const [r] = parseMoodleAjaxResponse(res.text())
      if (r?.ok) return r.data as T
      if (r && isMoodleSessionError(r.errorcode)) {
        this.sesskeyValue = null
        if (attempt === 0) continue
        throw this.needsSignIn()
      }
      throw new AulaError('moodle_unavailable', tr(`Moodle no permite esa consulta (${r?.errorcode ?? 'error'}).`, `Moodle doesn’t allow that request (${r?.errorcode ?? 'error'}).`), { errorcode: r?.errorcode })
    }
    throw this.needsSignIn()
  }

  /** Cursos en los que está inscrito el estudiante (los de «Mis cursos»). */
  async enrolledCourses(): Promise<MoodleCourse[]> {
    const data = await this.ajax<{ courses?: unknown[] }>('core_course_get_enrolled_courses_by_timeline_classification', {
      offset: 0, limit: 0, classification: 'all', sort: 'fullname', customfieldname: '', customfieldvalue: ''
    })
    const out: MoodleCourse[] = []
    for (const raw of Array.isArray(data?.courses) ? data.courses : []) {
      if (!raw || typeof raw !== 'object') continue
      const c = raw as Record<string, unknown>
      const id = Number(c.id)
      if (!Number.isFinite(id) || id <= 0) continue
      const fullname = cleanText(c.fullnamedisplay ?? c.fullname) || `Curso ${id}`
      out.push({
        id, fullname,
        ...(typeof c.shortname === 'string' && c.shortname ? { shortname: cleanText(c.shortname) } : {}),
        ...(typeof c.coursecategory === 'string' && c.coursecategory ? { category: cleanText(c.coursecategory) } : {}),
        url: typeof c.viewurl === 'string' && c.viewurl.startsWith('http') ? c.viewurl : joinRoot(this.root, `/course/view.php?id=${id}`)
      })
    }
    return out
  }

  /** Secciones y actividades de un curso (AJAX; si no está disponible, la página del curso). */
  async courseContents(courseId: number): Promise<MoodleSection[]> {
    if (!Number.isInteger(courseId) || courseId <= 0) throw new AulaError('invalid_args', tr('Curso no válido', 'Invalid course'))
    try {
      const data = await this.ajax<unknown[]>('core_course_get_contents', { courseid: courseId, options: [] })
      const sections = mapContents(data)
      if (sections.length) return sections
    } catch (err) {
      if (err instanceof AulaError && err.code === 'needs_sign_in') throw err
      // sigue con la página
    }
    const { res, html } = await this.page(`/course/view.php?id=${courseId}`)
    return parseMoodleCoursePage(html, res.url)
  }

  /**
   * Enlace privado del calendario (.ics) de todos los eventos, recientes y próximos. Primero con el token de exportación (AJAX);
   * si no, pidiendo solo «Obtener la URL del calendario» en calendar/export.php. Siempre se valida antes de devolverlo.
   */
  async calendarExportURL(): Promise<string> {
    try {
      const data = await this.ajax<{ token?: string }>('core_calendar_get_calendar_export_token', {})
      if (!this.userId) await this.sesskey(true)
      if (data?.token && this.userId) {
        const url = moodleExportURLFromToken(this.root, this.userId, data.token)
        if (isValidMoodleExportURL(url, this.root)) return url
      }
    } catch (err) {
      if (err instanceof AulaError && err.code === 'needs_sign_in') throw err
    }
    const { html } = await this.page('/calendar/export.php')
    const cfg = extractMoodleConfig(html)
    if (!cfg.sesskey) throw new AulaError('moodle_error', tr('No encuentro el formulario de exportación del calendario.', 'I can’t find the calendar export form.'))
    const res = await this.opts.fetch(joinRoot(this.root, '/calendar/export.php'), {
      method: 'POST', body: moodleExportFormBody(cfg.sesskey), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      maxBytes: 4 * 1024 * 1024, timeoutMs: 30_000
    })
    const url = extractMoodleExportURL(res.text())
    if (!url || !isValidMoodleExportURL(url, this.root)) throw new AulaError('moodle_error', tr('Moodle no dio un enlace de calendario válido.', 'Moodle didn’t provide a valid calendar link.'))
    return url
  }
}

function cleanText(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/** core_course_get_contents → secciones con sus actividades (lectura tolerante). */
export function mapContents(data: unknown): MoodleSection[] {
  if (!Array.isArray(data)) return []
  const out: MoodleSection[] = []
  for (const s of data) {
    if (!s || typeof s !== 'object') continue
    const sec = s as Record<string, unknown>
    const activities = []
    for (const m of Array.isArray(sec.modules) ? sec.modules : []) {
      if (!m || typeof m !== 'object') continue
      const mod = m as Record<string, unknown>
      const id = Number(mod.id)
      const url = typeof mod.url === 'string' ? mod.url : ''
      if (!Number.isFinite(id) || !url) continue
      if (mod.uservisible === false) continue
      activities.push({ id, modname: String(mod.modname ?? ''), name: cleanText(mod.name) || `Actividad ${id}`, url })
    }
    out.push({ name: cleanText(sec.name), activities })
  }
  return out.filter((s) => s.activities.length > 0 || s.name)
}
