// El navegador en vivo desde un dispositivo: solo las plataformas del estudiante y su inicio de sesión (engine/live/reach.ts).
// Desde la ventana del ordenador no cambia nada. Electron simulado: una página que navega, con historial y capturas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** La página simulada, tal como la miran las pruebas. */
interface FakePage {
  opener: ((d: { url: string }) => { action: string }) | null
  loadURL: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  navigationHistory: { goBack: ReturnType<typeof vi.fn>; goForward: ReturnType<typeof vi.fn>; goToIndex: ReturnType<typeof vi.fn> }
  getURL(): string
  emit(event: string, ...args: unknown[]): boolean
}

const sim = vi.hoisted(() => ({
  pages: [] as FakePage[],
  accounts: [{ id: 'm1', kind: 'moodle', label: 'Campus', baseURL: 'https://campus.uni.es/' }]
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  type Opener = (d: { url: string }) => { action: 'deny' | 'allow' }
  let next = 1
  class FakeWebContents extends EventEmitter {
    readonly id = next++
    entries: string[] = []
    index = -1
    destroyed = false
    opener: Opener | null = null
    // como loadURL de verdad: empieza la navegación (did-start-navigation) y la deja hecha
    loadURL = vi.fn(async (url: string) => { this.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false }); this.commit(url) })
    reload = vi.fn()
    navigationHistory = {
      canGoBack: () => this.index > 0,
      canGoForward: () => this.index < this.entries.length - 1,
      goBack: vi.fn(() => { this.index--; this.emit('did-navigate') }),
      goForward: vi.fn(() => { this.index++; this.emit('did-navigate') }),
      goToIndex: vi.fn((i: number) => { this.index = i; this.emit('did-navigate') }),
      length: () => this.entries.length,
      getActiveIndex: () => this.index,
      getEntryAtIndex: (i: number) => (i >= 0 && i < this.entries.length ? { url: this.entries[i], title: '' } : null)
    }
    debugger = { attach: vi.fn(), isAttached: () => true, on: vi.fn(), detach: vi.fn(), sendCommand: vi.fn(async () => ({})) }
    /** Los marcos cargados de la página (el árbol de verdad, sin los «especulativos»). */
    frames: unknown[] = []
    get mainFrame(): { framesInSubtree: unknown[] } { return { framesInSubtree: this.frames } }
    /** Como una navegación de verdad: entra en el historial (y corta lo de delante). */
    commit(url: string): void {
      this.entries = [...this.entries.slice(0, this.index + 1), url]
      this.index = this.entries.length - 1
      this.emit('did-navigate')
    }
    getURL(): string { return this.index >= 0 ? this.entries[this.index] : '' }
    getTitle(): string { return '' }
    isDestroyed(): boolean { return this.destroyed }
    isLoading(): boolean { return false }
    setAudioMuted(): void {}
    setWindowOpenHandler(fn: Opener): void { this.opener = fn }
    // la «imagen» es la dirección que había al capturar
    async capturePage(): Promise<unknown> {
      const url = this.getURL()
      return { isEmpty: () => false, resize: () => ({ toJPEG: () => Buffer.from(url) }) }
    }
    async executeJavaScriptInIsolatedWorld(): Promise<unknown> { return null }
  }
  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = new FakeWebContents()
    private gone = false
    constructor() { super(); sim.pages.push(this.webContents as unknown as FakePage) }
    isDestroyed(): boolean { return this.gone }
    destroy(): void { if (this.gone) return; this.gone = true; this.webContents.destroyed = true; this.emit('closed') }
    setContentSize(): void {}
  }
  return { BrowserWindow: FakeBrowserWindow }
})
vi.mock('./sessions', () => ({ forgetWebContents: vi.fn(), partitionFor: () => 'p', platformSession: vi.fn(), safeOrigin: (u: string) => u }))
vi.mock('./scripts', () => ({ AULA_WORLD: 7301 }))
vi.mock('@main/services/platforms/accounts', () => ({
  getAccount: (id: string) => sim.accounts.find((a) => a.id === id) ?? null,
  listAccounts: () => sim.accounts
}))
vi.mock('@main/services/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { LiveBrowser } = await import('./live')

const YOUTUBE = 'https://www.youtube.com/watch?v=1'
let live: InstanceType<typeof LiveBrowser>
const hooks = { changed: vi.fn(), closed: vi.fn(), focus: vi.fn(), fields: vi.fn() }

/** La página de la última ventana abierta. */
const page = (): FakePage => sim.pages.at(-1)!
/** Lo que haría la página sola: un enlace, una redirección o una emergente. */
const navigateEvent = (event: 'will-navigate' | 'will-redirect', url: string, isMainFrame = true) => {
  const e = { url, isMainFrame, preventDefault: vi.fn() }
  page().emit(event, e)
  return e.preventDefault
}
const popup = (url: string) => page().opener!({ url })
type FakeFrame = { url: string; frameTreeNodeId: number; parent: FakeFrame | null }
let nextNode = 10
/** Un marco de dentro que navega (un enlace o un formulario) o que redirige: `current` es lo que tiene cargado. Lo pide el
 *  propio marco si `initiator` es su dirección (o con `self`); su padre es la página (o `parent`). Con `speculative`,
 *  Electron da el marco «especulativo» de un salto a otro sitio (aún vacío), como en las redirecciones. */
const frameEvent = (event: 'will-frame-navigate' | 'will-redirect', url: string, current: string, initiator = current, o: { self?: boolean; parent?: string; speculative?: boolean } = {}) => {
  const top: FakeFrame = { url: page().getURL(), frameTreeNodeId: 1, parent: null }
  const parent: FakeFrame = o.parent ? { url: o.parent, frameTreeNodeId: 2, parent: top } : top
  const loaded: FakeFrame = { url: current, frameTreeNodeId: nextNode++, parent }
  ;(page() as unknown as { frames: FakeFrame[] }).frames = [top, ...(parent === top ? [] : [parent]), loaded]
  const frame = o.speculative ? { ...loaded, url: '' } : loaded
  const self = o.self ?? initiator === current
  const e = { url, isMainFrame: false, frame, initiator: self ? frame : { url: initiator, frameTreeNodeId: 999, parent: null }, preventDefault: vi.fn() }
  page().emit(event, e)
  return e.preventDefault
}
/** Lo que haría la propia página desde la de ahora: empezar a ir a `start`, redirigir por `hops` y quedarse en la última. */
const pageRedirects = (start: string, ...hops: string[]) => {
  page().emit('did-start-navigation', { url: start, isMainFrame: true, isSameDocument: false })
  const prevented = hops.map((h) => navigateEvent('will-redirect', h))
  ;(page() as unknown as { commit(u: string): void }).commit(hops.at(-1) ?? start)
  return prevented
}
const tick = () => new Promise<void>((r) => setImmediate(r))

beforeEach(() => {
  sim.pages.length = 0
  live = new LiveBrowser(hooks)
})
afterEach(() => {
  live.shutdown()
  vi.useRealTimers()
})

/** Abre la plataforma y la deja en manos de quien se diga. */
async function openAs(via: 'window' | 'device', url?: string) {
  const s = await live.open({ accountId: 'm1', holder: 'student', via, ...(url ? { url } : {}) })
  return s
}

describe('desde la ventana del ordenador, como siempre', () => {
  it('los marcos de dentro van a donde sea', async () => {
    await openAs('window')
    expect(frameEvent('will-frame-navigate', YOUTUBE, 'https://external.example/page')).not.toHaveBeenCalled()
    expect(frameEvent('will-redirect', 'https://other.example/', 'https://external.example/page')).not.toHaveBeenCalled()
  })

  it('abre cualquier página, la sigue y la enseña', async () => {
    const s = await openAs('window', 'https://www.youtube.com')
    expect(page().loadURL).toHaveBeenLastCalledWith('https://www.youtube.com/')
    await live.navigate(s.id, s.controlId, undefined, YOUTUBE, 'window')
    expect(page().getURL()).toBe(YOUTUBE)
    expect(navigateEvent('will-navigate', 'https://www.youtube.com/other')).not.toHaveBeenCalled()
    const f = await live.frame(s.id, -1, 800, 'window')
    expect(f?.data).toBe(Buffer.from(YOUTUBE).toString('base64'))
    expect(live.state(s.id)?.deviceAllowed).toBe(false)
    expect(live.state(s.id)?.refused).toBeUndefined()
  })
})

describe('desde un dispositivo, solo sus plataformas y su inicio de sesión', () => {
  it('no abre una dirección fuera de su alcance; su plataforma sí', async () => {
    await expect(openAs('device', 'https://www.youtube.com')).rejects.toMatchObject({ code: 'off_limits', details: { host: 'www.youtube.com' } })
    expect(sim.pages).toHaveLength(0)
    const s = await openAs('device')
    expect(page().loadURL).toHaveBeenLastCalledWith('https://campus.uni.es/')
    await expect(live.navigate(s.id, s.controlId, undefined, YOUTUBE, 'device')).rejects.toMatchObject({ code: 'off_limits' })
    expect(page().loadURL).toHaveBeenCalledTimes(1)
  })

  it('lo que abre la página: enlaces, redirecciones y emergentes solo a lo permitido', async () => {
    const s = await openAs('window')
    await live.input(s.id, s.controlId, [], 'device')
    expect(navigateEvent('will-navigate', YOUTUBE)).toHaveBeenCalled()
    expect(live.state(s.id)?.refused?.host).toBe('www.youtube.com')
    expect(navigateEvent('will-navigate', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).not.toHaveBeenCalled()
    expect(navigateEvent('will-redirect', YOUTUBE)).toHaveBeenCalled()
    // los marcos de dentro (un vídeo que inserta la plataforma) siguen como siempre
    expect(navigateEvent('will-redirect', YOUTUBE, false)).not.toHaveBeenCalled()
    const loads = page().loadURL.mock.calls.length
    expect(popup(YOUTUBE)).toEqual({ action: 'deny' })
    await tick()
    expect(page().loadURL).toHaveBeenCalledTimes(loads)
    popup('https://accounts.google.com/o/oauth2/auth')
    await tick()
    expect(page().loadURL).toHaveBeenLastCalledWith('https://accounts.google.com/o/oauth2/auth')
    // una página nueva borra el aviso
    expect(live.state(s.id)?.refused).toBeUndefined()
  })

  it('los marcos de dentro: su primera carga y lo que empieza la plataforma, sí; saltar desde un marco ajeno a otro sitio, no', async () => {
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    // un vídeo o un recurso «URL» incrustado: su primera carga, y dentro de su sitio
    expect(frameEvent('will-frame-navigate', 'https://external.example/page', '', 'https://campus.uni.es/mod/url/view.php?id=42')).not.toHaveBeenCalled()
    expect(frameEvent('will-frame-navigate', 'https://www.external.example/other', 'https://external.example/page')).not.toHaveBeenCalled()
    // un enlace dentro de ese marco a otro sitio: no se abre y el dispositivo sabe por qué
    expect(frameEvent('will-frame-navigate', 'https://other.example/', 'https://external.example/page')).toHaveBeenCalled()
    expect(live.state(s.id)?.refused?.host).toBe('other.example')
    expect(frameEvent('will-redirect', YOUTUBE, 'https://external.example/page')).toHaveBeenCalled()
    // el lanzamiento LTI: la plataforma manda el formulario a la herramienta, que va a su proveedor y vuelve
    expect(frameEvent('will-frame-navigate', 'https://tool.example/lti/launch', 'https://campus.uni.es/mod/lti/launch.php?id=4')).not.toHaveBeenCalled()
    expect(frameEvent('will-redirect', 'https://idp.otra.org/idp/profile/SAML2/Redirect/SSO', 'https://tool.example/app')).not.toHaveBeenCalled()
    expect(frameEvent('will-frame-navigate', 'https://tool.example/return', 'https://idp.otra.org/idp/profile/SAML2/Redirect/SSO')).not.toHaveBeenCalled()
    // en una página nueva, lo que alcanzaron los marcos de la anterior ya no cuenta
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/my/', 'device')
    expect(frameEvent('will-frame-navigate', 'https://tool.example/return', 'https://idp.otra.org/idp/profile/SAML2/Redirect/SSO')).toHaveBeenCalled()
  })

  it('una redirección de un marco ajeno se mira con lo que tiene cargado (no con el marco «especulativo», aún vacío)', async () => {
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    expect(frameEvent('will-redirect', YOUTUBE, 'https://external.example/page', undefined, { speculative: true })).toHaveBeenCalled()
    expect(live.state(s.id)?.refused?.host).toBe('www.youtube.com')
    // dentro de su sitio, sí
    expect(frameEvent('will-redirect', 'https://www.external.example/next', 'https://external.example/page', undefined, { speculative: true })).not.toHaveBeenCalled()
  })

  it('un enlace dentro de un documento en blanco o srcdoc: se mira como quien lo contiene', async () => {
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    for (const cur of ['about:srcdoc', 'about:blank', '']) {
      // dentro de un marco ajeno (un anuncio, un reproductor): no salta a otro sitio
      expect(frameEvent('will-frame-navigate', 'https://evil.example/', cur, cur, { self: true, parent: 'https://external.example/page' }), cur).toHaveBeenCalled()
      // dentro de la plataforma: sí (y lo que alcanza vale para los demás marcos de la página: por eso, otro sitio cada vez)
      expect(frameEvent('will-frame-navigate', 'https://inner.example/', cur, cur, { self: true }), cur).not.toHaveBeenCalled()
      // lo carga quien lo contiene: su primera carga
      expect(frameEvent('will-frame-navigate', 'https://first.example/', cur, 'https://external.example/page', { self: false, parent: 'https://external.example/page' }), cur).not.toHaveBeenCalled()
    }
  })

  it('una herramienta (LTI) que la plataforma lanza en la ventana entera: su inicio, su vuelta y su sitio, sí; otro, no', async () => {
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    // la actividad se abre en una ventana nueva (aquí, en la misma) con la página de lanzamiento de la plataforma
    popup('https://campus.uni.es/mod/lti/launch.php?id=4')
    await tick()
    expect(page().getURL()).toBe('https://campus.uni.es/mod/lti/launch.php?id=4')
    // que manda sola el formulario al inicio OIDC de la herramienta, que vuelve a la plataforma y de ahí a la herramienta
    expect(navigateEvent('will-navigate', 'https://tool.example/lti/login')).not.toHaveBeenCalled()
    for (const p of pageRedirects('https://tool.example/lti/login', 'https://campus.uni.es/mod/lti/auth.php?state=x')) expect(p).not.toHaveBeenCalled()
    expect(navigateEvent('will-navigate', 'https://tool.example/lti/launch')).not.toHaveBeenCalled()
    for (const p of pageRedirects('https://tool.example/lti/launch', 'https://app.tool.example/course/1')) expect(p).not.toHaveBeenCalled()
    expect(live.state(s.id)?.deviceAllowed).toBe(true)
    expect(live.state(s.id)?.refused).toBeUndefined()
    // dentro de la herramienta, a otro sitio: no; pedirla él mismo: tampoco
    expect(navigateEvent('will-navigate', 'https://other.example/')).toHaveBeenCalled()
    await expect(live.navigate(s.id, s.controlId, undefined, 'https://app.tool.example/course/2', 'device')).rejects.toMatchObject({ code: 'off_limits' })
    // una página cualquiera de la plataforma no lanza nada
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/course/view.php?id=3', 'device')
    expect(navigateEvent('will-navigate', 'https://tool2.example/lti')).toHaveBeenCalled()
  })

  it('manda quien tocó la última vez', async () => {
    const s = await openAs('window')
    await live.input(s.id, s.controlId, [], 'device')
    expect(navigateEvent('will-navigate', YOUTUBE)).toHaveBeenCalled()
    await live.input(s.id, s.controlId, [], 'window')
    expect(navigateEvent('will-navigate', YOUTUBE)).not.toHaveBeenCalled()
    // tomar el turno también es manejar
    live.hold(s.id, 'aula')
    const back = live.hold(s.id, 'student', undefined, 'device')
    expect(navigateEvent('will-navigate', YOUTUBE)).toHaveBeenCalled()
    expect(back.holder).toBe('student')
  })

  it('atrás, adelante y recargar se miran antes de ir', async () => {
    const s = await openAs('window', YOUTUBE)
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/my/', 'window')
    await live.navigate(s.id, s.controlId, 'back', undefined, 'device')
    expect(page().navigationHistory.goBack).not.toHaveBeenCalled()
    expect(live.state(s.id)?.refused?.host).toBe('www.youtube.com')
    await live.navigate(s.id, s.controlId, 'back', undefined, 'window')
    expect(page().navigationHistory.goBack).toHaveBeenCalledTimes(1)
    expect(page().getURL()).toBe(YOUTUBE)
    // en YouTube (desde el ordenador), el dispositivo no recarga ni toca, pero puede volver a su plataforma
    await live.navigate(s.id, s.controlId, 'reload', undefined, 'device')
    expect(page().reload).not.toHaveBeenCalled()
    await live.navigate(s.id, s.controlId, 'forward', undefined, 'device')
    expect(page().navigationHistory.goForward).toHaveBeenCalledTimes(1)
    expect(page().getURL()).toBe('https://campus.uni.es/my/')
  })

  it('desde un dispositivo, si todo lo de atrás se puede ver, atrás de siempre (se salta lo que añadió la página sola)', async () => {
    const s = await openAs('window', 'https://campus.uni.es/login/index.php')
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/my/', 'window')
    await live.navigate(s.id, s.controlId, 'back', undefined, 'device')
    expect(page().navigationHistory.goBack).toHaveBeenCalledTimes(1)
    expect(page().navigationHistory.goToIndex).not.toHaveBeenCalled()
  })

  it('desde un dispositivo, si atrás podría llevar a algo que no ve, justo a la entrada más cercana que sí', async () => {
    const s = await openAs('window', 'https://campus.uni.es/course/view.php?id=3')
    await live.navigate(s.id, s.controlId, undefined, YOUTUBE, 'window')
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/my/', 'window')
    await live.navigate(s.id, s.controlId, 'back', undefined, 'device')
    expect(page().navigationHistory.goBack).not.toHaveBeenCalled()
    expect(page().navigationHistory.goToIndex).toHaveBeenLastCalledWith(0)
    expect(page().getURL()).toBe('https://campus.uni.es/course/view.php?id=3')
  })

  it('una página que pone Aula (sin `via`) vuelve a dejar la ventana al ordenador: sus redirecciones no se cortan', async () => {
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    expect(navigateEvent('will-redirect', YOUTUBE)).toHaveBeenCalled()
    // la tarjeta del chat en el Mac: un recurso de Moodle que redirige fuera
    await live.open({ accountId: 'm1', url: 'https://campus.uni.es/mod/url/view.php?id=42', purpose: 'task', holder: 'student' })
    expect(navigateEvent('will-redirect', YOUTUBE)).not.toHaveBeenCalled()
    expect(navigateEvent('will-navigate', YOUTUBE)).not.toHaveBeenCalled()
    expect(live.state(s.id)?.refused).toBeUndefined()
    // (abrirla con el turno del estudiante cambia el `controlId`) el dispositivo no la ve ni la toca, y su siguiente toque
    // en su plataforma vuelve a mandar
    const control = (): string => live.state(s.id)?.controlId ?? ''
    await live.navigate(s.id, control(), undefined, YOUTUBE, 'window')
    await expect(live.input(s.id, control(), [], 'device')).rejects.toMatchObject({ code: 'off_limits' })
    await live.navigate(s.id, control(), undefined, 'https://campus.uni.es/my/', 'window')
    await live.input(s.id, control(), [], 'device')
    expect(navigateEvent('will-navigate', YOUTUBE)).toHaveBeenCalled()
  })

  it("'home' vuelve al inicio de la plataforma", async () => {
    const s = await openAs('window', YOUTUBE)
    await live.navigate(s.id, s.controlId, 'home', undefined, 'device')
    expect(page().loadURL).toHaveBeenLastCalledWith('https://campus.uni.es/')
  })

  it('una página fuera de su alcance no se le enseña ni se le deja tocar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const s = await openAs('window', YOUTUBE)
    // la ventana del ordenador la ve (y queda guardada su última imagen)
    expect(await live.frame(s.id, -1, 800, 'window')).not.toBeNull()
    const asked = live.frame(s.id, -1, 800, 'device')
    await vi.advanceTimersByTimeAsync(3000)
    expect(await asked).toBeNull()
    await expect(live.input(s.id, s.controlId, [{ type: 'tap', x: 0.5, y: 0.5 }], 'device')).rejects.toMatchObject({ code: 'off_limits' })
    // en su plataforma, sí
    await live.navigate(s.id, s.controlId, undefined, 'https://campus.uni.es/my/', 'window')
    const f = await live.frame(s.id, -1, 800, 'device')
    expect(f?.data).toBe(Buffer.from('https://campus.uni.es/my/').toString('base64'))
    expect(live.state(s.id)?.deviceAllowed).toBe(true)
  })

  it('lo que abre Aula (sin `via`) fuera de lo que podría pedir el dispositivo no se le enseña, aunque parezca un inicio de sesión', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    for (const url of ['https://sso-proxy.example.com/', 'https://x.example/login/https://www.youtube.com', 'https://uni.okta.com/app/x']) {
      // la herramienta student_browser_show del chat: live.open sin `via`
      const s = await live.open({ accountId: 'm1', url, purpose: 'task', holder: 'student' })
      expect(page().getURL()).toBe(new URL(url).href)
      expect(live.state(s.id)?.deviceAllowed, url).toBe(false)
      expect(live.deviceMaySee(s.id, url), url).toBe(false)
      const asked = live.frame(s.id, -1, 800, 'device')
      await vi.advanceTimersByTimeAsync(3000)
      expect(await asked, url).toBeNull()
      await expect(live.input(s.id, live.state(s.id)!.controlId, [{ type: 'tap', x: 0.5, y: 0.5 }], 'device'), url).rejects.toMatchObject({ code: 'off_limits' })
      // la ventana del ordenador la ve como siempre
      expect(await live.frame(s.id, -1, 800, 'window')).not.toBeNull()
    }
    // su plataforma, sí
    const s = await live.open({ accountId: 'm1', url: 'https://campus.uni.es/mod/assign/view.php?id=4', purpose: 'task', holder: 'student' })
    expect(live.state(s.id)?.deviceAllowed).toBe(true)
    expect(live.deviceMaySee(s.id, 'https://campus.uni.es/my/')).toBe(true)
    // y abrirla desde el dispositivo con la ventana en una página así vuelve a su plataforma
    await live.open({ accountId: 'm1', url: 'https://sso-proxy.example.com/', holder: 'student' })
    await openAs('device')
    expect(page().loadURL).toHaveBeenLastCalledWith('https://campus.uni.es/')
  })

  it('un paso de acceso al que lleva la propia página desde algo que el dispositivo ve, sí se le enseña', async () => {
    // el dispositivo toca «Entrar» en su plataforma y la página va al SSO de otra organización
    const s = await openAs('device')
    await live.input(s.id, s.controlId, [], 'device')
    expect(navigateEvent('will-navigate', 'https://sso.ejemplo.com/login')).not.toHaveBeenCalled()
    ;(page() as unknown as { commit(u: string): void }).commit('https://sso.ejemplo.com/login')
    expect(live.state(s.id)?.deviceAllowed).toBe(true)
    // Aula abre su plataforma y la sesión caducó: la plataforma redirige a su proveedor (el ordenador conduce)
    const t = await live.open({ accountId: 'm1', url: 'https://campus.uni.es/course/view.php?id=3', purpose: 'signin', holder: 'student' })
    for (const p of pageRedirects('https://campus.uni.es/course/view.php?id=3', 'https://campus.uni.es/login/index.php', 'https://idp.otra.org/idp/profile/SAML2/Redirect/SSO')) expect(p).not.toHaveBeenCalled()
    expect(live.state(t.id)?.url).toBe('https://idp.otra.org/idp/profile/SAML2/Redirect/SSO')
    expect(live.state(t.id)?.deviceAllowed).toBe(true)
    // pero lo que sale de una página que el dispositivo no ve no cuenta: Aula abre algo de fuera que redirige a un «SSO»
    await live.open({ accountId: 'm1', url: 'https://x.example/start', holder: 'student' })
    pageRedirects('https://x.example/start', 'https://auth.otro-sitio.example/sso/')
    expect(live.state(t.id)?.deviceAllowed).toBe(false)
  })

  it('abrir su plataforma desde el dispositivo con la ventana fuera de su alcance vuelve a ella', async () => {
    await openAs('window', YOUTUBE)
    const s = await openAs('device')
    expect(page().loadURL).toHaveBeenLastCalledWith('https://campus.uni.es/')
    expect(s.holder).toBe('student')
  })
})
