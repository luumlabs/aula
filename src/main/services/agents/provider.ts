// Adaptador: un agente CLI (Claude Code, Codex, OpenCode) con la interfaz `ChatModel` de la capa de IA.
//  - `runAgent`: tarea completa (sistema + mensajes + herramientas de Aula). Las herramientas se ofrecen a la CLI por MCP: la app
//    arranca el relevo local y la CLI lanza el ayudante `aula-mcp`, que le reenvía cada llamada. La CLI lleva su propio bucle.
//  - `complete`: una respuesta sin herramientas (calificar, resumir…), con el texto como mensaje del asistente.
// Los errores llegan como `AIError` (mismo `kind` que el `AgentError` de las CLIs).
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { CLIAgentKind } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import type { AIProviderConfig, AIProviderKind } from '@shared/settings/ai'
import type { ChatMessage, ChatRequest, ChatResponse, ImagePart as AIImagePart } from '@shared/ai/types'
import { AIError } from '../ai/errors'
import type { AgentTaskSpec, AgentTool, ChatModel, CompleteOptions, ModelCapabilities } from '../ai/model'
import { paths } from '../paths'
import { ClaudeCodeRunner, type ClaudeCodeOptions } from './claude'
import { CodexRunner, type CodexOptions } from './codex'
import { codexStoreArguments } from './codex-account'
import { AgentError, isCancellation } from './errors'
import { OpenCodeRunner, type OpenCodeOptions } from './opencode'
import { probeCLI } from './probe'
import { RELAY_TOKEN_ENV, RELAY_URL_ENV, startToolRelayServer, toolsProviderFrom, type ToolRelayServer } from './relay'
import type { AgentEvent, AgentResult, AgentRunner, AgentTask, CLIAgentConfig, ImagePart, MCPServerSpec, RelayableTool, Usage } from './types'
import { emptyUsage } from './types'
import { devOverride } from '../runtime'

// MARK: Ayudante MCP

export interface HelperLaunch {
  /** Ejecutable con el que se lanza el ayudante (el de Aula, en modo Node). */
  command: string
  args: string[]
  env: Record<string, string>
}

let configuredLaunch: HelperLaunch | undefined

/** Fija cómo lanzar el ayudante (el proceso principal lo llama al arrancar si hace falta; las pruebas también). */
export function configureAulaMCPHelper(launch: HelperLaunch | undefined): void {
  configuredLaunch = launch
}

/** `app.asar/…` → `app.asar.unpacked/…` si existe (un script dentro del asar no lo puede leer otro proceso fuera de Electron). */
export function unpackedPath(path: string): string {
  const marker = `app.asar${sep}`
  const index = path.indexOf(marker)
  if (index < 0) return path
  const unpacked = path.slice(0, index) + `app.asar.unpacked${sep}` + path.slice(index + marker.length)
  return existsSync(unpacked) ? unpacked : path
}

/**
 * Cómo se lanza `aula-mcp`: el ejecutable de Aula (`process.execPath`) con `ELECTRON_RUN_AS_NODE=1` y el script empaquetado
 * `out/main/aula-mcp.js` (junto a `out/main/index.js`). `AULA_MCP_SCRIPT` lo sustituye (desarrollo, pruebas; nunca en la app
 * instalada).
 */
export function aulaMCPHelperLaunch(): HelperLaunch {
  if (configuredLaunch) return configuredLaunch
  const script = devOverride('AULA_MCP_SCRIPT') || join(__dirname, 'aula-mcp.js')
  return { command: process.execPath, args: [unpackedPath(script)], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} }
}

/** El servidor MCP «aula» para una ejecución: el ayudante con la dirección y la clave del relevo. */
export function aulaMCPServerSpec(relay: Pick<ToolRelayServer, 'url' | 'token'>, extraEnv: Record<string, string> = {}): MCPServerSpec {
  const launch = aulaMCPHelperLaunch()
  return { name: 'aula', command: launch.command, args: launch.args, env: { ...launch.env, ...extraEnv, [RELAY_URL_ENV]: relay.url, [RELAY_TOKEN_ENV]: relay.token } }
}

// MARK: Sesión de Codex propia de Aula

/** `CODEX_HOME` de Aula: `<datos>/tools/codex/home`, como en la app Swift (la sesión de ChatGPT de Aula queda en su `auth.json`). */
export function managedCodexHome(): string {
  return join(paths.root(), 'tools', 'codex', 'home')
}

/** La carpeta de sesión de Aula si ya tiene una sesión iniciada; si no, `undefined` (= la del usuario, `~/.codex`). */
export function codexHomeForUse(): string | undefined {
  try {
    const home = managedCodexHome()
    return existsSync(join(home, 'auth.json')) ? home : undefined
  } catch {
    return undefined
  }
}

// MARK: Agentes

export const CLI_PROVIDER_KINDS: Record<CLIAgentKind, AIProviderKind> = { claude: 'claude-cli', codex: 'codex-cli', opencode: 'opencode-cli' }

export function cliKindForProvider(kind: AIProviderKind): CLIAgentKind | undefined {
  if (kind === 'claude-cli') return 'claude'
  if (kind === 'codex-cli') return 'codex'
  if (kind === 'opencode-cli') return 'opencode'
  return undefined
}

const DISPLAY_NAMES: Record<CLIAgentKind, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

export function cliAgentConfig(config: AIProviderConfig): CLIAgentConfig | undefined {
  const kind = cliKindForProvider(config.kind)
  if (!kind) return undefined
  return {
    id: config.id,
    kind,
    displayName: config.label || DISPLAY_NAMES[kind],
    model: config.model ?? '',
    executablePath: config.executable,
    reasoningEffort: config.reasoning && config.reasoning !== 'auto' ? config.reasoning : undefined
  }
}

export interface RunnerOverrides {
  effort?: string
  claude?: ClaudeCodeOptions
  codex?: CodexOptions
  opencode?: OpenCodeOptions
}

/** El agente de una CLI (el Codex con la sesión de Aula va con su `CODEX_HOME`). */
export function createCLIRunner(config: CLIAgentConfig, overrides: RunnerOverrides = {}): AgentRunner {
  switch (config.kind) {
    case 'claude':
      return new ClaudeCodeRunner(config, { ...overrides.claude, effort: overrides.claude?.effort ?? overrides.effort })
    case 'codex': {
      const home = codexHomeForUse()
      const base: CodexOptions = home ? { extraArguments: codexStoreArguments(home), extraEnvironment: { CODEX_HOME: home } } : {}
      return new CodexRunner(config, {
        ...base,
        ...overrides.codex,
        reasoningEffort: overrides.codex?.reasoningEffort ?? overrides.effort,
        extraArguments: [...(base.extraArguments ?? []), ...(overrides.codex?.extraArguments ?? [])],
        extraEnvironment: { ...(base.extraEnvironment ?? {}), ...(overrides.codex?.extraEnvironment ?? {}) }
      })
    }
    case 'opencode':
      return new OpenCodeRunner(config, { ...overrides.opencode, variant: overrides.opencode?.variant ?? overrides.effort })
  }
}

// MARK: Mensajes → prompt

function textOf(m: ChatMessage): string {
  return m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

function imagesOf(m: ChatMessage): ImagePart[] {
  return m.content.flatMap((p) => (p.type === 'image' ? [{ mediaType: p.image.mediaType, base64: p.image.base64 }] : []))
}

const HISTORY_TOOL_LIMIT = 2000

/**
 * Una CLI recibe un solo mensaje por stdin: la conversación anterior va delante, entre etiquetas, y después el mensaje actual.
 * `prompt` vacío = el texto del último mensaje del usuario.
 */
export function conversationPrompt(messages: ChatMessage[], prompt?: string): { prompt: string; images: ImagePart[] } {
  const turns = messages.filter((m) => m.role !== 'system')
  let lastUser = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') {
      lastUser = i
      break
    }
  }
  const current = prompt?.trim() ? prompt : lastUser >= 0 ? textOf(turns[lastUser]) : ''
  const images = lastUser >= 0 ? imagesOf(turns[lastUser]) : []
  const history = (lastUser >= 0 ? turns.slice(0, lastUser) : turns).filter((m) => textOf(m).trim() || m.toolCalls?.length)
  if (history.length === 0) return { prompt: current, images }
  const lines: string[] = ['<conversation_so_far>']
  for (const m of history) {
    const text = textOf(m).trim()
    if (m.role === 'user') lines.push(`<user>\n${text}\n</user>`)
    else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).map((c) => `[tool ${c.name}]`).join(' ')
      lines.push(`<assistant>\n${[text, calls].filter(Boolean).join('\n')}\n</assistant>`)
    } else if (m.role === 'tool') {
      const clipped = text.length > HISTORY_TOOL_LIMIT ? text.slice(0, HISTORY_TOOL_LIMIT) + '…' : text
      lines.push(`<tool_result name="${m.name ?? 'tool'}">\n${clipped}\n</tool_result>`)
    }
  }
  lines.push('</conversation_so_far>', '', current)
  return { prompt: lines.join('\n'), images }
}

// MARK: ChatModel

function toAIError(err: unknown): unknown {
  if (err instanceof AIError) return err
  if (err instanceof AgentError) return new AIError(err.kind, err.message, { retryAfter: err.retryAfter })
  return err
}

function relayable(tools: AgentTool[]): RelayableTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: (args, ctx) => tool.run(args as never, { signal: ctx.signal, callId: typeof ctx.callId === 'string' ? ctx.callId : randomBytes(6).toString('hex') })
  }))
}

function capabilitiesFor(kind: CLIAgentKind): ModelCapabilities {
  switch (kind) {
    case 'claude':
      return { tools: true, vision: true, streaming: true, jsonMode: false, contextWindow: 200_000, reasoning: null }
    case 'codex':
      return { tools: true, vision: true, streaming: true, jsonMode: false, contextWindow: 272_000, reasoning: null }
    case 'opencode':
      return { tools: true, vision: true, streaming: true, jsonMode: false, contextWindow: 128_000, reasoning: null }
  }
}

export interface CLIChatModelOptions {
  /** Para pruebas: otro agente (p. ej. con una CLI falsa). */
  runner?: (overrides: RunnerOverrides) => AgentRunner
  /** Variables extra para el ayudante MCP (p. ej. instrucciones). */
  helperEnv?: Record<string, string>
  /** Servidores MCP del usuario que la CLI también debe conectar. */
  extraMCPServers?: MCPServerSpec[]
  workingDirectory?: string
}

/** Ejecuta una tarea con la CLI y devuelve el resultado final (los eventos van a `onEvent`). */
async function runTask(runner: AgentRunner, task: AgentTask, signal: AbortSignal | undefined, onEvent?: (e: AgentEvent) => void): Promise<AgentResult> {
  let result: AgentResult | undefined
  let text = ''
  let usage: Usage = emptyUsage()
  for await (const event of runner.run(task, signal)) {
    onEvent?.(event)
    if (event.type === 'finished') result = event.result
    else if (event.type === 'text') text += event.text
    else if (event.type === 'usage') usage = event.usage
  }
  if (signal?.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
  return result ?? { text, steps: 0, usage, stopReason: 'cancelled' }
}

/** Un agente CLI como `ChatModel` (con `runAgent`: lleva su propio bucle; las herramientas van por MCP). */
export function createCLIChatModel(config: AIProviderConfig, options: CLIChatModelOptions = {}): ChatModel {
  const agentConfig = cliAgentConfig(config)
  if (!agentConfig) {
    const name = config.label || config.kind
    throw new AIError('unsupported', tr(`«${name}» no es un agente de línea de órdenes.`, `“${name}” isn’t a command-line agent.`))
  }
  const makeRunner = options.runner ?? ((o: RunnerOverrides) => createCLIRunner(agentConfig, o))

  const runAgent = async (spec: AgentTaskSpec, opts: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void } = {}): Promise<AgentResult> => {
    let relay: ToolRelayServer | undefined
    try {
      const servers: MCPServerSpec[] = []
      if (spec.tools.length > 0) {
        relay = await startToolRelayServer(toolsProviderFrom(relayable(spec.tools)))
        servers.push(aulaMCPServerSpec(relay, options.helperEnv))
      }
      servers.push(...(options.extraMCPServers ?? []))
      const flattened = conversationPrompt(spec.messages, spec.prompt)
      const task: AgentTask = {
        system: spec.system,
        prompt: flattened.prompt,
        images: spec.images?.length ? spec.images.map((i: AIImagePart) => ({ mediaType: i.mediaType, base64: i.base64 })) : flattened.images,
        mcpServers: servers,
        // A2-P1-2: sin WebSearch/WebFetch propios salvo que la tarea lo pida expresamente; la web de Aula (`web_search`,
        // `fetch_url`) llega por el relevo MCP con sus puertas, también con «Buscar en la web» apagado no hay nada
        allowWeb: spec.allowWeb === true,
        model: agentConfig.model || undefined,
        maxSteps: spec.maxSteps,
        timeoutMs: spec.timeoutSec * 1000,
        temperature: spec.temperature,
        maxOutputTokens: spec.maxOutputTokens,
        sharedContext: spec.sharedContext,
        workingDirectory: options.workingDirectory
      }
      return await runTask(makeRunner({ effort: spec.reasoningEffort }), task, opts.signal, opts.onEvent)
    } catch (err) {
      if (isCancellation(err) || opts.signal?.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
      throw toAIError(err)
    } finally {
      await relay?.close()
    }
  }

  const complete = async (request: ChatRequest, opts: CompleteOptions = {}): Promise<ChatResponse> => {
    const system = request.messages.filter((m) => m.role === 'system').map(textOf).join('\n\n')
    const flattened = conversationPrompt(request.messages)
    const task: AgentTask = {
      system,
      prompt: flattened.prompt,
      images: flattened.images,
      allowWeb: false,
      model: request.model || agentConfig.model || undefined,
      maxSteps: 2,
      timeoutMs: (request.timeoutSec ?? 300) * 1000,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
      workingDirectory: options.workingDirectory
    }
    try {
      const result = await runTask(makeRunner({ effort: request.reasoningEffort }), task, opts.signal, (event) => {
        if (event.type === 'text') opts.onDelta?.({ type: 'text', text: event.text })
        else if (event.type === 'reasoning') opts.onDelta?.({ type: 'reasoning', text: event.text })
        else if (event.type === 'usage') opts.onDelta?.({ type: 'usage', usage: event.usage })
      })
      const finish = result.stopReason === 'length' ? 'length' : 'stop'
      opts.onDelta?.({ type: 'finished', finish })
      const message: ChatMessage = { role: 'assistant', content: result.text ? [{ type: 'text', text: result.text }] : [] }
      return { message, usage: result.usage, finish }
    } catch (err) {
      if (isCancellation(err) || opts.signal?.aborted) throw new AIError('cancelled', 'Cancelado.', { code: 'cancelled' })
      throw toAIError(err)
    }
  }

  return {
    providerId: config.id,
    providerName: agentConfig.displayName,
    kind: config.kind,
    model: agentConfig.model,
    capabilities: capabilitiesFor(agentConfig.kind),
    complete,
    runAgent
  }
}

/** Fábricas para el registro de proveedores de la capa de IA (`registerProviderFactory(kind, factory)`). */
export const cliProviderFactories: Record<'claude-cli' | 'codex-cli' | 'opencode-cli', (config: AIProviderConfig) => ChatModel> = {
  'claude-cli': (config) => createCLIChatModel(config),
  'codex-cli': (config) => createCLIChatModel(config),
  'opencode-cli': (config) => createCLIChatModel(config)
}

/** ¿Se puede usar ya este agente? (CLI instalada y con sesión; Codex también con la sesión propia de Aula). */
export interface CLIAvailability {
  available: boolean
  reason?: string
}

export async function probeCLIProvider(config: AIProviderConfig): Promise<CLIAvailability> {
  const kind = cliKindForProvider(config.kind)
  if (!kind) return { available: false, reason: tr('No es un agente de línea de órdenes.', 'It isn’t a command-line agent.') }
  const home = kind === 'codex' ? codexHomeForUse() : undefined
  const status = await probeCLI(kind, {
    explicitPath: config.executable,
    ...(home ? { extraEnvironment: { CODEX_HOME: home }, sessionArguments: codexStoreArguments(home) } : {})
  })
  return status.installed && status.loggedIn !== false ? { available: true } : { available: false, reason: status.detail }
}

/** Forma de `registerProviderFactory` de la capa de IA (con la comprobación de disponibilidad opcional). */
export type CLIProviderRegistrar = (
  kind: AIProviderKind,
  factory: (config: AIProviderConfig) => ChatModel,
  options?: { probe?: (config: AIProviderConfig) => Promise<CLIAvailability>; probeTTLms?: number }
) => unknown

/** Registra los agentes CLI en el registro de la capa de IA: `registerCLIProviders(registerProviderFactory)`. */
export function registerCLIProviders(register: CLIProviderRegistrar): void {
  for (const [kind, factory] of Object.entries(cliProviderFactories)) register(kind as AIProviderKind, factory, { probe: probeCLIProvider, probeTTLms: 60_000 })
}
