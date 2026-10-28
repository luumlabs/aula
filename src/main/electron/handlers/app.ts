// Métodos generales de la app.
import { app, nativeTheme, Notification, shell } from 'electron'
import { handle } from '../rpc'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { paths } from '@main/services/paths'
import { legalFallbackURL, legalFilePath } from '@main/services/legal'
import { isLegalDoc } from '@shared/legal'
import { invalidArgs } from '@main/services/errors'
import { getMainWindow } from '../window'
import { secretProtection } from '../secrets'
import { powerState } from '../power'
import { noticeNeeded } from '@shared/ipc/power'

export function register(): void {
  handle('app.info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataPath: paths.root(),
    locale: app.getLocale(),
    isPackaged: app.isPackaged,
    electron: process.versions.electron,
    secretProtection: secretProtection()
  }))
  handle('app.openExternal', async ({ url }) => {
    if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) throw invalidArgs('Solo se abren enlaces web')
    await shell.openExternal(url)
  })
  handle('app.showItemInFolder', ({ path }) => {
    const full = typeof path === 'string' ? resolve(path) : ''
    if (!full || !full.startsWith(resolve(paths.root()) + sep)) throw invalidArgs('Ruta fuera de la carpeta de Aula')
    shell.showItemInFolder(full)
  })
  handle('app.openLicenses', async (args) => {
    const which: unknown = (args as { which?: unknown } | undefined)?.which
    if (!isLegalDoc(which)) throw invalidArgs('Aviso legal no válido')
    // empaquetada van en Resources (electron-builder.yml); en desarrollo, en el proyecto (src/main/services/legal.ts)
    const file = legalFilePath(which, { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
    const web = legalFallbackURL(which)
    const error = existsSync(file) ? await shell.openPath(file) : 'No se encuentra el aviso de licencias'
    if (!error) return
    // sin programa para abrir el archivo (un .md en Windows): el mismo texto en la web
    if (web) return void (await shell.openExternal(web))
    throw invalidArgs(error)
  })
  handle('app.notify', ({ body, whenAway }) => {
    if (typeof body !== 'string' || !body.trim() || body.length > 300) throw invalidArgs('Aviso no válido')
    // «solo si no lo está viendo»: lo sabe el proceso principal (minimizada, oculta, detrás de otra app o bloqueada)
    if (whenAway === true && !noticeNeeded(powerState())) return
    if (!Notification.isSupported()) return
    new Notification({ title: 'Aula', body: body.trim() }).show()
  })
  handle('app.setTheme', ({ dark }) => {
    if (typeof dark !== 'boolean') throw invalidArgs('Tema no válido')
    applyWindowTheme(dark)
  })
}

/** La barra de título del sistema (Windows/Linux) y el fondo de la ventana siguen al tema que pinta la interfaz. */
function applyWindowTheme(dark: boolean): void {
  const win = getMainWindow()
  if (!win) return
  if (process.platform !== 'darwin') {
    win.setBackgroundColor(dark ? '#110f0c' : '#f3f0e9')
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f0eae3' : '#201e1a', height: 48 })
    } catch {
      /* sin barra superpuesta (Linux sin soporte) */
    }
  } else {
    // en macOS el vidrio sigue al sistema; con el tema forzado, que el sistema lo sepa también
    nativeTheme.themeSource = dark === nativeTheme.shouldUseDarkColors ? nativeTheme.themeSource : dark ? 'dark' : 'light'
  }
}
