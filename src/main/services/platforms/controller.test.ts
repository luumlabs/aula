import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlatformAccount } from '@shared/settings/platforms'
import { platformSecretKeys } from '@shared/settings/platforms'
import type { PlatformAccountView } from '@shared/platforms/types'
import { setDataRoot } from '../paths'
import { getSettings, resetSettingsCache, updateSettings } from '../settings'
import { MemorySecretStore, secrets, setSecretStore } from '../secrets'
import { log } from '../log'
import { addAccount, getAccount } from './accounts'
import { PlatformController, moodleAccountURL, type PlatformBrowserAdapter, type SignInResult, type SignInSession } from './controller'
import { fakeHttp, html, json, redirectTo, type FakeHttp } from './fake-http'
import { HttpError, type HttpResponse } from './http'
import { cachedMoodleSesskey, rememberMoodleSesskey } from './session-check'
import { KeepAliveScheduler } from './keepalive'
import type { PlatformProbeOutcome } from './probe'
import { platformStatus } from './status'

log.setSink(() => undefined)

const SELF = 'https://uni.instructure.com/api/v1/users/self'

interface Harness {
  c: PlatformController
  http: FakeHttp
  events: { status: PlatformAccountView[]; signedIn: PlatformAccountView[] }
  log: string[]
  signIn: { resolve: (v: SignInResult) => Promise<void>; focused: number; cancelled: number; rechecks: boolean[]; verify: () => Promise<string> } | null
  silent: { result: boolean; calls: number; during?: () => void }
  timeouts: (() => void)[]
  /** Reloj inyectado: el tiempo solo avanza cuando la prueba lo dice. */
  advance: (ms: number) => void
  /** Se resuelve cuando se abre la siguiente ventana de inicio de sesión. */
  nextWindow: () => Promise<void>
  /** Se resuelve con el primer aviso de estado (ya recibido o futuro) que cumple la condición. */
  until: (pred: (v: PlatformAccountView) => boolean) => Promise<PlatformAccountView>
}

function harness(opts: { silentResult?: boolean } = {}): Harness {
  const http = fakeHttp()
  const logLines: string[] = []
  let now = Date.UTC(2026, 9, 26, 9, 0, 0)
  const windowWaiters: (() => void)[] = []
  const statusWaiters: { pred: (v: PlatformAccountView) => boolean; resolve: (v: PlatformAccountView) => void }[] = []
  const h: Harness = {
    c: null as unknown as PlatformController, http, events: { status: [], signedIn: [] }, log: logLines, signIn: null,
    silent: { result: opts.silentResult ?? false, calls: 0 }, timeouts: [],
    advance: (ms) => { now += ms },
    nextWindow: () => new Promise<void>((r) => windowWaiters.push(r)),
    until: (pred) => {
      const seen = h.events.status.find(pred)
      return seen ? Promise.resolve(seen) : new Promise((resolve) => statusWaiters.push({ pred, resolve }))
    }
  }
  const adapter: PlatformBrowserAdapter = {
    sessionFetch: (id) => {
      logLines.push(`fetch:${id}`)
      return http.fetch
    },
    snapshotCookies: async (a) => {
      logLines.push(`snapshot:${a.id}`)
      return true
    },
    restoreCookies: async (a) => {
      logLines.push(`restore:${a.id}`)
      return 1
    },
    clearSession: async (id) => {
      logLines.push(`clear:${id}`)
    },
    openSignIn: (a, hooks): SignInSession => {
      logLines.push(`window:${a.id}`)
      let resolve!: (v: SignInResult) => void
      const promise = new Promise<SignInResult>((r) => (resolve = r))
      const state = { resolve: async (v: SignInResult) => { if (v.signedIn) await hooks.onSuccess(); resolve(v) }, focused: 0, cancelled: 0, rechecks: [] as boolean[], verify: hooks.verify }
      h.signIn = state as Harness['signIn']
      for (const w of windowWaiters.splice(0)) w()
      return {
        promise, focus: () => { state.focused++ }, cancel: () => { state.cancelled++; resolve({ signedIn: false }) },
        // como la ventana de verdad: comprueba con la sesión y, si hay, termina sola
        recheck: async (force = false) => {
          state.rechecks.push(force)
          if ((await hooks.verify()) !== 'signedIn') return false
          await state.resolve({ signedIn: true })
          return true
        }
      }
    },
    silentSignIn: async (a) => {
      h.silent.calls++
      logLines.push(`silent:${a.id}${h.c.isSigningIn(a.id) ? '(window)' : ''}`)
      h.silent.during?.()
      return h.silent.result
    },
    cancelSilentSignIn: (id) => logLines.push(`cancelSilent:${id}`),
    closeAccountTabs: (id) => logLines.push(`tabs:${id}`)
  }
  h.c = new PlatformController(adapter, {
    setInterval: () => 0, clearInterval: () => undefined,
    setTimeout: (fn) => { h.timeouts.push(fn); return h.timeouts.length }, clearTimeout: () => undefined,
    scheduler: (deps) => new KeepAliveScheduler({ ...deps, setTimer: () => 0, clearTimer: () => undefined }),
    probe: async (url) => ({ url, finalURL: url, kind: null, confidence: null }),
    now: () => now
  })
  h.c.on('status', (v) => {
    h.events.status.push(v)
    for (const w of [...statusWaiters]) {
      if (!w.pred(v)) continue
      statusWaiters.splice(statusWaiters.indexOf(w), 1)
      w.resolve(v)
    }
  })
  h.c.on('signedIn', (v) => h.events.signedIn.push(v))
  return h
}

let canvas: PlatformAccount

beforeEach(() => {
  setDataRoot(mkdtempSync(join(tmpdir(), 'aula-ctl-')))
  resetSettingsCache()
  setSecretStore(new MemorySecretStore())
  platformStatus.clear()
  canvas = addAccount({ url: 'https://uni.instructure.com', kind: 'canvas', label: 'Canvas' })
})

describe('arranque', () => {
  it('repone las cookies de TODAS las cuentas antes de la primera petición y luego comprueba', async () => {
    const m = addAccount({ url: 'https://campus.uni.edu', kind: 'moodle' })
    const h = harness()
    h.http.route(SELF, json(SELF, { id: 1 }))
    h.http.route('https://campus.uni.edu/my/', html('https://campus.uni.edu/my/', '<a href="/login/logout.php?sesskey=Abcdef1234">x</a>'))
    await h.c.start()
    await Promise.all([h.until((v) => v.id === canvas.id && v.status === 'signedIn'), h.until((v) => v.id === m.id && v.status === 'signedIn')])
    const firstFetch = h.log.findIndex((l) => l.startsWith('fetch:'))
    expect(h.log.slice(0, 2).sort()).toEqual([`restore:${canvas.id}`, `restore:${m.id}`].sort())
    expect(firstFetch).toBeGreaterThan(1)
    expect(h.c.view(canvas.id).status).toBe('signedIn')
    expect(h.c.view(m.id).status).toBe('signedIn')
    await h.c.shutdown(100)
  })
})

describe('comprobación y sesión cerrada', () => {
  it('iniciada: estado, aviso, se guarda en la cuenta y se copian las cookies', async () => {
    const h = harness()
    h.http.route(SELF, json(SELF, { id: 1 }))
    const v = await h.c.check(canvas.id)
    expect(v.status).toBe('signedIn')
    expect(getAccount(canvas.id)?.lastState).toBe('signedIn')
    expect(getAccount(canvas.id)?.lastCheckedAt).toBeTruthy()
    expect(h.log).toContain(`snapshot:${canvas.id}`)
    expect(h.events.status.map((s) => s.status)).toContain('signedIn')
  })

  it('cerrada: antes de pedir nada al estudiante intenta volver a entrar sola por el SSO', async () => {
    const h = harness({ silentResult: true })
    h.http.route(SELF, (_u, _i, n) => (n === 1 ? json(SELF, { status: 'unauthenticated' }, 401) : json(SELF, { id: 1 })))
    const v = await h.c.check(canvas.id)
    expect(h.silent.calls).toBe(1)
    expect(v.status).toBe('signedIn')
  })

  it('cerrada de verdad: needsSignIn (con motivo), guardado y sin reintentar el SSO enseguida', async () => {
    const h = harness({ silentResult: false })
    h.http.route(SELF, json(SELF, { status: 'unauthenticated' }, 401))
    const v = await h.c.check(canvas.id)
    expect(v).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('inicia sesión') })
    expect(getAccount(canvas.id)?.lastState).toBe('needsSignIn')
    expect(h.c.keepAliveState().find((s) => s.id === canvas.id)?.status).toBe('needsSignIn')
    await h.c.check(canvas.id)
    expect(h.silent.calls).toBe(1)
    // no se guardan las cookies de una sesión cerrada (no se pisa la copia buena)
    expect(h.log.filter((l) => l.startsWith('snapshot:'))).toEqual([])
    await h.c.snapshotIfDue()
    expect(h.log.filter((l) => l.startsWith('snapshot:'))).toEqual([])
  })

  it('sin red: nunca se marca cerrada', async () => {
    updateSettings((s) => {
      s.platforms.accounts = s.platforms.accounts.map((a) => ({ ...a, lastState: 'signedIn' }))
      return s
    })
    const h = harness()
    const v = await h.c.check(canvas.id)
    expect(v.status).toBe('signedIn')
    expect(getAccount(canvas.id)?.lastState).toBe('signedIn')
  })

  it('una respuesta sospechosa (401) se confirma con la comprobación', async () => {
    const h = harness()
    const course = 'https://uni.instructure.com/api/v1/courses'
    h.http.route(course, json(course, { status: 'unauthenticated' }, 401))
    h.http.route(SELF, json(SELF, { status: 'unauthenticated' }, 401))
    const r = await h.c.fetchWithSession(canvas.id, course)
    expect(r.status).toBe(401)
    expect(h.timeouts).toHaveLength(1)
    // una segunda sospecha seguida no programa otra comprobación
    await h.c.fetchWithSession(canvas.id, course)
    expect(h.timeouts).toHaveLength(1)
    const closed = h.until((v) => v.id === canvas.id && v.status === 'needsSignIn')
    h.timeouts[0]()
    await closed
    expect(h.c.view(canvas.id).status).toBe('needsSignIn')
  })
})

describe('inicio de sesión', () => {
  it('una sola ventana a la vez; al entrar: cookies, estado, aviso y calendario conectado solo', async () => {
    const h = harness()
    const profile = 'https://uni.instructure.com/api/v1/users/self/profile'
    h.http.route(profile, json(profile, { id: 1, calendar: { ics: 'https://uni.instructure.com/feeds/calendars/user_ABC.ics' } }))
    const p1 = h.c.signIn(canvas.id)
    const p2 = h.c.signIn(canvas.id)
    expect(h.log.filter((l) => l.startsWith('window:'))).toHaveLength(1)
    expect(h.signIn?.focused).toBe(1)
    expect(h.c.view(canvas.id).signingIn).toBe(true)
    expect(h.c.isSigningIn(canvas.id)).toBe(true)
    await h.signIn!.resolve({ signedIn: true })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(r2)
    expect(r1.signedIn).toBe(true)
    expect(r1.account).toMatchObject({ status: 'signedIn', signingIn: false })
    expect(getAccount(canvas.id)?.lastSignedInAt).toBeTruthy()
    expect(h.log).toContain(`snapshot:${canvas.id}`)
    expect(h.events.signedIn).toHaveLength(1)
    await h.until((v) => v.id === canvas.id && v.calendarConnected)
    expect(secrets().get(platformSecretKeys.calendar(canvas.id))).toBe('https://uni.instructure.com/feeds/calendars/user_ABC.ics')
    expect(h.c.view(canvas.id).calendarConnected).toBe(true)
  })

  it('la ventana comprueba con la sesión (tres estados, sin cookies ni cuerpo)', async () => {
    const h = harness()
    void h.c.signIn(canvas.id)
    h.http.route(SELF, json(SELF, {}, 401))
    expect(await h.signIn!.verify()).toBe('signedOut')
    h.http.route(SELF, json(SELF, { id: 3 }))
    expect(await h.signIn!.verify()).toBe('signedIn')
    h.signIn!.resolve({ signedIn: false })
  })

  it('«Ya he iniciado sesión»: comprueba ya con la ventana abierta; si aún no, la trae al frente', async () => {
    const h = harness()
    const p = h.c.signIn(canvas.id)
    h.http.route(SELF, json(SELF, {}, 401))
    const early = await h.c.confirmSignIn(canvas.id)
    expect(early).toMatchObject({ signedIn: false, account: { signingIn: true } })
    expect(h.signIn!.rechecks).toEqual([true])
    expect(h.signIn!.focused).toBe(1)
    h.http.route(SELF, json(SELF, { id: 1 }))
    const done = await h.c.confirmSignIn(canvas.id)
    expect(done).toMatchObject({ signedIn: true, account: { status: 'signedIn', signingIn: false } })
    expect((await p).signedIn).toBe(true)
    expect(h.events.signedIn).toHaveLength(1)
    // sin ventana abierta, es una comprobación normal
    const again = await h.c.confirmSignIn(canvas.id)
    expect(again.signedIn).toBe(true)
  })

  it('«Comprobar» con la ventana abierta no se queda en «Comprobando…»: mira la ventana', async () => {
    const h = harness()
    void h.c.signIn(canvas.id)
    h.http.route(SELF, json(SELF, {}, 401))
    const v = await h.c.check(canvas.id)
    expect(v.status).not.toBe('checking')
    expect(h.signIn!.rechecks).toEqual([false])
    h.http.route(SELF, json(SELF, { id: 1 }))
    expect((await h.c.check(canvas.id)).status).toBe('signedIn')
  })

  it('ventana cerrada sin entrar', async () => {
    const h = harness()
    const p = h.c.signIn(canvas.id)
    await h.signIn!.resolve({ signedIn: false })
    expect(await p).toMatchObject({ signedIn: false, account: { signingIn: false } })
    expect(h.events.signedIn).toHaveLength(0)
  })

  it('ensureSignedIn: lo reciente vale; sin sesión y sin ventana = false; con ventana espera', async () => {
    const h = harness()
    h.http.route(SELF, json(SELF, { id: 1 }))
    await h.c.check(canvas.id)
    const calls = h.http.calls.length
    // comprobada hace menos de 2 minutos: vale sin pedir nada
    h.advance(119_000)
    expect(await h.c.ensureSignedIn(canvas.id)).toBe(true)
    expect(h.http.calls.length).toBe(calls)
    // pasados los 2 minutos se vuelve a comprobar
    h.advance(2_000)
    expect(await h.c.ensureSignedIn(canvas.id)).toBe(true)
    expect(h.http.calls.length).toBe(calls + 1)
    // maxAgeMs: 0 comprueba siempre, aunque no haya pasado ni un milisegundo
    h.http.route(SELF, json(SELF, {}, 401))
    expect(await h.c.ensureSignedIn(canvas.id, { interactive: false, maxAgeMs: 0 })).toBe(false)
    expect(h.signIn).toBeNull()
    const opened = h.nextWindow()
    const p = h.c.ensureSignedIn(canvas.id, { maxAgeMs: 0 })
    await opened
    expect(h.signIn).not.toBeNull()
    await h.signIn!.resolve({ signedIn: true })
    expect(await p).toBe(true)
  })

  it('cerrar sesión borra la partición y la copia de cookies; quitar borra todo', async () => {
    secrets().set(platformSecretKeys.cookies(canvas.id), '{"v":1,"savedAt":1,"cookies":[]}')
    const h = harness()
    const v = await h.c.signOut(canvas.id)
    expect(v).toMatchObject({ status: 'needsSignIn', statusDetail: 'Sesión cerrada.' })
    expect(h.log).toEqual(expect.arrayContaining([`tabs:${canvas.id}`, `clear:${canvas.id}`]))
    expect(secrets().get(platformSecretKeys.cookies(canvas.id))).toBeNull()
    // tras cerrar sesión a propósito, no se vuelve a entrar sola por el SSO
    h.silent.result = true
    h.http.route(SELF, json(SELF, {}, 401))
    expect((await h.c.check(canvas.id)).status).toBe('needsSignIn')
    expect(h.silent.calls).toBe(0)
    await h.c.remove(canvas.id)
    expect(h.c.list()).toEqual([])
  })
})

describe('peticiones con la sesión (para la IA)', () => {
  it('solo GET/HEAD y solo a los sitios de la plataforma', async () => {
    const h = harness()
    const u = 'https://uni.instructure.com/api/v1/courses'
    h.http.route(u, json(u, []))
    expect((await h.c.fetchWithSession(canvas.id, u)).status).toBe(200)
    await expect(h.c.fetchWithSession(canvas.id, u, { method: 'POST' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.c.fetchWithSession(canvas.id, 'https://evil.com/api')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.c.fetchWithSession(canvas.id, 'https://login.microsoftonline.com/me')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.c.fetchWithSession(canvas.id, 'file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_args' })
  })

  it('cursos de Canvas con la sesión; de otras plataformas, no', async () => {
    const h = harness()
    const u = 'https://uni.instructure.com/api/v1/courses?include%5B%5D=term&enrollment_state=active&per_page=100'
    h.http.route(u, json(u, [{ id: 1, name: 'Cálculo', course_code: 'MAT', term: { name: '2025-26' } }]))
    expect(await h.c.courses(canvas.id)).toEqual([{ id: '1', accountId: canvas.id, kind: 'canvas', name: 'Cálculo', code: 'MAT', term: '2025-26', url: 'https://uni.instructure.com/courses/1' }])
    const other = addAccount({ url: 'https://profe.com/curso', kind: 'other' })
    await expect(h.c.courses(other.id)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('si un cliente dice que la sesión se cerró, se confirma con una comprobación y entonces se avisa', async () => {
    const h = harness()
    const u = 'https://uni.instructure.com/api/v1/courses?include%5B%5D=term&enrollment_state=active&per_page=100'
    h.http.route(u, json(u, {}, 401))
    h.http.route(SELF, json(SELF, {}, 401))
    await expect(h.c.courses(canvas.id)).rejects.toMatchObject({ code: 'needs_sign_in' })
    // aún no: un error suelto de un cliente no basta
    expect(h.c.view(canvas.id).status).not.toBe('needsSignIn')
    expect(h.timeouts).toHaveLength(1)
    const closed = h.until((v) => v.id === canvas.id && v.status === 'needsSignIn')
    h.timeouts[0]()
    await closed
    expect(h.c.view(canvas.id).status).toBe('needsSignIn')
  })

  it('calendario de Moodle con la sesión', async () => {
    const m = addAccount({ url: 'https://campus.uni.edu', kind: 'moodle' })
    const h = harness()
    const key = 'Mdl1234567'
    h.http.route('https://campus.uni.edu/my/', html('https://campus.uni.edu/my/', `"sesskey":"${key}" data-userid="5" <a href="/login/logout.php?sesskey=${key}">`))
    h.http.route(`POST https://campus.uni.edu/lib/ajax/service.php?sesskey=${key}&info=core_calendar_get_calendar_export_token`, json('x', [{ error: false, data: { token: 'T0K' } }]))
    const v = await h.c.connectCalendar(m.id)
    expect(v.calendarConnected).toBe(true)
    expect(h.c.calendarURL(m.id)).toBe('https://campus.uni.edu/calendar/export_execute.php?userid=5&authtoken=T0K&preset_what=all&preset_time=recentupcoming')
    await expect(h.c.connectCalendar(addAccount({ url: 'https://uni.blackboard.com', kind: 'blackboard' }).id)).rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('alta de cuentas', () => {
  it('dirección segura: sin sondeo; si no, el sondeo decide y sigue la redirección a la plataforma real', async () => {
    const h = harness()
    const probed: string[] = []
    const c = new PlatformController({ ...({} as PlatformBrowserAdapter), sessionFetch: () => h.http.fetch } as PlatformBrowserAdapter, {
      setInterval: () => 0, clearInterval: () => undefined,
      scheduler: (deps) => new KeepAliveScheduler({ ...deps, setTimer: () => 0, clearTimer: () => undefined }),
      probe: async (url) => {
        probed.push(url)
        return { url, finalURL: 'https://uni.instructure.com/login/canvas', kind: 'canvas', confidence: 'high' }
      }
    })
    const b = await c.add({ url: 'uni.brightspace.com' })
    expect(b).toMatchObject({ kind: 'brightspace', label: 'Brightspace · uni.brightspace.com' })
    expect(probed).toEqual([])
    const v = await c.add({ url: 'campus.uni.edu' })
    expect(probed).toEqual(['https://campus.uni.edu/'])
    // es el mismo sitio que la cuenta de Canvas que ya había: no se duplica
    expect(v).toMatchObject({ id: canvas.id, kind: 'canvas', baseURL: 'https://uni.instructure.com/', label: 'Canvas' })
    expect(await c.add({ url: 'https://uni.instructure.com/courses/1' })).toMatchObject({ id: canvas.id, label: 'Canvas' })
    await expect(c.add({ url: '' })).rejects.toMatchObject({ code: 'invalid_args' })
    expect(getSettings().platforms.accounts.length).toBe(2)
  })
})

// MARK: Issue 25 (Moodle + cuenta Microsoft de la universidad: «se queda atascado o entra en bucle»)

const CAMPUS = 'https://campus.uni.edu'
const KEY = 'Abcdef1234'
const dashboard = (host = 'campus.uni.edu', userId = 7) =>
  `<html><body id="page-my-index" class="path-my"><script>M.cfg = {"wwwroot":"https:\\/\\/${host}","sesskey":"${KEY}"};</script>` +
  `<div data-userid="${userId}"></div><a href="https://${host}/login/logout.php?sesskey=${KEY}">Log out</a></body></html>`
const service = (root: string, info: string) => `${root}/lib/ajax/service.php?sesskey=${KEY}&info=${info}`
const ajaxError = (errorcode: string) => json('x', [{ error: true, exception: { errorcode, message: 'x' } }])
const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms))

/** Abre la ventana de acceso del arnés y espera a que exista; `done` es lo que devuelve `signIn`. */
async function openWindow(h: Harness, accountId: string): Promise<{ done: Promise<{ signedIn: boolean; account: PlatformAccountView }> }> {
  const opened = h.nextWindow()
  const done = h.c.signIn(accountId)
  await opened
  return { done }
}

describe('issue 25: la comprobación de fondo y la ventana de acceso', () => {
  it('L1 invertida: cuenta http:// y 301 de service.php tras entrar → sigue iniciada (y el calendario se conecta por https)', async () => {
    const m = addAccount({ url: 'http://campus.uni.edu/', kind: 'moodle' })
    const h = harness()
    h.http.route('http://campus.uni.edu/my/', redirectTo('http://campus.uni.edu/my/', `${CAMPUS}/my/`, 301))
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    const info = 'core_calendar_get_calendar_export_token'
    h.http.route(`POST ${service('http://campus.uni.edu', info)}`, (url) => redirectTo(url, url.replace('http:', 'https:'), 301))
    h.http.route(`POST ${service(CAMPUS, info)}`, json('x', [{ error: false, data: { token: 'T0K' } }]))
    for (let round = 1; round <= 2; round++) {
      const { done: p } = await openWindow(h, m.id)
      expect(await h.signIn!.verify()).toBe('signedIn')
      await h.signIn!.resolve({ signedIn: true })
      expect(await p).toMatchObject({ signedIn: true, account: { status: 'signedIn', signingIn: false } })
      if (round === 1) await h.until((v) => v.id === m.id && v.calendarConnected)
      await tick(5)
    }
    expect(h.c.view(m.id).status).toBe('signedIn')
    expect(getAccount(m.id)?.lastState).toBe('signedIn')
    expect(h.events.status.some((v) => v.id === m.id && v.status === 'needsSignIn')).toBe(false)
    expect(h.c.calendarURL(m.id)).toBe('https://campus.uni.edu/calendar/export_execute.php?userid=7&authtoken=T0K&preset_what=all&preset_time=recentupcoming')
  })

  it('una cuenta guardada con http:// pasa a https cuando su comprobación acaba en https en el mismo host', async () => {
    const m = addAccount({ url: 'http://campus.uni.edu/', kind: 'moodle' })
    const h = harness()
    h.http.route('http://campus.uni.edu/my/', redirectTo('http://campus.uni.edu/my/', `${CAMPUS}/my/`, 301))
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    expect((await h.c.check(m.id)).status).toBe('signedIn')
    expect(getAccount(m.id)?.baseURL).toBe(`${CAMPUS}/`)
    // desde ahora el toque va directo por https
    h.http.route(`POST ${service(CAMPUS, 'core_session_touch')}`, json('x', [{ error: false, data: true }]))
    const from = h.http.calls.length
    await h.c.check(m.id)
    expect(h.http.calls.slice(from).map((c) => c.url)).toEqual([service(CAMPUS, 'core_session_touch')])
  })

  it('un 3xx suelto de service.php (sin raíz nueva) no pide el acceso de golpe: lo decide una comprobación de verdad', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    rememberMoodleSesskey(m.id, KEY)
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    const info = 'core_course_get_enrolled_courses_by_timeline_classification'
    h.http.route(`POST ${service(CAMPUS, info)}`, redirectTo('x', `${CAMPUS}/login/index.php`, 303))
    await expect(h.c.courses(m.id)).rejects.toMatchObject({ code: 'needs_sign_in' })
    expect(h.c.view(m.id).status).not.toBe('needsSignIn')
    expect(h.timeouts).toHaveLength(1)
    // la comprobación dice que la sesión sigue viva: nada que pedir
    h.timeouts[0]()
    await h.until((v) => v.id === m.id && v.status === 'signedIn')
    expect(h.events.status.some((v) => v.id === m.id && v.status === 'needsSignIn')).toBe(false)
  })

  it('L2 invertida: la comprobación en marcha se corta al abrir la ventana (sin silentSignIn, sin needsSignIn, sin el segundo destino)', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness({ silentResult: false })
    let signal: AbortSignal | undefined
    // servidor lento: solo contestaría mucho después (y «sin sesión»)
    h.http.route(`${CAMPUS}/my/`, (_u, init) => new Promise<HttpResponse>((_resolve, reject) => {
      signal = init.signal
      init.signal?.addEventListener('abort', () => reject(new HttpError('cancelled', 'Cancelado')), { once: true })
    }))
    h.http.route(`${CAMPUS}/my/courses.php`, html(`${CAMPUS}/login/index.php`, '<body class="notloggedin">', 200, [`${CAMPUS}/login/index.php`]))
    const check = h.c.check(m.id)
    while (!signal) await tick()
    void openWindow(h, m.id)
    await check
    expect(signal.aborted).toBe(true)
    expect(h.silent.calls).toBe(0)
    expect(h.log).toContain(`cancelSilent:${m.id}`)
    expect(h.http.calls.map((c) => c.url)).toEqual([`${CAMPUS}/my/`])
    expect(h.events.status.some((v) => v.id === m.id && v.status === 'needsSignIn')).toBe(false)
    expect(h.c.view(m.id)).toMatchObject({ signingIn: true })
    expect(h.c.view(m.id).status).not.toBe('checking')
    await h.signIn!.resolve({ signedIn: false })
  })

  it('L2 con un servidor que no corta: el veredicto tardío no lanza silentSignIn ni pisa el estado mientras se inicia sesión', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness({ silentResult: false })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let asked = false
    h.http.route(`${CAMPUS}/my/`, async () => {
      asked = true
      await gate
      return html(`${CAMPUS}/login/index.php`, '<body id="page-login-index" class="notloggedin"></body>', 200, [`${CAMPUS}/login/index.php`])
    })
    const check = h.c.check(m.id)
    while (!asked) await tick()
    void openWindow(h, m.id)
    release()
    await check
    expect(h.silent.calls).toBe(0)
    expect(h.events.status.some((v) => v.id === m.id && v.status === 'needsSignIn')).toBe(false)
    expect(getAccount(m.id)?.lastState).not.toBe('needsSignIn')
    await h.signIn!.resolve({ signedIn: false })
  })

  it('si la ventana se abre durante la vuelta sola por el SSO, no se vuelve a comprobar ni se toca el estado', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness({ silentResult: true })
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/login/index.php`, '<body class="notloggedin">', 200, [`${CAMPUS}/login/index.php`]))
    h.silent.during = () => void h.c.signIn(m.id)
    await h.c.check(m.id)
    expect(h.silent.calls).toBe(1)
    expect(h.http.calls.filter((c) => c.url === `${CAMPUS}/my/`)).toHaveLength(1)
    expect(h.events.status.some((v) => v.id === m.id && v.status === 'needsSignIn')).toBe(false)
    await h.signIn!.resolve({ signedIn: false })
  })

  it('la comprobación de fondo nunca pide la página de acceso, OIDC ni Microsoft (y la cuenta queda needsSignIn como antes)', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness({ silentResult: false })
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, `${CAMPUS}/auth/oidc/?source=loginpage`, 303))
    h.http.route(`${CAMPUS}/my/courses.php`, redirectTo(`${CAMPUS}/my/courses.php`, 'https://login.microsoftonline.com/t/oauth2/authorize?x=1', 303))
    expect((await h.c.check(m.id)).status).toBe('needsSignIn')
    expect(h.http.calls.map((c) => c.url)).toEqual([`${CAMPUS}/my/`])
  })
})

describe('issue 25: paso pendiente de Moodle (política del sitio, perfil)', () => {
  const POLICY = `${CAMPUS}/admin/tool/policy/index.php`
  const ENROLLED = `POST ${service(CAMPUS, 'core_course_get_enrolled_courses_by_timeline_classification')}`
  const TOUCH = `POST ${service(CAMPUS, 'core_session_touch')}`

  function setup(): { m: PlatformAccount; h: Harness } {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    rememberMoodleSesskey(m.id, KEY)
    // como el Moodle real: el toque funciona aunque la política esté pendiente
    h.http.route(TOUCH, json('x', [{ error: false, data: true }]))
    return { m, h }
  }

  it('sitepolicynotagreed: needsSignIn con su texto; la comprobación mira la página (no el toque); solo la quita una página sin paso', async () => {
    const { m, h } = setup()
    h.http.route(ENROLLED, ajaxError('sitepolicynotagreed'))
    await expect(h.c.courses(m.id)).rejects.toMatchObject({ code: 'platform_step_pending' })
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    expect(h.c.view(m.id)).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('política') })
    expect(h.c.keepAliveState().find((s) => s.id === m.id)?.status).toBe('needsSignIn')
    // /my/ sigue llevando a la política: sigue pendiente (y sin POST: el toque diría «iniciada»)
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, POLICY, 303))
    h.http.route(POLICY, html(POLICY, dashboard()))
    let from = h.http.calls.length
    expect(await h.c.check(m.id)).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('política') })
    expect(h.http.calls.slice(from).some((c) => c.init.method === 'POST')).toBe(false)
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    // aceptada (p. ej. en otro navegador): la página ya no lleva al paso
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    expect((await h.c.check(m.id)).status).toBe('signedIn')
    expect(h.c.hasPendingStep(m.id)).toBe(false)
    // y vuelve el atajo del toque
    from = h.http.calls.length
    await h.c.check(m.id)
    expect(h.http.calls.slice(from).map((c) => c.init.method)).toEqual(['POST'])
  })

  it('usernotfullysetup también; una lectura AJAX que funciona no basta: lo decide una comprobación de página', async () => {
    const { m, h } = setup()
    const PROFILE = `${CAMPUS}/user/edit.php`
    h.http.route(ENROLLED, (_u, _i, n) => (n === 1 ? ajaxError('usernotfullysetup') : json('x', [{ error: false, data: { courses: [{ id: 3, fullname: 'Cálculo' }] } }])))
    await expect(h.c.courses(m.id)).rejects.toMatchObject({ code: 'platform_step_pending' })
    expect(h.c.view(m.id).status).toBe('needsSignIn')
    // por AJAX Moodle solo mira el perfil por encima; las páginas siguen pidiendo los campos obligatorios
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, PROFILE, 303))
    h.http.route(PROFILE, html(PROFILE, dashboard()))
    const from = h.http.calls.length
    expect(await h.c.courses(m.id)).toHaveLength(1)
    await tick(5)
    expect(h.http.calls.slice(from).some((c) => c.url === `${CAMPUS}/my/`)).toBe(true)
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    expect(h.c.view(m.id)).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('perfil') })
    // otra lectura enseguida no vuelve a pedir la página (una por minuto)
    const again = h.http.calls.length
    await h.c.courses(m.id)
    await tick(5)
    expect(h.http.calls.slice(again).some((c) => c.url === `${CAMPUS}/my/`)).toBe(false)
    // perfil completado: la siguiente comprobación por una lectura que funciona lo quita y vuelve a «iniciada»
    h.advance(61_000)
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    const back = h.until((v) => v.id === m.id && v.status === 'signedIn')
    await h.c.courses(m.id)
    await back
    expect(h.c.hasPendingStep(m.id)).toBe(false)
  })

  it('una comprobación sin respuesta clara no borra el texto del paso pendiente', async () => {
    const { m, h } = setup()
    h.http.route(ENROLLED, ajaxError('sitepolicynotagreed'))
    await expect(h.c.courses(m.id)).rejects.toMatchObject({ code: 'platform_step_pending' })
    // sin red: ni /my/ ni «Mis cursos» contestan
    expect(await h.c.check(m.id)).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('política') })
    expect(h.c.hasPendingStep(m.id)).toBe(true)
  })

  it('un veredicto con paso pendiente en la comprobación de fondo pone la marca', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, `${CAMPUS}/user/policy.php`, 303))
    h.http.route(`${CAMPUS}/user/policy.php`, html(`${CAMPUS}/user/policy.php`, dashboard()))
    expect(await h.c.check(m.id)).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('perfil') })
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    expect(h.silent.calls).toBe(0)
  })

  it('la ventana se cierra con el paso a la vista: needsSignIn con el texto del paso, sin «iniciada»', async () => {
    const { m, h } = setup()
    const { done: p } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: false, pendingStep: true })
    expect(await p).toMatchObject({ signedIn: false, account: { status: 'needsSignIn', signingIn: false, statusDetail: expect.stringContaining('política') } })
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    expect(h.events.signedIn).toHaveLength(0)
    // aunque la ventana diga signedIn, con el paso a la vista no cuenta como iniciada
    const { done: q } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: true, pendingStep: true })
    expect((await q).signedIn).toBe(false)
    expect(h.events.signedIn).toHaveLength(0)
  })

  it('la ventana se cierra «iniciada» por la página pero su comprobación vio el paso: no cuenta como iniciada', async () => {
    // recién entrada: aún sin sesskey (sin el atajo del toque)
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, POLICY, 303))
    h.http.route(POLICY, html(POLICY, dashboard()))
    const { done: p } = await openWindow(h, m.id)
    // la comprobación de la ventana ve el paso; la ventana la da por iniciada por la prueba de la página («Ya has iniciado sesión»)
    expect(await h.signIn!.verify()).toBe('unknown')
    expect(h.c.hasPendingStep(m.id)).toBe(true)
    await h.signIn!.resolve({ signedIn: true })
    expect(await p).toMatchObject({ signedIn: false, account: { status: 'needsSignIn', statusDetail: expect.stringContaining('política') } })
    expect(h.events.signedIn).toHaveLength(0)
    // aceptada después (la página ya no lleva al paso): la misma salida sí cuenta, tras mirarla otra vez
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    const { done: q } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: true })
    expect(await q).toMatchObject({ signedIn: true, account: { status: 'signedIn' } })
    expect(h.c.hasPendingStep(m.id)).toBe(false)
    expect(h.events.signedIn).toHaveLength(1)
  })

  it('la vuelta sola por el SSO acaba en la política: se explica el paso, no «inicia sesión»', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness({ silentResult: true })
    h.http.route(`${CAMPUS}/my/`, (_u, _i, n) => (n === 1 ? redirectTo(`${CAMPUS}/my/`, `${CAMPUS}/login/index.php`, 303) : redirectTo(`${CAMPUS}/my/`, POLICY, 303)))
    h.http.route(`${CAMPUS}/my/courses.php`, redirectTo(`${CAMPUS}/my/courses.php`, `${CAMPUS}/login/index.php`, 303))
    h.http.route(POLICY, html(POLICY, dashboard()))
    const v = await h.c.check(m.id)
    expect(h.silent.calls).toBe(1)
    expect(v).toMatchObject({ status: 'needsSignIn', statusDetail: expect.stringContaining('política') })
    expect(h.c.hasPendingStep(m.id)).toBe(true)
  })

  it('con la ventana abierta en la política, su comprobación dice «unknown» sin tocar el estado; al aceptar, se inicia sesión', async () => {
    const { m, h } = setup()
    h.http.route(ENROLLED, ajaxError('sitepolicynotagreed'))
    await expect(h.c.courses(m.id)).rejects.toMatchObject({ code: 'platform_step_pending' })
    h.http.route(`${CAMPUS}/my/`, redirectTo(`${CAMPUS}/my/`, POLICY, 303))
    h.http.route(POLICY, html(POLICY, dashboard()))
    const { done: p } = await openWindow(h, m.id)
    const events = h.events.status.length
    expect(await h.signIn!.verify()).toBe('unknown')
    expect(h.events.status.slice(events).every((v) => v.signingIn)).toBe(true)
    // el estudiante acepta la política en la ventana: /my/ ya es el área personal
    h.http.route(`${CAMPUS}/my/`, html(`${CAMPUS}/my/`, dashboard()))
    expect(await h.signIn!.verify()).toBe('signedIn')
    expect(h.c.hasPendingStep(m.id)).toBe(false)
    await h.signIn!.resolve({ signedIn: true })
    expect(await p).toMatchObject({ signedIn: true, account: { status: 'signedIn' } })
  })
})

describe('issue 25: Moodle en otro host del mismo sitio', () => {
  it('la ventana adopta ev.uni.edu: la cuenta pasa a esa dirección (mismo id), queda iniciada y se apunta en el registro', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    const lines: string[] = []
    log.setSink((_level, ...a) => lines.push(a.map(String).join(' ')))
    try {
      const { done: p } = await openWindow(h, m.id)
      await h.signIn!.resolve({ signedIn: true, adoptedRoot: 'https://ev.uni.edu' })
      expect(await p).toMatchObject({ signedIn: true, account: { id: m.id, baseURL: 'https://ev.uni.edu/', status: 'signedIn' } })
      expect(getAccount(m.id)?.baseURL).toBe('https://ev.uni.edu/')
      expect(lines.some((l) => l.includes(m.id) && l.includes('https://ev.uni.edu'))).toBe(true)
    } finally {
      log.setSink(() => undefined)
    }
  })

  it('también con subcarpeta, y aunque la ventana se cierre sin entrar', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    const { done: p } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: false, adoptedRoot: 'https://www.uni.edu/moodle' })
    expect(await p).toMatchObject({ signedIn: false, account: { baseURL: 'https://www.uni.edu/moodle/' } })
  })

  it.each([
    ['otro sitio', 'https://ev.otra-uni.edu'],
    ['un host de identidad', 'https://login.microsoftonline.com'],
    ['una dirección que no es web', 'javascript:alert(1)']
  ])('no adopta %s', async (_name, root) => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    const { done: p } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: false, adoptedRoot: root })
    await p
    expect(getAccount(m.id)?.baseURL).toBe(`${CAMPUS}/`)
  })

  it('nunca baja una cuenta https a http', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    const h = harness()
    const { done: p } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: false, adoptedRoot: 'http://ev.uni.edu' })
    await p
    expect(getAccount(m.id)?.baseURL).toBe(`${CAMPUS}/`)
  })

  it('no adopta la dirección de otra cuenta (ni falla)', async () => {
    const m = addAccount({ url: CAMPUS, kind: 'moodle' })
    addAccount({ url: 'https://ev.uni.edu/', kind: 'moodle' })
    const h = harness()
    const { done: p } = await openWindow(h, m.id)
    await h.signIn!.resolve({ signedIn: false, adoptedRoot: 'https://ev.uni.edu' })
    await p
    expect(getAccount(m.id)?.baseURL).toBe(`${CAMPUS}/`)
  })

  it('una cuenta que no es Moodle no adopta nada', async () => {
    const h = harness()
    const { done: p } = await openWindow(h, canvas.id)
    await h.signIn!.resolve({ signedIn: false, adoptedRoot: 'https://other.instructure.com' })
    await p
    expect(getAccount(canvas.id)?.baseURL).toBe('https://uni.instructure.com/')
  })
})

describe('issue 25: alta de Moodle por su raíz', () => {
  function controllerWith(probe: (url: string) => Partial<PlatformProbeOutcome> | null): { c: PlatformController; probed: string[] } {
    const probed: string[] = []
    const h = harness()
    const c = new PlatformController({ ...({} as PlatformBrowserAdapter), sessionFetch: () => h.http.fetch } as PlatformBrowserAdapter, {
      setInterval: () => 0, clearInterval: () => undefined,
      scheduler: (deps) => new KeepAliveScheduler({ ...deps, setTimer: () => 0, clearTimer: () => undefined }),
      probe: async (url) => {
        probed.push(url)
        const p = probe(url)
        if (!p) throw new HttpError('network', 'sin red')
        return { url, finalURL: url, kind: null, confidence: null, ...p }
      }
    })
    return { c, probed }
  }

  it('dirección pegada de la página de acceso: se guarda la raíz (sondeando para saber su wwwroot)', async () => {
    const { c, probed } = controllerWith(() => ({ finalURL: 'https://m.uni.edu/login/index.php', kind: 'moodle', confidence: 'high', wwwroot: 'https://m.uni.edu' }))
    expect(await c.add({ url: 'https://m.uni.edu/login/index.php' })).toMatchObject({ kind: 'moodle', baseURL: 'https://m.uni.edu/' })
    expect(probed).toEqual(['https://m.uni.edu/login/index.php'])
  })

  it('sin red: la raíz igualmente (sin /login/index.php), y un solo intento de sondeo', async () => {
    const { c, probed } = controllerWith(() => null)
    expect(await c.add({ url: 'https://m2.uni.edu/moodle/login/index.php?x=1' })).toMatchObject({ kind: 'moodle', baseURL: 'https://m2.uni.edu/moodle/' })
    expect(await c.add({ url: 'moodle.otra.edu', kind: undefined })).toMatchObject({ kind: 'moodle' })
    expect(probed).toHaveLength(2)
  })

  it('http:// y el sondeo acaba en https en el mismo host: se guarda https', async () => {
    const { c } = controllerWith(() => ({ finalURL: 'https://moodle.uni.edu/login/index.php', kind: 'moodle', confidence: 'high' }))
    expect(await c.add({ url: 'http://moodle.uni.edu' })).toMatchObject({ baseURL: 'https://moodle.uni.edu/' })
  })

  it('alias: campus.uni.edu redirige a ev.uni.edu, cuyo wwwroot es él mismo → ev.uni.edu (un solo sondeo)', async () => {
    const { c, probed } = controllerWith(() => ({ finalURL: 'https://ev.uni.edu/', kind: 'moodle', confidence: 'high', wwwroot: 'https://ev.uni.edu' }))
    expect(await c.add({ url: 'campus.uni.edu' })).toMatchObject({ kind: 'moodle', baseURL: 'https://ev.uni.edu/' })
    expect(probed).toHaveLength(1)
  })

  it('wwwroot en una subcarpeta', async () => {
    const { c } = controllerWith(() => ({ finalURL: 'https://uni.edu/moodle/login/index.php', kind: 'moodle', confidence: 'high', wwwroot: 'https://uni.edu/moodle' }))
    expect(await c.add({ url: 'uni.edu' })).toMatchObject({ kind: 'moodle', baseURL: 'https://uni.edu/moodle/' })
  })

  it('volver a añadir una cuenta que ya existe la actualiza (mismo id), aunque su raíz pase a https: nunca la duplica', async () => {
    const old = addAccount({ url: 'http://m.uni.edu/', kind: 'moodle', label: 'Mi Moodle' })
    const { c } = controllerWith(() => ({ finalURL: 'https://m.uni.edu/login/index.php', kind: 'moodle', confidence: 'high' }))
    expect(await c.add({ url: 'http://m.uni.edu/', kind: 'moodle' })).toMatchObject({ id: old.id, baseURL: 'https://m.uni.edu/', label: 'Mi Moodle' })
    expect(await c.add({ url: 'http://m.uni.edu/login/index.php', label: 'Campus' })).toMatchObject({ id: old.id, baseURL: 'https://m.uni.edu/', label: 'Campus' })
    expect(getSettings().platforms.accounts.filter((a) => a.kind === 'moodle')).toHaveLength(1)
    // un alias: la dirección pegada es la de la cuenta; el wwwroot la mueve a su Moodle (mismo id)
    const alias = addAccount({ url: 'https://campus.otra.edu/', kind: 'moodle' })
    const moved = controllerWith(() => ({ finalURL: 'https://ev.otra.edu/', kind: 'moodle', confidence: 'high', wwwroot: 'https://ev.otra.edu' }))
    expect(await moved.c.add({ url: 'https://campus.otra.edu/', kind: 'moodle' })).toMatchObject({ id: alias.id, baseURL: 'https://ev.otra.edu/' })
    expect(getSettings().platforms.accounts.filter((a) => a.kind === 'moodle')).toHaveLength(2)
  })

  it('moodleAccountURL: wwwroot solo del host de su página; nunca un host de identidad; otro sitio solo si el sondeo vio un Moodle', () => {
    expect(moodleAccountURL('https://m.uni.edu/login/index.php', null)).toBe('https://m.uni.edu/')
    expect(moodleAccountURL('https://m.uni.edu/', { finalURL: 'https://login.microsoftonline.com/t/oauth2/authorize', wwwroot: 'https://login.microsoftonline.com', kind: 'moodle' })).toBe('https://m.uni.edu/')
    // wwwroot de otro host que la página: no vale
    expect(moodleAccountURL('https://m.uni.edu/', { finalURL: 'https://m.uni.edu/login/index.php', wwwroot: 'https://ev.uni.edu', kind: 'moodle' })).toBe('https://m.uni.edu/')
    expect(moodleAccountURL('https://uni.edu/', { finalURL: 'https://campus.hosting.net/', wwwroot: 'https://campus.hosting.net', kind: null })).toBe('https://uni.edu/')
    expect(moodleAccountURL('https://uni.edu/', { finalURL: 'https://campus.hosting.net/', wwwroot: 'https://campus.hosting.net', kind: 'moodle' })).toBe('https://campus.hosting.net/')
    // wwwroot por http con la página por https: se queda https
    expect(moodleAccountURL('http://m.uni.edu/', { finalURL: 'https://m.uni.edu/login/index.php', wwwroot: 'http://m.uni.edu', kind: 'moodle' })).toBe('https://m.uni.edu/')
    // el sondeo acabó por https en OTRO host: no se cambia el esquema
    expect(moodleAccountURL('http://m.uni.edu/', { finalURL: 'https://login.microsoftonline.com/x', kind: null })).toBe('http://m.uni.edu/')
  })
})
