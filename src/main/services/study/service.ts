// Servicio de estudio del proceso principal: une el almacén de cursos, el calendario, los ajustes y la IA con el motor
// `@engine/study`. Cada escritura del progreso va con cerrojo (`updateProgress`) y devuelve un resumen de lo que cambió.
import { join } from 'node:path'
import { IDs } from '@engine/base/ids'
import {
  CardReview, LearnBridge, Recorder, StudyStatsCalc, answerSummary, buildExam, completeLesson as completeLessonOf, courseOverview, examExercises, examReport, gradeExam,
  homeSummary, instantiateTemplate, learningContentRequest, lessonConcepts, recordAttempt as recordAttemptOf, recordExam, recordStudyTime, reviewCard as reviewCardOf,
  statsData, type HomeCourseInput, type StudyLang
} from '@engine/study'
import { decodeAnswerInput, isLanguageCourse, type AnswerInput, type GradeResult } from '@engine/grading'
import {
  decodeExercise, decodeLearningConcept, makeSkillProgress, type Exercise, type ItemID, type LearningConceptProgress, type Skill, type StudyProgress
} from '@shared/schema'
import type { CourseOverview } from '@shared/ipc/course-view'
import type { HomeEvent, HomeSummary } from '@shared/ipc/home'
import type { StatsData } from '@shared/ipc/stats'
import type {
  GradeOpenArgs, GradeOpenResult, PrepareMoreArgs, PrepareMoreResult, RecordAttemptArgs, ReviewCardArgs, SaveLearningArgs, StartExamResult, StudyProgressSummary,
  SubmitExamArgs, SubmitExamResult
} from '@shared/ipc/study'
import type { CalendarEvent } from '@engine/calendar'
import { tr } from '@shared/ai/i18n'
import { AulaError } from '../errors'
import { log } from '../log'
import { writeJSONAtomic } from '../fs'
import { getSettings } from '../settings'
import { uiLanguage } from '../settings/uiLanguage'
import { allProgress, loadAllCourses, loadCourse, requireStore, updateProgress, type CourseData } from './courses'
import { gradeOpenAnswer } from './open-grader'

// MARK: Ajustes y fuentes externas (opcionales)

/** Idioma de las frases del motor: el único idioma de la interfaz (`uiLanguage`). */
export function studyLang(): StudyLang {
  return uiLanguage()
}

type EventsSource = (from: Date, to: Date) => Promise<HomeEvent[]>
type AIReadySource = () => Promise<boolean>

let eventsSource: EventsSource | null = null
let aiReadySource: AIReadySource | null = null

/** Pruebas: de dónde salen los eventos del calendario y si hay IA. */
export function setStudySources(o: { events?: EventsSource | null; aiReady?: AIReadySource | null }): void {
  if (o.events !== undefined) eventsSource = o.events
  if (o.aiReady !== undefined) aiReadySource = o.aiReady
}

function homeKind(kind: CalendarEvent['kind']): HomeEvent['kind'] {
  switch (kind) {
    case 'exam': case 'quiz': return 'exam'
    case 'assignment': return 'assignment'
    case 'lecture': return 'class'
    case 'study': return 'study'
    default: return 'event'
  }
}

/** Un evento del calendario como lo pinta Inicio. */
export function toHomeEvent(e: CalendarEvent): HomeEvent {
  const out: HomeEvent = {
    id: e.occurrenceKey ? `${e.seriesID ?? e.id}#${e.occurrenceKey}` : e.id, title: e.title, start: e.start.toISOString(), end: e.end ? e.end.toISOString() : null,
    allDay: e.allDay, kind: homeKind(e.kind), courseId: e.packID ?? null
  }
  if (e.task) out.done = e.task.done
  return out
}

async function calendarEvents(from: Date, to: Date): Promise<HomeEvent[]> {
  if (eventsSource) return eventsSource(from, to)
  try {
    // el calendario es opcional: si su servicio no está o falla, Inicio sale sin eventos
    const cal = await import('../calendar')
    const snap = await cal.calendarService().events(from, to)
    return snap.events.map(toHomeEvent)
  } catch (err) {
    log.warn('Inicio sin calendario', err)
    return []
  }
}

async function aiReady(): Promise<boolean> {
  if (aiReadySource) return aiReadySource()
  try {
    const ai = await import('../ai')
    const status = await Promise.race([ai.aiStatus(), new Promise<null>((r) => setTimeout(() => r(null), 2500))])
    return status?.ready ?? false
  } catch { return false }
}

// MARK: Vistas

export function overview(packId: ItemID, now = new Date()): CourseOverview {
  const c = loadCourse(packId)
  return courseOverview(c.pack, c.skills, c.progress, now, studyLang())
}

export async function summary(now = new Date()): Promise<HomeSummary> {
  const courses = loadAllCourses()
  const inputs: HomeCourseInput[] = courses.map((c) => ({ pack: c.pack, skills: c.skills, generating: c.generating }))
  const progress: Record<ItemID, StudyProgress> = {}
  for (const c of courses) progress[c.pack.id] = c.progress
  const [events, ready] = await Promise.all([calendarEvents(new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 30 * 86_400_000)), aiReady()])
  let name = ''
  try { name = getSettings().general.name } catch { /* sin ajustes */ }
  return homeSummary(inputs, progress, events, { name, aiReady: ready, lang: studyLang() }, now)
}

export function stats(now = new Date()): StatsData {
  return statsData(loadAllCourses().map((c) => ({ pack: c.pack, skills: c.skills, progress: c.progress, generating: c.generating })), now, studyLang())
}

// MARK: Ejercicios

/** El ejercicio de un intento: del banco, una variante de plantilla, uno incrustado en la lección o el que manda la interfaz. */
export function findExercise(skill: Skill | undefined, exerciseId: string, given?: unknown): Exercise | undefined {
  if (skill) {
    const bank = skill.exercises.find((e) => e.id === exerciseId)
    if (bank) return bank
    const hash = exerciseId.lastIndexOf('#')
    if (hash > 0 && /^\d{1,20}$/.test(exerciseId.slice(hash + 1))) {
      const t = skill.templates.find((x) => x.id === exerciseId.slice(0, hash))
      const e = t ? instantiateTemplate(t, BigInt.asUintN(64, BigInt(exerciseId.slice(hash + 1)))) : undefined
      if (e) return e
    }
    for (const b of skill.lesson) if (b.type === 'tryit') { const e = b.inline.find((x) => x.id === exerciseId); if (e) return { ...e, skill: skill.id } }
  }
  if (given !== undefined) {
    const e = decodeExercise(given)
    if (e && e.id === exerciseId) return skill ? { ...e, skill: skill.id } : e
  }
  return undefined
}

function skillOf(c: CourseData, skillId: string): Skill | undefined {
  return c.skills.find((s) => s.id === skillId)
}

// MARK: Resúmenes

function progressSummary(c: CourseData, p: StudyProgress, skillId: string | undefined, now: Date): StudyProgressSummary {
  const sp = skillId ? p.skills[skillId] : undefined
  const streak = StudyStatsCalc.summary([p, ...allProgress(c.pack.id)], now, 1).streak.current
  const out: StudyProgressSummary = {
    packId: c.pack.id,
    mastery: LearnBridge.probability(sp, now) ?? null,
    level: LearnBridge.level(sp, now),
    skillAttempts: sp?.attempts ?? 0,
    dueCards: LearnBridge.dueCardCount(c.pack, c.skills, p, now),
    mistakes: Recorder.dueMistakes(p, now, c.skills).length,
    xp: p.xp,
    minutesToday: p.days.find((d) => d.day === Recorder.dayKey(now))?.minutes ?? 0,
    streak,
    readiness: LearnBridge.readiness(c.pack, p, now).expectedScore
  }
  if (skillId) out.skillId = skillId
  return out
}

/** Escribe el progreso del curso (con cerrojo) y devuelve el resumen. */
function write(c: CourseData, skillId: string | undefined, now: Date, change: (p: StudyProgress) => StudyProgress): StudyProgressSummary {
  const next = updateProgress(c.store, (p) => { const n = change(p); return { progress: n, value: n } })
  return progressSummary(c, next, skillId, now)
}

// MARK: Escrituras

export function recordAttempt(args: RecordAttemptArgs, now = new Date()): StudyProgressSummary {
  const c = loadCourse(args.packId)
  const skill = skillOf(c, args.skillId)
  if (!skill) throw new AulaError('not_found', tr('Esa habilidad no existe en el curso', 'That skill doesn’t exist in the course'))
  const ex = findExercise(skill, args.exerciseId, args.exercise)
  if (!ex) throw new AulaError('not_found', tr('Ese ejercicio no existe en la habilidad', 'That exercise doesn’t exist in the skill'))
  const exercise: Exercise = { ...ex, skill: skill.id }
  const credit = Number(args.result.credit)
  const inputText = typeof args.input === 'string' ? args.input : args.input ? answerSummary(args.input, exercise, studyLang()) : undefined
  const why = args.result.status !== 'correct' ? args.result.feedback?.find((f) => f.markdown)?.markdown : undefined
  return write(c, skill.id, now, (p) => recordAttemptOf(p, exercise, {
    credit, hints: args.hints, seconds: args.seconds, mode: args.mode, input: inputText?.slice(0, 2000), why: why?.slice(0, 4000)
  }, now))
}

export function reviewCard(args: ReviewCardArgs, now = new Date()): StudyProgressSummary {
  const c = loadCourse(args.packId)
  const skillId = CardReview.skillOfCard(args.cardId, c.skills)
  if (!skillId) throw new AulaError('not_found', tr('Esa tarjeta no existe en el curso', 'That flashcard doesn’t exist in the course'))
  return write(c, skillId, now, (p) => reviewCardOf(p, args.cardId, args.rating, now, { skillId, seconds: args.seconds }))
}

export function recordTime(packId: ItemID, seconds: number, now = new Date()): { minutesToday: number } {
  const store = requireStore(packId)
  const next = updateProgress(store, (p) => { const n = recordStudyTime(p, seconds, now); return { progress: n, value: n } })
  return { minutesToday: next.days.find((d) => d.day === Recorder.dayKey(now))?.minutes ?? 0 }
}

export function completeLesson(packId: ItemID, skillId: ItemID, now = new Date()): StudyProgressSummary {
  const c = loadCourse(packId)
  if (!skillOf(c, skillId)) throw new AulaError('not_found', tr('Esa habilidad no existe en el curso', 'That skill doesn’t exist in the course'))
  return write(c, skillId, now, (p) => completeLessonOf(p, skillId, now))
}

/** Guarda el estado de los conceptos guiados (se fusiona por concepto; lo que no se entiende se descarta). */
export function saveLearning(args: SaveLearningArgs, now = new Date()): StudyProgressSummary {
  const c = loadCourse(args.packId)
  if (!skillOf(c, args.skillId)) throw new AulaError('not_found', tr('Esa habilidad no existe en el curso', 'That skill doesn’t exist in the course'))
  const learning: Record<string, LearningConceptProgress> = {}
  for (const [id, raw] of Object.entries(args.learning ?? {}).slice(0, 500)) {
    const decoded = decodeLearningConcept(raw)
    if (decoded) learning[id] = decoded
  }
  return write(c, args.skillId, now, (p) => {
    const sp = p.skills[args.skillId] ?? makeSkillProgress()
    const next = { ...sp, learning: { ...sp.learning, ...learning } }
    if (args.lessonStep !== undefined && Number.isFinite(args.lessonStep)) next.lessonStep = Math.max(0, Math.min(1_000_000, Math.trunc(args.lessonStep)))
    return { ...p, skills: { ...p.skills, [args.skillId]: next } }
  })
}

// MARK: Corrección con IA y más ejercicios

export async function gradeOpen(args: GradeOpenArgs): Promise<GradeOpenResult> {
  const c = loadCourse(args.packId)
  const skill = args.skillId ? skillOf(c, args.skillId) : c.skills.find((s) => findExercise(s, args.exerciseId) !== undefined)
  const ex = findExercise(skill, args.exerciseId, args.exercise)
  if (!ex) throw new AulaError('not_found', tr('Ese ejercicio no existe en el curso', 'That exercise doesn’t exist in the course'))
  return gradeOpenAnswer(ex, String(args.answer ?? ''), { language: c.pack.language, courseID: c.pack.id, lang: studyLang() })
}

/** Deja en `runs/` la petición de más ejercicios para el concepto agotado; la generación (`generation.extend`) la recoge. */
export function prepareMore(args: PrepareMoreArgs, now = new Date()): PrepareMoreResult {
  const c = loadCourse(args.packId)
  const skill = skillOf(c, args.skillId)
  if (!skill) throw new AulaError('not_found', tr('Esa habilidad no existe en el curso', 'That skill doesn’t exist in the course'))
  const concept = args.conceptId ? lessonConcepts(skill).find((x) => x.id === args.conceptId) : undefined
  const id = `practice-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${IDs.short(4)}`
  const request = learningContentRequest(c.pack, skill, concept, id, now, studyLang())
  const file = join(c.store.runsDirectory, `${id}.practice-request.json`)
  writeJSONAtomic(file, request)
  return { requestId: id, file, instruction: request.instruction }
}

// MARK: Simulacros

export function startExam(packId: ItemID, now = new Date()): StartExamResult | null {
  const c = loadCourse(packId)
  const plan = buildExam(c.pack, c.skills, c.progress, { now, lang: studyLang() })
  if (!plan) return null
  updateProgress(c.store, (p) => ({ progress: { ...p, examRun: plan.run }, value: undefined }))
  return { ...plan, exercises: examExercises(plan.run, c.skills) }
}

export function submitExam(args: SubmitExamArgs, now = new Date()): SubmitExamResult {
  const c = loadCourse(args.packId)
  const run = c.progress.examRun
  if (!run || run.id !== args.runId) throw new AulaError('not_found', tr('Ese simulacro ya no está en curso', 'That mock exam is no longer running'))
  const inputs: Record<string, AnswerInput> = {}
  for (const [id, raw] of Object.entries(args.inputs ?? {})) { const input = decodeAnswerInput(raw); if (input) inputs[id] = input }
  const seconds: Record<string, number> = {}
  for (const [id, s] of Object.entries(args.secondsByItem ?? {})) if (typeof s === 'number' && Number.isFinite(s) && s >= 0) seconds[id] = s
  const exercises = examExercises(run, c.skills)
  // sin el tiempo activo de la interfaz, el que llevan apuntado las preguntas del simulacro guardado
  const active = typeof args.activeSeconds === 'number' && Number.isFinite(args.activeSeconds) && args.activeSeconds >= 0
    ? args.activeSeconds
    : run.items.reduce((s, it) => s + (Number.isFinite(it.seconds) && it.seconds > 0 ? it.seconds : 0), 0) || undefined
  const graded = gradeExam(run, exercises, inputs, now, { activeSeconds: active, exactText: isLanguageCourse(c.pack) })
  updateProgress(c.store, (p) => {
    if (p.examRun?.id !== run.id) throw new AulaError('not_found', tr('Ese simulacro ya no está en curso', 'That mock exam is no longer running'))
    return { progress: recordExam(p, graded, run, exercises, { now, inputs, secondsByItem: seconds }), value: undefined }
  })
  return { result: graded.result, grades: graded.grades as Record<string, GradeResult>, report: examReport(graded, run, c.pack, studyLang()) }
}
