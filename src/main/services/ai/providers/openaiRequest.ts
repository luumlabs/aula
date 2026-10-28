// Cuerpo de `POST /chat/completions` y particularidades de cada servicio «compatible con OpenAI» (port de OpenAIRequest.swift,
// de OpenAIFixups y de OpenAIPromptCache).
//
// Opciones locales (en las cabeceras extra del proveedor; nunca se envían):
//  - `useMaxCompletionTokens: true` (o `x-aula-max-completion-tokens`): `max_completion_tokens` en vez de `max_tokens`
//    (por defecto en api.openai.com, Azure y MiMo);
//  - `x-aula-echo-reasoning: reasoning_content | reasoning | none`: reenviar el razonamiento previo (por defecto según el host:
//    DeepSeek, MiMo y OpenCode Zen → `reasoning_content`; OpenRouter → `reasoning`);
//  - `x-aula-stream-usage: false`: no enviar `stream_options`;
//  - `x-aula-idle-timeout: <s>`: inactividad máxima;
//  - `x-aula-auth-header: api-key`: la clave sola en esa cabecera (Azure y algunas pasarelas);
//  - `x-aula-openai-api: responses | chat`: qué API de OpenAI usar (por defecto `responses` con api.openai.com).
import type { JSONObject, JSONValue } from '@shared/ai/json'
import { isJSONObject } from '@shared/ai/json'
import type { ChatMessage, ChatRequest, ToolChoice, ToolSpec } from '@shared/ai/types'
import { messageImages, messageText, reusesTail } from '@shared/ai/types'
import { applyExtraBody, argumentsString, canonicalJSON, dataURL, objectSchema, str } from '../core/json'
import { isContextLengthError, AIError } from '../errors'
import { hostOf } from '../http/endpoints'
import { LocalFlags } from '../http/localFlags'
import type { ProviderConfig } from './config'
import { modelOrDefault, reasoningEffortFor } from './config'
import { hasImages, noMessagesError, noModelError, noVisionError, repairToolPairing } from './common'

export type ReasoningEcho = 'none' | 'reasoningContent' | 'reasoning'

export interface OpenAIQuirks {
  useMaxCompletionTokens: boolean
  reasoningEcho: ReasoningEcho
  /** OpenRouter pide `"reasoning": {"effort": …}` en vez de `reasoning_effort`. */
  reasoningAsObject: boolean
  sendStreamOptions: boolean
  idleTimeoutSec?: number
  authHeader?: string
  /** Usar la Responses API (`/responses`) en lugar de `/chat/completions`. */
  useResponsesAPI: boolean
}

export function detectQuirks(config: Pick<ProviderConfig, 'extraHeaders' | 'baseURL'>): OpenAIQuirks {
  const flags = new LocalFlags(config.extraHeaders)
  const host = hostOf(config.baseURL) ?? ''
  let reasoningEcho: ReasoningEcho = 'none'
  const echo = flags.string('x-aula-echo-reasoning')?.toLowerCase()
  if (echo !== undefined) {
    if (echo === 'reasoning') reasoningEcho = 'reasoning'
    else if (['none', 'false', '0', 'no', 'off'].includes(echo)) reasoningEcho = 'none'
    else reasoningEcho = 'reasoningContent'
  } else if (host.endsWith('deepseek.com') || host.endsWith('xiaomimimo.com') || host === 'opencode.ai') {
    reasoningEcho = 'reasoningContent'
  } else if (host === 'openrouter.ai') reasoningEcho = 'reasoning'
  let useResponsesAPI: boolean
  switch (flags.string('x-aula-openai-api')?.toLowerCase()) {
    case 'responses':
      useResponsesAPI = true
      break
    case 'chat':
    case 'chat-completions':
    case 'chat_completions':
      useResponsesAPI = false
      break
    default:
      useResponsesAPI = host === 'api.openai.com'
  }
  return {
    // MiMo documenta `max_completion_tokens` (acepta las dos)
    useMaxCompletionTokens: flags.bool('useMaxCompletionTokens') ?? flags.bool('x-aula-max-completion-tokens') ??
      (host === 'api.openai.com' || host.endsWith('.openai.azure.com') || host.endsWith('xiaomimimo.com')),
    reasoningEcho,
    reasoningAsObject: flags.bool('x-aula-reasoning-object') ?? host === 'openrouter.ai',
    sendStreamOptions: flags.bool('x-aula-stream-usage') ?? true,
    idleTimeoutSec: flags.number('x-aula-idle-timeout'),
    authHeader: flags.string('x-aula-auth-header'),
    useResponsesAPI
  }
}

/** Caracteres (≈ 3,5 por token) a partir de los cuales el prefijo estable llega al mínimo cacheable (≈ 512 tokens). */
export const CACHEABLE_PREFIX_MIN_CHARS = 1_800
export const EPHEMERAL: JSONObject = { type: 'ephemeral' }

/** Caché de prompts de OpenAI (guía «Prompt caching», consultada el 20-10-2026). */
export const OpenAIPromptCache = {
  /** `prompt_cache_breakpoint` explícito. */
  breakpoint: { mode: 'explicit' } as JSONObject,

  /** GPT-5.6 y posteriores admiten puntos de caché explícitos y `prompt_cache_options` (admite el prefijo `openai/`). */
  supportsExplicitBreakpoints(model: string): boolean {
    let m = model.toLowerCase()
    if (m.startsWith('~')) m = m.slice(1)
    if (m.startsWith('openai/')) m = m.slice('openai/'.length)
    return /^gpt-(?:5\.(?:[6-9]|[1-9]\d)|(?:[6-9]|[1-9]\d)(?:\.\d+)?)(?:[-.:_]|$)/.test(m)
  },

  /** `prompt_cache_key` (como mucho 64 caracteres). */
  key(raw: string | undefined): string | undefined {
    const k = raw?.trim()
    return k ? Array.from(k).slice(0, 64).join('') : undefined
  },

  /** Quita los parámetros de caché (un servidor que no los admite). Un mensaje `developer` que solo llevaba el punto vuelve a `instructions`. */
  strip(body: JSONObject): JSONObject {
    const o: JSONObject = { ...body }
    for (const k of ['prompt_cache_key', 'prompt_cache_options', 'session_id', 'cache_control']) delete o[k]
    const clean = (part: JSONValue): JSONValue => {
      if (!isJSONObject(part)) return part
      const p = { ...part }
      delete p.prompt_cache_breakpoint
      delete p.cache_control
      return p
    }
    const cleanMessages = (list: JSONValue[]): JSONValue[] =>
      list.map((item) => {
        if (!isJSONObject(item) || !Array.isArray(item.content)) return item
        return { ...item, content: item.content.map(clean) }
      })
    if (Array.isArray(o.input)) {
      let input = [...o.input]
      const first = input[0]
      if (o.instructions === undefined && isJSONObject(first) && first.role === 'developer' && Array.isArray(first.content) &&
          first.content.length === 1 && isJSONObject(first.content[0]) && typeof first.content[0].text === 'string') {
        o.instructions = first.content[0].text
        input = input.slice(1)
      }
      o.input = cleanMessages(input)
    }
    if (Array.isArray(o.messages)) o.messages = cleanMessages(o.messages)
    return o
  }
}

/**
 * Marcadores de caché en Chat Completions. Solo OpenRouter los traduce: modelos de Anthropic (`cache_control` por bloque y de
 * nivel superior), Qwen (exige marcadores) y OpenAI GPT-5.6+ (se convierten en `prompt_cache_breakpoint`). El resto: implícita.
 */
export type ChatCacheStyle = 'none' | 'anthropic' | 'blocks'

export function chatCacheStyle(host: string, model: string): ChatCacheStyle {
  if (host !== 'openrouter.ai') return 'none'
  let m = model.toLowerCase()
  if (m.startsWith('~')) m = m.slice(1)
  if (m.startsWith('anthropic/')) return 'anthropic'
  if (m.startsWith('qwen/') || (m.startsWith('openai/') && OpenAIPromptCache.supportsExplicitBreakpoints(m))) return 'blocks'
  return 'none'
}

/** Marca el último mensaje de sistema del principio (si llega al mínimo cacheable) y el primer fragmento del primer mensaje del usuario. */
export function markChatCache(messages: JSONValue[], toolChars: number, sharedFirstPart: boolean): JSONValue[] {
  const out = [...messages]
  let leading = 0
  while (leading < out.length && isJSONObject(out[leading]) && (out[leading] as JSONObject).role === 'system') leading++
  let systemChars = 0
  for (let i = 0; i < leading; i++) systemChars += str((out[i] as JSONObject).content)?.length ?? 0
  if (leading > 0 && systemChars + toolChars >= CACHEABLE_PREFIX_MIN_CHARS) {
    const m = out[leading - 1] as JSONObject
    const text = str(m.content)
    if (text) out[leading - 1] = { ...m, content: [{ type: 'text', text, cache_control: EPHEMERAL }] }
  }
  if (sharedFirstPart) {
    const i = out.findIndex((x) => isJSONObject(x) && x.role === 'user')
    if (i >= 0) {
      const m = out[i] as JSONObject
      const parts = Array.isArray(m.content) ? [...m.content] : undefined
      if (parts && parts.length > 1 && isJSONObject(parts[0]) && parts[0].type === 'text') {
        parts[0] = { ...parts[0], cache_control: EPHEMERAL }
        out[i] = { ...m, content: parts }
      }
    }
  }
  return out
}

/** `tools: [{type: function, function: {name, description, parameters}}]`. */
export function chatTools(specs: ToolSpec[]): JSONValue[] {
  return specs.map((s) => ({ type: 'function', function: { name: s.name, description: s.description, parameters: objectSchema(s.inputSchema) } }))
}

/** `auto` es el valor por defecto de las APIs, así que no se envía. */
export function chatToolChoice(c: ToolChoice | undefined): JSONValue | undefined {
  if (!c || c === 'auto') return undefined
  if (c === 'none') return 'none'
  if (c === 'required') return 'required'
  return { type: 'function', function: { name: c.name } }
}

function userContent(m: ChatMessage, asParts: boolean): JSONValue {
  if (!messageImages(m).length && !asParts) return messageText(m)
  return m.content.map((p): JSONValue =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: dataURL(p.image) } }
  )
}

/**
 * Mensajes en el formato de OpenAI. Las imágenes solo con visión (si no, error, nunca se descartan en silencio); las que
 * devuelve una herramienta van en un mensaje `user` posterior a todos los resultados (los mensajes `tool` solo admiten texto).
 */
export function chatMessages(input: ChatMessage[], config: ProviderConfig, quirks: OpenAIQuirks, echoReasoning: boolean, splitFirstUser = false, model?: string): JSONValue[] {
  if (!config.supportsVision && hasImages(input)) throw noVisionError(config, model)
  const repaired = repairToolPairing(input)
  const out: JSONValue[] = []
  let pending: JSONValue[] = []
  let firstUser = true
  const flush = () => {
    out.push(...pending)
    pending = []
  }
  for (const m of repaired) {
    if (m.role !== 'tool') flush()
    switch (m.role) {
      case 'system':
        out.push({ role: 'system', content: messageText(m) })
        break
      case 'user':
        out.push({ role: 'user', content: userContent(m, splitFirstUser && firstUser && m.content.length > 1) })
        firstUser = false
        break
      case 'assistant': {
        const o: JSONObject = { role: 'assistant' }
        const text = messageText(m)
        const calls = m.toolCalls ?? []
        if (!calls.length) o.content = text
        else {
          o.content = text ? text : null
          o.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: argumentsString(c) } }))
        }
        if (echoReasoning && m.reasoning) o[quirks.reasoningEcho === 'reasoning' ? 'reasoning' : 'reasoning_content'] = m.reasoning
        out.push(o)
        break
      }
      case 'tool': {
        const text = messageText(m) || '(sin salida)'
        out.push({ role: 'tool', tool_call_id: m.toolCallID ?? '', content: text })
        const images = messageImages(m)
        if (images.length) {
          const parts: JSONValue[] = [{ type: 'text', text: `Imagen devuelta por la herramienta «${m.name ?? 'herramienta'}»:` }]
          for (const img of images) parts.push({ type: 'image_url', image_url: { url: dataURL(img) } })
          pending.push({ role: 'user', content: parts })
        }
        break
      }
    }
  }
  flush()
  return out
}

/** Cuerpo completo de `POST /chat/completions`. */
export function chatBody(config: ProviderConfig, request: ChatRequest, stream: boolean, quirks: OpenAIQuirks): JSONObject {
  const model = modelOrDefault(request.model, config)
  if (!model) throw noModelError(config)
  if (!request.messages.length) throw noMessagesError()
  const tools = request.tools ?? []
  const b: JSONObject = { model }
  // DeepSeek (modo razonamiento) exige reenviar `reasoning_content` solo cuando la petición lleva herramientas
  const echo = quirks.reasoningEcho !== 'none' && tools.length > 0
  const host = hostOf(config.baseURL) ?? ''
  const style = chatCacheStyle(host, model)
  const toolList = tools.length ? chatTools(tools) : undefined
  const sharedFirst = request.cache?.sharedFirstUserPart === true
  let list = chatMessages(request.messages, config, quirks, echo, style !== 'none' && sharedFirst, model)
  if (style !== 'none') {
    list = markChatCache(list, toolList ? canonicalJSON(toolList).length : 0, sharedFirst)
    if (style === 'anthropic' && reusesTail(request.cache, request.messages)) b.cache_control = EPHEMERAL
    // GPT-5.6+ vía OpenRouter: en una petición suelta, modo `explicit` para no pagar la escritura de una cola que no se repetirá
    if (style === 'blocks' && OpenAIPromptCache.supportsExplicitBreakpoints(model) && !reusesTail(request.cache, request.messages)) {
      b.prompt_cache_options = { mode: 'explicit' }
    }
  }
  b.messages = list
  b.stream = stream
  if (stream && quirks.sendStreamOptions) b.stream_options = { include_usage: true }
  // clave de caché: OpenRouter la usa para el enrutado «pegajoso» (`session_id`); OpenAI, para llevar el prefijo al mismo servidor
  const key = OpenAIPromptCache.key(request.cache?.key)
  if (key) {
    if (host === 'openrouter.ai') b.session_id = key
    else if (host === 'api.openai.com') b.prompt_cache_key = key
  }
  if (toolList) {
    b.tools = toolList
    const c = chatToolChoice(request.toolChoice)
    if (c !== undefined) b.tool_choice = c
  }
  if (request.temperature !== undefined) b.temperature = request.temperature
  if (request.topP !== undefined) b.top_p = request.topP
  const maxTokens = request.maxTokens ?? config.maxOutputTokens
  if (maxTokens !== undefined) b[quirks.useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = maxTokens
  if (request.jsonMode && config.supportsJSONMode) b.response_format = { type: 'json_object' }
  const effort = request.reasoningEffort ?? reasoningEffortFor(config, model)
  if (effort) {
    if (host === 'api.deepseek.com') {
      b.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' }
      if (effort !== 'none') b.reasoning_effort = effort
    } else if (host.endsWith('xiaomimimo.com') && (effort === 'none' || effort === 'enabled')) {
      b.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' }
    } else if (quirks.reasoningAsObject) {
      // sin `provider.require_parameters`: excluía a todo proveedor que no anunciara TODOS los parámetros (404 «No endpoints»)
      b.reasoning = { effort }
    } else b.reasoning_effort = effort
  }
  return applyExtraBody(b, request.extraBody)
}

// MARK: Arreglos automáticos (400/422 por un parámetro opcional)

/** Etiquetas que se pueden recordar. */
export const OPENAI_MEMORABLE = new Set(['max-rename', 'temperature', 'top_p', 'stream_options', 'response_format', 'reasoning_effort', 'reasoning', 'tool_choice', 'prompt_cache'])

/** Quita o renombra lo que el servidor no admite según el mensaje de error. `null` si no hay nada que arreglar (o ya se intentó). */
export function applyOpenAIFixup(message: string, body: JSONObject, applied: Set<string>): JSONObject | null {
  // un «contexto demasiado largo» a veces nombra `max_tokens`; no es un parámetro mal puesto
  if (isContextLengthError(new AIError('http', message, { status: 400 }))) return null
  const m = message.toLowerCase()
  let o: JSONObject = { ...body }
  // DeepSeek (razonamiento): exige reenviar `reasoning_content` en los mensajes del asistente cuando hay herramientas
  if (m.includes('reasoning_content') &&
      ['missing', 'must be passed', 'pass back', 'passed back', 'required', 'should be passed', 'must be provided'].some((w) => m.includes(w)) &&
      !applied.has('reasoning-field') && Array.isArray(o.messages)) {
    let touched = false
    const msgs = o.messages.map((x) => {
      if (!isJSONObject(x) || x.role !== 'assistant' || x.reasoning_content !== undefined) return x
      touched = true
      return { ...x, reasoning_content: '' }
    })
    if (touched) {
      applied.add('reasoning-field')
      return { ...o, messages: msgs }
    }
  }
  const complains = ['unsupported', 'not supported', 'does not support', 'unknown', 'unrecognized', 'not allowed', 'invalid', 'only the default',
    'extra inputs', 'additional properties', 'not permitted', 'deprecated', 'no se admite', 'cannot be used', 'is not valid'].some((w) => m.includes(w))
  if (!complains) return null
  let changed = false
  const remove = (key: string, tag: string) => {
    if (o[key] === undefined || applied.has(tag)) return
    delete o[key]
    applied.add(tag)
    changed = true
  }
  // max_tokens ↔ max_completion_tokens (solo una vez, para no ir y venir)
  if (!applied.has('max-rename')) {
    if (m.includes('max_tokens') && o.max_tokens !== undefined) {
      o.max_completion_tokens = o.max_tokens
      delete o.max_tokens
      applied.add('max-rename')
      changed = true
    } else if (m.includes('max_completion_tokens') && o.max_completion_tokens !== undefined) {
      o.max_tokens = o.max_completion_tokens
      delete o.max_completion_tokens
      applied.add('max-rename')
      changed = true
    }
  }
  if (m.includes('temperature')) remove('temperature', 'temperature')
  if (m.includes('top_p')) remove('top_p', 'top_p')
  if (m.includes('stream_options') || m.includes('include_usage')) remove('stream_options', 'stream_options')
  if (m.includes('response_format') || m.includes('json_object') || m.includes('json mode')) remove('response_format', 'response_format')
  if (m.includes('reasoning_effort') || m.includes('reasoning')) {
    remove('reasoning_effort', 'reasoning_effort')
    remove('reasoning', 'reasoning')
  }
  if (m.includes('tool_choice')) remove('tool_choice', 'tool_choice')
  // parámetros de caché que este servidor no admite: fuera todos (y se recuerda)
  if (!applied.has('prompt_cache') && ['prompt_cache', 'session_id', 'cache_control', 'developer'].some((w) => m.includes(w))) {
    const stripped = OpenAIPromptCache.strip(o)
    applied.add('prompt_cache')
    if (canonicalJSON(stripped) !== canonicalJSON(o)) {
      o = stripped
      changed = true
    }
  }
  return changed ? o : null
}

/** Antes de la primera petición: aplica lo aprendido (el cuerpo se arma siempre igual, así que el cambio de nombre también). */
export function preapplyOpenAIFixups(body: JSONObject, learned: Set<string>, applied: Set<string>): JSONObject {
  if (!learned.size) return body
  let o: JSONObject = { ...body }
  for (const t of learned) {
    if (t === 'max-rename') {
      if (o.max_tokens !== undefined) {
        o.max_completion_tokens = o.max_tokens
        delete o.max_tokens
      } else if (o.max_completion_tokens !== undefined) {
        o.max_tokens = o.max_completion_tokens
        delete o.max_completion_tokens
      }
    } else if (t !== 'prompt_cache') delete o[t]
    applied.add(t)
  }
  if (learned.has('prompt_cache')) o = OpenAIPromptCache.strip(o)
  return o
}
