import { describe, expect, it } from 'vitest'
import {
  classifyAuthPage, interpretSessionCheck, isAccountLoginURL, isIdentityHost, isLoginURL, isPostLoginStep, isRememberMeLabel, sessionCheckTargets,
  startsSignIn, stripJSONGuard, type SessionCheckTarget, type SessionProbeResponse
} from './login'
import {
  SecretMask, accountAllowsDownloadFrom, accountContains, accountDisplayName, accountForURL, hostMatches, normalizePlatformURL, originOf,
  parsePlatformKind, platformRoot, trustedSitePatterns
} from './model'

const canvas = { kind: 'canvas' as const, baseURL: 'https://uni.instructure.com/' }
const moodle = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu/moodle/' }

describe('modelo de plataforma', () => {
  it('normaliza direcciones', () => {
    expect(normalizePlatformURL('campus.uni.edu')).toBe('https://campus.uni.edu/')
    expect(normalizePlatformURL('http://campus.uni.edu/x#frag')).toBe('http://campus.uni.edu/x')
    expect(normalizePlatformURL('https://user:pw@campus.uni.edu')).toBeNull()
    expect(normalizePlatformURL('ftp://campus.uni.edu')).toBeNull()
    expect(normalizePlatformURL('campus uni')).toBeNull()
    expect(normalizePlatformURL('intranet')).toBeNull()
    expect(normalizePlatformURL('localhost:8080')).toBe('https://localhost:8080/')
    expect(originOf('https://Campus.Uni.edu:8443/a')).toBe('https://campus.uni.edu:8443')
  })

  it('patrones de host', () => {
    expect(hostMatches('uni.instructure.com', '*.instructure.com')).toBe(true)
    expect(hostMatches('instructure.com', '*.instructure.com')).toBe(true)
    expect(hostMatches('evilinstructure.com', '*.instructure.com')).toBe(false)
    expect(hostMatches('x.edu', 'https://x.edu/path')).toBe(true)
    expect(hostMatches('y.edu', '*')).toBe(true)
  })

  it('qué es de la cuenta y desde dónde se descarga', () => {
    expect(accountContains(canvas, 'https://uni.instructure.com/courses/1')).toBe(true)
    expect(accountContains(canvas, 'https://other.instructure.com/')).toBe(true)
    expect(accountContains(canvas, 'https://evil.com/')).toBe(false)
    expect(accountAllowsDownloadFrom(canvas, 'https://inst-fs-iad-prod.inscloudgate.net/files/1')).toBe(true)
    expect(accountAllowsDownloadFrom(canvas, 'https://evil.com/f.pdf')).toBe(false)
    expect(trustedSitePatterns(canvas)).toContain('https://uni.instructure.com')
    const accounts = [{ ...canvas, id: 'a' }, { ...moodle, id: 'b' }]
    expect(accountForURL(accounts, 'https://campus.uni.edu/moodle/course/view.php?id=1')?.id).toBe('b')
    expect(accountForURL(accounts, 'https://nada.com')).toBeNull()
  })

  it('raíz de Moodle en una carpeta', () => {
    expect(platformRoot('moodle', 'https://campus.uni.edu/moodle/login/index.php')).toBe('https://campus.uni.edu/moodle')
    expect(platformRoot('moodle', 'https://campus.uni.edu/my/')).toBe('https://campus.uni.edu')
    expect(platformRoot('canvas', 'https://uni.instructure.com/courses/1')).toBe('https://uni.instructure.com')
  })

  it('tipos de la app Swift y nombres', () => {
    expect(parsePlatformKind('googleClassroom')).toBe('classroom')
    expect(parsePlatformKind('openEdx')).toBe('openedx')
    expect(parsePlatformKind('futuro')).toBe('other')
    expect(parsePlatformKind(3)).toBe('other')
    expect(accountDisplayName({ ...canvas, label: '' })).toBe('Canvas')
    expect(accountDisplayName({ kind: 'other', baseURL: 'https://www.profe.com/', label: '' })).toBe('profe.com')
    expect(accountDisplayName({ ...canvas, label: '  Mi Canvas ' })).toBe('Mi Canvas')
  })

  it('enmascara secretos', () => {
    expect(SecretMask.url('https://uni.instructure.com/feeds/calendars/user_abc.ics')).toBe('https://uni.instructure.com/••••')
    expect(SecretMask.scrub('token=abcdef123 ok', ['abcdef123'])).toBe('token=•••• ok')
  })
})

describe('proveedores de identidad y páginas de acceso', () => {
  it('reconoce SSO conocidos y propios', () => {
    for (const h of ['login.microsoftonline.com', 'accounts.google.com', 'uni.okta.com', 'sso.uni.edu', 'idp.uni.edu', 'cas.uni.edu', 'shibboleth.uni.edu', 'adfs.uni.edu', 'weblogin.uni.edu']) {
      expect(isIdentityHost(h), h).toBe(true)
    }
    for (const h of ['campus.uni.edu', 'uni.instructure.com', 'login.com', 'casa.uni.edu', '']) expect(isIdentityHost(h), h).toBe(false)
  })

  it('rutas de acceso genéricas y por plataforma', () => {
    expect(isLoginURL('https://uni.instructure.com/login/saml', 'canvas')).toBe(true)
    expect(isLoginURL('https://uni.instructure.com/courses/1', 'canvas')).toBe(false)
    expect(isLoginURL('https://campus.uni.edu/login/index.php', 'moodle')).toBe(true)
    expect(isLoginURL('https://campus.uni.edu/auth/saml2/login.php', 'moodle')).toBe(true)
    expect(isLoginURL('https://lms.uni.edu/webapps/login/', 'blackboard')).toBe(true)
    expect(isLoginURL('https://lms.uni.edu/d2l/login', 'brightspace')).toBe(true)
    expect(isLoginURL('https://lms.uni.edu/portal/xlogin', 'sakai')).toBe(true)
    expect(isLoginURL('https://web.uni.edu/cas/login?service=x')).toBe(true)
    expect(isLoginURL('https://web.uni.edu/Shibboleth.sso/Login'.toLowerCase())).toBe(true)
    expect(isLoginURL('https://login.microsoftonline.com/common/oauth2/authorize')).toBe(true)
    expect(isLoginURL('https://school.itslearning.com/', 'itslearning')).toBe(false)
    expect(isLoginURL('not a url')).toBe(false)
  })

  it('clasifica páginas para la sesión', () => {
    expect(classifyAuthPage({ url: 'https://login.microsoftonline.com/x', account: canvas })).toBe('sso')
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/login/canvas', account: canvas })).toBe('login')
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/', account: canvas, hasPasswordField: true })).toBe('login')
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/', account: canvas, html: '"current_user_id":null' })).toBe('login')
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/', account: canvas, html: '"current_user_id":"42"' })).toBe('authenticated')
    expect(classifyAuthPage({ url: 'https://campus.uni.edu/moodle/my/', account: moodle, html: '<body id="page-login-index">' })).toBe('login')
    expect(classifyAuthPage({ url: 'https://elsewhere.com/', account: canvas })).toBe('unknown')
  })

  it('«Recordarme» (sin el «recordar usuario» de Moodle)', () => {
    expect(isRememberMeLabel('Remember me')).toBe(true)
    expect(isRememberMeLabel('Mantener la sesión iniciada')).toBe(true)
    expect(isRememberMeLabel('Recordar nombre de usuario')).toBe(false)
    expect(isRememberMeLabel('Acepto las condiciones')).toBe(false)
  })

  it('qué dirección empezaría un inicio de sesión (el sondeo del alta no la pide)', () => {
    const from = 'https://campus.uni.edu/login/index.php'
    // el arranque del SSO de la plataforma (auth_oidc guarda una fila de estado) y el proveedor de identidad
    expect(startsSignIn(from, 'https://campus.uni.edu/auth/oidc/?source=loginpage')).toBe(true)
    expect(startsSignIn(from, 'https://campus.uni.edu/moodle/auth/saml2/login.php?wants')).toBe(true)
    expect(startsSignIn(from, 'https://login.microsoftonline.com/t/oauth2/v2.0/authorize?client_id=x')).toBe(true)
    expect(startsSignIn(from, 'https://sso.uni.edu/idp/profile/SAML2/Redirect/SSO')).toBe(true)
    expect(startsSignIn('https://uni.instructure.com/login', 'https://uni.instructure.com/login/saml')).toBe(true)
    expect(startsSignIn(from, 'javascript:alert(1)')).toBe(true)
    // la portada, la página de acceso, https y otro host del campus, sí
    expect(startsSignIn('https://campus.uni.edu/', from)).toBe(false)
    expect(startsSignIn('http://campus.uni.edu/', 'https://campus.uni.edu/')).toBe(false)
    expect(startsSignIn('https://uni.edu/', 'https://campus.uni.edu/login/index.php')).toBe(false)
    expect(startsSignIn('https://uni.instructure.com/', 'https://uni.instructure.com/login/canvas')).toBe(false)
    // un campus que se llama «login.uni.edu» no es por eso el SSO si ya se estaba en él
    expect(startsSignIn('https://login.uni.edu/', 'https://login.uni.edu/my/')).toBe(false)
  })
})

describe('comprobación de la sesión', () => {
  it('direcciones baratas por plataforma', () => {
    expect(sessionCheckTargets(canvas)[0]).toMatchObject({ url: 'https://uni.instructure.com/api/v1/users/self', expect: 'json' })
    expect(sessionCheckTargets(moodle)).toEqual([
      { url: 'https://campus.uni.edu/moodle/my/', expect: 'page' },
      { url: 'https://campus.uni.edu/moodle/my/courses.php', expect: 'page' }
    ])
    expect(sessionCheckTargets({ kind: 'brightspace', baseURL: 'https://lms.uni.edu/d2l/home' }).map((t) => t.expect)).toEqual(['json', 'page'])
    expect(sessionCheckTargets({ kind: 'other', baseURL: 'https://profe.com/curso' })[0].url).toBe('https://profe.com/curso')
  })

  it('quita la guarda JSON de Canvas', () => {
    expect(stripJSONGuard('while(1);{"id":1}')).toBe('{"id":1}')
    expect(stripJSONGuard(")]}',\n[1]")).toBe('\n[1]')
  })

  const target = sessionCheckTargets(canvas)[0]
  const res = (o: Partial<Parameters<typeof interpretSessionCheck>[2]>) => ({ status: 200, finalURL: target.url, redirects: [], contentType: 'application/json', body: '', ...o })

  it('Canvas con sesión', () => {
    expect(interpretSessionCheck(canvas, target, res({ body: 'while(1);{"id":"7","name":"Ana"}' })).state).toBe('signedIn')
  })

  it('401, redirección al acceso o al SSO = sesión cerrada', () => {
    expect(interpretSessionCheck(canvas, target, res({ status: 401, body: '{"status":"unauthenticated"}' })).state).toBe('signedOut')
    expect(interpretSessionCheck(canvas, target, res({ redirects: ['https://uni.instructure.com/login'], finalURL: 'https://login.microsoftonline.com/x', contentType: 'text/html' })).state).toBe('signedOut')
  })

  it('errores del servidor o de red no dicen nada', () => {
    expect(interpretSessionCheck(canvas, target, res({ status: 503 })).state).toBe('unknown')
    expect(interpretSessionCheck(canvas, target, res({ status: 429 })).state).toBe('unknown')
    expect(interpretSessionCheck(canvas, target, res({ status: 403 })).state).toBe('unknown')
    expect(interpretSessionCheck(canvas, target, res({ body: 'no es json' })).state).toBe('unknown')
  })

  it('una página de acceso en vez de JSON', () => {
    expect(interpretSessionCheck(canvas, target, res({ contentType: 'text/html', body: '<html><input type="password"></html>' })).state).toBe('signedOut')
  })

  it('Moodle por página', () => {
    const t = sessionCheckTargets(moodle)[0]
    const page = (body: string, finalURL = t.url) => ({ status: 200, finalURL, redirects: [], contentType: 'text/html', body })
    expect(interpretSessionCheck(moodle, t, page('<a href="/login/logout.php?sesskey=abc">Salir</a>')).state).toBe('signedIn')
    expect(interpretSessionCheck(moodle, t, page('<body id="page-login-index">', 'https://campus.uni.edu/moodle/login/index.php')).state).toBe('signedOut')
    expect(interpretSessionCheck(moodle, t, page('<html></html>', 'https://otro.com/')).state).toBe('unknown')
  })

  it('Brightspace 403 en whoami = cerrada; Sakai anónima = cerrada', () => {
    const b = { kind: 'brightspace' as const, baseURL: 'https://lms.uni.edu/' }
    expect(interpretSessionCheck(b, sessionCheckTargets(b)[0], res({ status: 403 })).state).toBe('signedOut')
    const s = { kind: 'sakai' as const, baseURL: 'https://lms.uni.edu/' }
    expect(interpretSessionCheck(s, sessionCheckTargets(s)[0], res({ body: '{"userEid":null,"userId":null}' })).state).toBe('signedOut')
    expect(interpretSessionCheck(s, sessionCheckTargets(s)[0], res({ body: '{"userEid":"ana","userId":"x"}' })).state).toBe('signedIn')
  })
})

// MARK: Moodle (issue #25)

const ROOT = 'https://campus.uni.edu/moodle'
const PROOF = `<a href="${ROOT}/login/logout.php?sesskey=Ab12Cd34Ef">Cerrar sesión</a>`
/** Página de Moodle: body con clases, M.cfg y, si hay usuario, el menú con la salida. */
function moodleHTML(o: { bodyClass?: string; inner?: string; wwwroot?: string; head?: string } = {}): string {
  const cfg = `<script>M.cfg = {"wwwroot":"${(o.wwwroot ?? ROOT).replace(/\//g, '\\/')}","sesskey":"Ab12Cd34Ef"};</script>`
  return `<!DOCTYPE html><html><head>${cfg}${o.head ?? ''}</head><body id="page-my-index" class="${o.bodyClass ?? 'path-my'}">${o.inner ?? ''}</body></html>`
}
const guestHTML = moodleHTML({ bodyClass: 'path-site', inner: `<span class="login">Está usando el acceso de invitado (<a href="${ROOT}/login/index.php">Acceder</a>)</span>` })

describe('Moodle: pasos tras el acceso', () => {
  const steps = [`${ROOT}/admin/tool/policy/index.php`, `${ROOT}/admin/tool/policy/view.php?versionid=3&returnurl=x`, `${ROOT}/user/policy.php`, `${ROOT}/user/edit.php?id=5&course=1`]

  it('política del sitio y perfil por completar, también en una carpeta; solo Moodle y solo en su host', () => {
    for (const u of steps) expect(isPostLoginStep(moodle, u), u).toBe(true)
    expect(isPostLoginStep(moodle, 'https://campus.uni.edu/user/policy.php')).toBe(true)
    expect(isPostLoginStep(moodle, `${ROOT}/admin/tool/policy/accept.php`)).toBe(false)
    expect(isPostLoginStep(moodle, `${ROOT}/my/`)).toBe(false)
    expect(isPostLoginStep(moodle, 'https://otro.edu/user/policy.php')).toBe(false)
    expect(isPostLoginStep({ kind: 'canvas', baseURL: 'https://campus.uni.edu/' }, 'https://campus.uni.edu/user/edit.php')).toBe(false)
    expect(isPostLoginStep({ kind: 'other', baseURL: 'https://campus.uni.edu/' }, 'https://campus.uni.edu/user/policy.php')).toBe(false)
    expect(isPostLoginStep(moodle, 'no es una dirección')).toBe(false)
  })

  it('no son páginas de acceso (si lo fueran, la comprobación diría «sesión cerrada»)', () => {
    for (const u of steps) {
      expect(isAccountLoginURL(moodle, u), u).toBe(false)
      expect(isLoginURL(u, 'moodle'), u).toBe(false)
    }
  })

  it('el cambio de contraseña forzado sí es una página de acceso, también en una carpeta', () => {
    expect(isAccountLoginURL(moodle, `${ROOT}/login/change_password.php`)).toBe(true)
    expect(isLoginURL('https://x.edu/moodle/login/change_password.php', 'moodle')).toBe(true)
  })
})

describe('Moodle: comprobación de la sesión', () => {
  const [my, courses] = sessionCheckTargets(moodle) as [SessionCheckTarget, SessionCheckTarget]
  const page = (o: Partial<SessionProbeResponse>): SessionProbeResponse => ({ status: 200, finalURL: my.url, redirects: [], contentType: 'text/html', body: '', ...o })
  const check = (o: Partial<SessionProbeResponse>, target = my) => interpretSessionCheck(moodle, target, page(o))

  it('con un paso tras el acceso en la cadena: no se sabe, y hay un paso pendiente', () => {
    const policy = `${ROOT}/admin/tool/policy/index.php`
    expect(check({ redirects: [policy], finalURL: policy, body: moodleHTML({ bodyClass: 'pagelayout-secure' }) })).toEqual({
      state: 'unknown', reason: 'post-login step (policy/profile)', pendingStep: true
    })
    // el perfil sí trae el menú del usuario: aun así no es «iniciada»
    const edit = `${ROOT}/user/edit.php?id=5&course=1`
    expect(check({ redirects: [edit], finalURL: edit, body: moodleHTML({ inner: PROOF }) })).toMatchObject({ state: 'unknown', pendingStep: true })
    expect(check({ redirects: [`${ROOT}/user/policy.php`], finalURL: `${ROOT}/user/policy.php` }, courses).pendingStep).toBe(true)
  })

  it('la vuelta al acceso se mira antes que el paso: una sesión caducada sigue siendo «cerrada»', () => {
    const v = check({ redirects: [`${ROOT}/admin/tool/policy/index.php`, `${ROOT}/login/index.php`], finalURL: `${ROOT}/login/index.php`, body: moodleHTML({ bodyClass: 'notloggedin' }) })
    expect(v.state).toBe('signedOut')
    expect(v.pendingStep).toBeUndefined()
    expect(check({ redirects: ['https://login.microsoftonline.com/t/oauth2/v2.0/authorize?x=1'], finalURL: 'https://login.microsoftonline.com/t/oauth2/v2.0/authorize?x=1' }).state).toBe('signedOut')
  })

  it('invitado: /my/ manda a la portada con redirect=0 → cerrada', () => {
    for (const front of [`${ROOT}/?redirect=0`, `${ROOT}/index.php?redirect=0`, `${ROOT}?redirect=0`]) {
      expect(check({ redirects: [front], finalURL: front, body: guestHTML }), front).toEqual({ state: 'signedOut', reason: 'guest session' })
    }
    const rootLevel = { kind: 'moodle' as const, baseURL: 'https://m.uni.edu/' }
    const t = sessionCheckTargets(rootLevel)[0]
    expect(interpretSessionCheck(rootLevel, t, page({ redirects: ['https://m.uni.edu/?redirect=0'], finalURL: 'https://m.uni.edu/?redirect=0', body: guestHTML })).state).toBe('signedOut')
  })

  it('redirect=0 en otra página no es la portada; y con la prueba de un usuario, manda la prueba', () => {
    const other = `${ROOT}/course/view.php?id=2&redirect=0`
    expect(check({ redirects: [other], finalURL: other, body: guestHTML })).toEqual({ state: 'unknown', reason: 'no user proof' })
    const front = `${ROOT}/?redirect=0`
    expect(check({ redirects: [front], finalURL: front, body: moodleHTML({ inner: PROOF }) }).state).toBe('signedIn')
  })

  it('una página interna sin la prueba de un usuario (invitado en /my/, tema raro): no se sabe, nunca «iniciada»', () => {
    expect(check({ body: guestHTML })).toEqual({ state: 'unknown', reason: 'no user proof' })
    expect(check({ body: '<html><body class="path-my">Área personal</body></html>' }, courses)).toEqual({ state: 'unknown', reason: 'no user proof' })
    expect(check({ body: moodleHTML({ inner: PROOF }) })).toEqual({ state: 'signedIn', reason: 'internal page' })
  })

  it('la prueba se busca en todo el cuerpo (no solo al principio)', () => {
    const big = moodleHTML({ inner: '<p>' + 'Contenido del curso. '.repeat(70_000) + '</p>' + PROOF })
    expect(big.length).toBeGreaterThan(1_400_000)
    expect(check({ body: big }).state).toBe('signedIn')
  })

  it('«notloggedin» solo cuenta en la clase del body; la prueba de salida gana a las marcas genéricas', () => {
    const cssAndJs = '<style>body.notloggedin #x { display: none }</style><script>var k = "notloggedin";</script>'
    expect(check({ body: moodleHTML({ head: cssAndJs, inner: PROOF }) }).state).toBe('signedIn')
    expect(check({ body: moodleHTML({ bodyClass: 'path-my notloggedin' }) }).state).toBe('signedOut')
    // una clave de matriculación o la contraseña de un cuestionario no son una página de acceso
    expect(check({ body: moodleHTML({ inner: `<input type="password" name="enrolpassword">${PROOF}` }) }).state).toBe('signedIn')
    // sin la prueba, el campo de contraseña sí manda
    expect(check({ body: moodleHTML({ inner: '<input type="password" name="password">' }) }).state).toBe('signedOut')
  })

  it('área personal desactivada: /my/ da 404 (no concluyente) y se prueba «Mis cursos»', () => {
    expect(check({ status: 404, body: moodleHTML({ inner: PROOF }) })).toEqual({ state: 'unknown', reason: 'HTTP 404' })
    expect(check({ finalURL: courses.url, body: moodleHTML({ inner: PROOF }) }, courses).state).toBe('signedIn')
  })

  it('Moodle en otro host del mismo sitio (la dirección guardada es un alias): su página cuenta', () => {
    const acct = { kind: 'moodle' as const, baseURL: 'https://campus.uni.edu/' }
    const t = sessionCheckTargets(acct)[0]
    const ev = 'https://ev.uni.edu/my/'
    const evPage = (inner: string, wwwroot = 'https://ev.uni.edu') => moodleHTML({ wwwroot, inner: inner.replaceAll(ROOT, 'https://ev.uni.edu') })
    expect(interpretSessionCheck(acct, t, page({ redirects: [ev], finalURL: ev, body: evPage(PROOF) }))).toEqual({ state: 'signedIn', reason: 'internal page' })
    expect(interpretSessionCheck(acct, t, page({ redirects: [ev], finalURL: ev, body: evPage('') })).state).toBe('unknown')
    const policy = 'https://ev.uni.edu/admin/tool/policy/index.php'
    expect(interpretSessionCheck(acct, t, page({ redirects: [policy], finalURL: policy, body: evPage('') })).pendingStep).toBe(true)
    // sin un wwwroot de ese host, de otro sitio o de un host de identidad: otro sitio
    expect(interpretSessionCheck(acct, t, page({ redirects: [ev], finalURL: ev, body: `<html>${PROOF}</html>` }))).toEqual({ state: 'unknown', reason: 'ended on another site' })
    expect(interpretSessionCheck(acct, t, page({ redirects: [ev], finalURL: ev, body: evPage(PROOF, 'https://campus.uni.edu') })).reason).toBe('ended on another site')
    const far = 'https://ev.otra.edu/my/'
    expect(interpretSessionCheck(acct, t, page({ redirects: [far], finalURL: far, body: evPage(PROOF, 'https://ev.otra.edu') })).reason).toBe('ended on another site')
  })
})

describe('las demás plataformas no cambian', () => {
  const page = (o: Partial<SessionProbeResponse>): SessionProbeResponse => ({ status: 200, finalURL: '', redirects: [], contentType: 'text/html', body: '', ...o })

  it('una página interna sin prueba sigue siendo «iniciada»; las rutas de Moodle no son pasos', () => {
    const other = { kind: 'other' as const, baseURL: 'https://profe.uni.edu/curso/' }
    const t = sessionCheckTargets(other)[0]
    expect(interpretSessionCheck(other, t, page({ finalURL: 'https://profe.uni.edu/user/edit.php' })).state).toBe('signedIn')
    const sch = { kind: 'schoology' as const, baseURL: 'https://app.schoology.com/' }
    const ts = sessionCheckTargets(sch)[0]
    expect(interpretSessionCheck(sch, ts, page({ finalURL: ts.url, body: '<div>Inicio</div>' }))).toEqual({ state: 'signedIn', reason: 'internal page' })
    expect(interpretSessionCheck(sch, ts, page({ finalURL: ts.url, redirects: [], body: '<input type="password">' })).state).toBe('signedOut')
    const bb = { kind: 'blackboard' as const, baseURL: 'https://learn.uni.edu/' }
    const tb = sessionCheckTargets(bb)[1]
    expect(interpretSessionCheck(bb, tb, page({ finalURL: 'https://ev.uni.edu/ultra/course', body: '"wwwroot":"https:\\/\\/ev.uni.edu"' })).reason).toBe('ended on another site')
  })

  it('la contraseña sigue mandando fuera de Moodle aunque haya un enlace de salida', () => {
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/x', account: canvas, hasPasswordField: true, html: '<a href="/logout.php?sesskey=1">x</a>' })).toBe('login')
    expect(classifyAuthPage({ url: 'https://uni.instructure.com/x', account: canvas, html: '<style>.notloggedin{}</style>' })).toBe('authenticated')
  })
})

describe('Moodle: clasificación de páginas', () => {
  it('body notloggedin manda; la prueba de salida gana a la contraseña; el CSS no cuenta', () => {
    const url = `${ROOT}/course/enrol.php?id=3`
    expect(classifyAuthPage({ url, account: moodle, hasPasswordField: true, html: moodleHTML({ inner: PROOF }) })).toBe('authenticated')
    expect(classifyAuthPage({ url, account: moodle, html: moodleHTML({ bodyClass: 'notloggedin', inner: PROOF }) })).toBe('login')
    expect(classifyAuthPage({ url, account: moodle, html: moodleHTML({ head: '<style>.notloggedin{}</style>' }) })).toBe('authenticated')
    expect(classifyAuthPage({ url, account: moodle, hasPasswordField: true, html: moodleHTML() })).toBe('login')
    // fuera de la cuenta, la prueba no la hace «interna»
    expect(classifyAuthPage({ url: 'https://otro.edu/my/', account: moodle, html: moodleHTML({ inner: PROOF }) })).toBe('unknown')
  })
})
