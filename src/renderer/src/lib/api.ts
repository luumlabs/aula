// Acceso tipado al proceso principal desde la interfaz.
import type { RpcArgs, RpcEnvelope, RpcEvent, RpcMethod, RpcPayload, RpcResult } from '@shared/ipc'
import { tr } from '@shared/ai/i18n'

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
  pathForFile(file: File): string {
    return bridge().pathForFile(file)
  }
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
