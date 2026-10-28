// Agente que usa la suscripción de Claude lanzando la CLI oficial (`claude -p --output-format stream-json --verbose`)
// (port de `AgentKit/CLI/{ClaudeCodeRunner,ClaudeStreamParser}.swift`).
//
// Seguridad: el agente solo dispone de las herramientas MCP de la tarea y, si `allowWeb`, de WebSearch/WebFetch:
//  - `--tools` (solo esas integradas; `""` las desactiva todas), `--allowedTools` y `--disallowedTools`;
//  - `--permission-mode dontAsk` (lo no autorizado se deniega, nunca se pregunta) y `--permission-prompts none`;
//  - `--strict-mcp-config` (ignora los servidores MCP del usuario) y `--setting-sources user`;
//  - un directorio de trabajo vacío y sin persistir la sesión.
// Además, si en el flujo aparece una herramienta peligrosa disponible o ejecutada, se detiene el proceso.
import { tr } from '@shared/ai/i18n'
import { sanitizeName } from '../../mcp/protocol'
import { AgentError, AgentL10n, CLIErrorClassifier, droppableFlag, type AgentErrorKind, type RateLimitInfo } from './errors'
import {
  eventStream,
  prefixChars,
  runCLI,
  step,
  stripMCPPrefix,
  summarizeArguments,
  summarizeResult,
  truncate,
  type CLIConclusion,
  type CLIEventParser,
  type CLIFailure,
  type CLIInvocation,
  type CLIParseStep
} from './engine'
import { arr, asText, bool, compactJSON, get, int, isObject, num, parseLenient, str, tryParse } from './json'
import { childEnvironment, findExecutable, prepareLocator } from './locator'
import { claudeMCPConfig } from './mcp-config'
import { AgentSandbox } from './sandbox'
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  emptyUsage,
  fullPrompt,
  type AgentEvent,
  type AgentRunner,
  type AgentTask,
  type CLIAgentConfig,
  type JSONObject,
  type Usage
} from './types'

const isWindows = process.platform === 'win32'

// MARK: Política de herramientas

/** Herramientas integradas que ejecutan comandos, tocan archivos o lanzan subagentes: nunca deben estar disponibles. */
export const CLAUDE_DANGEROUS_BUILTINS = new Set([
  'Bash', 'BashOutput', 'KillShell', 'KillBash', 'PowerShell', 'REPL', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead',
  'Read', 'Glob', 'Grep', 'LS', 'Task', 'Agent', 'Skill', 'SlashCommand'
])

/** Las que se deniegan explícitamente con `--disallowedTools` (defensa en profundidad además de `--tools`). */
export const CLAUDE_DENIED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'PowerShell', 'REPL', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS',
  'Task', 'Agent', 'Skill', 'SlashCommand'
]

export const CLAUDE_WEB_TOOLS = ['WebSearch', 'WebFetch']

/** Integradas que no hacen nada fuera de la conversación (listas de tareas, buscar herramientas, leer recursos MCP). */
export const CLAUDE_HARMLESS_BUILTINS = new Set([
  'ToolSearch', 'TodoWrite', 'TodoRead', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'StructuredOutput'
])

/**
 * Lista BLANCA (J3-9): solo las herramientas MCP de la tarea (`mcp__<servidor>__…`), las web si se permiten y unas pocas
 * integradas inofensivas. Cualquier otra (Bash, Monitor, Workflow, EnterWorktree… o una que salga en una CLI nueva) es una
 * violación: la defensa principal es `--tools ""`, esto es la segunda capa si una CLI vieja o distinta la ignora.
 */
export function claudeToolAllowed(name: string, serverNames: readonly string[], allowWeb: boolean): boolean {
  if (serverNames.some((s) => name.startsWith(`mcp__${s}__`))) return true
  if (CLAUDE_WEB_TOOLS.includes(name)) return allowWeb
  return CLAUDE_HARMLESS_BUILTINS.has(name)
}

// MARK: Analizador

/**
 * Sin red (ECONNREFUSED, DNS, sin conexión) la CLI reintenta hasta 10 veces con esperas crecientes: más de 3 minutos por agente
 * antes de rendirse. Esos reintentos llegan como `system/api_retry` SIN código HTTP (`error_status: null`):
 *  - si fallan al instante (cada uno llega antes de la espera anunciada más un margen), no hay red: a los 4 se para la CLI;
 *  - si cada intento tarda (la red no contesta, la API no responde), se para cuando ya van 3 y más de 5 minutos.
 */
export const CONNECTION_RETRY_POLICY = { fastAttempts: 4, fastSlackMs: 15_000, slowAttempts: 3, slowWindowMs: 5 * 60_000 }

/** El texto del fallo de conexión que se detecta antes de que la CLI se rinda (lo reconoce `isNetworkFailure`). */
export function connectionFailureMessage(attempts: number): string {
  return `API Error: no connection to the Claude API (no response after ${attempts} attempts: the network is down, the address can't be resolved or the connection is refused)`
}

/** Cuando cada intento tarda minutos: la API no contesta (no se sabe si hay red). */
export function slowConnectionMessage(attempts: number, minutes: number): string {
  return `API Error: the Claude API did not answer (${attempts} attempts in ${minutes} min)`
}

interface Block {
  type: string
  toolID?: string
  toolName?: string
  inputJSON: string
}

interface ResultInfo {
  subtype: string
  isError: boolean
  text?: string
  turns: number
  usage: Usage
  sessionID?: string
  errors: string[]
  stopReason?: string
}

/**
 * Analiza `claude -p --output-format stream-json --verbose --include-partial-messages`, una línea JSON por evento:
 *  - `system/init` → `started` (modelo, herramientas, estado de los servidores MCP);
 *  - `stream_event` con eventos de la API de mensajes (`text_delta`, `thinking_delta`, `input_json_delta`);
 *  - `assistant` (instantánea de cada bloque: repite lo ya enviado en los deltas) y `user` (`tool_result`);
 *  - `result` (`subtype`, `is_error`, `result`, `num_turns`, `usage`, `session_id`); `rate_limit_event`, `system/api_retry`…
 */
export class ClaudeStreamParser implements CLIEventParser {
  private sessionID?: string
  private model?: string
  private readonly partialMessageIDs = new Set<string>()
  private blocks = new Map<number, Block>()
  private emittedText = false
  private pendingSeparator = false
  private lastAssistantText = ''
  private readonly startedTools = new Map<string, string>()
  private readonly suspectToolIDs = new Set<string>()
  private result?: ResultInfo
  private assistantFailure?: { message: string; kind?: AgentErrorKind }
  private rateLimit?: RateLimitInfo
  private warnedAboutLimit = false
  private readonly unparsed: string[] = []
  private lastRetryNotice = 0
  private lastRetry?: { attempt: number; maxRetries?: number; status?: number; error: string }
  /** Reintentos seguidos sin respuesta HTTP: cuántos, cuándo el primero y el último, la espera anunciada y si alguno tardó. */
  private connectionRetries = 0
  private connectionFirstAt = 0
  private connectionLastAt = 0
  private connectionLastDelay = 0
  private connectionSlow = false
  private connectionFailure?: CLIFailure

  constructor(
    readonly providerName: string,
    readonly requestedModel: string,
    /** Nombres de servidor MCP ya normalizados (para quitar `mcp__servidor__`). */
    readonly serverNames: string[],
    /** Reloj (ms) para las pruebas. */
    private readonly clock: () => number = Date.now,
    /** ¿La tarea permite WebSearch/WebFetch? (por defecto, no) */
    readonly allowWeb = false
  ) {}

  get unparsedSample(): string {
    return this.unparsed.join('\n')
  }

  consume(line: string): CLIParseStep {
    const trimmed = line.trim()
    if (!trimmed) return step()
    const json = trimmed.startsWith('{') ? tryParse(trimmed) : undefined
    if (!isObject(json)) {
      if (this.unparsed.length < 8) this.unparsed.push(prefixChars(trimmed, 300))
      return step()
    }
    // mensajes de subagentes: no esperamos ninguno, se ignoran
    if (json.parent_tool_use_id !== undefined && json.parent_tool_use_id !== null) return step()
    const s = step()
    switch (json.type) {
      case 'system':
        this.consumeSystem(json, s)
        break
      case 'stream_event':
        this.consumeStreamEvent(json.event, s)
        break
      case 'assistant':
        this.consumeAssistant(json, s)
        break
      case 'user':
        this.consumeUser(json, s)
        break
      case 'result':
        this.consumeResult(json, s)
        break
      case 'rate_limit_event':
        this.consumeRateLimit(json.rate_limit_info, s)
        break
    }
    return s
  }

  private consumeSystem(json: JSONObject, s: CLIParseStep): void {
    if (json.subtype === 'init') {
      this.sessionID = str(json.session_id) ?? this.sessionID
      this.model = str(json.model)
      const tools = (arr(json.tools) ?? []).filter((t): t is string => typeof t === 'string')
      const dangerous = tools.filter((t) => !claudeToolAllowed(t, this.serverNames, this.allowWeb))
      if (dangerous.length > 0) {
        const list = dangerous.sort().join(', ')
        s.violation = tr(
          `Claude Code expuso herramientas que pueden ejecutar comandos o editar archivos (${list}). Se detuvo la ejecución por seguridad.`,
          `Claude Code exposed tools that can run commands or edit files (${list}). The run was stopped for security.`
        )
      }
      const model = this.model ? this.model : this.requestedModel || AgentL10n.defaultModel
      s.events.push({ type: 'started', provider: this.providerName, model })
      for (const server of arr(json.mcp_servers) ?? []) {
        const status = str(get(server, 'status')) ?? ''
        if (status && status !== 'connected') {
          const name = str(get(server, 'name')) ?? '?'
          s.events.push({ type: 'notice', text: tr(`El servidor MCP «${name}» no se pudo conectar (${status}). El agente no tendrá sus herramientas.`, `The MCP server “${name}” couldn’t connect (${status}). The agent won’t have its tools.`) })
        }
      }
    } else if (json.subtype === 'api_retry') {
      const attempt = int(json.attempt) ?? 0
      const status = int(json.error_status)
      const reason = str(json.error) ?? ''
      const max = int(json.max_retries)
      this.lastRetry = { attempt, maxRetries: max, status, error: reason }
      if (this.noteConnectionRetry(status, reason, int(json.retry_delay_ms) ?? 0, s)) return
      if (attempt > this.lastRetryNotice || attempt === 0) {
        this.lastRetryNotice = attempt
        const total = max !== undefined ? String(max) : '?'
        let text: string
        if (status === 429 || reason === 'rate_limit') text = tr(`Claude limita las peticiones ahora mismo (429); la CLI reintenta (${attempt} de ${total})…`, `Claude is limiting requests right now (429); the CLI is retrying (${attempt} of ${total})…`)
        else if (status === 529 || reason.includes('overloaded')) text = tr(`Claude está saturado (529); la CLI reintenta (${attempt} de ${total})…`, `Claude is overloaded (529); the CLI is retrying (${attempt} of ${total})…`)
        else if (max !== undefined) text = tr(`Reintentando la conexión con Claude (intento ${attempt} de ${max})…`, `Retrying the connection to Claude (attempt ${attempt} of ${max})…`)
        else text = tr(`Reintentando la conexión con Claude (intento ${attempt})…`, `Retrying the connection to Claude (attempt ${attempt})…`)
        s.events.push({ type: 'notice', text })
      }
    }
  }

  /** Cuenta los reintentos sin respuesta HTTP; al pasar el límite corta la CLI (`stopNow`) con un fallo de red o de espera. */
  private noteConnectionRetry(status: number | undefined, reason: string, delayMs: number, s: CLIParseStep): boolean {
    // con código HTTP (o un motivo de la API: límite, saturación, sesión) sí hubo respuesta: no es un problema de red
    if (status !== undefined || /rate_limit|overloaded|authentication|billing|invalid_request/.test(reason)) {
      this.connectionRetries = 0
      return false
    }
    const p = CONNECTION_RETRY_POLICY
    const now = this.clock()
    if (this.connectionRetries === 0) {
      this.connectionFirstAt = now
      this.connectionSlow = false
    } else if (now - this.connectionLastAt > this.connectionLastDelay + p.fastSlackMs) {
      this.connectionSlow = true
    }
    this.connectionRetries += 1
    this.connectionLastAt = now
    this.connectionLastDelay = Math.max(0, delayMs)
    const n = this.connectionRetries
    if (!this.connectionSlow && n >= p.fastAttempts) {
      this.connectionFailure = { message: connectionFailureMessage(n), kind: 'network' }
      s.events.push({ type: 'notice', text: tr('No hay conexión con Claude: se deja de esperar.', 'No connection to Claude: giving up waiting.') })
    } else if (n >= p.slowAttempts && now - this.connectionFirstAt >= p.slowWindowMs) {
      this.connectionFailure = { message: slowConnectionMessage(n, Math.round((now - this.connectionFirstAt) / 60_000)), kind: 'timeout' }
      s.events.push({ type: 'notice', text: tr('Claude no contesta: se deja de esperar.', "Claude isn't answering: giving up waiting.") })
    } else return false
    s.stopNow = true
    return true
  }

  private consumeStreamEvent(event: unknown, s: CLIParseStep): void {
    if (!isObject(event)) return
    switch (event.type) {
      case 'message_start': {
        const id = str(get(event, 'message', 'id'))
        if (id) this.partialMessageIDs.add(id)
        this.blocks = new Map()
        break
      }
      case 'content_block_start': {
        const index = int(event.index)
        const block = event.content_block
        if (index === undefined || !isObject(block)) return
        const type = str(block.type) ?? ''
        this.blocks.set(index, { type, toolID: str(block.id), toolName: str(block.name), inputJSON: '' })
        if (type === 'text' && this.emittedText) this.pendingSeparator = true
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (!isObject(delta)) return
        const index = int(event.index) ?? -1
        if (delta.type === 'text_delta') {
          const text = str(delta.text)
          if (text) this.appendText(text, s)
        } else if (delta.type === 'thinking_delta') {
          const text = str(delta.thinking)
          if (text) s.events.push({ type: 'reasoning', text })
        } else if (delta.type === 'input_json_delta') {
          const fragment = str(delta.partial_json)
          const block = this.blocks.get(index)
          if (fragment !== undefined && block) block.inputJSON += fragment
        }
        break
      }
      case 'content_block_stop': {
        const index = int(event.index)
        const block = index !== undefined ? this.blocks.get(index) : undefined
        if (!block || block.type !== 'tool_use' || !block.toolID || !block.toolName) return
        const raw = block.inputJSON.trim()
        let input: unknown = {}
        if (raw) {
          try {
            input = parseLenient(raw)
          } catch {
            input = {}
          }
        }
        this.startTool(block.toolID, block.toolName, input, s)
        break
      }
    }
  }

  private appendText(text: string, s: CLIParseStep): void {
    if (this.pendingSeparator) {
      this.pendingSeparator = false
      s.events.push({ type: 'text', text: '\n\n' })
    }
    this.emittedText = true
    s.events.push({ type: 'text', text })
  }

  private consumeAssistant(json: JSONObject, s: CLIParseStep): void {
    const message = json.message
    if (!isObject(message)) return
    const content = arr(message.content) ?? []
    const combinedText = content.map((b) => (get(b, 'type') === 'text' ? str(get(b, 'text')) ?? '' : '')).join('')
    const error = str(json.error)
    if (error) {
      // mensaje sintético con un error de la API («Not logged in», límite de uso…): no es texto del asistente
      let kind: AgentErrorKind | undefined
      if (error === 'authentication_failed') kind = 'notLoggedIn'
      else if (error === 'rate_limit') kind = 'rateLimited'
      else if (error === 'invalid_request') kind = 'badResponse'
      else if (error === 'server_error' || error === 'unknown' || error === 'billing_error') kind = 'http'
      this.assistantFailure = { message: combinedText || error, kind }
      return
    }
    const id = str(message.id)
    const streamed = id !== undefined && this.partialMessageIDs.has(id)
    for (const block of content) {
      if (!isObject(block)) continue
      if (block.type === 'text') {
        const text = str(block.text)
        if (text) {
          this.lastAssistantText = text
          if (!streamed) {
            if (this.emittedText) this.pendingSeparator = true
            this.appendText(text, s)
          }
        }
      } else if (block.type === 'thinking') {
        const text = str(block.thinking)
        if (!streamed && text) s.events.push({ type: 'reasoning', text })
      } else if (block.type === 'tool_use') {
        const toolID = str(block.id)
        const name = str(block.name)
        if (toolID && name) this.startTool(toolID, name, block.input ?? {}, s)
      }
    }
  }

  private startTool(id: string, rawName: string, input: unknown, s: CLIParseStep): void {
    if (this.startedTools.has(id)) return
    const name = stripMCPPrefix(rawName, this.serverNames)
    this.startedTools.set(id, name)
    if (CLAUDE_DANGEROUS_BUILTINS.has(rawName) || !claudeToolAllowed(rawName, this.serverNames, this.allowWeb)) this.suspectToolIDs.add(id)
    let summary: string
    if (rawName === 'WebSearch') summary = truncate(asText(get(input, 'query')), 120)
    else if (rawName === 'WebFetch') summary = truncate(asText(get(input, 'url')), 120)
    else summary = summarizeArguments(input)
    s.events.push({ type: 'toolStarted', id, name, summary })
  }

  private consumeUser(json: JSONObject, s: CLIParseStep): void {
    const content = arr(get(json, 'message', 'content'))
    if (!content) return
    for (const block of content) {
      if (!isObject(block) || block.type !== 'tool_result') continue
      const id = str(block.tool_use_id)
      if (!id) continue
      const isError = bool(block.is_error) ?? false
      const text = claudeResultText(block.content)
      if (this.suspectToolIDs.has(id) && !isError) {
        const tool = this.startedTools.get(id) ?? '?'
        s.violation = tr(`Claude Code ejecutó una herramienta que no está permitida (${tool}). Se detuvo la ejecución por seguridad.`, `Claude Code ran a tool that isn’t allowed (${tool}). The run was stopped for security.`)
      }
      s.events.push({ type: 'toolFinished', id, name: this.startedTools.get(id) ?? AgentL10n.unknownTool, ok: !isError, summary: summarizeResult(text) })
    }
  }

  private consumeResult(json: JSONObject, s: CLIParseStep): void {
    const denials = (arr(json.permission_denials) ?? []).map((d) => str(get(d, 'tool_name'))).filter((n): n is string => !!n)
    this.result = {
      subtype: str(json.subtype) ?? '',
      isError: bool(json.is_error) ?? false,
      text: str(json.result),
      turns: int(json.num_turns) ?? 0,
      usage: claudeUsage(json.usage),
      sessionID: str(json.session_id),
      errors: (arr(json.errors) ?? []).filter((e): e is string => typeof e === 'string'),
      stopReason: str(json.stop_reason)
    }
    if (denials.length > 0) {
      const list = Array.from(new Set(denials)).sort().join(', ')
      s.events.push({ type: 'notice', text: tr(`El agente intentó usar herramientas no permitidas (${list}) y se bloquearon.`, `The agent tried to use tools that aren’t allowed (${list}), and they were blocked.`) })
    }
    s.isTerminal = true
  }

  private consumeRateLimit(rateInfo: unknown, s: CLIParseStep): void {
    if (!isObject(rateInfo)) return
    if (rateInfo.status === 'rejected') {
      const resets = num(rateInfo.resetsAt)
      if (resets !== undefined) this.rateLimit = { retryAfter: Math.max(0, resets - Date.now() / 1000), resetDate: resets * 1000 }
    } else if (rateInfo.status === 'allowed_warning') {
      if (!this.warnedAboutLimit) {
        this.warnedAboutLimit = true
        s.events.push({ type: 'notice', text: tr('Estás cerca del límite de uso de tu suscripción de Claude.', 'You’re close to the usage limit of your Claude subscription.') })
      }
    }
  }

  /** Si la CLI se quedó reintentando (429, sin sesión, saturado), el motivo; un `rate_limit_event` rechazado manda. */
  stallFailure(): CLIFailure | undefined {
    if (this.rateLimit?.retryAfter !== undefined) return { message: 'rate_limit_event: rejected', kind: 'rateLimited', retryAfter: this.rateLimit.retryAfter }
    const retry = this.lastRetry
    if (!retry) return undefined
    const status = retry.status !== undefined ? `HTTP ${retry.status}` : ''
    const message = `API ${status} ${retry.error} (${retry.attempt}/${retry.maxRetries ?? '?'})`.replace(/ {2}/g, ' ')
    let kind: AgentErrorKind | undefined
    if (retry.status === 429 || retry.error === 'rate_limit') kind = 'rateLimited'
    else if (retry.status === 401 || retry.error === 'authentication_failed') kind = 'notLoggedIn'
    return { message, kind, retryAfter: this.rateLimit?.retryAfter }
  }

  conclude(): CLIConclusion {
    const result = this.result
    if (!result) {
      if (this.connectionFailure) return { type: 'failed', failure: this.connectionFailure }
      if (this.assistantFailure) return { type: 'failed', failure: { ...this.assistantFailure, retryAfter: this.rateLimit?.retryAfter } }
      return { type: 'noResult' }
    }
    const sessionID = result.sessionID ?? this.sessionID
    if (result.isError) {
      if (result.subtype === 'error_max_turns') {
        return { type: 'finished', result: { text: this.lastAssistantText, steps: result.turns, usage: result.usage, stopReason: 'max_steps', sessionID } }
      }
      const candidates = [result.text, result.errors.length > 0 ? result.errors.join('\n') : undefined, this.assistantFailure?.message]
      const message = candidates.find((c) => c !== undefined && c.trim() !== '') ?? `error: ${result.subtype}`
      return { type: 'failed', failure: { message, kind: this.assistantFailure?.kind, retryAfter: this.rateLimit?.retryAfter } }
    }
    const text = result.text ? result.text : this.lastAssistantText
    const stopReason = result.stopReason === 'max_tokens' ? 'length' : 'stop'
    return { type: 'finished', result: { text, steps: result.turns, usage: result.usage, stopReason, sessionID } }
  }
}

/** El contenido de un `tool_result`: una cadena o bloques `{type:"text",text}` (las imágenes salen como «[imagen]»). */
export function claudeResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (get(b, 'type') === 'text' ? str(get(b, 'text')) : get(b, 'type') === 'image' ? AgentL10n.imagePlaceholder : undefined))
      .filter((t): t is string => t !== undefined)
      .join('\n')
  }
  return ''
}

/** `usage` de Anthropic → `Usage`: `promptTokens` incluye lecturas y escrituras de caché. */
export function claudeUsage(json: unknown): Usage {
  if (!isObject(json)) return emptyUsage()
  const input = int(json.input_tokens) ?? 0
  const cacheRead = int(json.cache_read_input_tokens) ?? 0
  const cacheWrite = int(json.cache_creation_input_tokens) ?? 0
  return {
    promptTokens: input + cacheRead + cacheWrite,
    completionTokens: int(json.output_tokens) ?? 0,
    reasoningTokens: int(get(json, 'output_tokens_details', 'thinking_tokens')) ?? 0,
    cachedTokens: cacheRead,
    cacheWriteTokens: cacheWrite
  }
}

// MARK: Agente

export interface ClaudeCodeOptions {
  /** Guardar la sesión en `~/.claude` (por defecto no: cada ejecución es independiente). */
  persistSession?: boolean
  resumeSessionID?: string
  /** Esfuerzo de razonamiento (`low`, `medium`, `high`…). */
  effort?: string
  extraArguments?: string[]
  extraEnvironment?: Record<string, string>
}

/** Opciones que pueden retirarse si una versión antigua de la CLI no las conoce. */
export const CLAUDE_OPTIONAL_FLAGS = new Set(['--permission-prompts', '--setting-sources', '--disable-slash-commands', '--no-session-persistence', '--include-partial-messages', '--effort', '--tools'])

/** Por encima de esto el prompt de sistema va en un archivo (en Windows la línea de órdenes admite ~32 000 caracteres). */
export const CLAUDE_MAX_INLINE_SYSTEM_BYTES = isWindows ? 8_000 : 100_000

/** Modelo efectivo: el de la tarea o el de la configuración (`undefined` = el de la CLI). */
export function effectiveModel(task: AgentTask, config: CLIAgentConfig): string | undefined {
  const candidate = (task.model ?? config.model ?? '').trim()
  return candidate || undefined
}

/** Esfuerzo guardado para el modelo de la configuración (no se filtra a otro modelo pedido por la tarea). */
export function savedEffort(config: CLIAgentConfig, model: string | undefined): string | undefined {
  const effort = config.reasoningEffort?.trim()
  if (!effort || effort === 'auto' || effort === 'automatic') return undefined
  if (model !== undefined && config.model && model !== config.model.trim()) return undefined
  return effort
}

export function claudeArguments(
  task: AgentTask,
  config: CLIAgentConfig,
  options: ClaudeCodeOptions,
  mcpConfigPath: string | undefined,
  systemPromptPath: string | undefined,
  dropping: ReadonlySet<string> = new Set(),
  permissionMode = 'dontAsk'
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  const addOptional = (flag: string, value?: string): void => {
    if (dropping.has(flag)) return
    args.push(flag)
    if (value !== undefined) args.push(value)
  }
  addOptional('--include-partial-messages')
  if (task.images?.length) args.push('--input-format', 'stream-json')
  if (systemPromptPath) args.push('--system-prompt-file', systemPromptPath)
  else args.push('--system-prompt', claudeSystemPrompt(task))
  const model = effectiveModel(task, config)
  if (model) args.push('--model', model)
  args.push('--max-turns', String(Math.max(1, Math.min(task.maxSteps ?? DEFAULT_MAX_STEPS, 1000))))
  args.push('--permission-mode', permissionMode)
  addOptional('--permission-prompts', 'none')

  // herramientas: solo las nuestras (MCP) y, si se permite, la web
  const servers = Array.from(new Set((task.mcpServers ?? []).map((s) => sanitizeName(s.name)))).sort()
  const allowed = servers.map((s) => `mcp__${s}__*`)
  if (task.allowWeb) allowed.push(...CLAUDE_WEB_TOOLS)
  addOptional('--tools', task.allowWeb ? CLAUDE_WEB_TOOLS.join(',') : '')
  if (allowed.length > 0) args.push('--allowedTools', allowed.join(','))
  const denied = [...CLAUDE_DENIED_TOOLS, ...(task.allowWeb ? [] : CLAUDE_WEB_TOOLS)]
  args.push('--disallowedTools', denied.join(','))

  args.push('--strict-mcp-config')
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath)
  addOptional('--setting-sources', 'user')
  addOptional('--disable-slash-commands')
  if (options.resumeSessionID) args.push('--resume', options.resumeSessionID)
  else if (!options.persistSession) addOptional('--no-session-persistence')
  const effort = options.effort ?? savedEffort(config, model)
  if (effort) addOptional('--effort', effort)
  args.push(...(options.extraArguments ?? []))
  return args
}

export function claudeEnvironment(task: AgentTask, options: ClaudeCodeOptions, workingDirectory: string): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // la memoria automática escribiría archivos en ~/.claude
    MCP_TIMEOUT: '60000', // arranque de los servidores MCP (ms)
    PWD: workingDirectory
  }
  if (task.maxOutputTokens && task.maxOutputTokens > 0) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(task.maxOutputTokens)
  Object.assign(env, options.extraEnvironment ?? {})
  return env
}

/**
 * Claude Code expone las herramientas de cada servidor MCP como `mcp__<servidor>__<herramienta>`, pero las instrucciones de Aula
 * las nombran a secas (`write_lesson`), igual para todos los proveedores. Sin esta nota el agente a veces llama al nombre suelto
 * y gasta un turno en «No such tool available: write_lesson». También recuerda que la entrada de una herramienta debe ser JSON
 * válido (la CLI rechaza sin llegar a Aula una llamada que no se puede leer).
 */
export function mcpToolNamesNote(serverNames: readonly string[]): string {
  const names = Array.from(new Set(serverNames)).filter(Boolean)
  if (!names.length) return ''
  const main = names.includes('aula') ? 'aula' : names[0]
  const others = names.filter((n) => n !== main).map((n) => `\`mcp__${n}__…\``).join(', ')
  return `\n\n# Tool names in this session\nThe tools these instructions mention by their short name are MCP tools: call them with their full name, \`mcp__${main}__<name>\` (for example \`search_sources\` is \`mcp__${main}__search_sources\`). A bare short name does not exist here and the call fails.` +
    (others ? ` Tools from other servers are named the same way (${others}).` : '') +
    ' Every tool input must be one complete, valid JSON object (escape quotes and backslashes inside strings); if a call is rejected because its input could not be parsed, resend it split into smaller parts.'
}

/** El prompt de sistema que recibe la CLI: el de la tarea y, si hay servidores MCP, cómo se llaman sus herramientas aquí. */
export function claudeSystemPrompt(task: AgentTask): string {
  return task.system + mcpToolNamesNote((task.mcpServers ?? []).map((s) => sanitizeName(s.name)))
}

/** Lo que se escribe en stdin: el prompt como texto o, si hay imágenes, un mensaje de usuario en `stream-json`. */
export function claudeStdin(task: AgentTask): string {
  const prompt = fullPrompt(task)
  if (!task.images?.length) return prompt
  const content: unknown[] = task.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } }))
  if (prompt) content.push({ type: 'text', text: prompt })
  return compactJSON({ type: 'user', message: { role: 'user', content } }) + '\n'
}

export class ClaudeCodeRunner implements AgentRunner {
  constructor(
    readonly config: CLIAgentConfig,
    private readonly options: ClaudeCodeOptions = {}
  ) {}

  run(task: AgentTask, signal?: AbortSignal): AsyncIterableIterator<AgentEvent> {
    return eventStream<AgentEvent>((emit, sig) => this.execute(task, emit, sig), signal)
  }

  private async execute(task: AgentTask, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    const classifier = CLIErrorClassifier.claude
    await prepareLocator()
    const executable = findExecutable('claude', this.config.executablePath)
    if (!executable) throw classifier.notInstalled
    if (!fullPrompt(task).trim() && !task.images?.length) throw new AgentError('other', AgentL10n.emptyPrompt(classifier.cliName))
    if ((task.inProcessToolCount ?? 0) > 0 && !task.mcpServers?.length) emit({ type: 'notice', text: AgentL10n.inProcessToolsUnsupported(classifier.cliName) })
    const sandbox = new AgentSandbox(task.workingDirectory)
    try {
      const dropped = new Set<string>()
      let permissionMode = 'dontAsk'
      const model = effectiveModel(task, this.config)
      for (let attempt = 0; attempt < 5; attempt++) {
        const invocation = this.makeInvocation(task, executable, sandbox, dropped, permissionMode)
        const parser = new ClaudeStreamParser(this.config.displayName || 'Claude Code', model ?? '', (task.mcpServers ?? []).map((s) => sanitizeName(s.name)), Date.now, !!task.allowWeb)
        try {
          await runCLI(invocation, parser, classifier, { timeoutMs: task.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal, emit })
          return
        } catch (err) {
          if (!(err instanceof AgentError)) throw err
          // una versión antigua puede no conocer opciones de refuerzo: se reintenta sin ellas (falla al instante, sin salida)
          const flag = droppableFlag(err, CLAUDE_OPTIONAL_FLAGS, dropped)
          if (flag) {
            if (flag === '--effort' && (this.options.effort || savedEffort(this.config, model))) {
              throw new AgentError(
                'unsupported',
                tr(
                  'La versión instalada de Claude Code no permite elegir el esfuerzo de razonamiento. Actualiza Claude Code o elige Automático junto al modelo.',
                  'The installed version of Claude Code doesn’t let you choose the reasoning effort. Update Claude Code or choose Automatic next to the model.'
                )
              )
            }
            dropped.add(flag)
            continue
          }
          if (permissionMode === 'dontAsk' && err.message.includes('dontAsk') && err.message.toLowerCase().includes('invalid')) {
            permissionMode = 'default'
            continue
          }
          throw err
        }
      }
      throw new AgentError('unsupported', AgentL10n.tooOld(classifier))
    } finally {
      sandbox.cleanup()
    }
  }

  private makeInvocation(task: AgentTask, executable: string, sandbox: AgentSandbox, dropped: ReadonlySet<string>, permissionMode: string): CLIInvocation {
    const mcpConfigPath = task.mcpServers?.length ? sandbox.write(claudeMCPConfig(task.mcpServers), 'mcp.json') : undefined
    const system = claudeSystemPrompt(task)
    const systemPromptPath = Buffer.byteLength(system, 'utf8') > CLAUDE_MAX_INLINE_SYSTEM_BYTES ? sandbox.write(system, 'system.md') : undefined
    const args = claudeArguments(task, this.config, this.options, mcpConfigPath, systemPromptPath, dropped, permissionMode)
    const environment = childEnvironment(claudeEnvironment(task, this.options, sandbox.workingDirectory))
    environment.PWD = sandbox.workingDirectory
    return { executable, arguments: args, environment, workingDirectory: sandbox.workingDirectory, stdin: claudeStdin(task) }
  }
}
