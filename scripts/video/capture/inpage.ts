// Código que se inyecta en la app capturada (se serializa con toString: sin imports ni tipos fuera de la firma).
// - Math.random con semilla (los pixel art y las ráfagas salen siempre iguales);
// - guarda el requestAnimationFrame real (el reloj falso de Playwright sustituye el de la página);
// - cuenta mutaciones del DOM (para saber cuándo la interfaz está quieta);
// - conduce las animaciones CSS/WAAPI (incluidas las de motion que van por WAAPI) con el tiempo virtual.

export interface VtPage {
  realRAF: (cb: () => void) => number
  mutations: number
  /** Peticiones de rAF y temporizadores (falsos) hechas desde código de la página: si alguna llega mientras se espera
   *  en tiempo real, algo despertó (un IntersectionObserver, un evento) y la interfaz aún no está quieta. */
  activity: number
  /** Coloca cada animación en su tiempo local virtual. Devuelve cuántas hay y cuántas eran nuevas. */
  driveAnimations(now: number): number
  /** Historias pixel art que arrancaron (evento `aula:pixel` del reproductor), pendientes de recoger. */
  pixel: { story: string; clip: string }[]
  /** Animaciones descubiertas por primera vez en la última llamada. */
  fresh: number
  /** Animaciones que la última llamada dio por terminadas (sus avisos `finish` llegan en el siguiente pintado real). */
  finished: number
  /** Mensajes enviados a un Worker de la página sin respuesta todavía (la app pinta sus dibujos en hilos aparte). */
  workers: number
  /** Espera `frames` fotogramas reales y dice si la interfaz cambió entretanto o aún carga imágenes o fuentes (o espera a
   *  un hilo de pintura). */
  quiet(frames: number): Promise<{ changed: number; loading: number }>
  rects(selectors: Record<string, string>): Record<string, [number, number, number, number] | null>
}

export function installInPage(opts: { seed: number; pixelIdle: boolean }): void {
  const w = window as unknown as { __vt?: VtPage }
  if (w.__vt) return
  const seed = opts.seed
  // sin los gestos de reposo del pixel art (llegan cada 7–18 s desde que se montó cada icono): <html data-pixel-idle="off">
  if (!opts.pixelIdle) {
    const off = () => document.documentElement?.setAttribute('data-pixel-idle', 'off')
    off()
    document.addEventListener('DOMContentLoaded', off, { once: true })
  }
  // Azar determinista POR LUGAR DE LLAMADA y tiempo virtual: cada componente recibe siempre su misma secuencia aunque
  // otro componente gaste más o menos números en ese fotograma.
  const counts = new Map<string, number>()
  let countsAt = -1
  const hash = (str: string): number => {
    let h = (0x811c9dc5 ^ seed) >>> 0
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0
    h = Math.imul(h ^ (h >>> 15), h | 1)
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
  Math.random = () => {
    const now = performance.now()
    if (now !== countsAt) {
      counts.clear()
      countsAt = now
    }
    const site = (new Error().stack ?? '').split('\n').slice(2, 6).join('|')
    const n = (counts.get(site) ?? 0) + 1
    counts.set(site, n)
    return hash(`${site}|${Math.round(now * 1000)}|${n}`)
  }
  const realRAF = window.requestAnimationFrame.bind(window)
  const starts = new WeakMap<Animation, number>()
  const vt: VtPage = {
    realRAF,
    mutations: 0,
    activity: 0,
    workers: 0,
    pixel: [],
    fresh: 0,
    finished: 0,
    driveAnimations(now: number): number {
      const list = document.getAnimations()
      vt.fresh = 0
      vt.finished = 0
      for (const an of list) {
        if (!starts.has(an)) {
          vt.fresh++
          starts.set(an, now)
          if (an.playState !== 'finished') an.pause()
        }
        if (an.playState === 'finished' || an.playState === 'idle') continue
        const rate = an.playbackRate || 1
        const local = (now - (starts.get(an) as number)) * rate
        const end = an.effect ? Number(an.effect.getComputedTiming().endTime) : Infinity
        if (Number.isFinite(end) && local >= end) {
          an.finish()
          vt.finished++
        }
        else an.currentTime = Math.max(0, local)
      }
      return list.length
    },
    async quiet(frames: number) {
      const before = vt.mutations + vt.activity
      for (let i = 0; i < frames; i++) await new Promise<void>((r) => realRAF(() => r()))
      let loading = document.fonts.status === 'loaded' ? 0 : 1
      for (const img of document.images) if (!img.complete) loading++
      loading += vt.workers
      return { changed: vt.mutations + vt.activity - before, loading }
    },
    rects(selectors) {
      const out: Record<string, [number, number, number, number] | null> = {}
      for (const [name, sel] of Object.entries(selectors)) {
        let el: Element | null | undefined
        if (sel.startsWith('text:')) {
          const text = sel.slice(5).trim()
          const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], h1, h2, h3, p, span, div')]
          el = all.find((e) => e.childElementCount <= 3 && e.textContent?.trim() === text)
        } else el = document.querySelector(sel)
        const r = el?.getBoundingClientRect()
        out[name] = r && r.width > 0 ? [r.x, r.y, r.width, r.height] : null
      }
      return out
    }
  }
  w.__vt = vt
  // nada a pantalla completa durante la captura (sacaría la ventana oculta a la pantalla del dueño)
  const noFull = function (): Promise<void> {
    return Promise.resolve()
  }
  Element.prototype.requestFullscreen = noFull
  const legacy = Element.prototype as unknown as { webkitRequestFullscreen?: unknown; webkitRequestFullScreen?: unknown }
  if (legacy.webkitRequestFullscreen) legacy.webkitRequestFullscreen = noFull
  if (legacy.webkitRequestFullScreen) legacy.webkitRequestFullScreen = noFull
  // los dibujos de la app (personajes, pinturas) se pintan en hilos aparte y llegan en tiempo real: cada mensaje al hilo
  // tiene una respuesta, y mientras falte alguna la interfaz no está quieta (así cada dibujo cae siempre en el mismo paso)
  const RealWorker = window.Worker
  if (RealWorker) {
    class VWorker extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        // se registra antes que el onmessage de la app: cuenta la respuesta y, en el mismo evento, la app la usa
        this.addEventListener('message', () => (vt.workers = Math.max(0, vt.workers - 1)))
        this.addEventListener('error', () => (vt.workers = 0))
        const post = this.postMessage.bind(this) as (...a: unknown[]) => void
        this.postMessage = ((...a: unknown[]) => {
          vt.workers++
          post(...a)
        }) as Worker['postMessage']
      }
    }
    ;(window as unknown as { Worker: typeof Worker }).Worker = VWorker
  }
  // el reproductor pixel art avisa al empezar cada historia (para poner sus sonidos en el vídeo)
  document.addEventListener(
    'aula:pixel',
    (e) => {
      const el = e.target as HTMLElement | null
      const story = el?.dataset?.pixel
      const clip = (e as CustomEvent<{ clip?: string }>).detail?.clip
      if (story && clip) vt.pixel.push({ story, clip })
    },
    true
  )
  const observe = () => new MutationObserver((m) => (vt.mutations += m.length)).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  if (document.documentElement) observe()
  else document.addEventListener('DOMContentLoaded', observe, { once: true })
  // sin cursor de texto parpadeando (va con el reloj real del motor): el compositor dibuja el suyo
  const style = () => {
    const s = document.createElement('style')
    s.textContent = '*, *::before, *::after { caret-color: transparent !important; }'
    document.head.appendChild(s)
  }
  if (document.head) style()
  else document.addEventListener('DOMContentLoaded', style, { once: true })
}

/** Segundo guion, registrado DESPUÉS del reloj falso: envuelve sus requestAnimationFrame y temporizadores para contar la
 *  actividad (las librerías los capturan al cargar, así que tiene que ir antes que el código de la app). */
export function installActivityProbe(): void {
  const w = window as unknown as { __vt?: VtPage; __vtProbe?: boolean } & Record<string, unknown>
  if (w.__vtProbe) return
  w.__vtProbe = true
  for (const name of ['requestAnimationFrame', 'setTimeout', 'setInterval']) {
    const orig = w[name] as (...a: unknown[]) => unknown
    w[name] = function (this: unknown, ...args: unknown[]) {
      if (w.__vt) w.__vt.activity++
      return orig.apply(this, args)
    }
  }
  // IntersectionObserver entrega cuando el motor pinta (tiempo real): a veces antes de la captura y a veces después.
  // Se guardan las entregas y se pasan al código de la página en el siguiente paso del reloj virtual: siempre el mismo.
  const fakeTimeout = w.setTimeout as (fn: () => void, ms: number) => unknown
  const RealIO = window.IntersectionObserver
  class VirtualIO extends RealIO {
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      let queue: IntersectionObserverEntry[] = []
      let scheduled = false
      super((entries) => {
        if (w.__vt) w.__vt.activity++
        queue.push(...entries)
        if (scheduled) return
        scheduled = true
        fakeTimeout(() => {
          scheduled = false
          const batch = queue
          queue = []
          cb(batch, this)
        }, 0)
      }, opts)
    }
  }
  w.IntersectionObserver = VirtualIO
  // ResizeObserver, igual: entrega al pintar (tiempo real). Los dibujos a mano miden su caja con él y piden su máscara al
  // recibir la medida; si eso cayera en un paso u otro, el fundido de la máscara empezaría en instantes distintos
  const RealRO = window.ResizeObserver
  if (RealRO) {
    class VirtualRO extends RealRO {
      constructor(cb: ResizeObserverCallback) {
        let queue: ResizeObserverEntry[] = []
        let scheduled = false
        super((entries) => {
          if (w.__vt) w.__vt.activity++
          queue.push(...entries)
          if (scheduled) return
          scheduled = true
          fakeTimeout(() => {
            scheduled = false
            const batch = queue
            queue = []
            cb(batch, this)
          }, 0)
        })
      }
    }
    w.ResizeObserver = VirtualRO
  }
}

export interface VtMain {
  /** Llamadas IPC en curso que empezaron hace menos de 1,5 s reales (las más largas, como una escucha que nunca
   *  termina, no deben frenar cada fotograma). */
  young(): number
  /** Métodos IPC que tardaron más de 1,5 s (informativo). */
  long: string[]
  /** Hora virtual del proceso principal (ms de época) si se fijó con take.clock. */
  dateBase: number | null
  pending: number
  /** Métodos IPC llamados desde la última consulta (depuración). */
  log: string[]
  last: number
  advance(dt: number): number
  virtual: boolean
}

/** Proceso principal de la app: cuenta las llamadas IPC pendientes y, si se pide, pasa sus temporizadores a tiempo virtual
 *  (la IA simulada «escribe» al ritmo del vídeo y no del reloj real). Se ejecuta con electronApp.evaluate. */
export function installInMain(electron: typeof import('electron'), opts: { virtualTimers: boolean; dateStart: number | null }): void {
  const g = globalThis as unknown as { __vtMain?: VtMain }
  if (g.__vtMain) return
  const virtualTimers = opts.virtualTimers
  const started = new Map<number, [number, string]>()
  let callSeq = 0
  const m: VtMain = {
    pending: 0,
    last: Date.now(),
    virtual: virtualTimers,
    advance: () => 0,
    log: [],
    dateBase: opts.dateStart,
    long: [],
    young: () => {
      const now = Date.now()
      let n = 0
      for (const [id, [t0, name]] of started) {
        if (now - t0 < 1500) n++
        else if (!m.long.includes(name)) {
          m.long.push(name)
          started.delete(id)
        }
      }
      return n
    }
  }
  g.__vtMain = m
  // la hora del proceso principal sigue a la de la interfaz (take.clock): base + tiempo virtual + lo poco que pasó en real
  // desde el último paso (hasta 50 ms, para que ningún bucle que espere a Date.now() se quede parado)
  const realMs = () => performance.timeOrigin + performance.now()
  let vElapsed = 0
  let lastReal = realMs()
  if (opts.dateStart !== null) {
    const RealDate = Date
    const now = () => Math.floor((opts.dateStart as number) + vElapsed + Math.min(50, realMs() - lastReal))
    class VDate extends RealDate {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(now())
        else super(...(a as [string]))
      }
      static override now(): number {
        return now()
      }
    }
    ;(globalThis as unknown as { Date: DateConstructor }).Date = VDate as unknown as DateConstructor
  }
  const tickDate = (dt: number) => {
    vElapsed += dt
    lastReal = realMs()
  }
  m.advance = (dt: number) => {
    tickDate(dt)
    return 0
  }
  const handlers = (electron.ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
  const wrap =
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      m.pending++
      m.last = Date.now()
      m.log.push(String(args[1]))
      const id = ++callSeq
      started.set(id, [Date.now(), String(args[1])])
      try {
        return await fn(...args)
      } finally {
        m.pending--
        started.delete(id)
        m.last = Date.now()
      }
    }
  for (const [channel, fn] of [...handlers]) handlers.set(channel, wrap(fn))
  // los manejadores que se registren más tarde también cuentan
  const set = handlers.set.bind(handlers)
  handlers.set = (k: string, fn: (...a: unknown[]) => unknown) => set(k, wrap(fn))
  for (const wc of electron.webContents.getAllWebContents()) {
    const send = wc.send.bind(wc)
    wc.send = (channel: string, ...args: unknown[]) => {
      // la ventana oculta gana y pierde el foco en tiempo real: esos avisos (y los de energía) harían que la interfaz
      // pause o reanude lo ambiental en un fotograma u otro; en la captura no llegan
      if (args[0] === 'app.focus' || args[0] === 'app.power') return
      m.last = Date.now()
      m.log.push('E:' + String((args[0] as { event?: string })?.event ?? args[0] ?? channel).slice(0, 40))
      send(channel, ...args)
    }
  }
  if (!virtualTimers) return
  interface Entry {
    fn: (...a: unknown[]) => void
    args: unknown[]
    at: number
    ms: number
    repeat: boolean
  }
  let now = 0
  let seq = 0
  const queue = new Map<number, Entry>()
  class VTimer {
    id: number
    constructor(id: number) {
      this.id = id
    }
    ref(): this {
      return this
    }
    unref(): this {
      return this
    }
    hasRef(): boolean {
      return true
    }
    refresh(): this {
      const e = queue.get(this.id)
      if (e) e.at = now + e.ms
      return this
    }
    close(): this {
      queue.delete(this.id)
      return this
    }
    [Symbol.toPrimitive](): number {
      return this.id
    }
  }
  const realClearTimeout = globalThis.clearTimeout
  const realClearInterval = globalThis.clearInterval
  const add = (repeat: boolean) => (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const d = Math.max(1, Number(ms) || 0)
    const id = ++seq
    queue.set(id, { fn, args, at: now + d, ms: d, repeat })
    return new VTimer(id)
  }
  const clear = (real: (t: never) => void) => (t: unknown) => {
    if (t instanceof VTimer) queue.delete(t.id)
    else if (typeof t === 'number' && queue.has(t)) queue.delete(t)
    else if (t != null) real(t as never)
  }
  const gt = globalThis as unknown as Record<string, unknown>
  gt.setTimeout = add(false)
  gt.setInterval = add(true)
  gt.clearTimeout = clear(realClearTimeout as (t: never) => void)
  gt.clearInterval = clear(realClearInterval as (t: never) => void)
  m.advance = (dt: number) => {
    tickDate(dt)
    const end = now + dt
    let fired = 0
    for (;;) {
      let next: [number, Entry] | null = null
      for (const [id, e] of queue) if (e.at <= end && (!next || e.at < next[1].at || (e.at === next[1].at && id < next[0]))) next = [id, e]
      if (!next) break
      const [id, e] = next
      now = e.at
      if (e.repeat) e.at = now + e.ms
      else queue.delete(id)
      fired++
      try {
        e.fn(...e.args)
      } catch (err) {
        console.error('[vt] temporizador', err)
      }
    }
    now = end
    if (fired) m.last = Date.now()
    return fired
  }
}
