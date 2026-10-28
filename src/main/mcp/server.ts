// Servidor MCP (Model Context Protocol) sobre stdio: un mensaje JSON por línea, sin cabeceras `Content-Length`
// (port de `AgentKit/MCP/MCPServer.swift`).
//
// Implementa `initialize` (negocia versión), `notifications/*` (incluida la cancelación), `ping`, `tools/list`, `tools/call` y listas
// vacías de recursos y prompts. Las peticiones se atienden EN PARALELO y cada respuesta lleva el `id` de su petición.
// Las herramientas pueden registrarse (`addTool`) o venir de un `ToolsProvider` dinámico (el relevo hacia la app de Aula).
import type { Readable, Writable } from 'node:stream'
import { compactJSON, isObject, str, tryParse } from '../services/agents/json'
import { LineBuffer } from '../services/agents/line-buffer'
import type { JSONObject, ToolOutput, ToolRunContext, ToolSpec, ToolsProvider } from '../services/agents/types'
import {
  INVALID_PARAMS,
  INVALID_REQUEST,
  INTERNAL_ERROR,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  line,
  negotiateVersion,
  parseArguments,
  rpcError,
  rpcResponse,
  toolDescriptor,
  toolResult,
  type RpcId
} from './protocol'

export type ToolHandler = (args: JSONObject, ctx: ToolRunContext) => Promise<ToolOutput> | ToolOutput

export interface MCPServerOptions {
  name: string
  version: string
  /** Indicaciones de uso para el agente (se envían en `initialize`). */
  instructions?: string
  /** Si se da, `tools/list` y `tools/call` se le delegan (además de las herramientas registradas con `addTool`). */
  provider?: ToolsProvider
  /** Tamaño máximo de una línea de entrada. */
  maxLineBytes?: number
  maxConcurrent?: number
}

/** Profundidad máxima de anidamiento de un mensaje (protege de entradas hostiles). */
const MAX_DEPTH = 512

function exceedsDepth(value: unknown, limit: number): boolean {
  const stack: [unknown, number][] = [[value, 1]]
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!
    if (typeof v !== 'object' || v === null) continue
    if (depth > limit) return true
    const children = Array.isArray(v) ? v : Object.values(v)
    for (const child of children) if (typeof child === 'object' && child !== null) stack.push([child, depth + 1])
  }
  return false
}

function validID(value: unknown): RpcId | undefined {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

export class MCPServer {
  private readonly order: string[] = []
  private readonly entries = new Map<string, { spec: ToolSpec; handler: ToolHandler }>()
  private readonly active = new Map<string, AbortController>()
  private readonly cancelled = new Set<string>()
  private closing = false

  constructor(private readonly options: MCPServerOptions) {}

  /** Registra (o reemplaza) una herramienta. El orden de registro es el de `tools/list`. */
  addTool(spec: ToolSpec, handler: ToolHandler): void {
    if (!this.entries.has(spec.name)) this.order.push(spec.name)
    this.entries.set(spec.name, { spec, handler })
  }

  // MARK: Bucle stdio

  /**
   * Atiende mensajes de `input` (uno por línea) y escribe las respuestas en `output` hasta EOF: termina cuando el cliente cierra
   * la entrada y las peticiones en curso han respondido, o si se aborta `signal` (las llamadas en curso se cancelan).
   */
  async run(input: Readable, output: Writable, signal?: AbortSignal): Promise<void> {
    const buffer = new LineBuffer(this.options.maxLineBytes ?? 32 * 1024 * 1024)
    const max = this.options.maxConcurrent ?? 256
    const pending = new Set<Promise<void>>()
    const write = (text: string): void => {
      if (!output.writableEnded && !output.destroyed) output.write(text + '\n')
    }
    let reportedDropped = 0
    const dispatch = async (text: string): Promise<void> => {
      while (pending.size >= max && !signal?.aborted) await Promise.race(pending)
      const job = this.handleLine(text)
        .then((reply) => {
          if (reply !== undefined && !signal?.aborted) write(reply)
        })
        .catch(() => undefined)
        .finally(() => pending.delete(job))
      pending.add(job)
    }
    const iterator = input[Symbol.asyncIterator]()
    const aborted = new Promise<'aborted'>((resolve) => {
      if (signal?.aborted) resolve('aborted')
      signal?.addEventListener('abort', () => resolve('aborted'), { once: true })
    })
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next === 'aborted') break
        if (next.done) break
        for (const text of buffer.append(next.value as Buffer)) await dispatch(text)
        if (buffer.droppedLines > reportedDropped) {
          reportedDropped = buffer.droppedLines
          write(line(rpcError(null, INVALID_REQUEST, 'Mensaje demasiado grande')))
        }
      }
    } catch {
      /* la entrada se cerró con error */
    }
    if (signal?.aborted) {
      this.closing = true
      for (const controller of this.active.values()) controller.abort()
      return
    }
    const rest = buffer.finish()
    if (rest !== undefined) await dispatch(rest)
    if (buffer.droppedLines > reportedDropped) write(line(rpcError(null, INVALID_REQUEST, 'Mensaje demasiado grande')))
    while (pending.size > 0) await Promise.all(Array.from(pending))
  }

  // MARK: Una línea

  /**
   * Procesa una línea JSON-RPC y devuelve la respuesta (una línea, sin salto final) o `undefined` si no hay que responder
   * (notificaciones, líneas vacías). Un lote (arreglo) devuelve un arreglo de respuestas.
   */
  async handleLine(text: string): Promise<string | undefined> {
    const trimmed = text.trim()
    if (!trimmed) return undefined
    const message = tryParse(trimmed)
    if (message === undefined) return line(rpcError(null, PARSE_ERROR, 'JSON inválido'))
    if (exceedsDepth(message, MAX_DEPTH)) return line(rpcError(null, INVALID_REQUEST, 'Mensaje demasiado anidado'))
    if (Array.isArray(message)) {
      if (message.length === 0) return line(rpcError(null, INVALID_REQUEST, 'Lote vacío'))
      const replies = await Promise.all(message.map((item) => this.safeProcess(item)))
      const answered = replies.filter((r) => r !== undefined)
      return answered.length > 0 ? line(answered) : undefined
    }
    const reply = await this.safeProcess(message)
    return reply === undefined ? undefined : line(reply)
  }

  private async safeProcess(message: unknown): Promise<JSONObject | undefined> {
    try {
      return await this.process(message)
    } catch (err) {
      const id = isObject(message) ? validID(message.id) ?? null : null
      return rpcError(id, INTERNAL_ERROR, err instanceof Error ? err.message : 'Error interno')
    }
  }

  // MARK: Despacho

  private async process(message: unknown): Promise<JSONObject | undefined> {
    if (!isObject(message)) return rpcError(null, INVALID_REQUEST, 'La petición debe ser un objeto JSON')
    if (message.jsonrpc !== undefined && message.jsonrpc !== '2.0') return rpcError(validID(message.id) ?? null, INVALID_REQUEST, 'Solo se admite JSON-RPC 2.0')
    const method = str(message.method)
    if (!method) {
      // respuestas del cliente a peticiones nuestras (no enviamos ninguna): se ignoran
      if (message.result !== undefined || message.error !== undefined) return undefined
      return rpcError(validID(message.id) ?? null, INVALID_REQUEST, 'Falta «method»')
    }
    const rawID = message.id
    const isNotification = rawID === undefined || rawID === null
    if (!isNotification && validID(rawID) === undefined) return rpcError(null, INVALID_REQUEST, '«id» debe ser un número o una cadena')
    const params = message.params
    if (isNotification) {
      this.handleNotification(method, params)
      return undefined
    }
    const id = rawID as RpcId
    switch (method) {
      case 'initialize':
        return rpcResponse(id, this.initializeResult(params))
      case 'ping':
        return rpcResponse(id, {})
      case 'tools/list':
        return rpcResponse(id, { tools: (await this.listTools()).map(toolDescriptor) })
      case 'tools/call':
        return this.callTool(id, params)
      case 'resources/list':
        return rpcResponse(id, { resources: [] })
      case 'resources/templates/list':
        return rpcResponse(id, { resourceTemplates: [] })
      case 'prompts/list':
        return rpcResponse(id, { prompts: [] })
      case 'resources/read':
      case 'prompts/get':
        return rpcError(id, INVALID_PARAMS, 'No existe ese recurso o prompt')
      default:
        return rpcError(id, METHOD_NOT_FOUND, `Método no encontrado: ${method}`)
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== 'notifications/cancelled') return // notifications/initialized, roots/list_changed…: sin acción
    const requestID = isObject(params) ? validID(params.requestId) : undefined
    if (requestID === undefined || requestID === null) return
    const key = compactJSON(requestID)
    if (this.cancelled.size > 1000) this.cancelled.clear()
    this.cancelled.add(key)
    this.active.get(key)?.abort()
  }

  private initializeResult(params: unknown): JSONObject {
    const requested = isObject(params) ? str(params.protocolVersion) : undefined
    const result: JSONObject = {
      protocolVersion: negotiateVersion(requested),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: this.options.name, version: this.options.version }
    }
    if (this.options.instructions) result.instructions = this.options.instructions
    return result
  }

  private async listTools(): Promise<ToolSpec[]> {
    const own = this.order.map((n) => this.entries.get(n)!.spec)
    if (!this.options.provider) return own
    const remote = await this.options.provider.list()
    // las registradas aquí tienen prioridad sobre las del proveedor con el mismo nombre
    return [...own, ...remote.filter((r) => !this.entries.has(r.name))]
  }

  private async callTool(id: RpcId, params: unknown): Promise<JSONObject | undefined> {
    const toolName = isObject(params) ? str(params.name) : undefined
    if (!toolName) return rpcError(id, INVALID_PARAMS, 'Falta «name» en tools/call')
    const entry = this.entries.get(toolName)
    if (!entry && !this.options.provider) {
      return rpcError(id, INVALID_PARAMS, `Herramienta desconocida: ${toolName}. Disponibles: ${this.order.join(', ')}`)
    }
    const args = parseArguments(isObject(params) ? params.arguments : undefined)
    if (!args) return rpcError(id, INVALID_PARAMS, '«arguments» debe ser un objeto JSON')

    const key = compactJSON(id)
    // cancelada antes de empezar: ni se ejecuta (una herramienta con permiso podría aprobarse sin que nadie oiga la respuesta)
    if (this.cancelled.delete(key)) return undefined
    const controller = new AbortController()
    this.active.set(key, controller)
    let output: ToolOutput
    try {
      const ctx: ToolRunContext = { signal: controller.signal }
      output = entry ? await entry.handler(args, ctx) : await this.options.provider!.call(toolName, args, ctx)
    } catch (err) {
      const message = controller.signal.aborted ? 'La operación se canceló.' : err instanceof Error ? err.message : String(err)
      output = { text: `Error: ${message}`, isError: true }
    } finally {
      this.active.delete(key)
    }
    // el cliente canceló la petición (o el servidor se cierra): según la especificación no se responde
    if (this.cancelled.delete(key) || controller.signal.aborted || this.closing) return undefined
    return rpcResponse(id, toolResult(output))
  }
}
