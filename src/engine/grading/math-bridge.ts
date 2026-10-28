// Puente con los verificadores matemáticos (`AnswerChecker` de MathKit, en @engine/math). Por defecto se usan los del motor
// matemático, así que el proceso principal y la interfaz corrigen igual sin instalar nada; `setMathCheckers` existe para
// las pruebas (o para sustituir un verificador concreto). Nunca lanzan: un error inesperado es un problema de formato.
import { AnswerChecker as MathAnswerChecker, MathError, Verdict, mathTr, type CheckVerdict, type ExpressionSpec, type NumericSpec, type TextMatchOptions } from '@engine/math'

/** La interfaz de `AnswerChecker` que usa el corrector. Los verificadores nunca lanzan. */
export interface MathCheckers {
  checkNumeric(input: string, spec: NumericSpec): CheckVerdict
  checkExpression(input: string, spec: ExpressionSpec): CheckVerdict
  checkEquation(input: string, expected: string, variables?: readonly string[] | null): CheckVerdict
  checkSet(input: string, expected: readonly string[], ordered: boolean): CheckVerdict
  checkInterval(input: string, expected: string): CheckVerdict
  checkPoint(input: string, expected: readonly string[], absTol: number): CheckVerdict
  checkText(input: string, accepted: readonly string[], rejected?: readonly string[], options?: TextMatchOptions): CheckVerdict
}

const engine: MathCheckers = MathAnswerChecker
let active: MathCheckers = engine

/** Sustituye verificadores concretos (los que no se den siguen siendo los del motor matemático). */
export function setMathCheckers(c: Partial<MathCheckers>): void {
  active = { ...active, ...c }
}

/** Vuelve a los verificadores del motor matemático (pruebas). */
export function resetMathCheckers(): void {
  active = engine
}

/** Los verificadores en uso. Nunca lanzan: un error inesperado es un problema de formato. */
export const AnswerChecker: MathCheckers = {
  checkNumeric: (i, s) => safe(() => active.checkNumeric(i, s)),
  checkExpression: (i, s) => safe(() => active.checkExpression(i, s)),
  checkEquation: (i, e, v) => safe(() => active.checkEquation(i, e, v)),
  checkSet: (i, e, o) => safe(() => active.checkSet(i, e, o)),
  checkInterval: (i, e) => safe(() => active.checkInterval(i, e)),
  checkPoint: (i, e, t) => safe(() => active.checkPoint(i, e, t)),
  checkText: (i, a, r, o) => safe(() => active.checkText(i, a, r, o))
}

function safe(run: () => CheckVerdict): CheckVerdict {
  try { return run() } catch (err) {
    return Verdict.format(err instanceof MathError ? err.message : mathTr('No pude leer tu respuesta.'))
  }
}
