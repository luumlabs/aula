// Vigilancia de la ventana de inicio de sesión: junta señales y decide CUÁNDO comprobar la sesión y CUÁNDO darla por
// iniciada. Señales: las direcciones por las que pasa (también las redirecciones y las ventanas emergentes del SSO), el
// estado de cada página (campo de contraseña, marcas de acceso o de sesión en el DOM ya pintado por JavaScript), las cookies
// de sesión de la plataforma que cambian y, como prueba, la comprobación de solo lectura con la sesión (API o página
// interna). Puro (sin Electron ni DOM): lo usa src/main/electron/browser/signin.ts y se prueba aquí.
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import { accountContains, hostMatches, hostOf, platformInfo } from './model'
import { classifyAuthPage, htmlShowsSignedIn, isAccountLoginURL, isIdentityHost, type PageAuthKind } from './login'

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
  moodle: ['body#page-login-index', 'body.notloggedin', 'form#login'],
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
}

/** ¿Qué es esta página para el inicio de sesión? Junta la dirección, el campo de contraseña, el HTML y el DOM ya pintado. */
export function classifySignInPage(account: Account, p: SignInPageState): PageVerdict {
  const base = classifyAuthPage({ url: p.url, account, hasPasswordField: p.hasPassword, html: p.html })
  if (base === 'sso' || base === 'login' || base === 'unknown') return { kind: base, strong: false }
  if (p.signedOutHint && !p.signedInHint) return { kind: 'login', strong: false }
  const strong = !!p.signedInHint || (!!p.html && htmlShowsSignedIn(account.kind, p.html))
  return { kind: 'authenticated', strong }
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

export class SignInWatch {
  private sawLogin = false
  private readonly pages = new Map<string, PageVerdict & { url: string }>()
  private changes = 0
  private verifiedAt = -Infinity
  private verifiedChanges = -1
  private lastURL = ''
  private readonly now: () => number
  private readonly reliable: boolean

  constructor(private readonly account: Account, private readonly opts: SignInWatchOptions = {}) {
    this.now = opts.now ?? Date.now
    this.reliable = RELIABLE_SESSION_CHECK.has(account.kind)
  }

  /** ¿Se vio ya algún paso del inicio de sesión (SSO, acceso, contraseña)? */
  get loginSeen(): boolean {
    return this.sawLogin
  }

  /** Una dirección por la que pasa cualquier ventana (navegación, redirección o emergente). */
  noteURL(url: string): void {
    if (!url || url === this.lastURL) return
    this.lastURL = url
    this.changes++
    if (isSignInStep(this.account, url)) this.sawLogin = true
  }

  /** Cambió una cookie: true si es de sesión de la plataforma (y entonces conviene comprobar ya). */
  noteCookie(cookie: { name: string; domain?: string | null }): boolean {
    if (!isPlatformSessionCookie(this.account, cookie)) return false
    this.changes++
    return true
  }

  /** Estado de la página de una ventana (`windowKey`: la principal o una emergente). */
  notePage(windowKey: string, state: SignInPageState): PageVerdict {
    this.noteURL(state.url)
    const v = classifySignInPage(this.account, state)
    if (v.kind === 'login' || v.kind === 'sso' || state.hasPassword) this.sawLogin = true
    const prev = this.pages.get(windowKey)
    if (!prev || prev.kind !== v.kind || prev.strong !== v.strong || prev.url !== state.url) this.changes++
    this.pages.set(windowKey, { ...v, url: state.url })
    return v
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
