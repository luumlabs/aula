// Eventos SSE de `chat/completions` (y la respuesta completa sin streaming) → eventos de chat (port de OpenAIStreamDecoder.swift).
// El uso y el motivo de fin se guardan y se emiten UNA sola vez al terminar (`usage` y después `finished`), aunque el proveedor
// los mande en trozos distintos (OpenAI manda el uso en un último chunk sin `choices`; OpenRouter repite `finish_reason`).
import type { JSONValue } from '@shared/ai/json'
import type { ChatEvent, FinishReason, Usage } from '@shared/ai/types'
import { usageTotal } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { AIError } from '../errors'
import { arr, at, canonicalJSON, int, obj, str, tryParseJSON } from '../core/json'
import { ToolCallIndexer } from '../core/toolCalls'
import type { SSEEvent } from '../http/sse'
import type { ChatStreamDecoder } from '../http/streaming'
import { fromStreamError, streamErrorText, truncate, type ErrorContext } from '../http/providerErrors'
import { scrubSecrets } from '../http/redactor'
import { cutText, noAnswerText, ThinkTagSplitter } from './common'

export function mapFinish(raw: string): FinishReason {
  switch (raw.toLowerCase()) {
    case 'stop':
    case 'end_turn':
    case 'stop_sequence':
    case 'eos':
      return 'stop'
    case 'length':
    case 'max_tokens':
    case 'max_output_tokens':
      return 'length'
    case 'tool_calls':
    case 'function_call':
    case 'tool_use':
      return 'toolCalls'
    case 'content_filter':
    case 'safety':
    case 'refusal':
      return 'contentFilter'
    case 'error':
      return 'error'
    default:
      return 'other'
  }
}

/** Uso de OpenAI, DeepSeek, OpenRouter, MiMo, Responses o pasarelas al estilo Anthropic (sin contar dos veces la caché). */
export function parseOpenAIUsage(u: JSONValue | undefined): Usage | undefined {
  const o = obj(u)
  if (!o) return undefined
  const prompt = int(o.prompt_tokens) ?? int(o.input_tokens)
  const completion = int(o.completion_tokens) ?? int(o.output_tokens)
  if (prompt === undefined && completion === undefined) return undefined
  const reasoning = int(at(o, 'completion_tokens_details', 'reasoning_tokens')) ?? int(at(o, 'output_tokens_details', 'reasoning_tokens')) ?? 0
  // lecturas de caché: varios nombres según el servicio; algunos mandan dos a la vez (DeepSeek): vale el mayor
  const cachedList = [int(at(o, 'prompt_tokens_details', 'cached_tokens')), int(at(o, 'input_tokens_details', 'cached_tokens')),
    int(o.prompt_cache_hit_tokens), int(o.cache_read_input_tokens)].filter((x): x is number => x !== undefined)
  const cached = cachedList.length ? Math.max(...cachedList) : 0
  // escrituras: OpenAI (GPT-5.6+) y OpenRouter `…_tokens_details.cache_write_tokens`; al estilo Anthropic `cache_creation_input_tokens`
  const writtenList = [int(at(o, 'prompt_tokens_details', 'cache_write_tokens')), int(at(o, 'input_tokens_details', 'cache_write_tokens')),
    int(o.cache_creation_input_tokens)].filter((x): x is number => x !== undefined)
  const written = writtenList.length ? Math.max(...writtenList) : 0
  let promptTokens = prompt ?? 0
  // con los nombres de Anthropic, `input_tokens` es solo lo no cacheado y el total es la suma
  if (o.prompt_tokens === undefined && o.input_tokens_details === undefined && (o.cache_read_input_tokens !== undefined || o.cache_creation_input_tokens !== undefined)) {
    promptTokens += (int(o.cache_read_input_tokens) ?? 0) + (int(o.cache_creation_input_tokens) ?? 0)
  }
  return { promptTokens, completionTokens: completion ?? 0, reasoningTokens: reasoning, cachedTokens: cached, cacheWriteTokens: written }
}

export function contentText(v: JSONValue | undefined): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((p) => (typeof p === 'string' ? p : str(obj(p)?.text) ?? '')).join('')
  return ''
}

export class OpenAIStreamDecoder implements ChatStreamDecoder {
  sawDone = false
  sawFinishReason = false
  sawPayload = false
  ignoredPayloads = 0
  private finish: FinishReason | undefined
  private usage: Usage | undefined
  private indexer = new ToolCallIndexer()
  private emittedToolCall = false
  private think = new ThinkTagSplitter()

  constructor(private readonly context: ErrorContext) {}

  get isComplete(): boolean {
    return this.sawDone || this.sawFinishReason
  }

  handle(event: SSEEvent): ChatEvent[] {
    const raw = event.data.trim()
    if (!raw) return []
    if (raw === '[DONE]') {
      this.sawDone = true
      return []
    }
    if (event.event?.toLowerCase() === 'error') {
      const json = tryParseJSON(raw)
      if (json !== undefined) throw fromStreamError(obj(json)?.error ?? json, this.context)
      const detail = scrubSecrets(truncate(raw, 500), this.context.secrets)
      throw new AIError('badResponse', streamErrorText(this.context.provider, detail), { providerMessage: detail })
    }
    const json = tryParseJSON(raw)
    if (!obj(json)) {
      this.ignoredPayloads += 1
      return []
    }
    return this.handleChunk(json!)
  }

  /** Procesa un objeto JSON de la respuesta (un chunk o la respuesta completa). */
  handleChunk(json: JSONValue): ChatEvent[] {
    this.sawPayload = true
    const o = obj(json)!
    if (o.error !== undefined && o.error !== null) throw fromStreamError(o.error, this.context)
    const out: ChatEvent[] = []
    const parsed = parseOpenAIUsage(o.usage)
    if (parsed && (!this.usage || usageTotal(parsed) >= usageTotal(this.usage))) this.usage = parsed
    const choices = arr(o.choices)
    if (!choices || !choices.length) return out
    const choice = obj(choices.find((c) => (int(obj(c)?.index) ?? 0) === 0) ?? choices[0])
    if (!choice) return out
    const delta = obj(choice.delta) ?? obj(choice.message)
    if (delta) {
      const r = str(delta.reasoning_content) ?? str(delta.reasoning)
      if (r) out.push({ type: 'reasoning', text: r })
      const split = this.think.feed(contentText(delta.content))
      if (split.reasoning) out.push({ type: 'reasoning', text: split.reasoning })
      if (split.visible) out.push({ type: 'text', text: split.visible })
      const refusal = str(delta.refusal)
      if (refusal) out.push({ type: 'text', text: refusal })
      const calls = arr(delta.tool_calls)
      if (calls) for (const tc of calls) out.push(...this.toolCallEvents(tc))
      else if (obj(delta.function_call)) out.push(...this.toolCallEvents({ function: delta.function_call as JSONValue })) // formato antiguo
    }
    const fr = str(choice.finish_reason)
    if (fr) {
      this.sawFinishReason = true
      this.finish = mapFinish(fr)
    }
    return out
  }

  finishStream(): ChatEvent[] {
    const out: ChatEvent[] = []
    const tail = this.think.finish()
    if (tail.reasoning) out.push({ type: 'reasoning', text: tail.reasoning })
    if (tail.visible) out.push({ type: 'text', text: tail.visible })
    if (this.usage) out.push({ type: 'usage', usage: this.usage })
    let reason = this.finish
    if (reason === undefined && this.sawDone) reason = this.emittedToolCall ? 'toolCalls' : 'stop'
    if (reason === undefined) {
      if (!this.sawPayload) throw new AIError('badResponse', noAnswerText(this.context.provider))
      throw new AIError('network', cutText(this.context.provider))
    }
    if (reason === 'stop' && this.emittedToolCall) reason = 'toolCalls'
    if (reason === 'error') {
      const p = this.context.provider
      throw new AIError('badResponse', tr(`${p} terminó la respuesta con un error sin dar detalles. Inténtalo de nuevo; si se repite, prueba con otro modelo.`,
        `${p} ended the response with an error and no details. Try again; if it happens again, try another model.`))
    }
    out.push({ type: 'finished', finish: reason })
    return out
  }

  /** Respuesta completa sin streaming: si falta `finish_reason`, se da por terminada con `stop`. */
  handleJSONBody(json: JSONValue): ChatEvent[] {
    let events: ChatEvent[] = []
    if (obj(json)) events = this.handleChunk(json)
    else this.sawPayload = true
    if (this.finish === undefined) {
      this.finish = 'stop'
      this.sawFinishReason = true
    }
    return events
  }

  private toolCallEvents(tc: JSONValue): ChatEvent[] {
    const t = obj(tc)
    if (!t) return []
    const fn = obj(t.function)
    const id = str(t.id)
    const name = str(fn?.name) ?? str(t.name)
    let args = ''
    const a = fn?.arguments ?? t.arguments
    if (a !== undefined) args = typeof a === 'string' ? a : a === null ? '' : canonicalJSON(a)
    const hasID = !!id
    const hasName = !!name
    if (!hasID && !hasName && !args) return []
    const eff = this.indexer.resolve(int(t.index), id, name)
    this.emittedToolCall = true
    return [{ type: 'tool_call', index: eff, id: hasID ? id : undefined, name: hasName ? name : undefined, argumentsFragment: args }]
  }
}
