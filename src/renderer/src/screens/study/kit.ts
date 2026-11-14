// Piezas compartidas de los modos de estudio: el contexto de los bloques del curso, anotar un resultado en el progreso
// (con el motor, al instante) y salir al curso.
import { openCourseSource } from '../documents/lib'
import { useMemo, useRef } from 'react'
import type { Exercise, Pack } from '@shared/schema'
import { recordAttempt, recordStudyTime, type AttemptRecord } from '@engine/study'
import { isLanguageCourse } from '@engine/grading'
import { makeBlockContext, type AskFrom, type BlockContext } from '@renderer/blocks/types'
import { toneForHue, useTheme } from '@renderer/design'
import { navigate, useRoute, type CourseTab } from '@renderer/app/router'
import { finalCredit, hintsUsed, inputSummary, elapsedSeconds, type GradeResult, type RunState } from '@renderer/exercises'
import type { TutorContext } from '@shared/assistant/types'
import { useTutor } from './TutorPanel'
import { updateProgress, useStudyStore, type SyncOp } from './data'
import { activePlan } from './plan/session'

/** Desde qué pantalla se pregunta al tutor por una figura: todos los modos de estudio menos el simulacro (allí no hay tutor). */
export function tutorScreenOf(route: ReturnType<typeof useRoute>): string | undefined {
  return route.name === 'study' && route.mode !== 'exam' ? (route.mode === 'learn' ? 'lesson' : route.mode) : undefined
}

/**
 * Lo que sabe el tutor de una pregunta de «Marcar»: la figura y, si está en el enunciado de un ejercicio, cuál es, lo que
 * respondió el estudiante (si la pantalla lo sabe: `exercise`) y si aún está sin resolver (entonces ayuda con pistas).
 */
export function markedFigureContext(base: { courseID: string; skillID?: string; screen: string }, blockID: string, from?: AskFrom, exercise?: TutorContext): TutorContext {
  const ctx: TutorContext = { ...base, blockID }
  if (!from) return ctx
  const known = exercise?.exerciseID === from.exerciseId ? exercise : undefined
  const done = 'finished: the solution is on screen'
  const lastResult = from.unsolved ? (known?.lastResult ?? 'not solved yet') : known?.lastResult ? `${known.lastResult} (${done})` : done
  return { ...ctx, skillID: known?.skillID ?? base.skillID, exerciseID: from.exerciseId, ...(known?.lastInput ? { lastInput: known.lastInput } : {}), lastResult }
}

/**
 * Contexto de los bloques de una lección o un enunciado del curso. `exercise`: lo que la pantalla sabe del ejercicio a la vista
 * (para que el tutor vea su respuesta si pregunta por una figura de su enunciado).
 */
export function useBlockCtx(pack: Pack, skillId?: string, extra: Partial<BlockContext> = {}, opts: { exercise?: (id: string) => TutorContext | undefined } = {}): BlockContext {
  const { onTryIt } = extra
  // «Marcar y preguntar» lleva al tutor del curso: en todos los modos de estudio menos el simulacro (allí no hay tutor)
  const route = useRoute()
  const tutorScreen = tutorScreenOf(route)
  const exerciseRef = useRef(opts.exercise)
  exerciseRef.current = opts.exercise
  return useMemo(
    () =>
      makeBlockContext(pack.id, pack.language, {
        skillId,
        hue: pack.hue,
        onAskTutor: tutorScreen
          ? (blockId, message, from) => askTutor(message, markedFigureContext({ courseID: pack.id, skillID: skillId, screen: tutorScreen }, blockId, from, from ? exerciseRef.current?.(from.exerciseId) : undefined))
          : undefined,
        sourceTitle: (id) => pack.sources.find((s) => s.id === id)?.title,
        // la cita abre el material en su página, o la grabación en su minuto; si ya no está, la lista de materiales
        onOpenSource: (ref) => (pack.sources.some((s) => s.id === ref.source) ? openCourseSource(pack.id, ref.source, ref.page, ref.at) : navigate({ name: 'course', id: pack.id, tab: 'materials' })),
        exactText: isLanguageCourse(pack),
        ...extra
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pack, skillId, onTryIt, tutorScreen]
  )
}

/** Tinta del curso (cifras, barras y puntos hechos). */
export function useInk(pack: Pack): string {
  const { dark } = useTheme()
  const tone = toneForHue(pack.hue)
  return dark ? tone.inkDark : tone.inkLight
}

/** La primera explicación del error que se mostró (para el cuaderno de errores). */
export function whyOf(r: GradeResult): string | undefined {
  return r.matchedWrong?.why || r.feedback.find((f) => f.kind === 'error' || f.kind === 'explanation')?.markdown || undefined
}

/** Anota el primer resultado de un ejercicio (dominio, errores, día y XP) y lo programa para guardarse. */
export function recordResult(packId: string, exercise: Exercise, result: GradeResult, run: RunState, mode: AttemptRecord['mode']): void {
  const record: AttemptRecord = {
    credit: finalCredit(result, hintsUsed(run)),
    hints: hintsUsed(run),
    seconds: Math.round(elapsedSeconds(run)),
    mode,
    input: inputSummary(exercise.answer, run.draft),
    why: result.status === 'correct' ? undefined : whyOf(result)
  }
  updateProgress(packId, (p) => recordAttempt(p, exercise, record, new Date()), attemptOp(packId, exercise, record, result))
}

/** La operación de un intento para el proceso principal (con el ejercicio entero si no está en el banco del curso). */
export function attemptOp(packId: string, exercise: Exercise, record: AttemptRecord, result: GradeResult): SyncOp {
  const skill = useStudyStore.getState().courses[packId]?.skills.find((s) => s.id === exercise.skill)
  const inBank = !!skill?.exercises.some((e) => e.id === exercise.id)
  return { kind: 'attempt', exercise, record, result: { status: result.status, feedback: result.feedback, needsReview: result.needsReview }, inBank }
}

/** Suma tiempo de estudio al día (lectura, simulacros…). */
export function recordTime(packId: string, seconds: number): void {
  if (!(seconds >= 5)) return
  updateProgress(packId, (p) => recordStudyTime(p, Math.min(seconds, 3 * 3600), new Date()), { kind: 'time', seconds: Math.min(seconds, 3 * 3600) })
}

/** Salir de un modo: al plan si se está siguiendo «Estudiar ahora»; si no, a la pestaña del curso. */
export function exitTo(packId: string, tab?: CourseTab): void {
  const plan = activePlan(packId)
  if (plan && plan.current >= 0) navigate({ name: 'study', id: packId, mode: 'plan' }, { replace: true })
  else navigate({ name: 'course', id: packId, tab }, { replace: true })
}

/** Pedir a Aula otra explicación: el tutor del curso se abre al lado con el ejercicio y la respuesta como contexto. */
export function askTutor(prompt: string, context?: TutorContext): void {
  if (context?.courseID) useTutor.getState().show(context, prompt)
  else navigate({ name: 'chat', prompt })
}

/** Contexto del tutor para un ejercicio (lo que escribió el estudiante y cómo le fue). */
export function exerciseContext(packId: string, exercise: Exercise, run: RunState, screen: string): TutorContext {
  return {
    courseID: packId,
    skillID: exercise.skill,
    exerciseID: exercise.id,
    screen,
    lastInput: inputSummary(exercise.answer, run.draft) || undefined,
    lastResult: run.result ? `${run.result.status}${whyOf(run.result) ? `: ${whyOf(run.result)}` : ''}` : undefined
  }
}
