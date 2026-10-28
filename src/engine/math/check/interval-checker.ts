import { freeVariables, type Expr } from '../core/expr'
import { tr } from '../core/i18n'
import { charCount, chars as toChars, escapeRegExp, foldedLower, isLetter, isNumberChar, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError, MV, type AngleMode } from '../core/types'
import { NumberFormat } from '../format/number-format'
import { normalizeText } from '../parse/normalizer'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { AnswerWords } from './answer-words'
import { isComparisonSign, ListParsing, WORD_AFTER, WORD_BEFORE } from './list-parsing'
import { rxGroups } from './rx'
import { ValueMatch, ValueReadings, type ValueReading } from './value-match'
import { MAX_INPUT_LENGTH, Verdict, type CheckVerdict, type Diagnosis } from './verdict'

// MARK: - Conjuntos de la recta real

/** Intervalo de la recta real (con las expresiones de los extremos tal como se escribieron, si se conocen). */
export interface RealInterval {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  loExpr?: Expr | null
  hiExpr?: Expr | null
}

function intervalIsEmpty(i: RealInterval): boolean {
  if (i.lo > i.hi) return true
  if (i.lo === i.hi) return !(i.loClosed && i.hiClosed)
  return false
}

/** Unión ordenada y sin solapes de intervalos. */
export class RealSet {
  readonly intervals: readonly RealInterval[]

  /** Extremo escrito (`a`) frente al de la clave (`b`): un 0 escrito nunca coincide con un extremo distinto de 0. */
  static matches(a: number, b: number): boolean {
    if (a === b) return true
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    return ValueMatch.close(a, b, 1e-9)
  }

  constructor(raw: readonly RealInterval[]) {
    const items: RealInterval[] = []
    for (const i of raw) {
      const x = { ...i }
      if (x.lo === -Infinity) x.loClosed = false
      if (x.hi === Infinity) x.hiClosed = false
      if (!intervalIsEmpty(x)) items.push(x)
    }
    items.sort((a, b) => {
      if (a.lo !== b.lo) return a.lo < b.lo ? -1 : 1
      if (a.loClosed && !b.loClosed) return -1
      if (b.loClosed && !a.loClosed) return 1
      return 0
    })
    const out: RealInterval[] = []
    for (const x of items) {
      const last = out[out.length - 1]
      if (last) {
        const touching = x.lo === last.hi && (x.loClosed || last.hiClosed)
        if (x.lo < last.hi || touching) {
          const merged = { ...last }
          if (x.hi > last.hi) {
            merged.hi = x.hi
            merged.hiClosed = x.hiClosed
            merged.hiExpr = x.hiExpr
          } else if (x.hi === last.hi && x.hiClosed) {
            merged.hiClosed = true
          }
          out[out.length - 1] = merged
          continue
        }
      }
      out.push(x)
    }
    this.intervals = out
  }

  static readonly empty = new RealSet([])
  static readonly all = new RealSet([{ lo: -Infinity, hi: Infinity, loClosed: false, hiClosed: false }])

  get isEmpty(): boolean {
    return this.intervals.length === 0
  }

  contains(x: number): boolean {
    return this.intervals.some((i) => (x > i.lo || (x === i.lo && i.loClosed)) && (x < i.hi || (x === i.hi && i.hiClosed)))
  }

  /** Los cortes incluyen todos los extremos: cada tramo cubre la celda abierta entera o no cubre su interior. */
  coversOpenCell(lo: number, hi: number): boolean {
    if (!(lo < hi)) return false
    return this.intervals.some((i) => i.lo <= lo && i.hi >= hi)
  }

  union(o: RealSet): RealSet {
    return new RealSet([...this.intervals, ...o.intervals])
  }

  intersection(o: RealSet): RealSet {
    const out: RealInterval[] = []
    for (const a of this.intervals) {
      for (const b of o.intervals) {
        let lo = a.lo
        let lc = a.loClosed
        let le = a.loExpr
        if (b.lo > lo) {
          lo = b.lo
          lc = b.loClosed
          le = b.loExpr
        } else if (b.lo === lo) lc = lc && b.loClosed
        let hi = a.hi
        let hc = a.hiClosed
        let he = a.hiExpr
        if (b.hi < hi) {
          hi = b.hi
          hc = b.hiClosed
          he = b.hiExpr
        } else if (b.hi === hi) hc = hc && b.hiClosed
        out.push({ lo, hi, loClosed: lc, hiClosed: hc, loExpr: le, hiExpr: he })
      }
    }
    return new RealSet(out)
  }

  complement(): RealSet {
    const out: RealInterval[] = []
    let lo = -Infinity
    let lc = false
    let le: Expr | null | undefined = null
    for (const i of this.intervals) {
      out.push({ lo, hi: i.lo, loClosed: lc, hiClosed: !i.loClosed, loExpr: le, hiExpr: i.loExpr })
      lo = i.hi
      lc = !i.hiClosed
      le = i.hiExpr
    }
    out.push({ lo, hi: Infinity, loClosed: lc, hiClosed: false, loExpr: le, hiExpr: null })
    return new RealSet(out)
  }

  /** ¿Es el mismo conjunto que `o` (la clave)? */
  equals(o: RealSet): boolean {
    if (this.intervals.length !== o.intervals.length) return false
    for (let k = 0; k < this.intervals.length; k++) {
      const a = this.intervals[k]
      const b = o.intervals[k]
      if ((a.lo === a.hi) !== (b.lo === b.hi)) return false
      if (!RealSet.matches(a.lo, b.lo) || !RealSet.matches(a.hi, b.hi)) return false
      if (Number.isFinite(a.lo) && a.loClosed !== b.loClosed) return false
      if (Number.isFinite(a.hi) && a.hiClosed !== b.hiClosed) return false
    }
    return true
  }

  // MARK: Texto

  get plain(): string {
    if (this.intervals.length === 0) return '∅'
    return this.intervals
      .map((i) => {
        if (i.lo === i.hi) return '{' + endpointText(i.lo, i.loExpr) + '}'
        return (i.loClosed ? '[' : '(') + endpointText(i.lo, i.loExpr) + ', ' + endpointText(i.hi, i.hiExpr) + (i.hiClosed ? ']' : ')')
      })
      .join(' ∪ ')
  }

  get latex(): string {
    if (this.intervals.length === 0) return '\\varnothing'
    return this.intervals
      .map((i) => {
        if (i.lo === i.hi) return '\\left\\{' + endpointLatex(i.lo, i.loExpr) + '\\right\\}'
        return (i.loClosed ? '[' : '(') + endpointLatex(i.lo, i.loExpr) + ',\\,' + endpointLatex(i.hi, i.hiExpr) + (i.hiClosed ? ']' : ')')
      })
      .join('\\cup ')
  }
}

function endpointText(v: number, e: Expr | null | undefined): string {
  if (v === Infinity) return '∞'
  if (v === -Infinity) return '-∞'
  if (e) return toPlain(e)
  return NumberFormat.decimal(v, null)
}

function endpointLatex(v: number, e: Expr | null | undefined): string {
  if (v === Infinity) return '\\infty'
  if (v === -Infinity) return '-\\infty'
  if (e) return toLatex(e)
  return NumberFormat.decimal(v, null)
}

// MARK: - Lectura de intervalos

/** Error de lectura de un intervalo, con un mensaje para el estudiante. */
export class IntervalFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntervalFailure'
  }
}

export type IntervalParseResult = { ok: true; set: RealSet } | { ok: false; message: string }

const OO_RE = new RegExp(`${WORD_BEFORE}oo${WORD_AFTER}`, 'gu')
const ADJACENT_RE = /[)\]]\s*[([]/u
const SET_BUILDER_RE = /^\{\s*[\p{L}][\p{L}0-9_]*\s*(?:∈\s*\S+\s*)?[|:]\s*(.+)\}$/su
const MEMBERSHIP_RE = new RegExp(`^\\s*[\\p{L}][\\p{L}0-9_]*\\s*(?:∈|${WORD_BEFORE}in${WORD_AFTER})\\s*`, 'u')
const S_EQUALS_RE = /^\s*[Ss]\s*=\s*(?=[{([])/u

const DEFAULT_READING: ValueReading = { angle: 'radians', degreeLabel: false }

function endpoint(text: string, reading: ValueReading): [number, Expr] {
  let t = trimWS(text)
  if (t.startsWith('+')) t = t.slice(1)
  if (t === '') throw new IntervalFailure(tr('Falta un número en uno de los extremos.'))
  t = t.replace(OO_RE, 'inf')
  let e: Expr
  try {
    e = MathParser.parse(t)
  } catch (err) {
    if (err instanceof MathError) throw new IntervalFailure(tr('No pude leer el extremo «%@» (%@).', t, err.message))
    throw err
  }
  const v = sortedStrings(freeVariables(e))[0]
  if (v !== undefined) throw new IntervalFailure(tr('Los extremos deben ser números, sin letras (aparece «%@»).', v))
  try {
    return [MV.double(ValueReadings.evaluate(reading, e)), e]
  } catch (err) {
    if (err instanceof MathError) throw new IntervalFailure(tr('El extremo «%@» no es válido: %@.', t, err.message))
    throw err
  }
}

/** Divide por los símbolos de unión (∪, U, o, or, union) fuera de paréntesis, y por comas entre dos intervalos con corchetes. */
function splitUnion(s: string): string[] {
  const cs = toChars(s)
  const parts: string[] = []
  let current = ''
  let depth = 0
  let i = 0
  const prevNonSpace = (idx: number): string | null => {
    let k = idx - 1
    while (k >= 0 && cs[k] === ' ') k -= 1
    return k >= 0 ? cs[k] : null
  }
  const nextNonSpace = (idx: number): string | null => {
    let k = idx
    while (k < cs.length && cs[k] === ' ') k += 1
    return k < cs.length ? cs[k] : null
  }
  const flush = (): void => {
    parts.push(current)
    current = ''
  }
  while (i < cs.length) {
    const c = cs[i]
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
    if (depth === 0) {
      if (c === '∪') {
        flush()
        i += 1
        continue
      }
      if (c === ',') {
        const p = prevNonSpace(i)
        const n = nextNonSpace(i + 1)
        if (p !== null && ')]}'.includes(p) && n !== null && '([{'.includes(n)) {
          flush()
          i += 1
          continue
        }
      }
      if (isLetter(c) && (i === 0 || !isLetter(cs[i - 1]))) {
        let j = i
        while (j < cs.length && isLetter(cs[j])) j += 1
        const word = cs.slice(i, j).join('').toLowerCase()
        const p = prevNonSpace(i)
        // «u ≤ 3», «v > 3»: seguida de un signo de comparación, la palabra es la variable, no la unión (la app Swift sí partía)
        const n = nextNonSpace(j)
        if (AnswerWords.unionWords.has(foldedLower(word)) && p !== null && n !== null && !isComparisonSign(n) && (isNumberChar(p) || isLetter(p) || ')]}'.includes(p))) {
          flush()
          i = j
          continue
        }
        current += cs.slice(i, j).join('')
        i = j
        continue
      }
    }
    current += c
    i += 1
  }
  flush()
  return parts.map(trimWS).filter((p) => p !== '')
}

/** ¿Un único par de corchetes/paréntesis abarca todo el texto? */
function isBracketed(s: string): boolean {
  const cs = toChars(s)
  if (cs.length < 2 || !'(['.includes(cs[0]) || !')]'.includes(cs[cs.length - 1])) return false
  let depth = 0
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth -= 1
    if (depth === 0 && i < cs.length - 1) return false
  }
  return depth === 0
}

/** Parte por `seps` fuera de paréntesis. Con `keepGluedDecimalCommas`, una coma pegada entre cifras (`1,5`) no separa. */
function splitTop(s: string, seps: string, keepGluedDecimalCommas = false): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  const cs = toChars(s)
  cs.forEach((c, i) => {
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth -= 1
    if (depth === 0 && seps.includes(c) && !(keepGluedDecimalCommas && c === ',' && ListParsing.isGluedBetweenDigits(cs, i))) {
      parts.push(current)
      current = ''
      return
    }
    current += c
  })
  parts.push(current)
  return parts
}

/** `[a, b)`: el `;` siempre separa (y entonces las comas son decimales); si no, la coma (salvo la pegada entre cifras). */
function parseBracketed(part: string, decimalComma: boolean, reading: ValueReading): RealInterval {
  const cs = toChars(part)
  const open = cs[0]
  const close = cs[cs.length - 1]
  const inner = cs.slice(1, -1).join('')
  const pieces = inner.includes(';') ? splitTop(inner, ';') : splitTop(inner, ',', decimalComma)
  if (pieces.length !== 2) {
    throw new IntervalFailure(pieces.length < 2
      ? tr('Falta la coma entre los extremos del intervalo, por ejemplo (2, 5).')
      : tr('Un intervalo tiene solo dos extremos, por ejemplo (2, 5).'))
  }
  const [lo, loE] = endpoint(pieces[0], reading)
  const [hi, hiE] = endpoint(pieces[1], reading)
  if (lo > hi) throw new IntervalFailure(tr('Los extremos están al revés: el menor va primero.'))
  const lc = open === '['
  const hc = close === ']'
  if ((lo === -Infinity && lc) || (hi === Infinity && hc)) throw new IntervalFailure(tr('El infinito siempre va con paréntesis, nunca con corchete.'))
  if (lo === hi && !(lc && hc)) throw new IntervalFailure(tr('Un intervalo con los dos extremos iguales solo existe como [a, a].'))
  return { lo, hi, loClosed: lc, hiClosed: hc, loExpr: loE, hiExpr: hiE }
}

/** `{1, 2}`: en la lectura clásica separan la coma y el `;`; con coma decimal, si hay `;` solo separa el `;`. */
function parsePoints(part: string, decimalComma: boolean, reading: ValueReading): RealInterval[] {
  const inner = toChars(part).slice(1, -1).join('')
  let pieces: string[]
  if (decimalComma) pieces = inner.includes(';') ? splitTop(inner, ';') : splitTop(inner, ',', true)
  else pieces = splitTop(inner, ',;')
  const out: RealInterval[] = []
  for (const piece of pieces) {
    if (trimWS(piece) === '') continue
    const [v, e] = endpoint(piece, reading)
    out.push({ lo: v, hi: v, loClosed: true, hiClosed: true, loExpr: e, hiExpr: e })
  }
  return out
}

/** Variable vista hasta ahora en todo el texto (todas las partes deben usar la misma). */
interface VariableSlot {
  name: string | null
}

/** Conjunto descrito por una desigualdad o cadena de desigualdades: `x<3`, `2<x<=7`, `x≠3`. */
function parseInequality(part: string, variable: VariableSlot, reading: ValueReading): RealSet {
  let rel: { operands: Expr[]; relations: string[] }
  try {
    rel = MathParser.parseRelation(part)
  } catch (e) {
    if (e instanceof MathError) throw new IntervalFailure(tr('No pude leer «%@»: %@.', part, e.message))
    throw e
  }
  if (rel.relations.length === 0) {
    throw new IntervalFailure(tr('No entiendo «%@» como intervalo: usa notación como (1, 3] o desigualdades como x < 3.', part))
  }
  let result = RealSet.all
  rel.relations.forEach((r, idx) => {
    const left = rel.operands[idx]
    const right = rel.operands[idx + 1]
    let varOnLeft: boolean
    let name: string
    let constant: Expr
    if (left.type === 'variable' && freeVariables(right).size === 0) {
      varOnLeft = true
      name = left.name
      constant = right
    } else if (right.type === 'variable' && freeVariables(left).size === 0) {
      varOnLeft = false
      name = right.name
      constant = left
    } else {
      throw new IntervalFailure(tr('Cada desigualdad debe tener la variable de un lado y un número del otro (por ejemplo x < 3).'))
    }
    if (variable.name !== null && variable.name !== name) {
      throw new IntervalFailure(tr('Usa una sola variable en las desigualdades (aparecen «%@» y «%@»).', variable.name, name))
    }
    variable.name = name
    let c: number
    try {
      c = MV.double(ValueReadings.evaluate(reading, constant))
    } catch (e) {
      if (e instanceof MathError) throw new IntervalFailure(tr('El número «%@» no es válido: %@.', toPlain(constant), e.message))
      throw e
    }
    // pasar a la forma  variable ⊙ c
    let op = r
    if (!varOnLeft) {
      if (r === '<') op = '>'
      else if (r === '<=') op = '>='
      else if (r === '>') op = '<'
      else if (r === '>=') op = '<='
    }
    let piece: RealSet
    switch (op) {
      case '<': piece = new RealSet([{ lo: -Infinity, hi: c, loClosed: false, hiClosed: false, loExpr: null, hiExpr: constant }]); break
      case '<=': piece = new RealSet([{ lo: -Infinity, hi: c, loClosed: false, hiClosed: true, loExpr: null, hiExpr: constant }]); break
      case '>': piece = new RealSet([{ lo: c, hi: Infinity, loClosed: false, hiClosed: false, loExpr: constant, hiExpr: null }]); break
      case '>=': piece = new RealSet([{ lo: c, hi: Infinity, loClosed: true, hiClosed: false, loExpr: constant, hiExpr: null }]); break
      case '=':
      case '==': piece = new RealSet([{ lo: c, hi: c, loClosed: true, hiClosed: true, loExpr: constant, hiExpr: constant }]); break
      case '!=': piece = new RealSet([{ lo: c, hi: c, loClosed: true, hiClosed: true, loExpr: constant, hiExpr: constant }]).complement(); break
      default: throw new IntervalFailure(tr('No entiendo el signo de comparación «%@».', r))
    }
    result = result.intersection(piece)
  })
  return result
}

/** ¿Hay `)(`, `)[` , `](`, `][` al nivel superior? */
function isBracketedWithAdjacent(t: string): boolean {
  let depth = 0
  const cs = toChars(t)
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    if ('([{'.includes(c)) depth += 1
    else if (')]}'.includes(c)) depth -= 1
    if (depth === 0 && ')]'.includes(c)) {
      let j = i + 1
      while (j < cs.length && cs[j] === ' ') j += 1
      if (j < cs.length && '(['.includes(cs[j])) return true
    }
  }
  return false
}

/** Parte por las palabras `words` (las de letras, solo como palabra completa). */
function splitWord(s: string, words: readonly string[]): string[] {
  let result = [s]
  for (const w of words) {
    const next: string[] = []
    const first = toChars(w)[0]
    for (const piece of result) {
      if (first !== undefined && isLetter(first)) next.push(...splitOnLetterWord(piece, w))
      else next.push(...piece.split(w))
    }
    result = next
  }
  return result.map(trimWS).filter((p) => p !== '')
}

/**
 * Parte por una palabra de letras («y», «and», «et»…) solo cuando une dos desigualdades: con texto a ambos lados y sin un
 * signo de comparación pegado. Así «-1 ≤ y ≤ 3» o «y >= -1 and y <= 3» (la variable «y») no se parten y
 * «x > 1 y x < 3» sí (la app Swift partía por cualquier «y»).
 */
function splitOnLetterWord(piece: string, w: string): string[] {
  const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(w)}(?![\\p{L}])`, 'gu')
  const parts: string[] = []
  let start = 0
  for (const m of piece.matchAll(re)) {
    const at = m.index
    const before = toChars(trimWS(piece.slice(start, at)))
    const after = toChars(trimWS(piece.slice(at + m[0].length)))
    if (before.length === 0 || after.length === 0) continue
    if (isComparisonSign(before[before.length - 1]) || isComparisonSign(after[0])) continue
    parts.push(piece.slice(start, at))
    start = at + m[0].length
  }
  parts.push(piece.slice(start))
  return parts
}

function parsePart(part: string, variable: VariableSlot, decimalComma: boolean, reading: ValueReading): RealSet {
  const t = trimWS(part)
  if (ListParsing.isEmptyWord(t)) return RealSet.empty
  if (IntervalParsing.isAllWord(t)) return RealSet.all
  // dos intervalos pegados sin unión
  if (ADJACENT_RE.test(t) && isBracketedWithAdjacent(t)) {
    throw new IntervalFailure(tr('Une los intervalos con el símbolo ∪ (puedes escribir la letra U): por ejemplo (-inf, -2) U (4, inf).'))
  }
  // notación de conjunto: {x | -2 < x < 2}, {x : x > 3}, {x ∈ R | x ≠ 1}
  const g = rxGroups(SET_BUILDER_RE, t)
  if (g && g.length === 2) return parsePart(g[1], variable, decimalComma, reading)
  if (t.startsWith('{') && t.endsWith('}')) return new RealSet(parsePoints(t, decimalComma, reading))
  if (isBracketed(t)) return new RealSet([parseBracketed(t, decimalComma, reading)])
  // intersección: "x>2 y x<5", "x>2 and x<5", "x>2 et x<5"…
  const andParts = splitWord(t, AnswerWords.intersectionWords)
  if (andParts.length > 1) {
    let r = RealSet.all
    for (const p of andParts) r = r.intersection(parsePart(p, variable, decimalComma, reading))
    return r
  }
  return parseInequality(t, variable, reading)
}

/** Lectura de intervalos y uniones de intervalos. */
export const IntervalParsing = {
  /** ¿Dice «todos los reales» en alguno de los 12 idiomas de la app? */
  isAllWord(s: string): boolean {
    return AnswerWords.allReals.has(AnswerWords.normalized(s))
  },

  /**
   * Lee un intervalo o unión de intervalos. `decimalComma`: lectura con coma decimal (`[1,5, 3]` = [1.5, 3], `{1,5; 2}`);
   * la clásica (por defecto) es la de los datos de los ejercicios.
   */
  parse(text: string, decimalComma = false, reading: ValueReading = DEFAULT_READING): IntervalParseResult {
    let t = trimWS(normalizeText(text).string)
    if (t === '') return { ok: false, message: tr('Escribe tu respuesta.') }
    t = t.replace(MEMBERSHIP_RE, '')
    t = t.replace(S_EQUALS_RE, '')
    t = trimWS(t)
    try {
      if (ListParsing.isEmptyWord(t)) return { ok: true, set: RealSet.empty }
      if (IntervalParsing.isAllWord(t)) return { ok: true, set: RealSet.all }
      const parts = splitUnion(t)
      if (parts.length === 0) return { ok: false, message: tr('No encontré ningún intervalo.') }
      let set = RealSet.empty
      const variable: VariableSlot = { name: null }
      for (const p of parts) set = set.union(parsePart(p, variable, decimalComma, reading))
      return { ok: true, set }
    } catch (e) {
      if (e instanceof IntervalFailure) return { ok: false, message: e.message }
      return { ok: false, message: tr('No pude leer tu intervalo.') }
    }
  },
}

// MARK: - Comprobador

/** Comprobador de intervalos y uniones de intervalos (se comparan como conjuntos de la recta real). */
export class IntervalChecker {
  readonly expected: string
  readonly angle: AngleMode

  constructor(expected: string, angle: AngleMode = 'radians') {
    this.expected = expected
    this.angle = angle
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu respuesta.'))
    if (charCount(trimmed) > MAX_INPUT_LENGTH) return Verdict.format(Verdict.tooLongMessage)
    // el intervalo esperado (datos del ejercicio) siempre con la lectura clásica
    if (!IntervalParsing.parse(this.expected, false, { angle: this.angle, degreeLabel: false }).ok) {
      return Verdict.format(tr('No se pudo interpretar el intervalo esperado del ejercicio («%@»).', this.expected))
    }
    // Ángulos: la lectura normal y, si algún lado lleva «°», la del «°» como etiqueta ([0°, 90°) = [0, 90)).
    const verdicts: CheckVerdict[] = []
    for (const reading of ValueReadings.readings(this.angle, [trimmed, this.expected])) {
      const want = IntervalParsing.parse(this.expected, false, reading)
      if (!want.ok) continue
      verdicts.push(this.checkReading(trimmed, want.set, reading))
    }
    return Verdict.best(verdicts) ?? Verdict.format(tr('No pude leer tu intervalo.'))
  }

  /** Una lectura de los ángulos: prueba la coma clásica y la decimal. */
  private checkReading(trimmed: string, want: RealSet, reading: ValueReading): CheckVerdict {
    // Con una coma pegada entre cifras hay dos lecturas: la clásica y la de coma decimal («[1,5, 3]», «{1,5; 2}»).
    // Se queda la mejor; a igualdad, la preferida: la de coma decimal si hay «;» o si el estudiante usa coma decimal.
    const parsed = IntervalParsing.parse(trimmed, false, reading)
    const classic = parsed.ok ? compareSets(parsed.set, want) : Verdict.format(parsed.message)
    if (!ListParsing.hasGluedDecimalComma(normalizeText(trimmed).string)) return classic
    const alternative = IntervalParsing.parse(trimmed, true, reading)
    if (!alternative.ok) return classic
    const decimal = compareSets(alternative.set, want)
    const decimalFirst = NumberInput.decimalComma || trimmed.includes(';')
    return Verdict.best(decimalFirst ? [decimal, classic] : [classic, decimal]) ?? classic
  }
}

/** Compara el conjunto escrito con el esperado y explica la diferencia. */
function compareSets(got: RealSet, want: RealSet): CheckVerdict {
  const plain = got.plain
  const latex = got.latex
  if (got.equals(want)) return Verdict.correct(null, plain, latex)

  // comparar por tramos y por puntos de corte
  const breaks: number[] = []
  for (const i of [...got.intervals, ...want.intervals]) {
    if (Number.isFinite(i.lo)) breaks.push(i.lo)
    if (Number.isFinite(i.hi)) breaks.push(i.hi)
  }
  breaks.sort((a, b) => a - b)
  const unique: number[] = []
  for (const b of breaks) if (!unique.includes(b)) unique.push(b)
  let missingSeg = 0
  let extraSeg = 0
  let segmentCount = 0
  const pointIssues: Array<{ x: number; shouldInclude: boolean }> = []
  const edges = [-Infinity, ...unique, Infinity]
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k]
    const hi = edges[k + 1]
    const g = got.coversOpenCell(lo, hi)
    const w = want.coversOpenCell(lo, hi)
    segmentCount += 1
    if (g && !w) extraSeg += 1
    else if (w && !g) missingSeg += 1
  }
  // Todos los tramos al revés: escogió justo los intervalos contrarios (aunque los extremos también difieran)
  if (segmentCount > 0 && missingSeg + extraSeg === segmentCount) {
    return Verdict.wrong(tr('Escogiste justo los intervalos contrarios: revisa si buscabas donde la expresión es positiva (>) o negativa (<) y prueba un punto en cada intervalo.'), ['wrongInterval', 'signError'], plain, latex)
  }
  for (const x of unique) {
    const g = got.contains(x)
    const w = want.contains(x)
    if (g !== w) pointIssues.push({ x, shouldInclude: w })
  }
  if (missingSeg === 0 && extraSeg === 0 && pointIssues.length > 0) {
    return Verdict.partial(0.5, endpointsMessage(pointIssues), ['wrongInterval'], plain, latex)
  }
  const labels: Diagnosis[] = ['wrongInterval']
  let message: string
  if (missingSeg > 0 && extraSeg === 0) {
    labels.push('missingSolution')
    message = tr('Te falta incluir alguna parte de la solución: revisa la tabla de signos, ese intervalo también cumple.')
  } else if (extraSeg > 0 && missingSeg === 0) {
    labels.push('extraSolution')
    message = tr('Incluiste algún intervalo que no cumple: prueba un punto de cada intervalo en la expresión original.')
  } else {
    message = tr('Tu conjunto no coincide con la solución: rehaz la tabla de signos, marca los valores críticos y une solo los intervalos que cumplen.')
  }
  return Verdict.wrong(message, labels, plain, latex)
}

/**
 * Los intervalos coinciden salvo en algunos extremos (corchete frente a paréntesis). Un extremo: una frase; varios: una
 * frase por extremo. El número va con el separador decimal del estudiante.
 */
function endpointsMessage(issues: ReadonlyArray<{ x: number; shouldInclude: boolean }>): string {
  const rule = tr('(Corchete si el valor se incluye; paréntesis si no, o si es ∞ o hace cero un denominador.)')
  if (issues.length === 1) {
    const v = NumberInput.shown(issues[0].x)
    const first = issues[0].shouldInclude
      ? tr('Los intervalos están bien, pero revisa los extremos: en x = %@ debe ir corchete [ ].', v)
      : tr('Los intervalos están bien, pero revisa los extremos: en x = %@ debe ir paréntesis ( ).', v)
    return first + ' ' + rule
  }
  const lines = issues.map((issue) => {
    const v = NumberInput.shown(issue.x)
    return issue.shouldInclude ? tr('En x = %@ debe ir corchete [ ].', v) : tr('En x = %@ debe ir paréntesis ( ).', v)
  })
  return [tr('Los intervalos están bien, pero revisa los extremos.'), ...lines, rule].join(' ')
}
