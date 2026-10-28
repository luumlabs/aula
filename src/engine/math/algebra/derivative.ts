import { E, freeVariables, type Expr } from '../core/expr'
import { StackGuard } from '../core/stack-guard'
import type { BinaryOp } from '../core/types'
import { simplify } from './simplify'

/**
 * Derivada simbólica respecto de `variable` (los ángulos se suponen en radianes).
 * Soporta polinomios, potencias (también con exponente variable), `exp`, logaritmos, trigonometría y sus inversas,
 * funciones hiperbólicas, raíces, valor absoluto, y las reglas del producto, el cociente y la cadena.
 * Devuelve `null` si no sabe derivar (funciones definidas a trozos como `floor`, o con la variable en un factorial…).
 * El resultado ya viene simplificado.
 */
export function derivative(e: Expr, variable: string): Expr | null {
  const d = new Differentiator(variable).d(e, 0)
  return d ? simplify(d) : null
}

const mul = (a: Expr, b: Expr): Expr => E.mul(a, b)
const div = (a: Expr, b: Expr): Expr => E.div(a, b)
const add = (a: Expr, b: Expr): Expr => E.add(a, b)
const sub = (a: Expr, b: Expr): Expr => E.sub(a, b)
const pow = (a: Expr, b: Expr): Expr => E.pow(a, b)
const neg = (a: Expr): Expr => E.neg(a)
const fn = (n: string, ...a: Expr[]): Expr => E.call(n, a)
const sq = (a: Expr): Expr => pow(a, E.int(2))

const NO_DERIVATIVE = new Set(['floor', 'ceil', 'round', 'trunc', 'sign', 'fact', 'nCr', 'nPr', 'gcd', 'lcm', 'mod', 'min', 'max'])

class Differentiator {
  constructor(readonly v: string) {}

  depends(e: Expr): boolean {
    return freeVariables(e).has(this.v)
  }

  d(e: Expr, depth: number): Expr | null {
    if (depth > 400 || StackGuard.exhausted(depth)) return null
    if (!this.depends(e)) return E.zero
    switch (e.type) {
      case 'number':
      case 'real':
      case 'constant':
        return E.zero
      case 'variable':
        return E.one
      case 'unary': {
        const da = this.d(e.arg, depth + 1)
        if (!da) return null
        switch (e.op) {
          case 'plus':
            return da
          case 'neg':
            return neg(da)
          case 'percent':
            return div(da, E.int(100))
          case 'degree':
            return div(mul(da, E.constant('pi')), E.int(180))
          case 'factorial':
            return null
        }
        break
      }
      case 'binary':
        return this.dBinary(e.op, e.left, e.right, depth)
      case 'call':
        return this.dCall(e.name, e.args, depth)
    }
    return null
  }

  private dBinary(op: BinaryOp, a: Expr, b: Expr, depth: number): Expr | null {
    switch (op) {
      case 'add':
      case 'sub': {
        const da = this.d(a, depth + 1)
        const db = da ? this.d(b, depth + 1) : null
        if (!da || !db) return null
        return op === 'add' ? add(da, db) : sub(da, db)
      }
      case 'mul': {
        const da = this.d(a, depth + 1)
        const db = da ? this.d(b, depth + 1) : null
        if (!da || !db) return null
        return add(mul(da, b), mul(a, db))
      }
      case 'div': {
        const da = this.d(a, depth + 1)
        const db = da ? this.d(b, depth + 1) : null
        if (!da || !db) return null
        if (!this.depends(b)) return div(da, b)
        return div(sub(mul(da, b), mul(a, db)), sq(b))
      }
      case 'pow':
        return this.dPow(a, b, depth)
      case 'mod':
        return null
    }
  }

  private dPow(a: Expr, b: Expr, depth: number): Expr | null {
    if (!this.depends(b)) {
      // regla de la potencia: b·a^(b-1)·a'
      const da = this.d(a, depth + 1)
      if (!da) return null
      return mul(mul(b, pow(a, sub(b, E.one))), da)
    }
    if (!this.depends(a)) {
      const db = this.d(b, depth + 1)
      if (!db) return null
      if (a.type === 'constant' && a.name === 'e') return mul(pow(a, b), db)
      return mul(mul(pow(a, b), fn('ln', a)), db)
    }
    // a^b = e^(b ln a)
    const da = this.d(a, depth + 1)
    const db = da ? this.d(b, depth + 1) : null
    if (!da || !db) return null
    return mul(pow(a, b), add(mul(db, fn('ln', a)), div(mul(b, da), a)))
  }

  private dCall(name: string, args: readonly Expr[], depth: number): Expr | null {
    // Funciones sin derivada útil: si no dependen de la variable ya se devolvió 0 arriba.
    if (NO_DERIVATIVE.has(name)) return null
    if (name === 'pow' && args.length === 2) return this.dPow(args[0], args[1], depth)
    if (name === 'atan2' && args.length === 2) {
      const dy = this.d(args[0], depth + 1)
      const dx = dy ? this.d(args[1], depth + 1) : null
      if (!dy || !dx) return null
      const y = args[0]
      const x = args[1]
      return div(sub(mul(x, dy), mul(y, dx)), add(sq(x), sq(y)))
    }
    if (name === 'log' && args.length === 2) {
      const base = args[0]
      const u = args[1]
      // log_b(u) = ln u / ln b
      if (this.depends(base)) return this.d(div(fn('ln', u), fn('ln', base)), depth + 1)
      const du = this.d(u, depth + 1)
      if (!du) return null
      return div(du, mul(u, fn('ln', base)))
    }
    if (name === 'root' && args.length === 2) {
      if (this.depends(args[0])) return null
      // root(n, u) = u^(1/n)
      return this.d(pow(args[1], div(E.one, args[0])), depth + 1)
    }
    if (args.length !== 1) return null
    const u = args[0]
    const du = this.d(u, depth + 1)
    if (!du) return null
    let chain: Expr
    switch (name) {
      case 'sqrt': chain = div(E.one, mul(E.int(2), fn('sqrt', u))); break
      case 'cbrt': chain = div(E.one, mul(E.int(3), sq(fn('cbrt', u)))); break
      case 'abs': chain = div(u, fn('abs', u)); break
      case 'exp': chain = fn('exp', u); break
      case 'ln': chain = div(E.one, u); break
      case 'log': chain = div(E.one, mul(u, fn('ln', E.int(10)))); break
      case 'log10': chain = div(E.one, mul(u, fn('ln', E.int(10)))); break
      case 'log2': chain = div(E.one, mul(u, fn('ln', E.int(2)))); break
      case 'sin': chain = fn('cos', u); break
      case 'cos': chain = neg(fn('sin', u)); break
      case 'tan': chain = sq(fn('sec', u)); break
      case 'sec': chain = mul(fn('sec', u), fn('tan', u)); break
      case 'csc': chain = neg(mul(fn('csc', u), fn('cot', u))); break
      case 'cot': chain = neg(sq(fn('csc', u))); break
      case 'asin': chain = div(E.one, fn('sqrt', sub(E.one, sq(u)))); break
      case 'acos': chain = neg(div(E.one, fn('sqrt', sub(E.one, sq(u))))); break
      case 'atan': chain = div(E.one, add(E.one, sq(u))); break
      case 'acot': chain = neg(div(E.one, add(E.one, sq(u)))); break
      case 'asec': chain = div(E.one, mul(fn('abs', u), fn('sqrt', sub(sq(u), E.one)))); break
      case 'acsc': chain = neg(div(E.one, mul(fn('abs', u), fn('sqrt', sub(sq(u), E.one))))); break
      case 'sinh': chain = fn('cosh', u); break
      case 'cosh': chain = fn('sinh', u); break
      case 'tanh': chain = sub(E.one, sq(fn('tanh', u))); break
      case 'asinh': chain = div(E.one, fn('sqrt', add(sq(u), E.one))); break
      case 'acosh': chain = div(E.one, fn('sqrt', sub(sq(u), E.one))); break
      case 'atanh': chain = div(E.one, sub(E.one, sq(u))); break
      case 'rad': chain = div(E.constant('pi'), E.int(180)); break
      case 'deg': chain = div(E.int(180), E.constant('pi')); break
      default: return null
    }
    return mul(du, chain)
  }
}
