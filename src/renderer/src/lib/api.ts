// Acceso tipado al proceso principal desde la interfaz.
import type { RpcArgs, RpcEnvelope, RpcEvent, RpcMethod, RpcPayload, RpcResult } from '@shared/ipc'
import { tr } from '@shared/ai/i18n'
import { deviceRole, type DeviceRole } from './device'

export interface AulaClientError extends Error {
  code: string
  details?: unknown
}

/**
 * Quien vigila las llamadas antes de mandarlas (solo en un dispositivo: el aviso de la IA de terceros, aiConsent.ts):
 * `before` puede esperar a que el estudiante acepte o lanzar si cancela; `recover`, ante un error, decide si se reintenta
 * (una vez) tras arreglarlo.
 */
export interface InvokeGuard {
  before(method: string, args: unknown): Promise<void>
  recover(method: string, args: unknown, err: AulaClientError): Promise<boolean>
}

let guard: InvokeGuard | null = null

/** Pone (o quita, con null) el vigilante de las llamadas. */
export function installInvokeGuard(g: InvokeGuard | null): void {
  guard = g
}

function bridge() {
  if (typeof window === 'undefined' || !window.aula) throw new Error(tr('El puente de Aula no está disponible', 'Aula’s bridge isn’t available'))
  return window.aula
}

export const api = {
  async invoke<M extends RpcMethod>(method: M, ...args: RpcArgs<M> extends void ? [] : [RpcArgs<M>]): Promise<RpcResult<M>> {
    const arg = args[0]
    const g = guard
    if (g) await g.before(method, arg)
    const send = async (): Promise<RpcResult<M>> => unwrap((await bridge().invoke(method, arg)) as RpcEnvelope<RpcResult<M>>)
    try {
      return await send()
    } catch (err) {
      if (g && isAulaError(err) && (await g.recover(method, arg, err))) return send()
      throw err
    }
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
  /** En qué equipo corre la Aula remota («mac», «windows» o «server»). */
  get host(): 'mac' | 'windows' | 'server' {
    if (!this.remote) return 'mac'
    const h = (window.aula as { host?: string } | undefined)?.host
    if (h === 'server' || h === 'windows') return h
    return this.server ? 'server' : 'mac'
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
