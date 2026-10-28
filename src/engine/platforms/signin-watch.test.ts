import { describe, expect, it } from 'vitest'
import { classifyAuthPage, interpretSessionCheck, isAccountLoginURL, sessionCheckTargets } from './login'
import { SignInWatch, classifySignInPage, isPlatformSessionCookie, isSignInStep, signInSelectors } from './signin-watch'

const canvas = { kind: 'canvas' as const, baseURL: 'https://canvas.uni.edu/' }
const moodle = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu/moodle/' }
const bb = { kind: 'blackboard' as const, baseURL: 'https://learn.uni.edu/' }
const teams = { kind: 'teams' as const, baseURL: 'https://teams.microsoft.com/' }
const other = { kind: 'other' as const, baseURL: 'https://profe.uni.edu/curso/' }

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('pasos del inicio de sesión', () => {
  it('reconoce el SSO aunque esté en otro dominio y las rutas de acceso de la plataforma', () => {
    expect(isSignInStep(canvas, 'https://login.microsoftonline.com/abc/saml2?SAMLRequest=x')).toBe(true)
    expect(isSignInStep(canvas, 'https://sso.uni.edu/idp/profile/SAML2/Redirect/SSO')).toBe(true)
    expect(isSignInStep(canvas, 'https://canvas.uni.edu/login/saml')).toBe(true)
    expect(isSignInStep(moodle, 'https://cas.uni.edu/cas/login?service=x')).toBe(true)
    expect(isSignInStep(canvas, 'https://canvas.uni.edu/?login_success=1')).toBe(false)
    expect(isSignInStep(canvas, 'msteams://x')).toBe(false)
  })

  it('un campus cuyo host parece de un SSO no se toma por el SSO', () => {
    const odd = { kind: 'moodle' as const, baseURL: 'https://sso-campus.uni.edu/' }
    expect(isSignInStep(odd, 'https://sso-campus.uni.edu/my/')).toBe(false)
    expect(isAccountLoginURL(odd, 'https://sso-campus.uni.edu/my/')).toBe(false)
    expect(isAccountLoginURL(odd, 'https://sso-campus.uni.edu/login/index.php')).toBe(true)
    expect(classifyAuthPage({ url: 'https://sso-campus.uni.edu/my/', account: odd, html: '<a href="/login/logout.php?sesskey=1">x</a>' })).toBe('authenticated')
    // y la comprobación de la sesión no lo toma por una redirección al acceso
    const target = sessionCheckTargets(odd)[0]
    const v = interpretSessionCheck(odd, target, { status: 200, finalURL: 'https://sso-campus.uni.edu/my/', redirects: [], contentType: 'text/html', body: '<html><a href="/login/logout.php?sesskey=1">Salir</a></html>' })
    expect(v.state).toBe('signedIn')
  })
})

describe('cookies de sesión (solo nombres y dominios)', () => {
  it('las típicas de cada plataforma, en su host, en su dominio padre o en la nube', () => {
    expect(isPlatformSessionCookie(canvas, { name: '_normandy_session', domain: 'canvas.uni.edu' })).toBe(true)
    expect(isPlatformSessionCookie(canvas, { name: 'canvas_session', domain: '.uni.edu' })).toBe(true)
    expect(isPlatformSessionCookie({ kind: 'canvas', baseURL: 'https://example.instructure.com/' }, { name: 'log_session_id', domain: '.instructure.com' })).toBe(true)
    expect(isPlatformSessionCookie(moodle, { name: 'MoodleSessionCampus', domain: 'campus.uni.edu' })).toBe(true)
    expect(isPlatformSessionCookie(teams, { name: 'ESTSAUTHPERSISTENT', domain: '.login.microsoftonline.com' })).toBe(true)
    expect(isPlatformSessionCookie({ kind: 'classroom', baseURL: 'https://classroom.google.com/' }, { name: 'SID', domain: '.google.com' })).toBe(true)
    expect(isPlatformSessionCookie(other, { name: 'PHPSESSID', domain: 'profe.uni.edu' })).toBe(true)
  })

  it('no las de otros sitios ni las que no son de sesión', () => {
    expect(isPlatformSessionCookie(canvas, { name: '_normandy_session', domain: 'evil.com' })).toBe(false)
    expect(isPlatformSessionCookie(canvas, { name: '_ga', domain: '.uni.edu' })).toBe(false)
    expect(isPlatformSessionCookie(canvas, { name: 'ESTSAUTH', domain: 'login.microsoftonline.com' })).toBe(false)
    expect(isPlatformSessionCookie(moodle, { name: '', domain: 'campus.uni.edu' })).toBe(false)
  })
})

describe('estado de una página', () => {
  it('el panel pintado por JavaScript se reconoce por el DOM, no por el primer HTML', () => {
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/', html: '<div id="application">Cargando…</div>' })).toEqual({ kind: 'authenticated', strong: false })
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/', html: '<div></div>', signedInHint: true })).toEqual({ kind: 'authenticated', strong: true })
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/', html: '<script>ENV = {"current_user_id":"12"}</script>' }).strong).toBe(true)
  })

  it('formularios de acceso, contraseñas y el SSO no son sesión', () => {
    expect(classifySignInPage(moodle, { url: 'https://campus.uni.edu/moodle/', signedOutHint: true }).kind).toBe('login')
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/login/canvas', hasPassword: true }).kind).toBe('login')
    expect(classifySignInPage(canvas, { url: 'https://login.microsoftonline.com/x', signedInHint: true }).kind).toBe('sso')
    expect(classifySignInPage(canvas, { url: 'https://otra.com/', signedInHint: true }).kind).toBe('unknown')
  })

  it('selectores por plataforma y genéricos de «cerrar sesión»', () => {
    const s = signInSelectors('canvas')
    expect(s.signedIn).toContain('#global_nav_profile_link')
    expect(s.signedIn.some((x) => x.includes('logout'))).toBe(true)
    expect(signInSelectors('moodle').signedOut).toContain('body.notloggedin')
    expect(signInSelectors('other').signedOut).toEqual([])
  })
})

describe('SignInWatch', () => {
  it('Canvas con SAML: no comprueba en el SSO; al volver al panel, sí; la API confirma', () => {
    const c = clock()
    const w = new SignInWatch(canvas, { now: c.now })
    w.notePage('main', { url: 'https://canvas.uni.edu/login/saml' })
    w.noteURL('https://sso.uni.edu/idp/profile/SAML2/Redirect/SSO')
    w.notePage('main', { url: 'https://sso.uni.edu/idp/login', hasPassword: true })
    expect(w.loginSeen).toBe(true)
    expect(w.wantsVerify()).toBe(false)
    c.advance(5000)
    w.notePage('main', { url: 'https://canvas.uni.edu/?login_success=1', html: '<div>Cargando</div>' })
    expect(w.wantsVerify()).toBe(true)
    w.markVerifying()
    expect(w.accept('signedIn')).toBe('verified')
  })

  it('espacia las comprobaciones: enseguida si algo cambió, cada pocos segundos si no', () => {
    const c = clock()
    const w = new SignInWatch(canvas, { now: c.now, minGapMs: 900, pollGapMs: 5000 })
    w.notePage('main', { url: 'https://canvas.uni.edu/' })
    expect(w.wantsVerify()).toBe(true)
    w.markVerifying()
    expect(w.accept('signedOut')).toBeNull()
    c.advance(1000)
    expect(w.wantsVerify()).toBe(false)
    // una cookie de sesión nueva: a comprobar ya (tras el mínimo)
    expect(w.noteCookie({ name: '_normandy_session', domain: 'canvas.uni.edu' })).toBe(true)
    expect(w.wantsVerify()).toBe(true)
    w.markVerifying()
    c.advance(2000)
    expect(w.wantsVerify()).toBe(false)
    c.advance(3500)
    expect(w.wantsVerify()).toBe(true)
  })

  it('ventana emergente del SSO: cuenta como paso de acceso y la página principal sigue siendo la que vale', () => {
    const c = clock()
    const w = new SignInWatch(bb, { now: c.now })
    w.notePage('main', { url: 'https://learn.uni.edu/ultra/', html: '<div id="app"></div>' })
    w.markVerifying()
    expect(w.accept('signedOut')).toBeNull()
    w.notePage('popup-2', { url: 'https://idp.uni.edu/idp/popup', hasPassword: true })
    w.forgetWindow('popup-2')
    c.advance(1000)
    w.notePage('main', { url: 'https://learn.uni.edu/ultra/', html: '<div id="app"></div>', signedInHint: true })
    expect(w.wantsVerify()).toBe(true)
    expect(w.accept('signedIn')).toBe('verified')
  })

  it('sin respuesta clara de la API, basta la prueba en la página tras el acceso', () => {
    const w = new SignInWatch(bb)
    w.noteURL('https://login.microsoftonline.com/x')
    w.notePage('main', { url: 'https://learn.uni.edu/ultra/stream', signedInHint: true })
    expect(w.accept('unknown')).toBe('page-proof')
    const weak = new SignInWatch(bb)
    weak.noteURL('https://login.microsoftonline.com/x')
    weak.notePage('main', { url: 'https://learn.uni.edu/ultra/stream' })
    expect(weak.accept('unknown')).toBeNull()
  })

  it('Teams y las páginas sin comprobación fiable: hace falta ver el acceso y estar en una página interna', () => {
    const w = new SignInWatch(teams)
    w.notePage('main', { url: 'https://teams.microsoft.com/v2/' })
    // una página pública de una plataforma sin comprobación fiable: no se comprueba ni se acepta solo
    expect(w.wantsVerify()).toBe(false)
    expect(w.accept('signedIn')).toBeNull()
    w.notePage('main', { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', hasPassword: true })
    // en el SSO, aunque la comprobación (que en Teams no es fiable) diga que sí, no
    expect(w.accept('signedIn')).toBeNull()
    expect(w.accept('signedIn', true)).toBeNull()
    w.notePage('main', { url: 'https://teams.microsoft.com/v2/' })
    expect(w.wantsVerify()).toBe(true)
    expect(w.accept('signedIn')).toBe('verified')
  })

  it('«Ya he iniciado sesión»: comprueba siempre; en una página cualquiera lo da por bueno si es interna', () => {
    const w = new SignInWatch(other)
    w.notePage('main', { url: 'https://profe.uni.edu/curso/tema-1' })
    expect(w.wantsVerify()).toBe(false)
    expect(w.wantsVerify(true)).toBe(true)
    expect(w.accept('unknown', true)).toBe('confirmed-by-student')
    expect(w.accept('signedOut', true)).toBeNull()
    // en Canvas no basta con decirlo: la API manda
    const c = new SignInWatch(canvas)
    c.notePage('main', { url: 'https://canvas.uni.edu/' })
    expect(c.accept('unknown', true)).toBeNull()
    expect(c.accept('signedOut', true)).toBeNull()
  })
})
