// Agente que usa la CLI OpenCode (`opencode run --format json`) con la configuración y credenciales del usuario
// (port de `AgentKit/CLI/{OpenCodeRunner,OpenCodeEventParser}.swift`).
//
// Todo lo que Aula necesita (servidores MCP, permisos, un agente con el prompt de sistema y el límite de pasos) va en
// `OPENCODE_CONFIG_CONTENT`, que tiene prioridad sobre la configuración global sin modificarla. La regla `permission` deniega
// por defecto y nombra las herramientas peligrosas; solo se permiten las de los servidores MCP de la tarea y, si `allowWeb`,
// `webfetch`/`websearch`. Se usa `--pure` y, si en el flujo aparece una herramienta peligrosa EJECUTADA, se detiene.
import { randomUUID } from 'node:crypto'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { sanitizeName } from '../../mcp/protocol'
import { AgentError, AgentL10n, CLIErrorClassifier, droppableFlag, type AgentErrorKind } from './errors'
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
import { asText, get, int, isObject, str, tryParse } from './json'
import { childEnvironment, findExecutable, prepareLocator } from './locator'
import { defuseOpenCode, openCodeConfigJSON } from './mcp-config'
import { AgentSandbox } from './sandbox'
import {
  addUsage,
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS,
  emptyUsage,
  fullPrompt,
  type AgentEvent,
  type AgentRunner,
  type AgentTask,
  type CLIAgentConfig,
  type Usage
} from './types'

const isWindows = process.platform === 'win32'

/** Herramientas integradas que ejecutan comandos, tocan archivos o lanzan subagentes. */
export const OPENCODE_DANGEROUS_BUILTINS = new Set([
  'bash', 'edit', 'write', 'patch', 'multiedit', 'apply_patch', 'read', 'glob', 'grep', 'list', 'task', 'skill', 'lsp', 'codesearch',
  'todowrite', 'todoread', 'question', 'batch'
])

/**
 * Analiza `opencode run --format json`: una línea JSON por evento con `type`, `timestamp`, `sessionID` y `part`/`error`:
 * `step_start` / `step_finish` (`part.reason`, `part.tokens`), `text`, `reasoning` (con `--thinking`), `tool_use` (al terminar:
 * `part.tool`, `part.callID`, `part.state {status, input, output, error}`) y `error` (`error {name, data {message, statusCode}}`).
 */
export class OpenCodeEventParser implements CLIEventParser {
  private sessionID?: string
  private started = false
  private emittedText = false
  private lastText = ''
  private steps = 0
  private usage = emptyUsage()
  private lastReason?: string
  private readonly errors: { message: string; kind?: AgentErrorKind }[] = []
  private readonly unparsed: string[] = []

  constructor(
    readonly providerName: string,
    readonly requestedModel: string,
    /** Nombres de servidor normalizados: sus herramientas se llaman `servidor_herramienta`. */
    readonly serverNames: string[],
    readonly allowWeb: boolean
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
    this.sessionID = str(json.sessionID) ?? this.sessionID
    const s = step()
    switch (json.type) {
      case 'step_start':
        this.lastReason = undefined
        this.beginIfNeeded(s)
        this.steps += 1
        break
      case 'text': {
        this.beginIfNeeded(s)
        const text = str(get(json, 'part', 'text'))
        if (text && text.trim()) {
          this.lastText = text
          if (this.emittedText) s.events.push({ type: 'text', text: '\n\n' })
          this.emittedText = true
          s.events.push({ type: 'text', text })
        }
        break
      }
      case 'reasoning': {
        const text = str(get(json, 'part', 'text'))
        if (text && text.trim()) s.events.push({ type: 'reasoning', text })
        break
      }
      case 'tool_use':
        this.beginIfNeeded(s)
        this.consumeTool(json.part, s)
        break
      case 'step_finish':
        this.consumeStepFinish(json.part)
        break
      case 'error':
        this.consumeError(json.error)
        break
    }
    return s
  }

  private beginIfNeeded(s: CLIParseStep): void {
    if (this.started) return
    this.started = true
    s.events.push({ type: 'started', provider: this.providerName, model: this.requestedModel || AgentL10n.defaultModel })
  }

  private consumeTool(part: unknown, s: CLIParseStep): void {
    if (!isObject(part)) return
    const rawName = str(part.tool)
    if (!rawName) return
    const id = str(part.callID) ?? str(part.id) ?? randomUUID()
    const name = stripServerPrefix(rawName, this.serverNames)
    const state = isObject(part.state) ? part.state : {}
    const status = str(state.status) ?? 'completed'
    const input = state.input ?? {}
    let summary: string
    if (rawName === 'websearch') summary = truncate(asText(get(input, 'query')), 120)
    else if (rawName === 'webfetch') summary = truncate(asText(get(input, 'url')), 120)
    else summary = summarizeArguments(input)
    s.events.push({ type: 'toolStarted', id, name, summary })
    const ok = status === 'completed'
    const resultText = ok ? str(state.output) ?? '' : str(state.error) ?? ''
    s.events.push({ type: 'toolFinished', id, name, ok, summary: summarizeResult(resultText) })
    // una herramienta peligrosa que SE EJECUTÓ es una violación; una denegada por permisos (error) es lo esperado
    const isWeb = rawName === 'websearch' || rawName === 'webfetch'
    if (ok && (OPENCODE_DANGEROUS_BUILTINS.has(rawName) || (isWeb && !this.allowWeb))) {
      s.violation = tr(`OpenCode ejecutó una herramienta que no está permitida (${rawName}). Se detuvo la ejecución por seguridad.`, `OpenCode ran a tool that isn’t allowed (${rawName}). The run was stopped for security.`)
    }
  }

  private consumeStepFinish(part: unknown): void {
    // solo vale el cierre del paso más reciente; un nuevo step_start lo vuelve a dejar pendiente
    this.lastReason = str(get(part, 'reason'))
    const tokens = get(part, 'tokens')
    if (!isObject(tokens)) return
    const cacheRead = int(get(tokens, 'cache', 'read')) ?? 0
    const cacheWrite = int(get(tokens, 'cache', 'write')) ?? 0
    const add: Usage = {
      promptTokens: (int(tokens.input) ?? 0) + cacheRead + cacheWrite,
      completionTokens: int(tokens.output) ?? 0,
      reasoningTokens: int(tokens.reasoning) ?? 0,
      cachedTokens: cacheRead,
      cacheWriteTokens: cacheWrite
    }
    this.usage = addUsage(this.usage, add)
  }

  private consumeError(error: unknown): void {
    if (!isObject(error)) return
    const name = str(error.name) ?? 'Error'
    if (name === 'MessageAbortedError') return
    const message = str(get(error, 'data', 'message')) ?? name
    const status = int(get(error, 'data', 'statusCode'))
    let kind: AgentErrorKind | undefined
    if (name === 'ProviderAuthError' || status === 401 || status === 403) kind = 'notLoggedIn'
    else if (status === 429) kind = 'rateLimited'
    else if (name === 'ContextOverflowError') kind = 'badResponse'
    this.errors.push({ message, kind })
  }

  /** El último error que anunció OpenCode (sin sesión, 429…), si se quedó sin responder. */
  stallFailure(): CLIFailure | undefined {
    const last = this.errors[this.errors.length - 1]
    return last ? { message: last.message, kind: last.kind } : undefined
  }

  conclude(): CLIConclusion {
    if (this.errors.length > 0) {
      return { type: 'failed', failure: { message: this.errors.map((e) => e.message).join('\n'), kind: this.errors[0].kind } }
    }
    if (!this.started || !this.lastReason || !this.lastReason.trim()) return { type: 'noResult' }
    let stopReason = 'stop'
    if (this.lastReason === 'length') stopReason = 'length'
    else if (this.lastReason === 'tool-calls' || this.lastReason === 'tool_calls') stopReason = 'max_steps'
    return { type: 'finished', result: { text: this.lastText, steps: Math.max(this.steps, 1), usage: this.usage, stopReason, sessionID: this.sessionID } }
  }
}

/** `servidor_herramienta` → `herramienta`. */
export function stripServerPrefix(name: string, servers: string[]): string {
  for (const server of [...servers].sort((a, b) => b.length - a.length)) {
    if (name.startsWith(server + '_') && name.length > server.length + 1) return name.slice(server.length + 1)
  }
  return name
}

// MARK: Agente

export interface OpenCodeOptions {
  /** Variante del modelo (esfuerzo de razonamiento: `high`, `max`, `minimal`…). */
  variant?: string
  extraArguments?: string[]
  extraEnvironment?: Record<string, string>
}

export const OPENCODE_AGENT_NAME = 'aula'
export const OPENCODE_OPTIONAL_FLAGS = new Set(['--pure', '--thinking', '--variant'])
/** Por encima de esto (bytes) el prompt de sistema va en un archivo (en Windows el bloque de entorno es pequeño). */
export const OPENCODE_INLINE_PROMPT_LIMIT = isWindows ? 8_000 : 200_000

export function openCodeArguments(model: string | undefined, options: OpenCodeOptions, imagePaths: string[], dropping: ReadonlySet<string> = new Set()): string[] {
  const args = ['run', '--format', 'json']
  const addOptional = (flag: string, value?: string): void => {
    if (dropping.has(flag)) return
    args.push(flag)
    if (value !== undefined) args.push(value)
  }
  addOptional('--thinking')
  addOptional('--pure')
  args.push('--agent', OPENCODE_AGENT_NAME)
  if (model) args.push('--model', model)
  if (options.variant) addOptional('--variant', options.variant)
  for (const path of imagePaths) args.push('--file', path)
  args.push(...(options.extraArguments ?? []))
  return args
}

/** `promptFile`: archivo con el prompt de sistema (ya neutralizado) cuando es demasiado grande para ir en línea. */
export function openCodeTaskConfig(task: AgentTask, promptFile?: string): string {
  const marker = `__AULA_PROMPT_FILE_${randomUUID()}__`
  const json = openCodeConfigJSON(task.mcpServers ?? [], !!task.allowWeb, {
    name: OPENCODE_AGENT_NAME,
    prompt: promptFile ? marker : task.system,
    steps: Math.max(1, task.maxSteps ?? DEFAULT_MAX_STEPS),
    temperature: task.temperature
  })
  if (!promptFile) return json
  // la referencia va DESPUÉS de neutralizar `{file:` (si no, OpenCode no la expandiría)
  const reference = JSON.stringify(`{file:${promptFile}}`).slice(1, -1)
  return json.replace(marker, () => reference)
}

export function openCodeEnvironment(task: AgentTask, options: OpenCodeOptions, workingDirectory: string, promptFile?: string): Record<string, string> {
  return {
    OPENCODE_CONFIG_CONTENT: openCodeTaskConfig(task, promptFile),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1', // no leer ~/.claude/CLAUDE.md ni skills de Claude Code
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_DISABLE_TERMINAL_TITLE: '1',
    PWD: workingDirectory, // OpenCode usa PWD antes que getcwd()
    ...(options.extraEnvironment ?? {})
  }
}

export class OpenCodeRunner implements AgentRunner {
  constructor(
    readonly config: CLIAgentConfig,
    private readonly options: OpenCodeOptions = {}
  ) {}

  run(task: AgentTask, signal?: AbortSignal): AsyncIterableIterator<AgentEvent> {
    return eventStream<AgentEvent>((emit, sig) => this.execute(task, emit, sig), signal)
  }

  private async execute(task: AgentTask, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    const classifier = CLIErrorClassifier.openCode
    await prepareLocator()
    const executable = findExecutable('opencode', this.config.executablePath)
    if (!executable) throw classifier.notInstalled
    if (!fullPrompt(task).trim() && !task.images?.length) throw new AgentError('other', AgentL10n.emptyPrompt(classifier.cliName))
    const model = effectiveModel(task, this.config)
    const options: OpenCodeOptions = { ...this.options, variant: this.options.variant ?? savedEffort(this.config, model) }
    if (model && !model.includes('/')) {
      throw new AgentError(
        'unsupported',
        tr(
          `El modelo de OpenCode debe escribirse como «proveedor/modelo» (por ejemplo \`anthropic/claude-sonnet-4-5\` u \`opencode/grok-code\`), no «${model}». Corrígelo en ${settingsPath('ai', 'es')}.`,
          `The OpenCode model must be written as “provider/model” (for example \`anthropic/claude-sonnet-4-5\` or \`opencode/grok-code\`), not “${model}”. Fix it in ${settingsPath('ai', 'en')}.`
        )
      )
    }
    if ((task.inProcessToolCount ?? 0) > 0 && !task.mcpServers?.length) emit({ type: 'notice', text: AgentL10n.inProcessToolsUnsupported(classifier.cliName) })
    const sandbox = new AgentSandbox(task.workingDirectory)
    try {
      const imagePaths = sandbox.writeImages(task.images ?? [])
      // un prompt de sistema muy grande no cabe en el entorno: va en un archivo que la configuración referencia con `{file:…}`
      const promptFile = Buffer.byteLength(task.system, 'utf8') > OPENCODE_INLINE_PROMPT_LIMIT ? sandbox.write(defuseOpenCode(task.system), 'system-prompt.md') : undefined
      const dropped = new Set<string>()
      for (let attempt = 0; attempt < 5; attempt++) {
        const invocation = {
          executable,
          arguments: openCodeArguments(model, options, imagePaths, dropped),
          environment: childEnvironment(openCodeEnvironment(task, this.options, sandbox.workingDirectory, promptFile)),
          workingDirectory: sandbox.workingDirectory,
          stdin: fullPrompt(task)
        }
        const parser = new OpenCodeEventParser(this.config.displayName || 'OpenCode', model ?? '', (task.mcpServers ?? []).map((s) => sanitizeName(s.name)), !!task.allowWeb)
        try {
          await runCLI(invocation, parser, classifier, { timeoutMs: task.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal, emit })
          return
        } catch (err) {
          if (!(err instanceof AgentError)) throw err
          const flag = droppableFlag(err, OPENCODE_OPTIONAL_FLAGS, dropped)
          if (flag) {
            if (flag === '--variant' && options.variant) {
              throw new AgentError(
                'unsupported',
                tr(
                  'La versión instalada de OpenCode no permite elegir la variante de razonamiento. Actualiza OpenCode o elige Automático junto al modelo.',
                  'The installed version of OpenCode doesn’t let you choose the reasoning variant. Update OpenCode or choose Automatic next to the model.'
                )
              )
            }
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
