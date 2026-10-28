// Piezas comunes de los proveedores HTTP: dependencias (secretos, red, memorias), cabeceras, plazo total y capacidades.
import type { ChatEvent, ChatRequest, ChatResponse } from '@shared/ai/types'
import { secrets as defaultSecrets, type SecretStore } from '../../secrets'
import { canonicalJSON } from '../core/json'
import { ResponseCollector } from '../core/toolCalls'
import { abortReason, defaultHTTPOptions, linkedController, startIdleWatch, ActivityTracker, type HTTPOptions } from '../http/options'
import { AIError } from '../errors'
import { performStreaming, type ChatStreamDecoder } from '../http/streaming'
import type { ErrorContext } from '../http/providerErrors'
import type { CompleteOptions, ModelCapabilities } from '../model'
import { reasoningCapabilitiesFor, type ProviderConfig } from './config'
import { FixupMemory, ThinkingVault } from './memory'

export interface ProviderDeps {
  /** Almacén de claves (por defecto, el de la app). */
  secrets?: SecretStore
  /** Red, tiempos y reintentos (las pruebas inyectan `fetch` y `sleep`). */
  http?: Partial<HTTPOptions>
  /** Razonamiento firmado (por defecto, el compartido del proceso). */
  vault?: ThinkingVault
  /** Parámetros rechazados aprendidos (por defecto, la memoria compartida). */
  fixups?: FixupMemory
}

export interface ResolvedDeps {
  secrets: SecretStore
  http: HTTPOptions
  vault: ThinkingVault
  fixups: FixupMemory
}

export function resolveDeps(deps: ProviderDeps = {}): ResolvedDeps {
  return {
    secrets: deps.secrets ?? defaultSecrets(),
    http: defaultHTTPOptions(deps.http),
    vault: deps.vault ?? ThinkingVault.shared,
    fixups: deps.fixups ?? FixupMemory.shared
  }
}

export const USER_AGENT = `Aula/2.0 (${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'})`

/** Capacidades de un proveedor y modelo (las del preset o los ajustes, más los niveles de razonamiento conocidos). */
export function capabilitiesFor(config: ProviderConfig, model?: string): ModelCapabilities {
  return {
    tools: config.supportsTools,
    vision: config.supportsVision,
    streaming: config.supportsStreaming,
    jsonMode: config.supportsJSONMode,
    contextWindow: config.contextWindow ?? 100_000,
    maxOutputTokens: config.maxOutputTokens,
    reasoning: reasoningCapabilitiesFor(config, model) ?? null
  }
}

/**
 * Ejecuta `fn` con un plazo total (`timeoutSec`; 0 o infinito = sin límite) y la cancelación de quien llama. Si algo aborta
 * la operación, se lanza el motivo (el error de plazo, la cancelación o el error que puso quien abortó).
 */
export async function withDeadline<T>(timeoutSec: number, timeoutError: () => AIError, parent: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { controller, dispose } = linkedController(parent)
  const timer = timeoutSec > 0 && Number.isFinite(timeoutSec)
    ? setTimeout(() => controller.abort(timeoutError()), Math.min(timeoutSec, 86_400 * 365) * 1000)
    : undefined
  try {
    if (controller.signal.aborted) throw abortReason(controller.signal)
    return await fn(controller.signal)
  } catch (err) {
    if (controller.signal.aborted) throw abortReason(controller.signal)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    dispose()
  }
}

export interface AttemptArgs {
  url: string
  headers: Headers
  body: unknown
  http: HTTPOptions
  idleSec: number
  idleError: () => AIError
  decoder: ChatStreamDecoder
  context: ErrorContext
  signal: AbortSignal
  emit: (e: ChatEvent) => void
}

/** Un intento HTTP con su vigilancia de inactividad. */
export async function streamingAttempt(a: AttemptArgs): Promise<void> {
  const { controller, dispose } = linkedController(a.signal)
  const tracker = new ActivityTracker()
  const stopIdle = startIdleWatch(a.idleSec, tracker, () => controller.abort(a.idleError()))
  try {
    await performStreaming({
      url: a.url,
      init: { method: 'POST', headers: a.headers, body: canonicalJSON(a.body) },
      fetch: a.http.fetch,
      signal: controller.signal,
      decoder: a.decoder,
      context: a.context,
      tracker,
      emit: a.emit
    })
  } finally {
    stopIdle()
    dispose()
  }
}

/** `complete` a partir de un `stream` que emite eventos. */
export async function completeFromStream(
  stream: (request: ChatRequest, emit: (e: ChatEvent) => void, signal?: AbortSignal) => Promise<void>,
  request: ChatRequest,
  opts: CompleteOptions = {}
): Promise<ChatResponse> {
  const collector = new ResponseCollector()
  await stream(request, (e) => {
    collector.add(e)
    opts.onDelta?.(e)
  }, opts.signal)
  return collector.response()
}

/** Cabeceras comunes de una petición. */
export function baseHeaders(streaming: boolean, extra: Record<string, string>): Headers {
  const h = new Headers()
  h.set('Content-Type', 'application/json')
  h.set('Accept', streaming ? 'text/event-stream' : 'application/json')
  h.set('User-Agent', USER_AGENT)
  return mergeHeaders(h, extra)
}

export function mergeHeaders(h: Headers, extra: Record<string, string>): Headers {
  for (const [k, v] of Object.entries(extra)) {
    try {
      h.set(k, v)
    } catch {
      /* una cabecera no válida no rompe la petición */
    }
  }
  return h
}
