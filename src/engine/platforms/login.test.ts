import { describe, expect, it } from 'vitest'
import {
  classifyAuthPage, interpretSessionCheck, isIdentityHost, isLoginURL, isRememberMeLabel, sessionCheckTargets, stripJSONGuard
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
})

describe('comprobación de la sesión', () => {
  it('direcciones baratas por plataforma', () => {
    expect(sessionCheckTargets(canvas)[0]).toMatchObject({ url: 'https://uni.instructure.com/api/v1/users/self', expect: 'json' })
    expect(sessionCheckTargets(moodle)[0]).toMatchObject({ url: 'https://campus.uni.edu/moodle/my/', expect: 'page' })
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
