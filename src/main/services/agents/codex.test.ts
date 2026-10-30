// Port de `Tests/AgentKitTests/CodexTests.swift`: analizador de `codex exec --json` y `CodexRunner` contra una CLI falsa.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexEventParser, CodexRunner, type CodexOptions } from './codex'
import type { CLIConclusion } from './engine'
import { AgentError, CLIErrorClassifier } from './errors'
import { locatorOverrides } from './locator'
import { SHARED_WORK_NAME } from './sandbox'
import { emptyUsage, type AgentEvent, type AgentTask, type CLIAgentConfig, type ImagePart, type MCPServerSpec } from './types'
import { FakeCLI, cleanupTempDirs, collect, makeTempDir, processExists, summarize, waitUntil, posixIt } from './__fixtures__/support'

/** Eventos de `codex exec --json` fieles al esquema de `codex-rs/exec/src/exec_events.rs`. */
const line = (v: unknown): string => JSON.stringify(v)
const C = {
  threadStarted: line({ type: 'thread.started', thread_id: '0199a213-81c0-7800-8aa1-bbab2a035a53' }),
  turnStarted: line({ type: 'turn.started' }),
  started: (item: unknown) => line({ type: 'item.started', item }),
  completed: (item: unknown) => line({ type: 'item.completed', item }),
  agentMessage: (id: string, text: string) => ({ id, type: 'agent_message', text }),
  reasoning: (id: string, text: string) => ({ id, type: 'reasoning', text }),
  mcpCall: (id: string, o: { server?: string; tool: string; arguments?: unknown; status?: string; resultText?: string; error?: string }) => ({
    id, type: 'mcp_tool_call', server: o.server ?? 'aula', tool: o.tool, arguments: o.arguments ?? {},
    result: o.resultText !== undefined ? { content: [{ type: 'text', text: o.resultText }], structured_content: null } : null,
    error: o.error !== undefined ? { message: o.error } : null,
    status: o.status ?? 'in_progress'
  }),
  webSearch: (id: string, query: string) => ({ id, type: 'web_search', query, action: { type: 'search', query } }),
  command: (id: string, command: string, status = 'in_progress') => ({ id, type: 'command_execution', command, aggregated_output: '', exit_code: null, status }),
  usage: (o: { input?: number; cached?: number; output?: number; reasoning?: number } = {}) => ({
    input_tokens: o.input ?? 24763, cached_input_tokens: o.cached ?? 24448, cache_write_input_tokens: 0, output_tokens: o.output ?? 122, reasoning_output_tokens: o.reasoning ?? 30
  }),
  turnCompleted: (usage?: unknown) => line({ type: 'turn.completed', usage: usage ?? C.usage() }),
  turnFailed: (message: string) => line({ type: 'turn.failed', error: { message } }),
  error: (message: string) => line({ type: 'error', message }),
  fullRun(): string[] {
    return [
      C.threadStarted, C.turnStarted,
      C.completed(C.reasoning('item_0', '**Planificando** la lección')),
      C.started(C.mcpCall('item_1', { tool: 'buscar_en_fuentes', arguments: { consulta: 'círculo unidad' } })),
      C.completed(C.mcpCall('item_1', { tool: 'buscar_en_fuentes', arguments: { consulta: 'círculo unidad' }, status: 'completed', resultText: '3 fragmentos encontrados\nfuente: libro.pdf' })),
      C.started(C.webSearch('item_2', 'círculo unidad')), C.completed(C.webSearch('item_2', 'círculo unidad')),
      C.started(C.mcpCall('item_3', { tool: 'crear_leccion', arguments: { titulo: 'X' } })),
      C.completed(C.mcpCall('item_3', { tool: 'crear_leccion', arguments: { titulo: 'X' }, status: 'failed', error: 'JSON inválido' })),
      C.completed(C.agentMessage('item_4', 'He creado la lección.')),
      C.turnCompleted()
    ]
  }
}

function run(lines: string[], maxToolCalls = 100): { events: AgentEvent[]; violation?: string; conclusion: CLIConclusion; stop: boolean } {
  const parser = new CodexEventParser('Codex', '', maxToolCalls)
  const events: AgentEvent[] = []
  let violation: string | undefined
  let stop = false
  for (const l of lines) {
    const s = parser.consume(l)
    events.push(...s.events)
    violation ??= s.violation
    stop = stop || !!s.stopNow
  }
  return { events, violation, conclusion: parser.conclude(), stop }
}

function finished(c: CLIConclusion) {
  if (c.type !== 'finished') throw new Error(`se esperaba fin normal y fue ${c.type}`)
  return c.result
}

describe('CodexEventParser', () => {
  it('ejecución completa', () => {
    const o = run(C.fullRun())
    expect(o.violation).toBeUndefined()
    expect(summarize(o.events).toolEvents).toEqual([
      '→ buscar_en_fuentes {"consulta":"círculo unidad"}', '← buscar_en_fuentes ok 3 fragmentos encontrados ⏎ fuente: libro.pdf',
      '→ web_search círculo unidad', '← web_search ok círculo unidad',
      '→ crear_leccion {"titulo":"X"}', '← crear_leccion error JSON inválido'
    ])
    expect(summarize(o.events).kinds).toEqual(['started', 'reasoning', 'toolStarted', 'toolFinished', 'toolStarted', 'toolFinished', 'toolStarted', 'toolFinished', 'text'])
    expect(o.events[0]).toEqual({ type: 'started', provider: 'Codex', model: 'predeterminado' })
    const r = finished(o.conclusion)
    expect(r.text).toBe('He creado la lección.')
    expect(r.stopReason).toBe('stop')
    expect(r.sessionID).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53')
    expect(r.steps).toBe(4)
    expect(r.usage).toEqual({ ...emptyUsage(), promptTokens: 24763, completionTokens: 122, reasoningTokens: 30, cachedTokens: 24448 })
  })

  it('la muestra de la documentación con una orden es una violación', () => {
    const sample = [
      '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}',
      '{"type":"turn.started"}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Repo contains docs, sdk, and examples directories."}}',
      '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}'
    ]
    const o = run(sample)
    expect(o.violation).toContain('bash -lc ls')
    const r = finished(o.conclusion) // el resto se entiende igual (sin cache_write_input_tokens)
    expect(r.text).toBe('Repo contains docs, sdk, and examples directories.')
    expect(r.usage.promptTokens).toBe(24763)
  })

  it('cambios de archivos y subagentes son violaciones', () => {
    expect(run([C.completed({ id: 'i', type: 'file_change', changes: [{ path: '/tmp/x', kind: 'add' }], status: 'completed' })]).violation).toBeDefined()
    expect(run([C.started({ id: 'i', type: 'collab_tool_call', tool: 'spawn_agent', status: 'in_progress' })]).violation).toBeDefined()
    expect(run([C.completed(C.command('i', 'rm -rf /', 'declined'))]).violation).toBeDefined()
  })

  it('varios mensajes del agente se separan', () => {
    const o = run([C.threadStarted, C.completed(C.agentMessage('a', 'Primero.')), C.completed(C.agentMessage('b', 'Segundo.')), C.turnCompleted()])
    expect(summarize(o.events).text).toBe('Primero.\n\nSegundo.')
    expect(finished(o.conclusion).text).toBe('Segundo.') // el texto final es el último mensaje
  })

  it('los reintentos son avisos, no fallos', () => {
    const o = run([C.threadStarted, C.error('Reconnecting... 1/5'), C.error('Reconnecting... 1/5'), C.error('Reconnecting... 2/5'), C.completed(C.agentMessage('a', 'Hecho')), C.turnCompleted()])
    expect(summarize(o.events).notices).toEqual(['Reconnecting... 1/5', 'Reconnecting... 2/5'])
    expect(o.conclusion.type).toBe('finished')
  })

  it('turn.failed es un fallo', () => {
    const o = run([C.threadStarted, C.turnStarted, C.error('stream error'), C.turnFailed('unexpected status 401 Unauthorized')])
    expect(o.conclusion.type).toBe('failed')
    const f = o.conclusion.type === 'failed' ? o.conclusion.failure : undefined
    expect(f?.message).toBe('unexpected status 401 Unauthorized')
    expect(CLIErrorClassifier.codex.classify(f?.message ?? '').kind).toBe('notLoggedIn')
  })

  it('un error fatal sin turn.failed falla', () => {
    const c = run([C.threadStarted, C.error('model not found')]).conclusion
    expect(c.type === 'failed' ? c.failure.message : '').toBe('model not found')
  })

  it('sin eventos no hay resultado', () => {
    expect(run([]).conclusion.type).toBe('noResult')
    expect(run([C.threadStarted, C.turnStarted]).conclusion.type).toBe('noResult')
  })

  it('el tope de herramientas corta con max_steps', () => {
    const lines = [C.threadStarted]
    for (let i = 0; i < 5; i++) lines.push(C.completed(C.mcpCall(`c${i}`, { tool: 't', status: 'completed', resultText: 'r' })))
    lines.push(C.completed(C.agentMessage('m', 'nunca llega')))
    const o = run(lines, 3)
    expect(o.stop).toBe(true)
    const r = finished(o.conclusion)
    expect(r.stopReason).toBe('max_steps')
    expect(r.steps).toBe(4) // 3 herramientas + 1; lo posterior al corte se ignora
    expect(summarize(o.events).notices.some((n) => n.includes('máximo de pasos'))).toBe(true)
  })

  it('una herramienta sin item.started da los dos eventos', () => {
    const o = run([C.completed(C.mcpCall('x', { tool: 'solo_completada', status: 'completed', resultText: 'ok' })), C.turnCompleted()])
    expect(summarize(o.events).toolEvents).toEqual(['→ solo_completada ', '← solo_completada ok ok'])
  })

  it('items de error, desconocidos y eventos nuevos', () => {
    const o = run([
      C.threadStarted,
      C.completed({ id: 'e', type: 'error', message: 'model rerouted: a -> b' }),
      C.completed({ id: 't', type: 'todo_list', items: [{ text: 'paso', completed: false }] }),
      C.completed({ id: 'n', type: 'tipo_nuevo_desconocido' }),
      line({ type: 'item.updated', item: { id: 't', type: 'todo_list', items: [] } }),
      line({ type: 'evento.nuevo', x: 1 }),
      C.turnCompleted()
    ])
    expect(summarize(o.events).notices).toEqual(['model rerouted: a -> b'])
    expect(o.violation).toBeUndefined()
  })

  it('las líneas basura se ignoran y se guardan de muestra', () => {
    const parser = new CodexEventParser('Codex', '', 10)
    for (const l of ['', 'Reading prompt from stdin...', '{roto', '[1]', 'null']) expect(parser.consume(l).events).toEqual([])
    expect(parser.unparsedSample).toContain('Reading prompt from stdin')
  })

  it('el «id» repetido de web_search se tolera', () => {
    const l = '{"type":"item.completed","item":{"id":"item_2","type":"web_search","id":"ws_123","query":"seno de 30 grados","action":{"type":"search","query":"seno de 30 grados"}}}'
    expect(summarize(run([l]).events).toolEvents).toHaveLength(2)
  })

  it('sin usage y con un mensaje enorme', () => {
    const big = 'Texto largo. '.repeat(100_000)
    const r = finished(run([C.completed(C.agentMessage('a', big)), line({ type: 'turn.completed' })]).conclusion)
    expect(r.text).toBe(big)
    expect(r.usage).toEqual(emptyUsage())
  })
})

// MARK: Runner

function config(cli?: FakeCLI, o: { path?: string; model?: string; effort?: string } = {}): CLIAgentConfig {
  return { id: 'codex', kind: 'codex', displayName: 'Codex', model: o.model ?? '', executablePath: o.path ?? cli?.executable, reasoningEffort: o.effort }
}

function task(o: { prompt?: string; system?: string; servers?: MCPServerSpec[]; web?: boolean; model?: string; steps?: number; timeout?: number; images?: ImagePart[] } = {}): AgentTask {
  return {
    id: 't', system: o.system ?? 'SYS', prompt: o.prompt ?? 'Hola', images: o.images ?? [], mcpServers: o.servers ?? [], allowWeb: o.web ?? false,
    model: 'model' in o ? o.model : 'gpt-5', maxSteps: o.steps ?? 40, timeoutMs: (o.timeout ?? 20) * 1000
  }
}

const successOutput = (): string => C.fullRun().join('\n') + '\n'
const runner = (cli?: FakeCLI, options: CodexOptions = {}, cfg?: CLIAgentConfig): CodexRunner => new CodexRunner(cfg ?? config(cli), options)
const agentError = (err: unknown): AgentError | undefined => (err instanceof AgentError ? err : undefined)
const pidOf = (path: string): number => Number(readFileSync(path, 'utf8').trim())

describe('CodexRunner', () => {
  beforeEach(() => {
    locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
    locatorOverrides.searchDirectories = ['/usr/bin', '/bin']
  })
  afterEach(() => {
    locatorOverrides.loginPATH = undefined
    locatorOverrides.searchDirectories = undefined
  })
  afterAll(() => cleanupTempDirs())

  it('línea de órdenes de una tarea simple (golden)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task()))
    expect(r.error).toBeUndefined()
    expect(cli.arguments).toEqual([
      'exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--color', 'never',
      '--sandbox', 'read-only', '--model', 'gpt-5',
      '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
      '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false', '-c', 'features.multi_agent=false',
      '-c', 'features.apps=false', '-c', 'features.hooks=false',
      '-c', 'features.view_image=false', '-c', 'project_doc_max_bytes=0', '-c', 'model_reasoning_summary="auto"',
      '-c', 'developer_instructions="SYS"', '-'
    ])
    expect(cli.stdin).toBe('Hola')
  })

  it('con MCP, web e imágenes (golden)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const servers: MCPServerSpec[] = [{ name: 'aula', command: '/Applications/Aula.app/Contents/MacOS/aula-mcp', args: ['--home', '/Users/x/Aula "datos"'], env: { TOKEN: 'a"b\\c' } }]
    const images: ImagePart[] = [{ mediaType: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') }, { mediaType: 'image/jpeg', base64: Buffer.from([4, 5]).toString('base64') }]
    const r = await collect(runner(undefined, {}, config(cli, { model: 'o3' })).run(task({ servers, web: true, model: undefined, images })))
    expect(r.error).toBeUndefined()
    const args = cli.arguments
    expect(cli.valueAfter('--model')).toBe('o3')
    expect(args).toContain('web_search="live"')
    const imagePaths = args.flatMap((a, i) => (a === '--image' ? [args[i + 1]] : []))
    expect(imagePaths).toHaveLength(2)
    expect(imagePaths[0].endsWith('imagen-1.png')).toBe(true)
    expect(imagePaths[1].endsWith('imagen-2.jpg')).toBe(true)
    expect(args).toContain('mcp_servers.aula.command="/Applications/Aula.app/Contents/MacOS/aula-mcp"')
    expect(args).toContain('mcp_servers.aula.args=["--home", "/Users/x/Aula \\"datos\\""]')
    expect(args).toContain('mcp_servers.aula.env={ TOKEN = "a\\"b\\\\c" }')
    expect(args).toContain('mcp_servers.aula.default_tools_approval_mode="approve"')
    expect(args[args.length - 1]).toBe('-')
    expect(args.indexOf('--image')).toBeLessThan(args.indexOf('-')) // las imágenes antes del prompt
    expect(args[args.length - 2]).not.toBe('--image')
  })

  it('los refuerzos de seguridad están siempre', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    for (const web of [false, true]) {
      await collect(runner(cli).run(task({ web })))
      const args = cli.arguments
      expect(cli.valueAfter('--sandbox')).toBe('read-only')
      for (const o of ['features.shell_tool=false', 'features.unified_exec=false', 'features.multi_agent=false', 'features.apps=false', 'features.hooks=false', 'features.view_image=false', 'approval_policy="never"']) {
        expect(args, o).toContain(o)
      }
      expect(args.some((a) => a.startsWith('tools.view_image='))).toBe(false)
      expect(args).toContain('--ignore-user-config')
      for (const bad of ['--dangerously-bypass-approvals-and-sandbox', '--yolo', 'danger-full-access', 'workspace-write']) expect(args).not.toContain(bad)
      expect(args).toContain(`web_search="${web ? 'live' : 'disabled'}"`)
    }
  })

  it('entorno y carpeta de trabajo', async () => {
    process.env.CODEX_SANDBOX = 'seatbelt'
    process.env.CODEX_THREAD_ID = 'padre'
    try {
      const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
      await collect(runner(cli).run(task()))
      const env = cli.environment
      expect(env.CODEX_SANDBOX).toBeUndefined()
      expect(env.CODEX_THREAD_ID).toBeUndefined()
      expect(env.PWD).toBe(cli.workingDirectory)
      if (basename(cli.workingDirectory) === SHARED_WORK_NAME) expect(readdirSync(cli.workingDirectory)).toEqual([])
      else expect(existsSync(cli.workingDirectory)).toBe(false)
    } finally {
      delete process.env.CODEX_SANDBOX
      delete process.env.CODEX_THREAD_ID
    }
  })

  it('esfuerzo de razonamiento y extras', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(cli, { reasoningEffort: 'high', extraArguments: ['--oss'], extraEnvironment: { MI: 'x' } }).run(task()))
    expect(cli.arguments).toContain('model_reasoning_effort="high"')
    expect(cli.arguments.slice(-2)).toEqual(['--oss', '-'])
    expect(cli.environment.MI).toBe('x')
  })

  it('el esfuerzo guardado se envía y no pasa a otro modelo pedido', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const cfg = config(cli, { model: 'gpt-6.1-sol', effort: 'xhigh' })
    await collect(runner(undefined, {}, cfg).run(task({ model: undefined })))
    expect(cli.arguments).toContain('model_reasoning_effort="xhigh"')
    await collect(runner(undefined, {}, cfg).run(task({ model: 'plain' })))
    expect(cli.arguments.some((a) => a.startsWith('model_reasoning_effort='))).toBe(false)
  })

  it('un prompt de sistema enorme va por stdin', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const big = 'Instrucción. '.repeat(20_000)
    await collect(runner(cli).run(task({ prompt: 'Tarea', system: big })))
    expect(cli.arguments.some((a) => a.startsWith('developer_instructions'))).toBe(false)
    expect(cli.stdin.startsWith('<instrucciones>\n')).toBe(true)
    expect(cli.stdin.endsWith('</instrucciones>\n\nTarea')).toBe(true)
  })

  it('emite los eventos como los demás agentes', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task()))
    expect(r.error).toBeUndefined()
    expect(r.kinds[r.kinds.length - 1]).toBe('finished')
    expect(r.kinds[r.kinds.length - 2]).toBe('usage')
    expect(r.finished?.text).toBe('He creado la lección.')
  })

  it('no instalado', async () => {
    const r = await collect(runner(undefined, {}, config(undefined, { path: '/no/existe/codex' })).run(task()))
    expect(agentError(r.error)?.kind).toBe('notInstalled')
    expect(agentError(r.error)?.message).toContain('Conectar con ChatGPT')
  })

  it('sin sesión (por stderr)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: 'Not logged in. Run `codex login` first.\n', exitCode: 1 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('notLoggedIn')
    expect(agentError(r.error)?.message).toContain('Conectar con ChatGPT')
  })

  it('límite de uso con espera relativa', async () => {
    const message = "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 4 days 2 hours 9 minutes."
    const cli = new FakeCLI(makeTempDir(), { stdout: [C.threadStarted, C.error(message), C.turnFailed(message)].join('\n') + '\n', exitCode: 1 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('rateLimited')
    expect(Math.abs((agentError(r.error)?.retryAfter ?? 0) - (4 * 86_400 + 2 * 3_600 + 9 * 60))).toBeLessThan(5)
    expect(agentError(r.error)?.message).toContain('4 días 2 h')
  })

  it('turn.failed con un mensaje genérico', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: [C.threadStarted, C.turnFailed('The model `x` does not exist')].join('\n') + '\n', exitCode: 1 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('other')
    expect(agentError(r.error)?.message).toContain('does not exist')
  })

  posixIt('una opción opcional desconocida se quita y se reintenta', async () => {
    const before = `for a in "$@"; do
  if [ "$a" = "--ignore-user-config" ]; then printf "error: unexpected argument '--ignore-user-config' found\\n\\n  tip: to pass '--ignore-user-config' as a value, use '-- --ignore-user-config'\\n" >&2; exit 2; fi
done`
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput(), before })
    const r = await collect(runner(cli).run(task()))
    expect(r.error).toBeUndefined()
    expect(cli.calls).toHaveLength(2)
    expect(cli.arguments).not.toContain('--ignore-user-config')
    expect(cli.valueAfter('--sandbox')).toBe('read-only') // el sandbox de solo lectura nunca se retira
  })

  it('una opción esencial desconocida se informa', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: "error: unexpected argument '--sandbox' found\n", exitCode: 2 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('unsupported')
    expect(cli.calls).toHaveLength(1)
  })

  posixIt('ejecutar una orden detiene la ejecución (y al grupo)', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const output = [C.threadStarted, C.started(C.command('item_1', 'cat ~/.ssh/id_rsa'))].join('\n') + '\n'
    const cli = new FakeCLI(dir, { stdout: output, before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('other')
    expect(agentError(r.error)?.message).toContain('por seguridad')
    const pid = pidOf(pidFile)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('el tope de pasos para a un agente desbocado', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const lines = [C.threadStarted]
    for (let i = 0; i < 10; i++) lines.push(C.completed(C.mcpCall(`c${i}`, { tool: 't', status: 'completed', resultText: 'r' })))
    const cli = new FakeCLI(dir, { stdout: lines.join('\n') + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const started = Date.now()
    const r = await collect(runner(cli).run(task({ steps: 3 })))
    expect(r.error).toBeUndefined()
    expect(r.finished?.stopReason).toBe('max_steps')
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(r.toolEvents.filter((t) => t.startsWith('←'))).toHaveLength(3)
  })

  posixIt('el plazo y la cancelación matan al grupo', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const cli = new FakeCLI(dir, { stdout: C.threadStarted + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const r = await collect(runner(cli).run(task({ timeout: 0.7 })))
    expect(agentError(r.error)?.kind).toBe('timeout')
    const pid = pidOf(pidFile)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)

    rmSync(pidFile, { force: true })
    const controller = new AbortController()
    const consumer = collect(runner(cli).run(task({ timeout: 60 }), controller.signal))
    expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true)
    const pid2 = pidOf(pidFile)
    controller.abort()
    expect((await consumer).error).toBeUndefined()
    expect(await waitUntil(() => !processExists(pid2), 6000)).toBe(true)
  })
})
