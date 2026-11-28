// La red privada de Tailscale, dentro de Aula: un proceso auxiliar (`aula-tsnet`, native/tsnet) que se une a la red del
// estudiante como un equipo más («aula-mac» en macOS, «aula-windows» en Windows) y reenvía hasta el servidor remoto las
// conexiones de sus dispositivos (solo las de su misma cuenta de Tailscale). No hace falta instalar Tailscale aparte. Aquí
// se arranca, se le pasa la clave por su entrada (nunca por argumentos) y se sigue su estado, que cuenta en una línea JSON
// por cambio.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { RemoteStatus } from '@shared/ipc/remote'
import { log } from '@main/services/log'
import { tr } from '@shared/ai/i18n'

export type TailnetView = RemoteStatus['tailnet'] & { dnsName?: string; ips?: string[] }

export const TAILNET_HOSTNAME = 'aula-mac'
export const WINDOWS_TAILNET_HOSTNAME = 'aula-windows'

/** Nombre por defecto en la red privada para la app de escritorio (en modo servidor manda `serverHostname()`). */
export function defaultTailnetHostname(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? WINDOWS_TAILNET_HOSTNAME : TAILNET_HOSTNAME
}

/** Nombre del ejecutable del componente de Tailscale en cada sistema. */
export function tailnetBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'aula-tsnet.exe' : 'aula-tsnet'
}

/** Ruta al componente de Tailscale: dentro de la app empaquetada o, en desarrollo, donde lo deja `native/tsnet/build.sh`. */
export function resolveTailnetBinary(opts: {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  platform?: NodeJS.Platform
  arch?: string
  exists?: (path: string) => boolean
}): string {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const exists = opts.exists ?? existsSync
  const name = tailnetBinaryName(platform)
  const packaged = join(opts.resourcesPath, 'bin', name)
  if (opts.isPackaged) return packaged
  const binDir = join(opts.appPath, 'native', 'tsnet', 'bin')
  const candidates = platform === 'win32'
    ? [join(binDir, `win-${arch}`, name), join(binDir, name)]
    : platform === 'linux'
      ? [join(binDir, `linux-${arch}`, name), join(binDir, name)]
      : [join(binDir, name)]
  return candidates.find((p) => exists(p)) ?? packaged
}

/** Opciones de arranque del proceso auxiliar (en Windows oculta la ventana de consola). */
export function tailnetSpawnOptions(): SpawnOptions {
  return { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
}

interface SidecarEvent { type?: string; authURL?: string; hostname?: string; dnsName?: string; ips?: string[]; user?: string; message?: string }

export class Tailnet {
  private child: ChildProcess | null = null
  /** Procesos en cierre tras `stop()`: si la app sale antes de que acaben (Windows NSIS), `terminateNow` los cierra. */
  private readonly exiting = new Set<ChildProcess>()
  private view: TailnetView
  private wanted = false
  private restarts = 0
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: { binary: string; stateDir: string; proxyKey: string; onChange: () => void; /** «aula-mac», «aula-windows» o, como servidor, «aula-server». */ hostname?: string; spawn?: typeof spawn }) {
    this.view = { state: existsSync(o.binary) ? 'off' : 'unavailable' }
  }

  get status(): TailnetView { return this.view }
  get hostname(): string { return this.o.hostname ?? defaultTailnetHostname() }
  get available(): boolean { return existsSync(this.o.binary) }

  /** Arranca la red privada apuntando al servidor remoto de este equipo. */
  start(targetPort: number): void {
    this.wanted = true
    if (this.child || !this.available) { if (!this.available) this.set({ state: 'unavailable' }); return }
    mkdirSync(this.o.stateDir, { recursive: true })
    this.set({ state: 'starting' })
    const run = this.o.spawn ?? spawn
    const child = run(this.o.binary, ['--state-dir', this.o.stateDir, '--hostname', this.hostname, '--target', `127.0.0.1:${targetPort}`, '--listen-port', '80'], tailnetSpawnOptions())
    this.child = child
    // si el proceso muere enseguida, escribir en su entrada falla después (EPIPE): sin quien lo escuche, ese error tumbaría
    // Aula entera; su salida ya dice qué pasó
    child.stdin?.on('error', (err) => log.warn('[tailnet] entrada', err.message))
    child.stdin?.write(JSON.stringify({ proxyKey: this.o.proxyKey }) + '\n')
    createInterface({ input: child.stdout! }).on('line', (line) => this.onLine(line))
    createInterface({ input: child.stderr! }).on('line', (line) => log.info('[tailnet]', line.slice(0, 400)))
    child.on('error', (err) => { log.warn('[tailnet] no arrancó', err); this.set({ state: 'error', message: err.message }) })
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      if (!this.wanted) { this.set({ state: 'off' }); return }
      // se cayó sin que nadie lo parase: se vuelve a intentar, cada vez con más espera
      this.restarts++
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(this.restarts, 5))
      this.set({ state: 'error', message: tr(`El componente de Tailscale se cerró (código ${code ?? '?'}); se reintenta.`, `The Tailscale component closed (code ${code ?? '?'}); retrying.`) })
      this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.start(targetPort) }, wait)
    })
  }

  stop(): void {
    this.wanted = false
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const child = this.child
    this.child = null
    if (child) {
      this.exiting.add(child)
      // al cerrarle la entrada termina limpio; si no, se le pide
      try { child.stdin?.end() } catch { /* ya cerrada */ }
      const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM') }, 1500)
      killTimer.unref?.()
      child.once('exit', () => { clearTimeout(killTimer); this.exiting.delete(child) })
    }
    this.set({ state: this.available ? 'off' : 'unavailable' })
  }

  /** Cierre inmediato al salir del proceso (evita que aula-tsnet.exe quede bloqueando una actualización NSIS en Windows). */
  terminateNow(): void {
    this.wanted = false
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const procs = [...this.exiting, ...(this.child ? [this.child] : [])]
    this.child = null
    for (const p of procs) {
      this.exiting.delete(p)
      try { p.stdin?.end() } catch { /* ya cerrada */ }
      if (p.exitCode === null) {
        try { p.kill('SIGTERM') } catch { /* ya cerrado */ }
      }
    }
  }

  /** Cierra la sesión de Tailscale de este Mac (volverá a pedir que se inicie). */
  logout(): void {
    try { this.child?.stdin?.write(JSON.stringify({ cmd: 'logout' }) + '\n') } catch { /* sin proceso */ }
  }

  private onLine(line: string): void {
    let e: SidecarEvent
    try { e = JSON.parse(line) as SidecarEvent } catch { return }
    switch (e.type) {
      case 'starting': return this.set({ state: 'starting' })
      case 'needs_login': return this.set({ state: 'needsLogin', ...(typeof e.authURL === 'string' && /^https:\/\//.test(e.authURL) ? { authURL: e.authURL } : {}) })
      case 'needs_machine_auth': return this.set({ state: 'needsApproval', message: e.message })
      case 'running':
        this.restarts = 0
        return this.set({ state: 'running', name: e.hostname ?? this.hostname, dnsName: e.dnsName, ips: Array.isArray(e.ips) ? e.ips.filter((x): x is string => typeof x === 'string') : [], user: e.user })
      case 'logged_out': return this.set({ state: 'needsLogin' })
      case 'peer_refused': log.info('[tailnet] se rechazó a otro usuario de la red', e.user ?? '', e.message ?? ''); return
      case 'error': return this.set({ ...this.view, state: 'error', message: e.message })
      default: return
    }
  }

  private set(next: TailnetView): void {
    this.view = next
    this.o.onChange()
  }
}
