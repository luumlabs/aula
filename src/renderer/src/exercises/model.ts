// Estado de un ejercicio mientras se resuelve (port de StudyUI/Exercise/ExerciseState.swift), como funciones puras:
// el borrador de la respuesta, los barajados estables, el paso a `AnswerInput` y el flujo (comprobar, reintentar, pistas,
// solución, autoevaluación). La vista (`useExercise`) solo guarda este estado y llama a estas funciones.
import type { Answer, AnswerPart, Exercise } from '@shared/schema/exercises'
import { effectiveLabelMode } from '@shared/schema/exercises'
import type { JSONValue } from '@engine/base/json'
import { answerInputIsEmpty } from '@engine/grading'
import { makeResult, type AnswerInput, type GradeResult } from './types'

// MARK: Barajado estable

const MASK = (1n << 64n) - 1n

/** Generador determinista pequeño (FNV-1a de la semilla + xorshift64), el mismo que `SeededShuffler` en Swift. */
export class SeededShuffler {
  private state: bigint
  constructor(seed: string) {
    let h = 1469598103934665603n
    for (const b of new TextEncoder().encode(seed)) h = ((h ^ BigInt(b)) * 1099511628211n) & MASK
    this.state = h === 0n ? 88172645463325252n : h
  }
  next(): bigint {
    let s = this.state
    s ^= (s << 13n) & MASK
    s ^= s >> 7n
    s ^= (s << 17n) & MASK
    this.state = s & MASK
    return this.state
  }
  shuffled<T>(a: readonly T[]): T[] {
    const r = [...a]
    for (let i = r.length - 1; i > 0; i--) {
      const j = Number(this.next() % BigInt(i + 1))
      ;[r[i], r[j]] = [r[j], r[i]]
    }
    return r
  }
}

/** Sin repetidos, en el orden en que aparecen. */
export function unique(a: readonly string[]): string[] {
  const seen = new Set<string>()
  return a.filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
}

/** Orden en que se enseñan las opciones (barajadas si la respuesta lo pide; siempre igual para el mismo ejercicio). */
export function choiceOrder(exerciseId: string, answer: Extract<Answer, { kind: 'choice' }>): string[] {
  const ids = unique(answer.options.map((o) => o.id))
  return answer.shuffle ? new SeededShuffler(exerciseId).shuffled(ids) : ids
}

/** Columna derecha de relacionar: las parejas y los distractores, barajados. */
export function rightsOrder(exerciseId: string, answer: Extract<Answer, { kind: 'matching' }>): string[] {
  return new SeededShuffler(exerciseId).shuffled(unique([...answer.pairs.map((p) => p.right), ...answer.extraRights]))
}

/** Orden de partida de ordenar: barajado y nunca el correcto (si hay más de un elemento). */
export function initialOrder(exerciseId: string, items: readonly string[]): string[] {
  if (items.length < 2) return [...items]
  const sh = new SeededShuffler(exerciseId)
  let s = sh.shuffled(items)
  for (let tries = 0; s.every((x, i) => x === items[i]) && tries < 6; tries++) s = sh.shuffled(items)
  return s
}

// MARK: Borrador

export interface Draft {
  text: string
  choice: string[]
  order: string[]
  /** El estudiante ya movió algo: el orden de partida es un barajado y sin tocarlo no cuenta como respondida. */
  orderTouched: boolean
  matches: Record<string, string>
  bool?: boolean
  blanks: string[]
  labels: string[]
  parts: Draft[]
}

/** El ejercicio de una parte (a, b, c…) de un ejercicio de varias partes. */
export function partExercise(parent: Exercise, part: AnswerPart): Exercise {
  return { ...parent, id: `${parent.id}/${part.label}`, answer: part.answer, prompt: part.prompt, hints: part.hints, points: part.points, solution: [], wrongs: [] }
}

export function initialDraft(ex: Pick<Exercise, 'id' | 'answer'>): Draft {
  const a = ex.answer
  const d: Draft = { text: '', choice: [], order: [], orderTouched: false, matches: {}, blanks: [], labels: [], parts: [] }
  switch (a.kind) {
    case 'ordering':
      d.order = initialOrder(ex.id, a.items)
      // con un solo elemento no hay nada que mover
      d.orderTouched = a.items.length < 2
      break
    case 'cloze':
      d.blanks = a.blanks.map(() => '')
      break
    case 'label':
      d.labels = a.spots.map(() => '')
      break
    case 'multi':
      d.parts = a.parts.map((p) => initialDraft({ id: `${ex.id}/${p.label}`, answer: p.answer }))
      break
    default:
      break
  }
  return d
}

/** El borrador como entrada para el corrector. */
export function draftInput(answer: Answer, d: Draft): AnswerInput {
  switch (answer.kind) {
    case 'choice': return { kind: 'choice', ids: [...d.choice] }
    case 'truefalse': return d.bool === undefined ? { kind: 'none' } : { kind: 'bool', value: d.bool }
    case 'ordering': return d.orderTouched ? { kind: 'ordering', items: [...d.order] } : { kind: 'none' }
    case 'matching': return { kind: 'matching', pairs: { ...d.matches } }
    case 'cloze': return { kind: 'blanks', values: [...d.blanks] }
    case 'label': return { kind: 'blanks', values: [...d.labels] }
    case 'multi': return { kind: 'parts', parts: answer.parts.map((p, i) => draftInput(p.answer, d.parts[i] ?? initialDraft({ id: '', answer: p.answer }))) }
    default: return { kind: 'text', text: d.text }
  }
}

/** ¿No contestó nada? (un verdadero/falso nunca está vacío) */
export const inputIsEmpty = answerInputIsEmpty

export function draftHasInput(answer: Answer, d: Draft): boolean {
  if (answer.kind === 'multi') return answer.parts.some((p, i) => draftHasInput(p.answer, d.parts[i] ?? initialDraft({ id: '', answer: p.answer })))
  if (answer.kind === 'ordering') return d.orderTouched
  return !inputIsEmpty(draftInput(answer, d))
}

/** Clave estable de una entrada (para saber si la respuesta cambió desde que se comprobó). */
export function inputKey(i: AnswerInput): string {
  switch (i.kind) {
    case 'choice': return JSON.stringify({ c: [...i.ids].sort() })
    case 'matching': return JSON.stringify({ m: Object.entries(i.pairs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) })
    case 'parts': return JSON.stringify({ p: i.parts.map(inputKey) })
    default: return JSON.stringify(i)
  }
}

/** Lo que escribió o eligió el estudiante, como texto (para el cuaderno de errores y el tutor). */
export function inputSummary(answer: Answer, d: Draft, words: { true: string; false: string } = { true: 'Verdadero', false: 'Falso' }): string | undefined {
  switch (answer.kind) {
    case 'choice': {
      const chosen = answer.options.filter((o) => d.choice.includes(o.id)).map((o) => o.md)
      return chosen.length ? chosen.join('; ') : undefined
    }
    case 'truefalse': return d.bool === undefined ? undefined : d.bool ? words.true : words.false
    case 'ordering': return d.orderTouched && d.order.length ? d.order.join(' → ') : undefined
    case 'matching': {
      const e = Object.entries(d.matches)
      return e.length ? e.map(([l, r]) => `${l} → ${r}`).sort().join('; ') : undefined
    }
    case 'cloze': {
      const b = d.blanks.filter((x) => x.trim() !== '')
      return b.length ? b.join(' | ') : undefined
    }
    case 'label': {
      if (effectiveLabelMode(answer) === 'locate') return d.labels.some((x) => x) ? d.labels.join(' | ') : undefined
      const b = d.labels.filter((x) => x.trim() !== '')
      return b.length ? b.join(' | ') : undefined
    }
    case 'multi': {
      const p = answer.parts.map((part, i) => inputSummary(part.answer, d.parts[i] ?? initialDraft({ id: '', answer: part.answer }), words)).filter((x): x is string => !!x)
      return p.length ? p.join(' / ') : undefined
    }
    default: return d.text.trim() === '' ? undefined : d.text
  }
}

// MARK: Guardar y recuperar lo escrito (simulacro en curso, comprobación guiada)

/** Lo escrito o elegido como JSON (undefined si no hay nada), con las mismas claves que la app Swift. */
export function snapshotDraft(answer: Answer, d: Draft): JSONValue | undefined {
  const o: Record<string, JSONValue> = {}
  if (d.text) o.text = d.text
  if (d.choice.length) o.choice = [...d.choice].sort()
  if (answer.kind === 'ordering' && d.orderTouched) o.order = [...d.order]
  if (Object.keys(d.matches).length) o.matches = { ...d.matches }
  if (d.bool !== undefined) o.bool = d.bool
  if (d.blanks.some((x) => x)) o.blanks = [...d.blanks]
  if (d.labels.some((x) => x)) o.labels = [...d.labels]
  if (answer.kind === 'multi' && d.parts.length) {
    const ps = answer.parts.map((p, i) => snapshotDraft(p.answer, d.parts[i] ?? initialDraft({ id: '', answer: p.answer })) ?? null)
    if (ps.some((x) => x !== null)) o.parts = ps
  }
  return Object.keys(o).length ? o : undefined
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)

/** Vuelve a poner lo guardado (lo que no encaja con el ejercicio actual se ignora). */
export function restoreDraft(answer: Answer, base: Draft, v: unknown): Draft {
  if (!isObject(v)) return base
  const d: Draft = { ...base, parts: [...base.parts] }
  if (typeof v.text === 'string') d.text = v.text
  const c = strings(v.choice)
  if (c) d.choice = c
  const order = strings(v.order)
  if (order && [...order].sort().join('\u0000') === [...d.order].sort().join('\u0000')) {
    d.order = order
    d.orderTouched = true
  }
  if (isObject(v.matches)) d.matches = Object.fromEntries(Object.entries(v.matches).filter((e): e is [string, string] => typeof e[1] === 'string'))
  if (typeof v.bool === 'boolean') d.bool = v.bool
  const b = strings(v.blanks)
  if (b && b.length === d.blanks.length) d.blanks = b
  const l = strings(v.labels)
  if (l && l.length === d.labels.length) d.labels = l
  if (answer.kind === 'multi' && Array.isArray(v.parts)) {
    d.parts = answer.parts.map((p, i) => restoreDraft(p.answer, d.parts[i] ?? initialDraft({ id: '', answer: p.answer }), (v.parts as unknown[])[i]))
  }
  return d
}

/** La entrada que corresponde a lo guardado (simulacro): lo que se corrige al entregar. */
export function snapshotInput(ex: Pick<Exercise, 'id' | 'answer'>, snapshot: unknown): AnswerInput {
  return draftInput(ex.answer, restoreDraft(ex.answer, initialDraft(ex), snapshot))
}

// MARK: Flujo

export interface RunState {
  draft: Draft
  result?: GradeResult
  /** Lo que estaba escrito al comprobar (si cambia, el resultado queda obsoleto). */
  checkedKey?: string
  attempts: number
  hintsShown: number
  /** Pistas vistas de cada parte (ejercicios de varias partes). */
  partHints: number[]
  revealed: boolean
  /** Cerrado tras el primer resultado (comprobación guiada): no se puede cambiar ni volver a comprobar. */
  closed: boolean
  reportedFirst: boolean
  continued: boolean
  startedAt: number
  finishedAt?: number
  /** Cambian con cada comprobación (para animaciones). */
  successPulse: number
  errorPulse: number
  /** Corrigiendo con la IA (respuestas abiertas). */
  grading: boolean
}

export function initialRun(ex: Exercise, snapshot?: unknown, now = Date.now()): RunState {
  const base = initialDraft(ex)
  return {
    draft: snapshot === undefined ? base : restoreDraft(ex.answer, base, snapshot),
    attempts: 0, hintsShown: 0, partHints: ex.answer.kind === 'multi' ? ex.answer.parts.map(() => 0) : [], revealed: false, closed: false,
    reportedFirst: false, continued: false, startedAt: now, successPulse: 0, errorPulse: 0, grading: false
  }
}

export const runInput = (ex: Exercise, s: RunState): AnswerInput => draftInput(ex.answer, s.draft)
export const isFinished = (s: RunState): boolean => s.result?.status === 'correct' || s.revealed || s.closed
export const isStale = (ex: Exercise, s: RunState): boolean => !!s.result && !isFinished(s) && s.checkedKey !== undefined && s.checkedKey !== inputKey(runInput(ex, s))
/** Hay un resultado (que no sea «no se entendió») y la respuesta no ha cambiado desde entonces. */
export const isChecked = (ex: Exercise, s: RunState): boolean => !!s.result && s.result.status !== 'invalid' && !isStale(ex, s)

export function canCheck(ex: Exercise, s: RunState): boolean {
  if (isFinished(s) || s.grading) return false
  if (s.result && !isStale(ex, s) && s.result.status !== 'invalid') return false
  return draftHasInput(ex.answer, s.draft)
}

/** Respuesta abierta (o corta) a la espera de que el estudiante se autoevalúe. */
export function needsSelfReview(ex: Exercise, s: RunState): boolean {
  const r = s.result
  if (!r || !r.needsReview || r.status === 'correct' || s.revealed || isStale(ex, s)) return false
  return ex.answer.kind === 'open' || ex.answer.kind === 'short'
}

/** Comprobado y mal (y sin cambiar la respuesta desde entonces). */
export const checkedWrong = (ex: Exercise, s: RunState): boolean => isChecked(ex, s) && s.result?.status !== 'correct' && !isFinished(s) && !needsSelfReview(ex, s)

/** Verdadero/falso o dos opciones: un segundo intento no enseña nada. */
export function isBinary(a: Answer): boolean {
  return a.kind === 'truefalse' || (a.kind === 'choice' && !a.multi && a.options.length <= 2)
}

/** Aplica un resultado de la corrección (y, en lo binario, enseña la solución si falló). */
export function applyResult(ex: Exercise, s: RunState, r: GradeResult, now = Date.now()): RunState {
  const valid = r.status !== 'invalid'
  const next: RunState = {
    ...s,
    result: r,
    checkedKey: inputKey(runInput(ex, s)),
    attempts: valid ? s.attempts + 1 : s.attempts,
    finishedAt: valid ? now : s.finishedAt,
    grading: false,
    successPulse: r.status === 'correct' ? s.successPulse + 1 : s.successPulse,
    errorPulse: (r.status === 'incorrect' || r.status === 'partial') && !r.needsReview ? s.errorPulse + 1 : s.errorPulse
  }
  if (r.status === 'incorrect' && isBinary(ex.answer)) next.revealed = true
  return next
}

/** Autoevaluación (respuesta abierta con rúbrica o corta revisada a mano): fija el resultado y termina el ejercicio. */
export function applySelfGrade(ex: Exercise, s: RunState, raw: number, now = Date.now()): RunState {
  const credit = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
  const r = makeResult(credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { feedback: s.result?.feedback ?? [] })
  return { ...s, result: r, checkedKey: inputKey(runInput(ex, s)), revealed: true, finishedAt: s.finishedAt ?? now, successPulse: credit >= 0.999 ? s.successPulse + 1 : s.successPulse }
}

/** Crédito final para el progreso: solo cuenta el primer intento; cada pista resta un poco. */
export function finalCredit(first: GradeResult | undefined, hints: number): number {
  if (!first || !Number.isFinite(first.credit)) return 0
  return Math.min(1, Math.max(0, first.credit - 0.1 * hints * (first.credit > 0 ? 1 : 0)))
}

/** Pistas usadas en total (las del ejercicio o la parte con más). */
export const hintsUsed = (s: RunState): number => Math.max(s.hintsShown, ...s.partHints, 0)

export const elapsedSeconds = (s: RunState, now = Date.now()): number => Math.max(0, ((s.finishedAt ?? now) - s.startedAt) / 1000)
