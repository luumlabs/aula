// Tipos públicos del motor de estudio (aprendizaje guiado, práctica, tarjetas, simulacros, errores y estadísticas).
import type { Attempt, Block, ExamBlueprint, ExamResult, ExamRun, Exercise, Flashcard, ISODate, ItemID, LearningPhase, MistakeEntry, Skill, SkillProgress } from '@shared/schema'
import type { Seed } from '@engine/learn'
import type { GradeLang, GradeResult } from '@engine/grading'

/** Las habilidades de un curso, como lista o indexadas por id (los ids repetidos cuentan una vez: la primera). */
export type SkillsInput = readonly Skill[] | Readonly<Record<ItemID, Skill>>

/** Idioma de las frases que escribe el motor (planes, avisos, informes). */
export type StudyLang = GradeLang

// MARK: Aprendizaje guiado

/** Un concepto de la lección: su explicación y las preguntas que lo certifican (port de `LearningConcept`). */
export interface LearningConcept {
  /** Id del primer bloque (o «<habilidad>-concept-<n>»). */
  id: string
  /** Huella de la explicación y de las comprobaciones: si cambia, la evidencia vieja no vale. */
  revision: string
  title: string
  teachingBlocks: Block[]
  /** Bloques de comprobación (tryit, predict, spot). */
  checkpointBlocks: Block[]
  /** Ejercicios del banco que lo comprueban (los enlazados en su tryit y los asociados por etiquetas o enunciado). */
  exerciseIDs: ItemID[]
  /** Ejercicios incrustados en sus tryit (con la habilidad ya puesta). */
  inlineExercises: Exercise[]
  /** Plantillas asociadas (preguntas inagotables). */
  templateIDs: ItemID[]
  /** Revisión de cada fuente de preguntas (ejercicio o plantilla) en el momento de construir el concepto. */
  questionRevisions: Record<string, string>
}

/** Cómo se puede comprobar un concepto: preguntas que Aula corrige sola, solo abiertas (IA o autoevaluación) o ninguna. */
export type CheckKind = 'objective' | 'selfAssessed' | 'none'

/** Lo que la interfaz necesita para dibujar el recorrido de una lección guiada. */
export interface ConceptView {
  id: string
  title: string
  phase: LearningPhase
  /** Aciertos independientes conseguidos y los que hacen falta (2; 1 si el concepto solo tiene preguntas abiertas). */
  successes: number
  required: number
  checkKind: CheckKind
  /** Preguntas distintas que Aula corrige sola (`Infinity` con plantillas). */
  objectiveChecks: number
  /** ¿Se puede abrir? (todos los anteriores superados). */
  unlocked: boolean
  canAdvance: boolean
  /** Se dio por superado sin comprobarlo (se acabaron las preguntas y el estudiante siguió). */
  unchecked: boolean
  /** Se acabaron las preguntas: conviene pedir más (`study.prepareMore`). */
  prepareMore: boolean
}

/** Resultado de un paso del flujo guiado: el progreso NUEVO de la habilidad (el de entrada no se toca). */
export interface LearningStep {
  progress: SkillProgress
  phase: LearningPhase
  /** La pregunta que toca ahora (si la hay). */
  exercise?: Exercise
  /** La reexplicación tras un error (feedback, pistas, solución, otro ejemplo resuelto). */
  remediation: Block[]
  /** No quedan preguntas nuevas: la interfaz ofrece «Preparar más ejercicios» (`study.prepareMore`) o seguir sin comprobar. */
  prepareMore: boolean
}

export interface CheckOptions {
  /** Semilla para las plantillas (por defecto 0, como Swift). */
  seed?: Seed
  /** Intentos ya hechos del curso (para no repetir preguntas que el estudiante ya vio). */
  attempts?: readonly Attempt[]
  lang?: StudyLang
}

/** Cómo se respondió la comprobación. */
export interface CheckUse {
  hints: number
  /** Vio la solución antes de responder. */
  revealed: boolean
  /** Primer intento con esta pregunta (por defecto sí). */
  firstAttempt?: boolean
  lang?: StudyLang
}

// MARK: Práctica

/** Qué se quiere practicar (port de `PracticeRequest.Kind`). */
export type PracticeRequest =
  | { kind: 'skill'; skillId: ItemID; level?: number }
  | { kind: 'weakest' }
  | { kind: 'mistakes' }
  | { kind: 'diagnostic' }

export interface PracticeOptions {
  /** Ejercicios de la sesión (10 por defecto). */
  count?: number
  now?: Date
  /** Semilla (por defecto, los segundos de `now`). */
  seed?: Seed
}

// MARK: Tarjetas

export interface DueCard {
  card: Flashcard
  skillId: ItemID
  isNew: boolean
  /** Vencimiento (las nuevas, la fecha más antigua posible). */
  due: ISODate
}

export interface DueCardOptions {
  now?: Date
  /** Incluir tarjetas nuevas (sí por defecto). */
  includeNew?: boolean
  /** Nuevas como mucho (8). */
  newLimit?: number
  /** Tarjetas como mucho (60). */
  limit?: number
  /** Solo de esta habilidad. */
  skillId?: ItemID
}

export interface ReviewCardOptions {
  /** Habilidad de la tarjeta (para actualizar su dominio); si falta, se busca en `skills`. */
  skillId?: ItemID
  skills?: SkillsInput
  /** Segundos que tardó (8 por defecto en la estadística del día). */
  seconds?: number
}

// MARK: Simulacros

export interface ExamPlan {
  run: ExamRun
  blueprint: ExamBlueprint
  totalPoints: number
  /** Preguntas del banco que no entran en pantalla porque necesitan otra corrección (abiertas, cortas «con IA»). */
  leftOut: number
  /** Aviso para la persona cuando `leftOut > 0`. */
  leftOutNotice?: string
}

export interface BuildExamOptions {
  seed?: Seed
  now?: Date
  /** Simulacro en la app (por defecto); `false` para el examen en papel. */
  onScreen?: boolean
  /** Id del simulacro (por defecto, uno corto aleatorio). */
  id?: string
  lang?: StudyLang
}

export interface ExamGrade {
  result: ExamResult
  /** Corrección de cada pregunta (por id del elemento del simulacro). */
  grades: Record<string, GradeResult>
}

/** Una habilidad en el informe del simulacro. */
export interface ExamSkillReport {
  skillId: ItemID
  title: string
  points: number
  total: number
  /** 0…1 */
  percent: number
  items: number
  wrong: number
}

export interface ExamSectionReport {
  title: string
  points: number
  total: number
  percent: number
  items: number
}

/** Informe de un simulacro: nota, por secciones y por habilidad, y qué repasar. */
export interface ExamReport {
  examId: string
  score: number
  total: number
  /** 0…1 */
  percent: number
  passed?: boolean
  durationSeconds: number
  sections: ExamSectionReport[]
  skills: ExamSkillReport[]
  /** Habilidades que más puntos hicieron perder (como mucho 3), con una frase. */
  review: Array<{ skillId: ItemID; title: string; reason: string }>
  /** Preguntas falladas (para el cuaderno de errores y para revisarlas). */
  wrongItems: string[]
}

// MARK: Registro

/** Un intento para `recordAttempt`. */
export interface AttemptRecord {
  /** 0…1 (se acota; NaN → 0). */
  credit: number
  hints?: number
  seconds?: number
  /** lesson | practice | review | diagnostic | exam (practice por defecto). */
  mode?: Attempt['mode']
  /** Lo que escribió (texto), para el cuaderno de errores. */
  input?: string
  /** La explicación del error que se mostró. */
  why?: string
}

/** Un error del cuaderno con su ejercicio (si aún existe). */
export interface MistakeView {
  entry: MistakeEntry
  exercise?: Exercise
  /** ¿Toca repasarlo ya? */
  due: boolean
  /** Días hasta el siguiente repaso (0 si ya toca). */
  inDays: number
}

// MARK: Estadísticas

export interface StudyStatsSummary {
  minutesToday: number
  attemptsToday: number
  /** Precisión de hoy (0…1; 0 sin intentos). */
  accuracyToday: number
  streak: { current: number; best: number }
  /** Lunes…domingo de esta semana: ¿hubo estudio ese día? */
  week: boolean[]
  /** Minutos de los últimos `days` días (el último es hoy). */
  minutesByDay: Array<{ day: string; minutes: number }>
  totalMinutes: number
  totalAttempts: number
  /** Precisión de todos los días (0…1). */
  accuracy: number
}

export type { GradeResult }
