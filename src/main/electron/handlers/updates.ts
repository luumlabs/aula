// Actualizaciones de la app (ver ../updates.ts).
import { handle } from '../rpc'
import { checkForUpdates, installUpdate, openDownloadPage, startUpdates, updateState } from '../updates'

export function register(): void {
  handle('updates.state', () => updateState())
  handle('updates.check', () => checkForUpdates(true))
  handle('updates.install', () => installUpdate())
  handle('updates.openDownloadPage', () => openDownloadPage())
  startUpdates()
}
