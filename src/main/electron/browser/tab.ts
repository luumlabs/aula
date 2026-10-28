// Pestaña de lectura oculta (port de BrowserKit/Engine/TabRuntime.swift sobre Electron): una ventana que nunca se muestra, con
// la sesión de la cuenta, aislada (sandbox, sin Node, webSecurity, sin diálogos), que abre una dirección, espera a que la red
// quede quieta y lee en un mundo aislado. Las decisiones de seguridad (qué se pulsa) las toma PlatformBrowser; aquí solo se
// ejecutan, con una guarda de red que corta igualmente lo peligroso (examen, entrega, cerrar sesión…).
import { BrowserWindow, type NativeImage, type WebContents } from 'electron'
import { join } from 'node:path'
import type { PlatformAccount } from '@shared/settings/platforms'
import { classifyAuthPage, guardRequest, navigationPolicy, normalizeBrowserURL, type PageElement, type PageHeading, type PageInfo, type PageLink, type PageWall } from '@engine/platforms'
import { AulaError } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { AULA_WORLD, domClickScript, hasTextScript, locateRefScript, pageStateScript, readabilityParseScript, readabilityScript, scrollScript, snapshotScript } from './scripts'
import { forgetWebContents, networkState, partitionFor, platformSession, setRequestGuard } from './sessions'

/** Lo que devuelve la lectura completa (mundo aislado). */
export interface PageSnapshot {
  info: PageInfo
  markdown: string
  truncated: boolean
  headings: PageHeading[]
  links: PageLink[]
  elements: PageElement[]
  usedMain: boolean
}

export interface ArticleResult {
  title: string
  html: string
  text: number
}

interface PageState {
  url: string
  title: string
  hasPassword: boolean
  wall: string
  htmlHead: string
}

interface RawSnapshot {
  url: string
  title: string
  markdown: string
  truncated: boolean
  headings: PageHeading[]
  links: PageLink[]
  elements: PageElement[]
  hasPassword: boolean
  nextRef: number
  usedMain: boolean
}

const ERR_ABORTED = -3
const ERR_BLOCKED_BY_CLIENT = -20
const BLOCKING_STATUSES = new Set([401, 403, 407, 429])
const VIEWPORT = { width: 1280, height: 900 }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class ReaderTab {
  readonly win: BrowserWindow
  readonly wc: WebContents
  readonly id: number
  lastUsed = Date.now()
  closed = false
  private httpStatus: number | undefined
  private elements = new Map<string, PageElement>()
  private nextRef = 1
  private blocked = false
  /** Peticiones de fondo cortadas por la guarda (entregas, mensajes… lanzados por el JavaScript de la página). */
  blockedRequests = 0
  private navigations = 0
  private queue: Promise<unknown> = Promise.resolve()
  private active = 0
  private onClosed: (() => void) | null = null

  constructor(readonly accountId: string | null, readonly name: string, private readonly account: () => PlatformAccount | null) {
    platformSession(accountId)
    this.win = new BrowserWindow({
      show: false,
      ...VIEWPORT,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: true,
      title: 'Aula (lectura)',
      webPreferences: {
        partition: partitionFor(accountId),
        preload: join(__dirname, '../preload/browser.js'),
        additionalArguments: ['--aula-reader'],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        backgroundThrottling: false,
        webgl: false,
        navigateOnDragDrop: false,
        webviewTag: false,
        safeDialogs: true,
        autoplayPolicy: 'document-user-activation-required'
      }
    })
    this.wc = this.win.webContents
    this.id = this.wc.id
    this.wc.setAudioMuted(true)
    setRequestGuard(this.id, (url, method, resourceType, body) => {
      const account = this.account()
      const ok = guardRequest({ url, method, resourceType, kind: account?.kind, account, body })
      if (!ok && resourceType === 'mainFrame') this.blocked = true
      if (!ok && resourceType !== 'mainFrame') this.blockedRequests++
      return ok
    })
    this.wc.on('did-start-navigation', (d) => {
      if (!d.isMainFrame || d.isSameDocument) return
      this.navigations++
      this.httpStatus = undefined
    })
    this.wc.on('did-navigate', (_e, _url, code) => {
      this.httpStatus = code > 0 ? code : undefined
    })
    this.wc.on('will-navigate', (e) => {
      if (!/^https?:\/\//i.test(e.url)) e.preventDefault()
    })
    // «¿Seguro que quieres salir?»: se ignora (la pestaña es de Aula)
    this.wc.on('will-prevent-unload', (e) => e.preventDefault())
    // autenticación HTTP (Basic/NTLM): nunca se dan credenciales
    this.wc.on('login', (e, _d, _a, callback) => {
      e.preventDefault()
      callback()
    })
    // ventanas emergentes: nunca; si es una dirección que se puede abrir, se abre en esta misma pestaña
    this.wc.setWindowOpenHandler(({ url }) => {
      const n = normalizeBrowserURL(url)
      if (n.ok && navigationPolicy(n.url, this.account()).decision === 'allow') {
        setImmediate(() => {
          if (!this.closed && !this.wc.isDestroyed()) void this.wc.loadURL(n.url).catch(() => undefined)
        })
      }
      return { action: 'deny' }
    })
    this.win.on('closed', () => {
      this.closed = true
      forgetWebContents(this.id)
      this.onClosed?.()
    })
  }

  whenClosed(fn: () => void): void {
    this.onClosed = fn
  }

  /** Las operaciones de una pestaña van de una en una. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.active++
    this.lastUsed = Date.now()
    const step = (): Promise<T> => fn()
    const next = this.queue.then(step, step).finally(() => {
      this.active--
      this.lastUsed = Date.now()
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Hay una operación en marcha o esperando. */
  get busy(): boolean {
    return this.active > 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.win.destroy()
    } catch { /* ya cerrada */ }
    forgetWebContents(this.id)
  }

  private ensureOpen(): void {
    if (this.closed || this.win.isDestroyed()) throw new AulaError('tab_closed', tr('La pestaña de lectura se cerró; vuelve a abrir la página.', 'The reading tab closed; open the page again.'))
  }

  private exec<T>(code: string, timeoutMs = 15_000): Promise<T> {
    this.ensureOpen()
    return Promise.race([
      this.wc.executeJavaScriptInIsolatedWorld(AULA_WORLD, [{ code }]) as Promise<T>,
      sleep(timeoutMs).then(() => {
        throw new AulaError('timeout', tr('La página no respondió a tiempo.', 'The page didn’t respond in time.'))
      })
    ])
  }

  /** Espera a que la red quede quieta (0 peticiones durante `quietMs`), como mucho `maxMs`. */
  async settle(maxMs = 3000, quietMs = 500): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < maxMs && !this.closed) {
      const s = networkState(this.id)
      if (this.wc.isDestroyed()) return
      if (s.inflight === 0 && Date.now() - s.lastActivity >= quietMs && !this.wc.isLoadingMainFrame()) return
      await sleep(100)
    }
  }

  /** Abre una dirección y espera a que cargue (y a que la red quede quieta). */
  async goto(url: string, timeoutMs = 30_000): Promise<PageInfo> {
    this.ensureOpen()
    this.blocked = false
    let complete = true
    try {
      await Promise.race([
        this.wc.loadURL(url),
        sleep(timeoutMs).then(() => {
          throw new AulaError('timeout', tr('La página tardó demasiado en cargar.', 'The page took too long to load.'))
        })
      ])
    } catch (err) {
      const code = (err as { errno?: number; code?: string }).errno
      if (err instanceof AulaError && err.code === 'timeout') complete = false
      else if (this.blocked || code === ERR_BLOCKED_BY_CLIENT) return this.info(true, true)
      else if (code !== ERR_ABORTED) {
        throw new AulaError('page_failed', tr(
          `No se pudo abrir la página (${(err as Error).message?.slice(0, 120) ?? 'error'}).`,
          `Couldn’t open the page (${(err as Error).message?.slice(0, 120) ?? 'error'}).`
        ))
      }
    }
    await this.settle(complete ? 3000 : 1000)
    return this.info(complete)
  }

  /** Estado de la página: dirección, título, HTTP, muro, ¿hay que iniciar sesión? */
  async info(loadComplete = true, blockedByPolicy = false): Promise<PageInfo> {
    this.ensureOpen()
    const state = await this.exec<PageState | null>(pageStateScript()).catch(() => null)
    const url = state?.url || this.wc.getURL()
    const account = this.account()
    let wall: PageWall | undefined = state?.wall === 'captcha' ? 'captcha' : state?.wall === 'challenge' ? 'challenge' : undefined
    if (!wall && this.httpStatus != null && BLOCKING_STATUSES.has(this.httpStatus)) wall = 'http'
    const auth = account ? classifyAuthPage({ url, account, hasPasswordField: state?.hasPassword, html: state?.htmlHead }) : null
    const needsLogin = auth === 'login' || auth === 'sso' || (!account && !!state?.hasPassword) || (!!account && this.httpStatus === 401)
    return {
      url,
      title: state?.title ?? this.wc.getTitle(),
      ...(this.httpStatus != null ? { httpStatus: this.httpStatus } : {}),
      needsLogin,
      ...(wall ? { wall } : {}),
      loadComplete,
      accountId: this.accountId,
      ...(blockedByPolicy || this.blocked ? { blockedByPolicy: true } : {})
    }
  }

  /** Lectura completa: Markdown de la zona principal, títulos, enlaces y controles con referencias. */
  async snapshot(opts: { full?: boolean; budget?: number; maxElements?: number } = {}): Promise<PageSnapshot> {
    const raw = await this.exec<RawSnapshot | null>(snapshotScript({ start: this.nextRef, budget: opts.budget, maxElements: opts.maxElements, full: opts.full }), 30_000)
    if (!raw) throw new AulaError('page_failed', tr('No se pudo leer la página.', 'Couldn’t read the page.'))
    this.nextRef = Math.max(this.nextRef, raw.nextRef)
    this.elements = new Map(raw.elements.map((e) => [e.ref, e]))
    const info = await this.info()
    return { info, markdown: raw.markdown, truncated: raw.truncated, headings: raw.headings, links: raw.links, elements: raw.elements, usedMain: raw.usedMain }
  }

  /** Artículo según Readability (HTML del contenido) o null si no se puede. */
  async article(): Promise<ArticleResult | null> {
    const lib = readabilityScript()
    if (!lib) return null
    const loaded = await this.exec<boolean>(lib, 15_000).catch(() => false)
    if (!loaded) return null
    return this.exec<ArticleResult | null>(readabilityParseScript(), 20_000).catch(() => null)
  }

  /** El control de la última lectura con esa referencia (o null). */
  element(ref: string): PageElement | null {
    return this.elements.get(ref) ?? null
  }

  /**
   * Pulsa una referencia: comprueba que sigue siendo el mismo control, lo centra y hace clic (de ratón, o desde el DOM si otro
   * elemento lo tapa). Si provoca una navegación, espera a que cargue; si no, a que la red quede quieta.
   */
  async click(ref: string, expected: PageElement): Promise<{ info: PageInfo; navigated: boolean }> {
    this.ensureOpen()
    const loc = await this.exec<{ ok: boolean; err?: string; x?: number; y?: number; covered?: boolean }>(locateRefScript(ref, {
      label: expected.label, href: expected.href, submits: expected.submits, formAction: expected.formAction
    }))
    if (!loc.ok) {
      const why =
        loc.err === 'gone' ? tr('ya no está en la página', 'is no longer on the page')
          : loc.err === 'changed' ? tr('cambió desde la última lectura', 'changed since the last read')
            : loc.err === 'disabled' ? tr('está desactivado', 'is disabled')
              : tr('no se ve', 'isn’t visible')
      throw new AulaError('element_unavailable', tr(`El control ${ref} ${why}: vuelve a leer la página.`, `The control ${ref} ${why}: read the page again.`), { reason: loc.err })
    }
    const before = this.navigations
    if (loc.covered || loc.x == null || loc.y == null) {
      await this.exec(domClickScript(ref))
    } else {
      const x = loc.x
      const y = loc.y
      this.wc.sendInputEvent({ type: 'mouseMove', x, y })
      this.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      this.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }
    await sleep(500)
    const navigated = this.navigations > before || this.wc.isLoadingMainFrame()
    if (navigated) {
      const start = Date.now()
      while (!this.closed && !this.wc.isDestroyed() && this.wc.isLoading() && Date.now() - start < 25_000) await sleep(150)
    }
    await this.settle(navigated ? 3000 : 2000)
    return { info: await this.info(true), navigated }
  }

  async scroll(arg: { ref?: string; direction?: 'down' | 'up' | 'top' | 'bottom'; amount?: number }): Promise<PageInfo> {
    await this.exec(scrollScript(arg))
    await this.settle(1500)
    return this.info()
  }

  /** Espera a que aparezca un texto (o solo `ms`), como mucho 20 s. */
  async wait(opts: { text?: string; ms?: number }): Promise<{ found: boolean; info: PageInfo }> {
    const limit = Math.min(20_000, Math.max(0, opts.ms ?? (opts.text ? 10_000 : 1000)))
    const start = Date.now()
    let found = !opts.text
    if (opts.text) {
      while (Date.now() - start < limit && !this.closed) {
        if (await this.exec<boolean>(hasTextScript(opts.text)).catch(() => false)) {
          found = true
          break
        }
        await sleep(300)
      }
    } else await sleep(limit)
    await this.settle(1500)
    return { found, info: await this.info() }
  }

  /** Captura de lo visible (la ventana sigue oculta). */
  async screenshot(): Promise<NativeImage> {
    this.ensureOpen()
    return this.wc.capturePage(undefined, { stayHidden: true, stayAwake: false })
  }

  /** Dirección actual. */
  url(): string {
    return this.closed ? '' : this.wc.getURL()
  }
}
