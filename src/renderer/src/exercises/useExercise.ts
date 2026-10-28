// El flujo de un ejercicio en la interfaz (como `ExerciseFlow` en Swift): comprobar, intentar de nuevo, pistas, «No lo sé»,
// ver la solución, autoevaluarse y seguir. Lo comparten la tarjeta del ejercicio y la barra flotante de la práctica.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Exercise } from '@shared/schema/exercises'
import i18n from '@renderer/i18n'
import { gradeExercise } from './grading'
import {
  applyResult, applySelfGrade, canCheck, checkedWrong, draftHasInput, hintsUsed, initialRun, isChecked, isFinished, isStale, needsSelfReview, runInput, snapshotDraft,
  type Draft, type RunState
} from './model'
import { makeResult, type AnswerInput, type ExerciseMode, type GradeResult } from './types'

export interface ExerciseCallbacks {
  /** El primer resultado (el que cuenta para el progreso). Llega una sola vez. */
  onFirstResult?: (result: GradeResult, run: RunState) => void
  /** «Siguiente» / «Continuar». Sin él no hay botón de seguir. */
  onContinue?: () => void
  /** Se pidió ayuda (pista o solución) antes de responder (la comprobación guiada deja de contar). */
  onAssist?: (run: RunState) => void
  /** Lo escrito cambió (para guardarlo: simulacro, comprobación guiada). */
  onDraft?: (snapshot: unknown, input: AnswerInput) => void
  /** Idioma de la interfaz (mensajes del corrector). */
  lang?: string
  /** Curso de idiomas: los huecos y respuestas cortas se corrigen exactos (`BlockContext.exactText`). */
  exactText?: boolean
  /** Corrección con IA de una respuesta abierta (null = no hay IA: autoevaluación). */
  gradeOpen?: (exercise: Exercise, text: string) => Promise<GradeResult | null>
}

export interface ExerciseOptions extends ExerciseCallbacks {
  mode?: ExerciseMode
  /** Lo que llevaba escrito (simulacro a medias, comprobación guiada al volver). */
  snapshot?: unknown
}

export interface ExerciseController {
  exercise: Exercise
  mode: ExerciseMode
  run: RunState
  input: AnswerInput
  finished: boolean
  stale: boolean
  checked: boolean
  canCheck: boolean
  selfReview: boolean
  checkedWrong: boolean
  canHint: boolean
  canSayDontKnow: boolean
  /** Respuesta abierta: ↩ es salto de línea y se comprueba con ⌘↩. */
  multiline: boolean
  hasContinue: boolean
  edit: (fn: (d: Draft) => Draft) => void
  editPart: (i: number, fn: (d: Draft) => Draft) => void
  submit: () => void
  retry: () => void
  hint: () => void
  partHint: (i: number) => void
  reveal: () => void
  selfGrade: (credit: number) => void
  continueNow: () => void
  /** ↩: comprobar, intentar de nuevo o seguir (según el momento). */
  primary: () => void
}

export function useExercise(exercise: Exercise, opts: ExerciseOptions = {}): ExerciseController {
  const mode = opts.mode ?? 'practice'
  const [run, setRun] = useState<RunState>(() => initialRun(exercise, opts.snapshot))
  const ref = useRef(run)
  const cb = useRef(opts)
  cb.current = opts
  const last = useRef(0)

  // otro ejercicio en la misma vista: estado nuevo
  const exKey = exercise.id
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const fresh = initialRun(exercise, cb.current.snapshot)
    ref.current = fresh
    setRun(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exKey])

  const commit = useCallback((next: RunState) => {
    ref.current = next
    setRun(next)
  }, [])

  /** Un doble clic (o ↩ que llega dos veces) no debe saltarse el resultado recién mostrado. */
  const tooSoon = (): boolean => Date.now() - last.current < 350
  const mark = (): void => {
    last.current = Date.now()
  }

  const reportFirst = useCallback((s: RunState): RunState => {
    if (s.reportedFirst || !s.result || s.result.status === 'invalid' || needsSelfReview(exercise, s)) return s
    // la comprobación guiada vale un solo intento: queda el resultado y «Continuar»
    const next = { ...s, reportedFirst: true, closed: s.closed || mode === 'guided' }
    cb.current.onFirstResult?.(s.result, next)
    return next
  }, [exercise, mode])

  const edit = useCallback((fn: (d: Draft) => Draft) => {
    const s = ref.current
    if (isFinished(s)) return
    const draft = fn(s.draft)
    const next = { ...s, draft }
    commit(next)
    cb.current.onDraft?.(snapshotDraft(exercise.answer, draft), runInput(exercise, next))
  }, [commit, exercise])

  const editPart = useCallback((i: number, fn: (d: Draft) => Draft) => {
    edit((d) => {
      const parts = [...d.parts]
      if (!parts[i]) return d
      parts[i] = fn(parts[i])
      return { ...d, parts }
    })
  }, [edit])

  const submit = useCallback(() => {
    const s = ref.current
    if (mode === 'exam' || !canCheck(exercise, s)) return
    mark()
    const input = runInput(exercise, s)
    const r = gradeExercise(exercise, input, cb.current.lang ?? i18n.language, cb.current.exactText)
    // respuesta abierta: la IA la corrige (si hay); si no, autoevaluación con la rúbrica
    if (exercise.answer.kind === 'open' && r.needsReview && cb.current.gradeOpen && input.kind === 'text') {
      commit({ ...s, grading: true })
      cb.current
        .gradeOpen(exercise, input.text)
        .then((ai) => {
          const base = ref.current
          const next = applyResult(exercise, { ...base, grading: false }, ai ?? r)
          commit(reportFirst(next))
        })
        .catch(() => commit(reportFirst(applyResult(exercise, { ...ref.current, grading: false }, r))))
      return
    }
    commit(reportFirst(applyResult(exercise, s, r)))
  }, [commit, exercise, mode, reportFirst])

  const retry = useCallback(() => {
    if (tooSoon()) return
    mark()
    const s = ref.current
    commit({ ...s, result: undefined, checkedKey: undefined })
  }, [commit])

  const assisted = useCallback((s: RunState) => {
    if (!s.reportedFirst) cb.current.onAssist?.(s)
  }, [])

  const hint = useCallback(() => {
    const s = ref.current
    if (isFinished(s) || s.hintsShown >= exercise.hints.length) return
    const next = { ...s, hintsShown: s.hintsShown + 1 }
    commit(next)
    assisted(next)
  }, [assisted, commit, exercise.hints.length])

  const partHint = useCallback((i: number) => {
    const s = ref.current
    if (isFinished(s) || exercise.answer.kind !== 'multi') return
    const max = exercise.answer.parts[i]?.hints.length ?? 0
    if ((s.partHints[i] ?? 0) >= max) return
    const partHints = [...s.partHints]
    partHints[i] = (partHints[i] ?? 0) + 1
    const next = { ...s, partHints }
    commit(next)
    assisted(next)
  }, [assisted, commit, exercise.answer])

  const reveal = useCallback(() => {
    mark()
    const s = ref.current
    let next: RunState = { ...s, revealed: true, finishedAt: s.finishedAt ?? Date.now() }
    if (!next.reportedFirst) {
      // «No lo sé» o «Ver la solución» antes de acertar: cuenta como fallo
      const r = s.result && s.result.status !== 'invalid' ? s.result : makeResult('incorrect', 0)
      next = { ...next, reportedFirst: true }
      assisted(s)
      cb.current.onFirstResult?.(r, next)
    }
    commit(next)
  }, [assisted, commit])

  const selfGrade = useCallback((credit: number) => {
    const s = ref.current
    commit(reportFirst({ ...applySelfGrade(exercise, s, credit), reportedFirst: s.reportedFirst }))
  }, [commit, exercise, reportFirst])

  const continueNow = useCallback(() => {
    if (tooSoon()) return
    mark()
    const s = ref.current
    commit({ ...s, continued: true })
    cb.current.onContinue?.()
  }, [commit])

  const primary = useCallback(() => {
    if (tooSoon()) return
    const s = ref.current
    if (isFinished(s)) {
      if (!s.continued && cb.current.onContinue) continueNow()
    } else if (checkedWrong(exercise, s)) retry()
    else if (canCheck(exercise, s)) submit()
  }, [continueNow, exercise, retry, submit])

  return useMemo(() => {
    const finished = isFinished(run)
    return {
      exercise, mode, run, input: runInput(exercise, run), finished, stale: isStale(exercise, run), checked: isChecked(exercise, run), canCheck: canCheck(exercise, run),
      selfReview: needsSelfReview(exercise, run), checkedWrong: checkedWrong(exercise, run),
      canHint: mode !== 'exam' && !finished && run.hintsShown < exercise.hints.length,
      canSayDontKnow: mode !== 'exam' && mode !== 'guided' && !finished && !run.result && run.attempts === 0,
      multiline: exercise.answer.kind === 'open', hasContinue: !!opts.onContinue,
      edit, editPart, submit, retry, hint, partHint, reveal, selfGrade, continueNow, primary
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, exercise, mode, !!opts.onContinue, edit, editPart, submit, retry, hint, partHint, reveal, selfGrade, continueNow, primary])
}

export { draftHasInput, hintsUsed }
