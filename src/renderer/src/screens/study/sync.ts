// Operaciones de estudio que la interfaz manda al proceso principal (contrato `study.*` en src/shared/ipc/study.ts). La
// interfaz ya aplicó cada una a su copia del progreso con el motor; aquí se agrupan y se mandan en orden. Lo que no
// tiene método propio (ajustes, simulacro a medias, deshacer) se guarda con `progress.save`.
import type { AnswerInput, GradeResult } from '@engine/grading'
import type { AttemptRecord } from '@engine/study'
import type { Exercise, StudyProgress } from '@shared/schema'

export type SyncOp =
  /** Un intento (dominio, cuaderno de errores, día, XP). `inBank`: el ejercicio está en el banco del curso. */
  | { kind: 'attempt'; exercise: Exercise; record: AttemptRecord; result: Pick<GradeResult, 'status' | 'feedback' | 'needsReview'>; inBank: boolean; input?: AnswerInput }
  | { kind: 'review'; cardId: string; rating: 1 | 2 | 3 | 4; seconds?: number }
  | { kind: 'time'; seconds: number }
  /** El estado guiado (y el paso de lectura) de una habilidad: se manda el que haya al enviar. */
  | { kind: 'learning'; skillId: string }
  | { kind: 'completeLesson'; skillId: string }
  /** Todo el progreso (lo que no tiene método propio). */
  | { kind: 'save' }

type Invoke = (method: string, args?: unknown) => Promise<unknown>

/** Junta las operaciones repetidas: un solo «learning» por habilidad y un solo «save» (en el sitio del último). */
export function coalesceOps(ops: readonly SyncOp[]): SyncOp[] {
  const lastLearning = new Map<string, number>()
  let lastSave = -1
  ops.forEach((op, i) => {
    if (op.kind === 'learning') lastLearning.set(op.skillId, i)
    if (op.kind === 'save') lastSave = i
  })
  return ops.filter((op, i) => (op.kind === 'learning' ? lastLearning.get(op.skillId) === i : op.kind === 'save' ? i === lastSave : true))
}

/** Los argumentos de `study.recordAttempt` para un intento. */
export function attemptArgs(packId: string, op: Extract<SyncOp, { kind: 'attempt' }>): Record<string, unknown> {
  const { exercise, record, result, inBank } = op
  return {
    packId,
    skillId: exercise.skill,
    exerciseId: exercise.id,
    result: { credit: record.credit, status: result.status, feedback: result.feedback, needsReview: result.needsReview },
    seconds: record.seconds,
    hints: record.hints,
    mode: record.mode ?? 'practice',
    input: record.input,
    // un ejercicio que no está en el banco (incrustado en un «Pruébalo» o variante de plantilla) viaja entero
    ...(inBank ? {} : { exercise })
  }
}

/**
 * Manda las operaciones en orden. Si el proceso principal rechaza alguna (argumentos que no acepta, un fallo al
 * escribir), se guarda el progreso entero al final para no perder nada.
 */
export async function sendOps(packId: string, ops: readonly SyncOp[], latest: () => StudyProgress, invoke: Invoke): Promise<void> {
  let fallback = false
  for (const op of ops) {
    try {
      switch (op.kind) {
        case 'attempt':
          await invoke('study.recordAttempt', attemptArgs(packId, op))
          break
        case 'review':
          await invoke('study.reviewCard', { packId, cardId: op.cardId, rating: op.rating, seconds: op.seconds })
          break
        case 'time':
          await invoke('study.recordTime', { packId, seconds: Math.round(op.seconds) })
          break
        case 'learning': {
          const sp = latest().skills[op.skillId]
          await invoke('study.saveLearning', { packId, skillId: op.skillId, learning: sp?.learning ?? {}, lessonStep: sp?.lessonStep })
          break
        }
        case 'completeLesson':
          await invoke('study.completeLesson', { packId, skillId: op.skillId })
          break
        case 'save':
          await invoke('progress.save', { id: packId, progress: latest() })
          break
      }
    } catch (e) {
      const code = (e as { code?: string }).code
      // argumentos que el proceso principal no acepta (un ejercicio raro): se sigue con lo demás y se guarda todo al final
      fallback = true
      if (code !== 'invalid_args') console.warn('[aula] estudio:', op.kind, e)
    }
  }
  if (fallback) await invoke('progress.save', { id: packId, progress: latest() })
}
