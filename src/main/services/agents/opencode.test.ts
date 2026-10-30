// Port de `Tests/AgentKitTests/{OpenCodeTests,OpenCodeCompletionSafetyTests}.swift`: analizador de `opencode run --format json`,
// configuración efímera (OpenCode, Claude Code y Codex) y `OpenCodeRunner` contra una CLI falsa.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eventStream, runCLI, type CLIConclusion } from './engine'
import { AgentError, CLIErrorClassifier } from './errors'
import { locatorOverrides } from './locator'
import { claudeMCPConfig, codexMCPOverrides, openCodeConfigJSON, toml, tomlKey } from './mcp-config'
import { OpenCodeEventParser, OpenCodeRunner, stripServerPrefix, type OpenCodeOptions } from './opencode'
import type { AgentEvent, AgentTask, CLIAgentConfig, ImagePart, MCPServerSpec } from './types'
import { FakeCLI, cleanupTempDirs, collect, makeTempDir, processExists, summarize, waitUntil, posixIt } from './__fixtures__/support'

/** Eventos de `opencode run --format json` con la forma de los tipos del SDK (`TextPart`, `ToolPart`, `StepFinishPart`…). */
const SESSION = 'ses_2b1f0c7e4ffe6Nn8zq'
const O = {
  event: (type: string, fields: Record<string, unknown>) => JSON.stringify({ type, timestamp: 1_760_000_000_000, sessionID: SESSION, ...fields }),
  part: (type: string, fields: Record<string, unknown>) => ({ id: 'prt_1', sessionID: SESSION, messageID: 'msg_1', type, ...fields }),
  get stepStart() {
    return O.event('step_start', { part: O.part('step-start', {}) })
  },
  text: (text: string) => O.event('text', { part: O.part('text', { text, time: { start: 1, end: 2 } }) }),
  reasoning: (text: string) => O.event('reasoning', { part: O.part('reasoning', { text, time: { start: 1, end: 2 } }) }),
  tool(name: string, o: { callID?: string; status?: string; input?: unknown; output?: string; error?: string } = {}) {
    const status = o.status ?? 'completed'
    const state: Record<string, unknown> = { status, input: o.input ?? {}, time: { start: 1, end: 2 } }
    if (status === 'completed') Object.assign(state, { output: o.output ?? '', title: name, metadata: {} })
    if (o.error !== undefined) state.error = o.error
    return O.event('tool_use', { part: O.part('tool', { callID: o.callID ?? 'call_1', tool: name, state }) })
  },
  stepFinish: (o: { reason?: string; input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number } = {}) =>
    O.event('step_finish', {
      part: O.part('step-finish', {
        reason: o.reason ?? 'stop', cost: 0.01,
        tokens: { input: o.input ?? 100, output: o.output ?? 20, reasoning: o.reasoning ?? 5, cache: { read: o.cacheRead ?? 50, write: o.cacheWrite ?? 10 } }
      })
    }),
  error: (name: string, message: string, statusCode?: number) => O.event('error', { error: { name, data: { message, ...(statusCode !== undefined ? { statusCode } : {}) } } }),
  fullRun(): string[] {
    return [
      O.stepStart, O.reasoning('Necesito buscar en las fuentes.'),
      O.tool('aula_buscar_en_fuentes', { input: { consulta: 'círculo unidad' }, output: '3 fragmentos\nlibro.pdf' }),
      O.stepFinish({ reason: 'tool-calls' }),
      O.stepStart, O.text('He terminado la lección.'), O.stepFinish({ reason: 'stop' })
    ]
  }
}

function run(lines: string[], servers = ['aula'], allowWeb = false): { events: AgentEvent[]; violation?: string; conclusion: CLIConclusion } {
  const parser = new OpenCodeEventParser('OpenCode', 'anthropic/claude-sonnet-4-5', servers, allowWeb)
  const events: AgentEvent[] = []
  let violation: string | undefined
  for (const l of lines) {
    const s = parser.consume(l)
    events.push(...s.events)
    violation ??= s.violation
  }
  return { events, violation, conclusion: parser.conclude() }
}

describe('OpenCodeEventParser', () => {
  it('ejecución completa', () => {
    const o = run(O.fullRun())
    expect(o.violation).toBeUndefined()
    const r = summarize(o.events)
    expect(r.kinds).toEqual(['started', 'reasoning', 'toolStarted', 'toolFinished', 'text'])
    expect(r.toolEvents).toEqual(['→ buscar_en_fuentes {"consulta":"círculo unidad"}', '← buscar_en_fuentes ok 3 fragmentos ⏎ libro.pdf'])
    expect(o.events[0]).toEqual({ type: 'started', provider: 'OpenCode', model: 'anthropic/claude-sonnet-4-5' })
    expect(o.conclusion.type).toBe('finished')
    const result = o.conclusion.type === 'finished' ? o.conclusion.result : undefined
    expect(result?.text).toBe('He terminado la lección.')
    expect(result?.steps).toBe(2)
    expect(result?.stopReason).toBe('stop')
    expect(result?.sessionID).toBe(SESSION)
    expect(result?.usage).toEqual({ promptTokens: 2 * (100 + 50 + 10), completionTokens: 40, reasoningTokens: 10, cachedTokens: 100, cacheWriteTokens: 20 })
  })

  it('una herramienta con error es un fallo de la herramienta, no una violación', () => {
    const o = run([
      O.stepStart,
      O.tool('bash', { callID: 'b', status: 'error', input: { command: 'ls' }, error: 'The user has specified a rule which prevents you from using this specific tool call.' }),
      O.tool('aula_crear', { callID: 'c', status: 'error', error: 'JSON inválido' }),
      O.stepFinish()
    ])
    expect(o.violation).toBeUndefined()
    expect(summarize(o.events).toolEvents).toEqual([
      '→ bash {"command":"ls"}', '← bash error The user has specified a rule which prevents you from using this specific tool call.',
      '→ crear ', '← crear error JSON inválido'
    ])
  })

  it('ejecutar una herramienta peligrosa es una violación', () => {
    for (const tool of ['bash', 'edit', 'write', 'read', 'glob', 'grep', 'task', 'patch']) {
      const o = run([O.stepStart, O.tool(tool, { output: 'hecho' })])
      expect(o.violation, tool).toContain('por seguridad')
    }
  })

  it('las herramientas web dependen del permiso', () => {
    const search = O.tool('websearch', { input: { query: 'identidades trigonométricas' }, output: 'resultados' })
    expect(run([O.stepStart, search], ['aula'], false).violation).toBeDefined()
    const allowed = run([O.stepStart, search, O.tool('webfetch', { callID: 'f', input: { url: 'https://example.com' }, output: 'página' })], ['aula'], true)
    expect(allowed.violation).toBeUndefined()
    const tools = summarize(allowed.events).toolEvents
    expect(tools[0]).toBe('→ websearch identidades trigonométricas')
    expect(tools[2]).toBe('→ webfetch https://example.com')
  })

  it('quita el prefijo del servidor', () => {
    expect(stripServerPrefix('aula_crear_leccion', ['aula'])).toBe('crear_leccion')
    expect(stripServerPrefix('mi_servidor_x_y', ['mi_servidor', 'mi'])).toBe('x_y')
    expect(stripServerPrefix('bash', ['aula'])).toBe('bash')
    expect(stripServerPrefix('aula_', ['aula'])).toBe('aula_')
    expect(stripServerPrefix('otro_x', [])).toBe('otro_x')
  })

  it('tipos de error', () => {
    const failure = (l: string) => {
      const c = run([O.stepStart, l]).conclusion
      return c.type === 'failed' ? c.failure : undefined
    }
    expect(failure(O.error('ProviderAuthError', 'No auth for anthropic'))?.kind).toBe('notLoggedIn')
    expect(failure(O.error('APIError', 'Unauthorized', 401))?.kind).toBe('notLoggedIn')
    expect(failure(O.error('APIError', 'Too many requests', 429))?.kind).toBe('rateLimited')
    expect(failure(O.error('ContextOverflowError', 'demasiado largo'))?.kind).toBe('badResponse')
    expect(failure(O.error('UnknownError', 'algo raro'))?.kind).toBeUndefined()
    expect(failure(O.error('UnknownError', 'algo raro'))?.message).toBe('algo raro')
  })

  it('los errores de aborto se ignoran y varios errores se unen', () => {
    expect(run([O.stepStart, O.text('hola'), O.error('MessageAbortedError', 'abortado'), O.stepFinish()]).conclusion.type).toBe('finished')
    const c = run([O.error('UnknownError', 'uno'), O.error('UnknownError', 'dos')]).conclusion
    expect(c.type === 'failed' ? c.failure.message : '').toBe('uno\ndos')
  })

  it('un error antes de cualquier paso falla', () => {
    expect(run([O.error('UnknownError', 'Model not found: x/y.')]).conclusion.type).toBe('failed')
  })

  it('motivos de parada', () => {
    const reason = (r: string) => {
      const c = run([O.stepStart, O.text('x'), O.stepFinish({ reason: r })]).conclusion
      return c.type === 'finished' ? c.result.stopReason : undefined
    }
    expect(reason('stop')).toBe('stop')
    expect(reason('length')).toBe('length')
    expect(reason('tool-calls')).toBe('max_steps')
    expect(reason('loquesea')).toBe('stop')
  })

  it('los textos se separan y los vacíos se ignoran', () => {
    expect(summarize(run([O.stepStart, O.text('Uno.'), O.text('   '), O.text(''), O.text('Dos.'), O.stepFinish()]).events).text).toBe('Uno.\n\nDos.')
  })

  it('sin eventos y con basura', () => {
    expect(run([]).conclusion.type).toBe('noResult')
    const parser = new OpenCodeEventParser('OpenCode', '', [], false)
    for (const l of ['', 'Unknown arguments: foo', '{roto', 'null']) expect(parser.consume(l).events).toEqual([])
    expect(parser.unparsedSample).toContain('Unknown arguments')
    expect(parser.conclude().type).toBe('noResult')
    expect(parser.consume(O.event('evento_nuevo', {})).events).toEqual([])
  })

  it('una herramienta sin callID también funciona', () => {
    const l = O.event('tool_use', { part: { id: 'prt_9', type: 'tool', tool: 'aula_x', state: { status: 'completed', input: {}, output: 'ok' } } })
    expect(summarize(run([l]).events).toolEvents).toHaveLength(2)
  })
})

describe('Configuración efímera de las CLIs', () => {
  const servers: MCPServerSpec[] = [
    { name: 'aula', command: '/usr/local/bin/aula-mcp', args: ['--home', '/tmp/m'], env: { K: 'v' } },
    { name: 'mi canvas.v2', command: 'npx', args: ['-y', 'canvas'] }
  ]

  it('OpenCode: JSON válido con la forma esperada', () => {
    const config = JSON.parse(openCodeConfigJSON(servers, true))
    expect(config.$schema).toBe('https://opencode.ai/config.json')
    expect(config.autoupdate).toBe(false)
    expect(config.share).toBe('disabled')
    const aula = config.mcp.aula
    expect(aula.type).toBe('local')
    expect(aula.command).toEqual(['/usr/local/bin/aula-mcp', '--home', '/tmp/m'])
    expect(aula.environment.K).toBe('v')
    expect(aula.enabled).toBe(true)
    expect(aula.timeout).toBe(600_000) // también es el plazo de cada llamada: supera al de las tarjetas de permiso
    expect(config.mcp.mi_canvas_v2).toBeDefined() // el nombre se normaliza como hace OpenCode
    expect(config.agent).toBeUndefined()
  })

  it('OpenCode: niega por defecto y luego solo permite nuestras herramientas (en orden)', () => {
    for (const allowWeb of [false, true]) {
      const json = openCodeConfigJSON(servers, allowWeb)
      const start = json.indexOf('"permission":{') + '"permission":{'.length
      const body = json.slice(start, json.indexOf('}', start))
      const entries = body.split(',').map((e) => e.split(':').map((s) => s.replace(/^"|"$/g, '')))
      expect(entries[0]).toEqual(['*', 'deny'])
      const indexOf = (name: string): number => entries.findIndex((e) => e[0] === name)
      for (const dangerous of ['bash', 'edit', 'read', 'glob', 'grep', 'task', 'external_directory']) {
        expect(entries[indexOf(dangerous)][1], dangerous).toBe('deny')
        expect(indexOf(dangerous)).toBeLessThan(indexOf('aula_*'))
      }
      expect(entries[indexOf('aula_*')][1]).toBe('allow')
      expect(entries[indexOf('mi_canvas_v2_*')][1]).toBe('allow')
      expect(entries[indexOf('webfetch')][1]).toBe(allowWeb ? 'allow' : 'deny')
      expect(entries[indexOf('websearch')][1]).toBe(allowWeb ? 'allow' : 'deny')
      expect(() => JSON.parse(json)).not.toThrow()
    }
  })

  it('OpenCode: el agente lleva el prompt, los pasos y la temperatura', () => {
    const config = JSON.parse(openCodeConfigJSON(servers, false, { name: 'aula', prompt: 'Eres un tutor.\nUsa "herramientas".', steps: 12, temperature: 0.3 }))
    expect(config.default_agent).toBe('aula')
    const d = config.agent.aula
    expect(d.mode).toBe('primary')
    expect(d.prompt).toBe('Eres un tutor.\nUsa "herramientas".')
    expect(d.steps).toBe(12)
    expect(d.temperature).toBe(0.3)
    expect(d.model).toBeUndefined()
  })

  it('OpenCode: {env:…} y {file:…} se neutralizan', () => {
    const nasty = 'Apunte: {file:/Users/yo/.ssh/id_rsa} y {env:ANTHROPIC_API_KEY} y \\frac{file}{env:x}'
    const text = openCodeConfigJSON([{ name: 'x', command: 'c', args: ['{env:HOME}'], env: { T: '{file:/etc/passwd}' } }], false, { name: 'aula', prompt: nasty, steps: 5 })
    expect(text).not.toContain('{file:')
    expect(text).not.toContain('{env:')
    const prompt: string = JSON.parse(text).agent.aula.prompt
    expect(prompt).toContain('file:/Users/yo/.ssh/id_rsa') // el contenido sigue ahí, solo cambia la llave
    expect(prompt.replaceAll('​', '')).toBe(nasty)
    expect(/\{(env|file):[^}]+\}/.test(text)).toBe(false)
  })

  it('OpenCode: sin servidores sigue siendo segura', () => {
    const config = JSON.parse(openCodeConfigJSON([], false))
    expect(config.mcp).toEqual({})
    expect(config.permission['*']).toBe('deny')
  })

  it('Claude Code: forma y salida determinista', () => {
    const data = claudeMCPConfig(servers)
    expect(claudeMCPConfig(servers)).toBe(data)
    const config = JSON.parse(data)
    expect(config.mcpServers.aula.command).toBe('/usr/local/bin/aula-mcp')
    expect(config.mcpServers.aula.args).toEqual(['--home', '/tmp/m'])
    expect(config.mcpServers.aula.env.K).toBe('v')
    expect(config.mcpServers['mi canvas.v2'].env).toEqual({})
    expect(JSON.parse(claudeMCPConfig([]))).toEqual({ mcpServers: {} })
  })

  it('Codex: pares TOML válidos y bien escapados', () => {
    const overrides = codexMCPOverrides([{ name: 'mi servidor', command: '/ruta con espacios/bin', args: ['a"b', 'c\\d', 'línea\nnueva', 'tab\t', 'ñ日本🙂', '\u0001'], env: { B: '2', A: '1', 'CLAVE RARA': 'x' } }])
    expect(overrides.length % 2).toBe(0)
    expect(overrides.filter((_, i) => i % 2 === 0).every((o) => o === '-c')).toBe(true)
    expect(overrides.filter((_, i) => i % 2 === 1)).toEqual([
      'mcp_servers.mi_servidor.command="/ruta con espacios/bin"',
      'mcp_servers.mi_servidor.args=["a\\"b", "c\\\\d", "línea\\nnueva", "tab\\t", "ñ日本🙂", "\\u0001"]',
      'mcp_servers.mi_servidor.env={ A = "1", B = "2", "CLAVE RARA" = "x" }',
      'mcp_servers.mi_servidor.default_tools_approval_mode="approve"',
      'mcp_servers.mi_servidor.startup_timeout_sec=60',
      'mcp_servers.mi_servidor.tool_timeout_sec=300'
    ])
    expect(codexMCPOverrides([])).toEqual([])
    // dos servidores cuyos nombres normalizados coinciden no se pisan
    const clash = codexMCPOverrides([{ name: 'a b', command: 'x' }, { name: 'a.b', command: 'y' }])
    expect(clash).toContain('mcp_servers.a_b.command="x"')
    expect(clash).toContain('mcp_servers.a_b_2.command="y"')
  })

  it('escapado TOML', () => {
    expect(toml('simple')).toBe('"simple"')
    expect(toml('')).toBe('""')
    expect(toml('a\u0008b\u000Cc\r')).toBe('"a\\bb\\fc\\r"')
    expect(toml('\u007F')).toBe('"\\u007F"')
    expect(tomlKey('OK_name-1')).toBe('OK_name-1')
    expect(tomlKey('con espacio')).toBe('"con espacio"')
    expect(tomlKey('')).toBe('""')
  })
})

// MARK: Runner

function config(cli?: FakeCLI, o: { path?: string; model?: string; effort?: string } = {}): CLIAgentConfig {
  return { id: 'opencode', kind: 'opencode', displayName: 'OpenCode', model: o.model ?? '', executablePath: o.path ?? cli?.executable, reasoningEffort: o.effort }
}

function task(o: { prompt?: string; system?: string; servers?: MCPServerSpec[]; web?: boolean; model?: string; steps?: number; timeout?: number; images?: ImagePart[]; inProcessToolCount?: number } = {}): AgentTask {
  return {
    id: 't', system: o.system ?? 'SYS', prompt: o.prompt ?? 'Hola', images: o.images ?? [], mcpServers: o.servers ?? [], allowWeb: o.web ?? false,
    model: 'model' in o ? o.model : 'anthropic/claude-sonnet-4-5', maxSteps: o.steps ?? 25, timeoutMs: (o.timeout ?? 20) * 1000, temperature: 0.2,
    inProcessToolCount: o.inProcessToolCount
  }
}

const successOutput = (): string => O.fullRun().join('\n') + '\n'
const runner = (cli?: FakeCLI, options: OpenCodeOptions = {}, cfg?: CLIAgentConfig): OpenCodeRunner => new OpenCodeRunner(cfg ?? config(cli), options)
const agentError = (err: unknown): AgentError | undefined => (err instanceof AgentError ? err : undefined)

describe('OpenCodeRunner', () => {
  beforeEach(() => {
    locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
    locatorOverrides.searchDirectories = ['/usr/bin', '/bin']
  })
  afterEach(() => {
    locatorOverrides.loginPATH = undefined
    locatorOverrides.searchDirectories = undefined
  })
  afterAll(() => cleanupTempDirs())

  it('la variante guardada llega a la CLI', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(undefined, {}, config(cli, { model: 'provider/model', effort: 'max' })).run(task({ model: undefined })))
    expect(cli.valueAfter('--variant')).toBe('max')
  })

  it('línea de órdenes y entorno (golden)', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: '/usr/local/bin/aula-mcp', args: ['--home', '/tmp/m'] }], web: true })))
    expect(r.error).toBeUndefined()
    expect(cli.arguments).toEqual(['run', '--format', 'json', '--thinking', '--pure', '--agent', 'aula', '--model', 'anthropic/claude-sonnet-4-5'])
    expect(cli.stdin).toBe('Hola')
    const env = cli.environment
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('1')
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
    expect(env.PWD).toBe(cli.workingDirectory)
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
    expect(cfg.default_agent).toBe('aula')
    expect(cfg.agent.aula.prompt).toBe('SYS')
    expect(cfg.agent.aula.steps).toBe(25)
    expect(cfg.agent.aula.temperature).toBe(0.2)
    expect(cfg.mcp.aula.command).toHaveLength(3)
    expect(cfg.permission['*']).toBe('deny')
    expect(cfg.permission.webfetch).toBe('allow')
  })

  it('emite los eventos', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task({ servers: [{ name: 'aula', command: 'x' }] })))
    expect(r.error).toBeUndefined()
    expect(r.kinds).toEqual(['started', 'reasoning', 'toolStarted', 'toolFinished', 'text', 'usage', 'finished'])
    expect(r.finished?.text).toBe('He terminado la lección.')
  })

  it('modelo de la configuración y sin modelo', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(undefined, {}, config(cli, { model: 'opencode/grok-code' })).run(task({ model: undefined })))
    expect(cli.valueAfter('--model')).toBe('opencode/grok-code')
    await collect(runner(cli).run(task({ model: undefined })))
    expect(cli.valueAfter('--model')).toBeUndefined()
  })

  it('un modelo sin proveedor se rechaza antes de lanzar', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task({ model: 'gpt-5' })))
    expect(agentError(r.error)?.kind).toBe('unsupported')
    expect(agentError(r.error)?.message).toContain('proveedor/modelo')
    expect(cli.arguments).toEqual([])
  })

  it('las imágenes se adjuntan con --file', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(cli).run(task({ images: [{ mediaType: 'image/png', base64: 'AQ==' }, { mediaType: 'image/jpeg', base64: 'Ag==' }] })))
    const args = cli.arguments
    expect(args.filter((a) => a === '--file')).toHaveLength(2)
    expect(args.some((a) => a.endsWith('imagen-1.png'))).toBe(true)
    expect(args.some((a) => a.endsWith('imagen-2.jpg'))).toBe(true)
  })

  it('el prompt de sistema con patrones de sustitución se neutraliza', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(cli).run(task({ system: 'Lee {file:/etc/hosts} y {env:HOME}' })))
    expect(/\{(env|file):[^}]+\}/.test(cli.environment.OPENCODE_CONFIG_CONTENT)).toBe(false)
  })

  it('opciones: variante y extras', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    await collect(runner(cli, { variant: 'high', extraArguments: ['--share'], extraEnvironment: { X: '1' } }).run(task()))
    expect(cli.valueAfter('--variant')).toBe('high')
    expect(cli.arguments[cli.arguments.length - 1]).toBe('--share')
    expect(cli.environment.X).toBe('1')
  })

  it('no instalado', async () => {
    const r = await collect(runner(undefined, {}, config(undefined, { path: '/no/existe/opencode' })).run(task()))
    expect(agentError(r.error)?.kind).toBe('notInstalled')
    expect(agentError(r.error)?.message).toContain('opencode.ai/install')
  })

  it('sin credenciales del proveedor = sin sesión', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: [O.stepStart, O.error('ProviderAuthError', 'Missing credentials for anthropic')].join('\n') + '\n', exitCode: 1 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('notLoggedIn')
    expect(agentError(r.error)?.message).toContain('opencode auth login')
  })

  it('límite de uso desde un APIError', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: [O.stepStart, O.error('APIError', 'Rate limit exceeded, retry after 90 seconds', 429)].join('\n') + '\n', exitCode: 1 })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('rateLimited')
    expect(Math.abs((agentError(r.error)?.retryAfter ?? 0) - 90)).toBeLessThanOrEqual(1)
  })

  it('una opción opcional desconocida se quita y se reintenta', async () => {
    const before = `for a in "$@"; do
  if [ "$a" = "--pure" ]; then printf 'Unknown arguments: pure\\n' >&2; exit 1; fi
done`
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput(), before })
    const r = await collect(runner(cli).run(task()))
    expect(r.error).toBeUndefined()
    expect(cli.calls).toHaveLength(2)
    expect(cli.arguments).not.toContain('--pure')
  })

  posixIt('ejecutar bash detiene la ejecución', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const output = [O.stepStart, O.tool('bash', { input: { command: 'cat ~/.ssh/id_rsa' }, output: 'secreto' })].join('\n') + '\n'
    const cli = new FakeCLI(dir, { stdout: output, before: `sleep 300 & echo $! > '${pidFile}'`, after: 'wait' })
    const r = await collect(runner(cli).run(task()))
    expect(agentError(r.error)?.kind).toBe('other')
    expect(agentError(r.error)?.message).toContain('por seguridad')
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  posixIt('plazo agotado', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: O.stepStart + '\n', after: 'sleep 300' })
    const started = Date.now()
    const r = await collect(runner(cli).run(task({ timeout: 0.7 })))
    expect(agentError(r.error)?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('herramientas en proceso: aviso', async () => {
    const cli = new FakeCLI(makeTempDir(), { stdout: successOutput() })
    const r = await collect(runner(cli).run(task({ inProcessToolCount: 1 })))
    expect(r.notices).toHaveLength(1)
  })
})

describe('OpenCode · respuestas incompletas (seguridad del final)', () => {
  afterAll(() => cleanupTempDirs())

  async function launch(lines: string[], exit = 0, stderr = '') {
    const dir = makeTempDir()
    const cli = new FakeCLI(dir, { stdout: lines.join('\n') + '\n', stderr, exitCode: exit })
    const invocation = { executable: cli.executable, arguments: [], environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: dir }, workingDirectory: dir }
    return collect(
      eventStream<AgentEvent>((emit, signal) =>
        runCLI(invocation, new OpenCodeEventParser('OpenCode', 'synthetic/model', ['aula'], false), CLIErrorClassifier.openCode, { timeoutMs: 5000, postResultGraceMs: 100, signal, emit })
      )
    )
  }

  it('texto parcial y salida 17 = fallo', async () => {
    const r = await launch([O.stepStart, O.text('respuesta parcial')], 17, 'synthetic fatal crash')
    expect(r.text).toBe('respuesta parcial')
    expect(r.finished).toBeUndefined()
    expect(agentError(r.error)?.message).toContain('synthetic fatal crash')
  })

  it('texto parcial y salida limpia sigue incompleto', async () => {
    const r = await launch([O.stepStart, O.text('respuesta parcial')])
    expect(r.finished).toBeUndefined()
    expect(agentError(r.error)?.kind).toBe('badResponse')
  })

  it('un paso anterior con herramienta no completa el siguiente paso sin terminar', async () => {
    const r = await launch([O.stepStart, O.tool('aula_lookup', { output: 'synthetic' }), O.stepFinish({ reason: 'tool-calls' }), O.stepStart, O.text('segunda respuesta parcial')], 17)
    expect(r.text).toBe('segunda respuesta parcial')
    expect(r.finished).toBeUndefined()
    expect(r.error).toBeDefined()
  })

  it('contenido tardío dentro del mismo paso cerrado conserva su resultado', async () => {
    for (const event of [O.text('otra parte'), O.reasoning('pensamiento pendiente'), O.tool('aula_lookup', { output: 'synthetic' })]) {
      const r = await launch([O.stepStart, O.text('primera parte'), O.stepFinish(), event])
      expect(r.error).toBeUndefined()
      expect(r.finished).toBeDefined()
    }
  })

  it('un final vacío no reutiliza un motivo anterior', async () => {
    for (const finish of [O.event('step_finish', {}), O.event('step_finish', { part: {} }), O.stepFinish({ reason: '' })]) {
      const r = await launch([O.stepStart, O.text('primera parte'), O.stepFinish(), finish])
      expect(r.finished).toBeUndefined()
      expect(agentError(r.error)?.kind).toBe('badResponse')
    }
  })

  it('los resultados cerrados válidos conservan el motivo de parada', async () => {
    for (const [reason, expected] of [['stop', 'stop'], ['length', 'length'], ['tool-calls', 'max_steps'], ['future-reason', 'stop']]) {
      const r = await launch([O.stepStart, O.text('respuesta completa'), O.stepFinish({ reason })])
      expect(r.error).toBeUndefined()
      expect(r.finished?.text).toBe('respuesta completa')
      expect(r.finished?.stopReason).toBe(expected)
    }
  })

  it('una salida incompleta sigue reconociendo errores de autenticación', async () => {
    const r = await launch([O.stepStart, O.text('respuesta parcial')], 17, '401 unauthorized synthetic')
    expect(r.finished).toBeUndefined()
    expect(agentError(r.error)?.kind).toBe('notLoggedIn')
  })
})
