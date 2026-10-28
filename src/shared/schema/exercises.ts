// Ejercicios, tipos de respuesta y plantillas (port de StudyModel/Exercises.swift).
//
// Las respuestas son una unión discriminada por `kind` (la misma clave que el JSON). Un `kind` que no se reconoce se
// conserva como `kind: 'unknown'` (tipo original en `rawKind`, el JSON en `raw`): Swift lo leía como respuesta corta vacía;
// para corregirlo, trátalo igual (ver `answerForGrading`).
import type { JSONObject } from '@engine/base/json'
import {
  bool, bounded, clamp, date, encodeU64, enumOf, fallbackID, flexNum, flexNums, flexStr, int, isObj, list, nested, nowISO, num, pickKeys, points, prune,
  put, str, strictStrings, strings, tooDeep, vNum, vU64, type ISODate, type ItemID, type Obj, type U64
} from './coding'
import { blocksField, encodeBlock, type Block } from './blocks'
import { decodeDrawing, decodeSourceRef, encodeDrawing, encodeSourceRef, type DrawingBlock, type SourceRef } from './common'
import type { FigurePart } from './visual'

// MARK: Tipos de respuesta

export interface ChoiceOption { id: string; md: string; correct: boolean; why?: string }
export interface ChoiceAnswer { options: ChoiceOption[]; multi: boolean; shuffle: boolean }

export interface NumericAnswer {
  value: string
  alternatives: string[]
  absTol: number
  relTol: number
  decimals?: number
  /** any | fraction | reducedFraction | integer | decimal | scientific | percent | mixedNumber */
  form: string
  unit?: string
  /** required | optional | ignore */
  unitMode: string
  /** radians | degrees */
  angle: string
  /** Texto antes del campo ("x ="). */
  prefix?: string
  suffix?: string
  placeholder?: string
}

export interface ExpressionAnswer {
  expected: string
  variables?: string[]
  domainMin: number
  domainMax: number
  /** any | expanded | factored | simplified | lowestTerms */
  form: string
  forbidden: string[]
  angle: string
  prefix?: string
  placeholder?: string
}

export interface EquationAnswer { expected: string; variables?: string[] }
export interface SetAnswer { expected: string[]; ordered: boolean; placeholder?: string }
export interface IntervalAnswer { expected: string }
export interface PointAnswer { expected: string[]; absTol: number }

export interface ShortAnswer {
  accepted: string[]
  /** Palabras clave para crédito parcial ("a|b" = sinónimos). */
  keywords: string[]
  minKeywords?: number
  typoTolerance: boolean
  /** true = además se pide a la IA que califique (si hay proveedor); la comprobación local siempre va primero. */
  aiGrade: boolean
  rubric?: string
  placeholder?: string
  /**
   * Corrección exacta: las tildes, la ortografía y los artículos cuentan (las mayúsculas no). Sin el campo, lo decide el curso
   * (exacta en los cursos de idiomas, tolerante en el resto). Campo nuevo: la app Swift lo ignora al leer.
   */
  exact?: boolean
}

export interface ClozeBlank {
  accepted: string[]
  numeric: boolean
  hint?: string
  /** Corrección exacta del hueco (como `ShortAnswer.exact`); sin el campo, la del curso. */
  exact?: boolean
}
/** Completar huecos. En `text`, los huecos se marcan `[[1]]`, `[[2]]`… y `blanks[0]` corresponde a `[[1]]`. */
export interface ClozeAnswer { text: string; blanks: ClozeBlank[] }
/** Elementos en el orden CORRECTO (la interfaz los baraja). */
export interface OrderingAnswer { items: string[] }
export interface MatchPair { left: string; right: string }
export interface MatchingAnswer { pairs: MatchPair[]; extraRights: string[] }

export const CHEM_MODES = ['formula', 'equation', 'name', 'number', 'configuration'] as const
export type ChemMode = (typeof CHEM_MODES)[number]
/** Química (la corrige el motor químico): fórmula, ecuación balanceada, nombre, cantidad con cifras significativas o configuración. */
export interface ChemAnswer {
  mode: ChemMode
  /** «Fe2O3», «4 Fe + 3 O2 -> 2 Fe2O3», «sulfato de cobre(II)», «0.250», «[Ar] 4s2 3d6». */
  expected: string
  /** number: cifras significativas exigidas. */
  sigFigs?: number
  /** number: unidad que se muestra junto a la casilla. */
  unit?: string
  /** number: tolerancia relativa (por defecto 1 %). */
  tolerance?: number
}

export interface TrueFalseAnswer { value: boolean; explainWhy: boolean }

export interface LabelSpot {
  /** 0…1 sobre la imagen. */
  x: number
  y: number
  accepted: string[]
  hint?: string
  /** Zona de la parte (modo «señala»): radio, rectángulo [x, y, ancho, alto] o contorno [[x, y], …]. */
  r?: number
  rect?: number[]
  polygon?: number[][]
}
export const LABEL_MODES = ['type', 'bank', 'drag', 'locate'] as const
export type LabelMode = (typeof LABEL_MODES)[number]
/** Rotular una imagen o un dibujo: escribir, elegir de una lista, arrastrar las etiquetas o señalar la parte. */
export interface LabelAnswer {
  asset?: string
  source?: SourceRef
  /** Dibujo vectorial en lugar de imagen. */
  drawing?: DrawingBlock
  alt: string
  spots: LabelSpot[]
  /** Si no está vacío, se eligen de una lista (o son las etiquetas que se arrastran, con distractores). */
  wordBank: string[]
  /** undefined = escribir (o elegir, si hay banco de palabras). */
  mode?: LabelMode
  /** Ancho / alto de la imagen. */
  aspect?: number
  credit?: string
}

export interface RubricItem { text: string; points: number }
/** Respuesta abierta: se califica con rúbrica (IA si hay proveedor, autoevaluación si no). */
export interface OpenAnswer { modelAnswer: string; rubric: RubricItem[]; maxWords?: number }
export interface AnswerPart {
  /** "a", "b", "i"… */
  label: string
  prompt: Block[]
  answer: Answer
  points: number
  hints: string[]
}
export interface MultiAnswer { parts: AnswerPart[] }
/** Tipo de respuesta que esta versión no conoce: se conserva el JSON. */
export interface UnknownAnswer { rawKind: string; raw: JSONObject }

export type Answer =
  | ({ kind: 'choice' } & ChoiceAnswer)
  | ({ kind: 'numeric' } & NumericAnswer)
  | ({ kind: 'expression' } & ExpressionAnswer)
  | ({ kind: 'equation' } & EquationAnswer)
  | ({ kind: 'set' } & SetAnswer)
  | ({ kind: 'interval' } & IntervalAnswer)
  | ({ kind: 'point' } & PointAnswer)
  | ({ kind: 'short' } & ShortAnswer)
  | ({ kind: 'cloze' } & ClozeAnswer)
  | ({ kind: 'ordering' } & OrderingAnswer)
  | ({ kind: 'matching' } & MatchingAnswer)
  | ({ kind: 'truefalse' } & TrueFalseAnswer)
  | ({ kind: 'label' } & LabelAnswer)
  | ({ kind: 'open' } & OpenAnswer)
  | ({ kind: 'multi' } & MultiAnswer)
  | ({ kind: 'chem' } & ChemAnswer)
  | ({ kind: 'unknown' } & UnknownAnswer)

export type AnswerKind = Answer['kind']
export type AnswerOf<K extends AnswerKind> = Extract<Answer, { kind: K }>

export const ANSWER_KINDS = ['choice', 'numeric', 'expression', 'equation', 'set', 'interval', 'point', 'short', 'cloze', 'ordering', 'matching',
  'truefalse', 'label', 'open', 'multi', 'chem'] as const

// MARK: Ejercicio

export const REVIEW_STATES = ['verified', 'fixed', 'flagged'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]
/** Marca de revisión: ✓ verificado por un solucionador independiente, ✎ corregido, ⚑ sin resolver (se excluye de la práctica). */
export interface ReviewMark { state: ReviewState; note?: string; date: ISODate }

export interface WrongAnswer {
  /** Lo que escribiría el estudiante. Para opciones, usa el `why` de la propia opción. */
  input: string
  why: string
}

/** Un ejercicio completo: enunciado, tipo de respuesta, pistas, solución y errores típicos con su explicación. */
export interface Exercise {
  id: ItemID
  skill: ItemID
  /** 1 = básico · 2 = estándar · 3 = nivel examen. */
  level: number
  prompt: Block[]
  answer: Answer
  /** Pistas progresivas (de la más sutil a la más directa). */
  hints: string[]
  /** Solución paso a paso (se muestra después de responder). */
  solution: Block[]
  /** Respuestas equivocadas frecuentes y por qué se cometen. */
  wrongs: WrongAnswer[]
  points: number
  tags: string[]
  source?: SourceRef
  estimatedSeconds?: number
  /** Si proviene de una plantilla: id de la plantilla y semilla. */
  templateID?: ItemID
  seed?: U64
  /** Resultado de la verificación independiente. undefined = aún sin verificar. */
  review?: ReviewMark
}

export interface TemplateVarSpec {
  name: string
  /** int | real | pick | fraction | expr */
  kind: string
  min?: number
  max?: number
  decimals?: number
  exclude: number[]
  values: string[]
  minDen?: number
  maxDen?: number
  maxNum?: number
  proper: boolean
  expr?: string
}

/** Plantilla paramétrica: los textos usan `{{expr}}`, `{{tex:expr}}`, `{{frac:expr}}`, `{{signed:expr}}`, `{{dec(2):expr}}`… */
export interface ExerciseTemplate {
  id: ItemID
  skill: ItemID
  level: number
  vars: TemplateVarSpec[]
  constraints: string[]
  prompt: Block[]
  answer: Answer
  hints: string[]
  solution: Block[]
  wrongs: WrongAnswer[]
  points: number
  tags: string[]
  estimatedSeconds?: number
}

// MARK: Leer

const lowerKey = (s: string | undefined): string => (s ?? '').toLowerCase().replace(/[_\- ]/g, '')

export function parseChemMode(raw: string | undefined): ChemMode {
  switch (lowerKey(raw)) {
    case 'equation': case 'reaction': case 'balance': case 'balanced': case 'ecuacion': case 'ecuación': case 'reaccion': case 'reacción': return 'equation'
    case 'name': case 'nomenclature': case 'naming': case 'nombre': case 'nomenclatura': return 'name'
    case 'number': case 'numeric': case 'quantity': case 'value': case 'amount': case 'numero': case 'número': case 'cantidad': return 'number'
    case 'configuration': case 'electronconfiguration': case 'config': case 'configuracion': case 'configuración': return 'configuration'
    default: return 'formula'
  }
}

export function parseLabelMode(raw: string | undefined): LabelMode | undefined {
  if (raw === undefined) return undefined
  switch (lowerKey(raw)) {
    case 'type': case 'write': case 'typed': case 'escribir': case 'text': return 'type'
    case 'bank': case 'choose': case 'select': case 'menu': case 'wordbank': case 'elegir': return 'bank'
    case 'drag': case 'draglabel': case 'draglabels': case 'dragdrop': case 'draganddrop': case 'arrastrar': case 'arrastra': return 'drag'
    case 'locate': case 'point': case 'pointat': case 'click': case 'find': case 'identify': case 'hotspot': case 'señalar': case 'senalar': case 'señala': case 'senala': return 'locate'
    default: return undefined
  }
}

const decodeChoiceOption = (raw: unknown, _d?: number, index?: number): ChoiceOption | undefined => {
  if (!isObj(raw)) return undefined
  // sin id, uno fijo por posición: con uno aleatorio, la opción elegida dejaba de ser la correcta al releer el ejercicio
  return prune({ id: flexStr(raw, 'id') ?? `o${index ?? 0}`, md: flexStr(raw, 'md') ?? flexStr(raw, 'text') ?? '', correct: bool(raw, 'correct') ?? false, why: str(raw, 'why') })
}

/** `exact` (o `strict`) de un hueco o una respuesta corta, leído con tolerancia: true, "true", "sí", 1… (otra cosa: sin decidir). */
export function decodeExactFlag(c: Obj): boolean | undefined {
  for (const k of ['exact', 'strict']) {
    const v = c[k]
    if (typeof v === 'boolean') return v
    if (typeof v === 'number' && Number.isInteger(v)) return v !== 0
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      if (['true', 'yes', 'si', 'sí', '1', 'exact', 'strict'].includes(t)) return true
      if (['false', 'no', '0'].includes(t)) return false
    }
  }
  return undefined
}

const decodeClozeBlank = (raw: unknown): ClozeBlank | undefined => {
  if (!isObj(raw)) return undefined
  return prune({ accepted: strings(raw, 'accepted'), numeric: bool(raw, 'numeric') ?? false, hint: str(raw, 'hint'), exact: decodeExactFlag(raw) })
}

const decodeMatchPair = (raw: unknown): MatchPair | undefined =>
  isObj(raw) ? { left: flexStr(raw, 'left') ?? '', right: flexStr(raw, 'right') ?? '' } : undefined

function decodeLabelSpot(raw: unknown): LabelSpot | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  let accepted = strings(c, 'accepted')
  if (!accepted.length) {
    const n = flexStr(c, 'name') ?? flexStr(c, 'label')
    if (n !== undefined) accepted = [n]
  }
  return prune({ x: flexNum(c, 'x') ?? 0.5, y: flexNum(c, 'y') ?? 0.5, accepted, hint: str(c, 'hint'), r: flexNum(c, 'r'), rect: flexNums(c, 'rect'), polygon: points(c, 'polygon') })
}

function decodeLabelAnswer(c: Obj, d: number): LabelAnswer {
  let spots = list(c, 'spots', decodeLabelSpot, d)
  if (!spots.length) spots = list(c, 'parts', decodeLabelSpot, d)
  return prune({
    asset: str(c, 'asset'), source: nested(c, 'source', decodeSourceRef, d), drawing: nested(c, 'drawing', decodeDrawing, d), alt: flexStr(c, 'alt') ?? '',
    spots, wordBank: strings(c, 'wordBank'), mode: parseLabelMode(flexStr(c, 'mode')), aspect: flexNum(c, 'aspect'), credit: str(c, 'credit')
  })
}

const decodeRubricItem = (raw: unknown): RubricItem | undefined => {
  if (typeof raw === 'string') return { text: raw, points: 1 }
  if (!isObj(raw)) return undefined
  // puntos acotados: con 1e300 la hoja de respuestas hacía `Int(p)` y la app se cerraba
  return { text: flexStr(raw, 'text') ?? '', points: clamp(num(raw, 'points') ?? 1, 0, 1e6, 1) }
}

function decodeAnswerPart(raw: unknown, d: number): AnswerPart | undefined {
  if (!isObj(raw)) return undefined
  return {
    label: flexStr(raw, 'label') ?? '', prompt: blocksField(raw, 'prompt', d), answer: nested(raw, 'answer', decodeAnswer, d) ?? emptyShortAnswer(),
    points: num(raw, 'points') ?? 1, hints: strings(raw, 'hints')
  }
}

export function emptyShortAnswer(): AnswerOf<'short'> {
  return { kind: 'short', accepted: [], keywords: [], typoTolerance: true, aiGrade: false }
}

function decodeShort(c: Obj): AnswerOf<'short'> {
  return prune({
    kind: 'short' as const, accepted: strings(c, 'accepted'), keywords: strings(c, 'keywords'), minKeywords: int(c, 'minKeywords'),
    typoTolerance: bool(c, 'typoTolerance') ?? true, aiGrade: bool(c, 'aiGrade') ?? false, rubric: str(c, 'rubric'), placeholder: str(c, 'placeholder'),
    exact: decodeExactFlag(c)
  })
}

/** Canónico de un `kind` de respuesta (lo que escriba la IA: «multiple_choice», «tf», «señala»…); undefined si no se conoce. */
export function canonicalAnswerKind(raw: string): AnswerKind | 'locate' | 'drag' | undefined {
  switch (raw.toLowerCase().replace(/[_-]/g, '')) {
    case 'choice': case 'mc': case 'multiplechoice': case 'single': case 'mcq': case 'select': return 'choice'
    case 'numeric': case 'number': case 'num': case 'value': return 'numeric'
    case 'expression': case 'expr': case 'algebra': case 'formula': return 'expression'
    case 'equation': case 'eq': return 'equation'
    case 'set': case 'list': case 'solutions': return 'set'
    case 'interval': case 'intervals': case 'domain': case 'range': return 'interval'
    case 'point': case 'coordinates': case 'coord': return 'point'
    case 'short': case 'text': case 'string': case 'word': case 'term': case 'fill': return 'short'
    case 'cloze': case 'blanks': case 'fillblanks': case 'fillintheblank': return 'cloze'
    case 'ordering': case 'order': case 'sequence': case 'sort': return 'ordering'
    case 'matching': case 'match': case 'pairs': return 'matching'
    case 'truefalse': case 'tf': case 'boolean': case 'bool': return 'truefalse'
    case 'label': case 'labels': case 'labelimage': case 'hotspots': return 'label'
    // «señala la parte» y «arrastra la etiqueta»: rotular con su modo
    case 'locate': case 'pointat': case 'pointto': case 'clickon': case 'findpart': case 'identifypart': case 'hotspot': case 'señala': case 'senala':
    case 'señalar': case 'senalar': return 'locate'
    case 'draglabel': case 'draglabels': case 'dragdrop': case 'draganddrop': case 'arrastra': case 'arrastrar': case 'draglabelling': case 'draglabeling': return 'drag'
    case 'open': case 'essay': case 'freeresponse': case 'explain': return 'open'
    case 'multi': case 'multipart': case 'parts': return 'multi'
    case 'chem': case 'chemistry': case 'chemical': case 'chemformula': case 'chemicalformula': case 'chemequation': case 'chemicalequation': case 'quimica': case 'química': return 'chem'
    default: return undefined
  }
}

/** Lee una respuesta (como `Answer.init(from:)`). undefined si no es un objeto. */
export function decodeAnswer(raw: unknown, d = 0): Answer | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  // partes dentro de partes dentro de partes…: se corta antes de desbordar la pila
  if (tooDeep(d)) return emptyShortAnswer()
  const rawKind = str(c, 'kind') ?? str(c, 'type') ?? 'short'
  switch (canonicalAnswerKind(rawKind)) {
    case 'choice': return { kind: 'choice', options: list(c, 'options', decodeChoiceOption, d), multi: bool(c, 'multi') ?? false, shuffle: bool(c, 'shuffle') ?? true }
    case 'numeric': {
      const decimals = int(c, 'decimals')
      return prune({
        kind: 'numeric' as const, value: flexStr(c, 'value') ?? '', alternatives: strings(c, 'alternatives'), absTol: num(c, 'absTol') ?? 0, relTol: num(c, 'relTol') ?? 0,
        // más de 15 decimales no tiene sentido con Double y un valor gigante colgaba el redondeo
        decimals: decimals === undefined ? undefined : clamp(decimals, 0, 15),
        form: str(c, 'form') ?? 'any', unit: str(c, 'unit'), unitMode: str(c, 'unitMode') ?? 'optional', angle: str(c, 'angle') ?? 'radians',
        prefix: str(c, 'prefix'), suffix: str(c, 'suffix'), placeholder: str(c, 'placeholder')
      })
    }
    case 'expression':
      return prune({
        kind: 'expression' as const, expected: flexStr(c, 'expected') ?? '', variables: strictStrings(c, 'variables'), domainMin: num(c, 'domainMin') ?? -6,
        domainMax: num(c, 'domainMax') ?? 6, form: str(c, 'form') ?? 'any', forbidden: strings(c, 'forbidden'), angle: str(c, 'angle') ?? 'radians',
        prefix: str(c, 'prefix'), placeholder: str(c, 'placeholder')
      })
    case 'equation': return prune({ kind: 'equation' as const, expected: flexStr(c, 'expected') ?? '', variables: strictStrings(c, 'variables') })
    case 'set': return prune({ kind: 'set' as const, expected: strings(c, 'expected'), ordered: bool(c, 'ordered') ?? false, placeholder: str(c, 'placeholder') })
    case 'interval': return { kind: 'interval', expected: flexStr(c, 'expected') ?? '' }
    case 'point': return { kind: 'point', expected: Array.isArray(c.expected) ? strings(c, 'expected') : [], absTol: num(c, 'absTol') ?? 1e-6 }
    case 'short': return decodeShort(c)
    case 'cloze': return { kind: 'cloze', text: flexStr(c, 'text') ?? '', blanks: list(c, 'blanks', decodeClozeBlank, d) }
    case 'ordering': return { kind: 'ordering', items: strings(c, 'items') }
    case 'matching': return { kind: 'matching', pairs: list(c, 'pairs', decodeMatchPair, d), extraRights: strings(c, 'extraRights') }
    case 'truefalse': return { kind: 'truefalse', value: bool(c, 'value') ?? true, explainWhy: bool(c, 'explainWhy') ?? false }
    case 'label': return { kind: 'label', ...decodeLabelAnswer(c, d) }
    case 'locate': { const l = decodeLabelAnswer(c, d); return { kind: 'label', ...l, mode: l.mode ?? 'locate' } }
    case 'drag': { const l = decodeLabelAnswer(c, d); return { kind: 'label', ...l, mode: l.mode ?? 'drag' } }
    case 'open': return prune({ kind: 'open' as const, modelAnswer: flexStr(c, 'modelAnswer') ?? '', rubric: list(c, 'rubric', decodeRubricItem, d), maxWords: int(c, 'maxWords') })
    case 'multi': return { kind: 'multi', parts: list(c, 'parts', decodeAnswerPart, d) }
    case 'chem': {
      const sig = int(c, 'sigFigs'), tol = num(c, 'tolerance')
      return prune({
        kind: 'chem' as const, mode: parseChemMode(flexStr(c, 'mode')), expected: flexStr(c, 'expected') ?? '',
        sigFigs: sig === undefined ? undefined : clamp(sig, 1, 12), unit: str(c, 'unit'), tolerance: tol === undefined ? undefined : clamp(tol, 0, 0.5, 0.01)
      })
    }
    default: {
      // tipo desconocido (de una versión futura): se conserva el JSON tal cual
      const all = bounded(c, d)
      const rest: JSONObject = {}
      if (isObj(all)) for (const [k, v] of Object.entries(all as JSONObject)) if (k !== 'kind') rest[k] = v
      return { kind: 'unknown', rawKind, raw: rest }
    }
  }
}

/** La respuesta como la corrige Aula: un tipo desconocido es una respuesta corta vacía (como hacía Swift). */
export function answerForGrading(a: Answer): Exclude<Answer, { kind: 'unknown' }> {
  if (a.kind !== 'unknown') return a
  const s = decodeShort(a.raw as Obj)
  return s
}

const decodeWrong = (raw: unknown): WrongAnswer | undefined =>
  isObj(raw) ? { input: flexStr(raw, 'input') ?? flexStr(raw, 'value') ?? '', why: flexStr(raw, 'why') ?? flexStr(raw, 'explanation') ?? '' } : undefined

function decodeReviewMark(raw: unknown): ReviewMark | undefined {
  // decodificación estricta (sin `init(from:)` propio): `date` es obligatoria
  if (!isObj(raw)) return undefined
  const dt = date(raw, 'date')
  if (dt === undefined) return undefined
  // `state` es obligatoria; cualquier valor que no se entienda es «verificado» (como `State.init(from:)`)
  if (raw.state === undefined) return undefined
  const state: ReviewState = enumOf(raw, 'state', REVIEW_STATES) ?? 'verified'
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') return undefined
  return prune({ state, note: str(raw, 'note'), date: dt })
}

/** Lee un ejercicio (como `Exercise.init(from:)`). */
export function decodeExercise(raw: unknown, d = 0, index?: number): Exercise | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? fallbackID(raw, index), skill: flexStr(c, 'skill') ?? '', level: Math.min(3, Math.max(1, int(c, 'level') ?? 2)),
    prompt: blocksField(c, 'prompt', d), answer: nested(c, 'answer', decodeAnswer, d) ?? emptyShortAnswer(), hints: strings(c, 'hints'),
    solution: blocksField(c, 'solution', d), wrongs: list(c, 'wrongs', decodeWrong, d), points: clamp(num(c, 'points') ?? 1, 0, 1e6, 1),
    tags: strings(c, 'tags'), source: nested(c, 'source', decodeSourceRef, d), estimatedSeconds: int(c, 'estimatedSeconds'), templateID: str(c, 'templateID'),
    seed: vU64(c.seed), review: nested(c, 'review', decodeReviewMark, d)
  })
}

function decodeTemplateVar(raw: unknown): TemplateVarSpec | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    name: flexStr(c, 'name') ?? 'x', kind: str(c, 'kind') ?? 'int', min: num(c, 'min'), max: num(c, 'max'), decimals: int(c, 'decimals'),
    exclude: list(c, 'exclude', vNum, 0), values: Array.isArray(c.values) ? strings(c, 'values') : [],
    minDen: int(c, 'minDen'), maxDen: int(c, 'maxDen'), maxNum: int(c, 'maxNum'), proper: bool(c, 'proper') ?? true, expr: flexStr(c, 'expr')
  })
}

export function decodeTemplate(raw: unknown, d = 0, index?: number): ExerciseTemplate | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({
    id: flexStr(c, 'id') ?? fallbackID(raw, index), skill: flexStr(c, 'skill') ?? '', level: Math.min(3, Math.max(1, int(c, 'level') ?? 2)),
    vars: list(c, 'vars', decodeTemplateVar, d), constraints: strings(c, 'constraints'), prompt: blocksField(c, 'prompt', d), solution: blocksField(c, 'solution', d),
    answer: nested(c, 'answer', decodeAnswer, d) ?? emptyShortAnswer(), hints: strings(c, 'hints'), wrongs: list(c, 'wrongs', decodeWrong, d),
    points: clamp(num(c, 'points') ?? 1, 0, 1e6, 1), tags: strings(c, 'tags'), estimatedSeconds: int(c, 'estimatedSeconds')
  })
}

// MARK: Escribir

const encodeSpot = (v: LabelSpot): JSONObject => pickKeys(v, ['x', 'y', 'accepted', 'hint', 'r', 'rect', 'polygon'])

/** La respuesta como la escribe Swift: {"kind": …, ...campos}. */
export function encodeAnswer(a: Answer): JSONObject {
  let out: JSONObject
  switch (a.kind) {
    case 'choice':
      out = { options: a.options.map((o) => pickKeys(o, ['id', 'md', 'correct', 'why'])), multi: a.multi, shuffle: a.shuffle }
      break
    case 'numeric': out = pickKeys(a, ['value', 'alternatives', 'absTol', 'relTol', 'decimals', 'form', 'unit', 'unitMode', 'angle', 'prefix', 'suffix', 'placeholder']); break
    case 'expression': out = pickKeys(a, ['expected', 'variables', 'domainMin', 'domainMax', 'form', 'forbidden', 'angle', 'prefix', 'placeholder']); break
    case 'equation': out = pickKeys(a, ['expected', 'variables']); break
    case 'set': out = pickKeys(a, ['expected', 'ordered', 'placeholder']); break
    case 'interval': out = pickKeys(a, ['expected']); break
    case 'point': out = pickKeys(a, ['expected', 'absTol']); break
    case 'short': out = pickKeys(a, ['accepted', 'keywords', 'minKeywords', 'typoTolerance', 'aiGrade', 'rubric', 'placeholder', 'exact']); break
    case 'cloze': out = { text: a.text, blanks: a.blanks.map((b) => pickKeys(b, ['accepted', 'numeric', 'hint', 'exact'])) }; break
    case 'ordering': out = pickKeys(a, ['items']); break
    case 'matching': out = { pairs: a.pairs.map((p) => pickKeys(p, ['left', 'right'])), extraRights: [...a.extraRights] }; break
    case 'truefalse': out = pickKeys(a, ['value', 'explainWhy']); break
    case 'label':
      out = pickKeys(a, ['asset'])
      if (a.source) out.source = encodeSourceRef(a.source)
      if (a.drawing) out.drawing = encodeDrawing(a.drawing)
      out.alt = a.alt
      out.spots = a.spots.map(encodeSpot)
      out.wordBank = [...a.wordBank]
      Object.assign(out, pickKeys(a, ['mode', 'aspect', 'credit']))
      break
    case 'open': out = { modelAnswer: a.modelAnswer, rubric: a.rubric.map((r) => pickKeys(r, ['text', 'points'])) }; put(out, 'maxWords', a.maxWords); break
    case 'multi':
      out = { parts: a.parts.map((p) => ({ label: p.label, prompt: p.prompt.map(encodeBlock), answer: encodeAnswer(p.answer), points: p.points, hints: [...p.hints] })) }
      break
    case 'chem': out = pickKeys(a, ['mode', 'expected', 'sigFigs', 'unit', 'tolerance']); break
    case 'unknown': return { ...a.raw, kind: a.rawKind }
  }
  out.kind = a.kind
  return out
}

export function encodeExercise(e: Exercise): JSONObject {
  const out = pickKeys(e, ['id', 'skill', 'level', 'hints', 'points', 'tags', 'estimatedSeconds', 'templateID'])
  out.prompt = e.prompt.map(encodeBlock)
  out.answer = encodeAnswer(e.answer)
  out.solution = e.solution.map(encodeBlock)
  out.wrongs = e.wrongs.map((w) => pickKeys(w, ['input', 'why']))
  if (e.source) out.source = encodeSourceRef(e.source)
  if (e.seed !== undefined) put(out, 'seed', encodeU64(e.seed))
  if (e.review) out.review = pickKeys(e.review, ['state', 'note', 'date'])
  return out
}

export function encodeTemplate(t: ExerciseTemplate): JSONObject {
  const out = pickKeys(t, ['id', 'skill', 'level', 'constraints', 'hints', 'points', 'tags', 'estimatedSeconds'])
  out.vars = t.vars.map((v) => pickKeys(v, ['name', 'kind', 'min', 'max', 'decimals', 'exclude', 'values', 'minDen', 'maxDen', 'maxNum', 'proper', 'expr']))
  out.prompt = t.prompt.map(encodeBlock)
  out.answer = encodeAnswer(t.answer)
  out.solution = t.solution.map(encodeBlock)
  out.wrongs = t.wrongs.map((w) => pickKeys(w, ['input', 'why']))
  return out
}

// MARK: Ayudas

/** Modo efectivo de rotular: el escrito o, si falta, escribir (o elegir de la lista cuando hay banco de palabras). */
export const effectiveLabelMode = (l: LabelAnswer): LabelMode => l.mode ?? (l.wordBank.length ? 'bank' : 'type')

/** Las partes de la figura de un ejercicio de rotular, para la geometría común. */
export function labelAnswerParts(l: LabelAnswer): FigurePart[] {
  return l.spots.map((s, i) => prune({ id: `s${i}`, name: s.accepted[0] ?? '', aliases: s.accepted.slice(1), x: s.x, y: s.y, r: s.r, rect: s.rect, polygon: s.polygon }))
}

/** ¿El ejercicio se puede usar en la práctica? (los marcados ⚑ se excluyen). */
export const isReviewUsable = (r: ReviewMark | undefined): boolean => r?.state !== 'flagged'

export function makeExercise(p: Partial<Exercise> & { id: ItemID; skill: ItemID; answer: Answer }): Exercise {
  return prune({ level: 2, prompt: [], hints: [], solution: [], wrongs: [], points: 1, tags: [], ...p })
}

export function makeReviewMark(state: ReviewState, note?: string): ReviewMark {
  return prune({ state, note, date: nowISO() })
}
