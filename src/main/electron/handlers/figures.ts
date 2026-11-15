import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '@main/services/errors'
import { FigureExports } from '@main/services/figures/service'
import { isServerMode } from '@main/services/remote/server-mode'
import { handle, type RpcContext } from '../rpc'
import { renderDrawingPng, cancelDrawingRender } from '../figure-render'

export function register(): void {
  const exports = new FigureExports(), watched = new WeakSet<object>()
  function local(ctx: RpcContext): BrowserWindow {
    if (ctx.remote || isServerMode() || !ctx.sender || ctx.sender.isDestroyed()) {
      throw new AulaError('forbidden', tr('Exporta figuras desde la app de escritorio.', 'Export figures from the desktop app.'))
    }
    const parent = BrowserWindow.fromWebContents(ctx.sender)
    if (!parent || parent.isDestroyed()) throw new AulaError('forbidden', tr('La ventana ya no está disponible.', 'The window is no longer available.'))
    if (!watched.has(ctx.sender)) {
      watched.add(ctx.sender)
      ctx.sender.once('destroyed', () => exports.forget(ctx.sender))
    }
    return parent
  }
  handle('figures.renderDrawingPng', (args, ctx) => { local(ctx); return renderDrawingPng(args, ctx.sender) })
  handle('figures.cancelRender', (args, ctx) => { local(ctx); cancelDrawingRender(args, ctx.sender) })
  handle('figures.save', async (args, ctx) => {
    const parent = local(ctx)
    return exports.save(args, ctx.sender, async (name, format) => {
      if (ctx.sender.isDestroyed() || parent.isDestroyed()) return null
      const result = await dialog.showSaveDialog(parent, {
        title: tr('Guardar figura', 'Save figure'), buttonLabel: tr('Guardar', 'Save'),
        defaultPath: join(app.getPath('downloads'), name),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      return result.canceled || !result.filePath || ctx.sender.isDestroyed() || parent.isDestroyed() ? null : result.filePath
    })
  })
  handle('figures.revealSaved', (args, ctx) => {
    local(ctx)
    shell.showItemInFolder(exports.revealPath(ctx.sender, args))
  })
}
