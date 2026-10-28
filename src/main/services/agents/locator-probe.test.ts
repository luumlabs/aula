// Port de `Tests/AgentKitTests/CLILocatorProbeTests.swift`: búsqueda de las CLIs, entorno de los hijos, PATH del shell de login
// y estado de cada CLI (versión y sesión) contra CLIs falsas.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeCodeRunner } from './claude'
import { CodexRunner } from './codex'
import { buildChildEnvironment, findExecutable, locatorOverrides, mergedPATH, parseLoginPATH, queryLoginShellPATH, wellKnownDirectories } from './locator'
import { OpenCodeRunner } from './opencode'
import { openCodeCredentialCounts, parseVersion, probeCLI, probeSettings, stripANSI } from './probe'
import { cliAgentConfig, createCLIRunner } from './provider'
import { cleanupTempDirs, makeTempDir, writeExecutable } from './__fixtures__/support'

beforeEach(() => {
  locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
  locatorOverrides.searchDirectories = ['/usr/bin', '/bin'] // sin `claude`/`codex`/`opencode` reales del usuario
})
afterEach(() => {
  locatorOverrides.loginPATH = undefined
  locatorOverrides.searchDirectories = undefined
})
afterAll(() => cleanupTempDirs())

describe('Localizador de CLIs', () => {
  it('la ruta explícita tiene prioridad', () => {
    const tool = writeExecutable(join(makeTempDir(), 'claude'), '#!/bin/sh\necho hola\n')
    const other = makeTempDir()
    writeExecutable(join(other, 'claude'), '#!/bin/sh\n')
    locatorOverrides.searchDirectories = [other]
    expect(findExecutable('claude', tool)).toBe(tool)
    expect(findExecutable('claude')).toBe(join(other, 'claude'))
  })

  it('una carpeta explícita se busca por dentro (y se recortan espacios)', () => {
    const dir = makeTempDir()
    const tool = writeExecutable(join(dir, 'opencode'), '#!/bin/sh\n')
    expect(findExecutable('opencode', dir)).toBe(tool)
    expect(findExecutable('opencode', `  ${tool}  `)).toBe(tool)
  })

  it('una ruta explícita no válida vuelve a la búsqueda', () => {
    const dir = makeTempDir()
    const tool = writeExecutable(join(dir, 'codex'), '#!/bin/sh\n')
    locatorOverrides.searchDirectories = [dir]
    expect(findExecutable('codex', '/no/existe/codex')).toBe(tool)
    expect(findExecutable('noexiste', '/no/existe')).toBeUndefined()
  })

  it('los archivos sin permiso de ejecución y las carpetas se saltan', () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'claude'), 'no ejecutable')
    mkdirSync(join(dir, 'codex'))
    locatorOverrides.searchDirectories = [dir]
    expect(findExecutable('claude')).toBeUndefined()
    expect(findExecutable('codex')).toBeUndefined()
  })

  it('un nombre con «/» es una ruta', () => {
    const dir = makeTempDir()
    const tool = writeExecutable(join(dir, 'tool'), '#!/bin/sh\n')
    expect(findExecutable(tool)).toBe(tool)
    expect(findExecutable('../../bin/sh_inexistente')).toBeUndefined()
    expect(findExecutable(join(dir, 'nada'))).toBeUndefined()
  })

  it('el orden de búsqueda es el de las carpetas', () => {
    const first = makeTempDir()
    const second = makeTempDir()
    const a = writeExecutable(join(first, 'tool'), '#!/bin/sh\n')
    writeExecutable(join(second, 'tool'), '#!/bin/sh\n')
    locatorOverrides.searchDirectories = [first, second]
    expect(findExecutable('tool')).toBe(a)
  })
})

describe('Entorno de los procesos hijo', () => {
  it('quita las variables de la sesión padre y conserva las del usuario', () => {
    const base: Record<string, string> = {
      HOME: '/Users/x', PATH: '/usr/bin:/bin', LANG: 'es_ES.UTF-8',
      CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_SSE_PORT: '1234', CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_HOST_SESSION_ID: 'h', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s.sock', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_PID: '9',
      CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: 'true', AI_AGENT: 'claude-code',
      BAGGAGE: 'sentry-trace_id=1', USE_STAGING_OAUTH: '1', CODEX_SANDBOX: 'seatbelt', OPENCODE: '1', OLDPWD: '/viejo', ELECTRON_RUN_AS_NODE: '1',
      // credenciales y ajustes que el usuario puso a propósito: se conservan
      ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_BASE_URL: 'https://gw.example', OPENAI_API_KEY: 'sk-x', CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-work', CLAUDE_CODE_USE_BEDROCK: '1', HTTPS_PROXY: 'http://p:3128'
    }
    const env = buildChildEnvironment(base, null, {})
    for (const name of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID', 'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH', 'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL', 'AI_AGENT',
      'BAGGAGE', 'USE_STAGING_OAUTH', 'CODEX_SANDBOX', 'OPENCODE', 'OLDPWD', 'ELECTRON_RUN_AS_NODE']) {
      expect(env[name], name).toBeUndefined()
    }
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'HTTPS_PROXY', 'LANG', 'HOME']) {
      expect(env[name], name).toBeDefined()
    }
    expect(env.NO_COLOR).toBe('1')
    expect(env.TERM).toBe('dumb')
  })

  it('«extra» manda y el PATH se combina sin duplicados', () => {
    const home = makeTempDir()
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    const env = buildChildEnvironment({ HOME: home, PATH: '/usr/bin:/bin:/usr/bin' }, '/opt/x/bin:/usr/bin:/opt/y/bin', { PATH_EXTRA: '1', NO_COLOR: '0', HOME: '/otra' })
    expect(env.NO_COLOR).toBe('0')
    expect(env.HOME).toBe('/otra')
    const path = env.PATH.split(':')
    expect(path.slice(0, 3)).toEqual(['/opt/x/bin', '/usr/bin', '/opt/y/bin']) // el del shell de login primero
    expect(path.filter((p) => p === '/usr/bin')).toHaveLength(1)
    expect(path).toContain('/bin')
    expect(path).toContain(`${home}/.local/bin`) // las carpetas habituales que existen
  })

  it('sin PATH de partida siguen las carpetas del sistema, al final', () => {
    const path = mergedPATH(null, null, '/no/existe').split(':')
    expect(path.slice(-4)).toEqual(['/usr/bin', '/bin', '/usr/sbin', '/sbin'])
    expect(path.some((p) => p.startsWith('/no/existe'))).toBe(false)
  })

  it('las versiones de nvm van de la más nueva a la más vieja', () => {
    const home = makeTempDir()
    for (const v of ['v18.20.4', 'v22.11.0', 'v20.18.1', 'v9.0.0']) mkdirSync(join(home, `.nvm/versions/node/${v}/bin`), { recursive: true })
    const dirs = wellKnownDirectories(home, {}).filter((d) => d.includes('.nvm')).map((d) => basename(dirname(d)))
    expect(dirs).toEqual(['v22.11.0', 'v20.18.1', 'v18.20.4', 'v9.0.0'])
  })
})

describe('PATH del shell de login', () => {
  it('ignora el ruido del shell', () => {
    expect(parseLoginPATH('Last login: ayer\nruido\n__AULA_PATH_BEGIN__/a:/b:/c__AULA_PATH_END__\notro ruido')).toBe('/a:/b:/c')
    expect(parseLoginPATH('sin marcas')).toBeNull()
    expect(parseLoginPATH('__AULA_PATH_BEGIN__sin fin')).toBeNull()
    expect(parseLoginPATH('__AULA_PATH_BEGIN____AULA_PATH_END__')).toBeNull()
    expect(parseLoginPATH('__AULA_PATH_BEGIN__  /x:/y \n __AULA_PATH_END__')).toBe('/x:/y')
  })

  it('un shell colgado se corta con el plazo', async () => {
    const shell = writeExecutable(join(makeTempDir(), 'lento'), '#!/bin/sh\nsleep 30\n')
    const previous = process.env.SHELL
    process.env.SHELL = shell
    try {
      const started = Date.now()
      expect(await queryLoginShellPATH(500)).toBeNull()
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      if (previous === undefined) delete process.env.SHELL
      else process.env.SHELL = previous
    }
  })
})

describe('Estado de las CLIs', () => {
  const fake = (dir: string, name: string, script: string): string => writeExecutable(join(dir, name), `#!/bin/bash\n${script}\n`)

  it('Claude con sesión', async () => {
    const path = fake(makeTempDir(), 'claude', `case "$1 $2" in
  "--version ") echo "2.1.288 (Claude Code)";;
  "auth status") echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty"}';;
  *) echo "otro" >&2; exit 9;;
esac`)
    const s = await probeCLI('claude', { explicitPath: path })
    expect(s.installed).toBe(true)
    expect(s.version).toBe('2.1.288')
    expect(s.loggedIn).toBe(true)
    expect(s.path).toBe(path)
    expect(s.detail).toBe('Claude Code 2.1.288 · sesión iniciada (claude.ai)')
  })

  it('Claude sin sesión (código 1 pero con JSON)', async () => {
    const path = fake(makeTempDir(), 'claude', `if [ "$1" = "--version" ]; then echo "2.0.5 (Claude Code)"; exit 0; fi
echo '{"loggedIn": false, "authMethod": "none"}'; exit 1`)
    const s = await probeCLI('claude', { explicitPath: path })
    expect(s.loggedIn).toBe(false)
    expect(s.detail).toContain('sin sesión')
    expect(s.detail).toContain('Abre Terminal y ejecuta `claude`')
  })

  it('Claude antiguo sin «auth» = no se sabe', async () => {
    const path = fake(makeTempDir(), 'claude', `if [ "$1" = "--version" ]; then echo "1.0.3 (Claude Code)"; exit 0; fi
echo "error: unknown command 'auth'" >&2; exit 1`)
    const s = await probeCLI('claude', { explicitPath: path })
    expect(s.installed).toBe(true)
    expect(s.loggedIn).toBeNull()
    expect(s.detail).toContain('no se pudo comprobar')
  })

  it('Codex con y sin sesión', async () => {
    const dir = makeTempDir()
    const ok = await probeCLI('codex', { explicitPath: fake(dir, 'codex-ok', `if [ "$1" = "--version" ]; then echo "codex-cli 0.46.0"; exit 0; fi
if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
exit 5`) })
    expect(ok.version).toBe('0.46.0')
    expect(ok.loggedIn).toBe(true)
    const no = await probeCLI('codex', { explicitPath: fake(dir, 'codex-no', `if [ "$1" = "--version" ]; then echo "codex-cli 0.46.0"; exit 0; fi
echo "Not logged in" >&2; exit 1`) })
    expect(no.loggedIn).toBe(false)
    expect(no.detail).toContain('Conectar con ChatGPT')
    const unknown = await probeCLI('codex', { explicitPath: fake(dir, 'codex-raro', `if [ "$1" = "--version" ]; then echo "codex-cli 0.1.0"; exit 0; fi
echo "algo inesperado" >&2; exit 3`) })
    expect(unknown.loggedIn).toBeNull()
  })

  it('OpenCode cuenta las credenciales', async () => {
    const dir = makeTempDir()
    const a = await probeCLI('opencode', { explicitPath: fake(dir, 'opencode-a', `if [ "$1" = "--version" ]; then echo "1.14.2"; exit 0; fi
printf '\\033[90m┌\\033[0m  Credentials ~/.local/share/opencode/auth.json\\n│\\n●  Anthropic api\\n│\\n└  2 credentials\\n\\n┌  Environment\\n●  OpenAI OPENAI_API_KEY\\n└  1 environment variable\\n'`) })
    expect(a.loggedIn).toBe(true)
    expect(a.version).toBe('1.14.2')
    expect(a.detail).toContain('2 credencial(es), 1 clave(s)')
    const b = await probeCLI('opencode', { explicitPath: fake(dir, 'opencode-b', `if [ "$1" = "--version" ]; then echo "1.14.2"; exit 0; fi
printf '┌  Credentials ~/.local/share/opencode/auth.json\\n│\\n└  0 credentials\\n'`) })
    expect(b.loggedIn).toBeNull() // sin credenciales no es «sin sesión»: Zen funciona sin cuenta
    expect(b.detail).toContain('OpenCode Zen')
    expect(openCodeCredentialCounts('opencode  stored\nopenai  environment\n')).toEqual({ credentials: 1, environmentKeys: 1 })
    expect(openCodeCredentialCounts('No authenticated integrations')).toEqual({ credentials: 0, environmentKeys: 0 })
  })

  it('no instaladas', async () => {
    for (const kind of ['claude', 'codex', 'opencode'] as const) {
      const s = await probeCLI(kind)
      expect(s.installed).toBe(false)
      expect(s.path).toBeUndefined()
      expect(s.loggedIn).toBeNull()
      expect(s.detail).toContain('no está instalado')
    }
  })

  it('una CLI colgada no bloquea para siempre', async () => {
    const path = fake(makeTempDir(), 'claude', 'sleep 60')
    probeSettings.commandTimeoutMs = 800
    try {
      const started = Date.now()
      const s = await probeCLI('claude', { explicitPath: path })
      expect(Date.now() - started).toBeLessThan(6000)
      expect(s.installed).toBe(true)
      expect(s.detail).toContain('no respondió a tiempo')
    } finally {
      probeSettings.commandTimeoutMs = 10_000
    }
  })

  it('un archivo sin permiso de ejecución no cuenta como instalado', async () => {
    const file = join(makeTempDir(), 'claude')
    writeFileSync(file, 'texto')
    expect((await probeCLI('claude', { explicitPath: file })).installed).toBe(false)
  })

  it('versiones y colores', () => {
    expect(parseVersion('2.1.288 (Claude Code)')).toBe('2.1.288')
    expect(parseVersion('codex-cli 0.46.0')).toBe('0.46.0')
    expect(parseVersion('opencode 1.14.2-beta.3\n')).toBe('1.14.2-beta.3')
    expect(parseVersion('sin versión')).toBeUndefined()
    expect(stripANSI('\u001B[90m┌\u001B[0m  hola')).toBe('┌  hola')
  })

  it('la fábrica crea el agente adecuado', () => {
    const make = (kind: 'claude-cli' | 'codex-cli' | 'opencode-cli' | 'anthropic') => {
      const config = cliAgentConfig({ id: 'x', kind, label: 'X', model: 'm' })
      return config ? createCLIRunner(config) : undefined
    }
    expect(make('claude-cli')).toBeInstanceOf(ClaudeCodeRunner)
    expect(make('codex-cli')).toBeInstanceOf(CodexRunner)
    expect(make('opencode-cli')).toBeInstanceOf(OpenCodeRunner)
    expect(make('anthropic')).toBeUndefined()
    expect(make('claude-cli')?.config.model).toBe('m')
    expect(make('claude-cli')?.config.kind).toBe('claude')
  })
})
