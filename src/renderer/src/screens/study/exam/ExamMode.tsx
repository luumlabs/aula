// Simulacro: el inicio (modelo del examen, intentos anteriores), el examen cronometrado por secciones (sin pistas ni
// corrección hasta entregar; si sales, el reloj se pausa y puedes continuar) y el informe con la nota. El proceso
// principal lo arma y lo corrige (`study.startExam` / `study.submitExam`); sin él (demostración), el motor aquí mismo.
import { useRef, useState } from 'react'
import type { ExamRun, Exercise } from '@shared/schema'
import type { StartExamResult, SubmitExamResult } from '@shared/ipc/study'
import { buildExam, examExercises, examReport, gradeExam, recordExam, type ExamGrade, type ExamReport as Report } from '@engine/study'
import { isLanguageCourse } from '@engine/grading'
import { snapshotInput, gradeLang, type AnswerInput } from '@renderer/exercises'
import { toast } from '@renderer/design'
import i18n from '@renderer/i18n'
import { flushProgress, invokeMain, patchLocalProgress, updateProgress, useStudyStore, type CourseData } from '../data'
import { exitTo, recordTime } from '../kit'
import { PracticeMode } from '../practice/PracticeMode'
import { ExamStart } from './ExamStart'
import { ExamRunView } from './ExamRunView'
import { ExamReportView } from './ExamReport'

export interface Finished {
  run: ExamRun
  graded: ExamGrade
  report: Report
  exercises: Record<string, Exercise>
  inputs: Record<string, AnswerInput>
}

/** Lo contestado en cada pregunta, como entrada para corregir. */
function inputsOf(r: ExamRun, exercises: Record<string, Exercise>): Record<string, AnswerInput> {
  const inputs: Record<string, AnswerInput> = {}
  for (const it of r.items) {
    const ex = exercises[it.exerciseID]
    if (ex && it.answer !== undefined && it.answer !== null) inputs[it.exerciseID] = snapshotInput(ex, it.answer)
  }
  return inputs
}

/** El mensaje de un error de IPC (`AulaError`) para el aviso. */
function errorText(e: unknown): string | undefined {
  return e instanceof Error && e.message ? e.message : undefined
}

export function ExamMode({ data }: { data: CourseData }) {
  const packId = data.pack.id
  const run = useStudyStore((s) => s.courses[packId]?.progress.examRun)
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState<Finished | null>(null)
  const [practice, setPractice] = useState<Exercise[] | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  const submitting = useRef(false)
  const lang = gradeLang(i18n.language)
  const onExit = (): void => exitTo(packId, 'exam')

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      if (!data.demo) {
        // el proceso principal monta el simulacro y lo guarda; aquí sólo se pone al día la copia local
        await flushProgress(packId)
        try {
          const r = (await invokeMain('study.startExam', { packId })) as StartExamResult | null
          // sin ejercicios no hay simulacro: se dice (antes el botón no hacía nada, A3-P2-8)
          if (!r) return void toast.warning(i18n.t('study:exam.noExercises'), i18n.t('study:exam.noExercisesBody'))
          setNotice(r.leftOutNotice)
          patchLocalProgress(packId, (p) => ({ ...p, examRun: r.run }))
          setStarted(true)
        } catch (e) {
          toast.error(i18n.t('study:exam.startFailed'), errorText(e))
        }
        return
      }
      // demostración: sin proceso principal, el motor aquí mismo
      const plan = buildExam(data.pack, data.skills, useStudyStore.getState().courses[packId]?.progress ?? data.progress, { now: new Date(), lang })
      if (!plan) return void toast.warning(i18n.t('study:exam.noExercises'), i18n.t('study:exam.noExercisesBody'))
      setNotice(plan.leftOutNotice)
      updateProgress(packId, (p) => ({ ...p, examRun: plan.run }), { kind: 'save' })
      setStarted(true)
    } finally {
      setBusy(false)
    }
  }

  const discard = (): void => {
    updateProgress(packId, (p) => {
      const { examRun: _drop, ...rest } = p
      return rest
    }, { kind: 'save' })
  }

  const submit = async (r: ExamRun): Promise<void> => {
    const exercises = examExercises(r, data.skills)
    const inputs = inputsOf(r, exercises)
    const secondsByItem = Object.fromEntries(r.items.map((it) => [it.exerciseID, it.seconds]))
    const now = new Date()
    if (!data.demo) {
      if (submitting.current) return
      submitting.current = true
      try {
        await flushProgress(packId)
        const res = (await invokeMain('study.submitExam', { packId, runId: r.id, inputs, secondsByItem, activeSeconds: r.items.reduce((a, it) => a + it.seconds, 0) })) as SubmitExamResult
        const graded: ExamGrade = { result: res.result, grades: res.grades }
        // el proceso principal ya lo guardó: la copia local se pone al día sin volver a mandarlo
        patchLocalProgress(packId, (p) => recordExam(p, graded, r, exercises, { now, inputs, secondsByItem }))
        setFinished({ run: r, graded, report: res.report, exercises, inputs })
      } catch (e) {
        // el simulacro sigue abierto (y guardado) para volver a entregarlo
        toast.error(i18n.t('study:exam.submitFailed'), errorText(e))
      } finally {
        submitting.current = false
      }
      return
    }
    // demostración: se corrige aquí y el progreso vive en memoria
    const graded = gradeExam(r, exercises, inputs, now, { activeSeconds: r.items.reduce((a, it) => a + it.seconds, 0), exactText: isLanguageCourse(data.pack) })
    const report = examReport(graded, r, data.pack, lang)
    updateProgress(packId, (p) => recordExam(p, graded, r, exercises, { now, inputs, secondsByItem }), { kind: 'save' })
    recordTime(packId, r.items.reduce((a, it) => a + it.seconds, 0))
    setFinished({ run: r, graded, report, exercises, inputs })
  }

  if (practice) return <PracticeMode data={data} initial={practice} options={{ exitTab: 'exam' }} />
  if (finished)
    return (
      <ExamReportView
        data={data}
        done={finished}
        onExit={onExit}
        onPractice={setPractice}
        onAgain={() => {
          setFinished(null)
          setStarted(false)
        }}
      />
    )
  if (run && started) return <ExamRunView key={run.id} data={data} run={run} notice={notice} onExit={onExit} onSubmit={(r) => void submit(r)} />
  return <ExamStart data={data} pending={run} busy={busy} onStart={() => void start()} onResume={() => setStarted(true)} onDiscard={discard} onExit={onExit} />
}
