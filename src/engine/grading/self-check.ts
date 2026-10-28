// Comprobaciones matemáticas del contenido que escribe la IA (port de MathKitChecker en StudyEngine/Math/MathServices.swift):
// expresiones que se entienden, valores numéricos válidos y ejercicios que se aprueban a sí mismos.
import type { Answer, ContentIssue, Exercise, WrongAnswer } from '@shared/schema'
import { MathKitChecker as MathKit } from '@engine/math'
import { canonicalInput } from './describe'
import { gradeAnswer } from './grader'
import { Input } from './types'

/** Lo que el validador necesita del motor matemático (se inyecta para que funcione también sin él). */
export interface MathChecking {
  /** undefined = válida; si no, un mensaje (en español) con la causa. */
  checkExpression(text: string, variables: ReadonlySet<string> | null): string | undefined
  checkNumericValue(text: string): string | undefined
  /** Corrige el ejercicio con su propia respuesta canónica y devuelve los problemas si no se aprueba a sí mismo. */
  selfCheck(exercise: Exercise): ContentIssue[]
}

/** Sin motor matemático: solo comprueba que no esté vacío. */
export const NoMathChecker: MathChecking = {
  checkExpression: (t) => (t.trim() === '' ? 'está vacía' : undefined),
  checkNumericValue: (t) => (t.trim() === '' ? 'está vacío' : undefined),
  selfCheck: () => []
}

/** Comparaciones (`<`, `<=`, `==`, `!=`, `=`) se comprueban lado por lado. */
export function relationSides(text: string): string[] {
  return MathKit.sides(text)
}

/** Las comprobaciones de MathKit (expresiones y valores) más la autocomprobación de las claves con el corrector. */
export const MathKitChecker: MathChecking = {
  checkExpression: (text, variables) => MathKit.checkExpression(text, variables) ?? undefined,
  checkNumericValue: (text) => MathKit.checkNumericValue(text) ?? undefined,

  selfCheck(exercise) {
    const out: ContentIssue[] = []
    checkAnswerKey(exercise.answer, exercise.wrongs, `exercises[${exercise.id}].answer`, out)
    return out
  }
}

function checkAnswerKey(a: Answer, wrongs: readonly WrongAnswer[], path: string, out: ContentIssue[]): void {
  if (a.kind === 'multi') {
    for (const p of a.parts) checkAnswerKey(p.answer, [], `${path}.parts[${p.label}]`, out)
    return
  }
  const input = canonicalInput(a)
  if (!input) return
  const r = gradeAnswer(a, input, [])
  if (r.status !== 'correct') {
    const why = r.feedback[0]?.markdown ?? `estado ${r.status}`
    out.push({ severity: 'error', path, message: `La clave de respuesta no se acepta a sí misma (${why}). Revisa el valor esperado y el formato pedido.` })
  }
  // un «error típico» que en realidad se acepta como correcto es una contradicción (se miran los 40 primeros)
  if (['numeric', 'expression', 'equation', 'set', 'interval', 'point', 'short'].includes(a.kind)) {
    wrongs.slice(0, 40).forEach((w, i) => {
      if (gradeAnswer(a, Input.text(w.input), []).status === 'correct') {
        out.push({ severity: 'warning', path: path.replace('.answer', `.wrongs[${i}]`), message: `El error típico «${w.input}» se acepta como respuesta correcta: no es un error.` })
      }
    })
  }
}
