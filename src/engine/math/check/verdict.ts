import { tr } from '../core/i18n'

/** Etiquetas legibles por máquina que explican el error probable de una respuesta. */
export type Diagnosis =
  | 'signError' | 'reciprocal' | 'factorOfTen' | 'factorOfTwo' | 'percentVsFraction' | 'degreesVsRadians' | 'radiansVsDegrees'
  | 'rounding' | 'truncation' | 'forgotSquareRoot' | 'forgotSquare' | 'offByOne' | 'unitMissing' | 'unitWrong' | 'unitConversion'
  | 'notSimplified' | 'notFactored' | 'notExpanded' | 'notReduced' | 'decimalInsteadOfFraction' | 'fractionInsteadOfDecimal'
  | 'extraSolution' | 'missingSolution' | 'orderMatters' | 'wrongInterval' | 'sameAsExpected' | 'other'

/**
 * Resultado de la comprobación:
 * - `correct`: respuesta correcta;
 * - `incorrect`: se entendió la respuesta y es incorrecta;
 * - `partial`: parcialmente correcta (crédito entre 0 y 1);
 * - `formatProblem`: no se pudo interpretar lo escrito (no debería contar como intento fallido);
 * - `wrongForm`: el valor es correcto pero no está en la forma pedida.
 */
export type VerdictStatus = 'correct' | 'incorrect' | 'partial' | 'formatProblem' | 'wrongForm'

/** Resultado de comprobar una respuesta. Los verificadores nunca lanzan: todo problema se expresa aquí. */
export interface CheckVerdict {
  /** Estado del veredicto. */
  status: VerdictStatus
  /** Crédito de 0 a 1. */
  credit: number
  /** Mensaje corto y accionable para el estudiante, ya localizado. Ausente si no hay nada que decir. */
  message?: string
  /** Etiquetas de error probable, de la más a la menos probable. */
  diagnosis: Diagnosis[]
  /** Cómo se entendió lo escrito (texto normalizado). */
  normalizedInput?: string
  /** Vista previa en LaTeX de lo escrito. */
  latexInput?: string
}

/** Longitud máxima (en caracteres) de una respuesta que se intenta interpretar. */
export const MAX_INPUT_LENGTH = 2000

function make(status: VerdictStatus, credit: number, message: string | null | undefined, diagnosis: Diagnosis[], normalized?: string | null, latex?: string | null): CheckVerdict {
  const v: CheckVerdict = { status, credit, diagnosis }
  if (message !== null && message !== undefined) v.message = message
  if (normalized !== null && normalized !== undefined) v.normalizedInput = normalized
  if (latex !== null && latex !== undefined) v.latexInput = latex
  return v
}

/** Constructores y utilidades de veredictos. */
export const Verdict = {
  make,

  get tooLongMessage(): string {
    return tr('La respuesta es demasiado larga: escríbela de forma más corta.')
  },

  format(message: string, normalized?: string | null, latex?: string | null): CheckVerdict {
    return make('formatProblem', 0, message, [], normalized, latex)
  },

  correct(message?: string | null, normalized?: string | null, latex?: string | null): CheckVerdict {
    return make('correct', 1, message, [], normalized, latex)
  },

  wrong(message: string | null | undefined, diagnosis: Diagnosis[] = ['other'], normalized?: string | null, latex?: string | null): CheckVerdict {
    return make('incorrect', 0, message, diagnosis, normalized, latex)
  },

  partial(credit: number, message: string | null | undefined, diagnosis: Diagnosis[], normalized?: string | null, latex?: string | null): CheckVerdict {
    return make('partial', credit, message, diagnosis, normalized, latex)
  },

  wrongForm(message: string, diagnosis: Diagnosis[], credit = 0.5, normalized?: string | null, latex?: string | null): CheckVerdict {
    return make('wrongForm', credit, message, diagnosis, normalized, latex)
  },

  /** `true` si el estado es `correct`. */
  isCorrect(v: CheckVerdict): boolean {
    return v.status === 'correct'
  },

  /** ¿Tiene esta etiqueta de diagnóstico? */
  has(v: CheckVerdict, d: Diagnosis): boolean {
    return v.diagnosis.includes(d)
  },

  /** Añade una frase al mensaje existente. */
  appending(v: CheckVerdict, extra: string | null | undefined): CheckVerdict {
    if (!extra) return v
    const out = { ...v }
    out.message = v.message ? v.message + ' ' + extra : extra
    return out
  },

  /** Rellena el texto normalizado y el LaTeX si faltan. */
  withInput(v: CheckVerdict, normalized: string | null | undefined, latex: string | null | undefined): CheckVerdict {
    const out = { ...v }
    if (out.normalizedInput === undefined && normalized !== null && normalized !== undefined) out.normalizedInput = normalized
    if (out.latexInput === undefined && latex !== null && latex !== undefined) out.latexInput = latex
    return out
  },

  /** Orden de preferencia entre veredictos de distintas lecturas de un mismo texto (mayor = mejor). */
  readingRank(v: CheckVerdict): number {
    const base = { correct: 5, wrongForm: 4, partial: 3, incorrect: 2, formatProblem: 1 }[v.status]
    return base + v.credit * 0.5
  },

  /** El mejor veredicto de varias lecturas; a igualdad, el primero (la lectura preferida va primero). */
  best(readings: readonly CheckVerdict[]): CheckVerdict | null {
    let best: CheckVerdict | null = null
    for (const v of readings) if (best === null || Verdict.readingRank(v) > Verdict.readingRank(best)) best = v
    return best
  },
}
