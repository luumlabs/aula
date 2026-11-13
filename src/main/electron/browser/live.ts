// El navegador de Aula «en vivo» (shared/live/types.ts): una ventana oculta del Mac con la sesión de una plataforma, que
// se ve imagen a imagen en la app (también desde el iPad o el iPhone del estudiante) y se maneja con el dedo o el ratón.
//  · Las imágenes se sacan solo mientras alguien mira (cada petición espera a que la página cambie).
//  · Lo que hace el estudiante entra por el protocolo de depuración de Chromium (ratón, rueda, texto, teclas): funciona
//    con la ventana oculta, y la página cree que tiene el foco (el cursor de texto parpadea).
//  · El turno: `student` maneja; `aula` solo lee (texto y respuestas, nunca contraseñas ni datos de pago). Aula aquí no
//    pulsa ni escribe: nunca hace la tarea ni la envía.
import { BrowserWindow, type WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { LiveFields, LiveFocus, LiveFrame, LiveInput, LivePurpose, LiveReading, LiveState } from '@shared/live/types'
import type { PlatformAccount } from '@shared/settings/platforms'
import { DEFAULT_VIEWPORT, KEY_CODES, clampViewport, fieldKind, frameSize, sanitizeLiveInput, toPoint } from '@engine/live/input'
import { normalizeBrowserURL } from '@engine/platforms'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '@main/services/errors'
import { log } from '@main/services/log'
import { getAccount } from '@main/services/platforms/accounts'
import { AULA_WORLD } from './scripts'
import { forgetWebContents, partitionFor, platformSession, safeOrigin } from './sessions'

/** Sin nadie mirando ni tocando durante este tiempo, la ventana se cierra sola (la sesión queda guardada). */
const IDLE_MS = 20 * 60_000
/** Lo que espera una petición de imagen a que la página cambie. */
const FRAME_WAIT_MS = 2500
const FRAME_POLL_MS = 180
const JPEG_QUALITY = 64
const READ_LIMIT = 24_000

export interface LiveHooks {
  changed(state: LiveState): void
  closed(id: string): void
  focus(focus: LiveFocus): void
  fields(fields: LiveFields): void
}

/** Solo páginas web. (Este equipo y la red local ya los corta la sesión de plataformas en cada petición: sessions.ts.) */
const blocked = (url: string): boolean => !/^https?:\/\//i.test(url)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function startURLFor(account: PlatformAccount | null): string {
  if (!account) return 'about:blank'
  switch (account.kind) {
    case 'classroom': return 'https://classroom.google.com/'
    case 'teams': return 'https://teams.microsoft.com/'
    default: return account.baseURL
  }
}

/** En la página: en qué campo quedó el cursor (tipo y pistas), sin leer su contenido. */
const FOCUS_SCRIPT = `(() => { const e = document.activeElement; if (!e) return null; const tag = e.tagName; const editable = tag === 'TEXTAREA' || e.isContentEditable || (tag === 'INPUT' && !['button','submit','checkbox','radio','file','image','reset','range','color'].includes((e.type || 'text').toLowerCase())); return { editable, type: tag === 'INPUT' ? (e.type || 'text') : 'text', inputMode: e.inputMode || '', autocomplete: e.autocomplete || '' } })()`

/** En la página: dónde están los campos de escribir que se ven (fracciones de la página), sin leer su contenido. */
const FIELDS_SCRIPT = `(() => { const W = innerWidth || 1, H = innerHeight || 1, out = []; for (const e of document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]')) { if (out.length >= 60) break; if (e.tagName === 'INPUT' && ['button','submit','checkbox','radio','file','image','reset','range','color','hidden'].includes((e.type || 'text').toLowerCase())) continue; const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue; out.push([r.left / W, r.top / H, r.width / W, r.height / H]) } return out })()`

/**
 * En la página: su texto visible y lo que el estudiante ha escrito o elegido (campo a campo, con su etiqueta). Los campos
 * privados (contraseñas, códigos, pago, ocultos) no se leen: solo se dice que existen.
 */
const READ_SCRIPT = `(() => {
  const priv = (el) => { const t = (el.type || '').toLowerCase(); const h = ((el.autocomplete || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase(); return t === 'password' || t === 'hidden' || /password|passwd|one-time-code|otp|cc-|card|cvv|cvc|iban|ssn|secret|token/.test(h) }
  const labelOf = (el) => { let s = ''; if (el.labels && el.labels.length) s = el.labels[0].innerText; if (!s) s = el.getAttribute('aria-label') || el.placeholder || el.name || el.id || ''; if (!s) { const p = el.closest('fieldset, .question, [role=group], li, tr, p, div'); if (p) s = (p.innerText || '').split('\\n')[0] } return String(s).replace(/\\s+/g, ' ').trim().slice(0, 160) }
  const fields = []
  for (const el of document.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    if (fields.length >= 120) break
    const tag = el.tagName
    const type = tag === 'INPUT' ? (el.type || 'text').toLowerCase() : tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textarea' : 'text'
    if (['button', 'submit', 'reset', 'image', 'file'].includes(type)) continue
    if (tag !== 'INPUT' || type !== 'hidden') { const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue }
    if (priv(el)) { if (type !== 'hidden') fields.push({ label: labelOf(el), kind: 'private', value: '' }); continue }
    let value = ''
    if (type === 'checkbox' || type === 'radio') { if (!el.checked) continue; value = el.value && el.value !== 'on' ? el.value : 'x' }
    else if (tag === 'SELECT') value = Array.from(el.selectedOptions).map((o) => o.text).join(', ')
    else if (tag === 'INPUT' || tag === 'TEXTAREA') value = el.value
    else value = el.innerText
    value = String(value || '').trim()
    if (!value) continue
    fields.push({ label: labelOf(el), kind: type, value: value.slice(0, 4000) })
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n'), fields }
})()`

class LiveView {
  readonly win: BrowserWindow
  readonly wc: WebContents
  holder: LiveState['holder'] = 'student'
  controlId = randomUUID()
  purpose: LivePurpose
  note: string | undefined
  lastUsed = Date.now()
  closed = false
  private size = { ...DEFAULT_VIEWPORT }
  private seq = 0
  private lastHash = ''
  private capturing: Promise<{ hash: string; jpeg: Buffer; w: number; h: number } | null> | null = null
  private last: { jpeg: Buffer; w: number; h: number; maxWidth: number } | null = null
  private attached = false
  private fieldsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly id: string, readonly accountId: string | null, purpose: LivePurpose, private readonly hooks: LiveHooks) {
    this.purpose = purpose
    platformSession(accountId)
    this.win = new BrowserWindow({
      show: false,
      width: this.size.width,
      height: this.size.height,
      useContentSize: true,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: true,
      title: 'Aula (en vivo)',
      webPreferences: {
        partition: partitionFor(accountId),
        preload: join(__dirname, '../preload/browser.js'),
        // guarda de las llaves de acceso: en una ventana oculta que se maneja desde el móvil no hay interfaz de passkeys
        additionalArguments: ['--aula-live'],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        backgroundThrottling: false,
        navigateOnDragDrop: false,
        webviewTag: false,
        safeDialogs: true
      }
    })
    this.wc = this.win.webContents
    this.wc.setAudioMuted(true)
    const bump = (): void => { if (!this.closed) this.hooks.changed(this.state()) }
    this.wc.on('did-navigate', bump)
    this.wc.on('did-navigate-in-page', bump)
    this.wc.on('page-title-updated', bump)
    this.wc.on('did-start-loading', bump)
    this.wc.on('did-stop-loading', bump)
    this.wc.on('did-stop-loading', () => this.scheduleFields())
    this.wc.on('did-navigate-in-page', () => this.scheduleFields())
    this.wc.on('will-navigate', (e) => { if (blocked(e.url)) e.preventDefault() })
    this.wc.on('will-redirect', (e) => { if (blocked(e.url)) e.preventDefault() })
    this.wc.on('will-prevent-unload', (e) => e.preventDefault())
    // autenticación HTTP (Basic/NTLM): no hay dónde pedirla en la imagen; se cancela
    this.wc.on('login', (e, _d, _a, callback) => { e.preventDefault(); callback() })
    // ventanas emergentes (el «Continuar con Google» de un acceso): en esta misma ventana, que es la que se ve
    this.wc.setWindowOpenHandler(({ url }) => {
      const n = normalizeBrowserURL(url)
      if (n.ok && !blocked(n.url)) setImmediate(() => { if (!this.closed && !this.wc.isDestroyed()) void this.wc.loadURL(n.url).catch(() => undefined) })
      return { action: 'deny' }
    })
    const wcId = this.wc.id
    this.win.on('closed', () => {
      this.closed = true
      forgetWebContents(wcId)
      this.hooks.closed(this.id)
    })
  }

  state(): LiveState {
    const dead = this.closed || this.wc.isDestroyed()
    return {
      id: this.id, accountId: this.accountId, url: dead ? '' : this.wc.getURL(), title: dead ? '' : this.wc.getTitle(), holder: this.holder, controlId: this.controlId,
      purpose: this.purpose, loading: dead ? false : this.wc.isLoading(), canGoBack: dead ? false : this.wc.navigationHistory.canGoBack(), canGoForward: dead ? false : this.wc.navigationHistory.canGoForward(),
      width: this.size.width, height: this.size.height, ...(this.note ? { note: this.note } : {})
    }
  }

  private touch(): void { this.lastUsed = Date.now() }

  /** El protocolo de depuración: entrada que funciona con la ventana oculta, y la página cree que tiene el foco. */
  private async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.attached) {
      try {
        this.wc.debugger.attach('1.3')
        this.attached = true
        this.wc.debugger.on('detach', () => { this.attached = false })
        await this.wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      } catch (err) {
        this.attached = this.wc.debugger.isAttached()
        if (!this.attached) throw err
      }
    }
    return this.wc.debugger.sendCommand(method, params)
  }

  async goto(url: string): Promise<void> {
    this.touch()
    await this.wc.loadURL(url).catch((err: unknown) => {
      // una navegación que corta a otra (redirecciones del acceso) no es un fallo; al registro, sin la dirección (lleva el
      // estado del SSO en la consulta): el código y el origen
      const e = (err ?? {}) as { errno?: number; code?: string; url?: string }
      if (e.code === 'ERR_ABORTED' || e.errno === -3) return
      log.debug(`[en vivo] no se pudo abrir: ${e.code ?? e.errno ?? 'error'}${e.url ? ` ${safeOrigin(e.url)}` : ''}`)
    })
  }

  setViewport(width: unknown, height: unknown): void {
    this.touch()
    const next = clampViewport(width, height)
    if (next.width === this.size.width && next.height === this.size.height) return
    this.size = next
    this.win.setContentSize(next.width, next.height)
    this.lastHash = ''
    this.hooks.changed(this.state())
    this.scheduleFields()
  }

  private capture(maxWidth: number): Promise<{ hash: string; jpeg: Buffer; w: number; h: number } | null> {
    // una sola captura a la vez, aunque miren dos dispositivos
    this.capturing ??= (async () => {
      try {
        const image = await this.wc.capturePage(undefined, { stayHidden: true, stayAwake: false })
        if (image.isEmpty()) return null
        const { w, h } = frameSize(this.size, maxWidth)
        const jpeg = image.resize({ width: w, height: h, quality: 'good' }).toJPEG(JPEG_QUALITY)
        return { hash: createHash('sha1').update(jpeg).digest('base64'), jpeg, w, h }
      } catch { return null } finally { this.capturing = null }
    })()
    return this.capturing
  }

  /** La siguiente imagen distinta de la número `after` (o null si en un rato la página no cambió). */
  async frame(after: number, maxWidth: number): Promise<LiveFrame | null> {
    this.touch()
    // quien llega ahora (o cambió de tamaño) recibe la última sin esperar
    if (this.last && after < this.seq && this.last.maxWidth === maxWidth) return { seq: this.seq, mime: 'image/jpeg', data: this.last.jpeg.toString('base64'), w: this.last.w, h: this.last.h }
    const deadline = Date.now() + FRAME_WAIT_MS
    for (;;) {
      if (this.closed) return null
      const shot = await this.capture(maxWidth)
      if (shot && (shot.hash !== this.lastHash || after < 0)) {
        if (shot.hash !== this.lastHash) { this.lastHash = shot.hash; this.seq++ }
        this.last = { jpeg: shot.jpeg, w: shot.w, h: shot.h, maxWidth }
        return { seq: this.seq, mime: 'image/jpeg', data: shot.jpeg.toString('base64'), w: shot.w, h: shot.h }
      }
      if (Date.now() >= deadline) return null
      await sleep(FRAME_POLL_MS)
    }
  }

  private modifiers(e: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean }): number {
    return (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.meta ? 4 : 0) | (e.shift ? 8 : 0)
  }

  /** Aplica lo que hizo el estudiante. Devuelve cuántos eventos se aplicaron. */
  async input(events: LiveInput[]): Promise<number> {
    this.touch()
    let applied = 0
    let tapped = false
    for (const e of events) {
      if (this.closed) break
      try {
        switch (e.type) {
          case 'tap': {
            const p = toPoint(e.x, e.y, this.size)
            const clickCount = e.count ?? 1
            await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
            await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount })
            await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount })
            tapped = true
            break
          }
          case 'wheel': {
            const p = toPoint(e.x, e.y, this.size)
            await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: e.dx, deltaY: e.dy })
            break
          }
          case 'text':
            await this.cdp('Input.insertText', { text: e.text })
            break
          case 'key': {
            const named = KEY_CODES[e.key]
            const modifiers = this.modifiers(e)
            if (named) {
              const code = e.key === 'Space' ? 'Space' : e.key
              const key = e.key === 'Space' ? ' ' : e.key
              const vk = VIRTUAL_KEYS[e.key] ?? 0
              const text = e.key === 'Enter' ? '\r' : e.key === 'Space' ? ' ' : e.key === 'Tab' ? '' : undefined
              await this.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text ? { text, unmodifiedText: text } : {}) })
              await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
            } else if (modifiers & 6) {
              // un atajo (⌘A, Ctrl+C…): la tecla sin texto, con sus modificadores
              const vk = e.key.toUpperCase().charCodeAt(0)
              await this.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: e.key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(SHORTCUT_COMMANDS[e.key.toLowerCase()] ? { commands: [SHORTCUT_COMMANDS[e.key.toLowerCase()]] } : {}) })
              await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: e.key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
            } else {
              await this.cdp('Input.insertText', { text: e.key })
            }
            break
          }
        }
        applied++
      } catch (err) {
        log.debug('[en vivo] entrada no aplicada', String(err).slice(0, 160))
      }
    }
    if (tapped) void this.reportFocus()
    if (applied) this.scheduleFields()
    return applied
  }

  /** Tras un toque: en qué campo quedó el cursor (para el teclado del dispositivo). Nunca su contenido. */
  private async reportFocus(): Promise<void> {
    await sleep(120)
    if (this.closed || this.wc.isDestroyed()) return
    try {
      const f = (await this.wc.executeJavaScriptInIsolatedWorld(AULA_WORLD, [{ code: FOCUS_SCRIPT }])) as { editable?: boolean; type?: string; inputMode?: string; autocomplete?: string } | null
      this.hooks.focus({ id: this.id, editable: f?.editable === true, kind: fieldKind(String(f?.type ?? 'text'), String(f?.inputMode ?? ''), String(f?.autocomplete ?? '')) })
    } catch { /* la página se fue mientras se miraba */ }
  }

  /** Tras moverse la página (un toque, la rueda, otra dirección): dónde quedaron los campos de escribir. */
  private scheduleFields(): void {
    if (this.fieldsTimer) clearTimeout(this.fieldsTimer)
    this.fieldsTimer = setTimeout(() => {
      this.fieldsTimer = null
      if (this.closed || this.wc.isDestroyed()) return
      void this.wc.executeJavaScriptInIsolatedWorld(AULA_WORLD, [{ code: FIELDS_SCRIPT }]).then(
        (raw) => {
          const rects = (Array.isArray(raw) ? raw : []).filter((r): r is [number, number, number, number] => Array.isArray(r) && r.length === 4 && r.every((n) => typeof n === 'number' && Number.isFinite(n))).slice(0, 60)
          if (!this.closed) this.hooks.fields({ id: this.id, rects })
        },
        () => { /* la página se fue mientras se miraba */ }
      )
    }, 280)
  }

  navigate(action: 'back' | 'forward' | 'reload'): void {
    this.touch()
    const h = this.wc.navigationHistory
    if (action === 'back' && h.canGoBack()) h.goBack()
    else if (action === 'forward' && h.canGoForward()) h.goForward()
    else if (action === 'reload') this.wc.reload()
  }

  /** Lo que Aula puede leer (con su turno): texto y respuestas, sin lo privado. */
  async read(): Promise<LiveReading> {
    this.touch()
    const raw = (await this.wc.executeJavaScriptInIsolatedWorld(AULA_WORLD, [{ code: READ_SCRIPT }])) as { url?: string; title?: string; text?: string; fields?: { label?: string; kind?: string; value?: string }[] } | null
    const text = String(raw?.text ?? '')
    return {
      url: String(raw?.url ?? this.wc.getURL()), title: String(raw?.title ?? this.wc.getTitle()), text: text.slice(0, READ_LIMIT), truncated: text.length > READ_LIMIT,
      fields: (raw?.fields ?? []).map((f) => ({ label: String(f.label ?? ''), kind: String(f.kind ?? 'text'), value: String(f.value ?? '') }))
    }
  }

  setHolder(holder: LiveState['holder'], note?: string): void {
    this.touch()
    this.holder = holder
    this.controlId = randomUUID()
    this.note = note?.trim() ? note.trim().slice(0, 300) : undefined
    this.hooks.changed(this.state())
  }

  close(): void {
    if (this.closed) return
    try { if (this.attached) this.wc.debugger.detach() } catch { /* ya suelto */ }
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}

/** Teclas con nombre → código virtual (el que entienden las páginas en `keyCode`). */
const VIRTUAL_KEYS: Readonly<Record<string, number>> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 }
/** Atajos de edición que Chromium aplica como órdenes (en macOS no llegan solos a una ventana sin menú). */
const SHORTCUT_COMMANDS: Readonly<Record<string, string>> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }

/** Las ventanas en vivo abiertas (una por cuenta de plataforma, y otra sin cuenta). */
export class LiveBrowser {
  private views = new Map<string, LiveView>()
  private sweep: ReturnType<typeof setInterval> | null = null

  constructor(private readonly hooks: LiveHooks) {}

  private idFor(accountId: string | null): string { return accountId ? `live-${accountId}` : 'live-web' }

  private view(id: string): LiveView {
    const v = this.views.get(id)
    if (!v || v.closed) throw new AulaError('not_found', tr('Esa ventana del navegador ya no está abierta.', 'That browser window is no longer open.'))
    return v
  }

  /** Abre (o trae) la ventana de una cuenta; con dirección, va a ella. */
  async open(opts: { accountId?: string | null; url?: string; purpose?: LivePurpose; holder?: LiveState['holder']; note?: string }): Promise<LiveState> {
    const account = opts.accountId ? getAccount(opts.accountId) : null
    if (opts.accountId && !account) throw new AulaError('not_found', tr('Esa plataforma ya no está en Aula.', 'That platform is no longer in Aula.'))
    const id = this.idFor(account?.id ?? null)
    let view = this.views.get(id)
    let target: string | null = null
    if (opts.url) {
      const n = normalizeBrowserURL(opts.url)
      if (!n.ok || blocked(n.url)) throw new AulaError('invalid_args', tr('Esa dirección no se puede abrir.', 'That address can’t be opened.'))
      target = n.url
    }
    if (!view || view.closed) {
      view = new LiveView(id, account?.id ?? null, opts.purpose ?? 'browse', {
        changed: (s) => this.hooks.changed(s),
        focus: (f) => this.hooks.focus(f),
        fields: (f) => this.hooks.fields(f),
        closed: (closedId) => { this.views.delete(closedId); this.hooks.closed(closedId) }
      })
      this.views.set(id, view)
      this.sweep ??= setInterval(() => this.closeIdle(), 60_000)
      target ??= startURLFor(account)
    }
    if (opts.purpose) view.purpose = opts.purpose
    if (opts.holder) view.setHolder(opts.holder, opts.note)
    if (target && target !== 'about:blank') void view.goto(target)
    this.hooks.changed(view.state())
    return view.state()
  }

  state(id: string): LiveState | null {
    const v = this.views.get(id)
    return v && !v.closed ? v.state() : null
  }

  list(): LiveState[] {
    return [...this.views.values()].filter((v) => !v.closed).map((v) => v.state())
  }

  frame(id: string, after: unknown, maxWidth: unknown): Promise<LiveFrame | null> {
    const v = this.view(id)
    const { w } = frameSize({ width: v.state().width, height: v.state().height }, maxWidth)
    return v.frame(typeof after === 'number' && Number.isFinite(after) ? after : -1, w)
  }

  /** El estudiante: solo con su turno y con el `controlId` de ese turno (una orden de antes ya no vale). */
  private student(id: string, controlId: unknown): LiveView {
    const v = this.view(id)
    if (v.holder !== 'student') throw new AulaError('forbidden', tr('Ahora lo está mirando Aula. Toma el control para seguir.', 'Aula is looking at it now. Take control to carry on.'))
    if (typeof controlId !== 'string' || controlId !== v.controlId) throw new AulaError('conflict', tr('La página cambió de manos; vuelve a intentarlo.', 'Control of the page changed; try again.'))
    return v
  }

  async input(id: string, controlId: unknown, events: unknown): Promise<{ applied: number }> {
    return { applied: await this.student(id, controlId).input(sanitizeLiveInput(events)) }
  }

  async navigate(id: string, controlId: unknown, action: unknown, url: unknown): Promise<LiveState> {
    const v = this.student(id, controlId)
    if (typeof url === 'string' && url.trim()) {
      const n = normalizeBrowserURL(url)
      if (!n.ok || blocked(n.url)) throw new AulaError('invalid_args', tr('Esa dirección no se puede abrir.', 'That address can’t be opened.'))
      void v.goto(n.url)
    } else if (action === 'back' || action === 'forward' || action === 'reload') v.navigate(action)
    return v.state()
  }

  viewport(id: string, width: unknown, height: unknown): LiveState {
    const v = this.view(id)
    v.setViewport(width, height)
    return v.state()
  }

  /** El estudiante toma el turno, o se lo pasa a Aula. */
  hold(id: string, holder: LiveState['holder'], note?: string): LiveState {
    const v = this.view(id)
    v.setHolder(holder, note)
    return v.state()
  }

  /** Aula lee la página: solo cuando el estudiante le ha pasado el turno. */
  async read(id: string): Promise<LiveReading> {
    const v = this.view(id)
    if (v.holder !== 'aula') throw new AulaError('forbidden', 'The student is using the browser right now. Ask them to hand it over («Que Aula lo revise») before reading it.')
    return v.read()
  }

  /** La ventana en la que Aula puede leer ahora (la última usada con su turno), si la hay. */
  readable(): LiveState | null {
    const mine = [...this.views.values()].filter((v) => !v.closed && v.holder === 'aula').sort((a, b) => b.lastUsed - a.lastUsed)
    return mine[0]?.state() ?? null
  }

  close(id: string): void {
    this.views.get(id)?.close()
  }

  private closeIdle(): void {
    const now = Date.now()
    for (const v of this.views.values()) if (!v.closed && now - v.lastUsed > IDLE_MS) v.close()
    if (!this.views.size && this.sweep) { clearInterval(this.sweep); this.sweep = null }
  }

  shutdown(): void {
    if (this.sweep) { clearInterval(this.sweep); this.sweep = null }
    for (const v of this.views.values()) v.close()
    this.views.clear()
  }
}
