// Corrección con IA de una respuesta abierta según su rúbrica (port de StudyEngine/Grading/OpenAnswerGrader.swift): una sola
// corrección con la IA que el estudiante eligió (sin herramientas), con la nota acotada a la rúbrica real. Si no hay ninguna
// IA lista, error con código 'needs_ai' (la interfaz ofrece la autoevaluación con la respuesta modelo y la rúbrica).
import type { Exercise } from '@shared/schema'
import {
  feedbackLine, makeGrade, openGraderPrompt, openGraderSystem, openPartOf, openRubric, parseOpenReview, reviewCredit,
  type FeedbackLine, type GradeLang, type GradeResult, type OpenAnswerReview
} from '@engine/grading'
import { AIError, resolveActiveModel, runToolLoop, withAIUse, type ChatModel } from '../ai'
import { AulaError } from '../errors'

type ModelResolver = () => Promise<ChatModel>
let resolver: ModelResolver = () => resolveActiveModel()

/** Cambia de dónde sale el modelo (pruebas). */
export function setOpenGraderModel(fn: ModelResolver | null): void {
  resolver = fn ?? (() => resolveActiveModel())
}

const NEEDS_AI_CODES = new Set(['ai_no_provider', 'ai_missing_key', 'ai_no_model', 'ai_unsupported', 'ai_not_installed', 'ai_not_logged_in'])

async function model(): Promise<ChatModel> {
  try {
    return await resolver()
  } catch (err) {
    if (err instanceof AIError && (NEEDS_AI_CODES.has(err.code) || err.kind === 'missingKey' || err.kind === 'notInstalled' || err.kind === 'notLoggedIn')) {
      throw new AulaError('needs_ai', err.message, { cause: err.code })
    }
    if (err instanceof AulaError) throw err
    throw new AulaError('needs_ai', err instanceof Error ? err.message : String(err))
  }
}

/** La corrección de la IA como resultado de cualquier ejercicio. */
export function reviewToGrade(review: OpenAnswerReview): GradeResult {
  const credit = reviewCredit(review)
  const lines: FeedbackLine[] = []
  if (review.feedback) lines.push(feedbackLine(credit >= 0.999 ? 'praise' : 'explanation', review.feedback))
  for (const m of review.missing) lines.push(feedbackLine('hint', m))
  for (const c of review.criteria) if (c.comment) lines.push(feedbackLine('info', `**${c.text}** (${c.points}/${c.max}): ${c.comment}`))
  return makeGrade(credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { feedback: lines })
}

export interface OpenGrade { review: OpenAnswerReview; grade: GradeResult; provider: string }

/** Corrige con la IA. Lanza `needs_ai` sin IA, `invalid_args` si no es abierta o está vacía, `ai_bad_response` si no responde bien. */
export async function gradeOpenAnswer(exercise: Exercise, answer: string, opts: { language: string; courseID?: string; lang?: GradeLang; signal?: AbortSignal; timeoutSec?: number }): Promise<OpenGrade> {
  let open
  try { open = openPartOf(exercise, answer, opts.lang) } catch (err) {
    throw new AulaError('invalid_args', err instanceof Error ? err.message : String(err))
  }
  const m = await model()
  const rubric = openRubric(open)
  const system = openGraderSystem(opts.language)
  const prompt = openGraderPrompt(exercise, open, answer)
  const once = async (): Promise<OpenAnswerReview | undefined> => {
    const r = await withAIUse({ purpose: 'grading', ...(opts.courseID ? { courseID: opts.courseID } : {}) }, () =>
      runToolLoop({ model: m, system, prompt, tools: [], maxSteps: 2, timeoutSec: opts.timeoutSec ?? 150, temperature: 0.2, signal: opts.signal }))
    if (r.stopReason === 'cancelled') throw new AulaError('cancelled', opts.lang === 'en' ? 'Cancelled' : 'Cancelado')
    return parseOpenReview(r.text, rubric)
  }
  // una respuesta que no es JSON (o sin puntuar algún criterio) no cuenta como nota: se pide otra vez
  const review = (await once()) ?? (await once())
  if (!review) throw new AulaError('ai_bad_response', opts.lang === 'en' ? 'Aula didn’t return a valid grade. Try again.' : 'La IA no devolvió una corrección válida. Inténtalo de nuevo.')
  return { review, grade: reviewToGrade(review), provider: [m.providerName, m.model].filter((x) => x).join(' · ') }
}
