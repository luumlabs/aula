// Planificador de «mantener la sesión»: despierta cuando toca, comprueba las cuentas debidas (como mucho 2 a la vez) y vuelve a
// dormir. Las decisiones son las de @engine/platforms/keepalive (puras); aquí solo los temporizadores. Sin Electron.
import type { PlatformAccount } from '@shared/settings/platforms'
import { afterResume, applyCheckResult, planKeepAlive, type KeepAliveAccountState, type KeepAliveOptions } from '@engine/platforms'
import { log } from '../log'

export type CheckVerdict = 'signedIn' | 'signedOut' | 'unknown' | 'error'

export interface KeepAliveDeps {
  accounts(): PlatformAccount[]
  /** Hace la comprobación (y sus efectos: estado, eventos, cookies). */
  check(account: PlatformAccount): Promise<CheckVerdict>
  isSigningIn(accountId: string): boolean
  options(): KeepAliveOptions
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  maxConcurrent?: number
}

export class KeepAliveScheduler {
  private states = new Map<string, KeepAliveAccountState>()
  private timer: unknown = null
  private running = false
  private active = 0
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  constructor(private readonly deps: KeepAliveDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return t
    })
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = null
  }

  /** Tras la suspensión o al recuperar la red: lo atrasado se comprueba ya. */
  resume(): void {
    const opts = this.deps.options()
    const next = afterResume([...this.states.values()], this.now(), opts)
    for (const s of next) this.states.set(s.id, s)
    this.tick()
  }

  /** Olvida lo sabido de una cuenta (p. ej. tras iniciar sesión): se comprobará en el siguiente intervalo normal. */
  markChecked(accountId: string, status: KeepAliveAccountState['status']): void {
    const s = this.stateFor(accountId)
    this.states.set(accountId, { ...s, status, lastCheckedAt: this.now(), failures: 0, inFlight: false })
    this.tick()
  }

  /** Estado del planificador (para pruebas y diagnóstico). */
  snapshot(): KeepAliveAccountState[] {
    return [...this.states.values()].map((s) => ({ ...s }))
  }

  tick(): void {
    if (!this.running) return
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = null
    const accounts = this.deps.accounts()
    const ids = new Set(accounts.map((a) => a.id))
    for (const id of [...this.states.keys()]) if (!ids.has(id)) this.states.delete(id)
    const list = accounts.map((a) => ({ ...this.stateFor(a.id, a), signingIn: this.deps.isSigningIn(a.id) }))
    const opts = this.deps.options()
    const plan = planKeepAlive(list, this.now(), opts)
    const max = this.deps.maxConcurrent ?? 2
    for (const id of plan.due) {
      if (this.active >= max) break
      const account = accounts.find((a) => a.id === id)
      if (account) void this.run(account)
    }
    // si quedaron debidas por el tope, se vuelve a mirar pronto
    const wake = plan.due.length > 0 && this.active >= max ? this.now() + 5_000 : plan.nextWakeAt
    if (wake != null) {
      const ms = Math.max(1_000, Math.min(wake - this.now(), 2 ** 31 - 1))
      this.timer = this.setTimer(() => this.tick(), ms)
    }
  }

  private stateFor(id: string, account?: PlatformAccount): KeepAliveAccountState {
    const s = this.states.get(id)
    if (s) return s
    // al arrancar se comprueba todo una vez (también lo que se cerró: las cookies repuestas podrían bastar)
    const fresh: KeepAliveAccountState = {
      id,
      status: account?.lastState === 'signedIn' ? 'signedIn' : 'unknown',
      lastCheckedAt: null,
      failures: 0,
      inFlight: false
    }
    this.states.set(id, fresh)
    return fresh
  }

  private async run(account: PlatformAccount): Promise<void> {
    const s = this.stateFor(account.id, account)
    this.states.set(account.id, { ...s, inFlight: true })
    this.active++
    let verdict: CheckVerdict = 'error'
    try {
      verdict = await this.deps.check(account)
    } catch (err) {
      log.warn(`[platforms] comprobación fallida (${account.id}):`, err instanceof Error ? err.message : String(err))
    } finally {
      this.active--
      const cur = this.states.get(account.id)
      if (cur) this.states.set(account.id, applyCheckResult(cur, verdict, this.now()))
      this.tick()
    }
  }
}
