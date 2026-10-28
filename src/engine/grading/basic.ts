// Corrector provisional sin motor matemático (port de BasicGrader.swift): solo comparaciones directas. Sirve para pruebas
// de interfaz y como referencia del comportamiento mínimo; la app usa `grade` (grader.ts).
import { answerForGrading, ownValue, type Answer, type Exercise } from '@shared/schema'
import { gradeLabel } from './grader'
import { describeAnswer } from './describe'
import { L } from './messages'
import { answerInputIsEmpty, feedbackLine, invalidGrade, makeGrade, sanitizedGrade, type AnswerInput, type GradeLang, type GradeResult } from './types'

/** Sin acentos ni mayúsculas, y sin espacios ni puntuación en los extremos. */
export function basicNorm(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
}

export function basicGrade(ex: Exercise, input: AnswerInput, lang?: GradeLang): GradeResult {
  return sanitizedGrade(basicAnswer(ex.answer, input, ex, lang))
}

function basicAnswer(answer: Answer, input: AnswerInput, ex: Exercise, lang?: GradeLang): GradeResult {
  const a = answerForGrading(answer)
  if (answerInputIsEmpty(input) && a.kind !== 'truefalse') return invalidGrade(L(lang, 'Escribe o elige una respuesta primero.', 'Write or choose an answer first.'))
  if (a.kind === 'choice' && input.kind === 'choice') {
    const correct = new Set(a.options.filter((o) => o.correct).map((o) => o.id))
    const sel = new Set(input.ids)
    const ok = sel.size === correct.size && [...sel].every((x) => correct.has(x))
    const fb = a.options.filter((o) => sel.has(o.id) && !o.correct && o.why).map((o) => feedbackLine('explanation', o.why!))
    return makeGrade(ok ? 'correct' : 'incorrect', ok ? 1 : 0, { feedback: fb })
  }
  if (a.kind === 'truefalse' && input.kind === 'bool') return makeGrade(a.value === input.value ? 'correct' : 'incorrect', a.value === input.value ? 1 : 0)
  if (a.kind === 'numeric' && input.kind === 'text') {
    const got = Number(input.text.replace(/,/g, '.').trim()), want = Number(a.value)
    const ok = input.text.trim() !== '' && Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) < 1e-6
    const w = ex.wrongs.find((x) => basicNorm(x.input) === basicNorm(input.text))
    return makeGrade(ok ? 'correct' : 'incorrect', ok ? 1 : 0, { feedback: w ? [feedbackLine('explanation', w.why)] : [], matchedWrong: w })
  }
  if (a.kind === 'short' && input.kind === 'text') {
    const ok = a.accepted.some((x) => basicNorm(x) === basicNorm(input.text))
    return makeGrade(ok ? 'correct' : 'incorrect', ok ? 1 : 0)
  }
  if (a.kind === 'ordering' && input.kind === 'ordering') {
    const ok = input.items.length === a.items.length && input.items.every((x, i) => x === a.items[i])
    const inPlace = input.items.filter((x, i) => x === a.items[i]).length
    return makeGrade(ok ? 'correct' : 'incorrect', ok ? 1 : inPlace / Math.max(1, a.items.length))
  }
  if (a.kind === 'matching' && input.kind === 'matching') {
    const right = a.pairs.filter((p) => ownValue(input.pairs, p.left) === p.right).length
    const ok = right === a.pairs.length
    return makeGrade(ok ? 'correct' : right > 0 ? 'partial' : 'incorrect', right / Math.max(1, a.pairs.length))
  }
  if (a.kind === 'label' && input.kind === 'blanks') return gradeLabel(a, input.values, lang)
  if (a.kind === 'cloze' && input.kind === 'blanks') {
    const parts = a.blanks.map((bl, i) => {
      const ok = bl.accepted.some((x) => basicNorm(x) === basicNorm(input.values[i] ?? ''))
      return makeGrade(ok ? 'correct' : 'incorrect', ok ? 1 : 0)
    })
    const credit = parts.length ? parts.reduce((s, p) => s + p.credit, 0) / parts.length : 0
    return makeGrade(credit === 1 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { parts })
  }
  if (a.kind === 'multi' && input.kind === 'parts') {
    const parts = a.parts.map((p, i) => (i < input.parts.length ? basicAnswer(p.answer, input.parts[i], ex, lang) : invalidGrade(L(lang, `Falta responder la parte ${p.label}.`, `Part ${p.label} is not answered.`))))
    const total = a.parts.reduce((s, p) => s + p.points, 0)
    const credit = total > 0 ? a.parts.reduce((s, p, i) => s + p.points * parts[i].credit, 0) / total : 0
    return makeGrade(credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { parts })
  }
  return makeGrade('incorrect', 0, { needsReview: true })
}

export const basicCorrectAnswer = (ex: Exercise, lang?: GradeLang): string => describeAnswer(ex.answer, lang)
