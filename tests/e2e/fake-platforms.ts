// Plataformas FALSAS y locales para probar el inicio de sesión sin cuentas reales ni credenciales: un Canvas con SSO SAML
// (otro host y otro puerto, doble factor, panel que se pinta con JavaScript), un Moodle con CAS y un Blackboard Ultra que
// inicia sesión en una ventana emergente y vuelve sin navegar. Todo en *.localhost (Chromium lo resuelve a 127.0.0.1).
// Los formularios aceptan cualquier cosa (también vacíos): las pruebas solo pulsan «Continuar», nunca escriben contraseñas.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface FakeRequest {
  host: string
  method: string
  path: string
  /** Nombres de las cookies que llegaron (sin valores). */
  cookies: string[]
  authed: boolean
}

export interface FakePlatforms {
  canvasURL: string
  moodleURL: string
  blackboardURL: string
  ssoOrigin: string
  casOrigin: string
  idpOrigin: string
  requests: FakeRequest[]
  /** Peticiones que no son de lectura a las plataformas (fuera de los pasos del inicio de sesión que hizo el estudiante). */
  writes(): FakeRequest[]
  close(): Promise<void>
}

export interface FakeOptions {
  /** Atributo SameSite de la cookie de sesión de las plataformas (como las de verdad: Lax por defecto). */
  sameSite?: 'Lax' | 'Strict' | 'None'
  /** Lo que tarda la plataforma en aceptar la respuesta del SSO (las de verdad tardan; mientras, la página del SSO sigue
   *  visible pero ya se está yendo: el caso en que una comprobación a destiempo se quedaba colgada). */
  slowLoginMs?: number
}

const id = (): string => randomBytes(9).toString('hex')

function cookiesOf(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  return out
}

function body(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (c: Buffer) => (s += c.toString('utf8')))
    req.on('end', () => resolve(new URLSearchParams(s)))
  })
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(html)
}

function json(res: ServerResponse, status: number, data: unknown, prefix = '', headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(prefix + JSON.stringify(data))
}

function redirect(res: ServerResponse, to: string, status = 302, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { Location: to, 'Cache-Control': 'no-store', ...headers })
  res.end()
}

const page = (title: string, inner: string, bodyAttrs = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body ${bodyAttrs} style="font:16px system-ui;padding:40px">${inner}</body></html>`

/** Formulario de acceso del proveedor de identidad (campo de contraseña incluido: así se reconoce como página de acceso). */
const loginForm = (action: string, hidden: Record<string, string>, title: string): string =>
  page(title, `<h1>${title}</h1><form method="post" action="${action}">
    ${Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('')}
    <label>Usuario <input name="username" autocomplete="username"></label><br>
    <label>Contraseña <input type="password" name="password" autocomplete="current-password"></label><br>
    <label><input type="checkbox" name="rememberMe"> Recordarme</label><br>
    <button type="submit">Continuar</button></form>`)

/** Respuesta SAML que se envía sola (como la de cualquier IdP). */
const autoPost = (action: string, fields: Record<string, string>): string =>
  page('Redirigiendo…', `<p>Redirigiendo a tu campus…</p><form method="post" action="${action}">
    ${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('')}
    <noscript><button>Continuar</button></noscript></form><script>setTimeout(function(){document.forms[0].submit()}, 350)</script>`)

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return (server.address() as AddressInfo).port
}

export async function startFakePlatforms(opts: FakeOptions = {}): Promise<FakePlatforms> {
  const sameSite = opts.sameSite ?? 'Lax'
  const slow = (): Promise<void> => new Promise((r) => setTimeout(r, opts.slowLoginMs ?? 0))
  const requests: FakeRequest[] = []
  // sesiones de cada sitio: id → ¿con usuario?
  const canvasSessions = new Map<string, boolean>()
  const moodleSessions = new Map<string, { authed: boolean; sesskey: string }>()
  const bbSessions = new Map<string, boolean>()
  const idpSessions = new Set<string>()
  const tickets = new Set<string>()
  const ports = { canvas: 0, moodle: 0, bb: 0, idp: 0 }
  const canvasOrigin = (): string => `http://canvas.localhost:${ports.canvas}`
  const moodleOrigin = (): string => `http://moodle.localhost:${ports.moodle}`
  const bbOrigin = (): string => `http://blackboard.localhost:${ports.bb}`
  const sso = (): string => `http://sso.localhost:${ports.idp}`
  const cas = (): string => `http://cas.localhost:${ports.idp}`
  const idp = (): string => `http://idp.localhost:${ports.idp}`
  const cookie = (name: string, value: string): string => `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}${sameSite === 'None' ? '; Secure' : ''}`

  const log = (req: IncomingMessage, authed: boolean): void => {
    const u = new URL(req.url ?? '/', 'http://x')
    requests.push({ host: String(req.headers.host ?? ''), method: req.method ?? 'GET', path: u.pathname, cookies: [...cookiesOf(req).keys()], authed })
  }

  // MARK: Canvas (canvas.localhost) con SAML en sso.localhost

  const canvas = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', canvasOrigin())
    const jar = cookiesOf(req)
    let sid = jar.get('_normandy_session') ?? ''
    const set: string[] = []
    if (!canvasSessions.has(sid)) {
      // como Canvas: hay cookie de sesión también SIN usuario (para el CSRF)
      sid = id()
      canvasSessions.set(sid, false)
      set.push(cookie('_normandy_session', sid))
    }
    const authed = canvasSessions.get(sid) === true
    log(req, authed)
    const h = set.length ? { 'Set-Cookie': set } : undefined
    if (u.pathname === '/api/v1/users/self') {
      if (!authed) return json(res, 401, { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] }, '', h)
      return json(res, 200, { id: 7, name: 'Estudiante de prueba' }, 'while(1);', h)
    }
    if (u.pathname === '/api/v1/dashboard/dashboard_cards') {
      if (!authed) return json(res, 401, { status: 'unauthenticated' }, '', h)
      return json(res, 200, [{ shortName: 'MAT 101', id: 1 }], 'while(1);', h)
    }
    if (u.pathname === '/login') return redirect(res, '/login/saml', 302, h)
    if (u.pathname === '/login/saml' && req.method === 'GET') {
      const acs = `${canvasOrigin()}/login/saml`
      return redirect(res, `${sso()}/idp/profile/SAML2/Redirect/SSO?SAMLRequest=fake&RelayState=${encodeURIComponent(acs)}`, 302, h)
    }
    if (u.pathname === '/login/saml' && req.method === 'POST') {
      const form = await body(req)
      if (form.get('SAMLResponse') !== 'ok') return send(res, 400, page('Error', 'SAML no válido'), h)
      await slow()
      // al iniciar sesión, sesión NUEVA (como Rails): otra cookie
      canvasSessions.delete(sid)
      const fresh = id()
      canvasSessions.set(fresh, true)
      return redirect(res, '/?login_success=1', 302, { 'Set-Cookie': [cookie('_normandy_session', fresh), cookie('log_session_id', id())] })
    }
    if (u.pathname === '/') {
      if (!authed) return redirect(res, '/login', 302, h)
      // panel que se pinta con JavaScript (la primera carga no trae marcas de la sesión)
      return send(res, 200, page('Canvas', `<div id="application"><p>Cargando…</p></div>
        <script>setTimeout(function(){ fetch('/api/v1/dashboard/dashboard_cards').then(function(r){ return r.text() }).then(function(){
          document.getElementById('application').innerHTML = '<header><a id="global_nav_profile_link" href="/profile">Cuenta</a></header><h1>Panel</h1><p>MAT 101</p>';
        }) }, 1500)</script>`), h)
    }
    return send(res, authed ? 200 : 302, authed ? page('Canvas', '<p>Página</p>') : '', authed ? h : { ...h, Location: '/login' })
  })

  // MARK: Moodle (moodle.localhost) con CAS en cas.localhost

  const moodle = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', moodleOrigin())
    const jar = cookiesOf(req)
    let sid = jar.get('MoodleSession') ?? ''
    const set: string[] = []
    if (!moodleSessions.has(sid)) {
      sid = id()
      moodleSessions.set(sid, { authed: false, sesskey: id() })
      set.push(cookie('MoodleSession', sid))
    }
    const s = moodleSessions.get(sid)!
    log(req, s.authed)
    const h = set.length ? { 'Set-Cookie': set } : undefined
    if (u.pathname === '/lib/ajax/service.php') {
      if (!s.authed || u.searchParams.get('sesskey') !== s.sesskey) return json(res, 200, [{ error: true, exception: { errorcode: 'servicerequireslogin' } }], '', h)
      return json(res, 200, [{ error: false, data: true }], '', h)
    }
    if (u.pathname === '/login/index.php') {
      const ticket = u.searchParams.get('ticket')
      if (u.searchParams.get('authCAS') === 'CAS' && ticket && tickets.delete(ticket)) {
        await slow()
        moodleSessions.delete(sid)
        const fresh = id()
        moodleSessions.set(fresh, { authed: true, sesskey: id() })
        return redirect(res, '/my/', 303, { 'Set-Cookie': cookie('MoodleSession', fresh) })
      }
      if (u.searchParams.get('authCAS') === 'CAS') {
        const service = `${moodleOrigin()}/login/index.php?authCAS=CAS`
        return redirect(res, `${cas()}/cas/login?service=${encodeURIComponent(service)}`, 303, h)
      }
      return send(res, 200, page('Acceso', `<h1>Campus virtual</h1><a href="/login/index.php?authCAS=CAS">Entrar con la cuenta de la universidad</a>`, 'id="page-login-index" class="notloggedin"'), h)
    }
    if (u.pathname === '/my/' || u.pathname === '/my') {
      if (!s.authed) return redirect(res, `${moodleOrigin()}/login/index.php`, 303, h)
      // página grande: el menú del usuario (con el enlace de salida) va al final, lejos del principio del HTML
      const filler = '<p>' + 'Contenido del curso. '.repeat(9000) + '</p>'
      return send(res, 200, page('Área personal', `<h1>Área personal</h1>${filler}<nav><a href="${moodleOrigin()}/login/logout.php?sesskey=${s.sesskey}">Salir</a></nav>
        <script>var M = {cfg: {sesskey: "${s.sesskey}"}};</script>`, 'id="page-my-index" class="loggedin"'), h)
    }
    if (u.pathname === '/') {
      if (s.authed) return redirect(res, '/my/', 303, h)
      return send(res, 200, page('Campus virtual', `<h1>Campus virtual</h1><a href="/login/index.php">Acceder</a>`, 'id="page-site-index" class="notloggedin"'), h)
    }
    return send(res, 404, page('No', 'No existe'), h)
  })

  // MARK: Blackboard Ultra (blackboard.localhost): SPA con acceso en una ventana emergente (idp.localhost)

  const bb = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', bbOrigin())
    const jar = cookiesOf(req)
    const sid = jar.get('BbRouter') ?? ''
    const authed = bbSessions.get(sid) === true
    log(req, authed)
    if (u.pathname === '/learn/api/v1/users/me') {
      if (!authed) return json(res, 401, { status: 401, message: 'Unauthorized' })
      return json(res, 200, { id: '_7_1', userName: 'estudiante' })
    }
    if (u.pathname === '/auth-saml/saml/SSO' && req.method === 'POST') {
      const form = await body(req)
      if (form.get('SAMLResponse') !== 'ok') return send(res, 400, page('Error', 'SAML no válido'))
      await slow()
      const fresh = id()
      bbSessions.set(fresh, true)
      // la ventana emergente avisa a la principal y se cierra sola
      return send(res, 200, page('Listo', `<p>Listo. Esta ventana se cerrará.</p><script>
        try { window.opener && window.opener.postMessage('aula-fake-signed-in', '*') } catch (e) {}
        setTimeout(function(){ window.close() }, 300)</script>`), { 'Set-Cookie': cookie('BbRouter', fresh) })
    }
    if (u.pathname === '/') return redirect(res, '/ultra/')
    if (u.pathname.startsWith('/ultra')) {
      // la SPA: SIEMPRE el mismo armazón; sin sesión pinta un botón que abre el SSO en una ventana emergente
      const popup = `${idp()}/idp/popup?return=${encodeURIComponent(`${bbOrigin()}/auth-saml/saml/SSO`)}`
      return send(res, 200, page('Blackboard Learn', `<div id="app">Cargando…</div><script>
        function render(){ fetch('/learn/api/v1/users/me').then(function(r){
          var app = document.getElementById('app');
          if (r.status === 401) { app.innerHTML = '<h1>Blackboard</h1><button id="sso">Iniciar sesión con la universidad</button>';
            document.getElementById('sso').onclick = function(){ window.open(${JSON.stringify(popup)}, 'sso', 'width=520,height=640') }; return }
          app.innerHTML = '<header><a href="/webapps/login/?action=logout">Cerrar sesión</a></header><h1>Actividad</h1>';
        }) }
        window.addEventListener('message', function(e){ if (e.data === 'aula-fake-signed-in') setTimeout(render, 800) });
        render();</script>`))
    }
    return send(res, 404, page('No', 'No existe'))
  })

  // MARK: Proveedores de identidad (sso / cas / idp .localhost, un solo puerto)

  const identity = createServer(async (req, res) => {
    const host = String(req.headers.host ?? '').split(':')[0]
    const u = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const jar = cookiesOf(req)
    const known = idpSessions.has(jar.get('idp_session') ?? '')
    log(req, known)
    // SAML (Shibboleth/ADFS) con doble factor
    if (host === 'sso.localhost' || host === 'idp.localhost') {
      const relay = u.searchParams.get('RelayState') ?? u.searchParams.get('return') ?? ''
      if (u.pathname === '/idp/profile/SAML2/Redirect/SSO' || u.pathname === '/idp/popup') {
        if (known) return send(res, 200, autoPost(relay, { SAMLResponse: 'ok' }))
        return send(res, 200, loginForm('/idp/login', { RelayState: relay }, 'Universidad · Inicia sesión'))
      }
      if (u.pathname === '/idp/login' && req.method === 'POST') {
        const form = await body(req)
        return redirect(res, `/idp/mfa?RelayState=${encodeURIComponent(form.get('RelayState') ?? '')}`, 302)
      }
      if (u.pathname === '/idp/mfa' && req.method === 'GET') {
        return send(res, 200, page('Verificación', `<h1>Aprueba el aviso en tu móvil</h1><form method="post" action="/idp/mfa">
          <input type="hidden" name="RelayState" value="${(u.searchParams.get('RelayState') ?? '').replace(/"/g, '&quot;')}"><button>Ya lo aprobé</button></form>`))
      }
      if (u.pathname === '/idp/mfa' && req.method === 'POST') {
        const form = await body(req)
        const s = id()
        idpSessions.add(s)
        return send(res, 200, autoPost(form.get('RelayState') ?? '', { SAMLResponse: 'ok' }), { 'Set-Cookie': `idp_session=${s}; Path=/; HttpOnly; SameSite=Lax` })
      }
    }
    // CAS
    if (host === 'cas.localhost') {
      const service = u.searchParams.get('service') ?? ''
      if (u.pathname === '/cas/login' && req.method === 'GET') {
        return send(res, 200, loginForm('/cas/login', { service }, 'CAS · Universidad'))
      }
      if (u.pathname === '/cas/login' && req.method === 'POST') {
        const form = await body(req)
        const t = 'ST-' + id()
        tickets.add(t)
        const to = form.get('service') ?? ''
        return redirect(res, `${to}${to.includes('?') ? '&' : '?'}ticket=${t}`, 302, { 'Set-Cookie': `CASTGC=TGT-${id()}; Path=/cas; HttpOnly` })
      }
    }
    return send(res, 404, page('No', 'No existe'))
  })

  ports.canvas = await listen(canvas)
  ports.moodle = await listen(moodle)
  ports.bb = await listen(bb)
  ports.idp = await listen(identity)

  const platformHosts = ['canvas.localhost', 'moodle.localhost', 'blackboard.localhost']
  // pasos del inicio de sesión (los hace el estudiante): no cuentan como escrituras de Aula
  const loginSteps = new Set(['/login/saml', '/auth-saml/saml/SSO'])
  return {
    canvasURL: `${canvasOrigin()}/`,
    moodleURL: `${moodleOrigin()}/`,
    blackboardURL: `${bbOrigin()}/`,
    ssoOrigin: sso(),
    casOrigin: cas(),
    idpOrigin: idp(),
    requests,
    writes: () => requests.filter((r) => platformHosts.includes(r.host.split(':')[0]) && r.method !== 'GET' && r.method !== 'HEAD' && !loginSteps.has(r.path) && r.path !== '/lib/ajax/service.php'),
    close: async () => {
      for (const s of [canvas, moodle, bb, identity]) {
        s.closeAllConnections?.()
        await new Promise<void>((r) => s.close(() => r()))
      }
    }
  }
}
