import { describe, expect, it } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'
import { AulaError } from '../errors'
import { fakeHttp, html, json, redirectTo } from './fake-http'
import { MoodleClient, mapContents } from './moodle'
import { cachedMoodleSesskey, checkSession, rememberMoodleSesskey } from './session-check'

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
