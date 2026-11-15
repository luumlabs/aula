// Un único trabajo sin cola; el identificador nunca sustituye al objeto emisor.
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'

export interface FigureRenderOwner {
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}
export interface FigureRenderJob {
  readonly signal: AbortSignal
  remaining(): number
  check(): void
  wait<T>(operation: Promise<T>): Promise<T>
  cleanup(fn: () => void | Promise<void>): void
  abort(error?: Error): void
}
const cancelled = () => new AulaError('cancelled', tr('Cancelado', 'Cancelled'))
const timedOut = () => new AulaError('render_timeout', tr('El dibujo tardó demasiado en prepararse.', 'The drawing took too long to prepare.'))
export function drawingJobId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new AulaError('invalid_args', tr('Identificador de exportación no válido.', 'Invalid export identifier.'))
  }
  return value
}

export class FigureRenderJobs {
  private current?: { owner: FigureRenderOwner; id?: string; abort: (error?: Error) => void }
  constructor(private readonly timeoutMs = 20_000, private readonly now: () => number = () => performance.now(), private readonly cleanupReserveMs = 0) {}

  async run<T>(owner: FigureRenderOwner, identify: () => string, task: (job: FigureRenderJob) => Promise<T>): Promise<T> {
    if (this.current) throw new AulaError('busy', tr('Ya se está preparando una figura.', 'A figure is already being prepared.'))
    const controller = new AbortController(), cleanups: Array<() => void | Promise<void>> = [], cleanupPromises: Promise<void>[] = []
    const finalDeadline = this.now() + this.timeoutMs, deadline = finalDeadline - this.cleanupReserveMs
    let rejectAbort!: (error: Error) => void, failure: Error | undefined, closed = false
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    // Puede cancelarse durante la validación síncrona; no dejamos un rechazo sin observador.
    void aborted.catch(() => undefined)
    const close = (): void => {
      if (closed) return
      closed = true
      for (const fn of cleanups.splice(0).reverse()) {
        try { const result = fn(); if (result) { void result.catch(() => undefined); cleanupPromises.push(result) } } catch (error) { const rejected = Promise.reject(error); void rejected.catch(() => undefined); cleanupPromises.push(rejected) }
      }
    }
    const abort = (error: Error = cancelled()): void => {
      if (failure) return
      failure = error; controller.abort(error); close(); rejectAbort(error)
    }
    const current = { owner, id: undefined as string | undefined, abort }
    this.current = current // Se reserva antes de leer o recorrer el DTO.
    const destroyed = (): void => abort()
    owner.once('destroyed', destroyed)
    const timer = setTimeout(() => abort(timedOut()), this.timeoutMs - this.cleanupReserveMs)
    const check = (): void => {
      if (!failure && this.now() >= deadline) abort(timedOut())
      if (failure) throw failure
    }
    const job: FigureRenderJob = {
      signal: controller.signal, remaining: () => Math.max(0, finalDeadline - this.now()), check, abort,
      wait: async <V>(operation: Promise<V>): Promise<V> => { check(); const result = await Promise.race([operation, aborted]); check(); return result },
      cleanup: fn => { if (closed) { const result = fn(); if (result) { void result.catch(() => undefined); cleanupPromises.push(result) } } else cleanups.push(fn) }
    }
    try {
      if (owner.isDestroyed()) abort()
      check(); current.id = drawingJobId(identify()); check()
      return await job.wait(task(job))
    } finally {
      clearTimeout(timer); owner.removeListener('destroyed', destroyed); close()
      try { await Promise.all(cleanupPromises) } finally { if (this.current === current) this.current = undefined }
    }
  }

  cancel(owner: FigureRenderOwner, value: unknown): void {
    const id = drawingJobId(value)
    if (this.current?.owner === owner && this.current.id === id) this.current.abort()
  }
}
