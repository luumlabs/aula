// Un intento HTTP de chat con streaming (port de StreamingClient.swift). Los reintentos y los plazos los gestiona quien llama.
//
// Errores que lanza:
//  - `RetryableFailure`: 5xx/408/409, red caída o respuesta vacía ANTES de recibir ningún byte (se puede reintentar);
//  - `ParameterRejected`: 400/422 (quizá arreglable quitando un parámetro);
//  - `AIError`: cualquier otro fallo definitivo (incluidos los cortes tras el primer byte);
//  - el motivo del aborto de `signal` (cancelación, plazo total o inactividad).
import type { JSONValue } from '@shared/ai/json'
import type { ChatEvent } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { AIError, isCancellation } from '../errors'
import { tryParseJSON } from '../core/json'
import { SSEParser, type SSEEvent } from './sse'
import { abortReason, ParameterRejected, RetryableFailure, type ActivityTracker, type FetchFn } from './options'
import { fromHTTP, fromTransport, plainText, type ErrorContext } from './providerErrors'
import { scrubSecrets } from './redactor'

/** Traduce el contenido de la respuesta de un proveedor a eventos de chat. */
export interface ChatStreamDecoder {
  /** Un evento SSE completo. */
  handle(event: SSEEvent): ChatEvent[]
  /** Una respuesta JSON completa (sin streaming, o un servidor que ignoró `stream: true`). */
  handleJSONBody(json: JSONValue): ChatEvent[]
  /** Fin del flujo: emite uso y motivo de fin, o lanza si el flujo se cortó. */
  finishStream(): ChatEvent[]
}

const MAX_JSON_BYTES = 64 * 1024 * 1024
const MAX_ERROR_BODY = 64 * 1024

export function notHTTPText(p: string): string {
  return tr(`${p} devolvió una respuesta que no es HTTP.`, `${p} returned a response that isn't HTTP.`)
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** Lee como mucho `max` bytes del cuerpo (para explicar un error) y corta la conexión. */
async function readLimited(res: Response, max: number, tracker: ActivityTracker, signal: AbortSignal): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const parts: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      tracker.touch()
      if (value?.length) {
        parts.push(value)
        total += value.length
      }
    }
  } catch (err) {
    if (signal.aborted || isCancellation(err)) throw signal.aborted ? abortReason(signal) : err
  } finally {
    reader.cancel().catch(() => {})
  }
  return concat(parts, total).subarray(0, Math.max(total, 0))
}

/** Clasifica un error del intento: cancelaciones y AIError pasan tal cual; los de red solo son reintentables sin bytes recibidos. */
function failure(err: unknown, committed: boolean, ctx: ErrorContext, signal: AbortSignal): unknown {
  if (signal.aborted) return abortReason(signal)
  if (isCancellation(err)) return err
  if (err instanceof AIError || err instanceof RetryableFailure || err instanceof ParameterRejected) return err
  const mapped = fromTransport(err, ctx)
  if (mapped.retryable && !committed) return new RetryableFailure(mapped.error)
  if (committed && (mapped.error.kind === 'network' || mapped.error.kind === 'timeout')) {
    // cortes a mitad de la respuesta: no se reintenta (ya se entregó contenido)
    const first = mapped.error.message
    return mapped.error.withMessage(tr(`${first} La respuesta quedó incompleta; vuelve a intentarlo.`, `${first} The response was incomplete; try again.`))
  }
  return mapped.error
}

export interface PerformArgs {
  url: string
  init: RequestInit
  fetch: FetchFn
  /** Aborta el intento (con el motivo: cancelación, plazo o inactividad). */
  signal: AbortSignal
  decoder: ChatStreamDecoder
  context: ErrorContext
  tracker: ActivityTracker
  emit: (e: ChatEvent) => void
}

/** Envía la petición y entrega los eventos a `emit` a medida que llegan. */
export async function performStreaming(a: PerformArgs): Promise<void> {
  const { context: ctx, tracker, signal, decoder, emit } = a
  let res: Response
  try {
    res = await a.fetch(a.url, { ...a.init, signal })
  } catch (err) {
    throw failure(err, false, ctx, signal)
  }
  tracker.touch()
  if (typeof res?.status !== 'number') throw new AIError('badResponse', notHTTPText(ctx.provider))

  // respuesta de error: leer el cuerpo (acotado) para explicar el motivo
  if (res.status < 200 || res.status >= 300) {
    const body = await readLimited(res, MAX_ERROR_BODY, tracker, signal)
    const r = fromHTTP(res.status, body, res.headers, ctx)
    if (r.retryable) throw new RetryableFailure(r.error, r.retryAfter)
    if (res.status === 400 || res.status === 422) throw new ParameterRejected(r.error)
    throw r.error
  }

  let mode: 'undecided' | 'sse' | 'json' = (res.headers.get('content-type') ?? '').toLowerCase().includes('json') ? 'json' : 'undecided'
  const parser = new SSEParser()
  const jsonParts: Uint8Array[] = []
  let jsonSize = 0
  let committed = false

  const process = (chunk: Uint8Array) => {
    if (mode === 'undecided') {
      let first = -1
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]
        if (b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09) {
          first = b
          break
        }
      }
      if (first < 0) return // solo espacios: esperar
      mode = first === 0x7b || first === 0x5b ? 'json' : 'sse'
    }
    if (mode === 'json') {
      jsonParts.push(chunk)
      jsonSize += chunk.length
      if (jsonSize > MAX_JSON_BYTES) {
        throw new AIError('badResponse', tr(`${ctx.provider} envió una respuesta demasiado grande.`, `${ctx.provider} sent a response that was too large.`))
      }
    } else {
      for (const ev of parser.feed(chunk)) for (const e of decoder.handle(ev)) emit(e)
    }
  }

  const reader = res.body?.getReader()
  let finished = false
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        tracker.touch()
        if (!value || value.length === 0) continue
        committed = true
        process(value)
      }
      finished = true
    } catch (err) {
      throw failure(err, committed, ctx, signal)
    } finally {
      if (!finished) reader.cancel().catch(() => {})
    }
  }
  tracker.touch()

  if (!committed) {
    throw new RetryableFailure(new AIError('badResponse', tr(`${ctx.provider} devolvió una respuesta vacía. Inténtalo de nuevo.`,
      `${ctx.provider} returned an empty response. Try again.`)))
  }
  if (mode === 'json') {
    const text = new TextDecoder('utf-8').decode(concat(jsonParts, jsonSize))
    const value = tryParseJSON(text)
    if (value === undefined) {
      const snippet = scrubSecrets(plainText(text.slice(0, 300)) ?? '', ctx.secrets)
      throw new AIError('badResponse', tr(`${ctx.provider} devolvió una respuesta que no es JSON válido. ${snippet}`,
        `${ctx.provider} returned a response that isn't valid JSON. ${snippet}`), { providerMessage: snippet })
    }
    for (const e of decoder.handleJSONBody(value)) emit(e)
  } else {
    for (const ev of parser.finish()) for (const e of decoder.handle(ev)) emit(e)
  }
  for (const e of decoder.finishStream()) emit(e)
}
