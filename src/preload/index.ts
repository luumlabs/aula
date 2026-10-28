// Puente seguro: la interfaz solo ve `window.aula` (invocar métodos y escuchar eventos del proceso principal).
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNEL, FILE_GRANT_CHANNEL, RPC_CHANNEL, type RpcEnvelope } from '../shared/ipc/contract'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

ipcRenderer.on(EVENT_CHANNEL, (_e: IpcRendererEvent, event: string, payload: unknown) => {
  const set = listeners.get(event)
  if (set) for (const fn of [...set]) {
    try { fn(payload) } catch (err) { console.error(`[aula] listener ${event}`, err) }
  }
})

const bridge = {
  platform: process.platform,
  /**
   * Devuelve el sobre tal cual ({ ok, value } o { ok: false, error }): `contextBridge` solo copia el mensaje de un Error,
   * así que el código del error (`code`) se perdería si se lanzara aquí. La interfaz lo desenvuelve (lib/api.ts).
   */
  invoke(method: string, args?: unknown): Promise<RpcEnvelope<unknown>> {
    return ipcRenderer.invoke(RPC_CHANNEL, method, args) as Promise<RpcEnvelope<unknown>>
  },
  on(event: string, fn: Listener): () => void {
    let set = listeners.get(event)
    if (!set) listeners.set(event, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  },
  /** Ruta real de un archivo soltado o elegido (para importarlo). El proceso principal solo lee las rutas que salen de aquí:
   *  se le avisan antes de devolverla (`getPathForFile` solo da rutas de archivos de verdad, nunca una inventada). */
  pathForFile(file: File): string {
    const path = webUtils.getPathForFile(file)
    if (path) ipcRenderer.sendSync(FILE_GRANT_CHANNEL, path)
    return path
  }
}

contextBridge.exposeInMainWorld('aula', bridge)
export type AulaBridge = typeof bridge
