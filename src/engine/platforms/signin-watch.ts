// Vigilancia de la ventana de inicio de sesión: junta señales y decide CUÁNDO comprobar la sesión y CUÁNDO darla por
// iniciada. Señales: las direcciones por las que pasa (también las redirecciones y las ventanas emergentes del SSO), el
// estado de cada página (campo de contraseña, marcas de acceso o de sesión en el DOM ya pintado por JavaScript), las cookies
// de sesión de la plataforma que cambian y, como prueba, la comprobación de solo lectura con la sesión (API o página
// interna). También: los pasos de Moodle tras el acceso (la ventana espera a que el estudiante los termine), el Moodle de
// la cuenta en otro host del mismo sitio (alias) y los bucles de redirecciones. Puro (sin Electron ni DOM): lo usa
// src/main/electron/browser/signin.ts y se prueba aquí.
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import { isIdentityHost } from './identity'
import { accountContains, hostMatches, hostOf, platformInfo } from './model'
import { classifyAuthPage, htmlShowsSignedIn, isAccountLoginURL, isPostLoginStep, type PageAuthKind } from './login'
import { extractMoodleConfig, moodleBodyNotLoggedIn, moodleUserProof } from './moodle'
import { moodleAliasRoot } from './site'

export type VerifyState = 'signedIn' | 'signedOut' | 'unknown'

type Account = Pick<PlatformAccount, 'kind' | 'baseURL'>

/** Tipos cuya comprobación con la sesión es fiable (API que contesta 401 sin sesión o página interna que redirige al acceso). */
export const RELIABLE_SESSION_CHECK: ReadonlySet<PlatformKind> = new Set<PlatformKind>(['canvas', 'brightspace', 'openedx', 'sakai', 'blackboard', 'moodle'])

// MARK: Cookies de sesión

/** Nombres de las cookies de sesión típicas de cada plataforma (solo nombres: los valores no se miran nunca). */
const SESSION_COOKIES: Partial<Record<PlatformKind, RegExp>> = {
  canvas: /^(_normandy_session|_legacy_normandy_session|canvas_session|log_session_id|pseudonym_credentials)$/,
  moodle: /^MoodleSession/i,
  blackboard: /^(BbRouter|JSESSIONID|s_session_id|session_id)$/,
  brightspace: /^(d2lSessionVal|d2lSecureSessionVal)$/,
  sakai: /^(SAKAI2SESSIONID|JSESSIONID)$/,
  schoology: /^S?SESS[0-9a-f]+$/,
  openedx: /^(edxloggedin|sessionid|edx-user-info)$/,
  itslearning: /^(\.ASPXAUTH.*|ASP\.NET_SessionId|login)$/i,
  classroom: /^(SID|__Secure-1PSID|__Secure-3PSID|SAPISID|OSID)$/,
  teams: /^(ESTSAUTH|ESTSAUTHPERSISTENT|skypetoken_asm|authtoken)$/
}
/** Para cualquier otra página: nombres que suelen ser de sesión. */
const GENERIC_SESSION_COOKIE = /(sess|session|auth|token|login|^sid$|^jsessionid$)/i

/** Dominios donde viven las cookies de las plataformas que inician sesión con la cuenta de Google o de Microsoft. */
const ACCOUNT_COOKIE_DOMAINS: Partial<Record<PlatformKind, string[]>> = {
  classroom: ['*.google.com'],
  teams: ['*.microsoftonline.com', '*.microsoft.com', '*.skype.com', '*.cloud.microsoft']
}

/** ¿El dominio de la cookie alcanza a la plataforma? (`.uni.edu` vale para `canvas.uni.edu`; los hosts en la nube también). */
function cookieDomainTouchesAccount(account: Account, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\./, '')
  if (!d) return false
  const mine = hostOf(account.baseURL) ?? ''
  if (mine && (mine === d || mine.endsWith('.' + d))) return true
  const patterns = [...platformInfo(account.kind).hostPatterns, ...(ACCOUNT_COOKIE_DOMAINS[account.kind] ?? [])]
  return patterns.some((p) => hostMatches(d, p))
}

/** ¿Es una cookie de sesión de esta plataforma? (cambia al iniciar sesión: buena señal para comprobar YA). */
export function isPlatformSessionCookie(account: Account, cookie: { name: string; domain?: string | null }): boolean {
  if (!cookie.name || !cookieDomainTouchesAccount(account, cookie.domain ?? '')) return false
  const known = SESSION_COOKIES[account.kind]
  return known ? known.test(cookie.name) : GENERIC_SESSION_COOKIE.test(cookie.name)
}

// MARK: Marcas en el DOM

/** Enlaces o formularios de salida: solo los tiene una página con la sesión iniciada. */
const GENERIC_SIGNED_IN_SELECTORS = [
  'a[href*="logout" i]', 'a[href*="log_out" i]', 'a[href*="log-out" i]', 'a[href*="logoff" i]', 'a[href*="signout" i]', 'a[href*="sign_out" i]',
  'a[href*="sign-out" i]', 'form[action*="logout" i]', '[data-action="logout" i]'
]

const SIGNED_IN_SELECTORS: Partial<Record<PlatformKind, string[]>> = {
  canvas: ['#global_nav_profile_link', '#global_nav_dashboard_link', '[data-testid="global-nav-profile-link"]'],
  moodle: ['a[href*="login/logout.php?sesskey="]', '#user-menu-toggle', '.usermenu .userbutton'],
  blackboard: ['#global-nav-link', 'a[href*="/webapps/login/?action=logout"]', 'bb-base-navigation', '#base_tools'],
  brightspace: ['d2l-navigation-s-personal-menu', 'a[href*="/d2l/logout"]'],
  sakai: ['a[href*="/portal/logout"]', '#loginUser', '.Mrphs-userNav__submenuitem--username'],
  schoology: ['a[href="/logout"]', '[data-sgy-sitenav="header-my-account-menu"]'],
  openedx: ['.user-dropdown', '[data-testid="user-dropdown"]'],
  classroom: ['a[href*="accounts.google.com/SignOutOptions"]', 'a[aria-label^="Google Account"]', 'a[aria-label^="Cuenta de Google"]'],
  teams: ['[data-tid="app-bar"]', '#app-bar', '[data-tid="me-control-avatar-trigger"]', 'button[data-tid="me-control-avatar"]']
}

const SIGNED_OUT_SELECTORS: Partial<Record<PlatformKind, string[]>> = {
  canvas: ['#login_form', '.ic-Login', 'body.ic-Login-Body'],
  // sin «body#page-login-index»: también lo lleva la página «Ya has iniciado sesión» (que SÍ tiene sesión)
  moodle: ['body.notloggedin', 'form#login'],
  blackboard: ['#loginForm', 'form[name="login"]', '#entry-login'],
  brightspace: ['d2l-login', 'form[action*="/d2l/lp/auth/login"]'],
  sakai: ['#loginLink1', 'form#loginForm'],
  openedx: ['form#login'],
  itslearning: ['.itsl-login']
}

/** Selectores que el guion de la página busca (también dentro de shadow DOM) para saber si ya hay sesión. */
export function signInSelectors(kind: PlatformKind): { signedIn: string[]; signedOut: string[] } {
  return { signedIn: [...(SIGNED_IN_SELECTORS[kind] ?? []), ...GENERIC_SIGNED_IN_SELECTORS], signedOut: SIGNED_OUT_SELECTORS[kind] ?? [] }
}

// MARK: Una página

/** Lo que el guion cuenta de una página (sin contraseñas ni valores de campos). */
export interface SignInPageState {
  url: string
  hasPassword?: boolean
  /** Principio del HTML (para las marcas del servidor). */
  html?: string | null
  /** Hay en el DOM un control que solo existe con la sesión iniciada (menú del usuario, «Cerrar sesión»…). */
  signedInHint?: boolean
  /** Hay un formulario o marca de acceso (sin sesión). */
  signedOutHint?: boolean
}

export interface PageVerdict {
  kind: PageAuthKind
  /** Prueba en la propia página (DOM o HTML) de que hay sesión, además de estar en la plataforma. */
  strong: boolean
  /** Paso de Moodle tras el acceso (política, perfil): hay sesión, pero el estudiante aún tiene que terminarlo aquí. */
  step?: boolean
}

/** ¿Qué es esta página para el inicio de sesión? Junta la dirección, el campo de contraseña, el HTML y el DOM ya pintado. */
export function classifySignInPage(account: Account, p: SignInPageState): PageVerdict {
  // un paso tras el acceso cuenta como acceso: la ventana sigue esperando (y nada la da por iniciada)
  if (isPostLoginStep(account, p.url)) return { kind: 'login', strong: false, step: true }
  if (showsMoodleAlreadySignedIn(account, p)) return { kind: 'authenticated', strong: true }
  const base = classifyAuthPage({ url: p.url, account, hasPasswordField: p.hasPassword, html: p.html })
  if (base === 'sso' || base === 'login' || base === 'unknown') return { kind: base, strong: false }
  if (p.signedOutHint && !p.signedInHint) return { kind: 'login', strong: false }
  const strong = !!p.signedInHint || (!!p.html && htmlShowsSignedIn(account.kind, p.html))
  return { kind: 'authenticated', strong }
}

/** Formulario de acceso de Moodle (`form#login`) y campos de contraseña en el HTML. */
const MOODLE_LOGIN_FORM = /<form\b[^>]*\bid\s*=\s*["']?login["'\s>]/i
const PASSWORD_INPUT = /<input[^>]+type\s*=\s*["']?password/i

function isMoodleLoginIndex(url: string): boolean {
  try {
    return /\/login\/(index\.php)?$/.test(new URL(url).pathname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Página «Ya has iniciado sesión» de Moodle (`/login/index.php` con la sesión viva; su botón principal CIERRA la sesión):
 * trae la prueba de salida y ninguna marca de acceso (ni `notloggedin`, ni `form#login`, ni contraseña).
 */
function showsMoodleAlreadySignedIn(account: Account, p: SignInPageState): boolean {
  if (account.kind !== 'moodle' || !accountContains(account, p.url) || !isMoodleLoginIndex(p.url)) return false
  const html = p.html ?? ''
  const proof = !!p.signedInHint || moodleUserProof(html)
  const loginMarks = !!p.signedOutHint || !!p.hasPassword || moodleBodyNotLoggedIn(html) || MOODLE_LOGIN_FORM.test(html) || PASSWORD_INPUT.test(html)
  return proof && !loginMarks
}

/** ¿Es un paso del inicio de sesión (SSO o página de acceso)? En el host de la plataforma solo cuentan sus rutas de acceso. */
export function isSignInStep(account: Account, url: string): boolean {
  const h = hostOf(url)
  if (!h || !/^https?:/i.test(url)) return false
  if (!accountContains(account, url) && isIdentityHost(h)) return true
  return isAccountLoginURL(account, url)
}

// MARK: La vigilancia

export interface SignInWatchOptions {
  now?: () => number
  /** Mínimo entre dos comprobaciones cuando algo cambió (ms). */
  minGapMs?: number
  /** Entre comprobaciones del sondeo cuando nada cambió (ms). */
  pollGapMs?: number
}

/** Por qué se da la sesión por iniciada (registro y pruebas). */
export type AcceptReason = 'verified' | 'page-proof' | 'confirmed-by-student'

/** Clave de la ventana principal: la única cuyas direcciones cuentan para los bucles (las emergentes del SSO no). */
export const MAIN_SIGNIN_WINDOW = 'main'
/**
 * Un bucle: se entra por el mismo paso de acceso o de identidad más de `LOOP_MAX_VISITS` veces en `LOOP_WINDOW_MS`. Solo
 * cuenta la ENTRADA en una zona (identidad o acceso de la plataforma): una pasada normal de auth_oidc (/login/index.php →
 * /auth/oidc/ → Microsoft → /auth/oidc/ → /login/index.php) entra una vez en cada una aunque pase dos veces por la misma ruta.
 */
const LOOP_WINDOW_MS = 60_000
const LOOP_MAX_VISITS = 3
const MAX_HOPS = 200

/** Host y ruta (sin consulta ni fragmento) de una dirección web; null si no lo es. */
function hopKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return (u.host + u.pathname).toLowerCase()
  } catch {
    return null
  }
}

export class SignInWatch {
  private sawLogin = false
  private readonly pages = new Map<string, PageVerdict & { url: string }>()
  private changes = 0
  private verifiedAt = -Infinity
  private verifiedChanges = -1
  private lastURL = ''
  private readonly now: () => number
  private readonly reliable: boolean
  /** Moodle de la cuenta en otro host del mismo sitio (la dirección guardada era un alias o un portal). */
  private alias: Account | null = null
  /** El propio host de la cuenta ya se vio como un Moodle de verdad: no se adopta otro. */
  private ownHostIsMoodle = false
  /** Saltos de la ventana principal (host y ruta) con su hora; `entry`: entró ahí en una zona del acceso (cuenta para bucles). */
  private hops: { key: string; at: number; entry: boolean }[] = []
  private lastMainHop = ''
  private lastZone: 'identity' | 'login' | null = null

  constructor(private readonly account: Account, private readonly opts: SignInWatchOptions = {}) {
    this.now = opts.now ?? Date.now
    this.reliable = RELIABLE_SESSION_CHECK.has(account.kind)
  }

  /** ¿Se vio ya algún paso del inicio de sesión (SSO, acceso, contraseña)? */
  get loginSeen(): boolean {
    return this.sawLogin
  }

  /** ¿Alguna ventana abierta muestra un paso de Moodle tras el acceso (política, perfil)? Entonces no se cierra. */
  get pendingStep(): boolean {
    for (const p of this.pages.values()) if (p.step) return true
    return false
  }

  /** Raíz (`https://host[/carpeta]`, sin barra final) del Moodle adoptado en otro host del mismo sitio; null si no hay. */
  get adoptedRoot(): string | null {
    return this.alias ? this.alias.baseURL.replace(/\/+$/, '') : null
  }

  /** ¿La ventana principal parece en un bucle? (se entra por el mismo paso de acceso o de identidad más de 3 veces en 60 s). */
  get loopSuspected(): boolean {
    const now = this.now()
    const seen = new Map<string, number>()
    for (const h of this.hops) {
      if (!h.entry || now - h.at >= LOOP_WINDOW_MS) continue
      const n = (seen.get(h.key) ?? 0) + 1
      if (n > LOOP_MAX_VISITS) return true
      seen.set(h.key, n)
    }
    return false
  }

  /** Los saltos recientes de la ventana principal (host y ruta, sin consultas), para el registro. */
  recentHops(): string[] {
    const now = this.now()
    return this.hops.filter((h) => now - h.at < LOOP_WINDOW_MS).map((h) => h.key)
  }

  /** ¿La dirección es de la plataforma (la cuenta o el alias adoptado)? */
  isPlatformURL(url: string): boolean {
    return accountContains(this.account, url) || (!!this.alias && accountContains(this.alias, url))
  }

  /** `isSignInStep` sabiendo del alias adoptado. */
  isSignInStepURL(url: string): boolean {
    return isSignInStep(this.accountFor(url), url)
  }

  /** La cuenta con la que se mira una dirección: la del alias si es de su host. */
  private accountFor(url: string): Account {
    if (this.alias && accountContains(this.alias, url) && !accountContains(this.account, url)) return this.alias
    return this.account
  }

  /**
   * Una dirección por la que pasa cualquier ventana (navegación, redirección o emergente). `windowKey`:
   * `MAIN_SIGNIN_WINDOW` para la principal (solo esas cuentan para los bucles).
   */
  noteURL(url: string, windowKey?: string): void {
    if (!url) return
    if (windowKey === MAIN_SIGNIN_WINDOW) this.noteMainHop(url)
    if (url === this.lastURL) return
    this.lastURL = url
    this.changes++
    if (this.isSignInStepURL(url)) this.sawLogin = true
  }

  /** Un salto de la principal: solo cuando cambian el host o la ruta (las navegaciones dentro de la página no cuentan). */
  private noteMainHop(url: string): void {
    const key = hopKey(url)
    if (!key || key === this.lastMainHop) return
    this.lastMainHop = key
    const zone = this.zoneOf(url)
    const entry = zone !== null && zone !== this.lastZone
    this.lastZone = zone
    const at = this.now()
    this.hops = this.hops.filter((h) => at - h.at < LOOP_WINDOW_MS).slice(-MAX_HOPS + 1)
    this.hops.push({ key, at, entry })
  }

  /** Zona del acceso de una dirección: el proveedor de identidad, las páginas de acceso de la plataforma, o ninguna. */
  private zoneOf(url: string): 'identity' | 'login' | null {
    if (!this.isSignInStepURL(url)) return null
    return !this.isPlatformURL(url) && isIdentityHost(hostOf(url) ?? '') ? 'identity' : 'login'
  }

  /** Cambió una cookie: true si es de sesión de la plataforma (y entonces conviene comprobar ya). */
  noteCookie(cookie: { name: string; domain?: string | null }): boolean {
    const mine = isPlatformSessionCookie(this.account, cookie) || (!!this.alias && isPlatformSessionCookie(this.alias, cookie))
    if (!mine) return false
    this.changes++
    return true
  }

  /** Estado de la página de una ventana (`windowKey`: la principal o una emergente). */
  notePage(windowKey: string, state: SignInPageState): PageVerdict {
    this.maybeAdoptAlias(state)
    this.noteURL(state.url, windowKey)
    const v = classifySignInPage(this.accountFor(state.url), state)
    if (v.kind === 'login' || v.kind === 'sso' || state.hasPassword) this.sawLogin = true
    const prev = this.pages.get(windowKey)
    if (!prev || prev.kind !== v.kind || prev.strong !== v.strong || prev.url !== state.url || !!prev.step !== !!v.step) this.changes++
    this.pages.set(windowKey, { ...v, url: state.url })
    return v
  }

  /**
   * Moodle: una página de OTRO host del mismo sitio (no de identidad) cuyo `wwwroot` es su propio host es el Moodle de la
   * cuenta (la dirección guardada era un alias o un portal). Se adopta una sola vez, y nunca si el host de la cuenta ya
   * resultó ser un Moodle de verdad.
   */
  private maybeAdoptAlias(state: SignInPageState): void {
    if (this.account.kind !== 'moodle' || this.alias || !state.html) return
    if (accountContains(this.account, state.url)) {
      const www = extractMoodleConfig(state.html).wwwroot
      if (www && hostOf(www) === hostOf(state.url)) this.ownHostIsMoodle = true
      return
    }
    if (this.ownHostIsMoodle) return
    const root = moodleAliasRoot(this.account, state.url, state.html)
    if (!root) return
    this.alias = { kind: this.account.kind, baseURL: root + '/' }
    this.changes++
  }

  /** La ventana se cerró: su página ya no cuenta. */
  forgetWindow(windowKey: string): void {
    if (this.pages.delete(windowKey)) this.changes++
  }

  /** La mejor página abierta: con prueba de sesión, después interna, después cualquiera. */
  private best(): (PageVerdict & { url: string }) | null {
    let best: (PageVerdict & { url: string }) | null = null
    const rank = (p: PageVerdict): number => (p.kind === 'authenticated' ? (p.strong ? 3 : 2) : 0)
    for (const p of this.pages.values()) if (!best || rank(p) > rank(best)) best = p
    return best
  }

  /** ¿Toca comprobar con la sesión ahora? Con `force` (el estudiante dice que ya entró), siempre. */
  wantsVerify(force = false): boolean {
    if (force) return true
    const page = this.best()
    if (!page || page.kind !== 'authenticated') return false
    // en una página que no es de una plataforma con comprobación fiable hace falta haber visto el acceso o una prueba
    if (!this.reliable && !this.sawLogin && !page.strong) return false
    const gap = this.now() - this.verifiedAt
    if (this.changes !== this.verifiedChanges) return gap >= (this.opts.minGapMs ?? 900)
    return gap >= (this.opts.pollGapMs ?? 5000)
  }

  /** Se va a comprobar (para espaciar las comprobaciones). */
  markVerifying(): void {
    this.verifiedAt = this.now()
    this.verifiedChanges = this.changes
  }

  /** Con el resultado de la comprobación: ¿sesión iniciada? (null = aún no). */
  accept(state: VerifyState, force = false): AcceptReason | null {
    if (state === 'signedOut') return null
    // con un paso tras el acceso a la vista, nunca (tampoco con «Ya he iniciado sesión» ni con la comprobación fiable)
    if (this.pendingStep) return null
    const page = this.best()
    const onPlatform = page?.kind === 'authenticated'
    const strong = !!page?.strong
    if (state === 'signedIn') {
      if (this.reliable) return 'verified'
      // sin comprobación fiable (Classroom, Teams, cualquier página), la página tiene que ser interna y haberse visto el acceso
      if (onPlatform && (this.sawLogin || strong || force)) return force && !this.sawLogin && !strong ? 'confirmed-by-student' : 'verified'
      return null
    }
    // sin respuesta clara de la comprobación (API cerrada, red…): basta la prueba en la propia página tras el acceso
    if (strong && (this.sawLogin || force || this.reliable)) return 'page-proof'
    if (force && onPlatform && !this.reliable) return 'confirmed-by-student'
    return null
  }
}
