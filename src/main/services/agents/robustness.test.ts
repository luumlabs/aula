// Port de `Tests/AgentKitTests/{RobustnessTests,ContractTests,SharedContextStdinTests,MCPArgumentLogPrivacyTests,AuditAIFixTests}.swift`:
// entradas aleatorias, casos límite del motor, apagado, privacidad del registro y el contexto compartido por stdin.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MCPServer } from '../../mcp/server'
import { ChildProcessHandle, killAllLive, liveCount } from './child-process'
import { ClaudeCodeRunner, ClaudeStreamParser, claudeStdin } from './claude'
import { CodexEventParser, codexStdin } from './codex'
import { describeArguments, engineSettings } from './engine'
import { AgentError } from './errors'
import { locatorOverrides } from './locator'
import { codexMCPOverrides } from './mcp-config'
import { OPENCODE_INLINE_PROMPT_LIMIT, OpenCodeEventParser, openCodeTaskConfig } from './opencode'
import { fullPrompt, type AgentTask, type MCPServerSpec } from './types'
import { ClaudeEvents as E, FakeCLI, cleanupTempDirs, collect, fixture, makeTempDir, processExists, waitUntil } from './__fixtures__/support'

const TEXT_OK = fixture('claude-text-ok.jsonl')

/** Generador pseudoaleatorio con semilla (SplitMix64 con BigInt): las pruebas son deterministas. */
class Seeded {
  private state: bigint
  constructor(seed: number) {
    this.state = BigInt(seed)
  }
  next(): bigint {
    const mask = (1n << 64n) - 1n
    this.state = (this.state + 0x9e3779b97f4a7c15n) & mask
    let z = this.state
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask
    return z ^ (z >> 31n)
  }
  int(lo: number, hi: number): number {
    return lo + Number(this.next() % BigInt(hi - lo))
  }
  pick<T>(list: T[]): T {
    return list[this.int(0, list.length)]
  }
}

const KNOWN_TYPES = ['system', 'stream_event', 'assistant', 'user', 'result', 'rate_limit_event', 'thread.started', 'turn.started', 'turn.completed', 'turn.failed',
  'item.started', 'item.updated', 'item.completed', 'error', 'step_start', 'step_finish', 'text', 'reasoning', 'tool_use']
const KNOWN_KEYS = ['type', 'subtype', 'event', 'message', 'content', 'delta', 'index', 'content_block', 'item', 'part', 'state', 'tool', 'tool_use_id', 'id', 'name', 'input',
  'text', 'thinking', 'usage', 'tokens', 'result', 'error', 'errors', 'status', 'is_error', 'num_turns', 'session_id', 'sessionID', 'thread_id', 'arguments',
  'partial_json', 'tools', 'mcp_servers', 'permission_denials', 'rate_limit_info', 'resetsAt', 'callID', 'output', 'query', 'url', 'command', 'data', 'cache']
const STRINGS = ['', 'a', 'texto', 'ñandú', '日本語', '🙂', '\u0000', '\\', '"', '{', '}', '[', ']', 'null', 'true', '-1', '1e999', 'x'.repeat(2000), 'mcp__a__b', 'Bash', 'stop', 'completed', 'error', 'tool_use', 'text_delta']

function randomValue(rng: Seeded, depth = 0): unknown {
  switch (rng.int(0, depth > 3 ? 5 : 8)) {
    case 0:
      return null
    case 1:
      return rng.int(0, 2) === 1
    case 2:
      return rng.int(-3, 100_000)
    case 3:
      return (rng.int(0, 2_000_000) - 1_000_000) * 1e6 + 0.5
    case 4:
      return rng.pick(STRINGS)
    case 5:
      return Array.from({ length: rng.int(0, 4) }, () => randomValue(rng, depth + 1))
    default: {
      const object: Record<string, unknown> = {}
      for (let i = rng.int(0, 6); i > 0; i--) object[rng.pick(KNOWN_KEYS)] = randomValue(rng, depth + 1)
      if (rng.int(0, 2) === 1) object.type = rng.pick([...KNOWN_TYPES, 'otro'])
      return object
    }
  }
}

function randomLines(seed: number, count: number): string[] {
  const rng = new Seeded(seed)
  return Array.from({ length: count }, () => {
    switch (rng.int(0, 6)) {
      case 0:
        return Array.from({ length: rng.int(0, 80) }, () => String.fromCharCode(rng.int(1, 256))).join('') // basura binaria
      case 1:
        return JSON.stringify({ type: rng.pick(KNOWN_TYPES) })
      default:
        return JSON.stringify(randomValue(rng))
    }
  })
}

beforeEach(() => {
  locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
  locatorOverrides.searchDirectories = ['/usr/bin', '/bin']
  engineSettings.postResultGraceMs = 10_000
})
afterEach(() => {
  locatorOverrides.loginPATH = undefined
  locatorOverrides.searchDirectories = undefined
  engineSettings.postResultGraceMs = 10_000
})
afterAll(() => cleanupTempDirs())

describe('Entradas aleatorias (fuzz)', () => {
  it('el analizador de Claude sobrevive', () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = new ClaudeStreamParser('C', '', ['a'])
      for (const l of randomLines(seed, 150)) p.consume(l)
      p.conclude()
      void p.unparsedSample
    }
  })

  it('el analizador de Codex sobrevive', () => {
    for (let seed = 100; seed < 140; seed++) {
      const p = new CodexEventParser('C', '', 5)
      for (const l of randomLines(seed, 150)) p.consume(l)
      p.conclude()
    }
  })

  it('el analizador de OpenCode sobrevive', () => {
    for (let seed = 200; seed < 240; seed++) {
      const p = new OpenCodeEventParser('C', '', ['a'], false)
      for (const l of randomLines(seed, 150)) p.consume(l)
      p.conclude()
    }
  })

  it('el servidor MCP siempre responde JSON válido en una línea', async () => {
    const server = new MCPServer({ name: 'fuzz', version: '1' })
    server.addTool({ name: 'eco', description: '', inputSchema: {} }, (args) => ({ text: JSON.stringify(args) }))
    for (let seed = 300; seed < 310; seed++) {
      for (const l of randomLines(seed, 80)) {
        const reply = await server.handleLine(l)
        if (reply !== undefined) {
          expect(() => JSON.parse(reply)).not.toThrow()
          expect(reply).not.toContain('\n')
        }
      }
    }
  })

  it('las capturas reales mutadas no rompen el analizador de Claude', () => {
    const rng = new Seeded(777)
    const base = (TEXT_OK + '\n' + fixture('claude-mcp-tool-max-turns.jsonl')).split('\n').filter(Boolean)
    for (let round = 0; round < 60; round++) {
      const p = new ClaudeStreamParser('C', '', ['aulatest'])
      for (const original of base) {
        const bytes = [...Buffer.from(original)]
        for (let n = rng.int(0, 4); n > 0 && bytes.length > 0; n--) {
          const i = rng.int(0, bytes.length)
          const op = rng.int(0, 3)
          if (op === 0) bytes[i] = rng.int(32, 127)
          else if (op === 1) bytes.splice(i, 1)
          else bytes.splice(i, 0, rng.int(32, 127))
        }
        p.consume(Buffer.from(bytes).toString('utf8'))
      }
      p.conclude()
    }
  })

  it('eventos conocidos con tipos equivocados se ignoran', () => {
    const claude = new ClaudeStreamParser('C', '', [])
    for (const l of ['{"type":"stream_event","event":"no soy un objeto"}', '{"type":"assistant","message":{"content":"texto"}}', '{"type":"user","message":{"content":{"a":1}}}',
      '{"type":"result","usage":"x","num_turns":"dos","is_error":"sí"}', '{"type":"system","subtype":"init","tools":"Bash"}']) claude.consume(l)
    claude.conclude()
    const codex = new CodexEventParser('C', '', 3)
    for (const l of ['{"type":"item.completed","item":"x"}', '{"type":"item.started","item":{"type":5}}', '{"type":"turn.completed","usage":[1]}', '{"type":"error","message":{"a":1}}']) codex.consume(l)
    codex.conclude()
    const opencode = new OpenCodeEventParser('C', '', [], true)
    for (const l of ['{"type":"tool_use","part":"x"}', '{"type":"tool_use","part":{"tool":5}}', '{"type":"text","part":{"text":5}}', '{"type":"error","error":"x"}', '{"type":"step_finish","part":{"tokens":"x"}}']) opencode.consume(l)
    opencode.conclude()
  })
})

const claudeRunner = (cli: FakeCLI): ClaudeCodeRunner => new ClaudeCodeRunner({ id: 'c', kind: 'claude', displayName: 'C', model: '', executablePath: cli.executable })
const simpleTask = (o: Partial<AgentTask> = {}): AgentTask => ({ system: 's', prompt: 'p', ...o })
const agentError = (err: unknown): AgentError | undefined => (err instanceof AgentError ? err : undefined)

describe('Casos límite del motor', () => {
  it('muerte por señal tras algo de salida', async () => {
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { stdout: E.initEvent() + '\n', after: 'kill -9 $$' })).run(simpleTask()))
    expect(agentError(r.error)?.kind).toBe('other')
    expect(agentError(r.error)?.message).toContain('señal 9')
    expect(r.kinds).toContain('started')
  })

  it('cerrar stdout y seguir vivo se corta con el plazo', async () => {
    const started = Date.now()
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { stdout: E.initEvent() + '\n', after: 'exec 1>&-; sleep 300' })).run(simpleTask({ timeoutMs: 800 })))
    expect(agentError(r.error)?.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(8000)
  })

  it('salida inmediata sin nada', async () => {
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { before: 'exit 0' })).run(simpleTask()))
    expect(agentError(r.error)?.kind).toBe('badResponse')
    expect(agentError(r.error)?.message).toContain('sin dar ninguna respuesta')
  })

  it('lo que llega tras el result no rompe nada (vale el último result)', async () => {
    const lines = [...E.fullToolFlow(), E.result({ text: 'OTRO RESULTADO' }), E.assistant('x', [E.textBlock('tarde')])]
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { stdout: lines.join('\n') + '\n' })).run(simpleTask({ mcpServers: [{ name: 'aula', command: 'x' }] })))
    expect(r.error).toBeUndefined()
    expect(r.finished?.text).toBe('OTRO RESULTADO')
  })

  it('basura binaria en stdout no rompe la ejecución', async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'garbage.stdout'), TEXT_OK)
    const r = await collect(claudeRunner(new FakeCLI(dir, { before: "head -c 100000 /dev/urandom | tr -d '\\n'; echo", after: `cat '${join(dir, 'garbage.stdout')}'` })).run(simpleTask()))
    expect(r.error).toBeUndefined()
    expect(r.finished?.text).toBe('OK')
  })

  it('la última línea válida sin salto final se procesa', async () => {
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { stdout: E.fullToolFlow().join('\n') })).run(simpleTask({ mcpServers: [{ name: 'aula', command: 'x' }] })))
    expect(r.error).toBeUndefined()
    expect(r.finished?.text).toBe('Listo, ya está.')
  })

  it('cancelar con stdout cerrado y el proceso vivo lo mata', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'hijo.pid')
    const controller = new AbortController()
    const run = collect(claudeRunner(new FakeCLI(dir, { stdout: E.initEvent() + '\n', before: `sleep 300 & echo $! > '${pidFile}'`, after: 'exec 1>&-; wait' })).run(simpleTask({ timeoutMs: 60_000 }), controller.signal))
    expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true)
    await new Promise((r) => setTimeout(r, 400))
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    controller.abort()
    await run
    expect(await waitUntil(() => !processExists(pid), 8000)).toBe(true)
  })

  it('una tormenta de cancelaciones no deja nada vivo', async () => {
    const dir = makeTempDir()
    const pids = join(dir, 'pids')
    mkdirSync(pids)
    const cli = new FakeCLI(dir, { stdout: E.initEvent() + '\n', before: `sleep 300 & echo $! > '${pids}'/$$.pid`, after: 'wait' })
    const runner = claudeRunner(cli)
    const controllers = Array.from({ length: 12 }, () => new AbortController())
    const runs = controllers.map((c) => collect(runner.run(simpleTask({ timeoutMs: 60_000 }), c.signal)))
    expect(await waitUntil(() => readdirSync(pids).length === 12, 10_000)).toBe(true)
    await waitUntil(() => readdirSync(pids).every((f) => readFileSync(join(pids, f), 'utf8').trim() !== ''))
    const sleepers = readdirSync(pids).map((f) => Number(readFileSync(join(pids, f), 'utf8').trim()))
    expect(sleepers.every(processExists)).toBe(true)
    controllers.forEach((c, i) => i % 2 === 0 && c.abort())
    await new Promise((r) => setTimeout(r, 150))
    controllers.forEach((c, i) => i % 2 === 1 && c.abort())
    await Promise.all(runs)
    expect(await waitUntil(() => sleepers.every((p) => !processExists(p)), 10_000)).toBe(true)
  })

  it('el servidor MCP puede leer sus peticiones de un archivo (`aula-mcp < peticiones.jsonl`)', async () => {
    const server = new MCPServer({ name: 'archivo', version: '1' })
    server.addTool({ name: 't', description: '', inputSchema: {} }, () => ({ text: 'x' }))
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (c: Buffer) => chunks.push(c.toString()))
    input.end(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}', '{"jsonrpc":"2.0","method":"notifications/initialized"}', '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'].join('\n') + '\n')
    await server.run(input, output)
    const lines = chunks.join('').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(new Set(lines.map((l) => JSON.parse(l).id))).toEqual(new Set([1, 2]))
  })
})

describe('Apagado', () => {
  it('si el plazo vence con el resultado ya llegado, no es un error', async () => {
    engineSettings.postResultGraceMs = 30_000 // el proceso «se queda» tras el resultado
    const started = Date.now()
    const r = await collect(claudeRunner(new FakeCLI(makeTempDir(), { stdout: TEXT_OK, after: 'sleep 300' })).run(simpleTask({ timeoutMs: 600 })))
    expect(r.error).toBeUndefined()
    expect(r.finished?.text).toBe('OK')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('killAllLive mata a todos los grupos hijo vivos', async () => {
    const dir = makeTempDir()
    const env = { PATH: '/usr/bin:/bin' }
    const processes: ChildProcessHandle[] = []
    const pids: number[] = []
    for (let i = 0; i < 3; i++) {
      const pidFile = join(dir, `nieto${i}.pid`)
      const p = await ChildProcessHandle.spawn('/bin/sh', ['-c', `sleep 300 & echo $! > '${pidFile}'; wait`], { env })
      p.closeStdin()
      processes.push(p)
      expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true)
      pids.push(Number(readFileSync(pidFile, 'utf8').trim()))
    }
    expect(liveCount()).toBeGreaterThanOrEqual(3)
    killAllLive() // lo que hace la app al salir
    await Promise.all(processes.map((p) => p.waitForExit()))
    expect(await waitUntil(() => pids.every((p) => !processExists(p)))).toBe(true)
    expect(await waitUntil(() => liveCount() === 0)).toBe(true)
  })
})

describe('Privacidad del registro de argumentos', () => {
  const server = (args: string[], name = 'fixture', env: Record<string, string> = {}): MCPServerSpec => ({ name, command: '/synthetic/no-process', args, env })

  it('oculta prompts y secretos', () => {
    const args = ['-p', '--system-prompt', 'TEXTO SECRETO DE LOS APUNTES DEL USUARIO', '--model', 'haiku',
      '-c', 'developer_instructions="otro texto del sistema"', '-c', 'mcp_servers.canvas.env={ CANVAS_TOKEN = "abc123" }',
      '-c', 'mcp_servers.x.command="/ruta/' + 'larga'.repeat(40) + '"']
    const text = describeArguments(args)
    for (const secret of ['SECRETO', 'otro texto', 'abc123', 'CANVAS_TOKEN']) expect(text).not.toContain(secret)
    expect(text).toContain('--system-prompt <oculto>')
    expect(text).toContain('--model haiku')
    expect(text.length).toBeLessThan(400)
  })

  it('los argumentos de los servidores MCP son opacos', () => {
    const token = 'SYNTHETIC_MCP_PRIVATE_TOKEN_1234'
    const text = describeArguments(codexMCPOverrides([server(['--token', token])]))
    expect(text).toContain('mcp_servers.fixture.args=<oculto>')
    expect(text).not.toContain(token)
    expect(text).not.toContain('--token')
    expect(text).toContain('mcp_servers.fixture.command=')
    for (const argument of ['opaque_fixture_value', '--key=SYNTHETIC_VALUE', 'Bearer SYNTHETIC_VALUE', 'https://fixture.invalid/?token=SYNTHETIC_VALUE']) {
      const t = describeArguments(codexMCPOverrides([server([argument])]))
      expect(t).toContain('mcp_servers.fixture.args=<oculto>')
      expect(t).not.toContain('SYNTHETIC_VALUE')
    }
    const settings = codexMCPOverrides([server(['FIRST_PRIVATE_VALUE'], 'same name'), server(['SECOND_PRIVATE_VALUE'], 'same.name')]).filter((a) => a.startsWith('mcp_servers.') && a.includes('.args='))
    expect(settings).toHaveLength(2)
    for (const s of settings) expect(describeArguments([s]).endsWith('.args=<oculto>')).toBe(true)
  })

  it('el entorno de los servidores se oculta y lo demás sigue útil y acotado', () => {
    const env = describeArguments(codexMCPOverrides([server([], 'fixture', { EARLY: 'FIRST_ENV_PRIVATE_VALUE', LATE: 'x.args=y' })]))
    expect(env).toContain('mcp_servers.fixture.env=<oculto>')
    expect(env).not.toContain('FIRST_ENV_PRIVATE_VALUE')
    const mixed = describeArguments(codexMCPOverrides([server(['FIRST_PRIVATE_VALUE', 'x.env=y'])]))
    expect(mixed).not.toContain('FIRST_PRIVATE_VALUE')
    expect(mixed).not.toContain('x.env=')
    const text = describeArguments(['--model', 'fixture-model', '--resume', 'fixture-session', 'other.args=visible-value', 'mcp_servers.fixture.command="/synthetic/no-process"', 'mcp_servers.fixture.startup_timeout_sec=60', 'z'.repeat(500)])
    expect(text).toContain('--model fixture-model --resume fixture-session')
    expect(text).toContain('other.args=visible-value')
    expect(text).toContain('startup_timeout_sec=60')
    expect(text).not.toContain('z'.repeat(100))
  })
})

describe('Contexto compartido por stdin', () => {
  const task: AgentTask = { system: 'S', prompt: 'Escribe la lección 1.', allowWeb: false, sharedContext: '## Course context\n- Title: Cálculo' }

  it('Claude Code recibe primero el contexto compartido', () => {
    expect(claudeStdin(task)).toBe('## Course context\n- Title: Cálculo\n\nEscribe la lección 1.')
    const line = JSON.parse(claudeStdin({ ...task, images: [{ mediaType: 'image/png', base64: 'AQ==' }] }).trim())
    expect(line.message.content[line.message.content.length - 1].text).toBe(fullPrompt(task))
  })

  it('Codex también', () => {
    expect(codexStdin(task, false)).toBe(fullPrompt(task))
    expect(codexStdin(task, true).endsWith('</instrucciones>\n\n' + fullPrompt(task))).toBe(true)
  })

  it('se une con una sola línea en blanco', () => {
    expect(fullPrompt({ prompt: 'B', sharedContext: 'A\n' })).toBe('A\n\nB')
    expect(fullPrompt({ prompt: 'B', sharedContext: 'A\n\n' })).toBe('A\n\nB')
    expect(fullPrompt({ prompt: 'B' })).toBe('B')
    expect(fullPrompt({ prompt: '', sharedContext: 'A' })).toBe('A')
  })
})

describe('OpenCode: un prompt de sistema enorme va en un archivo', () => {
  it('la referencia {file:…} es la única que no se neutraliza', () => {
    const task: AgentTask = { system: 'Sistema {file:/etc/passwd}', prompt: 'Hola' }
    expect(openCodeTaskConfig(task)).toContain('{​file:/etc/passwd}')
    const withFile = openCodeTaskConfig(task, '/tmp/aula-sandbox/system-prompt.md')
    expect(withFile).toContain('"prompt":"{file:/tmp/aula-sandbox/system-prompt.md}"')
    expect(withFile).not.toContain('Sistema')
    expect(() => JSON.parse(withFile)).not.toThrow()
    expect(OPENCODE_INLINE_PROMPT_LIMIT).toBeLessThan(1_000_000)
  })
})
