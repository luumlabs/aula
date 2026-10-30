// Captura determinista de la app real, fotograma a fotograma:
// - Electron con AULA_HOME temporal, modo demostración, ventana oculta (nunca la Aula instalada ni sus datos);
// - reloj falso de Playwright (Date, performance.now, requestAnimationFrame, temporizadores) que avanza 1/fps por fotograma;
// - la línea de tiempo de animaciones CSS/WAAPI congelada (CDP Animation.setPlaybackRate 0) y cada animación colocada en su
//   tiempo virtual; Math.random con semilla; perfil de color sRGB; 2 px por pt;
// - antes de cada fotograma espera a que el proceso principal no tenga IPC pendiente y a que el DOM esté quieto.
import { _electron as electron, type ElectronApplication, type Page, type CDPSession } from 'playwright'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import type { Action, Take, TakeMeta, Target, TimedAction } from '../montage/types.ts'
import { ease } from '../montage/ease.ts'
import { installActivityProbe, installInMain, installInPage, type VtMain, type VtPage } from './inpage.ts'

export const CAPTURE_VERSION = 24
const HERE = dirname(fileURLToPath(import.meta.url))

export interface CaptureOptions {
  name: string
  take: Take
  fps: number
  appDir: string
  fingerprint: string
  outDir: string
  seed?: number
  /** Acciones blandas en toda la toma: si un objetivo no aparece, aviso y sigue. */
  soft?: boolean
  /** Reutilizar la toma ya capturada aunque haya cambiado la app o el guion de la toma (revisiones, recomposiciones). */
  reuse?: boolean
  log?: (msg: string) => void
}

type W = Window & { __vt: VtPage; __aula?: { navigate: (r: unknown) => void; setTheme: (t: string) => void } }
type G = typeof globalThis & { __vtMain: VtMain }

export function takeHash(name: string, take: Take, fps: number, fingerprint: string): string {
  return createHash('sha1').update(JSON.stringify({ v: CAPTURE_VERSION, name, take, fps, fingerprint })).digest('hex').slice(0, 12)
}

function todayAt10(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00:00`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Session {
  readonly app: ElectronApplication
  readonly page: Page
  readonly cdp: CDPSession
  readonly virtualMain: boolean
  constructor(app: ElectronApplication, page: Page, cdp: CDPSession, virtualMain: boolean) {
    this.app = app
    this.page = page
    this.cdp = cdp
    this.virtualMain = virtualMain
  }
  cursor: [number, number] | null = null
  /** El proceso principal tiene la hora virtual (take.clock). */
  mainDate = false
  /** Peticiones de red en curso (trozos de JS que se cargan al abrir una pantalla, imágenes, aula-asset://…). */
  inflight = new Map<string, number>()
  /** Url e inicio de cada petición en curso (para avisar de las largas y para VT_NET). */
  netUrls = new Map<string, [number, string]>()
  /** Peticiones que no terminaron en 1,5 s reales (p. ej. el guion de un Worker, cuyo final llega a la sesión del hilo y
   *  no a la de la página): dejan de frenar cada paso, como los IPC largos. */
  longNet: string[] = []
  /** Peticiones en curso que empezaron hace menos de 1,5 s reales. */
  netBusy(): number {
    const now = Date.now()
    let n = 0
    for (const [id, t0] of this.inflight) {
      if (now - t0 < 1500) n++
      else {
        this.longNet.push(this.netUrls.get(id)?.[1] ?? id)
        this.inflight.delete(id)
        this.netUrls.delete(id)
      }
    }
    return n
  }
  down = false
  slowSettles = 0

  /** Espera a que el proceso principal termine sus IPC y la interfaz deje de cambiar (tiempo real, con tope): repite
   *  hasta que, tras dos fotogramas reales, ni el DOM cambió, ni quedan imágenes o fuentes cargando, ni IPC pendiente. */
  lastLoops = 0
  /** Espera a que el proceso principal termine sus IPC y la interfaz deje de cambiar (tiempo real, con tope).
   *  Si en este paso pasó algo (IPC, red, mutaciones o temporizadores pedidos desde un evento real), exige además
   *  `quietMs` de silencio tras el último cambio: lo que tarda un tiempo variable (un trozo de JS que se evalúa, un IPC
   *  lento, un IntersectionObserver) cae siempre en el mismo paso del reloj virtual y no en el siguiente. */
  async settle(maxMs = 4000, quietMs = 140): Promise<void> {
    const deadline = Date.now() + maxMs
    this.lastLoops = 0
    let lastChange = -Infinity
    const mainIdle = () =>
      this.app.evaluate((_e, virtual) => {
        const m = (globalThis as G).__vtMain
        return m.young() === 0 || (virtual && Date.now() - m.last > 40)
      }, this.virtualMain)
    for (;;) {
      let busy = false
      while ((this.netBusy() || !(await mainIdle())) && Date.now() < deadline) {
        busy = true
        await sleep(3)
      }
      this.lastLoops++
      const q = await this.page.evaluate(() => (window as unknown as W).__vt.quiet(2))
      const changed = busy || q.changed > 0 || q.loading > 0 || this.netBusy() > 0 || !(await mainIdle())
      if (changed) lastChange = Date.now()
      else if (Date.now() - lastChange >= quietMs) return
      if (Date.now() > deadline) {
        if (process.env.VT_NET) {
          const page = await this.page.evaluate(() => {
            const vt = (window as unknown as W).__vt
            return `workers=${vt.workers} mutations=${vt.mutations} activity=${vt.activity}`
          })
          console.log(`settle lento: red=${[...this.inflight.keys()].map((id) => this.netUrls.get(id)?.[1] ?? id).join(' | ')} main=${await mainIdle()} ${page} cambios=${changed}`)
        }
        this.slowSettles++
        return
      }
    }
  }

  /** Avanza el tiempo virtual (página y, si se pidió, proceso principal). */
  async advance(ms: number): Promise<void> {
    if (ms <= 0) return
    await this.page.clock.runFor(ms)
    if (this.virtualMain || this.mainDate) await this.app.evaluate((_e, dt) => (globalThis as G).__vtMain.advance(dt), ms)
  }

  /** Espera (en tiempo real) a que el proceso principal lleve `ms` sin IPC ni eventos: el sembrado de la demo y otras
   *  tareas del arranque terminan y avisan a la interfaz en un momento imprevisible; mejor que eso pase antes de grabar. */
  async mainQuiet(ms: number, maxMs = 20000): Promise<number> {
    const t0 = Date.now()
    for (;;) {
      const idle = await this.app.evaluate(() => {
        const m = (globalThis as G).__vtMain
        return m.young() === 0 ? Date.now() - m.last : 0
      })
      if (idle >= ms || Date.now() - t0 > maxMs) return Date.now() - t0
      await sleep(Math.min(200, ms - idle + 5))
      await this.settle()
    }
  }

  /** Un paso completo: avanza, espera a que todo se asiente y coloca las animaciones en su tiempo virtual. */
  async tick(ms: number): Promise<void> {
    await this.advance(ms)
    await this.settle()
    const n = await this.drive()
    if (process.env.VT_DEBUG) {
      const ipc = await this.app.evaluate(() => (globalThis as G).__vtMain.log.splice(0).join(','))
      this.debug.push(`${await this.page.evaluate(() => performance.now())} m=${await this.page.evaluate(() => (window as unknown as W).__vt.mutations)} a=${n} ipc=${ipc}`)
    }
  }
  debug: string[] = []

  /** Coloca las animaciones; si aparecieron nuevas, deja pasar un fotograma real y repite (una animación creada justo
   *  antes de la captura saldría un fotograma en su estado final). */
  async drive(): Promise<number> {
    let n = 0
    for (let i = 0; i < 4; i++) {
      const r = await this.page.evaluate(() => {
        const vt = (window as unknown as W).__vt
        const count = vt.driveAnimations(performance.now())
        return { count, fresh: vt.fresh, finished: vt.finished }
      })
      n = r.count
      if (!r.fresh && !r.finished) break
      // una animación nueva (saldría un fotograma en su estado final) o una que acaba (su `finish` desata trabajo,
      // p. ej. que entre la pantalla siguiente): se espera a que todo eso pase dentro de este mismo paso
      await this.settle()
    }
    return n
  }

  /** Avisos de acciones «blandas» que no encontraron su objetivo (se apuntan y la toma sigue). */
  warnings: string[] = []
  soft = false

  async target(t: Target, soft = this.soft): Promise<[number, number] | null> {
    if (Array.isArray(t)) return t
    const p = await this.page.evaluate((sel) => {
      let el: Element | null | undefined
      if (sel.startsWith('text:')) {
        const text = sel.slice(5).trim()
        const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], label, li, h1, h2, h3, p, span')]
        el = all.find((e) => e.textContent?.trim() === text) ?? all.find((e) => e.textContent?.trim().startsWith(text))
      } else el = document.querySelector(sel)
      const r = el?.getBoundingClientRect()
      return r && r.width > 0 ? [r.x + r.width / 2, r.y + r.height / 2] : null
    }, t)
    if (!p) {
      if (soft) {
        this.warnings.push(`no encuentro «${t}» (acción blanda: se salta)`)
        return null
      }
      throw new Error(`no encuentro «${t}» en la pantalla`)
    }
    return p as [number, number]
  }

  async moveTo(x: number, y: number): Promise<void> {
    this.cursor = [x, y]
    await this.page.mouse.move(x, y)
  }
}

/** Una acción instantánea (preparación o momento puntual de la toma). */
async function instant(s: Session, a: Action): Promise<void> {
  const page = s.page
  switch (a.do) {
    case 'navigate':
      await page.evaluate((r) => (window as unknown as W).__aula?.navigate(r), a.route)
      break
    case 'theme':
      await page.evaluate((t) => (window as unknown as W).__aula?.setTheme(t), a.value)
      break
    case 'key':
      await page.keyboard.press(a.key)
      break
    case 'eval':
      await page.evaluate(a.js)
      break
    case 'move':
    case 'click': {
      const p = await s.target(a.to, a.soft || s.soft)
      if (!p) break
      const [x, y] = p
      await s.moveTo(x, y)
      if (a.do === 'click') {
        await page.mouse.down()
        await page.mouse.up()
      }
      break
    }
    case 'type':
      await page.keyboard.insertText(a.text)
      break
    case 'drag': {
      const p0 = await s.target(a.from, a.soft || s.soft)
      const p1 = await s.target(a.to, a.soft || s.soft)
      if (!p0 || !p1) break
      const [x0, y0] = p0
      const [x1, y1] = p1
      await s.moveTo(x0, y0)
      await page.mouse.down()
      await s.moveTo(x1, y1)
      await page.mouse.up()
      break
    }
    case 'scroll': {
      const p = await s.target(a.to, a.soft || s.soft)
      if (!p) break
      await scrollAt(page, p[0], p[1], a.dy)
      break
    }
  }
}

/** Desplaza al instante el contenedor desplazable bajo un punto (sin el desplazamiento suave del motor, que va con reloj real). */
async function scrollAt(page: Page, x: number, y: number, dy: number): Promise<void> {
  await page.evaluate(
    ([x, y, dy]) => {
      let el = document.elementFromPoint(x, y) as HTMLElement | null
      while (el && !(el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement
      el?.scrollBy({ top: dy, behavior: 'instant' })
    },
    [x, y, dy] as [number, number, number]
  )
}

/** Plan por fotograma de las acciones con duración (cursor, tecleo, rueda). */
interface Track {
  start: number
  end: number
  step: (s: Session, t: number, last: boolean) => Promise<void>
}

function planAction(a: TimedAction): Track {
  switch (a.do) {
    case 'move':
    case 'click': {
      const dur = a.dur ?? 0.7
      let from: [number, number] | null = null
      let to: [number, number] | null = null
      let pressed = false
      let skip = false
      return {
        start: a.at,
        end: a.at + dur + (a.do === 'click' ? 0.12 : 0),
        step: async (s, t, last) => {
          if (skip) return
          const k = ease('inOut', dur > 0 ? (t - a.at) / dur : 1)
          if (!to) {
            to = await s.target(a.to, a.soft || s.soft)
            if (!to) {
              skip = true
              return
            }
            from = s.cursor ?? [to[0] + 220, to[1] + 160]
          } else if (k > 0.6 && !pressed) {
            // el objetivo puede seguir moviéndose (paneles que entran): se vuelve a buscar en el último tramo
            to = (await s.target(a.to, true)) ?? to
          }
          // trayectoria con un arco leve, como una mano
          const dx = to[0] - from![0]
          const dy = to[1] - from![1]
          const arc = Math.sin(Math.PI * k) * 0.08
          await s.moveTo(from![0] + dx * k - dy * arc, from![1] + dy * k + dx * arc)
          if (a.do === 'click' && k >= 1 && !pressed) {
            pressed = true
            s.down = true
            await s.page.mouse.down()
          }
          if (a.do === 'click' && pressed && (t - a.at >= dur + 0.1 || last)) {
            if (s.down) await s.page.mouse.up()
            s.down = false
          }
        }
      }
    }
    case 'drag': {
      const dur = a.dur ?? 0.9
      let from: [number, number] | null = null
      let to: [number, number] | null = null
      let skip = false
      return {
        start: a.at,
        end: a.at + dur + 0.2,
        step: async (s, t, last) => {
          if (skip) return
          if (!from) {
            from = await s.target(a.from, a.soft || s.soft)
            to = await s.target(a.to, a.soft || s.soft)
            if (!from || !to) {
              skip = true
              return
            }
            await s.moveTo(from[0], from[1])
            s.down = true
            await s.page.mouse.down()
          }
          const k = ease('inOut', (t - a.at - 0.1) / dur)
          await s.moveTo(from[0] + (to![0] - from[0]) * k, from[1] + (to![1] - from[1]) * k)
          if ((k >= 1 && t - a.at >= dur + 0.15) || last) {
            if (s.down) await s.page.mouse.up()
            s.down = false
          }
        }
      }
    }
    case 'type': {
      const cps = a.cps ?? 14
      let typed = 0
      return {
        start: a.at,
        end: a.at + a.text.length / cps,
        step: async (s, t, last) => {
          const want = last ? a.text.length : Math.min(a.text.length, Math.floor((t - a.at) * cps) + 1)
          if (want > typed) {
            await s.page.keyboard.insertText(a.text.slice(typed, want))
            typed = want
          }
        }
      }
    }
    case 'scroll': {
      const dur = a.dur ?? 0.8
      let done = 0
      let at: [number, number] | null | undefined = undefined
      return {
        start: a.at,
        end: a.at + dur,
        step: async (s, t) => {
          at ??= await s.target(a.to, a.soft || s.soft)
          if (!at) return
          const want = a.dy * ease('inOut', (t - a.at) / dur)
          await scrollAt(s.page, at[0], at[1], want - done)
          done = want
        }
      }
    }
    default:
      return { start: a.at, end: a.at, step: async (s) => instant(s, a) }
  }
}

/** Recarga la página con el reloj falso y la línea de tiempo congelada, y alinea el origen del tiempo virtual a un valor
 *  exacto (lo que tarda Playwright en preparar la página varía unos ms, y los rAF falsos caen cada 16 ms). */
async function reloadAligned(page: Page, cdp: CDPSession): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })
  await page.waitForFunction(() => !!(window as unknown as W).__aula && !!(window as unknown as W).__vt, null, { timeout: 30000 })
  const p0 = await page.evaluate(() => performance.now())
  await page.clock.runFor(1000 - (Math.round(p0) % 1000))
}

async function launch(o: CaptureOptions, home: string): Promise<Session> {
  const take = o.take
  const [vw, vh] = take.viewport ?? [1440, 900]
  const app = await electron.launch({
    // -r: el arranque de Electron precarga no-watch.cjs en el proceso principal (sin vigilantes de archivos)
    // --use-mock-keychain: la app empaquetada no pide el llavero de macOS (ni enseña su diálogo)
    args: ['-r', join(HERE, 'no-watch.cjs'), o.appDir, '--force-color-profile=srgb', '--force-device-scale-factor=2', '--use-mock-keychain'],
    env: {
      ...process.env,
      AULA_HOME: home,
      AULA_DEMO: '1',
      AULA_SEED: 'demo',
      AULA_SKIP_ONBOARDING: '1',
      AULA_HIDDEN: '1',
      AULA_THEME: take.theme ?? 'light',
      ...take.env
    }
  })
  await app.evaluate(({ app }) => app.dock?.hide())
  const page = await app.firstWindow()
  page.on('pageerror', (e) => o.log?.(`[${o.name}] error en la página: ${e.message}`))
  const ctx = app.context()
  await ctx.addInitScript(installInPage, { seed: o.seed ?? 20261026, pixelIdle: !!take.pixelIdle })
  const t0 = new Date(take.clock ?? todayAt10())
  await ctx.clock.install({ time: t0 })
  await ctx.clock.pauseAt(new Date(t0.getTime() + 1000))
  await ctx.addInitScript(installActivityProbe)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 2, mobile: false })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await cdp.send('Animation.enable')
  await reloadAligned(page, cdp)
  // la hora del proceso principal sigue a la de la interfaz si la toma fija su reloj (o va con mainClock)
  const dateStart = take.clock || take.mainClock ? await page.evaluate(() => Date.now()) : null
  await app.evaluate(installInMain, { virtualTimers: !!take.mainClock, dateStart })
  const s = new Session(app, page, cdp, !!take.mainClock)
  s.mainDate = dateStart !== null
  s.soft = !!o.soft
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (e) => {
    s.inflight.set(e.requestId, Date.now())
    s.netUrls.set(e.requestId, [Date.now(), `${e.type ?? '?'} ${e.request.url.slice(0, 120)}`])
  })
  const end = (id: string) => {
    s.inflight.delete(id)
    s.netUrls.delete(id)
  }
  cdp.on('Network.loadingFinished', (e) => end(e.requestId))
  cdp.on('Network.loadingFailed', (e) => end(e.requestId))
  return s
}

/** Captura una toma (o la reutiliza de la caché si su huella no cambió). */
export async function captureTake(o: CaptureOptions): Promise<TakeMeta> {
  const hash = takeHash(o.name, o.take, o.fps, o.fingerprint)
  const dir = join(o.outDir, o.name)
  const metaFile = join(dir, 'meta.json')
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as TakeMeta
    if (meta.hash === hash || o.reuse) return meta
  }
  // solo componer: nunca se regraba (ni se borra) una toma; sin meta.json puede ser que otro proceso la esté grabando
  if (process.env.AULA_VIDEO_NO_WORLDS === '1') throw new Error(`la toma «${o.name}» no está completa en ${dir} y AULA_VIDEO_NO_WORLDS=1 no deja capturar`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const home = mkdtempSync(join(tmpdir(), 'aula-video-'))
  if (o.take.home) cpSync(o.take.home, home, { recursive: true })
  else {
    cpSync(join(o.appDir, 'resources/demo-course/Packs'), join(home, 'Packs'), { recursive: true })
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ version: 2, onboarded: true, general: { language: o.take.lang ?? 'es', name: 'Boris' } }))
  }
  const tBoot = Date.now()
  const s = await launch(o, home)
  try {
    // arranque: 2 s virtuales en pasos de 100 ms, dejando que el IPC real responda entre paso y paso
    // primer arranque: la app siembra la demo, instala los cursos de ejemplo y calienta cachés (todo en tiempo real)
    const firstBoot = async () => {
      await s.page.waitForFunction(() => document.readyState === 'complete' && (document.getElementById('root')?.childElementCount ?? 0) > 0, null, { timeout: 30000 })
      for (let i = 0; i < 3; i++) await s.settle()
      for (let i = 0; i < 40; i++) await s.tick(50)
    }
    await firstBoot()
    await s.mainQuiet(1500)
    // segundo arranque, ya con el proceso principal en reposo: así toda la interfaz (también la barra lateral y lo que no
    // se vuelve a montar) nace en el mismo instante virtual en todas las capturas
    s.inflight.clear()
    await reloadAligned(s.page, s.cdp)
    await firstBoot()
    await s.mainQuiet(800)
    if (o.take.theme) await instant(s, { do: 'theme', value: o.take.theme })
    const bootMs = Date.now() - tBoot
    const tSetup = Date.now()
    // la pantalla del arranque se montó en un instante virtual que depende del tiempo real: se vuelve a montar en uno fijo
    for (const route of [{ name: 'tools' }, { name: 'home' }]) {
      await instant(s, { do: 'navigate', route })
      for (let i = 0; i < 12; i++) await s.tick(50)
    }
    // calienta las pantallas que se abrirán durante la toma (sus trozos de JS y datos quedan cargados)
    const warm = (o.take.actions ?? []).filter((a) => a.do === 'navigate')
    for (const a of warm) {
      await instant(s, a)
      for (let i = 0; i < 20; i++) await s.tick(50)
    }
    for (const a of o.take.setup ?? []) {
      await instant(s, a)
      for (let i = 0; i < 30; i++) await s.tick(50)
    }
    await s.mainQuiet(800)
    const setupMs = Date.now() - tSetup
    if (process.env.VT_DEBUG) writeFileSync(join(dir, 'debug.txt'), s.debug.join('\n'))

    const fps = o.fps
    const frames = Math.round(o.take.duration * fps)
    const actions = [...(o.take.actions ?? [])].sort((a, b) => a.at - b.at)
    const tracks: Track[] = []
    for (const a of actions) tracks.push(planAction(a))
    const marks: TakeMeta['marks'] = Object.fromEntries(Object.keys(o.take.marks ?? {}).map((k) => [k, []]))
    const cursor: TakeMeta['cursor'] = []
    const pixel: NonNullable<TakeMeta['pixel']> = []
    const frameHashes: string[] = []
    const writes: Promise<void>[] = []
    const tRec = Date.now()
    let virtualMs = 0
    for (let f = 0; f < frames; f++) {
      const t = f / fps
      const target = Math.round((f * 1000) / fps)
      await s.advance(target - virtualMs)
      virtualMs = target
      for (const tr of tracks) {
        if (t + 1e-9 < tr.start || tr.end + 1 / fps < t) continue
        await tr.step(s, Math.min(t, tr.end), t >= tr.end)
      }
      await s.settle()
      await s.drive()
      if (o.take.marks) {
        const r = await s.page.evaluate((m) => (window as unknown as W).__vt.rects(m), o.take.marks)
        for (const k of Object.keys(marks)) marks[k].push(r[k] ?? null)
      }
      cursor.push(s.cursor ? [s.cursor[0], s.cursor[1], s.down ? 1 : 0] : null)
      for (const ev of await s.page.evaluate(() => (window as unknown as W).__vt.pixel.splice(0))) pixel.push({ frame: f, ...ev })
      // depuración: una expresión de la página que se apunta cada 15 fotogramas (VT_PROBE="js")
      if (process.env.VT_PROBE && f % 15 === 0) s.debug.push(`P${f} ` + JSON.stringify(await s.page.evaluate(process.env.VT_PROBE)))
      if (process.env.VT_DEBUG)
        s.debug.push(
          `F${f} ipc=${await s.app.evaluate(() => (globalThis as G).__vtMain.log.splice(0).join(','))} net=${s.inflight.size} loops=${s.lastLoops} ` +
            (await s.page.evaluate(() => {
              const vt = (window as unknown as W).__vt
              const nums = [...document.querySelectorAll('.tabular')].slice(0, 4).map((e) => e.textContent).join('|')
              return `${performance.now()} m=${vt.mutations} act=${vt.activity} anims=${document.getAnimations().length} ${nums}`
            }))
        )
      const { data } = await s.cdp.send('Page.captureScreenshot', { format: 'png' })
      const png = Buffer.from(data, 'base64')
      frameHashes.push(createHash('sha1').update(png).digest('hex').slice(0, 16))
      writes.push(writeFile(join(dir, `${String(f).padStart(6, '0')}.png`), png))
      if (f % 60 === 0) o.log?.(`[${o.name}] ${f}/${frames}`)
    }
    await Promise.all(writes)
    const recordMs = Date.now() - tRec
    const meta: TakeMeta = {
      take: o.name,
      hash,
      fps,
      frames,
      viewport: o.take.viewport ?? [1440, 900],
      scale: 2,
      cursor,
      marks,
      pixel,
      frameHashes,
      timing: { bootMs, setupMs, recordMs, perFrameMs: Math.round(recordMs / Math.max(1, frames)) }
    }
    if (process.env.VT_DEBUG || process.env.VT_PROBE) writeFileSync(join(dir, 'debug.txt'), s.debug.join('\n'))
    for (const w of s.warnings) o.log?.(`[${o.name}] aviso: ${w}`)
    const long = await s.app.evaluate(() => (globalThis as G).__vtMain.long)
    if (long.length) o.log?.(`[${o.name}] IPC de más de 1,5 s (no frenan la captura): ${long.join(', ')}`)
    if (s.slowSettles) o.log?.(`[${o.name}] aviso: ${s.slowSettles} esperas de IPC agotaron el tope`)
    if (s.longNet.length) o.log?.(`[${o.name}] peticiones de más de 1,5 s (no frenan): ${[...new Set(s.longNet)].join(' · ')}`)
    writeFileSync(metaFile, JSON.stringify(meta))
    return meta
  } finally {
    await s.app.close().catch(() => {})
    rmSync(home, { recursive: true, force: true })
  }
}
