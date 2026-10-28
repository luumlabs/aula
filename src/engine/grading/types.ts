// Entrada del estudiante y resultado de la corrección (port de StudyEngine/Grading/GradeTypes.swift).
// Isomorfo: lo usan el proceso principal (registrar intentos, simulacros) y la interfaz (corregir al instante).
import { setOwn, type WrongAnswer } from '@shared/schema'

/** Idioma de los mensajes que escribe el corrector (el resto de la interfaz va con i18n). */
export type GradeLang = 'es' | 'en'

/**
 * Lo que contestó el estudiante (la forma depende del tipo de ejercicio), como `AnswerInput` de Swift:
 * - `text`: numeric · expression · equation · set · interval · point · short · chem · open
 * - `choice`: ids de las opciones marcadas (choice)
 * - `ordering`: los elementos en el orden elegido (ordering)
 * - `matching`: izquierda → derecha elegida (matching)
 * - `bool`: verdadero/falso (truefalse)
 * - `blanks`: un texto por hueco (cloze) o por punto (label; en «señala la parte», «x,y» en fracciones de la figura)
 * - `parts`: una entrada por parte (multi)
 */
export type AnswerInput =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'choice'; ids: string[] }
  | { kind: 'ordering'; items: string[] }
  | { kind: 'matching'; pairs: Record<string, string> }
  | { kind: 'bool'; value: boolean }
  | { kind: 'blanks'; values: string[] }
  | { kind: 'parts'; parts: AnswerInput[] }

export type AnswerInputKind = AnswerInput['kind']

/** Atajos para construir entradas. */
export const Input = {
  none: (): AnswerInput => ({ kind: 'none' }),
  text: (text: string): AnswerInput => ({ kind: 'text', text }),
  choice: (ids: Iterable<string>): AnswerInput => ({ kind: 'choice', ids: [...new Set(ids)] }),
  ordering: (items: string[]): AnswerInput => ({ kind: 'ordering', items }),
  matching: (pairs: Record<string, string>): AnswerInput => {
    const own: Record<string, string> = {}
    for (const [k, v] of Object.entries(pairs)) setOwn(own, k, v)
    return { kind: 'matching', pairs: own }
  },
  bool: (value: boolean): AnswerInput => ({ kind: 'bool', value }),
  blanks: (values: string[]): AnswerInput => ({ kind: 'blanks', values }),
  parts: (parts: AnswerInput[]): AnswerInput => ({ kind: 'parts', parts })
}

/** ¿No contestó nada? (un verdadero/falso nunca está vacío). */
export function answerInputIsEmpty(input: AnswerInput): boolean {
  switch (input.kind) {
    case 'none': return true
    case 'text': return input.text.trim() === ''
    case 'choice': return input.ids.length === 0
    case 'ordering': return input.items.length === 0
    case 'matching': return Object.keys(input.pairs).length === 0
    case 'bool': return false
    case 'blanks': return input.values.every((b) => b.trim() === '')
    case 'parts': return input.parts.every(answerInputIsEmpty)
  }
}

/** Tipo de línea de «¿Qué pasó?»: elogio, error, explicación (del autor), pista, aviso (formato) o información. */
export type FeedbackKind = 'praise' | 'error' | 'explanation' | 'hint' | 'warning' | 'info'

export interface FeedbackLine {
  kind: FeedbackKind
  /** Markdown con matemáticas ($…$). */
  markdown: string
}

export const feedbackLine = (kind: FeedbackKind, markdown: string): FeedbackLine => ({ kind, markdown })

/** correct · incorrect · partial · invalid (no se pudo leer: no cuenta como intento fallido). */
export type GradeStatus = 'correct' | 'incorrect' | 'partial' | 'invalid'

export interface GradeResult {
  status: GradeStatus
  /** 0…1 (siempre finito). */
  credit: number
  /** Mensajes para el estudiante: error típico del autor, diagnóstico automático, explicación de la opción elegida… */
  feedback: FeedbackLine[]
  /** El error típico del autor con el que coincide la respuesta (si lo hay). */
  matchedWrong?: WrongAnswer
  /** Etiquetas técnicas del diagnóstico de los verificadores matemáticos (p. ej. «signError»). */
  diagnosis: string[]
  /** Cómo entendió Aula lo escrito (texto plano y LaTeX), para enseñarlo de vuelta. */
  echoPlain?: string
  echoTeX?: string
  /** Resultado por parte (multi), por hueco (cloze) o por punto (label). */
  parts: GradeResult[]
  /** Respuesta abierta (o corta «con IA») que conviene que corrija la IA o el propio estudiante con la rúbrica. */
  needsReview: boolean
  /** Lo mismo que `needsReview`, con el nombre que usa la interfaz: hace falta la IA (`study.gradeOpen`) o autoevaluarse. */
  needsAI: boolean
}

/** Opciones de la corrección. */
export interface GradeOptions {
  /** Idioma de los mensajes propios del corrector (los de los verificadores matemáticos y químicos siguen su traductor). */
  lang?: GradeLang
  /**
   * Corrección del curso para los huecos y respuestas cortas que no dicen `exact`: true = exacta (tildes, ortografía y artículos
   * cuentan; los cursos de idiomas, ver `courseGradeOptions`). Sin él, tolerante (sin tildes y con erratas leves), como siempre.
   */
  exactText?: boolean
}

/** Resultado con los valores por defecto para lo que no se indique. */
export function makeGrade(status: GradeStatus, credit: number, more: Partial<Omit<GradeResult, 'status' | 'credit'>> = {}): GradeResult {
  const needs = more.needsReview ?? more.needsAI ?? false
  const r: GradeResult = { status, credit, feedback: [], diagnosis: [], parts: [], ...more, needsReview: needs, needsAI: needs }
  if (r.matchedWrong === undefined) delete r.matchedWrong
  if (r.echoPlain === undefined) delete r.echoPlain
  if (r.echoTeX === undefined) delete r.echoTeX
  return r
}

/** «No se pudo leer» con un aviso. */
export function invalidGrade(message: string): GradeResult {
  return makeGrade('invalid', 0, { feedback: [feedbackLine('warning', message)] })
}

/** Marca (o desmarca) que hace falta la IA o la autoevaluación, manteniendo los dos nombres iguales. */
export function withReview(r: GradeResult, needs: boolean): GradeResult {
  return { ...r, needsReview: needs, needsAI: needs }
}

/** El mismo resultado con el crédito siempre entre 0 y 1 (un NaN o un infinito llegaban al progreso y a la interfaz). */
export function sanitizedGrade(r: GradeResult): GradeResult {
  const credit = Number.isFinite(r.credit) ? Math.min(Math.max(r.credit, 0), 1) : 0
  const out: GradeResult = { ...r, credit, needsAI: r.needsReview }
  if (r.parts.length) out.parts = r.parts.map(sanitizedGrade)
  return out
}

export const isCorrectGrade = (r: GradeResult): boolean => r.status === 'correct'

/** Lee una entrada que llega de fuera (IPC, archivo): undefined si no tiene la forma de `AnswerInput`. */
export function decodeAnswerInput(raw: unknown, depth = 0): AnswerInput | undefined {
  if (depth > 8 || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const strings = (v: unknown, max = 500): string[] | undefined =>
    Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 20_000) ? (v as string[]) : undefined
  switch (o.kind) {
    case 'none': return { kind: 'none' }
    case 'text': return typeof o.text === 'string' && o.text.length <= 20_000 ? { kind: 'text', text: o.text } : undefined
    case 'choice': { const ids = strings(o.ids); return ids ? Input.choice(ids) : undefined }
    case 'ordering': { const items = strings(o.items); return items ? { kind: 'ordering', items } : undefined }
    case 'blanks': { const values = strings(o.values); return values ? { kind: 'blanks', values } : undefined }
    case 'bool': return typeof o.value === 'boolean' ? { kind: 'bool', value: o.value } : undefined
    case 'matching': {
      const p = o.pairs
      if (typeof p !== 'object' || p === null || Array.isArray(p)) return undefined
      const pairs: Record<string, string> = {}
      const entries = Object.entries(p as Record<string, unknown>)
      if (entries.length > 500) return undefined
      for (const [k, v] of entries) { if (typeof v !== 'string') return undefined; setOwn(pairs, k, v) }
      return { kind: 'matching', pairs }
    }
    case 'parts': {
      if (!Array.isArray(o.parts) || o.parts.length > 50) return undefined
      const parts = o.parts.map((x) => decodeAnswerInput(x, depth + 1))
      return parts.every((x) => x !== undefined) ? { kind: 'parts', parts: parts as AnswerInput[] } : undefined
    }
    default: return undefined
  }
}
