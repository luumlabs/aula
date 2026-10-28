// Proceso principal de Aula.
import { app, BrowserWindow, protocol, session } from 'electron'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import electronLog from 'electron-log/main'
import { emit, installRpc, setTrustedPage } from './electron/rpc'
import { createMainWindow, getMainWindow, isAppURL } from './electron/window'
import { reveal, windowsAlwaysHidden } from './electron/visibility'
import { registerAllHandlers } from './electron/handlers'
import { setDataRoot, paths } from './services/paths'
import { setPackaged } from './services/runtime'
import { log } from './services/log'
import { readJSON } from './services/fs'
import { registerAppProtocol, registerAssetProtocol, SCHEME_PRIVILEGES } from './electron/protocol'
import { setSecretStore } from './services/secrets'
import { SafeStorageSecretStore } from './electron/secrets'
import { loadSettings, updateSettings } from './services/settings'
import { applyPendingWipe, type WipeResult } from './services/settings/data'
import { installUILanguage } from '@main/services/settings/uiLanguage'
import { installMenu } from './electron/menu'
import { useSystemProxy } from './electron/proxy'
import { installRasterizer } from './electron/rasterizer'
import { installIngestWorker } from './electron/ingest-host'
import { startBackground } from './electron/background'
import { installRecovery } from './electron/recovery'
import { migrateFileStorage } from './electron/migrate-storage'
import { isAuditBuild, refusedDebugSwitch } from './electron/debug-guard'

// la app instalada no abre la depuración remota (CDP): se sale antes de leer datos, sesiones o cookies
const debugSwitch = refusedDebugSwitch(app.isPackaged, (s) => app.commandLine.hasSwitch(s), isAuditBuild())
if (debugSwitch) {
  process.stderr.write(`Aula: --${debugSwitch} no está permitido en la app instalada (not allowed in the installed app)\n`)
  app.exit(1)
}
app.setName('Aula')
// los servicios no importan Electron: así saben si es la app instalada (sin atajos de desarrollo)
setPackaged(app.isPackaged)
// Carpeta de datos: la misma que la app Swift (~/Library/Application Support/Aula) o $AULA_HOME.
const dataRoot = process.env.AULA_HOME || join(app.getPath('appData'), 'Aula')
app.setPath('userData', dataRoot)
setDataRoot(dataRoot)
// una sola instancia: la segunda solo avisa a la primera (y nunca toca la carpeta de datos)
const primaryInstance = app.requestSingleInstanceLock()
// «Borrar todos los datos» se completa aquí, antes de abrir nada de la carpeta (y solo en la instancia que tiene el cerrojo)
let wipe: WipeResult | null = null
if (primaryInstance) applyPendingWipe(dataRoot, { onResult: (r) => { wipe = r } })
// El perfil de Chromium (cookies de las plataformas, cachés) va en su propia subcarpeta.
app.setPath('sessionData', paths.browserData())
// Fechas y horas nativas (<input type="date">, «mm/dd/aaaa») en el idioma elegido en Aula, no en el del sistema
// (se aplica al arrancar: un cambio de idioma se nota en ellas tras reiniciar).
const chosenLanguage = readJSON<{ general?: { language?: unknown } }>(paths.settings())?.general?.language
if (chosenLanguage === 'es' || chosenLanguage === 'en') app.commandLine.appendSwitch('lang', chosenLanguage === 'es' ? 'es-ES' : 'en-US')

electronLog.transports.file.resolvePathFn = () => join(paths.logs(), 'main.log')
electronLog.transports.file.maxSize = 2 * 1024 * 1024
log.setSink((level, ...args) => electronLog[level](...args))
logWipe(wipe)

/** La caché de electron-updater (`updaterCacheDirName: aula-updater`), donde deja las descargas. */
function updaterCacheDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'aula-updater')
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'aula-updater')
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'aula-updater')
}

function logWipe(r: WipeResult | null): void {
  if (!r) return
  // las descargas de actualizaciones (fuera de la carpeta de datos: ~/Library/Caches/aula-updater…) también se van
  if (r.wiped) {
    try { rmSync(updaterCacheDir(), { recursive: true, force: true }) } catch { /* nada */ }
  }
  if (r.refused) log.warn(`[datos] no se borró la carpeta de datos: ${r.refused}`)
  else log.info(`[datos] carpeta de datos borrada${r.left.length ? ` (se quedan: ${r.left.join(', ')})` : ''}`)
}

// app:// (la interfaz) y aula-asset:// (archivos de los cursos)
protocol.registerSchemesAsPrivileged(SCHEME_PRIVILEGES)

/** Permisos que la interfaz puede tener (y solo la página de la app): avisos del temporizador, copiar y pantalla completa.
 *  Cámara, micrófono, ubicación, leer el portapapeles… denegados (la interfaz no los usa). */
const APP_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen'])
function restrictAppPermissions(): void {
  const ses = session.defaultSession
  const allowed = (permission: string, url: string | undefined) => APP_PERMISSIONS.has(permission) && !!url && isAppURL(url)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowed(permission, details.requestingUrl ?? wc?.getURL())))
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed(permission, origin ? `${origin}/` : wc?.getURL()))
  ses.setDevicePermissionHandler(() => false)
  ses.setDisplayMediaRequestHandler((_req, callback) => callback(null))
}

if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => { reveal(getMainWindow()) })

  app.whenReady().then(async () => {
    // lanzada con AULA_HIDDEN (pruebas, capturas): sin icono en el Dock que alguien pueda pulsar
    if (windowsAlwaysHidden()) app.dock?.hide()
    // si el llavero no deja leer secrets.enc, el almacén se bloquea (sin perder nada) y la interfaz lo avisa
    setSecretStore(new SafeStorageSecretStore((status) => emit('secrets.changed', status)))
    // con un proxy del sistema (redes de centros), las peticiones del proceso principal lo usan
    await useSystemProxy().catch((e) => log.warn('[red] proxy', e))
    loadSettings()
    // un solo idioma para todo lo que genera el proceso principal (tr(), motor, listas, documentos…), fijado ANTES de
    // registrar los handlers: el de la interfaz de Aula
    installUILanguage(() => app.getLocale())
    if (process.env.AULA_SKIP_ONBOARDING) updateSettings({ onboarded: true })
    restrictAppPermissions()
    registerAppProtocol()
    registerAssetProtocol()
    installRpc()
    setTrustedPage(isAppURL)
    registerAllHandlers()
    // capturas y desarrollo: seis semanas de estudio simuladas con el motor real
    if (!app.isPackaged && process.env.AULA_SEED === 'demo') await import('./dev/seed').then((m) => { m.seedDemoProgress(); m.seedDemoCalendar() }).catch((e) => log.warn('[seed]', e))
    installMenu()
    installRasterizer()
    installIngestWorker()
    startBackground()
    // si la interfaz se cae, la ventana se recarga sola en vez de quedarse en blanco
    installRecovery()
    // la interfaz ya no va por file://: sus preferencias de localStorage pasan una vez a app://aula
    await migrateFileStorage(paths.browserData())
    createMainWindow()
    // macOS emite `activate` al lanzar la app y al pulsar su icono del Dock: con AULA_HIDDEN no enseña nada
    app.on('activate', () => {
      if (windowsAlwaysHidden()) return
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else reveal(getMainWindow(), { focus: false })
    })
  }).catch((err) => log.error('Arranque', err))

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
