import { freeVariables, type Expr } from '../core/expr'
import { tr } from '../core/i18n'
import { charCount, compareStrings, foldedLower, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError, MV, type AngleMode, type MathValue } from '../core/types'
import { decimalString } from '../format/decimal-digits'
import { normalizeText } from '../parse/normalizer'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { roundHalfAwayFromZero } from '../eval/rounding'
import { ListParsing } from './list-parsing'
import { ValueMatch, ValueReadings, type ValueReading } from './value-match'
import { MAX_INPUT_LENGTH, Verdict, type CheckVerdict, type Diagnosis } from './verdict'

/** ¿`value` (escrito como decimal con ≥ 2 cifras) es una aproximación redondeada de `exact`? */
export function isDecimalApproximation(value: MathValue, expr: Expr, exact: MathValue): boolean {
  const literal = expr.type === 'unary' && expr.op === 'neg' ? expr.arg : expr
  if (literal.type !== 'number' || literal.value.isInteger) return false
  const text = decimalString(literal.value)
  if (text === null) return false
  const parts = text.split('.')
  const decimals = parts[parts.length - 1].length
  if (decimals < 2) return false
  const x = MV.double(value)
  const e = MV.double(exact)
  if (e === 0 || !Number.isFinite(e)) return false
  return Math.abs(x - e) <= 0.5 * Math.pow(10, -decimals) * (1 + 1e-9) && Math.abs(x - e) <= 0.02 * Math.abs(e)
}

type Pieces = { ok: true; items: Array<[MathValue, Expr]> } | { ok: false; error: MathError }

const ASSIGNMENT_BEFORE_BRACKET_RE = /^\s*[\p{L}][\p{L}0-9_]*\s*(?:=|∈|(?<![\p{L}\p{N}_])in(?![\p{L}\p{N}_]))\s*(?=[{([])/u

/** Comprobador de conjuntos de valores (soluciones de una ecuación, una secuencia…). */
export class SetChecker {
  readonly expected: readonly string[]
  readonly ordered: boolean
  readonly angle: AngleMode

  constructor(expected: readonly string[], ordered = false, angle: AngleMode = 'radians') {
    this.expected = expected
    this.ordered = ordered
    this.angle = angle
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu respuesta.'))
    if (charCount(trimmed) > MAX_INPUT_LENGTH) return Verdict.format(Verdict.tooLongMessage)

    // Esperado (datos del ejercicio: cada valor por separado, sin depender del separador del estudiante)
    const expectedExprs: Expr[] = []
    for (const e of this.expected) {
      let ex: Expr
      try {
        ex = MathParser.parse(e)
      } catch {
        return this.checkTextSet(trimmed)
      }
      if (freeVariables(ex).size > 0 || !canEvaluate(ex, this.angle)) return this.checkTextSet(trimmed)
      expectedExprs.push(ex)
    }

    // Ángulos: la lectura normal y, si algún lado lleva «°», la del «°» como etiqueta (30° = 30). Se queda la mejor.
    const verdicts: CheckVerdict[] = []
    for (const reading of ValueReadings.readings(this.angle, [trimmed, ...this.expected])) {
      let expectedValues: MathValue[]
      try {
        expectedValues = expectedExprs.map((e) => ValueReadings.evaluate(reading, e))
      } catch {
        continue
      }
      verdicts.push(this.checkReading(trimmed, expectedValues, reading))
    }
    return Verdict.best(verdicts) ?? Verdict.format(tr('No entiendo tu respuesta.'))
  }

  /** Una lectura de los ángulos: prueba la coma clásica y la decimal. */
  private checkReading(trimmed: string, expectedValues: readonly MathValue[], reading: ValueReading): CheckVerdict {
    // Con una coma pegada entre cifras hay dos lecturas: la clásica (toda coma separa: «1,5» = {1, 5}) y la de coma decimal
    // («1,5» = 1.5; «1,5, 2» = {1.5, 2}; con «;», solo separa el «;»). Se queda la mejor; a igualdad, la preferida.
    const classic = this.evaluate(trimmed, expectedValues, false, reading)
    if (!ListParsing.hasGluedDecimalComma(normalizeText(trimmed).string)) return classic
    const decimal = this.evaluate(trimmed, expectedValues, true, reading)
    if (decimal.status === 'formatProblem') return classic // la lectura alternativa solo cuenta si se puede leer
    const decimalFirst = NumberInput.decimalComma || trimmed.includes(';')
    return Verdict.best(decimalFirst ? [decimal, classic] : [classic, decimal]) ?? classic
  }

  private parsePieces(trimmed: string, decimalComma: boolean, reading: ValueReading): Pieces {
    let text = trimWS(normalizeText(trimmed).string)
    text = text.replace(ASSIGNMENT_BEFORE_BRACKET_RE, '')
    text = ListParsing.stripOuterBrackets(text)
    const out: Array<[MathValue, Expr]> = []
    for (const piece of ListParsing.split(text, decimalComma)) {
      for (const variant of ListParsing.expandPlusMinus(ListParsing.stripAssignment(piece))) {
        const body = ListParsing.stripAssignment(variant)
        try {
          const r = MathParser.parseDetailed(body)
          const v = sortedStrings(freeVariables(r.expr))[0]
          if (v !== undefined) {
            return { ok: false, error: new MathError('syntax', tr('«%@» tiene la letra «%@»: escribe solo números (o expresiones numéricas), separados por comas', body, v)) }
          }
          out.push([ValueReadings.evaluate(reading, r.expr), r.expr])
        } catch (e) {
          if (e instanceof MathError) return { ok: false, error: new MathError(e.kind, tr('No pude leer «%@» (%@)', body, e.message), e.position) }
          return { ok: false, error: new MathError('syntax', tr('No pude leer «%@»', body)) }
        }
      }
    }
    return { ok: true, items: out }
  }

  private evaluate(trimmed: string, expectedValues: readonly MathValue[], decimalComma: boolean, reading: ValueReading): CheckVerdict {
    const normalizedWhole = trimWS(normalizeText(trimmed).string)
    let student: Array<[MathValue, Expr]> = []
    if (!ListParsing.isEmptyWord(normalizedWhole) && !ListParsing.isEmptyWord(ListParsing.stripOuterBrackets(normalizedWhole))) {
      const r = this.parsePieces(trimmed, decimalComma, reading)
      if (!r.ok) return Verdict.format(r.error.message)
      student = r.items
      if (student.length === 0) return Verdict.format(tr('Escribe al menos un valor, por ejemplo 2, -3.'))
      if (student.length > 200) return Verdict.format(tr('Hay demasiados valores: escribe solo las soluciones, separadas por comas.'))
    }

    const normalizedText = student.length === 0 ? '∅' : '{' + student.map((s) => toPlain(s[1])).join(', ') + '}'
    const latexText = student.length === 0 ? '\\varnothing' : '\\left\\{' + student.map((s) => toLatex(s[1])).join(',\\,') + '\\right\\}'

    // Conjunto vacío esperado
    if (expectedValues.length === 0) {
      if (student.length === 0) return Verdict.correct(null, normalizedText, latexText)
      return Verdict.wrong(tr('Esa ecuación no tiene solución: sustituye tus valores en la ecuación original y revisa el dominio.'), ['extraSolution'], normalizedText, latexText)
    }
    if (student.length === 0) {
      return Verdict.wrong(tr('Sí hay solución: revisa si descartaste un valor que en realidad era válido.'), ['missingSolution'], normalizedText, latexText)
    }

    // Orden importante
    if (this.ordered) {
      const same = student.length === expectedValues.length && student.every((s, i) => ValueMatch.equal(s[0], expectedValues[i]))
      if (same) return Verdict.correct(null, normalizedText, latexText)
      if (sameElements(student.map((s) => s[0]), expectedValues, true)) {
        return Verdict.partial(0.5, tr('Los valores están bien, pero el orden importa.'), ['orderMatters'], normalizedText, latexText)
      }
    }

    // Como conjunto: sin repetidos
    const unique: Array<[MathValue, Expr]> = []
    for (const [v, e] of student) if (!unique.some((u) => ValueMatch.same(u[0], v))) unique.push([v, e])
    const expectedUnique: MathValue[] = []
    for (const v of expectedValues) if (!expectedUnique.some((u) => ValueMatch.same(u, v))) expectedUnique.push(v)

    let matchedExpected = 0
    let approxMatches = 0
    const usedStudent = new Set<number>()
    const pending: MathValue[] = []
    for (const e of expectedUnique) {
      const idx = unique.findIndex((u, i) => !usedStudent.has(i) && ValueMatch.equal(u[0], e))
      if (idx >= 0) {
        usedStudent.add(idx)
        matchedExpected += 1
      } else pending.push(e)
    }
    // aproximaciones decimales (0.333 por 1/3) de lo que queda sin pareja
    for (const e of pending) {
      const idx = unique.findIndex((u, i) => !usedStudent.has(i) && isDecimalApproximation(u[0], u[1], e))
      if (idx >= 0) {
        usedStudent.add(idx)
        matchedExpected += 1
        approxMatches += 1
      }
    }
    const missing = expectedUnique.length - matchedExpected
    const extra = unique.length - usedStudent.size
    if (missing === 0 && extra === 0 && !this.ordered) {
      if (approxMatches > 0) {
        return Verdict.partial(0.5, tr('Alguno de tus valores es una aproximación decimal: escribe los valores exactos (fracciones o radicales) o usa más cifras.'), ['rounding'], normalizedText, latexText)
      }
      return Verdict.correct(null, normalizedText, latexText)
    }
    if (missing === 0 && extra === 0 && this.ordered) {
      // mismos valores distintos pero con otros repetidos
      return Verdict.wrong(tr('Los valores son los correctos, pero la cantidad de repeticiones no coincide.'), ['other'], normalizedText, latexText)
    }

    // signos contrarios en todo el conjunto
    const negatedExpected = expectedUnique.map((v): MathValue => {
      const n = v.kind === 'rational' ? v.value.negated() : null
      return n ? MV.rational(n) : MV.real(-MV.double(v))
    })
    const uniqueValues = unique.map((u) => u[0])
    if (sameElements(uniqueValues, negatedExpected, false) && !sameElements(uniqueValues, expectedUnique, false)) {
      return Verdict.wrong(tr('Casi: los signos de tus soluciones están al revés.'), ['signError'], normalizedText, latexText)
    }

    let labels: Diagnosis[]
    let message: string
    if (extra > 0 && missing === 0) {
      labels = ['extraSolution']
      message = extra === 1
        ? tr('Uno de tus valores no es solución: sustitúyelo en la ecuación original y revisa el dominio (¿solución extraña?).')
        : tr('Algunos de tus valores no son solución: sustitúyelos en la ecuación original y revisa el dominio.')
    } else if (missing > 0 && extra === 0) {
      labels = ['missingSolution']
      message = missing === 1
        ? tr('Te falta una solución: revisa si descartaste un valor válido o si la ecuación tiene más de una raíz.')
        : tr('Te faltan %lld soluciones.', missing)
    } else {
      labels = ['extraSolution', 'missingSolution']
      message = matchedExpected === 0
        ? tr('Tu conjunto no coincide: ningún valor es correcto.')
        : tr('Tu conjunto no coincide: acertaste %lld de %lld.', matchedExpected, expectedUnique.length)
    }
    if (matchedExpected > 0) {
      const fraction = matchedExpected / expectedUnique.length
      const credit = extra === 0 ? 0.5 * fraction : 0.5 * fraction * 0.5
      return Verdict.partial(roundHalfAwayFromZero(credit * 100) / 100, message, labels, normalizedText, latexText)
    }
    return Verdict.wrong(message, labels, normalizedText, latexText)
  }

  // MARK: Conjuntos de palabras

  private checkTextSet(trimmed: string): CheckVerdict {
    const norm = (s: string): string => trimWSNL(foldedLower(s))
    const text = normalizeText(trimmed).string
    const given = ListParsing.split(ListParsing.stripOuterBrackets(text)).map(norm)
    const want = this.expected.map(norm)
    const joined = given.join(', ')
    if (this.ordered) {
      if (arraysEqual(given, want)) return Verdict.correct(null, joined)
      if (arraysEqual([...given].sort(compareStrings), [...want].sort(compareStrings))) {
        return Verdict.partial(0.5, tr('Los valores están bien, pero el orden importa.'), ['orderMatters'], joined)
      }
      if (setsEqual(new Set(given), new Set(want))) {
        return Verdict.wrong(tr('Los valores son los correctos, pero la cantidad de repeticiones no coincide.'), ['other'], joined)
      }
    }
    const missing = want.filter((w) => !given.includes(w))
    const extra = given.filter((g) => !want.includes(g))
    if (missing.length === 0 && extra.length === 0) return Verdict.correct(null, joined)
    const labels: Diagnosis[] = []
    if (extra.length > 0) labels.push('extraSolution')
    if (missing.length > 0) labels.push('missingSolution')
    const matched = want.length - missing.length
    if (matched > 0) {
      return Verdict.partial(roundHalfAwayFromZero(((0.5 * matched) / Math.max(want.length, 1)) * 100) / 100, tr('Tu lista no coincide: acertaste %lld de %lld.', matched, want.length), labels, joined)
    }
    return Verdict.wrong(tr('Tu lista no coincide.'), labels, joined)
  }
}

function canEvaluate(e: Expr, angle: AngleMode): boolean {
  try {
    ValueReadings.evaluate({ angle, degreeLabel: false }, e)
    return true
  } catch {
    return false
  }
}

/** ¿Los valores escritos `a` son los de la referencia `b` (con repetidos si `multiset`)? `b` hace de clave. */
function sameElements(a: readonly MathValue[], b: readonly MathValue[], multiset: boolean): boolean {
  if (multiset && a.length !== b.length) return false
  const pool = [...b]
  for (const x of a) {
    const i = pool.findIndex((y) => ValueMatch.equal(x, y))
    if (i < 0) return false
    if (multiset) pool.splice(i, 1)
  }
  if (multiset) return pool.length === 0
  return b.every((y) => a.some((x) => ValueMatch.equal(x, y)))
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}
