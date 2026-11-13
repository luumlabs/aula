// Moodle de universidad y Microsoft Entra ID FALSOS y locales (issue #25: «se queda colgado o entra en bucle al iniciar sesión
// en Moodle con la cuenta de la universidad (Outlook)»). Todo en *.localhost, con valores de prueba; nada real.
//
// Moodle (moodle.localhost, u otro host con `moodleHost`), como el de verdad:
//  - auth_oauth2 del núcleo: botón «Microsoft» en /login/index.php → /auth/oauth2/login.php?id=1&wantsurl&sesskey
//    (require_sesskey) → authorize con state = esa misma dirección (lleva la sesskey de la sesión) → Microsoft vuelve a
//    /admin/oauth2callback.php?code&state, que compara la sesskey con la de la sesión (MoodleSession): si casa, sigue a
//    /auth/oauth2/login.php?…&oauth2code; si no, «Your session has most likely timed out» y de vuelta a /login/index.php.
//  - auth_oidc (plugin de Microsoft 365): /auth/oidc/?source=loginpage guarda una fila de estado de un solo uso (con la
//    sesskey) y pone la cookie auth_oidc_csrf = sesskey (SameSite=None, 5 min); Microsoft vuelve por form_post (o query) a
//    /auth/oidc/, que compara la sesskey de la fila con esa cookie (o con la de la sesión si no llegó) y la borra; un estado
//    desconocido o que no casa da «Unknown state» (errorauthunknownstate). Como microsoft/moodle-auth_oidc MOODLE_405_STABLE.
//  - MoodleSession con SameSite=Lax (Moodle 4.5, MDL-83526): no llega en el form_post entre sitios. Con `moodleCookie:
//    'none-secure'`, como Moodle ≤ 4.4 con un navegador Chrome (SameSite=None; Secure).
//  - opcional: /login/index.php manda directo a Microsoft (forceredirect), todo el sitio pide acceso (forcelogin) y una
//    política del sitio que hay que aceptar antes de que /my/ funcione (/user/policy.php).
//  - al entrar, sesión NUEVA (session_regenerate_id) y sesskey nueva; redirecciones 303 (las de Moodle);
//  - con la política pendiente, `core_session_touch` funciona (como en el de verdad) y lo demás da sitepolicynotagreed;
//  - /login/index.php con la sesión viva: «Ya has iniciado sesión» (su botón principal CIERRA la sesión).
// Portal de la universidad (opcional, `portalHost`): otro host del mismo sitio con un enlace al Moodle (la dirección que el
// estudiante guardó no es la del Moodle).
// Microsoft (login.microsoftonline.localhost, u otro host con `msHost`), como Entra ID:
//  - /common/oauth2/v2.0/authorize → página del usuario → de la contraseña → «¿Quiere mantener la sesión iniciada?» (KMSI);
//  - con la sesión de Microsoft viva (ESTSAUTH / ESTSAUTHPERSISTENT) devuelve el código sin pantallas;
//  - cookie de contexto por flujo (como esctx) que CADA /authorize nuevo pisa: un flujo viejo falla al enviar y vuelve a
//    empezar en la página del usuario (authorize otra vez, con sso_reload=true);
//  - detección de bucles: demasiados /authorize del mismo cliente en poco tiempo → AADSTS50196;
//  - opcional: un error de Entra en /authorize (acceso condicional: AADSTS53003…) y botones de llave de acceso (passkey) en
//    la página del usuario, que llaman a `navigator.credentials.get/create` con `publicKey` y escriben el resultado.
// Cada petición se apunta con su Sec-Fetch-Mode: `navigate` = una ventana; otra cosa = petición de fondo (net.request de Aula).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface MoodleMicrosoftOptions {
  /** Cómo entra Moodle con Microsoft: auth_oauth2 del núcleo o el plugin auth_oidc. */
  auth: 'oauth2' | 'oidc'
  /** auth_oidc: cómo vuelve Microsoft (form_post, como el plugin; o query). */
  responseMode?: 'form_post' | 'query'
  /** auth_oidc «forceredirect»: /login/index.php manda directo a Microsoft. */
  forceRedirect?: boolean
  /** forcelogin: la portada pide acceso. */
  forceLogin?: boolean
  /** Política del sitio que hay que aceptar tras entrar. */
  policy?: boolean
  /** Atributos de MoodleSession: Lax (Moodle 4.5+, por defecto), None; Secure (Moodle ≤ 4.4 con Chrome) o sin atributo. */
  moodleCookie?: 'none-secure' | 'lax' | 'unspecified'
  /** auth_oidc: cookie auth_oidc_csrf que ata el estado al navegador (por defecto, sí: el plugin actual). */
  oidcCsrfCookie?: boolean
  /** Microsoft pregunta «¿Quiere mantener la sesión iniciada?» (por defecto, sí). */
  kmsi?: boolean
  /** Cada /authorize nuevo pisa la cookie de contexto del flujo (por defecto, sí). false = una cookie por flujo. */
  sharedFlowCookie?: boolean
  /** Detección de bucles: más de `loopLimit` /authorize del mismo cliente en `loopWindowMs` → AADSTS50196. */
  loopLimit?: number
  loopWindowMs?: number
  /** Lo que tarda Moodle en canjear el código al volver de Microsoft (ms). */
  callbackDelayMs?: number
  /** Doble factor de Microsoft: «Aprueba la solicitud en Authenticator» (la página espera sola hasta `approveMfa()`). */
  mfa?: boolean
  /** Moodle lento con las peticiones de fondo a /my/ (la comprobación de Aula tarda en volver), en ms. */
  slowBackgroundMs?: number
  /** Retiene las navegaciones a la portada de Moodle (ms): da tiempo a que el estudiante vaya a otra dirección. */
  holdFrontMs?: number
  /** Host del Moodle (por defecto moodle.localhost). */
  moodleHost?: string
  /** Host de Microsoft (por defecto login.microsoftonline.localhost). */
  msHost?: string
  /** Portal de la universidad en este host (mismo sitio que el Moodle), con un enlace «Campus virtual» al Moodle. */
  portalHost?: string
  /** Microsoft: botones de llave de acceso (passkey) en la página del usuario. */
  passkey?: boolean
  /** Tope que la página pide a WebAuthn (`publicKey.timeout`, ms; por defecto 8000). */
  passkeyTimeoutMs?: number
  /** Microsoft contesta /authorize con este error de Entra (p. ej. «AADSTS53003: …»). */
  authorizeError?: string
}

export type Site = 'moodle' | 'ms' | 'portal'

export interface MMRequest {
  /** ms desde que arrancó el falso. */
  t: number
  site: Site
  method: string
  path: string
  /** Parámetros que importan (cortos). */
  info: string
  /** Sec-Fetch-Mode (navigate = una ventana). */
  mode: string
  dest: string
  /** Principio de la MoodleSession que llegó (o '-'). */
  sid: string
  authed: boolean
  status?: number
  location?: string
}

export type MMEventKind =
  | 'authorize' | 'flow-created' | 'flow-stale' | 'loop-detected' | 'sso-silent' | 'code-issued' | 'code-redeemed' | 'code-reused'
  | 'moodle-login' | 'sesskey-mismatch' | 'unknown-state' | 'csrf-mismatch' | 'policy-accepted' | 'policy-published' | 'new-moodle-session'
  | 'oidc-state-created' | 'ajax' | 'mark'

export interface MMEvent {
  t: number
  kind: MMEventKind
  detail: string
  background: boolean
}

export interface MMSummary {
  /** /authorize en total, desde una ventana y de fondo. */
  authorize: number
  authorizeWindow: number
  authorizeBackground: number
  /** Flujos de Microsoft creados (página del usuario mostrada). */
  flows: number
  /** Envíos de un flujo viejo (el estudiante vuelve a la página del usuario). */
  staleSubmits: number
  loopErrors: number
  /** GET /my/ de fondo (la comprobación de Aula) y peticiones de fondo a Moodle en total. */
  verifyMy: number
  backgroundMoodle: number
  moodleLogins: number
  sesskeyMismatch: number
  unknownState: number
  /** auth_oidc: la cookie auth_oidc_csrf no casaba con la fila del estado (también cuenta en unknownState). */
  csrfMismatch: number
  codeReused: number
  oidcStates: number
  newMoodleSessions: number
  policyAcceptedAt: number | null
  /** Peticiones a /login/logout.php (nadie debería cerrar la sesión). */
  logouts: number
  /** Llamadas AJAX a core_session_touch. */
  touches: number
}

export interface FakeMoodleMicrosoft {
  moodleURL: string
  msOrigin: string
  /** Portada del portal (con `portalHost`), o null. */
  portalURL: string | null
  requests: MMRequest[]
  events: MMEvent[]
  /** Marca en la línea de tiempo (lo que hace el estudiante o la prueba). */
  mark(detail: string): void
  now(): number
  summary(from?: number): MMSummary
  /** La secuencia de peticiones y sucesos, legible. */
  timeline(from?: number): string
  /** Moodle olvida todas sus sesiones (caducan en el servidor). */
  expireMoodleSessions(): void
  /** Microsoft olvida sus sesiones (ESTSAUTH / ESTSAUTHPERSISTENT ya no valen). */
  expireMicrosoftSessions(): void
  /** ¿El usuario aceptó la política? */
  policyAgreed(): boolean
  /** El estudiante aprueba en el móvil la última solicitud de doble factor. */
  approveMfa(): void
  /** Moodle publica una versión nueva de la política: hay que volver a aceptarla. */
  publishPolicy(): void
  /** Sesión de Moodle ya iniciada (como si el estudiante hubiera entrado antes): el valor de la cookie MoodleSession. */
  authedSession(): string
  /** Cambia opciones sobre la marcha (p. ej. `holdFrontMs`). */
  set(changes: Partial<MoodleMicrosoftOptions>): void
  close(): Promise<void>
}

const rid = (n = 9): string => randomBytes(n).toString('hex')
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function cookiesOf(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    // como PHP: si un nombre se repite, vale el primero
    if (i > 0 && !out.has(part.slice(0, i).trim())) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  }
  return out
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (c: Buffer) => (s += c.toString('utf8')))
    req.on('end', () => resolve(s))
  })
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return (server.address() as AddressInfo).port
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface MoodleSess {
  id: string
  authed: boolean
  sesskey: string
  wantsurl?: string
  loginError?: string
}

interface Flow {
  id: string
  /** Dirección de authorize de este flujo (para volver a empezar). */
  authorizeURL: string
  params: URLSearchParams
  stage: 'username' | 'password' | 'mfa' | 'kmsi' | 'done'
  mfaApproved?: boolean
}

export async function startFakeMoodleMicrosoft(input: MoodleMicrosoftOptions): Promise<FakeMoodleMicrosoft> {
  // copia: `set` y `publishPolicy` las cambian sobre la marcha
  const opts: MoodleMicrosoftOptions = { ...input }
  const t0 = Date.now()
  const now = (): number => Date.now() - t0
  const requests: MMRequest[] = []
  const events: MMEvent[] = []
  const ports = { moodle: 0, ms: 0, portal: 0 }
  const mo = (): string => `http://${opts.moodleHost ?? 'moodle.localhost'}:${ports.moodle}`
  const ms = (): string => `http://${opts.msHost ?? 'login.microsoftonline.localhost'}:${ports.ms}`
  const po = (): string => `http://${opts.portalHost ?? 'portal.localhost'}:${ports.portal}`
  const sessions = new Map<string, MoodleSess>()
  const oidcStates = new Map<string, { wantsurl?: string; sesskey: string }>()
  const flows = new Map<string, Flow>()
  const codes = new Map<string, { used: boolean }>()
  const ssoSessions = new Set<string>()
  const authorizeTimes = new Map<string, number[]>()
  let flowSeq = 0
  let pageSeq = 0
  let userPolicyAgreed = false
  let policyAcceptedAt: number | null = null

  const event = (kind: MMEventKind, detail: string, background = false): void => {
    events.push({ t: now(), kind, detail, background })
  }
  const isBackground = (req: IncomingMessage): boolean => String(req.headers['sec-fetch-mode'] ?? '') !== 'navigate'

  const moodleCookie = (sid: string): string => {
    const base = `MoodleSession=${sid}; path=/; HttpOnly`
    const mode = opts.moodleCookie ?? 'lax'
    return mode === 'none-secure' ? `${base}; Secure; SameSite=None` : mode === 'lax' ? `${base}; SameSite=Lax` : base
  }
  // las de Microsoft: siempre SameSite=None; Secure (como las de verdad)
  const msCookie = (name: string, value: string, maxAgeSec?: number): string =>
    `${name}=${value}; path=/; Secure; HttpOnly; SameSite=None${maxAgeSec ? `; Max-Age=${maxAgeSec}` : ''}`

  /** Apunta la petición (y su respuesta, al terminar). */
  const record = (req: IncomingMessage, res: ServerResponse, site: Site, u: URL, sid: string, authed: boolean): MMRequest => {
    const keep = ['sesskey', 'source', 'state', 'code', 'oauth2code', 'prompt', 'response_mode', 'error', 'sso_reload', 'redirect', 'info', 'wantsurl']
    const info = keep.filter((k) => u.searchParams.has(k)).map((k) => `${k}=${String(u.searchParams.get(k)).slice(0, 14)}`).join('&')
    const r: MMRequest = {
      t: now(), site, method: req.method ?? 'GET', path: u.pathname, info,
      mode: String(req.headers['sec-fetch-mode'] ?? ''), dest: String(req.headers['sec-fetch-dest'] ?? ''),
      sid: sid ? sid.slice(0, 6) : '-', authed
    }
    requests.push(r)
    res.on('finish', () => {
      r.status = res.statusCode
      const loc = res.getHeader('location')
      if (loc) {
        const l = String(loc)
        r.location = l.replace(mo(), 'moodle').replace(ms(), 'ms').replace(po(), 'portal').slice(0, 90)
      }
    })
    return r
  }

  const send = (res: ServerResponse, status: number, html: string, headers: Record<string, string | string[]> = {}): void => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
    res.end(html)
  }
  const redirect = (res: ServerResponse, to: string, status = 303, headers: Record<string, string | string[]> = {}): void => {
    res.writeHead(status, { Location: to, 'Cache-Control': 'no-store', ...headers })
    res.end()
  }
  const json = (res: ServerResponse, data: unknown, headers: Record<string, string | string[]> = {}): void => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
    res.end(JSON.stringify(data))
  }

  // MARK: Moodle

  /** Página de Moodle (Boost): body con id y clases (notloggedin sin sesión), menú del usuario con la salida y M.cfg. */
  const moodlePage = (s: MoodleSess, o: { id: string; title: string; inner: string; fake: string; userid?: boolean }): string => {
    const header = s.authed
      ? `<nav class="navbar"><a id="user-menu-toggle" href="#">Estudiante</a> <a href="${mo()}/login/logout.php?sesskey=${s.sesskey}">Cerrar sesión</a></nav>`
      : `<nav class="navbar"><a href="${mo()}/login/index.php">Acceder</a></nav>`
    const cls = `format-site path-${o.id.replace(/^page-/, '').split('-')[0]} ${s.authed ? '' : 'notloggedin'}`
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title>
      <script>var M = {}; M.cfg = {"wwwroot":"${mo()}","sesskey":"${s.sesskey}","sessiontimeout":"7200"};</script></head>
      <body id="${o.id}" class="${cls}" data-fake="${o.fake}" data-page="${++pageSeq}" ${o.userid && s.authed ? 'data-userid="7"' : ''} style="font:16px system-ui;padding:32px">
      ${header}<div id="region-main">${o.inner}</div></body></html>`
  }

  const moodleError = (s: MoodleSess, message: string, cont: string): string =>
    moodlePage(s, { id: 'page-error', title: 'Error', fake: 'moodle-error', inner: `<div class="alert alert-danger">${esc(message)}</div><a class="btn" id="continue" href="${cont}">Continuar</a>` })

  /** auth_oauth2 / auth_oidc: dirección de authorize de Microsoft. */
  const authorizeURL = (p: Record<string, string>): string => {
    const q = new URLSearchParams({ client_id: 'aula-fake-moodle', response_type: 'code', scope: 'openid profile email', nonce: rid(6), ...p })
    return `${ms()}/common/oauth2/v2.0/authorize?${q}`
  }

  const moodle = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', mo())
    const jar = cookiesOf(req)
    let sid = jar.get('MoodleSession') ?? ''
    const set: string[] = []
    const bg = isBackground(req)
    if (!sessions.has(sid)) {
      sid = rid()
      sessions.set(sid, { id: sid, authed: false, sesskey: rid(5) })
      set.push(moodleCookie(sid))
      event('new-moodle-session', `${u.pathname} ${sid.slice(0, 6)}`, bg)
    }
    let s = sessions.get(sid) as MoodleSess
    record(req, res, 'moodle', u, jar.get('MoodleSession') ?? '', s.authed)
    const h = (): Record<string, string | string[]> => (set.length ? { 'Set-Cookie': [...set] } : {})

    /** complete_user_login: sesión nueva (otra cookie, otra sesskey); $SESSION (wantsurl) se queda. */
    const login = (via: string): MoodleSess => {
      sessions.delete(s.id)
      const fresh: MoodleSess = { id: rid(), authed: true, sesskey: rid(5), wantsurl: s.wantsurl }
      sessions.set(fresh.id, fresh)
      for (let i = set.length - 1; i >= 0; i--) if (set[i].startsWith('MoodleSession=')) set.splice(i, 1)
      set.push(moodleCookie(fresh.id))
      event('moodle-login', `${via} → ${fresh.id.slice(0, 6)}`, bg)
      s = fresh
      return fresh
    }
    const returnURL = (): string => {
      const w = s.wantsurl
      s.wantsurl = undefined
      return w && w.startsWith(mo()) ? w : `${mo()}/my/`
    }
    /** require_login(): sin sesión, al acceso (apunta wantsurl); con política sin aceptar, a la política. */
    const requireLogin = (): boolean => {
      if (!s.authed) {
        s.wantsurl = `${mo()}${u.pathname}${u.search}`
        redirect(res, `${mo()}/login/index.php`, 303, h())
        return false
      }
      if (opts.policy && !userPolicyAgreed) {
        s.wantsurl = `${mo()}${u.pathname}${u.search}`
        redirect(res, `${mo()}/user/policy.php`, 303, h())
        return false
      }
      return true
    }

    const p = u.pathname
    if (p === '/' || p === '/index.php') {
      if (!bg && opts.holdFrontMs) await sleep(opts.holdFrontMs)
      if (opts.forceLogin && !requireLogin()) return
      if (s.authed && u.searchParams.get('redirect') !== '0') {
        if (!requireLogin()) return
        return redirect(res, `${mo()}/my/`, 303, h())
      }
      return send(res, 200, moodlePage(s, { id: 'page-site-index', title: 'Campus virtual', fake: s.authed ? 'moodle-front-authed' : 'moodle-front', inner: '<h1>Campus virtual</h1><p>Cursos disponibles…</p>' }), h())
    }

    if (p === '/login/index.php') {
      if (s.authed) {
        // login/index.php (alreadyloggedin): confirmación cuyo botón principal CIERRA la sesión
        return send(res, 200, moodlePage(s, {
          id: 'page-login-index', title: 'Acceso', fake: 'moodle-already',
          inner: `<div class="modal-dialog" role="alertdialog"><p>Ya has iniciado sesión como Estudiante, necesitas salir antes de volver a entrar con otro usuario.</p>
            <form method="post" action="${mo()}/login/logout.php?sesskey=${s.sesskey}&amp;loginpage=1"><button class="btn btn-primary" id="already-logout">Cerrar sesión</button></form>
            <form method="get" action="${mo()}/"><button class="btn btn-secondary" id="already-cancel">Cancelar</button></form></div>`
        }), h())
      }
      if (opts.auth === 'oidc' && opts.forceRedirect && u.searchParams.get('noredirect') !== '1') {
        return redirect(res, `${mo()}/auth/oidc/?source=loginpage`, 303, h())
      }
      const err = s.loginError
      s.loginError = undefined
      const wants = s.wantsurl ?? ''
      const provider = opts.auth === 'oauth2'
        ? `${mo()}/auth/oauth2/login.php?id=1&wantsurl=${encodeURIComponent(wants)}&sesskey=${s.sesskey}`
        : `${mo()}/auth/oidc/?source=loginpage`
      return send(res, 200, moodlePage(s, {
        id: 'page-login-index', title: 'Acceso', fake: 'moodle-login',
        inner: `<h1>Campus virtual</h1>${err ? `<div class="alert alert-danger" id="loginerrormessage">${esc(err)}</div>` : ''}
          <form id="login" method="post" action="${mo()}/login/index.php"><input type="hidden" name="logintoken" value="${rid(6)}">
          <label>Usuario <input name="username" id="username"></label> <label>Contraseña <input type="password" name="password" id="password"></label>
          <button id="loginbtn">Acceder</button></form>
          <h2>Identifíquese usando su cuenta en:</h2><a class="btn login-identityprovider-btn" id="ms-provider" href="${provider}">Microsoft</a>`
      }), h())
    }

    // auth_oauth2 del núcleo
    if (p === '/auth/oauth2/login.php') {
      // require_sesskey(): la de la dirección tiene que ser la de ESTA sesión
      if (u.searchParams.get('sesskey') !== s.sesskey) {
        event('sesskey-mismatch', `login.php (url ${String(u.searchParams.get('sesskey')).slice(0, 6)} ≠ sesión ${s.sesskey.slice(0, 6)})`, bg)
        return send(res, 200, moodleError(s, 'Your session has most likely timed out. Please log in again.', `${mo()}/login/index.php`), h())
      }
      const code = u.searchParams.get('oauth2code')
      const wants = u.searchParams.get('wantsurl') ?? ''
      if (code) {
        await sleep(opts.callbackDelayMs ?? 0)
        if (!redeem(code)) return send(res, 200, moodleError(s, 'Could not upgrade oauth token', `${mo()}/login/index.php`), h())
        if (wants) s.wantsurl = wants
        login('auth_oauth2')
        return redirect(res, returnURL(), 303, h())
      }
      const state = `${mo()}/auth/oauth2/login.php?wantsurl=${encodeURIComponent(wants)}&sesskey=${s.sesskey}&id=1`
      return redirect(res, authorizeURL({ redirect_uri: `${mo()}/admin/oauth2callback.php`, state, response_mode: 'query' }), 303, h())
    }
    if (p === '/admin/oauth2callback.php') {
      const error = u.searchParams.get('error')
      if (error) return send(res, 200, moodleError(s, u.searchParams.get('error_description') ?? error, `${mo()}/login/index.php`), h())
      const code = u.searchParams.get('code') ?? ''
      let target: URL | null = null
      try {
        target = new URL(u.searchParams.get('state') ?? '')
      } catch { /* sin estado */ }
      if (target && target.searchParams.get('sesskey') === s.sesskey) {
        target.searchParams.set('oauth2code', code)
        return redirect(res, target.toString(), 303, h())
      }
      event('sesskey-mismatch', `oauth2callback (state ${String(target?.searchParams.get('sesskey')).slice(0, 6)} ≠ sesión ${s.sesskey.slice(0, 6)})`, bg)
      s.loginError = 'Your session has most likely timed out. Please log in again.'
      return redirect(res, `${mo()}/login/index.php`, 303, h())
    }

    // auth_oidc (Microsoft 365)
    if (p === '/auth/oidc/' || p === '/auth/oidc/index.php') {
      const params = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : u.searchParams
      if (params.get('error')) {
        s.loginError = params.get('error_description') ?? params.get('error') ?? 'error'
        return redirect(res, `${mo()}/login/index.php?noredirect=1`, 303, h())
      }
      const code = params.get('code')
      if (code) {
        const st = params.get('state') ?? ''
        const row = oidcStates.get(st)
        if (!row) {
          event('unknown-state', st.slice(0, 8), bg)
          return send(res, 200, moodleError(s, 'Unknown state.', `${mo()}/login/index.php?noredirect=1`), h())
        }
        oidcStates.delete(st)
        if (opts.oidcCsrfCookie !== false) {
          // verify_csrf_cookie(): la cookie (o, si no llegó, la sesskey de la sesión) tiene que ser la de la fila; se borra
          const token = jar.get('auth_oidc_csrf') || s.sesskey
          set.push(`auth_oidc_csrf=; path=/; Max-Age=0; Secure; HttpOnly; SameSite=None`)
          if (token !== row.sesskey) {
            event('csrf-mismatch', `fila ${row.sesskey.slice(0, 6)} ≠ ${jar.get('auth_oidc_csrf') ? 'cookie' : 'sesión'} ${token.slice(0, 6)}`, bg)
            event('unknown-state', st.slice(0, 8), bg)
            return send(res, 200, moodleError(s, 'Unknown state.', `${mo()}/login/index.php?noredirect=1`), h())
          }
        }
        await sleep(opts.callbackDelayMs ?? 0)
        if (!redeem(code)) return send(res, 200, moodleError(s, 'Could not get an access token (AADSTS54005).', `${mo()}/login/index.php?noredirect=1`), h())
        if (row.wantsurl && !s.wantsurl) s.wantsurl = row.wantsurl
        login('auth_oidc')
        return redirect(res, returnURL(), 303, h())
      }
      const st = rid(8)
      oidcStates.set(st, { wantsurl: s.wantsurl, sesskey: s.sesskey })
      event('oidc-state-created', `${st.slice(0, 8)} sesskey ${s.sesskey.slice(0, 6)}`, bg)
      // set_csrf_cookie(): la sesskey de ESTA sesión viaja en una cookie SameSite=None (la de la sesión es Lax)
      if (opts.oidcCsrfCookie !== false) set.push(`auth_oidc_csrf=${s.sesskey}; path=/; Max-Age=300; Secure; HttpOnly; SameSite=None`)
      return redirect(res, authorizeURL({ redirect_uri: `${mo()}/auth/oidc/`, state: st, response_mode: opts.responseMode ?? 'form_post' }), 303, h())
    }

    if (p === '/my/' || p === '/my' || p === '/my/index.php') {
      if (bg && opts.slowBackgroundMs) await sleep(opts.slowBackgroundMs)
      if (!requireLogin()) return
      const filler = '<p>' + 'Contenido del curso. '.repeat(2000) + '</p>'
      return send(res, 200, moodlePage(s, { id: 'page-my-index', title: 'Área personal', fake: 'moodle-dashboard', userid: true, inner: `<h1>Área personal</h1>${filler}` }), h())
    }

    if (p === '/user/policy.php') {
      if (!s.authed) return void requireLogin()
      if (req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req))
        if (form.get('sesskey') === s.sesskey && form.get('agree') === '1') {
          userPolicyAgreed = true
          policyAcceptedAt = now()
          event('policy-accepted', '', bg)
          return redirect(res, returnURL(), 303, h())
        }
        return redirect(res, `${mo()}/login/logout.php?sesskey=${s.sesskey}`, 303, h())
      }
      return send(res, 200, moodlePage(s, {
        id: 'page-user-policy', title: 'Política del sitio', fake: 'moodle-policy',
        inner: `<h1>Política del sitio</h1><p>Debe aceptar esta política para continuar usando este sitio.</p>
          <form method="post" action="${mo()}/user/policy.php"><input type="hidden" name="sesskey" value="${s.sesskey}"><input type="hidden" name="agree" value="1">
          <button id="agree">Sí, acepto</button></form>`
      }), h())
    }

    if (p === '/lib/ajax/service.php') {
      const raw = req.method === 'POST' ? await readBody(req) : '[]'
      let calls: { methodname?: string }[] = []
      try {
        calls = JSON.parse(raw) as { methodname?: string }[]
      } catch { /* vacío */ }
      const fail = (errorcode: string): unknown => ({ error: true, exception: { errorcode, message: errorcode } })
      event('ajax', calls.map((c) => c.methodname ?? '?').join(','), bg)
      if (!s.authed) return json(res, [fail('servicerequireslogin')], h())
      if (u.searchParams.get('sesskey') !== s.sesskey) return json(res, [fail('invalidsesskey')], h())
      // como el de verdad: el toque de la sesión no pasa por require_login (no mira la política); lo demás, sí
      const sessionOnly = (c: { methodname?: string }): boolean => c.methodname === 'core_session_touch' || c.methodname === 'core_session_time_remaining'
      if (opts.policy && !userPolicyAgreed) return json(res, calls.map((c) => (sessionOnly(c) ? { error: false, data: true } : fail('sitepolicynotagreed'))), h())
      return json(res, calls.map((c) => {
        if (c.methodname === 'core_course_get_enrolled_courses_by_timeline_classification') return { error: false, data: { courses: [{ id: 3, fullname: 'Cálculo I', shortname: 'CAL1', viewurl: `${mo()}/course/view.php?id=3` }], nextoffset: 1 } }
        if (c.methodname === 'core_calendar_get_calendar_export_token') return { error: false, data: { token: 'tok' + rid(4) } }
        return { error: false, data: true }
      }), h())
    }

    if (p === '/login/logout.php') {
      if (u.searchParams.get('sesskey') === s.sesskey) {
        sessions.delete(s.id)
        return redirect(res, `${mo()}/`, 303)
      }
      return redirect(res, `${mo()}/`, 303, h())
    }

    if (p === '/calendar/export_execute.php') {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
      return void res.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Moodle falso//ES\r\nEND:VCALENDAR\r\n')
    }

    if (p === '/calendar/export.php') {
      if (!requireLogin()) return
      return send(res, 200, moodlePage(s, { id: 'page-calendar-export', title: 'Exportar', fake: 'moodle-other', inner: '<p>Exportar calendario</p>' }), h())
    }

    return send(res, 404, moodlePage(s, { id: 'page-404', title: 'No', fake: 'moodle-404', inner: 'No existe' }), h())
  })

  // MARK: Microsoft Entra ID

  function redeem(code: string): boolean {
    const c = codes.get(code)
    if (!c) return false
    if (c.used) {
      event('code-reused', code.slice(0, 8))
      return false
    }
    c.used = true
    event('code-redeemed', code.slice(0, 8))
    return true
  }

  const msPage = (title: string, fake: string, inner: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
     <body data-fake="${fake}" data-page="${++pageSeq}" style="font:15px 'Segoe UI',system-ui;padding:40px;max-width:440px">
     <div style="font-weight:600;margin-bottom:16px">Microsoft</div>${inner}</body></html>`

  const hidden = (fields: Record<string, string>): string => Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')

  /** La cookie de contexto del flujo que tiene el navegador, ¿es la de este flujo? */
  const flowCookieOK = (jar: Map<string, string>, flow: Flow): boolean =>
    opts.sharedFlowCookie === false ? jar.get(`esctx-${flow.id}`) === flow.id : jar.get('esctx') === flow.id

  /** Respuesta con el código (form_post: formulario que se envía solo; query: redirección). */
  const issue = (res: ServerResponse, params: URLSearchParams, extraCookies: string[] = [], why = ''): void => {
    const code = 'M.' + rid(8)
    codes.set(code, { used: false })
    event('code-issued', `${code.slice(0, 8)} ${why}`)
    const redirectURI = params.get('redirect_uri') ?? ''
    const fields = { code, state: params.get('state') ?? '', session_state: rid(6) }
    const headers: Record<string, string | string[]> = extraCookies.length ? { 'Set-Cookie': extraCookies } : {}
    if ((params.get('response_mode') ?? 'query') === 'form_post') {
      return send(res, 200, msPage('Working…', 'ms-autopost', `<p>Redirigiendo…</p><form method="post" action="${esc(redirectURI)}">${hidden(fields)}
        <noscript><button>Continue</button></noscript></form><script>setTimeout(function(){ document.forms[0].submit() }, 300)</script>`), headers)
    }
    return redirect(res, `${redirectURI}${redirectURI.includes('?') ? '&' : '?'}${new URLSearchParams(fields)}`, 302, headers)
  }

  const errorTo = (res: ServerResponse, params: URLSearchParams, error: string, description: string): void => {
    const redirectURI = params.get('redirect_uri') ?? ''
    const fields = { error, error_description: description, state: params.get('state') ?? '' }
    if ((params.get('response_mode') ?? 'query') === 'form_post') {
      return send(res, 200, msPage('Working…', 'ms-autopost', `<form method="post" action="${esc(redirectURI)}">${hidden(fields)}</form><script>setTimeout(function(){ document.forms[0].submit() }, 300)</script>`))
    }
    return redirect(res, `${redirectURI}?${new URLSearchParams(fields)}`, 302)
  }

  const usernamePage = (flow: Flow, note = ''): string =>
    msPage('Sign in to your account', 'ms-username', `<h1>Sign in</h1>${note ? `<p id="usernameError">${esc(note)}</p>` : ''}
      <form method="post" action="${ms()}/common/login">${hidden({ ctx: flow.id, flowToken: 'FT' + flow.id, step: 'username' })}
      <input type="email" name="loginfmt" id="i0116" placeholder="Email, phone, or Skype" autocomplete="username">
      <input type="submit" id="idSIButton9" value="Next"></form>${opts.passkey ? passkeyBox() : ''}`)

  /**
   * «Iniciar sesión con una llave de acceso» y «Crear una llave de acceso»: la página llama a WebAuthn con `publicKey` (como
   * Microsoft) y escribe en #passkey-result «<get|create>: <resultado> <ms>». `data-timeout` en el botón cambia el tope pedido.
   */
  const passkeyBox = (): string => `<div id="passkey-box" style="margin-top:20px">
      <button type="button" id="passkey-get">Sign in with a passkey</button> <button type="button" id="passkey-create">Create a passkey</button>
      <output id="passkey-result"></output></div>
      <script>(function(){
        var T = ${Number(opts.passkeyTimeoutMs ?? 8000)};
        function run(kind, btn){
          var out = document.getElementById('passkey-result'), t0 = Date.now(), ms = Number(btn.getAttribute('data-timeout')) || T;
          var challenge = new Uint8Array(32); crypto.getRandomValues(challenge);
          var p;
          try {
            p = kind === 'get'
              ? navigator.credentials.get({ publicKey: { challenge: challenge, timeout: ms, userVerification: 'required', allowCredentials: [] } })
              : navigator.credentials.create({ publicKey: { challenge: challenge, rp: { name: 'Entra falso' }, user: { id: new Uint8Array(8), name: 'estudiante@uni.localhost', displayName: 'Estudiante' },
                  pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: ms, authenticatorSelection: { residentKey: 'required', userVerification: 'required' } } });
          } catch (e) { out.textContent = kind + ': threw ' + e.name; return; }
          out.textContent = kind + ': pending';
          p.then(function(){ out.textContent = kind + ': resolved ' + (Date.now() - t0) }, function(e){ out.textContent = kind + ': ' + e.name + ' ' + (Date.now() - t0) });
        }
        document.getElementById('passkey-get').addEventListener('click', function(){ run('get', this) });
        document.getElementById('passkey-create').addEventListener('click', function(){ run('create', this) });
      })()</script>`

  const passwordPage = (flow: Flow): string =>
    msPage('Sign in to your account', 'ms-password', `<h1>Enter password</h1>
      <form method="post" action="${ms()}/common/login">${hidden({ ctx: flow.id, flowToken: 'FT' + flow.id, step: 'password' })}
      <input type="password" name="passwd" id="i0118" placeholder="Password" autocomplete="current-password">
      <input type="submit" id="idSIButton9" value="Sign in"></form>`)

  const mfaPage = (flow: Flow): string =>
    msPage('Sign in to your account', 'ms-mfa', `<h1>Approve sign in request</h1><p>Open your Authenticator app, and enter the number shown to sign in.</p>
      <div id="idRichContext_DisplaySign" style="font-size:40px">42</div>
      <form method="post" action="${ms()}/common/SAS/ProcessAuth">${hidden({ ctx: flow.id, flowToken: 'FT' + flow.id })}</form>
      <script>(function poll(){ fetch('${ms()}/common/SAS/EndAuth?ctx=${flow.id}', { method: 'POST', credentials: 'include' }).then(function(r){ return r.json() })
        .then(function(j){ if (j.Success) document.forms[0].submit(); else setTimeout(poll, 1000) }, function(){ setTimeout(poll, 1000) }) })()</script>`)

  const kmsiPage = (flow: Flow): string =>
    msPage('Sign in to your account', 'ms-kmsi', `<h1>Stay signed in?</h1><p>Do this to reduce the number of times you are asked to sign in.</p>
      <form method="post" action="${ms()}/kmsi">${hidden({ ctx: flow.id, flowToken: 'FT' + flow.id })}
      <label><input type="checkbox" name="DontShowAgain" id="KmsiCheckboxField"> Don't show this again</label><br>
      <button type="submit" name="LoginOptions" value="3" id="idBtn_Back">No</button>
      <button type="submit" name="LoginOptions" value="1" id="idSIButton9">Yes</button></form>`)

  const msServer = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', ms())
    const jar = cookiesOf(req)
    const bg = isBackground(req)
    const sso = ssoSessions.has(jar.get('ESTSAUTH') ?? '') || ssoSessions.has(jar.get('ESTSAUTHPERSISTENT') ?? '')
    record(req, res, 'ms', u, '', sso)

    if (u.pathname === '/common/oauth2/v2.0/authorize') {
      const params = u.searchParams
      // el cliente (buid) y la detección de bucles
      const cookies: string[] = []
      let buid = jar.get('buid')
      if (!buid) {
        buid = rid(6)
        cookies.push(msCookie('buid', buid, 365 * 86_400))
      }
      const list = (authorizeTimes.get(buid) ?? []).filter((t) => now() - t < (opts.loopWindowMs ?? 60_000))
      list.push(now())
      authorizeTimes.set(buid, list)
      event('authorize', `${bg ? 'fondo' : 'ventana'} ${params.get('redirect_uri')?.replace(mo(), '') ?? ''}${params.get('sso_reload') ? ' sso_reload' : ''} (${list.length} en la ventana de tiempo)`, bg)
      if (list.length > (opts.loopLimit ?? 8)) {
        event('loop-detected', `${list.length} /authorize`, bg)
        return send(res, 200, msPage('Sign in to your account', 'ms-error', `<h1>Sorry, but we’re having trouble signing you in.</h1>
          <p id="errorCode">AADSTS50196: The server terminated an operation because it encountered a client request loop. Please contact your app vendor.</p>`), cookies.length ? { 'Set-Cookie': cookies } : {})
      }
      if (opts.authorizeError) {
        return send(res, 200, msPage('Sign in to your account', 'ms-error', `<h1>You cannot access this right now</h1>
          <p id="errorCode">${esc(opts.authorizeError)}</p>`), cookies.length ? { 'Set-Cookie': cookies } : {})
      }
      const prompt = params.get('prompt')
      if (prompt === 'none' && !sso) return errorTo(res, params, 'login_required', 'AADSTS50058: A silent sign-in request was sent but no user is signed in.')
      if (sso && prompt !== 'login' && prompt !== 'select_account') {
        event('sso-silent', 'sesión de Microsoft viva: código sin pantallas', bg)
        return issue(res, params, cookies, '(SSO)')
      }
      const flow: Flow = { id: `f${++flowSeq}`, authorizeURL: u.toString(), params: new URLSearchParams(params), stage: 'username' }
      flows.set(flow.id, flow)
      event('flow-created', `${flow.id} ${bg ? '(fondo)' : '(ventana)'}`, bg)
      cookies.push(opts.sharedFlowCookie === false ? msCookie(`esctx-${flow.id}`, flow.id) : msCookie('esctx', flow.id), msCookie('fpc', rid(4)), msCookie('x-ms-gateway-slice', 'estsfd'))
      return send(res, 200, usernamePage(flow, params.get('sso_reload') ? 'Your session has timed out. Please sign in again.' : ''), { 'Set-Cookie': cookies })
    }

    if (u.pathname === '/common/SAS/EndAuth') {
      // la página del doble factor pregunta si ya se aprobó en el móvil (como la de verdad, cada segundo)
      const flow = flows.get(u.searchParams.get('ctx') ?? '')
      return json(res, { Success: !!flow?.mfaApproved, ResultValue: flow?.mfaApproved ? 'Success' : 'AuthenticationPending' })
    }

    if ((u.pathname === '/common/login' || u.pathname === '/kmsi' || u.pathname === '/common/SAS/ProcessAuth') && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      const flow = flows.get(form.get('ctx') ?? '')
      if (!flow || !flowCookieOK(jar, flow)) {
        // flujo viejo: su contexto ya no es el del navegador → se vuelve a empezar (authorize otra vez, en la página del usuario)
        event('flow-stale', `${flow?.id ?? '?'} en ${u.pathname}${form.get('step') ? ' · ' + form.get('step') : ''} (el navegador tiene ${jar.get('esctx') ?? '-'})`, bg)
        if (!flow) return send(res, 200, msPage('Error', 'ms-error', '<p id="errorCode">AADSTS90100: flowToken parameter is empty or not valid.</p>'))
        const again = new URL(flow.authorizeURL)
        again.searchParams.set('sso_reload', 'true')
        return redirect(res, again.toString(), 302)
      }
      if (u.pathname === '/common/login' && form.get('step') === 'username') {
        flow.stage = 'password'
        return send(res, 200, passwordPage(flow))
      }
      if (u.pathname === '/common/login' && form.get('step') === 'password' && opts.mfa) {
        flow.stage = 'mfa'
        return send(res, 200, mfaPage(flow))
      }
      if ((u.pathname === '/common/login' && form.get('step') === 'password') || u.pathname === '/common/SAS/ProcessAuth') {
        const token = rid(10)
        ssoSessions.add(token)
        const cookie = msCookie('ESTSAUTH', token)
        if (opts.kmsi === false) {
          flow.stage = 'done'
          return issue(res, flow.params, [cookie], '(contraseña)')
        }
        flow.stage = 'kmsi'
        return send(res, 200, kmsiPage(flow), { 'Set-Cookie': cookie })
      }
      if (u.pathname === '/kmsi') {
        flow.stage = 'done'
        const extra: string[] = []
        if (form.get('LoginOptions') === '1') {
          const persistent = rid(10)
          ssoSessions.add(persistent)
          extra.push(msCookie('ESTSAUTHPERSISTENT', persistent, 90 * 86_400))
        }
        return issue(res, flow.params, extra, '(KMSI)')
      }
    }
    return send(res, 404, msPage('Not found', 'ms-404', 'No existe'))
  })

  // MARK: Portal de la universidad (otro host del mismo sitio)

  const portal = createServer((req, res) => {
    const u = new URL(req.url ?? '/', po())
    record(req, res, 'portal', u, '', false)
    if (u.pathname === '/' || u.pathname === '/index.html') {
      return send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Universidad</title></head>
        <body data-fake="portal" data-page="${++pageSeq}" style="font:16px system-ui;padding:32px"><h1>Universidad</h1>
        <p><a id="campus-link" href="${mo()}/">Campus virtual</a> · <a href="${po()}/noticias">Noticias</a></p></body></html>`)
    }
    return send(res, 404, `<!doctype html><html><body data-fake="portal-404" data-page="${++pageSeq}">No existe</body></html>`)
  })

  ports.moodle = await listen(moodle)
  ports.ms = await listen(msServer)
  if (opts.portalHost) ports.portal = await listen(portal)

  const summary = (from = 0): MMSummary => {
    const ev = events.filter((e) => e.t >= from)
    const rq = requests.filter((r) => r.t >= from)
    const count = (k: MMEventKind, bg?: boolean): number => ev.filter((e) => e.kind === k && (bg === undefined || e.background === bg)).length
    return {
      authorize: count('authorize'),
      authorizeWindow: count('authorize', false),
      authorizeBackground: count('authorize', true),
      flows: count('flow-created'),
      staleSubmits: count('flow-stale'),
      loopErrors: count('loop-detected'),
      verifyMy: rq.filter((r) => r.site === 'moodle' && r.mode !== 'navigate' && /^\/my\/?$/.test(r.path) && r.method === 'GET').length,
      backgroundMoodle: rq.filter((r) => r.site === 'moodle' && r.mode !== 'navigate').length,
      moodleLogins: count('moodle-login'),
      sesskeyMismatch: count('sesskey-mismatch'),
      unknownState: count('unknown-state'),
      csrfMismatch: count('csrf-mismatch'),
      codeReused: count('code-reused'),
      oidcStates: count('oidc-state-created'),
      newMoodleSessions: count('new-moodle-session'),
      policyAcceptedAt,
      logouts: rq.filter((r) => r.site === 'moodle' && r.path === '/login/logout.php').length,
      touches: ev.filter((e) => e.kind === 'ajax' && e.detail.includes('core_session_touch')).length
    }
  }

  const timeline = (from = 0): string => {
    const rows: { t: number; line: string }[] = []
    for (const r of requests) {
      if (r.t < from) continue
      const who = r.mode === 'navigate' ? 'ventana' : `FONDO(${r.mode || '-'})`
      const out = r.status ? ` → ${r.status}${r.location ? ' ' + r.location : ''}` : ''
      rows.push({ t: r.t, line: `${r.method} ${r.site}${r.path}${r.info ? '?' + r.info : ''} [${who}] sid=${r.sid}${r.authed ? ' authed' : ''}${out}` })
    }
    for (const e of events) {
      if (e.t < from || e.kind === 'authorize') continue
      rows.push({ t: e.t, line: `  · ${e.kind}${e.background ? ' (fondo)' : ''}: ${e.detail}` })
    }
    return rows.sort((a, b) => a.t - b.t).map((r) => `+${(r.t / 1000).toFixed(2)}s ${r.line}`).join('\n')
  }

  return {
    moodleURL: `${mo()}/`,
    msOrigin: ms(),
    portalURL: opts.portalHost ? `${po()}/` : null,
    requests,
    events,
    mark: (detail) => event('mark', detail),
    now,
    summary,
    timeline,
    expireMoodleSessions: () => sessions.clear(),
    expireMicrosoftSessions: () => ssoSessions.clear(),
    policyAgreed: () => userPolicyAgreed,
    approveMfa: () => {
      const pending = [...flows.values()].filter((f) => f.stage === 'mfa' && !f.mfaApproved)
      const last = pending[pending.length - 1]
      if (last) {
        last.mfaApproved = true
        event('mark', `doble factor aprobado en el móvil (${last.id})`)
      }
    },
    publishPolicy: () => {
      opts.policy = true
      userPolicyAgreed = false
      policyAcceptedAt = null
      event('policy-published', 'versión nueva de la política')
    },
    authedSession: () => {
      const s: MoodleSess = { id: rid(), authed: true, sesskey: rid(5) }
      sessions.set(s.id, s)
      event('moodle-login', `sesión previa ${s.id.slice(0, 6)}`)
      return s.id
    },
    set: (changes) => {
      Object.assign(opts, changes)
    },
    close: async () => {
      for (const s of [moodle, msServer, portal]) {
        if (!s.listening) continue
        s.closeAllConnections?.()
        await new Promise<void>((r) => s.close(() => r()))
      }
    }
  }
}
