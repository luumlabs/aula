import { describe, expect, it } from 'vitest'
import { classifyAuthPage, interpretSessionCheck, isAccountLoginURL, sessionCheckTargets } from './login'
import { MAIN_SIGNIN_WINDOW, SignInWatch, classifySignInPage, isPlatformSessionCookie, isSignInStep, signInSelectors } from './signin-watch'

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

// MARK: Moodle (issue #25)

const ROOT = 'https://campus.uni.edu/moodle'
const PROOF = `<a href="${ROOT}/login/logout.php?sesskey=Ab12Cd34Ef">Cerrar sesión</a>`
const cfg = (root: string): string => `<script>M.cfg = {"wwwroot":"${root.replace(/\//g, '\\/')}","sesskey":"Ab12Cd34Ef"};</script>`

describe('Moodle: pasos tras el acceso en la ventana', () => {
  const policy = `${ROOT}/admin/tool/policy/index.php`

  it('la política y el perfil son un paso (cuenta como acceso, no como sesión), aunque tengan el menú del usuario', () => {
    expect(classifySignInPage(moodle, { url: policy, signedInHint: true })).toEqual({ kind: 'login', strong: false, step: true })
    expect(classifySignInPage(moodle, { url: `${ROOT}/user/edit.php?id=5&course=1`, html: PROOF, signedInHint: true })).toEqual({ kind: 'login', strong: false, step: true })
    expect(classifySignInPage(moodle, { url: `${ROOT}/user/policy.php` }).step).toBe(true)
    // en otras plataformas, la misma ruta no es nada especial
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/user/edit.php' }).step).toBeUndefined()
    expect(isSignInStep(moodle, policy)).toBe(false)
  })

  it('con el paso a la vista nada la da por iniciada (ni la comprobación fiable, ni «Ya he iniciado sesión»); al terminar, sí', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    w.noteURL('https://login.microsoftonline.com/t/oauth2/v2.0/authorize?x=1', MAIN_SIGNIN_WINDOW)
    w.notePage('main', { url: policy, signedInHint: true })
    expect(w.pendingStep).toBe(true)
    expect(w.wantsVerify()).toBe(false)
    // core_session_touch funciona con la política pendiente: la comprobación diría «iniciada»
    expect(w.accept('signedIn')).toBeNull()
    expect(w.accept('signedIn', true)).toBeNull()
    expect(w.accept('unknown', true)).toBeNull()
    c.advance(10_000)
    w.notePage('main', { url: `${ROOT}/admin/tool/policy/view.php?versionid=2`, signedInHint: true })
    expect(w.accept('signedIn')).toBeNull()
    c.advance(10_000)
    w.notePage('main', { url: `${ROOT}/my/`, signedInHint: true })
    expect(w.pendingStep).toBe(false)
    expect(w.wantsVerify()).toBe(true)
    expect(w.accept('signedIn')).toBe('verified')
  })

  it('un paso en CUALQUIER ventana abierta lo para; al cerrarla, ya no', () => {
    const w = new SignInWatch(moodle)
    w.notePage('main', { url: `${ROOT}/my/`, html: PROOF, signedInHint: true })
    w.notePage('popup-3', { url: policy })
    expect(w.accept('signedIn')).toBeNull()
    expect(w.accept('unknown')).toBeNull()
    w.forgetWindow('popup-3')
    expect(w.pendingStep).toBe(false)
    expect(w.accept('signedIn')).toBe('verified')
  })
})

describe('Moodle: «Ya has iniciado sesión» en /login/index.php', () => {
  const login = `${ROOT}/login/index.php`
  // la confirmación de Moodle: el formulario de salida (POST, sesskey oculta) y el pie con la salida
  const already = `<html><head>${cfg(ROOT)}</head><body id="page-login-index" class="pagelayout-login path-login">
    <div class="box"><p>Ya ha iniciado sesión como Ana. Necesita salir antes de entrar con otro usuario.</p>
    <form method="post" action="${ROOT}/login/logout.php"><input type="hidden" name="sesskey" value="Ab12Cd34Ef"><button>Salir</button></form>
    <form method="get" action="${ROOT}/"><button>Cancelar</button></form></div><footer>${PROOF}</footer></body></html>`

  it('con la prueba (DOM o HTML) y ninguna marca de acceso: es una sesión, y fuerte', () => {
    expect(classifySignInPage(moodle, { url: login, signedInHint: true, signedOutHint: false })).toEqual({ kind: 'authenticated', strong: true })
    expect(classifySignInPage(moodle, { url: login, html: already, signedInHint: false, signedOutHint: false })).toEqual({ kind: 'authenticated', strong: true })
    expect(classifySignInPage(moodle, { url: `${ROOT}/login/`, signedInHint: true })).toEqual({ kind: 'authenticated', strong: true })
    const w = new SignInWatch(moodle)
    w.notePage('main', { url: login, html: already, signedInHint: true, signedOutHint: false })
    expect(w.wantsVerify()).toBe(true)
    expect(w.accept('signedIn')).toBe('verified')
    expect(w.accept('unknown')).toBe('page-proof')
  })

  it('la página de acceso de verdad sigue siendo acceso', () => {
    expect(classifySignInPage(moodle, { url: login, signedInHint: true, signedOutHint: true }).kind).toBe('login')
    expect(classifySignInPage(moodle, { url: login, signedInHint: true, hasPassword: true }).kind).toBe('login')
    expect(classifySignInPage(moodle, { url: login, html: `<body class="notloggedin">${PROOF}</body>` }).kind).toBe('login')
    expect(classifySignInPage(moodle, { url: login, html: `<body id="page-login-index"><form class="login-form" action="${login}" method="post" id="login"></form>${PROOF}` }).kind).toBe('login')
    expect(classifySignInPage(moodle, { url: login }).kind).toBe('login')
    expect(classifySignInPage(moodle, { url: login, signedInHint: true, html: '<input type="password" name="password">' }).kind).toBe('login')
    // otras rutas de acceso (doble factor de Moodle) no: allí la sesión aún no vale
    expect(classifySignInPage(moodle, { url: `${ROOT}/admin/tool/mfa/auth.php`, signedInHint: true }).kind).toBe('login')
    expect(classifySignInPage(canvas, { url: 'https://canvas.uni.edu/login/index.php', signedInHint: true }).kind).toBe('login')
  })

  it('el DOM ya no marca «sin sesión» solo por el id del body (lo lleva también esta página)', () => {
    expect(signInSelectors('moodle').signedOut).toEqual(['body.notloggedin', 'form#login'])
  })
})

describe('Moodle: invitado en la ventana', () => {
  it('una página de invitado no basta para darla por iniciada', () => {
    const guest = `<body class="path-site"><span class="login">Acceso de invitado (<a href="${ROOT}/login/index.php">Acceder</a>)</span></body>`
    const w = new SignInWatch(moodle)
    expect(w.notePage('main', { url: `${ROOT}/?redirect=0`, html: guest })).toEqual({ kind: 'authenticated', strong: false })
    // la comprobación dice «cerrada» (guest session) o «no se sabe» (sin prueba de usuario)
    expect(w.accept('signedOut')).toBeNull()
    expect(w.accept('unknown')).toBeNull()
  })
})

describe('Moodle en otro host del mismo sitio (alias)', () => {
  const account = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu/' }
  const evPage = (path: string, extra = ''): { url: string; html: string } => ({ url: `https://ev.uni.edu${path}`, html: `<html><head>${cfg('https://ev.uni.edu')}</head><body class="path-my">${extra}</body></html>` })
  const evProof = '<a href="https://ev.uni.edu/login/logout.php?sesskey=Ab12Cd34Ef">Salir</a>'

  it('lo adopta por el wwwroot de la página: desde entonces cuenta como la plataforma', () => {
    const w = new SignInWatch(account)
    expect(w.adoptedRoot).toBeNull()
    expect(w.notePage('main', { url: 'https://ev.uni.edu/my/' }).kind).toBe('unknown')
    expect(w.wantsVerify()).toBe(false)
    expect(w.notePage('main', evPage('/my/', evProof))).toEqual({ kind: 'authenticated', strong: true })
    expect(w.adoptedRoot).toBe('https://ev.uni.edu')
    expect(w.isPlatformURL('https://ev.uni.edu/course/view.php?id=2')).toBe(true)
    expect(w.isPlatformURL('https://campus.uni.edu/')).toBe(true)
    expect(w.isPlatformURL('https://otro.edu/')).toBe(false)
    expect(w.isSignInStepURL('https://ev.uni.edu/login/index.php')).toBe(true)
    expect(w.isSignInStepURL('https://ev.uni.edu/my/')).toBe(false)
    expect(w.wantsVerify()).toBe(true)
    expect(w.accept('signedIn')).toBe('verified')
    // la comprobación con la dirección vieja acaba «en otro sitio»: basta la prueba de la página
    expect(w.accept('unknown')).toBe('page-proof')
  })

  it('cookies de sesión y pasos tras el acceso también en el host adoptado', () => {
    const w = new SignInWatch(account)
    expect(w.noteCookie({ name: 'MoodleSession', domain: 'ev.uni.edu' })).toBe(false)
    w.notePage('main', evPage('/login/index.php'))
    expect(w.adoptedRoot).toBe('https://ev.uni.edu')
    expect(w.noteCookie({ name: 'MoodleSession', domain: 'ev.uni.edu' })).toBe(true)
    w.notePage('main', evPage('/admin/tool/policy/index.php'))
    expect(w.pendingStep).toBe(true)
    expect(w.accept('signedIn')).toBeNull()
  })

  it('en una carpeta: la raíz lleva la carpeta y no la barra final', () => {
    const w = new SignInWatch(account)
    w.notePage('main', { url: 'https://www.uni.edu/moodle/my/', html: `${cfg('https://www.uni.edu/moodle')}${PROOF}` })
    expect(w.adoptedRoot).toBe('https://www.uni.edu/moodle')
  })

  it('nunca: un host de identidad, otro sitio, un wwwroot de otro host, otra plataforma o sin HTML', () => {
    const idp = new SignInWatch(account)
    expect(idp.notePage('main', { url: 'https://login.uni.edu/my/', html: cfg('https://login.uni.edu') }).kind).toBe('sso')
    expect(idp.adoptedRoot).toBeNull()
    const far = new SignInWatch(account)
    far.notePage('main', { url: 'https://ev.otra.edu/my/', html: cfg('https://ev.otra.edu') + evProof })
    expect(far.adoptedRoot).toBeNull()
    const mismatch = new SignInWatch(account)
    mismatch.notePage('main', { url: 'https://ev.uni.edu/my/', html: cfg('https://moodle.uni.edu') + evProof })
    expect(mismatch.adoptedRoot).toBeNull()
    const cv = new SignInWatch({ kind: 'canvas', baseURL: 'https://campus.uni.edu/' })
    cv.notePage('main', evPage('/my/', evProof))
    expect(cv.adoptedRoot).toBeNull()
    const bare = new SignInWatch(account)
    bare.notePage('main', { url: 'https://ev.uni.edu/my/', signedInHint: true })
    expect(bare.adoptedRoot).toBeNull()
  })

  it('si el host de la cuenta ya es un Moodle de verdad, no adopta otro; y solo adopta uno', () => {
    const own = new SignInWatch(account)
    own.notePage('main', { url: 'https://campus.uni.edu/login/index.php', html: `<body class="notloggedin">${cfg('https://campus.uni.edu')}</body>` })
    own.notePage('main', evPage('/my/', evProof))
    expect(own.adoptedRoot).toBeNull()
    const once = new SignInWatch(account)
    once.notePage('main', evPage('/my/', evProof))
    once.notePage('main', { url: 'https://ev2.uni.edu/my/', html: cfg('https://ev2.uni.edu') })
    expect(once.adoptedRoot).toBe('https://ev.uni.edu')
    expect(once.isPlatformURL('https://ev2.uni.edu/my/')).toBe(false)
  })
})

describe('bucles en la ventana principal', () => {
  const login = `${ROOT}/login/index.php`
  const oidc = `${ROOT}/auth/oidc/?source=loginpage`
  const authorize = 'https://login.microsoftonline.com/t/oauth2/authorize?client_id=x&state=1'
  const callback = `${ROOT}/auth/oidc/`

  it('se entra por el mismo paso más de 3 veces en 60 s', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    const lap = (): void => {
      for (const u of [login, oidc, authorize, callback]) {
        w.noteURL(u, MAIN_SIGNIN_WINDOW)
        c.advance(1500)
      }
    }
    lap()
    expect(w.loopSuspected).toBe(false)
    lap()
    lap()
    expect(w.loopSuspected).toBe(false)
    lap()
    expect(w.loopSuspected).toBe(true)
    // pasado el minuto sin más vueltas, ya no
    c.advance(61_000)
    expect(w.loopSuspected).toBe(false)
  })

  it('dos pasadas normales de auth_oidc en menos de un minuto no son un bucle; cuatro, sí', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    // la vuelta de OIDC pasa otra vez por /auth/oidc/ y por /login/index.php: no es entrar de nuevo
    const pass = (): void => {
      for (const u of [`${ROOT}/`, login, oidc, authorize, 'https://login.microsoftonline.com/common/login', 'https://login.microsoftonline.com/kmsi', callback, login, `${ROOT}/my/`]) {
        w.noteURL(u, MAIN_SIGNIN_WINDOW)
        c.advance(1000)
      }
    }
    pass()
    expect(w.loopSuspected).toBe(false)
    pass()
    expect(w.loopSuspected).toBe(false)
    pass()
    expect(w.loopSuspected).toBe(false)
    pass()
    expect(w.loopSuspected).toBe(true)
  })

  it('un bucle solo de la plataforma (el área personal devuelve al acceso) también cuenta', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    for (let i = 0; i < 3; i++) {
      w.noteURL(`${ROOT}/my/`, MAIN_SIGNIN_WINDOW)
      w.noteURL(login, MAIN_SIGNIN_WINDOW)
      c.advance(2000)
    }
    expect(w.loopSuspected).toBe(false)
    w.noteURL(`${ROOT}/my/`, MAIN_SIGNIN_WINDOW)
    w.noteURL(login, MAIN_SIGNIN_WINDOW)
    expect(w.loopSuspected).toBe(true)
  })

  it('el umbral: 3 veces no, la cuarta sí', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    for (let i = 0; i < 3; i++) {
      w.noteURL(`${login}?i=${i}`, MAIN_SIGNIN_WINDOW)
      w.noteURL(authorize, MAIN_SIGNIN_WINDOW)
      c.advance(2000)
    }
    expect(w.loopSuspected).toBe(false)
    w.noteURL(login, MAIN_SIGNIN_WINDOW)
    expect(w.loopSuspected).toBe(true)
  })

  it('una pasada normal no; vueltas espaciadas más de un minuto tampoco', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    for (const u of [`${ROOT}/`, login, oidc, authorize, 'https://login.microsoftonline.com/common/login', 'https://login.microsoftonline.com/kmsi', callback, `${ROOT}/my/`]) {
      w.notePage('main', { url: u })
      c.advance(3000)
    }
    expect(w.loopSuspected).toBe(false)
    const slow = new SignInWatch(moodle, { now: c.now })
    for (let i = 0; i < 6; i++) {
      slow.noteURL(login, MAIN_SIGNIN_WINDOW)
      slow.noteURL(authorize, MAIN_SIGNIN_WINDOW)
      c.advance(25_000)
    }
    expect(slow.loopSuspected).toBe(false)
  })

  it('las navegaciones dentro de la misma página de Microsoft (misma ruta) no cuentan como vueltas', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    w.noteURL(oidc, MAIN_SIGNIN_WINDOW)
    for (let i = 0; i < 8; i++) {
      w.noteURL(`${authorize}&sso_reload=${i}#p${i}`, MAIN_SIGNIN_WINDOW)
      c.advance(100)
    }
    expect(w.loopSuspected).toBe(false)
  })

  it('solo la ventana principal: las emergentes y las direcciones sin ventana no cuentan; las páginas internas tampoco', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    for (let i = 0; i < 6; i++) {
      w.noteURL(login, 'popup-2')
      w.noteURL(authorize, 'popup-2')
      w.noteURL(login)
      w.noteURL(authorize)
      c.advance(500)
    }
    expect(w.loopSuspected).toBe(false)
    for (let i = 0; i < 6; i++) {
      w.noteURL(`${ROOT}/my/`, MAIN_SIGNIN_WINDOW)
      w.noteURL(`${ROOT}/course/view.php?id=${i}`, MAIN_SIGNIN_WINDOW)
    }
    expect(w.loopSuspected).toBe(false)
  })

  it('la cadena para el registro: hosts y rutas, sin consultas', () => {
    const c = clock()
    const w = new SignInWatch(moodle, { now: c.now })
    w.notePage('main', { url: oidc })
    w.noteURL(authorize, MAIN_SIGNIN_WINDOW)
    w.noteURL(callback, MAIN_SIGNIN_WINDOW)
    expect(w.recentHops()).toEqual(['campus.uni.edu/moodle/auth/oidc/', 'login.microsoftonline.com/t/oauth2/authorize', 'campus.uni.edu/moodle/auth/oidc/'])
    expect(w.recentHops().some((h) => h.includes('?') || h.includes('state'))).toBe(false)
    c.advance(61_000)
    expect(w.recentHops()).toEqual([])
  })

  it('anotar la dirección de la principal no cambia lo demás (pasos vistos, cambios)', () => {
    const w = new SignInWatch(canvas)
    w.noteURL('https://login.microsoftonline.com/x', MAIN_SIGNIN_WINDOW)
    expect(w.loginSeen).toBe(true)
    expect(w.loopSuspected).toBe(false)
  })
})
