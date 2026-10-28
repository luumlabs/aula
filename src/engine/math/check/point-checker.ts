import { freeVariables, type Expr } from '../core/expr'
import { tr } from '../core/i18n'
import { charCount, chars as toChars, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError, MV, type AngleMode, type MathValue } from '../core/types'
import { evaluate } from '../eval/evaluate'
import { normalizeText } from '../parse/normalizer'
import { NumberInput } from '../parse/number-input'
import { MathParser } from '../parse/parser'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { ListParsing } from './list-parsing'
import { isDecimalApproximation } from './set-checker'
import { ValueMatch, ValueReadings, type ValueReading } from './value-match'
import { MAX_INPUT_LENGTH, Verdict, type CheckVerdict, type Diagnosis } from './verdict'

/** Margen por defecto de `checkPoint` (y de los puntos de los ejercicios): por debajo o igual, no es un margen del autor. */
export const DEFAULT_POINT_ABS_TOL = 1e-6

const NAMED_POINT_RE = /^\s*[\p{L}][\p{L}0-9_']*\s*=\s*(?=[([{])/u // "P = (1,2)"
const CAPITAL_POINT_RE = /^\s*[A-Z][0-9_']*\s*(?=\()/u // "A(1,2)"
const COORDINATE_NAME_RE = /^\s*[\p{L}]\s*=\s*/u

/** Comprobador de puntos de 2 o 3 coordenadas: `(1, -2)`, `P = (1; -2)`, `x=1, y=-2`. */
export class PointChecker {
  readonly expected: readonly string[]
  readonly absTol: number
  readonly angle: AngleMode

  constructor(expected: readonly string[], absTol = DEFAULT_POINT_ABS_TOL, angle: AngleMode = 'radians') {
    this.expected = expected
    this.absTol = absTol
    this.angle = angle
  }

  /** ¿La coordenada escrita coincide con la de la clave? */
  private close(got: number, want: number): boolean {
    if (ValueMatch.close(got, want, ValueMatch.realTolerance)) return true
    return this.absTol > DEFAULT_POINT_ABS_TOL && Number.isFinite(this.absTol) && Math.abs(got - want) <= this.absTol
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu respuesta.'))
    if (charCount(trimmed) > MAX_INPUT_LENGTH) return Verdict.format(Verdict.tooLongMessage)

    const wantExprs: Expr[] = []
    for (const e of this.expected) {
      let ex: Expr | null = null
      try {
        ex = MathParser.parse(e)
        if (freeVariables(ex).size > 0 || !Number.isFinite(MV.double(evaluate(ex, {}, this.angle)))) ex = null
      } catch {
        ex = null
      }
      if (!ex) return Verdict.format(tr('No se pudo interpretar el punto esperado del ejercicio («%@»).', e))
      wantExprs.push(ex)
    }

    let text = trimWS(normalizeText(trimmed).string)
    text = text.replace(NAMED_POINT_RE, '')
    text = text.replace(CAPITAL_POINT_RE, '')
    text = trimWS(text)

    // ¿Varios puntos? Solo cuentan los grupos de nivel superior que llevan un separador dentro, como «(1, 2)»:
    // los paréntesis de una función («-sqrt(2)/2, sqrt(2)/2») no son puntos.
    let depth = 0
    let groups = 0
    let groupHasSeparator = false
    for (const c of toChars(text)) {
      if ('([{'.includes(c)) {
        if (depth === 0) groupHasSeparator = false
        depth += 1
      } else if (')]}'.includes(c)) {
        depth -= 1
        if (depth === 0 && groupHasSeparator) groups += 1
      } else if (depth === 1 && (c === ',' || c === ';')) {
        groupHasSeparator = true
      }
    }
    if (groups > 1) return Verdict.format(tr('Escribe un solo punto, con el formato (x, y).'))

    const body = ListParsing.stripOuterBrackets(text)
    // Ángulos: la lectura normal y, si algún lado lleva «°», la del «°» como etiqueta ((30°, 0) = (30, 0)).
    const verdicts: CheckVerdict[] = []
    for (const reading of ValueReadings.readings(this.angle, [trimmed, ...this.expected])) {
      let values: number[]
      try {
        values = wantExprs.map((e) => MV.double(ValueReadings.evaluate(reading, e)))
      } catch {
        continue
      }
      if (!values.every(Number.isFinite)) continue
      verdicts.push(this.checkReading(body, wantExprs.map((expr, i) => ({ expr, value: values[i] })), reading))
    }
    return Verdict.best(verdicts) ?? Verdict.format(tr('No pude leer tu respuesta.'))
  }

  /** Una lectura de los ángulos: prueba la coma clásica y la decimal. */
  private checkReading(body: string, want: ReadonlyArray<{ expr: Expr; value: number }>, reading: ValueReading): CheckVerdict {
    // Sin «;» y con una coma pegada entre cifras («(1,5, 2)») hay dos lecturas: la clásica y la de coma decimal.
    const classic = this.evaluate(body, want, false, reading)
    if (body.includes(';') || !ListParsing.hasGluedDecimalComma(body)) return classic
    const decimal = this.evaluate(body, want, true, reading)
    if (decimal.status === 'formatProblem') return classic // la lectura alternativa solo cuenta si se puede leer
    return Verdict.best(NumberInput.decimalComma ? [decimal, classic] : [classic, decimal]) ?? classic
  }

  /**
   * Lee las coordenadas de `body` (sin los paréntesis exteriores) y las compara con `want`. Separa el `;` si lo hay (y
   * entonces las comas son decimales); si no, la coma, salvo la pegada entre cifras con `decimalComma`.
   */
  private evaluate(body: string, wantPairs: ReadonlyArray<{ expr: Expr; value: number }>, decimalComma: boolean, reading: ValueReading): CheckVerdict {
    const want = wantPairs.map((p) => p.value)
    const n = want.length
    const cs = toChars(body)
    const separator = body.includes(';') ? ';' : ','
    let pieces: string[] = []
    let current = ''
    let d = 0
    cs.forEach((c, i) => {
      if ('([{'.includes(c)) d += 1
      else if (')]}'.includes(c)) d -= 1
      if (d === 0 && c === separator && !(decimalComma && c === ',' && ListParsing.isGluedBetweenDigits(cs, i))) {
        pieces.push(current)
        current = ''
        return
      }
      current += c
    })
    pieces.push(current)
    pieces = pieces.map((p) => trimWS(p).replace(COORDINATE_NAME_RE, ''))

    if (pieces.length !== n || pieces.some((p) => p === '')) {
      const example = n === 3 ? '(1, 2, 3)' : '(1, 2)'
      const written = pieces.filter((p) => p !== '').length
      return Verdict.format(tr('Un punto de %lld coordenadas se escribe así: %@. Tú escribiste %lld valor(es).', n, example, written))
    }

    const exprs: Expr[] = []
    const got: number[] = []
    const gotValues: MathValue[] = []
    for (const p of pieces) {
      try {
        const r = MathParser.parseDetailed(p)
        const v = sortedStrings(freeVariables(r.expr))[0]
        if (v !== undefined) return Verdict.format(tr('Las coordenadas deben ser números, sin letras (aparece «%@»).', v))
        const exact = ValueReadings.evaluate(reading, r.expr)
        const value = MV.double(exact)
        if (!Number.isFinite(value)) return Verdict.format(tr('Una de las coordenadas no es un número real.'))
        exprs.push(r.expr)
        got.push(value)
        gotValues.push(exact)
      } catch (e) {
        if (e instanceof MathError) return Verdict.format(tr('No pude leer la coordenada «%@»: %@.', p, e.message))
        return Verdict.format(tr('No pude leer la coordenada «%@».', p))
      }
    }
    const normalized = '(' + exprs.map(toPlain).join(', ') + ')'
    const latex = '\\left(' + exprs.map(toLatex).join(',\\,') + '\\right)'

    const hits = got.map((g, i) => this.close(g, want[i]))
    if (hits.every((h) => h)) return Verdict.correct(null, normalized, latex)
    // Aproximaciones decimales (0.7071 por √2/2): crédito parcial si todas las coordenadas que fallan son aproximaciones.
    const approximations = hits.map((h, i) => !h && isDecimalApproximation(gotValues[i], exprs[i], MV.real(want[i])))
    if (approximations.includes(true) && hits.every((h, i) => h || approximations[i])) {
      return Verdict.partial(0.5, tr('Esas coordenadas son aproximaciones decimales de las correctas: escribe los valores exactos (fracciones, raíces como √2/2, π…).'), ['rounding'], normalized, latex)
    }

    // nombres de las coordenadas (con más de tres, x1, x2…)
    const names = n <= 3 ? ['x', 'y', 'z'] : Array.from({ length: n }, (_, i) => `x${i + 1}`)
    // coordenadas intercambiadas
    if (n >= 2) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (this.close(want[i], want[j])) continue
          const swapped = [...want]
          swapped[i] = want[j]
          swapped[j] = want[i]
          if (got.every((g, k) => this.close(g, swapped[k]))) {
            const order = names.slice(0, n).join(', ')
            return Verdict.wrong(tr('Tienes las coordenadas %@ y %@ intercambiadas: el orden es (%@).', names[i], names[j], order), ['other'], normalized, latex)
          }
        }
      }
    }
    const labels: Diagnosis[] = []
    const wrong: Array<{ name: string; signFlipped: boolean }> = []
    for (let i = 0; i < n; i++) {
      if (hits[i]) continue
      const flipped = want[i] !== 0 && this.close(got[i], -want[i])
      if (flipped && !labels.includes('signError')) labels.push('signError')
      wrong.push({ name: names[i], signFlipped: flipped })
    }
    const okNames = names.slice(0, n).filter((_, i) => hits[i])
    let message: string
    if (okNames.length > 0) {
      message = partlyRightMessage(okNames, wrong)
    } else if (got.every((g, i) => Math.abs(g - want[i]) <= 0.005 * Math.max(1, Math.abs(want[i])))) {
      // redondeó: 0.7071 en lugar de √2/2
      message = tr('Esas coordenadas son aproximaciones decimales de las correctas: escribe los valores exactos (fracciones, raíces como √2/2, π…).')
    } else {
      message = wrong.some((w) => w.signFlipped) ? tr('Revisa los signos de las coordenadas.') : tr('Ninguna coordenada coincide: revisa el procedimiento.')
    }
    const finalLabels: Diagnosis[] = labels.length === 0 ? ['other'] : labels
    if (okNames.length > 0) return Verdict.partial((0.5 * okNames.length) / n, message, finalLabels, normalized, latex)
    return Verdict.wrong(message, finalLabels, normalized, latex)
  }
}

/**
 * Mensaje cuando unas coordenadas están bien y otras no: con una bien y una mal (los puntos del plano), una sola frase;
 * si no, una frase por coordenada.
 */
function partlyRightMessage(okNames: readonly string[], wrong: ReadonlyArray<{ name: string; signFlipped: boolean }>): string {
  if (okNames.length === 1 && wrong.length === 1) {
    return wrong[0].signFlipped
      ? tr('La coordenada %@ está bien, pero la %@ tiene el signo al revés.', okNames[0], wrong[0].name)
      : tr('La coordenada %@ está bien, pero la %@ no coincide.', okNames[0], wrong[0].name)
  }
  const right = okNames.length === 2
    ? [tr('Las coordenadas %@ y %@ están bien.', okNames[0], okNames[1])]
    : okNames.map((name) => tr('La coordenada %@ está bien.', name))
  const issues = wrong.map((w) => (w.signFlipped ? tr('La coordenada %@ tiene el signo al revés.', w.name) : tr('La coordenada %@ no coincide.', w.name)))
  return [...right, ...issues].join(' ')
}
