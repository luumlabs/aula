// La cuenta de ChatGPT de Codex, SIEMPRE a través del binario oficial (`codex login`, `codex login status`, `codex logout`,
// `codex debug models`): Aula nunca implementa el OAuth de OpenAI ni toca las credenciales (port de `CodexAccount.swift`).
//
//  - `codex login` BORRA y revoca la sesión que hubiera, abre un servidor local, abre el navegador y escribe en stderr «If your
//    browser did not open, navigate to this URL to authenticate: <url>». Acaba con «Successfully logged in» (0) o error (1).
//  - `codex login --device-auth` escribe la página (`https://auth.openai.com/codex/device`) y un código de un solo uso.
//  - `CODEX_HOME` cambia la carpeta de la sesión; Aula usa la suya con `cli_auth_credentials_store = "file"`.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { CodexLoginEvent } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import { captureCommand, ChildProcessHandle, exitSucceeded, SpawnError, type CaptureOutput } from './child-process'
import { AgentError, AgentL10n, CancelledError, humanDuration } from './errors'
import { eventStream } from './engine'
import { arr, get, int, isObject, str, tryParse } from './json'
import { LineBuffer } from './line-buffer'
import { childEnvironment } from './locator'
import { toml } from './mcp-config'
import { stripANSI } from './probe'

export const CODEX_LOGIN_TIMEOUT_MS = 600_000

/** Un modelo de la cuenta según la CLI. */
export interface CodexModel {
  id: string
  displayName?: string
  contextLength?: number
  supportsTools: boolean
  supportsVision?: boolean
  reasoningEfforts: string[]
  defaultEffort?: string
}

/** `-c cli_auth_credentials_store="file"`: la sesión de la carpeta de Aula queda en su `auth.json`, nunca en el llavero. */
export function codexStoreArguments(home: string | undefined): string[] {
  return home ? ['-c', `cli_auth_credentials_store=${toml('file')}`] : []
}

export function codexEnvironment(home: string | undefined): Record<string, string> {
  return childEnvironment({ NO_COLOR: '1', ...(home ? { CODEX_HOME: home } : {}) })
}

function capture(executable: string, args: string[], home: string | undefined, timeoutMs: number): Promise<CaptureOutput | null> {
  return captureCommand(executable, args, { env: codexEnvironment(home), cwd: home ?? tmpdir(), timeoutMs })
}

/** ¿Hay sesión? `true`/`false` según `codex login status`; `null` si no se pudo saber. */
export async function codexIsLoggedIn(executable: string, home: string | undefined, timeoutMs = 15_000): Promise<boolean | null> {
  if (home) mkdirSync(home, { recursive: true })
  const out = await capture(executable, [...codexStoreArguments(home), 'login', 'status'], home, timeoutMs)
  if (!out?.exit || out.timedOut) return null
  if (exitSucceeded(out.exit)) return true
  const text = (out.stdout.toString('utf8') + out.stderr.toString('utf8')).toLowerCase()
  return text.includes('not logged in') ? false : null
}

/** Cierra la sesión de esa carpeta (`codex logout`). */
export async function codexLogout(executable: string, home: string | undefined): Promise<void> {
  const out = await capture(executable, [...codexStoreArguments(home), 'logout'], home, 30_000)
  if (!out?.exit || !exitSucceeded(out.exit)) {
    const detail = (out?.stderr.toString('utf8') ?? '').trim()
    throw new AgentError('other', tr('No se pudo cerrar la sesión de ChatGPT.', 'Couldn’t sign out of ChatGPT.') + (detail ? ' ' + AgentL10n.detail(detail.slice(0, 300)) : ''))
  }
}

/** Modelos de la cuenta (`codex debug models`; sin red ni sesión, el catálogo del binario con `--bundled`). */
export async function codexModels(executable: string, home: string | undefined): Promise<CodexModel[]> {
  for (const extra of [[], ['--bundled']]) {
    const out = await capture(executable, [...codexStoreArguments(home), 'debug', 'models', ...extra], home, 20_000)
    if (!out?.exit || !exitSucceeded(out.exit)) continue
    const json = tryParse(out.stdout.toString('utf8'))
    if (json === undefined) continue
    const models = parseCodexModels(json)
    if (models.length > 0) return models
  }
  return []
}

/** `{"models":[{slug, display_name, visibility, priority, context_window, input_modalities, supported_reasoning_levels}]}`. */
export function parseCodexModels(json: unknown): CodexModel[] {
  const list = arr(get(json, 'models')) ?? arr(json) ?? []
  const rows: [number, CodexModel][] = []
  for (const m of list) {
    if (!isObject(m)) continue
    const slug = str(m.slug)
    if (!slug || m.visibility === 'hide') continue
    const modalities = arr(m.input_modalities)
    const efforts = (arr(m.supported_reasoning_levels) ?? [])
      .map((e) => str(e) ?? str(get(e, 'effort')))
      .filter((e): e is string => !!e)
    rows.push([
      int(m.priority) ?? 999,
      {
        id: slug,
        displayName: str(m.display_name),
        contextLength: int(m.context_window),
        supportsTools: true,
        supportsVision: modalities ? modalities.includes('image') : undefined,
        reasoningEfforts: efforts,
        defaultEffort: str(m.default_reasoning_level)
      }
    ])
  }
  return rows.sort((a, b) => a[0] - b[0]).map(([, m]) => m)
}

// MARK: Iniciar sesión

export interface CodexLoginOptions {
  home?: string
  deviceAuth?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Lanza `codex login` (o `--device-auth`) y emite lo que va pasando. Termina con `finished` o lanza un `AgentError` claro.
 * Cancelar (dejar de iterar o abortar `signal`) mata el proceso y termina sin error.
 */
export function codexLogin(executable: string, options: CodexLoginOptions = {}): AsyncIterableIterator<CodexLoginEvent> {
  return eventStream<CodexLoginEvent>(async (emit, signal) => {
    const home = options.home
    if (home) mkdirSync(home, { recursive: true })
    const args = [...codexStoreArguments(home), 'login', ...(options.deviceAuth ? ['--device-auth'] : [])]
    let proc: ChildProcessHandle
    try {
      proc = await ChildProcessHandle.spawn(executable, args, { env: codexEnvironment(home), cwd: home ?? tmpdir() })
    } catch (err) {
      const reason = err instanceof SpawnError || err instanceof Error ? err.message : String(err)
      throw new AgentError('notInstalled', tr(`No pude iniciar Codex: ${reason}`, `I couldn’t start Codex: ${reason}`))
    }
    proc.closeStdin()
    const parser = new CodexLoginOutput()
    const timeoutMs = options.timeoutMs ?? CODEX_LOGIN_TIMEOUT_MS
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.terminate(1000)
    }, Math.max(50, timeoutMs))
    const onAbort = (): void => proc.terminate(1000)
    signal.addEventListener('abort', onAbort, { once: true })
    const pump = async (stream: NodeJS.ReadableStream): Promise<void> => {
      const buffer = new LineBuffer()
      try {
        for await (const chunk of stream) for (const line of buffer.append(chunk as Buffer)) for (const e of parser.feed(line)) emit(e)
      } catch {
        /* tubería cortada */
      }
      const rest = buffer.finish()
      if (rest !== undefined) for (const e of parser.feed(rest)) emit(e)
    }
    await Promise.all([pump(proc.stdout), pump(proc.stderr)])
    const exit = await proc.waitForExit()
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (signal.aborted) throw new CancelledError()
    if (timedOut) {
      const took = humanDuration(timeoutMs / 1000)
      throw new AgentError(
        'timeout',
        tr(`No terminaste de iniciar sesión en ChatGPT en ${took}. Vuelve a pulsar «Conectar con ChatGPT».`, `You didn’t finish signing in to ChatGPT within ${took}. Click “Connect with ChatGPT” again.`)
      )
    }
    if (exitSucceeded(exit)) {
      emit({ type: 'finished' })
      return
    }
    const detail = parser.errorText
    if (detail.toLowerCase().includes('device code login is not enabled')) {
      throw new AgentError(
        'unsupported',
        tr(
          'Tu cuenta de ChatGPT no tiene activado el inicio de sesión con código. Usa el inicio de sesión en el navegador.',
          'Your ChatGPT account doesn’t have sign-in with a code turned on. Use the sign-in in the browser.'
        )
      )
    }
    const base = tr('No se pudo iniciar sesión en ChatGPT.', 'Couldn’t sign in to ChatGPT.')
    throw new AgentError('notLoggedIn', detail ? `${base} ${AgentL10n.detail(detail.slice(0, 300))}` : base)
  }, options.signal)
}

/** Lee la salida de `codex login`: la página de inicio de sesión, el código de dispositivo y el último error. */
export class CodexLoginOutput {
  private announced = false
  private deviceURL?: string
  private awaitingCode = false
  private lastError = ''

  get errorText(): string {
    return this.lastError
  }

  feed(raw: string): CodexLoginEvent[] {
    const line = stripANSI(raw).trim()
    if (!line) return []
    const lower = line.toLowerCase()
    if (lower.startsWith('error') || lower.includes('error logging in') || lower.includes('timed out') || lower.includes('not enabled')) this.lastError = line
    const url = codexAuthURL(line)
    if (url) {
      if (new URL(url).pathname.endsWith('/codex/device')) {
        this.deviceURL = url
        return []
      }
      if (!this.announced) {
        this.announced = true
        return [{ type: 'waitingForBrowser', url }]
      }
      return []
    }
    if (lower.includes('one-time code')) {
      this.awaitingCode = true
      return []
    }
    if (this.awaitingCode && this.deviceURL && /^[A-Z0-9]{3,6}(?:-[A-Z0-9]{3,6})+$|^[A-Z0-9]{6,12}$/.test(line)) {
      this.awaitingCode = false
      return [{ type: 'deviceCode', url: this.deviceURL, code: line }]
    }
    return []
  }
}

/** Una página de OpenAI para iniciar sesión (nunca la del servidor local). */
export function codexAuthURL(line: string): string | undefined {
  const m = /https:\/\/[^\s"'<>]+/.exec(line)
  if (!m) return undefined
  try {
    const url = new URL(m[0])
    const host = url.hostname.toLowerCase()
    if (host === 'auth.openai.com' || host.endsWith('.openai.com') || host === 'chatgpt.com') return url.toString()
  } catch {
    /* no es una URL */
  }
  return undefined
}
