// Puente mínimo del compositor: leer el trabajo, escribir en la salida, informar y terminar.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('vt', {
  job: (): Promise<unknown> => ipcRenderer.invoke('vt:job'),
  write: (rel: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke('vt:write', rel, data),
  log: (msg: unknown): void => ipcRenderer.send('vt:log', msg),
  done: (result: unknown): void => ipcRenderer.send('vt:done', result)
})
