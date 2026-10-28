// Reconoce la plataforma de una página por su dirección y, si se tiene, por su HTML o su título.
// Port de StudyPlatformDetector.swift. Orden de las pistas (gana la más segura):
// 1. Host de la plataforma en la nube (`*.instructure.com`, `classroom.google.com`…) → segura.
// 2. Ruta típica (`/course/view.php` de Moodle, `/webapps/` de Blackboard, `/d2l/` de Brightspace…) → segura o probable.
// 3. HTML (también la página de inicio de sesión): marcas como `M.cfg` de Moodle o `brandable_css` de Canvas → probable.
import type { PlatformKind } from '@shared/settings/platforms'
import { KNOWN_PLATFORM_KINDS, hostMatches, platformInfo } from './model'

export type DetectionConfidence = 'low' | 'medium' | 'high'

export interface PlatformDetection {
  kind: PlatformKind
  confidence: DetectionConfidence
  /** Qué pista lo dijo (en inglés, para depurar y para la IA). */
  evidence: string
}

const RANK: Record<DetectionConfidence, number> = { low: 1, medium: 2, high: 3 }

export function confidenceAtLeast(c: DetectionConfidence | null | undefined, min: DetectionConfidence): boolean {
  return !!c && RANK[c] >= RANK[min]
}

/** Detecta con la dirección (y el HTML/título si los hay). null = no se reconoce (cualquier página). */
export function detectPlatform(input: { url?: string | null; html?: string | null; title?: string | null }): PlatformDetection | null {
  let best: PlatformDetection | null = null
  const consider = (d: PlatformDetection | null): void => {
    if (d && (!best || RANK[d.confidence] > RANK[best.confidence])) best = d
  }
  if (input.url) consider(fromURL(input.url))
  if ((best as PlatformDetection | null)?.confidence !== 'high' && input.html) consider(fromHTML(input.html))
  if (!best && input.title) consider(fromTitle(input.title))
  return best
}

/** Aviso para plataformas que ya no existen (Edmodo cerró el 22-09-2022); null si el host no es de una de ellas. */
export function closedPlatformNotice(host: string): { es: string; en: string } | null {
  const h = host.toLowerCase()
  if (h === 'edmodo.com' || h.endsWith('.edmodo.com')) {
    return {
      es: 'Edmodo cerró en septiembre de 2022: sus clases y materiales ya no están en línea. Si guardaste archivos, añádelos a Aula.',
      en: 'Edmodo shut down in September 2022: its classes and materials are no longer online. If you saved files, add them to Aula.'
    }
  }
  return null
}

/** La plataforma de un host en la nube (sin mirar la ruta). */
export function kindForHost(host: string): PlatformKind | null {
  const h = host.toLowerCase()
  for (const k of KNOWN_PLATFORM_KINDS) {
    if (!platformInfo(k).hostPatterns.some((p) => hostMatches(h, p))) continue
    // drive/docs.google.com por sí solos no son Classroom (pueden ser cualquier documento)
    if (k === 'classroom' && h !== 'classroom.google.com') continue
    return k
  }
  // Blackboard Open LMS (antes Moodlerooms) es un Moodle
  if (h.endsWith('.blackboardopen.com') || h.endsWith('.mrooms.net') || h.endsWith('.openlms.net')) return 'moodle'
  return null
}

const MOODLE_STRONG = ['/course/view.php', '/mod/resource/', '/mod/quiz/', '/mod/assign/', '/mod/forum/', '/mod/folder/', '/mod/page/', '/mod/book/',
  '/pluginfile.php', '/login/index.php', '/my/courses.php', '/calendar/view.php', '/user/profile.php', '/admin/tool/']
const CANVAS_TOOLS = new Set(['modules', 'assignments', 'quizzes', 'files', 'pages', 'announcements', 'discussion_topics', 'grades', 'external_tools', 'syllabus'])
const BY_NAME: Record<string, PlatformKind> = {
  moodle: 'moodle', canvas: 'canvas', sakai: 'sakai', blackboard: 'blackboard', bb: 'blackboard', brightspace: 'brightspace', d2l: 'brightspace',
  schoology: 'schoology', edx: 'openedx'
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw.includes('://') ? raw : 'https://' + raw)
  } catch {
    return null
  }
}

export function fromURL(raw: string): PlatformDetection | null {
  const u = parse(raw)
  if (!u || !u.hostname) return null
  const host = u.hostname.toLowerCase()
  const k = kindForHost(host)
  if (k) return { kind: k, confidence: 'high', evidence: `host ${host}` }
  const path = u.pathname.toLowerCase()
  const query = u.search.toLowerCase()
  const has = (p: string): boolean => path.includes(p)
  if (MOODLE_STRONG.some(has)) return { kind: 'moodle', confidence: 'high', evidence: 'Moodle path' }
  if (path === '/my/' || path === '/my') return { kind: 'moodle', confidence: 'medium', evidence: 'Moodle /my/' }
  if (path.startsWith('/webapps/') || path.startsWith('/ultra/') || path.startsWith('/bbcswebdav/') || path.startsWith('/learn/api/')) {
    return { kind: 'blackboard', confidence: 'high', evidence: 'Blackboard path' }
  }
  if (path.startsWith('/d2l/') || path === '/d2l') return { kind: 'brightspace', confidence: 'high', evidence: 'Brightspace /d2l/' }
  if (path.startsWith('/portal/site/') || path.startsWith('/access/content/') || path.startsWith('/samigo-app/') || path.startsWith('/portal/directtool/')) {
    return { kind: 'sakai', confidence: 'high', evidence: 'Sakai path' }
  }
  if (path.includes('/courses/course-v1:') || path.includes('/course/course-v1:') || path.includes('course-v1%3a') || path.includes('/asset-v1:')) {
    return { kind: 'openedx', confidence: 'high', evidence: 'Open edX course key' }
  }
  if (path.startsWith('/login/canvas')) return { kind: 'canvas', confidence: 'high', evidence: 'Canvas /login/canvas' }
  if (path.startsWith('/login/saml') || path.startsWith('/login/cas') || path.startsWith('/login/openid_connect')) {
    return { kind: 'canvas', confidence: 'medium', evidence: 'Canvas-like /login/<provider>' }
  }
  const segs = path.split('/').filter(Boolean)
  if (segs.length >= 2 && segs[0] === 'courses' && /^\d+$/.test(segs[1])) {
    const confident = segs.length >= 3 && CANVAS_TOOLS.has(segs[2])
    return { kind: 'canvas', confidence: confident ? 'medium' : 'low', evidence: 'Canvas-like /courses/<id>' }
  }
  if (segs.length >= 3 && segs[0] === 'course' && /^\d+$/.test(segs[1]) && ['materials', 'updates', 'gradebook', 'members'].includes(segs[2])) {
    return { kind: 'schoology', confidence: 'medium', evidence: 'Schoology-like /course/<id>/materials' }
  }
  if (query.includes('cmid=') && path.endsWith('.php')) return { kind: 'moodle', confidence: 'medium', evidence: 'Moodle cmid' }
  // un host que se llama como la plataforma (moodle.x.edu, canvas.x.edu…) es una pista débil
  const first = host.split('.')[0] ?? ''
  const byName = BY_NAME[first] ?? (host.includes('moodle') ? 'moodle' : undefined)
  if (byName) return { kind: byName, confidence: 'low', evidence: `host name ${first}` }
  return null
}

/** Marcas (en minúsculas) que delatan cada plataforma en su HTML; cada una con su peso (2 = clara, 1 = pista). */
const HTML_MARKERS: [PlatformKind, string, number][] = [
  ['moodle', 'yui_combo.php', 2], ['moodle', 'm.cfg = {', 2], ['moodle', 'm.cfg={', 2], ['moodle', 'content="moodle', 2], ['moodle', '/theme/image.php', 2],
  ['moodle', '/theme/styles.php/', 2], ['moodle', '/lib/javascript.php', 2], ['moodle', 'page-login-index', 1], ['moodle', 'pagelayout-login', 1],
  ['moodle', 'powered by moodle', 2], ['moodle', 'moodle.org', 1],
  ['canvas', 'brandable_css', 2], ['canvas', 'app-id=480883488', 2], ['canvas', 'ic-login-body', 2], ['canvas', 'du11hjcvx0uqb.cloudfront.net', 2],
  ['canvas', 'instructure.com', 1], ['canvas', 'canvas lms', 1],
  ['blackboard', '/webapps/login', 2], ['blackboard', 'learn-oe-body', 2], ['blackboard', 'content="blackboard"', 2], ['blackboard', 'blackboard inc', 2],
  ['blackboard', 'blackboard learn', 2], ['blackboard', 'learn.blackboard', 2], ['blackboard', 'blackboard.com', 1], ['blackboard', '/ultra/', 1],
  ['brightspace', 'd2l-body', 2], ['brightspace', 's.brightspace.com', 2], ['brightspace', '<d2l-', 2], ['brightspace', '/d2l/lp/', 2], ['brightspace', '/d2l/login', 2],
  ['brightspace', 'd2l.lp', 2], ['brightspace', 'brightspace', 1],
  ['schoology', 'app.schoology.com', 2], ['schoology', 'schoology', 1],
  ['sakai', 'mrphs-', 2], ['sakai', '/library/skin/', 2], ['sakai', 'poweredbysakai', 2], ['sakai', '/portal/xlogin', 2], ['sakai', 'sakai : gateway', 2],
  ['sakai', 'sakaiproject', 2],
  ['itslearning', 'itsl-login', 2], ['itslearning', 'cdn.itslearning.com', 2], ['itslearning', 'app-id=1640277495', 2], ['itslearning', 'itslearning', 1],
  ['openedx', 'edx-platform', 2], ['openedx', 'open edx', 2], ['openedx', 'authn.edx.org', 2], ['openedx', 'course-v1:', 2], ['openedx', 'edx.org', 1],
  ['classroom', 'classroom.google.com', 2], ['classroom', 'google classroom', 2],
  ['teams', 'teams.microsoft.com', 2], ['teams', 'microsoft teams', 2]
]

export function fromHTML(html: string): PlatformDetection | null {
  const lower = html.slice(0, 600_000).toLowerCase()
  const score = new Map<PlatformKind, number>()
  const hit = new Map<PlatformKind, string>()
  for (const [k, marker, w] of HTML_MARKERS) {
    if (!lower.includes(marker)) continue
    score.set(k, (score.get(k) ?? 0) + w)
    if (!hit.has(k)) hit.set(k, marker)
  }
  if (score.size === 0) return null
  const max = Math.max(...score.values())
  const top = [...score.entries()].filter(([, s]) => s === max)
  // con empate entre dos plataformas no se decide
  if (top.length > 1) return null
  const [k, s] = top[0]
  const confidence: DetectionConfidence = s >= 3 ? 'high' : s === 2 ? 'medium' : 'low'
  return { kind: k, confidence, evidence: `HTML marker ${hit.get(k) ?? ''}` }
}

export function fromTitle(title: string): PlatformDetection | null {
  const t = title.toLowerCase()
  for (const k of KNOWN_PLATFORM_KINDS) {
    if (t.includes(platformInfo(k).displayName.toLowerCase())) return { kind: k, confidence: 'low', evidence: 'page title' }
  }
  return null
}
