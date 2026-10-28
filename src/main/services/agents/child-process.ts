// Procesos hijo con grupo propio, plazos, cancelación y muerte del árbol entero
// (port de `AgentKit/CLI/{ChildProcess,PosixSpawn,SyncCapture}.swift` sobre node:child_process).
//
// Garantías:
//  - en macOS/Linux el hijo es líder de su propia sesión y grupo (`detached`): `terminate()` envía SIGTERM al GRUPO entero y,
//    pasado un margen, SIGKILL; en Windows se usa `taskkill /T` (árbol de procesos);
//  - cuando el proceso principal del hijo termina, se mata a los descendientes que haya dejado (así las tuberías llegan a EOF);
//  - al salir la app se matan todos los hijos vivos (nada de agentes huérfanos gastando suscripción);
//  - nunca se usa un shell: los argumentos llegan tal cual (en Windows, los `.cmd` de npm se resuelven a `node script.js`).
import { spawn, execFileSync, type ChildProcess as NodeChildProcess } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs'
import { constants as osConstants } from 'node:os'
import { dirname, join, extname, delimiter } from 'node:path'
import type { Readable } from 'node:stream'
import { tr } from '@shared/ai/i18n'
import { settingsPath } from '@shared/settings/sections'

const isWindows = process.platform === 'win32'

/** Cómo terminó un proceso hijo. */
export interface ChildExit {
  /** Código de salida (0 = éxito); -1 si murió por una señal. */
  code: number
  /** Número de señal (9 = SIGKILL), si murió por una. */
  signal?: number
  signalName?: string
}

export function exitSucceeded(exit: ChildExit): boolean {
  return exit.code === 0 && exit.signal === undefined
}

/** «código 1» / «señal 9». */
export function describeExit(exit: ChildExit): string {
  return exit.signal !== undefined ? tr(`señal ${exit.signal}`, `signal ${exit.signal}`) : tr(`código ${exit.code}`, `code ${exit.code}`)
}

export class SpawnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpawnError'
  }
}

export interface SpawnOptions {
  env: Record<string, string>
  cwd?: string
}

// MARK: Registro de procesos vivos

const live = new Set<ChildProcessHandle>()
let exitHookInstalled = false

function installExitHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => killAllLive())
}

/** Mata (SIGKILL) a todos los grupos de procesos hijo vivos. Se llama al salir de la app. */
export function killAllLive(): void {
  for (const p of Array.from(live)) p.kill()
}

export function liveCount(): number {
  return live.size
}

// MARK: Ejecutables

/** ¿Es un archivo que se puede ejecutar? (en Windows basta con que exista y tenga una extensión ejecutable). */
export function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (isWindows) return windowsExecutableExtensions().includes(extname(path).toLowerCase())
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export function windowsExecutableExtensions(): string[] {
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD'
  const list = raw.split(';').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.filter((e) => ['.exe', '.cmd', '.bat', '.com'].includes(e))
}

/**
 * Qué lanzar de verdad. En Windows, Node no ejecuta `.cmd`/`.bat` sin shell (y con shell los argumentos no serían seguros):
 * los envoltorios de npm (`claude.cmd`, `codex.cmd`, `opencode.cmd`) se resuelven al script que lanzan, con su `node`.
 */
export function resolveLaunch(executable: string, args: string[], env: Record<string, string>): { file: string; args: string[] } {
  if (!isWindows) return { file: executable, args }
  const ext = extname(executable).toLowerCase()
  if (ext !== '.cmd' && ext !== '.bat') return { file: executable, args }
  const shim = parseCmdShim(readFileSync(executable, 'utf8'), dirname(executable))
  if (!shim) {
    throw new SpawnError(
      tr(
        `No sé lanzar «${executable}» sin un intérprete de órdenes. Indica la ruta del ejecutable (.exe) o del script en ${settingsPath('ai', 'es')}.`,
        `I don’t know how to launch “${executable}” without a command shell. Enter the path of the executable (.exe) or the script in ${settingsPath('ai', 'en')}.`
      )
    )
  }
  if (/\.(c|m)?js$/i.test(shim)) {
    const localNode = join(dirname(executable), 'node.exe')
    const node = existsSync(localNode) ? localNode : findOnPath('node.exe', env)
    if (!node) throw new SpawnError(tr(`«${executable}» necesita Node.js y no lo encuentro en el PATH.`, `“${executable}” needs Node.js and I can’t find it on the PATH.`))
    return { file: node, args: [shim, ...args] }
  }
  return { file: shim, args }
}

/** El destino de un envoltorio `.cmd` de npm (`"%dp0%\node_modules\…\cli.js" %*`), o `undefined`. */
export function parseCmdShim(text: string, folder: string): string | undefined {
  const m = /"%(?:~?dp0)%\\?([^"]+?)"\s+%\*/i.exec(text) ?? /"%~dp0\\?([^"]+?)"\s+%\*/i.exec(text)
  if (!m) return undefined
  const target = join(folder, m[1].replace(/\\/g, '/'))
  return existsSync(target) ? target : undefined
}

function findOnPath(name: string, env: Record<string, string>): string | undefined {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH')
  for (const dir of (pathKey ? env[pathKey] : '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function signalNumber(name: NodeJS.Signals | null): number | undefined {
  if (!name) return undefined
  const value = (osConstants.signals as Record<string, number>)[name]
  return typeof value === 'number' ? value : undefined
}

function taskkill(pid: number, force: boolean): void {
  const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
  try {
    execFileSync(exe, ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore', windowsHide: true, timeout: 5000 })
  } catch {
    /* ya terminó */
  }
}

// MARK: Proceso hijo

/** Proceso hijo en ejecución, con tuberías, grupo de procesos propio y espera de salida. */
export class ChildProcessHandle {
  static defaultKillGraceMs = 2000
  /** Tras la salida del proceso, cuánto se espera a que sus tuberías lleguen a EOF antes de cortarlas. */
  static pipeDrainGraceMs = 2000

  readonly pid: number
  readonly stdout: Readable
  readonly stderr: Readable
  private exitInfo?: ChildExit
  private readonly exitPromise: Promise<ChildExit>
  private stdinClosed = false
  private readonly observers: ((exit: ChildExit) => void)[] = []

  private constructor(private readonly child: NodeChildProcess) {
    this.pid = child.pid!
    this.stdout = child.stdout!
    this.stderr = child.stderr!
    child.stdin?.on('error', () => {
      /* EPIPE: el hijo cerró su entrada */
    })
    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        const info: ChildExit = signal ? { code: -1, signal: signalNumber(signal), signalName: signal } : { code: code ?? -1 }
        this.exitInfo = info
        live.delete(this)
        // el grupo sigue reservado mientras tenga miembros: limpiar a los descendientes que dejó
        this.signalGroup('SIGKILL')
        resolve(info)
        for (const fn of this.observers.splice(0)) fn(info)
        // si algún rezagado que escapó del grupo mantiene las tuberías abiertas, cortarlas pasado un margen
        const timer = setTimeout(() => {
          this.stdout.destroy()
          this.stderr.destroy()
        }, ChildProcessHandle.pipeDrainGraceMs)
        timer.unref?.()
      })
    })
  }

  /** Lanza `executable` (sin shell). Lanza `SpawnError` con un motivo en español si no se puede. */
  static async spawn(executable: string, args: string[], options: SpawnOptions): Promise<ChildProcessHandle> {
    if (!isExecutableFile(executable)) {
      throw new SpawnError(tr(`No se puede ejecutar «${executable}» (no existe o no tiene permiso de ejecución).`, `“${executable}” can’t be run (it doesn’t exist or isn’t executable).`))
    }
    const launch = resolveLaunch(executable, args, options.env)
    const child = spawn(launch.file, launch.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true,
      shell: false
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        child.removeListener('spawn', onSpawn)
        reject(new SpawnError(tr(`No se pudo iniciar «${executable}»: ${err.message}.`, `Couldn’t start “${executable}”: ${err.message}.`)))
      }
      const onSpawn = (): void => {
        child.removeListener('error', onError)
        resolve()
      }
      child.once('error', onError)
      child.once('spawn', onSpawn)
    })
    child.on('error', () => {
      /* errores tardíos (p. ej. al matar): no deben tumbar la app */
    })
    const handle = new ChildProcessHandle(child)
    live.add(handle)
    installExitHook()
    return handle
  }

  get isRunning(): boolean {
    return this.exitInfo === undefined
  }

  get exit(): ChildExit | undefined {
    return this.exitInfo
  }

  /** Escribe en el stdin del hijo (en orden). Si `thenClose`, cierra la entrada después. */
  writeStdin(data: string | Uint8Array, thenClose = false): void {
    const stdin = this.child.stdin
    if (!stdin || this.stdinClosed) return
    if (data.length > 0) stdin.write(data)
    if (thenClose) this.closeStdin()
  }

  /** Cierra el stdin (EOF) cuando se hayan escrito los datos pendientes. */
  closeStdin(): void {
    if (this.stdinClosed) return
    this.stdinClosed = true
    this.child.stdin?.end()
  }

  waitForExit(): Promise<ChildExit> {
    return this.exitPromise
  }

  /** Llama a `fn` (una vez) cuando el proceso termina; si ya terminó, de inmediato. */
  onExit(fn: (exit: ChildExit) => void): void {
    if (this.exitInfo) fn(this.exitInfo)
    else this.observers.push(fn)
  }

  /** Pide al grupo que termine (SIGTERM) y, si sigue vivo pasado `graceMs`, lo mata (SIGKILL). */
  terminate(graceMs = ChildProcessHandle.defaultKillGraceMs): void {
    if (!this.isRunning) return
    if (isWindows) taskkill(this.pid, false)
    else this.signalGroup('SIGTERM')
    const timer = setTimeout(() => this.kill(), graceMs)
    timer.unref?.()
  }

  /** Mata de inmediato al grupo (o al árbol, en Windows). */
  kill(): void {
    if (!this.isRunning) return
    if (isWindows) taskkill(this.pid, true)
    else this.signalGroup('SIGKILL')
  }

  private signalGroup(signal: NodeJS.Signals): void {
    if (isWindows) return
    try {
      process.kill(-this.pid, signal)
    } catch {
      /* el grupo ya no existe */
    }
  }
}

// MARK: Ejecución corta con captura (SyncCapture)

export interface CaptureOutput {
  exit?: ChildExit
  stdout: Buffer
  stderr: Buffer
  timedOut: boolean
}

export function captureText(out: CaptureOutput, which: 'stdout' | 'stderr'): string {
  return out[which].toString('utf8')
}

/**
 * Ejecuta un comando corto, espera a que termine (con plazo) y devuelve su salida. `null` si no se pudo lanzar.
 * Si se agota el tiempo, mata el grupo de procesos entero.
 */
export async function captureCommand(
  executable: string,
  args: string[],
  options: SpawnOptions & { stdin?: string; timeoutMs: number; maxOutputBytes?: number }
): Promise<CaptureOutput | null> {
  let proc: ChildProcessHandle
  try {
    proc = await ChildProcessHandle.spawn(executable, args, options)
  } catch {
    return null
  }
  const max = options.maxOutputBytes ?? 1_000_000
  const out: Buffer[] = []
  const err: Buffer[] = []
  let outSize = 0
  let errSize = 0
  proc.stdout.on('data', (b: Buffer) => {
    if (outSize < max) {
      out.push(b)
      outSize += b.length
    }
  })
  proc.stderr.on('data', (b: Buffer) => {
    if (errSize < max) {
      err.push(b)
      errSize += b.length
    }
  })
  const closed = (s: Readable): Promise<void> => new Promise((r) => (s.readableEnded || s.destroyed ? r() : s.once('close', () => r())))
  if (options.stdin) proc.writeStdin(options.stdin, true)
  else proc.closeStdin()
  let timedOut = false
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), Math.max(1, options.timeoutMs))
  })
  const finished = Promise.all([proc.waitForExit(), closed(proc.stdout), closed(proc.stderr)]).then(() => 'done' as const)
  const outcome = await Promise.race([finished, deadline])
  clearTimeout(timer)
  if (outcome === 'timeout') {
    timedOut = true
    proc.kill()
    await Promise.race([proc.waitForExit(), new Promise((r) => setTimeout(r, 2000))])
    proc.stdout.destroy()
    proc.stderr.destroy()
  }
  return { exit: proc.exit, stdout: Buffer.concat(out).subarray(0, max), stderr: Buffer.concat(err).subarray(0, max), timedOut }
}
