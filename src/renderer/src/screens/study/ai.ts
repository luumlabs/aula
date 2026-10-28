// Lo que necesita la IA durante el estudio: corregir una respuesta abierta con su rúbrica (`study.gradeOpen`) y preparar
// más ejercicios cuando se acaba el banco de un concepto (`study.prepareMore` + `generation.extend`). Sin proveedor (o en
// demostración), null: la interfaz ofrece la alternativa (autoevaluarse, seguir sin comprobar).
import type { Exercise } from '@shared/schema'
import type { GradeOpenResult, PrepareMoreResult } from '@shared/ipc/study'
import { reviewCredit, type OpenAnswerReview } from '@engine/grading'
import { api } from '@renderer/lib/api'
import i18n from '@renderer/i18n'
import { isDemo } from '@renderer/lib/demo'
import { makeResult, type GradeResult } from '@renderer/exercises'
import { useStudyStore } from './data'

const invoke = api.invoke as unknown as (m: string, a?: unknown) => Promise<unknown>
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** La corrección de la IA como `GradeResult` (con la rúbrica puntuada para enseñarla). */
export function aiResult(raw: unknown): GradeResult | null {
  if (!isObj(raw)) return null
  const r = raw as Partial<GradeOpenResult>
  const review = isObj(r.review) && Array.isArray((r.review as OpenAnswerReview).criteria) ? (r.review as OpenAnswerReview) : undefined
  if (r.grade && typeof r.grade.status === 'string') return { ...r.grade, needsReview: false, needsAI: false, review }
  if (!review) return null
  const credit = reviewCredit(review)
  return makeResult(credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { feedback: review.feedback ? [{ kind: 'explanation', markdown: review.feedback }] : [], review })
}

/** ¿El ejercicio está en el banco del curso? (si no, viaja entero) */
function inBank(packId: string, ex: Exercise): boolean {
  return !!useStudyStore.getState().courses[packId]?.skills.find((s) => s.id === ex.skill)?.exercises.some((e) => e.id === ex.id)
}

/** Corrige con IA una respuesta abierta (null = sin IA: autoevaluación). */
export async function gradeOpenWithAI(packId: string, exercise: Exercise, answer: string): Promise<GradeResult | null> {
  if (isDemo() && useStudyStore.getState().courses[packId]?.demo) return null
  try {
    const base = { packId, exerciseId: exercise.id, answer, skillId: exercise.skill || undefined }
    return aiResult(await invoke('study.gradeOpen', inBank(packId, exercise) ? base : { ...base, exercise }))
  } catch {
    return null
  }
}

/**
 * Pide a Aula más ejercicios para un concepto con la tubería real del curso: la petición (`study.prepareMore`) y la
 * ampliación (`generation.extend`). Devuelve la ejecución (para seguirla en su monitor) o null si no hay IA.
 */
export async function prepareMore(packId: string, skillId: string, conceptId: string | undefined, focus: string): Promise<{ runId: string } | null> {
  let instruction = i18n.t('study:prepareMoreInstruction', { focus })
  try {
    const r = (await invoke('study.prepareMore', { packId, skillId, conceptId })) as PrepareMoreResult
    if (r?.instruction) instruction = r.instruction
  } catch {
    /* sin la petición: la instrucción de aquí */
  }
  try {
    const r = await invoke('generation.extend', { packId, instruction, skillId })
    if (isObj(r) && typeof r.runId === 'string') return { runId: r.runId }
  } catch {
    /* sin IA */
  }
  return null
}
