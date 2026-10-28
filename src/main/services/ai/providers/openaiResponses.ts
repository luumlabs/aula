// La Responses API de OpenAI (`POST {base}/responses`), que Aula usa con api.openai.com (port de OpenAIResponses.swift).
// Con los modelos actuales (GPT-6) las herramientas con razonamiento solo funcionan por Responses.
//  - Sin estado (`store: false`): los elementos de razonamiento llegan con `encrypted_content` y se reenvían intactos junto a
//    sus llamadas en la petición siguiente (se guardan en ThinkingVault por el `call_id` de la primera llamada del turno).
//  - El sistema va en `instructions` (o en un mensaje `developer` con su punto de caché); herramientas `{type: function, …}`.
//  - Streaming por eventos semánticos (`response.output_text.delta`, `response.function_call_arguments.delta`…).
import type { JSONObject, JSONValue } from '@shared/ai/json'
import type { ChatEvent, ChatMessage, ChatRequest, FinishReason, ToolChoice, Usage } from '@shared/ai/types'
import { messageImages, messageText, reusesTail } from '@shared/ai/types'
import { AIError } from '../errors'
import { applyExtraBody, arr, argumentsString, canonicalJSON, dataURL, obj, objectSchema, str, tryParseJSON } from '../core/json'
import { shortId } from '../core/toolCalls'
import type { SSEEvent } from '../http/sse'
import type { ChatStreamDecoder } from '../http/streaming'
import { fromStreamError, type ErrorContext } from '../http/providerErrors'
import type { ProviderConfig } from './config'
import { modelOrDefault, reasoningCapabilitiesFor, reasoningEffortFor } from './config'
import { cutText, hasImages, noAnswerText, noMessagesError, noModelError, noVisionError, repairToolPairing } from './common'
import { ThinkingVault } from './memory'
import { CACHEABLE_PREFIX_MIN_CHARS, OpenAIPromptCache } from './openaiRequest'
import { parseOpenAIUsage } from './openaiDecoder'

/** Modelos de razonamiento de OpenAI que rechazan el muestreo (`temperature`, `top_p`) cuando el esfuerzo no es `none`. */
export function responsesRejectsSampling(model: string, effort: string | undefined): boolean {
  if (effort?.toLowerCase() === 'none') return false
  return /^(?:o\d|gpt-(?:5|6|7))/.test(model.toLowerCase())
}

export function responsesToolChoice(c: ToolChoice | undefined): JSONValue | undefined {
  if (!c || c === 'auto') return undefined
  if (c === 'none') return 'none'
  if (c === 'required') return 'required'
  return { type: 'function', name: c.name }
}

/** Mensajes comunes → elementos de `input`. Las imágenes de una herramienta van en un mensaje de usuario posterior. */
export function responsesInput(messages: ChatMessage[], replayReasoning: boolean, vault: ThinkingVault, markSharedPart = false): JSONValue[] {
  const out: JSONValue[] = []
  let pending: JSONValue[] = []
  let firstUser = true
  const flush = () => {
    out.push(...pending)
    pending = []
  }
  for (const m of messages) {
    if (m.role !== 'tool') flush()
    switch (m.role) {
      case 'system':
        break
      case 'user': {
        // el contexto compartido (primer fragmento del primer mensaje) lleva su propio punto de caché
        const markFirst = markSharedPart && firstUser && m.content.length > 1
        firstUser = false
        if (!messageImages(m).length && !markFirst) {
          out.push({ role: 'user', content: messageText(m) })
          break
        }
        const parts: JSONValue[] = []
        m.content.forEach((p, k) => {
          if (p.type === 'text') {
            if (!p.text) return
            const part: JSONObject = { type: 'input_text', text: p.text }
            if (markFirst && k === 0) part.prompt_cache_breakpoint = OpenAIPromptCache.breakpoint
            parts.push(part)
          } else parts.push({ type: 'input_image', image_url: dataURL(p.image), detail: 'auto' })
        })
        out.push({ role: 'user', content: parts })
        break
      }
      case 'assistant': {
        const calls = m.toolCalls ?? []
        // razonamiento cifrado de la respuesta original, delante de sus llamadas (si sigue siendo la misma respuesta)
        if (replayReasoning && calls.length) {
          const skeleton = vault.lookup(calls[0].id)
          if (skeleton) {
            const ids = skeleton.flatMap((b) => (b.type === 'toolUse' ? [b.id] : []))
            if (ids.join('\u0000') === calls.map((c) => c.id).join('\u0000')) {
              for (const b of skeleton) {
                if (b.type !== 'item') continue
                const item = tryParseJSON(b.raw)
                if (item !== undefined) out.push(item)
              }
            }
          }
        }
        const text = messageText(m)
        if (text) out.push({ role: 'assistant', content: text })
        for (const c of calls) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: argumentsString(c) })
        break
      }
      case 'tool': {
        const text = messageText(m) || '(sin salida)'
        out.push({ type: 'function_call_output', call_id: m.toolCallID ?? '', output: text })
        const images = messageImages(m)
        if (images.length) {
          const parts: JSONValue[] = [{ type: 'input_text', text: `Imagen devuelta por la herramienta «${m.name ?? 'herramienta'}»:` }]
          for (const img of images) parts.push({ type: 'input_image', image_url: dataURL(img), detail: 'auto' })
          pending.push({ role: 'user', content: parts })
        }
        break
      }
    }
  }
  flush()
  return out
}

/** Cuerpo de `POST /responses`. */
export function responsesBody(config: ProviderConfig, request: ChatRequest, stream: boolean, replayReasoning = true, vault: ThinkingVault = ThinkingVault.shared): JSONObject {
  const model = modelOrDefault(request.model, config)
  if (!model) throw noModelError(config)
  if (!request.messages.length) throw noMessagesError()
  if (!config.supportsVision && hasImages(request.messages)) throw noVisionError(config, model)
  const repaired = repairToolPairing(request.messages)
  const instructions = repaired.filter((m) => m.role === 'system').map(messageText).filter((t) => t).join('\n\n')
  const tools: JSONValue[] = (request.tools ?? []).map((s) => ({ type: 'function', name: s.name, description: s.description, parameters: objectSchema(s.inputSchema) }))

  // Caché (GPT-5.6+): el modo implícito solo escribe al final del último mensaje; un sistema compartido lleva un punto
  // explícito en un mensaje `developer` (no cabe en `instructions`), igual que el contexto compartido.
  const explicit = OpenAIPromptCache.supportsExplicitBreakpoints(model)
  const stableChars = instructions.length + tools.reduce((n: number, t) => n + canonicalJSON(t).length, 0)
  const markSystem = explicit && !!instructions && stableChars >= CACHEABLE_PREFIX_MIN_CHARS
  const items = responsesInput(repaired.filter((m) => m.role !== 'system'), replayReasoning, vault, explicit && request.cache?.sharedFirstUserPart === true)
  if (markSystem) {
    items.unshift({ role: 'developer', content: [{ type: 'input_text', text: instructions, prompt_cache_breakpoint: OpenAIPromptCache.breakpoint }] })
  }
  const b: JSONObject = { model, input: items }
  if (instructions && !markSystem) b.instructions = instructions
  b.stream = stream
  b.store = false
  const key = OpenAIPromptCache.key(request.cache?.key)
  if (key) b.prompt_cache_key = key
  if (explicit && !reusesTail(request.cache, request.messages)) b.prompt_cache_options = { mode: 'explicit' }
  if (tools.length) {
    b.tools = tools
    const c = responsesToolChoice(request.toolChoice)
    if (c !== undefined) b.tool_choice = c
  }
  const effort = (request.reasoningEffort ?? reasoningEffortFor(config, model))?.trim().toLowerCase()
  if (!responsesRejectsSampling(model, effort)) {
    if (request.temperature !== undefined) b.temperature = request.temperature
    if (request.topP !== undefined) b.top_p = request.topP
  }
  const maxTokens = request.maxTokens ?? config.maxOutputTokens
  if (maxTokens !== undefined) b.max_output_tokens = maxTokens
  if (request.jsonMode && config.supportsJSONMode) b.text = { format: { type: 'json_object' } }
  const reasoning: JSONObject = {}
  if (effort) reasoning.effort = effort
  // solo los modelos con razonamiento admiten un resumen
  if (effort !== 'none' && (effort !== undefined || (reasoningCapabilitiesFor(config, model)?.efforts.length ?? 0) > 0)) reasoning.summary = 'auto'
  if (Object.keys(reasoning).length) b.reasoning = reasoning
  return applyExtraBody(b, request.extraBody)
}

/** `{code, message}` → la forma que entiende `fromStreamError` (con el código HTTP si se deduce). */
export function responsesErrorObject(err: JSONValue): JSONValue {
  const o0 = obj(err)
  if (!o0) return err
  const o: JSONObject = { ...o0 }
  const code = (str(o.code) ?? str(o.type) ?? '').toLowerCase()
  if (o.type === undefined && code) o.type = code
  if (code.includes('rate_limit') || code === 'slow_down') o.code = 429
  else if (code.includes('server_error') || code.includes('overloaded')) o.type = 'overloaded_error'
  else if (code.includes('invalid_api_key') || code.includes('authentication')) o.code = 401
  return o
}

/** Eventos SSE de la Responses API → eventos de chat (uso y fin, una sola vez al terminar; lo desconocido se ignora). */
export class OpenAIResponsesDecoder implements ChatStreamDecoder {
  private toolIndexByItem = new Map<string, number>()
  private argumentsSeen = new Set<string>()
  private callIDs: string[] = []
  private reasoningItems: string[] = []
  private usage: Usage | undefined
  private finish: FinishReason | undefined
  private sawPayload = false
  private refused = false

  constructor(private readonly context: ErrorContext, private readonly vault: ThinkingVault = ThinkingVault.shared) {}

  handle(event: SSEEvent): ChatEvent[] {
    const raw = event.data.trim()
    if (!raw || raw === '[DONE]') return []
    const json = obj(tryParseJSON(raw))
    if (!json) return []
    this.sawPayload = true
    const type = str(json.type) ?? event.event ?? ''
    const delta = () => str(json.delta) ?? ''
    switch (type) {
      case 'response.output_text.delta': {
        const t = delta()
        return t ? [{ type: 'text', text: t }] : []
      }
      case 'response.refusal.delta': {
        this.refused = true
        const t = delta()
        return t ? [{ type: 'text', text: t }] : []
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const t = delta()
        return t ? [{ type: 'reasoning', text: t }] : []
      }
      case 'response.reasoning_summary_part.done':
        return [{ type: 'reasoning', text: '\n\n' }]
      case 'response.output_item.added':
        return this.itemStarted(json.item)
      case 'response.function_call_arguments.delta': {
        const itemID = str(json.item_id)
        const index = itemID !== undefined ? this.toolIndexByItem.get(itemID) : undefined
        if (itemID === undefined || index === undefined) return []
        const frag = delta()
        if (frag) this.argumentsSeen.add(itemID)
        return [{ type: 'tool_call', index, argumentsFragment: frag }]
      }
      case 'response.function_call_arguments.done': {
        const itemID = str(json.item_id)
        const index = itemID !== undefined ? this.toolIndexByItem.get(itemID) : undefined
        if (itemID === undefined || index === undefined || this.argumentsSeen.has(itemID)) return []
        this.argumentsSeen.add(itemID)
        return [{ type: 'tool_call', index, argumentsFragment: str(json.arguments) ?? '' }]
      }
      case 'response.output_item.done':
        return this.itemDone(json.item)
      case 'response.completed':
      case 'response.incomplete':
        this.absorb(json.response, true)
        return []
      case 'response.failed': {
        const err = obj(json.response)?.error ?? json.error ?? json
        throw fromStreamError(responsesErrorObject(err), this.context)
      }
      case 'error':
        throw fromStreamError(responsesErrorObject(json.error ?? json), this.context)
      default:
        return []
    }
  }

  /** Respuesta completa sin streaming. */
  handleJSONBody(json: JSONValue): ChatEvent[] {
    this.sawPayload = true
    const o = obj(json)
    if (o && o.error !== undefined && o.error !== null && o.status !== 'completed') {
      throw fromStreamError(responsesErrorObject(o.error), this.context)
    }
    const out: ChatEvent[] = []
    for (const itemV of arr(o?.output) ?? []) {
      const item = obj(itemV)
      if (!item) continue
      switch (str(item.type) ?? '') {
        case 'message':
          for (const partV of arr(item.content) ?? []) {
            const part = obj(partV)
            const t = str(part?.text)
            if (t && part?.type === 'output_text') out.push({ type: 'text', text: t })
            const r = str(part?.refusal)
            if (r) {
              this.refused = true
              out.push({ type: 'text', text: r })
            }
          }
          break
        case 'reasoning': {
          const summary = (arr(item.summary) ?? []).map((s) => str(obj(s)?.text)).filter((x): x is string => x !== undefined).join('\n\n')
          if (summary) out.push({ type: 'reasoning', text: summary })
          out.push(...this.itemDone(item))
          break
        }
        case 'function_call':
          out.push(...this.itemStarted(item))
          out.push(...this.itemDone(item))
          break
        default:
          break
      }
    }
    this.absorb(json, true)
    if (this.finish === undefined) this.finish = 'stop'
    return out
  }

  finishStream(): ChatEvent[] {
    let final = this.finish
    if (final === undefined) {
      if (!this.sawPayload) throw new AIError('badResponse', noAnswerText(this.context.provider))
      throw new AIError('network', cutText(this.context.provider))
    }
    if (this.refused) final = 'contentFilter'
    else if (final === 'stop' && this.callIDs.length) final = 'toolCalls'
    const out: ChatEvent[] = []
    if (this.usage) out.push({ type: 'usage', usage: this.usage })
    out.push({ type: 'finished', finish: final })
    if (this.callIDs.length && this.reasoningItems.length) {
      this.vault.store([...this.reasoningItems.map((raw) => ({ type: 'item' as const, raw })), ...this.callIDs.map((id) => ({ type: 'toolUse' as const, id }))])
    }
    return out
  }

  private itemStarted(itemV: JSONValue | undefined): ChatEvent[] {
    const item = obj(itemV)
    if (!item || item.type !== 'function_call') return []
    const itemID = str(item.id) ?? str(item.call_id) ?? shortId(12)
    if (this.toolIndexByItem.has(itemID)) return []
    const index = this.toolIndexByItem.size
    this.toolIndexByItem.set(itemID, index)
    const callID = str(item.call_id) ?? itemID
    this.callIDs.push(callID)
    const args = str(item.arguments) ?? ''
    if (args) this.argumentsSeen.add(itemID)
    return [{ type: 'tool_call', index, id: callID, name: str(item.name) ?? '', argumentsFragment: args }]
  }

  private itemDone(itemV: JSONValue | undefined): ChatEvent[] {
    const item = obj(itemV)
    if (!item) return []
    switch (str(item.type) ?? '') {
      case 'reasoning':
        // se guarda entero (con `encrypted_content`) para devolverlo intacto en la petición siguiente
        if (str(item.encrypted_content)) this.reasoningItems.push(canonicalJSON(item))
        return []
      case 'function_call': {
        const itemID = str(item.id) ?? str(item.call_id) ?? ''
        if (!this.toolIndexByItem.has(itemID)) return this.itemStarted(item)
        const index = this.toolIndexByItem.get(itemID)!
        if (this.argumentsSeen.has(itemID)) return []
        this.argumentsSeen.add(itemID)
        return [{ type: 'tool_call', index, argumentsFragment: str(item.arguments) ?? '' }]
      }
      default:
        return []
    }
  }

  private absorb(responseV: JSONValue | undefined, terminal: boolean): void {
    const response = obj(responseV)
    if (!response) return
    const u = parseOpenAIUsage(response.usage)
    if (u) this.usage = u
    if (response.status === 'incomplete') {
      const reason = str(obj(response.incomplete_details)?.reason) ?? ''
      this.finish = reason === 'content_filter' ? 'contentFilter' : 'length'
    } else if (terminal) this.finish = 'stop'
  }
}
