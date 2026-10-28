// Ventana principal: sin barra de título del sistema (la interfaz dibuja la suya), segura y con tamaño recordado.
import { app, BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { trustWebContents, emit } from './rpc'
import { paths } from '@main/services/paths'
import { APP_ORIGIN, APP_SCHEME } from './protocol'
import { watchPower } from './power'
import { showWhenReady, windowsAlwaysHidden } from './visibility'

interface Bounds { x?: number; y?: number; width: number; height: number; maximized?: boolean }

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function boundsFile(): string {
  return join(paths.root(), 'window.json')
}

function loadBounds(): Bounds {
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8')) as Bounds
    const area = screen.getDisplayMatching({ x: b.x ?? 0, y: b.y ?? 0, width: b.width, height: b.height }).workArea
    if (b.width >= 900 && b.height >= 620 && b.width <= area.width + 40 && b.height <= area.height + 40) return b
  } catch {
    /* primera vez */
  }
  const area = screen.getPrimaryDisplay().workAreaSize
  return { width: Math.min(1480, Math.round(area.width * 0.9)), height: Math.min(940, Math.round(area.height * 0.9)) }
}

function saveBounds(win: BrowserWindow): void {
  try {
    const b: Bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    writeFileSync(boundsFile(), JSON.stringify(b))
  } catch {
    /* sin importancia */
  }
}

/** Dirección de la página de la app (sin consulta ni ancla): app://aula/index.html (en desarrollo, el servidor de vite). */
export function appPageURL(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return new URL(devUrl).href
  return `${APP_ORIGIN}/index.html`
}

/** Dirección de otra página de la interfaz (raster.html…), con consulta opcional. */
export function appURL(page: string, query?: Record<string, string>): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const u = !app.isPackaged && devUrl ? new URL(page === 'index.html' ? '' : page, new URL(devUrl).href) : new URL(`${APP_ORIGIN}/${page}`)
  for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v)
  return u.href
}

/** ¿Es la página de la app (con cualquier consulta o ancla)? */
export function isAppURL(url: string): boolean {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    const page = new URL(appPageURL())
    if (page.protocol === `${APP_SCHEME}:`) return u.href === page.href || u.href === `${APP_ORIGIN}/`
    // en desarrollo, el servidor de vite (mismo origen)
    return u.origin === page.origin
  } catch {
    return false
  }
}

export function createMainWindow(): BrowserWindow {
  const bounds = loadBounds()
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Aula',
    icon: process.platform === 'linux' ? join(__dirname, '../../resources/icon.png') : undefined,
    // macOS: ventana translúcida (el vidrio del sistema se ve bajo la barra lateral, como en la app original).
    backgroundColor: isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#110f0c' : '#f3f0e9',
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'followWindow' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 22, y: 22 } : undefined,
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f0eae3' : '#201e1a', height: 48 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true
    }
  })
  mainWindow = win
  trustWebContents(win.webContents)
  // maximizar enseña la ventana: con AULA_HIDDEN, no
  if (bounds.maximized && !windowsAlwaysHidden()) win.maximize()

  const show = showWhenReady()
  win.once('ready-to-show', () => {
    if (show && !windowsAlwaysHidden()) win.show()
  })
  win.on('close', () => saveBounds(win))
  win.on('focus', () => emit('app.focus', { focused: true }))
  win.on('blur', () => emit('app.focus', { focused: false }))
  // la interfaz duerme lo ambiental cuando la ventana no se ve (J4-1)
  watchPower(win)

  // Los enlaces externos se abren en el navegador del sistema; la ventana nunca navega fuera de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // La ventana solo muestra la página de la app: cualquier otra navegación (un enlace de un curso importado, file://…) se
  // bloquea, y si es web se abre en el navegador del sistema.
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppURL(url)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  win.webContents.on('will-redirect', (e, url) => {
    if (!isAppURL(url)) e.preventDefault()
  })

  // la interfaz por su protocolo propio (app://aula), nunca por file://
  void win.loadURL(appURL('index.html', process.env.AULA_DEMO ? { demo: '1' } : undefined))
  return win
}
