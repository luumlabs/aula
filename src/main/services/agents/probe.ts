// ¿Está instalada cada CLI y tiene sesión? De la forma menos intrusiva posible (nunca se leen archivos de credenciales)
// (port de `AgentKit/CLI/CLIProbe.swift`):
//  - Claude Code: `claude auth status` (JSON con `loggedIn`);
//  - Codex: `codex login status` (código 0 si hay credenciales);
//  - OpenCode: `opencode auth list` (credenciales guardadas y claves en variables de entorno).
import { homedir } from 'node:os'
import type { CLIAgentKind, CLIStatus } from '@shared/agents'
import { tr } from '@shared/ai/i18n'
import { captureCommand, describeExit, exitSucceeded, type CaptureOutput } from './child-process'
import { CLIErrorClassifier } from './errors'
import { bool, isObject, str, tryParse } from './json'
import { childEnvironment, findExecutable, prepareLocator } from './locator'

export interface CLISpec {
  name: string
  executable: string
  classifier: CLIErrorClassifier
}

export function cliSpec(kind: CLIAgentKind): CLISpec {
  switch (kind) {
    case 'claude':
      return { name: 'Claude Code', executable: 'claude', classifier: CLIErrorClassifier.claude }
    case 'codex':
      return { name: 'Codex', executable: 'codex', classifier: CLIErrorClassifier.codex }
    case 'opencode':
      return { name: 'OpenCode', executable: 'opencode', classifier: CLIErrorClassifier.openCode }
  }
}

/** Tiempo máximo de cada consulta a la CLI (ms). Configurable para pruebas. */
export const probeSettings = { commandTimeoutMs: 10_000 }

export interface ProbeOptions {
  explicitPath?: string
  /** Variables extra (p. ej. el `CODEX_HOME` de Aula). */
  extraEnvironment?: Record<string, string>
  /** Argumentos que van delante de la consulta de sesión (p. ej. `-c cli_auth_credentials_store="file"`). */
  sessionArguments?: string[]
}

type SessionNote = { kind: 'plain' } | { kind: 'method'; method: string } | { kind: 'counts'; credentials: number; environmentKeys: number }

/** Estado de la CLI. Nunca lanza: los problemas se describen en `detail`. */
export async function probeCLI(kind: CLIAgentKind, options: ProbeOptions = {}): Promise<CLIStatus> {
  await prepareLocator()
  const spec = cliSpec(kind)
  const path = findExecutable(spec.executable, options.explicitPath)
  if (!path) return { kind, installed: false, loggedIn: null, detail: tr(`${spec.name} no está instalado. ${spec.classifier.installInstruction}`, `${spec.name} isn’t installed. ${spec.classifier.installInstruction}`) }
  const env = childEnvironment(options.extraEnvironment ?? {})
  const run = (args: string[]): Promise<CaptureOutput | null> =>
    captureCommand(path, args, { env, cwd: homedir(), timeoutMs: probeSettings.commandTimeoutMs })

  // versión
  let version: string | undefined
  const versionOut = await run(['--version'])
  if (!versionOut) {
    return { kind, installed: true, path, loggedIn: null, detail: tr(`${spec.name} está instalado en ${path} pero no se puede ejecutar. Revisa sus permisos.`, `${spec.name} is installed at ${path} but can’t be run. Check its permissions.`) }
  }
  version = parseVersion(versionOut.stdout.toString('utf8') + '\n' + versionOut.stderr.toString('utf8'))
  if (versionOut.timedOut) {
    return { kind, installed: true, path, loggedIn: null, detail: tr(`${spec.name} no respondió a tiempo. Reinícialo o reinstálalo.`, `${spec.name} didn’t respond in time. Restart or reinstall it.`) }
  }
  if (versionOut.exit && !exitSucceeded(versionOut.exit) && !version) {
    return { kind, installed: true, path, loggedIn: null, detail: tr(`${spec.name} está instalado pero no se pudo ejecutar (${describeExit(versionOut.exit)}).`, `${spec.name} is installed but couldn’t be run (${describeExit(versionOut.exit)}).`) }
  }
  const label = version ? `${spec.name} ${version}` : spec.name

  // sesión
  let loggedIn: boolean | null = null
  let note: SessionNote = { kind: 'plain' }
  if (kind === 'claude') {
    const out = await run(['auth', 'status'])
    const json = out ? tryParse(out.stdout.toString('utf8').trim()) : undefined
    if (isObject(json)) {
      loggedIn = bool(json.loggedIn) ?? null
      const method = str(json.authMethod)
      if (loggedIn === true && method && method !== 'none') note = { kind: 'method', method }
    }
  } else if (kind === 'codex') {
    const out = await run([...(options.sessionArguments ?? []), 'login', 'status'])
    if (out?.exit && !out.timedOut) {
      const text = (out.stdout.toString('utf8') + out.stderr.toString('utf8')).toLowerCase()
      if (exitSucceeded(out.exit)) loggedIn = true
      else if (text.includes('not logged in') || text.includes('no credentials') || text.includes('not authenticated')) loggedIn = false
    }
  } else {
    const out = await run(['auth', 'list'])
    if (out?.exit && exitSucceeded(out.exit)) {
      const counts = openCodeCredentialCounts(stripANSI(out.stdout.toString('utf8') + '\n' + out.stderr.toString('utf8')))
      // sin credenciales no es «sin sesión»: los modelos gratuitos de OpenCode Zen funcionan sin cuenta
      if (counts.credentials + counts.environmentKeys > 0) {
        loggedIn = true
        note = { kind: 'counts', ...counts }
      }
    }
  }

  let detail: string
  if (loggedIn === true) {
    const signedIn = tr('sesión iniciada', 'signed in')
    if (note.kind === 'method') detail = `${label} · ${signedIn} (${note.method})`
    else if (note.kind === 'counts') {
      const c = note.credentials
      const k = note.environmentKeys
      detail = tr(
        `${label} · ${signedIn} (${c} credencial(es), ${k} clave(s) en el entorno)`,
        `${label} · ${signedIn} (${c} ${c === 1 ? 'credential' : 'credentials'}, ${k} ${k === 1 ? 'key' : 'keys'} in the environment)`
      )
    } else detail = `${label} · ${signedIn}`
  } else if (loggedIn === false) {
    detail = tr(`${label} · sin sesión. ${spec.classifier.loginInstruction}`, `${label} · not signed in. ${spec.classifier.loginInstruction}`)
  } else {
    detail = kind === 'opencode'
      ? tr(
          `${label} · sin credenciales guardadas (los modelos gratuitos de OpenCode Zen funcionan sin cuenta). ${spec.classifier.loginInstruction}`,
          `${label} · no saved credentials (the free OpenCode Zen models work without an account). ${spec.classifier.loginInstruction}`
        )
      : tr(`${label} · no se pudo comprobar la sesión.`, `${label} · couldn’t check the sign-in.`)
  }
  return { kind, installed: true, path, version, loggedIn, detail }
}

/**
 * Credenciales guardadas y claves en el entorno según `opencode auth list`, en sus dos formatos:
 *  - v1 (≤ 1.19): termina con «N credentials» y «N environment variable(s)»;
 *  - v2 (2.0.x): una tabla «<integración> <origen> stored|environment» o «No authenticated integrations».
 */
export function openCodeCredentialCounts(text: string): { credentials: number; environmentKeys: number } {
  const credentials = /(\d+)\s+credentials?\b/i.exec(text)
  const environment = /(\d+)\s+environment variables?\b/i.exec(text)
  if (credentials || environment) return { credentials: credentials ? Number(credentials[1]) : 0, environmentKeys: environment ? Number(environment[1]) : 0 }
  if (text.toLowerCase().includes('no authenticated integrations')) return { credentials: 0, environmentKeys: 0 }
  let stored = 0
  let env = 0
  for (const line of text.split(/\r?\n/)) {
    const words = line.split(/[ \t│|]+/).filter(Boolean).map((w) => w.toLowerCase())
    if (words.length < 2) continue
    const last = words[words.length - 1]
    if (last === 'stored') stored += 1
    else if (last === 'environment') env += 1
  }
  return { credentials: stored, environmentKeys: env }
}

/** Primer número de versión («2.1.288», «0.46.0», «1.14.2-beta.3»). */
export function parseVersion(text: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)/.exec(text)?.[1]
}

export function stripANSI(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
}
