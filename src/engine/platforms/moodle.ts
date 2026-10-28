// Moodle con la sesión del estudiante (sin token): lectura de la clave de sesión (sesskey) de una página, llamadas a
// /lib/ajax/service.php y lectura tolerante de la página de un curso y del enlace de exportación del calendario. Puro.

function unescapeJSONString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return s.replace(/\\\//g, '/')
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d) || 0xfffd))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16) || 0xfffd))
}

const SESSKEY = /^[A-Za-z0-9]{6,32}$/

/** La sesskey de una página de Moodle (`M.cfg.sesskey`, un campo oculto o un enlace `…?sesskey=`); null si no hay. */
export function extractMoodleSesskey(html: string): string | null {
  const patterns = [
    /M\.cfg\s*=\s*\{[^]*?"sesskey"\s*:\s*"([^"]+)"/,
    /"sesskey"\s*:\s*"([^"]+)"/,
    /M\.cfg\.sesskey\s*=\s*["']([^"']+)["']/,
    /name=["']sesskey["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']sesskey["']/i,
    /[?&;]sesskey=([A-Za-z0-9]{6,32})/
  ]
  for (const re of patterns) {
    const m = re.exec(html.length > 2_000_000 ? html.slice(0, 2_000_000) : html)
    const v = m?.[1] ? unescapeJSONString(m[1]) : null
    if (v && SESSKEY.test(v)) return v
  }
  return null
}

export interface MoodlePageConfig {
  wwwroot: string | null
  sesskey: string | null
  /** Id del usuario si la página lo deja ver (enlace a su perfil o `data-userid`). */
  userId: number | null
  /** ¿La página es de alguien con la sesión iniciada? (enlace de salida con sesskey). */
  signedIn: boolean
}

export function extractMoodleConfig(html: string): MoodlePageConfig {
  const www = /"wwwroot"\s*:\s*"([^"]+)"/.exec(html)?.[1]
  const user = /data-userid=["'](\d+)["']/.exec(html)?.[1] ?? /\/user\/profile\.php\?id=(\d+)/.exec(html)?.[1] ?? /"userid"\s*:\s*(\d+)/i.exec(html)?.[1]
  return {
    wwwroot: www ? unescapeJSONString(www).replace(/\/+$/, '') : null,
    sesskey: extractMoodleSesskey(html),
    userId: user ? Number(user) : null,
    signedIn: /logout\.php\?sesskey=/.test(html) && !/\bnotloggedin\b/.test(html)
  }
}

// MARK: AJAX (/lib/ajax/service.php)

export interface MoodleAjaxCall {
  methodname: string
  args: Record<string, unknown>
}

/** Dirección y cuerpo de una llamada AJAX de Moodle (la misma que hace la propia página). */
export function moodleAjaxRequest(root: string, sesskey: string, calls: MoodleAjaxCall[]): { url: string; body: string } {
  const info = calls.map((c) => c.methodname).join(',')
  const url = `${root.replace(/\/+$/, '')}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(info)}`
  const body = JSON.stringify(calls.map((c, index) => ({ index, methodname: c.methodname, args: c.args })))
  return { url, body }
}

export type MoodleAjaxResult = { ok: true; data: unknown } | { ok: false; errorcode: string; message: string }

/** Respuesta de service.php: `[{error:false,data}]` o `{error:true,exception:{errorcode,message}}` (o `[{error:true,exception}]`). */
export function parseMoodleAjaxResponse(text: string, count = 1): MoodleAjaxResult[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return Array.from({ length: count }, () => ({ ok: false, errorcode: 'invalidresponse', message: 'Respuesta no válida' }))
  }
  const fail = (e: unknown): MoodleAjaxResult => {
    const ex = (e && typeof e === 'object' ? (e as Record<string, unknown>) : {})
    return { ok: false, errorcode: String(ex.errorcode ?? 'error'), message: String(ex.message ?? 'Error de Moodle') }
  }
  if (!Array.isArray(data)) {
    const o = (data && typeof data === 'object' ? (data as Record<string, unknown>) : {})
    const r = fail(o.exception ?? o)
    return Array.from({ length: count }, () => r)
  }
  return data.map((item) => {
    const o = (item && typeof item === 'object' ? (item as Record<string, unknown>) : {})
    return o.error === false || (o.error == null && 'data' in o) ? { ok: true, data: o.data } : fail(o.exception)
  })
}

/** ¿El error de AJAX es por la sesión (caducada o clave de sesión vieja)? */
export function isMoodleSessionError(errorcode: string): boolean {
  return ['servicerequireslogin', 'invalidsesskey', 'requireloginerror', 'sessiontimedout', 'notloggedin', 'invalidtoken'].includes(errorcode.toLowerCase())
}

// MARK: Página de un curso (cuando core_course_get_contents no está disponible por AJAX)

export interface MoodleActivity {
  id: number
  modname: string
  name: string
  url: string
}

export interface MoodleSection {
  name: string
  activities: MoodleActivity[]
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<span[^>]*class="[^"]*accesshide[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Secciones y actividades de `course/view.php` (enlaces `/mod/<tipo>/view.php?id=N` con su nombre), en orden. */
export function parseMoodleCoursePage(html: string, pageURL: string): MoodleSection[] {
  const sections: MoodleSection[] = []
  let current: MoodleSection = { name: '', activities: [] }
  sections.push(current)
  const seen = new Set<number>()
  // títulos de sección y enlaces de actividades en el orden del documento
  const re = /<(h[2-4])[^>]*class="[^"]*\bsectionname\b[^"]*"[^>]*>([\s\S]*?)<\/\1>|<a\b[^>]*href="([^"]*\/mod\/([a-z0-9_]+)\/view\.php\?id=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1]) {
      current = { name: stripTags(m[2]), activities: [] }
      sections.push(current)
      continue
    }
    const id = Number(m[5])
    if (!id || seen.has(id)) continue
    const name = stripTags(m[6])
    if (!name) continue
    seen.add(id)
    let url = decodeEntities(m[3])
    try {
      url = new URL(url, pageURL).toString()
    } catch { /* se queda */ }
    current.activities.push({ id, modname: m[4].toLowerCase(), name, url })
  }
  return sections.filter((s) => s.activities.length > 0 || s.name)
}

// MARK: Calendario

/** El enlace de exportación del calendario en la página de calendar/export.php (campo `#calendarexporturl` o un enlace). */
export function extractMoodleExportURL(html: string): string | null {
  const byId = /id=["']calendarexporturl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] ?? /value=["']([^"']+)["'][^>]*id=["']calendarexporturl["']/i.exec(html)?.[1]
  if (byId) return decodeEntities(byId)
  const any = /(https?:\/\/[^"'<>\s]+\/calendar\/export_execute\.php\?[^"'<>\s]*authtoken=[^"'<>\s]+)/i.exec(html)?.[1]
  return any ? decodeEntities(any) : null
}

/** ¿Es un enlace de exportación válido de ESTA plataforma (mismo sitio, con authtoken, «todos» o «de mis cursos»)? */
export function isValidMoodleExportURL(url: string, root: string): boolean {
  try {
    const u = new URL(url)
    const r = new URL(root)
    if (u.hostname.toLowerCase() !== r.hostname.toLowerCase()) return false
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && r.protocol === 'http:')) return false
    if (!u.pathname.endsWith('/calendar/export_execute.php')) return false
    if (!u.searchParams.get('authtoken')) return false
    return ['all', 'courses'].includes(u.searchParams.get('preset_what') ?? '')
  } catch {
    return false
  }
}

/** Enlace de exportación a partir del token de `core_calendar_get_calendar_export_token` (todos los eventos, recientes y próximos). */
export function moodleExportURLFromToken(root: string, userId: number, token: string): string {
  const base = root.replace(/\/+$/, '')
  return `${base}/calendar/export_execute.php?userid=${userId}&authtoken=${encodeURIComponent(token)}&preset_what=all&preset_time=recentupcoming`
}

/** Cuerpo del formulario de calendar/export.php que solo pide «Obtener la URL del calendario» (nunca exporta ni cambia nada). */
export function moodleExportFormBody(sesskey: string): string {
  const p = new URLSearchParams()
  p.set('sesskey', sesskey)
  p.set('_qf__core_calendar_export_form', '1')
  p.set('events[exportevents]', 'all')
  p.set('period[timeperiod]', 'recentupcoming')
  p.set('generateurl', 'Get calendar URL')
  return p.toString()
}
