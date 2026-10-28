// Errores con código estable para la interfaz.
import type { RpcErrorInfo } from '@shared/ipc'
import { tr } from '@shared/ai/i18n'

export class AulaError extends Error {
  readonly code: string
  readonly details?: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AulaError'
    this.code = code
    this.details = details
  }
}

export function toErrorInfo(err: unknown): RpcErrorInfo {
  if (err instanceof AulaError) return { message: err.message, code: err.code, details: err.details }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return { message: tr('Cancelado', 'Cancelled'), code: 'cancelled' }
    return { message: err.message || tr('Error inesperado', 'Unexpected error'), code: 'internal' }
  }
  return { message: String(err), code: 'internal' }
}

/** Atajo para validar argumentos de IPC. */
export function invalidArgs(message: string): AulaError {
  return new AulaError('invalid_args', message)
}
