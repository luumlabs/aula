// Inicio de sesión: reconocer páginas de acceso y de SSO, decidir si una cuenta sigue con la sesión iniciada y qué dirección
// barata sirve para comprobarlo (y para mantenerla viva). Puro: lo usan la ventana de inicio de sesión, la comprobación en
// segundo plano y las pruebas.
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import { accountContains, hostOf, joinRoot, platformRoot } from './model'

// MARK: Proveedores de identidad (SSO)

/** Hosts exactos o dominios (`*.x`) de proveedores de identidad. */
const IDENTITY_HOSTS = [
  'login.microsoftonline.com', 'login.microsoft.com', 'login.windows.net', 'login.live.com', 'account.live.com', 'sts.windows.net',
  'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com', 'idmsa.apple.com',
  '*.okta.com', '*.oktapreview.com', '*.okta-emea.com', '*.auth0.com', '*.duosecurity.com', '*.onelogin.com', '*.pingone.com', '*.pingidentity.com',
  '*.clever.com', 'clever.com', 'launchpad.classlink.com', '*.classlink.com', '*.cirrusidentity.com', 'wayf.surfnet.nl', '*.eduroam.org',
  'idp.rediris.es', '*.gakunin.jp', '*.ukfederation.org.uk', '*.incommon.org', '*.b2clogin.com', '*.ciamlogin.com', 'authn.edx.org'
]
/** Primeras etiquetas del host típicas de un servidor de identidad propio (sso.uni.edu, idp.uni.edu, cas.uni.edu…). */
const IDENTITY_PREFIXES = ['sso', 'idp', 'cas', 'shibboleth', 'shib', 'adfs', 'fs', 'sts', 'login', 'auth', 'weblogin', 'websso', 'wayf', 'signin', 'secure-login', 'identity', 'iam', 'accounts', 'passport']

/** ¿Es el host de un proveedor de inicio de sesión único (Microsoft, Google, Okta, Shibboleth, CAS, ADFS…)? */
export function isIdentityHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!h) return false
  for (const p of IDENTITY_HOSTS) {
    if (p.startsWith('*.')) {
      const base = p.slice(2)
      if (h === base || h.endsWith('.' + base)) return true
    } else if (h === p) return true
  }
  const first = h.split('.')[0] ?? ''
  if (h.split('.').length >= 3 && IDENTITY_PREFIXES.includes(first)) return true
  return h.includes('shibboleth') || /(^|[.-])(sso|idp|adfs)([.-]|$)/.test(h)
}

// MARK: Páginas de inicio de sesión

/** Rutas de acceso genéricas (SAML, CAS, OAuth, Shibboleth…). */
const GENERIC_LOGIN_PATHS = [
  /^\/log[-_]?in(\/|$|\.|\?)/, /^\/sign[-_]?in(\/|$)/, /^\/signon/, /^\/logon/, /^\/auth(\/|$)/, /\/saml2?(\/|$)/, /\/sso(\/|$)/, /^\/cas\/login/, /\/cas\/login/,
  /^\/idp\//, /\/shibboleth\.sso\//, /\/oauth2?\/(authorize|v2\.0\/authorize|auth)/, /^\/adfs\/ls/, /\/simplesaml\//, /\/profile\/saml2\//, /\/session\/new/
]

/** Rutas de acceso de cada plataforma. */
const PLATFORM_LOGIN_PATHS: Partial<Record<PlatformKind, RegExp[]>> = {
  canvas: [/^\/login(\/|$)/],
  moodle: [/\/login\/index\.php/, /\/login\/signup\.php/, /\/login\/forgot_password\.php/, /\/auth\/(saml2|shibboleth|oidc|cas|oauth2)\//, /\/admin\/tool\/mfa\//],
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
/** Marcas de una página SIN sesión (aunque no tenga campo de contraseña visible, p. ej. un botón «Acceder con SSO»). */
const SIGNED_OUT_HTML: Partial<Record<PlatformKind, RegExp[]>> = {
  canvas: [/"current_user_id"\s*:\s*null/, /ic-Login-Body/i, /id="login_form"/],
  moodle: [/id="page-login-index"/, /\bnotloggedin\b/, /id="login"[^>]*action="[^"]*login\/index\.php/],
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
  if (input.hasPasswordField) return 'login'
  const html = input.html ?? ''
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
  return (SIGNED_OUT_HTML[kind] ?? []).some((r) => r.test(html))
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
      return [{ url: joinRoot(root, '/my/'), expect: 'page' }]
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

/** Lo que se sabe de una respuesta (sin el cuerpo completo: basta un trozo). */
export interface SessionProbeResponse {
  status: number
  /** Dirección final tras seguir las redirecciones. */
  finalURL: string
  /** Saltos de redirección (sin la primera dirección). */
  redirects: string[]
  contentType?: string | null
  /** Primeros ~200 KB del cuerpo. */
  body?: string
}

export type SessionState = 'signedIn' | 'signedOut' | 'unknown'

export interface SessionVerdict {
  state: SessionState
  /** Motivo en inglés (registro y depuración; nunca lleva cookies ni el cuerpo). */
  reason: string
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
  if (r.status === 401) return { state: 'signedOut', reason: 'HTTP 401' }
  if (r.status === 407 || r.status === 429 || r.status >= 500) return { state: 'unknown', reason: `HTTP ${r.status}` }
  const body = r.body ?? ''
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
    if (!accountContains(account, r.finalURL) && kind !== 'other') return { state: 'unknown', reason: 'ended on another site' }
    const page = classifyAuthPage({ url: r.finalURL, account, html: body, hasPasswordField: hasPasswordInput(body) })
    if (page === 'login' || page === 'sso') return { state: 'signedOut', reason: 'sign-in page' }
    if (page === 'authenticated') return { state: 'signedIn', reason: 'internal page' }
    return { state: 'unknown', reason: 'unclear page' }
  }
  return { state: 'unknown', reason: `HTTP ${r.status}` }
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
