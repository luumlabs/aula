// Equipo de agentes: cuántos trabajan a la vez y cuándo puede empezar cada etapa (port de StudyEngine/Pipeline/Team.swift).

export type GatePriority = 'high' | 'normal'

/**
 * Limita cuántos agentes trabajan a la vez. Lo que termina una habilidad (verificar, arbitrar, reparar) pasa delante de empezar
 * otra, así las habilidades quedan listas antes y el estudiante puede ir estudiándolas.
 */
export class AgentGate {
  readonly limit: number
  private active = 0
  private readonly high: Array<() => void> = []
  private readonly normal: Array<() => void> = []
  /** Máximo de agentes simultáneos que se llegó a tener. */
  peak = 0

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit))
  }

  acquire(priority: GatePriority): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      this.peak = Math.max(this.peak, this.active)
      return Promise.resolve()
    }
    return new Promise((resolve) => (priority === 'high' ? this.high : this.normal).push(resolve))
  }

  /** Libera un puesto: pasa directamente al siguiente que espera (primero los urgentes). */
  release(): void {
    const next = this.high.shift() ?? this.normal.shift()
    if (next) next()
    else this.active = Math.max(0, this.active - 1)
  }

  /** Ejecuta `body` ocupando un puesto. */
  async run<T>(priority: GatePriority, body: () => Promise<T>): Promise<T> {
    await this.acquire(priority)
    try {
      return await body()
    } finally {
      this.release()
    }
  }
}

/** Cuenta atrás: `wait()` vuelve cuando se ha llamado `done()` tantas veces como se indicó. */
export class Countdown {
  private remaining: number
  private waiters: Array<() => void> = []

  constructor(count: number) {
    this.remaining = Math.max(0, count)
  }

  done(): void {
    this.remaining = Math.max(0, this.remaining - 1)
    if (this.remaining === 0) {
      const w = this.waiters
      this.waiters = []
      for (const r of w) r()
    }
  }

  wait(): Promise<void> {
    if (this.remaining === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

/** Ejecuta `body` para cada elemento con a lo sumo `limit` a la vez. */
export async function forEachLimited<T>(items: readonly T[], limit: number, body: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]
      await body(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()))
}
