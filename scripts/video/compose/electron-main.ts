// Proceso principal de Electron del compositor (NO es la app Aula): una ventana oculta que dibuja el montaje en canvas,
// codifica con WebCodecs (VideoToolbox en macOS) y escribe el MP4. Sirve los archivos del trabajo por vt:// (de solo
// lectura) y solo deja escribir dentro de la carpeta de salida del trabajo.
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'

interface HostJob {
  /** Carpeta con page.html y page.js. */
  buildDir: string
  /** Carpeta de las tomas capturadas (se sirven como vt://work/…). */
  workDir: string
  /** Carpeta donde la página puede escribir. */
  outDir: string
  /** Carpeta de la pista decodificada (caché fuera del repo), servida como vt://music/… */
  musicDir?: string
  /** Datos para la página (montaje, opciones). */
  payload: unknown
}

const jobPath = process.argv[process.argv.indexOf('--job') + 1]
const job = JSON.parse(readFileSync(jobPath, 'utf8')) as HostJob

protocol.registerSchemesAsPrivileged([{ scheme: 'vt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const MIME: Record<string, string> = { '.wav': 'audio/wav', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' }

function inside(root: string, rel: string): string | null {
  const full = normalize(join(root, decodeURIComponent(rel)))
  const r = relative(root, full)
  return r.startsWith('..') || r.startsWith(sep) ? null : full
}

function say(msg: unknown): void {
  process.stdout.write('@vt ' + JSON.stringify(msg) + '\n')
}

// perfil propio, dentro de la carpeta del trabajo (nunca ~/Library/Application Support/…)
app.setPath('userData', join(job.outDir, '.build', 'profile'))
app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.dock?.hide()

app.whenReady().then(async () => {
  protocol.handle('vt', (req) => {
    const url = new URL(req.url)
    const root = url.host === 'build' ? job.buildDir : url.host === 'work' ? job.workDir : url.host === 'out' ? job.outDir : url.host === 'music' && job.musicDir ? job.musicDir : null
    const file = root ? inside(root, url.pathname.slice(1)) : null
    if (!file) return new Response('no', { status: 403 })
    try {
      const body = readFileSync(file)
      const ext = file.slice(file.lastIndexOf('.'))
      return new Response(body, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } })
    } catch {
      return new Response('no', { status: 404 })
    }
  })
  ipcMain.handle('vt:job', () => job.payload)
  ipcMain.handle('vt:write', (_e, rel: string, data: Uint8Array) => {
    const file = inside(job.outDir, rel)
    if (!file) throw new Error('ruta fuera de la salida: ' + rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data)
    return file
  })
  ipcMain.on('vt:log', (_e, msg: unknown) => say(msg))
  ipcMain.on('vt:done', (_e, result: unknown) => {
    say({ done: result })
    app.exit(0)
  })
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: resolve(job.buildDir, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.on('console-message', (e) => say({ console: e.message }))
  win.webContents.on('render-process-gone', (_e, d) => {
    say({ error: 'el renderizador se cerró: ' + d.reason })
    app.exit(2)
  })
  await win.loadURL('vt://build/page.html')
})
