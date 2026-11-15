// Renderer sin preload ni RPC, en una sesión en memoria y con recursos locales enumerados por el build.
import { BrowserWindow, screen, session, type Session, type NativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FIGURE_LIMITS, FigureValidationError } from '@shared/figures'
import type { DrawingRenderApi, DrawingRenderBounds } from '@shared/figuresDrawing'
import { tr } from '@shared/ai/i18n'
import { validateDrawingRenderScene } from '@engine/figures/drawing'
import { AulaError } from '@main/services/errors'
import { canonicalizeFigurePng } from '@main/services/figures/png'
import { FigureRenderJobs, type FigureRenderJob, type FigureRenderOwner } from '@main/services/figures/render-job'
import { FIGURE_RENDER_URL, FIGURE_RENDER_CSP, figureAssetName, loadFigureAssets } from '@main/services/figures/render-assets'
import { checkRenderSize, drawingCaptureSize, privatePngSize } from '@main/services/figures/render-size'

const jobs = new FigureRenderJobs(20_000, () => performance.now(), 1000), partition = `aula-figure-${randomUUID()}`
let isolated: Promise<Session> | undefined, sessionPoisoned = false
const invalid = () => new AulaError('invalid_args', tr('No se puede exportar ese dibujo.', 'This drawing cannot be exported.'))
const failed = () => new AulaError('render_failed', tr('No se pudo preparar el dibujo.', 'The drawing could not be prepared.'))
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k))) throw invalid()
  const out: Record<string, unknown> = {}
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d)) throw invalid(); out[key] = d.value }
  return out
}
async function isolatedSession(): Promise<Session> {
  if (sessionPoisoned) throw failed()
  if (process.env.ELECTRON_RENDERER_URL) throw new AulaError('render_build_required', tr('Compila Aula para exportar dibujos; la vista de desarrollo no se usa para capturas.', 'Build Aula to export drawings; the development page is not used for captures.'))
  isolated ??= (async () => {
    const assets = await loadFigureAssets(join(__dirname, '../renderer'))
    const s = session.fromPartition(partition, { cache: false })
    s.setPermissionCheckHandler(() => false)
    s.setDevicePermissionHandler(() => false)
    s.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    s.setDisplayMediaRequestHandler((_request, callback) => callback({}))
    s.on('will-download', (event, item) => { event.preventDefault(); item.cancel() })
    s.webRequest.onBeforeRequest((details, callback) => {
      const name = figureAssetName(details.url)
      const allowed = !!name && assets.has(name) && (details.method === 'GET' || details.method === 'HEAD') && details.resourceType !== 'subFrame' && (details.resourceType !== 'mainFrame' || details.url === FIGURE_RENDER_URL)
      callback({ cancel: !allowed })
    })
    await s.protocol.handle('app', async request => {
      const name = figureAssetName(request.url), asset = name ? assets.get(name) : undefined
      if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 })
      try {
        const data = request.method === 'HEAD' ? null : new Uint8Array(await readFile(asset.file))
        return new Response(data, { headers: { 'content-type': asset.mime, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': FIGURE_RENDER_CSP } })
      } catch { return new Response(null, { status: 404 }) }
    })
    return s
  })().catch(error => { isolated = undefined; throw error })
  return isolated
}

async function clearSession(s: Session, remaining: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all([s.clearStorageData(), s.clearCache(), s.closeAllConnections()]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(failed()), Math.max(0, Math.min(1000, remaining))) })
    ])
  } catch (error) {
    // No se crea otra partición ni se reutiliza almacenamiento cuya limpieza no pudo verificarse.
    sessionPoisoned = true
    throw error
  } finally { if (timer) clearTimeout(timer) }
}

function displays(): string {
  return JSON.stringify(screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor })).sort((a, b) => a.id - b.id))
}
function captureSize(image: NativeImage): { width: number; height: number } {
  if (image.isEmpty()) throw failed()
  const size = image.getSize()
  checkRenderSize(size.width, size.height)
  return size
}
async function invoke<K extends keyof Omit<DrawingRenderApi, 'cancel'>>(win: BrowserWindow, job: FigureRenderJob, method: K, args: Parameters<DrawingRenderApi[K]>[0]): Promise<unknown> {
  job.check()
  // El nombre es una unión interna; el argumento es JSON copiado/validado, jamás código del emisor.
  const json = JSON.stringify(args).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return job.wait(win.webContents.executeJavaScript(`window.aulaFigureRender.${method}(${json})`, false))
}
function measured(value: unknown): { bounds: DrawingRenderBounds; layoutWidth: number; layoutHeight: number } {
  const v = object(value, ['bounds', 'layoutWidth', 'layoutHeight']), b = object(v.bounds, ['x', 'y', 'width', 'height'])
  const numbers = [...Object.values(b), v.layoutWidth, v.layoutHeight]
  if (numbers.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw failed()
  const bounds = b as unknown as DrawingRenderBounds
  if (bounds.width <= 0 || bounds.height <= 0 || (v.layoutWidth as number) <= 0 || (v.layoutHeight as number) <= 0) throw failed()
  return { bounds, layoutWidth: v.layoutWidth as number, layoutHeight: v.layoutHeight as number }
}

export async function renderDrawingPng(value: unknown, owner: FigureRenderOwner): Promise<{ data: Uint8Array; width: number; height: number }> {
  return jobs.run(owner, () => object(value, ['jobId', 'scene']).jobId as string, async job => {
    try {
      const args = object(value, ['jobId', 'scene']), scene = validateDrawingRenderScene(args.scene)
      job.check()
      const knownDisplays = screen.getAllDisplays()
      if (!knownDisplays.length || knownDisplays.some(display => !Number.isFinite(display.scaleFactor) || display.scaleFactor < .5 || display.scaleFactor > 8)) throw failed()
      const ownSession = await job.wait(isolatedSession())
      // La captura no usa el marco grueso de Windows: sus insets alteran el viewport de calibración.
      const win = new BrowserWindow({ show: false, width: 128, height: 128, useContentSize: true, frame: false, thickFrame: false, focusable: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, hasShadow: false, paintWhenInitiallyHidden: true, backgroundColor: scene.appearance.palette.paper, webPreferences: { session: ownSession, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, devTools: false, plugins: false, spellcheck: false, backgroundThrottling: false } })
      job.cleanup(() => clearSession(ownSession, job.remaining()))
      job.cleanup(() => { if (!win.isDestroyed()) win.destroy() })
      const wc = win.webContents
      let painted!: () => void
      const firstPaint = new Promise<void>(resolve => { painted = resolve; win.once('ready-to-show', painted) })
      job.cleanup(() => { win.removeListener('ready-to-show', painted) })
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('will-navigate', e => e.preventDefault()); wc.on('will-frame-navigate', e => e.preventDefault()); wc.on('will-redirect', e => e.preventDefault()); wc.on('will-attach-webview', e => e.preventDefault())
      wc.once('render-process-gone', () => job.abort(failed()))
      const destroyed = (): void => job.abort(failed())
      wc.once('destroyed', destroyed)
      job.cleanup(() => { wc.removeListener('destroyed', destroyed) })
      win.on('show', () => job.abort(failed()))
      const displayState = displays(), initialDisplay = screen.getDisplayMatching(win.getBounds())
      const displayChanged = (): void => job.abort(failed())
      screen.on('display-added', displayChanged); screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged)
      job.cleanup(() => { screen.removeListener('display-added', displayChanged); screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged) })
      await job.wait(win.loadURL(FIGURE_RENDER_URL))
      const ready = await job.wait(wc.executeJavaScript('Boolean(window.aulaFigureRender)', false))
      if (ready !== true) throw failed()
      // La escena permanece recortada a 128 DIP mientras espera fuentes y dos frames estables.
      const result = measured(await invoke(win, job, 'render', scene))
      await job.wait(firstPaint)
      const calibrate = () => job.wait(wc.capturePage({ x: 0, y: 0, width: 128, height: 128 }, { stayHidden: true, stayAwake: false }))
      let small: NativeImage
      try { small = await calibrate() } catch (error) {
        // Chromium puede perder la primera superficie oculta; sólo se repite ese error comprobado.
        if (!(error instanceof Error) || error.message !== 'UnknownVizError') throw error
        await job.wait(wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))', false))
        small = await calibrate()
      }
      const actual = captureSize(small), tinyPng = small.toPNG(), tiny = privatePngSize(tinyPng)
      if (actual.width !== tiny.width || actual.height !== tiny.height || actual.width !== actual.height) throw failed()
      const physicalScale = Math.max(actual.width / 128, initialDisplay.scaleFactor, ...screen.getAllDisplays().map(d => d.scaleFactor))
      if (displays() !== displayState) throw failed()
      const size = drawingCaptureSize(result.bounds, scene.output.scale, physicalScale)
      if (Math.abs(result.layoutWidth - scene.metrics.layoutWidth) > .1 || Math.abs(result.layoutHeight - scene.canvas.height * scene.metrics.layoutWidth / scene.canvas.width) > .1) throw failed()
      job.check()
      if (displays() !== displayState) throw failed()
      win.setContentSize(size.width, size.height)
      if (screen.getDisplayMatching(win.getBounds()).id !== initialDisplay.id) throw failed()
      const resized = object(await invoke(win, job, 'resize', { width: size.width, height: size.height, scale: size.scale, offsetX: -result.bounds.x * size.scale, offsetY: -result.bounds.y * size.scale }), ['width', 'height'])
      if (resized.width !== size.width || resized.height !== size.height || win.getContentSize()[0] !== size.width || win.getContentSize()[1] !== size.height || displays() !== displayState) throw failed()
      const captured = await job.wait(wc.capturePage({ x: 0, y: 0, width: size.width, height: size.height }, { stayHidden: true, stayAwake: false }))
      const capturedSize = captureSize(captured)
      if (Math.abs(capturedSize.width - size.width * actual.width / 128) > 1 || Math.abs(capturedSize.height - size.height * actual.height / 128) > 1 || displays() !== displayState) throw failed()
      job.check()
      const nativePng = captured.toPNG(), nativeSize = privatePngSize(nativePng)
      if (nativeSize.width !== capturedSize.width || nativeSize.height !== capturedSize.height) throw failed()
      const normalized = object(await invoke(win, job, 'normalize', { data: nativePng.toString('base64'), width: size.outputWidth, height: size.outputHeight }), ['data', 'width', 'height'])
      if (normalized.width !== size.outputWidth || normalized.height !== size.outputHeight || typeof normalized.data !== 'string' || normalized.data.length > Math.ceil(FIGURE_LIMITS.maxPngBytes / 3) * 4 || normalized.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized.data) || /=[^=]|={3}/.test(normalized.data)) throw failed()
      const bytes = Buffer.from(normalized.data, 'base64'), outputSize = privatePngSize(bytes)
      if (outputSize.width !== size.outputWidth || outputSize.height !== size.outputHeight) throw failed()
      const data = await job.wait(canonicalizeFigurePng(bytes))
      return { data: new Uint8Array(data), width: outputSize.width, height: outputSize.height }
    } catch (error) {
      if (error instanceof AulaError) throw error
      if (error instanceof FigureValidationError) throw error.reason === 'too_large' ? new AulaError('too_large', tr('El dibujo es demasiado grande para exportarlo.', 'The drawing is too large to export.')) : invalid()
      throw failed()
    }
  })
}
export function cancelDrawingRender(value: unknown, owner: FigureRenderOwner): void { jobs.cancel(owner, object(value, ['jobId']).jobId) }
// Cada trabajo destruye su ventana; la sesión única es efímera y no conserva cookies ni datos de la aplicación.
