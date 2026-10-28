// Localiza las CLIs de los agentes (`claude`, `codex`, `opencode`) y prepara el entorno con el que se lanzan
// (port de `AgentKit/CLI/CLILocator.swift`, ampliado a Windows y Linux).
//
// Una app abierta desde el Finder (o desde el menú de un escritorio Linux) no hereda el PATH del shell del usuario, y las CLIs
// instaladas con npm son scripts `#!/usr/bin/env node`: sin un PATH completo fallan con «env: node: No such file or directory».
// Por eso se consulta (una vez, con caché) el PATH de un shell de login y se completa con las carpetas habituales.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { captureCommand, isExecutableFile, windowsExecutableExtensions } from './child-process'

const isWindows = process.platform === 'win32'

/** Sustitutos para pruebas. */
export const locatorOverrides: {
  /** Si no es `undefined`, `find` solo mira estas carpetas. */
  searchDirectories?: string[]
  /** Si no es `undefined`, se usa en lugar de lanzar un shell de login. */
  loginPATH?: () => string | null
} = {}

// MARK: Búsqueda

function expandTilde(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Nombres de archivo a probar para `name` (en Windows con sus extensiones: `claude.exe`, `claude.cmd`…). */
function candidateNames(name: string): string[] {
  if (!isWindows) return [name]
  if (/\.(exe|cmd|bat|com)$/i.test(name)) return [name]
  // el .exe primero: los envoltorios .cmd necesitan resolverse
  return windowsExecutableExtensions()
    .sort((a, b) => (a === '.exe' ? -1 : b === '.exe' ? 1 : 0))
    .map((ext) => name + ext)
}

function findIn(directory: string, name: string): string | undefined {
  for (const candidate of candidateNames(name)) {
    const path = join(directory, candidate)
    if (isExecutableFile(path)) return path
  }
  return undefined
}

/**
 * Busca un ejecutable: ruta explícita (archivo o carpeta) → PATH del shell de login y del proceso → carpetas habituales
 * (`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, prefijo global de npm, `%APPDATA%\npm`…)
 * → la CLI incluida en la app de escritorio de Codex/ChatGPT. Llama antes a `prepareLocator()` para tener el PATH del shell.
 */
export function findExecutable(name: string, explicitPath?: string): string | undefined {
  if (name.includes('/') || (isWindows && name.includes('\\'))) {
    const expanded = expandTilde(name)
    return isExecutableFile(expanded) ? expanded : undefined
  }
  const explicit = explicitPath?.trim()
  if (explicit) {
    const expanded = expandTilde(explicit)
    if (isDirectory(expanded)) {
      const inside = findIn(expanded, name)
      if (inside) return inside
    } else if (isExecutableFile(expanded)) {
      return expanded
    }
  }
  for (const directory of searchDirectories()) {
    const found = findIn(directory, name)
    if (found) return found
  }
  return undefined
}

/** Carpetas con herramientas que instaló Aula (p. ej. su Codex oficial): se miran al final, tras las del usuario. */
const toolDirectories: string[] = []

export function addToolDirectory(directory: string): void {
  if (directory && !toolDirectories.includes(directory)) toolDirectories.push(directory)
}

function searchDirectories(): string[] {
  if (locatorOverrides.searchDirectories) return locatorOverrides.searchDirectories
  const home = homedir()
  const out: string[] = []
  const seen = new Set<string>()
  const add = (list: string[]): void => {
    for (const d of list) if (d && !seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  add(splitPath(loginShellPATHCached() ?? ''))
  add(splitPath(pathFromEnv(process.env as Record<string, string>) ?? ''))
  add(wellKnownDirectories(home))
  add(appBundleDirectories(home))
  add(toolDirectories)
  return out
}

function splitPath(value: string): string[] {
  return value.split(delimiter).filter(Boolean)
}

function pathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
}

function pathFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env[pathKey(env)]
}

// MARK: Carpetas habituales

/** Carpetas donde se instalan estas CLIs (solo las que existen). */
export function wellKnownDirectories(home = homedir(), env: Record<string, string | undefined> = process.env): string[] {
  const dirs: string[] = []
  if (isWindows) {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming')
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    dirs.push(
      join(appData, 'npm'),
      join(home, '.local', 'bin'),
      join(home, '.claude', 'local'),
      join(home, '.bun', 'bin'),
      join(home, '.opencode', 'bin'),
      join(local, 'pnpm'),
      join(home, 'scoop', 'shims'),
      join(local, 'Programs', 'claude'),
      join(local, 'Volta', 'bin'),
      join(env.ProgramFiles || 'C:\\Program Files', 'nodejs')
    )
    if (env.NVM_SYMLINK) dirs.push(env.NVM_SYMLINK)
    if (env.VOLTA_HOME) dirs.push(join(env.VOLTA_HOME, 'bin'))
  } else {
    dirs.push(
      `${home}/.local/bin`, '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', `${home}/.claude/local`,
      `${home}/.npm-global/bin`, `${home}/.bun/bin`, `${home}/.opencode/bin`, `${home}/.volta/bin`, `${home}/.cargo/bin`,
      `${home}/.asdf/shims`, `${home}/Library/pnpm`, `${home}/.local/share/pnpm`, `${home}/.deno/bin`, `${home}/go/bin`,
      `${home}/.nix-profile/bin`, '/home/linuxbrew/.linuxbrew/bin', '/snap/bin'
    )
    // ~/.nvm/versions/node/<versión>/bin, la versión más reciente primero
    const nvmRoot = `${home}/.nvm/versions/node`
    try {
      const versions = readdirSync(nvmRoot).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      dirs.push(...versions.map((v) => `${nvmRoot}/${v}/bin`))
    } catch {
      /* sin nvm */
    }
  }
  for (const prefix of npmGlobalPrefixes(home, env)) dirs.push(isWindows ? prefix : join(prefix, 'bin'))
  return Array.from(new Set(dirs)).filter((d) => existsSync(d))
}

let cachedNpmPrefix: string | null | undefined

/** Prefijos globales de npm: variable de entorno, `~/.npmrc` y (si ya se consultó) `npm prefix -g`. */
export function npmGlobalPrefixes(home = homedir(), env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = []
  const fromEnv = env.NPM_CONFIG_PREFIX || env.npm_config_prefix
  if (fromEnv) out.push(expandTilde(fromEnv))
  try {
    const rc = readFileSync(join(home, '.npmrc'), 'utf8')
    const m = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(rc)
    if (m) out.push(expandTilde(m[1].replace(/^["']|["']$/g, '').replace(/\$\{HOME\}/g, home)))
  } catch {
    /* sin .npmrc */
  }
  if (cachedNpmPrefix) out.push(cachedNpmPrefix)
  return out
}

/** CLIs que vienen dentro de una app de escritorio (solo para buscarlas; no se añaden al PATH de los hijos). */
export function appBundleDirectories(home = homedir()): string[] {
  if (process.platform !== 'darwin') return []
  const apps = ['/Applications', `${home}/Applications`]
  const inside = ['Codex.app/Contents/Resources', 'ChatGPT.app/Contents/Resources/codex-cli/bin']
  return apps.flatMap((dir) => inside.map((sub) => `${dir}/${sub}`)).filter((d) => existsSync(d))
}

// MARK: Entorno de los procesos hijo

/** Variables que describen a una sesión de agente en curso (la que lanzó nuestra app, si la hubo). */
export const STRIPPED_VARIABLES = new Set([
  // Claude Code (sesión padre y anfitrión)
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID',
  'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_TERMINAL_MCP_TOOLS', 'CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID',
  'CLAUDE_CODE_USER_EMAIL', 'CLAUDE_CODE_OAUTH_SCOPES', 'CLAUDE_CODE_REPORT_FINDINGS', 'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES',
  'CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL', 'CLAUDE_CODE_DISABLE_CRON', 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE',
  'CLAUDE_CODE_EAGER_FLUSH', 'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING', 'CLAUDE_CODE_DESKTOP_APP_VERSION',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH', 'CLAUDE_EFFORT', 'CLAUDE_PREVIEW_CLASSIFIER_FLOOR', 'CLAUDE_AGENT_SDK_VERSION',
  // convenciones generales de agentes y trazado distribuido
  'AI_AGENT', 'BAGGAGE', 'TRACEPARENT', 'TRACESTATE',
  // banderas internas de OAuth
  'USE_LOCAL_OAUTH', 'USE_STAGING_OAUTH',
  // Codex
  'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID',
  // OpenCode
  'OPENCODE', 'OPENCODE_PID', 'OPENCODE_RUN_ID', 'OPENCODE_SESSION_ID',
  // directorios del padre
  'OLDPWD',
  // Electron: un hijo que también sea Electron no debe arrancar como Node por herencia
  'ELECTRON_RUN_AS_NODE'
])

export const STRIPPED_PREFIXES = ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_HOST', 'CLAUDE_CODE_MESSAGING', 'CLAUDE_CODE_REMOTE', 'CLAUDE_CODE_IDE', 'CLAUDE_CODE_SDK']

export function isStrippedVariable(name: string): boolean {
  const upper = isWindows ? name.toUpperCase() : name
  return STRIPPED_VARIABLES.has(upper) || STRIPPED_PREFIXES.some((p) => upper.startsWith(p))
}

/** PATH final: shell de login primero, luego el del proceso y las carpetas habituales; las del sistema al final. */
export function mergedPATH(loginPATH: string | null | undefined, currentPATH: string | null | undefined, home: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (list: string[]): void => {
    for (const d of list) if (d && !seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  add(splitPath(loginPATH ?? ''))
  add(splitPath(currentPATH ?? ''))
  add(wellKnownDirectories(home))
  if (!isWindows) add(['/usr/bin', '/bin', '/usr/sbin', '/sbin'])
  return out.join(delimiter)
}

/**
 * Entorno con el que lanzar una CLI o un servidor MCP: PATH completo, sin las variables de la sesión padre (que hacen que
 * una `claude` anidada se comporte como «invitada» y no use la sesión del usuario), sin colores ni terminal, más `extra`.
 * Las credenciales que el usuario puso a propósito (`ANTHROPIC_API_KEY`…) se respetan.
 */
export function childEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return buildChildEnvironment(process.env as Record<string, string>, loginShellPATHCached(), extra)
}

/** Variante testeable (no consulta el shell ni el entorno real). */
export function buildChildEnvironment(base: Record<string, string | undefined>, loginPATH: string | null | undefined, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !isStrippedVariable(k)) env[k] = v
  const home = env.HOME || env.USERPROFILE || homedir()
  if (!isWindows) env.HOME = home
  const key = pathKey(env)
  env[key] = mergedPATH(loginPATH, base[pathKey(base)], home)
  env.NO_COLOR = '1'
  env.TERM = 'dumb'
  for (const [k, v] of Object.entries(extra)) {
    if (k.toUpperCase() === 'PATH') env[key] = v
    else env[k] = v
  }
  return env
}

// MARK: PATH del shell de login

let cache: { value: string | null; at: number } | undefined
let pending: Promise<string | null> | undefined
/** Cuánto vale el PATH del shell de login en caché. */
export const LOGIN_PATH_LIFETIME_MS = 600_000

/** Lo que haya en caché (sin esperar): `null` si aún no se consultó o no se pudo. */
export function loginShellPATHCached(): string | null {
  if (locatorOverrides.loginPATH) return locatorOverrides.loginPATH()
  return cache?.value ?? null
}

/**
 * Consulta (una vez, con caché de 10 min y un límite de 8 s) el PATH de un shell de login interactivo (`$SHELL -lic`) y el
 * prefijo global de npm. Los agentes y el cliente MCP lo esperan antes de buscar ejecutables o construir el entorno.
 */
export async function prepareLocator(): Promise<void> {
  if (locatorOverrides.loginPATH) return
  if (cache && Date.now() - cache.at < LOGIN_PATH_LIFETIME_MS) return
  if (!pending) {
    pending = (async () => {
      const value = isWindows ? null : await queryLoginShellPATH(8000)
      cache = { value, at: Date.now() }
      if (cachedNpmPrefix === undefined) cachedNpmPrefix = await queryNpmPrefix()
      return value
    })().finally(() => {
      pending = undefined
    })
  }
  await pending
}

/** Olvida el PATH en caché (pruebas, o tras cambiar la configuración del shell). */
export function resetLocatorCache(): void {
  cache = undefined
  cachedNpmPrefix = undefined
}

export async function queryLoginShellPATH(timeoutMs: number): Promise<string | null> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !isStrippedVariable(k)) env[k] = v
  let shell = env.SHELL || '/bin/zsh'
  if (!isExecutableFile(shell)) shell = existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'
  if (!isExecutableFile(shell)) return null
  env.HOME = env.HOME || homedir()
  env.TERM = 'dumb'
  const script = "printf '%s%s%s' '__AULA_PATH_BEGIN__' \"$PATH\" '__AULA_PATH_END__'"
  const out = await captureCommand(shell, ['-l', '-i', '-c', script], { env, cwd: homedir(), timeoutMs, maxOutputBytes: 256 * 1024 })
  if (!out) return null
  return parseLoginPATH(out.stdout.toString('utf8'))
}

/** Extrae el PATH entre las marcas (el shell puede imprimir ruido antes y después). */
export function parseLoginPATH(text: string): string | null {
  const begin = text.indexOf('__AULA_PATH_BEGIN__')
  if (begin < 0) return null
  const from = begin + '__AULA_PATH_BEGIN__'.length
  const end = text.indexOf('__AULA_PATH_END__', from)
  if (end < 0) return null
  const value = text.slice(from, end).trim()
  return value.includes('/') || value.includes('\\') ? value : null
}

/** `npm prefix -g` con un plazo corto (si npm está a mano). */
async function queryNpmPrefix(): Promise<string | null> {
  const npm = findExecutable('npm')
  if (!npm) return null
  const out = await captureCommand(npm, ['prefix', '-g'], { env: childEnvironment(), cwd: homedir(), timeoutMs: 5000, maxOutputBytes: 16 * 1024 })
  const value = out?.exit?.code === 0 ? out.stdout.toString('utf8').trim().split(/\r?\n/).pop()?.trim() : undefined
  return value && existsSync(value) ? value : null
}
