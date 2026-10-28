// Port de `Tests/AgentKitTests/CodexAccountTests.swift`: «Conectar con ChatGPT» con el inicio de sesión OFICIAL de Codex, contra
// una `codex` falsa que imita la salida real de `codex login` (rust-v0.162.1). Nunca se abre el navegador.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CodexLoginEvent } from '@shared/agents'
import { CLAUDE_ALIASES, cliModelCatalog, parseOpenCodeModels } from './catalogs'
import { codexIsLoggedIn, codexLogin, codexLogout, codexModels, parseCodexModels, CodexLoginOutput, codexAuthURL } from './codex-account'
import { AgentError } from './errors'
import { locatorOverrides } from './locator'
import { cleanupTempDirs, makeTempDir, processExists, waitUntil, writeExecutable } from './__fixtures__/support'

/** Lo que escribe la CLI real (`login/src/server.rs`) en stderr antes de esperar al navegador. */
const BROWSER_BANNER = `Starting local login server on http://localhost:1455.
If your browser did not open, navigate to this URL to authenticate:

https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_TEST&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=abc&code_challenge_method=S256&state=xyz

On a remote or headless machine? Use \`codex login --device-auth\` instead.`

const sq = (s: string): string => s.replace(/'/g, `'\\''`)

/** `codex` falsa: `login` imprime la página, espera y guarda `auth.json` en `$CODEX_HOME`; `login status`, `logout`, `debug models`. */
function fakeCodex(dir: string, loginBody?: string): string {
  const log = join(dir, 'calls.log')
  const login = loginBody ?? `printf '%s\\n' '${sq(BROWSER_BANNER)}' >&2
sleep 0.3
echo '{"tokens":{}}' > "$CODEX_HOME/auth.json"
echo "Successfully logged in" >&2
exit 0`
  const script = `#!/bin/bash
echo "$CODEX_HOME|$*" >> '${log}'
case "$*" in
  *"login status"*) if [ -f "$CODEX_HOME/auth.json" ]; then echo "Logged in using ChatGPT" >&2; exit 0; else echo "Not logged in" >&2; exit 1; fi ;;
  *"logout"*) rm -f "$CODEX_HOME/auth.json"; echo "Successfully logged out" >&2; exit 0 ;;
  *"debug models --bundled"*) echo '{"models":[{"slug":"gpt-6-luna","display_name":"GPT-6-Luna","visibility":"list","priority":4,"context_window":272000,"input_modalities":["text","image"]},{"slug":"gpt-6.1-sol","display_name":"GPT-6.1-Sol","visibility":"list","priority":1,"context_window":272000},{"slug":"codex-auto-review","visibility":"hide","priority":43}]}'; exit 0 ;;
  *"debug models"*) echo "error: not logged in" >&2; exit 1 ;;
  *"login"*)
${login}
  ;;
esac
exit 2
`
  return writeExecutable(join(dir, 'codex'), script)
}

const calls = (dir: string): string[] => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean) : [])

async function loginEvents(it: AsyncIterable<CodexLoginEvent>): Promise<{ events: CodexLoginEvent[]; error?: unknown }> {
  const events: CodexLoginEvent[] = []
  try {
    for await (const e of it) events.push(e)
    return { events }
  } catch (error) {
    return { events, error }
  }
}

beforeEach(() => {
  locatorOverrides.loginPATH = () => '/usr/bin:/bin:/usr/sbin:/sbin'
  locatorOverrides.searchDirectories = ['/usr/bin', '/bin']
})
afterEach(() => {
  locatorOverrides.loginPATH = undefined
  locatorOverrides.searchDirectories = undefined
})
afterAll(() => cleanupTempDirs())

describe('CodexAccount', () => {
  it('el catálogo conserva los esfuerzos exactos de la CLI (también «ultra»)', () => {
    const models = parseCodexModels(JSON.parse('{"models":[{"slug":"gpt-6.1-sol","supported_reasoning_levels":[{"effort":"low"},{"effort":"xhigh"},{"effort":"ultra"}],"default_reasoning_level":"low"}]}'))
    expect(models[0].reasoningEfforts).toEqual(['low', 'xhigh', 'ultra'])
    expect(models[0].defaultEffort).toBe('low')
    const openCode = parseOpenCodeModels('provider/model\n{\n"variants": {"low": {}, "max": {}},\n"limit": {"context": 64000}\n}\nprovider/plain\n')
    expect(openCode[0].reasoningEfforts).toEqual(['low', 'max'])
    expect(openCode[0].contextLength).toBe(64_000)
    expect(openCode[openCode.length - 1].reasoningEfforts).toEqual([])
  })

  it('inicio de sesión en el navegador: anuncia la página y termina', async () => {
    const dir = makeTempDir()
    const codex = fakeCodex(dir)
    const home = join(dir, 'home sesión') // con espacios y tilde, y sin crear: la CLI exige que exista
    const { events, error } = await loginEvents(codexLogin(codex, { home, timeoutMs: 20_000 }))
    expect(error).toBeUndefined()
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('waitingForBrowser')
    const url = new URL(events[0].type === 'waitingForBrowser' ? events[0].url ?? '' : '')
    expect(url.hostname).toBe('auth.openai.com')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(events[1]).toEqual({ type: 'finished' })
    expect(existsSync(join(home, 'auth.json'))).toBe(true) // la sesión queda en la carpeta de Aula
    const call = calls(dir)[0]
    expect(call.startsWith(home + '|')).toBe(true)
    expect(call).toContain('-c cli_auth_credentials_store="file" login')
    expect(await codexIsLoggedIn(codex, home)).toBe(true)
  })

  it('el código de dispositivo se muestra', async () => {
    const dir = makeTempDir()
    const device = `printf '\\033[94mWelcome to Codex [v0.162.1]\\033[0m\\nOpenAI'"'"'s command-line coding agent\\n\\nFollow these steps to sign in with ChatGPT using device code authorization:\\n\\n1. Open this link in your browser and sign in to your account\\n   \\033[94mhttps://auth.openai.com/codex/device\\033[0m\\n\\n2. Enter this one-time code \\033[90m(expires in 15 minutes)\\033[0m\\n   \\033[94mQX7P-9KDM\\033[0m\\n'
sleep 0.2
echo '{}' > "$CODEX_HOME/auth.json"; echo "Successfully logged in" >&2; exit 0`
    const codex = fakeCodex(dir, device)
    const { events } = await loginEvents(codexLogin(codex, { home: join(dir, 'h'), deviceAuth: true, timeoutMs: 20_000 }))
    expect(events[0]).toEqual({ type: 'deviceCode', url: 'https://auth.openai.com/codex/device', code: 'QX7P-9KDM' })
    expect(events[events.length - 1]).toEqual({ type: 'finished' })
    expect(calls(dir)[0].endsWith('login --device-auth')).toBe(true)
  })

  it('un inicio de sesión fallido es un error claro', async () => {
    const dir = makeTempDir()
    const codex = fakeCodex(dir, "echo 'Error logging in: Token exchange failed: 400 Bad Request' >&2; exit 1")
    const failed = await loginEvents(codexLogin(codex, { home: join(dir, 'h'), timeoutMs: 20_000 }))
    expect(failed.error).toBeInstanceOf(AgentError)
    expect((failed.error as AgentError).kind).toBe('notLoggedIn')
    expect((failed.error as AgentError).message).toContain('No se pudo iniciar sesión en ChatGPT')
    expect((failed.error as AgentError).message).toContain('Token exchange failed')
    const device = fakeCodex(makeTempDir(), "echo 'Error logging in with device code: device code login is not enabled for this Codex server.' >&2; exit 1")
    const unsupported = await loginEvents(codexLogin(device, { home: join(dir, 'h2'), deviceAuth: true, timeoutMs: 20_000 }))
    expect((unsupported.error as AgentError).kind).toBe('unsupported')
    expect((unsupported.error as AgentError).message).toContain('navegador')
  })

  it('se agota el plazo y la CLI muere', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'pid')
    const codex = fakeCodex(dir, `echo $$ > '${pidFile}'; printf '%s\\n' '${sq(BROWSER_BANNER)}' >&2; sleep 300`)
    const started = Date.now()
    const { events, error } = await loginEvents(codexLogin(codex, { home: join(dir, 'h'), timeoutMs: 1000 }))
    expect((error as AgentError).kind).toBe('timeout')
    expect((error as AgentError).message).toContain('Conectar con ChatGPT')
    expect(events.some((e) => e.type === 'waitingForBrowser')).toBe(true)
    expect(Date.now() - started).toBeLessThan(8000)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(await waitUntil(() => !processExists(pid))).toBe(true) // no queda esperando al navegador
  })

  it('cancelar detiene el inicio de sesión sin error', async () => {
    const dir = makeTempDir()
    const pidFile = join(dir, 'pid')
    const codex = fakeCodex(dir, `echo $$ > '${pidFile}'; printf '%s\\n' '${sq(BROWSER_BANNER)}' >&2; sleep 300`)
    const controller = new AbortController()
    let sawPage = false
    const running = loginEvents(
      (async function* () {
        for await (const e of codexLogin(codex, { home: join(dir, 'h'), timeoutMs: 60_000, signal: controller.signal })) {
          if (e.type === 'waitingForBrowser') {
            sawPage = true
            controller.abort()
          }
          yield e
        }
      })()
    )
    const { error } = await running
    expect(sawPage).toBe(true)
    expect(error).toBeUndefined()
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    expect(await waitUntil(() => !processExists(pid))).toBe(true)
  })

  it('estado, cierre de sesión y modelos', async () => {
    const dir = makeTempDir()
    const codex = fakeCodex(dir)
    const home = join(dir, 'h')
    expect(await codexIsLoggedIn(codex, home)).toBe(false)
    writeFileSync(join(home, 'auth.json'), '{}')
    expect(await codexIsLoggedIn(codex, home)).toBe(true)
    await codexLogout(codex, home)
    expect(await codexIsLoggedIn(codex, home)).toBe(false)
    // sin sesión, `debug models` falla y se usa el catálogo del propio binario (por prioridad, sin los ocultos)
    const models = await codexModels(codex, home)
    expect(models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna'])
    expect(models[models.length - 1].supportsVision).toBe(true)
    expect(models[0].displayName).toBe('GPT-6.1-Sol')
  })

  it('lista de modelos de OpenCode', () => {
    const text = '\u001B[1mopencode/deepseek-v4.1-flash\u001B[0m\nopencode/mimo-v2.6-flash-free\nanthropic/claude-sonnet-5-5\nNot a model line\nopencode/deepseek-v4.1-flash\n'
    const models = parseOpenCodeModels(text)
    expect(models.map((m) => m.id)).toEqual(['opencode/deepseek-v4.1-flash', 'opencode/mimo-v2.6-flash-free', 'anthropic/claude-sonnet-5-5'])
    expect(models[1].isFree).toBe(true)
  })

  it('los alias de Claude son los documentados', async () => {
    expect((await cliModelCatalog('claude')).map((m) => m.id)).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
    expect(CLAUDE_ALIASES).toHaveLength(4)
  })

  it('solo páginas de OpenAI (nunca el servidor local) y el código tras «one-time code»', () => {
    expect(codexAuthURL('navigate to http://localhost:1455/auth/callback')).toBeUndefined()
    expect(codexAuthURL('https://evil.example.com/auth.openai.com')).toBeUndefined()
    expect(codexAuthURL('see https://auth.openai.com/oauth/authorize?x=1')).toBe('https://auth.openai.com/oauth/authorize?x=1')
    const out = new CodexLoginOutput()
    expect(out.feed('QX7P-9KDM')).toEqual([]) // sin página ni aviso previo no es un código
  })
})
