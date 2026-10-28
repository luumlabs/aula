// La tarjeta del curso que se crea (o se cambia) desde el chat sigue la ejecución de verdad (A3-P2-5): antes se quedaba en
// «Empezando» para siempre, también días después. Puro (con prueba): de la última ejecución del curso a lo que se enseña.
import type { RunSummary } from '@shared/generation/types'

export type CourseCardStatus =
  | { kind: 'building'; percent: number; runId: string }
  | { kind: 'ready' }
  | { kind: 'failed'; runId: string }
  | { kind: 'paused'; runId: string }
  | { kind: 'limit'; runId: string }

/** El estado de la tarjeta según la última ejecución del curso (undefined: no se sabe; se enseña lo que trajo la tarjeta). */
export function courseCardStatus(run: Pick<RunSummary, 'id' | 'state' | 'progress'> | undefined): CourseCardStatus | undefined {
  if (!run) return undefined
  switch (run.state) {
    case 'running':
    case 'waiting':
      return { kind: 'building', percent: Math.max(0, Math.min(99, Math.round(run.progress * 100))), runId: run.id }
    case 'done':
      return { kind: 'ready' }
    case 'failed':
      return { kind: 'failed', runId: run.id }
    case 'paused':
    case 'cancelled':
      return { kind: 'paused', runId: run.id }
    case 'limit':
      return { kind: 'limit', runId: run.id }
  }
}
