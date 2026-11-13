// Inicio de sesión: reconocer páginas de acceso y de SSO, decidir si una cuenta sigue con la sesión iniciada y qué dirección
// barata sirve para comprobarlo (y para mantenerla viva). Puro: lo usan la ventana de inicio de sesión, la comprobación en
// segundo plano y las pruebas.
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import { isIdentityHost } from './identity'
import { accountContains, hostOf, joinRoot, platformRoot } from './model'
import { moodleBodyNotLoggedIn, moodleUserProof } from './moodle'
import { moodleAliasRoot } from './site'

// MARK: Proveedores de identidad (SSO)

// viven en identity.ts (también los usa site.ts); se siguen exportando desde aquí
export { isIdentityHost } from './identity'

// MARK: Páginas de inicio de sesión

/** Rutas de acceso genéricas (SAML, CAS, OAuth, Shibboleth…). */
const GENERIC_LOGIN_PATHS = [
  /^\/log[-_]?in(\/|$|\.|\?)/, /^\/sign[-_]?in(\/|$)/, /^\/signon/, /^\/logon/, /^\/auth(\/|$)/, /\/saml2?(\/|$)/, /\/sso(\/|$)/, /^\/cas\/login/, /\/cas\/login/,
  /^\/idp\//, /\/shibboleth\.sso\//, /\/oauth2?\/(authorize|v2\.0\/authorize|auth)/, /^\/adfs\/ls/, /\/simplesaml\//, /\/profile\/saml2\//, /\/session\/new/
]

/** Rutas de acceso de cada plataforma. */
const PLATFORM_LOGIN_PATHS: Partial<Record<PlatformKind, RegExp[]>> = {
  canvas: [/^\/login(\/|$)/],
  moodle: [
    /\/login\/index\.php/, /\/login\/signup\.php/, /\/login\/forgot_password\.php/, /\/login\/change_password\.php/,
    /\/auth\/(saml2|shibboleth|oidc|cas|oauth2)\//, /\/admin\/tool\/mfa\//
  ],
  blackboard: [/^\/webapps\/login/, /^\/webapps\/bb-auth-provider/, /^\/auth-saml\//, /^\/ultra\/login/],
  brightspace: [/^\/d2l\/login/, /^\/d2l\/lp\/auth\//],
  sakai: [/^\/portal\/x?login/, /^\/container\/login/, /^\/sakai-login-tool\//],
  schoology: [/^\/login(\/|$)/, /^\/register/],
  itslearning: [/^\/index\.aspx/i, /^\/elogin/, /^\/oauth/],
  openedx: [/^\/login/, /^\/signin/, /^\/register/, /^\/authn\//],
  classroom: [],
  teams: [],
  other: []
}

function loginPathMatches(u: URL, kind?: PlatformKind): boolean {
  const path = u.pathname.toLowerCase()
  if (kind === 'itslearning' && path === '/') return false
  const rules = [...(kind ? PLATFORM_LOGIN_PATHS[kind] ?? [] : []), ...GENERIC_LOGIN_PATHS]
  return rules.some((r) => r.test(path))
}

/** ¿La dirección es una página de inicio de sesión (de la plataforma o del SSO)? */
export function isLoginURL(url: string, kind?: PlatformKind): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (isIdentityHost(u.hostname)) return true
  return loginPathMatches(u, kind)
}

/**
 * Como `isLoginURL`, pero sabiendo de qué cuenta es: en el propio host de la plataforma solo cuentan las rutas de acceso
 * (un campus que se llame «sso.uni.edu» o «login.uni.edu» no es por eso una página del SSO).
 */
export function isAccountLoginURL(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!accountContains(account, url)) return isLoginURL(url, account.kind)
  return loginPathMatches(u, account.kind)
}

/**
 * Rutas que EMPIEZAN un inicio de sesión único (piden algo al proveedor o guardan un estado de un solo uso): los plugins de
 * acceso de Moodle, SAML, CAS, Shibboleth, OAuth y los proveedores de Canvas y Blackboard. La página de acceso en sí no.
 */
const SSO_START_PATHS = [
  /\/auth\/(saml2|shibboleth|oidc|cas|oauth2)\//, /\/saml2?(\/|$)/, /\/sso(\/|$)/, /\/cas\/login/, /^\/idp\//, /\/shibboleth\.sso\//,
  /\/oauth2?\/(authorize|v2\.0\/authorize|auth)/, /^\/adfs\/ls/, /\/simplesaml\//, /\/profile\/saml2\//,
  /^\/login\/(saml|cas|openid_connect|oauth2?|google|microsoft|apple|clever)(\/|$)/, /^\/auth-saml\//, /^\/webapps\/bb-auth-provider-[^/]*\/execute\//
]

/**
 * ¿Pedir esta dirección empezaría un inicio de sesión (un proveedor de identidad u otra ruta que arranca el SSO)? Lo usa el
 * sondeo sin sesión del alta para no empezar un acceso de Microsoft de fondo. `from`: la dirección de la que se llega.
 */
export function startsSignIn(from: string, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return true
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return true
  if (u.hostname.toLowerCase() !== (hostOf(from) ?? '') && isIdentityHost(u.hostname)) return true
  const path = u.pathname.toLowerCase()
  return SSO_START_PATHS.some((r) => r.test(path))
}

// MARK: Pasos tras el acceso (Moodle)

/**
 * Lo que Moodle pide DESPUÉS de iniciar sesión: aceptar la política del sitio o completar el perfil. Sin anclar (Moodle
 * puede vivir en una carpeta). No son páginas de acceso: la sesión está iniciada (por eso no van en las rutas de acceso:
 * la comprobación diría «sesión cerrada»), pero el estudiante tiene que terminarlo en la ventana.
 */
const MOODLE_POST_LOGIN_STEPS = [/\/admin\/tool\/policy\/(index|view)\.php/, /\/user\/policy\.php/, /\/user\/edit\.php/]

/** ¿La dirección es un paso de Moodle tras el acceso (política, perfil)? Solo cuentas Moodle y solo en el host de la cuenta. */
export function isPostLoginStep(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  if (account.kind !== 'moodle' || !accountContains(account, url)) return false
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return false
  }
  return MOODLE_POST_LOGIN_STEPS.some((r) => r.test(path))
}

/** Marcas en el HTML de una página CON la sesión iniciada. */
const SIGNED_IN_HTML: Partial<Record<PlatformKind, RegExp[]>> = {
  canvas: [/"current_user_id"\s*:\s*"?\d+/],
  moodle: [/logout\.php\?sesskey=/],
  blackboard: [/\/webapps\/login\/\?action=logout/, /"userId"\s*:\s*"_\d+_1"/],
  brightspace: [/\/d2l\/logout/, /d2l-navigation-s-personal-menu/],
  sakai: [/\/portal\/logout/, /"userId"\s*:\s*"[^"]+"/],
  schoology: [/\/logout/, /s-user-id/],
  openedx: [/\/logout/, /"username"\s*:\s*"[^"]+"/]
}
/** Una marca en el HTML: una expresión o una prueba propia (p. ej. una clase del `<body>`). */
type HtmlMark = RegExp | ((html: string) => boolean)

/** Marcas de una página SIN sesión (aunque no tenga campo de contraseña visible, p. ej. un botón «Acceder con SSO»). */
const SIGNED_OUT_HTML: Partial<Record<PlatformKind, HtmlMark[]>> = {
  canvas: [/"current_user_id"\s*:\s*null/, /ic-Login-Body/i, /id="login_form"/],
  // `notloggedin` solo cuenta en la clase del <body> (no en CSS ni en JavaScript en línea)
  moodle: [/id="page-login-index"/, moodleBodyNotLoggedIn, /id="login"[^>]*action="[^"]*login\/index\.php/],
  blackboard: [/class="[^"]*login-page/, /name="login"[^>]*action="\/webapps\/login/],
  brightspace: [/d2l-login/],
  sakai: [/\/portal\/xlogin"/],
  itslearning: [/itsl-login/],
  openedx: [/id="login"/]
}

export type PageAuthKind = 'sso' | 'login' | 'authenticated' | 'unknown'

/**
 * ¿Qué es esta página para la sesión de la cuenta? `sso`/`login` = hay que iniciar sesión; `authenticated` = página interna de
 * la plataforma (sin contraseña ni marcas de acceso); `unknown` = no se sabe (otro sitio, o señales mezcladas).
 */
export function classifyAuthPage(input: {
  url: string
  account: Pick<PlatformAccount, 'kind' | 'baseURL'>
  hasPasswordField?: boolean
  html?: string | null
}): PageAuthKind {
  const host = hostOf(input.url)
  if (!host) return 'unknown'
  const onPlatform = accountContains(input.account, input.url)
  if (!onPlatform && isIdentityHost(host)) return 'sso'
  const kind = input.account.kind
  if (isAccountLoginURL(input.account, input.url)) return 'login'
  const html = input.html ?? ''
  if (kind === 'moodle' && html) {
    // Moodle: el body «notloggedin» manda; si no, la prueba de salida gana a las marcas genéricas (una contraseña de
    // cuestionario, una clave de matriculación, un bloque de acceso…)
    if (moodleBodyNotLoggedIn(html)) return 'login'
    if (onPlatform && moodleUserProof(html)) return 'authenticated'
  }
  if (input.hasPasswordField) return 'login'
  if (html) {
    if (htmlShowsSignedOut(kind, html)) return 'login'
    if (onPlatform && htmlShowsSignedIn(kind, html)) return 'authenticated'
  }
  return onPlatform ? 'authenticated' : 'unknown'
}

/** ¿El HTML trae marcas de una página CON la sesión iniciada (id del usuario, enlace de salida…)? */
export function htmlShowsSignedIn(kind: PlatformKind, html: string): boolean {
  return (SIGNED_IN_HTML[kind] ?? []).some((r) => r.test(html))
}

/** ¿El HTML trae marcas de una página SIN sesión (formulario de acceso, «notloggedin»…)? */
export function htmlShowsSignedOut(kind: PlatformKind, html: string): boolean {
  return (SIGNED_OUT_HTML[kind] ?? []).some((m) => (typeof m === 'function' ? m(html) : m.test(html)))
}

// MARK: Comprobación de la sesión (sin ventana)

/** Petición barata con la sesión que dice si sigue iniciada (y, al hacerla, la mantiene viva). */
export interface SessionCheckTarget {
  url: string
  /** 'json' = API que contesta 401 sin sesión; 'page' = página interna que redirige al acceso sin sesión. */
  expect: 'json' | 'page'
  headers?: Record<string, string>
}

/** Las direcciones que comprueban la sesión de cada plataforma, en orden (si una no es concluyente se prueba la siguiente). */
export function sessionCheckTargets(account: Pick<PlatformAccount, 'kind' | 'baseURL'>): SessionCheckTarget[] {
  const root = platformRoot(account.kind, account.baseURL)
  const json = { Accept: 'application/json' }
  switch (account.kind) {
    case 'canvas':
      return [{ url: joinRoot(root, '/api/v1/users/self'), expect: 'json', headers: json }]
    case 'moodle':
      // si el área personal está desactivada, /my/ da 404 (no concluyente) y se prueba «Mis cursos»
      return [{ url: joinRoot(root, '/my/'), expect: 'page' }, { url: joinRoot(root, '/my/courses.php'), expect: 'page' }]
    case 'blackboard':
      return [{ url: joinRoot(root, '/learn/api/v1/users/me'), expect: 'json', headers: json }, { url: joinRoot(root, '/ultra/course'), expect: 'page' }]
    case 'brightspace':
      return [{ url: joinRoot(root, '/d2l/api/lp/1.0/users/whoami'), expect: 'json', headers: json }, { url: joinRoot(root, '/d2l/home'), expect: 'page' }]
    case 'sakai':
      return [{ url: joinRoot(root, '/direct/session/current.json'), expect: 'json', headers: json }, { url: joinRoot(root, '/portal'), expect: 'page' }]
    case 'openedx':
      return [{ url: joinRoot(root, '/api/user/v1/me'), expect: 'json', headers: json }, { url: joinRoot(root, '/dashboard'), expect: 'page' }]
    case 'schoology':
      return [{ url: joinRoot(root, '/home'), expect: 'page' }]
    case 'classroom':
      return [{ url: 'https://classroom.google.com/u/0/h', expect: 'page' }]
    case 'teams':
      return [{ url: 'https://teams.microsoft.com/v2/', expect: 'page' }]
    case 'itslearning':
      return [{ url: joinRoot(root, '/DashboardMenu.aspx'), expect: 'page' }, { url: account.baseURL, expect: 'page' }]
    default:
      return [{ url: account.baseURL, expect: 'page' }]
  }
}

/** Lo que se sabe de una respuesta. */
export interface SessionProbeResponse {
  status: number
  /** Dirección final tras seguir las redirecciones. */
  finalURL: string
  /** Saltos de redirección (sin la primera dirección). */
  redirects: string[]
  contentType?: string | null
  /** El cuerpo recibido, entero (con el tope de la petición): la prueba de usuario de Moodle puede ir al final. */
  body?: string
}

export type SessionState = 'signedIn' | 'signedOut' | 'unknown'

export interface SessionVerdict {
  state: SessionState
  /** Motivo en inglés (registro y depuración; nunca lleva cookies ni el cuerpo). */
  reason: string
  /** Moodle pide un paso tras el acceso (política, perfil): hay sesión, pero el estudiante tiene que terminarlo. */
  pendingStep?: boolean
}

/** Quita el `while(1);` que Canvas antepone a las respuestas JSON con sesión. */
export function stripJSONGuard(text: string): string {
  const t = text.trimStart()
  if (t.startsWith('while(1);')) return t.slice('while(1);'.length)
  if (t.startsWith(")]}',")) return t.slice(5)
  return t
}

function looksLikeHTML(contentType: string | null | undefined, body: string): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true
  return /^\s*(<!doctype html|<html)/i.test(body)
}

function hasPasswordInput(body: string): boolean {
  return /<input[^>]+type\s*=\s*["']?password/i.test(body)
}

/** Interpreta la respuesta de una comprobación de la sesión. Solo dice `signedOut` con señales claras (401, acceso, SSO). */
export function interpretSessionCheck(
  account: Pick<PlatformAccount, 'kind' | 'baseURL'>,
  target: SessionCheckTarget,
  r: SessionProbeResponse
): SessionVerdict {
  const kind = account.kind
  const chain = [...r.redirects, r.finalURL]
  const bounced = chain.find((u) => isAccountLoginURL(account, u))
  if (bounced) return { state: 'signedOut', reason: `redirected to sign-in (${hostOf(bounced) ?? '?'})` }
  const body = r.body ?? ''
  // Moodle en otro host del mismo sitio (la dirección guardada es un alias): su página cuenta como la de la cuenta
  const pageAccount = kind === 'moodle' ? moodleAliasAccount(account, r.finalURL, body) ?? account : account
  // después del acceso: la política o el perfil por completar (nunca «cerrada», nunca «iniciada»)
  if (kind === 'moodle' && chain.some((u) => isPostLoginStep(account, u) || isPostLoginStep(pageAccount, u))) {
    return { state: 'unknown', reason: 'post-login step (policy/profile)', pendingStep: true }
  }
  if (r.status === 401) return { state: 'signedOut', reason: 'HTTP 401' }
  if (r.status === 407 || r.status === 429 || r.status >= 500) return { state: 'unknown', reason: `HTTP ${r.status}` }
  if (target.expect === 'json') {
    if (r.status === 403) {
      // Brightspace contesta 403 a whoami sin sesión; en las demás puede ser un permiso: no concluyente
      return kind === 'brightspace' ? { state: 'signedOut', reason: 'HTTP 403 (whoami)' } : { state: 'unknown', reason: 'HTTP 403' }
    }
    if (r.status === 404 || r.status === 400) return { state: 'unknown', reason: `HTTP ${r.status}` }
    if (r.status >= 200 && r.status < 300) {
      if (looksLikeHTML(r.contentType, body)) {
        return hasPasswordInput(body) || classifyAuthPage({ url: r.finalURL, account, html: body }) === 'login'
          ? { state: 'signedOut', reason: 'login page instead of JSON' }
          : { state: 'unknown', reason: 'HTML instead of JSON' }
      }
      let data: unknown
      try {
        data = JSON.parse(stripJSONGuard(body))
      } catch {
        return { state: 'unknown', reason: 'unreadable JSON' }
      }
      return jsonVerdict(kind, data)
    }
    return { state: 'unknown', reason: `HTTP ${r.status}` }
  }
  // Página interna
  if (r.status === 403) return { state: 'unknown', reason: 'HTTP 403' }
  if (r.status >= 200 && r.status < 300) {
    if (!accountContains(pageAccount, r.finalURL) && kind !== 'other') return { state: 'unknown', reason: 'ended on another site' }
    if (kind === 'moodle') return moodlePageVerdict(pageAccount, r.finalURL, body)
    const page = classifyAuthPage({ url: r.finalURL, account, html: body, hasPasswordField: hasPasswordInput(body) })
    if (page === 'login' || page === 'sso') return { state: 'signedOut', reason: 'sign-in page' }
    if (page === 'authenticated') return { state: 'signedIn', reason: 'internal page' }
    return { state: 'unknown', reason: 'unclear page' }
  }
  return { state: 'unknown', reason: `HTTP ${r.status}` }
}

/** La cuenta con la raíz del Moodle en otro host del mismo sitio, si la página lo prueba (ver `moodleAliasRoot`). */
function moodleAliasAccount(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string, html: string): Pick<PlatformAccount, 'kind' | 'baseURL'> | null {
  const root = moodleAliasRoot(account, url, html)
  return root ? { kind: account.kind, baseURL: root + '/' } : null
}

/** Página interna de Moodle: «iniciada» solo con la prueba de un usuario de verdad (un invitado no la tiene). */
function moodlePageVerdict(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string, body: string): SessionVerdict {
  const proof = moodleUserProof(body)
  // /my/ manda a los invitados a la portada con «redirect=0»
  if (!proof && isMoodleFrontPageRedirect0(account, url)) return { state: 'signedOut', reason: 'guest session' }
  const page = classifyAuthPage({ url, account, html: body, hasPasswordField: hasPasswordInput(body) })
  if (page === 'login' || page === 'sso') return { state: 'signedOut', reason: 'sign-in page' }
  if (page !== 'authenticated') return { state: 'unknown', reason: 'unclear page' }
  return proof ? { state: 'signedIn', reason: 'internal page' } : { state: 'unknown', reason: 'no user proof' }
}

/** ¿Es la portada de Moodle (raíz, `/` o `/index.php`) con `redirect=0`? */
function isMoodleFrontPageRedirect0(account: Pick<PlatformAccount, 'kind' | 'baseURL'>, url: string): boolean {
  let u: URL
  let rootPath: string
  try {
    u = new URL(url)
    rootPath = new URL(platformRoot('moodle', account.baseURL)).pathname.replace(/\/+$/, '').toLowerCase()
  } catch {
    return false
  }
  if (u.searchParams.get('redirect') !== '0') return false
  const path = u.pathname.toLowerCase()
  if (!path.startsWith(rootPath)) return false
  return ['', '/', '/index.php'].includes(path.slice(rootPath.length))
}

function jsonVerdict(kind: PlatformKind, data: unknown): SessionVerdict {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'unknown', reason: 'unexpected JSON' }
  const o = data as Record<string, unknown>
  switch (kind) {
    case 'canvas':
      if (o.status === 'unauthenticated' || o.errors) return { state: 'signedOut', reason: 'Canvas: unauthenticated' }
      return o.id != null ? { state: 'signedIn', reason: 'Canvas: users/self' } : { state: 'unknown', reason: 'Canvas: no id' }
    case 'brightspace':
      return o.Identifier != null || o.UniqueName != null ? { state: 'signedIn', reason: 'Brightspace: whoami' } : { state: 'unknown', reason: 'Brightspace: no id' }
    case 'sakai':
      // sin sesión, Sakai devuelve una sesión anónima con userEid nulo
      if (o.userEid == null && o.userId == null) return { state: 'signedOut', reason: 'Sakai: anonymous session' }
      return { state: 'signedIn', reason: 'Sakai: session' }
    case 'openedx':
      return typeof o.username === 'string' ? { state: 'signedIn', reason: 'Open edX: me' } : { state: 'unknown', reason: 'Open edX: no user' }
    case 'blackboard':
      return o.id != null || o.userName != null ? { state: 'signedIn', reason: 'Blackboard: users/me' } : { state: 'unknown', reason: 'Blackboard: no id' }
    default:
      return { state: 'unknown', reason: 'JSON' }
  }
}

// MARK: «Recordarme»

/**
 * Casillas «Recordarme» / «Mantener la sesión iniciada» que Aula marca en la página de acceso (nunca escribe nada ni pulsa
 * botones: solo marca la casilla; el estudiante puede desmarcarla). Selectores CSS.
 */
export const REMEMBER_ME_SELECTORS = [
  'input[type=checkbox][name="pseudonym_session[remember_me]"]', // Canvas
  'input[type=checkbox]#pseudonym_session_remember_me',
  'input[type=checkbox][name="rememberMe"]', 'input[type=checkbox][name="remember_me"]', 'input[type=checkbox][name="remember"]',
  'input[type=checkbox][name="persistent"]', 'input[type=checkbox][name="RememberMe"]', 'input[type=checkbox]#rememberMe',
  'input[type=checkbox][name="staySignedIn"]', 'input[type=checkbox][name="stay_signed_in"]', 'input[type=checkbox][name="keepMeLoggedIn"]'
]

/** ¿El texto de la etiqueta de una casilla es un «recordarme»? (para las que no tienen un nombre conocido). */
export function isRememberMeLabel(label: string): boolean {
  const s = label.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '')
  // Moodle «Recordar nombre de usuario» solo recuerda el usuario: no sirve (y no se toca)
  if (/(nombre de usuario|username|user name|usuario)$/.test(s.trim())) return false
  return /(remember me|keep me (signed|logged) in|stay signed in|recordarme|recuerdame|mantener (la )?sesion|mantenerme conectad|no cerrar sesion|seguir conectad|lembrar de mim|se souvenir de moi|angemeldet bleiben|ricordami)/.test(s)
}
