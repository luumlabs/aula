// Motor de estudio (port de StudyEngine/Learning): API PÚBLICA y estable para la interfaz y el proceso principal.
// Isomorfo y puro: nada de `node:*` ni `electron`. Ninguna función modifica sus argumentos: las que «escriben» devuelven
// un progreso NUEVO (StudyProgress o SkillProgress) que quien llama guarda.
//
//   Corregir:            grade · correctAnswerMarkdown · canonicalInput · instantiateTemplate (de @engine/grading)
//   Aprendizaje guiado:  lessonConcepts · learningOverview · acknowledgeExplanation · prepareCheck · recordCheck · …
//   Práctica:            buildPractice · refillPractice · weakestSkills
//   Tarjetas (FSRS):     dueCards · reviewCard · cardIntervals · clozeText
//   Simulacros:          examBlueprint · buildExam · examExercises · gradeExam · examReport · recordExam
//   Registro y errores:  recordAttempt · recordStudyTime · completeLesson · dueMistakes · mistakesNotebook · withSkillProgress
//   Resúmenes:           readiness · dailyPlan · studyStats · courseOverview · homeSummary
import type {
  Attempt, Block, ExamBlueprint, ExamRun, ExamRunItem, Exercise, ItemID, LearningPhase, MistakeEntry, Pack, Skill, SkillProgress, StudyProgress
} from '@shared/schema'
import type { CourseOverview } from '@shared/ipc/course-view'
import type { HomeEvent, HomeSummary } from '@shared/ipc/home'
import type { PlanItem, Rating, Readiness } from '@engine/learn'
import type { AnswerInput, GradeResult } from '@engine/grading'
import type {
  AttemptRecord, BuildExamOptions, CheckKind, CheckOptions, CheckUse, ConceptView, DueCard, DueCardOptions, ExamGrade, ExamPlan, ExamReport,
  LearningConcept, LearningStep, MistakeView, PracticeOptions, PracticeRequest, ReviewCardOptions, SkillsInput, StudyLang, StudyStatsSummary
} from './types'
import { LearningController } from './learning'
import { PracticeQueue } from './practice'
import { CardReview } from './cards'
import { ExamBuilder } from './exam'
import { Recorder } from './recorder'
import { LearnBridge } from './bridge'
import { StudyStatsCalc } from './stats'
import { buildCourseOverview } from './overview'
import { buildHomeSummary, type HomeCourseInput, type HomeSettings } from './home'
import { buildStatsData, type StatsCourseInput } from './stats-data'
import type { StatsData } from '@shared/ipc/stats'
import { ownValue } from '@shared/schema'

export * from './types'
export type { HomeCourseInput, HomeSettings } from './home'
export type { StatsCourseInput } from './stats-data'
export { learningContentRequest, type LearningContentRequest } from './content-request'
// Piezas internas (paridad con los tipos de Swift), para el proceso principal y las pruebas
export { LearningController, LearnBridge, Recorder, PracticeQueue, CardReview, ExamBuilder, StudyStatsCalc }
export { MISTAKE_STAGES } from './recorder'
export { readinessLabel, toHomePlanItem } from './overview'
export { combinedPlan, dueTitle } from './home'
export type { AnswerInput, FeedbackKind, FeedbackLine, GradeLang, GradeOptions, GradeResult, GradeStatus } from '@engine/grading'
export { Input, answerInputIsEmpty, canonicalInput, correctAnswerMarkdown, grade, instantiateTemplate } from '@engine/grading'

// MARK: - Aprendizaje guiado (LearningController)
//
// Flujo de un concepto: explicación → `acknowledgeExplanation` (da la primera pregunta) → el estudiante responde → `grade` →
// `recordCheck`. Hacen falta DOS aciertos independientes al primer intento, sin pistas ni ver la solución, con preguntas
// distintas (uno si el concepto solo tiene preguntas abiertas). Un fallo, una pista o ver la solución → `reteach` con la
// reexplicación en `remediation`; al leerla, `acknowledgeExplanation` da una pregunta NUEVA. Si no quedan preguntas,
// `prepareMore` = true (pedir más con `study.prepareMore`) o `continueWithoutChecks`.

/** Aciertos independientes que pide un concepto con preguntas que Aula corrige sola. */
export const REQUIRED_SUCCESSES = LearningController.requiredSuccesses

/** Los conceptos de la lección de una habilidad, en orden. */
export function lessonConcepts(skill: Skill): LearningConcept[] {
  return LearningController.concepts(skill)
}

/** El recorrido de la lección guiada: fase, aciertos, si está desbloqueado y si conviene preparar más preguntas. */
export function learningOverview(skill: Skill, progress: SkillProgress | undefined): ConceptView[] {
  return LearningController.overview(skill, progress)
}

/** Fase de un concepto (explicación, comprobación, reexplicación, superado o sin preguntas). */
export function conceptPhase(concept: LearningConcept, progress: SkillProgress | undefined): LearningPhase {
  return LearningController.status(concept, progress)
}

/** ¿Cómo se comprueba? objective · selfAssessed · none. */
export function conceptCheckKind(concept: LearningConcept, skill: Skill): CheckKind {
  return LearningController.checkKind(concept, skill)
}

/** Aciertos que pide este concepto (2, o 1 si solo tiene preguntas abiertas). */
export function requiredSuccesses(concept: LearningConcept): number {
  return LearningController.requiredSuccessesFor(concept)
}

/** ¿Todos los conceptos de la lección guiada superados? */
export function isSkillMasteredGuided(skill: Skill, progress: SkillProgress | undefined): boolean {
  return LearningController.isMastered(skill, progress)
}

/** La pregunta que toca (la activa si sigue valiendo; si no, una nueva del concepto). undefined si no quedan. */
export function nextCheck(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): Exercise | undefined {
  return LearningController.nextCheck(concept, skill, progress, opts)
}

/** «Ya lo leí»: tras la explicación (o la reexplicación) pasa a comprobar y prepara la pregunta. */
export function acknowledgeExplanation(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): LearningStep {
  return LearningController.acknowledgeExplanation(concept, skill, progress, opts)
}

/** Prepara (y guarda como activa) la pregunta que toca; al reabrir la lección vuelve la misma sin responder. */
export function prepareCheck(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, opts: CheckOptions = {}): LearningStep {
  return LearningController.prepareCheck(concept, skill, progress, opts)
}

/** Anota la respuesta a la pregunta activa. Una respuesta ilegible (`invalid`) o pendiente de la IA no cuenta. */
export function recordCheck(concept: LearningConcept, skill: Skill, exercise: Exercise, result: GradeResult, use: CheckUse, progress: SkillProgress | undefined): LearningStep {
  return LearningController.recordCheck(concept, skill, exercise, result, use, progress)
}

/** Pedir una pista o ver la solución invalida la pregunta en el acto (aunque aún no se haya respondido). */
export function recordAssistance(concept: LearningConcept, skill: Skill, exercise: Exercise, use: Pick<CheckUse, 'hints' | 'revealed'>, progress: SkillProgress | undefined): LearningStep {
  return LearningController.recordAssistance(concept, skill, exercise, use, progress)
}

/** Sin preguntas y sin poder preparar más: el concepto queda «sin comprobar» y la lección sigue. */
export function continueWithoutChecks(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined): LearningStep & { applied: boolean } {
  return LearningController.continueWithoutChecks(concept, skill, progress)
}

/** La reexplicación tras un error: feedback, pistas, solución comprobada y otro ejemplo resuelto. */
export function remediationBlocks(concept: LearningConcept, skill: Skill, progress: SkillProgress | undefined, attempts: readonly Attempt[] = [], lang?: StudyLang): Block[] {
  return LearningController.remediationBlocks(concept, skill, progress, attempts, lang)
}

/** Huella de una pregunta (enunciado + respuesta, sin ids ni metadatos): copiar una pregunta no fabrica evidencia. */
export function exerciseFingerprint(exercise: Exercise): string {
  return LearningController.fingerprint(exercise)
}

// MARK: - Práctica (PracticeQueue)

/** Arma una sesión: un tema o «lo más flojo» (adaptativas e intercaladas), los errores que tocan o un diagnóstico. */
export function buildPractice(pack: Pack, skills: SkillsInput, progress: StudyProgress, request: PracticeRequest, opts: PracticeOptions = {}): Exercise[] {
  return PracticeQueue.build(pack, skills, progress, request, opts)
}

/** Sesión adaptativa en marcha: el ejercicio que conviene ahora en el hueco `slot` (tras anotar la respuesta). undefined = dejar el que había. */
export function refillPractice(slot: number, session: readonly Exercise[], pack: Pack, skills: SkillsInput, progress: StudyProgress, request: PracticeRequest, opts: PracticeOptions = {}): Exercise | undefined {
  return PracticeQueue.refill(slot, session, pack, skills, progress, request, opts)
}

/** ¿Se adapta sobre la marcha? (tema y «lo más flojo» sí; errores y diagnóstico no). */
export function isAdaptivePractice(request: PracticeRequest): boolean {
  return PracticeQueue.isAdaptive(request)
}

/** Las 3 habilidades más flojas entre las practicadas (completadas con las no vistas, en el orden del curso). */
export function weakestSkills(pack: Pack, skills: SkillsInput, progress: StudyProgress, now: Date): ItemID[] {
  return PracticeQueue.weakest(pack, skills, progress, now)
}

// MARK: - Tarjetas (CardReview, FSRS)

/** Tarjetas que tocan hoy (vencidas, de la más atrasada a la más reciente) y algunas nuevas de lo ya estudiado. */
export function dueCards(pack: Pack, skills: SkillsInput, progress: StudyProgress, opts: DueCardOptions = {}): DueCard[] {
  return CardReview.queue(pack, skills, progress, opts)
}

/** Número de tarjetas vencidas (sin tope de sesión). */
export function dueCardCount(pack: Pack, skills: SkillsInput, progress: StudyProgress, now: Date): number {
  return LearnBridge.dueCardCount(pack, skills, progress, now)
}

/**
 * Califica una tarjeta (1 otra vez · 2 difícil · 3 bien · 4 fácil): FSRS, dominio de su habilidad como evidencia débil (30 %,
 * sin sumar intentos y con techo del 70 %), minutos del día y XP. Devuelve el progreso nuevo.
 */
export function reviewCard(progress: StudyProgress, cardId: ItemID, rating: Rating, now: Date, opts: ReviewCardOptions = {}): StudyProgress {
  return CardReview.rate(progress, cardId, rating, now, opts)
}

/** «Otra vez 1 min · Difícil 6 min · Bien 1 día · Fácil 4 días». */
export function cardIntervals(progress: StudyProgress, cardId: ItemID, now: Date, lang?: StudyLang): Record<Rating, string> {
  return CardReview.preview(ownValue(progress.cards, cardId), now, lang)
}

/** Texto de una tarjeta cloze con los huecos ocultos («**[…]**») o resueltos. */
export function clozeText(front: string, revealed: boolean): string {
  return CardReview.clozeText(front, revealed)
}

// MARK: - Simulacros (ExamBuilder)

/** El modelo de examen del curso (o uno estándar: una sección por unidad según el peso de sus habilidades). */
export function examBlueprint(pack: Pack): ExamBlueprint {
  return ExamBuilder.blueprint(pack)
}

/** Arma un simulacro cronometrado por secciones (sin repetir lo de simulacros anteriores si hay alternativa). */
export function buildExam(pack: Pack, skills: SkillsInput, progress: StudyProgress, opts: BuildExamOptions = {}): ExamPlan | undefined {
  return ExamBuilder.build(pack, skills, progress, opts)
}

/** El ejercicio concreto de un elemento del simulacro (las plantillas, instanciadas con su semilla). */
export function examExercise(item: ExamRunItem, skills: SkillsInput): Exercise | undefined {
  return ExamBuilder.exercise(item, skills)
}

/** Los ejercicios de todo el simulacro, por id del elemento. */
export function examExercises(run: ExamRun, skills: SkillsInput): Record<string, Exercise> {
  return ExamBuilder.exercises(run, skills)
}

/**
 * Corrige el simulacro entregado (lo no contestado vale 0; lo que no se pudo construir no cuenta en el total). `exactText`: la
 * corrección del curso (`isLanguageCourse(pack)`: huecos y respuestas cortas exactos).
 */
export function gradeExam(run: ExamRun, exercises: Readonly<Record<string, Exercise>>, inputs: Readonly<Record<string, AnswerInput>>, now: Date,
  opts: { activeSeconds?: number; exactText?: boolean } = {}): ExamGrade {
  return ExamBuilder.grade(run, exercises, inputs, now, opts.activeSeconds, opts.exactText ? { exactText: true } : {})
}

/** Informe: nota, secciones, habilidades y qué repasar. */
export function examReport(graded: ExamGrade, run: ExamRun, pack: Pack, lang?: StudyLang): ExamReport {
  return ExamBuilder.report(graded, run, pack, lang)
}

/** Guarda la entrega: cada pregunta como intento de examen (dominio y cuaderno de errores), el resultado, y cierra el simulacro. */
export function recordExam(progress: StudyProgress, graded: ExamGrade, run: ExamRun, exercises: Readonly<Record<string, Exercise>>,
  opts: { now: Date; inputs?: Readonly<Record<string, AnswerInput>>; secondsByItem?: Readonly<Record<string, number>> }): StudyProgress {
  return ExamBuilder.record(progress, graded, run, exercises, opts)
}

// MARK: - Registro (Recorder) y cuaderno de errores

/** Anota un intento: dominio (Beta con olvido), cuaderno de errores (repasos a 1, 3, 7, 16 y 35 días), día y XP. */
export function recordAttempt(progress: StudyProgress, exercise: Exercise, attempt: AttemptRecord, now: Date): StudyProgress {
  return Recorder.record(progress, exercise, attempt, now)
}

/** Suma tiempo de estudio al día (lectura de lecciones, simulacros…). */
export function recordStudyTime(progress: StudyProgress, seconds: number, now: Date): StudyProgress {
  return Recorder.addTime(progress, seconds, now)
}

/** Lección terminada (+20 XP). */
export function completeLesson(progress: StudyProgress, skillId: ItemID, now: Date): StudyProgress {
  return Recorder.completeLesson(progress, skillId, now)
}

/** El progreso con el de una habilidad sustituido (para guardar los pasos del aprendizaje guiado). */
export function withSkillProgress(progress: StudyProgress, skillId: ItemID, skill: SkillProgress): StudyProgress {
  return Recorder.withSkill(progress, skillId, skill)
}

/** Errores que toca repasar (con `skills`, solo los de ejercicios que aún existen). */
export function dueMistakes(progress: StudyProgress, now: Date, skills?: SkillsInput): MistakeEntry[] {
  return Recorder.dueMistakes(progress, now, skills)
}

/** El cuaderno de errores sin resolver, con su ejercicio, de lo que toca antes a lo que toca después. */
export function mistakesNotebook(progress: StudyProgress, skills: SkillsInput, now: Date): MistakeView[] {
  return Recorder.notebook(progress, skills, now)
}

/** Texto breve de una respuesta para el cuaderno de errores («x = 3», «b, c», «1 → a · 2 → c»). */
export function answerSummary(input: AnswerInput, exercise?: Exercise, lang?: StudyLang): string | undefined {
  return Recorder.inputSummary(input, exercise, lang)
}

// MARK: - Dominio, nota estimada, plan y estadísticas

/** Dominio (0…1) de una habilidad con el olvido aplicado; undefined si nunca se intentó. */
export function skillMastery(progress: SkillProgress | undefined, now: Date): number | undefined {
  return LearnBridge.probability(progress, now)
}

/** Nota estimada del examen con su intervalo de credibilidad del 80 % y la cobertura. */
export function readiness(pack: Pack, progress: StudyProgress, now: Date, lang?: StudyLang): Readiness {
  return LearnBridge.readiness(pack, progress, now, lang)
}

/** Plan de hoy del curso (puntos por minuto, prerrequisitos, repasos, errores, simulacro y repaso final). */
export function dailyPlan(pack: Pack, skills: SkillsInput, progress: StudyProgress, minutes: number, now: Date, lang?: StudyLang): PlanItem[] {
  return LearnBridge.dailyPlan(pack, skills, progress, minutes, now, lang)
}

/** Minutos por día, racha, semana, precisión… de uno o varios cursos juntos. */
export function studyStats(progress: StudyProgress | readonly StudyProgress[], now: Date, days = 14): StudyStatsSummary {
  return StudyStatsCalc.summary(Array.isArray(progress) ? progress : [progress as StudyProgress], now, days)
}

/** La vista de un curso: nota estimada, plan, dominio por habilidad, tarjetas y errores pendientes. */
export function courseOverview(pack: Pack, skills: SkillsInput, progress: StudyProgress, now: Date, lang?: StudyLang): CourseOverview {
  return buildCourseOverview(pack, skills, progress, now, lang)
}

/** El resumen de Inicio: plan combinado de todos los cursos, racha, exámenes, cursos y próximos eventos. */
export function homeSummary(packs: readonly HomeCourseInput[], progressByPack: Readonly<Record<ItemID, StudyProgress>>, calendarEvents: readonly HomeEvent[],
  settings: HomeSettings, now: Date): HomeSummary {
  return buildHomeSummary(packs, progressByPack, calendarEvents, settings, now)
}

/**
 * Datos de Estadísticas: 84 días (fechas locales) que terminan hoy, precisión por tema, niveles de dominio por semana y nota
 * estimada día a día reconstruidos repasando los intentos; el último punto es el progreso real. Los cursos en creación no salen.
 */
export function statsData(courses: readonly StatsCourseInput[], now: Date, lang?: StudyLang): StatsData {
  return buildStatsData(courses, now, lang)
}
