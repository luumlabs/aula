// Progreso del estudiante por curso (port de StudyModel/Progress.swift y LessonLearningMode.swift).
import { IDs } from '@engine/base/ids'
import type { JSONObject, JSONValue } from '@engine/base/json'
import {
  bool, bounded, clamp, date, dict, encodeU64, flexStr, int, isObj, list, nested, nowISO, num, pickKeys, prune, put, setOwn, str, strictStrings, vStr, vU64,
  SchemaError, type ISODate, type ItemID, type Obj, type U64
} from './coding'
import { blocksField, encodeBlock, type Block } from './blocks'
import { decodeExercise, encodeExercise, type Exercise } from './exercises'

// MARK: Modo de las lecciones

export const LESSON_LEARNING_MODES = ['guided', 'explore', 'reading'] as const
/** Cómo enseña un curso. Leer y explorar nunca certifican el dominio guiado. */
export type LessonLearningMode = (typeof LESSON_LEARNING_MODES)[number]

export const LEARNING_PHASES = ['explanation', 'check', 'reteach', 'mastered', 'needsPractice'] as const
export type LearningPhase = (typeof LEARNING_PHASES)[number]

/** Cómo se dio por superado un concepto guiado sin dos aciertos. */
export const LEARNING_PASS_WITHOUT = ['explanation', 'unchecked'] as const
export type LearningPassWithoutChecks = (typeof LEARNING_PASS_WITHOUT)[number]

/** Evidencia de los conceptos guiados (independiente de `lessonDone` y del dominio estadístico). */
export interface LearningConceptProgress {
  revision: string
  phase: LearningPhase
  successfulChecks: string[]
  /** Revisiones de las preguntas detrás de los aciertos, para conservar la evidencia al ampliar el banco. */
  successfulSources: Record<string, string>
  attemptedChecks: string[]
  remediation: Block[]
  lastExercise?: Exercise
  /** La misma pregunta sin responder vuelve al reabrir la lección. */
  activeExercise?: Exercise
  activeSourceRevision?: string
  activeInput?: JSONValue
  /** Se superó sin dos aciertos: `explanation` = sin preguntas; `unchecked` = se acabaron y el estudiante siguió. */
  passedWithout?: LearningPassWithoutChecks
}

/** Dominio de una habilidad (posterior Beta con olvido). */
export interface SkillProgress {
  alpha: number
  beta: number
  attempts: number
  lastPracticed?: ISODate
  lastCorrect?: ISODate
  streak: number
  /** Paso actual de la lección y si se terminó. */
  lessonStep: number
  lessonDone: boolean
  lessonDoneAt?: ISODate
  learning: Record<string, LearningConceptProgress>
}

/** Estado de repaso espaciado de una tarjeta. */
export interface CardProgress {
  /** new | learning | review | relearning */
  phase: string
  due: ISODate
  stability: number
  difficulty: number
  reps: number
  lapses: number
  lastReview?: ISODate
  /** Paso de (re)aprendizaje en curso. */
  step: number
}

export const ATTEMPT_KINDS = ['lesson', 'practice', 'review', 'diagnostic', 'exam'] as const
export type AttemptKind = (typeof ATTEMPT_KINDS)[number]

export interface Attempt {
  id: string
  /** Para plantillas: "plantilla#semilla". */
  exerciseID: string
  skill: ItemID
  date: ISODate
  /** 0…1 */
  credit: number
  level: number
  hints: number
  seconds?: number
  mode: AttemptKind
  /** Lo que escribió (texto), para el cuaderno de errores. */
  input?: string
}

/** Cuaderno de errores: ejercicios que fallaste, para volver a verlos con repaso espaciado. */
export interface MistakeEntry {
  /** exerciseID (con semilla si viene de plantilla). */
  id: string
  exerciseID: ItemID
  templateID?: ItemID
  seed?: U64
  skill: ItemID
  firstSeen: ISODate
  lastSeen: ISODate
  count: number
  lastInput?: string
  /** Explicación del error que se mostró. */
  why?: string
  due: ISODate
  /** Etapa de repaso (0 = repetir pronto, crece con cada acierto). */
  stage: number
  resolved: boolean
}

export interface ExamItemResult { exerciseID: string; skill: ItemID; credit: number; points: number; seconds?: number }

export interface ExamResult {
  id: string
  date: ISODate
  /** "mock" | "diagnostic" */
  kind: string
  scorePoints: number
  totalPoints: number
  durationSeconds: number
  items: ExamItemResult[]
}

/** Simulacro en curso (se guarda para poder continuar si cierras la app). */
export interface ExamRunItem {
  exerciseID: string
  skill: ItemID
  templateID?: ItemID
  seed?: U64
  points: number
  sectionTitle?: string
  /** Respuesta guardada (forma depende del tipo). */
  answer?: JSONValue
  flagged: boolean
  seconds: number
}

export interface ExamRun {
  id: string
  startedAt: ISODate
  durationMinutes: number
  items: ExamRunItem[]
  currentIndex: number
  kind: string
}

export interface DayRecord {
  /** yyyy-MM-dd (hora local) */
  day: string
  minutes: number
  attempts: number
  correct: number
}

export interface StudySettings {
  lessonMode: LessonLearningMode
  dailyMinutes: number
  /** Traducciones breves de enunciados en otro idioma. */
  showGloss: boolean
  decimalComma: boolean
  soundEffects: boolean
  /** undefined = sin recordatorio. */
  reminderHour?: number
}

export interface StudyProgress {
  schema: number
  skills: Record<ItemID, SkillProgress>
  cards: Record<ItemID, CardProgress>
  /** Últimos intentos (se conservan los más recientes; el resumen vive en `skills`). */
  attempts: Attempt[]
  mistakes: MistakeEntry[]
  exams: ExamResult[]
  days: DayRecord[]
  examRun?: ExamRun
  diagnosticDone: boolean
  settings: StudySettings
  /** Notas del estudiante por habilidad/tarjeta. */
  notes: Record<string, string>
  xp: number
}

export const MAX_ATTEMPTS = 2500

// MARK: Leer

/** Enumeración con `init(from:)` propio: cualquier valor que no se entienda es `fallback`. */
function lenientEnum<T extends string>(c: Obj, k: string, values: readonly T[], fallback: T): T {
  const v = c[k]
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback
}

const intClamp = (c: Obj, k: string, def: number, lo: number, hi: number): number => clamp(int(c, k) ?? def, lo, hi)
const numClamp = (c: Obj, k: string, def: number, lo: number, hi: number, fb: number): number => clamp(num(c, k) ?? def, lo, hi, fb)

export function decodeLearningConcept(raw: unknown, d = 0): LearningConceptProgress | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const sources: Record<string, string> = {}
  if (isObj(c.successfulSources) && Object.values(c.successfulSources).every((v) => typeof v === 'string')) {
    for (const [k, v] of Object.entries(c.successfulSources)) setOwn(sources, k, v as string)
  }
  const passed = c.passedWithout
  return prune({
    revision: str(c, 'revision') ?? '', phase: lenientEnum(c, 'phase', LEARNING_PHASES, 'explanation'),
    successfulChecks: (strictStrings(c, 'successfulChecks') ?? []).slice(0, 2), successfulSources: sources,
    attemptedChecks: strictStrings(c, 'attemptedChecks') ?? [], remediation: blocksField(c, 'remediation', d).slice(0, 24),
    lastExercise: nested(c, 'lastExercise', decodeExercise, d), activeExercise: nested(c, 'activeExercise', decodeExercise, d),
    activeSourceRevision: str(c, 'activeSourceRevision'), activeInput: c.activeInput === undefined || c.activeInput === null ? undefined : bounded(c.activeInput, d + 1),
    // un valor desconocido no da el concepto por superado
    passedWithout: typeof passed === 'string' && (LEARNING_PASS_WITHOUT as readonly string[]).includes(passed) ? (passed as LearningPassWithoutChecks) : undefined
  })
}

export function decodeSkillProgress(raw: unknown, d = 0): SkillProgress | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    alpha: num(c, 'alpha') ?? 1, beta: num(c, 'beta') ?? 1, lastPracticed: date(c, 'lastPracticed'), lastCorrect: date(c, 'lastCorrect'),
    // contadores de un archivo dañado: un paso de lección negativo cerraba el reproductor y Int.max desbordaba al sumar
    attempts: intClamp(c, 'attempts', 0, 0, 1_000_000_000), streak: intClamp(c, 'streak', 0, 0, 1_000_000_000),
    lessonStep: intClamp(c, 'lessonStep', 0, 0, 1_000_000), lessonDone: bool(c, 'lessonDone') ?? false, lessonDoneAt: date(c, 'lessonDoneAt'),
    learning: dict(c, 'learning', decodeLearningConcept, d)
  })
}

export function decodeCardProgress(raw: unknown): CardProgress | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    phase: str(c, 'phase') ?? 'new', due: date(c, 'due') ?? nowISO(), stability: num(c, 'stability') ?? 0, difficulty: num(c, 'difficulty') ?? 0,
    lastReview: date(c, 'lastReview'), reps: intClamp(c, 'reps', 0, 0, 1_000_000), lapses: intClamp(c, 'lapses', 0, 0, 1_000_000), step: intClamp(c, 'step', 0, 0, 1_000)
  })
}

export function decodeAttempt(raw: unknown): Attempt | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? IDs.short(8), exerciseID: flexStr(c, 'exerciseID') ?? '', skill: flexStr(c, 'skill') ?? '', date: date(c, 'date') ?? nowISO(),
    credit: numClamp(c, 'credit', 0, 0, 1, 0), level: int(c, 'level') ?? 2, hints: intClamp(c, 'hints', 0, 0, 1_000), seconds: num(c, 'seconds'),
    mode: lenientEnum(c, 'mode', ATTEMPT_KINDS, 'practice'), input: str(c, 'input')
  })
}

export function decodeMistake(raw: unknown): MistakeEntry | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const id = flexStr(c, 'id') ?? ''
  return prune({
    id, exerciseID: flexStr(c, 'exerciseID') ?? id, templateID: flexStr(c, 'templateID'), seed: vU64(c.seed), skill: flexStr(c, 'skill') ?? '',
    firstSeen: date(c, 'firstSeen') ?? nowISO(), lastSeen: date(c, 'lastSeen') ?? nowISO(), count: intClamp(c, 'count', 1, 0, 1_000_000),
    lastInput: str(c, 'lastInput'), why: str(c, 'why'),
    // la etapa indexa la tabla de intervalos de repaso: negativa (archivo dañado) se salía del arreglo
    due: date(c, 'due') ?? nowISO(), stage: intClamp(c, 'stage', 0, 0, 100), resolved: bool(c, 'resolved') ?? false
  })
}

function decodeExamItemResult(raw: unknown): ExamItemResult | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    exerciseID: flexStr(c, 'exerciseID') ?? '', skill: flexStr(c, 'skill') ?? '', credit: numClamp(c, 'credit', 0, 0, 1, 0),
    points: numClamp(c, 'points', 1, 0, 1e6, 1), seconds: num(c, 'seconds')
  })
}

export function decodeExamResult(raw: unknown, d = 0): ExamResult | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return {
    id: flexStr(c, 'id') ?? IDs.short(6), date: date(c, 'date') ?? nowISO(), kind: str(c, 'kind') ?? 'mock',
    scorePoints: numClamp(c, 'scorePoints', 0, 0, 1e12, 0), totalPoints: numClamp(c, 'totalPoints', 0, 0, 1e12, 0),
    durationSeconds: numClamp(c, 'durationSeconds', 0, 0, 1e7, 0), items: list(c, 'items', decodeExamItemResult, d)
  }
}

function decodeExamRunItem(raw: unknown, d: number): ExamRunItem | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    exerciseID: flexStr(c, 'exerciseID') ?? '', skill: flexStr(c, 'skill') ?? '', templateID: flexStr(c, 'templateID'), seed: vU64(c.seed),
    points: numClamp(c, 'points', 1, 0, 1e6, 1), sectionTitle: str(c, 'sectionTitle'),
    answer: c.answer === undefined || c.answer === null ? undefined : bounded(c.answer, d + 1), flagged: bool(c, 'flagged') ?? false,
    seconds: numClamp(c, 'seconds', 0, 0, 1e7, 0)
  })
}

export function decodeExamRun(raw: unknown, d = 0): ExamRun | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return {
    id: flexStr(c, 'id') ?? IDs.short(6), startedAt: date(c, 'startedAt') ?? nowISO(), items: list(c, 'items', decodeExamRunItem, d), kind: str(c, 'kind') ?? 'mock',
    // un índice negativo o una duración de Int.max (archivo dañado) cerraban la pantalla del simulacro
    durationMinutes: intClamp(c, 'durationMinutes', 60, 0, 10_000), currentIndex: intClamp(c, 'currentIndex', 0, 0, 100_000)
  }
}

function decodeDayRecord(raw: unknown): DayRecord | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return {
    day: flexStr(c, 'day') ?? '', minutes: numClamp(c, 'minutes', 0, 0, 1e6, 0), attempts: intClamp(c, 'attempts', 0, 0, 1_000_000_000),
    correct: numClamp(c, 'correct', 0, 0, 1e9, 0)
  }
}

export function defaultStudySettings(lessonMode: LessonLearningMode = 'guided'): StudySettings {
  return { lessonMode, dailyMinutes: 45, showGloss: true, decimalComma: false, soundEffects: false }
}

export function decodeStudySettings(raw: unknown): StudySettings | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    dailyMinutes: intClamp(c, 'dailyMinutes', 45, 0, 1_440), showGloss: bool(c, 'showGloss') ?? true, decimalComma: bool(c, 'decimalComma') ?? false,
    soundEffects: bool(c, 'soundEffects') ?? false, reminderHour: int(c, 'reminderHour'),
    // un progreso guardado sin `lessonMode` es de un curso de antes del modo guiado: sigue como estaba («Explorar»)
    lessonMode: 'lessonMode' in c ? (c.lessonMode === null ? 'guided' : lenientEnum(c, 'lessonMode', LESSON_LEARNING_MODES, 'guided')) : 'explore'
  })
}

/** Progreso vacío de un curso nuevo (modo guiado). */
export function emptyProgress(): StudyProgress {
  return { schema: 1, skills: {}, cards: {}, attempts: [], mistakes: [], exams: [], days: [], diagnosticDone: false, settings: defaultStudySettings(), notes: {}, xp: 0 }
}

/** Lee `progress.json` como `StudyProgress.init(from:)`. Lanza si no es un objeto. */
export function decodeProgress(raw: unknown, d = 0): StudyProgress {
  if (!isObj(raw)) throw new SchemaError('progress.json no es un objeto JSON')
  const c: Obj = raw
  const notes: Record<string, string> = {}
  if (isObj(c.notes)) for (const [k, v] of Object.entries(c.notes)) { const s = vStr(v); if (s !== undefined) setOwn(notes, k, s) }
  return prune({
    schema: int(c, 'schema') ?? 1, skills: dict(c, 'skills', decodeSkillProgress, d), cards: dict(c, 'cards', decodeCardProgress, d),
    attempts: list(c, 'attempts', decodeAttempt, d), mistakes: list(c, 'mistakes', decodeMistake, d), exams: list(c, 'exams', decodeExamResult, d),
    days: list(c, 'days', decodeDayRecord, d), examRun: nested(c, 'examRun', decodeExamRun, d), diagnosticDone: bool(c, 'diagnosticDone') ?? false,
    settings: nested(c, 'settings', decodeStudySettings, d) ?? defaultStudySettings('explore'), notes,
    xp: clamp(int(c, 'xp') ?? 0, 0, 1_000_000_000_000)
  })
}

// MARK: Escribir

export function encodeLearningConcept(v: LearningConceptProgress): JSONObject {
  const out = pickKeys(v, ['revision', 'phase', 'successfulChecks', 'attemptedChecks', 'activeSourceRevision', 'passedWithout'])
  out.successfulSources = { ...v.successfulSources }
  out.remediation = v.remediation.map(encodeBlock)
  if (v.lastExercise) out.lastExercise = encodeExercise(v.lastExercise)
  if (v.activeExercise) out.activeExercise = encodeExercise(v.activeExercise)
  if (v.activeInput !== undefined) out.activeInput = v.activeInput
  return out
}

export function encodeSkillProgress(v: SkillProgress): JSONObject {
  const out = pickKeys(v, ['alpha', 'beta', 'attempts', 'lastPracticed', 'lastCorrect', 'streak', 'lessonStep', 'lessonDone', 'lessonDoneAt'])
  out.learning = Object.fromEntries(Object.entries(v.learning).map(([k, x]) => [k, encodeLearningConcept(x)]))
  return out
}

export const encodeCardProgress = (v: CardProgress): JSONObject => pickKeys(v, ['phase', 'due', 'stability', 'difficulty', 'reps', 'lapses', 'lastReview', 'step'])
export const encodeAttempt = (v: Attempt): JSONObject => pickKeys(v, ['id', 'exerciseID', 'skill', 'date', 'credit', 'level', 'hints', 'seconds', 'mode', 'input'])

export function encodeMistake(v: MistakeEntry): JSONObject {
  const out = pickKeys(v, ['id', 'exerciseID', 'templateID', 'skill', 'firstSeen', 'lastSeen', 'count', 'lastInput', 'why', 'due', 'stage', 'resolved'])
  if (v.seed !== undefined) put(out, 'seed', encodeU64(v.seed))
  return out
}

export function encodeExamResult(v: ExamResult): JSONObject {
  const out = pickKeys(v, ['id', 'date', 'kind', 'scorePoints', 'totalPoints', 'durationSeconds'])
  out.items = v.items.map((i) => pickKeys(i, ['exerciseID', 'skill', 'credit', 'points', 'seconds']))
  return out
}

export function encodeExamRun(v: ExamRun): JSONObject {
  const out = pickKeys(v, ['id', 'startedAt', 'durationMinutes', 'currentIndex', 'kind'])
  out.items = v.items.map((i) => {
    const o = pickKeys(i, ['exerciseID', 'skill', 'templateID', 'points', 'sectionTitle', 'flagged', 'seconds'])
    if (i.seed !== undefined) put(o, 'seed', encodeU64(i.seed))
    if (i.answer !== undefined) o.answer = i.answer
    return o
  })
  return out
}

export const encodeStudySettings = (v: StudySettings): JSONObject => pickKeys(v, ['lessonMode', 'dailyMinutes', 'showGloss', 'decimalComma', 'soundEffects', 'reminderHour'])

/** El progreso como lo escribe Swift (`progress.json`). */
export function encodeProgress(p: StudyProgress): JSONObject {
  const out: JSONObject = { schema: p.schema, diagnosticDone: p.diagnosticDone, xp: p.xp }
  out.skills = Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, encodeSkillProgress(v)]))
  out.cards = Object.fromEntries(Object.entries(p.cards).map(([k, v]) => [k, encodeCardProgress(v)]))
  out.attempts = p.attempts.map(encodeAttempt)
  out.mistakes = p.mistakes.map(encodeMistake)
  out.exams = p.exams.map(encodeExamResult)
  out.days = p.days.map((x) => pickKeys(x, ['day', 'minutes', 'attempts', 'correct']))
  if (p.examRun) out.examRun = encodeExamRun(p.examRun)
  out.settings = encodeStudySettings(p.settings)
  out.notes = { ...p.notes }
  return out
}

// MARK: Ayudas

/** Conserva solo los `MAX_ATTEMPTS` intentos más recientes (en su sitio). */
export function trimAttempts(p: StudyProgress): void {
  if (p.attempts.length > MAX_ATTEMPTS) p.attempts.splice(0, p.attempts.length - MAX_ATTEMPTS)
}

/** Nota de 0 a 1 (siempre finita). */
export function examPercent(r: Pick<ExamResult, 'scorePoints' | 'totalPoints'>): number {
  if (!(r.totalPoints > 0) || !Number.isFinite(r.totalPoints) || !Number.isFinite(r.scorePoints)) return 0
  return clamp(r.scorePoints / r.totalPoints, 0, 1, 0)
}

export function makeSkillProgress(p: Partial<SkillProgress> = {}): SkillProgress {
  return prune({ alpha: 1, beta: 1, attempts: 0, streak: 0, lessonStep: 0, lessonDone: false, learning: {}, ...p })
}

export function makeAttempt(p: Partial<Attempt> & { exerciseID: string; skill: ItemID; credit: number }): Attempt {
  return prune({ id: IDs.short(8), date: nowISO(), level: 2, hints: 0, mode: 'practice' as AttemptKind, ...p })
}

export function makeLearningConcept(p: Partial<LearningConceptProgress> = {}): LearningConceptProgress {
  return prune({ revision: '', phase: 'explanation' as LearningPhase, successfulChecks: [], successfulSources: {}, attemptedChecks: [], remediation: [], ...p })
}
