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
import { PlatformController, type PlatformBrowserAdapter, type SignInSession } from './controller'
import { fakeHttp, html, json, type FakeHttp } from './fake-http'
import { KeepAliveScheduler } from './keepalive'
import { platformStatus } from './status'

log.setSink(() => undefined)

const SELF = 'https://uni.instructure.com/api/v1/users/self'

interface Harness {
  c: PlatformController
  http: FakeHttp
  events: { status: PlatformAccountView[]; signedIn: PlatformAccountView[] }
  log: string[]
  signIn: { resolve: (v: { signedIn: boolean }) => void; focused: number; cancelled: number; rechecks: boolean[]; verify: () => Promise<string> } | null
  silent: { result: boolean; calls: number }
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
      let resolve!: (v: { signedIn: boolean }) => void
      const promise = new Promise<{ signedIn: boolean }>((r) => (resolve = r))
      const state = { resolve: async (v: { signedIn: boolean }) => { if (v.signedIn) await hooks.onSuccess(); resolve(v) }, focused: 0, cancelled: 0, rechecks: [] as boolean[], verify: hooks.verify }
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
      logLines.push(`silent:${a.id}`)
      return h.silent.result
    },
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

  it('si un cliente dice que la sesión se cerró, se avisa', async () => {
    const h = harness()
    const u = 'https://uni.instructure.com/api/v1/courses?include%5B%5D=term&enrollment_state=active&per_page=100'
    h.http.route(u, json(u, {}, 401))
    await expect(h.c.courses(canvas.id)).rejects.toMatchObject({ code: 'needs_sign_in' })
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
