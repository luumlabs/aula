// Atajos para los usos sencillos de un `ChatModel` (sin bucle de herramientas): una respuesta de texto, con streaming, y una
// respuesta JSON leída con reparación (bloques ```json, LaTeX mal escapado, comas finales, JSON cortado…) y, si aun así no vale,
// UNA segunda petición que le dice al modelo qué falló.
import type { JSONSchema, JSONValue } from '@shared/ai/json'
import type { ChatEvent, ChatMessage, ChatRequest, FinishReason, ImagePart, PromptCacheHint, Usage } from '@shared/ai/types'
import { addUsage, messageText, msg } from '@shared/ai/types'
import { tr } from '@shared/ai/i18n'
import { AIError } from './errors'
import { canonicalJSON } from './core/json'
import { fixLaTeXInValue, tryParseLenientJSON } from './core/repair'
import type { ChatModel, CompleteOptions } from './model'

export interface TextInput {
  system?: string
  /** Conversación previa (sin el sistema). */
  messages?: ChatMessage[]
  /** Atajo: un último mensaje del usuario. */
  prompt?: string
  images?: ImagePart[]
  temperature?: number
  maxTokens?: number
  reasoningEffort?: string
  jsonMode?: boolean
  timeoutSec?: number
  cache?: PromptCacheHint
}

export interface TextResult {
  text: string
  reasoning?: string
  usage: Usage
  finish: FinishReason
}

/** Arma la petición: sistema, conversación y el último mensaje del usuario. */
export function buildRequest(model: ChatModel, input: TextInput): ChatRequest {
  const messages: ChatMessage[] = []
  if (input.system) messages.push(msg.system(input.system))
  messages.push(...(input.messages ?? []))
  if (input.prompt !== undefined) messages.push(msg.user(input.prompt, model.capabilities.vision ? input.images ?? [] : []))
  const r: ChatRequest = { messages }
  if (input.temperature !== undefined) r.temperature = input.temperature
  if (input.maxTokens !== undefined) r.maxTokens = input.maxTokens
  if (input.reasoningEffort !== undefined) r.reasoningEffort = input.reasoningEffort
  if (input.jsonMode && model.capabilities.jsonMode) r.jsonMode = true
  if (input.timeoutSec !== undefined) r.timeoutSec = input.timeoutSec
  if (input.cache) r.cache = input.cache
  return r
}

/** Una respuesta de texto. */
export async function completeText(model: ChatModel, input: TextInput, opts: CompleteOptions = {}): Promise<TextResult> {
  const res = await model.complete(buildRequest(model, input), opts)
  const out: TextResult = { text: messageText(res.message), usage: res.usage, finish: res.finish }
  if (res.message.reasoning) out.reasoning = res.message.reasoning
  return out
}

export interface StreamCallbacks {
  signal?: AbortSignal
  onText?: (text: string) => void
  onReasoning?: (text: string) => void
  onEvent?: (e: ChatEvent) => void
}

/** Una respuesta de texto con los fragmentos a medida que llegan. */
export function streamText(model: ChatModel, input: TextInput, cb: StreamCallbacks = {}): Promise<TextResult> {
  return completeText(model, input, {
    signal: cb.signal,
    onDelta: (e) => {
      if (e.type === 'text' && e.text) cb.onText?.(e.text)
      else if (e.type === 'reasoning' && e.text) cb.onReasoning?.(e.text)
      cb.onEvent?.(e)
    }
  })
}

// MARK: JSON

/** Lee JSON de la respuesta de un modelo (tolerante y con el LaTeX arreglado); `undefined` si no hay. */
export function parseJSONReply(text: string): JSONValue | undefined {
  const t = text.trim()
  if (!t) return undefined
  const v = tryParseLenientJSON(t)
  return v === undefined ? undefined : fixLaTeXInValue(v)
}

/** El resultado de validar: el valor ya tipado o el motivo (para decírselo al modelo). */
export type JSONValidation<T> = { ok: true; value: T } | { ok: false; error: string }

export interface JSONInput<T> extends Omit<TextInput, 'jsonMode'> {
  /** Esquema que se describe en las instrucciones (no se valida aquí: para eso, `validate`). */
  schema?: JSONSchema
  /** Valida y convierte el JSON leído. Sin él, vale cualquier JSON. */
  validate?: (value: JSONValue) => JSONValidation<T>
  /** Peticiones extra para corregir (1 por defecto; 0 = ninguna). */
  repairAttempts?: number
}

export interface JSONResult<T> {
  value: T
  text: string
  usage: Usage
  /** Peticiones hechas (1 = a la primera). */
  attempts: number
}

/** Instrucciones de formato que se añaden al sistema (en inglés: van al modelo, como los prompts de la app Swift). */
export function jsonInstructions(schema?: JSONSchema): string {
  const lines = ['Answer ONLY with one valid JSON value: no prose before or after, no Markdown code fences.',
    'Inside JSON strings, escape backslashes (write \\\\frac, \\\\sqrt) and write line breaks as \\n.']
  if (schema) lines.push('It must match this JSON Schema:', canonicalJSON(schema))
  return lines.join('\n')
}

function badJSONError(model: ChatModel, detail: string): AIError {
  return new AIError('badResponse', tr(`${model.providerName} no devolvió un JSON válido (${detail}). Inténtalo de nuevo o prueba con otro modelo.`,
    `${model.providerName} didn't return valid JSON (${detail}). Try again or use another model.`), { providerMessage: detail })
}

/**
 * Pide una respuesta JSON y la lee con reparación. Si no es JSON, se cortó por longitud o `validate` la rechaza, repite la
 * petición con la respuesta y el motivo (hasta `repairAttempts` veces). Lanza `AIError` (`ai_bad_response`) si no se consigue.
 */
export async function completeJSON<T = JSONValue>(model: ChatModel, input: JSONInput<T>, opts: CompleteOptions = {}): Promise<JSONResult<T>> {
  const system = [input.system, jsonInstructions(input.schema)].filter((s) => s).join('\n\n')
  const base: TextInput = { ...input, system, jsonMode: true }
  const conversation: ChatMessage[] = [...(input.messages ?? [])]
  if (input.prompt !== undefined) conversation.push(msg.user(input.prompt, model.capabilities.vision ? input.images ?? [] : []))
  const maxAttempts = 1 + Math.max(0, input.repairAttempts ?? 1)
  let usage: Usage | undefined
  let lastError = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await completeText(model, { ...base, prompt: undefined, images: undefined, messages: conversation }, opts)
    usage = usage ? addUsage(usage, res.usage) : res.usage
    // una respuesta cortada por longitud no se acepta aunque se pueda «reparar»: faltaría contenido
    const parsed = res.finish === 'length' ? undefined : parseJSONReply(res.text)
    let problem: string
    if (parsed === undefined) {
      problem = res.finish === 'length' ? 'the answer was cut off by the length limit (send a shorter answer)' : 'the answer is not valid JSON'
    } else if (!input.validate) {
      return { value: parsed as T, text: res.text, usage, attempts: attempt }
    } else {
      const v = input.validate(parsed)
      if (v.ok) return { value: v.value, text: res.text, usage, attempts: attempt }
      problem = v.error
    }
    lastError = problem
    if (opts.signal?.aborted) break
    conversation.push(msg.assistant(res.text), msg.user(`Your previous answer can't be used: ${problem}. Send the corrected answer now, ONLY the JSON.`))
  }
  throw badJSONError(model, lastError)
}
