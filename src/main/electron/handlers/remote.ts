// IPC del acceso desde los dispositivos del estudiante (Ajustes → Tus dispositivos). La lógica está en ../remote.
import { app } from 'electron'
import { invalidArgs } from '@main/services/errors'
import { handle } from '../rpc'
import { remoteAccess } from '../remote'

export function register(): void {
  const remote = remoteAccess()
  handle('remote.status', () => remote.status())
  handle('remote.setEnabled', (args) => {
    if (typeof args?.enabled !== 'boolean') throw invalidArgs('Valor no válido')
    return remote.setEnabled(args.enabled)
  })
  handle('remote.startPairing', () => remote.startPairing())
  handle('remote.cancelPairing', () => remote.cancelPairing())
  handle('remote.revoke', (args) => {
    if (typeof args?.id !== 'string' || !/^[0-9a-f]{6,32}$/.test(args.id)) throw invalidArgs('Dispositivo no válido')
    return remote.revoke(args.id)
  })
  handle('remote.tailnetLogin', () => remote.tailnetLogin())
  handle('remote.tailnetLogout', () => remote.tailnetLogout())
  void remote.init()
  // al salir: se para el servidor y el proceso de Tailscale (que no quede huérfano)
  app.on('before-quit', () => { void remote.shutdown() })
}
