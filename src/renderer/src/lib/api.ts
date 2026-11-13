// Acceso tipado al proceso principal desde la interfaz.
import type { RpcArgs, RpcEnvelope, RpcEvent, RpcMethod, RpcPayload, RpcResult } from '@shared/ipc'
import { tr } from '@shared/ai/i18n'
import { deviceRole, type DeviceRole } from './device'

export interface AulaClientError extends Error {
  code: string
  details?: unknown
}

function bridge() {
  if (typeof window === 'undefined' || !window.aula) throw new Error(tr('El puente de Aula no está disponible', 'Aula’s bridge isn’t available'))
  return window.aula
}

export const api = {
  async invoke<M extends RpcMethod>(method: M, ...args: RpcArgs<M> extends void ? [] : [RpcArgs<M>]): Promise<RpcResult<M>> {
    return unwrap((await bridge().invoke(method, args[0])) as RpcEnvelope<RpcResult<M>>)
  },
  on<E extends RpcEvent>(event: E, fn: (payload: RpcPayload<E>) => void): () => void {
    return bridge().on(event, fn as (p: unknown) => void)
  },
  get platform(): string {
    return typeof window !== 'undefined' && window.aula ? window.aula.platform : 'web'
  },
  /** ¿Aula se está usando desde un dispositivo (iPad, iPhone, Android) y no desde su ventana del Mac? */
  get remote(): boolean {
    return typeof window !== 'undefined' && (window.aula as { remote?: boolean } | undefined)?.remote === true
  },
  /** Desde un dispositivo propietario de Aula como servidor: hace de ventana (claves, plataformas, dispositivos). */
  get owner(): boolean {
    return this.remote && (window.aula as { owner?: boolean } | undefined)?.owner === true
  },
  /** ¿La Aula al otro lado es un servidor (sin Mac)? Cambia cómo se habla de ella («tu servidor», no «tu Mac»). */
  get server(): boolean {
    return this.remote && (window.aula as { server?: boolean } | undefined)?.server === true
  },
  /** Quién usa Aula desde aquí (ventana, propietario, dispositivo de un Mac o de un servidor): lo que se arregla aquí (device.ts). */
  get role(): DeviceRole {
    return deviceRole({ remote: this.remote, owner: this.owner, server: this.server })
  },
  pathForFile(file: File): string {
    return bridge().pathForFile(file)
  }
}

/**
 * URL de un recurso de un curso (`assets/figura.png`, `sources/<id>/pages.json`…). En la ventana del Mac lo sirve el
 * protocolo `aula-asset://`; desde un dispositivo, el servidor remoto en `/asset/…` (mismo origen).
 */
export function packAssetUrl(packId: string, path: string): string {
  const rest = `pack/${encodeURIComponent(packId)}/${path.split('/').map(encodeURIComponent).join('/')}`
  return api.remote ? `/asset/${rest}` : `aula-asset://${rest}`
}

export function isAulaError(err: unknown): err is AulaClientError {
  return err instanceof Error && typeof (err as AulaClientError).code === 'string'
}

/** Del sobre del IPC al valor, o a un Error con `code` y `details` (el preload no puede lanzarlo con el código intacto). */
export function unwrap<T>(res: RpcEnvelope<T>): T {
  if (res && res.ok) return res.value
  const info = res && !res.ok ? res.error : { message: tr('Respuesta no válida del proceso principal', 'Invalid response from the main process'), code: 'internal' }
  const err = new Error(info.message) as AulaClientError
  err.name = 'AulaError'
  err.code = info.code
  err.details = info.details
  throw err
}
