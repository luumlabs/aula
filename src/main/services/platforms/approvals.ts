// Permisos del estudiante para lo que no es de solo lectura (pulsar «Enviar», abrir un examen, descargar de otro sitio…).
// La interfaz recibe la petición por evento y contesta con `platforms.approve`. Sin respuesta a tiempo = DENEGADO.
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import type { ApprovalAction, PlatformApprovalRequest, PlatformApprovalResolution } from '@shared/platforms/types'

export interface ApprovalAsk {
  accountId: string | null
  action: ApprovalAction
  label: string
  url?: string
  pageURL?: string
  category: string
  reason: string
}

interface Pending {
  request: PlatformApprovalRequest
  resolve: (allowed: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

export interface ApprovalBrokerOptions {
  /** Tiempo de espera por defecto (ms). */
  timeoutMs?: number
  now?: () => number
  /** Máximo de peticiones pendientes (las demás se deniegan al momento). */
  maxPending?: number
}

export class ApprovalBroker {
  private pending = new Map<string, Pending>()
  private readonly events = new EventEmitter()
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly maxPending: number

  constructor(opts: ApprovalBrokerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.now = opts.now ?? Date.now
    this.maxPending = opts.maxPending ?? 8
  }

  /** Pide permiso; se resuelve con true (permitido) o false (denegado, caducado o cancelado). */
  request(ask: ApprovalAsk, timeoutMs = this.timeoutMs, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false)
    if (this.pending.size >= this.maxPending) return Promise.resolve(false)
    const id = randomBytes(8).toString('hex')
    const created = this.now()
    const request: PlatformApprovalRequest = {
      id,
      accountId: ask.accountId,
      action: ask.action,
      label: ask.label.slice(0, 300),
      ...(ask.url ? { url: ask.url.slice(0, 2048) } : {}),
      ...(ask.pageURL ? { pageURL: ask.pageURL.slice(0, 2048) } : {}),
      category: ask.category,
      reason: ask.reason,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + timeoutMs).toISOString()
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.finish(id, false, 'timeout'), timeoutMs)
      this.pending.set(id, { request, resolve, timer })
      signal?.addEventListener('abort', () => this.finish(id, false, 'cancelled'), { once: true })
      this.events.emit('request', request)
    })
  }

  /** Respuesta del estudiante. Devuelve false si ya no estaba pendiente. */
  respond(id: string, allow: boolean): boolean {
    return this.finish(id, allow === true, 'user')
  }

  list(): PlatformApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request)
  }

  /** Deniega todo lo pendiente (al salir o al cerrar sesión). */
  cancelAll(accountId?: string): void {
    for (const [id, p] of [...this.pending]) if (!accountId || p.request.accountId === accountId) this.finish(id, false, 'cancelled')
  }

  onRequest(fn: (r: PlatformApprovalRequest) => void): () => void {
    this.events.on('request', fn)
    return () => this.events.off('request', fn)
  }

  onResolved(fn: (r: PlatformApprovalResolution) => void): () => void {
    this.events.on('resolved', fn)
    return () => this.events.off('resolved', fn)
  }

  private finish(id: string, allowed: boolean, by: PlatformApprovalResolution['by']): boolean {
    const p = this.pending.get(id)
    if (!p) return false
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(allowed)
    this.events.emit('resolved', { id, allowed, by } satisfies PlatformApprovalResolution)
    return true
  }
}
