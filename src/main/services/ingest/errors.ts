// Errores de lectura de fuentes, con mensajes listos para el usuario (como `IngestError` de Swift).
import { AulaError } from '../errors'
import { L } from './messages'

export type IngestErrorKind =
  | 'fileNotFound'
  | 'unreadable'
  | 'unsupportedType'
  | 'passwordProtected'
  | 'corrupt'
  | 'tooLarge'
  | 'archiveLimit'
  | 'blockedURL'
  | 'network'

/** Error de lectura. `reason` es el motivo ya localizado (en minúscula: se muestra tras dos puntos). */
export class IngestError extends AulaError {
  readonly kind: IngestErrorKind
  readonly reason: string

  constructor(kind: IngestErrorKind, reason: string) {
    super(`ingest_${kind}`, IngestError.describe(kind, reason))
    this.name = 'IngestError'
    this.kind = kind
    this.reason = reason
  }

  static describe(kind: IngestErrorKind, why: string): string {
    switch (kind) {
      case 'fileNotFound': return L('No se encontró el archivo «%@».', why)
      case 'unreadable': return L('No se pudo leer el archivo: %@', why)
      case 'unsupportedType': return L('Este tipo de archivo no está soportado: %@', why)
      case 'passwordProtected': return L('«%@» está protegido con contraseña. Quítale la contraseña y vuelve a intentarlo.', why)
      case 'corrupt': return L('El archivo está dañado o no tiene el formato esperado: %@', why)
      case 'tooLarge': return L('El archivo es demasiado grande: %@', why)
      case 'archiveLimit': return L('El archivo comprimido supera los límites de seguridad: %@', why)
      case 'blockedURL': return L('Dirección bloqueada por seguridad: %@', why)
      case 'network': return L('No se pudo descargar la página: %@', why)
    }
  }
}

export const fileNotFound = (name: string): IngestError => new IngestError('fileNotFound', name)
export const unreadable = (why: string): IngestError => new IngestError('unreadable', why)
export const unsupportedType = (why: string): IngestError => new IngestError('unsupportedType', why)
export const passwordProtected = (name: string): IngestError => new IngestError('passwordProtected', name)
export const corrupt = (why: string): IngestError => new IngestError('corrupt', why)
export const tooLarge = (why: string): IngestError => new IngestError('tooLarge', why)
export const archiveLimit = (why: string): IngestError => new IngestError('archiveLimit', why)
export const blockedURL = (why: string): IngestError => new IngestError('blockedURL', why)
export const network = (why: string): IngestError => new IngestError('network', why)

export function isIngestError(e: unknown, kind?: IngestErrorKind): e is IngestError {
  return e instanceof IngestError && (kind === undefined || e.kind === kind)
}

/** Error de cancelación (como `CancellationError`): `name === 'AbortError'`. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelado')
    this.name = 'AbortError'
  }
}

export function isCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/** Lanza `CancelledError` si la señal ya se canceló. */
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError()
}

/** Mensaje legible de cualquier error. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
