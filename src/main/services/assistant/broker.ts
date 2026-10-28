// Tarjetas que esperan al estudiante durante un turno (port de AssistantBroker de AssistantHost.swift). Una herramienta enseña la
// tarjeta y espera con `wait` hasta que la interfaz responda con `resolve` (o caduque, o se detenga el turno). Funciona igual con
// proveedores de API (herramientas en el proceso) y con agentes CLI (por el relevo MCP).

/** Respuesta del estudiante a una tarjeta (pregunta o permiso). */
export type AssistantAnswer =
  | { kind: 'option'; index: number }
  | { kind: 'approved' }
  | { kind: 'denied' }
  /** Escribió en el campo en lugar de pulsar (`fromComposer`: en la caja de escribir, que ya enseña su mensaje). */
  | { kind: 'typed'; text: string; fromComposer?: boolean }
  /** Nadie respondió a tiempo, o se detuvo el turno. */
  | { kind: 'expired' }

export const Answer = {
  option: (index: number): AssistantAnswer => ({ kind: 'option', index }),
  approved: { kind: 'approved' } as AssistantAnswer,
  denied: { kind: 'denied' } as AssistantAnswer,
  typed: (text: string, fromComposer = false): AssistantAnswer => (fromComposer ? { kind: 'typed', text, fromComposer } : { kind: 'typed', text }),
  expired: { kind: 'expired' } as AssistantAnswer
}

/** ¿Aprobó? (aprobar o elegir la primera opción de un permiso) */
export const isApproval = (a: AssistantAnswer): boolean => a.kind === 'approved' || (a.kind === 'option' && a.index === 0)

export class AssistantBroker {
  private readonly waiting = new Map<string, (a: AssistantAnswer) => void>()
  /** Respuestas que llegaron antes de que la herramienta se pusiera a esperar. */
  private readonly early = new Map<string, AssistantAnswer>()
  /** Cuánto se espera como mucho antes de dar la tarjeta por caducada (10 min). */
  readonly timeoutMs: number

  constructor(timeoutMs = 600_000) {
    this.timeoutMs = timeoutMs
  }

  get hasPending(): boolean { return this.waiting.size > 0 }
  get pendingIDs(): string[] { return [...this.waiting.keys()] }

  /** Espera la respuesta a la tarjeta `id` (ya enseñada). `timeoutMs` acota la espera de esta tarjeta: con un agente CLI la llamada
   * a la herramienta tiene su propio plazo y la tarjeta debe caducar ANTES (aprobar tarde no puede hacer nada a espaldas de la IA). */
  wait(id: string, timeoutMs?: number, signal?: AbortSignal): Promise<AssistantAnswer> {
    const ready = this.early.get(id)
    if (ready) {
      this.early.delete(id)
      return Promise.resolve(ready)
    }
    if (signal?.aborted) return Promise.resolve(Answer.expired)
    const limit = Math.min(this.timeoutMs, timeoutMs ?? this.timeoutMs)
    return new Promise((resolve) => {
      const done = (a: AssistantAnswer): void => {
        if (this.waiting.get(id) !== done) return
        this.waiting.delete(id)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(a)
      }
      const onAbort = (): void => done(Answer.expired)
      const timer = setTimeout(() => done(Answer.expired), limit)
      timer.unref?.()
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiting.set(id, done)
    })
  }

  /** Responde a una tarjeta. false si nadie la esperaba (la respuesta se guarda por si la herramienta aún no llegó a esperar). */
  resolve(id: string, answer: AssistantAnswer): boolean {
    const fn = this.waiting.get(id)
    if (fn) {
      fn(answer)
      return true
    }
    if (answer.kind !== 'expired') this.early.set(id, answer)
    return false
  }

  /** Responde a todas las tarjetas pendientes (al detener el turno: caducan). */
  resolveAll(answer: AssistantAnswer): void {
    const all = [...this.waiting.values()]
    this.early.clear()
    for (const fn of all) fn(answer)
  }
}
