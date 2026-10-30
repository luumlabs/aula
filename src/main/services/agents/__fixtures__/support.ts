// Utilidades de las pruebas de los agentes CLI (port de `Tests/AgentKitTests/TestSupport.swift`): carpetas temporales, CLIs
// falsas (un guion bash que registra cómo lo llamaron y emite una salida preparada) y recogida de eventos.
// En Windows la CLI falsa es un script de Node con un envoltorio `.cmd` como los de npm (así se instalan allí `claude`,
// `codex` y `opencode`): se prueba el mismo camino que sigue Aula para lanzarlas.
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import type { AgentEvent, AgentResult } from '../types'

export const isWindows = process.platform === 'win32'
/** Pruebas de grupos de procesos y señales POSIX, o con guiones bash: no corren en Windows. */
export const posixIt = it.skipIf(isWindows)

export function fixture(name: string): string {
  return readFileSync(join(__dirname, name), 'utf8')
}

export function fixtureLines(name: string): string[] {
  return fixture(name).split('\n').filter((l) => l.length > 0)
}

const dirs: string[] = []

/** Carpeta temporal única (se borra con `cleanupTempDirs`). */
export function makeTempDir(prefix = 'agentkit-tests'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)))
  dirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
}

export function writeExecutable(path: string, script: string): string {
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}

/** El envoltorio `.cmd` que crea npm en Windows para una CLI de Node (`"%dp0%\<script>" %*`). */
export function npmCmdShim(script: string): string {
  return [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
    'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`, ''
  ].join('\r\n')
}

/**
 * Una herramienta falsa escrita en JavaScript: `<dir>/<name>` (guion que la lanza con este Node) o, en Windows,
 * `<dir>\<name>.cmd` (envoltorio de npm). Devuelve la ruta del ejecutable.
 */
export function writeNodeTool(dir: string, name: string, js: string): string {
  writeFileSync(join(dir, `${name}.js`), js)
  if (isWindows) {
    writeFileSync(join(dir, `${name}.cmd`), npmCmdShim(`${name}.js`))
    return join(dir, `${name}.cmd`)
  }
  return writeExecutable(join(dir, name), `#!/bin/sh\nexec '${process.execPath}' '${join(dir, `${name}.js`)}' "$@"\n`)
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export interface FakeCLIOptions {
  name?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  /** Fragmento bash antes de imprimir (p. ej. `echo "error" >&2; exit 2`). */
  before?: string
  /** Fragmento bash después de imprimir (p. ej. `sleep 30`). */
  after?: string
}

/** CLI falsa: registra argumentos, stdin, entorno y carpeta; copia `--mcp-config`/`--system-prompt-file`; imprime la salida. */
export class FakeCLI {
  readonly executable: string
  private readonly base: string

  constructor(
    readonly directory: string,
    options: FakeCLIOptions = {}
  ) {
    const name = options.name ?? 'fake-cli'
    this.base = join(directory, name)
    writeFileSync(this.base + '.stdout', options.stdout ?? '')
    writeFileSync(this.base + '.stderr', options.stderr ?? '')
    if (isWindows) {
      // los fragmentos bash (`before`/`after`) solo existen en macOS y Linux: esas pruebas usan `posixIt`
      if (options.before || options.after) throw new Error('FakeCLI: before/after son bash (usa posixIt)')
      this.executable = writeNodeTool(directory, name, fakeCLIScript(this.base, options.exitCode ?? 0))
      return
    }
    this.executable = this.base
    const script = `#!/bin/bash
printf '%s\\0' "$@" > ${q(this.base + '.args')}
printf '%s\\0' "$@" >> ${q(this.base + '.calls')}
printf '\\n' >> ${q(this.base + '.calls')}
pwd -P > ${q(this.base + '.cwd')}
env > ${q(this.base + '.env')}
cat > ${q(this.base + '.stdin')}
i=1
while [ $i -le $# ]; do
  arg="\${!i}"
  j=$((i+1))
  if [ "$arg" = "--mcp-config" ]; then cp "\${!j}" ${q(this.base + '.mcp.json')}; (stat -c %a "\${!j}" 2>/dev/null || stat -f %Lp "\${!j}") > ${q(this.base + '.mcpmode')}; fi
  if [ "$arg" = "--system-prompt-file" ]; then cp "\${!j}" ${q(this.base + '.system.md')}; fi
  i=$((i+1))
done
${options.before ?? ''}
cat ${q(this.base + '.stdout')}
cat ${q(this.base + '.stderr')} >&2
${options.after ?? ''}
exit ${options.exitCode ?? 0}
`
    writeExecutable(this.executable, script)
  }

  private read(ext: string): string {
    const path = this.base + ext
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }

  get arguments(): string[] {
    return splitNul(this.read('.args'))
  }
  get calls(): string[][] {
    return this.read('.calls').split('\n').filter(Boolean).map(splitNul)
  }
  get stdin(): string {
    return this.read('.stdin')
  }
  get workingDirectory(): string {
    return this.read('.cwd').trim()
  }
  get environment(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of this.read('.env').split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return out
  }
  get mcpConfig(): unknown {
    const text = this.read('.mcp.json')
    return text ? JSON.parse(text) : undefined
  }
  get mcpConfigPermissions(): string {
    return this.read('.mcpmode').trim()
  }
  get systemPromptFile(): string | undefined {
    const path = this.base + '.system.md'
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }
  valueAfter(flag: string): string | undefined {
    const args = this.arguments
    const i = args.indexOf(flag)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
}

/** La CLI falsa en JavaScript (Windows): lo mismo que el guion bash, sin `before`/`after`. */
function fakeCLIScript(base: string, exitCode: number): string {
  return `const fs = require('fs')
const base = ${JSON.stringify(base)}
const args = process.argv.slice(2)
const nul = (list) => list.map((a) => a + '\\0').join('')
fs.writeFileSync(base + '.args', nul(args))
fs.appendFileSync(base + '.calls', nul(args) + '\\n')
fs.writeFileSync(base + '.cwd', fs.realpathSync(process.cwd()) + '\\n')
fs.writeFileSync(base + '.env', Object.entries(process.env).map(([k, v]) => k + '=' + v).join('\\n') + '\\n')
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  fs.writeFileSync(base + '.stdin', Buffer.concat(chunks))
  args.forEach((arg, i) => {
    if (arg === '--mcp-config') {
      fs.copyFileSync(args[i + 1], base + '.mcp.json')
      fs.writeFileSync(base + '.mcpmode', (fs.statSync(args[i + 1]).mode & 0o777).toString(8) + '\\n')
    }
    if (arg === '--system-prompt-file') fs.copyFileSync(args[i + 1], base + '.system.md')
  })
  process.stdout.write(fs.readFileSync(base + '.stdout'))
  process.stderr.write(fs.readFileSync(base + '.stderr'))
  process.exitCode = ${exitCode}
})
`
}

function splitNul(text: string): string[] {
  const parts = text.split('\0')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** Eventos de una ejecución hasta que termina el flujo (y el error, si lo hubo). */
export interface AgentRun {
  events: AgentEvent[]
  error?: unknown
  text: string
  finished?: AgentResult
  notices: string[]
  toolEvents: string[]
  kinds: string[]
}

export async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentRun> {
  const events: AgentEvent[] = []
  let error: unknown
  try {
    for await (const e of stream) events.push(e)
  } catch (err) {
    error = err
  }
  return summarize(events, error)
}

export function summarize(events: AgentEvent[], error?: unknown): AgentRun {
  const text = events.map((e) => (e.type === 'text' ? e.text : '')).join('')
  const finished = [...events].reverse().find((e) => e.type === 'finished')
  return {
    events,
    error,
    text,
    finished: finished?.type === 'finished' ? finished.result : undefined,
    notices: events.flatMap((e) => (e.type === 'notice' ? [e.text] : [])),
    toolEvents: events.flatMap((e) =>
      e.type === 'toolStarted' ? [`→ ${e.name} ${e.summary}`] : e.type === 'toolFinished' ? [`← ${e.name} ${e.ok ? 'ok' : 'error'} ${e.summary}`] : []
    ),
    kinds: events.map((e) => e.type)
  }
}

/** Espera (con sondeos cortos) hasta que se cumpla la condición o se agote el tiempo. */
export async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return condition()
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// MARK: Eventos stream-json de Claude Code con el formato real

const line = (v: unknown): string => JSON.stringify(v)

export const ClaudeEvents = {
  line,
  initEvent(o: { tools?: string[]; servers?: [string, string][]; model?: string; session?: string } = {}): string {
    return line({
      type: 'system', subtype: 'init', session_id: o.session ?? 'sess-1', model: o.model ?? 'claude-haiku-4-5-20251001', permissionMode: 'dontAsk',
      tools: o.tools ?? [], mcp_servers: (o.servers ?? []).map(([name, status]) => ({ name, status }))
    })
  },
  stream(event: unknown): string {
    return line({ type: 'stream_event', event, session_id: 'sess-1', parent_tool_use_id: null })
  },
  messageStart(id: string): string {
    return ClaudeEvents.stream({ type: 'message_start', message: { id, role: 'assistant', content: [] } })
  },
  blockStart(index: number, block: unknown): string {
    return ClaudeEvents.stream({ type: 'content_block_start', index, content_block: block })
  },
  textDelta(index: number, text: string): string {
    return ClaudeEvents.stream({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
  },
  thinkingDelta(index: number, text: string): string {
    return ClaudeEvents.stream({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: text } })
  },
  jsonDelta(index: number, fragment: string): string {
    return ClaudeEvents.stream({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: fragment } })
  },
  blockStop(index: number): string {
    return ClaudeEvents.stream({ type: 'content_block_stop', index })
  },
  messageStop(): string {
    return ClaudeEvents.stream({ type: 'message_stop' })
  },
  assistant(id: string, content: unknown[], error?: string): string {
    return line({ type: 'assistant', message: { id, role: 'assistant', content }, session_id: 'sess-1', parent_tool_use_id: null, ...(error ? { error } : {}) })
  },
  textBlock: (text: string) => ({ type: 'text', text }),
  thinkingBlock: (text: string) => ({ type: 'thinking', thinking: text }),
  toolUseBlock: (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }),
  toolResult(id: string, content: unknown, isError?: boolean): string {
    const block: Record<string, unknown> = { type: 'tool_result', tool_use_id: id, content }
    if (isError !== undefined) block.is_error = isError
    return line({ type: 'user', message: { role: 'user', content: [block] }, session_id: 'sess-1', parent_tool_use_id: null })
  },
  result(o: { subtype?: string; isError?: boolean; text?: string | null; turns?: number; session?: string; usage?: unknown; errors?: string[]; denials?: string[]; stopReason?: string } = {}): string {
    const object: Record<string, unknown> = {
      type: 'result', subtype: o.subtype ?? 'success', is_error: o.isError ?? false, num_turns: o.turns ?? 1, session_id: o.session ?? 'sess-1',
      stop_reason: o.stopReason ?? 'end_turn',
      usage: o.usage ?? { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens_details: { thinking_tokens: 3 } },
      permission_denials: (o.denials ?? []).map((name) => ({ tool_name: name, tool_use_id: 'x', tool_input: {} }))
    }
    const text = o.text === undefined ? 'Listo' : o.text
    if (text !== null) object.result = text
    if (o.errors?.length) object.errors = o.errors
    return line(object)
  },
  /** Un recorrido completo con una herramienta: razonamiento → texto → herramienta → resultado → respuesta final. */
  fullToolFlow(): string[] {
    const E = ClaudeEvents
    return [
      E.initEvent({ tools: ['mcp__aula__crear_leccion'], servers: [['aula', 'connected']] }),
      E.messageStart('msg_1'),
      E.blockStart(0, { type: 'thinking', thinking: '' }), E.thinkingDelta(0, 'Debo crear '), E.thinkingDelta(0, 'la lección.'),
      E.assistant('msg_1', [E.thinkingBlock('Debo crear la lección.')]), E.blockStop(0),
      E.blockStart(1, { type: 'text', text: '' }), E.textDelta(1, 'Voy a crear '), E.textDelta(1, 'la lección.'),
      E.assistant('msg_1', [E.textBlock('Voy a crear la lección.')]), E.blockStop(1),
      E.blockStart(2, { type: 'tool_use', id: 'toolu_1', name: 'mcp__aula__crear_leccion', input: {} }),
      E.jsonDelta(2, '{"titulo": "Círculo'), E.jsonDelta(2, ' unidad", "n"'), E.jsonDelta(2, ': 3}'),
      E.assistant('msg_1', [E.toolUseBlock('toolu_1', 'mcp__aula__crear_leccion', { titulo: 'Círculo unidad', n: 3 })]), E.blockStop(2),
      E.messageStop(),
      E.toolResult('toolu_1', [{ type: 'text', text: 'Lección creada\nid=abc' }]),
      E.messageStart('msg_2'), E.blockStart(0, { type: 'text', text: '' }), E.textDelta(0, 'Listo, '), E.textDelta(0, 'ya está.'),
      E.assistant('msg_2', [E.textBlock('Listo, ya está.')]), E.blockStop(0), E.messageStop(),
      E.result({ text: 'Listo, ya está.', turns: 2 })
    ]
  }
}
