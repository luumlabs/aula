// Lo que abre el navegador en vivo desde un dispositivo: sus plataformas y su inicio de sesión, y nada más.
import { describe, expect, it } from 'vitest'
import { deviceFrameMayGo, deviceMayOpen, deviceMayShow, deviceReach, frameKey, ltiToolSite, originKey, withToolSites, type DeviceReach, type FrameStep } from './reach'

const MOODLE = { kind: 'moodle', baseURL: 'https://campus.uni.es/' } as const
const CANVAS = { kind: 'canvas', baseURL: 'https://uni.instructure.com/' } as const
const CLASSROOM = { kind: 'classroom', baseURL: 'https://classroom.google.com/' } as const
const TEAMS = { kind: 'teams', baseURL: 'https://teams.microsoft.com/' } as const
const OTHER = { kind: 'other', baseURL: 'https://sites.google.com/view/clase' } as const

const all: DeviceReach = deviceReach([MOODLE, CANVAS, CLASSROOM, TEAMS, OTHER])
const both = (url: string, reach: DeviceReach = all): [boolean, boolean] => [deviceMayOpen(url, reach, 'typed'), deviceMayOpen(url, reach, 'page')]

describe('deviceReach', () => {
  it('una plataforma propia abre su host y su sitio, sin la nube de su tipo (un Moodle propio no abre MoodleCloud)', () => {
    const r = deviceReach([MOODLE])
    expect(r.hosts).toEqual(['campus.uni.es'])
    expect(r.linked).toEqual([])
    expect(r.sites).toEqual(['uni.es'])
  })

  it('un inquilino en la nube: su host lo pide el dispositivo; los comodines de la nube y de sus archivos, solo desde la página', () => {
    const r = deviceReach([CANVAS])
    expect(r.hosts).toEqual(['uni.instructure.com'])
    expect(r.linked).toEqual(expect.arrayContaining(['*.instructure.com', '*.instructure-uploads.com', '*.canvas-user-content.com']))
    expect(r.sites).toEqual([])
    // los hosts exactos de la plataforma (Classroom, Teams) sí los pide
    const g = deviceReach([CLASSROOM, TEAMS])
    expect(g.hosts).toEqual(expect.arrayContaining(['classroom.google.com', 'docs.google.com', 'drive.google.com', 'teams.microsoft.com', 'teams.cloud.microsoft']))
    expect(g.hosts.some((h) => h.startsWith('*.'))).toBe(false)
    expect(g.linked).toEqual(expect.arrayContaining(['*.googleusercontent.com', '*.sharepoint.com', 'onedrive.live.com']))
  })

  it('una página propia en la nube de una plataforma no abre la nube entera', () => {
    const r = deviceReach([{ kind: 'other', baseURL: 'https://uni.sharepoint.com/sites/clase' }])
    expect(r.hosts).toEqual(['uni.sharepoint.com'])
    expect(r.sites).toEqual([])
  })

  it('compartir sitio con un portal general no lo abre entero', () => {
    const r = deviceReach([CLASSROOM, TEAMS, OTHER])
    for (const portal of ['google.com', 'microsoft.com', 'cloud.microsoft']) expect(r.sites).not.toContain(portal)
  })

  it('edX es de una sola organización: con una cuenta en edx.org, todos sus subdominios se piden (el curso está en learning.edx.org)', () => {
    const r = deviceReach([{ kind: 'openedx', baseURL: 'https://courses.edx.org/' }])
    expect(r.hosts).toEqual(expect.arrayContaining(['courses.edx.org', '*.edx.org']))
    expect(deviceMayOpen('https://learning.edx.org/course/course-v1:x/home', r, 'typed')).toBe(true)
    expect(deviceMayShow('https://apps.edx.org/x', r)).toBe(true)
    expect(frameKey('https://learning.edx.org/x')).toBe('edx.org')
    // un Open edX propio no abre edx.org
    const own = deviceReach([{ kind: 'openedx', baseURL: 'https://cursos.uni.es/' }])
    expect(deviceMayOpen('https://learning.edx.org/', own, 'page')).toBe(false)
    // las nubes de varios clientes siguen siendo de inquilinos
    expect(deviceMayOpen('https://other.instructure.com/', deviceReach([CANVAS]), 'typed')).toBe(false)
  })

  it('los cuestionarios de Forms que enlazan Teams y Classroom: solo desde la página', () => {
    const r = deviceReach([TEAMS, CLASSROOM])
    for (const url of ['https://forms.office.com/r/abc', 'https://forms.cloud.microsoft/r/abc', 'https://forms.gle/abc']) expect(both(url, r), url).toEqual([false, true])
    // el resto de office.com, no
    expect(both('https://www.office.com/', r)).toEqual([false, false])
    expect(both('https://forms.office.com/r/abc', deviceReach([MOODLE]))).toEqual([false, false])
  })

  it('sin cuentas, nada', () => {
    expect(deviceReach([])).toEqual({ hosts: [], linked: [], sites: [] })
  })
})

describe('deviceMayOpen', () => {
  it('las plataformas, su sitio y los inicios de sesión: sí, las pida quien las pida', () => {
    for (const url of [
      'https://campus.uni.es/course/view.php?id=3', 'https://sso.uni.es/cas/login', 'https://www.uni.es/', 'https://uni.instructure.com/courses/1',
      'https://classroom.google.com/u/0/h', 'https://docs.google.com/document/d/x', 'https://teams.cloud.microsoft/',
      'https://sites.google.com/view/clase/tema-1', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x', 'https://login.live.com/',
      'https://accounts.google.com/v3/signin/identifier', 'https://accounts.youtube.com/accounts/SetSID',
      'https://mysignins.microsoft.com/register', 'https://gds.google.com/web/chip', 'https://engine.surfconext.nl/authentication/idp/single-sign-on'
    ]) expect(both(url), url).toEqual([true, true])
  })

  it('lo demás: no', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=1', 'https://www.google.com/search?q=x', 'https://www.microsoft.com/', 'https://en.wikipedia.org/wiki/Moodle',
      'https://campus.uni.es.evil.com/', 'https://evil-uni.es/', 'https://user:pw@campus.uni.es/', 'javascript:alert(1)', 'file:///etc/passwd',
      'data:text/html,x', 'about:blank', 'no es una url'
    ]) expect(both(url), url).toEqual([false, false])
  })

  it('la nube de la plataforma (otro inquilino, sus archivos): solo si lleva a ella la propia página', () => {
    for (const url of [
      'https://canvas.instructure.com/courses/1/pages/x', 'https://x.instructure-uploads.com/f', 'https://uni.canvas-user-content.com/x.html',
      'https://othertenant.sharepoint.com/sites/x', 'https://n-abc-0lu-script.googleusercontent.com/userCodeAppPanel', 'https://onedrive.live.com/?id=x'
    ]) expect(both(url), url).toEqual([false, true])
    // un Moodle propio ni eso: MoodleCloud no es su plataforma
    expect(both('https://misitio.moodlecloud.com/', deviceReach([MOODLE]))).toEqual([false, false])
    // un Moodle en MoodleCloud: el suyo lo pide; otro, solo desde la página
    const cloud = deviceReach([{ kind: 'moodle', baseURL: 'https://colegio.moodlecloud.com/' }])
    expect(both('https://colegio.moodlecloud.com/my/', cloud)).toEqual([true, true])
    expect(both('https://misitio.moodlecloud.com/', cloud)).toEqual([false, true])
    // una página propia en SharePoint: la suya, no otro inquilino
    const page = deviceReach([{ kind: 'other', baseURL: 'https://uni.sharepoint.com/sites/clase' }])
    expect(both('https://uni.sharepoint.com/sites/clase/x', page)).toEqual([true, true])
    expect(both('https://evil.sharepoint.com/', page)).toEqual([false, false])
  })

  it('un paso de acceso en otro host (un inquilino, o lo que lo parece por el nombre o la ruta) solo si lleva a él la propia página', () => {
    for (const url of [
      'https://sir3.otra-fed.org/idp/profile/SAML2/Redirect/SSO', 'https://x.org/simplesaml/module.php/core/loginuserpass.php', 'https://uni.okta.com/app/x',
      'https://sso.ejemplo.com/login', 'https://login.uni.nl/', 'https://x.example/sso/', 'https://id.uni.edu/realms/uni/protocol/openid-connect/auth?client_id=x'
    ]) {
      expect(both(url), url).toEqual([false, true])
    }
  })

  it('lo que solo se parece a un acceso no vale: una ruta en medio, un portal general o un alojamiento compartido', () => {
    for (const url of [
      'https://en.wikipedia.org/wiki/SSO', 'https://www.youtube.com/c/SSO', 'https://www.youtube.com/signin', 'https://github.com/login',
      'https://blog.example.org/posts/sso/', 'https://x.example/blog/saml/intro', 'https://mi-sso.netlify.app/', 'https://login.netlify.app.evil.com.github.io/',
      'https://idp-demo.vercel.app/idp/profile', 'https://mi-sso.netlify.app/sso/', 'https://x.workers.dev/login/https://www.youtube.com',
      'https://proxy.mi.deno.dev/sso/'
    ]) {
      expect(both(url), url).toEqual([false, false])
    }
  })

  it('cadenas reales de inicio de sesión: cada salto se permite', () => {
    const moodle = deviceReach([MOODLE])
    for (const url of [
      'https://campus.uni.es/login/index.php', 'https://campus.uni.es/auth/oidc/?source=loginpage',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fcampus.uni.es%2Fauth%2Foidc%2F',
      'https://login.microsoftonline.com/common/login', 'https://login.microsoftonline.com/kmsi', 'https://campus.uni.es/auth/oidc/?code=x', 'https://campus.uni.es/my/'
    ]) expect(deviceMayOpen(url, moodle, 'page'), url).toBe(true)
    // Brightspace → SURFconext → la universidad → SURFconext → Brightspace (las universidades de los Países Bajos)
    const brightspace = deviceReach([{ kind: 'brightspace', baseURL: 'https://uni.brightspace.com/' }])
    for (const url of [
      'https://uni.brightspace.com/d2l/lp/auth/saml/login', 'https://engine.surfconext.nl/authentication/idp/single-sign-on?SAMLRequest=x',
      'https://connect.surfconext.nl/', 'https://secure.uni.nl/idp/profile/SAML2/POST/SSO', 'https://login.uni.nl/adfs/ls/?SAMLRequest=x',
      'https://engine.surfconext.nl/authentication/sp/consume-assertion', 'https://uni.brightspace.com/d2l/lp/auth/login/samlLogin.d2l', 'https://uni.brightspace.com/d2l/home'
    ]) expect(deviceMayOpen(url, brightspace, 'page'), url).toBe(true)
    // Keycloak (el formulario envía a login-actions), WSO2, Gluu y PingFederate en un host sin nombre de proveedor
    const canvas = deviceReach([CANVAS])
    for (const url of [
      'https://keycloak.uni.edu/realms/uni/protocol/openid-connect/auth?client_id=x', 'https://keycloak.uni.edu/realms/uni/login-actions/authenticate?session_code=x',
      'https://keycloak.uni.edu/realms/uni/broker/saml/endpoint', 'https://id.uni.edu/authenticationendpoint/login.do?x=1', 'https://id.uni.edu/commonauth',
      'https://id.uni.edu/samlsso?SAMLRequest=x', 'https://id.uni.edu/oxauth/restv1/authorize', 'https://id.uni.edu/as/authorization.oauth2?client_id=x'
    ]) expect(deviceMayOpen(url, canvas, 'page'), url).toBe(true)
    // la página de error tras una contraseña mal (la misma dirección) se le enseña si llegó allí desde su plataforma
    expect(deviceMayShow('https://keycloak.uni.edu/realms/uni/login-actions/authenticate?session_code=x', canvas, new Set(['https://keycloak.uni.edu']))).toBe(true)
    // pero no el resto del host
    expect(deviceMayOpen('https://keycloak.uni.edu/realms/uni/account/', canvas, 'page')).toBe(false)
    // RENATER: su servicio de descubrimiento
    expect(deviceMayOpen('https://discovery.renater.fr/renater/WAYF?entityID=x', deviceReach([MOODLE]), 'page')).toBe(true)
    const classroom = deviceReach([CLASSROOM])
    for (const url of [
      'https://classroom.google.com/', 'https://accounts.google.com/v3/signin/identifier?continue=x', 'https://accounts.youtube.com/accounts/SetSID',
      'https://classroom.google.com/u/0/h'
    ]) expect(deviceMayOpen(url, classroom, 'page'), url).toBe(true)
  })

  it('las direcciones falsas de las pruebas de la app (con puerto)', () => {
    const fake = deviceReach([{ kind: 'moodle', baseURL: 'http://moodle.localhost:1234/' }])
    expect(deviceMayOpen('http://moodle.localhost:1234/login/index.php', fake, 'typed')).toBe(true)
    expect(deviceMayOpen('http://login.microsoftonline.localhost:5678/common/oauth2/v2.0/authorize', fake, 'page')).toBe(true)
    expect(deviceMayOpen('http://evil.localhost:1234/', fake, 'page')).toBe(false)
  })
})

describe('deviceMayShow', () => {
  it('una página en blanco o de sus plataformas, sí; otra, no', () => {
    expect(deviceMayShow('', all)).toBe(true)
    expect(deviceMayShow('about:blank', all)).toBe(true)
    expect(deviceMayShow('https://campus.uni.es/my/', all)).toBe(true)
    expect(deviceMayShow('https://www.youtube.com/', all)).toBe(false)
  })

  it("lo que solo vale desde la página ('page') se enseña solo si se llegó a su origen desde algo que se podía ver", () => {
    for (const url of ['https://sso.ejemplo.com/login', 'https://uni.okta.com/app/x', 'https://x.example/sso/', 'https://canvas.instructure.com/courses/1']) {
      expect(deviceMayShow(url, all), url).toBe(false)
      expect(deviceMayShow(url, all, new Set([originKey(url)!])), url).toBe(true)
    }
    // el origen apuntado no abre lo que no es un paso permitido, ni otro origen
    const reached = new Set(['https://x.example', 'https://www.youtube.com'])
    expect(deviceMayShow('https://x.example/blog', all, reached)).toBe(false)
    expect(deviceMayShow('https://www.youtube.com/watch?v=1', all, reached)).toBe(false)
    expect(deviceMayShow('https://y.example/sso/', all, reached)).toBe(false)
  })

  it('originKey', () => {
    expect(originKey('https://SSO.Uni.edu:8443/x?y')).toBe('https://sso.uni.edu:8443')
    for (const bad of ['about:blank', 'data:text/html,x', '', 'no es una url']) expect(originKey(bad), bad).toBeNull()
  })
})

describe('los marcos de una página que maneja el dispositivo', () => {
  const step = (current: string, over: Partial<FrameStep> = {}): FrameStep => ({ current, initiator: current, shown: (u) => deviceMayShow(u, all), reached: new Set(), ...over })
  const go = (url: string, s: FrameStep, reach: DeviceReach = all): boolean => deviceFrameMayGo(url, s, reach)

  it('su primera carga (un vídeo, una herramienta), sí', () => {
    for (const cur of ['', 'about:blank', 'about:srcdoc']) expect(go('https://www.youtube.com/embed/x', step(cur, { initiator: 'https://campus.uni.es/mod/page/view.php?id=1' })), cur).toBe(true)
  })

  it('lo que empieza la plataforma (el lanzamiento LTI con formularios), sí', () => {
    // el marco con la página de lanzamiento de la plataforma manda el formulario a la herramienta
    expect(go('https://tool.example/lti/launch', step('https://campus.uni.es/mod/lti/launch.php?id=4'))).toBe(true)
    // la página cambia el src de un marco que ya tenía otra cosa
    expect(go('https://tool2.example/', step('https://tool.example/app', { initiator: 'https://campus.uni.es/course/view.php?id=3' }))).toBe(true)
  })

  it('dentro del mismo sitio, y de vuelta a un sitio al que ya llegó un marco, sí', () => {
    expect(go('https://app.tool.example/next', step('https://www.tool.example/start'))).toBe(true)
    expect(go('https://tool.example/return', step('https://idp.otra.org/idp/profile/SAML2/POST/SSO', { reached: new Set(['tool.example']) }))).toBe(true)
    expect(go('https://tool.example/return', step('https://idp.otra.org/idp/profile/SAML2/POST/SSO'))).toBe(false)
  })

  it('un paso de acceso, sí (la herramienta manda a su proveedor)', () => {
    expect(go('https://accounts.google.com/o/oauth2/auth?client_id=x', step('https://tool.example/app'))).toBe(true)
    expect(go('https://idp.otra.org/idp/profile/SAML2/Redirect/SSO', step('https://tool.example/app'))).toBe(true)
  })

  it('un documento en blanco o srcdoc que navega solo (un enlace dentro): se mira como quien lo contiene', () => {
    const moodle = deviceReach([MOODLE])
    const shown = (u: string): boolean => deviceMayShow(u, moodle)
    for (const cur of ['about:srcdoc', 'about:blank', '']) {
      // dentro de un marco ajeno: no salta a otro sitio
      expect(go('https://evil.example/', step(cur, { self: true, parent: 'https://external.example/', shown }), moodle), cur).toBe(false)
      // dentro de la plataforma (su propio srcdoc, H5P en Moodle): sí
      expect(go('https://evil.example/', step(cur, { self: true, parent: 'https://campus.uni.es/mod/hvp/view.php?id=1', shown }), moodle), cur).toBe(true)
      // dentro del mismo sitio que su marco, o un paso de acceso: sí
      expect(go('https://www.external.example/next', step(cur, { self: true, parent: 'https://external.example/', shown }), moodle), cur).toBe(true)
      expect(go('https://accounts.google.com/o/oauth2/auth', step(cur, { self: true, parent: 'https://external.example/', shown }), moodle), cur).toBe(true)
      // sin padre con dirección: solo un paso permitido
      expect(go('https://evil.example/', step(cur, { self: true, shown }), moodle), cur).toBe(false)
    }
    // lo carga quien lo contiene: su primera carga
    expect(go('https://evil.example/', step('about:blank', { self: false, initiator: 'https://external.example/', parent: 'https://external.example/', shown }), moodle)).toBe(true)
  })

  it('saltar desde un marco ajeno a otro sitio, no', () => {
    for (const [cur, url] of [
      ['https://external.example/page', 'https://other.example/'],
      ['https://www.youtube.com/embed/x', 'https://www.google.com/search?q=x'],
      ['https://docs.google.com/presentation/d/x/embed', 'https://www.google.com/url?q=https://evil.example'],
      ['https://uni.sharepoint.com/x', 'https://evil.sharepoint.com/'],
      ['https://a.netlify.app/', 'https://b.netlify.app/']
    ]) {
      const moodle = deviceReach([MOODLE])
      expect(go(url, step(cur, { shown: (u) => deviceMayShow(u, moodle) }), moodle), `${cur} → ${url}`).toBe(false)
    }
    // un marco en blanco que lo pide no cuenta como algo que se puede ver
    expect(go('https://other.example/', step('https://external.example/', { initiator: 'about:blank' }))).toBe(false)
  })

  it('frameKey: el sitio, o el host en un portal, en la nube de una plataforma o en un alojamiento compartido', () => {
    expect(frameKey('https://a.uni.es/x')).toBe('uni.es')
    expect(frameKey('https://www.youtube.com/embed/x')).toBe('www.youtube.com')
    expect(frameKey('https://uni.instructure.com/')).toBe('uni.instructure.com')
    expect(frameKey('https://uni.sharepoint.com/')).toBe('uni.sharepoint.com')
    expect(frameKey('https://x.netlify.app/')).toBe('x.netlify.app')
    expect(frameKey('about:blank')).toBeNull()
  })
})

describe('una herramienta (LTI) que la plataforma lanza en la ventana entera', () => {
  const moodle = deviceReach([MOODLE])

  it('desde las páginas de lanzamiento de la plataforma, el sitio de la herramienta', () => {
    expect(ltiToolSite('https://campus.uni.es/mod/lti/launch.php?id=4', 'https://tool.example/lti/login', moodle)).toBe('tool.example')
    expect(ltiToolSite('https://campus.uni.es/mod/lti/auth.php?x=1', 'https://app.tool.example/launch', moodle)).toBe('tool.example')
    const canvas = deviceReach([CANVAS])
    expect(ltiToolSite('https://uni.instructure.com/courses/1/external_tools/5?display=borderless', 'https://tool.example/lti', canvas)).toBe('tool.example')
    expect(ltiToolSite('https://uni.instructure.com/api/lti/authorize?x=1', 'https://tool.example/launch', canvas)).toBe('tool.example')
    const d2l = deviceReach([{ kind: 'brightspace', baseURL: 'https://uni.brightspace.com/' }])
    expect(ltiToolSite('https://uni.brightspace.com/d2l/le/lti/123/toolLaunch/4', 'https://pub.example/lti', d2l)).toBe('pub.example')
    const bb = deviceReach([{ kind: 'blackboard', baseURL: 'https://uni.blackboard.com/' }])
    expect(ltiToolSite('https://uni.blackboard.com/webapps/blackboard/execute/blti/launchPlacement?id=1', 'https://pub.example/lti', bb)).toBe('pub.example')
  })

  it('desde otra página, desde fuera de la plataforma o hacia la propia plataforma: nada', () => {
    expect(ltiToolSite('https://campus.uni.es/course/view.php?id=3', 'https://tool.example/', moodle)).toBeNull()
    expect(ltiToolSite('https://evil.example/mod/lti/launch.php', 'https://tool.example/', moodle)).toBeNull()
    expect(ltiToolSite('https://campus.uni.es/mod/lti/launch.php?id=4', 'https://campus.uni.es/x', moodle)).toBeNull()
    expect(ltiToolSite('https://campus.uni.es/mod/lti/launch.php?id=4', 'https://u:p@tool.example/', moodle)).toBeNull()
    expect(ltiToolSite('about:blank', 'https://tool.example/', moodle)).toBeNull()
    // un proveedor de identidad no pasa a ser una herramienta
    expect(ltiToolSite('https://campus.uni.es/mod/lti/launch.php?id=4', 'https://uni.okta.com/app/x', moodle)).toBeNull()
  })

  it('con la herramienta apuntada, la propia página sigue por su sitio; el dispositivo no lo pide y no salta a otro', () => {
    const r = withToolSites(moodle, new Set(['tool.example']))
    expect(both('https://tool.example/lti/login', r)).toEqual([false, true])
    expect(both('https://app.tool.example/course/1', r)).toEqual([false, true])
    expect(both('https://other.example/', r)).toEqual([false, false])
    expect(withToolSites(moodle, new Set())).toBe(moodle)
  })
})
