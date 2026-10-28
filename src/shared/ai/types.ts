// Tipos comunes de la IA (port de AICore/Types.swift). Las claves de los mensajes y del uso son las mismas que en la app
// Swift (`toolCallID`, `promptTokens`…) para leer las conversaciones y los registros que ya existen.
import type { JSONObject, JSONSchema, JSONValue } from './json'
import type { ReasoningCapabilities } from './reasoning'

// MARK: Mensajes

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ImagePart {
  /** 'image/png' | 'image/jpeg' | 'image/webp' */
  mediaType: string
  base64: string
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: ImagePart }

export interface ToolCall {
  id: string
  name: string
  /** Argumentos ya interpretados (con reparación de JSON si hizo falta). */
  arguments: JSONValue
  /** Texto original que envió el modelo (para depurar). */
  rawArguments?: string
}

export interface ChatMessage {
  role: Role
  content: ContentPart[]
  toolCalls?: ToolCall[]
  /** En mensajes `tool`: id de la llamada a la que responde. */
  toolCallID?: string
  /** En mensajes `tool`: nombre de la herramienta. */
  name?: string
  /** Razonamiento del modelo (informativo; algunos proveedores exigen reenviarlo). */
  reasoning?: string
}

export function messageText(m: ChatMessage): string {
  let out = ''
  for (const p of m.content) if (p.type === 'text') out += p.text
  return out
}

export function messageImages(m: ChatMessage): ImagePart[] {
  const out: ImagePart[] = []
  for (const p of m.content) if (p.type === 'image') out.push(p.image)
  return out
}

/** Constructores de mensajes. */
export const msg = {
  system(text: string): ChatMessage {
    return { role: 'system', content: [{ type: 'text', text }] }
  },
  user(text: string, images: ImagePart[] = []): ChatMessage {
    return { role: 'user', content: [{ type: 'text', text }, ...images.map((image) => ({ type: 'image' as const, image }))] }
  },
  assistant(text: string, toolCalls: ToolCall[] = [], reasoning?: string): ChatMessage {
    const m: ChatMessage = { role: 'assistant', content: text ? [{ type: 'text', text }] : [] }
    if (toolCalls.length) m.toolCalls = toolCalls
    if (reasoning) m.reasoning = reasoning
    return m
  },
  toolResult(id: string, name: string, text: string, images: ImagePart[] = []): ChatMessage {
    return {
      role: 'tool',
      content: [{ type: 'text', text }, ...images.map((image) => ({ type: 'image' as const, image }))],
      toolCallID: id,
      name
    }
  }
}

// MARK: Herramientas

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema (type: object). */
  inputSchema: JSONSchema
}

export type ToolChoice = 'auto' | 'none' | 'required' | { name: string }

// MARK: Uso y fin

export interface Usage {
  /** Tokens de entrada, INCLUIDOS los leídos de caché (`cachedTokens`) y los escritos en ella (`cacheWriteTokens`). */
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  /** De `promptTokens`, los leídos de la caché del proveedor (tarifa reducida). */
  cachedTokens: number
  /** De `promptTokens`, los escritos en la caché (tarifa de escritura). 0 si el proveedor no los separa. */
  cacheWriteTokens: number
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens
  }
}

export function usageTotal(u: Usage): number {
  return u.promptTokens + u.completionTokens
}

/** Lee un uso guardado (los datos sin `cacheWriteTokens` también valen: falta = 0). */
export function normalizeUsage(raw: Partial<Usage> | null | undefined): Usage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    promptTokens: n(raw?.promptTokens),
    completionTokens: n(raw?.completionTokens),
    reasoningTokens: n(raw?.reasoningTokens),
    cachedTokens: n(raw?.cachedTokens),
    cacheWriteTokens: n(raw?.cacheWriteTokens)
  }
}

export function sameUsage(a: Usage, b: Usage): boolean {
  return (
    a.promptTokens === b.promptTokens &&
    a.completionTokens === b.completionTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.cachedTokens === b.cachedTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens
  )
}

export type FinishReason = 'stop' | 'length' | 'toolCalls' | 'contentFilter' | 'error' | 'other'

// MARK: Caché de prompts

/**
 * Cómo aprovechar la caché de prompts del proveedor (ver AICore/Types.swift `PromptCacheHint`): Anthropic con marcadores
 * `cache_control`, OpenAI con `prompt_cache_key`/puntos explícitos, OpenRouter con `session_id`; el resto, por prefijo estable.
 */
export interface PromptCacheHint {
  /** Clave estable que agrupa peticiones con el mismo prefijo. */
  key?: string
  /** ¿La siguiente petición repetirá esta y añadirá algo al final? `undefined` = sí si el historial trae resultados de herramientas. */
  reuseTail?: boolean
  /** El primer fragmento del primer mensaje del usuario es contexto compartido por muchas tareas. */
  sharedFirstUserPart?: boolean
}

export function reusesTail(hint: PromptCacheHint | undefined, messages: ChatMessage[]): boolean {
  return hint?.reuseTail ?? messages.some((m) => m.role === 'tool')
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/** Huella corta y estable (FNV-1a de 64 bits, en hexadecimal) de varios textos: clave de caché sin enviar el contenido. */
export function fingerprint(parts: string[]): string {
  let h = FNV_OFFSET
  const enc = new TextEncoder()
  for (const part of parts) {
    for (const b of enc.encode(part)) {
      h ^= BigInt(b)
      h = (h * FNV_PRIME) & MASK64
    }
    h ^= 0xffn // separador: ["ab","c"] ≠ ["a","bc"]
    h = (h * FNV_PRIME) & MASK64
  }
  return h.toString(16)
}

// MARK: Petición / respuesta

export interface ChatRequest {
  /** Vacío = el modelo configurado en el proveedor. */
  model?: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  toolChoice?: ToolChoice
  temperature?: number
  maxTokens?: number
  topP?: number
  jsonMode?: boolean
  /** 'low' | 'medium' | 'high'… (si el proveedor lo admite). Sin valor = la elección guardada del proveedor. */
  reasoningEffort?: string
  /** Tiempo máximo de la petición entera, en segundos (300 por defecto). */
  timeoutSec?: number
  /** Campos extra que se fusionan en el cuerpo JSON (un `null` quita la clave). */
  extraBody?: JSONObject
  cache?: PromptCacheHint
}

/** Lo que va llegando del proveedor. `tool_call`: `id`/`name` suelen llegar solo en el primer fragmento de cada `index`. */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; argumentsFragment: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'finished'; finish: FinishReason }

export interface ChatResponse {
  message: ChatMessage
  usage: Usage
  finish: FinishReason
}

// MARK: Agentes (bucle de herramientas o CLI) — mismo contrato que src/main/services/agents/types.ts

export interface AgentResult {
  text: string
  steps: number
  usage: Usage
  /** 'stop' | 'length' | 'max_steps' | 'timeout' | 'cancelled' | 'content_filter' */
  stopReason: string
  /** Identificador de sesión del agente CLI (para reanudar), si existe. */
  sessionID?: string
}

export type AgentEvent =
  | { type: 'started'; provider: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolStarted'; id: string; name: string; summary: string }
  | { type: 'toolFinished'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'notice'; text: string }
  | { type: 'finished'; result: AgentResult }

// MARK: Modelos

export interface ModelInfo {
  /** Identificador exacto que se manda a la API. */
  id: string
  displayName?: string
  contextLength?: number
  maxOutputTokens?: number
  /** `undefined` = la API no lo dice. */
  supportsTools?: boolean
  supportsVision?: boolean
  /** USD por millón de tokens (OpenRouter). */
  inputPricePerMillion?: number
  outputPricePerMillion?: number
  isFree: boolean
  /** Fecha de publicación (ms desde 1970), si la da la API. */
  created?: number
  /** Niveles publicados por el proveedor; `undefined` = no los declara. */
  reasoningCapabilities?: ReasoningCapabilities
}

export interface ModelCatalog {
  models: ModelInfo[]
  /** Los más usados ahora (OpenRouter «Top 10»). */
  popular: ModelInfo[]
  /** Los gratuitos más usados (OpenRouter «Top 10 gratis»). */
  free: ModelInfo[]
  /** Cuándo se pidió (ms). */
  fetchedAt: number
  /** De la API del proveedor, de la lista que trae Aula o de la CLI. */
  source: 'api' | 'known' | 'cli'
  /** Por qué no se pudo pedir a la API (si `source === 'known'`). */
  problem?: string
}
