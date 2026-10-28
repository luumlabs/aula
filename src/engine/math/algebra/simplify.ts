import { E, exprEquals, exprKey, isConstantExpr, type Expr } from '../core/expr'
import { StackGuard } from '../core/stack-guard'
import { compareStrings } from '../core/text'
import type { UnaryOp } from '../core/types'
import { tryEvaluate } from '../eval/evaluate'
import { Fraction } from '../numbers/fraction'
import { fitsInt } from '../numbers/int64'
import { toPlain } from '../print/plain'

/**
 * Simplificación ligera (no es un CAS completo):
 * - pliega constantes exactas: `1/2+1/3` → `5/6`, `2*3x` → `6x`, `sqrt(9/4)` → `3/2`, `sin(pi/6)` → `1/2`;
 * - reúne términos semejantes (`2x+3x` → `5x`) y potencias (`x*x` → `x^2`), cancela factores comunes (`x*y/x` → `y`);
 * - extrae cuadrados de raíces enteras (`sqrt(12)` → `2sqrt(3)`) y aplica identidades triviales (`x+0`, `x*1`, `x^1`, `--x`).
 * Nunca convierte un valor exacto en un decimal aproximado.
 */
export function simplify(e: Expr): Expr {
  let current = simp(e, 0)
  for (let i = 0; i < 4; i++) {
    // hasta que deje de cambiar
    const next = simp(current, 0)
    if (exprEquals(next, current)) break
    current = next
  }
  return fractionForm(current, 0)
}

/** Los racionales no enteros se muestran como fracción (`3/2`, no `1.5`): el resultado de simplificar es exacto. */
function fractionForm(e: Expr, depth: number): Expr {
  if (StackGuard.exhausted(depth)) return e
  switch (e.type) {
    case 'number': {
      const f = e.value
      const magnitude = f.absolute()
      if (f.isInteger || !magnitude) return e
      const fraction = E.div(E.int(magnitude.num), E.int(magnitude.den))
      return f.isNegative ? E.neg(fraction) : fraction
    }
    case 'unary':
      return E.unary(e.op, fractionForm(e.arg, depth + 1))
    case 'binary':
      return E.binary(e.op, fractionForm(e.left, depth + 1), fractionForm(e.right, depth + 1))
    case 'call':
      return E.call(e.name, e.args.map((a) => fractionForm(a, depth + 1)))
    default:
      return e
  }
}

// MARK: Recorrido

function simp(e: Expr, depth: number): Expr {
  if (StackGuard.exhausted(depth)) return e
  switch (e.type) {
    case 'number':
    case 'real':
    case 'variable':
    case 'constant':
      return e
    case 'unary':
      return simpUnary(e.op, simp(e.arg, depth + 1), depth)
    case 'binary':
      switch (e.op) {
        case 'add':
        case 'sub':
          return simpSum(e, depth)
        case 'mul':
        case 'div':
          return simpProduct(e, depth)
        case 'pow':
          return simpPow(simp(e.left, depth + 1), simp(e.right, depth + 1), depth)
        case 'mod': {
          const x = simp(e.left, depth + 1)
          const y = simp(e.right, depth + 1)
          return foldExact(E.binary('mod', x, y)) ?? E.binary('mod', x, y)
        }
      }
      break
    case 'call':
      return simpCall(e.name, e.args.map((a) => simp(a, depth + 1)), depth)
  }
  return e
}

/** Si `e` no tiene variables y se evalúa a un racional exacto, devuelve ese número. */
function foldExact(e: Expr): Expr | null {
  if (!isConstantExpr(e)) return null
  const v = tryEvaluate(e)
  if (v && v.kind === 'rational') return E.num(v.value)
  return null
}

function numberOf(e: Expr): Fraction | null {
  return e.type === 'number' ? e.value : null
}

// MARK: Unarios

function simpUnary(op: UnaryOp, x: Expr, depth: number): Expr {
  switch (op) {
    case 'plus':
      return x
    case 'neg':
      if (x.type === 'number') {
        const n = x.value.negated()
        return n ? E.num(n) : E.neg(x)
      }
      if (x.type === 'real') return E.real(-x.value)
      if (x.type === 'unary' && x.op === 'neg') return x.arg
      return E.neg(x)
    case 'percent':
      return simpProduct(E.div(x, E.int(100)), depth)
    case 'degree':
      if (x.type === 'number') {
        const q = x.value.divided(Fraction.int(180))
        if (q) {
          if (q.isZero) return E.zero
          return piMultiple(q)
        }
      }
      return E.unary('degree', x)
    case 'factorial':
      if (x.type === 'number' && x.value.isInteger && x.value.num >= 0n && x.value.num <= 20n) {
        const v = foldExact(E.unary('factorial', x))
        if (v) return v
      }
      return E.unary('factorial', x)
  }
}

/** `q·π` como expresión: `pi`, `5pi/6`, `-pi/2`. */
export function piMultiple(q: Fraction): Expr {
  const num = q.num
  const den = q.den
  const magnitude = num < 0n ? -num : num
  let top: Expr = E.constant('pi')
  if (magnitude !== 1n) top = E.mul(E.int(magnitude), E.constant('pi'))
  let result = den === 1n ? top : E.div(top, E.int(den))
  if (num < 0n) result = E.neg(result)
  return result
}

// MARK: Sumas

type Term = [number, Expr]

function flattenSum(e: Expr, sign: number, terms: Term[]): void {
  if (e.type === 'binary' && e.op === 'add') {
    flattenSum(e.left, sign, terms)
    flattenSum(e.right, sign, terms)
  } else if (e.type === 'binary' && e.op === 'sub') {
    flattenSum(e.left, sign, terms)
    flattenSum(e.right, -sign, terms)
  } else if (e.type === 'unary' && e.op === 'neg') {
    flattenSum(e.arg, -sign, terms)
  } else if (e.type === 'unary' && e.op === 'plus') {
    flattenSum(e.arg, sign, terms)
  } else {
    terms.push([sign, e])
  }
}

function flattenProduct(e: Expr): Expr[] {
  const out: Expr[] = []
  const stack: Expr[] = [e]
  while (stack.length > 0) {
    const n = stack.pop() as Expr
    if (n.type === 'binary' && n.op === 'mul') {
      stack.push(n.right)
      stack.push(n.left)
    } else out.push(n)
  }
  return out
}

/** Descompone un término en coeficiente racional y el resto (no numérico). */
function splitTerm(t: Expr): [Fraction, Expr | null] {
  if (t.type === 'number') return [t.value, null]
  if (t.type === 'unary' && t.op === 'neg') {
    const [c, k] = splitTerm(t.arg)
    return [c.negated() ?? c, k]
  }
  if (t.type === 'binary' && t.op === 'div' && t.right.type === 'number' && !t.right.value.isZero) {
    const [c, k] = splitTerm(t.left)
    const q = c.divided(t.right.value)
    if (q) return [q, k]
    return [Fraction.ONE, t]
  }
  if (t.type === 'binary' && t.op === 'mul') {
    let coeff: Fraction = Fraction.ONE
    const rest: Expr[] = []
    for (const f of flattenProduct(t)) {
      const c = f.type === 'number' ? coeff.multiplied(f.value) : null
      if (c) coeff = c
      else rest.push(f)
    }
    return [coeff, rest.length === 0 ? null : buildProduct(rest)]
  }
  return [Fraction.ONE, t]
}

/** Producto con los factores ordenados por su texto: `y*x` y `x*y` son la misma clave de términos semejantes. */
function canonicalKey(k: Expr | null): Expr | null {
  if (!k) return null
  if (!(k.type === 'binary' && k.op === 'mul')) return k
  const factors = flattenProduct(k)
    .map((f) => [toPlain(f), f] as const)
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([, f]) => f)
  return buildProduct(factors)
}

function buildProduct(factors: readonly Expr[]): Expr {
  if (factors.length === 0) return E.one
  let acc = factors[0]
  for (const f of factors.slice(1)) acc = E.mul(acc, f)
  return acc
}

const NIL_KEY = '∅'

function simpSum(e: Expr, depth: number): Expr {
  const raw: Term[] = []
  flattenSum(e, 1, raw)
  // simplificar cada término y volver a aplanar lo que se haya convertido en suma
  const terms: Term[] = []
  for (const [s, t] of raw) flattenSum(simp(t, depth + 1), s, terms)
  const order: string[] = []
  const coeffs = new Map<string, Fraction>()
  const display = new Map<string, Expr | null>() // clave canónica → forma con la que se muestra (la primera vista)
  for (const [s, t] of terms) {
    let [c, rawKey] = splitTerm(t)
    if (s < 0) c = c.negated() ?? c
    const key = canonicalKey(rawKey)
    const k = key ? exprKey(key) : NIL_KEY
    const existing = coeffs.get(k)
    if (existing) {
      const sum = existing.adding(c)
      if (!sum) return rebuildUnsimplifiedSum(terms)
      coeffs.set(k, sum)
      if (k === NIL_KEY && !c.isZero && !order.includes(NIL_KEY)) order.push(NIL_KEY)
    } else {
      coeffs.set(k, c)
      display.set(k, rawKey)
      // un cero inicial no fija la posición del término constante (6x+2, no 2+6x)
      if (!(k === NIL_KEY && c.isZero)) order.push(k)
    }
  }
  let result: Expr | null = null
  for (const canon of order) {
    const c = coeffs.get(canon)
    if (!c || c.isZero) continue
    const key = display.get(canon) ?? null
    const negative = c.isNegative
    const mag = c.absolute()
    if (!mag) return rebuildUnsimplifiedSum(terms)
    let term: Expr
    if (key) term = mag.equals(Fraction.ONE) ? key : E.mul(E.num(mag), key)
    else term = E.num(mag)
    if (result) result = E.binary(negative ? 'sub' : 'add', result, term)
    else result = negative ? E.neg(term) : term
  }
  return result ?? E.zero
}

function rebuildUnsimplifiedSum(terms: readonly Term[]): Expr {
  let result: Expr | null = null
  for (const [s, t] of terms) {
    if (result) result = E.binary(s < 0 ? 'sub' : 'add', result, t)
    else result = s < 0 ? E.neg(t) : t
  }
  return result ?? E.zero
}

// MARK: Productos y cocientes

interface ProductParts {
  num: Expr[]
  den: Expr[]
  negative: boolean
}

function collectProduct(e: Expr, denominator: boolean, p: ProductParts): void {
  if (e.type === 'binary' && e.op === 'mul') {
    collectProduct(e.left, denominator, p)
    collectProduct(e.right, denominator, p)
  } else if (e.type === 'binary' && e.op === 'div') {
    collectProduct(e.left, denominator, p)
    collectProduct(e.right, !denominator, p)
  } else if (e.type === 'unary' && e.op === 'neg') {
    p.negative = !p.negative
    collectProduct(e.arg, denominator, p)
  } else if (denominator) p.den.push(e)
  else p.num.push(e)
}

function simpProduct(e: Expr, depth: number): Expr {
  const first: ProductParts = { num: [], den: [], negative: false }
  collectProduct(e, false, first)

  // simplificar cada factor y volver a aplanar
  const p: ProductParts = { num: [], den: [], negative: first.negative }
  for (const f of first.num) collectProduct(simp(f, depth + 1), false, p)
  for (const f of first.den) collectProduct(simp(f, depth + 1), true, p)
  const num2 = p.num
  const den2 = p.den

  let coeff: Fraction = Fraction.ONE
  const order: string[] = []
  const bases = new Map<string, Expr>()
  const exps = new Map<string, number>()
  const addFactor = (f: Expr, sign: number): boolean => {
    if (f.type === 'number') {
      const c = sign > 0 ? coeff.multiplied(f.value) : coeff.divided(f.value)
      if (!c) return false
      coeff = c
      return true
    }
    let base: Expr = f
    let k = sign
    if (f.type === 'binary' && f.op === 'pow' && f.right.type === 'number' && f.right.value.isInteger && f.right.value.num < 1_000_000n && f.right.value.num > -1_000_000n) {
      base = f.left
      k = sign * Number(f.right.value.num)
    }
    const key = exprKey(base)
    if (!exps.has(key)) {
      order.push(key)
      bases.set(key, base)
    }
    exps.set(key, (exps.get(key) ?? 0) + k)
    return true
  }
  for (const f of num2) if (!addFactor(f, 1)) return rebuildProduct(num2, den2, p.negative)
  for (const f of den2) if (!addFactor(f, -1)) return rebuildProduct(num2, den2, p.negative)

  if (p.negative) coeff = coeff.negated() ?? coeff
  if (coeff.isZero) return E.zero

  const top: Expr[] = []
  const bottom: Expr[] = []
  for (const key of order) {
    const base = bases.get(key) as Expr
    const k = exps.get(key) ?? 0
    if (k > 0) top.push(k === 1 ? base : simpPow(base, E.int(k), depth))
    else if (k < 0) bottom.push(k === -1 ? base : simpPow(base, E.int(-k), depth))
  }
  const absCoeff = coeff.absolute() ?? coeff
  const negativeResult = coeff.isNegative
  if (top.length === 0 && bottom.length === 0) return E.num(coeff) // producto puramente numérico
  let numerator: Expr
  if (top.length === 0) {
    numerator = E.int(absCoeff.num)
  } else {
    numerator = buildProduct(top)
    if (absCoeff.num !== 1n) numerator = E.mul(E.int(absCoeff.num), numerator)
  }
  let result: Expr
  if (bottom.length === 0 && absCoeff.den === 1n) {
    result = numerator
  } else {
    let denominator: Expr = bottom.length === 0 ? E.int(absCoeff.den) : buildProduct(bottom)
    if (bottom.length > 0 && absCoeff.den !== 1n) denominator = E.mul(E.int(absCoeff.den), denominator)
    result = E.div(numerator, denominator)
  }
  return negativeResult ? E.neg(result) : result
}

function rebuildProduct(num: readonly Expr[], den: readonly Expr[], negative: boolean): Expr {
  let r: Expr = num.length === 0 ? E.one : buildProduct(num)
  if (den.length > 0) r = E.div(r, buildProduct(den))
  return negative ? E.neg(r) : r
}

// MARK: Potencias

function simpPow(x: Expr, y: Expr, depth: number): Expr {
  if (y.type === 'number') {
    const ny = y.value
    if (ny.equals(Fraction.ONE)) return x
    if (ny.isZero) {
      const nx = numberOf(x)
      if (nx && nx.isZero) return E.pow(x, y)
      return E.one
    }
    if (x.type === 'number') {
      const v = foldExact(E.pow(x, y))
      if (v) return v
    }
    if (ny.isInteger) {
      if (x.type === 'binary' && x.op === 'pow' && x.right.type === 'number' && x.right.value.isInteger) {
        const prod = x.right.value.multiplied(ny)
        if (prod) return simpPow(x.left, E.num(prod), depth + 1)
      }
      // (a/b)^n = a^n/b^n ; (a·b)^n = a^n·b^n  (válido para n entero)
      if (ny.num <= 64n && ny.num >= -64n) {
        if (x.type === 'binary' && x.op === 'div') {
          return simpProduct(E.div(simpPow(x.left, y, depth + 1), simpPow(x.right, y, depth + 1)), depth + 1)
        }
        if (x.type === 'binary' && x.op === 'mul') {
          return simpProduct(E.mul(simpPow(x.left, y, depth + 1), simpPow(x.right, y, depth + 1)), depth + 1)
        }
      }
      if (x.type === 'call' && x.name === 'sqrt' && x.args.length === 1 && ny.isInt(2)) return x.args[0]
      if (x.type === 'unary' && x.op === 'neg') {
        const p = simpPow(x.arg, y, depth + 1)
        return ny.num % 2n === 0n ? p : simpUnary('neg', p, depth + 1)
      }
      if (ny.num < 0n && fitsInt(-ny.num)) {
        // x^(-n) = 1/x^n
        return simpProduct(E.div(E.one, simpPow(x, E.int(-ny.num), depth + 1)), depth + 1)
      }
    }
  }
  const nx = numberOf(x)
  if (nx) {
    if (nx.equals(Fraction.ONE)) return E.one
    const ny = numberOf(y)
    if (nx.isZero && ny && ny.sign > 0) return E.zero
  }
  return E.pow(x, y)
}

// MARK: Funciones

function simpCall(name: string, args: Expr[], depth: number): Expr {
  const call = E.call(name, args)
  const v = foldExact(call)
  if (v) return v
  if (args.length !== 1) return call
  const a = args[0]
  switch (name) {
    case 'sqrt': {
      if (a.type === 'number' && a.value.isInteger && a.value.num > 1n) {
        const sf = squareFree(a.value.num)
        if (sf && sf[0] > 1n) return E.mul(E.int(sf[0]), E.call('sqrt', [E.int(sf[1])]))
      }
      if (a.type === 'binary' && a.op === 'pow' && a.right.type === 'number' && a.right.value.isInt(2)) return E.call('abs', [a.left])
      break
    }
    case 'abs':
      if (a.type === 'unary' && a.op === 'neg') return simpCall('abs', [a.arg], depth + 1)
      if (a.type === 'call' && a.name === 'abs') return a
      break
    case 'ln':
      if (a.type === 'constant' && a.name === 'e') return E.one
      if (a.type === 'binary' && a.op === 'pow' && a.left.type === 'constant' && a.left.name === 'e') return a.right
      if (a.type === 'call' && a.name === 'exp' && a.args.length === 1) return a.args[0]
      break
    case 'exp':
      if (a.type === 'call' && a.name === 'ln' && a.args.length === 1) return a.args[0]
      break
    case 'sin':
    case 'tan':
      if (a.type === 'unary' && a.op === 'neg') return simpUnary('neg', E.call(name, [a.arg]), depth)
      break
    case 'cos':
      if (a.type === 'unary' && a.op === 'neg') return E.call('cos', [a.arg])
      break
    default:
      break
  }
  return call
}

/** `n = k²·m` con `m` sin cuadrados: devuelve `[k, m]`. */
function squareFree(n: bigint): [bigint, bigint] | null {
  if (n <= 1n) return null
  if (n <= BigInt(Number.MAX_SAFE_INTEGER)) {
    let k = 1
    let m = Number(n)
    let f = 2
    while (f * f <= m) {
      while (m % (f * f) === 0) {
        m /= f * f
        k *= f
      }
      f += 1
      if (f > 100_000) return null
    }
    return [BigInt(k), BigInt(m)]
  }
  let k = 1n
  let m = n
  let f = 2n
  while (f * f <= m) {
    while (m % (f * f) === 0n) {
      m /= f * f
      k *= f
    }
    f += 1n
    if (f > 100_000n) return null
  }
  return [k, m]
}
