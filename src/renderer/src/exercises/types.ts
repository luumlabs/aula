// Tipos de la interfaz de ejercicios. La entrada del estudiante (`AnswerInput`) y el resultado de la corrección
// (`GradeResult`) son los del motor (src/engine/grading); aquí solo se añade la corrección con IA de las abiertas.
import type { Exercise } from '@shared/schema/exercises'
import type { AnswerInput, FeedbackKind, FeedbackLine, GradeResult as EngineGrade, GradeStatus, OpenAnswerReview } from '@engine/grading'
import { makeGrade } from '@engine/grading'

export type { AnswerInput, FeedbackKind, FeedbackLine, GradeStatus, OpenAnswerReview }

/** Resultado de la corrección; en una respuesta abierta corregida por Aula, con su rúbrica puntuada. */
export type GradeResult = EngineGrade & { review?: OpenAnswerReview }

/**
 * Cómo se usa el ejercicio:
 * - practice: con pistas, «No lo sé», reintentos y solución.
 * - lesson: dentro de una lección («Pruébalo»).
 * - guided: comprobación del modo guiado (un solo intento; pedir ayuda invalida la pregunta).
 * - review: repaso del cuaderno de errores.
 * - exam: sin pistas ni corrección hasta entregar.
 */
export type ExerciseMode = 'practice' | 'lesson' | 'guided' | 'review' | 'exam'

/** Corrector síncrono. */
export type GradeFn = (exercise: Exercise, input: AnswerInput) => GradeResult

export function makeResult(status: GradeStatus, credit: number, more: Partial<Omit<GradeResult, 'status' | 'credit'>> = {}): GradeResult {
  return makeGrade(status, Number.isFinite(credit) ? Math.min(1, Math.max(0, credit)) : 0, more)
}

export const isCorrect = (r: GradeResult | undefined): boolean => r?.status === 'correct'
