import { describe, expect, it } from 'vitest'
import { closedPlatformNotice, confidenceAtLeast, detectPlatform, fromHTML, fromTitle, fromURL, kindForHost } from './detector'
import { detectFromHops, iconLinks, pageTitle } from './probe'

describe('detector por dirección', () => {
  it('reconoce los hosts en la nube con seguridad', () => {
    expect(fromURL('https://uni.instructure.com/courses/1')).toMatchObject({ kind: 'canvas', confidence: 'high' })
    expect(fromURL('https://uni.blackboard.com')).toMatchObject({ kind: 'blackboard', confidence: 'high' })
    expect(fromURL('https://classroom.google.com/u/0/h')).toMatchObject({ kind: 'classroom', confidence: 'high' })
    expect(fromURL('https://uni.brightspace.com/d2l/home')).toMatchObject({ kind: 'brightspace', confidence: 'high' })
    expect(fromURL('https://app.schoology.com/home')).toMatchObject({ kind: 'schoology', confidence: 'high' })
    expect(fromURL('https://teams.microsoft.com/v2/')).toMatchObject({ kind: 'teams', confidence: 'high' })
    expect(fromURL('https://school.itslearning.com')).toMatchObject({ kind: 'itslearning', confidence: 'high' })
    expect(fromURL('https://courses.edx.org/dashboard')).toMatchObject({ kind: 'openedx', confidence: 'high' })
    expect(fromURL('https://x.moodlecloud.com')).toMatchObject({ kind: 'moodle', confidence: 'high' })
    expect(fromURL('https://uni.mrooms.net')).toMatchObject({ kind: 'moodle', confidence: 'high' })
  })

  it('drive o docs sueltos no son Classroom', () => {
    expect(kindForHost('drive.google.com')).toBeNull()
    expect(kindForHost('classroom.google.com')).toBe('classroom')
  })

  it('reconoce rutas típicas en dominios propios', () => {
    expect(fromURL('https://campus.uni.edu/course/view.php?id=3')).toMatchObject({ kind: 'moodle', confidence: 'high' })
    expect(fromURL('https://campus.uni.edu/login/index.php')).toMatchObject({ kind: 'moodle', confidence: 'high' })
    expect(fromURL('https://campus.uni.edu/my/')).toMatchObject({ kind: 'moodle', confidence: 'medium' })
    expect(fromURL('https://lms.uni.edu/webapps/portal/execute')).toMatchObject({ kind: 'blackboard', confidence: 'high' })
    expect(fromURL('https://lms.uni.edu/ultra/course')).toMatchObject({ kind: 'blackboard' })
    expect(fromURL('https://lms.uni.edu/d2l/home/123')).toMatchObject({ kind: 'brightspace', confidence: 'high' })
    expect(fromURL('https://lms.uni.edu/portal/site/abc')).toMatchObject({ kind: 'sakai', confidence: 'high' })
    expect(fromURL('https://learn.uni.edu/courses/course-v1:Org+C1+2024/course/')).toMatchObject({ kind: 'openedx', confidence: 'high' })
    expect(fromURL('https://lms.uni.edu/login/canvas')).toMatchObject({ kind: 'canvas', confidence: 'high' })
    expect(fromURL('https://lms.uni.edu/courses/12/modules')).toMatchObject({ kind: 'canvas', confidence: 'medium' })
    expect(fromURL('https://lms.uni.edu/courses/12')).toMatchObject({ kind: 'canvas', confidence: 'low' })
    expect(fromURL('https://lms.uni.edu/course/55/materials')).toMatchObject({ kind: 'schoology', confidence: 'medium' })
  })

  it('el nombre del host es una pista débil', () => {
    expect(fromURL('moodle.uni.edu')).toMatchObject({ kind: 'moodle', confidence: 'low' })
    expect(fromURL('https://canvas.uni.edu/')).toMatchObject({ kind: 'canvas', confidence: 'low' })
    expect(fromURL('https://campusmoodle.uni.edu/')).toMatchObject({ kind: 'moodle', confidence: 'low' })
    expect(fromURL('https://www.ejemplo.com/curso')).toBeNull()
    expect(fromURL('no es una url')).toBeNull()
  })
})

describe('detector por HTML y título', () => {
  it('suma marcas y decide por la puntuación', () => {
    expect(fromHTML('<script>M.cfg = {"wwwroot":"x"}</script><link href="/theme/styles.php/boost">')).toMatchObject({ kind: 'moodle', confidence: 'high' })
    expect(fromHTML('<body class="ic-Login-Body">')).toMatchObject({ kind: 'canvas', confidence: 'medium' })
    expect(fromHTML('<p>instructure.com</p>')).toMatchObject({ kind: 'canvas', confidence: 'low' })
    expect(fromHTML('<html><body>hola</body></html>')).toBeNull()
  })

  it('con empate no decide', () => {
    expect(fromHTML('powered by moodle brandable_css')).toBeNull()
  })

  it('el título es la última pista', () => {
    expect(fromTitle('Iniciar sesión | Moodle')).toMatchObject({ kind: 'moodle', confidence: 'low' })
    expect(fromTitle('Mi página')).toBeNull()
  })

  it('detectPlatform: gana la pista más segura', () => {
    expect(detectPlatform({ url: 'https://campus.uni.edu/', html: '<div id="page-login-index">M.cfg = {</div>' })).toMatchObject({ kind: 'moodle', confidence: 'high' })
    expect(detectPlatform({ url: 'https://uni.instructure.com', html: 'powered by moodle yui_combo.php' })).toMatchObject({ kind: 'canvas', confidence: 'high' })
    expect(detectPlatform({ title: 'Canvas LMS' })).toMatchObject({ kind: 'canvas' })
    expect(detectPlatform({})).toBeNull()
  })

  it('confidenceAtLeast', () => {
    expect(confidenceAtLeast('high', 'medium')).toBe(true)
    expect(confidenceAtLeast('low', 'medium')).toBe(false)
    expect(confidenceAtLeast(null, 'low')).toBe(false)
  })

  it('avisa de plataformas cerradas', () => {
    expect(closedPlatformNotice('www.edmodo.com')?.es).toContain('Edmodo')
    expect(closedPlatformNotice('moodle.uni.edu')).toBeNull()
  })
})

describe('sondeo sin sesión (piezas puras)', () => {
  it('ignora los saltos del SSO y usa el HTML del último salto de la plataforma', () => {
    const hops = ['https://campus.uni.edu/', 'https://login.microsoftonline.com/abc/saml2']
    expect(detectFromHops(hops, '<html>Microsoft</html>', 'Sign in')).toBeNull()
    const d = detectFromHops(['https://campus.uni.edu/', 'https://campus.uni.edu/login/index.php'], '<body>M.cfg = {</body>', 'Acceso')
    expect(d).toMatchObject({ kind: 'moodle', confidence: 'high' })
  })

  it('usa el HTML final si ningún salto dice nada', () => {
    expect(detectFromHops(['https://lms.uni.edu/'], '<body class="d2l-body">', null)).toMatchObject({ kind: 'brightspace' })
  })

  it('pageTitle decodifica entidades y recorta', () => {
    expect(pageTitle('<title>Campus &amp; Aula &#8211; Login</title>')).toBe('Campus & Aula – Login')
    expect(pageTitle('<p>sin título</p>')).toBeNull()
    expect(pageTitle(`<title>${'x'.repeat(400)}</title>`)?.length).toBe(160)
  })

  it('iconLinks ordena apple-touch primero y añade /favicon.ico', () => {
    const html = '<link rel="icon" href="/fav.png"><link rel="apple-touch-icon" href="/touch.png"><link rel="stylesheet" href="/a.css">'
    expect(iconLinks(html, 'https://campus.uni.edu/x')).toEqual([
      'https://campus.uni.edu/touch.png', 'https://campus.uni.edu/fav.png', 'https://campus.uni.edu/favicon.ico'
    ])
  })
})
