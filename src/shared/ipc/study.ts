// Estudio: registrar intentos, repasar tarjetas, sumar tiempo, corregir respuestas abiertas con la IA, pedir más ejercicios,
// guardar el aprendizaje guiado y los simulacros. Todo escribe `progress.json` del curso en el proceso principal (con cerrojo)
// y avisa con 'progress.changed'. El cálculo (corrección, dominio, FSRS…) es el de `@engine/study`, el mismo que usa la interfaz.
import type { AnswerInput, GradeResult, GradeStatus, OpenAnswerReview } from '@engine/grading'
import type { ExamPlan, ExamReport } from '@engine/study'
import type { ExamResult, Exercise, ItemID, LearningConceptProgress } from '../schema'
import type { MasteryLevelName } from './stats'

/** Resultado de la corrección que se anota (basta el crédito; con el estado y el feedback se rellena el cuaderno de errores). */
export interface StudyAttemptResult {
  /** 0…1 */
  credit: number
  status?: GradeStatus
  feedback?: GradeResult['feedback']
  needsReview?: boolean
}

export interface RecordAttemptArgs {
  packId: ItemID
  skillId: ItemID
  /** Id del ejercicio; las variantes de plantilla, «plantilla#semilla». */
  exerciseId: string
  result: StudyAttemptResult
  /** Segundos que tardó. */
  seconds?: number
  hints?: number
  /** lesson | practice | review | diagnostic | exam (practice por defecto). */
  mode?: 'lesson' | 'practice' | 'review' | 'diagnostic' | 'exam'
  /** Lo que contestó (para el cuaderno de errores); texto o la entrada tal cual. */
  input?: string | AnswerInput
  /** El ejercicio, si no está en el banco del curso (incrustado en un «Pruébalo»). */
  exercise?: Exercise
}

/** Lo que cambió tras escribir en el progreso. */
export interface StudyProgressSummary {
  packId: ItemID
  skillId?: ItemID
  /** Dominio 0…1 de la habilidad (null si nunca se intentó). */
  mastery: number | null
  level: MasteryLevelName
  /** Intentos registrados de la habilidad. */
  skillAttempts: number
  /** Tarjetas vencidas y errores por repasar del curso. */
  dueCards: number
  mistakes: number
  xp: number
  minutesToday: number
  /** Racha de días (todos los cursos). */
  streak: number
  /** Nota estimada del curso (0…1). */
  readiness: number
}

export interface ReviewCardArgs {
  packId: ItemID
  cardId: ItemID
  /** 1 otra vez · 2 difícil · 3 bien · 4 fácil */
  rating: 1 | 2 | 3 | 4
  seconds?: number
}

export interface GradeOpenArgs {
  packId: ItemID
  exerciseId: string
  /** La respuesta escrita del estudiante. */
  answer: string
  skillId?: ItemID
  /** El ejercicio, si no está en el banco del curso. */
  exercise?: Exercise
}

export interface GradeOpenResult {
  review: OpenAnswerReview
  /** La corrección como la de cualquier otro ejercicio (crédito = puntos / máximo). */
  grade: GradeResult
  /** Proveedor y modelo que corrigió. */
  provider: string
}

export interface PrepareMoreArgs {
  packId: ItemID
  skillId: ItemID
  /** El concepto agotado (aprendizaje guiado). */
  conceptId?: string
}

export interface PrepareMoreResult {
  requestId: string
  /** Archivo de la petición (en `runs/` del curso) que recoge la generación. */
  file: string
  /** Instrucción para `generation.extend`. */
  instruction: string
}

export interface SaveLearningArgs {
  packId: ItemID
  skillId: ItemID
  /** Estado de los conceptos guiados que devuelve `@engine/study` (se fusiona por concepto). */
  learning: Record<string, LearningConceptProgress>
  lessonStep?: number
}

export interface StartExamResult extends ExamPlan {
  /** Los ejercicios de cada elemento del simulacro (por `exerciseID`). */
  exercises: Record<string, Exercise>
}

export interface SubmitExamArgs {
  packId: ItemID
  /** Id del simulacro en curso (el guardado en el progreso). */
  runId: string
  inputs: Record<string, AnswerInput>
  secondsByItem?: Record<string, number>
  /** Tiempo activo del simulacro en segundos (sin pausas ni la app cerrada); es la duración que se guarda. */
  activeSeconds?: number
}

export interface SubmitExamResult {
  result: ExamResult
  grades: Record<string, GradeResult>
  report: ExamReport
}

declare module './contract' {
  interface RpcMethods {
    'study.recordAttempt': { args: RecordAttemptArgs; result: StudyProgressSummary }
    'study.reviewCard': { args: ReviewCardArgs; result: StudyProgressSummary }
    'study.recordTime': { args: { packId: ItemID; seconds: number }; result: { minutesToday: number } }
    /** Corrige una respuesta abierta con la IA y su rúbrica. Sin IA: error con código 'needs_ai'. */
    'study.gradeOpen': { args: GradeOpenArgs; result: GradeOpenResult }
    /** Pide más ejercicios para un concepto agotado (deja la petición para la generación). */
    'study.prepareMore': { args: PrepareMoreArgs; result: PrepareMoreResult }
    'study.saveLearning': { args: SaveLearningArgs; result: StudyProgressSummary }
    'study.completeLesson': { args: { packId: ItemID; skillId: ItemID }; result: StudyProgressSummary }
    /** Arma un simulacro y lo guarda como el simulacro en curso. */
    'study.startExam': { args: { packId: ItemID }; result: StartExamResult | null }
    'study.submitExam': { args: SubmitExamArgs; result: SubmitExamResult }
  }
  interface RpcEvents {
    /** El progreso de un curso cambió (intento, tarjeta, tiempo, lección, simulacro). */
    'progress.changed': { packId: ItemID }
  }
}
export {}
