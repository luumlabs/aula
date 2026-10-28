// Errores de los agentes CLI: reconocimiento de los mensajes de las CLIs (en inglés) y conversión en errores claros
// (port de `AgentKit/CLI/AgentErrors.swift`). Los textos salen en el idioma de la interfaz (`tr`); la interfaz usa `code`.
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'
import { AulaError } from '../errors'

export type AgentErrorKind =
  | 'missingKey'
  | 'network'
  | 'http'
  | 'rateLimited'
  | 'badResponse'
  | 'cancelled'
  | 'timeout'
  | 'notInstalled'
  | 'notLoggedIn'
  | 'unsupported'
  | 'other'

/** Código estable para la interfaz (RpcErrorInfo.code). */
export function codeForKind(kind: AgentErrorKind): string {
  switch (kind) {
    case 'missingKey':
      return 'ai_missing_key'
    case 'network':
      return 'ai_network'
    case 'http':
      return 'ai_http'
    case 'rateLimited':
      return 'ai_rate_limit'
    case 'badResponse':
      return 'ai_bad_response'
    case 'cancelled':
      return 'cancelled'
    case 'timeout':
      return 'ai_timeout'
    case 'notInstalled':
      return 'ai_not_installed'
    case 'notLoggedIn':
      return 'ai_auth'
    case 'unsupported':
      return 'ai_unsupported'
    default:
      return 'ai_error'
  }
}

/** Error de un agente o proveedor con su tipo (y cuándo reintentar, si se sabe). */
export class AgentError extends AulaError {
  readonly kind: AgentErrorKind
  /** Segundos hasta que se restablece un límite de uso. */
  readonly retryAfter?: number
  constructor(kind: AgentErrorKind, message: string, retryAfter?: number) {
    super(codeForKind(kind), message, retryAfter !== undefined ? { retryAfter } : undefined)
    this.name = 'AgentError'
    this.kind = kind
    this.retryAfter = retryAfter
  }
}

/** Error de cancelación (se trata como «terminar sin error»). */
export class CancelledError extends Error {
  constructor(message = tr('Cancelado', 'Cancelled')) {
    super(message)
    this.name = 'AbortError'
  }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof Error && err.name === 'AbortError') || (err instanceof AgentError && err.kind === 'cancelled')
}

// MARK: Límites de uso

/** Cuándo se restablece un límite de uso. */
export interface RateLimitInfo {
  /** Segundos desde «ahora». */
  retryAfter?: number
  /** Momento absoluto (ms desde 1970). */
  resetDate?: number
}

/** Opciones de fecha para pruebas: «ahora» (ms) y zona horaria por defecto (IANA). */
export interface ClockOptions {
  now?: number
  timeZone?: string
}

/** «Se restablece en 2 h 10 min (hacia las 15:00).» Vacía si no se sabe cuándo. */
export function rateLimitPhrase(info: RateLimitInfo, opts: ClockOptions = {}): string {
  if (info.retryAfter === undefined) return ''
  const duration = humanDuration(info.retryAfter)
  if (info.resetDate === undefined) return tr(`Se restablece en ${duration}.`, `It resets in ${duration}.`)
  const far = info.retryAfter > 20 * 3600
  const formatter = new Intl.DateTimeFormat(tr('es-ES', 'en-US'), {
    ...(far ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: tr('h23', 'h12') as 'h23' | 'h12',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {})
  })
  const at = formatter.format(new Date(info.resetDate))
  return tr(`Se restablece en ${duration} (hacia las ${at}).`, `It resets in ${duration} (around ${at}).`)
}

/** «2 h 10 min», «3 días 2 h», «menos de 1 min». */
export function humanDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return tr('menos de 1 min', 'less than 1 min')
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  if (days > 0) {
    const dayText = days === 1 ? tr('1 día', '1 day') : tr(`${days} días`, `${days} days`)
    return hours > 0 ? `${dayText} ${hours} h` : dayText
  }
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  return `${minutes} min`
}

export function isAuthFailure(text: string): boolean {
  const lower = text.toLowerCase()
  const phrases = [
    'not logged in', 'please run /login', 'run /login', 'invalid api key', 'authentication_failed', 'authentication_error',
    'oauth token has expired', 'token has expired', 'token_expired', 'failed to authenticate', 'not authenticated', 'please log in',
    'login required', 'codex login', 'provider auth', 'providerautherror', 'missing bearer', 'no credentials', 'invalid_api_key',
    'incorrect api key', 'refresh token', 'sign in with chatgpt', 'you must be logged in', 'authentication required'
  ]
  if (phrases.some((p) => lower.includes(p))) return true
  return /(status|error|http|code)\D{0,8}401|401\s+unauthorized|unauthorized/i.test(lower)
}

export function isRateLimit(text: string): boolean {
  const lower = text.toLowerCase()
  const phrases = [
    'rate limit', 'rate_limit', 'usage limit', 'hit your limit', 'hit your session limit', 'limit reached', 'reached your usage',
    'too many requests', 'session limit', 'weekly limit', '5-hour limit', 'exceeded your current quota', 'insufficient_quota',
    'usage_limit_reached', 'quota exceeded'
  ]
  if (phrases.some((p) => lower.includes(p))) return true
  return /(status|error|http|code)\D{0,8}429|429\s+too many/i.test(lower)
}

/** Si el texto dice que la CLI no conoce un flag, devuelve ese flag (`--tools`…). */
export function unsupportedFlag(text: string): string | undefined {
  const patterns = [
    /unknown option '(-{1,2}[A-Za-z0-9-]+)/, // commander (claude)
    /unexpected argument '(-{1,2}[A-Za-z0-9-]+)'/, // clap (codex)
    /unrecognized (?:option|argument)[: ]+'?(-{1,2}[A-Za-z0-9-]+)/,
    /Unknown arguments?: ([A-Za-z0-9-]+)/ // yargs (opencode)
  ]
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (!m) continue
    const flag = m[1]
    return flag.startsWith('-') ? flag : '--' + flag
  }
  return undefined
}

export function isNetworkFailure(text: string): boolean {
  const lower = text.toLowerCase()
  const phrases = ['enotfound', 'econnrefused', 'econnreset', 'etimedout', 'getaddrinfo', 'fetch failed', 'network is unreachable',
    'no internet', 'could not resolve host', 'connection error', 'unable to connect', 'offline', 'dns error', 'connection refused', 'no connection to']
  return phrases.some((p) => lower.includes(p))
}

function firstCapture(text: string, pattern: RegExp): string | undefined {
  const m = pattern.exec(text)
  return m && m.length > 1 ? m[1] : undefined
}

/** Suma las duraciones de un texto como «4 days 2 hours 9 minutes» o «1h 20m 5s». */
export function durationSeconds(text: string): number {
  const re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi
  let total = 0
  for (const m of text.matchAll(re)) {
    const value = Number(m[1])
    if (!Number.isFinite(value)) continue
    switch (m[2].toLowerCase()[0]) {
      case 'd':
        total += value * 86_400
        break
      case 'h':
        total += value * 3_600
        break
      case 'm':
        total += value * 60
        break
      case 's':
        total += value
        break
    }
  }
  return total
}

function info(resetAt: number, now: number): RateLimitInfo {
  return { retryAfter: Math.max(0, (resetAt - now) / 1000), resetDate: resetAt }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Desfase (ms) de `timeZone` respecto a UTC en el instante `utc`. */
function zoneOffset(utc: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(utc))
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUTC = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
  return asUTC - Math.floor(utc / 1000) * 1000
}

/** Fecha y hora de pared en `timeZone` → instante (ms). */
function zonedTime(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo, d, h, mi, 0)
  let t = guess - zoneOffset(guess, timeZone)
  t = guess - zoneOffset(t, timeZone)
  return t
}

/** Año, mes (0-11) y día de `utc` en `timeZone`. */
function zonedYMD(utc: number, timeZone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(utc))
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return [n('year'), n('month') - 1, n('day')]
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Extrae del mensaje cuándo se restablece el límite. Reconoce:
 *  - `…limit reached|1760000000` (epoch tras la barra);  `"resetsAt":1760000000` (segundos o milisegundos);
 *  - `resets 3pm (Europe/Madrid)`, `resets Oct 9, 9am`, `resets at 15:30`;  Codex: `Try again at 3:45 PM.`, `Try again at Oct 14th, 2026 3:45 PM.`;
 *  - `try again in 4 days 2 hours 9 minutes`, `retry after 120 seconds`.
 */
export function parseRateLimit(text: string, opts: ClockOptions = {}): RateLimitInfo {
  const now = opts.now ?? Date.now()
  const baseZone = opts.timeZone ?? localZone()
  // 1) epoch tras una barra vertical
  const pipe = firstCapture(text, /\|\s*(\d{10})(?!\d)/)
  if (pipe) return info(Number(pipe) * 1000, now)
  // 2) "resetsAt": epoch (segundos o milisegundos)
  const resetsAt = firstCapture(text, /resets?_?[Aa]t\W+(\d{9,13})/i)
  if (resetsAt) {
    const n = Number(resetsAt)
    return info(resetsAt.length >= 13 ? n : n * 1000, now)
  }
  // 3) "try again in 4 days 2 hours"
  const rest = firstCapture(text, /(?:try again|retry|available again|resets?|reset)\s+in\s+([^\n|]+?)(?:\.\s|\.$|$)/i)
  if (rest) {
    const seconds = durationSeconds(rest)
    if (seconds > 0) return { retryAfter: seconds, resetDate: now + seconds * 1000 }
  }
  // 4) "retry-after: 120"
  const after = firstCapture(text, /retry[-_ ]after\D{0,4}(\d+)/i)
  if (after && Number(after) > 0) return { retryAfter: Number(after), resetDate: now + Number(after) * 1000 }
  // 5) "resets 3pm (America/New_York)", "resets Oct 9 at 9:30am", "Try again at 3:45 PM."
  const re = /(?:[Rr]esets?|[Tt]ry again)\s+(?:at\s+|on\s+)?(?:(?<month>[A-Za-z]{3,9})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s*(?:\d{4}\s+)?(?:at\s+)?)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<ampm>[AaPp]\.?[Mm]\.?)?(?:\s*\((?<zone>[^)]+)\))?/
  const m = re.exec(text)
  if (m?.groups?.hour) {
    let hour = Number(m.groups.hour)
    const minute = m.groups.minute ? Number(m.groups.minute) : 0
    const ampm = m.groups.ampm?.toLowerCase().replace(/\./g, '')
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    if (hour <= 23 && minute <= 59) {
      let zone = baseZone
      const named = m.groups.zone?.trim()
      if (named && isValidZone(named)) zone = named
      const date = nextOccurrence(hour, minute, m.groups.month, m.groups.day ? Number(m.groups.day) : undefined, now, zone)
      if (date !== undefined) return info(date, now)
    }
  }
  return {}
}

function nextOccurrence(hour: number, minute: number, monthName: string | undefined, day: number | undefined, now: number, zone: string): number | undefined {
  const [y, mo, d] = zonedYMD(now, zone)
  const month = monthName ? MONTHS.indexOf(monthName.toLowerCase().slice(0, 3)) : -1
  if (monthName && day !== undefined && month >= 0) {
    let date = zonedTime(y, month, day, hour, minute, zone)
    if (date <= now) date = zonedTime(y + 1, month, day, hour, minute, zone)
    return date
  }
  let date = zonedTime(y, mo, d, hour, minute, zone)
  // ya pasó hoy → mañana a la misma hora de pared (Date.UTC desborda bien el día)
  if (date <= now) date = zonedTime(y, mo, d + 1, hour, minute, zone)
  return date
}

/** Primera opción de `optional` (y aún no retirada) que nombra el mensaje de un error `unsupported`. */
export function droppableFlag(error: AgentError, optional: ReadonlySet<string>, alreadyDropped: ReadonlySet<string>): string | undefined {
  if (error.kind !== 'unsupported') return undefined
  for (const m of error.message.matchAll(/(?<![A-Za-z0-9-])(-{1,2}[A-Za-z][A-Za-z0-9-]*)/g)) {
    const flag = m[1]
    if (optional.has(flag) && !alreadyDropped.has(flag)) return flag
  }
  return undefined
}

// MARK: Textos compartidos

// Getters y funciones: `tr()` se evalúa al usarlos, no al importar el módulo.
export const AgentL10n = {
  /** Nombre del modelo cuando la CLI usa el suyo por defecto. */
  get defaultModel(): string {
    return tr('predeterminado', 'default')
  },
  /** Nombre genérico de una herramienta cuando la CLI no dijo cuál era. */
  get unknownTool(): string {
    return tr('herramienta', 'tool')
  },
  get imagePlaceholder(): string {
    return tr('[imagen]', '[image]')
  },
  openTerminalToLogIn: (command: string): string =>
    tr(`Abre Terminal y ejecuta ${command} para iniciar sesión.`, `Open Terminal and run ${command} to sign in.`),
  updateWith: (command: string): string => tr(`Actualízalo con ${command}.`, `Update it with ${command}.`),
  emptyPrompt: (cli: string): string => tr(`No hay nada que pedirle a ${cli}: el prompt está vacío.`, `There’s nothing to ask ${cli}: the prompt is empty.`),
  inProcessToolsUnsupported: (cli: string): string =>
    tr(
      `Las herramientas en proceso no se pueden usar con ${cli}; hay que ofrecerlas como servidor MCP (\`mcpServers\`).`,
      `In-process tools can’t be used with ${cli}; they have to be offered as an MCP server (\`mcpServers\`).`
    ),
  tooOld: (c: CLIErrorClassifier): string =>
    tr(`Tu versión de ${c.cliName} es demasiado antigua para usarla desde Aula. ${c.updateInstruction}`, `Your version of ${c.cliName} is too old to use from Aula. ${c.updateInstruction}`),
  mcpCouldNotStart: (server: string, reason: string): string =>
    tr(`No pude iniciar el servidor MCP «${server}»: ${reason}`, `I couldn’t start the MCP server “${server}”: ${reason}`),
  mcpNotConnected: (server: string): string => tr(`El servidor MCP «${server}» no está conectado.`, `The MCP server “${server}” isn’t connected.`),
  detail: (text: string): string => tr(`Detalle: ${text}`, `Details: ${text}`)
}

/** Un texto fijo o calculado al usarlo (para que siga el idioma de la interfaz). */
type LazyText = string | (() => string)

function textOf(t: LazyText): string {
  return typeof t === 'function' ? t() : t
}

/** Recorta un texto largo conservando el principio y, sobre todo, el final (donde suele estar el motivo). */
export function clip(text: string, head = 400, tail = 1_100): string {
  const chars = Array.from(text)
  if (chars.length <= head + tail + 5) return text
  return chars.slice(0, head).join('') + ' … ' + chars.slice(-tail).join('')
}

/** Qué CLI es y cómo explicar sus problemas al usuario. */
export class CLIErrorClassifier {
  readonly #login: LazyText
  readonly #install: LazyText
  readonly #update: LazyText

  constructor(
    readonly cliName: string,
    readonly executableName: string,
    loginInstruction: LazyText,
    installInstruction: LazyText,
    updateInstruction: LazyText
  ) {
    this.#login = loginInstruction
    this.#install = installInstruction
    this.#update = updateInstruction
  }

  get loginInstruction(): string {
    return textOf(this.#login)
  }

  get installInstruction(): string {
    return textOf(this.#install)
  }

  get updateInstruction(): string {
    return textOf(this.#update)
  }

  static readonly claude = new CLIErrorClassifier(
    'Claude Code',
    'claude',
    () => AgentL10n.openTerminalToLogIn('`claude`'),
    () =>
      tr(
        'Instálalo con `curl -fsSL https://claude.ai/install.sh | bash` (o `npm install -g @anthropic-ai/claude-code`; en Windows, `irm https://claude.ai/install.ps1 | iex`) y abre Terminal para iniciar sesión con `claude`.',
        'Install it with `curl -fsSL https://claude.ai/install.sh | bash` (or `npm install -g @anthropic-ai/claude-code`; on Windows, `irm https://claude.ai/install.ps1 | iex`), then open Terminal and sign in with `claude`.'
      ),
    () => AgentL10n.updateWith('`claude update`')
  )

  static readonly codex = new CLIErrorClassifier(
    'Codex',
    'codex',
    () =>
      tr(
        `Pulsa «Conectar con ChatGPT» en ${settingsPath('ai', 'es')} para iniciar sesión con tu cuenta de ChatGPT.`,
        `Click “Connect with ChatGPT” in ${settingsPath('ai', 'en')} to sign in with your ChatGPT account.`
      ),
    () =>
      tr(
        `Pulsa «Conectar con ChatGPT» en ${settingsPath('ai', 'es')}: Aula descarga la herramienta oficial de OpenAI y abre el inicio de sesión. (Si prefieres Terminal: \`npm install -g @openai/codex\`).`,
        `Click “Connect with ChatGPT” in ${settingsPath('ai', 'en')}: Aula downloads OpenAI’s official tool and opens the sign-in. (If you prefer Terminal: \`npm install -g @openai/codex\`.)`
      ),
    () =>
      tr(
        'Actualízalo con `npm install -g @openai/codex@latest` (o `brew upgrade --cask codex`).',
        'Update it with `npm install -g @openai/codex@latest` (or `brew upgrade --cask codex`).'
      )
  )

  static readonly openCode = new CLIErrorClassifier(
    'OpenCode',
    'opencode',
    () =>
      tr(
        'Abre Terminal y ejecuta `opencode auth login` para añadir las credenciales del proveedor que usa el modelo elegido.',
        'Open Terminal and run `opencode auth login` to add the credentials for the provider the chosen model uses.'
      ),
    () =>
      tr(
        'Instálalo con `curl -fsSL https://opencode.ai/install | bash` (o `npm install -g opencode-ai`) y configura un proveedor con `opencode auth login`.',
        'Install it with `curl -fsSL https://opencode.ai/install | bash` (or `npm install -g opencode-ai`) and set up a provider with `opencode auth login`.'
      ),
    () => AgentL10n.updateWith('`opencode upgrade`')
  )

  get notInstalled(): AgentError {
    return new AgentError(
      'notInstalled',
      tr(
        `No encuentro la CLI de ${this.cliName} (\`${this.executableName}\`) en este ordenador. ${this.installInstruction}`,
        `I can’t find the ${this.cliName} CLI (\`${this.executableName}\`) on this computer. ${this.installInstruction}`
      )
    )
  }

  get notLoggedIn(): AgentError {
    return new AgentError('notLoggedIn', tr(`${this.cliName} no tiene la sesión iniciada. ${this.loginInstruction}`, `${this.cliName} isn’t signed in. ${this.loginInstruction}`))
  }

  /** Frases completas: límite alcanzado, cuándo se restablece, qué hacer y el detalle original de la CLI. */
  rateLimited(raw: string, rl: RateLimitInfo, opts: ClockOptions = {}): AgentError {
    const reset = rateLimitPhrase(rl, opts)
    const detail = raw.trim()
    const sentences = [tr(`Has alcanzado el límite de uso de tu suscripción de ${this.cliName}.`, `You’ve reached the usage limit of your ${this.cliName} subscription.`)]
    if (reset) sentences.push(reset)
    sentences.push(tr(`Espera o elige otro proveedor en ${settingsPath('ai', 'es')}.`, `Wait, or choose another provider in ${settingsPath('ai', 'en')}.`))
    if (detail) {
      const clipped = Array.from(detail).slice(0, 300).join('')
      sentences.push(tr(`Detalle de ${this.cliName}: ${clipped}`, `Details from ${this.cliName}: ${clipped}`))
    }
    return new AgentError('rateLimited', sentences.join(' '), rl.retryAfter)
  }

  unsupportedFlag(flag: string): AgentError {
    return new AgentError(
      'unsupported',
      tr(`Tu versión de ${this.cliName} no reconoce la opción \`${flag}\`. ${this.updateInstruction}`, `Your version of ${this.cliName} doesn’t recognize the \`${flag}\` option. ${this.updateInstruction}`)
    )
  }

  /** Convierte un texto de error (de stderr o del flujo de eventos) en el `AgentError` más útil. */
  classify(text: string, hint?: AgentErrorKind, retryAfter?: number, opts: ClockOptions = {}): AgentError {
    const message = text.trim()
    if (hint === 'notLoggedIn' || isAuthFailure(message)) return this.notLoggedIn
    if (hint === 'rateLimited' || isRateLimit(message)) {
      // el dato estructurado de la CLI (p. ej. `resetsAt`) es más fiable que interpretar el texto
      const now = opts.now ?? Date.now()
      const rl = retryAfter !== undefined ? { retryAfter, resetDate: now + retryAfter * 1000 } : parseRateLimit(message, opts)
      return this.rateLimited(message, rl, opts)
    }
    const flag = unsupportedFlag(message)
    if (flag) return this.unsupportedFlag(flag)
    if (hint === 'network' || isNetworkFailure(message)) {
      const detail = AgentL10n.detail(message.slice(0, 300))
      return new AgentError(
        'network',
        tr(`${this.cliName} no pudo conectarse a internet. Revisa tu conexión e inténtalo de nuevo. ${detail}`, `${this.cliName} couldn’t connect to the internet. Check your connection and try again. ${detail}`)
      )
    }
    if (!message) return new AgentError(hint ?? 'other', tr(`${this.cliName} terminó con un error sin detalles.`, `${this.cliName} ended with an error and no details.`))
    return new AgentError(hint ?? 'other', tr(`${this.cliName} devolvió un error: ${clip(message)}`, `${this.cliName} returned an error: ${clip(message)}`))
  }
}
