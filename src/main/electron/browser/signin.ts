// Ventana de inicio de sesión: una ventana normal y visible con la sesión de la cuenta. El estudiante inicia sesión (Aula
// nunca ve ni escribe la contraseña) y Aula detecta solo cuándo ha terminado, sin depender de una única carga:
// - mira cada navegación y redirección (también las de las ventanas emergentes del SSO: «Continuar con Microsoft»);
// - mira el DOM ya pintado (paneles que llegan por JavaScript) con un sondeo suave mientras la ventana está abierta y al
//   volver el foco a cualquier ventana de Aula;
// - reacciona a las cookies de sesión de la plataforma que cambian;
// - y lo confirma con la comprobación de solo lectura con la sesión (API o página interna).
// Cada paso tiene tope de tiempo: una página que se va mientras se la mira (el SSO que se envía solo) no deja la vigilancia
// colgada. Al confirmarse: aviso «Sesión iniciada en …», cookies guardadas y la ventana se cierra sola. El estudiante también
// puede decir «Ya he iniciado sesión» (recheck con `force`).
// Con un paso de Moodle tras el acceso a la vista (política, perfil) la ventana NO se cierra: lo termina el estudiante. Un
// Moodle en otro host del mismo sitio (alias) cuenta como la plataforma. Y explica con avisos lo que Aula no puede hacer por
// él: llaves de acceso, bucles, errores de Microsoft, pasos que abren otra app y direcciones que la guarda corta.
import { app, BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import type { PlatformAccount } from '@shared/settings/platforms'
import { aiLocale, tr } from '@shared/ai/i18n'
import { signInTitle } from '@main/services/platforms/signin-title'
// cómo termina la ventana: el tipo es del controlador (contrato `SignInSession.promise`); esta ventana lo produce
import type { SignInResult } from '@main/services/platforms/controller'
import {
  accountDisplayName, entraErrorKind, hostOf, isIdentityHost, isPostLoginStep, joinRoot, MAIN_SIGNIN_WINDOW, platformRoot, signInSelectors, SignInWatch,
  type SignInPageState, type VerifyState
} from '@engine/platforms'
import { log } from '@main/services/log'
import { AULA_WORLD, hintBannerScript, identityStateScript, rememberMeScript, signInStateScript, successBannerScript } from './scripts'
import { blockedDestinations, externalSchemes, forgetWebContents, noteExternalScheme, partitionFor, platformSession, safeOrigin } from './sessions'
import {
  blockedHint, blockedHintRelevant, blockedPageURL, devicePolicyHint, externalAppHint, hopForLog, hopKeyForLog, loopHint, passkeyHint, passkeyHintDue,
  stepHint, type SignInHint
} from './signin-hints'
import { reveal, windowsAlwaysHidden } from '../visibility'

export interface SignInOptions {
  account: PlatformAccount
  /** Comprobación de solo lectura con la sesión (API o página interna). */
  verify: () => Promise<VerifyState>
  /** Tras confirmar (guardar cookies, avisar…). */
  onSuccess: () => Promise<void>
  parent?: BrowserWindow | null
  /** Dirección donde empezar (por defecto, la de la cuenta). */
  startURL?: string
}

export interface SignInHandle {
  promise: Promise<SignInResult>
  window: BrowserWindow
  focus(): void
  cancel(): void
  /** Vuelve a mirar ya. Con `force` (el estudiante dice que ya entró) se comprueba con la sesión pase lo que pase. */
  recheck(force?: boolean): Promise<boolean>
}

/** Sondeo mientras la ventana está abierta (el DOM; la comprobación con la sesión se espacia sola). */
const POLL_MS = 1500
const SCRIPT_TIMEOUT_MS = 3500
const VERIFY_TIMEOUT_MS = 25_000
const ERR_ABORTED = -3
/** Electron solo trae interfaz de llaves de acceso en Windows: en macOS y Linux se avisa en cuanto la página pide una. */
const NO_PASSKEY_UI = process.platform !== 'win32'

/** Lo que los guiones de la ventana cuentan además del estado de la página. */
interface PageExtras {
  /** Marca de la guarda de WebAuthn: 'asked' o 'failed'. */
  passkey?: string
  /** Avisos de Aula que el estudiante cerró en esta página. */
  closed?: string
  /** Primer código `AADSTS…` del texto visible. */
  aadsts?: string
}
type PlatformPageState = SignInPageState & PageExtras & { htmlHead?: string }

function startURLFor(account: PlatformAccount): string {
  switch (account.kind) {
    case 'classroom': return 'https://classroom.google.com/'
    case 'teams': return 'https://teams.microsoft.com/'
    // la raíz de Moodle: una dirección pegada de /login/index.php abriría «Ya has iniciado sesión» (su botón cierra la sesión)
    case 'moodle': return joinRoot(platformRoot('moodle', account.baseURL), '/')
    default: return account.baseURL
  }
}

function webPrefs(partition: string): Electron.WebPreferences {
  return {
    partition,
    preload: join(__dirname, '../preload/browser.js'),
    // el preload pone la guarda de las llaves de acceso (también en las emergentes, que usan estas mismas preferencias)
    additionalArguments: ['--aula-signin'],
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    webviewTag: false
  }
}

/** Una promesa con tope: si no llega a tiempo, `fallback` (las de executeJavaScript pueden no volver nunca si la página se va). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(fallback) })
  })
}

function runInPage<T>(wc: WebContents, code: string, fallback: T): Promise<T> {
  if (wc.isDestroyed()) return Promise.resolve(fallback)
  let p: Promise<T>
  try {
    p = wc.executeJavaScriptInIsolatedWorld(AULA_WORLD, [{ code }]) as Promise<T>
  } catch {
    return Promise.resolve(fallback)
  }
  return withTimeout(p, SCRIPT_TIMEOUT_MS, fallback)
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Avisos de las ventanas de acceso: uno por tipo y ventana; los que el estudiante cierra no vuelven. */
class Notices {
  private readonly byWindow = new Map<string, { shown: Set<string>; dismissed: Set<string> }>()
  private readonly logged = new Set<string>()

  private of(key: string): { shown: Set<string>; dismissed: Set<string> } {
    let n = this.byWindow.get(key)
    if (!n) this.byWindow.set(key, (n = { shown: new Set(), dismissed: new Set() }))
    return n
  }

  /** Los avisos que el estudiante cerró en la página (atributo `data-aula-hints-closed`). */
  noteClosed(key: string, closed: string | undefined): void {
    for (const kind of (closed ?? '').split(/\s+/)) if (kind) this.of(key).dismissed.add(kind)
  }

  /**
   * Pone un aviso en una ventana: una sola vez, o con `sticky` en cada página nueva mientras haga falta (bucles, pasos de
   * varias páginas) salvo que el estudiante lo cerrara. true si está (o estuvo) a la vista.
   */
  async show(key: string, w: BrowserWindow, hint: SignInHint, sticky = false): Promise<boolean> {
    const n = this.of(key)
    if (n.dismissed.has(hint.kind) || (!sticky && n.shown.has(hint.kind))) return true
    if (w.isDestroyed()) return false
    const r = await runInPage<string>(w.webContents, hintBannerScript(hint, tr('Cerrar aviso', 'Close notice')), 'failed')
    if (r === 'dismissed') n.dismissed.add(hint.kind)
    else if (r === 'shown' || r === 'present') n.shown.add(hint.kind)
    else return false
    return true
  }

  forget(key: string): void {
    this.byWindow.delete(key)
  }

  /** Una línea en el registro, una sola vez por `id`. */
  logOnce(id: string, line: string): void {
    if (this.logged.has(id)) return
    this.logged.add(id)
    log.info(line)
  }
}

export function openSignInWindow(opts: SignInOptions): SignInHandle {
  const { account } = opts
  const partition = partitionFor(account.id)
  const name = accountDisplayName(account)
  const selectors = signInSelectors(account.kind)
  const watch = new SignInWatch(account)
  const notices = new Notices()
  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 420,
    minHeight: 480,
    show: false,
    title: tr(`Inicia sesión · ${name}`, `Sign in · ${name}`),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    ...(opts.parent && !opts.parent.isDestroyed() ? { parent: opts.parent } : {}),
    webPreferences: webPrefs(partition)
  })
  win.once('ready-to-show', () => { reveal(win, { focus: false }) })

  /** La principal y las emergentes del SSO (clave → ventana). */
  const windows = new Map<string, BrowserWindow>([[MAIN_SIGNIN_WINDOW, win]])
  /** Última dirección mirada en cada ventana. */
  const seenURL = new Map<string, string>()
  /** Última página a la que llegó cada ventana (¿se cierra con un paso de Moodle a la vista?). */
  const lastNav = new Map<string, string>()
  /** Último host de cada ventana (registro: una línea por cambio de host). */
  const lastHost = new Map<string, string>()
  /** Hosts cortados por la guarda que ya se explicaron (una vez por host). */
  const blockedExplained = new Set<string>()
  let aliasLogged = false
  let finished = false
  let running: Promise<boolean> | null = null
  let again = false
  let debounce: ReturnType<typeof setTimeout> | null = null
  let resolveFn!: (r: SignInResult) => void
  const promise = new Promise<SignInResult>((r) => (resolveFn = r))
  const tag = (key: string): string => (key === MAIN_SIGNIN_WINDOW ? account.id : `${account.id} · ${key}`)

  const cleanups: (() => void)[] = []
  const finish = (signedIn: boolean, pendingStep = false): void => {
    if (finished) return
    finished = true
    if (debounce) clearTimeout(debounce)
    for (const c of cleanups.splice(0)) {
      try { c() } catch { /* nada */ }
    }
    const adoptedRoot = watch.adoptedRoot
    resolveFn({ signedIn, ...(pendingStep ? { pendingStep: true } : {}), ...(adoptedRoot ? { adoptedRoot } : {}) })
  }

  /** ¿Es un paso de Moodle tras el acceso (en la cuenta o en el alias adoptado)? */
  const isStepURL = (url: string): boolean => {
    if (isPostLoginStep(account, url)) return true
    const alias = watch.adoptedRoot
    return !!alias && isPostLoginStep({ kind: account.kind, baseURL: alias + '/' }, url)
  }
  const stepOnScreen = (): boolean => [...lastNav.values()].some(isStepURL)

  const logHop = (key: string, url: string): void => {
    const hop = hopForLog(url)
    if (!hop || lastHost.get(key) === hop.host) return
    lastHost.set(key, hop.host)
    log.info(`[platforms] ventana de acceso (${tag(key)}): ${hop.host}${hop.path}`)
  }

  const noteAlias = (): void => {
    const root = watch.adoptedRoot
    if (!root || aliasLogged) return
    aliasLogged = true
    log.info(`[platforms] ventana de acceso (${account.id}): el Moodle de la cuenta está en ${hostOf(root) ?? root} (otro host del mismo sitio)`)
  }

  /** La guarda cortó la página entera: en su lugar, una página local que lo explica (si no, se quedaría en blanco). */
  const showBlockedPage = (w: BrowserWindow, hint: SignInHint): boolean => {
    if (w.isDestroyed()) return false
    void w.loadURL(blockedPageURL(hint, aiLocale())).catch(() => undefined)
    return true
  }

  /** Lo que la sesión apuntó de esta ventana: otras apps que quiso abrir y direcciones que la guarda cortó. */
  const explainBlocked = async (key: string, w: BrowserWindow): Promise<void> => {
    if (w.isDestroyed()) return
    const id = w.webContents.id
    const schemes = externalSchemes(id)
    for (const s of schemes) notices.logOnce(`app:${s}`, `[platforms] ventana de acceso (${tag(key)}): la página quiso abrir otra aplicación (${s}:)`)
    if (schemes.length) await notices.show(key, w, externalAppHint(schemes[schemes.length - 1]))
    const platformHosts = [hostOf(account.baseURL) ?? '', hostOf(watch.adoptedRoot ?? '') ?? '']
    for (const b of blockedDestinations(id)) {
      if (blockedExplained.has(b.host) || !blockedHintRelevant({ host: b.host, mainFrame: b.mainFrame, kind: b.kind, platformHosts })) continue
      const hint = blockedHint(b.host, b.kind, b.reason)
      const shown = b.mainFrame ? showBlockedPage(w, hint) : await notices.show(key, w, hint)
      if (!shown) continue
      blockedExplained.add(b.host)
      log.info(`[platforms] ventana de acceso (${tag(key)}): la guarda cortó ${b.host} (${b.mainFrame ? 'la página' : 'un recurso'}, ${b.kind}): ${b.reason}`)
    }
  }

  /** Error de Microsoft Entra en la página: política de dispositivo o bucle de peticiones. */
  const explainEntra = async (key: string, w: BrowserWindow, code: string): Promise<void> => {
    notices.logOnce(`entra:${code}`, `[platforms] ventana de acceso (${tag(key)}): Microsoft muestra ${code}`)
    const kind = entraErrorKind(code)
    if (kind === 'devicePolicy') await notices.show(key, w, devicePolicyHint(code))
    else if (kind === 'requestLoop') await notices.show(key, w, loopHint())
  }

  /** Avisos de una página: llaves de acceso, error de Entra y paso de Moodle tras el acceso. */
  const explainPage = async (key: string, w: BrowserWindow, s: PageExtras, step: boolean): Promise<void> => {
    notices.noteClosed(key, s.closed)
    if (passkeyHintDue(s.passkey, NO_PASSKEY_UI)) {
      notices.logOnce(`passkey:${key}:${s.passkey}`, `[platforms] ventana de acceso (${tag(key)}): la página pidió una llave de acceso (${s.passkey})`)
      await notices.show(key, w, passkeyHint())
    }
    if (s.aadsts) await explainEntra(key, w, s.aadsts)
    if (step) {
      notices.logOnce(`step:${key}`, `[platforms] ventana de acceso (${tag(key)}): paso de Moodle tras el acceso (política o perfil); la ventana sigue abierta`)
      await notices.show(key, w, stepHint(), true)
    }
  }

  /** La principal vuelve una y otra vez al mismo paso de acceso: aviso y la cadena en el registro (hosts y rutas). */
  const explainLoop = async (): Promise<void> => {
    if (!watch.loopSuspected || win.isDestroyed()) return
    notices.logOnce('loop', `[platforms] ventana de acceso (${account.id}): parece un bucle: ${watch.recentHops().map(hopKeyForLog).join(' → ')}`)
    await notices.show(MAIN_SIGNIN_WINDOW, win, loopHint(), true)
  }

  /** Mira una ventana: marca «recordarme» en el acceso, cuenta a la vigilancia cómo está su página y pone los avisos. */
  const look = async (key: string, w: BrowserWindow): Promise<void> => {
    if (w.isDestroyed()) return
    await explainBlocked(key, w)
    if (finished || w.isDestroyed()) return
    const wc = w.webContents
    const url = wc.getURL()
    if (!/^https?:/i.test(url)) return
    watch.noteURL(url, key)
    const fresh = seenURL.get(key) !== url
    seenURL.set(key, url)
    const onIdentity = !watch.isPlatformURL(url) && isIdentityHost(hostOf(url) ?? '')
    // «recordarme» una sola vez por página (si el estudiante la desmarca, se queda desmarcada)
    if (fresh && (onIdentity || watch.isSignInStepURL(url))) await runInPage(wc, rememberMeScript(), 0)
    if (onIdentity) {
      watch.notePage(key, { url, hasPassword: true })
      // en el proveedor de identidad solo se mira lo mínimo: llaves de acceso y errores de Microsoft
      const extra = await runInPage<PageExtras | null>(wc, identityStateScript(), null)
      if (extra && !finished && !w.isDestroyed()) await explainPage(key, w, extra, false)
      return
    }
    // el HTML (marcas del servidor) solo al llegar a una página; en el sondeo basta el DOM
    const s = await runInPage<PlatformPageState | null>(wc, signInStateScript(selectors, fresh), null)
    if (finished || w.isDestroyed()) return
    // si el guion no contestó (página yéndose), vale la dirección: así una página que se cuelga no lo para todo
    const v = watch.notePage(key, s ? { url: s.url || url, hasPassword: s.hasPassword, html: s.htmlHead, signedInHint: s.signedInHint, signedOutHint: s.signedOutHint } : { url })
    noteAlias()
    if (s) await explainPage(key, w, s, !!v.step)
  }

  const succeed = async (reason: string): Promise<void> => {
    log.info(`[platforms] sesión iniciada en la ventana (${account.id}): ${reason}`)
    // el aviso, en la ventana que está en la plataforma (la principal si no)
    const target = [...windows.values()].find((w) => !w.isDestroyed() && watch.isPlatformURL(w.webContents.getURL())) ?? win
    if (!target.isDestroyed()) {
      await runInPage(target.webContents, successBannerScript(tr(`Sesión iniciada en ${name}`, `Signed in to ${name}`), tr('Ya puedes volver a Aula.', 'You can go back to Aula now.')), false)
    }
    await opts.onSuccess().catch((err) => log.warn('[platforms] tras iniciar sesión:', errText(err)))
    finish(true)
    setTimeout(() => {
      for (const w of windows.values()) if (!w.isDestroyed()) w.close()
    }, 1300)
  }

  const evaluateOnce = async (force: boolean): Promise<boolean> => {
    if (finished) return true
    if (win.isDestroyed()) return false
    for (const [key, w] of [...windows.entries()]) {
      try {
        await look(key, w)
      } catch (err) {
        log.debug('[platforms] ventana de acceso:', errText(err))
      }
      if (finished) return true
    }
    await explainLoop().catch((err) => log.debug('[platforms] aviso de bucle:', errText(err)))
    if (finished) return true
    if (!watch.wantsVerify(force)) return false
    watch.markVerifying()
    const state = await withTimeout(opts.verify(), VERIFY_TIMEOUT_MS, 'unknown' as VerifyState)
    if (finished) return true
    // con un paso tras el acceso a la vista, accept() no la da por iniciada (ni con «Ya he iniciado sesión»)
    const reason = watch.accept(state, force)
    if (!reason) return false
    await succeed(`${reason} (${state})`)
    return true
  }

  /** Una evaluación a la vez; si llega otra petición mientras tanto, se repite al acabar (sin quedarse nunca bloqueada). */
  const evaluate = (force = false): Promise<boolean> => {
    if (running) {
      if (!force) {
        again = true
        return running
      }
      return running.then((done) => (done || finished ? true : evaluate(true)))
    }
    running = evaluateOnce(force)
      .catch((err) => {
        log.debug('[platforms] comprobación de la ventana de acceso:', errText(err))
        return false
      })
      .finally(() => {
        running = null
        if (again && !finished) {
          again = false
          schedule(250)
        }
      })
    return running
  }

  const schedule = (ms = 600): void => {
    if (finished) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void evaluate()
    }, ms)
  }

  /** Popup del SSO o de la plataforma: con la misma sesión; lo demás se abre fuera; otras apps, nunca. */
  const openPolicy = (wcId: number, url: string): Electron.WindowOpenHandlerResponse => {
    if (!/^https?:\/\//i.test(url)) {
      noteExternalScheme(wcId, url)
      schedule(200)
      return { action: 'deny' }
    }
    const h = hostOf(url) ?? ''
    const sameSite = isIdentityHost(h) || watch.isPlatformURL(url) || watch.isSignInStepURL(url)
    if (!sameSite && !/login|auth|sso|oauth|saml|signin|cas\b/i.test(url)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { width: 560, height: 720, autoHideMenuBar: true, show: !windowsAlwaysHidden(), webPreferences: webPrefs(partition) }
    }
  }

  /** Escucha una ventana (la principal o una emergente) y le aplica la misma política. */
  const attach = (key: string, w: BrowserWindow): void => {
    const wc = w.webContents
    const wcId = wc.id
    wc.once('destroyed', () => forgetWebContents(wcId))
    const onURL = (url: string, isMainFrame: boolean, sameDocument = false): void => {
      if (!isMainFrame) return
      // las navegaciones dentro de la misma página no cuentan como saltos (bucles ni registro)
      watch.noteURL(url, sameDocument ? undefined : key)
      if (!sameDocument) logHop(key, url)
    }
    wc.on('did-start-navigation', (d) => onURL(d.url, d.isMainFrame, d.isSameDocument))
    wc.on('did-redirect-navigation', (d) => onURL(d.url, d.isMainFrame))
    wc.on('did-navigate', (_e, url) => {
      watch.noteURL(url, key)
      lastNav.set(key, url)
      // el título dice siempre en qué dominio se escribe la contraseña (y si va sin cifrar)
      if (!w.isDestroyed()) w.setTitle(signInTitle(name, url))
      schedule(500)
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) schedule(900)
    })
    wc.on('dom-ready', () => schedule(700))
    wc.on('did-finish-load', () => schedule(500))
    // una página que no llega a cargar (p. ej. la cortó la guarda de destinos): al registro, y a explicarlo enseguida
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return
      log.info(`[platforms] ventana de acceso (${tag(key)}): no cargó ${safeOrigin(url)} (${code} ${desc})`)
      schedule(300)
    })
    wc.on('page-title-updated', (e) => {
      // el título de la ventana lo pone Aula (plataforma y dominio), nunca la página
      e.preventDefault()
    })
    // solo direcciones web; enlaces a otras apps (msteams:, msauth:, zoommtg:…) no, y se explica
    wc.on('will-navigate', (e, url) => {
      if (/^https?:\/\//i.test(url)) return
      e.preventDefault()
      noteExternalScheme(wcId, url)
      schedule(200)
    })
    wc.setWindowOpenHandler(({ url }) => openPolicy(wcId, url))
    wc.on('did-create-window', (child) => {
      if (finished) return
      const childKey = `popup-${child.id}`
      windows.set(childKey, child)
      attach(childKey, child)
      child.on('closed', () => {
        windows.delete(childKey)
        seenURL.delete(childKey)
        lastNav.delete(childKey)
        lastHost.delete(childKey)
        notices.forget(childKey)
        watch.forgetWindow(childKey)
        // el SSO de la emergente terminó: la principal suele cambiar sin navegar
        schedule(400)
      })
    })
  }
  attach(MAIN_SIGNIN_WINDOW, win)

  // sondeo suave mientras está abierta: paneles que llegan por JavaScript, emergentes que vuelven sin navegar…
  const poll = setInterval(() => {
    if (!finished && !win.isDestroyed() && !running) void evaluate()
  }, POLL_MS)
  cleanups.push(() => clearInterval(poll))

  // al volver a cualquier ventana de Aula (o a esta), se mira enseguida
  const onFocus = (): void => schedule(150)
  app.on('browser-window-focus', onFocus)
  cleanups.push(() => app.off('browser-window-focus', onFocus))

  // una cookie de sesión de la plataforma (o del alias adoptado) que cambia (al entrar se renueva): a comprobar ya
  const ses = platformSession(account.id)
  const onCookie = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
    if (!removed && watch.noteCookie({ name: cookie.name, domain: cookie.domain })) schedule(400)
  }
  ses.cookies.on('changed', onCookie)
  cleanups.push(() => ses.cookies.off('changed', onCookie))

  win.on('closed', () => {
    for (const w of windows.values()) if (w !== win && !w.isDestroyed()) w.close()
    if (finished) return
    // cerrada con la política o el perfil de Moodle a medias: no hay sesión que se pueda usar hasta terminarlo
    if (stepOnScreen()) {
      log.info(`[platforms] ventana de acceso (${account.id}): cerrada con un paso de Moodle pendiente (política o perfil)`)
      finish(false, true)
      return
    }
    // el estudiante cerró la ventana: quizá ya había iniciado sesión aunque no se detectara
    void withTimeout(opts.verify(), VERIFY_TIMEOUT_MS, 'unknown' as VerifyState).then(async (state) => {
      const ok = state === 'signedIn'
      if (ok) await opts.onSuccess().catch(() => undefined)
      finish(ok)
    })
  })

  void win.loadURL(opts.startURL ?? startURLFor(account)).catch((err: unknown) => {
    // sin la dirección: la carga inicial recorre el SSO (estado, nonce, SAMLRequest en la consulta); el código y el origen
    const e = (err ?? {}) as { errno?: number; code?: string; url?: string }
    if (e.errno === ERR_ABORTED || e.code === 'ERR_ABORTED') return
    log.warn(`[platforms] no se pudo abrir la página de acceso (${account.id}): ${e.code ?? e.errno ?? 'error'}${e.url ? ` ${safeOrigin(e.url)}` : ''}`)
  })

  return {
    promise,
    window: win,
    focus: () => {
      reveal(win)
    },
    cancel: () => {
      finish(false)
      for (const w of windows.values()) if (!w.isDestroyed()) w.close()
    },
    recheck: async (force = false) => {
      if (finished) return promise.then((r) => r.signedIn)
      return evaluate(force)
    }
  }
}
