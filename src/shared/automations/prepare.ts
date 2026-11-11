// «Adelantar trabajo»: qué merece que Aula prepare algo POR SU CUENTA, sin que nadie se lo pida. Puro (sin IA): mira el
// calendario y decide; así una pasada sin nada que adelantar no cuesta nada, y lo que sí hay se le encarga a la IA con el
// evento concreto delante («tienes esta prueba mañana: prepárale un repaso»).
import type { PlannerEvent } from './planner'

/** Lo que usa de un evento (lo cumple `RoutineEvent`). */
export interface PreparableEvent extends PlannerEvent {
  course?: string
  url?: string
  packID?: string
}

export interface PrepareCandidate<E extends PreparableEvent = PreparableEvent> {
  event: E
  /** review: un repaso corto dentro de su curso de Aula (examen o prueba); guide: una guía para organizar una entrega. */
  kind: 'review' | 'guide'
  /** El curso de Aula del evento, si lo tiene. */
  packID?: string
  hoursLeft: number
}

export interface PrepareRules {
  /** Días antes de un examen o prueba desde los que se prepara el repaso. */
  examDays: number
  /** Días antes de una entrega desde los que se prepara la guía. */
  assignmentDays: number
  /** Con menos horas que estas ya no ayuda: es tarde para material nuevo. */
  minHours: number
  /** Cuántas cosas adelanta en una pasada. */
  max: number
}

export const PREPARE_RULES: PrepareRules = { examDays: 3, assignmentDays: 4, minHours: 3, max: 2 }
/** Cuántas cosas adelanta Aula en un día como mucho (cada una cuesta uso de la IA). */
export const PREPARE_PER_DAY = 4

/**
 * Los eventos próximos que piden que Aula adelante algo, los más cercanos primero. `prepared` son los ids de los que ya se
 * ocupó (no se repite) y `packFor` dice qué curso de Aula corresponde a un evento.
 */
export function prepareCandidates<E extends PreparableEvent>(
  events: readonly E[], prepared: ReadonlySet<string>, packFor: (e: E) => string | undefined, now: number, rules: PrepareRules = PREPARE_RULES
): PrepareCandidate<E>[] {
  const out: PrepareCandidate<E>[] = []
  for (const e of events) {
    if (prepared.has(e.id)) continue
    const start = e.start.getTime()
    const hoursLeft = (start - now) / 3_600_000
    if (hoursLeft < rules.minHours) continue
    const packID = packFor(e)
    if (e.kind === 'exam' || e.kind === 'quiz') {
      // el repaso vive dentro de un curso: sin curso, de eso se ocupa la oferta de «¿lo preparo?»
      if (packID && hoursLeft <= rules.examDays * 24) out.push({ event: e, kind: 'review', packID, hoursLeft })
    } else if (e.kind === 'assignment') {
      if (hoursLeft <= rules.assignmentDays * 24) out.push({ event: e, kind: 'guide', ...(packID ? { packID } : {}), hoursLeft })
    }
  }
  return out.sort((a, b) => a.hoursLeft - b.hoursLeft).slice(0, Math.max(0, rules.max))
}
