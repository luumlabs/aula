// Peticiones HTTP sencillas (sin streaming) con reintentos, plazo y errores claros (port de HTTPRequester.swift).
// Las usan la lista de modelos y la prueba de conexión.
import type { JSONValue } from '@shared/ai/json'
import { AIError, isCancellation } from '../errors'
import { arr, obj, str } from '../core/json'
import { abortReason, linkedController, RetryableFailure, withRetry, type HTTPOptions } from './options'
import { fromHTTP, fromTransport, slowResponseText, type ErrorContext } from './providerErrors'

export interface SimpleResponse {
  status: number
  headers: Headers
  body: Uint8Array
}

/** GET (u otro método) con reintentos ante 5xx/red y un plazo total en segundos. */
export async function requestData(
  url: string,
  init: RequestInit,
  options: HTTPOptions,
  ctx: ErrorContext,
  deadlineSec: number,
  signal?: AbortSignal
): Promise<SimpleResponse> {
  const { controller, dispose } = linkedController(signal)
  const timer = deadlineSec > 0 && Number.isFinite(deadlineSec)
    ? setTimeout(() => controller.abort(new AIError('timeout', slowResponseText(ctx.provider))), deadlineSec * 1000)
    : undefined
  try {
    return await withRetry(options, ctx.provider, async () => {
      let res: Response
      try {
        res = await options.fetch(url, { ...init, signal: controller.signal })
      } catch (err) {
        if (controller.signal.aborted) throw abortReason(controller.signal)
        if (isCancellation(err)) throw err
        const mapped = fromTransport(err, ctx)
        if (mapped.retryable) throw new RetryableFailure(mapped.error)
        throw mapped.error
      }
      let body: Uint8Array
      try {
        body = new Uint8Array(await res.arrayBuffer())
      } catch (err) {
        if (controller.signal.aborted) throw abortReason(controller.signal)
        const mapped = fromTransport(err, ctx)
        if (mapped.retryable) throw new RetryableFailure(mapped.error)
        throw mapped.error
      }
      if (res.status >= 200 && res.status < 300) return { status: res.status, headers: res.headers, body }
      const r = fromHTTP(res.status, body, res.headers, ctx)
      if (r.retryable) throw new RetryableFailure(r.error, r.retryAfter)
      throw r.error
    }, controller.signal)
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof AIError && err.kind !== 'cancelled')) throw abortReason(controller.signal)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    dispose()
  }
}

/** Ordena y quita duplicados (orden natural, sin distinguir mayúsculas). */
export function sortedUnique(ids: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
}

const NON_CHAT_TOKENS = new Set(['tts', 'asr', 'whisper', 'embed', 'embedding', 'embeddings', 'moderation', 'rerank', 'reranker', 'transcribe',
  'voiceclone', 'voicedesign', 'sora', 'babbage', 'davinci'])

/**
 * Quita los modelos que no sirven para conversar (voz, transcripción, embeddings, moderación, imágenes). Si el filtro lo
 * quitara todo, se devuelve la lista tal cual (mejor ver algo que nada).
 */
export function likelyChatModels(ids: string[]): string[] {
  const kept = ids.filter((id) => {
    const lower = id.toLowerCase()
    if (lower.includes('dall-e') || lower.includes('gpt-image') || lower.includes('text-embedding')) return false
    return !lower.split(/[-_/.:]/).some((p) => NON_CHAT_TOKENS.has(p))
  })
  return kept.length ? kept : ids
}

/** Identificadores de `{"data":[{"id"}]}`, `{"models":[{"name"|"id"|"model"}]}`, un arreglo de objetos o de cadenas. */
export function modelIDs(json: JSONValue): string[] {
  const list = arr(json) ?? arr(obj(json)?.data) ?? arr(obj(json)?.models)
  if (!list) return []
  const out: string[] = []
  for (const item of list) {
    const s = str(item) ?? str(obj(item)?.id) ?? str(obj(item)?.name) ?? str(obj(item)?.model)
    if (s !== undefined) out.push(s)
  }
  return out
}
