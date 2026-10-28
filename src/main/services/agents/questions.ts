// Canal de preguntas de la IA al estudiante (`ask_user`), igual para proveedores de API y agentes CLI: la herramienta corre en
// la app (los agentes CLI llegan por el relevo), publica la pregunta aquí y espera la respuesta de la interfaz
// (idea de `StudyEngine/Pipeline/QuestionBroker.swift`, en memoria en vez de archivos).
import { randomBytes } from 'node:crypto'

export interface PendingQuestion {
  id: string
  text: string
  options: string[]
  askedAt: number
}

export interface AskOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** Lo que recibe la IA si nadie contesta (en inglés: lo lee el modelo). */
export const NO_ANSWER =
  '(The student did not answer. Decide yourself using the most reasonable assumption and record it with note_progress.)'

export class QuestionBroker {
  private readonly waiting = new Map<string, { question: PendingQuestion; resolve: (answer: string) => void }>()
  private readonly listeners = new Set<(pending: PendingQuestion[]) => void>()

  /** Publica la pregunta y espera la respuesta (o el plazo, o la cancelación: entonces `NO_ANSWER`). */
  ask(text: string, options: string[] = [], opts: AskOptions = {}): Promise<string> {
    if (opts.signal?.aborted) return Promise.resolve(NO_ANSWER)
    const id = randomBytes(6).toString('hex')
    const question: PendingQuestion = { id, text, options, askedAt: Date.now() }
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined
      const finish = (answer: string): void => {
        if (!this.waiting.delete(id)) return
        if (timer) clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        this.notify()
        resolve(answer)
      }
      const onAbort = (): void => finish(NO_ANSWER)
      this.waiting.set(id, { question, resolve: finish })
      timer = setTimeout(() => finish(NO_ANSWER), opts.timeoutMs ?? 900_000)
      timer.unref?.()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      this.notify()
    })
  }

  /** Preguntas que aún esperan respuesta. */
  pending(): PendingQuestion[] {
    return Array.from(this.waiting.values()).map((w) => w.question)
  }

  /** Responde una pregunta. `false` si ya no esperaba. */
  answer(id: string, text: string): boolean {
    const entry = this.waiting.get(id)
    if (!entry) return false
    entry.resolve(text.trim() ? text : NO_ANSWER)
    return true
  }

  /** Avisa de cada cambio en las preguntas pendientes. Devuelve la función para dejar de escuchar. */
  onChange(listener: (pending: PendingQuestion[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    const list = this.pending()
    for (const listener of this.listeners) listener(list)
  }
}
