import { E, containsNode, freeVariables, type Expr } from '../core/expr'
import { tr } from '../core/i18n'
import { charCount, chars as toChars, isASCII, isDigit, isLetter, isNumberChar, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError, MV, type AngleMode, type MathValue } from '../core/types'
import { evaluate } from '../eval/evaluate'
import { Numerics } from '../eval/numerics'
import { DecimalDigits } from '../format/decimal-digits'
import { Fraction } from '../numbers/fraction'
import { INT_MAX, UINT_MAX, fitsInt, gcdBig } from '../numbers/int64'
import { normalizeText } from '../parse/normalizer'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { UnitTable, unitQuantityName, type UnitInfo } from '../units/unit-table'
import { AnswerWords } from './answer-words'
import type { NumericSpec } from './specs'
import { rxGroups, ulp } from './rx'
import { DegreeLabel, ValueMatch } from './value-match'
import { Verdict, type CheckVerdict, type Diagnosis, type VerdictStatus } from './verdict'

// MARK: - Forma en que se escribió un número

/** Forma en que el estudiante escribió un número (entero, decimal, fracción, mixto, científica, porcentaje). */
export class WrittenForm {
  isInteger = false
  isDecimal = false
  decimalPlaces = 0
  isFraction = false
  fraction: { num: bigint; den: bigint } | null = null
  isMixed = false
  mixedFraction: { num: bigint; den: bigint } | null = null
  isScientific = false
  mantissa: number | null = null
  hasPercent = false

  get isPlainNumber(): boolean {
    return this.isInteger || this.isDecimal
  }

  constructor(text: string) {
    const t = trimWS(text)
    this.hasPercent = t.includes('%')
    const body = trimWS(t.split('%').join(''))
    if (/^[+-]?\d+$/.test(body)) this.isInteger = true
    if (/^[+-]?(\d+[.,]\d*|[.,]\d+)$/.test(body)) {
      this.isDecimal = true
      const cs = toChars(body)
      const sep = cs.findIndex((c) => c === '.' || c === ',')
      if (sep >= 0) this.decimalPlaces = cs.length - sep - 1
    }
    const g = rxGroups(/^\(?\s*([+-]?\d+)\s*\)?\s*\/\s*\(?\s*([+-]?\d+)\s*\)?$/, body)
    const n = g ? swiftInt(g[1]) : null
    const d = g ? swiftInt(g[2]) : null
    if (n !== null && d !== null && d !== 0n) {
      this.isFraction = true
      this.fraction = { num: n, den: d }
    }
    if (/^[+-]?\d+\s+\d+\s*\/\s*\d+$/.test(body)) this.isMixed = true
    if (this.isMixed) {
      const m = rxGroups(/(\d+)\s*\/\s*(\d+)$/, body)
      const mn = m ? swiftInt(m[1]) : null
      const md = m ? swiftInt(m[2]) : null
      if (mn !== null && md !== null && md > 0n) this.mixedFraction = { num: mn, den: md }
    }
    const s = rxGroups(/^([+-]?\d+(?:[.,]\d+)?)\s*(?:[eE]\s*[+-]?\d+|\*\s*10\s*\^\s*\(?\s*[+-]?\d+\s*\)?)$/, body)
    if (s && s.length >= 2) {
      this.isScientific = true
      const m = Number(s[1].split(',').join('.'))
      this.mantissa = Number.isNaN(m) ? null : m
    }
  }
}

/** `Int(texto)` de Swift: entero con signo opcional que cabe en 64 bits. */
function swiftInt(s: string): bigint | null {
  if (!/^[+-]?\d+$/.test(s)) return null
  const v = BigInt(s)
  return fitsInt(v) ? v : null
}

// MARK: - Comprobador

interface Expected {
  value: MathValue
  unit: UnitInfo | null
  undefined: boolean
}

interface Attempt {
  expr: Expr
  value: MathValue
  numberText: string
  unit: UnitInfo | null
  unitText: string | null
  written: WrittenForm
  notes: string[]
}

type Analysis = { ok: true; attempt: Attempt } | { ok: false; verdict: CheckVerdict }

/** La incertidumbre de precisión pertenece a la evaluación, no al formato escrito por el estudiante. */
interface ReadingOutcome {
  verdict: CheckVerdict
  precisionIndeterminate: boolean
}

type DecimalMatch = 'exact' | 'unrounded' | 'oneOff' | 'none' | 'indeterminate'

interface DecimalPrecision {
  places: number
  quantum: number
  quantumFraction: Fraction | null
}

/** Funciones cuyo resultado depende de la unidad de los ángulos. */
const ANGLE_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'asec', 'acsc', 'acot', 'atan2'])

const emptyAnswer = (): string => tr('Escribe tu respuesta.')
const notUnderstood = (): string => tr('No entiendo tu respuesta.')
const writeAsFraction = (): string => tr('El valor es correcto, pero escríbelo como fracción (por ejemplo 3/4).')

/** Comprobador de respuestas numéricas (con unidad, forma, tolerancias y diagnóstico de errores típicos). */
export class NumericChecker {
  readonly spec: NumericSpec
  /** Lectura en grados: el «°» de la raíz del número (en la clave o en lo escrito) es una etiqueta (30° = 30). */
  degreeLabel: boolean

  constructor(spec: NumericSpec, degreeLabel = false) {
    this.spec = spec
    this.degreeLabel = degreeLabel
  }

  // MARK: Punto de entrada

  check(raw: string): CheckVerdict {
    const spec = this.spec
    const trimmed = trimWSNL(raw)
    const expected = this.parseExpected(spec.value)
    if (!expected) return Verdict.format(tr('No se pudo interpretar la respuesta esperada del ejercicio («%@»).', spec.value))
    if (trimmed === '') return Verdict.format(emptyAnswer())
    if (charCount(trimmed) > 300) return Verdict.format(tr('La respuesta es demasiado larga.'))

    const saidUndefined = AnswerWords.saysUndefined(trimmed)
    if (expected.undefined) {
      if (saidUndefined) return Verdict.correct()
      // ¿se puede leer lo escrito? (si no, es un problema de formato y no un error)
      const a = this.analyze(normalizeText(trimmed).string, false)
      if (!a.ok) return a.verdict
      return Verdict.wrong(tr('En este caso la expresión no está definida: la respuesta correcta es «indefinido» (DNE).'), ['other'])
    }
    if (saidUndefined) return Verdict.wrong(tr('Esa expresión sí está definida: revisa tu cálculo.'), ['other'])

    // Ángulos: si la clave o lo escrito llevan «°» (y los ángulos no están ya en grados), también la lectura con el «°»
    // como etiqueta («30°» frente a la clave «30»). Se queda la mejor; a igualdad, la normal.
    const verdicts: ReadingOutcome[] = [this.checkReadings(trimmed, expected)]
    if (!this.degreeLabel && spec.angle === 'radians' && [trimmed, spec.value, ...spec.alternatives].some((t) => DegreeLabel.mentioned(t))) {
      const degrees = new NumericChecker(spec, true)
      const e = degrees.parseExpected(spec.value)
      if (e && !e.undefined) verdicts.push(degrees.checkReadings(trimmed, e))
    }
    return bestReading(verdicts)?.verdict ?? Verdict.format(notUnderstood())
  }

  /**
   * Varias lecturas posibles (separador de miles frente a coma decimal): se queda la mejor; a igualdad, la preferida
   * (la primera de `groupingReadings`, según el separador decimal del estudiante).
   */
  private checkReadings(trimmed: string, expected: Expected): ReadingOutcome {
    const readings = NumericChecker.groupingReadings(NumericChecker.joinSpaceGroupedThousands(normalizeText(trimmed).string))
    return bestReading(readings.map((r) => this.evaluateReading(r, expected))) ?? { verdict: Verdict.format(notUnderstood()), precisionIndeterminate: false }
  }

  // MARK: Valor esperado

  private parseExpected(text: string): Expected | null {
    if (AnswerWords.saysUndefined(text)) return { value: MV.int(0), unit: null, undefined: true }
    const v = this.evaluateExpected(text)
    if (v) return { value: v, unit: null, undefined: false }
    // "5 m/s" dentro del valor esperado: se separa la unidad
    const split = NumericChecker.splitTrailingUnit(text)
    if (split) {
      const nv = this.evaluateExpected(split[0])
      const u = UnitTable.parse(split[1])
      if (nv && u) return { value: nv, unit: u, undefined: false }
    }
    return null
  }

  private evaluateExpected(text: string): MathValue | null {
    try {
      const parsed = MathParser.parse(text)
      if (freeVariables(parsed).size > 0) return null
      const e = this.degreeLabel ? DegreeLabel.strip(parsed) : parsed
      return evaluate(e, {}, this.spec.angle)
    } catch {
      return null
    }
  }

  // MARK: Lecturas del texto

  /** `1 000 000` (miles separados por espacios, como en el SI) → `1000000`. No toca números mixtos (`2 1/2`). */
  static joinSpaceGroupedThousands(text: string): string {
    if (!text.includes(' ')) return text
    return text.replace(/(?<![\d.,])\d{1,3}(?: \d{3})+(?![\d/])/g, (m) => m.split(' ').join(''))
  }

  /** Decimales de un valor esperado escrito como decimal (`"0.333"` → 3); `null` si no es un decimal simple. */
  static decimalPlaces(ofLiteral: string): number | null {
    const g = rxGroups(/^\s*[+-]?\d*[.,](\d+)\s*$/, ofLiteral)
    return g && g.length === 2 ? g[1].length : null
  }

  /**
   * Interpreta los separadores de miles / decimales de cada número del texto.
   * - `1,234.5` y `1.234,5` → 1234.5; `1,234,567` → 1234567; `1,5` → 1.5 (coma decimal).
   * - Un solo grupo de tres cifras (`1,234` o `1.234`) puede ser un decimal o un número con separador de miles. El
   *   separador decimal del propio estudiante (`NumberInput.decimalComma`) NUNCA es de miles; el otro sí es ambiguo:
   *   con punto decimal, `1,234` puede ser 1234 (va primero) o 1.234. Se aceptan las dos lecturas que den la respuesta.
   */
  static groupingReadings(text: string): string[] {
    const re = /(?<![\d.,])\d[\d.,]*\d(?![\d.,]|[eE][+-]?\d)/g
    const matches = [...text.matchAll(re)]
    let decimalReading = text
    let thousandsReading = text
    let ambiguousFound = false
    const ambiguousSeparators = new Set<string>()
    for (let k = matches.length - 1; k >= 0; k--) {
      const m = matches[k]
      const token = m[0]
      const start = m.index ?? 0
      const end = start + token.length
      if (!token.includes('.') && !token.includes(',')) continue
      const [single, alt] = readToken(token)
      decimalReading = decimalReading.slice(0, start) + single + decimalReading.slice(end)
      if (alt !== null) {
        ambiguousFound = true
        ambiguousSeparators.add(token.includes(',') ? ',' : '.')
        thousandsReading = thousandsReading.slice(0, start) + alt + thousandsReading.slice(end)
      } else {
        thousandsReading = thousandsReading.slice(0, start) + single + thousandsReading.slice(end)
      }
    }
    if (!ambiguousFound || decimalReading === thousandsReading) return [decimalReading]
    if (ambiguousSeparators.size === 1) {
      const separator = [...ambiguousSeparators][0]
      // El separador decimal del estudiante nunca es de miles: solo la lectura decimal (`1.234` con punto decimal).
      if ((separator === ',') === NumberInput.decimalComma) return [decimalReading]
      // El otro separador: miles primero (`1,234` con punto decimal), y también la lectura decimal.
      return [thousandsReading, decimalReading]
    }
    return [decimalReading, thousandsReading]
  }

  /** Quita prefijos ("x =", "aprox."), símbolos de moneda y espacios sobrantes. */
  private clean(text: string): string {
    let t = trimWSNL(text)
    // "x = 5", "f(x) = 3/4", "x ≈ 0.7": se queda lo que hay tras el último = o ≈ (no los de <=, >=, !=)
    const cs = toChars(t)
    let idx = -1
    for (let i = cs.length - 1; i >= 0; i--) {
      if (cs[i] === '=' || cs[i] === '≈' || cs[i] === '~') {
        idx = i
        break
      }
    }
    if (idx >= 0) {
      const before = idx > 0 ? cs[idx - 1] : ' '
      if (!'<>!'.includes(before)) {
        const after = trimWS(cs.slice(idx + 1).join(''))
        if (after !== '') t = after
      }
    }
    t = t.replace(/^\s*(?:aprox(?:imadamente)?|approx(?:imately)?|about|around|circa|ca)\.?\s+/u, '')
    t = t.split('$').join('').split('€').join('').split('£').join('')
    // "3.2 x 10^3" / "3.2 X 10^-3" → 3.2*10^3
    t = t.replace(/(\d)\s*[xX]\s*10\s*\^/g, '$1*10^')
    t = t.replace(/(\d)\s*[xX]\s*10(?![\d])/g, '$1*10')
    t = t.replace(/(?<=[A-Za-z%°])\.$/u, '') // "5 m." → "5 m"
    return trimWSNL(t)
  }

  // MARK: Separación número / unidad

  /** Busca la partición más corta del texto en "número" + "unidad" donde ambos son válidos. */
  static splitTrailingUnit(text: string): [string, string] | null {
    const cs = toChars(text)
    if (cs.length < 2 || cs.length > 120) return null
    for (let i = 1; i < cs.length; i++) {
      const numPart = trimWS(cs.slice(0, i).join(''))
      const unitPart = trimWS(cs.slice(i).join(''))
      if (numPart === '' || unitPart === '' || UnitTable.parse(unitPart) === null) continue
      try {
        if (freeVariables(MathParser.parse(numPart)).size === 0) return [numPart, unitPart]
      } catch {
        // no es una expresión: se prueba como número
      }
      if (Fraction.parse(numPart) !== null) return [numPart, unitPart]
    }
    return null
  }

  /**
   * Parte numérica de un texto cuyo final parece una unidad (aunque no se reconozca): `5 lo que sea` → `5`. Se busca el número
   * más largo («3.01*10^23 moléculas» → «3.01*10^23», no «3»), y lo que sigue empieza por una letra, «°» o «%».
   */
  private splitLooseUnit(text: string): string | null {
    const cs = toChars(text)
    if (cs.length < 2 || cs.length > 120) return null
    for (let i = cs.length - 1; i >= 1; i--) {
      const numPart = trimWS(cs.slice(0, i).join(''))
      const rest = trimWS(cs.slice(i).join(''))
      if (numPart === '' || rest === '') continue
      const restChars = toChars(rest)
      if (!(isLetter(restChars[0]) || restChars[0] === '°' || restChars[0] === '%')) continue
      if (!restChars.every((c) => isLetter(c) || isNumberChar(c) || ' °%Ω/·*^-.()'.includes(c))) continue
      try {
        if (freeVariables(MathParser.parse(numPart)).size === 0) return numPart
      } catch {
        // sigue probando
      }
    }
    return null
  }

  /**
   * Un número seguido de palabras («3.01*10^23 moléculas», «88 g de CO2»): el número más largo del principio y lo que sigue
   * (que empieza por letra y tiene al menos dos). null si no es eso (una variable suelta, «5x», sigue siendo una expresión).
   */
  static numberThenWords(text: string): { num: string; rest: string } | null {
    const cs = toChars(text)
    if (cs.length < 3 || cs.length > 120) return null
    for (let i = cs.length - 1; i >= 1; i--) {
      const num = trimWS(cs.slice(0, i).join(''))
      const rest = trimWS(cs.slice(i).join(''))
      if (num === '' || rest === '' || !/\d/.test(num)) continue
      const restChars = toChars(rest)
      if (!isLetter(restChars[0]) || restChars.filter(isLetter).length < 2) continue
      if (!restChars.every((c) => isLetter(c) || isNumberChar(c) || ' °%Ω/·*^-.,()₀₁₂₃₄₅₆₇₈₉⁺⁻²³'.includes(c))) continue
      try {
        if (freeVariables(MathParser.parse(num)).size === 0) return { num, rest }
      } catch {
        // sigue probando
      }
    }
    return null
  }

  /** La unidad con la que empiezan unas palabras («g de CO2» → «g»), si hay más palabras detrás. */
  static leadingUnit(words: string): string | null {
    const ws = words.split(/\s+/).filter((w) => w !== '')
    for (let k = ws.length - 1; k >= 1; k--) {
      const unit = ws.slice(0, k).join(' ')
      if (UnitTable.parse(unit) !== null) return unit
    }
    return null
  }

  private evaluateNumber(text: string): { expr: Expr; value: MathValue; notes: string[] } | null {
    // número mixto "1 3/4"
    if (/^\s*[+-]?\d+\s+\d+\s*\/\s*\d+\s*$/.test(text)) {
      const f = Fraction.parse(text)
      if (f) return { expr: E.num(f), value: MV.rational(f), notes: [] }
    }
    try {
      const r = MathParser.parseDetailed(text)
      if (freeVariables(r.expr).size > 0) return null
      const v = evaluate(this.degreeLabel ? DegreeLabel.strip(r.expr) : r.expr, {}, this.spec.angle)
      return { expr: r.expr, value: v, notes: r.notes }
    } catch {
      return null
    }
  }

  /** Explica por qué un texto no se pudo leer como número. */
  private explainFailure(text: string): string {
    try {
      const r = MathParser.parseDetailed(text)
      const v = sortedStrings(freeVariables(r.expr))[0]
      if (v !== undefined) {
        return tr('Tu respuesta tiene la letra «%@»: aquí se espera un número (o una expresión numérica como sqrt(2)/2).', v)
      }
      try {
        evaluate(r.expr, {}, this.spec.angle)
      } catch (e) {
        if (e instanceof MathError) return tr('Esa expresión no da un número real: %@.', e.message)
      }
      return tr('No pude leer tu respuesta como un número.')
    } catch (e) {
      if (e instanceof MathError) return tr('No pude leer «%@» como un número: %@.', text, e.message)
      return tr('No pude leer tu respuesta como un número.')
    }
  }

  private analyze(text: string, expectsUnit: boolean): Analysis {
    const cleaned = this.clean(text)
    if (cleaned === '') return { ok: false, verdict: Verdict.format(emptyAnswer()) }
    const normalized = trimWS(normalizeText(cleaned).string)

    const build = (numText: string, unitText: string | null): Analysis => {
      const n = this.evaluateNumber(numText)
      if (!n) return { ok: false, verdict: Verdict.format(this.explainFailure(numText)) }
      let unit: UnitInfo | null = null
      if (unitText !== null) {
        unit = UnitTable.parse(unitText)
        if (!unit) return { ok: false, verdict: Verdict.format(tr('No reconozco la unidad «%@».', unitText)) }
      }
      return { ok: true, attempt: { expr: n.expr, value: n.value, numberText: numText, unit, unitText, written: new WrittenForm(numText), notes: n.notes } }
    }

    // Con unidad esperada se intenta separar la unidad primero; si no, se intenta leer todo como número.
    if (expectsUnit) {
      const s = NumericChecker.splitTrailingUnit(normalized)
      if (s) return build(s[0], s[1])
    }
    if (this.evaluateNumber(normalized) !== null) return build(normalized, null)
    const s = NumericChecker.splitTrailingUnit(normalized)
    if (s) return build(s[0], s[1])
    // Con la unidad ignorada, cualquier texto con aspecto de unidad al final se descarta.
    if (this.spec.unitMode === 'ignore') {
      const n = this.splitLooseUnit(normalized)
      if (n !== null) return build(n, null)
    }
    // Un número con palabras detrás: «88 g de CO2» vale como 88 g si la clave lleva unidad; si no, se pide solo el número (antes
    // salía «tu respuesta tiene la letra «a»» o «para un subíndice escribe O_2»)
    const words = NumericChecker.numberThenWords(normalized)
    if (words) {
      const unit = expectsUnit ? NumericChecker.leadingUnit(words.rest) : null
      if (unit !== null) return build(words.num, unit)
      const message = expectsUnit && this.spec.unit !== null
        ? tr('Escribe solo el número y la unidad (%@), sin más palabras.', this.spec.unit)
        : tr('Escribe solo el número, sin unidades ni palabras detrás.')
      return { ok: false, verdict: Verdict.format(message) }
    }
    return build(normalized, null)
  }

  // MARK: Evaluación de una lectura

  private evaluateReading(text: string, expected: Expected): ReadingOutcome {
    const spec = this.spec
    const analysis = this.analyze(text, spec.unit !== null || expected.unit !== null)
    if (!analysis.ok) return { verdict: analysis.verdict, precisionIndeterminate: false }
    const attempt = analysis.attempt
    // un número mixto se muestra como se escribió (3 1/2), no como 3.5
    let numberPlain = toPlain(attempt.expr)
    let numberLatex = toLatex(attempt.expr)
    if (attempt.written.isMixed) {
      const g = rxGroups(/^\s*([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/, attempt.numberText)
      if (g && g.length === 4) {
        numberPlain = `${g[1]} ${g[2]}/${g[3]}`
        numberLatex = `${g[1]}\\frac{${g[2]}}{${g[3]}}`
      }
    }
    const normalizedText = numberPlain + (attempt.unit !== null ? ' ' + (attempt.unitText ?? '') : '')
    const latexText = numberLatex + (attempt.unitText !== null ? UnitFormatting.latex(attempt.unitText) : '')
    const note = attempt.notes[0]
    const finish = (v: CheckVerdict, precisionIndeterminate = false): ReadingOutcome => {
      let out = Verdict.withInput(v, normalizedText, latexText)
      if (out.status !== 'correct' && note !== undefined) out = Verdict.appending(out, note)
      return { verdict: out, precisionIndeterminate }
    }

    // Unidades
    const specUnit = spec.unit !== null ? UnitTable.parse(spec.unit) : null
    const expectedUnit: UnitInfo | null = specUnit ?? expected.unit
    const unitSpecGiven = spec.unit !== null || expected.unit !== null
    let value = attempt.value
    let unitIssue: VerdictStatus | null = null
    let unitDiag: Diagnosis[] = []
    let unitMessage: string | null = null
    const rawNumberValue = attempt.value
    if (unitSpecGiven && spec.unitMode !== 'ignore') {
      const expectedUnitText = spec.unit ?? ''
      const given = attempt.unit
      if (given) {
        if (expectedUnit) {
          if (UnitTable.sameDimension(given.dimension, expectedUnit.dimension)) {
            const converted = UnitTable.convertValue(attempt.value, given, expectedUnit)
            if (converted) value = converted
          } else {
            unitIssue = 'partial'
            unitDiag = ['unitWrong']
            const quantity = unitQuantityName(expectedUnit)
            unitMessage =
              expectedUnitText === ''
                ? tr('La unidad no corresponde: se esperaba una unidad de %@.', quantity)
                : tr('La unidad no corresponde: se esperaba una unidad de %@ (%@).', quantity, expectedUnitText)
          }
        }
      } else if (spec.unitMode === 'required') {
        unitIssue = 'partial'
        unitDiag = ['unitMissing']
        unitMessage = expectedUnitText === '' ? tr('Falta la unidad.') : tr('Falta la unidad (%@).', expectedUnitText)
      }
    }

    // Candidatos
    const candidates: MathValue[] = [expected.value]
    for (const alt of spec.alternatives) {
      const v = this.evaluateExpected(alt)
      if (v) candidates.push(v)
    }

    // Con decimales pedidos, la precisión decimal prevalece sobre las tolerancias genéricas del autor.
    let precisionIndeterminate = false
    const decimalMatch = (v: MathValue, c: MathValue, k: number): DecimalMatch => {
      const result = compareDecimals(v, c, k)
      if (result === 'indeterminate') precisionIndeterminate = true
      return result
    }
    const creditMatches = (v: MathValue, c: MathValue): boolean => {
      if (spec.decimals !== null) return decimalMatch(v, c, spec.decimals) === 'exact'
      return this.matches(v, c)
    }

    // Comparación del valor (ya en la unidad esperada): agotar primero todos los plenos certificados.
    let matched: MathValue | null = null
    let partialRounding: [Diagnosis, string] | null = null
    let unroundedAccurate = false
    if (spec.decimals !== null) {
      const k = spec.decimals
      const comparisons = candidates.map((c) => [c, decimalMatch(value, c, k)] as const)
      const full = comparisons.find((x) => x[1] === 'exact')
      if (full) matched = full[0]
      if (matched === null) {
        if (comparisons.some((x) => x[1] === 'unrounded')) {
          unroundedAccurate = true
        } else if (comparisons.some((x) => x[1] === 'oneOff')) {
          partialRounding = [
            'rounding',
            k === 1
              ? tr('Casi: revisa el redondeo; se pide con 1 decimal y hay que redondear solo al final de todos los cálculos.')
              : tr('Casi: revisa el redondeo; se pide con %lld decimales y hay que redondear solo al final de todos los cálculos.', k),
          ]
        }
      }
    } else {
      for (const c of candidates) {
        if (this.matches(value, c)) {
          matched = c
          break
        }
      }
    }

    // ¿Coincidía el número escrito pero con la unidad mal?
    if (unitIssue !== null) {
      // El número solo cuenta si coincide con el valor esperado sin convertir (misma cifra, otra unidad o sin unidad).
      const numberMatches = candidates.some((c) => creditMatches(rawNumberValue, c)) || matched !== null
      if (numberMatches) return finish(Verdict.make(unitIssue, 0.5, unitMessage, unitDiag))
      // número también mal: sigue como incorrecto, anotando la unidad
    }

    if (matched !== null) return finish(this.applyForm(attempt, matched))

    if (unroundedAccurate && spec.decimals !== null) {
      const k = spec.decimals
      const message = k === 1
        ? tr('El valor es correcto, pero se pide redondeado a 1 decimal.')
        : tr('El valor es correcto, pero se pide redondeado a %lld decimales.', k)
      return finish(Verdict.wrongForm(message, ['sameAsExpected', 'rounding']))
    }
    if (partialRounding) return finish(Verdict.partial(0.5, partialRounding[1], [partialRounding[0]]))

    // Se pidió porcentaje y escribió la cifra del porcentaje sin el símbolo %: el valor está bien, falta el símbolo.
    if (spec.form === 'percent' && !attempt.written.hasPercent) {
      let asFraction: MathValue
      const q = MV.fraction(value)
      const d = q ? q.divided(Fraction.int(100)) : null
      if (d) asFraction = MV.rational(d)
      else asFraction = MV.real(MV.double(value) / 100)
      if (candidates.some((c) => creditMatches(asFraction, c))) {
        return finish(Verdict.wrongForm(tr('El valor es correcto, pero escríbelo como porcentaje, con el símbolo %.'), ['sameAsExpected', 'percentVsFraction']))
      }
    }

    // Aproximaciones decimales de un valor exacto (0.33 por 1/3; 0.7071 por √2/2)
    const converted = ((): boolean => {
      const given = attempt.unit
      const exp = expectedUnit
      if (!given || !exp || !UnitTable.sameDimension(given.dimension, exp.dimension)) return false
      return given.factor !== exp.factor || given.offset !== exp.offset
    })()
    // La clave es un decimal redondeado (0.333) y se escribió el valor exacto o con más cifras (1/3, 0.3333):
    // el valor es correcto, pero se espera el decimal.
    const keyPlaces = NumericChecker.decimalPlaces(spec.value)
    if (spec.decimals === null && !converted && keyPlaces !== null && keyPlaces >= 1 && !(attempt.written.isPlainNumber && attempt.written.decimalPlaces <= keyPlaces)) {
      const k = keyPlaces
      const rounded = Numerics.roundHalfUp(MV.double(value), k)
      if (candidates.some((c) => ValueMatch.close(rounded, MV.double(c), 1e-9))) {
        const shown = NumberInput.shown(rounded, k, false)
        const message = k === 1
          ? tr('El valor es correcto, pero se espera como decimal redondeado a 1 decimal: %@.', shown)
          : tr('El valor es correcto, pero se espera como decimal redondeado a %lld decimales: %@.', k, shown)
        return finish(Verdict.wrongForm(message, ['sameAsExpected', 'rounding']))
      }
    }

    if (spec.decimals === null && !converted) {
      const approx = approximationVerdict(attempt, candidates, value)
      if (approx) return finish(approx)
    }

    // ¿Ángulos en la otra unidad? (sin(30) con los ángulos en radianes, como una calculadora en otro modo)
    let angleIssue: CheckVerdict | null = null
    if (attempt.unit === null && containsNode(attempt.expr, (n) => n.type === 'call' && ANGLE_FUNCTIONS.has(n.name))) {
      const other: AngleMode = spec.angle === 'radians' ? 'degrees' : 'radians'
      let alt: MathValue | null = null
      try {
        alt = evaluate(attempt.expr, {}, other)
      } catch {
        alt = null
      }
      const altValue = alt
      if (altValue && candidates.some((c) => this.matches(altValue, c))) {
        const msg = spec.angle === 'radians'
          ? tr('Parece que escribiste los ángulos en grados, pero aquí se leen en radianes: usa el símbolo ° (por ejemplo sin(30°)) o pasa el ángulo a radianes.')
          : tr('Parece que escribiste los ángulos en radianes, pero aquí se leen en grados: pasa el ángulo a grados (π rad = 180°).')
        const issue = Verdict.wrong(msg, [spec.angle === 'radians' ? 'degreesVsRadians' : 'radiansVsDegrees'])
        if (spec.decimals === null) return finish(issue)
        angleIssue = issue
      }
    }

    // Incorrecta: diagnóstico
    let diag: Diagnosis[] = []
    let message: string | null = null
    // Número sin unidad que coincide con el resultado en otra unidad de la misma magnitud (100 por 1 m: está en cm)
    if (attempt.unit === null && spec.unitMode !== 'ignore' && expectedUnit) {
      const exp = expectedUnit
      search: for (const { symbol, unit: other } of UnitTable.commonUnits(exp)) {
        for (const c of candidates) {
          const inOther = UnitTable.convertValue(c, exp, other)
          if (!inOther || !this.matches(rawNumberValue, inOther)) continue
          diag = ['unitConversion']
          if (spec.unitMode === 'required') diag.push('unitMissing')
          const target = spec.unit ?? exp.text
          message = spec.unitMode === 'required'
            ? tr('Tu número coincide con el resultado expresado en %@, pero aquí se pide en %@: convierte la unidad y escríbela.', symbol, target)
            : tr('Tu número coincide con el resultado expresado en %@, pero aquí se pide en %@: convierte la unidad.', symbol, target)
          break search
        }
      }
    }
    for (const c of candidates) {
      const convertedFrom = attempt.unit !== null && expectedUnit !== null && UnitTable.sameDimension(attempt.unit.dimension, expectedUnit.dimension)
      const d = this.diagnose(value, c, attempt, convertedFrom)
      if (d.labels.length > 0) {
        for (const l of d.labels) if (!diag.includes(l)) diag.push(l)
        if (message === null) message = d.message
        break
      }
    }
    const given = attempt.unit
    if (given && expectedUnit && UnitTable.sameDimension(given.dimension, expectedUnit.dimension) && !diag.includes('unitConversion')) {
      // «5 K» por «5 °C»: si es una diferencia de temperatura (calorimetría, ΔT) está bien; si es una temperatura, no.
      // La clave no lo dice (para diferencias, el autor puede usar la unidad «Δ°C»): se avisa con crédito parcial.
      if (UnitTable.isKelvinCelsiusPair(given, expectedUnit) && candidates.some((c) => creditMatches(rawNumberValue, c))) {
        const offset = NumberInput.shown(273.15)
        return finish(Verdict.partial(0.5, tr('Si es una diferencia de temperatura, está bien (una variación de 1 K es una variación de 1 °C); si es una temperatura, recuerda que K = °C + %@.', offset), ['unitConversion']))
      }
      // El número escrito coincide con el esperado pero en otra escala de la misma magnitud
      if (candidates.some((c) => this.matches(rawNumberValue, c))) {
        diag.unshift('unitConversion')
        const written = attempt.unitText ?? ''
        message = spec.unit !== null
          ? tr('Revisa la conversión de unidades: el número coincide pero la unidad escrita (%@) no equivale a %@.', written, spec.unit)
          : tr('Revisa la conversión de unidades: el número coincide pero la unidad escrita (%@) no equivale a la esperada.', written)
      }
    }
    // Un parcial certificado se conserva aun si otra alternativa es indeterminada. Sin crédito certificado,
    // no atribuir al estudiante una limitación del evaluador.
    if (precisionIndeterminate) {
      return finish(Verdict.format(tr('No puedo comprobar esta respuesta con la precisión solicitada. Pide revisar el ejercicio.')), true)
    }
    if (angleIssue) return finish(angleIssue)
    if (unitIssue === 'partial') {
      const alreadyExplained = diag.includes('unitConversion')
      for (const l of unitDiag) if (!diag.includes(l)) diag.push(l)
      if (unitMessage !== null && !alreadyExplained) message = message !== null ? message + ' ' + unitMessage : unitMessage
    }
    if (diag.length === 0) diag = ['other']
    return finish(Verdict.wrong(message ?? tr('No es correcto.'), diag))
  }

  // MARK: Comparaciones

  /**
   * Igualdad de lo escrito (`v`) con un candidato (`c`, la clave). Con tolerancias del autor (`absTol`/`relTol`), las suyas
   * tal cual. Si no, la de todos los verificadores (`ValueMatch`).
   */
  private matches(v: MathValue, c: MathValue): boolean {
    const spec = this.spec
    if (spec.absTol > 0 || spec.relTol > 0) {
      const d = Math.abs(MV.double(v) - MV.double(c))
      return d <= spec.absTol || d <= spec.relTol * Math.abs(MV.double(c))
    }
    return ValueMatch.equal(v, c)
  }

  // MARK: Forma pedida

  private applyForm(a: Attempt, matchedValue: MathValue): CheckVerdict {
    const w = a.written
    const expectedIsInteger = MV.isInteger(matchedValue)
    switch (this.spec.form) {
      case 'any':
        return Verdict.correct()
      case 'integer':
        if (w.isInteger || (w.isDecimal && MV.isInteger(matchedValue))) return Verdict.correct()
        if (MV.isInteger(matchedValue)) {
          return Verdict.wrongForm(tr('El valor es correcto, pero escríbelo como número entero.'), ['sameAsExpected', 'notSimplified'])
        }
        return Verdict.correct()
      case 'fraction':
        if (w.isFraction || w.isInteger || w.isMixed) return Verdict.correct()
        if (expectedIsInteger) return Verdict.correct()
        return Verdict.wrongForm(writeAsFraction(), ['sameAsExpected', 'decimalInsteadOfFraction'])
      case 'reducedFraction': {
        const f = w.fraction ?? w.mixedFraction
        if (f) {
          const g = gcdBig(f.num, f.den)
          if (g > 1n || f.den < 0n) {
            const reduced = Fraction.of(f.num, f.den)?.plain ?? ''
            const message = reduced === ''
              ? tr('El valor es correcto, pero falta simplificar la fracción.')
              : tr('El valor es correcto, pero falta simplificar la fracción: %@/%@ = %@.', String(f.num), String(f.den), reduced)
            return Verdict.wrongForm(message, ['sameAsExpected', 'notReduced'])
          }
          return Verdict.correct()
        }
        if (w.isInteger) return Verdict.correct()
        if (expectedIsInteger && !w.isMixed) return Verdict.correct()
        return Verdict.wrongForm(tr('El valor es correcto, pero escríbelo como fracción simplificada (por ejemplo 3/4).'), ['sameAsExpected', w.isMixed ? 'notReduced' : 'decimalInsteadOfFraction'])
      }
      case 'decimal': {
        if (w.isPlainNumber) return Verdict.correct()
        const example = NumberInput.shown(0.75)
        return Verdict.wrongForm(tr('El valor es correcto, pero escríbelo como número decimal (por ejemplo %@).', example), ['sameAsExpected', 'fractionInsteadOfDecimal'])
      }
      case 'scientific': {
        if (w.isScientific && w.mantissa !== null && Math.abs(w.mantissa) >= 1 && Math.abs(w.mantissa) < 10) return Verdict.correct()
        const mantissa = NumberInput.shown(3.2)
        if (w.isScientific) {
          return Verdict.wrongForm(tr('El valor es correcto, pero en notación científica la parte decimal debe estar entre 1 y 10 (por ejemplo %@e4).', mantissa), ['sameAsExpected', 'notSimplified'])
        }
        return Verdict.wrongForm(tr('El valor es correcto, pero escríbelo en notación científica (por ejemplo %@e4 o %@×10^4).', mantissa, mantissa), ['sameAsExpected', 'other'])
      }
      case 'percent':
        if (w.hasPercent) return Verdict.correct()
        return Verdict.wrongForm(tr('El valor es correcto, pero escríbelo como porcentaje, con el símbolo %.'), ['sameAsExpected', 'percentVsFraction'])
      case 'mixedNumber': {
        const mixedText = tr('El valor es correcto, pero escríbelo como número mixto (por ejemplo 1 3/4).')
        if (w.isMixed && !(w.mixedFraction !== null && w.mixedFraction.num < w.mixedFraction.den)) {
          return Verdict.wrongForm(mixedText, ['sameAsExpected', 'notSimplified'])
        }
        const improper = !MV.isInteger(matchedValue) && Math.abs(MV.double(matchedValue)) > 1
        if (!improper) {
          return w.isFraction || w.isInteger || w.isMixed ? Verdict.correct() : Verdict.wrongForm(writeAsFraction(), ['sameAsExpected', 'decimalInsteadOfFraction'])
        }
        if (w.isMixed) return Verdict.correct()
        return Verdict.wrongForm(mixedText, ['sameAsExpected', 'notSimplified'])
      }
    }
  }

  // MARK: Diagnóstico de errores típicos

  /**
   * Decimales escritos por el estudiante, si su número tiene al menos 2 cifras significativas (para comparar con
   * candidatos redondeados: 43 por 42.97, -1.41 por -1.4142…). `null` si no es un número simple o es demasiado corto.
   */
  private writtenRoundingPlaces(a: Attempt): number | null {
    if (!a.written.isPlainNumber || a.written.hasPercent) return null
    const all = toChars(a.numberText).filter((c) => isASCII(c) && isDigit(c))
    let start = 0
    while (start < all.length && all[start] === '0') start += 1
    if (all.length - start < 2) return null
    return a.written.isDecimal ? a.written.decimalPlaces : 0
  }

  private diagnose(v: MathValue, c: MathValue, attempt: Attempt, convertedFrom: boolean): { labels: Diagnosis[]; message: string | null } {
    const x = MV.double(v)
    const e = MV.double(c)
    if (!Number.isFinite(x) || !Number.isFinite(e)) return { labels: [], message: null }
    // relativa (como la igualdad): con números diminutos, «0» no está «cerca» de -1.77e-10 (no es un error de signo)
    const near = (a: number, b: number): boolean => ValueMatch.close(a, b, 5e-4)
    // El estudiante suele redondear: un candidato también cuenta si, redondeado a los decimales que escribió, da su número.
    const places = convertedFrom ? null : this.writtenRoundingPlaces(attempt)
    const hits = (target: number): boolean => {
      if (!Number.isFinite(target)) return false
      if (near(x, target)) return true
      if (places === null) return false
      return Math.abs(Numerics.roundHalfUp(target, places) - x) <= 1e-12 * Math.max(1, Math.abs(x))
    }
    const labels: Diagnosis[] = []
    let message: string | null = null
    const add = (d: Diagnosis, m: string): void => {
      if (!labels.includes(d)) labels.push(d)
      if (message === null) message = m
    }

    if (e !== 0 && hits(-e)) {
      add('signError', e < 0 ? tr('Casi: te faltó el signo menos.') : tr('Casi: sobra el signo menos; revisa el signo del resultado.'))
    }
    if (e !== 0) {
      const times100 = hits(e * 100)
      const over100 = hits(e / 100)
      if (times100 || over100) {
        add('percentVsFraction', times100
          ? tr('Parece que multiplicaste por 100 de más: revisa si la respuesta va en porcentaje o como fracción.')
          : tr('Parece que olvidaste pasar a porcentaje: la respuesta está multiplicada por 100.'))
      }
      // Si escribió «°», no usó radianes (y «30°» con la clave «30» ya se acepta en la lectura en grados).
      const wroteDegrees = containsNode(attempt.expr, (n) => n.type === 'unary' && n.op === 'degree')
      if (!wroteDegrees && hits((e * 180) / Math.PI)) add('degreesVsRadians', tr('Parece que usaste grados donde la respuesta está en radianes.'))
      if (!wroteDegrees && hits((e * Math.PI) / 180)) add('radiansVsDegrees', tr('Parece que usaste radianes donde la respuesta está en grados.'))
      for (const k of [-6, -5, -4, -3, -1, 1, 3, 4, 5, 6]) {
        if (hits(e * Math.pow(10, k))) {
          add('factorOfTen', tr('Tu respuesta difiere por un factor de 10^%@: revisa la coma decimal o la conversión de unidades.', String(k)))
        }
      }
      if (times100 || over100) add('factorOfTen', tr('Tu respuesta difiere por un factor de 100.'))
      const double = hits(2 * e)
      const half = hits(e / 2)
      if (double || half) {
        add('factorOfTwo', double
          ? tr('Tu respuesta es el doble de la correcta: revisa si te sobra un factor 2.')
          : tr('Tu respuesta es la mitad de la correcta: revisa si te falta un factor 2.'))
      }
      if (Math.abs(e) !== 1 && hits(1 / e)) add('reciprocal', tr('Parece que usaste el recíproco: ¿invertiste el numerador y el denominador?'))
    }
    if (e > 0 && e !== 1 && hits(e * e)) add('forgotSquareRoot', tr('Parece que te faltó sacar la raíz cuadrada.'))
    if (e > 0 && e !== 1 && hits(Math.sqrt(e))) add('forgotSquare', tr('Parece que te faltó elevar al cuadrado.'))
    if (hits(e + 1) || hits(e - 1)) add('offByOne', tr('Estás a 1 de distancia de la respuesta: revisa el último paso (¿sumaste o restaste 1 de más?).'))
    // redondeo / truncamiento a menos decimales
    const r = roundingLabel(x, e)
    if (r) add(r[0], r[1])
    return { labels, message }
  }
}

/** Mejor lectura: primero los plenos certificados, luego los parciales certificados y, si no, las indeterminadas. */
function bestReading(readings: readonly ReadingOutcome[]): ReadingOutcome | null {
  const certified = readings.filter((r) => !r.precisionIndeterminate)
  const full = certified.filter((r) => r.verdict.status === 'correct')
  const positive = certified.filter((r) => r.verdict.credit > 0)
  const choices = full.length > 0 ? full : positive.length > 0 ? positive : readings.filter((r) => r.precisionIndeterminate)
  const pool = choices.length > 0 ? choices : readings
  let best: ReadingOutcome | null = null
  for (const r of pool) if (best === null || Verdict.readingRank(r.verdict) > Verdict.readingRank(best.verdict)) best = r
  return best
}

/** Un número con separadores → lectura principal (y la alternativa de miles si es ambiguo). */
function readToken(t: string): [string, string | null] {
  const dots = [...t].filter((c) => c === '.').length
  const commas = [...t].filter((c) => c === ',').length
  const stripped = (sep: string): string => t.split(sep).join('')
  const groupsOfThree = (sep: string): boolean => (sep === ',' ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/).test(t)
  if (dots > 0 && commas > 0) {
    const decimalIsDot = t.lastIndexOf('.') > t.lastIndexOf(',')
    const thousands = decimalIsDot ? ',' : '.'
    const pieces = t.split(decimalIsDot ? '.' : ',')
    if (pieces.length !== 2 || !(thousands === ',' ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/).test(pieces[0])) return [t, null]
    return [stripped(thousands).split(',').join('.'), null]
  }
  if (commas === 1 || dots === 1) {
    const sep = commas === 1 ? ',' : '.'
    if ((sep === ',' ? /^[1-9]\d{0,2},\d{3}$/ : /^[1-9]\d{0,2}\.\d{3}$/).test(t)) return [t, stripped(sep)] // ambiguo
    return [t, null]
  }
  if (commas > 1 && groupsOfThree(',')) return [stripped(','), null]
  if (dots > 1 && groupsOfThree('.')) return [stripped('.'), null]
  return [t, null]
}

// MARK: - Precisión decimal certificada

/** Rechaza extremos antes de cualquier suma de índices o redondeo. */
function decimalPrecision(k: number): DecimalPrecision | null {
  const places = Math.max(k, 0)
  const quantum = Math.pow(10, -places)
  if (!Number.isFinite(quantum) || !(quantum > 0)) return null
  const scale = decimalScale(places)
  return { places, quantum, quantumFraction: scale !== null ? Fraction.of(1n, scale) : null }
}

/** Potencia decimal acotada por `Int`; el fallo sólo retira este certificado, nunca cae a `number`. */
function decimalScale(places: number): bigint | null {
  let scale = 1n
  for (let i = 0; i < places; i++) {
    scale *= 10n
    if (scale > INT_MAX) return null
  }
  return scale
}

/** Una fracción reducida es fija a k decimales si su denominador sólo tiene 2 y 5, con exponentes <= k. */
function fixedAtDecimals(f: Fraction, places: number): boolean {
  let d = f.den
  let twos = 0
  let fives = 0
  while (d % 2n === 0n) {
    d /= 2n
    twos += 1
  }
  while (d % 5n === 0n) {
    d /= 5n
    fives += 1
  }
  return d === 1n && Math.max(twos, fives) <= places
}

function roundedDigits(digits: DecimalDigits, places: number): DecimalDigits | null {
  if (!Number.isSafeInteger(digits.pointPos + places)) return null
  const rounded = digits.clone()
  rounded.roundToPlaces(places)
  return rounded
}

/** Conversión exacta de dígitos finitos dentro de `UInt`/`Int`. No se interpreta un fallo como desigualdad. */
function exactFraction(digits: DecimalDigits): Fraction | null {
  if (digits.isZero) return Fraction.ZERO
  let magnitude = 0n
  for (const digit of digits.digits) {
    magnitude = magnitude * 10n + BigInt(digit)
    if (magnitude > UINT_MAX) return null
  }
  const shift = digits.pointPos - digits.digits.length
  let denominator = 1n
  if (shift >= 0) {
    for (let i = 0; i < shift; i++) {
      magnitude *= 10n
      if (magnitude > UINT_MAX) return null
    }
  } else {
    for (let i = 0; i < -shift; i++) {
      denominator *= 10n
      if (denominator > UINT_MAX) return null
    }
  }
  const divisor = gcdBig(magnitude, denominator)
  magnitude /= divisor
  denominator /= divisor
  if (denominator > INT_MAX) return null
  if (digits.negative) {
    if (magnitude > INT_MAX + 1n) return null
    return Fraction.of(-magnitude, denominator)
  }
  if (magnitude > INT_MAX) return null
  return Fraction.of(magnitude, denominator)
}

/** Certifica el valor racional redondeado. La fijeza se prueba antes de materializar 10^k. */
function roundedFraction(f: Fraction, places: number): Fraction | null {
  if (fixedAtDecimals(f, places)) return f
  const digits = DecimalDigits.fromFraction(f)
  if (digits) {
    const rounded = roundedDigits(digits, places)
    const target = rounded ? exactFraction(rounded) : null
    if (target) return target
  }
  const scale = decimalScale(places)
  if (scale === null) return null
  const scaled = f.multiplied(Fraction.int(scale))
  if (!scaled) return null
  const whole = scaled.num / scaled.den
  const remainder = scaled.num % scaled.den
  const remainderMagnitude = remainder < 0n ? -remainder : remainder
  const half = scaled.den / 2n + (scaled.den % 2n)
  let rounded = whole
  if (remainderMagnitude >= half) {
    const next = whole + BigInt(scaled.sign)
    if (!fitsInt(next)) return null
    rounded = next
  }
  return Fraction.int(rounded).divided(Fraction.int(scale))
}

function rationalDistance(a: Fraction, b: Fraction): Fraction | null {
  return a.subtracting(b)?.absolute() ?? b.subtracting(a)?.absolute() ?? null
}

/**
 * `k` define la rejilla decimal. Igualdades/distancias racionales probadas prevalecen sobre cualquier ULP.
 * La aproximación sólo opera si la rejilla es resoluble; ε no tiene un suelo libre y no borra desigualdades exactas.
 */
function compareDecimals(v: MathValue, c: MathValue, k: number): DecimalMatch {
  const precision = decimalPrecision(k)
  if (!precision) return 'indeterminate'
  const places = precision.places
  const input = MV.fraction(v)
  const key = MV.fraction(c)
  if (input && key && input.equals(key)) return fixedAtDecimals(key, places) ? 'exact' : 'unrounded'
  const vd = MV.double(v)
  const cd = MV.double(c)

  let target: number
  let targetFraction: Fraction | null
  if (key) {
    const rounded = roundedFraction(key, places)
    if (!rounded) return 'indeterminate'
    target = rounded.doubleValue
    targetFraction = rounded
  } else {
    // Un `number` de la clave no certifica una rejilla más fina que su representación ni la de la entrada.
    if (!Number.isFinite(vd) || !Number.isFinite(cd) || !(precision.quantum >= Math.max(ulp(vd), ulp(cd)))) return 'indeterminate'
    const digits = DecimalDigits.fromDouble(cd)
    const rounded = digits ? roundedDigits(digits, places) : null
    if (!rounded) return 'indeterminate'
    target = rounded.doubleValue
    targetFraction = exactFraction(rounded)
  }
  if (!Number.isFinite(target) || !Number.isFinite(vd) || !Number.isFinite(cd)) return 'indeterminate'

  let unequalRationals = false
  let certifiedOneOff = false
  const roundedInput = input ? roundedFraction(input, places) : null
  if (input && targetFraction) {
    const exactTarget = targetFraction
    if (input.equals(exactTarget)) return 'exact'
    unequalRationals = true
    if (key && roundedInput && roundedInput.equals(exactTarget)) {
      const fromKey = rationalDistance(input, key)
      const half = precision.quantumFraction?.divided(Fraction.int(2)) ?? null
      if (fromKey && half && fromKey.lt(half)) return 'unrounded'
    }
    const distance = rationalDistance(input, exactTarget)
    if (distance && precision.quantumFraction) {
      if (distance.gt(precision.quantumFraction)) return 'none'
      certifiedOneOff = true
    } else if (distance && places > 0 && distance.compare(Fraction.ONE) >= 0) {
      return 'none' // q <= 0.1, aunque 10^k no quepa como denominador racional.
    }
  }

  const spacing = Math.max(ulp(vd), Math.max(ulp(cd), ulp(target)))
  if (!(precision.quantum >= spacing)) return certifiedOneOff ? 'oneOff' : 'indeterminate'
  const epsilon = Math.min(precision.quantum / 16, 4 * spacing)
  const fromTarget = Math.abs(vd - target)
  if (!unequalRationals && fromTarget <= epsilon) return 'exact'
  const inputRoundDisagrees = roundedInput !== null && targetFraction !== null && !roundedInput.equals(targetFraction)
  if (!inputRoundDisagrees) {
    const digits = DecimalDigits.fromDouble(vd)
    const rounded = digits ? roundedDigits(digits, places) : null
    if (rounded && Math.abs(rounded.doubleValue - target) <= epsilon && Math.abs(vd - cd) < precision.quantum / 2 + epsilon) return 'unrounded'
  }
  if (certifiedOneOff || fromTarget <= precision.quantum + epsilon) return 'oneOff'
  return 'none'
}

/** Aproximación decimal de un valor exacto: parcial con aviso de redondeo o truncamiento. */
function approximationVerdict(a: Attempt, candidates: readonly MathValue[], value: MathValue): CheckVerdict | null {
  if (!a.written.isDecimal || a.written.decimalPlaces < 2 || a.written.hasPercent) return null
  const k = a.written.decimalPlaces
  const x = MV.double(value)
  for (const c of candidates) {
    const cd = MV.double(c)
    if (cd === 0 || !Number.isFinite(cd) || !(Math.abs(x - cd) <= 0.02 * Math.abs(cd))) continue
    const half = 0.5 * Math.pow(10, -k)
    const rounded = Numerics.roundHalfUp(cd, k)
    const p = Math.pow(10, k)
    const truncated = (cd >= 0 ? Math.floor(cd * p) : Math.ceil(cd * p)) / p
    if (Math.abs(x - rounded) <= 1e-9 * Math.max(1, Math.abs(rounded)) || Math.abs(x - cd) <= half * (1 + 1e-9)) {
      return Verdict.partial(0.5, tr('Tu decimal es una aproximación del valor exacto: escribe el valor exacto (fracción o radical) o usa más cifras.'), ['rounding'])
    }
    if (Math.abs(x - truncated) <= 1e-9 * Math.max(1, Math.abs(truncated))) {
      return Verdict.partial(0.5, tr('Parece que cortaste los decimales en lugar de redondear; escribe el valor exacto o redondea al final.'), ['truncation'])
    }
  }
  return null
}

/** ¿Es `x` el valor esperado redondeado o truncado a menos decimales? */
function roundingLabel(x: number, e: number): [Diagnosis, string] | null {
  if (e === x || x === 0) return null // redondear a 0 no es «estar muy cerca» (3.97e-19 → 0)
  for (let places = 0; places <= 8; places++) {
    const r = Numerics.roundHalfUp(e, places)
    if (Math.abs(r - x) <= 1e-12 * Math.max(1, Math.abs(x)) && Math.abs(r - e) > 1e-12) {
      return ['rounding', tr('Estás muy cerca: parece un problema de redondeo (redondea solo al final de todos los cálculos).')]
    }
    const f = Math.pow(10, places)
    const t = (e >= 0 ? Math.floor(e * f) : Math.ceil(e * f)) / f
    if (Math.abs(t - x) <= 1e-12 * Math.max(1, Math.abs(x)) && Math.abs(t - e) > 1e-12) {
      return ['truncation', tr('Parece que cortaste los decimales en lugar de redondear.')]
    }
  }
  return null
}

// MARK: - Unidades en TeX

/** Unidades en LaTeX. */
export const UnitFormatting = {
  /** `m/s^2` → `\,\mathrm{m/s^{2}}`, `μm` → `\,\mu\mathrm{m}`, `°C` → `\,^{\circ}\mathrm{C}`. */
  latex(unit: string): string {
    let out = ''
    let run = ''
    const flush = (): void => {
      if (run !== '') {
        out += '\\mathrm{' + run + '}'
        run = ''
      }
    }
    const cs = toChars(normalizeText(unit).string)
    let i = 0
    while (i < cs.length) {
      const c = cs[i]
      switch (c) {
        case 'μ':
        case 'µ':
          flush()
          out += '\\mu '
          break
        case 'Ω':
          flush()
          out += '\\Omega '
          break
        case '°':
          flush()
          out += '^{\\circ}'
          break
        case '%':
          flush()
          out += '\\%'
          break
        case '*':
          flush()
          out += '\\cdot '
          break
        case '^': {
          let j = i + 1
          let exp = ''
          if (j < cs.length && cs[j] === '(') {
            j += 1
            while (j < cs.length && cs[j] !== ')') {
              exp += cs[j]
              j += 1
            }
            j += 1
          } else {
            if (j < cs.length && cs[j] === '-') {
              exp += '-'
              j += 1
            }
            while (j < cs.length && isNumberChar(cs[j])) {
              exp += cs[j]
              j += 1
            }
          }
          run += '^{' + exp + '}'
          i = j
          continue
        }
        default:
          run += c
      }
      i += 1
    }
    flush()
    return '\\,' + out
  },
}
