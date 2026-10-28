import { describe, expect, it } from 'vitest'
import { fakeHttp, html, json, redirectTo } from '../platforms/fake-http'
import { HttpError, textResponse } from '../platforms/http'
import { CanvasClient, isValidCanvasFeedURL, pageSlug, parseLinkHeader } from './client'
import { canvasErrorMessage, errorForStatus } from './errors'
import { decodeAssignment, decodeCalendarEvent, decodeCourse, decodeFile, decodePlannerItem } from './models'

const O = 'https://uni.instructure.com'
const API = (p: string) => `${O}/api/v1/${p}`
const noSleep = { sleep: async () => undefined }
const client = (h: ReturnType<typeof fakeHttp>, extra: Partial<ConstructorParameters<typeof CanvasClient>[0]> = {}) =>
  new CanvasClient({ baseURL: `${O}/courses`, fetch: h.fetch, ...noSleep, ...extra })

describe('paginación y lectura tolerante', () => {
  it('sigue Link: rel="next" y salta elementos defectuosos', async () => {
    const p1 = API('courses?include%5B%5D=term&enrollment_state=active&per_page=100')
    const p2 = API('courses?page=2&per_page=100')
    const warnings: string[] = []
    const h = fakeHttp({
      [p1]: json(p1, [{ id: 1, name: 'Cálculo', course_code: 'MAT1', term: { name: '2025-26' } }, { id: 'x' }], 200, { link: `<${p2}>; rel="next", <${p1}>; rel="first"` }),
      [p2]: json(p2, [{ id: 2, name: 'Física', access_restricted_by_date: true }, { id: 3, name: 'Química', workflow_state: 'available' }])
    })
    const list = await client(h, { onWarning: (m) => warnings.push(m) }).courses()
    expect(list.map((c) => c.name)).toEqual(['Cálculo', 'Química'])
    expect(list[0]).toMatchObject({ id: '1', courseCode: 'MAT1', term: { name: '2025-26' }, url: `${O}/courses/1` })
    expect(warnings.join(' ')).toContain('defectuoso')
  })

  it('ignora una página siguiente de otro servidor y sube http a https', async () => {
    const p1 = API('courses/1/pages?sort=title&per_page=100')
    const h = fakeHttp({ [p1]: json(p1, [{ url: 'tema-1', title: 'Tema 1' }], 200, { link: '<https://evil.com/api/v1/x>; rel="next"' }) })
    const warnings: string[] = []
    expect(await client(h, { onWarning: (m) => warnings.push(m) }).pages('1')).toHaveLength(1)
    expect(warnings[0]).toContain('otro servidor')
    const q = API('courses/1/files?sort=name&per_page=100')
    const h2 = fakeHttp({
      [q]: json(q, [{ id: 1, display_name: 'a.pdf' }], 200, { link: `<http://uni.instructure.com/api/v1/courses/1/files?page=2>; rel="next"` }),
      [`${O}/api/v1/courses/1/files?page=2`]: json('x', [{ id: 2, display_name: 'b.pdf' }])
    })
    expect((await client(h2).files('1')).map((f) => f.displayName)).toEqual(['a.pdf', 'b.pdf'])
  })

  it('quita la guarda while(1); de las respuestas con sesión', async () => {
    const u = API('users/self/profile')
    const h = fakeHttp({ [u]: textResponse(200, u, 'while(1);{"id":9,"name":"Ana","calendar":{"ics":"https://uni.instructure.com/feeds/calendars/user_abc.ics"}}', { 'content-type': 'application/json' }) })
    const c = client(h)
    expect(await c.profile()).toMatchObject({ id: '9', name: 'Ana' })
    expect(await c.calendarFeedURL()).toBe('https://uni.instructure.com/feeds/calendars/user_abc.ics')
  })

  it('una respuesta que no es lista falla con un mensaje claro', async () => {
    const u = API('courses/1/files?sort=name&per_page=100')
    const h = fakeHttp({ [u]: json(u, { message: 'file listing disabled' }) })
    await expect(client(h).files('1')).rejects.toMatchObject({ code: 'canvas_unexpected' })
  })
})

describe('sesión y errores', () => {
  const u = API('courses?include%5B%5D=term&enrollment_state=active&per_page=100')

  it('401 con la sesión = hay que iniciar sesión; con token = el token no vale', async () => {
    const h = fakeHttp({ [u]: json(u, { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] }, 401) })
    await expect(client(h).courses()).rejects.toMatchObject({ code: 'needs_sign_in' })
    await expect(client(h, { token: 'a'.repeat(30) }).courses()).rejects.toMatchObject({ code: 'canvas_token_invalid' })
  })

  it('401 «not authorized to perform» es un permiso, no la sesión', async () => {
    const h = fakeHttp({ [u]: json(u, { errors: [{ message: 'user not authorized to perform that action' }] }, 401) })
    await expect(client(h).courses()).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('la página de acceso en vez de JSON = sesión cerrada; otra página = no es un Canvas', async () => {
    const h = fakeHttp({ [u]: html(`${O}/login/canvas`, '<form id="login_form"><input type="password"></form>') })
    await expect(client(h).courses()).rejects.toMatchObject({ code: 'needs_sign_in' })
    const h2 = fakeHttp({ [u]: html(u, '<html><body>Bienvenido</body></html>') })
    await expect(client(h2).courses()).rejects.toMatchObject({ code: 'not_canvas' })
  })

  it('redirección fuera de Canvas (el SSO) = sesión cerrada; dentro se sigue', async () => {
    const h = fakeHttp({ [u]: redirectTo(u, 'https://login.microsoftonline.com/t/saml2') })
    await expect(client(h).courses()).rejects.toMatchObject({ code: 'needs_sign_in' })
    const h2 = fakeHttp({ [u]: redirectTo(u, `${O}/api/v1/courses?page=1`), [`${O}/api/v1/courses?page=1`]: json('x', [{ id: 1, name: 'A' }]) })
    expect(await client(h2).courses()).toHaveLength(1)
  })

  it('429 y 5xx se reintentan con espera; después, error claro', async () => {
    const waits: number[] = []
    const h = fakeHttp({ [u]: (_url, _i, n) => (n < 3 ? textResponse(n === 1 ? 429 : 503, u, 'Rate Limit Exceeded', { 'retry-after': '2' }) : json(u, [{ id: 1, name: 'A' }])) })
    expect(await client(h, { sleep: async (ms) => { waits.push(ms) } }).courses()).toHaveLength(1)
    expect(waits).toEqual([2000, 2000])
    const h2 = fakeHttp({ [u]: textResponse(500, u, 'boom') })
    await expect(client(h2, { maxRetries: 2 }).courses()).rejects.toMatchObject({ code: 'canvas_server' })
    expect(h2.calls).toHaveLength(3)
    const h3 = fakeHttp({ [u]: textResponse(429, u, '') })
    await expect(client(h3, { maxRetries: 1 }).courses()).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('red caída: reintenta y luego dice que no hay conexión', async () => {
    let n = 0
    const c = new CanvasClient({ baseURL: O, ...noSleep, fetch: async () => { n++; throw new HttpError('network', 'x') } })
    await expect(c.courses()).rejects.toMatchObject({ code: 'network' })
    expect(n).toBe(3)
  })

  it('el token solo viaja en Authorization y nunca en http://', () => {
    expect(() => new CanvasClient({ baseURL: 'http://uni.instructure.com', fetch: fakeHttp().fetch })).toThrow()
    expect(() => new CanvasClient({ baseURL: 'http://localhost:3000', fetch: fakeHttp().fetch })).not.toThrow()
  })

  it('identificadores no válidos se rechazan antes de pedir nada', async () => {
    const h = fakeHttp()
    await expect(client(h).modules('1/../../users')).rejects.toMatchObject({ code: 'invalid_args' })
    expect(h.calls).toHaveLength(0)
  })
})

describe('módulos, anuncios, próximas fechas y archivos', () => {
  it('módulos con los elementos pedidos aparte si no vinieron', async () => {
    const m = API('courses/1/modules?include%5B%5D=items&include%5B%5D=content_details&per_page=100')
    const items = API('courses/1/modules/20/items?include%5B%5D=content_details&per_page=100')
    const h = fakeHttp({
      [m]: json(m, [
        { id: 20, name: 'Tema 2', position: 2, items_count: 2, items: [] },
        { id: 10, name: 'Tema 1', position: 1, items: [{ id: 2, title: 'B', position: 2, type: 'Page' }, { id: 1, title: 'A', position: 1, type: 'File', content_details: { locked_for_user: true } }] }
      ]),
      [items]: json(items, [{ id: 5, title: 'Quiz', type: 'Quiz', position: 1, content_details: { due_at: '2026-11-02T10:00:00Z', points_possible: 10 } }])
    })
    const list = await client(h).modules('1')
    expect(list.map((x) => x.name)).toEqual(['Tema 1', 'Tema 2'])
    expect(list[0].items.map((i) => i.title)).toEqual(['A', 'B'])
    expect(list[0].items[0]).toMatchObject({ lockedForUser: true, moduleId: '10' })
    expect(list[1].items[0]).toMatchObject({ title: 'Quiz', dueAt: '2026-11-02T10:00:00.000Z', pointsPossible: 10, moduleId: '20' })
  })

  it('anuncios de varios cursos, sin repetir y del más nuevo al más viejo', async () => {
    const now = new Date('2026-10-26T12:00:00Z')
    const h = fakeHttp()
    h.route(API('announcements?context_codes%5B%5D=course_1&context_codes%5B%5D=course_2&start_date=2026-09-26T12%3A00%3A00.000Z&end_date=2026-10-27T12%3A00%3A00.000Z&active_only=true&per_page=100'),
      json('x', [
        { id: 1, title: 'Examen', message: '<p>Entra el <b>tema 5</b></p>', posted_at: '2026-10-20T09:00:00Z', context_code: 'course_1' },
        { id: 2, title: 'Bienvenida', message: 'Hola', posted_at: '2026-10-01T09:00:00Z', context_code: 'course_2' },
        { id: 1, title: 'Examen', posted_at: '2026-10-20T09:00:00Z' }
      ]))
    const list = await client(h).announcements(['1', '2', '1'], { now })
    expect(list.map((a) => a.title)).toEqual(['Examen', 'Bienvenida'])
    expect(list[0]).toMatchObject({ courseId: '1', message: 'Entra el **tema 5**' })
  })

  it('próximas fechas sin lo entregado; sin planificador, los próximos eventos', async () => {
    const now = new Date('2026-10-26T12:00:00')
    const h = fakeHttp()
    h.route(`${O}/api/v1/planner/items`, json('x', []))
    const c = client(h)
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    // fin = último segundo del 7.º día civil (setDate, no 8 × 24 h: esta semana cambia la hora en EE. UU.)
    const end = new Date(start)
    end.setDate(end.getDate() + 8)
    end.setTime(end.getTime() - 1000)
    const planner = API(`planner/items?start_date=${encodeURIComponent(start.toISOString())}&end_date=${encodeURIComponent(end.toISOString())}&per_page=100`)
    h.route(planner, json(planner, [
      { plannable_id: 1, plannable_type: 'assignment', plannable: { title: 'Entrega 1' }, plannable_date: new Date(start.getTime() + 86_400_000).toISOString(), submissions: { submitted: true } },
      { plannable_id: 2, plannable_type: 'quiz', plannable: { title: 'Parcial' }, plannable_date: new Date(start.getTime() + 2 * 86_400_000).toISOString(), html_url: '/courses/1/quizzes/2' }
    ]))
    const items = await c.upcoming({ days: 7, now })
    expect(items.map((i) => i.title)).toEqual(['Parcial'])
    expect(items[0].htmlURL).toBe(`${O}/courses/1/quizzes/2`)
    h.route(planner, json(planner, { errors: [{ message: 'no' }] }, 404))
    h.route(API('users/self/upcoming_events?per_page=100'), json('x', [{ id: 'assignment_9', title: 'Tarea', start_at: new Date(start.getTime() + 3 * 86_400_000).toISOString(), assignment: {} }]))
    const fallback = await c.upcoming({ days: 7, now })
    expect(fallback).toMatchObject([{ plannableId: 'assignment_9', plannableType: 'assignment', title: 'Tarea' }])
  })

  it('descarga: la redirección al almacenamiento externo se sigue SIN el token', async () => {
    const dl = `${O}/files/7/download?download_frd=1`
    const s3 = 'https://inst-fs-iad-prod.inscloudgate.net/files/7?token=signed'
    const h = fakeHttp({ [dl]: redirectTo(dl, s3), [s3]: textResponse(200, s3, '%PDF-1.7', { 'content-type': 'application/pdf' }) })
    const c = client(h, { token: 'b'.repeat(30) })
    const r = await c.downloadFile({ id: '7', displayName: 'Tema.pdf' })
    expect(r).toMatchObject({ filename: 'Tema.pdf', contentType: 'application/pdf' })
    expect(h.calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${'b'.repeat(30)}` })
    expect(h.calls[1].init.headers).toEqual({})
    const h2 = fakeHttp({ [dl]: html(dl, '<html>login</html>') })
    await expect(client(h2).downloadFile({ id: '7', displayName: 'Tema.pdf' })).rejects.toMatchObject({ code: 'needs_sign_in' })
  })
})

describe('piezas de Canvas', () => {
  it('cabecera Link', () => {
    expect(parseLinkHeader('<https://x/a?page=2>; rel="next", <https://x/a?page=9>; rel="last"')).toEqual({ next: 'https://x/a?page=2', last: 'https://x/a?page=9' })
    expect(parseLinkHeader(null)).toEqual({})
  })

  it('identificador de página', () => {
    expect(pageSlug('https://x/courses/1/pages/semana-1?module_item_id=3')).toBe('semana-1')
    expect(pageSlug('page_id:7')).toBe('page_id:7')
    expect(pageSlug('tema%20uno')).toBe('tema uno')
  })

  it('enlace del calendario privado', () => {
    expect(isValidCanvasFeedURL('webcal://uni.instructure.com/feeds/calendars/user_abc.ics', O)).toBe(true)
    expect(isValidCanvasFeedURL('https://canvas.uni.edu/feeds/calendars/user_abc.ics', 'https://canvas.uni.edu')).toBe(true)
    expect(isValidCanvasFeedURL('https://evil.com/feeds/calendars/user_abc.ics', O)).toBe(false)
    expect(isValidCanvasFeedURL('https://uni.instructure.com/feeds/calendars/user_abc.txt', O)).toBe(false)
  })

  it('mensajes de error', () => {
    expect(canvasErrorMessage('{"errors":[{"message":"Nope"}]}')).toBe('Nope')
    expect(canvasErrorMessage('{"errors":{"base":[{"message":"Base"}]}}')).toBe('Base')
    expect(canvasErrorMessage('<html>')).toBeNull()
    expect(errorForStatus(404, '', false).code).toBe('not_found')
    expect(errorForStatus(418, '{"message":"tea"}', false).message).toContain('tea')
  })

  it('decodificación tolerante', () => {
    expect(decodeCourse({ id: '12345678901234567890', name: 'Big' }, O)?.id).toBe('12345678901234567890')
    expect(decodeCourse({ name: 'sin id' }, O)).toBeNull()
    expect(decodeFile({ id: 3, filename: 'a.pdf', 'content-type': 'application/pdf', size: '10' })).toMatchObject({ displayName: 'a.pdf', contentType: 'application/pdf', size: 10 })
    expect(decodeAssignment({ id: 4, name: 'T', due_at: 'no es fecha', submission_types: ['online_upload', 3], is_quiz_lti_assignment: true })).toMatchObject({
      submissionTypes: ['online_upload'], isQuizLTI: true
    })
    expect(decodeAssignment({ id: 4 })?.dueAt).toBeUndefined()
    expect(decodeCalendarEvent({ id: 'assignment_5', title: 'X', context_code: 'course_9' })).toMatchObject({ type: 'assignment', courseId: '9' })
    expect(decodePlannerItem({ plannable_id: 1, planner_override: { marked_complete: true } })?.completed).toBe(true)
  })
})
