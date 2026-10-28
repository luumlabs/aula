// IPC del estudio (dominios «course.overview», «home.summary», «stats.get» y «study.*»). La lógica vive en
// `@main/services/study`; aquí solo se validan los argumentos y se avisa con 'progress.changed' tras cada escritura.
import type { ItemID } from '@shared/schema'
import type { RecordAttemptArgs, SubmitExamArgs } from '@shared/ipc/study'
import { invalidArgs } from '@main/services/errors'
import {
  completeLesson, gradeOpen, overview, prepareMore, recordAttempt, recordTime, reviewCard, saveLearning, startExam, stats, submitExam, summary
} from '@main/services/study'
import { emit, handle } from '../rpc'

type Obj = Record<string, unknown>

function obj(args: unknown): Obj {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArgs('Argumentos no válidos')
  return args as Obj
}

function id(o: Obj, key: string, max = 200): string {
  const v = o[key]
  if (typeof v !== 'string' || v === '' || v.length > max) throw invalidArgs(`Falta «${key}»`)
  return v
}

function optId(o: Obj, key: string): string | undefined {
  return o[key] === undefined || o[key] === null ? undefined : id(o, key)
}

function finite(o: Obj, key: string, lo: number, hi: number): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw invalidArgs(`«${key}» no es válido`)
  return v
}

const MODES = ['lesson', 'practice', 'review', 'diagnostic', 'exam'] as const

function changed(packId: ItemID): void {
  emit('progress.changed', { packId })
}

export function register(): void {
  handle('course.overview', (args) => overview(id(obj(args), 'id')))
  handle('home.summary', () => summary())
  handle('stats.get', () => stats())

  handle('study.recordAttempt', (args) => {
    const o = obj(args)
    const result = obj(o.result)
    const credit = finite(result, 'credit', -1e9, 1e9)
    if (credit === undefined) throw invalidArgs('Falta el crédito del intento')
    const mode = o.mode === undefined ? undefined : MODES.find((m) => m === o.mode)
    if (o.mode !== undefined && !mode) throw invalidArgs('Modo de intento no válido')
    const input = o.input
    if (input !== undefined && typeof input !== 'string' && (typeof input !== 'object' || input === null)) throw invalidArgs('Respuesta no válida')
    const a: RecordAttemptArgs = {
      packId: id(o, 'packId'), skillId: id(o, 'skillId'), exerciseId: id(o, 'exerciseId', 400),
      result: {
        credit,
        ...(typeof result.status === 'string' && ['correct', 'incorrect', 'partial', 'invalid'].includes(result.status) ? { status: result.status as 'correct' } : {}),
        ...(Array.isArray(result.feedback) ? { feedback: result.feedback.filter((f): f is { kind: 'error'; markdown: string } => !!f && typeof f === 'object' && typeof (f as Obj).markdown === 'string').slice(0, 20) } : {})
      },
      seconds: finite(o, 'seconds', 0, 1e7), hints: finite(o, 'hints', 0, 1000), mode,
      input: typeof input === 'string' ? input.slice(0, 20_000) : (input as RecordAttemptArgs['input']),
      exercise: o.exercise as RecordAttemptArgs['exercise']
    }
    const r = recordAttempt(a)
    changed(a.packId)
    return r
  })

  handle('study.reviewCard', (args) => {
    const o = obj(args)
    const rating = o.rating
    if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) throw invalidArgs('La calificación va de 1 a 4')
    const packId = id(o, 'packId')
    const r = reviewCard({ packId, cardId: id(o, 'cardId'), rating, seconds: finite(o, 'seconds', 0, 1e6) })
    changed(packId)
    return r
  })

  handle('study.recordTime', (args) => {
    const o = obj(args)
    const packId = id(o, 'packId')
    const seconds = finite(o, 'seconds', 0, 86_400)
    if (seconds === undefined) throw invalidArgs('Faltan los segundos')
    const r = recordTime(packId, seconds)
    changed(packId)
    return r
  })

  handle('study.gradeOpen', (args) => {
    const o = obj(args)
    const answer = o.answer
    if (typeof answer !== 'string' || answer.length > 50_000) throw invalidArgs('La respuesta no es válida')
    return gradeOpen({ packId: id(o, 'packId'), exerciseId: id(o, 'exerciseId', 400), answer, skillId: optId(o, 'skillId'), exercise: o.exercise as never })
  })

  handle('study.prepareMore', (args) => {
    const o = obj(args)
    return prepareMore({ packId: id(o, 'packId'), skillId: id(o, 'skillId'), conceptId: optId(o, 'conceptId') })
  })

  handle('study.saveLearning', (args) => {
    const o = obj(args)
    const packId = id(o, 'packId')
    const learning = obj(o.learning)
    const r = saveLearning({ packId, skillId: id(o, 'skillId'), learning: learning as never, lessonStep: finite(o, 'lessonStep', 0, 1e6) })
    changed(packId)
    return r
  })

  handle('study.completeLesson', (args) => {
    const o = obj(args)
    const packId = id(o, 'packId')
    const r = completeLesson(packId, id(o, 'skillId'))
    changed(packId)
    return r
  })

  handle('study.startExam', (args) => {
    const packId = id(obj(args), 'packId')
    const r = startExam(packId)
    if (r) changed(packId)
    return r
  })

  handle('study.submitExam', (args) => {
    const o = obj(args)
    const a: SubmitExamArgs = {
      packId: id(o, 'packId'), runId: id(o, 'runId'), inputs: obj(o.inputs ?? {}) as SubmitExamArgs['inputs'],
      ...(o.secondsByItem !== undefined ? { secondsByItem: obj(o.secondsByItem) as Record<string, number> } : {}),
      ...(typeof o.activeSeconds === 'number' && Number.isFinite(o.activeSeconds) && o.activeSeconds >= 0 ? { activeSeconds: o.activeSeconds } : {})
    }
    const r = submitExam(a)
    changed(a.packId)
    return r
  })
}
