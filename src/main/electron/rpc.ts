// Canal genérico de IPC: un solo `ipcMain.handle` despacha a los manejadores registrados por cada dominio.
import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  EVENT_CHANNEL,
  FILE_GRANT_CHANNEL,
  RPC_CHANNEL,
  type RpcArgs,
  type RpcEnvelope,
  type RpcEvent,
  type RpcMethod,
  type RpcPayload,
  type RpcResult
} from '@shared/ipc'
import { AulaError, toErrorInfo } from '@main/services/errors'
import { log } from '@main/services/log'
import { userFiles } from '@main/services/userFiles'

export interface RpcContext {
  sender: WebContents
}

type Handler<M extends RpcMethod> = (args: RpcArgs<M>, ctx: RpcContext) => Promise<RpcResult<M>> | RpcResult<M>

const handlers = new Map<string, Handler<RpcMethod>>()
const trustedSenders = new Set<number>()

/** Registra el manejador de un método. Un método solo puede tener uno. */
export function handle<M extends RpcMethod>(method: M, fn: Handler<M>): void {
  if (handlers.has(method)) throw new Error(`RPC duplicado: ${method}`)
  handlers.set(method, fn as unknown as Handler<RpcMethod>)
}

/** Solo las ventanas de la app (no las del navegador de plataformas) pueden llamar al RPC. */
export function trustWebContents(wc: WebContents): void {
  trustedSenders.add(wc.id)
  wc.once('destroyed', () => trustedSenders.delete(wc.id))
}

/** Envía un evento a todas las ventanas de la app. */
export function emit<E extends RpcEvent>(event: E, payload: RpcPayload<E>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed() && trustedSenders.has(wc.id)) wc.send(EVENT_CHANNEL, event, payload)
  }
}

let frameCheck: (url: string) => boolean = () => true

/** Qué páginas pueden llamar (la de la app): lo instala la ventana principal. */
export function setTrustedPage(check: (url: string) => boolean): void {
  frameCheck = check
}

/** Solo el marco principal de la página de la app (ni iframes ni una página a la que se hubiera navegado). */
function trustedFrame(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = e.senderFrame
  const main = e.sender.mainFrame
  if (!frame || frame.processId !== main.processId || frame.routingId !== main.routingId) return false
  return frameCheck(frame.url)
}

export function installRpc(): void {
  // rutas de archivos soltados o elegidos (las apunta el preload con `webUtils.getPathForFile`); solo de la ventana de la app
  ipcMain.on(FILE_GRANT_CHANNEL, (e: IpcMainEvent, path: unknown) => {
    e.returnValue = trustedSenders.has(e.sender.id) && trustedFrame(e) ? userFiles.grant(path) : false
  })
  ipcMain.handle(RPC_CHANNEL, async (e: IpcMainInvokeEvent, method: unknown, args: unknown): Promise<RpcEnvelope<unknown>> => {
    if (!trustedSenders.has(e.sender.id) || !trustedFrame(e)) return { ok: false, error: { message: 'Remitente no autorizado', code: 'forbidden' } }
    if (typeof method !== 'string') return { ok: false, error: { message: 'Método no válido', code: 'invalid_args' } }
    const fn = handlers.get(method)
    if (!fn) return { ok: false, error: { message: `Método desconocido: ${method}`, code: 'unknown_method' } }
    try {
      const value = await fn(args as never, { sender: e.sender })
      return { ok: true, value }
    } catch (err) {
      const info = toErrorInfo(err)
      if (!(err instanceof AulaError) || info.code === 'internal') log.error(`[rpc] ${method}`, err)
      return { ok: false, error: info }
    }
  })
}
