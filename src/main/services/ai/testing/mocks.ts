// Apoyo de las pruebas (port de Tests/AIKitTests/Support): un `fetch` simulado que graba las peticiones y responde con SSE,
// JSON o fallos de red, y un `ChatModel` con guion para el bucle de agente. Solo lo importan los `*.test.ts`.
import type { ChatEvent, ChatRequest, ChatResponse, FinishReason, Usage } from '@shared/ai/types'
import { MemorySecretStore } from '../../secrets'
import type { ChatModel, CompleteOptions, ModelCapabilities } from '../model'
import { ResponseCollector } from '../core/toolCalls'
import { cancelledError } from '../errors'
import { abortReason, type FetchFn } from '../http/options'
import type { ProviderDeps } from '../providers/base'
import { FixupMemory, ThinkingVault } from '../providers/memory'

/** El mismo criterio que las pruebas Swift para «parece español». */
export function looksSpanish(s: string): boolean {
  const lower = s.toLowerCase()
  return [' de ', ' la ', ' el ', ' tu ', ' no ', ' una ', ' un ', ' en ', ' con ', ' que ', ' ha ', ' es ', ' se ', ' ser ', 'clave', 'revisa',
    'intenta', 'falta', 'espera', 'modelo', 'tuvo', 'suele', 'temporal', 'fallo', 'conexión', 'saldo', 'cuota'].some((m) => lower.includes(m))
}

// MARK: fetch simulado

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Cuerpo interpretado como JSON (o el texto si no lo es). */
  body: unknown
  rawBody: string
}

export interface MockReply {
  status?: number
  headers?: Record<string, string>
  /** Cuerpo completo (un objeto se convierte en JSON). */
  body?: string | object
  /** Trozos que se envían uno a uno (SSE). */
  chunks?: (string | Uint8Array)[]
  /** No termina nunca (hasta que se cancele). */
  hang?: boolean
  /** Tras los trozos, la conexión se corta con este error. */
  cutAfterChunks?: Error
  /** `fetch` falla sin respuesta (red). */
  networkError?: Error
  /** Pausa antes de cada trozo (ms). */
  chunkDelayMs?: number
  /** La respuesta (las cabeceras) no llega nunca (hasta que se cancele). */
  hangBeforeHeaders?: boolean
}

/** Error de red como los de undici (`fetch failed` con `cause.code`). */
export function netError(code: string, message = 'fetch failed'): Error {
  return Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) })
}

export const sseHeaders = { 'content-type': 'text/event-stream' }

/** Respuesta SSE con el texto partido en trozos de `size` bytes (para probar los cortes). */
export function sseReply(text: string, size = 0, extra: Partial<MockReply> = {}): MockReply {
  if (size <= 0) return { status: 200, headers: sseHeaders, chunks: [text], ...extra }
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size))
  return { status: 200, headers: sseHeaders, chunks, ...extra }
}

export function jsonReply(body: string | object, status = 200, headers: Record<string, string> = {}): MockReply {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body }
}

export interface MockFetch {
  fetch: FetchFn
  requests: RecordedRequest[]
}

function toBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody)
  } catch {
    return rawBody
  }
}

function headerRecord(h: ConstructorParameters<typeof Headers>[0]): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(h).forEach((v, k) => (out[k] = v))
  return out
}

/** `fetch` con guion: una lista de respuestas (la última se repite) o una función. */
export function mockFetch(script: MockReply[] | ((req: RecordedRequest, index: number) => MockReply)): MockFetch {
  const requests: RecordedRequest[] = []
  const fetch: FetchFn = async (input, init = {}) => {
    const rawBody = typeof init.body === 'string' ? init.body : ''
    const req: RecordedRequest = { url: String(input), method: init.method ?? 'GET', headers: headerRecord(init.headers), body: toBody(rawBody), rawBody }
    const index = requests.length
    requests.push(req)
    const reply = typeof script === 'function' ? script(req, index) : script[Math.min(index, script.length - 1)]
    const signal = init.signal ?? undefined
    if (signal?.aborted) throw abortReason(signal)
    if (reply.networkError) throw reply.networkError
    if (reply.hangBeforeHeaders) {
      await new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(abortReason(signal)), { once: true }))
    }
    const encoder = new TextEncoder()
    const status = reply.status ?? 200
    const parts: Uint8Array[] = reply.chunks
      ? reply.chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c))
      : reply.body !== undefined ? [encoder.encode(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))] : []
    let i = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (reply.chunkDelayMs && i < parts.length) await new Promise((r) => setTimeout(r, reply.chunkDelayMs))
        if (signal?.aborted) {
          controller.error(signal.reason ?? cancelledError())
          return
        }
        if (i < parts.length) {
          controller.enqueue(parts[i++])
          return
        }
        if (reply.cutAfterChunks) {
          controller.error(reply.cutAfterChunks)
          return
        }
        if (reply.hang) {
          return new Promise<void>((resolve) => {
            const onAbort = () => {
              controller.error(signal?.reason ?? cancelledError())
              resolve()
            }
            if (signal) signal.addEventListener('abort', onAbort, { once: true })
          })
        }
        controller.close()
      }
    })
    return new Response(status === 204 || status === 304 ? null : stream, { status, headers: reply.headers ?? {} })
  }
  return { fetch, requests }
}

/** Dependencias de un proveedor para las pruebas: clave en memoria, `fetch` simulado y esperas instantáneas que se graban. */
export function testDeps(fetch: FetchFn, keys: Record<string, string> = {}, extra: Partial<ProviderDeps> = {}): ProviderDeps & { sleeps: number[]; secretsStore: MemorySecretStore } {
  const store = new MemorySecretStore()
  for (const [k, v] of Object.entries(keys)) store.set(k, v)
  const sleeps: number[] = []
  return {
    secrets: store,
    secretsStore: store,
    sleeps,
    http: { fetch, sleep: async (s) => void sleeps.push(s), random: () => 0.5, ...extra.http },
    vault: extra.vault ?? new ThinkingVault(),
    fixups: extra.fixups ?? new FixupMemory()
  }
}

// MARK: Modelo con guion

export type Step =
  | { events: ChatEvent[] }
  | { fail: Error }
  | { eventsThenFail: ChatEvent[]; error: Error }
  /** No termina hasta que se cancele. */
  | { hang: true }

export interface ReplyCall {
  id: string
  name: string
  args: string
}

const defaultUsage = (): Usage => ({ promptTokens: 10, completionTokens: 5, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 })

/** Eventos de una respuesta: texto en trozos, llamadas con argumentos fragmentados, uso y motivo de fin. */
export function reply(o: { text?: string; reasoning?: string; calls?: ReplyCall[]; finish?: FinishReason; usage?: Usage | null; chunk?: number } = {}): ChatEvent[] {
  const out: ChatEvent[] = []
  if (o.reasoning) out.push({ type: 'reasoning', text: o.reasoning })
  const chunk = o.chunk ?? 7
  const text = o.text ?? ''
  for (let i = 0; i < text.length; i += chunk) out.push({ type: 'text', text: text.slice(i, i + chunk) })
  ;(o.calls ?? []).forEach((c, i) => {
    out.push({ type: 'tool_call', index: i, id: c.id, name: c.name, argumentsFragment: '' })
    for (let k = 0; k < c.args.length; k += 9) out.push({ type: 'tool_call', index: i, argumentsFragment: c.args.slice(k, k + 9) })
  })
  const usage = o.usage === undefined ? defaultUsage() : o.usage
  if (usage) out.push({ type: 'usage', usage })
  out.push({ type: 'finished', finish: o.finish ?? ((o.calls ?? []).length ? 'toolCalls' : 'stop') })
  return out
}

export const step = (o: Parameters<typeof reply>[0] = {}): Step => ({ events: reply(o) })

/** Una línea legible de un evento (como `ChatEvent.line` de las pruebas Swift). */
export function line(e: ChatEvent): string {
  switch (e.type) {
    case 'text':
      return `text:${e.text}`
    case 'reasoning':
      return `reasoning:${e.text}`
    case 'tool_call':
      return `tool[${e.index}] id=${e.id ?? '-'} name=${e.name ?? '-'} args=${e.argumentsFragment}`
    case 'usage':
      return `usage:${e.usage.promptTokens}/${e.usage.completionTokens}/${e.usage.reasoningTokens}/${e.usage.cachedTokens}`
    case 'finished':
      return `finished:${e.finish}`
  }
}

/** Ejecuta una petición y devuelve los eventos y la respuesta (o el error). */
export async function collect(model: ChatModel, request: ChatRequest, signal?: AbortSignal): Promise<{ events: ChatEvent[]; response?: ChatResponse; error?: unknown }> {
  const events: ChatEvent[] = []
  try {
    const response = await model.complete(request, { signal, onDelta: (e) => events.push(e) })
    return { events, response }
  } catch (error) {
    return { events, error }
  }
}

/** Resumen de una lista de eventos. */
export function digest(events: ChatEvent[]) {
  const c = new ResponseCollector()
  for (const e of events) c.add(e)
  const r = c.response()
  return {
    text: c.text,
    reasoning: c.reasoning,
    calls: r.message.toolCalls ?? [],
    usage: events.filter((e) => e.type === 'usage').map((e) => (e as { usage: Usage }).usage).pop(),
    finish: r.finish,
    usageCount: events.filter((e) => e.type === 'usage').length,
    finishCount: events.filter((e) => e.type === 'finished').length
  }
}

export class MockChatModel implements ChatModel {
  readonly requests: ChatRequest[] = []
  cancelled = 0
  providerId = 'mock'
  providerName = 'Mock'
  kind = 'openai-compatible' as const
  model = 'mock-model'
  capabilities: ModelCapabilities
  edited: string[][] = []

  constructor(private readonly script: Step[] | ((req: ChatRequest, index: number) => Step), caps: Partial<ModelCapabilities> = {}) {
    this.capabilities = { tools: true, vision: false, streaming: true, jsonMode: true, contextWindow: 100_000, reasoning: null, ...caps }
  }

  get callCount(): number {
    return this.requests.length
  }

  historyWasEdited(ids: string[]): void {
    this.edited.push(ids)
  }

  async complete(request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> {
    const index = this.requests.length
    this.requests.push(structuredClone(request))
    const s = typeof this.script === 'function' ? this.script(request, index) : this.script[Math.min(index, this.script.length - 1)]
    const collector = new ResponseCollector()
    const emit = (e: ChatEvent) => {
      collector.add(e)
      opts.onDelta?.(e)
    }
    const signal = opts.signal
    if (signal?.aborted) {
      this.cancelled++
      throw abortReason(signal)
    }
    if ('fail' in s) throw s.fail
    if ('hang' in s) {
      await new Promise<void>((_, reject) => {
        const onAbort = () => {
          this.cancelled++
          reject(abortReason(signal))
        }
        if (signal) signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    if ('events' in s) for (const e of s.events) emit(e)
    if ('eventsThenFail' in s) {
      for (const e of s.eventsThenFail) emit(e)
      throw s.error
    }
    return collector.response()
  }
}
