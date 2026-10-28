// Progreso monótono y limitado en frecuencia, avisos sin repetir y el contexto de una lectura.
import { checkCancelled } from '../errors'
import type { IngestOptions } from '../options'

export type ProgressCallback = (fraction: number, message: string) => void

/** Emite el progreso: monótono (nunca retrocede), acotado a 0…1 y como mucho cada `minIntervalMs`. */
export class ProgressReporter {
  private last = -1
  private lastTime = 0

  constructor(private readonly callback?: ProgressCallback, private readonly minIntervalMs = 50) {}

  /** `force` ignora el límite de frecuencia (primer y último aviso). */
  report(fraction: number, message: string, force = false): void {
    if (!this.callback) return
    const clamped = Number.isNaN(fraction) ? 0 : Math.min(Math.max(fraction, 0), 1)
    const value = Math.max(clamped, this.last)
    const now = performance.now()
    const due = force || this.last < 0 || value >= 1 || now - this.lastTime >= this.minIntervalMs
    if (!due) return
    this.last = value
    this.lastTime = now
    this.callback(value, message)
  }

  /** Un sub-rango [from, to] del progreso total. */
  scoped(from: number, to: number): ScopedProgress {
    return new ScopedProgress(this, from, to)
  }
}

export class ScopedProgress {
  constructor(readonly parent: ProgressReporter, readonly from: number, readonly to: number) {}

  report(fraction: number, message: string, force = false): void {
    const f = Number.isNaN(fraction) ? 0 : Math.min(Math.max(fraction, 0), 1)
    this.parent.report(this.from + (this.to - this.from) * f, message, force)
  }
}

/** Advertencias de una lectura, sin repetir. */
export class WarningCollector {
  private readonly items: string[] = []
  private readonly seen = new Set<string>()

  add(message: string): void {
    if (this.seen.has(message)) return
    this.seen.add(message)
    this.items.push(message)
  }

  get all(): string[] {
    return [...this.items]
  }
}

/** Todo lo que un extractor necesita saber de la operación en curso. */
export interface IngestContext {
  options: IngestOptions
  progress: ProgressReporter
  warnings: WarningCollector
  /** Nombre del archivo sin extensión (título de reserva). */
  fallbackTitle: string
  signal?: AbortSignal
}

export function makeContext(options: IngestOptions, fallbackTitle: string, progress?: ProgressReporter): IngestContext {
  return { options, progress: progress ?? new ProgressReporter(options.onProgress), warnings: new WarningCollector(), fallbackTitle, signal: options.signal }
}

export function checkContext(ctx: IngestContext): void {
  checkCancelled(ctx.signal)
}

/** Cede el hilo (para que la cancelación y el progreso lleguen durante trabajos largos). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Semáforo asíncrono: como mucho `limit` trabajos a la vez, en orden de llegada (como `AsyncGate`). */
export class AsyncGate {
  private running = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < Math.max(1, this.limit)) {
      this.running++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.running = Math.max(0, this.running - 1)
  }

  get active(): number {
    return this.running
  }

  async run<T>(body: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await body()
    } finally {
      this.release()
    }
  }
}
