// Piezas comunes del Model Context Protocol sobre stdio: un mensaje JSON-RPC por línea (port de `AgentKit/MCP/MCPProtocol.swift`).
// Sin `electron`: lo usan el proceso principal y el ayudante `aula-mcp` (que corre con ELECTRON_RUN_AS_NODE).
import { createHash } from 'node:crypto'
import { arr, compactJSON, isObject, parseLenient, repairStrings, str } from '../services/agents/json'
import type { ImagePart, JSONObject, ToolOutput, ToolSpec } from '../services/agents/types'

/** Versiones del protocolo que sabemos hablar, de la más antigua a la más reciente. */
export const SUPPORTED_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
export const LATEST_VERSION = '2025-06-18'

/** La más alta que soportamos sin superar la pedida; si es anterior a todas (o no hay), la más reciente. */
export function negotiateVersion(requested: string | undefined | null): string {
  if (!requested) return LATEST_VERSION
  for (let i = SUPPORTED_VERSIONS.length - 1; i >= 0; i--) if (SUPPORTED_VERSIONS[i] <= requested) return SUPPORTED_VERSIONS[i]
  return LATEST_VERSION
}

// Códigos de error JSON-RPC estándar
export const PARSE_ERROR = -32700
export const INVALID_REQUEST = -32600
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

export type RpcId = number | string | null

export function rpcResponse(id: RpcId, result: unknown): JSONObject {
  return { jsonrpc: '2.0', id, result }
}

export function rpcError(id: RpcId, code: number, message: string, data?: unknown): JSONObject {
  const error: JSONObject = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

export function rpcRequest(id: number, method: string, params?: unknown): JSONObject {
  const message: JSONObject = { jsonrpc: '2.0', id, method }
  if (params !== undefined) message.params = params
  return message
}

export function rpcNotification(method: string, params?: unknown): JSONObject {
  const message: JSONObject = { jsonrpc: '2.0', method }
  if (params !== undefined) message.params = params
  return message
}

/** Una línea de JSON compacta (JSON.stringify ya escapa los saltos de línea dentro de las cadenas). */
export function line(value: unknown): string {
  return compactJSON(value)
}

// MARK: Herramientas

/** Esquema de entrada válido para un cliente MCP: siempre `type: "object"` con `properties`. */
export function normalizedInputSchema(parameters: unknown): JSONObject {
  if (!isObject(parameters)) return { type: 'object', properties: {} }
  const schema: JSONObject = { ...parameters }
  if (schema.type === undefined) schema.type = 'object'
  if (schema.type === 'object' && schema.properties === undefined) schema.properties = {}
  return schema
}

export function toolDescriptor(spec: ToolSpec): JSONObject {
  return { name: spec.name, description: spec.description, inputSchema: normalizedInputSchema(spec.inputSchema) }
}

/** `ToolOutput` → resultado de `tools/call`: `{content:[{type:"text",text},{type:"image",data,mimeType}], isError}`. */
export function toolResult(output: ToolOutput): JSONObject {
  const images = output.images ?? []
  const content: JSONObject[] = []
  if (output.text || images.length === 0) content.push({ type: 'text', text: output.text })
  for (const image of images) content.push({ type: 'image', data: image.base64, mimeType: image.mediaType })
  return { content, isError: !!output.isError }
}

/** Resultado de `tools/call` → `ToolOutput` (texto unido, imágenes, `isError`). */
export function toolOutputFromResult(result: unknown): ToolOutput {
  const texts: string[] = []
  const images: ImagePart[] = []
  const r = isObject(result) ? result : {}
  for (const item of arr(r.content) ?? []) {
    if (!isObject(item)) continue
    switch (item.type) {
      case 'text': {
        const text = str(item.text)
        if (text !== undefined) texts.push(text)
        break
      }
      case 'image': {
        const data = str(item.data)
        if (data !== undefined) images.push({ mediaType: str(item.mimeType) ?? 'image/png', base64: data })
        break
      }
      case 'resource': {
        const resource = isObject(item.resource) ? item.resource : {}
        const text = str(resource.text)
        const uri = str(resource.uri)
        if (text !== undefined) texts.push(text)
        else if (uri !== undefined) texts.push(`[recurso: ${uri}]`)
        break
      }
      case 'resource_link': {
        const uri = str(item.uri)
        if (uri !== undefined) texts.push(`[recurso: ${uri}]`)
        break
      }
    }
  }
  if (texts.length === 0 && images.length === 0 && r.structuredContent !== undefined && r.structuredContent !== null) {
    texts.push(compactJSON(r.structuredContent))
  }
  return { text: texts.join('\n'), images, isError: r.isError === true }
}

// MARK: Argumentos

/**
 * Interpreta `arguments` de un `tools/call`: objeto, `null`/ausente (→ `{}`) o cadena con JSON (se repara). Devuelve
 * `undefined` si no es un objeto. Las cadenas con LaTeX mal escapado (`\f` + «rac») recuperan su barra.
 */
export function parseArguments(raw: unknown): JSONObject | undefined {
  if (raw === undefined || raw === null) return {}
  if (isObject(raw)) return repairStrings(raw) as JSONObject
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return {}
    try {
      const parsed = parseLenient(trimmed)
      return isObject(parsed) ? (repairStrings(parsed) as JSONObject) : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

// MARK: Nombres

/** Sustituye por `_` todo carácter fuera de `[A-Za-z0-9_-]` (así normalizan los nombres Claude Code y OpenCode). */
export function sanitizeName(name: string): string {
  const out = Array.from(name).map((c) => (/^[A-Za-z0-9_-]$/.test(c) ? c : '_')).join('')
  return out || '_'
}

/** Nombre de función válido para las APIs de modelos (`^[a-zA-Z0-9_-]{1,64}$`); recorta con un sufijo de huella. */
export function functionName(raw: string, limit = 64): string {
  const clean = sanitizeName(raw)
  if (clean.length <= limit) return clean
  const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 6)
  return clean.slice(0, limit - 7) + '_' + suffix
}
