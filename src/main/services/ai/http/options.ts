// Ajustes de red de los proveedores por API: tiempos, reintentos con retroceso exponencial y jitter (port de HTTPOptions.swift).
import { log } from '../../log'
import { AIError, cancelledError } from '../errors'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
export type SleepFn = (seconds: number, signal?: AbortSignal) => Promise<void>

export interface HTTPOptions {
  /** Segundos sin recibir ningún byte tras los cuales la petición se da por colgada. Por defecto 90. */
  idleTimeoutSec: number
  /** Reintentos (además del primer intento) ante 5xx o red, y solo antes del primer byte. Por defecto 4. */
  maxRetries: number
  /** Espera base del retroceso exponencial: `base · 2^intento`. */
  baseBackoffSec: number
  maxBackoffSec: number
  /** Variación aleatoria de la espera (0.25 = ±25 %). */
  jitter: number
  /** Tope de espera cuando el servidor pide esperar con `Retry-After` en un 5xx. */
  maxRetryAfterSec: number
  /** Pausa cancelable (las pruebas la sustituyen). */
  sleep: SleepFn
  /** Azar para el jitter, en [0, 1). */
  random: () => number
  /** `fetch` (las pruebas inyectan uno simulado). */
  fetch: FetchFn
}

/** Pausa real, cancelable con `signal` (rechaza con el motivo del aborto o con un error de cancelación). */
export function abortableSleep(seconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  if (!(seconds > 0)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.min(seconds, 3600) * 1000)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** El motivo de un aborto como error (un AIError si lo puso Aula; si no, cancelación). */
export function abortReason(signal: AbortSignal | undefined): Error {
  const r: unknown = signal?.reason
  if (r instanceof Error && !(r.name === 'AbortError' && !(r instanceof AIError))) return r
  return cancelledError()
}

export function defaultHTTPOptions(overrides: Partial<HTTPOptions> = {}): HTTPOptions {
  return {
    idleTimeoutSec: 90,
    maxRetries: 4,
    baseBackoffSec: 1,
    maxBackoffSec: 20,
    jitter: 0.25,
    maxRetryAfterSec: 30,
    sleep: abortableSleep,
    random: Math.random,
    fetch: (input, init) => globalThis.fetch(input, init),
    ...overrides,
    ...(overrides.maxRetries !== undefined ? { maxRetries: Math.max(0, overrides.maxRetries) } : {})
  }
}

/** Espera antes del reintento número `attempt + 1`: `min(maxBackoff, base · 2^attempt)` con jitter. */
export function backoffDelay(o: Pick<HTTPOptions, 'baseBackoffSec' | 'maxBackoffSec' | 'jitter' | 'random'>, attempt: number): number {
  const raw = Math.min(o.maxBackoffSec, o.baseBackoffSec * Math.pow(2, Math.max(0, attempt)))
  const spread = o.jitter * (2 * o.random() - 1)
  return Math.max(0, raw * (1 + spread))
}

/** Fallo que se puede reintentar (lo decide `withRetry`). */
export class RetryableFailure extends Error {
  constructor(readonly error: AIError, readonly retryAfter?: number) {
    super(error.message)
    this.name = 'RetryableFailure'
  }
}

/** El proveedor rechazó la petición con 400/422: quizá se arregle quitando un parámetro que no admite. */
export class ParameterRejected extends Error {
  constructor(readonly error: AIError) {
    super(error.message)
    this.name = 'ParameterRejected'
  }
}

/** Ejecuta `op` y la repite mientras lance `RetryableFailure` (hasta `maxRetries`); al agotarse lanza el último AIError. */
export async function withRetry<T>(o: HTTPOptions, label: string, op: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await op(attempt)
    } catch (err) {
      if (!(err instanceof RetryableFailure)) throw err
      if (attempt >= o.maxRetries) throw err.error
      const delay = err.retryAfter !== undefined ? Math.min(err.retryAfter, o.maxRetryAfterSec) : backoffDelay(o, attempt)
      log.info(`${label}: reintento ${attempt + 1}/${o.maxRetries} en ${delay.toFixed(1)} s (${err.error.kind}${err.error.status ? `, HTTP ${err.error.status}` : ''})`)
      await o.sleep(delay, signal)
      attempt += 1
    }
  }
}

/** Un AbortController que también se aborta cuando lo hace `parent` (con el mismo motivo). */
export function linkedController(parent?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  if (!parent) return { controller, dispose: () => {} }
  if (parent.aborted) {
    controller.abort(parent.reason)
    return { controller, dispose: () => {} }
  }
  const onAbort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', onAbort, { once: true })
  return { controller, dispose: () => parent.removeEventListener('abort', onAbort) }
}

/** Registra la última actividad de red para detectar peticiones colgadas. */
export class ActivityTracker {
  private last = Date.now()
  touch(): void {
    this.last = Date.now()
  }
  idleSeconds(): number {
    return (Date.now() - this.last) / 1000
  }
}

/** Vigila la inactividad: llama a `onIdle` si pasan `timeoutSec` sin `touch()`. Devuelve la función para pararla. */
export function startIdleWatch(timeoutSec: number, tracker: ActivityTracker, onIdle: () => void): () => void {
  if (!(timeoutSec > 0) || !Number.isFinite(timeoutSec)) return () => {}
  tracker.touch()
  const step = Math.min(0.25, Math.max(0.01, timeoutSec / 4)) * 1000
  const timer = setInterval(() => {
    if (tracker.idleSeconds() >= timeoutSec) {
      clearInterval(timer)
      onIdle()
    }
  }, step)
  timer.unref?.()
  return () => clearInterval(timer)
}
