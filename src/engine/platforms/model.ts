// «Tu plataforma de estudio»: Canvas, Moodle, Blackboard, Google Classroom, Brightspace… o cualquier página.
// Port de la app Swift anterior: Sources/StudyEngine/Platforms/StudyPlatform.swift (puro: sin Node ni DOM).
// El inicio de sesión lo hace SIEMPRE el estudiante en una ventana visible: Aula nunca pide ni escribe contraseñas.
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import { PLATFORM_KINDS } from '@shared/settings/platforms'
import { tr } from '@shared/ai/i18n'

export interface PlatformKindInfo {
  kind: PlatformKind
  /** Marca (no se traduce). Para 'other' sale «Otra página» / «Other website» en el idioma de la interfaz. */
  displayName: string
  /** Nombre en inglés para los prompts. */
  aiName: string
  exampleURL: string
  /** Hosts propios en la nube: sirven para reconocerla y cuentan como «tu plataforma» (`*.x.com` = dominio y subdominios). */
  hostPatterns: string[]
  /** Sitios donde guarda archivos: se permiten sus descargas. */
  relatedHostPatterns: string[]
  /** Dónde exporta el calendario .ics (es / en), si lo tiene. */
  calendarHelp?: { es: string; en: string }
  /** ¿Aula sabe conectar el calendario sola con la sesión? */
  automaticCalendar: boolean
}

const INFO: Record<PlatformKind, PlatformKindInfo> = {
  canvas: {
    kind: 'canvas', displayName: 'Canvas', aiName: 'Canvas LMS', exampleURL: 'tuuniversidad.instructure.com',
    hostPatterns: ['*.instructure.com'], relatedHostPatterns: ['*.instructure-uploads.com', '*.canvas-user-content.com', '*.inscloudgate.net'],
    calendarHelp: { es: 'En Canvas: Calendario → «Fuente del calendario» (abajo a la derecha) → copia la dirección.', en: 'In Canvas: Calendar → “Calendar Feed” (bottom right) → copy the address.' },
    automaticCalendar: true
  },
  moodle: {
    kind: 'moodle', displayName: 'Moodle', aiName: 'Moodle', exampleURL: 'campusvirtual.tuuniversidad.edu',
    hostPatterns: ['*.moodlecloud.com'], relatedHostPatterns: [],
    calendarHelp: { es: 'En Moodle: Calendario → «Importar o exportar calendarios» → «Exportar calendario» → «Obtener la URL del calendario».', en: 'In Moodle: Calendar → “Import or export calendars” → “Export calendar” → “Get calendar URL”.' },
    automaticCalendar: true
  },
  blackboard: {
    kind: 'blackboard', displayName: 'Blackboard', aiName: 'Blackboard Learn', exampleURL: 'tuuniversidad.blackboard.com',
    hostPatterns: ['*.blackboard.com'], relatedHostPatterns: ['*.blackboardcdn.com'],
    calendarHelp: { es: 'En Blackboard: Calendario → ajustes (engranaje) → «Obtener enlace de calendario externo».', en: 'In Blackboard: Calendar → settings (gear) → “Get external calendar link”.' },
    automaticCalendar: false
  },
  classroom: {
    kind: 'classroom', displayName: 'Google Classroom', aiName: 'Google Classroom', exampleURL: 'classroom.google.com',
    hostPatterns: ['classroom.google.com', 'drive.google.com', 'docs.google.com'], relatedHostPatterns: ['*.googleusercontent.com'],
    calendarHelp: { es: 'En Google Calendar: ajustes del calendario de la clase → «Dirección secreta en formato iCal».', en: 'In Google Calendar: the class calendar settings → “Secret address in iCal format”.' },
    automaticCalendar: false
  },
  brightspace: {
    kind: 'brightspace', displayName: 'Brightspace', aiName: 'D2L Brightspace', exampleURL: 'tuuniversidad.brightspace.com',
    hostPatterns: ['*.brightspace.com', '*.desire2learn.com'], relatedHostPatterns: [],
    calendarHelp: { es: 'En Brightspace: Calendario → «Suscribirse» → copia la dirección del feed.', en: 'In Brightspace: Calendar → “Subscribe” → copy the feed address.' },
    automaticCalendar: false
  },
  schoology: {
    kind: 'schoology', displayName: 'Schoology', aiName: 'Schoology', exampleURL: 'app.schoology.com',
    hostPatterns: ['*.schoology.com'], relatedHostPatterns: [],
    calendarHelp: { es: 'En Schoology: Calendario → «Exportar» → copia la dirección iCal.', en: 'In Schoology: Calendar → “Export” → copy the iCal address.' },
    automaticCalendar: false
  },
  teams: {
    kind: 'teams', displayName: 'Microsoft Teams', aiName: 'Microsoft Teams (class team)', exampleURL: 'teams.microsoft.com',
    hostPatterns: ['teams.microsoft.com', 'teams.cloud.microsoft'], relatedHostPatterns: ['*.sharepoint.com', 'onedrive.live.com', '*.onenote.com'],
    automaticCalendar: false
  },
  sakai: {
    kind: 'sakai', displayName: 'Sakai', aiName: 'Sakai', exampleURL: 'sakai.tuuniversidad.edu',
    hostPatterns: [], relatedHostPatterns: [],
    calendarHelp: { es: 'En Sakai: Calendario → «Suscribirse» → copia la dirección del calendario.', en: 'In Sakai: Calendar → “Subscribe” → copy the calendar address.' },
    automaticCalendar: false
  },
  itslearning: {
    kind: 'itslearning', displayName: 'itslearning', aiName: 'itslearning', exampleURL: 'tucentro.itslearning.com',
    hostPatterns: ['*.itslearning.com'], relatedHostPatterns: [],
    calendarHelp: { es: 'En itslearning: Calendario → «Suscribirse al calendario» → copia la dirección.', en: 'In itslearning: Calendar → “Subscribe to calendar” → copy the address.' },
    automaticCalendar: false
  },
  openedx: {
    kind: 'openedx', displayName: 'Open edX', aiName: 'Open edX', exampleURL: 'courses.edx.org',
    hostPatterns: ['*.edx.org'], relatedHostPatterns: [],
    automaticCalendar: false
  },
  other: {
    kind: 'other', displayName: 'Otra página', aiName: 'a website', exampleURL: 'www.ejemplo.com/curso',
    hostPatterns: [], relatedHostPatterns: [],
    automaticCalendar: false
  }
}

export function platformInfo(kind: PlatformKind): PlatformKindInfo {
  const info = INFO[kind] ?? INFO.other
  // el nombre de 'other' se elige al pedirlo (no al importar el módulo) para seguir el idioma de la interfaz
  return info.kind === 'other' ? { ...info, displayName: tr('Otra página', 'Other website') } : info
}

/** Las conocidas, en el orden en que se ofrecen; 'other' al final. */
export const KNOWN_PLATFORM_KINDS: PlatformKind[] = PLATFORM_KINDS.filter((k) => k !== 'other')

/** Un tipo desconocido (de una versión futura o de la app Swift) se lee como 'other'; acepta los nombres de la app Swift. */
export function parsePlatformKind(raw: unknown): PlatformKind {
  if (typeof raw !== 'string') return 'other'
  const s = raw.trim()
  if ((PLATFORM_KINDS as readonly string[]).includes(s)) return s as PlatformKind
  if (s === 'googleClassroom') return 'classroom'
  if (s === 'openEdx') return 'openedx'
  return 'other'
}

/** Dirección validada (http/https, con host, sin usuario:contraseña, sin fragmento); «campus.x.edu» → «https://campus.x.edu/». */
export function normalizePlatformURL(text: string): string | null {
  let s = (text ?? '').trim()
  if (!s || /\s/.test(s)) return null
  if (!s.includes('://')) s = 'https://' + s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const scheme = u.protocol.toLowerCase()
  if (scheme !== 'https:' && scheme !== 'http:') return null
  const host = u.hostname.toLowerCase()
  if (!host || !(host.includes('.') || host === 'localhost')) return null
  if (u.username || u.password) return null
  u.hash = ''
  return u.toString()
}

/** «https://campus.unam.mx» (con el puerto si no es el de serie). */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin.toLowerCase()
  } catch {
    return null
  }
}

export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h || null
  } catch {
    return null
  }
}

/** `*.x.com` vale para `x.com` y sus subdominios; `x.com` solo para él; acepta también `https://x.com` y `*`. */
export function hostMatches(host: string, pattern: string): boolean {
  let p = pattern.toLowerCase().trim()
  const scheme = p.indexOf('://')
  if (scheme >= 0) p = p.slice(scheme + 3)
  const cut = p.search(/[/:]/)
  if (cut >= 0) p = p.slice(0, cut)
  const h = host.toLowerCase()
  if (p === '*') return true
  if (p.startsWith('*.')) {
    const base = p.slice(2)
    return h === base || h.endsWith('.' + base)
  }
  return h === p
}

/** Patrones de los sitios que cuentan como la plataforma de la cuenta (su origen y los hosts en la nube). */
export function trustedSitePatterns(account: Pick<PlatformAccount, 'kind' | 'baseURL'>): string[] {
  const out = new Set<string>()
  const o = originOf(account.baseURL)
  if (o) out.add(o)
  for (const p of platformInfo(account.kind).hostPatterns) out.add(p)
  return [...out]
}

/** Patrones desde los que se permiten descargas: los de confianza y los sitios de archivos de la plataforma. */
export function downloadSitePatterns(account: Pick<PlatformAccount, 'kind' | 'baseURL'>): string[] {
  return [...new Set([...trustedSitePatterns(account), ...platformInfo(account.kind).relatedHostPatterns])]
}

/** ¿La dirección es de esta cuenta (su host exacto o los hosts de su plataforma en la nube)? */
export function accountContains(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  const h = hostOf(url) ?? hostOf(normalizePlatformURL(url) ?? '')
  if (!h) return false
  const mine = hostOf(account.baseURL)
  if (mine && mine === h) return true
  return platformInfo(account.kind).hostPatterns.some((p) => hostMatches(h, p))
}

/** ¿Es una dirección de descarga de esta cuenta (incluye Drive, SharePoint, S3 de Canvas…)? */
export function accountAllowsDownloadFrom(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  const h = hostOf(url)
  if (!h) return false
  if (accountContains(account, url)) return true
  return platformInfo(account.kind).relatedHostPatterns.some((p) => hostMatches(h, p))
}

/** La cuenta a la que pertenece una dirección (primero por host exacto, después por los hosts de la plataforma). */
export function accountForURL<A extends Pick<PlatformAccount, 'kind' | 'baseURL'>>(accounts: A[], url: string): A | null {
  const h = hostOf(url)
  if (!h) return null
  return accounts.find((a) => hostOf(a.baseURL) === h) ?? accounts.find((a) => accountContains(a, url)) ?? null
}

/** Lo que ve el estudiante: su nombre, la plataforma o el sitio. */
export function accountDisplayName(account: Pick<PlatformAccount, 'kind' | 'baseURL' | 'label'>): string {
  if (account.label?.trim()) return account.label.trim()
  if (account.kind !== 'other') return platformInfo(account.kind).displayName
  const h = hostOf(account.baseURL)
  return h ? h.replace(/^www\./, '') : account.baseURL
}

/**
 * Raíz de la plataforma: el origen, o la carpeta donde vive (Moodle en `https://uni.edu/moodle/`). Se quitan las rutas
 * conocidas de páginas internas (`/login/index.php`, `/my/`, `/course/view.php`…).
 */
export function platformRoot(kind: PlatformKind, baseURL: string): string {
  let u: URL
  try {
    u = new URL(baseURL)
  } catch {
    return baseURL
  }
  if (kind !== 'moodle' && kind !== 'sakai') return u.origin
  const markers = kind === 'moodle'
    ? ['/login/', '/my/', '/course/', '/mod/', '/user/', '/calendar/', '/admin/', '/pluginfile.php', '/index.php', '/auth/', '/blocks/', '/lib/']
    : ['/portal', '/access/', '/direct/', '/samigo-app/']
  let path = u.pathname
  for (const m of markers) {
    const i = path.toLowerCase().indexOf(m)
    if (i >= 0) path = path.slice(0, i)
  }
  path = path.replace(/\/+$/, '')
  return u.origin + path
}

/** Une la raíz de la plataforma con una ruta (`/my/`). */
export function joinRoot(root: string, path: string): string {
  return root.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path)
}

/** Enmascara secretos para mostrarlos o registrarlos: un enlace privado deja solo su sitio. */
export const SecretMask = {
  url(s: string): string {
    const h = hostOf(s)
    if (!h) return '••••'
    let scheme = 'https'
    try {
      scheme = new URL(s).protocol.replace(':', '')
    } catch { /* nada */ }
    return `${scheme}://${h}/••••`
  },
  token: '••••••••',
  /** Quita de un texto cualquier aparición de los secretos dados. */
  scrub(text: string, secrets: string[]): string {
    let out = text
    for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('••••')
    return out
  }
}
