import { Polynomial } from '../algebra/polynomial'
import { E, exprEquals, freeVariables, substitute, type Expr } from '../core/expr'
import { FunctionTable } from '../core/functions'
import { tr } from '../core/i18n'
import { charCount, sortedStrings, trimWS, trimWSNL } from '../core/text'
import { MathError } from '../core/types'
import { tryEvaluateDouble, type NumberEnv } from '../eval/evaluate'
import { MathParser } from '../parse/parser'
import { latexVariable, toLatex } from '../print/latex'
import { toPlain } from '../print/plain'
import { DeterministicRNG } from '../random/rng'
import { ExpressionChecker } from './expression-checker'
import { rxGroups } from './rx'
import { MAX_INPUT_LENGTH, Verdict, type CheckVerdict } from './verdict'

/** Notación de función a la izquierda del «=»: `f(x) = …`, `r(θ) = …`, `g(theta) = …`. */
export interface FunctionLHS {
  name: string
  argument: string
  rhs: string
}

/** Resultado de comparar dos conjuntos solución. */
export type EquationDecision = 'same' | 'different' | 'undecided'

/** Una forma de entender la ecuación del estudiante. */
interface Reading {
  lhs: Expr
  rhs: Expr
  plain: string
  latex: string
}

const FUNCTION_LHS_RE = /^\s*([\p{L}][\p{L}0-9_]*'*)\s*\(\s*([\p{L}][\p{L}0-9_]*)\s*\)\s*=(?!=)(.*)$/su

function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance
  return p ? p.now() : Date.now()
}

/**
 * Tiempo de cálculo para un barrido: las respuestas normales tardan milisegundos; una expresión enorme no puede dejar la
 * corrección colgada.
 */
export class EquationBudget {
  private readonly deadline: number
  private counter = 0
  private spent = false

  constructor(seconds: number) {
    this.deadline = now() + seconds * 1000
  }

  get exhausted(): boolean {
    return this.spent
  }

  /** `false` (y queda agotado) cuando se pasa del tiempo; se consulta el reloj cada 256 evaluaciones. */
  spend(): boolean {
    if (this.spent) return false
    this.counter = (this.counter + 1) | 0
    if ((this.counter & 255) === 0 && now() > this.deadline) this.spent = true
    return !this.spent
  }
}

function canonical(name: string): string {
  return MathParser.canonicalVariableName(name)
}

/** Comprobador de ecuaciones: es correcta si tiene el mismo conjunto solución que la esperada. */
export class EquationChecker {
  readonly expectedText: string
  readonly variables: readonly string[] | null

  constructor(expectedText: string, variables: readonly string[] | null = null) {
    this.expectedText = expectedText
    this.variables = variables
  }

  /**
   * `null` si el nombre es una función conocida (`log(x) = 2`), una constante (`e(x) = …` es un producto) o una de las
   * variables declaradas del ejercicio (`a(x) = 3` con `a` variable es el producto `a·x`).
   */
  static functionLHS(text: string, variables: readonly string[] | null = null): FunctionLHS | null {
    const g = rxGroups(FUNCTION_LHS_RE, text)
    if (!g || g.length !== 4 || trimWS(g[3]) === '') return null
    const name = g[1]
    if (FunctionTable.canonical(name) !== undefined) return null
    if (name === 'e' || ['pi', 'π', 'inf', 'infinity'].includes(name.toLowerCase())) return null
    if (variables && variables.map(canonical).includes(canonical(name))) return null
    return { name, argument: g[2], rhs: g[3] }
  }

  check(raw: string): CheckVerdict {
    const trimmed = trimWSNL(raw)
    if (trimmed === '') return Verdict.format(tr('Escribe tu ecuación.'))
    if (charCount(trimmed) > MAX_INPUT_LENGTH) return Verdict.format(Verdict.tooLongMessage)

    // Esperada. Con notación de función (f(x) = …) la variable dependiente se llama «y» y el estudiante puede
    // escribir y = …, f(x) = … o f = … (r = 2cos θ para r(θ) = 2cos θ).
    let expLHS: Expr
    let expRHS: Expr
    let dependentAliases = new Set<string>()
    let expectedIsFunction = false
    const fExp = EquationChecker.functionLHS(this.expectedText, this.variables)
    const fExpRHS = fExp ? tryParse(fExp.rhs) : null
    if (fExp && fExpRHS) {
      const name = canonical(fExp.name)
      const rhsVars = freeVariables(fExpRHS)
      const dependent = rhsVars.has('y') ? name : 'y'
      expLHS = E.variable(dependent)
      expRHS = fExpRHS
      expectedIsFunction = true
      dependentAliases = new Set([name, 'y'].filter((a) => !rhsVars.has(a) && a !== dependent))
    } else {
      try {
        const e = MathParser.parseEquation(this.expectedText)
        expLHS = e.lhs
        expRHS = e.rhs
      } catch {
        return Verdict.format(tr('No se pudo interpretar la ecuación esperada del ejercicio («%@»).', this.expectedText))
      }
    }
    const expectedDependent = expectedIsFunction && expLHS.type === 'variable' ? expLHS.name : null
    const allowed = sortedStrings(this.variables ? this.variables.map(canonical) : new Set([...freeVariables(expLHS), ...freeVariables(expRHS)]))
    const allowedSet = new Set(allowed)

    /** El estudiante usó el nombre de la función esperada como variable (r = … para r(θ) = …). */
    const renameDependent = (e: Expr): Expr => {
      if (expectedDependent === null) return e
      let out = e
      for (const alias of dependentAliases) if (!allowedSet.has(alias)) out = substitute(out, alias, E.variable(expectedDependent))
      return out
    }

    // Lecturas posibles del estudiante: con notación de función y literal (x(y) = 6 puede ser un producto).
    const readings: Reading[] = []
    let parseError: MathError | null = null
    const f = EquationChecker.functionLHS(trimmed, this.variables)
    const fRHS = f ? tryParse(f.rhs) : null
    if (f && fRHS) {
      const name = canonical(f.name)
      const dependent = expectedDependent ?? (allowedSet.has(name) ? name : 'y')
      const arg = canonical(f.argument)
      const r = renameDependent(fRHS)
      readings.push({
        lhs: E.variable(dependent),
        rhs: r,
        plain: `${name}(${arg}) = ` + toPlain(r),
        latex: latexVariable(name) + '\\left(' + latexVariable(arg) + '\\right)=' + toLatex(r),
      })
    }
    try {
      const e = MathParser.parseEquation(trimmed)
      readings.push({ lhs: renameDependent(e.lhs), rhs: renameDependent(e.rhs), plain: toPlain(e.lhs) + ' = ' + toPlain(e.rhs), latex: toLatex(e.lhs) + '=' + toLatex(e.rhs) })
    } catch (e) {
      if (e instanceof MathError) parseError = e
    }
    if (readings.length === 0) {
      const message = parseError
        ? tr('No pude leer tu ecuación: %@. Escribe una ecuación con un solo «=», por ejemplo y = 2x + 1.', parseError.message)
        : tr('No pude leer tu ecuación. Escribe una ecuación con un solo «=», por ejemplo y = 2x + 1.')
      return Verdict.format(message)
    }

    // Se queda con la primera lectura correcta; si ninguna lo es, con la primera que use solo variables permitidas.
    const f2 = E.sub(expLHS, expRHS)
    let firstValid: Reading | null = null
    let firstBad: [Reading, string] | null = null
    let undecided: Reading | null = null
    // Un solo presupuesto de tiempo para toda la corrección: comparación principal y diagnósticos.
    const budget = new EquationBudget(2)
    for (const reading of readings) {
      const used = new Set([...freeVariables(reading.lhs), ...freeVariables(reading.rhs)])
      const bad = sortedStrings([...used].filter((v) => !allowedSet.has(v)))[0]
      if (bad !== undefined) {
        if (firstBad === null) firstBad = [reading, bad]
        continue
      }
      if (firstValid === null) firstValid = reading
      if ((exprEquals(reading.lhs, expLHS) && exprEquals(reading.rhs, expRHS)) || (exprEquals(reading.lhs, expRHS) && exprEquals(reading.rhs, expLHS))) {
        return Verdict.correct(null, reading.plain, reading.latex)
      }
      const decision = EquationChecker.compare(E.sub(reading.lhs, reading.rhs), f2, allowed, budget)
      if (decision === 'same') return Verdict.correct(null, reading.plain, reading.latex)
      if (decision === 'undecided' && undecided === null) undecided = reading
    }
    if (firstValid === null) {
      const [reading, bad] = firstBad ?? [readings[0], '?']
      return Verdict.format(ExpressionChecker.onlyVariables(allowed, bad), reading.plain, reading.latex)
    }
    // Expresión demasiado costosa para comprobarla a tiempo: ni se aprueba ni cuenta como intento fallido.
    if (undecided !== null) {
      return Verdict.format(tr('No he podido comprobar a tiempo si tu ecuación tiene las mismas soluciones que la esperada: escríbela de forma más sencilla.'), undecided.plain, undecided.latex)
    }
    const eq = firstValid
    const normalized = eq.plain
    const latex = eq.latex
    const f1 = E.sub(eq.lhs, eq.rhs)
    const vars = allowed

    // Diagnóstico: signos cambiados o variables intercambiadas
    if (vars.length >= 1 && vars.length <= 3) {
      for (let mask = 1; mask < 1 << vars.length; mask++) {
        let g = f2
        const flipped: string[] = []
        vars.forEach((v, i) => {
          if ((mask & (1 << i)) !== 0) {
            g = substitute(g, v, E.neg(E.variable(v)))
            flipped.push(v)
          }
        })
        if (EquationChecker.equivalent(f1, g, vars, budget)) {
          return Verdict.wrong(EquationChecker.checkSignsMessage(flipped), ['signError'], normalized, latex)
        }
      }
    }
    if (vars.length === 2) {
      const a = vars[0]
      const b = vars[1]
      const tmp = '__swap__'
      const swapped = substitute(substitute(substitute(f2, a, E.variable(tmp)), b, E.variable(a)), tmp, E.variable(b))
      if (EquationChecker.equivalent(f1, swapped, vars, budget)) {
        return Verdict.wrong(tr('Parece que intercambiaste «%@» y «%@» (es la ecuación de la inversa).', a, b), ['other'], normalized, latex)
      }
    }
    return Verdict.wrong(tr('Esa ecuación no es equivalente a la esperada: no tiene el mismo conjunto solución.'), ['other'], normalized, latex)
  }

  /** «Casi: revisa el signo de «x» (y «y»…) en tu ecuación.» (como mucho tres variables: una frase por caso). */
  static checkSignsMessage(names: readonly string[]): string {
    if (names.length <= 1) return tr('Casi: revisa el signo de «%@» en tu ecuación.', names[0] ?? '')
    if (names.length === 2) return tr('Casi: revisa el signo de «%@» y «%@» en tu ecuación.', names[0], names[1])
    return tr('Casi: revisa el signo de «%@», «%@» y «%@» en tu ecuación.', names[0], names[1], names[2])
  }

  // MARK: Equivalencia de ecuaciones

  /** `f1 = 0` y `f2 = 0` tienen el mismo conjunto solución. */
  static equivalent(f1: Expr, f2: Expr, vars: readonly string[], budget?: EquationBudget): boolean {
    return EquationChecker.compare(f1, f2, vars, budget) === 'same'
  }

  /**
   * Compara los conjuntos solución de `f1 = 0` y `f2 = 0`. `undecided` solo si se agotó el tiempo de cálculo (expresiones
   * enormes). `budget`: el tiempo compartido de una corrección; sin él, 1,5 s para esta comparación.
   */
  static compare(f1: Expr, f2: Expr, vars: readonly string[], budget?: EquationBudget): EquationDecision {
    if (vars.length === 0) {
      const a = tryEvaluateDouble(f1)
      const b = tryEvaluateDouble(f2)
      if (a === null || b === null) return 'different'
      return (Math.abs(a) < 1e-9) === (Math.abs(b) < 1e-9) ? 'same' : 'different'
    }
    // Con una variable y polinomios racionales, la comparación es exacta y no depende de ninguna ventana.
    if (vars.length === 1) {
      const exact = sameRealRoots(f1, f2, vars[0])
      if (exact !== null) return exact ? 'same' : 'different'
    }
    if (proportionalExprs(f1, f2, vars)) return 'same'
    const b = budget ?? new EquationBudget(1.5)
    if (b.exhausted) return 'undecided'
    if (vars.length === 1) return sameZeroSet1D(f1, f2, vars[0], b)
    return sameZeroSet(f1, f2, vars, b)
  }
}

function tryParse(text: string): Expr | null {
  try {
    return MathParser.parse(text)
  } catch {
    return null
  }
}

/**
 * Mismo conjunto de raíces reales para dos polinomios racionales de una variable, con aritmética exacta (partes libres de
 * cuadrados y secuencias de Sturm). `null` si alguna de las dos expresiones no es un polinomio racional en esa variable.
 * Dos ecuaciones sin ninguna solución real (x²+1 = 0 y x²+4 = 0) no se dan por equivalentes.
 */
function sameRealRoots(f1: Expr, f2: Expr, variable: string): boolean | null {
  const p1 = Polynomial.from(f1, variable)
  const p2 = Polynomial.from(f2, variable)
  if (!p1 || !p2 || p1.isZero || p2.isZero) return null
  const a = p1.squareFreePart()
  const b = p2.squareFreePart()
  if (!a || !b) return null
  if (proportionalPolys(a, b)) return true
  const d = Polynomial.gcd(a, b)
  const q1 = d ? a.divided(d)?.quotient : null
  const q2 = d ? b.divided(d)?.quotient : null
  if (!d || !q1 || !q2) return null
  const own1 = q1.realRootCount()
  const own2 = q2.realRootCount()
  const shared = d.realRootCount()
  if (own1 === null || own2 === null || shared === null) return null
  return own1 === 0 && own2 === 0 && shared > 0
}

/** Mismos ceros (complejos) para dos polinomios: uno es múltiplo constante del otro. */
function proportionalPolys(a: Polynomial, b: Polynomial): boolean {
  if (a.degree <= 0 && b.degree <= 0) return true
  if (a.degree !== b.degree) return false
  const g = Polynomial.gcd(a, b)
  return g !== null && g.degree === a.degree
}

/**
 * `f1 = k·f2` con k constante no nula **y el mismo dominio** en los puntos de muestra. Si una se puede evaluar donde la
 * otra no, no se decide aquí: el barrido de raíces tiene en cuenta el dominio de cada una.
 */
function proportionalExprs(f1: Expr, f2: Expr, vars: readonly string[]): boolean {
  const rng = new DeterministicRNG(0x45514e5f50524f50n)
  let ratio: number | null = null
  let used = 0
  let attempts = 0
  while (used < 16 && attempts < 600) {
    attempts += 1
    const env: Record<string, number> = {}
    for (const v of vars) env[v] = rng.doubleIn(-6, 6)
    const a = finite(tryEvaluateDouble(f1, env))
    const b = finite(tryEvaluateDouble(f2, env))
    if (a === null || b === null) {
      if ((a === null) !== (b === null)) return false
      continue
    }
    const scale = Math.max(1, Math.abs(a), Math.abs(b))
    if (Math.abs(b) < 1e-9 * scale) {
      if (Math.abs(a) > 1e-7 * scale) return false
      continue
    }
    const r = a / b
    if (ratio !== null) {
      // Tolerancia relativa a k: con una absoluta, (x−1)(|x|−5000) parecía proporcional a x−1 (k ≈ −1/5000).
      if (Math.abs(r - ratio) > 1e-6 * Math.abs(ratio)) return false
    } else ratio = r
    used += 1
  }
  if (used < 8 || ratio === null) return false
  return Math.abs(ratio) > 1e-9
}

function finite(v: number | null): number | null {
  return v !== null && Number.isFinite(v) ? v : null
}

/** Malla de `steps` intervalos iguales en `[lo, hi]`. */
function linearGrid(lo: number, hi: number, steps: number): number[] {
  const h = (hi - lo) / steps
  const out: number[] = []
  for (let i = 0; i <= steps; i++) out.push(lo + i * h)
  return out
}

/** Malla geométrica creciente entre `a` y `b` (los dos del mismo signo), con `perDecade` puntos por potencia de 10. */
function geometricGrid(a: number, b: number, perDecade: number): number[] {
  const la = Math.log10(Math.abs(a))
  const lb = Math.log10(Math.abs(b))
  const n = Math.max(2, Math.ceil(Math.abs(lb - la) * perDecade))
  const sign = a < 0 ? -1 : 1
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push(sign * Math.pow(10, la + ((lb - la) * i) / n))
  return xs[0] <= xs[xs.length - 1] ? xs : xs.reverse()
}

interface RootScan {
  roots: number[]
  oscillates: boolean
}

/**
 * Raíces de `f` en la malla creciente `xs` de la variable `pivot` (el resto fijado en `env`): cruces por cero (bisección;
 * descarta los polos), raíces de multiplicidad par (mínimos de |f| que se hunden al refinarlos) y raíces en el borde del
 * dominio. Los ceros exactos de la malla cuentan, salvo los que vienen de un subdesbordamiento. Si en la parte con
 * |x| > `oscillation.beyond` hay más de `oscillation.limit` cruces, esa parte no se usa y `oscillates` es `true`.
 * `null` si se agotó el tiempo.
 */
function roots(f: Expr, pivot: string, env: NumberEnv, xs: readonly number[], oscillation: { beyond: number; limit: number } | null, budget: EquationBudget): RootScan | null {
  const e: Record<string, number> = { ...env }
  const value = (t: number): number | null => {
    if (!budget.spend()) return null
    e[pivot] = t
    return finite(tryEvaluateDouble(f, e))
  }
  const steps = xs.length - 1
  if (steps < 2) return { roots: [], oscillates: false }
  const vs: Array<number | null> = []
  for (const t of xs) vs.push(value(t))
  if (budget.exhausted) return null
  // ¿Oscila en la parte lejana? Se cuentan los cruces y los mínimos locales de |f| antes de refinar nada.
  let skipFar = false
  if (oscillation) {
    let wiggles = 0
    for (let i = 1; i < steps; i++) {
      if (!(Math.abs(xs[i - 1]) > oscillation.beyond && Math.abs(xs[i + 1]) > oscillation.beyond)) continue
      const a = vs[i - 1]
      const m = vs[i]
      const b = vs[i + 1]
      if (a === null || m === null || b === null) continue
      if (m !== 0 && a !== 0 && a < 0 !== m < 0) wiggles += 1
      else if (Math.abs(m) < Math.abs(a) && Math.abs(m) <= Math.abs(b)) wiggles += 1
    }
    skipFar = wiggles > oscillation.limit
  }
  const considered = (i: number): boolean => !skipFar || Math.abs(xs[i]) <= (oscillation?.beyond ?? Infinity)
  // Ceros exactos: cuáles son raíces (aislados, o tramos junto a valores normales) y cuáles subdesbordamiento.
  const zeroIsRoot = new Array<boolean>(xs.length).fill(false)
  let i0 = 0
  while (i0 <= steps) {
    if (vs[i0] !== 0) {
      i0 += 1
      continue
    }
    let j = i0
    while (j + 1 <= steps && vs[j + 1] === 0) j += 1
    const neighbours = [i0 > 0 ? vs[i0 - 1] : null, j < steps ? vs[j + 1] : null].filter((v): v is number => v !== null)
    const underflow = neighbours.length > 0 && neighbours.every((v) => Math.abs(v) < 1e-250)
    if (!underflow) for (let k = i0; k <= j; k++) zeroIsRoot[k] = true
    i0 = j + 1
  }
  const out: number[] = []
  let scale = 1
  for (const v of vs) if (v !== null && Math.abs(v) > scale) scale = Math.abs(v)
  for (let i = 1; i <= steps; i++) {
    if (!(considered(i - 1) && considered(i))) continue
    const a = vs[i - 1]
    const b = vs[i]
    if (a !== null && a === 0) {
      if (zeroIsRoot[i - 1]) out.push(xs[i - 1])
      continue
    }
    if (a !== null && b !== null && a < 0 !== b < 0 && b !== 0) {
      let lo = xs[i - 1]
      let hi = xs[i]
      let flo = a
      for (let it = 0; it < 80; it++) {
        const mid = (lo + hi) / 2
        const fm = value(mid)
        if (fm === null) break
        if (fm < 0 === flo < 0) {
          lo = mid
          flo = fm
        } else hi = mid
      }
      const r = (lo + hi) / 2
      const fr = value(r)
      if (fr !== null && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(r) // descarta polos
    } else if ((a === null) !== (b === null)) {
      const inside = (a ?? b) as number
      if (inside === 0) continue
      // Borde del dominio entre dos puntos de la malla: se busca por bisección y cuenta si allí f ≈ 0.
      let defined = a === null ? xs[i] : xs[i - 1]
      let undefinedX = a === null ? xs[i - 1] : xs[i]
      for (let it = 0; it < 80; it++) {
        const mid = (defined + undefinedX) / 2
        if (value(mid) !== null) defined = mid
        else undefinedX = mid
      }
      const fb = value(defined)
      if (fb !== null && Math.abs(fb) <= 1e-6 * Math.max(1, Math.abs(inside))) out.push(defined)
    }
  }
  const last = vs[steps]
  if (last !== null && last === 0 && zeroIsRoot[steps] && considered(steps)) out.push(xs[steps])
  // Raíces de multiplicidad par: el signo no cambia y el barrido normal no las ve. Se buscan mínimos locales de |f| y se
  // refinan; solo cuentan si al refinar bajan muchísimo respecto del valor de malla.
  for (let i = 1; i < steps; i++) {
    if (!(considered(i - 1) && considered(i + 1))) continue
    const left = vs[i - 1]
    const mid = vs[i]
    const right = vs[i + 1]
    if (left === null || mid === null || right === null) continue
    const am = Math.abs(mid)
    if (!(am > 0 && am < Math.abs(left) && am <= Math.abs(right) && am <= 1e-4 * scale)) continue // mínimo discreto
    if (left < 0 !== mid < 0 || mid < 0 !== right < 0) continue // ya es un cruce
    let lo = xs[i - 1]
    let hi = xs[i + 1]
    let bestX = xs[i]
    let bestV = am
    for (let it = 0; it < 80; it++) {
      const m1 = lo + (hi - lo) * 0.382
      const m2 = lo + (hi - lo) * 0.618
      const f1 = value(m1)
      const f2 = value(m2)
      const v1 = f1 !== null ? Math.abs(f1) : Infinity
      const v2 = f2 !== null ? Math.abs(f2) : Infinity
      if (v1 < bestV) {
        bestV = v1
        bestX = m1
      }
      if (v2 < bestV) {
        bestV = v2
        bestX = m2
      }
      if (v1 < v2) hi = m2
      else lo = m1
    }
    // El mínimo de un subdesbordamiento (valores de 10⁻³⁰⁰ que «bajan» a 0) no es una raíz.
    if (!(bestV <= 1e-6 * am && bestV <= 1e-9 * scale && am >= 1e-250)) continue
    out.push(bestX)
  }
  if (budget.exhausted) return null
  out.sort((x, y) => x - y)
  const unique: number[] = []
  for (const r of out) {
    const prev = unique[unique.length - 1]
    if (prev === undefined || Math.abs(prev - r) > 1e-9 * Math.max(1, Math.abs(r))) unique.push(r)
  }
  return { roots: unique, oscillates: skipFar }
}

/**
 * ¿`f` se anula en `r`? Comprobación local, independiente de la malla: `f(r)` existe y es despreciable frente a sus valores
 * un poco más allá (cubre raíces simples, múltiples y del borde del dominio, y descarta polos).
 */
function vanishes(f: Expr, pivot: string, env: NumberEnv, r: number, budget: EquationBudget): boolean {
  const e: Record<string, number> = { ...env }
  const value = (t: number): number | null => {
    if (!budget.spend()) return null
    e[pivot] = t
    return finite(tryEvaluateDouble(f, e))
  }
  const fr = value(r)
  if (fr === null) return false // r no está en el dominio de f: no es solución
  if (fr === 0) return true
  const d = 1e-4 * Math.max(1, Math.abs(r))
  const around = [r - d, r + d, r - d / 100, r + d / 100].map(value).filter((v): v is number => v !== null).map(Math.abs)
  if (around.length === 0) return false
  const m = Math.max(...around)
  if (!(m > 0)) return false
  return Math.abs(fr) <= 1e-7 * m
}

/**
 * Cada raíz de `a` es raíz de la otra ecuación: está en su lista `b` (ordenada) o la otra expresión se anula allí. Dos
 * raíces son la misma si difieren menos de una millonésima relativa; cerca de 0 la tolerancia es absoluta y pequeña.
 */
function covered(a: readonly number[], b: readonly number[], other: Expr, pivot: string, env: NumberEnv, budget: EquationBudget): boolean {
  return a.every((x) => {
    const tol = 1e-6 * Math.max(1e-3, Math.abs(x))
    // búsqueda binaria del primer elemento ≥ x − tol
    let lo = 0
    let hi = b.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (b[mid] < x - tol) lo = mid + 1
      else hi = mid
    }
    if (lo < b.length && b[lo] <= x + tol) return true
    return vanishes(other, pivot, env, x, budget)
  })
}

let oneVariableGridCache: number[] | null = null

/**
 * Malla de una variable: [−50, 50] en pasos de 0,005, más 300 puntos por potencia de 10 entre 10⁻⁶ y 0,05 y entre 50 y 10⁶
 * (con los dos signos). Creciente y sin repetidos; se calcula una vez.
 */
function oneVariableGrid(): number[] {
  if (oneVariableGridCache) return oneVariableGridCache
  const xs = [
    ...linearGrid(-50, 50, 20_000),
    ...geometricGrid(1e-6, 0.05, 300), ...geometricGrid(50, 1e6, 300),
    ...geometricGrid(-0.05, -1e-6, 300), ...geometricGrid(-1e6, -50, 300),
  ]
  xs.sort((a, b) => a - b)
  const out: number[] = []
  for (const x of xs) {
    const prev = out[out.length - 1]
    if (prev === undefined || x - prev > 1e-12 * Math.max(1, Math.abs(x))) out.push(x)
  }
  oneVariableGridCache = out
  return out
}

/**
 * Una variable y alguna función no polinómica: a la malla fina de [−50, 50] se le añaden tramos geométricos cerca de 0
 * (hasta 10⁻⁶) y lejos (hasta ±10⁶). Cada raíz de una se comprueba en la otra evaluándola allí. Si en la parte lejana
 * alguna oscila más deprisa que la malla, esa parte se descarta para las dos.
 */
function sameZeroSet1D(f1: Expr, f2: Expr, v: string, budget: EquationBudget): EquationDecision {
  const grid = oneVariableGrid()
  const far = { beyond: 50, limit: 60 }
  const a = roots(f1, v, {}, grid, far, budget)
  const b = a ? roots(f2, v, {}, grid, far, budget) : null
  if (!a || !b) return 'undecided'
  let r1 = a.roots
  let r2 = b.roots
  if (a.oscillates || b.oscillates) {
    r1 = r1.filter((x) => !(Math.abs(x) > far.beyond))
    r2 = r2.filter((x) => !(Math.abs(x) > far.beyond))
  }
  // Ninguna de las dos tiene raíces reales: no se puede confirmar que tengan el mismo conjunto solución.
  if (r1.length === 0 && r2.length === 0) return 'different'
  const ok = covered(r1, r2, f2, v, {}, budget) && covered(r2, r1, f1, v, {}, budget)
  if (budget.exhausted) return 'undecided'
  return ok ? 'same' : 'different'
}

/** Varias variables: muestreo de cortes a lo largo de cada variable con el resto fijado al azar. */
function sameZeroSet(f1: Expr, f2: Expr, vars: readonly string[], budget: EquationBudget): EquationDecision {
  const rng = new DeterministicRNG(0x45514e5f5a45524fn)
  let agreeing = 0
  const grid = linearGrid(-12, 12, 1200)
  for (const pivot of vars) {
    const others = vars.filter((x) => x !== pivot)
    let tries = 0
    let found = 0
    while (found < 6 && tries < 60) {
      tries += 1
      const env: Record<string, number> = {}
      for (const o of others) env[o] = rng.doubleIn(-4, 4)
      const s1 = roots(f1, pivot, env, grid, null, budget)
      const s2 = s1 ? roots(f2, pivot, env, grid, null, budget) : null
      if (!s1 || !s2) return 'undecided'
      const r1 = s1.roots
      const r2 = s2.roots
      if (r1.length === 0 && r2.length === 0) continue
      // los dos conjuntos de raíces deben coincidir
      const ok = covered(r1, r2, f2, pivot, env, budget) && covered(r2, r1, f1, pivot, env, budget)
      if (budget.exhausted) return 'undecided'
      if (!ok) return 'different'
      found += 1
      agreeing += 1
    }
  }
  return agreeing >= 6 ? 'same' : 'different'
}
