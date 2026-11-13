// La guarda de WebAuthn se prueba SERIALIZADA (como la usa contextBridge.executeInMainWorld: solo su texto), con un
// objeto global falso que imita a Chromium en Electron: la petición modal no termina nunca, solo la cancela una señal, y
// una segunda petición con la primera pendiente falla con «A request is already pending».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installWebAuthnGuard, webAuthnCapMs, webAuthnNativeUI, type GuardAbortSignal, type GuardCredentialOptions, type WebAuthnGuardGlobal, type WebAuthnGuardOptions } from './webauthn-guard'

type Install = (g: WebAuthnGuardGlobal | null, opts: WebAuthnGuardOptions) => boolean

/** Lo que haría executeInMainWorld: solo el texto de la función, sin su módulo. */
// eslint-disable-next-line no-new-func
const serialized = new Function(`return (${installWebAuthnGuard.toString()})`)() as Install

interface FakeOpts { resolveAfterMs?: number; ignoreAbort?: boolean }

/** Un CredentialsContainer como el de Electron: pendiente para siempre salvo con una señal (o `resolveAfterMs`). */
function fakeChromium(o: FakeOpts = {}) {
  let pending = false
  const calls: { kind: 'get' | 'create'; options?: GuardCredentialOptions }[] = []
  const call = (kind: 'get' | 'create') => function (this: unknown, options?: GuardCredentialOptions): Promise<unknown> {
    calls.push({ kind, options })
    if (!options?.publicKey) return Promise.resolve({ type: 'password' })
    const signal = options.signal as GuardAbortSignal | undefined
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (pending && options.mediation !== 'conditional') return Promise.reject(new DOMException('A request is already pending.', 'OperationError'))
    if (options.mediation !== 'conditional') pending = true
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        pending = false
        if (!o.ignoreAbort) reject(signal.reason)
      })
      if (o.resolveAfterMs != null) setTimeout(() => { pending = false; resolve({ id: 'cred' }) }, o.resolveAfterMs)
    })
  }
  class CredentialsContainer {}
  const proto = CredentialsContainer.prototype as unknown as { get: unknown; create: unknown }
  proto.get = call('get')
  proto.create = call('create')
  const credentials = new CredentialsContainer() as unknown as { get(o?: GuardCredentialOptions): Promise<unknown>; create(o?: GuardCredentialOptions): Promise<unknown> }
  const dataset: Record<string, string | undefined> = {}
  const PublicKeyCredential = {
    isConditionalMediationAvailable: () => Promise.resolve(true),
    getClientCapabilities: () => Promise.resolve({ hybridTransport: true, passkeyPlatformAuthenticator: true, conditionalGet: true, userVerifyingPlatformAuthenticator: false, relatedOrigins: true })
  }
  const g = {
    navigator: { credentials },
    CredentialsContainer,
    PublicKeyCredential,
    document: { documentElement: { dataset } },
    AbortController,
    AbortSignal,
    DOMException,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
  } as unknown as WebAuthnGuardGlobal
  return { g, credentials, calls, dataset, PublicKeyCredential, isPending: () => pending }
}

const pk = (extra: Record<string, unknown> = {}): GuardCredentialOptions => ({ publicKey: { challenge: new Uint8Array(8), ...extra } })

/** Estado de una promesa sin esperarla: 'pending' o lo que dio. */
function track(p: Promise<unknown>): { state: string; error?: { name?: string }; value?: unknown } {
  const t: { state: string; error?: { name?: string }; value?: unknown } = { state: 'pending' }
  p.then((v) => { t.state = 'resolved'; t.value = v }, (e: { name?: string }) => { t.state = 'rejected'; t.error = e })
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('guarda de WebAuthn (serializada)', () => {
  it('es autocontenida: funciona solo con su texto', () => {
    const f = fakeChromium()
    expect(serialized(f.g, { noNativeUI: true, capMs: 10_000 })).toBe(true)
  })

  it('una petición modal get() se corta al tope con NotAllowedError y la siguiente ya no queda «already pending»', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const first = track(f.credentials.get(pk()))
    expect(f.dataset.aulaPasskey).toBe('asked')
    await vi.advanceTimersByTimeAsync(9_900)
    expect(first.state).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(first.state).toBe('rejected')
    expect(first.error?.name).toBe('NotAllowedError')
    expect(f.dataset.aulaPasskey).toBe('failed')
    // la petición de verdad se canceló: un segundo intento no da «A request is already pending»
    expect(f.isPending()).toBe(false)
    const second = track(f.credentials.get(pk()))
    await vi.advanceTimersByTimeAsync(10_100)
    expect(second.error?.name).toBe('NotAllowedError')
  })

  it('create() modal también se corta', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: false, capMs: 120_000 })
    const p = track(f.credentials.create(pk()))
    await vi.advanceTimersByTimeAsync(119_000)
    expect(p.state).toBe('pending')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(p.error?.name).toBe('NotAllowedError')
    expect(f.dataset.aulaPasskey).toBe('failed')
  })

  it('el tope es el menor entre el timeout de la página y el propio; el de la página no dice «falló»', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: false, capMs: 120_000 })
    const p = track(f.credentials.get(pk({ timeout: 30_000 })))
    await vi.advanceTimersByTimeAsync(29_900)
    expect(p.state).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(p.error?.name).toBe('NotAllowedError')
    // se le acabó el tiempo de la página (como en Chrome): no es que las passkeys no funcionen aquí
    expect(f.dataset.aulaPasskey).toBe('asked')
    expect(f.isPending()).toBe(false)
  })

  it('un timeout de la página por debajo de 10 s se sube a 10 s, como hace Chromium (p. ej. «60» queriendo decir segundos)', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: false, capMs: 120_000 })
    const p = track(f.credentials.get(pk({ timeout: 60 })))
    await vi.advanceTimersByTimeAsync(9_900)
    expect(p.state).toBe('pending')
    await vi.advanceTimersByTimeAsync(200)
    expect(p.error?.name).toBe('NotAllowedError')
    expect(f.dataset.aulaPasskey).toBe('asked')
  })

  it('con el tope de Aula más corto que el de la página, sí dice «falló»', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const p = track(f.credentials.get(pk({ timeout: 600_000 })))
    await vi.advanceTimersByTimeAsync(10_050)
    expect(p.error?.name).toBe('NotAllowedError')
    expect(f.dataset.aulaPasskey).toBe('failed')
  })

  it('aunque la petición no haga caso a la cancelación, la página recibe NotAllowedError al tope', async () => {
    const f = fakeChromium({ ignoreAbort: true })
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const p = track(f.credentials.get(pk()))
    await vi.advanceTimersByTimeAsync(10_050)
    expect(p.error?.name).toBe('NotAllowedError')
  })

  it('la señal de la propia página sigue cancelando (AbortError, antes del tope)', async () => {
    const f = fakeChromium({ ignoreAbort: true })
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const ctl = new AbortController()
    const p = track(f.credentials.get({ ...pk(), signal: ctl.signal as unknown as GuardAbortSignal }))
    await vi.advanceTimersByTimeAsync(1000)
    ctl.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state).toBe('rejected')
    expect(p.error?.name).toBe('AbortError')
    // la marca no dice «falló»: la canceló la página (p. ej. «Otras formas de iniciar sesión»)
    expect(f.dataset.aulaPasskey).toBe('asked')
    // la señal que llegó a Chromium también quedó cancelada
    const sent = f.calls[0].options?.signal as GuardAbortSignal
    expect(sent.aborted).toBe(true)
  })

  it('una señal ya cancelada se rechaza como en Chromium', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const ctl = new AbortController()
    ctl.abort()
    await expect(f.credentials.get({ ...pk(), signal: ctl.signal as unknown as GuardAbortSignal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('una llave que contesta a tiempo funciona (y no queda ningún temporizador)', async () => {
    const f = fakeChromium({ resolveAfterMs: 3000 })
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const p = track(f.credentials.get(pk()))
    await vi.advanceTimersByTimeAsync(3_050)
    expect(p.state).toBe('resolved')
    expect(p.value).toEqual({ id: 'cred' })
    expect(vi.getTimerCount()).toBe(0)
    expect(f.dataset.aulaPasskey).toBe('asked')
  })

  it('las peticiones condicionales (autocompletar) no se tocan y la página puede cancelarlas', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const ctl = new AbortController()
    const opts = { ...pk(), mediation: 'conditional', signal: ctl.signal as unknown as GuardAbortSignal }
    const p = track(f.credentials.get(opts))
    // llega a Chromium tal cual: las mismas opciones, sin tope ni marca
    expect(f.calls[0].options).toBe(opts)
    expect(f.dataset.aulaPasskey).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(p.state).toBe('pending')
    ctl.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.error?.name).toBe('AbortError')
  })

  it('sin publicKey (contraseñas, federadas) pasa tal cual', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    const opts = { password: true } as unknown as GuardCredentialOptions
    await expect(f.credentials.get(opts)).resolves.toEqual({ type: 'password' })
    expect(f.calls[0].options).toBe(opts)
    expect(f.dataset.aulaPasskey).toBeUndefined()
  })

  it('con tope 0 (pestañas ocultas) se rechaza al momento sin llegar a Chromium', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: false, capMs: 0 })
    await expect(f.credentials.get(pk())).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(f.calls).toHaveLength(0)
    expect(f.dataset.aulaPasskey).toBe('failed')
  })

  it('sin interfaz de passkeys: sin autocompletar ni passkeys de plataforma o del móvil; lo demás se conserva', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: true, capMs: 10_000 })
    await expect(f.PublicKeyCredential.isConditionalMediationAvailable()).resolves.toBe(false)
    await expect(f.PublicKeyCredential.getClientCapabilities()).resolves.toEqual({
      hybridTransport: false, passkeyPlatformAuthenticator: false, conditionalGet: false, conditionalCreate: false,
      userVerifyingPlatformAuthenticator: false, relatedOrigins: true
    })
  })

  it('con interfaz de passkeys (Windows) las capacidades no cambian', async () => {
    const f = fakeChromium()
    serialized(f.g, { noNativeUI: false, capMs: 120_000 })
    await expect(f.PublicKeyCredential.isConditionalMediationAvailable()).resolves.toBe(true)
    await expect(f.PublicKeyCredential.getClientCapabilities()).resolves.toMatchObject({ hybridTransport: true, passkeyPlatformAuthenticator: true, conditionalGet: true })
  })

  it('sin CredentialsContainer no instala nada', () => {
    expect(serialized({ AbortController, DOMException, setTimeout, clearTimeout } as unknown as WebAuthnGuardGlobal, { noNativeUI: true, capMs: 10_000 })).toBe(false)
  })
})

describe('tope de la guarda', () => {
  it('120 s solo en la ventana de acceso de Windows (tiene interfaz de passkeys); 10 s en los demás; 0 en las pestañas ocultas', () => {
    expect(webAuthnCapMs('darwin', 'signin')).toBe(10_000)
    expect(webAuthnCapMs('win32', 'signin')).toBe(120_000)
    expect(webAuthnCapMs('linux', 'signin')).toBe(10_000)
    expect(webAuthnCapMs('darwin', 'reader')).toBe(0)
    expect(webAuthnCapMs('win32', 'reader')).toBe(0)
    // la ventana en vivo está oculta y se maneja desde el móvil: nadie ve el diálogo de Windows Hello
    expect(webAuthnCapMs('win32', 'live')).toBe(10_000)
    expect(webAuthnCapMs('darwin', 'live')).toBe(10_000)
  })

  it('interfaz de passkeys: solo Windows, y solo en la ventana que el estudiante ve', () => {
    expect(webAuthnNativeUI('win32', 'signin')).toBe(true)
    expect(webAuthnNativeUI('darwin', 'signin')).toBe(false)
    expect(webAuthnNativeUI('linux', 'signin')).toBe(false)
    expect(webAuthnNativeUI('win32', 'live')).toBe(false)
    expect(webAuthnNativeUI('win32', 'reader')).toBe(false)
  })
})
