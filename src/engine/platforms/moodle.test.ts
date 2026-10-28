import { describe, expect, it } from 'vitest'
import {
  extractMoodleConfig, extractMoodleExportURL, extractMoodleSesskey, isMoodleSessionError, isValidMoodleExportURL, moodleAjaxRequest,
  moodleExportFormBody, moodleExportURLFromToken, parseMoodleAjaxResponse, parseMoodleCoursePage
} from './moodle'

describe('sesskey de Moodle', () => {
  it('de M.cfg', () => {
    const html = '<script>M.cfg = {"wwwroot":"https:\\/\\/campus.uni.edu\\/moodle","sesskey":"Ab12Cd34Ef","sessiontimeout":"7200"};</script>'
    expect(extractMoodleSesskey(html)).toBe('Ab12Cd34Ef')
    expect(extractMoodleConfig(html).wwwroot).toBe('https://campus.uni.edu/moodle')
  })

  it('de un campo oculto o de un enlace', () => {
    expect(extractMoodleSesskey('<input type="hidden" name="sesskey" value="zZ9yY8xX7w">')).toBe('zZ9yY8xX7w')
    expect(extractMoodleSesskey('<input value="qQ1wW2eE3r" type="hidden" name="sesskey">')).toBe('qQ1wW2eE3r')
    expect(extractMoodleSesskey('<a href="/login/logout.php?sesskey=LmNoPq1234">Salir</a>')).toBe('LmNoPq1234')
  })

  it('valores raros no valen', () => {
    expect(extractMoodleSesskey('"sesskey":"<script>"')).toBeNull()
    expect(extractMoodleSesskey('<html>sin clave</html>')).toBeNull()
  })

  it('configuración: usuario y si hay sesión', () => {
    const cfg = extractMoodleConfig('<div data-userid="42"></div><a href="https://c.edu/login/logout.php?sesskey=abcdef1234">x</a>')
    expect(cfg).toMatchObject({ userId: 42, signedIn: true, sesskey: 'abcdef1234' })
    expect(extractMoodleConfig('<body class="notloggedin">').signedIn).toBe(false)
  })
})

describe('AJAX de Moodle', () => {
  it('petición como la de la propia página', () => {
    const r = moodleAjaxRequest('https://campus.uni.edu/moodle/', 'abc123def', [{ methodname: 'core_session_touch', args: {} }])
    expect(r.url).toBe('https://campus.uni.edu/moodle/lib/ajax/service.php?sesskey=abc123def&info=core_session_touch')
    expect(JSON.parse(r.body)).toEqual([{ index: 0, methodname: 'core_session_touch', args: {} }])
  })

  it('respuestas: datos, error por llamada y error global', () => {
    expect(parseMoodleAjaxResponse('[{"error":false,"data":{"courses":[]}}]')).toEqual([{ ok: true, data: { courses: [] } }])
    expect(parseMoodleAjaxResponse('[{"error":true,"exception":{"errorcode":"invalidsesskey","message":"x"}}]')).toEqual([{ ok: false, errorcode: 'invalidsesskey', message: 'x' }])
    expect(parseMoodleAjaxResponse('{"error":true,"exception":{"errorcode":"servicerequireslogin","message":"y"}}', 2)).toHaveLength(2)
    expect(parseMoodleAjaxResponse('<html>')[0]).toMatchObject({ ok: false, errorcode: 'invalidresponse' })
    expect(isMoodleSessionError('servicerequireslogin')).toBe(true)
    expect(isMoodleSessionError('InvalidSesskey')).toBe(true)
    expect(isMoodleSessionError('nopermissions')).toBe(false)
  })
})

describe('página de un curso', () => {
  it('secciones y actividades en orden, sin duplicados ni textos ocultos', () => {
    const html = `
      <h3 class="sectionname"><span>Tema 1 &amp; intro</span></h3>
      <a href="https://c.edu/mod/resource/view.php?id=10">Apuntes <span class="accesshide">Archivo</span></a>
      <a href="/mod/quiz/view.php?id=11&amp;x=1">Cuestionario 1</a>
      <a href="/mod/resource/view.php?id=10">Apuntes</a>
      <h3 class="sectionname">Tema 2</h3>
      <a href="/mod/page/view.php?id=12">Lectura</a>`
    const s = parseMoodleCoursePage(html, 'https://c.edu/course/view.php?id=3')
    expect(s.map((x) => x.name)).toEqual(['Tema 1 & intro', 'Tema 2'])
    expect(s[0].activities).toEqual([
      { id: 10, modname: 'resource', name: 'Apuntes', url: 'https://c.edu/mod/resource/view.php?id=10' },
      { id: 11, modname: 'quiz', name: 'Cuestionario 1', url: 'https://c.edu/mod/quiz/view.php?id=11&x=1' }
    ])
    expect(s[1].activities[0].modname).toBe('page')
  })
})

describe('calendario de Moodle', () => {
  const root = 'https://campus.uni.edu/moodle'
  it('enlace de exportación de la página', () => {
    const html = `<input id="calendarexporturl" type="text" value="${root}/calendar/export_execute.php?userid=4&amp;authtoken=abc&amp;preset_what=all&amp;preset_time=recentupcoming">`
    const url = extractMoodleExportURL(html)!
    expect(url).toBe(`${root}/calendar/export_execute.php?userid=4&authtoken=abc&preset_what=all&preset_time=recentupcoming`)
    expect(isValidMoodleExportURL(url, root)).toBe(true)
  })

  it('validación: mismo sitio, https, authtoken y «todos» o «cursos»', () => {
    expect(isValidMoodleExportURL('https://evil.com/calendar/export_execute.php?authtoken=a&preset_what=all', root)).toBe(false)
    expect(isValidMoodleExportURL(`${root}/calendar/export_execute.php?preset_what=all`, root)).toBe(false)
    expect(isValidMoodleExportURL(`${root}/calendar/export_execute.php?authtoken=a&preset_what=user`, root)).toBe(false)
    expect(isValidMoodleExportURL(`http://campus.uni.edu/moodle/calendar/export_execute.php?authtoken=a&preset_what=all`, root)).toBe(false)
  })

  it('enlace desde el token y formulario «Obtener la URL»', () => {
    expect(moodleExportURLFromToken(root + '/', 7, 't/k')).toBe(`${root}/calendar/export_execute.php?userid=7&authtoken=t%2Fk&preset_what=all&preset_time=recentupcoming`)
    const body = new URLSearchParams(moodleExportFormBody('skey123456'))
    expect(body.get('sesskey')).toBe('skey123456')
    expect(body.get('generateurl')).toBeTruthy()
  })
})
