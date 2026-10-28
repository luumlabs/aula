// Cuerpo de `POST /v1/messages` de Anthropic (port de AnthropicRequest.swift, AnthropicThinking y AnthropicFixups).
import type { JSONObject, JSONValue } from '@shared/ai/json'
import { isJSONObject } from '@shared/ai/json'
import type { ChatMessage, ChatRequest, ImagePart, ToolCall, ToolChoice, ToolSpec } from '@shared/ai/types'
import { messageImages, messageText, reusesTail } from '@shared/ai/types'
import { knownReasoningCapabilities } from '@shared/ai/reasoning'
import { tr } from '@shared/ai/i18n'
import { AIError } from '../errors'
import { applyExtraBody, canonicalJSON, objectSchema } from '../core/json'
import type { ProviderConfig } from './config'
import { modelOrDefault, reasoningCapabilitiesFor, reasoningEffortFor } from './config'
import { hasImages, noMessagesError, noModelError, noVisionError, repairToolPairing } from './common'
import { ThinkingVault, type VaultBlock } from './memory'
import { CACHEABLE_PREFIX_MIN_CHARS, EPHEMERAL } from './openaiRequest'

/** `max_tokens` es obligatorio en esta API. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

export interface AnthropicBodyOptions {
  stream: boolean
  /** Reenviar los bloques `thinking` firmados de turnos anteriores con herramientas. */
  replayThinking?: boolean
  vault?: ThinkingVault
}

/** `low | medium | high | xhigh | max` (los de otros proveedores se traducen; `none` desactiva el parámetro). */
export function anthropicEffort(raw: string | undefined): string | undefined {
  const r = raw?.trim().toLowerCase()
  if (!r || r === 'none' || r === 'off') return undefined
  return r === 'minimal' ? 'low' : r
}

export function anthropicTool(s: ToolSpec): JSONObject {
  return { name: s.name, description: s.description, input_schema: objectSchema(s.inputSchema) }
}

export function anthropicToolChoice(c: ToolChoice | undefined): JSONValue | undefined {
  if (!c || c === 'auto') return undefined
  if (c === 'none') return { type: 'none' }
  if (c === 'required') return { type: 'any' }
  return { type: 'tool', name: c.name }
}

/** Ids de `tool_use` válidos para Anthropic: `^[a-zA-Z0-9_-]+$`. Se aplica igual a la llamada y a su resultado. */
export function sanitizeToolID(id: string): string {
  let out = ''
  for (const ch of id) out += /^[A-Za-z0-9_-]$/.test(ch) ? ch : '_'
  return out || 'toolu_sin_id'
}

/**
 * El parámetro `thinking`: en todo modelo que acepte el modo adaptativo se envía `{type: adaptive, display: summarized}`
 * (Opus 4.6–4.8 no piensan sin él; la familia 5.x esconde el razonamiento sin `display`). Los demás no lo reciben.
 */
export function anthropicThinking(config: ProviderConfig, model: string): JSONObject | undefined {
  const types = reasoningCapabilitiesFor(config, model)?.thinkingTypes ?? knownReasoningCapabilities(model, config)?.thinkingTypes
  if (!types?.includes('adaptive')) return undefined
  return { type: 'adaptive', display: 'summarized' }
}

/**
 * Modelos que solo aceptan un bloque de razonamiento reenviado si todo lo anterior es idéntico (Fable 5.1, Mythos 5.1,
 * Opus/Sonnet/Haiku 5.5): al recortar el historial sus bloques ya no valen y reenviarlos da un 400.
 */
export function checksReplayPrefix(model: string): boolean {
  return /^claude-(?:(?:fable|mythos)-5-1|(?:opus|sonnet|haiku)-5-5)(?:-\d{8}|-\d{4}-\d{2}-\d{2})?$/.test(model.toLowerCase())
}

/** Modelos que rechazan el muestreo (`temperature`, `top_p`, `top_k`) con un 400: no se manda. */
export function anthropicRejectsSampling(model: string): boolean {
  return /claude-(?:(?:fable|mythos|opus|sonnet|haiku)-5|opus-4-[78])(?![0-9])/.test(model.toLowerCase())
}

const textBlock = (t: string): JSONObject => ({ type: 'text', text: t })
const imageBlock = (i: ImagePart): JSONObject => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.base64 } })

function toolUseBlock(c: ToolCall): JSONObject {
  // `input` debe ser un objeto; cualquier otra cosa se envuelve
  const input: JSONValue = isJSONObject(c.arguments) ? c.arguments : c.arguments === null || c.arguments === undefined ? {} : { _valor: c.arguments }
  return { type: 'tool_use', id: sanitizeToolID(c.id), name: c.name, input }
}

/** Reconstruye el contenido original de la respuesta (con su razonamiento) si sigue coincidiendo con el mensaje. */
function rebuild(skeleton: VaultBlock[], m: ChatMessage): JSONValue[] | undefined {
  const calls = m.toolCalls ?? []
  const ids = skeleton.flatMap((b) => (b.type === 'toolUse' ? [b.id] : []))
  if (ids.join('\u0000') !== calls.map((c) => c.id).join('\u0000')) return undefined
  const text = skeleton.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  if (text !== messageText(m)) return undefined
  const byID = new Map<string, ToolCall>()
  for (const c of calls) if (!byID.has(c.id)) byID.set(c.id, c)
  const out: JSONValue[] = []
  for (const b of skeleton) {
    switch (b.type) {
      case 'thinking':
        out.push({ type: 'thinking', thinking: b.text, signature: b.signature })
        break
      case 'redacted':
        out.push({ type: 'redacted_thinking', data: b.data })
        break
      case 'text':
        if (b.text) out.push(textBlock(b.text))
        break
      case 'toolUse': {
        const c = byID.get(b.id)
        if (c) out.push(toolUseBlock(c))
        break
      }
      case 'item':
        break // de otra API: no se mezcla con Anthropic
    }
  }
  return out
}

function assistantBlocks(m: ChatMessage, opts: AnthropicBodyOptions): JSONValue[] {
  const calls = m.toolCalls ?? []
  if (opts.replayThinking !== false && calls.length) {
    const skeleton = (opts.vault ?? ThinkingVault.shared).lookup(calls[0].id)
    const rebuilt = skeleton ? rebuild(skeleton, m) : undefined
    if (rebuilt) return rebuilt
  }
  const out: JSONValue[] = []
  const text = messageText(m)
  if (text) out.push(textBlock(text))
  for (const c of calls) out.push(toolUseBlock(c))
  return out
}

/**
 * Mensajes en formato Anthropic y nombres de herramientas usadas en el historial. Se fusionan los mensajes consecutivos del
 * mismo rol (los `tool_result` van primero en el mensaje del usuario) y la conversación empieza por un mensaje del usuario.
 */
function convert(input: ChatMessage[], opts: AnthropicBodyOptions): { messages: JSONValue[]; usedTools: Set<string> } {
  const msgs: { role: string; blocks: JSONValue[] }[] = []
  const usedTools = new Set<string>()
  const append = (role: string, block: JSONValue, front = false) => {
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) {
      if (front) {
        // insertar tras los tool_result que ya haya al principio
        let i = 0
        while (i < last.blocks.length && isJSONObject(last.blocks[i]) && (last.blocks[i] as JSONObject).type === 'tool_result') i++
        last.blocks.splice(i, 0, block)
      } else last.blocks.push(block)
    } else msgs.push({ role, blocks: [block] })
  }
  for (const m of input) {
    switch (m.role) {
      case 'system':
        break
      case 'user':
        for (const p of m.content) {
          if (p.type === 'text') {
            if (p.text) append('user', textBlock(p.text))
          } else append('user', imageBlock(p.image))
        }
        break
      case 'assistant':
        for (const b of assistantBlocks(m, opts)) append('assistant', b)
        for (const c of m.toolCalls ?? []) usedTools.add(c.name)
        break
      case 'tool': {
        const id = sanitizeToolID(m.toolCallID ?? '')
        const text = messageText(m)
        const images = messageImages(m)
        const block: JSONObject = { type: 'tool_result', tool_use_id: id }
        if (!images.length) block.content = text || '(sin salida)'
        else {
          const content: JSONValue[] = []
          if (text || !images.length) content.push(textBlock(text || '(sin salida)'))
          for (const img of images) content.push(imageBlock(img))
          block.content = content
        }
        if (text.startsWith('Error:')) block.is_error = true
        append('user', block, true)
        break
      }
    }
  }
  if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', blocks: [textBlock('(inicio de la conversación)')] })
  return { messages: msgs.map((m) => ({ role: m.role, content: m.blocks })), usedTools }
}

function cacheable(block: JSONValue): boolean {
  if (!isJSONObject(block)) return false
  if (block.type === 'thinking' || block.type === 'redacted_thinking') return false
  if (block.type === 'text') return typeof block.text === 'string' && block.text.length > 0
  return true
}

/**
 * Marcadores de caché en los mensajes (como mucho dos; con el del sistema, tres de los cuatro que admite la API): el primer
 * bloque del primer mensaje del usuario si es contexto compartido, y el último bloque si la siguiente petición la repetirá.
 */
export function markForCaching(messages: JSONValue[], sharedFirstPart: boolean, tail: boolean): JSONValue[] {
  const out = [...messages]
  const mark = (mi: number, bi: number) => {
    const m = out[mi]
    if (!isJSONObject(m) || !Array.isArray(m.content)) return
    const blocks = [...m.content]
    const b = blocks[bi]
    if (!isJSONObject(b) || b.cache_control !== undefined) return
    blocks[bi] = { ...b, cache_control: EPHEMERAL }
    out[mi] = { ...m, content: blocks }
  }
  if (sharedFirstPart) {
    const first = out.findIndex((x) => isJSONObject(x) && x.role === 'user')
    const blocks = first >= 0 ? (out[first] as JSONObject).content : undefined
    if (Array.isArray(blocks) && blocks.length > 1 && cacheable(blocks[0])) mark(first, 0)
  }
  if (tail && out.length) {
    const last = out.length - 1
    const blocks = (out[last] as JSONObject).content
    if (Array.isArray(blocks)) {
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (cacheable(blocks[i])) {
          mark(last, i)
          break
        }
      }
    }
  }
  return out
}

/** Quita los marcadores `cache_control` (servidores compatibles que no los admiten). No entra en el contenido. */
export function stripCacheControl(body: JSONObject): JSONObject {
  const o: JSONObject = { ...body }
  const strip = (v: JSONValue): JSONValue => {
    if (!isJSONObject(v)) return v
    const b = { ...v }
    delete b.cache_control
    return b
  }
  delete o.cache_control
  if (Array.isArray(o.system)) o.system = o.system.map(strip)
  if (Array.isArray(o.tools)) o.tools = o.tools.map(strip)
  if (Array.isArray(o.messages)) {
    o.messages = o.messages.map((m) => (isJSONObject(m) && Array.isArray(m.content) ? { ...m, content: m.content.map(strip) } : m))
  }
  return o
}

export function anthropicBody(config: ProviderConfig, request: ChatRequest, opts: AnthropicBodyOptions): JSONObject {
  const model = modelOrDefault(request.model, config)
  if (!model) throw noModelError(config)
  if (!request.messages.length) throw noMessagesError()
  if (!config.supportsVision && hasImages(request.messages)) throw noVisionError(config, model)
  const repaired = repairToolPairing(request.messages)
  const system = repaired.filter((m) => m.role === 'system').map(messageText).filter((t) => t).join('\n\n')
  const { messages, usedTools } = convert(repaired.filter((m) => m.role !== 'system'), opts)
  if (!messages.length) {
    throw new AIError('other', tr('La petición no tiene ningún mensaje de usuario con contenido.', 'The request has no user message with content.'))
  }
  const b: JSONObject = { model, max_tokens: request.maxTokens ?? config.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS, messages, stream: opts.stream }
  const tools = (request.tools ?? []).map(anthropicTool)
  // Caché: el orden es herramientas → sistema → mensajes y cada marcador cachea todo lo anterior.
  const stablePrefixChars = system.length + tools.reduce((n: number, t) => n + canonicalJSON(t).length, 0)
  const cacheStablePrefix = stablePrefixChars >= CACHEABLE_PREFIX_MIN_CHARS
  if (system) b.system = cacheStablePrefix ? [{ type: 'text', text: system, cache_control: EPHEMERAL }] : system
  if (tools.length) {
    const list = [...tools]
    if (cacheStablePrefix && !system) list[list.length - 1] = { ...list[list.length - 1], cache_control: EPHEMERAL }
    b.tools = list
    const c = anthropicToolChoice(request.toolChoice)
    if (c !== undefined) b.tool_choice = c
  } else if (usedTools.size) {
    // la API exige declarar `tools` si el historial contiene tool_use/tool_result, aunque ahora no se quieran usar
    b.tools = [...usedTools].sort().map((name) => ({
      name, description: 'Herramienta usada antes en esta conversación (no está disponible ahora).', input_schema: { type: 'object', properties: {} }
    }))
    b.tool_choice = { type: 'none' }
  }
  if (request.temperature !== undefined) b.temperature = request.temperature
  if (request.topP !== undefined) b.top_p = request.topP
  const effort = anthropicEffort(request.reasoningEffort ?? reasoningEffortFor(config, model))
  if (effort) b.output_config = { effort }
  const thinking = anthropicThinking(config, model)
  if (thinking && request.extraBody?.thinking === undefined) {
    b.thinking = thinking
    // con el razonamiento activo, `temperature` no se admite y `top_p` solo entre 0,95 y 1
    delete b.temperature
    if (request.topP !== undefined && !(request.topP >= 0.95 && request.topP <= 1)) delete b.top_p
  }
  b.messages = markForCaching(messages, request.cache?.sharedFirstUserPart === true, reusesTail(request.cache, request.messages))
  return applyExtraBody(b, request.extraBody)
}

// MARK: Arreglos automáticos

export const ANTHROPIC_MEMORABLE = new Set(['thinking', 'temperature', 'top_p', 'top_k', 'output_config', 'tool_choice', 'cache_control', 'system-cache'])

export type AnthropicFixupResult = { action: 'none' } | { action: 'changedBody'; body: JSONObject } | { action: 'stripThinking' }

/** Quita del cuerpo lo que el modelo no admite. Si el error es de bloques de razonamiento, `stripThinking`. */
export function applyAnthropicFixup(message: string, body: JSONObject, applied: Set<string>): AnthropicFixupResult {
  const m = message.toLowerCase()
  if (m.includes('thinking') && (m.includes('signature') || m.includes('cannot be modified') || m.includes('block')) && !applied.has('strip-thinking')) {
    applied.add('strip-thinking')
    return { action: 'stripThinking' }
  }
  let o: JSONObject = { ...body }
  let changed = false
  const remove = (key: string) => {
    if (o[key] === undefined || applied.has(key)) return
    delete o[key]
    applied.add(key)
    changed = true
  }
  // «"thinking.type.…" is not supported», «adaptive thinking is not supported on this model», `display` no admitido:
  // fuera `thinking` (y solo eso: estos mensajes también nombran `output_config.effort` como alternativa)
  const thinkingComplaint = m.includes('thinking.type') || m.includes('adaptive thinking') || m.includes('thinking.display') ||
    (m.includes('thinking') && m.includes('display')) || (m.includes('thinking') && m.includes('adaptive'))
  if (thinkingComplaint) remove('thinking')
  if (m.includes('temperature')) remove('temperature')
  if (m.includes('top_p')) remove('top_p')
  if (!thinkingComplaint && (m.includes('output_config') || m.includes('effort'))) remove('output_config')
  if (m.includes('tool_choice')) remove('tool_choice')
  // un servidor compatible que no admite los marcadores de caché: fuera todos (y se recuerda)
  if (m.includes('cache_control') && !applied.has('cache_control')) {
    const stripped = stripCacheControl(o)
    applied.add('cache_control')
    if (canonicalJSON(stripped) !== canonicalJSON(o)) {
      o = stripped
      changed = true
    }
  }
  return changed ? { action: 'changedBody', body: o } : { action: 'none' }
}

/** Antes de la primera petición: quita lo que ya se sabe que el modelo no admite (y el muestreo en los que nunca lo admiten). */
export function preapplyAnthropicFixups(body: JSONObject, model: string, learned: Set<string>, applied: Set<string>): JSONObject {
  let o: JSONObject = { ...body }
  const tags = new Set(learned)
  if (anthropicRejectsSampling(model)) for (const t of ['temperature', 'top_p', 'top_k']) tags.add(t)
  let stripCache = false
  for (const t of tags) {
    if (t === 'cache_control' || t === 'system-cache') stripCache = true
    else delete o[t]
    applied.add(t)
  }
  if (stripCache) o = stripCacheControl(o)
  return o
}
