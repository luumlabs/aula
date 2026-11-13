import { describe, expect, it } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'
import { AulaError } from '../errors'
import { fakeHttp, html, json, redirectTo } from './fake-http'
import { HttpError } from './http'
import { MoodleClient, mapContents, movedServiceRoot } from './moodle'
import { cachedMoodleSesskey, checkSession, rememberMoodleSesskey, stopsBeforeHop } from './session-check'

const canvas: PlatformAccount = { id: 'c1', kind: 'canvas', label: 'Canvas', baseURL: 'https://uni.instructure.com/' }
const ROOT = 'https://campus.uni.edu/moodle'
const moodle = (id: string): PlatformAccount => ({ id, kind: 'moodle', label: 'Moodle', baseURL: `${ROOT}/` })
const MY = `${ROOT}/my/`
const SERVICE = (key: string, info: string) => `${ROOT}/lib/ajax/service.php?sesskey=${key}&info=${info}`
const signedInPage = (key: string) => `<script>M.cfg = {"wwwroot":"${ROOT}","sesskey":"${key}"};</script><div data-userid="77"></div><a href="${ROOT}/login/logout.php?sesskey=${key}">Salir</a>`
const loginPage = '<body id="page-login-index" class="notloggedin"><input type="password" name="password"></body>'

describe('checkSession', () => {
  it('Canvas: users/self con la sesión', async () => {
    const h = fakeHttp({ 'https://uni.instructure.com/api/v1/users/self': json('https://uni.instructure.com/api/v1/users/self', { id: 5, name: 'Ana' }) })
    const r = await checkSession(canvas, h.fetch)
    expect(r).toMatchObject({ state: 'signedIn', checkedURL: 'https://uni.instructure.com/api/v1/users/self' })
    expect(h.calls[0].init.headers).toMatchObject({ Accept: 'application/json' })
  })

  it('Canvas: 401 o vuelta al SSO = cerrada', async () => {
    const h = fakeHttp({ 'https://uni.instructure.com/api/v1/users/self': json('https://uni.instructure.com/api/v1/users/self', { status: 'unauthenticated' }, 401) })
    expect((await checkSession(canvas, h.fetch)).state).toBe('signedOut')
    const sso = fakeHttp({ 'https://uni.instructure.com/api/v1/users/self': html('https://login.microsoftonline.com/t/saml2', '<form>', 200, ['https://uni.instructure.com/login/saml', 'https://login.microsoftonline.com/t/saml2']) })
    expect((await checkSession(canvas, sso.fetch)).state).toBe('signedOut')
  })

  it('sin red: no se sabe (nunca «cerrada»)', async () => {
    const r = await checkSession(canvas, fakeHttp().fetch)
    expect(r).toMatchObject({ state: 'unknown', reason: 'network' })
  })

  it('Moodle: la página guarda la sesskey y la siguiente vez basta con core_session_touch', async () => {
    const a = moodle('m-touch')
    const h = fakeHttp({ [MY]: html(MY, signedInPage('Key123456')) })
    expect((await checkSession(a, h.fetch)).state).toBe('signedIn')
    expect(cachedMoodleSesskey(a.id)).toBe('Key123456')
    h.route(`POST ${SERVICE('Key123456', 'core_session_touch')}`, json(SERVICE('Key123456', 'core_session_touch'), [{ error: false, data: true }]))
    const again = await checkSession(a, h.fetch)
    expect(again).toMatchObject({ state: 'signedIn', reason: 'Moodle: core_session_touch' })
    expect(h.calls.at(-1)?.init.method).toBe('POST')
  })

  it('Moodle: sesskey vieja → se confirma con la página', async () => {
    const a = moodle('m-stale')
    rememberMoodleSesskey(a.id, 'OldKey1234')
    const h = fakeHttp({
      [`POST ${SERVICE('OldKey1234', 'core_session_touch')}`]: json('x', [{ error: true, exception: { errorcode: 'servicerequireslogin', message: 'x' } }]),
      [MY]: html(`${ROOT}/login/index.php`, loginPage, 200, [`${ROOT}/login/index.php`])
    })
    expect((await checkSession(a, h.fetch)).state).toBe('signedOut')
    expect(cachedMoodleSesskey(a.id)).toBeNull()
  })
})

describe('MoodleClient (sesión, sin token)', () => {
  it('cursos inscritos por AJAX con la sesskey de la página', async () => {
    const key = 'Abc1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_course_get_enrolled_courses_by_timeline_classification')}`]: json('x', [{ error: false, data: { courses: [
        { id: 3, fullname: 'Cálculo &amp; Álgebra', shortname: 'CAL1', coursecategory: '2025-26', viewurl: `${ROOT}/course/view.php?id=3` },
        { id: 'bad' }, { id: 4, fullnamedisplay: '<b>Física</b>' }
      ] } }])
    })
    const c = new MoodleClient({ baseURL: `${ROOT}/login/index.php`, fetch: h.fetch, accountId: 'm-courses' })
    const list = await c.enrolledCourses()
    expect(list).toEqual([
      { id: 3, fullname: 'Cálculo & Álgebra', shortname: 'CAL1', category: '2025-26', url: `${ROOT}/course/view.php?id=3` },
      { id: 4, fullname: 'Física', url: `${ROOT}/course/view.php?id=4` }
    ])
    const body = JSON.parse(String(h.calls[1].init.body)) as { methodname: string }[]
    expect(body[0].methodname).toBe('core_course_get_enrolled_courses_by_timeline_classification')
  })

  it('reintenta una vez con una sesskey nueva', async () => {
    const h = fakeHttp({
      [MY]: (_u, _i, n) => html(MY, signedInPage(n === 1 ? 'First12345' : 'Second1234')),
      [`POST ${SERVICE('First12345', 'core_course_get_contents')}`]: json('x', [{ error: true, exception: { errorcode: 'invalidsesskey', message: 'x' } }]),
      [`POST ${SERVICE('Second1234', 'core_course_get_contents')}`]: json('x', [{ error: false, data: [{ name: 'Tema 1', modules: [{ id: 9, modname: 'resource', name: 'PDF', url: `${ROOT}/mod/resource/view.php?id=9` }] }] }])
    })
    const c = new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-retry' })
    const s = await c.courseContents(5)
    expect(s[0].activities[0]).toMatchObject({ id: 9, name: 'PDF' })
  })

  it('si la página es la de acceso: needs_sign_in', async () => {
    const h = fakeHttp({ [MY]: html(`${ROOT}/login/index.php`, loginPage, 200, [`${ROOT}/login/index.php`]) })
    const c = new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-login' })
    await expect(c.enrolledCourses()).rejects.toMatchObject({ code: 'needs_sign_in' })
  })

  it('solo funciones de lectura', async () => {
    const c = new MoodleClient({ baseURL: ROOT, fetch: fakeHttp().fetch })
    await expect(c.ajax('core_user_update_users', {})).rejects.toBeInstanceOf(AulaError)
    await expect(c.ajax('mod_assign_submit_for_grading', {})).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('sin AJAX disponible, lee la página del curso', async () => {
    const key = 'Page123456'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_course_get_contents')}`]: json('x', [{ error: true, exception: { errorcode: 'servicenotavailable', message: 'x' } }]),
      [`${ROOT}/course/view.php?id=8`]: html(`${ROOT}/course/view.php?id=8`, '<h3 class="sectionname">Semana 1</h3><a href="/moodle/mod/page/view.php?id=21">Lectura</a>')
    })
    const s = await new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-page' }).courseContents(8)
    expect(s).toEqual([{ name: 'Semana 1', activities: [{ id: 21, modname: 'page', name: 'Lectura', url: 'https://campus.uni.edu/moodle/mod/page/view.php?id=21' }] }])
  })

  it('calendario: enlace desde el token de exportación (validado)', async () => {
    const key = 'Cal1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_calendar_get_calendar_export_token')}`]: json('x', [{ error: false, data: { token: 'tok123' } }])
    })
    const url = await new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-cal' }).calendarExportURL()
    expect(url).toBe(`${ROOT}/calendar/export_execute.php?userid=77&authtoken=tok123&preset_what=all&preset_time=recentupcoming`)
  })

  it('una redirección en una llamada AJAX = sesión cerrada', async () => {
    const key = 'Red1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_course_get_enrolled_courses_by_timeline_classification')}`]: redirectTo('x', `${ROOT}/login/index.php`)
    })
    await expect(new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-red' }).enrolledCourses()).rejects.toMatchObject({ code: 'needs_sign_in' })
  })

  it('mapContents tolera basura y oculta lo no visible', () => {
    expect(mapContents([{ name: 'S', modules: [{ id: 1, url: 'u', name: 'A' }, { id: 2, url: 'u2', uservisible: false }, { id: 'x' }] }, null, 'x'])).toEqual([
      { name: 'S', activities: [{ id: 1, modname: '', name: 'A', url: 'u' }] }
    ])
    expect(mapContents({})).toEqual([])
  })
})

// Issue 25: la comprobación sigue los saltos a mano y para ANTES del acceso o del SSO (nunca empieza otro inicio de sesión).
describe('checkSession: saltos a mano (issue 25)', () => {
  const CAMPUS = 'https://campus.uni.edu'
  const acct = (id: string, baseURL = `${CAMPUS}/`): PlatformAccount => ({ id, kind: 'moodle', label: 'Moodle', baseURL })
  const dash = (host: string, key = 'Abcdef1234') =>
    `<html><body id="page-my-index" class="path-my"><script>M.cfg = {"wwwroot":"https:\\/\\/${host}","sesskey":"${key}"};</script>` +
    `<a href="https://${host}/login/logout.php?sesskey=${key}">Salir</a></body></html>`
  const urls = (h: { calls: { url: string }[] }) => h.calls.map((c) => c.url)
  const FORBIDDEN = [/\/login\/index\.php/, /\/auth\/oidc\//, /login\.microsoftonline\.com/]

  it.each([
    ['la página de acceso de Moodle', `${CAMPUS}/login/index.php`],
    ['el inicio de OIDC de Moodle', `${CAMPUS}/auth/oidc/?source=loginpage`],
    ['Microsoft (redirección forzada)', 'https://login.microsoftonline.com/tenant/oauth2/authorize?client_id=x&state=y'],
    ['Microsoft por una dirección relativa al protocolo', '//login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1']
  ])('para antes de %s, no la pide y dice signedOut', async (_name, location) => {
    const h = fakeHttp({ [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, location, 303) })
    const r = await checkSession(acct('m-stop'), h.fetch)
    expect(r).toMatchObject({ state: 'signedOut', reason: expect.stringContaining('redirected to sign-in') })
    expect(urls(h)).toEqual([`${CAMPUS}/my/`])
    expect(h.calls[0].init.redirect).toBe('manual')
    expect(r.checkedURL).not.toContain('?')
  })

  it('cadena larga (http→https, /my/ → OIDC → Microsoft): ninguna petición al acceso, a OIDC ni a Microsoft', async () => {
    const h = fakeHttp({
      'http://campus.uni.edu/my/': redirectTo('http://campus.uni.edu/my/', `${CAMPUS}/my/`, 301),
      [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, '/auth/oidc/?source=loginpage&wantsurl=%2Fmy%2F', 303),
      [`${CAMPUS}/auth/oidc/?source=loginpage&wantsurl=%2Fmy%2F`]: redirectTo('x', 'https://login.microsoftonline.com/t/oauth2/authorize?state=s'),
      [`${CAMPUS}/login/index.php`]: html(`${CAMPUS}/login/index.php`, '<body class="notloggedin">')
    })
    const r = await checkSession(acct('m-chain', 'http://campus.uni.edu/'), h.fetch)
    expect(r.state).toBe('signedOut')
    expect(urls(h)).toEqual(['http://campus.uni.edu/my/', `${CAMPUS}/my/`])
    expect(urls(h).some((u) => FORBIDDEN.some((re) => re.test(u)))).toBe(false)
  })

  it('Canvas (JSON): para antes de su página de acceso por SAML', async () => {
    const self = 'https://uni.instructure.com/api/v1/users/self'
    const h = fakeHttp({ [self]: redirectTo(self, '/login/saml', 302) })
    expect((await checkSession(canvas, h.fetch)).state).toBe('signedOut')
    expect(urls(h)).toEqual([self])
  })

  it('sigue los saltos que no son de acceso: http→https en el mismo host', async () => {
    const h = fakeHttp({
      'http://campus.uni.edu/my/': redirectTo('http://campus.uni.edu/my/', `${CAMPUS}/my/`, 301),
      [`${CAMPUS}/my/`]: html(`${CAMPUS}/my/`, dash('campus.uni.edu'))
    })
    const r = await checkSession(acct('m-https', 'http://campus.uni.edu/'), h.fetch)
    expect(r).toMatchObject({ state: 'signedIn', checkedURL: `${CAMPUS}/my/` })
    expect(urls(h)).toEqual(['http://campus.uni.edu/my/', `${CAMPUS}/my/`])
  })

  it('sigue los saltos a otro host del campus (alias) y reconoce allí el Moodle de la cuenta', async () => {
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, 'https://ev.uni.edu/my/', 302),
      'https://ev.uni.edu/my/': html('https://ev.uni.edu/my/', dash('ev.uni.edu'))
    })
    expect((await checkSession(acct('m-alias'), h.fetch)).state).toBe('signedIn')
    expect(urls(h)).toEqual([`${CAMPUS}/my/`, 'https://ev.uni.edu/my/'])
  })

  it('en el alias, también para antes de su página de acceso', async () => {
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, 'https://ev.uni.edu/my/', 302),
      'https://ev.uni.edu/my/': redirectTo('https://ev.uni.edu/my/', '/login/index.php', 303)
    })
    expect((await checkSession(acct('m-alias-out'), h.fetch)).state).toBe('signedOut')
    expect(urls(h)).toEqual([`${CAMPUS}/my/`, 'https://ev.uni.edu/my/'])
  })

  it('paso tras el acceso (política): pendingStep y no pide el segundo destino', async () => {
    const policy = `${CAMPUS}/admin/tool/policy/index.php`
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, policy, 303),
      [policy]: html(policy, dash('campus.uni.edu'))
    })
    const r = await checkSession(acct('m-policy'), h.fetch)
    expect(r).toMatchObject({ state: 'unknown', pendingStep: true })
    expect(urls(h)).toEqual([`${CAMPUS}/my/`, policy])
  })

  it('invitado: /my/ → portada con redirect=0 = cerrada', async () => {
    const front = `${CAMPUS}/?redirect=0`
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: redirectTo(`${CAMPUS}/my/`, front, 303),
      [front]: html(front, '<html><body id="page-site-index" class="pagelayout-frontpage"><a href="/login/index.php">Acceder</a></body></html>')
    })
    expect(await checkSession(acct('m-guest'), h.fetch)).toMatchObject({ state: 'signedOut', reason: 'guest session' })
  })

  it('área personal desactivada (/my/ 404): prueba «Mis cursos»', async () => {
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: html(`${CAMPUS}/my/`, 'Not found', 404),
      [`${CAMPUS}/my/courses.php`]: html(`${CAMPUS}/my/courses.php`, dash('campus.uni.edu'))
    })
    expect((await checkSession(acct('m-404'), h.fetch)).state).toBe('signedIn')
    expect(urls(h)).toEqual([`${CAMPUS}/my/`, `${CAMPUS}/my/courses.php`])
  })

  it('la prueba del usuario cuenta aunque esté más allá de los primeros 200 KB', async () => {
    const big = `<html><body class="path-my"><div>${'x'.repeat(300_000)}</div><a href="/login/logout.php?sesskey=Abcdef1234">Salir</a></body></html>`
    const h = fakeHttp({ [`${CAMPUS}/my/`]: html(`${CAMPUS}/my/`, big) })
    expect((await checkSession(acct('m-big'), h.fetch)).state).toBe('signedIn')
  })

  it('skipTouch: no usa core_session_touch aunque haya sesskey guardada', async () => {
    const a = acct('m-skip')
    rememberMoodleSesskey(a.id, 'Key1234567')
    const h = fakeHttp({ [`${CAMPUS}/my/`]: html(`${CAMPUS}/my/`, dash('campus.uni.edu')) })
    expect((await checkSession(a, h.fetch, { skipTouch: true })).state).toBe('signedIn')
    expect(h.calls.some((c) => c.init.method === 'POST')).toBe(false)
  })

  it('cancelada antes de empezar: no pide nada', async () => {
    const abort = new AbortController()
    abort.abort()
    const h = fakeHttp({ [`${CAMPUS}/my/`]: html(`${CAMPUS}/my/`, dash('campus.uni.edu')) })
    expect(await checkSession(acct('m-abort0'), h.fetch, { signal: abort.signal })).toMatchObject({ state: 'unknown', reason: 'cancelled' })
    expect(h.calls).toEqual([])
  })

  it('cancelada a mitad: no sigue con el siguiente destino', async () => {
    const abort = new AbortController()
    const h = fakeHttp({
      [`${CAMPUS}/my/`]: (_u, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new HttpError('cancelled', 'Cancelado')), { once: true })
      }),
      [`${CAMPUS}/my/courses.php`]: html(`${CAMPUS}/my/courses.php`, dash('campus.uni.edu'))
    })
    const p = checkSession(acct('m-abort1'), h.fetch, { signal: abort.signal })
    while (!h.calls.length) await new Promise((r) => setTimeout(r, 1))
    abort.abort()
    expect(await p).toMatchObject({ state: 'unknown', reason: 'cancelled' })
    expect(urls(h)).toEqual([`${CAMPUS}/my/`])
  })

  it('demasiadas redirecciones: no se sabe (como antes, 10 saltos como mucho)', async () => {
    const self = 'https://uni.instructure.com/api/v1/users/self'
    const h = fakeHttp({ [self]: redirectTo(self, self, 302) })
    expect(await checkSession(canvas, h.fetch)).toMatchObject({ state: 'unknown', reason: 'too_many_redirects' })
    expect(h.calls).toHaveLength(11)
  })

  it('stopsBeforeHop: acceso de la cuenta o SSO, no los demás saltos', () => {
    const a = acct('x')
    expect(stopsBeforeHop(a, `${CAMPUS}/login/index.php?x=1`)).toBe(true)
    expect(stopsBeforeHop(a, `${CAMPUS}/auth/saml2/login.php`)).toBe(true)
    expect(stopsBeforeHop(a, 'https://login.microsoftonline.com/t/saml2')).toBe(true)
    expect(stopsBeforeHop(a, 'https://sso.uni.edu/idp/profile/SAML2/Redirect/SSO')).toBe(true)
    expect(stopsBeforeHop(a, `${CAMPUS}/my/`)).toBe(false)
    expect(stopsBeforeHop(a, 'https://ev.uni.edu/my/')).toBe(false)
    expect(stopsBeforeHop(a, `${CAMPUS}/admin/tool/policy/index.php`)).toBe(false)
  })
})

describe('MoodleClient: pasos tras el acceso y redirecciones de service.php (issue 25)', () => {
  const policy = `${ROOT}/admin/tool/policy/index.php`
  const ajaxError = (errorcode: string) => json('x', [{ error: true, exception: { errorcode, message: 'x' } }])

  it.each(['sitepolicynotagreed', 'usernotfullysetup'])('AJAX con %s = paso pendiente (platform_step_pending)', async (code) => {
    const key = 'Stp1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_course_get_enrolled_courses_by_timeline_classification')}`]: ajaxError(code)
    })
    const err = await new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: `m-${code}` }).enrolledCourses().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AulaError)
    expect(err).toMatchObject({ code: 'platform_step_pending', message: expect.stringContaining('Moodle') })
  })

  it('una página que acaba en un paso (política) = paso pendiente, no «sesión cerrada» ni «iniciada»', async () => {
    const h = fakeHttp({ [MY]: html(policy, signedInPage('Pol1234567'), 200, [policy]) })
    await expect(new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-step-page' }).enrolledCourses()).rejects.toMatchObject({ code: 'platform_step_pending' })
  })

  it('los respaldos (página del curso, exportación del calendario) no tapan el paso pendiente', async () => {
    const key = 'Fbk1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_course_get_contents')}`]: ajaxError('sitepolicynotagreed'),
      [`POST ${SERVICE(key, 'core_calendar_get_calendar_export_token')}`]: ajaxError('sitepolicynotagreed')
    })
    const c = new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-fallback' })
    await expect(c.courseContents(4)).rejects.toMatchObject({ code: 'platform_step_pending' })
    await expect(c.calendarExportURL()).rejects.toMatchObject({ code: 'platform_step_pending' })
    expect(h.calls.some((x) => /course\/view\.php|calendar\/export\.php/.test(x.url))).toBe(false)
  })

  it('sesskey: si /my/ da 404 prueba «Mis cursos» y luego la portada', async () => {
    const key = 'Ssk1234567'
    const h = fakeHttp({
      [MY]: html(MY, 'Not found', 404),
      [`${ROOT}/my/courses.php`]: html(`${ROOT}/my/courses.php`, 'Not found', 404),
      [`${ROOT}/`]: html(`${ROOT}/`, signedInPage(key))
    })
    expect(await new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-404s' }).sesskey()).toBe(key)
    expect(h.calls.map((x) => x.url)).toEqual([MY, `${ROOT}/my/courses.php`, `${ROOT}/`])
    // otro error que no es 404 no sigue probando
    const g = fakeHttp({ [MY]: html(MY, 'Boom', 500) })
    await expect(new MoodleClient({ baseURL: ROOT, fetch: g.fetch, accountId: 'm-500' }).sesskey()).rejects.toMatchObject({ code: 'moodle_error' })
    expect(g.calls).toHaveLength(1)
  })

  it('service.php redirige a la misma ruta en https: un reintento allí y se queda esa raíz', async () => {
    const key = 'Htp1234567'
    const httpRoot = 'http://campus.uni.edu/moodle'
    const info = 'core_course_get_enrolled_courses_by_timeline_classification'
    const httpService = `${httpRoot}/lib/ajax/service.php?sesskey=${key}&info=${info}`
    let ok = 0
    const h = fakeHttp({
      [`${httpRoot}/my/`]: html(`${httpRoot}/my/`, signedInPage(key)),
      [`POST ${httpService}`]: redirectTo(httpService, httpService.replace('http:', 'https:'), 301),
      [`POST ${SERVICE(key, info)}`]: json('x', [{ error: false, data: { courses: [{ id: 1, fullname: 'A' }] } }])
    })
    const c = new MoodleClient({ baseURL: `${httpRoot}/`, fetch: h.fetch, accountId: 'm-moved', onAjaxOk: () => ok++ })
    expect(await c.enrolledCourses()).toHaveLength(1)
    expect(c.root).toBe(ROOT)
    expect(ok).toBe(1)
    // la siguiente llamada va directa a la raíz nueva
    await c.enrolledCourses()
    expect(h.calls.filter((x) => x.url === httpService)).toHaveLength(1)
  })

  it('cualquier otro 3xx de service.php sigue siendo «sesión cerrada»', async () => {
    const key = 'Oth1234567'
    const info = 'core_course_get_enrolled_courses_by_timeline_classification'
    for (const location of [`${ROOT}/login/index.php`, 'https://evil.example/moodle/lib/ajax/service.php', `http://campus.uni.edu/moodle/lib/ajax/service.php`]) {
      const h = fakeHttp({ [MY]: html(MY, signedInPage(key)), [`POST ${SERVICE(key, info)}`]: redirectTo('x', location, 302) })
      await expect(new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-other3xx' }).enrolledCourses()).rejects.toMatchObject({ code: 'needs_sign_in' })
    }
  })

  it('onAjaxOk no salta con core_session_touch (funciona aunque haya un paso pendiente)', async () => {
    const key = 'Tch1234567'
    const h = fakeHttp({
      [MY]: html(MY, signedInPage(key)),
      [`POST ${SERVICE(key, 'core_session_touch')}`]: json('x', [{ error: false, data: true }])
    })
    let ok = 0
    await new MoodleClient({ baseURL: ROOT, fetch: h.fetch, accountId: 'm-touch-ok', onAjaxOk: () => ok++ }).ajax('core_session_touch', {})
    expect(ok).toBe(0)
  })

  it('movedServiceRoot: misma ruta en https o en otra raíz del sitio; nunca a http ni a otro sitio', () => {
    const from = 'http://campus.uni.edu/lib/ajax/service.php?sesskey=k&info=f'
    expect(movedServiceRoot(from, 'https://campus.uni.edu/lib/ajax/service.php?sesskey=k&info=f')).toBe('https://campus.uni.edu')
    expect(movedServiceRoot(from, 'https://ev.uni.edu/moodle/lib/ajax/service.php')).toBe('https://ev.uni.edu/moodle')
    expect(movedServiceRoot(from, '/lib/ajax/service.php')).toBeNull()
    expect(movedServiceRoot(from, 'https://campus.uni.edu/login/index.php')).toBeNull()
    expect(movedServiceRoot(from, 'https://evil.example/lib/ajax/service.php')).toBeNull()
    expect(movedServiceRoot(from, 'https://login.microsoftonline.com/lib/ajax/service.php')).toBeNull()
    expect(movedServiceRoot('https://campus.uni.edu/lib/ajax/service.php', 'http://campus.uni.edu/lib/ajax/service.php')).toBeNull()
    expect(movedServiceRoot(from, null)).toBeNull()
  })
})
