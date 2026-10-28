// Corrector de ejercicios (port de StudyEngine/Math/ExerciseGrader.swift): compara números, expresiones, ecuaciones,
// conjuntos, intervalos y puntos con los verificadores matemáticos, la química con el motor químico, y el resto (opciones,
// huecos, ordenar, emparejar, rotular, señalar) aquí. Los «errores típicos» del autor tienen prioridad sobre el diagnóstico
// automático. Las respuestas abiertas no se corrigen aquí: `needsReview`/`needsAI` (las corrige la IA o el estudiante).
import {
  answerForGrading, effectiveLabelMode, effectiveAspect, figurePartNames, labelAnswerParts, FigureGeometry, ownValue,
  type Answer, type AnswerOf, type Exercise, type WrongAnswer
} from '@shared/schema'
import { MathParser } from '@engine/math/parse/parser'
import { freeVariables } from '@engine/math/core/expr'
import { tryEvaluateDouble } from '@engine/math/eval/evaluate'
import { MathEquivalence } from '@engine/math/check/equivalence'
import { angleModeLenient } from '@engine/math/core/types'
import { expressionFormLenient, numericFormLenient, unitModeLenient, type NumericSpec, type ExpressionSpec } from '@engine/math/check/specs'
import type { CheckVerdict } from '@engine/math/check/verdict'
import { ChemChecker } from '@engine/chem/checker'
import type { ChemCheck } from '@engine/chem/types'
import { AnswerChecker } from './math-bridge'
import { textMatchOptions as defaultTextOptions } from '@engine/math'
import { L } from './messages'
import { EXACT_TEXT_OPTIONS, nearMissGrade } from './exact-text'
import {
  answerInputIsEmpty, feedbackLine, invalidGrade, makeGrade, sanitizedGrade, withReview,
  type AnswerInput, type FeedbackKind, type FeedbackLine, type GradeLang, type GradeOptions, type GradeResult
} from './types'

/** Corrige un ejercicio con lo que contestó el estudiante. Nunca lanza; el crédito siempre está entre 0 y 1. */
export function grade(exercise: Exercise, input: AnswerInput, opts: GradeOptions = {}): GradeResult {
  return sanitizedGrade(gradeAnswer(exercise.answer, input, exercise.wrongs, opts))
}

/** Las opciones de la corrección (o solo su idioma, como antes). */
const optionsOf = (o: GradeOptions | GradeLang | undefined): GradeOptions => (typeof o === 'string' ? { lang: o } : o ?? {})

/** Corrige una respuesta (o una parte de un ejercicio por apartados). */
export function gradeAnswer(answer: Answer, input: AnswerInput, wrongs: readonly WrongAnswer[], options?: GradeOptions | GradeLang): GradeResult {
  const opts = optionsOf(options)
  const lang = opts.lang
  const a = answerForGrading(answer)
  if (answerInputIsEmpty(input) && a.kind !== 'truefalse') return invalidGrade(L(lang, 'Escribe o elige una respuesta primero.', 'Write or choose an answer first.'))
  switch (a.kind) {
    case 'choice': if (input.kind === 'choice') return gradeChoice(a, input.ids, lang); break
    case 'truefalse': if (input.kind === 'bool') return a.value === input.value ? makeGrade('correct', 1) : makeGrade('incorrect', 0); break
    case 'numeric': if (input.kind === 'text') return convert(AnswerChecker.checkNumeric(input.text, numericSpecOf(a)), input.text, wrongs); break
    case 'expression': if (input.kind === 'text') return convert(AnswerChecker.checkExpression(input.text, expressionSpecOf(a)), input.text, wrongs); break
    case 'equation': if (input.kind === 'text') return convert(AnswerChecker.checkEquation(input.text, a.expected, a.variables ?? null), input.text, wrongs, true); break
    case 'set': if (input.kind === 'text') return convert(AnswerChecker.checkSet(input.text, a.expected, a.ordered), input.text, wrongs); break
    case 'interval': if (input.kind === 'text') return convert(AnswerChecker.checkInterval(input.text, a.expected), input.text, wrongs); break
    case 'point': if (input.kind === 'text') return convert(AnswerChecker.checkPoint(input.text, a.expected, a.absTol), input.text, wrongs); break
    case 'short': if (input.kind === 'text') return gradeShort(a, input.text, wrongs, opts); break
    case 'cloze': if (input.kind === 'blanks') return gradeCloze(a, input.values, opts); break
    case 'ordering': if (input.kind === 'ordering') return gradeOrdering(a, input.items, lang); break
    case 'matching': if (input.kind === 'matching') return gradeMatching(a, input.pairs, lang); break
    case 'label': if (input.kind === 'blanks') return gradeLabel(a, input.values, lang); break
    case 'multi': if (input.kind === 'parts') return gradeMulti(a, input.parts, opts); break
    case 'chem': if (input.kind === 'text') return gradeChem(a, input.text, lang); break
    case 'open': return makeGrade('incorrect', 0, { needsReview: true })
  }
  return invalidGrade(L(lang, 'Ese tipo de respuesta no corresponde a este ejercicio.', "That kind of answer doesn't fit this exercise."))
}

// MARK: Ejercicios por apartados

function gradeMulti(m: AnswerOf<'multi'>, inputs: readonly AnswerInput[], opts: GradeOptions): GradeResult {
  const lang = opts.lang
  const parts = m.parts.map((p, i) => i < inputs.length
    ? sanitizedGrade(gradeAnswer(p.answer, inputs[i], [], opts))
    : invalidGrade(L(lang, `Falta responder la parte ${p.label}.`, `Part ${p.label} is not answered.`)))
  if (parts.length && parts.every((p) => p.status === 'invalid')) return invalidGrade(L(lang, 'Responde al menos una parte.', 'Answer at least one part.'))
  // pesos de las partes: negativos, gigantes (la suma da ∞ y el crédito NaN) o todos cero → partes iguales
  let weights = m.parts.map((p) => (Number.isFinite(p.points) && p.points > 0 ? p.points : 0))
  const sum = weights.reduce((s, w) => s + w, 0)
  if (!(sum > 0) || !Number.isFinite(sum)) weights = m.parts.map(() => 1)
  const total = weights.reduce((s, w) => s + w, 0)
  const credit = total > 0 ? weights.reduce((s, w, i) => s + w * parts[i].credit, 0) / total : 0
  // como en Swift, el resultado del ejercicio no queda «pendiente de revisión» aunque una parte lo esté (cada parte lo dice en
  // `parts`): si no, un apartado corto «con IA» bloqueaba la lección guiada, que descarta las notas pendientes
  return makeGrade(credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect', credit, { parts })
}

// MARK: Química

/** Valor de una clave numérica de química: «0.250», «2.5e-3», «3/4». */
export function chemNumber(text: string): number | undefined {
  const t = text.trim().replace(/,/g, '.')
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) { const d = Number(t); return Number.isFinite(d) ? d : undefined }
  const numeric = /^[0-9.eE+\-/* ()]*/.exec(t)?.[0] ?? ''
  try {
    const e = MathParser.parse(numeric)
    if (freeVariables(e).size) return undefined
    const v = tryEvaluateDouble(e)
    return v !== null && Number.isFinite(v) ? v : undefined
  } catch { return undefined }
}

export function gradeChem(c: AnswerOf<'chem'>, input: string, lang?: GradeLang): GradeResult {
  const s = input.trim()
  if (!s) return invalidGrade(L(lang, 'Escribe tu respuesta primero.', 'Write your answer first.'))
  let check: ChemCheck
  switch (c.mode) {
    case 'formula': check = ChemChecker.checkFormula(s, c.expected); break
    case 'equation': check = ChemChecker.checkEquation(s, c.expected); break
    case 'name': check = ChemChecker.checkName(s, c.expected); break
    case 'configuration': check = ChemChecker.checkElectronConfiguration(s, c.expected); break
    case 'number': {
      const want = chemNumber(c.expected)
      if (want === undefined) return invalidGrade(L(lang, 'La clave de este ejercicio no es un número válido.', "This exercise's key is not a valid number."))
      check = ChemChecker.checkNumber(s, want, c.sigFigs ?? null, c.tolerance ?? 0.01)
      break
    }
  }
  const fb: FeedbackLine[] = check.feedback ? [feedbackLine(check.status === 'correct' ? 'praise' : 'explanation', check.feedback)] : []
  switch (check.status) {
    case 'correct': return makeGrade('correct', 1, { feedback: fb, echoPlain: s })
    case 'partial': return makeGrade('partial', 0.5, { feedback: fb, echoPlain: s })
    case 'incorrect': return makeGrade('incorrect', 0, { feedback: fb, echoPlain: s })
    default: return invalidGrade(check.feedback || L(lang, 'No pude leer tu respuesta.', "I couldn't read your answer."))
  }
}

// MARK: Números y expresiones

export function numericSpecOf(n: AnswerOf<'numeric'>): NumericSpec {
  return {
    value: n.value, alternatives: [...n.alternatives], absTol: n.absTol, relTol: n.relTol,
    decimals: n.decimals === undefined ? null : Math.min(Math.max(n.decimals, 0), 15),
    form: numericFormLenient(n.form), unit: n.unit ?? null, unitMode: unitModeLenient(n.unitMode),
    // «deg», «grados»… también (la IA no siempre escribe «degrees»)
    angle: angleModeLenient(n.angle)
  }
}

export function expressionSpecOf(e: AnswerOf<'expression'>): ExpressionSpec {
  return {
    expected: e.expected, variables: e.variables ? [...e.variables] : null, domainMin: e.domainMin, domainMax: e.domainMax, samples: 40,
    form: expressionFormLenient(e.form), forbiddenFunctions: [...e.forbidden], angle: angleModeLenient(e.angle)
  }
}

/** Veredicto matemático → resultado de la app, con la explicación del autor si coincide con un error típico. */
export function convert(v: CheckVerdict, input: string, wrongs: readonly WrongAnswer[], equationLike = false): GradeResult {
  let r: GradeResult
  switch (v.status) {
    case 'correct': r = makeGrade('correct', 1); break
    case 'formatProblem': r = makeGrade('invalid', 0); break
    case 'incorrect': r = makeGrade('incorrect', 0); break
    default: r = makeGrade('partial', Math.min(0.999, Math.max(0.01, v.credit)))
  }
  r.diagnosis = [...v.diagnosis]
  if (v.normalizedInput !== undefined) r.echoPlain = v.normalizedInput
  if (v.latexInput !== undefined) r.echoTeX = v.latexInput
  const lines: FeedbackLine[] = []
  if (v.status !== 'correct') {
    const w = matchWrong(wrongs, input, equationLike)
    if (w) { r.matchedWrong = w; lines.push(feedbackLine('explanation', w.why)) }
  }
  if (v.message) {
    const kind: FeedbackKind = v.status === 'correct' ? 'praise' : v.status === 'formatProblem' ? 'warning' : v.status === 'wrongForm' ? 'hint' : 'error'
    const onlyOther = v.diagnosis.length === 1 && v.diagnosis[0] === 'other'
    if (!(r.matchedWrong && onlyOther)) lines.push(feedbackLine(kind, v.message))
  }
  r.feedback = lines
  return r
}

/** ¿La respuesta es uno de los errores típicos del autor? (igual como texto o equivalente matemáticamente) */
export function matchWrong(wrongs: readonly WrongAnswer[], input: string, equationLike = false): WrongAnswer | undefined {
  if (!wrongs.length) return undefined
  const norm = (s: string): string => s.toLowerCase().replace(/[\s$]/gu, '')
  const n = norm(input)
  const same = wrongs.find((w) => norm(w.input) === n)
  if (same) return same
  if (equationLike) return undefined
  let a
  try { a = MathParser.parse(input) } catch { return undefined }
  // la equivalencia simbólica cuesta: con miles de «errores típicos» la corrección se colgaba (se miran los 60 primeros)
  for (const w of wrongs.slice(0, 60)) {
    try {
      const b = MathParser.parse(w.input)
      if (MathEquivalence.equivalent(a, b, { samples: 12 })) return w
    } catch { /* no es una expresión */ }
  }
  return undefined
}

// MARK: Texto, opciones, huecos…

/** ¿Este texto se corrige exacto? Lo que diga el ejercicio; si no dice nada, lo del curso (exacto en los cursos de idiomas). */
const isExact = (own: boolean | undefined, opts: GradeOptions): boolean => own ?? opts.exactText ?? false

export function gradeShort(sh: AnswerOf<'short'>, s: string, wrongs: readonly WrongAnswer[], options?: GradeOptions | GradeLang): GradeResult {
  const opts = optionsOf(options)
  const exact = isExact(sh.exact, opts)
  const keys = { keywords: [...sh.keywords], minKeywordsForCredit: sh.minKeywords ?? null }
  const opt = exact ? defaultTextOptions({ ...EXACT_TEXT_OPTIONS, ...keys }) : defaultTextOptions({ typoTolerance: sh.typoTolerance, ...keys })
  // los errores típicos del autor nunca cuentan como erratas de la respuesta («exotérmica» por «endotérmica»)
  const rejected = wrongs.map((w) => w.input)
  const v = AnswerChecker.checkText(s, sh.accepted, rejected, opt)
  let r = convert(v, s, wrongs)
  if (exact && v.status === 'incorrect' && !r.matchedWrong) r = nearMissGrade(s, sh.accepted, rejected, opts.lang, r.echoPlain) ?? r
  return sh.aiGrade && r.status !== 'correct' ? withReview(r, true) : r
}

/** Un hueco de texto: exacto (tildes y ortografía cuentan; un «casi» vale 0 con su aviso) o tolerante (sin tildes, erratas leves). */
function gradeTextBlank(got: string, accepted: readonly string[], exact: boolean, lang?: GradeLang): GradeResult {
  if (!exact) return convert(AnswerChecker.checkText(got, accepted, [], defaultTextOptions({ typoTolerance: true })), got, [])
  const v = AnswerChecker.checkText(got, accepted, [], defaultTextOptions(EXACT_TEXT_OPTIONS))
  const r = convert(v, got, [])
  return v.status === 'incorrect' ? nearMissGrade(got, accepted, [], lang, r.echoPlain) ?? r : r
}

export function gradeChoice(c: AnswerOf<'choice'>, selected: readonly string[], lang?: GradeLang): GradeResult {
  const sel = new Set(selected)
  const correct = new Set(c.options.filter((o) => o.correct).map((o) => o.id))
  const fb: FeedbackLine[] = []
  for (const o of c.options) {
    if (sel.has(o.id) && !o.correct) fb.push(feedbackLine('explanation', o.why ?? L(lang, `«${o.md}» no es correcta.`, `“${o.md}” is not correct.`)))
  }
  const equal = sel.size === correct.size && [...sel].every((x) => correct.has(x))
  if (equal) {
    for (const o of c.options) if (sel.has(o.id) && o.why) fb.push(feedbackLine('info', o.why))
    return makeGrade('correct', 1, { feedback: fb })
  }
  if (c.multi) {
    const right = [...sel].filter((x) => correct.has(x)).length, wrong = [...sel].filter((x) => !correct.has(x)).length
    const credit = Math.max(0, (right - wrong) / Math.max(1, correct.size))
    const superset = [...correct].every((x) => sel.has(x))
    if (!superset && wrong === 0) fb.push(feedbackLine('hint', L(lang, 'Te faltó marcar alguna opción correcta.', 'You missed a correct option.')))
    return makeGrade(credit > 0 ? 'partial' : 'incorrect', credit, { feedback: fb })
  }
  return makeGrade('incorrect', 0, { feedback: fb })
}

const overall = (parts: GradeResult[]): number => (parts.length ? parts.reduce((s, p) => s + p.credit, 0) / parts.length : 0)
const statusOf = (credit: number): GradeResult['status'] => (credit >= 0.999 ? 'correct' : credit > 0 ? 'partial' : 'incorrect')

export function gradeCloze(c: AnswerOf<'cloze'>, blanks: readonly string[], options?: GradeOptions | GradeLang): GradeResult {
  const opts = optionsOf(options)
  const lang = opts.lang
  const parts = c.blanks.map((bl, i) => {
    const got = i < blanks.length ? blanks[i] : ''
    if (!got.trim()) return makeGrade('incorrect', 0, { feedback: [feedbackLine('hint', L(lang, 'Falta este hueco.', 'This blank is empty.'))] })
    const first = bl.accepted[0]
    if (bl.numeric && first !== undefined) {
      const spec: NumericSpec = { value: first, alternatives: bl.accepted.slice(1), absTol: 0, relTol: 0, decimals: null, form: 'any', unit: null, unitMode: 'optional', angle: 'radians' }
      return convert(AnswerChecker.checkNumeric(got, spec), got, [])
    }
    return gradeTextBlank(got, bl.accepted, isExact(bl.exact, opts), lang)
  })
  const credit = overall(parts)
  // los avisos de «casi» (tildes, ortografía) suben al ejercicio: la interfaz solo colorea cada hueco
  const many = parts.length > 1
  const fb = parts.flatMap((p, i) => (p.diagnosis.some((d) => d === 'accents' || d === 'articles' || d === 'spelling') && p.feedback[0]
    ? [feedbackLine('hint', many ? L(lang, `Hueco ${i + 1}: `, `Blank ${i + 1}: `) + p.feedback[0].markdown : p.feedback[0].markdown)]
    : [])).slice(0, 3)
  return makeGrade(statusOf(credit), credit, { parts, feedback: fb })
}

export function gradeLabel(l: AnswerOf<'label'>, blanks: readonly string[], lang?: GradeLang): GradeResult {
  if (effectiveLabelMode(l) === 'locate') return gradeLocate(l, blanks, lang)
  const parts = l.spots.map((sp, i) => {
    const got = i < blanks.length ? blanks[i] : ''
    if (!got.trim()) return makeGrade('incorrect', 0)
    return convert(AnswerChecker.checkText(got, sp.accepted, [], defaultTextOptions()), got, [])
  })
  const credit = overall(parts)
  return makeGrade(statusOf(credit), credit, { parts })
}

/** «Señala la parte»: cada respuesta es «x,y» (fracciones de la figura); vale si señala la parte pedida con la geometría de la interfaz. */
export function gradeLocate(l: AnswerOf<'label'>, blanks: readonly string[], lang?: GradeLang): GradeResult {
  const figure = labelAnswerParts(l)
  const aspect = effectiveAspect(l)
  const parts = l.spots.map((sp, i) => {
    const name = sp.accepted[0] ?? ''
    const pt = i < blanks.length ? FigureGeometry.parsePoint(blanks[i]) : undefined
    if (!pt) return makeGrade('incorrect', 0, { feedback: [feedbackLine('hint', L(lang, `No señalaste «${name}».`, `You didn't point at “${name}”.`))] })
    const h = FigureGeometry.hit(pt[0], pt[1], figure, aspect)
    if (h === undefined) {
      return makeGrade('incorrect', 0, { feedback: [feedbackLine('explanation', L(lang, `Donde señalaste no hay ninguna de las partes marcadas; «${name}» está en otro sitio.`, `There is no marked part where you pointed; “${name}” is somewhere else.`))] })
    }
    const hitName = figure[h].name
    const same = h === i || figurePartNames(figure[h]).some((a) => sp.accepted.some((x) => x.toLowerCase() === a.toLowerCase()))
    if (same) return makeGrade('correct', 1, { echoPlain: hitName })
    return makeGrade('incorrect', 0, { feedback: [feedbackLine('explanation', L(lang, `Señalaste «${hitName}», no «${name}».`, `You pointed at “${hitName}”, not “${name}”.`))], echoPlain: hitName })
  })
  const credit = overall(parts)
  const fb = parts.length > 1 && credit < 0.999 ? parts.map((p) => p.feedback[0]).filter((f): f is FeedbackLine => f !== undefined).slice(0, 3) : []
  return makeGrade(statusOf(credit), credit, { feedback: fb, parts })
}

export function gradeOrdering(o: AnswerOf<'ordering'>, seq: readonly string[], lang?: GradeLang): GradeResult {
  if (seq.length === o.items.length && seq.every((x, i) => x === o.items[i])) return makeGrade('correct', 1)
  const n = Math.min(seq.length, o.items.length)
  let inPlace = 0
  const wrongSpots: number[] = []
  for (let i = 0; i < n; i++) { if (seq[i] === o.items[i]) inPlace += 1; else wrongSpots.push(i + 1) }
  const fb: FeedbackLine[] = []
  if (wrongSpots.length === 1) fb.push(feedbackLine('hint', L(lang, `El elemento de la posición ${wrongSpots[0]} no va ahí.`, `The item in position ${wrongSpots[0]} doesn't go there.`)))
  else if (wrongSpots.length > 1) fb.push(feedbackLine('hint', L(lang, `Revisa las posiciones ${wrongSpots.join(', ')}.`, `Check positions ${wrongSpots.join(', ')}.`)))
  const credit = inPlace / Math.max(1, o.items.length)
  return makeGrade(credit > 0 ? 'partial' : 'incorrect', credit, { feedback: fb })
}

export function gradeMatching(m: AnswerOf<'matching'>, sel: Readonly<Record<string, string>>, lang?: GradeLang): GradeResult {
  // solo las claves propias: «constructor» o «toString» no deben encontrar lo heredado de Object
  const chosen = (left: string): string | undefined => ownValue(sel, left)
  const ok = m.pairs.filter((p) => chosen(p.left) === p.right)
  if (ok.length === m.pairs.length) return makeGrade('correct', 1)
  const bad = m.pairs.filter((p) => chosen(p.left) !== p.right)
  const fb = bad.slice(0, 3).map((p) => feedbackLine('hint', L(lang, `«${p.left}» no va con «${chosen(p.left) ?? '—'}».`, `“${p.left}” doesn't go with “${chosen(p.left) ?? '—'}”.`)))
  const credit = ok.length / Math.max(1, m.pairs.length)
  return makeGrade(credit > 0 ? 'partial' : 'incorrect', credit, { feedback: fb })
}
