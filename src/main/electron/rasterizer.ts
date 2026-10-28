// Dibuja páginas de PDF a PNG para el OCR de las escaneadas (y convierte imágenes que el OCR no lee): una ventana oculta
// con pdf.js (src/renderer/raster.html), sin puente ni permisos, que se crea al primer uso y se cierra si no se usa.
import { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import type { PageRasterizer } from '@shared/ingest'
import { setDefaultRasterizer } from '@main/services/ingest'
import { log } from '@main/services/log'
import { appURL } from './window'

const IDLE_MS = 2 * 60 * 1000
/** Tope de cada paso del dibujante (A2-P2-16: si la ventana se colgaba o se caía, la página quedaba esperando para siempre). */
const STEP_MS = 90_000
let win: BrowserWindow | null = null
/** Se cumple cuando se cae el proceso de la ventana actual (lo que estaba esperando falla en vez de quedarse colgado). */
let gone: Promise<never> | null = null
let ready: Promise<BrowserWindow> | null = null
let idle: NodeJS.Timeout | null = null
let queue: Promise<unknown> = Promise.resolve()

function touch(): void {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => {
    win?.destroy()
    win = null
    ready = null
  }, IDLE_MS)
}

function open(): Promise<BrowserWindow> {
  if (ready && win && !win.isDestroyed()) return ready
  const w = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false }
  })
  // nunca navega ni abre ventanas
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // si se cae, la siguiente página abre una ventana nueva y la que se estaba dibujando falla enseguida
  gone = new Promise<never>((_resolve, reject) => {
    w.webContents.once('render-process-gone', (_e, details) => {
      log.warn(`[raster] la ventana del dibujante se cayó (${details.reason}); se abrirá otra`)
      discard(w)
      reject(new Error('El dibujante de páginas se cerró'))
    })
  })
  gone.catch(() => undefined)
  win = w
  ready = w.loadURL(appURL('raster.html')).then(async () => {
    // espera a que el módulo instale `__raster`
    for (let i = 0; i < 100; i++) {
      if (await w.webContents.executeJavaScript('typeof window.__raster === "object"')) return w
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('El dibujante de páginas no arrancó')
  })
  return ready
}

/** Cierra esta ventana del dibujante (colgada o caída): la próxima llamada abre otra. */
function discard(w: BrowserWindow): void {
  if (win === w) { win = null; ready = null; gone = null }
  try { if (!w.isDestroyed()) w.destroy() } catch { /* ya cerrada */ }
}

/** Un paso en la ventana con su tope; si no responde a tiempo (o se cae), se cierra y la llamada falla. */
async function run<T>(w: BrowserWindow, js: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { discard(w); reject(new Error('El dibujante de páginas no respondió a tiempo')) }, STEP_MS)
  })
  try {
    return (await Promise.race([w.webContents.executeJavaScript(js) as Promise<T>, late, ...(gone ? [gone] : [])]))
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Las llamadas van de una en una (una sola ventana, memoria acotada). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

/** Huella de cada PDF ya visto (por objeto): no se vuelve a calcular para cada página. */
const keys = new WeakMap<Uint8Array, string>()
function keyOf(pdf: Uint8Array): string {
  let k = keys.get(pdf)
  if (!k) {
    k = createHash('sha256').update(pdf).digest('hex').slice(0, 32)
    keys.set(pdf, k)
  }
  return k
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

export const electronRasterizer: PageRasterizer = {
  renderPdfPage: (pdf, page, maxDimension) =>
    serial(async () => {
      try {
        const w = await open()
        touch()
        const key = keyOf(pdf)
        const has = await run<boolean>(w, `window.__raster.has(${JSON.stringify(key)})`)
        if (!has) await run<unknown>(w, `window.__raster.open(${JSON.stringify(key)}, ${JSON.stringify(b64(pdf))})`)
        const png = await run<string | null>(w, `window.__raster.render(${JSON.stringify(key)}, ${Math.floor(page)}, ${Math.floor(maxDimension)})`)
        return png ? new Uint8Array(Buffer.from(png, 'base64')) : null
      } catch (err) {
        log.warn('[raster] página', err)
        return null
      }
    }),
  imageToPng: (image, maxDimension) =>
    serial(async () => {
      try {
        const w = await open()
        touch()
        const png = await run<string | null>(w, `window.__raster.imageToPng(${JSON.stringify(b64(image))}, ${Math.floor(maxDimension)})`)
        return png ? new Uint8Array(Buffer.from(png, 'base64')) : null
      } catch (err) {
        log.warn('[raster] imagen', err)
        return null
      }
    })
}

/** Instala el dibujante para todas las lecturas de materiales. */
export function installRasterizer(): void {
  setDefaultRasterizer(electronRasterizer)
}
