// Cuándo y cuánto se reintenta un agente de la tubería que falló (puro, sin Node). Un límite de uso, un corte de red o un
// servidor saturado se reintentan con esperas crecientes; sin red de verdad (conexión rechazada, nombre que no se resuelve,
// ninguna red) se reintenta UNA vez enseguida y se para: esperar trece minutos para acabar en el mismo error no sirve.
// Sin saldo o sin cuota (402, o un 429 de saldo: código `ai_quota`) no se reintenta tema a tema: se para la ejecución entera
// y queda para reanudarla cuando se recargue o se cambie de proveedor.
import { tr } from '@shared/ai/i18n'

/** Lo que importa de un error para decidir (`text`: el del proveedor si lo hay, si no el mensaje). */
export interface RetryInput {
  kind: string
  status?: number
  retryAfter?: number
  text: string
  /** Código estable del error (`ai_quota`…). */
  code?: string
}

export type RetryDecision =
  | { action: 'fail' }
  /** Un límite de uso: se para la ejecución y queda para reanudarla (`resumeAfterSec` si se sabe cuándo). */
  | { action: 'limit'; resumeAfterSec?: number; long: boolean }
  /** Sin saldo o sin cuota: se para la ejecución (como un límite), pero no se renueva sola. */
  | { action: 'quota' }
  | { action: 'retry'; waitSec: number; reason: RetryReason }

export type RetryReason = 'unreachable' | 'network' | 'timeout' | 'server' | 'rateLimited'

/** Intentos como mucho (contando el primero) según el motivo. */
export const RETRY_ATTEMPTS: Record<RetryReason, number> = { unreachable: 2, network: 4, timeout: 2, server: 4, rateLimited: 4 }

/** Por encima de esto (s) un límite no se espera: la ejecución se para y se reanuda luego. */
export const LONG_LIMIT_SEC = 600

/**
 * Sin red: los textos de las CLIs y de Node (ECONNREFUSED, ENOTFOUND…) y los que da la capa de IA al traducirlos
 * (`fromTransport`: «No hay conexión a internet», «No se pudo conectar con…», «No se encuentra el servidor…»).
 */
const UNREACHABLE = [
  /econnrefused|connection refused|enotfound|getaddrinfo|eai_again|eai_noname|enetunreach|enetdown|ehostunreach|network is unreachable/i,
  /could not resolve|couldn['’]t be resolved|no internet|no connection to|offline/i,
  /no hay conexión|no se pudo conectar con|no se encuentra el servidor|couldn['’]t connect to|server couldn['’]t be found/i
]

export function isUnreachable(text: string): boolean {
  return UNREACHABLE.some((re) => re.test(text))
}

/** El motivo de un error que se puede reintentar (undefined = no se reintenta). */
export function retryReason(e: RetryInput): RetryReason | undefined {
  if (e.kind === 'rateLimited') return 'rateLimited'
  if (e.kind === 'network') return isUnreachable(e.text) ? 'unreachable' : 'network'
  if (e.kind === 'timeout') return 'timeout'
  if (e.kind === 'http' && (e.status ?? 0) >= 500) return 'server'
  return undefined
}

/** Qué hacer tras el intento `attempt` (1 = el primero) que falló con `e`. */
export function retryDecision(e: RetryInput, attempt: number): RetryDecision {
  if (e.code === 'ai_quota') return { action: 'quota' }
  const reason = retryReason(e)
  if (reason === 'rateLimited') {
    const wait = e.retryAfter ?? 0
    if (attempt >= RETRY_ATTEMPTS.rateLimited) return { action: 'limit', resumeAfterSec: e.retryAfter, long: false }
    // un límite que tarda en renovarse: se para y queda para reanudar
    if (wait > LONG_LIMIT_SEC) return { action: 'limit', resumeAfterSec: wait, long: true }
  }
  if (!reason || attempt >= RETRY_ATTEMPTS[reason]) return { action: 'fail' }
  return { action: 'retry', waitSec: retryWait(reason, e.retryAfter, attempt), reason }
}

/**
 * Sin red, un solo reintento rápido. Un límite de uso, la espera entera que pide el proveedor (aquí ya es de LONG_LIMIT_SEC
 * o menos): reintentar antes fallaría seguro. Lo demás, esperas crecientes (5, 20, 45 s) o lo que pida, como mucho 90 s.
 */
function retryWait(reason: RetryReason, retryAfter: number | undefined, attempt: number): number {
  if (reason === 'unreachable') return 5
  if (reason === 'rateLimited' && retryAfter !== undefined) return retryAfter
  return Math.min(90, retryAfter ?? 5 * attempt * attempt)
}

/** Lo que se ve en el monitor mientras se espera: el motivo y cuándo se vuelve a probar. */
export function waitingText(reason: RetryReason, waitSec: number, status?: number): string {
  // «30 s»; a partir de minuto y medio, en minutos («5 min»)
  const secs = Math.max(1, Math.round(waitSec))
  const s = secs < 90 ? `${secs} s` : `${Math.ceil(secs / 60)} min`
  switch (reason) {
    case 'unreachable': return tr(`Sin conexión con la IA. Pruebo otra vez en ${s}…`, `No connection to the AI. Trying again in ${s}…`)
    case 'network': return tr(`Se cortó la conexión con la IA. Reintento en ${s}…`, `The connection to the AI dropped. Retrying in ${s}…`)
    case 'timeout': return tr(`La IA tardó demasiado en responder. Reintento en ${s}…`, `The AI took too long to answer. Retrying in ${s}…`)
    case 'server': return tr(`El servidor de la IA falló (${status ?? 500}). Reintento en ${s}…`, `The AI server failed (${status ?? 500}). Retrying in ${s}…`)
    case 'rateLimited': return tr(`La IA pide esperar (límite de peticiones). Reintento en ${s}…`, `The AI asks to wait (request limit). Retrying in ${s}…`)
  }
}
