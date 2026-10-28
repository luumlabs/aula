import { app, BrowserWindow, dialog, type SaveDialogOptions } from 'electron'
import { extname, join } from 'node:path'
import { handle, emit } from '../rpc'
import { paths } from '@main/services/paths'
import { log } from '@main/services/log'
import { exportAllData, scheduleDataWipe } from '@main/services/settings/data'
import { getSettings, updateSettings, onSettingsChange } from '@main/services/settings'
import { invalidArgs } from '@main/services/errors'
import { uiLanguage } from '@main/services/settings/uiLanguage'
import { tr } from '@shared/ai/i18n'
import { sanitizeSettingsPatch, SettingsPatchError } from '@shared/settings/patch'

export function register(): void {
  handle('settings.get', () => getSettings())
  handle('settings.update', (patch) => {
    // solo campos sencillos y comprobados: la IA y las cuentas se cambian con sus propios métodos
    let clean
    try {
      clean = sanitizeSettingsPatch(patch)
    } catch (err) {
      throw invalidArgs(err instanceof SettingsPatchError ? err.message : tr('Ajustes no válidos', 'Invalid settings'))
    }
    return updateSettings(clean)
  })
  onSettingsChange((s) => emit('settings.changed', s))

  handle('data.exportAll', async (_args, ctx) => {
    const day = new Date().toISOString().slice(0, 10)
    const opts: SaveDialogOptions = {
      title: words().exportTitle,
      defaultPath: join(app.getPath('documents'), `Aula ${day}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    }
    const win = BrowserWindow.fromWebContents(ctx.sender)
    const choice = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (choice.canceled || !choice.filePath) return null
    const path = extname(choice.filePath) ? choice.filePath : `${choice.filePath}.zip`
    await exportAllData(paths.root(), path)
    return { path }
  })

  handle('data.deleteAll', () => {
    // se borra al arrancar otra vez, antes de abrir nada (aquí hay archivos abiertos y servicios escribiendo)
    scheduleDataWipe(paths.root())
    log.info('Borrar todos los datos: Aula se reinicia y vacía la carpeta de datos')
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 150)
  })
}

function words(): { exportTitle: string } {
  return { exportTitle: uiLanguage() === 'es' ? 'Exportar todos tus datos' : 'Export all your data' }
}
