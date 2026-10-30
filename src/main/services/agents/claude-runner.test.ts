// Port de `Tests/AgentKitTests/ClaudeCodeRunnerTests.swift`: `ClaudeCodeRunner` contra una `claude` falsa (guion bash) que
// registra cómo la llaman y emite salidas reales o sintéticas.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeCodeRunner, mcpToolNamesNote, type ClaudeCodeOptions } from './claude'
import { engineSettings } from './engine'
import { AgentError } from './errors'
import { locatorOverrides } from './locator'
import { SHARED_WORK_NAME } from './sandbox'
import type { AgentTask, CLIAgentConfig, MCPServerSpec } from './types'
import { ClaudeEvents as E, FakeCLI, cleanupTempDirs, collect, fixture, makeTempDir, processExists, waitUntil, posixIt, isWindows } from './__fixtures__/support'

const TEXT_OK = fixture('claude-text-ok.jsonl')
const MAX_TURNS = fixture('claude-mcp-tool-max-turns.jsonl')
const NOT_LOGGED_IN = fixture('claude-not-logged-in.jsonl')

function config(cli?: FakeCLI, o: { path?: string; model?: string; effort?: string } = {}): CLIAgentConfig {
  return { id: 'claude-code', kind: 'claude', displayName: 'Claude Code', model: o.model ?? '', executablePath: o.path ?? cli?.executable, reasoningEffort: o.effort }
}

function task(o: Partial<AgentTask> & { timeout?: number; steps?: number; servers?: MCPServerSpec[]; web?: boolean } = {}): AgentTask {
  return {
    id: 't1',
    system: o.system ?? 'SYS',
    prompt: o.prompt ?? 'Hola',
    images: o.images ?? [],
    mcpServers: o.servers ?? [],
    allowWeb: o.web ?? false,
    model: 'model' in o ? o.model : 'haiku',
    maxSteps: o.steps ?? 7,
    timeoutMs: (o.timeout ?? 20) * 1000,
    workingDirectory: o.workingDirectory,
    maxOutputTokens: o.maxOutputTokens,
    inProcessToolCount: o.inProcessToolCount
  }
}

const runner = (cli?: FakeCLI, options: ClaudeCodeOptions = {}, cfg?: CLIAgentConfig): ClaudeCodeRunner => new ClaudeCodeRunner(cfg ?? config(cli), options)
const agentError = (err: unknown): AgentError | undefined => (err instanceof AgentError ? err : undefined)
const fullFlow = (): string => E.fullToolFlow().join('\n') + '\n'

beforeEach(() => {
  locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
  locatorOverrides.searchDirectories = ['/usr/bin', '/bin'] // sin `claude` real del usuario
  engineSettings.postResultGraceMs = 10_000
})
afterEach(() => {
  locatorOverrides.loginPATH = undefined
  locatorOverrides.searchDirectories = undefined
  engineSettings.postResultGraceMs = 10_000
})
afterAll(() => cleanupTempDirs())

describe('ClaudeCodeRunner · línea de órdenes', () => {
  it('tarea simple (golden)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(cli.arguments).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt', 'SYS', '--model', 'haiku', '--max-turns', '7', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
      '--tools', '', '--disallowedTools',
      'Bash,BashOutput,KillShell,PowerShell,REPL,Edit,MultiEdit,Write,NotebookEdit,Read,Glob,Grep,LS,Task,Agent,Skill,SlashCommand,WebSearch,WebFetch',
      '--strict-mcp-config', '--setting-sources', 'user', '--disable-slash-commands', '--no-session-persistence'
    ])
    expect(cli.stdin).toBe('Hola') // el prompt va por stdin, no en la línea de órdenes
  })

  it('con servidores MCP y web', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const servers: MCPServerSpec[] = [
      { name: 'aula', command: '/usr/bin/aula-mcp', args: ['--store', '/tmp/s'], env: { A: '1' } },
      { name: 'mi canvas.v2', command: 'npx', args: ['-y', 'canvas-mcp'] }
    ]
    const run = await collect(runner(undefined, {}, config(cli, { model: 'sonnet' })).run(task({ servers, web: true, model: undefined })))
    expect(run.error).toBeUndefined()
    expect(cli.valueAfter('--model')).toBe('sonnet') // sin modelo en la tarea, el de la configuración
    expect(cli.valueAfter('--tools')).toBe('WebSearch,WebFetch')
    expect(cli.valueAfter('--allowedTools')).toBe('mcp__aula__*,mcp__mi_canvas_v2__*,WebSearch,WebFetch')
    expect(cli.valueAfter('--disallowedTools')).not.toContain('WebSearch')
    expect(cli.arguments).toContain('--strict-mcp-config')
    expect(cli.valueAfter('--mcp-config')).toBeDefined()
    const mcp = cli.mcpConfig as { mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> }
    expect(mcp.mcpServers.aula.command).toBe('/usr/bin/aula-mcp')
    expect(mcp.mcpServers.aula.args).toEqual(['--store', '/tmp/s'])
    expect(mcp.mcpServers.aula.env?.A).toBe('1')
    expect(mcp.mcpServers['mi canvas.v2'].command).toBe('npx')
    if (!isWindows) expect(cli.mcpConfigPermissions).toBe('600') // puede llevar credenciales: solo lo lee el usuario (en Windows, la ACL de su carpeta)
  })

  it('con servidores MCP el prompt de sistema dice cómo se llaman sus herramientas aquí (mcp__aula__…)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: '/usr/bin/aula-mcp' }] })))
    const system = cli.valueAfter('--system-prompt') ?? ''
    expect(system.startsWith('SYS\n\n# Tool names in this session')).toBe(true)
    expect(system).toContain('`mcp__aula__<name>`')
    expect(system).toContain('`search_sources` is `mcp__aula__search_sources`')
    expect(system).toContain('valid JSON object')
    // sin servidores, el prompt va tal cual
    expect(mcpToolNamesNote([])).toBe('')
    expect(mcpToolNamesNote(['aula', 'mi_canvas_v2'])).toContain('`mcp__mi_canvas_v2__…`')
  })

  it('las opciones de seguridad están siempre', async () => {
    const dir = makeTempDir()
    for (const web of [false, true]) {
      for (const servers of [[], [{ name: 'x', command: 'y' }]] as MCPServerSpec[][]) {
        const cli = new FakeCLI(dir, { name: `claude-${web}-${servers.length}`, stdout: TEXT_OK })
        await collect(runner(cli).run(task({ servers, web })))
        const args = cli.arguments
        expect(cli.valueAfter('--permission-mode')).toBe('dontAsk')
        expect(cli.valueAfter('--permission-prompts')).toBe('none')
        expect(args).toContain('--strict-mcp-config')
        expect(args).toContain('--tools')
        const denied = new Set((cli.valueAfter('--disallowedTools') ?? '').split(','))
        for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Read']) expect(denied.has(t)).toBe(true)
        expect(args).not.toContain('--dangerously-skip-permissions')
        expect(args).not.toContain('--allow-dangerously-skip-permissions')
        expect(cli.valueAfter('--tools') === '').toBe(!web)
        if (servers.length === 0 && !web) expect(args).not.toContain('--allowedTools')
      }
    }
  })

  it('--max-turns acotado y sin --model si no hay', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    for (const [steps, expected] of [[0, '1'], [-5, '1'], [40, '40'], [5000, '1000']] as const) {
      await collect(runner(cli).run(task({ model: undefined, steps })))
      expect(cli.valueAfter('--max-turns')).toBe(expected)
      expect(cli.valueAfter('--model')).toBeUndefined()
    }
  })

  it('reanudar sesión, esfuerzo, extras y persistencia', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    await collect(runner(cli, { resumeSessionID: 'abc-123', effort: 'low', extraArguments: ['--foo', 'bar'], extraEnvironment: { MI_VAR: 'x' } }).run(task()))
    expect(cli.valueAfter('--resume')).toBe('abc-123')
    expect(cli.arguments).not.toContain('--no-session-persistence')
    expect(cli.valueAfter('--effort')).toBe('low')
    expect(cli.arguments.slice(-2)).toEqual(['--foo', 'bar'])
    expect(cli.environment.MI_VAR).toBe('x')
    await collect(runner(cli, { persistSession: true }).run(task()))
    expect(cli.arguments).not.toContain('--no-session-persistence')
    expect(cli.arguments).not.toContain('--resume')
  })

  it('el esfuerzo guardado del modelo llega a la CLI', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    await collect(runner(undefined, {}, config(cli, { model: 'sonnet', effort: 'max' })).run(task({ model: undefined })))
    expect(cli.valueAfter('--effort')).toBe('max')
    await collect(runner(undefined, {}, config(cli, { model: 'sonnet', effort: 'auto' })).run(task({ model: undefined })))
    expect(cli.valueAfter('--effort')).toBeUndefined()
  })

  posixIt('una CLI antigua sin --effort lo dice en vez de quitarlo', async () => {
    const before = `for a in "$@"; do if [ "$a" = "--effort" ]; then echo "error: unknown option '--effort'" >&2; exit 1; fi; done`
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK, before })
    const run = await collect(runner(undefined, {}, config(cli, { model: 'sonnet', effort: 'high' })).run(task({ model: undefined })))
    expect(agentError(run.error)?.kind).toBe('unsupported')
    expect(agentError(run.error)?.message).toContain('Automático')
  })

  it('un prompt de sistema enorme va en un archivo', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const big = 'Instrucción larga. '.repeat(10_000)
    await collect(runner(cli).run(task({ system: big })))
    expect(cli.valueAfter('--system-prompt')).toBeUndefined()
    expect(cli.valueAfter('--system-prompt-file')).toBeDefined()
    expect(cli.systemPromptFile).toBe(big)
  })

  it('un prompt de sistema con guion y caracteres especiales llega tal cual', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const system = `- Eres un tutor.\n"Comillas" y 'apóstrofos', $HOME \`backticks\` \\barra ñ 日本`
    await collect(runner(cli).run(task({ system })))
    expect(cli.valueAfter('--system-prompt')).toBe(system)
  })
})

describe('ClaudeCodeRunner · entrada', () => {
  it('el prompt llega por stdin con cualquier carácter', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const prompt = 'Línea 1\n\n\\frac{1}{2} y "comillas" $(rm -rf /) `x` ñandú 日本語 🙂\n' + 'Relleno '.repeat(20_000)
    await collect(runner(cli).run(task({ prompt })))
    expect(cli.stdin).toBe(prompt)
    expect(cli.arguments.some((a) => a.includes('frac'))).toBe(false)
  })

  it('las imágenes van como un mensaje de usuario stream-json', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    await collect(runner(cli).run(task({ prompt: '¿Qué ves?', images: [{ mediaType: 'image/png', base64: 'QUJD' }, { mediaType: 'image/jpeg', base64: Buffer.from([1, 2]).toString('base64') }] })))
    expect(cli.valueAfter('--input-format')).toBe('stream-json')
    const lines = cli.stdin.split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const message = JSON.parse(lines[0])
    expect(message.type).toBe('user')
    expect(message.message.role).toBe('user')
    const content = message.message.content
    expect(content).toHaveLength(3)
    expect(content[0].source.media_type).toBe('image/png')
    expect(content[0].source.data).toBe('QUJD')
    expect(content[1].source.media_type).toBe('image/jpeg')
    expect(content[2].text).toBe('¿Qué ves?')
  })

  it('un prompt vacío se rechaza sin lanzar la CLI', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const run = await collect(runner(cli).run(task({ prompt: '  \n ' })))
    expect(agentError(run.error)?.kind).toBe('other')
    expect(cli.arguments).toEqual([])
  })
})

describe('ClaudeCodeRunner · entorno y carpeta', () => {
  it('entorno limpio y carpeta de trabajo vacía y temporal', async () => {
    const vars = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_SESSION_ID: 'padre', MI_VARIABLE_DE_USUARIO: 'se-conserva' }
    Object.assign(process.env, vars)
    try {
      const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
      await collect(runner(cli).run(task()))
      const env = cli.environment
      expect(env.CLAUDECODE).toBeUndefined()
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
      expect(env.MI_VARIABLE_DE_USUARIO).toBe('se-conserva')
      expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
      expect(env.NO_COLOR).toBe('1')
      expect(env.PATH).toContain('/usr/bin')
      const cwd = cli.workingDirectory
      expect(env.PWD).toBe(cwd) // OpenCode usa PWD antes que getcwd
      expect(cwd).toContain('aula-agent-')
      if (basename(cwd) === SHARED_WORK_NAME) expect(readdirSync(cwd)).toEqual([])
      else expect(existsSync(cwd)).toBe(false)
    } finally {
      for (const k of Object.keys(vars)) delete process.env[k]
    }
  })

  it('una carpeta de trabajo explícita se usa y se conserva', async () => {
    const dir = makeTempDir()
    const work = makeTempDir()
    const cli = new FakeCLI(dir, { stdout: TEXT_OK })
    await collect(runner(cli).run(task({ workingDirectory: work })))
    expect(cli.workingDirectory).toBe(work)
    expect(existsSync(work)).toBe(true)
    const missing = await collect(runner(cli).run(task({ workingDirectory: join(dir, 'no-existe') })))
    expect(agentError(missing.error)?.kind).toBe('other')
    expect(agentError(missing.error)?.message).toContain('no existe')
  })

  it('maxOutputTokens → CLAUDE_CODE_MAX_OUTPUT_TOKENS', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    await collect(runner(cli).run(task({ maxOutputTokens: 4096 })))
    expect(cli.environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('4096')
  })
})

describe('ClaudeCodeRunner · eventos', () => {
  it('eventos en orden y fin con usage y finished', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: fullFlow() })
    const run = await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: 'x' }] })))
    expect(run.error).toBeUndefined()
    expect(run.kinds).toEqual(['started', 'reasoning', 'reasoning', 'text', 'text', 'toolStarted', 'toolFinished', 'text', 'text', 'text', 'usage', 'finished'])
    expect(run.text).toBe('Voy a crear la lección.\n\nListo, ya está.')
    expect(run.toolEvents).toEqual(['→ crear_leccion {"n":3,"titulo":"Círculo unidad"}', '← crear_leccion ok Lección creada ⏎ id=abc'])
    expect(run.finished?.text).toBe('Listo, ya está.')
    expect(run.finished?.steps).toBe(2)
    expect(run.finished?.sessionID).toBe('sess-1')
    expect(run.events[0]).toEqual({ type: 'started', provider: 'Claude Code', model: 'claude-haiku-4-5-20251001' })
  })

  it('max_turns con código 1 termina con max_steps', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: MAX_TURNS, exitCode: 1 })
    const run = await collect(runner(cli).run(task({ servers: [{ name: 'aulatest', command: 'x' }], steps: 1 })))
    expect(run.error).toBeUndefined()
    expect(run.finished?.stopReason).toBe('max_steps')
    expect(run.toolEvents).toHaveLength(2)
  })

  it('herramientas en proceso sin servidores → aviso', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const run = await collect(runner(cli).run(task({ inProcessToolCount: 1 })))
    expect(run.notices).toHaveLength(1)
    expect(run.notices[0]).toContain('mcpServers')
  })
})

describe('ClaudeCodeRunner · errores', () => {
  it('no instalada: con instrucciones', async () => {
    const run = await collect(runner(undefined, {}, config(undefined, { path: '/no/existe/claude' })).run(task()))
    expect(agentError(run.error)?.kind).toBe('notInstalled')
    expect(agentError(run.error)?.message).toContain('claude.ai/install.sh')
    expect(run.events).toEqual([])
  })

  posixIt('sin red: la CLI que se queda reintentando se corta en segundos con un error de red', async () => {
    const retries = [1, 2, 3, 4].map((attempt) => E.line({ type: 'system', subtype: 'api_retry', attempt, max_retries: 10, error_status: null, error: 'unknown' }))
    // tras los reintentos la CLI de verdad seguiría esperando minutos: aquí, 60 s
    const cli = new FakeCLI(makeTempDir(), { stdout: [E.initEvent(), ...retries].join('\n') + '\n', after: 'sleep 60' })
    const started = Date.now()
    const run = await collect(runner(cli).run(task({ timeout: 120 })))
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(agentError(run.error)?.kind).toBe('network')
    expect(agentError(run.error)?.message).toContain('no pudo conectarse a internet')
    expect(run.events.some((e) => e.type === 'notice' && e.text.includes('No hay conexión con Claude'))).toBe(true)
  })

  it('sin sesión', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: NOT_LOGGED_IN, exitCode: 1 })
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('notLoggedIn')
    expect(agentError(run.error)?.message).toContain('Abre Terminal y ejecuta `claude` para iniciar sesión')
    expect(run.finished).toBeUndefined()
  })

  it('límite de uso con la espera en el mensaje', async () => {
    const lines = [E.initEvent(), E.assistant('m', [E.textBlock("You've hit your limit · try again in 2 hours 30 minutes")], 'rate_limit'), E.result({ isError: true, text: "You've hit your limit · try again in 2 hours 30 minutes" })]
    const cli = new FakeCLI(makeTempDir(), { stdout: lines.join('\n') + '\n', exitCode: 1 })
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('rateLimited')
    expect(Math.abs((agentError(run.error)?.retryAfter ?? 0) - 9000)).toBeLessThan(5)
    expect(agentError(run.error)?.message).toContain('2 h 30 min')
  })

  it('una salida que no es JSON es una respuesta mala', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: 'Hola, soy una salida de texto normal\nsin ningún JSON\n' })
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('badResponse')
    expect(agentError(run.error)?.message).toContain('salida que no entiendo')
  })

  it('JSONL cortado sin result es un error (lo anterior sí se entregó)', async () => {
    const flow = E.fullToolFlow()
    const truncated = flow.slice(0, -1).join('\n') + '\n' + flow[flow.length - 1].slice(0, 40)
    const cli = new FakeCLI(makeTempDir(), { stdout: truncated })
    const run = await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: 'x' }] })))
    expect(agentError(run.error)?.kind).toBe('badResponse')
    expect(run.finished).toBeUndefined()
    expect(run.text).not.toBe('')
  })

  it('una última línea cortada tras el result sigue terminando bien', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: fullFlow() + '{"type":"system","subty' })
    const run = await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: 'x' }] })))
    expect(run.error).toBeUndefined()
    expect(run.finished).toBeDefined()
  })

  it('un fallo con solo stderr lo cuenta', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: 'Error: algo muy raro ha pasado\n', exitCode: 3 })
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('other')
    expect(agentError(run.error)?.message).toContain('algo muy raro')
  })

  it('una salida vacía con éxito es una respuesta mala', async () => {
    const cli = new FakeCLI(makeTempDir())
    expect(agentError((await collect(runner(cli).run(task()))).error)?.kind).toBe('badResponse')
  })

  it('un error de autenticación solo en stderr se reconoce', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: 'Invalid API key · Please run /login\n', exitCode: 1 })
    expect(agentError((await collect(runner(cli).run(task()))).error)?.kind).toBe('notLoggedIn')
  })

  posixIt('una avalancha en stderr queda acotada y no bloquea', async () => {
    const cli = new FakeCLI(makeTempDir(), { before: "head -c 20000000 /dev/zero | tr '\\0' 'e' >&2; echo ' FIN-STDERR' >&2; exit 4" })
    const started = Date.now()
    const run = await collect(runner(cli).run(task()))
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(agentError(run.error)?.kind).toBe('other')
    const message = agentError(run.error)?.message ?? ''
    expect(Array.from(message).length).toBeLessThan(4000)
    expect(message).toContain('FIN-STDERR')
  })

  it('mucha salida por stdout', async () => {
    const filler = Array.from({ length: 3000 }, () => E.line({ type: 'system', subtype: 'relleno', datos: 'x'.repeat(300) })).join('\n')
    const cli = new FakeCLI(makeTempDir(), { stdout: filler + '\n' + TEXT_OK })
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(run.finished?.text).toBe('OK')
  })

  it('una línea demasiado larga se descarta con un aviso', async () => {
    const huge = '{"type":"system","subtype":"enorme","x":"' + 'y'.repeat(17 * 1024 * 1024) + '"}'
    const cli = new FakeCLI(makeTempDir(), { stdout: huge + '\n' + TEXT_OK })
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(run.finished?.text).toBe('OK')
    expect(run.notices.some((n) => n.includes('demasiado larga'))).toBe(true)
  })
})

describe('ClaudeCodeRunner · versiones antiguas', () => {
  posixIt('una opción opcional desconocida se quita y se reintenta', async () => {
    const before = `for a in "$@"; do
  if [ "$a" = "--permission-prompts" ]; then echo "error: unknown option '--permission-prompts'" >&2; exit 1; fi
  if [ "$a" = "--disable-slash-commands" ]; then echo "error: unknown option '--disable-slash-commands'" >&2; exit 1; fi
done`
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK, before })
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(run.finished?.text).toBe('OK')
    expect(cli.calls).toHaveLength(3) // primer intento + un reintento por cada opción desconocida
    expect(cli.arguments).not.toContain('--permission-prompts')
    expect(cli.arguments).not.toContain('--disable-slash-commands')
    expect(cli.arguments).toContain('--strict-mcp-config')
    expect(cli.valueAfter('--permission-mode')).toBe('dontAsk')
  })

  it('una opción esencial desconocida es «no compatible»', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: "error: unknown option '--strict-mcp-config'\n", exitCode: 1 })
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('unsupported')
    expect(agentError(run.error)?.message).toContain('--strict-mcp-config')
    expect(agentError(run.error)?.message).toContain('claude update')
    expect(cli.calls).toHaveLength(1)
  })

  posixIt('--permission-mode vuelve a default en versiones antiguas', async () => {
    const before = `for a in "$@"; do
  if [ "$a" = "dontAsk" ]; then echo "error: option '--permission-mode <mode>' argument 'dontAsk' is invalid. Allowed choices are acceptEdits, bypassPermissions, default, plan." >&2; exit 1; fi
done`
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK, before })
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(cli.valueAfter('--permission-mode')).toBe('default')
    expect(cli.arguments).toContain('--disallowedTools')
  })
})

describe('ClaudeCodeRunner · seguridad, tiempo, cancelación y procesos', () => {
  const pidOf = (path: string): number => Number(readFileSync(path, 'utf8').trim())

  posixIt('herramientas peligrosas en init detienen la ejecución (y a todo el grupo)', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const cli = new FakeCLI(dir, { stdout: E.initEvent({ tools: ['Bash', 'mcp__x__y'] }) + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const started = Date.now()
    const run = await collect(runner(cli).run(task()))
    expect(agentError(run.error)?.kind).toBe('other')
    expect(agentError(run.error)?.message).toContain('por seguridad')
    expect(Date.now() - started).toBeLessThan(8000)
    const pid = pidOf(pidFile)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('el plazo mata al grupo de procesos', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'nieto.pid')
    const cli = new FakeCLI(dir, { stdout: E.initEvent() + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const started = Date.now()
    const run = await collect(runner(cli).run(task({ timeout: 0.8 })))
    expect(agentError(run.error)?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(8000)
    expect(run.kinds).toContain('started')
    const pid = pidOf(pidFile)
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('cancelar mata al proceso y termina el flujo sin error', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'nieto.pid')
    const cli = new FakeCLI(dir, { stdout: E.initEvent() + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const controller = new AbortController()
    const consumer = collect(runner(cli).run(task({ timeout: 60 }), controller.signal))
    expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true)
    const pid = pidOf(pidFile)
    controller.abort()
    const outcome = await consumer
    expect(outcome.error).toBeUndefined()
    expect(await waitUntil(() => !processExists(pid), 6000)).toBe(true)
  })

  posixIt('dejar de iterar pronto mata al proceso', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'nieto.pid')
    const cli = new FakeCLI(dir, { stdout: E.initEvent() + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    for await (const _ of runner(cli).run(task({ timeout: 60 }))) break // el consumidor se va tras el primer evento
    expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true)
    const pid = pidOf(pidFile)
    expect(await waitUntil(() => !processExists(pid), 6000)).toBe(true)
  })

  posixIt('un proceso que se queda tras el result se termina pasada la gracia', async () => {
    engineSettings.postResultGraceMs = 400
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK, after: 'sleep 300' })
    const started = Date.now()
    const run = await collect(runner(cli).run(task()))
    expect(run.error).toBeUndefined()
    expect(run.finished?.text).toBe('OK')
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('los archivos temporales se borran aunque falle', async () => {
    const cli = new FakeCLI(makeTempDir(), { stderr: 'boom\n', exitCode: 2 })
    const run = await collect(runner(cli).run(task({ servers: [{ name: 'x', command: 'y', env: { TOKEN: 'secreto' } }] })))
    expect(run.error).toBeDefined()
    const mcpPath = cli.valueAfter('--mcp-config') ?? ''
    expect(mcpPath).not.toBe('')
    expect(existsSync(mcpPath)).toBe(false) // la configuración con credenciales no queda en disco
  })

  it('ejecuciones en paralelo no se estorban', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: TEXT_OK })
    const r = runner(cli)
    const runs = await Promise.all(Array.from({ length: 6 }, (_, i) => collect(r.run(task({ prompt: `p${i}` })))))
    for (const run of runs) {
      expect(run.error).toBeUndefined()
      expect(run.finished?.text).toBe('OK')
    }
  })
})
