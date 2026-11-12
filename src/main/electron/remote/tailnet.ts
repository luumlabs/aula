// La red privada de Tailscale, dentro de Aula: un proceso auxiliar (`aula-tsnet`, native/tsnet) que se une a la red del
// estudiante como un equipo más («aula-mac») y reenvía hasta el servidor remoto las conexiones de sus dispositivos (solo
// las de su misma cuenta de Tailscale). No hace falta instalar Tailscale en el Mac. Aquí se arranca, se le pasa la clave
// por su entrada (nunca por argumentos) y se sigue su estado, que cuenta en una línea JSON por cambio.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { RemoteStatus } from '@shared/ipc/remote'
import { log } from '@main/services/log'

export type TailnetView = RemoteStatus['tailnet'] & { dnsName?: string; ips?: string[] }

export const TAILNET_HOSTNAME = 'aula-mac'

interface SidecarEvent { type?: string; authURL?: string; hostname?: string; dnsName?: string; ips?: string[]; user?: string; message?: string }

export class Tailnet {
  private child: ChildProcess | null = null
  private view: TailnetView
  private wanted = false
  private restarts = 0
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly o: { binary: string; stateDir: string; proxyKey: string; onChange: () => void; /** «aula-mac» o, como servidor, «aula-server». */ hostname?: string }) {
    this.view = { state: existsSync(o.binary) ? 'off' : 'unavailable' }
  }

  get status(): TailnetView { return this.view }
  get hostname(): string { return this.o.hostname ?? TAILNET_HOSTNAME }
  get available(): boolean { return existsSync(this.o.binary) }

  /** Arranca la red privada apuntando al servidor remoto de este Mac. */
  start(targetPort: number): void {
    this.wanted = true
    if (this.child || !this.available) { if (!this.available) this.set({ state: 'unavailable' }); return }
    mkdirSync(this.o.stateDir, { recursive: true })
    this.set({ state: 'starting' })
    const child = spawn(this.o.binary, ['--state-dir', this.o.stateDir, '--hostname', this.hostname, '--target', `127.0.0.1:${targetPort}`, '--listen-port', '80'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
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
      this.set({ state: 'error', message: `El componente de Tailscale se cerró (código ${code ?? '?'}); se reintenta.` })
      this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.start(targetPort) }, wait)
    })
  }

  stop(): void {
    this.wanted = false
    if (this.retry) { clearTimeout(this.retry); this.retry = null }
    const child = this.child
    this.child = null
    if (child) {
      // al cerrarle la entrada termina limpio; si no, se le pide
      try { child.stdin?.end() } catch { /* ya cerrada */ }
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM') }, 1500)
    }
    this.set({ state: this.available ? 'off' : 'unavailable' })
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
