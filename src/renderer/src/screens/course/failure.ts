// ¿La creación de un curso se quedó a medias sin ningún tema? (puro). Un curso así no tiene nada que estudiar: en vez del
// resumen vacío («0 temas · Estudiar ahora») se explica qué pasó y se ofrece reintentar, ver el registro o eliminarlo.
import type { RunState, RunSummary } from '@shared/generation/types'

export type CourseRunIssue = 'failed' | 'stopped' | 'limit' | 'building'

/** El problema de un curso según su última ejecución y cuántos temas tiene (undefined = todo bien). */
export function courseRunIssue(run: Pick<RunSummary, 'state'> | undefined, skillCount: number): CourseRunIssue | undefined {
  if (!run || skillCount > 0) return undefined
  const byState: Partial<Record<RunState, CourseRunIssue>> = { failed: 'failed', cancelled: 'stopped', paused: 'stopped', limit: 'limit', running: 'building', waiting: 'building' }
  return byState[run.state]
}

/** Un curso a medias: su creación se cortó (al cerrar Aula, con «Detener», por un error o un límite) cuando ya tenía temas.
 * Parece terminado («2 temas · Estudiar ahora») pero le faltan temas, glosario, fórmulas o simulacro: hay que decirlo y ofrecer
 * «Reanudar» (J2-2). */
export type CoursePartial = 'paused' | 'failed' | 'limit'

export function coursePartial(run: Pick<RunSummary, 'state'> | undefined, skillCount: number): CoursePartial | undefined {
  if (!run || skillCount <= 0) return undefined
  const byState: Partial<Record<RunState, CoursePartial>> = { paused: 'paused', cancelled: 'paused', failed: 'failed', limit: 'limit' }
  return byState[run.state]
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
export type FailureReason = 'auth' | 'network' | 'notInstalled' | 'timeout' | 'limit' | 'noMaterial' | 'stopped' | 'other'

export function failureReason(code: string | undefined, state: RunState): FailureReason {
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
    case 'ai_quota':
      return 'limit'
    case 'generation_no_material':
      return 'noMaterial'
    default:
      return 'other'
  }
}
