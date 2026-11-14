// ¿La creación de un curso se quedó a medias sin nada escrito? (puro). Un curso así no tiene nada que estudiar: en vez del
// resumen vacío («0 temas · Estudiar ahora») se explica qué pasó y se ofrece reintentar, ver el registro o eliminarlo.
// Mientras se escribe se cuentan los temas LISTOS (auditados): un borrador aún cambia. Si la creación se paró (pausa, límite,
// error), nadie escribe: cuenta todo lo ESCRITO, también los borradores que quedaron sin auditar (al cerrar Aula o al topar con
// un límite mientras se escribían los primeros temas).
import type { RunState, RunSummary } from '@shared/generation/types'
import type { CreationPhase, TopicCounts, TopicRef } from '@engine/study/topics'
import { topicIsReady } from '@engine/study/topics'

export type CourseRunIssue = 'failed' | 'stopped' | 'limit' | 'building'

type RunLike = Pick<RunSummary, 'state' | 'mode'>

/** Una ampliación («Pedir cambios», «Preparar más») trabaja sobre un curso que ya existía: no lo deja vacío ni a medias. */
const isExtend = (run: RunLike): boolean => run.mode === 'extend'

/** ¿Aula está trabajando ahora en esta ejecución? */
export const runIsActive = (run: Pick<RunSummary, 'state'> | undefined): boolean => !!run && (run.state === 'running' || run.state === 'waiting')

/** Los temas que cuentan según la ejecución: en marcha, los listos; parada, todo lo escrito. */
export function studyableCount(run: RunLike | undefined, counts: TopicCounts): number {
  return runIsActive(run) ? counts.ready : counts.written
}

/** El problema de un curso según su última ejecución y lo que tiene escrito (undefined = todo bien). */
export function courseRunIssue(run: RunLike | undefined, counts: TopicCounts): CourseRunIssue | undefined {
  if (!run || isExtend(run) || studyableCount(run, counts) > 0) return undefined
  const byState: Partial<Record<RunState, CourseRunIssue>> = { failed: 'failed', cancelled: 'stopped', paused: 'stopped', limit: 'limit', running: 'building', waiting: 'building' }
  return byState[run.state]
}

/** Un curso que aún se está creando pero ya tiene temas listos: se puede estudiar lo escrito mientras llega el resto. Se dice
 * igual en Hoy, en la barra lateral y en la pantalla del curso (antes solo Hoy decía «Creándose…» y lo demás parecía terminado). */
export function courseBuilding(run: RunLike | undefined, counts: TopicCounts): boolean {
  return !!run && !isExtend(run) && runIsActive(run) && counts.ready > 0
}

/** Un curso a medias: su creación se cortó (al cerrar Aula, con «Detener», por un error o un límite) cuando ya tenía temas
 * escritos. Parece terminado («2 temas · Estudiar ahora») pero le faltan temas, glosario, fórmulas o simulacro: hay que decirlo y
 * ofrecer «Reanudar» (J2-2). */
export type CoursePartial = 'paused' | 'failed' | 'limit'

export function coursePartial(run: RunLike | undefined, counts: TopicCounts): CoursePartial | undefined {
  if (!run || isExtend(run) || counts.written <= 0) return undefined
  const byState: Partial<Record<RunState, CoursePartial>> = { paused: 'paused', cancelled: 'paused', failed: 'failed', limit: 'limit' }
  return byState[run.state]
}

/** En qué punto está la creación para Aprender: escribiéndose, parada a medias o nada pendiente. */
export function creationPhase(run: RunLike | undefined, counts: TopicCounts): CreationPhase {
  if (!run || isExtend(run)) return 'none'
  if (runIsActive(run)) return 'building'
  return coursePartial(run, counts) ? 'stopped' : 'none'
}

/** El tema que está escribiendo ahora una ampliación de un solo tema («Escribir este tema ahora», «Pedir cambios» de un tema). */
export function extendingTopic(run: Pick<RunSummary, 'state' | 'mode' | 'skill'> | undefined): string | undefined {
  return run && isExtend(run) && runIsActive(run) ? run.skill : undefined
}

/** Qué temas puede proponer el plan («Estudiar ahora», Hoy): mientras se crea el curso, los listos; el que escribe ahora una
 * ampliación, cuando ya esté listo. undefined = todos los que tengan algo escrito (los demás cuentan igual para los pesos). */
export function planAvailability(run: Pick<RunSummary, 'state' | 'mode' | 'skill'> | undefined, counts: TopicCounts): ((ref: TopicRef & { id: string }) => boolean) | undefined {
  if (courseBuilding(run, counts)) return topicIsReady
  const target = extendingTopic(run)
  return target ? (ref) => ref.id !== target || topicIsReady(ref) : undefined
}

/** La última ejecución de cada curso (la lista llega con la más reciente primero). */
export function latestByCourse(runs: readonly RunSummary[]): Record<string, RunSummary> {
  const out: Record<string, RunSummary> = {}
  for (const r of runs) {
    const cur = out[r.packId]
    if (!cur || r.updated > cur.updated) out[r.packId] = r
  }
  return out
}

/** Los motivos que la pantalla explica con sus palabras (el resto: «algo salió mal»). */
export type FailureReason = 'auth' | 'network' | 'notInstalled' | 'timeout' | 'limit' | 'quota' | 'noMaterial' | 'stopped' | 'other'

export function failureReason(code: string | undefined, state: RunState): FailureReason {
  // sin saldo o sin cuota no «se renueva sola»: hay que recargar o cambiar de proveedor
  if (code === 'ai_quota') return 'quota'
  if (state === 'limit') return 'limit'
  // en pausa: la paró el estudiante (o se cerró Aula), no es un error (J2-13)
  if ((state === 'paused' || state === 'cancelled') && !code) return 'stopped'
  switch (code) {
    case 'ai_auth':
    case 'ai_missing_key':
      return 'auth'
    case 'ai_network':
      return 'network'
    case 'ai_not_installed':
      return 'notInstalled'
    case 'ai_timeout':
      return 'timeout'
    case 'ai_rate_limit':
    case 'ai_budget':
      return 'limit'
    case 'generation_no_material':
      return 'noMaterial'
    default:
      return 'other'
  }
}

/** Cuándo se puede seguir tras un límite: hoy a una hora, otro día, ya pasó o no se sabe (puro; la pantalla lo traduce). */
export type RenewalWhen = { kind: 'today' | 'later'; at: Date } | { kind: 'passed' } | undefined

export function renewalWhen(resumeAt: string | undefined, now: Date): RenewalWhen {
  if (!resumeAt) return undefined
  const at = new Date(resumeAt)
  if (Number.isNaN(at.getTime())) return undefined
  if (at.getTime() <= now.getTime()) return { kind: 'passed' }
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()
  return { kind: sameDay ? 'today' : 'later', at }
}
