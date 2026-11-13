// Orquesta las cuentas de plataformas para que el estudiante inicie sesión UNA vez y siga dentro: repone las cookies al arrancar,
// comprueba y mantiene viva la sesión en segundo plano, guarda copias cifradas de las cookies, detecta cuándo se cerró
// (needsSignIn) e intenta antes volver a entrar sola por el SSO (sin escribir nada), abre la ventana de acceso cuando hace
// falta y ofrece `fetchWithSession` con guardas. Sin Electron: el navegador real llega por `PlatformBrowserAdapter`.
import { EventEmitter } from 'node:events'
import type { PlatformAccount, PlatformKind } from '@shared/settings/platforms'
import type { PlatformAccountView, PlatformCourse, PlatformStatus } from '@shared/platforms/types'
import {
  confidenceAtLeast, detectPlatform, downgradesToHttp, hostOf, isAccountLoginURL, isAccountSite, isIdentityHost, moodleRootFromWwwroot,
  normalizeBrowserURL, normalizePlatformURL, originOf, parsePlatformKind, platformInfo, platformRoot, sameRegistrableSite, snapshotDue,
  type KeepAliveOptions
} from '@engine/platforms'
import { onSettingsChange } from '../settings'
import { AulaError, invalidArgs } from '../errors'
import { log } from '../log'
import { pick, tr } from '@shared/ai/i18n'
import { CanvasClient, CanvasError, canvasClientFor, connectCanvasCalendar } from '../canvas'
import {
  addAccount, canvasToken, changeAccountBaseURL, getAccount, listAccounts, platformSettings, removeAccount, requireAccount, setCanvasToken, updateAccount
} from './accounts'
import { ApprovalBroker } from './approvals'
import { platformCalendarURL, savePlatformCalendarURL } from './calendar'
import { clearCookieSnapshot } from './cookie-store'
import { canvasCoursesToPlatform, moodleCoursesToPlatform, sortPlatformCourses } from './courses'
import { createNodeHttpFetch, type HttpFetch, type HttpRequestInit, type HttpResponse } from './http'
import { KeepAliveScheduler, type CheckVerdict } from './keepalive'
import { MoodleClient, moodleStepPendingText } from './moodle'
import { probePlatform, type PlatformProbeOutcome } from './probe'
import { checkSession, rememberMoodleSesskey, type SessionCheckResult } from './session-check'
import { accountView, effectiveStatus, platformStatus, statusDetail } from './status'

/** Cómo terminó la ventana de inicio de sesión (lo produce la ventana; contrato con src/main/electron/browser/signin.ts). */
export interface SignInResult {
  signedIn: boolean
  /** Se cerró con un paso de Moodle a la vista (política, perfil) sin terminar. */
  pendingStep?: boolean
  /** Raíz del Moodle en otro host del mismo sitio que la ventana adoptó (`https://host[/carpeta]`, sin barra final). */
  adoptedRoot?: string
}

/** Una ventana de inicio de sesión abierta. */
export interface SignInSession {
  promise: Promise<SignInResult>
  focus(): void
  cancel(): void
  /** Vuelve a mirar ya (con `force`, el estudiante dice que ya entró: se comprueba con la sesión). true = sesión iniciada. */
  recheck?(force?: boolean): Promise<boolean>
}

/** Lo que el controlador necesita del navegador (Electron en la app; uno falso en las pruebas). */
export interface PlatformBrowserAdapter {
  /** `fetch` con las cookies de la sesión de la cuenta (sin restricciones: solo para los clientes internos). */
  sessionFetch(accountId: string): HttpFetch
  snapshotCookies(account: PlatformAccount): Promise<boolean>
  restoreCookies(account: PlatformAccount): Promise<number>
  /** Borra cookies, almacenamiento y caché de la partición de la cuenta. */
  clearSession(accountId: string): Promise<void>
  openSignIn(account: PlatformAccount, hooks: { verify(): Promise<SessionCheckResult['state']>; onSuccess(): Promise<void> }): SignInSession
  /**
   * Abre la plataforma en una pestaña oculta y deja que el inicio de sesión único vuelva solo (SAML/OIDC con la sesión del
   * proveedor aún viva). Nunca escribe ni pulsa nada. true si acabó en una página interna.
   */
  silentSignIn?(account: PlatformAccount): Promise<boolean>
  /** Corta la vuelta sola por el SSO en marcha (al abrir la ventana de acceso: no comparten la sesión a la vez). */
  cancelSilentSignIn?(accountId: string): void
  /** Cierra las pestañas de lectura de la cuenta (al cerrar sesión o quitarla). */
  closeAccountTabs?(accountId: string): void
}

export interface PlatformControllerOptions {
  now?: () => number
  broker?: ApprovalBroker
  probe?: (url: string) => Promise<PlatformProbeOutcome>
  /** `fetch` sin cookies (modo token de Canvas). */
  nodeFetch?: HttpFetch
  /** Cada cuánto se mira si toca guardar las cookies (ms; por defecto 60 s). */
  snapshotTickMs?: number
  /** Entre dos intentos de volver a entrar sola por el SSO (ms; por defecto 60 min). */
  silentRetryMs?: number
  /** Espera antes de confirmar una sospecha de sesión cerrada (ms; por defecto 3 s). */
  confirmDelayMs?: number
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (h: unknown) => void
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (h: unknown) => void
  /** Planificador propio (pruebas). */
  scheduler?: (deps: ConstructorParameters<typeof KeepAliveScheduler>[0]) => KeepAliveScheduler
}

type Events = { status: [PlatformAccountView]; signedIn: [PlatformAccountView] }

/** Métodos que acepta `fetchWithSession` (para las herramientas de la IA: solo lectura). */
const READ_METHODS = new Set(['GET', 'HEAD'])

export class PlatformController {
  readonly approvals: ApprovalBroker
  private readonly events = new EventEmitter()
  private readonly scheduler: KeepAliveScheduler
  private readonly now: () => number
  private readonly signIns = new Map<string, { session: SignInSession; promise: Promise<{ signedIn: boolean; account: PlatformAccountView }> }>()
  private readonly inflight = new Map<string, Promise<CheckVerdict>>()
  private readonly lastSnapshot = new Map<string, number>()
  private readonly dirty = new Set<string>()
  private readonly lastSilent = new Map<string, number>()
  private readonly checkedAt = new Map<string, number>()
  private readonly persistedCheckAt = new Map<string, number>()
  private readonly confirmTimers = new Map<string, unknown>()
  private readonly lastConfirm = new Map<string, number>()
  /** Cuentas cuya sesión cerró el estudiante: no se vuelve a entrar sola hasta que inicie sesión otra vez. */
  private readonly signedOutByUser = new Set<string>()
  /** Comprobación en marcha de cada cuenta (se corta al abrir la ventana de acceso). */
  private readonly checkAborts = new Map<string, AbortController>()
  /** Cuentas de Moodle con un paso pendiente tras el acceso (política, perfil). Solo en memoria. */
  private readonly pendingSteps = new Set<string>()
  /** Última comprobación de página por una lectura AJAX que funcionó con un paso pendiente (una por minuto como mucho). */
  private readonly lastStepCheck = new Map<string, number>()
  private snapshotTimer: unknown = null
  private unsubscribeSettings: (() => void) | null = null
  private started = false

  constructor(private readonly adapter: PlatformBrowserAdapter, private readonly opts: PlatformControllerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.approvals = opts.broker ?? new ApprovalBroker()
    const deps = {
      accounts: () => listAccounts(),
      check: (a: PlatformAccount) => this.runCheck(a),
      isSigningIn: (id: string) => this.signIns.has(id),
      options: () => this.keepAliveOptions(),
      now: this.now
    }
    this.scheduler = opts.scheduler ? opts.scheduler(deps) : new KeepAliveScheduler(deps)
  }

  on<E extends keyof Events>(event: E, fn: (...args: Events[E]) => void): () => void {
    this.events.on(event, fn as (...a: unknown[]) => void)
    return () => this.events.off(event, fn as (...a: unknown[]) => void)
  }

  private keepAliveOptions(): KeepAliveOptions {
    const s = platformSettings()
    return { enabled: s.keepSignedIn !== false, intervalMinutes: s.keepAliveMinutes }
  }

  // MARK: Ciclo de vida

  /** Al arrancar: repone las cookies de todas las cuentas ANTES de cualquier petición y empieza a mantener las sesiones. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const a of listAccounts()) {
      try {
        await this.adapter.restoreCookies(a)
      } catch (err) {
        log.warn(`[platforms] no se pudieron reponer las cookies (${a.id}):`, err instanceof Error ? err.message : String(err))
      }
    }
    if (this.keepAliveOptions().enabled) this.scheduler.start()
    const every = this.opts.snapshotTickMs ?? 60_000
    const setI = this.opts.setInterval ?? ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms)
      t.unref?.()
      return t
    })
    this.snapshotTimer = setI(() => void this.snapshotIfDue(), every)
    this.unsubscribeSettings = onSettingsChange((s, prev) => {
      const on = s.platforms.keepSignedIn !== false
      const was = prev.platforms.keepSignedIn !== false
      if (on && !was) this.scheduler.start()
      else if (!on && was) this.scheduler.stop()
      else if (s.platforms.keepAliveMinutes !== prev.platforms.keepAliveMinutes) this.scheduler.tick()
    })
  }

  /** Al salir: copia final de las cookies (con tope de tiempo) y fuera temporizadores y permisos pendientes. */
  async shutdown(timeoutMs = 3000): Promise<void> {
    this.scheduler.stop()
    if (this.snapshotTimer != null) (this.opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(this.snapshotTimer)
    this.snapshotTimer = null
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = null
    for (const t of this.confirmTimers.values()) (this.opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(t)
    this.confirmTimers.clear()
    this.approvals.cancelAll()
    await Promise.race([this.snapshotAll(), new Promise<void>((r) => setTimeout(r, timeoutMs).unref?.())])
    this.started = false
  }

  /** Tras la suspensión o al recuperar la red. */
  resume(): void {
    this.scheduler.resume()
  }

  // MARK: Cuentas

  list(): PlatformAccountView[] {
    return listAccounts().map(accountView)
  }

  view(accountId: string): PlatformAccountView {
    return accountView(requireAccount(accountId))
  }

  account(accountId: string): PlatformAccount {
    return requireAccount(accountId)
  }

  probe(url: string): Promise<PlatformProbeOutcome> {
    return (this.opts.probe ?? ((u: string) => probePlatform(u)))(url)
  }

  /**
   * Alta de una cuenta por su dirección. Sin tipo, se mira la dirección y, si no es segura, se sondea la página sin sesión (sin
   * cookies). Si la página redirige a la plataforma real (p. ej. «uni.edu» → «uni.instructure.com»), se usa esa. Moodle se
   * guarda por su raíz (la de `wwwroot` si el sondeo la trae; https si el sondeo acabó ahí), nunca por la página de acceso.
   */
  async add(input: { url: string; kind?: PlatformKind; label?: string }): Promise<PlatformAccountView> {
    const url = normalizePlatformURL(input?.url ?? '')
    if (!url) throw invalidArgs(
      tr('La dirección no es válida. Escribe algo como campus.tuuniversidad.edu', 'That address isn’t valid. Type something like campus.youruniversity.edu')
    )
    const sameSite = (u: string): PlatformAccount | undefined => listAccounts().find((a) => originOf(a.baseURL) === originOf(u))
    const typed = sameSite(url)
    // ya existe y no se pide cambiar nada: se devuelve tal cual (sin sondear)
    if (typed && !input.kind && !input.label?.trim()) return accountView(typed)
    let kind = input.kind
    let baseURL = url
    let probe: PlatformProbeOutcome | null = null
    let probed = false
    if (!kind) {
      const byURL = detectPlatform({ url })
      if (byURL?.confidence === 'high') kind = byURL.kind
      else {
        const p = await this.probe(url).catch(() => null)
        probe = p
        probed = true
        // el sondeo (HTML de la página pública) manda si es al menos probable o si la dirección no decía nada
        kind = p?.kind && (confidenceAtLeast(p.confidence, 'medium') || !byURL) ? p.kind : byURL?.kind ?? p?.kind ?? undefined
        const finalHost = p?.finalURL ? hostOf(p.finalURL) : null
        // redirigió a la plataforma de verdad (otro host que no es el del SSO): esa es la dirección de la cuenta
        if (kind && p?.finalURL && finalHost && finalHost !== hostOf(url) && !isIdentityHost(finalHost) && detectPlatform({ url: p.finalURL })?.kind === kind) {
          baseURL = normalizePlatformURL(platformRoot(kind, p.finalURL)) ?? url
        }
      }
    }
    if (kind === 'moodle') {
      // sin sondeo previo (la dirección ya decía Moodle): se sondea para saber su raíz y si va por https
      if (!probed) probe = await this.probe(url).catch(() => null)
      baseURL = moodleAccountURL(baseURL, probe)
    }
    const k = kind ?? 'other'
    const host = (hostOf(baseURL) ?? '').replace(/^www\./, '')
    const label = input.label?.trim() || (k === 'other' ? host : `${platformInfo(k).displayName} · ${host}`)
    // la cuenta que ya existe (la de la dirección pegada o la de su raíz) se actualiza, nunca se duplica
    const existing = typed ?? sameSite(baseURL)
    const account = existing ? this.updateExisting(existing, baseURL, input) : addAccount({ url: baseURL, kind: k, label })
    this.emitStatus(account.id)
    return accountView(account)
  }

  /**
   * Alta de una cuenta que ya existe: conserva su nombre (salvo que se pida otro) y su id; si su origen cambió (https, el
   * `wwwroot` de Moodle, la plataforma real tras una redirección), se mueve allí. Nunca de https a http.
   */
  private updateExisting(existing: PlatformAccount, baseURL: string, input: { kind?: PlatformKind; label?: string }): PlatformAccount {
    const patch: Partial<PlatformAccount> = {}
    if (input.kind) patch.kind = parsePlatformKind(input.kind)
    if (input.label?.trim()) patch.label = input.label.trim().slice(0, 120)
    let a = Object.keys(patch).length ? updateAccount(existing.id, patch) : existing
    if (originOf(baseURL) === originOf(a.baseURL) || downgradesToHttp(a.baseURL, baseURL)) return a
    try {
      a = changeAccountBaseURL(a.id, baseURL)
      log.info(`[platforms] ${a.id}: la cuenta pasa de ${originOf(existing.baseURL) ?? '?'} a ${originOf(baseURL) ?? '?'} (se volvió a añadir)`)
    } catch (err) {
      log.warn(`[platforms] ${a.id}: no se pudo cambiar la dirección:`, err instanceof Error ? err.message : String(err))
    }
    return a
  }

  update(accountId: string, patch: { label?: string; notes?: string }): PlatformAccountView {
    requireAccount(accountId)
    const p: Partial<PlatformAccount> = {}
    if (typeof patch?.label === 'string') p.label = patch.label.trim().slice(0, 120)
    if (typeof patch?.notes === 'string') p.notes = patch.notes.trim().slice(0, 2000) || undefined
    const a = updateAccount(accountId, p)
    this.emitStatus(a.id)
    return accountView(a)
  }

  /** Modo token de Canvas (opcional): con token se usa la API sin la sesión; null lo quita. */
  setCanvasToken(accountId: string, token: string | null): PlatformAccountView {
    const a = requireAccount(accountId)
    if (a.kind !== 'canvas') throw invalidArgs(tr('El token solo sirve para Canvas.', 'The token only works with Canvas.'))
    const updated = setCanvasToken(accountId, token)
    this.checkedAt.delete(accountId)
    this.emitStatus(updated.id)
    return accountView(updated)
  }

  // MARK: Estado

  private emitStatus(accountId: string): void {
    const a = getAccount(accountId)
    if (a) this.events.emit('status', accountView(a))
  }

  /** Cambia el estado visible (y el guardado, si cambia a iniciada o cerrada) y avisa a la interfaz. */
  private setStatus(account: PlatformAccount, status: PlatformStatus, detail?: string): void {
    const prev = effectiveStatus(account)
    platformStatus.set(account.id, { status, detail })
    const now = this.now()
    if (status === 'signedIn' || status === 'needsSignIn') {
      this.checkedAt.set(account.id, now)
      const changed = account.lastState !== status
      const stale = now - (this.persistedCheckAt.get(account.id) ?? 0) >= 30 * 60_000
      if (changed || stale) {
        this.persistedCheckAt.set(account.id, now)
        try {
          updateAccount(account.id, { lastState: status, lastCheckedAt: new Date(now).toISOString() })
        } catch { /* la cuenta ya no existe */ }
      }
      if (changed || prev.status !== status) log.info(`[platforms] ${account.id}: ${status}`)
    }
    if (prev.status !== status || prev.detail !== detail || status === 'signedIn' || status === 'needsSignIn') this.emitStatus(account.id)
  }

  /** La sesión se cerró (confirmado): se avisa y se deja de comprobar hasta que el estudiante vuelva a entrar. */
  markNeedsSignIn(accountId: string, detail = statusDetail('needsSignIn')): void {
    const a = getAccount(accountId)
    if (!a || this.signIns.has(accountId)) return
    this.setStatus(a, 'needsSignIn', detail)
    this.scheduler.markChecked(accountId, 'needsSignIn')
  }

  // MARK: Paso pendiente (Moodle: política del sitio, perfil por completar)

  /** ¿Moodle pide a esta cuenta un paso tras el acceso que aún no se ha hecho? */
  hasPendingStep(accountId: string): boolean {
    return this.pendingSteps.has(accountId)
  }

  /**
   * Moodle pide un paso tras el acceso: se apunta y, sin ventana abierta, se muestra como «hay que iniciar sesión» con su texto
   * (el botón abre la ventana, y el estudiante lo termina allí). No se comprueba sola hasta entonces.
   */
  notePendingStep(accountId: string): void {
    const a = getAccount(accountId)
    if (!a || a.kind !== 'moodle') return
    this.flagPendingStep(a.id)
    this.showPendingStep(a)
  }

  private flagPendingStep(accountId: string): void {
    if (this.pendingSteps.has(accountId)) return
    this.pendingSteps.add(accountId)
    log.info(`[platforms] ${accountId}: Moodle pide un paso tras el acceso (política o perfil)`)
  }

  private showPendingStep(a: PlatformAccount): void {
    if (!this.pendingSteps.has(a.id) || this.signIns.has(a.id)) return
    this.setStatus(a, 'needsSignIn', moodleStepPendingText())
    this.scheduler.markChecked(a.id, 'needsSignIn')
  }

  /** Lo quita una comprobación de página sin paso (iniciada) o una lectura AJAX que funcione. */
  private clearPendingStep(accountId: string): void {
    if (this.pendingSteps.delete(accountId)) log.info(`[platforms] ${accountId}: el paso de Moodle ya está hecho`)
  }

  /**
   * Una lectura AJAX funcionó con un paso pendiente. No basta para quitarlo: por AJAX Moodle solo mira el perfil a medias
   * por encima (las páginas piden los campos obligatorios). Lo decide una comprobación de página (como mucho una por minuto),
   * que solo quita la marca si la página no lleva al paso.
   */
  private ajaxWorked(accountId: string): void {
    if (!this.pendingSteps.has(accountId) || this.signIns.has(accountId)) return
    const now = this.now()
    if (now - (this.lastStepCheck.get(accountId) ?? -Infinity) < 60_000) return
    this.lastStepCheck.set(accountId, now)
    const a = getAccount(accountId)
    if (!a) return
    void this.runCheck(a).then(
      (v) => this.scheduler.markChecked(a.id, v === 'signedIn' ? 'signedIn' : v === 'signedOut' ? 'needsSignIn' : effectiveStatus(getAccount(a.id) ?? a).status),
      () => undefined
    )
  }

  /** Una respuesta sugiere que la sesión se cerró (401, redirección al acceso): se confirma en unos segundos con la comprobación. */
  suspectSignedOut(accountId: string): void {
    if (this.confirmTimers.has(accountId) || this.signIns.has(accountId)) return
    const now = this.now()
    if (now - (this.lastConfirm.get(accountId) ?? 0) < 60_000) return
    this.lastConfirm.set(accountId, now)
    const setT = this.opts.setTimeout ?? ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    })
    this.confirmTimers.set(accountId, setT(() => {
      this.confirmTimers.delete(accountId)
      const a = getAccount(accountId)
      if (a) void this.runCheck(a).then((v) => this.scheduler.markChecked(accountId, v === 'signedOut' ? 'needsSignIn' : effectiveStatus(a).status))
    }, this.opts.confirmDelayMs ?? 3000))
  }

  /** Comprobación con la sesión (la que usan el planificador, la ventana de acceso y `check`). Una a la vez por cuenta. */
  runCheck(account: PlatformAccount): Promise<CheckVerdict> {
    const running = this.inflight.get(account.id)
    if (running) return running
    const p = this.doCheck(account).finally(() => this.inflight.delete(account.id))
    this.inflight.set(account.id, p)
    return p
  }

  private async verify(account: PlatformAccount, signal?: AbortSignal): Promise<SessionCheckResult> {
    const token = account.kind === 'canvas' ? canvasToken(account) : null
    if (token) {
      try {
        await new CanvasClient({ baseURL: account.baseURL, fetch: this.opts.nodeFetch ?? createNodeHttpFetch(), token, maxRetries: 1 }).profile()
        return { state: 'signedIn', reason: 'Canvas token' }
      } catch (err) {
        if (err instanceof CanvasError && err.code === 'canvas_token_invalid') return { state: 'signedOut', reason: 'Canvas token rejected' }
        return { state: 'unknown', reason: err instanceof AulaError ? err.code : 'error' }
      }
    }
    // con un paso pendiente, el toque AJAX diría «iniciada» igual: se mira la página
    const skipTouch = this.pendingSteps.has(account.id)
    const r = await checkSession(account, this.adapter.sessionFetch(account.id), { signal, skipTouch })
    if (r.pendingStep) this.flagPendingStep(account.id)
    else if (skipTouch && r.state === 'signedIn') this.clearPendingStep(account.id)
    if (r.state === 'signedIn') this.upgradeMoodleToHttps(account.id, r.checkedURL)
    return r
  }

  /**
   * Una cuenta de Moodle guardada con http:// cuya página de comprobación acabó en https en el mismo host pasa a https (una
   * vez): así el toque AJAX y los clientes van directos por https y la sesskey no viaja sin cifrar.
   */
  private upgradeMoodleToHttps(accountId: string, checkedURL: string | undefined): void {
    const a = getAccount(accountId)
    if (!a || a.kind !== 'moodle' || !checkedURL) return
    const root = platformRoot('moodle', a.baseURL)
    if (!upgradesToHttps(root, checkedURL)) return
    const next = normalizePlatformURL(httpsRoot(root, checkedURL) + '/')
    if (!next) return
    try {
      changeAccountBaseURL(a.id, next)
      log.info(`[platforms] ${a.id}: Moodle responde por https: la cuenta pasa de ${originOf(a.baseURL) ?? '?'} a ${originOf(next) ?? '?'}`)
    } catch (err) {
      log.warn(`[platforms] ${a.id}: no se pudo pasar a https:`, err instanceof Error ? err.message : String(err))
    }
  }

  private async doCheck(account: PlatformAccount): Promise<CheckVerdict> {
    if (this.signIns.has(account.id)) return 'unknown'
    const abort = new AbortController()
    this.checkAborts.set(account.id, abort)
    try {
      return await this.checkAndApply(account, abort.signal)
    } finally {
      if (this.checkAborts.get(account.id) === abort) this.checkAborts.delete(account.id)
    }
  }

  /** Comprueba y aplica el veredicto. Si entretanto se abrió la ventana de acceso, no toca nada (ni vuelve sola por el SSO). */
  private async checkAndApply(account: PlatformAccount, signal: AbortSignal): Promise<CheckVerdict> {
    let result = await this.verify(account, signal)
    if (this.signIns.has(account.id)) return this.leaveToWindow(account)
    if (result.state === 'signedOut' && this.adapter.silentSignIn && !canvasToken(account) && !this.signedOutByUser.has(account.id)) {
      const now = this.now()
      if (now - (this.lastSilent.get(account.id) ?? -Infinity) >= (this.opts.silentRetryMs ?? 60 * 60_000)) {
        this.lastSilent.set(account.id, now)
        const ok = await this.adapter.silentSignIn(account).catch(() => false)
        if (this.signIns.has(account.id)) return this.leaveToWindow(account)
        if (ok) {
          const again = await this.verify(account, signal)
          // también si Moodle, tras entrar, pide un paso (política, perfil): se explica eso, no «inicia sesión»
          if (again.state === 'signedIn' || again.pendingStep) {
            if (again.state === 'signedIn') log.info(`[platforms] ${account.id}: sesión recuperada sola por el SSO`)
            result = again
          }
        }
      }
    }
    if (this.signIns.has(account.id)) return this.leaveToWindow(account)
    const fresh = getAccount(account.id) ?? account
    if (result.pendingStep) {
      this.notePendingStep(fresh.id)
      return 'unknown'
    }
    if (result.state === 'signedIn') {
      this.setStatus(fresh, 'signedIn')
      if (snapshotDue(this.lastSnapshot.get(account.id) ?? null, this.now(), this.dirty.has(account.id))) await this.snapshot(fresh)
      return 'signedIn'
    }
    if (result.state === 'signedOut') {
      log.info(`[platforms] ${account.id}: sesión cerrada (${result.reason})`)
      this.setStatus(fresh, 'needsSignIn', canvasToken(fresh) ? tr('Canvas rechazó el token de acceso.', 'Canvas rejected the access token.') : statusDetail('needsSignIn'))
      return 'signedOut'
    }
    // sin respuesta clara (red, 5xx…): nunca se marca «cerrada»
    this.settleChecking(fresh)
    return 'unknown'
  }

  /** La ventana de acceso manda: sin cambiar el estado (solo se quita el «Comprobando…» que puso esta comprobación). */
  private leaveToWindow(account: PlatformAccount): CheckVerdict {
    this.settleChecking(getAccount(account.id) ?? account)
    return 'unknown'
  }

  /** Si se estaba mostrando «comprobando», vuelve al último estado conocido (con el texto del paso pendiente, si lo hay). */
  private settleChecking(account: PlatformAccount): void {
    const rt = effectiveStatus(account)
    if (rt.status !== 'checking') return
    const status = account.lastState === 'signedIn' ? 'signedIn' : account.lastState === 'needsSignIn' ? 'needsSignIn' : 'unknown'
    const detail = status === 'needsSignIn' && this.pendingSteps.has(account.id) ? moodleStepPendingText() : undefined
    platformStatus.set(account.id, { status, detail })
    this.emitStatus(account.id)
  }

  /** Comprobación pedida por la interfaz o por una herramienta. */
  async check(accountId: string): Promise<PlatformAccountView> {
    const a = requireAccount(accountId)
    const open = this.signIns.get(a.id)
    if (open) {
      // con la ventana de acceso abierta, la comprueba ella (y si ya entró, se cierra sola)
      if (await open.session.recheck?.(false).catch(() => false)) await open.promise.catch(() => undefined)
      return this.view(a.id)
    }
    const rt = effectiveStatus(a)
    if (rt.status !== 'signedIn') this.setStatus(a, 'checking', statusDetail('checking'))
    const v = await this.runCheck(a)
    this.scheduler.markChecked(a.id, v === 'signedIn' ? 'signedIn' : v === 'signedOut' ? 'needsSignIn' : effectiveStatus(a).status)
    return this.view(a.id)
  }

  // MARK: Inicio de sesión

  isSigningIn(accountId: string): boolean {
    return this.signIns.has(accountId)
  }

  /** Abre la ventana de acceso (o la trae al frente si ya está abierta) y espera a que se inicie sesión o se cierre. */
  signIn(accountId: string): Promise<{ signedIn: boolean; account: PlatformAccountView }> {
    const account = requireAccount(accountId)
    const open = this.signIns.get(account.id)
    if (open) {
      open.session.focus()
      return open.promise
    }
    // una comprobación de fondo o una vuelta sola por el SSO en marcha no deben pisar la ventana (misma sesión)
    this.abortCheck(account.id)
    this.adapter.cancelSilentSignIn?.(account.id)
    platformStatus.set(account.id, { ...effectiveStatus(account), signingIn: true })
    this.emitStatus(account.id)
    const session = this.adapter.openSignIn(account, {
      verify: async () => {
        const r = await this.verify(getAccount(account.id) ?? account)
        log.debug(`[platforms] comprobación desde la ventana de acceso (${account.id}): ${r.state} · ${r.reason}`)
        return r.state
      },
      onSuccess: async () => {
        await this.snapshot(account)
      }
    })
    const promise = session.promise.then(
      async (result) => {
        this.signIns.delete(account.id)
        platformStatus.set(account.id, { ...effectiveStatus(getAccount(account.id) ?? account), signingIn: false })
        const signedIn = await this.afterSignInWindow(account.id, result)
        return { signedIn, account: this.view(account.id) }
      },
      (err: unknown) => {
        this.signIns.delete(account.id)
        platformStatus.set(account.id, { signingIn: false })
        this.emitStatus(account.id)
        throw err
      }
    )
    this.signIns.set(account.id, { session, promise })
    return promise
  }

  /** Corta la comprobación de fondo en marcha de la cuenta (si la hay). */
  private abortCheck(accountId: string): void {
    const abort = this.checkAborts.get(accountId)
    if (!abort) return
    this.checkAborts.delete(accountId)
    abort.abort()
  }

  /** La ventana se cerró: dirección adoptada, paso pendiente o sesión iniciada. true = iniciada y sin paso pendiente. */
  private async afterSignInWindow(accountId: string, result: SignInResult): Promise<boolean> {
    if (result.adoptedRoot) this.adoptMoodleRoot(accountId, result.adoptedRoot)
    if (result.pendingStep) this.flagPendingStep(accountId)
    // la ventana la dio por iniciada por la página, pero la marca sigue: su última comprobación vio el paso (o no lo quitó).
    // Se mira la página una vez más: solo una sin paso la quita
    if (result.signedIn && !result.pendingStep && this.pendingSteps.has(accountId)) {
      const a = getAccount(accountId)
      if (a) await this.verify(a).catch(() => undefined)
    }
    if (result.signedIn && !result.pendingStep && !this.pendingSteps.has(accountId)) {
      await this.markSignedIn(accountId)
      return true
    }
    const a = getAccount(accountId)
    if (a && this.pendingSteps.has(a.id)) this.showPendingStep(a)
    else this.emitStatus(accountId)
    return false
  }

  /**
   * La ventana encontró el Moodle de la cuenta en otro host del mismo sitio (la dirección guardada era un alias o un portal):
   * desde ahora la cuenta usa esa raíz. Solo Moodle, solo el mismo sitio registrable y nunca un host de identidad.
   */
  private adoptMoodleRoot(accountId: string, root: string): void {
    const a = getAccount(accountId)
    const next = normalizePlatformURL(root.replace(/\/+$/, '') + '/')
    if (!a || a.kind !== 'moodle' || !next || next === a.baseURL) return
    const from = hostOf(a.baseURL)
    const to = hostOf(next)
    if (!from || !to || (from !== to && !sameRegistrableSite(from, to))) {
      log.warn(`[platforms] ${a.id}: no se adopta ${originOf(next) ?? '?'} (no es del mismo sitio que ${originOf(a.baseURL) ?? '?'})`)
      return
    }
    if (downgradesToHttp(a.baseURL, next)) {
      log.warn(`[platforms] ${a.id}: no se adopta ${originOf(next) ?? '?'} (bajaría de https a http)`)
      return
    }
    try {
      changeAccountBaseURL(a.id, next)
      log.info(`[platforms] ${a.id}: el Moodle está en ${originOf(next) ?? '?'} (antes ${originOf(a.baseURL) ?? '?'}): se usa esa dirección`)
    } catch (err) {
      log.warn(`[platforms] ${a.id}: no se pudo cambiar la dirección:`, err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * «Ya he iniciado sesión»: con la ventana abierta, se mira ya y se comprueba con la sesión aunque la página no lo parezca;
   * si se confirma, la ventana se cierra sola. Si no, se trae al frente para terminar. Sin ventana, se comprueba la sesión.
   */
  async confirmSignIn(accountId: string): Promise<{ signedIn: boolean; account: PlatformAccountView }> {
    const a = requireAccount(accountId)
    const open = this.signIns.get(a.id)
    if (!open) {
      const v = await this.check(a.id)
      return { signedIn: v.status === 'signedIn', account: v }
    }
    const ok = open.session.recheck ? await open.session.recheck(true).catch(() => false) : false
    if (ok) return open.promise
    open.session.focus()
    return { signedIn: false, account: this.view(a.id) }
  }

  private async markSignedIn(accountId: string): Promise<void> {
    const a = getAccount(accountId)
    if (!a) return
    const nowISO = new Date(this.now()).toISOString()
    const updated = updateAccount(a.id, { lastSignedInAt: nowISO, lastState: 'signedIn', lastCheckedAt: nowISO })
    this.persistedCheckAt.set(a.id, this.now())
    this.lastSilent.delete(a.id)
    this.signedOutByUser.delete(a.id)
    this.setStatus(updated, 'signedIn')
    this.scheduler.markChecked(a.id, 'signedIn')
    this.events.emit('signedIn', accountView(updated))
    // el calendario privado se conecta solo la primera vez (Canvas y Moodle), sin molestar si no se puede
    if (platformInfo(updated.kind).automaticCalendar && !platformCalendarURL(updated)) {
      void this.connectCalendar(updated.id).catch((err) => log.info(`[platforms] calendario no conectado (${updated.id}):`, err instanceof Error ? err.message : String(err)))
    }
  }

  /**
   * ¿Hay sesión? Si se comprobó hace poco, sí; si no, se comprueba (y se intenta volver a entrar sola por el SSO); si sigue
   * cerrada y `interactive`, se abre la ventana de acceso y se espera.
   */
  async ensureSignedIn(accountId: string, opts: { interactive?: boolean; maxAgeMs?: number } = {}): Promise<boolean> {
    const a = requireAccount(accountId)
    const rt = effectiveStatus(a)
    const age = this.now() - (this.checkedAt.get(a.id) ?? -Infinity)
    // `maxAgeMs: 0` = comprobar siempre
    if (rt.status === 'signedIn' && age < (opts.maxAgeMs ?? 2 * 60_000)) return true
    if (!this.signIns.has(a.id)) {
      const v = await this.check(a.id)
      if (v.status === 'signedIn') return true
    }
    if (opts.interactive === false) return false
    return (await this.signIn(a.id)).signedIn
  }

  /** Cierra la sesión: borra el almacenamiento de la partición y la copia de las cookies (el calendario y el token se quedan). */
  async signOut(accountId: string): Promise<PlatformAccountView> {
    const a = requireAccount(accountId)
    this.signedOutByUser.add(a.id)
    await this.forgetSession(a)
    const updated = updateAccount(a.id, { lastState: 'needsSignIn' })
    this.setStatus(updated, 'needsSignIn', tr('Sesión cerrada.', 'Signed out.'))
    this.scheduler.markChecked(a.id, 'needsSignIn')
    return accountView(updated)
  }

  async remove(accountId: string): Promise<void> {
    const a = requireAccount(accountId)
    await this.forgetSession(a)
    removeAccount(a.id)
    platformStatus.delete(a.id)
    for (const m of [this.checkedAt, this.persistedCheckAt, this.lastSilent, this.lastConfirm]) m.delete(a.id)
    this.signedOutByUser.delete(a.id)
    this.scheduler.tick()
  }

  private async forgetSession(a: PlatformAccount): Promise<void> {
    this.signIns.get(a.id)?.session.cancel()
    this.signIns.delete(a.id)
    this.abortCheck(a.id)
    this.pendingSteps.delete(a.id)
    this.approvals.cancelAll(a.id)
    this.adapter.closeAccountTabs?.(a.id)
    try {
      await this.adapter.clearSession(a.id)
    } catch (err) {
      log.warn(`[platforms] no se pudo borrar la sesión (${a.id}):`, err instanceof Error ? err.message : String(err))
    }
    clearCookieSnapshot(a.id)
    rememberMoodleSesskey(a.id, null)
    this.lastSnapshot.delete(a.id)
    this.dirty.delete(a.id)
  }

  // MARK: Cookies

  /** Lo llama el navegador cuando cambian las cookies de una cuenta. */
  markCookiesChanged(accountId: string): void {
    this.dirty.add(accountId)
  }

  private async snapshot(account: PlatformAccount): Promise<void> {
    try {
      await this.adapter.snapshotCookies(account)
      this.lastSnapshot.set(account.id, this.now())
      this.dirty.delete(account.id)
    } catch (err) {
      log.warn(`[platforms] copia de cookies fallida (${account.id}):`, err instanceof Error ? err.message : String(err))
    }
  }

  /** ¿De qué cuentas se guardan las cookies? De todas menos las que tienen la sesión cerrada (no se pisa la copia buena). */
  private snapshotCandidates(): PlatformAccount[] {
    return listAccounts().filter((a) => effectiveStatus(a).status !== 'needsSignIn' || this.signIns.has(a.id))
  }

  /** Cada minuto: guarda las cookies de las cuentas que cambiaron (≥ 30 s) o cada 5 minutos. */
  async snapshotIfDue(): Promise<void> {
    const now = this.now()
    for (const a of this.snapshotCandidates()) {
      if (this.signIns.has(a.id)) continue
      if (snapshotDue(this.lastSnapshot.get(a.id) ?? null, now, this.dirty.has(a.id))) await this.snapshot(a)
    }
  }

  async snapshotAll(): Promise<void> {
    for (const a of this.snapshotCandidates()) await this.snapshot(a)
  }

  // MARK: Peticiones con la sesión

  /** Mira una respuesta: si acabó en la página de acceso o es un 401, se confirma si la sesión sigue viva. */
  observe(account: PlatformAccount, res: HttpResponse): void {
    const chain = [...res.redirects, res.url]
    if (res.status === 401 || chain.some((u) => isAccountLoginURL(account, u))) this.suspectSignedOut(account.id)
  }

  /** `fetch` con la sesión para los clientes internos (Canvas, Moodle): sin límite de método, con vigilancia de la sesión. */
  clientFetch(accountId: string): HttpFetch {
    const inner = this.adapter.sessionFetch(accountId)
    return async (url, init) => {
      const res = await inner(url, init)
      const a = getAccount(accountId)
      if (a) this.observe(a, res)
      return res
    }
  }

  /**
   * `fetch` con la sesión de la cuenta para las herramientas de la IA (APIs JSON): solo GET/HEAD y solo a los sitios de la
   * plataforma (no se usa la sesión contra otros sitios ni contra el SSO).
   */
  async fetchWithSession(accountId: string, url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    const a = requireAccount(accountId)
    const n = normalizeBrowserURL(url)
    if (!n.ok) throw invalidArgs(tr('La dirección no es válida.', 'That address isn’t valid.'))
    if (!isAccountSite(a, n.url) || isIdentityHost(hostOf(n.url) ?? '')) throw new AulaError('forbidden', tr('Esa dirección no es de tu plataforma.', 'That address isn’t on your platform.'))
    const method = (init.method ?? 'GET').toUpperCase()
    if (!READ_METHODS.has(method)) throw new AulaError('forbidden', tr('Aula solo lee de tu plataforma (GET).', 'Aula only reads from your platform (GET).'))
    return this.clientFetch(a.id)(n.url, { ...init, method: method as 'GET' | 'HEAD', body: undefined })
  }

  /**
   * Ejecuta una lectura de un cliente. Si dice que la sesión se cerró, se confirma con una comprobación de verdad (un 3xx
   * suelto no basta para pedir el acceso otra vez); si Moodle pide un paso tras el acceso, se apunta.
   */
  private async guarded<T>(account: PlatformAccount, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof AulaError && err.code === 'needs_sign_in') this.suspectSignedOut(account.id)
      if (err instanceof AulaError && err.code === 'platform_step_pending') this.notePendingStep(account.id)
      throw err
    }
  }

  // MARK: Canvas y Moodle

  canvas(accountId: string): CanvasClient {
    const a = requireAccount(accountId)
    return canvasClientFor(a, this.clientFetch(a.id))
  }

  moodle(accountId: string): MoodleClient {
    const a = requireAccount(accountId)
    if (a.kind !== 'moodle') throw invalidArgs(tr('Esa plataforma no es un Moodle.', 'That platform isn’t Moodle.'))
    return new MoodleClient({ baseURL: a.baseURL, fetch: this.clientFetch(a.id), accountId: a.id, onAjaxOk: () => this.ajaxWorked(a.id) })
  }

  /** Cursos de Canvas o Moodle. */
  async courses(accountId: string): Promise<PlatformCourse[]> {
    const a = requireAccount(accountId)
    if (a.kind === 'canvas') return this.guarded(a, async () => sortPlatformCourses(canvasCoursesToPlatform(a.id, await this.canvas(a.id).courses())))
    if (a.kind === 'moodle') return this.guarded(a, async () => sortPlatformCourses(moodleCoursesToPlatform(a.id, await this.moodle(a.id).enrolledCourses())))
    throw new AulaError(
      'unsupported',
      tr(
        'Por ahora solo sé listar los cursos de Canvas y Moodle. Puedo leer la página de tu plataforma.',
        'For now I can only list courses from Canvas and Moodle. I can read your platform’s page.'
      )
    )
  }

  /** Conecta el calendario privado con la sesión (Canvas: Perfil → calendar.ics; Moodle: exportación «todos»). */
  async connectCalendar(accountId: string): Promise<PlatformAccountView> {
    const a = requireAccount(accountId)
    if (a.kind === 'canvas') {
      const ok = await this.guarded(a, () => connectCanvasCalendar(a, this.canvas(a.id)))
      if (!ok) throw new AulaError('calendar_unavailable', tr('Canvas no dio el enlace de tu calendario.', 'Canvas didn’t provide your calendar link.'))
    } else if (a.kind === 'moodle') {
      const url = await this.guarded(a, () => this.moodle(a.id).calendarExportURL())
      savePlatformCalendarURL(a, url)
    } else {
      const help = platformInfo(a.kind).calendarHelp
      throw new AulaError(
        'unsupported',
        help
          ? `${tr('Aula aún no conecta este calendario sola.', 'Aula can’t connect this calendar on its own yet.')} ${pick(help)}`
          : tr('Esta plataforma no ofrece un calendario que Aula pueda conectar.', 'This platform doesn’t offer a calendar Aula can connect.')
      )
    }
    this.emitStatus(a.id)
    return this.view(a.id)
  }

  /** Enlace privado del calendario (solo para el motor del calendario, en el proceso principal). */
  calendarURL(accountId: string): string | null {
    const a = getAccount(accountId)
    return a ? platformCalendarURL(a) : null
  }

  /** Estado del planificador (diagnóstico y pruebas). */
  keepAliveState(): ReturnType<KeepAliveScheduler['snapshot']> {
    return this.scheduler.snapshot()
  }
}

/**
 * Dirección de una cuenta de Moodle: su raíz (sin /login/index.php ni otras rutas). Si el sondeo trae `wwwroot` del mismo
 * host que su página final (y ese host es el de la dirección, del mismo sitio o un Moodle reconocido), esa raíz; si no, y
 * el sondeo acabó en https en el mismo host, https.
 */
export function moodleAccountURL(url: string, probe: Pick<PlatformProbeOutcome, 'finalURL' | 'wwwroot' | 'kind'> | null): string {
  let root = platformRoot('moodle', url)
  const final = probe?.finalURL ?? null
  const fromWww = probe?.wwwroot && final ? moodleRootFromWwwroot(probe.wwwroot, final) : null
  if (fromWww && trustedMoodleMove(root, fromWww, probe?.kind === 'moodle')) root = fromWww
  else if (final && upgradesToHttps(root, final)) root = httpsRoot(root, final)
  return normalizePlatformURL(root + '/') ?? url
}

/** ¿Se puede pasar la cuenta de `from` a `to`? Mismo host o mismo sitio; otro sitio solo si el sondeo vio un Moodle allí. */
function trustedMoodleMove(from: string, to: string, probeSaidMoodle: boolean): boolean {
  const a = hostOf(from)
  const b = hostOf(to)
  if (!a || !b) return false
  if (a === b) return true
  if (isIdentityHost(b)) return false
  return sameRegistrableSite(a, b) || probeSaidMoodle
}

function upgradesToHttps(root: string, finalURL: string): boolean {
  return root.startsWith('http:') && finalURL.startsWith('https:') && hostOf(root) === hostOf(finalURL)
}

/** La raíz `root` (http) en el origen https de `finalURL` (su puerto, no el de http), con su carpeta y sin barra final. */
function httpsRoot(root: string, finalURL: string): string {
  return new URL(finalURL).origin + new URL(root).pathname.replace(/\/+$/, '')
}
