import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { platformSecretKeys } from '@shared/settings/platforms'
import { setDataRoot } from '../paths'
import { resetSettingsCache, getSettings } from '../settings'
import { MemorySecretStore, secrets, setSecretStore } from '../secrets'
import { log } from '../log'
import { addAccount, changeAccountBaseURL, getAccount, listAccounts, removeAccount, requireAccount, sanitizeAccount, setCanvasToken, updateAccount, canvasToken } from './accounts'
import { clearCookieSnapshot, cookiesToRestore, loadCookieSnapshot, saveCookieSnapshot } from './cookie-store'
import { accountView, platformStatus } from './status'
import { platformCalendarURL, savePlatformCalendarURL } from './calendar'
import { canvasCoursesToPlatform, moodleCoursesToPlatform, sortPlatformCourses } from './courses'
import { platformDownloadsDir, stagingPath, storeDownloadedFile, verifyDownloadedFile, cleanupPlatformDownloads } from './downloads'
import { probePlatform, probeWwwroot } from './probe'
import { fakeHttp, html, redirectTo } from './fake-http'

log.setSink(() => undefined)
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aula-platforms-'))
  setDataRoot(root)
  resetSettingsCache()
  setSecretStore(new MemorySecretStore())
  platformStatus.clear()
})

describe('cuentas', () => {
  it('alta con tipo detectado, sin duplicar el mismo sitio, y guardada en settings.json', () => {
    const a = addAccount({ url: 'uni.instructure.com' })
    expect(a).toMatchObject({ kind: 'canvas', baseURL: 'https://uni.instructure.com/', label: 'Canvas', lastState: 'unknown' })
    expect(a.id).toMatch(/^[0-9a-f]{12}$/)
    expect(addAccount({ url: 'https://uni.instructure.com/courses/3' }).id).toBe(a.id)
    const renamed = addAccount({ url: 'https://uni.instructure.com', label: 'Mi Canvas' })
    expect(renamed).toMatchObject({ id: a.id, label: 'Mi Canvas' })
    const disk = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')) as { platforms: { accounts: unknown[] } }
    expect(disk.platforms.accounts).toHaveLength(1)
    expect(() => addAccount({ url: 'no vale' })).toThrow()
  })

  it('lectura tolerante de cuentas escritas a mano o de otra versión', () => {
    expect(sanitizeAccount({ id: 'ok_1', kind: 'googleClassroom', baseURL: 'classroom.google.com' })).toMatchObject({ kind: 'classroom', baseURL: 'https://classroom.google.com/' })
    expect(sanitizeAccount({ id: '../x', baseURL: 'https://a.edu' })).toBeNull()
    expect(sanitizeAccount({ id: 'a', baseURL: 'javascript:x' })).toBeNull()
    expect(sanitizeAccount('x')).toBeNull()
  })

  it('cambios y bajas (con sus secretos)', () => {
    const a = addAccount({ url: 'campus.uni.edu/moodle', kind: 'moodle' })
    updateAccount(a.id, { notes: 'Los exámenes están en Avisos' })
    expect(getAccount(a.id)?.notes).toBe('Los exámenes están en Avisos')
    secrets().set(platformSecretKeys.cookies(a.id), '{}')
    savePlatformCalendarURL(a, 'https://campus.uni.edu/moodle/calendar/export_execute.php?authtoken=x')
    expect(platformCalendarURL(getAccount(a.id)!)).toContain('authtoken=x')
    expect(accountView(getAccount(a.id)!).calendarConnected).toBe(true)
    removeAccount(a.id)
    expect(listAccounts()).toEqual([])
    expect(secrets().keys()).toEqual([])
    expect(() => requireAccount(a.id)).toThrow(/No encuentro/)
    expect(() => requireAccount(3)).toThrow()
  })

  it('token de Canvas (opcional): validado, en secretos y nunca en la vista', () => {
    const a = addAccount({ url: 'uni.instructure.com' })
    expect(() => setCanvasToken(a.id, 'con espacios no')).toThrow()
    const withToken = setCanvasToken(a.id, '  ' + '7'.repeat(40) + '  ')
    expect(withToken.tokenSecretRef).toBe(platformSecretKeys.canvasToken(a.id))
    expect(canvasToken(withToken)).toBe('7'.repeat(40))
    const view = accountView(withToken)
    expect(view.tokenMode).toBe(true)
    expect(JSON.stringify(view)).not.toContain('7777')
    expect(setCanvasToken(a.id, null).tokenSecretRef).toBeUndefined()
    expect(secrets().keys()).toEqual([])
  })

  it('cambiar la dirección: validada, sin chocar con otra cuenta y conservando todo lo demás', () => {
    const m = addAccount({ url: 'https://campus.uni.edu/login/index.php', kind: 'moodle', label: 'Campus' })
    secrets().set(platformSecretKeys.cookies(m.id), 'x')
    const moved = changeAccountBaseURL(m.id, 'https://ev.uni.edu/moodle')
    expect(moved).toMatchObject({ id: m.id, kind: 'moodle', label: 'Campus', baseURL: 'https://ev.uni.edu/moodle', createdAt: m.createdAt })
    expect(getAccount(m.id)?.baseURL).toBe('https://ev.uni.edu/moodle')
    expect(secrets().get(platformSecretKeys.cookies(m.id))).toBe('x')
    expect(() => changeAccountBaseURL(m.id, 'javascript:alert(1)')).toThrow(expect.objectContaining({ code: 'invalid_args' }))
    expect(() => changeAccountBaseURL(m.id, 'https://user:pw@ev.uni.edu/')).toThrow(expect.objectContaining({ code: 'invalid_args' }))
    const other = addAccount({ url: 'https://otro.uni.edu', kind: 'moodle' })
    expect(() => changeAccountBaseURL(m.id, 'https://otro.uni.edu/moodle')).toThrow(expect.objectContaining({ code: 'conflict' }))
    // la misma cuenta puede quedarse en su origen (p. ej. cambiar solo la carpeta)
    expect(changeAccountBaseURL(other.id, 'https://otro.uni.edu/m/').baseURL).toBe('https://otro.uni.edu/m/')
  })

  it('la vista usa el estado de esta ejecución o el último guardado', () => {
    const a = updateAccount(addAccount({ url: 'uni.instructure.com' }).id, { lastState: 'needsSignIn' })
    expect(accountView(a)).toMatchObject({ status: 'needsSignIn', kindName: 'Canvas', signingIn: false, calendarConnected: false })
    platformStatus.set(a.id, { status: 'signedIn' })
    expect(accountView(a).status).toBe('signedIn')
    expect(getSettings().platforms.keepSignedIn).toBe(true)
  })
})

describe('copia cifrada de las cookies', () => {
  const NOW = Date.UTC(2026, 9, 26)
  const cookies = [{ name: 'S', value: 'secret-value', domain: 'uni.instructure.com', hostOnly: true, path: '/', secure: true, httpOnly: true, session: true }]

  it('guarda, no reescribe si no cambió y repone lo que falta', () => {
    expect(saveCookieSnapshot('a1', cookies, NOW)).toBe(true)
    expect(saveCookieSnapshot('a1', cookies, NOW + 60_000)).toBe(false)
    expect(saveCookieSnapshot('a1', [{ ...cookies[0], value: 'changed' }], NOW + 120_000)).toBe(true)
    expect(loadCookieSnapshot('a1')?.cookies[0].value).toBe('changed')
    // sin nada que guardar y sin copia previa: no se crea
    expect(saveCookieSnapshot('a2', [], NOW)).toBe(false)
    const plan = cookiesToRestore('a1', [], NOW + 3600_000)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ name: 'S', value: 'changed', url: 'https://uni.instructure.com/' })
    clearCookieSnapshot('a1')
    expect(loadCookieSnapshot('a1')).toBeNull()
  })

  it('el valor va solo al almacén de secretos (no a settings.json)', () => {
    addAccount({ url: 'uni.instructure.com' })
    saveCookieSnapshot('a1', cookies, NOW)
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).not.toContain('secret-value')
    expect(secrets().get(platformSecretKeys.cookies('a1'))).toContain('secret-value')
  })
})

describe('cursos de la plataforma', () => {
  it('Canvas y Moodle → vista común, ordenados por periodo y nombre', () => {
    const c = canvasCoursesToPlatform('a', [
      { id: '1', name: 'Física', courseCode: 'FIS', term: { name: '2024-25' }, accessRestrictedByDate: false, url: 'u1' },
      { id: '2', name: 'Álgebra', courseCode: 'Álgebra', term: { name: '2025-26' }, accessRestrictedByDate: false, url: 'u2' },
      { id: '3', name: 'Tutoría', accessRestrictedByDate: false, url: 'u3' }
    ])
    expect(sortPlatformCourses(c).map((x) => [x.name, x.code ?? null, x.term ?? null])).toEqual([
      ['Álgebra', null, '2025-26'], ['Física', 'FIS', '2024-25'], ['Tutoría', null, null]
    ])
    expect(moodleCoursesToPlatform('m', [{ id: 7, fullname: 'Química', shortname: 'QUI', url: 'u' }])).toEqual([
      { id: '7', accountId: 'm', kind: 'moodle', name: 'Química', code: 'QUI', url: 'u' }
    ])
  })
})

describe('descargas a disco', () => {
  it('comprueba y guarda sin sobrescribir, con nombre saneado', () => {
    const dir = platformDownloadsDir('acc')
    const put = (content: string | Uint8Array): string => {
      const p = stagingPath()
      writeFileSync(p, content)
      return p
    }
    const a = put('%PDF-1.7 contenido')
    verifyDownloadedFile(a, { filename: 'Tema 1.pdf', mimeType: 'application/pdf', maxBytes: 1000 })
    const s1 = storeDownloadedFile(a, dir, '../Tema 1.pdf', 'application/pdf')
    const s2 = storeDownloadedFile(put('%PDF-1.7 otro'), dir, 'Tema 1.pdf', 'application/pdf')
    expect([s1.filename, s2.filename]).toEqual(['Tema 1.pdf', 'Tema 1 (2).pdf'])
    expect(existsSync(a)).toBe(false)
    if (process.platform !== 'win32') expect((statSync(s1.path).mode & 0o777).toString(8)).toBe('644')
    expect(storeDownloadedFile(put('x'), dir, 'apuntes', 'application/pdf').filename).toBe('apuntes.pdf')
  })

  it('rechaza programas, páginas de acceso, vacíos y demasiado grandes', () => {
    const put = (content: string | Uint8Array): string => {
      const p = stagingPath()
      writeFileSync(p, content)
      return p
    }
    expect(() => verifyDownloadedFile(put(new Uint8Array([0x4d, 0x5a, 1, 2])), { filename: 'tema.pdf', mimeType: 'application/pdf', maxBytes: 1000 })).toThrow(/programas/)
    expect(() => verifyDownloadedFile(put('<!DOCTYPE html><html>login'), { filename: 'tema.pdf', mimeType: 'text/html', maxBytes: 1000 })).toThrow(/iniciar sesión/)
    expect(() => verifyDownloadedFile(put(''), { filename: 'a.pdf', mimeType: null, maxBytes: 1000 })).toThrow(/vacío/)
    expect(() => verifyDownloadedFile(put('x'.repeat(2000)), { filename: 'a.pdf', mimeType: null, maxBytes: 1000 })).toThrow(/grande/)
    cleanupPlatformDownloads(0, Date.now() + 10 * 86_400_000)
    expect(readdirSync(join(root, 'Cache', 'Platform Downloads', '.staging'))).toEqual([])
  })
})

describe('sondeo sin sesión', () => {
  it('detecta por el HTML de la página pública y apunta la dirección final', async () => {
    const h = fakeHttp({ 'https://campus.uni.edu/': html('https://campus.uni.edu/login/index.php', '<title>Campus: Acceso</title><script>M.cfg = {"sesskey":"x"}</script>', 200, ['https://campus.uni.edu/login/index.php']) })
    const r = await probePlatform('campus.uni.edu', h.fetch)
    expect(r).toMatchObject({ kind: 'moodle', confidence: 'high', title: 'Campus: Acceso', finalURL: 'https://campus.uni.edu/login/index.php', httpStatus: 200 })
    expect(h.calls[0].init).toMatchObject({ truncate: true, redirect: 'manual' })
  })

  it('auth_oidc forzado: sigue hasta la página de acceso y para ANTES de /auth/oidc/ (sin empezar el acceso de Microsoft)', async () => {
    const h = fakeHttp({
      'http://moodle.uni.edu/': redirectTo('http://moodle.uni.edu/', 'https://moodle.uni.edu/', 301),
      'https://moodle.uni.edu/': redirectTo('https://moodle.uni.edu/', '/login/index.php', 303),
      'https://moodle.uni.edu/login/index.php': redirectTo('https://moodle.uni.edu/login/index.php', '/auth/oidc/?source=loginpage', 303),
      'https://moodle.uni.edu/auth/oidc/?source=loginpage': redirectTo('x', 'https://login.microsoftonline.com/t/oauth2/authorize?state=1', 302)
    })
    const r = await probePlatform('http://moodle.uni.edu', h.fetch)
    expect(h.calls.map((c) => c.url)).toEqual(['http://moodle.uni.edu/', 'https://moodle.uni.edu/', 'https://moodle.uni.edu/login/index.php'])
    // la página de la plataforma de antes del salto (por https): así el alta guarda https
    expect(r).toMatchObject({ kind: 'moodle', confidence: 'high', finalURL: 'https://moodle.uni.edu/login/index.php' })
  })

  it('nunca pide el proveedor de identidad (la dirección final es la última de la plataforma)', async () => {
    const h = fakeHttp({
      'https://campus.uni.edu/': redirectTo('https://campus.uni.edu/', 'https://login.microsoftonline.com/t/saml2?SAMLRequest=abc', 302)
    })
    const r = await probePlatform('campus.uni.edu', h.fetch)
    expect(h.calls).toHaveLength(1)
    expect(r.finalURL).toBe('https://campus.uni.edu/')
    expect(JSON.stringify(r)).not.toContain('SAMLRequest')
  })

  it('demasiadas redirecciones: se detecta por la dirección', async () => {
    const h = fakeHttp({ 'https://loop.uni.edu/': redirectTo('https://loop.uni.edu/', 'https://loop.uni.edu/', 302) })
    const r = await probePlatform('loop.uni.edu', h.fetch)
    expect(r.error).toContain('No pude abrir')
    expect(h.calls.length).toBeLessThanOrEqual(11)
  })

  it('Moodle: trae el wwwroot de la página final (solo si es una dirección web)', async () => {
    const page = '<title>Acceso</title><script>M.cfg = {"wwwroot":"https:\\/\\/ev.uni.edu\\/moodle","sesskey":"x"};</script>'
    const h = fakeHttp({ 'https://campus.uni.edu/': html('https://ev.uni.edu/moodle/login/index.php', page, 200, ['https://ev.uni.edu/moodle/login/index.php']) })
    expect(await probePlatform('campus.uni.edu', h.fetch)).toMatchObject({ kind: 'moodle', wwwroot: 'https://ev.uni.edu/moodle', finalURL: 'https://ev.uni.edu/moodle/login/index.php' })
    const plain = fakeHttp({ 'https://web.uni.edu/': html('https://web.uni.edu/', '<title>Web</title>') })
    expect(await probePlatform('web.uni.edu', plain.fetch)).not.toHaveProperty('wwwroot')
    expect(probeWwwroot('<script>M.cfg = {"wwwroot":"javascript:alert(1)"};</script>')).toBeNull()
    expect(probeWwwroot('<script>M.cfg = {"wwwroot":"https://a:b@x.edu"};</script>')).toBeNull()
    expect(probeWwwroot('<script>M.cfg = {"wwwroot":"http:\\/\\/x.edu"};</script>')).toBe('http://x.edu')
  })

  it('sin red detecta por la dirección; avisa de plataformas cerradas; dirección mala', async () => {
    expect(await probePlatform('uni.instructure.com', fakeHttp().fetch)).toMatchObject({ kind: 'canvas', confidence: 'high', error: expect.stringContaining('No pude abrir') })
    expect((await probePlatform('new.edmodo.com', fakeHttp().fetch)).notice).toContain('Edmodo')
    expect((await probePlatform('a b', fakeHttp().fetch)).error).toBeTruthy()
  })
})
