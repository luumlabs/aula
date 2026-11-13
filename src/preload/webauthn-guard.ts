// Guarda de las llaves de acceso (WebAuthn) en las ventanas de plataformas. En Electron, una petición modal de
// `navigator.credentials.get/create` con `publicKey` puede quedarse pendiente para siempre (en macOS y en Linux no hay
// interfaz de passkeys; solo Windows tiene la suya) y la siguiente falla con «A request is already pending»: la página de
// Microsoft se queda esperando. Aquí se le pone un tope: al cumplirse se cancela de verdad y la página recibe NotAllowedError
// (lo mismo que si el estudiante cancelara en Chrome: Microsoft vuelve a su selector de métodos). Las peticiones
// condicionales (autocompletar) no se tocan.
//
// `installWebAuthnGuard` se SERIALIZA (contextBridge.executeInMainWorld): debe ser autocontenida, sin cierres, sin
// importaciones y sin ayudantes que el compilador pudiera añadir. Recibe el objeto global (null = el de la página) para
// poder probarla con uno falso.

/** Señal de cancelación (lo mínimo que se usa). */
export interface GuardAbortSignal {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', fn: () => void, opts?: { once?: boolean }): void
  removeEventListener(type: 'abort', fn: () => void): void
}

/** Opciones de `get`/`create` (solo lo que mira la guarda). */
export interface GuardCredentialOptions {
  publicKey?: { timeout?: number } & Record<string, unknown>
  mediation?: string
  signal?: GuardAbortSignal
  [key: string]: unknown
}

type CredentialCall = (this: unknown, options?: GuardCredentialOptions) => Promise<unknown>

export interface GuardCredentials {
  get: CredentialCall
  create?: CredentialCall
}

export interface GuardPublicKeyCredential {
  isConditionalMediationAvailable?: () => Promise<boolean>
  getClientCapabilities?: () => Promise<Record<string, boolean>>
}

/** Lo que la guarda usa del objeto global (`window` en la página; uno falso en las pruebas). */
export interface WebAuthnGuardGlobal {
  navigator?: { credentials?: GuardCredentials }
  CredentialsContainer?: { prototype: GuardCredentials }
  PublicKeyCredential?: GuardPublicKeyCredential
  document?: { documentElement?: { dataset?: Record<string, string | undefined> } | null }
  AbortController: new () => { signal: GuardAbortSignal; abort(reason?: unknown): void }
  AbortSignal?: { any?(signals: GuardAbortSignal[]): GuardAbortSignal }
  DOMException: new (message?: string, name?: string) => unknown
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface WebAuthnGuardOptions {
  /** Sin interfaz de passkeys (macOS, Linux, la ventana en vivo): además se dice que no hay passkeys de plataforma, ni del móvil, ni autocompletar. */
  noNativeUI: boolean
  /** Tope de una petición modal (ms). 0 = se rechaza al momento (pestañas ocultas: nadie puede usarla). */
  capMs: number
}

/** Dónde se instala: ventana de acceso, pestaña de lectura oculta o ventana «en vivo» (oculta, manejada desde el móvil). */
export type WebAuthnWindow = 'signin' | 'reader' | 'live'

/** ¿Hay interfaz de passkeys? Solo la de Windows (webauthn.dll), y solo en una ventana que el estudiante ve. */
export function webAuthnNativeUI(platform: string, where: WebAuthnWindow): boolean {
  return platform === 'win32' && where === 'signin'
}

/**
 * Tope de una petición modal: 120 s donde hay interfaz de passkeys (Windows Hello y llaves); 10 s en los demás (una llave
 * USB aún puede ir); 0 en las pestañas ocultas.
 */
export function webAuthnCapMs(platform: string, where: WebAuthnWindow): number {
  if (where === 'reader') return 0
  return webAuthnNativeUI(platform, where) ? 120_000 : 10_000
}

/**
 * Instala la guarda. Marca `document.documentElement.dataset.aulaPasskey`: 'asked' al empezar una petición modal y
 * 'failed' cuando la corta el tope (la ventana de acceso lo lee para avisar). true si se instaló.
 */
export function installWebAuthnGuard(g: WebAuthnGuardGlobal | null, opts: WebAuthnGuardOptions): boolean {
  const G = (g || globalThis) as unknown as WebAuthnGuardGlobal
  const target = (G.CredentialsContainer && G.CredentialsContainer.prototype) || (G.navigator && G.navigator.credentials)
  if (!target || typeof target.get !== 'function') return false
  const setT = G.setTimeout
  const clearT = G.clearTimeout
  const AC = G.AbortController
  const AS = G.AbortSignal
  const DE = G.DOMException
  const cap = Math.max(0, Number(opts && opts.capMs) || 0)

  const mark = function (value: string): void {
    try {
      const root = G.document && G.document.documentElement
      if (root && root.dataset) root.dataset.aulaPasskey = value
    } catch {
      // sin documento: nada que marcar
    }
  }
  const notAllowed = function (): unknown {
    return new DE('The operation either timed out or was not allowed.', 'NotAllowedError')
  }
  const reasonOf = function (signal: GuardAbortSignal): unknown {
    return signal.reason !== undefined ? signal.reason : new DE('signal is aborted without reason', 'AbortError')
  }

  // una petición modal con tope: la señal de la página sigue valiendo (AbortSignal.any) y la nuestra corta al tope
  const capped = function (orig: CredentialCall, self: unknown, options: GuardCredentialOptions): Promise<unknown> {
    mark('asked')
    const page = options.signal
    if (cap <= 0) {
      mark('failed')
      return Promise.reject(notAllowed())
    }
    // el timeout de la página, con el mínimo de Chromium (10 s: un «60» que quería decir segundos no corta a los 60 ms)
    const pageTimeout = options.publicKey ? Number(options.publicKey.timeout) : NaN
    const pageMs = pageTimeout > 0 ? Math.max(pageTimeout, 10000) : Infinity
    const ms = Math.min(pageMs, cap)
    // solo el tope de Aula dice «falló» (y el aviso de la ventana); el de la página es lo de siempre
    const ours = ms >= cap
    if (page && page.aborted) return orig.call(self, options)
    const ctl = new AC()
    let signal = ctl.signal
    if (page) {
      if (AS && typeof AS.any === 'function') signal = AS.any([page, ctl.signal])
      else page.addEventListener('abort', function () { ctl.abort(reasonOf(page)) }, { once: true })
    }
    const copy: GuardCredentialOptions = Object.assign({}, options, { signal })
    return new Promise(function (resolve, reject) {
      let done = false
      let timer: unknown = null
      const onPageAbort = function (): void {
        if (page) settle(reject, reasonOf(page))
      }
      const settle = function (fn: (v: unknown) => void, value: unknown): void {
        if (done) return
        done = true
        clearT.call(G, timer)
        if (page) page.removeEventListener('abort', onPageAbort)
        fn(value)
      }
      timer = setT.call(G, function () {
        if (done) return
        if (ours) mark('failed')
        settle(reject, notAllowed())
        try {
          ctl.abort(notAllowed())
        } catch {
          // ya cancelada
        }
      }, ms)
      if (page) page.addEventListener('abort', onPageAbort)
      let pending: Promise<unknown>
      try {
        pending = Promise.resolve(orig.call(self, copy))
      } catch (err) {
        settle(reject, err)
        return
      }
      pending.then(function (v) { settle(resolve, v) }, function (e) { settle(reject, e) })
    })
  }

  const wrap = function (orig: CredentialCall): CredentialCall {
    return function (this: unknown, options?: GuardCredentialOptions): Promise<unknown> {
      // solo las peticiones modales de llaves de acceso; contraseñas, federadas y las condicionales, tal cual
      if (!options || typeof options !== 'object' || !options.publicKey || options.mediation === 'conditional') {
        return orig.apply(this, Array.prototype.slice.call(arguments) as [GuardCredentialOptions?])
      }
      return capped(orig, this, options)
    }
  }

  try {
    const origGet = target.get
    const origCreate = target.create
    target.get = wrap(origGet)
    if (typeof origCreate === 'function') target.create = wrap(origCreate)
  } catch {
    return false
  }

  const PKC = G.PublicKeyCredential
  if (opts && opts.noNativeUI && PKC) {
    const define = function (name: string, fn: () => Promise<unknown>): void {
      try {
        Object.defineProperty(PKC, name, { value: fn, configurable: true, writable: true })
      } catch {
        // propiedad fija: se queda como estaba
      }
    }
    if (typeof PKC.isConditionalMediationAvailable === 'function') {
      define('isConditionalMediationAvailable', function () { return Promise.resolve(false) })
    }
    const caps = PKC.getClientCapabilities
    if (typeof caps === 'function') {
      define('getClientCapabilities', function () {
        return Promise.resolve(caps.call(PKC)).then(function (c) {
          const out: Record<string, boolean> = {}
          if (c && typeof c === 'object') for (const k of Object.keys(c)) out[k] = c[k]
          out.passkeyPlatformAuthenticator = false
          out.hybridTransport = false
          out.conditionalGet = false
          out.conditionalCreate = false
          return out
        })
      })
    }
  }
  return true
}
