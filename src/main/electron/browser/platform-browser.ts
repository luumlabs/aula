// PlatformBrowser: el navegador de Aula para las plataformas de estudio. Lo usan la interfaz (IPC «platforms.*») y las
// herramientas de la IA y de las automatizaciones. Une el controlador de cuentas y sesiones (sin Electron, en
// src/main/services/platforms/controller.ts) con lo de Electron: sesiones persistentes por cuenta, copia y reposición de
// cookies, ventana de inicio de sesión, pestañas de lectura ocultas, descargas y permisos.
//
// Seguridad: Aula solo LEE. Lo que entrega, empieza exámenes, borra, envía mensajes, paga o cierra la sesión no se pulsa ni se
// abre nunca (DangerClassifier + guarda de red); lo demás que no es de lectura pide permiso al estudiante (ApprovalBroker:
// sin respuesta a tiempo = denegado). Las contraseñas no se leen ni se escriben nunca.
import { tr } from '@shared/ai/i18n'
import { app, powerMonitor } from 'electron'
import type { PlatformAccount } from '@shared/settings/platforms'
import type { PlatformAccountView, PlatformApprovalRequest, PlatformApprovalResolution, PlatformCourse, PlatformProbeResult } from '@shared/platforms/types'
import {
  accountAllowsDownloadFrom, accountContains, accountForURL, chunkReading, classifyURL, clickPolicy, directDownloadURL, fencedElements,
  fencedLinks, navigationPolicy, normalizeBrowserURL, pageSummary, preferArticle, BLOCKED_CATEGORIES, type ClickDecision, type PageElement,
  type PageInfo, type PageLink, type PageReading
} from '@engine/platforms'
import { AulaError, invalidArgs } from '@main/services/errors'
import { log } from '@main/services/log'
import { listAccounts, getAccount, requireAccount } from '@main/services/platforms/accounts'
import { PlatformController, type PlatformBrowserAdapter } from '@main/services/platforms/controller'
import type { HttpRequestInit, HttpResponse } from '@main/services/platforms/http'
import type { MoodleClient } from '@main/services/platforms/moodle'
import type { SavedDownload } from '@main/services/platforms/downloads'
import { cleanupPlatformDownloads } from '@main/services/platforms/downloads'
import { htmlToMarkdown, type CanvasClient } from '@main/services/canvas'
import { restoreCookies, snapshotCookies } from './cookies'
import { DownloadManager } from './downloads'
import { sessionFetch } from './fetch'
import { ReaderPool, type TabRef } from './pool'
import { clearPlatformSession, destinationProblem, platformSession, setAccountBaseResolver, setDownloadRouter } from './sessions'
import { openSignInWindow } from './signin'
import type { ReaderTab } from './tab'

/** Dónde y con qué sesión se abre una página. `accountId` sin indicar = la cuenta a la que pertenece la dirección (o ninguna). */
export interface BrowseOptions {
  accountId?: string | null
  /** Pestaña con nombre (por defecto «main»): varias pestañas comparten la sesión de la cuenta. */
  tab?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** El estudiante ya permitió abrir este sitio (la tarjeta «Leer tu plataforma» del chat): no se le vuelve a preguntar. */
  preApproved?: boolean
}

export interface ReadOptions extends BrowseOptions {
  offset?: number
  maxCharacters?: number
  /** 'auto' (por defecto): zona principal o artículo según convenga; 'page': la página; 'article': Readability. */
  mode?: 'auto' | 'page' | 'article'
  /** Leer toda la página y no solo la zona principal. */
  full?: boolean
}

export interface PageReadingResult extends PageReading {
  links: PageLink[]
  elements: PageElement[]
  /** Controles para la IA (con la política fuera de la valla). */
  elementsFenced: string
}

export interface ClickResult {
  element: PageElement
  page: PageInfo
  navigated: boolean
  /** El estudiante tuvo que aprobarlo. */
  approved: boolean
  download?: SavedDownload
  downloadError?: string
  /** Resumen para la IA (notas + dirección y título con valla). */
  summary: string
}

export interface ScreenshotResult {
  data: Buffer
  mimeType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  page: PageInfo
}

export interface DownloadRequest {
  accountId?: string | null
  /** Carpeta de destino (por defecto, la temporal de la cuenta en la caché de Aula). */
  dir?: string
  maxBytes?: number
  timeoutMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function blocked(d: Exclude<ClickDecision, { decision: 'allow' }>): AulaError {
  return new AulaError('blocked', tr(`Aula no hace eso: ${d.reason}`, `Aula won’t do that: ${d.reason}`), { category: d.category, aiReason: d.aiReason })
}

function denied(d: Exclude<ClickDecision, { decision: 'allow' }>): AulaError {
  return new AulaError('denied', tr('El estudiante no dio permiso (o no contestó a tiempo).', 'The student didn’t allow it (or didn’t answer in time).'), {
    category: d.category, aiReason: "The student did not approve it (or did not answer in time). Do not retry; continue without it."
  })
}

export class PlatformBrowser {
  readonly controller: PlatformController
  private readonly pool: ReaderPool
  private readonly downloads = new DownloadManager()
  private readonly watched = new Set<string>()
  private started = false
  private quitting = false

  constructor() {
    this.pool = new ReaderPool((id) => getAccount(id))
    setDownloadRouter((accountId, item, wc) => this.downloads.route(accountId, item, wc))
    setAccountBaseResolver((id) => getAccount(id)?.baseURL ?? null)
    const adapter: PlatformBrowserAdapter = {
      sessionFetch: (id) => {
        this.watch(id)
        return sessionFetch(platformSession(id))
      },
      snapshotCookies: (a) => snapshotCookies(a),
      restoreCookies: (a) => {
        this.watch(a.id)
        return restoreCookies(a)
      },
      clearSession: (id) => clearPlatformSession(id),
      openSignIn: (a, hooks) => {
        this.watch(a.id)
        return openSignInWindow({ account: a, verify: hooks.verify, onSuccess: hooks.onSuccess })
      },
      silentSignIn: (a) => this.silentSignIn(a),
      closeAccountTabs: (id) => this.pool.closeAccount(id)
    }
    this.controller = new PlatformController(adapter)
  }

  /** Avisa al controlador cuando cambian las cookies de una cuenta (para guardar la copia a tiempo). */
  private watch(accountId: string): void {
    if (this.watched.has(accountId)) return
    this.watched.add(accountId)
    platformSession(accountId).cookies.on('changed', () => this.controller.markCookiesChanged(accountId))
  }

  // MARK: Ciclo de vida

  /** Arranque: repone cookies, empieza a mantener las sesiones y limpia descargas viejas. Idempotente. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    powerMonitor.on('resume', () => this.controller.resume())
    powerMonitor.on('unlock-screen', () => this.controller.resume())
    try {
      cleanupPlatformDownloads()
    } catch { /* sin importancia */ }
    await this.controller.start()
  }

  /** Antes de salir: copia final de las cookies (tope 3 s) y se cierra todo. */
  async shutdown(): Promise<void> {
    if (this.quitting) return
    this.quitting = true
    this.downloads.cancelAll()
    this.pool.closeAll()
    await this.controller.shutdown(3000)
  }

  // MARK: Cuentas (lo que usan la interfaz y las herramientas)

  listAccounts(): PlatformAccountView[] {
    return this.controller.list()
  }

  account(accountId: string): PlatformAccount {
    return requireAccount(accountId)
  }

  /** La cuenta a la que pertenece una dirección (o null). */
  accountForURL(url: string): PlatformAccount | null {
    return accountForURL(listAccounts(), url)
  }

  probe(url: string): Promise<PlatformProbeResult> {
    return this.controller.probe(url)
  }

  /** ¿Hay sesión? Si no, intenta volver a entrar sola y, si hace falta y `interactive`, abre la ventana de acceso y espera. */
  ensureSignedIn(accountId: string, opts: { interactive?: boolean; maxAgeMs?: number } = {}): Promise<boolean> {
    return this.controller.ensureSignedIn(accountId, opts)
  }

  signIn(accountId: string): Promise<{ signedIn: boolean; account: PlatformAccountView }> {
    return this.controller.signIn(accountId)
  }

  /** «Ya he iniciado sesión»: se vuelve a comprobar ya (y la ventana se cierra sola si es así). */
  confirmSignIn(accountId: string): Promise<{ signedIn: boolean; account: PlatformAccountView }> {
    return this.controller.confirmSignIn(accountId)
  }

  /**
   * La cuenta en la que hay que iniciar sesión para una dirección: la suya; si es una del SSO (la IA a veces da la del
   * proveedor de identidad), la de la página que la pestaña tenía abierta; y si solo hay una candidata, esa.
   */
  accountForSignIn(url: string, opts: { tab?: string; accountIds?: string[] } = {}): PlatformAccount | null {
    const all = listAccounts().filter((a) => !opts.accountIds || opts.accountIds.includes(a.id))
    const direct = accountForURL(all, url)
    if (direct) return direct
    const tab = opts.tab ? this.pool.latest(opts.tab) : null
    const fromTab = tab?.accountId ? all.find((a) => a.id === tab.accountId) : undefined
    if (fromTab) return fromTab
    return all.length === 1 ? all[0] : null
  }

  /** Inicio de sesión pedido con una dirección (herramientas de la IA). false si no hay cuenta para ella. */
  async signInForURL(url: string, opts: { tab?: string; accountIds?: string[] } = {}): Promise<boolean> {
    const acc = this.accountForSignIn(url, opts)
    if (!acc) return false
    return (await this.signIn(acc.id)).signedIn
  }

  /** Petición con la sesión de la cuenta (APIs JSON de la plataforma): solo GET/HEAD y solo a sus sitios. */
  fetchWithSession(accountId: string, url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    return this.controller.fetchWithSession(accountId, url, init)
  }

  /** Cliente de Canvas con la sesión (o con el token, si el estudiante lo configuró). */
  canvas(accountId: string): CanvasClient {
    return this.controller.canvas(accountId)
  }

  /** Cliente de Moodle con la sesión (sesskey + /lib/ajax/service.php, solo funciones de lectura). */
  moodle(accountId: string): MoodleClient {
    return this.controller.moodle(accountId)
  }

  courses(accountId: string): Promise<PlatformCourse[]> {
    return this.controller.courses(accountId)
  }

  /** Enlace privado del calendario (.ics) para el motor del calendario (nunca sale del proceso principal). */
  calendarURL(accountId: string): string | null {
    return this.controller.calendarURL(accountId)
  }

  approvals(): PlatformApprovalRequest[] {
    return this.controller.approvals.list()
  }

  approve(id: string, allow: boolean): boolean {
    return this.controller.approvals.respond(id, allow)
  }

  onApproval(fn: (e: { request: PlatformApprovalRequest } | { resolved: PlatformApprovalResolution }) => void): () => void {
    const a = this.controller.approvals.onRequest((request) => fn({ request }))
    const b = this.controller.approvals.onResolved((resolved) => fn({ resolved }))
    return () => {
      a()
      b()
    }
  }

  // MARK: Páginas

  private resolveAccount(accountId: string | null | undefined, url: string): PlatformAccount | null {
    if (accountId === null) return null
    if (typeof accountId === 'string') return requireAccount(accountId)
    return accountForURL(listAccounts(), url)
  }

  private existingTab(opts: BrowseOptions): ReaderTab {
    const t = opts.accountId === undefined ? this.pool.latest(opts.tab) : this.pool.peek({ accountId: opts.accountId, tab: opts.tab })
    if (!t) throw new AulaError('no_page', tr('No hay ninguna página abierta en esa pestaña: ábrela primero (read/open con una dirección).', 'There’s no page open in that tab: open one first (read/open with an address).'))
    return t
  }

  /** Pide permiso si la decisión lo exige; lanza si se bloquea o se deniega. */
  private async authorize(d: ClickDecision, ask: { accountId: string | null; action: 'click' | 'navigate' | 'download' | 'submit'; label: string; url?: string; pageURL?: string }, signal?: AbortSignal): Promise<boolean> {
    if (d.decision === 'allow') return false
    if (d.decision === 'block') throw blocked(d)
    const ok = await this.controller.approvals.request({ ...ask, category: d.category, reason: d.reason }, undefined, signal)
    if (!ok) throw denied(d)
    return true
  }

  /** Navega una pestaña (con la política de navegación) y apunta si la página pide iniciar sesión. */
  private async navigate(tab: ReaderTab, url: string, account: PlatformAccount | null, opts: BrowseOptions): Promise<PageInfo> {
    const policy = navigationPolicy(url, account)
    const already = opts.preApproved && policy.decision === 'ask' && policy.category === 'offsite'
    if (!already) await this.authorize(policy, { accountId: account?.id ?? null, action: 'navigate', label: url, url, pageURL: tab.url() || undefined }, opts.signal)
    await this.checkDestination(account?.id ?? null, url)
    const info = await tab.goto(url, Math.min(Math.max(5000, opts.timeoutMs ?? 30_000), 90_000))
    this.afterPage(info)
    return info
  }

  /** Nunca este equipo ni la red local (lo corta también la sesión en cada petición; aquí, con un error claro). */
  private async checkDestination(accountId: string | null, url: string): Promise<void> {
    const why = await destinationProblem(accountId, url)
    if (why) {
      throw new AulaError('blocked', tr(`Aula no abre direcciones de este ordenador ni de la red local: ${why}`, `Aula doesn’t open addresses on this computer or the local network: ${why}`), {
        category: 'private', aiReason: 'Blocked: the address is on this computer or the local network (router, local servers, cloud metadata). Aula never opens those.'
      })
    }
  }

  /** Una página de una cuenta que pide iniciar sesión: se confirma con la comprobación (y se avisa a la interfaz). */
  private afterPage(info: PageInfo): void {
    if (info.accountId && info.needsLogin) this.controller.suspectSignedOut(info.accountId)
  }

  private prepare(url: string, opts: BrowseOptions): { url: string; account: PlatformAccount | null; tab: ReaderTab } {
    const n = normalizeBrowserURL(url)
    if (!n.ok) throw invalidArgs(n.error === 'forbidden_scheme' ? tr('Solo se abren direcciones web (http/https).', 'Only web addresses (http/https) can be opened.') : tr('La dirección no es válida.', 'That address isn’t valid.'))
    const account = this.resolveAccount(opts.accountId, n.url)
    const tab = this.pool.get({ accountId: account?.id ?? null, tab: opts.tab })
    return { url: n.url, account, tab }
  }

  /** Abre una dirección en una pestaña oculta (con la sesión de su cuenta) y devuelve su estado. */
  async open(url: string, opts: BrowseOptions = {}): Promise<PageInfo & { summary: string }> {
    const p = this.prepare(url, opts)
    const info = await p.tab.run(() => this.navigate(p.tab, p.url, p.account, opts))
    return { ...info, summary: pageSummary(info) }
  }

  /**
   * Lee una página en Markdown, por trozos (`offset`/`maxCharacters`), con sus títulos, enlaces y controles ([eN]). Con `url`
   * null se lee la página actual de la pestaña.
   */
  async read(url: string | null, opts: ReadOptions = {}): Promise<PageReadingResult> {
    const p = url ? this.prepare(url, opts) : null
    const tab = p ? p.tab : this.existingTab(opts)
    return tab.run(async () => {
      if (p) await this.navigate(tab, p.url, p.account, opts)
      const snap = await tab.snapshot({ full: opts.full })
      let markdown = snap.markdown
      let source: 'page' | 'article' = 'page'
      const mode = opts.mode ?? 'auto'
      if (mode === 'article' || (mode === 'auto' && !snap.usedMain)) {
        const art = await tab.article()
        if (art?.html) {
          const md = htmlToMarkdown(art.html, snap.info.url)
          if (preferArticle({ pageChars: markdown.length, articleChars: md.length, usedMain: snap.usedMain, mode })) {
            markdown = (art.title ? `# ${art.title}\n\n` : '') + md
            source = 'article'
          }
        }
      }
      this.afterPage(snap.info)
      const notes = snap.truncated ? ['The page text was cut (very long page).'] : []
      const reading = chunkReading(markdown, snap.info, { offset: opts.offset, maxCharacters: opts.maxCharacters, source, headings: snap.headings, extraNotes: notes })
      const account = tab.accountId ? getAccount(tab.accountId) : null
      return {
        ...reading,
        links: snap.links,
        elements: snap.elements,
        elementsFenced: fencedElements(snap.elements, (el) => clickPolicy(el, { pageURL: snap.info.url, account, dialogText: el.dialogText || undefined }))
      }
    })
  }

  /** Enlaces de una página (texto + dirección absoluta + referencia). */
  async links(url: string | null, opts: BrowseOptions = {}): Promise<{ page: PageInfo; links: PageLink[]; fenced: string }> {
    const p = url ? this.prepare(url, opts) : null
    const tab = p ? p.tab : this.existingTab(opts)
    return tab.run(async () => {
      if (p) await this.navigate(tab, p.url, p.account, opts)
      const snap = await tab.snapshot({ full: true, budget: 2000 })
      return { page: snap.info, links: snap.links, fenced: fencedLinks(snap.links) }
    })
  }

  /**
   * Pulsa un control por su referencia de la última lectura. Lo peligroso no se pulsa nunca; lo que no es de lectura pide
   * permiso al estudiante (sin respuesta = no). Si el clic descarga un archivo, se guarda con las reglas de seguridad.
   */
  async click(ref: string, opts: BrowseOptions & { downloadDir?: string } = {}): Promise<ClickResult> {
    if (typeof ref !== 'string' || !/^e\d{1,7}$/.test(ref.trim().replace(/^\[|\]$/g, ''))) throw invalidArgs(tr('Referencia no válida (p. ej. «e12»).', 'Invalid reference (e.g. “e12”).'))
    const r = ref.trim().replace(/^\[|\]$/g, '')
    const tab = this.existingTab(opts)
    return tab.run(async () => {
      const el = tab.element(r)
      if (!el) throw new AulaError('element_unknown', tr(`No conozco el control ${r}: lee la página de nuevo.`, `I don’t know control ${r}: read the page again.`))
      const account = tab.accountId ? getAccount(tab.accountId) : null
      const pageURL = tab.url()
      // un «Sí / OK / Aceptar» dentro de un modal hereda el peligro del texto del modal («¿Entregar el examen?»)
      const d = clickPolicy(el, { pageURL, account, dialogText: el.dialogText || undefined })
      const approved = await this.authorize(d, {
        accountId: tab.accountId, action: el.submits ? 'submit' : 'click', label: el.label || el.href || r,
        url: el.href || el.formAction || undefined, pageURL
      }, opts.signal)
      const dl = this.downloads.expectFromWebContents(tab.id, tab.accountId, { dir: opts.downloadDir })
      const blockedBefore = tab.blockedRequests
      let res: { info: PageInfo; navigated: boolean }
      try {
        res = await tab.click(r, el)
      } catch (err) {
        dl.cancel()
        throw err
      }
      if (!dl.started()) await sleep(400)
      let download: SavedDownload | undefined
      let downloadError: string | undefined
      if (dl.started()) {
        try {
          download = await dl.promise
        } catch (err) {
          downloadError = err instanceof Error ? err.message : String(err)
          if (err instanceof AulaError && err.code === 'needs_sign_in' && tab.accountId) this.controller.suspectSignedOut(tab.accountId)
        }
      } else dl.cancel()
      this.afterPage(res.info)
      const extra = download ? [`A download was saved (${download.bytes} bytes).`] : downloadError ? [`The click started a download that was not saved: ${downloadError}`] : []
      const cut = tab.blockedRequests - blockedBefore
      if (cut > 0) extra.push(`Aula's safety guard blocked ${cut} background request(s) of the page that would change something on the platform (submit, post, mark done, vote, save, delete or sign out). Nothing was sent: Aula only reads.`)
      return { element: el, page: res.info, navigated: res.navigated, approved, ...(download ? { download } : {}), ...(downloadError ? { downloadError } : {}), summary: [pageSummary(res.info), ...extra].join('\n') }
    })
  }

  async scroll(opts: BrowseOptions & { ref?: string; direction?: 'down' | 'up' | 'top' | 'bottom'; amount?: number }): Promise<PageInfo> {
    const tab = this.existingTab(opts)
    return tab.run(() => tab.scroll({ ref: opts.ref, direction: opts.direction, amount: opts.amount }))
  }

  async wait(opts: BrowseOptions & { text?: string; ms?: number }): Promise<{ found: boolean; page: PageInfo }> {
    const tab = this.existingTab(opts)
    const r = await tab.run(() => tab.wait({ text: opts.text, ms: opts.ms }))
    return { found: r.found, page: r.info }
  }

  /** Captura de la página actual de la pestaña (PNG por defecto; JPEG para ahorrar). */
  async screenshot(opts: BrowseOptions & { format?: 'png' | 'jpeg'; quality?: number } = {}): Promise<ScreenshotResult> {
    const tab = this.existingTab(opts)
    return tab.run(async () => {
      const img = await tab.screenshot()
      if (img.isEmpty()) throw new AulaError('screenshot_failed', tr('No se pudo capturar la página.', 'Couldn’t capture the page.'))
      const { width, height } = img.getSize()
      const jpeg = opts.format === 'jpeg'
      const data = jpeg ? img.toJPEG(Math.max(30, Math.min(95, opts.quality ?? 80))) : img.toPNG()
      return { data, mimeType: jpeg ? 'image/jpeg' : 'image/png', width, height, page: await tab.info() }
    })
  }

  closeTab(opts: TabRef): void {
    this.pool.close(opts)
  }

  /**
   * Descarga un archivo con la sesión de su cuenta (los enlaces de página de archivo de Canvas, Moodle, Brightspace, Drive o
   * SharePoint se convierten en la descarga directa). Fuera de los sitios de la cuenta pide permiso.
   */
  async download(url: string, opts: DownloadRequest = {}): Promise<SavedDownload> {
    const n = normalizeBrowserURL(url)
    if (!n.ok) throw invalidArgs(tr('La dirección no es válida.', 'That address isn’t valid.'))
    const target = directDownloadURL(n.url) ?? n.url
    const account = this.resolveAccount(opts.accountId, target) ?? this.resolveAccount(opts.accountId, n.url)
    const danger = classifyURL(target)
    if (danger && (danger.forbidden || BLOCKED_CATEGORIES.has(danger.category))) {
      throw blocked({ decision: 'block', category: danger.category, reason: danger.reason, aiReason: `Blocked: ${danger.aiReason}.` })
    }
    if (account && !accountAllowsDownloadFrom(account, target) && !accountContains(account, n.url)) {
      await this.authorize({ decision: 'ask', category: 'offsite', reason: tr('Descargaría un archivo de otro sitio.', 'It would download a file from another site.'), aiReason: "Needs the student's approval: the file is outside the study platform." },
        { accountId: account.id, action: 'download', label: target, url: target }, opts.signal)
    }
    // sin cuenta: no es de ninguna plataforma del estudiante (la dirección misma podría llevarse datos): con permiso
    if (!account) {
      await this.authorize({ decision: 'ask', category: 'offsite', reason: tr('Descargaría un archivo de un sitio que no es de tus plataformas.', 'It would download a file from a site that isn’t one of your platforms.'), aiReason: "Needs the student's approval: the file is not on one of the student's study platforms." },
        { accountId: null, action: 'download', label: target, url: target }, opts.signal)
    }
    await this.checkDestination(account?.id ?? null, target)
    const ses = platformSession(account?.id ?? null)
    try {
      return await this.downloads.download(ses, account?.id ?? null, target, { dir: opts.dir, maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs })
    } catch (err) {
      if (account && err instanceof AulaError && err.code === 'needs_sign_in') this.controller.suspectSignedOut(account.id)
      throw err
    }
  }

  // MARK: Volver a entrar sola

  /**
   * Abre la plataforma en una pestaña oculta y deja que el SSO (SAML/OIDC) vuelva solo si la sesión del proveedor sigue viva.
   * Nunca escribe ni pulsa: si la página se queda pidiendo contraseña o una elección, se rinde (lo hará el estudiante).
   */
  private async silentSignIn(account: PlatformAccount): Promise<boolean> {
    if (this.quitting) return false
    const ref = { accountId: account.id, tab: '__silent' }
    const tab = this.pool.get(ref)
    try {
      return await tab.run(async () => {
        try {
          await tab.goto(account.baseURL, 30_000)
        } catch {
          return false
        }
        const start = Date.now()
        let last = ''
        let stableSince = Date.now()
        while (Date.now() - start < 25_000 && !tab.closed) {
          const info = await tab.info()
          if (info.url !== last) {
            last = info.url
            stableSince = Date.now()
          }
          const quiet = Date.now() - stableSince
          if (info.blockedByPolicy) return false
          if (accountContains(account, info.url) && !info.needsLogin && !info.wall && quiet >= 1500) return true
          if ((info.needsLogin || info.wall) && quiet >= 4000) return false
          await sleep(700)
        }
        return false
      })
    } catch (err) {
      log.debug(`[platforms] reentrada sin ventana (${account.id}):`, err instanceof Error ? err.message : String(err))
      return false
    } finally {
      this.pool.close(ref)
    }
  }
}

let instance: PlatformBrowser | null = null

/** El navegador de plataformas de la app (uno solo). Necesita que Electron esté listo. */
export function platformBrowser(): PlatformBrowser {
  if (!instance) instance = new PlatformBrowser()
  return instance
}

/** Al salir de la app: copia final de las cookies antes de cerrar (una sola vez, con tope de tiempo).
 *  Empieza en cuanto se pide salir y la salida la espera justo al final (`will-quit`). Antes se cancelaba `before-quit` y se
 *  volvía a llamar a app.quit(): con un SIGTERM (kill, cierre de sesión, herramientas) esa segunda salida no llegaba a
 *  terminar y Aula seguía viva (J4-11). */
export function installQuitHook(browser: PlatformBrowser): void {
  let pending: Promise<void> | null = null
  let done = false
  const start = (): Promise<void> => (pending ??= browser.shutdown().catch((err) => log.warn('[platforms] al salir:', err)))
  app.on('before-quit', () => void start())
  app.on('will-quit', (e) => {
    if (done) return
    e.preventDefault()
    const cap = new Promise<void>((r) => setTimeout(r, 4000))
    // app.exit y no app.quit: los demás «will-quit» ya han corrido (no se repiten) y «quit» sigue emitiéndose (actualizaciones)
    void Promise.race([start(), cap]).finally(() => {
      done = true
      app.exit(0)
    })
  })
}
