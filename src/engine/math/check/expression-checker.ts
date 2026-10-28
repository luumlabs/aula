import { Polynomial } from '../algebra/polynomial'
import { E, children, containsNode, exprEquals, freeVariables, functionNames, isConstantExpr, substitute, usesIntegerOnlyFunctions, type Expr } from '../core/expr'
import { FunctionTable } from '../core/functions'
import { tr } from '../core/i18n'
import { charCount, chars as toChars, foldedLower, isLetter, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MV, type AngleMode } from '../core/types'
import { tryEvaluate } from '../eval/evaluate'
import { Numerics } from '../eval/numerics'
import { Fraction } from '../numbers/fraction'
import { normalizeText } from '../parse/normalizer'
import { MathParser, type ParseResult } from '../parse/parser'
import { MathError } from '../core/types'
import { toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { EquivalenceEngine, MathEquivalence, equivalenceConfig, type EquivalenceConfig, type EquivalenceResult } from './equivalence'
import { NumericChecker } from './numeric-checker'
import { rxMatches } from './rx'
import { isDecimalApproximation } from './set-checker'
import type { ExpressionSpec } from './specs'
import { ValueMatch } from './value-match'
import { MAX_INPUT_LENGTH, Verdict, type CheckVerdict, type Diagnosis } from './verdict'

/** Resultado de quitar `f(x) =` delante de una expresión. */
export type StripResult = { ok: true; body: string } | { ok: false; message: string }

const IDENT = '[\\p{L}][\\p{L}0-9_]*'
const ASSIGNMENT_LHS_RE = new RegExp(`^${IDENT}'*(\\s*\\(\\s*${IDENT}(\\s*,\\s*${IDENT})*\\s*\\))?$`, 'u')
const DERIVATIVE_LHS_RE = /^d[\p{L}]*\s*\/\s*d[\p{L}]+$/u

/** Comprobador de respuestas algebraicas: equivalencia numérica, forma pedida, funciones prohibidas y diagnóstico. */
export class ExpressionChecker {
  readonly spec: ExpressionSpec

  constructor(spec: ExpressionSpec) {
    this.spec = spec
  }

  /**
   * Intervalo de muestreo: el de la especificación si tiene anchura (la IA a veces pone `domainMin ≥ domainMax`, y
   * entonces todas las muestras caían en un punto); si no, −6…6.
   */
  get samplingDomain(): [number, number] {
    const lo = Math.min(this.spec.domainMin, this.spec.domainMax)
    const hi = Math.max(this.spec.domainMin, this.spec.domainMax)
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(hi - lo) || !(hi - lo >= 1e-6)) return [-6, 6]
    return [lo, hi]
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu respuesta.'))
    if (charCount(trimmed) > MAX_INPUT_LENGTH) return Verdict.format(Verdict.tooLongMessage)
    // Un número sin letras con separadores ambiguos («1,500»): las mismas lecturas que `checkNumeric`. Se queda la mejor.
    if (!toChars(trimmed).some((c) => isLetter(c))) {
      const readings = NumericChecker.groupingReadings(NumericChecker.joinSpaceGroupedThousands(normalizeText(trimmed).string))
      if (readings.length > 1) return Verdict.best(readings.map((r) => this.checkReading(r))) ?? this.checkReading(trimmed)
      const only = readings[0]
      if (only !== undefined && only !== '') return this.checkReading(only)
    }
    return this.checkReading(trimmed)
  }

  private checkReading(trimmed: string): CheckVerdict {
    const spec = this.spec
    let expected: Expr
    try {
      expected = MathParser.parseDetailed(spec.expected).expr
    } catch {
      return Verdict.format(tr('No se pudo interpretar la respuesta esperada del ejercicio («%@»).', spec.expected))
    }

    // Quita "f(x) =", "y =" delante de la expresión.
    const stripped = ExpressionChecker.stripAssignment(trimmed)
    if (!stripped.ok) return Verdict.format(stripped.message)
    const body = stripped.body

    let parsed: ParseResult
    try {
      parsed = MathParser.parseDetailed(body)
    } catch (e) {
      if (e instanceof MathError) {
        return Verdict.format(tr('No pude leer tu expresión: %@. Usa * para multiplicar, ^ para potencias, / para fracciones, y sqrt(), sin(), ln()… para funciones.', e.message))
      }
      return Verdict.format(tr('No pude leer tu expresión.'))
    }
    const student = parsed.expr
    const normalized = toPlain(student)
    const latex = toLatex(student)
    const note = parsed.notes[0]

    // Variables permitidas (las declaradas se comparan con su nombre canónico: theta → θ)
    const allowed = sortedStrings(spec.variables ? spec.variables.map((v) => MathParser.canonicalVariableName(v)) : freeVariables(expected))
    const allowedSet = new Set(allowed)
    const extra = sortedStrings([...freeVariables(student)].filter((v) => !allowedSet.has(v)))
    const bad = extra[0]
    if (bad !== undefined) {
      if (allowed.length === 0) {
        // La respuesta esperada es un número: ¿escribió una expresión con letras que vale lo mismo? (sin²x + cos²x por 1)
        const studentVars = sortedStrings(freeVariables(student))
        const cfg = equivalenceConfig({ vars: studentVars, domain: this.samplingDomain, samples: Math.max(spec.samples, 4), relTol: 1e-9, absTol: 1e-9, angle: spec.angle })
        cfg.integerPoints = usesIntegerOnlyFunctions(student)
        if (EquivalenceEngine.compare(student, expected, cfg).verdict === 'equivalent') {
          const v = Verdict.wrongForm(tr('Es equivalente a la respuesta, pero todavía tiene letras: simplifícala hasta llegar a un número.'), ['sameAsExpected', 'notSimplified'])
          return Verdict.withInput(v, normalized, latex)
        }
        return Verdict.wrong(tr('Tu expresión depende de «%@», pero la respuesta es un número: revisa el procedimiento.', bad), ['other'], normalized, latex)
      }
      return Verdict.format(ExpressionChecker.onlyVariables(allowed, bad), normalized, latex)
    }

    const config = equivalenceConfig({ vars: allowed, domain: this.samplingDomain, samples: Math.max(spec.samples, 4), relTol: 1e-9, absTol: 1e-9, angle: spec.angle })
    config.integerPoints = usesIntegerOnlyFunctions(student) || usesIntegerOnlyFunctions(expected)
    const strict: EquivalenceResult = exprEquals(student, expected)
      ? { verdict: 'equivalent', pairs: [], points: [] }
      : EquivalenceEngine.compare(student, expected, config)

    const finish = (v: CheckVerdict): CheckVerdict => {
      let out = Verdict.withInput(v, normalized, latex)
      if (out.status !== 'correct') out = Verdict.appending(out, note)
      return out
    }

    if (strict.verdict === 'equivalent') {
      // Un número decimal en lugar del valor exacto (0.7071… por √2/2): equivale por muestreo, pero no es exacto.
      const approx = ExpressionChecker.decimalApproximation(student, expected, spec.angle)
      if (approx) return finish(approx)
      return finish(this.checkForm(student, expected))
    }

    // Mismos valores donde ambas existen, pero dominios distintos
    const loose: EquivalenceConfig = { ...config, strictDomain: false }
    const relaxed = EquivalenceEngine.compare(student, expected, loose)
    if (strict.verdict === 'domainMismatch' && relaxed.verdict === 'equivalent') {
      return finish(Verdict.partial(0.5, tr('Tus valores coinciden donde las dos expresiones existen, pero el dominio no es el mismo: revisa raíces, logaritmos, valores absolutos y denominadores.'), ['other']))
    }

    // Respuesta numérica escrita como decimal redondeado (0.7071 por √2/2): crédito parcial, como en checkNumeric.
    if (isConstantExpr(student) && isConstantExpr(expected)) {
      const given = tryEvaluate(student, {}, spec.angle)
      const want = tryEvaluate(expected, {}, spec.angle)
      if (given && want && isDecimalApproximation(given, student, want)) {
        return finish(Verdict.partial(0.5, tr('Tu decimal es una aproximación del valor exacto: escribe el valor exacto (fracción, raíz, π…).'), ['rounding']))
      }
    }

    const d = this.diagnose(student, expected, relaxed.pairs, config)
    return finish(Verdict.wrong(d.message ?? tr('No es correcto.'), d.labels.length === 0 ? ['other'] : d.labels))
  }

  /** «Usa solo la variable x (no «z»).» / «Usa solo las variables x, y (no «z»).» */
  static onlyVariables(allowed: readonly string[], bad: string): string {
    if (allowed.length === 1) return tr('Usa solo la variable %@ (no «%@»).', allowed[0], bad)
    return tr('Usa solo las variables %@ (no «%@»).', allowed.join(', '), bad)
  }

  // MARK: Prefijos "f(x) ="

  static stripAssignment(text: string): StripResult {
    // Un solo "=" (que no sea parte de <=, >=, !=, ==)
    const cs = toChars(text)
    const eqIndices: number[] = []
    cs.forEach((c, i) => {
      if (c !== '=') return
      const prev = i > 0 ? cs[i - 1] : ' '
      const next = i + 1 < cs.length ? cs[i + 1] : ' '
      if ('<>!='.includes(prev) || next === '=') return
      eqIndices.push(i)
    })
    const last = eqIndices[eqIndices.length - 1]
    if (last === undefined) return { ok: true, body: text }
    if (eqIndices.length > 1) return { ok: false, message: tr('Escribe solo la expresión, con un único signo «=» como máximo (por ejemplo f(x) = 2x+1).') }
    const lhs = trimWS(cs.slice(0, last).join(''))
    const rhs = trimWS(cs.slice(last + 1).join(''))
    if (rhs === '') return { ok: false, message: tr('Falta lo que va después del signo «=».') }
    // y = …, f(x) = …, f(theta) = …, g(x, y) = …, f'(x) = …, y' = …, dy/dx = …
    if (rxMatches(ASSIGNMENT_LHS_RE, lhs) || rxMatches(DERIVATIVE_LHS_RE, lhs)) return { ok: true, body: rhs }
    return { ok: false, message: tr('Escribe solo la expresión (sin ecuación): lo que va a la izquierda del «=» no es un nombre como y o f(x).') }
  }

  // MARK: Aproximaciones decimales

  /**
   * Si la respuesta esperada es un número exacto y el estudiante escribió una aproximación DECIMAL (`0.8660254` por `√3/2`),
   * devuelve crédito parcial con aviso de redondeo. Un entero o una fracción de enteros no es una aproximación; tampoco un
   * decimal corto que da justo el valor (`0.5` por `sin(π/4)^2` = 0.5000000000000001).
   */
  static decimalApproximation(student: Expr, expected: Expr, angle: AngleMode): CheckVerdict | null {
    if (!isConstantExpr(student) || !isConstantExpr(expected)) return null
    const g = tryEvaluate(student, {}, angle)
    const want = tryEvaluate(expected, {}, angle)
    if (!g || g.kind !== 'rational' || !want) return null
    const given = g.value
    if (!Number.isFinite(MV.double(want))) return null
    const approximation = Verdict.partial(0.5, tr('Tu número es una aproximación decimal del valor exacto: escribe el valor exacto (fracción, raíz, π…).'), ['rounding'])
    // Clave exacta (racional): lo escrito es exacto solo si es justo ese racional.
    if (want.kind === 'rational') return want.value.equals(given) ? null : approximation
    // Clave real (calculada con coma flotante: pow, ln, trigonometría no notable…).
    const wroteDecimal = containsNode(student, (node) => node.type === 'real' || (node.type === 'number' && !node.value.isInteger))
    if (!wroteDecimal) return null
    // Un decimal corto que coincide con la clave a precisión de `number` es el valor exacto (0.5, 0.25, 0.125…).
    if (given.den <= 1_000_000n && ValueMatch.close(given.doubleValue, MV.double(want), 1e-12)) return null
    return approximation
  }

  // MARK: Forma pedida

  private checkForm(student: Expr, expected: Expr): CheckVerdict {
    const spec = this.spec
    // Funciones prohibidas
    if (spec.forbiddenFunctions.length > 0) {
      const forbidden = new Set(spec.forbiddenFunctions.map((f) => FunctionTable.canonical(f) ?? foldedLower(f)))
      const used = functionNames(student)
      const radicalForbidden = forbidden.has('sqrt') || forbidden.has('root') || forbidden.has('cbrt')
      // sqrt y cbrt son root(2,·) y root(3,·): prohibir una forma prohibe la equivalente.
      if (radicalForbidden) {
        const radicalStack: Expr[] = [student]
        while (radicalStack.length > 0) {
          const node = radicalStack.pop() as Expr
          if (node.type === 'call') {
            const canonical = FunctionTable.canonical(node.name)
            if (canonical === 'sqrt' || canonical === 'cbrt') {
              used.add('root')
            } else if (canonical === 'root' && node.args.length === 2) {
              const v = tryEvaluate(node.args[0])
              const n = v ? MV.integerValue(v) : null
              if (n === 2) used.add('sqrt')
              else if (n === 3) used.add('cbrt')
            }
          }
          radicalStack.push(...children(node))
        }
      }
      // Una potencia de exponente racional no entero (3^(1/2), x^0.5, x^(1/3)) también es un radical.
      const radicalNames = new Set<string>()
      const radicalPreference: string[] = []
      if (radicalForbidden) {
        const stack: Expr[] = [student]
        while (stack.length > 0) {
          const node = stack.pop() as Expr
          if (node.type === 'binary' && node.op === 'pow' && isConstantExpr(node.right)) {
            const v = tryEvaluate(node.right)
            const f = v ? MV.fraction(v) : null
            if (f && !f.isInteger) {
              // 1/2 es sqrt (y root), 1/3 es cbrt (y root) y otros denominadores son root.
              if (f.den === 2n) {
                radicalNames.add('sqrt').add('root')
                radicalPreference.push('sqrt', 'root')
              } else if (f.den === 3n) {
                radicalNames.add('cbrt').add('root')
                radicalPreference.push('cbrt', 'root')
              } else {
                radicalNames.add('root')
                radicalPreference.push('root')
              }
            }
          }
          stack.push(...children(node))
        }
        for (const n of radicalNames) used.add(n)
      }
      const candidates: string[] = []
      for (const name of radicalPreference) if (!candidates.includes(name)) candidates.push(name)
      for (const name of sortedStrings(used)) if (!candidates.includes(name)) candidates.push(name)
      const bad = candidates.find((c) => forbidden.has(c))
      if (bad !== undefined) {
        return Verdict.wrongForm(tr('Es equivalente, pero no puedes usar «%@» en esta respuesta.', bad), ['sameAsExpected', 'other'])
      }
    }
    switch (spec.form) {
      case 'any':
        return Verdict.correct()
      case 'expanded':
        if (FormRules.isExpanded(expected) && !FormRules.isExpanded(student)) {
          return Verdict.wrongForm(tr('Es equivalente, pero falta expandir: multiplica y reduce los términos semejantes.'), ['sameAsExpected', 'notExpanded'])
        }
        break
      case 'factored':
        if (FormRules.isFactored(expected) && !FormRules.isFactored(student)) {
          return Verdict.wrongForm(tr('Es equivalente, pero falta factorizar por completo.'), ['sameAsExpected', 'notFactored'])
        }
        break
      case 'simplified':
        if (FormRules.isSimplified(expected) && !FormRules.isSimplified(student)) {
          return Verdict.wrongForm(tr('Es equivalente, pero falta simplificar.'), ['sameAsExpected', 'notSimplified'])
        }
        break
      case 'lowestTerms':
        if (FormRules.isLowestTerms(expected) && !FormRules.isLowestTerms(student)) {
          return Verdict.wrongForm(tr('Es equivalente, pero falta reducir la fracción a su mínima expresión.'), ['sameAsExpected', 'notReduced'])
        }
        break
    }
    return Verdict.correct()
  }

  // MARK: Diagnóstico

  private diagnose(student: Expr, expected: Expr, pairs: ReadonlyArray<[number, number]>, config: EquivalenceConfig): { labels: Diagnosis[]; message: string | null } {
    const labels: Diagnosis[] = []
    let message: string | null = null
    const add = (d: Diagnosis, m: string): void => {
      if (!labels.includes(d)) labels.push(d)
      if (message === null) message = m
    }
    // pairs = (valor del estudiante, valor esperado); se invierte para preguntar "estudiante = f(esperado)"
    const negated: Array<[number, number]> = pairs.map((p) => [p[1], p[0]])
    if (EquivalenceEngine.holds(negated, (x) => -x)) add('signError', tr('Casi: tu expresión es la opuesta de la correcta; revisa un signo.'))
    if (EquivalenceEngine.holds(negated, (x) => Math.abs(x)) && !EquivalenceEngine.holds(negated, (x) => x)) {
      add('signError', tr('Cuidado con el signo: tu expresión coincide con la correcta solo cuando ésta es positiva (recuerda que √(x²) = |x|).'))
    }
    if (EquivalenceEngine.holds(negated, (x) => (Math.abs(x) > 1e-9 ? 1 / x : null))) {
      add('reciprocal', tr('Tu expresión es el recíproco de la correcta: ¿intercambiaste numerador y denominador?'))
    }
    if (EquivalenceEngine.holds(negated, (x) => x * x)) add('forgotSquareRoot', tr('Parece que te faltó sacar la raíz cuadrada.'))
    if (EquivalenceEngine.holds(negated, (x) => (x > 0 ? Math.sqrt(x) : null))) add('forgotSquare', tr('Parece que te faltó elevar al cuadrado.'))
    const k = EquivalenceEngine.constantRatio(negated)
    if (k !== null) {
      const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
      if (near(k, 2) || near(k, 0.5)) {
        add('factorOfTwo', near(k, 2)
          ? tr('Tu expresión es el doble de la correcta: revisa si te sobra un factor 2.')
          : tr('Tu expresión es la mitad de la correcta: revisa si te falta un factor 2.'))
      }
      if (near(k, 100) || near(k, 0.01)) add('percentVsFraction', tr('Parece que mezclaste porcentaje y fracción (factor 100).'))
      if (near(k, 180 / Math.PI)) add('degreesVsRadians', tr('Parece que usaste grados donde la respuesta está en radianes.'))
      if (near(k, Math.PI / 180)) add('radiansVsDegrees', tr('Parece que usaste radianes donde la respuesta está en grados.'))
      for (const e of [-3, -1, 1, 3]) {
        if (near(k, Math.pow(10, e))) add('factorOfTen', tr('Tu expresión difiere de la correcta por un factor de 10^%@.', String(e)))
      }
      if (labels.length === 0 && !near(k, 1)) add('other', tr('Tu expresión es un múltiplo constante de la correcta: revisa el coeficiente.'))
    }
    const d = EquivalenceEngine.constantDifference(negated)
    if (d !== null) {
      if (Math.abs(Math.abs(d) - 1) < 1e-6) add('offByOne', tr('Tu expresión se diferencia de la correcta en 1: revisa el término independiente.'))
      else if (Math.abs(d) > 1e-9) add('other', tr('Tu expresión se diferencia de la correcta en una constante: revisa el término independiente.'))
    }
    // Signo dentro del argumento: f(-x) en vez de f(x)
    if (labels.length === 0) {
      for (const v of config.vars) {
        const flipped = substitute(expected, v, E.neg(E.variable(v)))
        if (!exprEquals(flipped, expected) && MathEquivalence.equivalent(student, flipped, { variables: config.vars, domain: config.domain, samples: 20, angle: config.angle })) {
          add('signError', tr('Casi: revisa el signo de «%@» dentro de la expresión (aparece %@ donde debería haber -%@, o al revés).', v, v, v))
          break
        }
      }
    }
    return { labels, message }
  }
}

// MARK: - Reglas de forma (heurísticas estructurales)

function stripNeg(e: Expr): Expr {
  let cur = e
  while (cur.type === 'unary' && cur.op === 'neg') cur = cur.arg
  return cur
}

function isSumWithVariables(e: Expr): boolean {
  const core = stripNeg(e)
  if (core.type === 'binary' && (core.op === 'add' || core.op === 'sub')) return !isConstantExpr(e)
  return false
}

function isAtomic(e: Expr): boolean {
  return e.type === 'variable' || e.type === 'number' || e.type === 'real' || e.type === 'constant' || e.type === 'call'
}

/** Una suma polinómica en una variable que no se puede factorizar más (sobre los racionales) y sin factor numérico común. */
function isIrreducibleSum(e: Expr): boolean | null {
  const vars = [...freeVariables(e)]
  if (vars.length !== 1) return null
  const p = Polynomial.from(e, vars[0])
  if (!p) return null
  if (p.degree <= 0) return true
  const ip = p.integerPrimitive()
  if (!ip) return null
  // ¿se puede sacar un factor numérico común? (2x+4 → 2(x+2)); se ignora el signo
  if (ip.content > 1n) return false
  if (p.degree === 1) return true
  const root = p.hasRationalRoot()
  if (root !== null) return !root
  return null
}

function isNumericFraction(e: Expr): boolean {
  return e.type === 'binary' && e.op === 'div' && e.left.type === 'number' && e.right.type === 'number' && e.left.value.isInteger && e.right.value.isInteger
}

/** Número escrito en su forma final: `3`, `-3`, `0.75`, `3/4`, `-3/4` (que se lee `(-3)/4`). */
function isCanonicalNumber(e: Expr): boolean {
  switch (e.type) {
    case 'number':
    case 'real':
      return true
    case 'unary':
      return e.op === 'neg' && isCanonicalNumber(e.arg)
    case 'binary': {
      if (e.op !== 'div' || e.right.type !== 'number') return false
      const q = e.right.value
      if (e.left.type === 'number') return e.left.value.isInteger && q.isInteger
      if (e.left.type === 'unary' && e.left.op === 'neg' && e.left.arg.type === 'number') return e.left.arg.value.isInteger && q.isInteger
      return false
    }
    default:
      return false
  }
}

const RADICALS = new Set(['sqrt', 'cbrt', 'root'])

/** `sqrt(2)`, `cbrt(5)`, `root(3, 4)`: raíz de un número. */
function isNumericRadical(e: Expr): boolean {
  if (e.type !== 'call' || !RADICALS.has(e.name)) return false
  const last = e.args[e.args.length - 1]
  return last !== undefined && isConstantExpr(last)
}

/** `base^exp` si no pasa de `limit` (en Swift, `nil` al desbordar; los dos casos cortan el bucle). */
function powIfSmall(base: bigint, exp: number, limit: bigint): bigint | null {
  let r = 1n
  for (let i = 0; i < exp; i++) {
    r *= base
    if (r > limit) return null
  }
  return r
}

function radicalIsSimplified(name: string, args: readonly Expr[]): boolean {
  const radicand = args[args.length - 1]
  if (radicand === undefined) return true
  let index: number
  switch (name) {
    case 'sqrt':
      index = 2
      break
    case 'cbrt':
      index = 3
      break
    default: {
      const k = args.length === 2 && args[0].type === 'number' ? args[0].value : null
      if (!k || !k.isInteger || k.num < 2n) return true
      index = Number(k.num)
    }
  }
  if (radicand.type === 'number') {
    const f = radicand.value
    if (!f.isInteger) return false // sqrt(0.5) = sqrt(2)/2
    const m = f.num < 0n ? -f.num : f.num
    if (!(m >= 4n && m < 1_000_000_000_000n)) return true
    // ¿algún factor p^index divide al radicando?
    for (let p = 2n; p <= 1_000_000n; p++) {
      const power = powIfSmall(p, index, m)
      if (power === null) break
      if (m % power === 0n) return false
    }
    return true
  }
  if (isNumericDivision(radicand)) return false // sqrt(3/4) = sqrt(3)/2
  return true
}

function isNumericDivision(e: Expr): boolean {
  return e.type === 'binary' && e.op === 'div' && e.left.type === 'number' && e.right.type === 'number'
}

/** Términos de una suma (con signo, a través de restas y negaciones). */
function flattenSum(e: Expr, terms: Expr[]): void {
  if (e.type === 'binary' && (e.op === 'add' || e.op === 'sub')) {
    flattenSum(e.left, terms)
    flattenSum(e.right, terms)
  } else if (e.type === 'unary' && e.op === 'neg') {
    flattenSum(e.arg, terms)
  } else {
    terms.push(e)
  }
}

/** ¿Es un número escrito tal cual (`3`, `0.5`, `3/4`)? */
function isNumericLiteral(e: Expr): boolean {
  return e.type === 'number' || e.type === 'real' || isNumericFraction(e)
}

interface ProductFactors {
  num: Expr[]
  den: Expr[]
  negatives: number
}

/** Factores de un producto/cociente. Una fracción numérica (`1/2` en `(1/2)x`) cuenta como un solo factor. */
function flattenProduct(e: Expr, inDenominator: boolean, root: boolean, out: ProductFactors): void {
  if (e.type === 'binary' && e.op === 'mul') {
    flattenProduct(e.left, inDenominator, false, out)
    flattenProduct(e.right, inDenominator, false, out)
  } else if (e.type === 'binary' && e.op === 'div' && !(isNumericLiteral(e) && !root)) {
    flattenProduct(e.left, inDenominator, false, out)
    flattenProduct(e.right, !inDenominator, false, out)
  } else if (e.type === 'unary' && e.op === 'neg') {
    out.negatives += inDenominator ? 2 : 1 // un signo en el denominador nunca está simplificado
    flattenProduct(e.arg, inDenominator, false, out)
  } else if (inDenominator) out.den.push(e)
  else out.num.push(e)
}

/** Clave de un término sin su coeficiente numérico (`3x*y` → «x*y»); `null` si el término es solo un número. */
function termKey(t: Expr): string | null {
  const f: ProductFactors = { num: [], den: [], negatives: 0 }
  flattenProduct(t, false, true, f)
  const rest = sortedStrings(f.num.filter((x) => !isNumericLiteral(x)).map(toPlain))
  const restDen = sortedStrings(f.den.filter((x) => !isNumericLiteral(x)).map(toPlain))
  if (rest.length === 0 && restDen.length === 0) return null
  return rest.join('*') + '/' + restDen.join('*')
}

function sumIsSimplified(e: Expr): boolean {
  const terms: Expr[] = []
  flattenSum(e, terms)
  let numericTerms = 0
  const keys = new Set<string>()
  for (const t of terms) {
    if (t.type === 'number' && t.value.isZero) return false // x + 0
    const key = termKey(t)
    if (key === null) {
      numericTerms += 1
      continue
    }
    if (keys.has(key)) return false // términos semejantes
    keys.add(key)
  }
  return numericTerms <= 1
}

function numericValue(e: Expr): Fraction | null {
  if (e.type === 'number') return e.value
  if (isNumericDivision(e) && e.type === 'binary' && e.left.type === 'number' && e.right.type === 'number') return e.left.value.divided(e.right.value)
  return null
}

function productIsSimplified(e: Expr): boolean {
  const f: ProductFactors = { num: [], den: [], negatives: 0 }
  flattenProduct(e, false, true, f)
  if (f.negatives >= 2) return false
  const numNumbers = f.num.map(numericValue).filter((x): x is Fraction => x !== null)
  const denNumbers = f.den.map(numericValue).filter((x): x is Fraction => x !== null)
  if (numNumbers.length > 1 || denNumbers.length > 1) return false
  const numOthers = f.num.filter((x) => numericValue(x) === null)
  const denOthers = f.den.filter((x) => numericValue(x) === null)
  const c = numNumbers[0]
  if (c !== undefined) {
    if (c.isZero) return false // 0*x
    if (c.equals(Fraction.ONE) && numOthers.length > 0) return false // 1*x
  }
  const d = denNumbers[0]
  if (d !== undefined) {
    if (d.equals(Fraction.ONE) || d.isZero || d.isNegative) return false // x/1
    if (c !== undefined) {
      if (!c.isInteger || !d.isInteger) return false // 0.5x/2
      if (Numerics.gcd(c.num, d.num) > 1n) return false // 2x/4
    }
  }
  // misma base repetida: x*x, x^2*x, x/x
  const base = (x: Expr): string => (x.type === 'binary' && x.op === 'pow' ? toPlain(x.left) : toPlain(x))
  const bases = new Set<string>()
  for (const x of [...numOthers, ...denOthers]) {
    const b = base(x)
    if (bases.has(b)) return false
    bases.add(b)
  }
  return true
}

/** Reglas locales de `isSimplified` para un nodo. */
function nodeIsSimplified(n: Expr): boolean {
  if (n.type === 'unary' && n.op === 'neg' && n.arg.type === 'unary' && n.arg.op === 'neg') return false
  if (n.type === 'binary') {
    if (n.op === 'pow' && n.right.type === 'number' && (n.right.value.isZero || n.right.value.equals(Fraction.ONE))) return false
    if (n.op === 'add' || n.op === 'sub') {
      if (!sumIsSimplified(n)) return false
    } else if (n.op === 'mul') {
      if (!productIsSimplified(n)) return false
    } else if (n.op === 'div') {
      if (n.left.type === 'number' && n.right.type === 'number' && n.left.value.isInteger && n.right.value.isInteger) {
        // fracción numérica: reducida y con denominador > 1
        return n.right.value.num > 1n && Numerics.gcd(n.left.value.num, n.right.value.num) === 1n
      }
      if (!productIsSimplified(n)) return false
      if (!FormRules.isLowestTerms(n)) return false
      if (containsNode(n.right, isNumericRadical)) return false
    }
  } else if (n.type === 'call' && RADICALS.has(n.name)) {
    if (!radicalIsSimplified(n.name, n.args)) return false
  }
  // Operación entre números que da un racional exacto (2^3, sqrt(4), 3!, sin(pi/6)): hay que calcularla.
  if (isConstantExpr(n) && !isCanonicalNumber(n)) {
    const v = tryEvaluate(n)
    if (v && v.kind === 'rational') return false
  }
  return true
}

/** Heurísticas estructurales de forma (expandida, factorizada, simplificada, en mínimos términos). */
export const FormRules = {
  /** Sin productos de sumas, potencias de sumas ni potencias de productos. */
  isExpanded(e: Expr): boolean {
    const stack: Expr[] = [e]
    while (stack.length > 0) {
      const n = stack.pop() as Expr
      if (n.type === 'binary') {
        if (n.op === 'mul') {
          if (isSumWithVariables(n.left) || isSumWithVariables(n.right)) return false
        } else if (n.op === 'pow' && n.right.type === 'number') {
          const k = n.right.value
          if (k.isInteger && k.num >= 2n && !isConstantExpr(n.left) && !isAtomic(n.left)) return false
        } else if (n.op === 'div') {
          if (isSumWithVariables(n.left)) return false
        }
      } else if (n.type === 'unary' && n.op === 'neg') {
        if (isSumWithVariables(n.arg)) return false
      }
      // no se entra en los argumentos de funciones
      if (n.type === 'call') continue
      stack.push(...children(n))
    }
    return true
  },

  isFactored(e: Expr): boolean {
    const core = stripNeg(e)
    if (core.type !== 'binary') return true
    switch (core.op) {
      case 'add':
      case 'sub':
        return isIrreducibleSum(core) ?? false
      case 'mul':
      case 'div':
        return FormRules.isFactored(core.left) && FormRules.isFactored(core.right)
      case 'pow':
        if (isConstantExpr(core.right)) return FormRules.isFactored(core.left)
        return true
      default:
        return true
    }
  },

  /**
   * ¿Está simplificada? Cada regla corresponde a un paso concreto que falta (términos semejantes, coeficientes, la misma
   * base repetida, factores triviales, fracciones sin reducir, radicales con factores cuadrados, potencias triviales,
   * operaciones entre números que dan un racional…). No reconoce identidades (sin²x+cos²x sigue contando como simplificada).
   */
  isSimplified(e: Expr): boolean {
    const stack: Expr[] = [e]
    let visited = 0
    while (stack.length > 0) {
      const n = stack.pop() as Expr
      visited += 1
      if (visited > 5000) return true // árboles enormes: no se juzga
      if (!nodeIsSimplified(n)) return false
      stack.push(...children(n))
    }
    return true
  },

  isLowestTerms(e: Expr): boolean {
    const core = stripNeg(e)
    if (core.type !== 'binary' || core.op !== 'div') return true
    const num = core.left
    const den = core.right
    // fracción numérica sin reducir (6/8)
    if (num.type === 'number' && den.type === 'number' && num.value.isInteger && den.value.isInteger) {
      return Numerics.gcd(num.value.num, den.value.num) <= 1n
    }
    const vars = [...freeVariables(e)]
    if (vars.length !== 1) return true
    const pn = Polynomial.from(num, vars[0])
    const pd = Polynomial.from(den, vars[0])
    if (!pn || !pd) return true
    const g = Polynomial.gcd(pn, pd)
    if (g && g.degree >= 1) return false
    const cn = pn.integerPrimitive()
    const cd = pd.integerPrimitive()
    // contenido numérico común entre numerador y denominador (2x+2)/4
    if (cn && cd) return Numerics.gcd(cn.content, cd.content) <= 1n
    return true
  },
}
