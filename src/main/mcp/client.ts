// Cliente MCP para usar servidores externos (p. ej. uno de Canvas) con los proveedores de API (port de `AgentKit/MCP/MCPClient.swift`).
//
// Lanza el servidor como proceso hijo (con el entorno completo del usuario), hace el `initialize`, lista y llama herramientas y
// se RECONECTA solo si el servidor murió entre dos llamadas. Si muere en mitad de una llamada, esa llamada falla con el motivo
// (final de stderr incluido): no se repite porque la herramienta pudo tener efectos.
import { randomBytes } from 'node:crypto'
import { tr } from '@shared/ai/i18n'
import { AgentError, AgentL10n, CancelledError, isCancellation } from '../services/agents/errors'
import { arr, int, isObject, str, tryParse } from '../services/agents/json'
import type { JSONObject, MCPServerSpec, RelayableTool, ToolOutput, ToolRunContext, ToolSpec } from '../services/agents/types'
import {
  LATEST_VERSION,
  METHOD_NOT_FOUND,
  functionName,
  line,
  normalizedInputSchema,
  rpcError,
  rpcNotification,
  rpcRequest,
  rpcResponse,
  toolOutputFromResult,
  type RpcId
} from './protocol'
import { ProcessMCPTransport, type MCPTransport } from './transport'

/** «El servidor MCP «x» se detuvo.» en el idioma de la interfaz. */
function stoppedText(name: string): string {
  return tr(`El servidor MCP «${name}» se detuvo.`, `The MCP server “${name}” stopped.`)
}

export interface MCPClientOptions {
  /** Tiempo máximo para completar `initialize` (ms). */
  startupTimeoutMs?: number
  /** Tiempo máximo de cada llamada (`tools/list`, `tools/call`) (ms). */
  callTimeoutMs?: number
  /** Transporte propio (pruebas: flujos conectados a un `MCPServer` en el mismo proceso). */
  transport?: () => MCPTransport | Promise<MCPTransport>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  timer?: NodeJS.Timeout
}

/** Una conexión concreta con el servidor (una instancia del proceso). */
class Session {
  private nextID = 1
  private readonly pending = new Map<number, Pending>()
  alive = true
  reason?: AgentError
  toolsStale = false

  constructor(
    readonly transport: MCPTransport,
    readonly serverName: string
  ) {}

  allocateID(): number {
    return this.nextID++
  }

  register(id: number, p: Pending): boolean {
    if (!this.alive) return false
    this.pending.set(id, p)
    return true
  }

  attachTimer(id: number, timer: NodeJS.Timeout): void {
    const entry = this.pending.get(id)
    if (entry) entry.timer = timer
    else clearTimeout(timer)
  }

  send(message: unknown): boolean {
    if (!this.alive) return false
    return this.transport.send(typeof message === 'string' ? message : line(message))
  }

  complete(id: number, result: unknown): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    entry.resolve(result)
    return true
  }

  fail(id: number, error: unknown): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    entry.reject(error)
    return true
  }

  /** Cierra la sesión: falla todas las peticiones pendientes y detiene el servidor. */
  close(reason: AgentError): void {
    if (!this.alive) return
    this.alive = false
    this.reason = reason
    const all = Array.from(this.pending.values())
    this.pending.clear()
    for (const entry of all) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(reason)
    }
    this.transport.close()
  }

  startReading(): void {
    this.transport.start(
      (l) => this.handleIncoming(l),
      () => {
        if (!this.alive) return
        void this.transport.diagnostics().then((detail) => {
          const name = this.serverName
          const message = detail
            ? tr(`El servidor MCP «${name}» se cerró inesperadamente: ${detail}`, `The MCP server “${name}” closed unexpectedly: ${detail}`)
            : tr(`El servidor MCP «${name}» se cerró inesperadamente.`, `The MCP server “${name}” closed unexpectedly.`)
          this.close(new AgentError('network', message))
        })
      }
    )
  }

  private handleIncoming(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const message = tryParse(trimmed)
    if (message === undefined) return // ruido en stdout
    if (Array.isArray(message)) for (const item of message) this.handle(item)
    else this.handle(message)
  }

  private handle(message: unknown): void {
    if (!isObject(message)) return
    const method = str(message.method)
    if (method) {
      const rawID = message.id
      if (rawID !== undefined && rawID !== null) this.respondToServerRequest(rawID as RpcId, method)
      else if (method === 'notifications/tools/list_changed') this.toolsStale = true
      return
    }
    const id = int(message.id)
    if (id === undefined) return // sin id numérico no es respuesta a nada nuestro
    if (message.error !== undefined && message.error !== null) {
      const code = int((message.error as JSONObject).code) ?? 0
      const text = str((message.error as JSONObject).message) ?? 'error desconocido'
      this.fail(id, new AgentError('badResponse', tr(`El servidor MCP «${this.serverName}» respondió con un error (${code}): ${text}`, `The MCP server “${this.serverName}” answered with an error (${code}): ${text}`)))
    } else {
      this.complete(id, message.result ?? {})
    }
  }

  /** Peticiones del servidor: `ping` y `roots/list` se contestan; el resto (muestreo, elicitación…) no se soporta. */
  private respondToServerRequest(id: RpcId, method: string): void {
    if (method === 'ping') this.send(rpcResponse(id, {}))
    else if (method === 'roots/list') this.send(rpcResponse(id, { roots: [] }))
    else this.send(rpcError(id, METHOD_NOT_FOUND, `Método no soportado por el cliente: ${method}`))
  }
}

export class MCPClient {
  private session?: Session
  private starting?: Promise<Session>
  /** Conexiones que aún están en el `initialize` (un `stop()` también las corta). */
  private readonly opening = new Set<Session>()
  private generation = 0
  private readonly startupTimeoutMs: number
  private readonly callTimeoutMs: number
  private readonly makeTransport: () => MCPTransport | Promise<MCPTransport>

  constructor(
    readonly spec: MCPServerSpec,
    options: MCPClientOptions = {}
  ) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000
    this.callTimeoutMs = options.callTimeoutMs ?? 120_000
    this.makeTransport = options.transport ?? (() => ProcessMCPTransport.create(spec))
  }

  /** Arranca el servidor y completa el `initialize`. Idempotente. */
  async start(): Promise<void> {
    await this.ensureSession()
  }

  /** Herramientas que ofrece el servidor (sigue la paginación `nextCursor`). */
  async tools(signal?: AbortSignal): Promise<ToolSpec[]> {
    const session = await this.ensureSession()
    let cursor: string | undefined
    const result: ToolSpec[] = []
    for (let page = 0; page < 50; page++) {
      const reply = await this.request(session, 'tools/list', cursor ? { cursor } : undefined, this.callTimeoutMs, signal)
      for (const item of arr((reply as JSONObject)?.tools) ?? []) {
        if (!isObject(item)) continue
        const name = str(item.name)
        if (!name) continue
        result.push({ name, description: str(item.description) ?? str(item.title) ?? '', inputSchema: normalizedInputSchema(item.inputSchema) })
      }
      const next = str((reply as JSONObject)?.nextCursor)
      if (!next) break
      cursor = next
    }
    session.toolsStale = false
    return result
  }

  /** Llama a una herramienta. Un error de la herramienta (`isError`) NO lanza: vuelve en `ToolOutput.isError`. */
  async call(name: string, args: JSONObject | null | undefined, signal?: AbortSignal): Promise<ToolOutput> {
    const session = await this.ensureSession()
    const reply = await this.request(session, 'tools/call', { name, arguments: args ?? {} }, this.callTimeoutMs, signal)
    return toolOutputFromResult(reply)
  }

  /** Detiene el servidor (cierra su entrada y luego SIGTERM/SIGKILL al grupo). Se puede volver a usar: reconecta. */
  stop(): void {
    this.generation += 1
    const current = this.session
    this.session = undefined
    this.starting = undefined
    current?.close(new AgentError('cancelled', stoppedText(this.spec.name)))
    for (const pending of Array.from(this.opening)) pending.close(new AgentError('cancelled', stoppedText(this.spec.name)))
    this.opening.clear()
  }

  /**
   * Cada herramienta del servidor con la forma de la capa de IA (`{name, description, inputSchema, run}`), con nombre
   * `prefijo__herramienta` válido como nombre de función. Con `fenced` (por defecto) el texto de un servidor externo llega a la
   * IA dentro de una valla «no confiable»: es dato, nunca orden.
   */
  async agentTools(options: { prefix?: string; fenced?: boolean } = {}): Promise<RelayableTool[]> {
    const specs = await this.tools()
    const base = options.prefix ?? this.spec.name
    const fenced = options.fenced ?? true
    const used = new Set<string>()
    const tools: RelayableTool[] = []
    for (const tool of specs) {
      let exposed = functionName(`${base}__${tool.name}`)
      let suffix = 2
      while (used.has(exposed)) exposed = functionName(`${base}__${tool.name}_${suffix++}`)
      used.add(exposed)
      const original = tool.name
      const source = 'mcp:' + this.spec.name
      tools.push({
        name: exposed,
        description: tool.description,
        inputSchema: tool.inputSchema,
        run: async (args: JSONObject, ctx: ToolRunContext): Promise<ToolOutput> => {
          const out = await this.call(original, args, ctx?.signal)
          if (!fenced || !out.text) return out
          return { ...out, text: wrapUntrusted(out.text, source, [['tool', original]]) }
        }
      })
    }
    return tools
  }

  // MARK: Conexión

  private async ensureSession(): Promise<Session> {
    if (this.session?.alive) return this.session
    if (!this.starting) {
      const generation = this.generation
      const starting = this.openSession().then(
        (opened) => {
          if (generation !== this.generation) {
            // un stop() retiró este arranque: nunca se toca una conexión más nueva
            opened.close(new AgentError('cancelled', stoppedText(this.spec.name)))
            throw new CancelledError()
          }
          this.session = opened
          if (this.starting === starting) this.starting = undefined
          return opened
        },
        (err: unknown) => {
          if (this.starting === starting) this.starting = undefined
          throw err
        }
      )
      this.starting = starting
    }
    return this.starting
  }

  private async openSession(): Promise<Session> {
    let transport: MCPTransport
    try {
      transport = await this.makeTransport()
    } catch (err) {
      if (err instanceof AgentError) throw err
      throw new AgentError('other', AgentL10n.mcpCouldNotStart(this.spec.name, err instanceof Error ? err.message : String(err)))
    }
    const session = new Session(transport, this.spec.name)
    this.opening.add(session)
    session.startReading()
    try {
      await this.request(session, 'initialize', { protocolVersion: LATEST_VERSION, capabilities: {}, clientInfo: { name: 'Aula', version: '2.0' } }, this.startupTimeoutMs)
      session.send(rpcNotification('notifications/initialized'))
      this.opening.delete(session)
      return session
    } catch (err) {
      this.opening.delete(session)
      if (isCancellation(err)) {
        session.close(new AgentError('cancelled', stoppedText(this.spec.name)))
        throw err
      }
      const detail = await transport.diagnostics()
      session.close(new AgentError('other', tr(`El servidor MCP «${this.spec.name}» no se inició.`, `The MCP server “${this.spec.name}” didn’t start.`)))
      const suffix = detail ? ' ' + AgentL10n.detail(detail) : ''
      if (err instanceof AgentError && (err.kind === 'timeout' || err.kind === 'cancelled')) throw new AgentError(err.kind, err.message + suffix)
      const reason = err instanceof Error ? err.message : String(err)
      throw new AgentError('other', tr(`El servidor MCP «${this.spec.name}» falló al iniciarse: ${reason}${suffix}`, `The MCP server “${this.spec.name}” failed to start: ${reason}${suffix}`))
    }
  }

  // MARK: Peticiones

  private request(session: Session, method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = session.allocateID()
      const name = this.spec.name
      if (signal?.aborted) {
        reject(new CancelledError())
        return
      }
      const onAbort = (): void => {
        if (session.fail(id, new CancelledError())) session.send(rpcNotification('notifications/cancelled', { requestId: id, reason: 'cancelled' }))
      }
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
      const registered = session.register(id, {
        resolve: (v) => {
          cleanup()
          resolve(v)
        },
        reject: (e) => {
          cleanup()
          reject(e)
        }
      })
      if (!registered) {
        reject(session.reason ?? new AgentError('other', AgentL10n.mcpNotConnected(name)))
        return
      }
      const timer = setTimeout(() => {
        const seconds = String(Math.round(timeoutMs / 1000))
        if (session.fail(id, new AgentError('timeout', tr(`El servidor MCP «${name}» no respondió a «${method}» en ${seconds} s.`, `The MCP server “${name}” didn’t answer “${method}” within ${seconds} s.`)))) {
          session.send(rpcNotification('notifications/cancelled', { requestId: id, reason: 'timeout' }))
        }
      }, Math.max(1, timeoutMs))
      session.attachTimer(id, timer)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (!session.send(rpcRequest(id, method, params))) session.fail(id, session.reason ?? new AgentError('other', AgentL10n.mcpNotConnected(name)))
    })
  }
}

// MARK: Valla de contenido no confiable

export const UNTRUSTED_OPEN = '<<<CONTENIDO_NO_CONFIABLE'
export const UNTRUSTED_CLOSE = '<<<FIN_CONTENIDO_NO_CONFIABLE'

/** Parte cada racha de 3 o más `<` o `>` en trozos de 2 separados por espacios, que nunca forman un marcador. */
export function breakMarkers(text: string): string {
  if (!text.includes('<<<') && !text.includes('>>>')) return text
  return text.replace(/<{3,}|>{3,}/g, (run) => {
    const c = run[0]
    const pairs = Array(Math.floor(run.length / 2)).fill(c + c)
    const odd = run.length % 2 === 1
    return (c === '<' ? [...(odd ? ['<'] : []), ...pairs] : [...pairs, ...(odd ? ['>'] : [])]).join(' ')
  })
}

function headerValue(value: string): string {
  const flat = value.replace(/[\s\p{Cc}]/gu, '%20')
  return breakMarkers(flat).replace(/>/g, '%3E').replace(/</g, '%3C').slice(0, 600)
}

/** Envuelve `text` en la valla anti-inyección con un id aleatorio (port de `UntrustedFence.wrap`). */
export function wrapUntrusted(text: string, source: string, fields: [string, string][] = []): string {
  const id = randomBytes(8).toString('hex')
  let header = `${UNTRUSTED_OPEN} id=${id}`
  if (source) header += ` fuente=${headerValue(source)}`
  for (const [key, value] of fields) if (value) header += ` ${headerValue(key)}=${headerValue(value)}`
  return `${header}>>>\n${breakMarkers(text)}\n${UNTRUSTED_CLOSE} id=${id}>>>`
}
