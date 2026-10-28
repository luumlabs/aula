// Cookies de sesión que sobreviven al reinicio (la queja nº 1: «me hace iniciar sesión una y otra vez»).
// Muchas plataformas y SSO usan cookies de sesión (sin caducidad) que Chromium tira al cerrarse. Aula guarda una copia cifrada
// (secrets) al salir, cada pocos minutos y tras iniciar sesión, y al arrancar repone las que falten dándoles una caducidad.
// Aquí solo está la transformación (pura y probada): qué se guarda, con qué caducidad y cómo se pasa a `cookies.set`.
// NUNCA se registran los valores: `describeSnapshot` solo cuenta.

/** Lo que devuelve `session.cookies.get` (forma de Electron.Cookie). */
export interface CookieLike {
  name: string
  value: string
  domain?: string
  hostOnly?: boolean
  path?: string
  secure?: boolean
  httpOnly?: boolean
  session?: boolean
  /** Segundos desde la época Unix. */
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

/** Cookie guardada (formato estable del almacén). */
export interface SavedCookie {
  name: string
  value: string
  /** Dominio sin el punto inicial. */
  domain: string
  hostOnly: boolean
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  /** true = cookie de sesión del servidor (sin caducidad). */
  session: boolean
  /** Caducidad del servidor (segundos), si la tenía. */
  expirationDate?: number
}

export interface CookieSnapshot {
  v: 1
  /** Milisegundos desde la época Unix. */
  savedAt: number
  cookies: SavedCookie[]
}

/** Lo que espera `session.cookies.set` (forma de Electron.CookiesSetDetails). */
export interface CookieSetDetails {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export interface SnapshotOptions {
  /** Tope de cookies por cuenta (las del sitio de la plataforma y de los SSO van primero). */
  maxCookies?: number
  /** Tope del valor de una cookie (bytes). */
  maxValueBytes?: number
  /** Hosts prioritarios (plataforma y SSO conocidos). */
  priorityHosts?: string[]
}

const DEFAULT_MAX_COOKIES = 800
const DEFAULT_MAX_VALUE = 8192

export function cookieDomain(c: Pick<CookieLike, 'domain'>): string {
  return (c.domain ?? '').trim().toLowerCase().replace(/^\.+/, '')
}

function domainMatches(domain: string, host: string): boolean {
  return host === domain || host.endsWith('.' + domain) || domain.endsWith('.' + host)
}

/** Clave de identidad de una cookie (nombre + dominio + ruta + host-only), como la entiende Chromium. */
export function cookieKey(c: Pick<CookieLike, 'name' | 'domain' | 'path' | 'hostOnly'>): string {
  return `${c.name}\u0000${cookieDomain(c)}\u0000${c.path || '/'}\u0000${c.hostOnly ? 'h' : 'd'}`
}

/**
 * Qué cookies se guardan: todas las de la partición de la cuenta (incluidas las del SSO: la partición es solo de esa cuenta),
 * menos las caducadas, las de valor enorme y las de dominio vacío; con tope, primero las de los hosts prioritarios.
 */
export function selectCookiesToSave(cookies: CookieLike[], nowSec: number, opts: SnapshotOptions = {}, previous?: CookieSnapshot | null): SavedCookie[] {
  const maxValue = opts.maxValueBytes ?? DEFAULT_MAX_VALUE
  const maxCookies = opts.maxCookies ?? DEFAULT_MAX_COOKIES
  const priority = (opts.priorityHosts ?? []).map((h) => h.toLowerCase())
  // Las que Aula repuso con caducidad propia siguen siendo «de sesión» (si el valor no cambió): así se siguen alargando
  const restoredSession = new Map<string, string>()
  for (const p of previous?.cookies ?? []) if (p.session) restoredSession.set(cookieKey(p), p.value)
  const seen = new Set<string>()
  const out: SavedCookie[] = []
  for (const c of cookies) {
    const domain = cookieDomain(c)
    if (!domain || typeof c.name !== 'string' || typeof c.value !== 'string') continue
    if (utf8Length(c.name) + utf8Length(c.value) > maxValue) continue
    let session = c.session === true || typeof c.expirationDate !== 'number' || !Number.isFinite(c.expirationDate)
    if (!session && (c.expirationDate as number) <= nowSec) continue
    if (!session && restoredSession.get(cookieKey({ ...c, domain, hostOnly: c.hostOnly === true, path: c.path || '/' })) === c.value) session = true
    const saved: SavedCookie = {
      name: c.name,
      value: c.value,
      domain,
      hostOnly: c.hostOnly === true,
      path: c.path && c.path.startsWith('/') ? c.path : '/',
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
      sameSite: c.sameSite ?? 'unspecified',
      session,
      ...(session ? {} : { expirationDate: c.expirationDate })
    }
    const key = cookieKey(saved)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(saved)
  }
  if (out.length <= maxCookies) return out
  const rank = (c: SavedCookie): number => (priority.some((h) => domainMatches(c.domain, h)) ? 0 : 1)
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || Number(b.c.session) - Number(a.c.session) || a.i - b.i)
    .slice(0, maxCookies)
    .map((x) => x.c)
}

/** `previous`: la copia anterior (para saber qué cookies repuso Aula como de sesión). */
export function makeSnapshot(cookies: CookieLike[], nowMs: number, opts: SnapshotOptions = {}, previous?: CookieSnapshot | null): CookieSnapshot {
  return { v: 1, savedAt: nowMs, cookies: selectCookiesToSave(cookies, Math.floor(nowMs / 1000), opts, previous) }
}

export function serializeSnapshot(s: CookieSnapshot): string {
  return JSON.stringify(s)
}

/** Lectura tolerante del almacén (un valor dañado se ignora entero: nunca se reponen cookies a medias raras). */
export function parseSnapshot(raw: string | null | undefined): CookieSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.v !== 1 || typeof o.savedAt !== 'number' || !Array.isArray(o.cookies)) return null
  const cookies: SavedCookie[] = []
  for (const item of o.cookies) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string' || !c.domain) continue
    const sameSite = c.sameSite === 'no_restriction' || c.sameSite === 'lax' || c.sameSite === 'strict' ? c.sameSite : 'unspecified'
    cookies.push({
      name: c.name, value: c.value, domain: c.domain.toLowerCase().replace(/^\.+/, ''), hostOnly: c.hostOnly === true,
      path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/', secure: c.secure === true, httpOnly: c.httpOnly === true,
      sameSite, session: c.session === true,
      ...(typeof c.expirationDate === 'number' && Number.isFinite(c.expirationDate) ? { expirationDate: c.expirationDate } : {})
    })
  }
  return { v: 1, savedAt: o.savedAt, cookies }
}

export interface RestoreOptions {
  /** Días de vida que se dan a una cookie de sesión al reponerla (por defecto 30). */
  sessionCookieDays?: number
  /** Una copia más vieja que esto (días) no repone cookies de sesión (el servidor ya las habrá olvidado). */
  maxSnapshotAgeDays?: number
}

/**
 * Caducidad al reponer: la cookie de sesión vive `sessionCookieDays` desde ahora; la que traía caducidad del servidor la
 * conserva tal cual (nunca se alarga). null = no reponer (caducada).
 */
export function restoreExpiration(c: SavedCookie, nowSec: number, opts: RestoreOptions = {}): number | null {
  const days = Math.max(1, Math.min(400, opts.sessionCookieDays ?? 30))
  const extended = nowSec + days * 86_400
  if (c.session || typeof c.expirationDate !== 'number') return extended
  if (c.expirationDate <= nowSec) return null
  // la del servidor manda (y Chromium no acepta más de 400 días)
  return Math.min(c.expirationDate, nowSec + 400 * 86_400)
}

/** Pasa una cookie guardada a los detalles de `session.cookies.set`, respetando host-only, secure, sameSite y prefijos. */
export function toCookieSetDetails(c: SavedCookie, nowSec: number, opts: RestoreOptions = {}): CookieSetDetails | null {
  const expirationDate = restoreExpiration(c, nowSec, opts)
  if (expirationDate == null) return null
  const domain = c.domain.replace(/^\.+/, '')
  if (!domain || /[\s/]/.test(domain)) return null
  const isHostPrefix = c.name.startsWith('__Host-')
  const isSecurePrefix = c.name.startsWith('__Secure-')
  // __Secure- y __Host- exigen secure; __Host- además ruta / y sin dominio
  const secure = c.secure || isHostPrefix || isSecurePrefix
  const hostOnly = c.hostOnly || isHostPrefix
  const path = isHostPrefix ? '/' : c.path || '/'
  // SameSite=None sin Secure lo rechaza Chromium: se deja en «sin especificar» (Lax por defecto)
  const sameSite = c.sameSite === 'no_restriction' && !secure ? 'unspecified' : c.sameSite
  // localhost y direcciones IP: http si la cookie no es segura
  const scheme = secure ? 'https' : isLocal(domain) ? 'http' : 'https'
  const details: CookieSetDetails = {
    url: `${scheme}://${domain}${path}`,
    name: c.name,
    value: c.value,
    path,
    secure,
    httpOnly: c.httpOnly,
    expirationDate,
    sameSite
  }
  // Sin `domain` Chromium la crea host-only (solo ese host); con `domain` vale para el dominio y sus subdominios
  if (!hostOnly) details.domain = '.' + domain
  return details
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/**
 * Plan de reposición al arrancar: las cookies que NO están ya en la sesión (lo que hay en disco es más nuevo) y siguen vigentes.
 * Una cookie de sesión que Aula ya repuso (mismo valor) y a la que le queda menos de la mitad de su vida se vuelve a poner con
 * la caducidad renovada. Una copia demasiado vieja solo repone las que traían caducidad del servidor.
 */
export function planRestore(snapshot: CookieSnapshot | null, existing: CookieLike[], nowMs: number, opts: RestoreOptions = {}): CookieSetDetails[] {
  if (!snapshot) return []
  const nowSec = Math.floor(nowMs / 1000)
  const days = Math.max(1, Math.min(400, opts.sessionCookieDays ?? 30))
  const maxAgeDays = opts.maxSnapshotAgeDays ?? days
  const tooOld = nowMs - snapshot.savedAt > maxAgeDays * 86_400_000
  const present = new Map<string, CookieLike>()
  for (const c of existing) present.set(cookieKey({ ...c, domain: cookieDomain(c), hostOnly: c.hostOnly === true, path: c.path || '/' }), c)
  const out: CookieSetDetails[] = []
  for (const c of snapshot.cookies) {
    if (tooOld && c.session) continue
    const now = present.get(cookieKey(c))
    if (now) {
      const renew = c.session && now.value === c.value && typeof now.expirationDate === 'number' && now.expirationDate < nowSec + (days * 86_400) / 2
      if (!renew) continue
    }
    const d = toCookieSetDetails(c, nowSec, opts)
    if (d) out.push(d)
  }
  return out
}

/** Resumen sin valores, para el registro: «12 cookies (3 de sesión) en campus.uni.edu, login.microsoftonline.com». */
export function describeSnapshot(s: CookieSnapshot | null): string {
  if (!s) return 'sin copia'
  const domains = [...new Set(s.cookies.map((c) => c.domain))].slice(0, 6)
  const sessions = s.cookies.filter((c) => c.session).length
  return `${s.cookies.length} cookies (${sessions} de sesión) en ${domains.join(', ')}${domains.length < new Set(s.cookies.map((c) => c.domain)).size ? '…' : ''}`
}

function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return n
}
