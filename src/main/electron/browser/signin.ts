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
import { app, BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import type { PlatformAccount } from '@shared/settings/platforms'
import { tr } from '@shared/ai/i18n'
import { signInTitle } from '@main/services/platforms/signin-title'
import { accountContains, accountDisplayName, hostOf, isIdentityHost, isSignInStep, signInSelectors, SignInWatch, type SignInPageState, type VerifyState } from '@engine/platforms'
import { log } from '@main/services/log'
import { AULA_WORLD, rememberMeScript, signInStateScript, successBannerScript } from './scripts'
import { partitionFor, platformSession } from './sessions'
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
  promise: Promise<{ signedIn: boolean }>
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

function startURLFor(account: PlatformAccount): string {
  switch (account.kind) {
    case 'classroom': return 'https://classroom.google.com/'
    case 'teams': return 'https://teams.microsoft.com/'
    default: return account.baseURL
  }
}

function webPrefs(partition: string): Electron.WebPreferences {
  return {
    partition,
    preload: join(__dirname, '../preload/browser.js'),
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

export function openSignInWindow(opts: SignInOptions): SignInHandle {
  const { account } = opts
  const partition = partitionFor(account.id)
  const name = accountDisplayName(account)
  const selectors = signInSelectors(account.kind)
  const watch = new SignInWatch(account)
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
  const windows = new Map<string, BrowserWindow>([['main', win]])
  /** Última dirección mirada en cada ventana. */
  const seenURL = new Map<string, string>()
  let finished = false
  let running: Promise<boolean> | null = null
  let again = false
  let debounce: ReturnType<typeof setTimeout> | null = null
  let resolveFn!: (r: { signedIn: boolean }) => void
  const promise = new Promise<{ signedIn: boolean }>((r) => (resolveFn = r))

  const cleanups: (() => void)[] = []
  const finish = (signedIn: boolean): void => {
    if (finished) return
    finished = true
    if (debounce) clearTimeout(debounce)
    for (const c of cleanups.splice(0)) {
      try { c() } catch { /* nada */ }
    }
    resolveFn({ signedIn })
  }

  /** Mira una ventana: marca «recordarme» en el acceso y cuenta a la vigilancia cómo está su página. */
  const look = async (key: string, w: BrowserWindow): Promise<void> => {
    if (w.isDestroyed()) return
    const wc = w.webContents
    const url = wc.getURL()
    if (!/^https?:/i.test(url)) return
    watch.noteURL(url)
    const fresh = seenURL.get(key) !== url
    seenURL.set(key, url)
    const onIdentity = !accountContains(account, url) && isIdentityHost(hostOf(url) ?? '')
    // «recordarme» una sola vez por página (si el estudiante la desmarca, se queda desmarcada)
    if (fresh && (onIdentity || isSignInStep(account, url))) await runInPage(wc, rememberMeScript(), 0)
    if (onIdentity) {
      watch.notePage(key, { url, hasPassword: true })
      return
    }
    // el HTML (marcas del servidor) solo al llegar a una página; en el sondeo basta el DOM
    const s = await runInPage<(SignInPageState & { htmlHead?: string }) | null>(wc, signInStateScript(selectors, fresh), null)
    if (finished || w.isDestroyed()) return
    // si el guion no contestó (página yéndose), vale la dirección: así una página que se cuelga no lo para todo
    watch.notePage(key, s ? { url: s.url || url, hasPassword: s.hasPassword, html: s.htmlHead, signedInHint: s.signedInHint, signedOutHint: s.signedOutHint } : { url })
  }

  const succeed = async (reason: string): Promise<void> => {
    log.info(`[platforms] sesión iniciada en la ventana (${account.id}): ${reason}`)
    // el aviso, en la ventana que está en la plataforma (la principal si no)
    const target = [...windows.values()].find((w) => !w.isDestroyed() && accountContains(account, w.webContents.getURL())) ?? win
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
    if (!watch.wantsVerify(force)) return false
    watch.markVerifying()
    const state = await withTimeout(opts.verify(), VERIFY_TIMEOUT_MS, 'unknown' as VerifyState)
    if (finished) return true
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

  /** Escucha una ventana (la principal o una emergente) y le aplica la misma política. */
  const attach = (key: string, w: BrowserWindow): void => {
    const wc = w.webContents
    const onURL = (url: string, isMainFrame: boolean): void => {
      if (isMainFrame) watch.noteURL(url)
    }
    wc.on('did-start-navigation', (d) => onURL(d.url, d.isMainFrame))
    wc.on('did-redirect-navigation', (d) => onURL(d.url, d.isMainFrame))
    wc.on('did-navigate', (_e, url) => {
      watch.noteURL(url)
      // el título dice siempre en qué dominio se escribe la contraseña (y si va sin cifrar)
      if (!w.isDestroyed()) w.setTitle(signInTitle(name, url))
      schedule(500)
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) schedule(900)
    })
    wc.on('dom-ready', () => schedule(700))
    wc.on('did-finish-load', () => schedule(500))
    wc.on('page-title-updated', (e) => {
      // el título de la ventana lo pone Aula (plataforma y dominio), nunca la página
      e.preventDefault()
    })
    // solo direcciones web; enlaces a otras apps (msteams:, zoommtg:…) no
    wc.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url)) e.preventDefault()
    })
    wc.setWindowOpenHandler(({ url }) => {
      // emergentes del SSO («Continuar con Google/Microsoft») o de la plataforma: con la misma sesión; lo demás, fuera
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' }
      const h = hostOf(url) ?? ''
      const sameSite = isIdentityHost(h) || accountContains(account, url) || isSignInStep(account, url)
      if (!sameSite && !/login|auth|sso|oauth|saml|signin|cas\b/i.test(url)) {
        void shell.openExternal(url)
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 560, height: 720, autoHideMenuBar: true, show: !windowsAlwaysHidden(), webPreferences: webPrefs(partition) }
      }
    })
    wc.on('did-create-window', (child) => {
      if (finished) return
      const childKey = `popup-${child.id}`
      windows.set(childKey, child)
      attach(childKey, child)
      child.on('closed', () => {
        windows.delete(childKey)
        seenURL.delete(childKey)
        watch.forgetWindow(childKey)
        // el SSO de la emergente terminó: la principal suele cambiar sin navegar
        schedule(400)
      })
    })
  }
  attach('main', win)

  // sondeo suave mientras está abierta: paneles que llegan por JavaScript, emergentes que vuelven sin navegar…
  const poll = setInterval(() => {
    if (!finished && !win.isDestroyed() && !running) void evaluate()
  }, POLL_MS)
  cleanups.push(() => clearInterval(poll))

  // al volver a cualquier ventana de Aula (o a esta), se mira enseguida
  const onFocus = (): void => schedule(150)
  app.on('browser-window-focus', onFocus)
  cleanups.push(() => app.off('browser-window-focus', onFocus))

  // una cookie de sesión de la plataforma que cambia (al entrar se renueva): a comprobar ya
  const ses = platformSession(account.id)
  const onCookie = (_e: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
    if (!removed && watch.noteCookie({ name: cookie.name, domain: cookie.domain })) schedule(400)
  }
  ses.cookies.on('changed', onCookie)
  cleanups.push(() => ses.cookies.off('changed', onCookie))

  win.on('closed', () => {
    for (const w of windows.values()) if (w !== win && !w.isDestroyed()) w.close()
    if (finished) return
    // el estudiante cerró la ventana: quizá ya había iniciado sesión aunque no se detectara
    void withTimeout(opts.verify(), VERIFY_TIMEOUT_MS, 'unknown' as VerifyState).then(async (state) => {
      const ok = state === 'signedIn'
      if (ok) await opts.onSuccess().catch(() => undefined)
      finish(ok)
    })
  })

  void win.loadURL(opts.startURL ?? startURLFor(account)).catch((err) => log.warn('[platforms] no se pudo abrir la página de acceso:', errText(err)))

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
