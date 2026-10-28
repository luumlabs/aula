// Agente que usa la suscripción de ChatGPT lanzando la CLI oficial (`codex exec --json`)
// (port de `AgentKit/CLI/{CodexRunner,CodexEventParser}.swift`).
//
// Seguridad: sin comandos ni edición de archivos. Sandbox `read-only`, aprobaciones «nunca», shell/unified_exec/subagentes/
// conectores/view_image desactivados con `-c features.…=false`, `--ignore-user-config` y `--ignore-rules`, directorio vacío,
// `--ephemeral` y solo los servidores MCP de la tarea. Si en el flujo aparece un comando o un cambio de archivos, se detiene.
// El prompt de sistema va con `-c developer_instructions=…`; el prompt, por stdin (`-`); las imágenes, con `--image`.
import { tr } from '@shared/ai/i18n'
import { AgentError, AgentL10n, CLIErrorClassifier, droppableFlag } from './errors'
import {
  eventStream,
  prefixChars,
  runCLI,
  step,
  summarizeArguments,
  summarizeResult,
  truncate,
  type CLIConclusion,
  type CLIEventParser,
  type CLIFailure,
  type CLIParseStep
} from './engine'
import { effectiveModel, savedEffort } from './claude'
import { arr, compactJSON, get, int, isObject, str, tryParse } from './json'
import { childEnvironment, findExecutable, prepareLocator } from './locator'
import { codexMCPOverrides, toml } from './mcp-config'
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

/**
 * Analiza `codex exec --json` (eventos de hilo, `codex-rs/exec/src/exec_events.rs`): `thread.started`, `turn.started`,
 * `turn.completed {usage}`, `turn.failed {error}`, `error {message}` e `item.started|updated|completed` con `agent_message`,
 * `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list` y `error`.
 * Un evento `error` puede ser un reintento de red (no es fatal).
 */
export class CodexEventParser implements CLIEventParser {
  private threadID?: string
  private lastAgentMessage?: string
  private emittedText = false
  private readonly startedItems = new Map<string, string>()
  private readonly finishedItems = new Set<string>()
  private usage?: Usage
  private turnCompleted = false
  private failure?: string
  private lastError?: string
  private lastNotice?: string
  private toolCalls = 0
  private limitReached = false
  private readonly unparsed: string[] = []

  constructor(
    readonly providerName: string,
    readonly requestedModel: string,
    /** Máximo de llamadas a herramientas antes de cortar (Codex no tiene un límite propio). */
    readonly maxToolCalls: number
  ) {}

  get unparsedSample(): string {
    return this.unparsed.join('\n')
  }

  consume(line: string): CLIParseStep {
    if (this.limitReached) return step()
    const trimmed = line.trim()
    if (!trimmed) return step()
    const json = trimmed.startsWith('{') ? tryParse(trimmed) : undefined
    if (!isObject(json)) {
      if (this.unparsed.length < 8) this.unparsed.push(prefixChars(trimmed, 300))
      return step()
    }
    const s = step()
    switch (json.type) {
      case 'thread.started':
        this.threadID = str(json.thread_id)
        s.events.push({ type: 'started', provider: this.providerName, model: this.requestedModel || AgentL10n.defaultModel })
        break
      case 'item.started':
        this.consumeStarted(json.item, s)
        break
      case 'item.completed':
        this.consumeCompleted(json.item, s)
        break
      case 'turn.completed':
        this.turnCompleted = true
        this.usage = codexUsage(json.usage)
        s.isTerminal = true
        break
      case 'turn.failed':
        this.failure = str(get(json, 'error', 'message')) ?? this.lastError ?? 'El turno falló.'
        s.isTerminal = true
        break
      case 'error': {
        const message = str(json.message)
        if (message) {
          this.lastError = message
          if (message !== this.lastNotice) {
            this.lastNotice = message
            s.events.push({ type: 'notice', text: message }) // puede ser un reintento («Reconnecting… 2/5»)
          }
        }
        break
      }
    }
    return s
  }

  private consumeStarted(item: unknown, s: CLIParseStep): void {
    if (!isObject(item)) return
    const type = str(item.type)
    if (type === 'mcp_tool_call' || type === 'web_search') this.startTool(item, type, s)
    else if (type === 'command_execution' || type === 'file_change' || type === 'collab_tool_call') s.violation = codexViolation(type, item)
  }

  private consumeCompleted(item: unknown, s: CLIParseStep): void {
    if (!isObject(item)) return
    const type = str(item.type)
    switch (type) {
      case 'agent_message': {
        const text = str(item.text)
        if (!text) return
        this.lastAgentMessage = text
        if (this.emittedText) s.events.push({ type: 'text', text: '\n\n' })
        this.emittedText = true
        s.events.push({ type: 'text', text })
        break
      }
      case 'reasoning': {
        const text = str(item.text)
        if (text) s.events.push({ type: 'reasoning', text })
        break
      }
      case 'mcp_tool_call':
      case 'web_search':
        this.startTool(item, type, s)
        this.finishTool(item, type, s)
        break
      case 'command_execution':
      case 'file_change':
      case 'collab_tool_call':
        s.violation = codexViolation(type, item)
        break
      case 'error': {
        const message = str(item.message)
        if (message) s.events.push({ type: 'notice', text: message })
        break
      }
    }
  }

  private startTool(item: JSONObject, type: string, s: CLIParseStep): void {
    const id = str(item.id)
    if (!id || this.startedItems.has(id)) return
    let name: string
    let summary: string
    if (type === 'web_search') {
      name = 'web_search'
      summary = truncate(str(item.query) ?? str(get(item, 'action', 'query')) ?? str(get(item, 'action', 'url')) ?? '', 120)
    } else {
      name = str(item.tool) ?? AgentL10n.unknownTool
      summary = summarizeArguments(item.arguments ?? null)
    }
    this.startedItems.set(id, name)
    s.events.push({ type: 'toolStarted', id, name, summary })
  }

  private finishTool(item: JSONObject, type: string, s: CLIParseStep): void {
    const id = str(item.id)
    if (!id || this.finishedItems.has(id)) return
    this.finishedItems.add(id)
    const name = this.startedItems.get(id) ?? AgentL10n.unknownTool
    let ok = true
    let summary: string
    if (type === 'web_search') {
      summary = truncate(str(item.query) ?? '', 120)
    } else {
      const status = str(item.status) ?? 'completed'
      const errorMessage = str(get(item, 'error', 'message'))
      ok = status !== 'failed' && errorMessage === undefined
      summary = summarizeResult(errorMessage ?? codexContentText(item.result))
    }
    s.events.push({ type: 'toolFinished', id, name, ok, summary })
    this.toolCalls += 1
    if (this.maxToolCalls > 0 && this.toolCalls >= this.maxToolCalls && !this.limitReached) {
      this.limitReached = true
      s.stopNow = true
      s.events.push({ type: 'notice', text: tr(`El agente llegó al máximo de pasos (${this.maxToolCalls}); se detuvo.`, `The agent reached the step limit (${this.maxToolCalls}) and stopped.`) })
    }
  }

  /** El último `error` (Codex anuncia así sus reintentos: «Reconnecting… 3/5», «429 Too Many Requests»…). */
  stallFailure(): CLIFailure | undefined {
    return this.lastError !== undefined ? { message: this.lastError } : undefined
  }

  conclude(): CLIConclusion {
    if (this.limitReached) {
      return { type: 'finished', result: { text: this.lastAgentMessage ?? '', steps: this.toolCalls + 1, usage: this.usage ?? emptyUsage(), stopReason: 'max_steps', sessionID: this.threadID } }
    }
    if (this.failure !== undefined) return { type: 'failed', failure: { message: this.failure } }
    if (this.turnCompleted) {
      return { type: 'finished', result: { text: this.lastAgentMessage ?? '', steps: this.toolCalls + 1, usage: this.usage ?? emptyUsage(), stopReason: 'stop', sessionID: this.threadID } }
    }
    if (this.lastError !== undefined) return { type: 'failed', failure: { message: this.lastError } }
    return { type: 'noResult' }
  }
}

/** Texto de un resultado MCP (`{content:[{type:"text",text}], structured_content}`). */
export function codexContentText(result: unknown): string {
  if (!isObject(result)) return ''
  const texts = (arr(result.content) ?? [])
    .map((b) => (get(b, 'type') === 'text' ? str(get(b, 'text')) : get(b, 'type') === 'image' ? AgentL10n.imagePlaceholder : undefined))
    .filter((t): t is string => t !== undefined)
  if (texts.length > 0) return texts.join('\n')
  if (result.structured_content !== undefined && result.structured_content !== null) return compactJSON(result.structured_content)
  return ''
}

function codexViolation(type: string, item: JSONObject): string {
  if (type === 'command_execution') {
    const command = truncate(str(item.command) ?? '', 80)
    return tr(`Codex intentó ejecutar un comando (${command}). Se detuvo la ejecución por seguridad.`, `Codex tried to run a command (${command}). The run was stopped for security.`)
  }
  if (type === 'file_change') return tr('Codex intentó modificar archivos. Se detuvo la ejecución por seguridad.', 'Codex tried to change files. The run was stopped for security.')
  return tr('Codex intentó lanzar subagentes. Se detuvo la ejecución por seguridad.', 'Codex tried to launch subagents. The run was stopped for security.')
}

export function codexUsage(json: unknown): Usage {
  if (!isObject(json)) return emptyUsage()
  return {
    promptTokens: int(json.input_tokens) ?? 0,
    completionTokens: int(json.output_tokens) ?? 0,
    reasoningTokens: int(json.reasoning_output_tokens) ?? 0,
    cachedTokens: int(json.cached_input_tokens) ?? 0,
    cacheWriteTokens: 0
  }
}

// MARK: Agente

export interface CodexOptions {
  /** Esfuerzo de razonamiento (`low`, `medium`, `high`…). */
  reasoningEffort?: string
  /** Argumentos extra, antes del `-` final. */
  extraArguments?: string[]
  extraEnvironment?: Record<string, string>
}

export const CODEX_OPTIONAL_FLAGS = new Set(['--ignore-user-config', '--ignore-rules', '--ephemeral', '--color'])

/** Por encima de esto el prompt de sistema se antepone al prompt (por stdin) en vez de ir en la línea de órdenes. */
export const CODEX_MAX_INLINE_SYSTEM_BYTES = isWindows ? 8_000 : 150_000

export function codexArguments(task: AgentTask, config: CLIAgentConfig, options: CodexOptions, imagePaths: string[], dropping: ReadonlySet<string> = new Set()): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check']
  const addOptional = (flag: string, value?: string): void => {
    if (dropping.has(flag)) return
    args.push(flag)
    if (value !== undefined) args.push(value)
  }
  addOptional('--ephemeral')
  addOptional('--ignore-user-config')
  addOptional('--ignore-rules')
  addOptional('--color', 'never')
  args.push('--sandbox', 'read-only')
  const model = effectiveModel(task, config)
  if (model) args.push('--model', model)
  for (const path of imagePaths) args.push('--image', path)
  const override = (key: string, value: string): void => {
    args.push('-c', `${key}=${value}`)
  }
  override('approval_policy', toml('never'))
  override('web_search', toml(task.allowWeb ? 'live' : 'disabled'))
  // sin shell, sin subagentes, sin conectores, sin lectura de imágenes locales: solo MCP y (si se permite) la web
  for (const feature of ['shell_tool', 'unified_exec', 'multi_agent', 'apps', 'hooks', 'view_image']) override(`features.${feature}`, 'false')
  override('project_doc_max_bytes', '0')
  override('model_reasoning_summary', toml('auto'))
  const effort = options.reasoningEffort ?? savedEffort(config, model)
  if (effort) override('model_reasoning_effort', toml(effort))
  if (task.system && Buffer.byteLength(task.system, 'utf8') <= CODEX_MAX_INLINE_SYSTEM_BYTES) override('developer_instructions', toml(task.system))
  args.push(...codexMCPOverrides(task.mcpServers ?? []))
  args.push(...(options.extraArguments ?? []))
  args.push('-') // el prompt se lee de stdin
  return args
}

export function codexStdin(task: AgentTask, systemInStdin: boolean): string {
  if (!systemInStdin || !task.system) return fullPrompt(task)
  return `<instrucciones>\n${task.system}\n</instrucciones>\n\n${fullPrompt(task)}`
}

export class CodexRunner implements AgentRunner {
  constructor(
    readonly config: CLIAgentConfig,
    private readonly options: CodexOptions = {}
  ) {}

  run(task: AgentTask, signal?: AbortSignal): AsyncIterableIterator<AgentEvent> {
    return eventStream<AgentEvent>((emit, sig) => this.execute(task, emit, sig), signal)
  }

  private async execute(task: AgentTask, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    const classifier = CLIErrorClassifier.codex
    await prepareLocator()
    const executable = findExecutable('codex', this.config.executablePath)
    if (!executable) throw classifier.notInstalled
    if (!fullPrompt(task).trim() && !task.images?.length) throw new AgentError('other', AgentL10n.emptyPrompt(classifier.cliName))
    if ((task.inProcessToolCount ?? 0) > 0 && !task.mcpServers?.length) emit({ type: 'notice', text: AgentL10n.inProcessToolsUnsupported(classifier.cliName) })
    const sandbox = new AgentSandbox(task.workingDirectory)
    try {
      const imagePaths = sandbox.writeImages(task.images ?? [])
      const dropped = new Set<string>()
      const inlineSystem = Buffer.byteLength(task.system, 'utf8') <= CODEX_MAX_INLINE_SYSTEM_BYTES
      for (let attempt = 0; attempt < 6; attempt++) {
        const environment = childEnvironment({ PWD: sandbox.workingDirectory, ...(this.options.extraEnvironment ?? {}) })
        const invocation = {
          executable,
          arguments: codexArguments(task, this.config, this.options, imagePaths, dropped),
          environment,
          workingDirectory: sandbox.workingDirectory,
          stdin: codexStdin(task, !inlineSystem)
        }
        const parser = new CodexEventParser(this.config.displayName || 'Codex', effectiveModel(task, this.config) ?? '', Math.max(1, task.maxSteps ?? DEFAULT_MAX_STEPS))
        try {
          await runCLI(invocation, parser, classifier, { timeoutMs: task.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal, emit })
          return
        } catch (err) {
          if (!(err instanceof AgentError)) throw err
          const flag = droppableFlag(err, CODEX_OPTIONAL_FLAGS, dropped)
          if (flag) {
            dropped.add(flag)
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
}
