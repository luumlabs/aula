import type { Expr } from '../core/expr'
import { FunctionTable, specAccepts } from '../core/functions'
import { tr } from '../core/i18n'
import { StackGuard } from '../core/stack-guard'
import { constantValue, MathError, MV, type AngleMode, type BinaryOp, type MathValue, type UnaryOp } from '../core/types'
import { Fraction } from '../numbers/fraction'
import { INT_MAX, INT_MIN, absBig } from '../numbers/int64'
import { GreekLetters } from '../parse/greek'
import { Exact } from './exact'
import { Numerics } from './numerics'
import { roundHalfAwayFromZero } from './rounding'
import { isStatistical } from './stat-tables'
import { Statistics } from './statistics'

/** Entorno de evaluación exacta: nombre de variable → valor. */
export type ValueEnv = Readonly<Record<string, MathValue>>
/** Entorno de evaluación rápida: nombre de variable → número. */
export type NumberEnv = Readonly<Record<string, number>>

const MAX_DEPTH = 400

/**
 * Evalúa la expresión. Mantiene la exactitud mientras sea posible: suma, resta, producto, cociente y potencias enteras de
 * racionales siguen siendo `Fraction`; `sqrt(9/4)` da `3/2`; `sin(pi/6)` da `1/2`. Si no es exacto, el resultado es real.
 *
 * En modo `degrees` las funciones trigonométricas reciben y devuelven grados, y el símbolo `°` no cambia el valor.
 */
export function evaluate(e: Expr, env: ValueEnv = {}, angle: AngleMode = 'radians'): MathValue {
  return new ExactEvaluator(env, angle).eval(e, 0)
}

/** Evaluación rápida en `number` (sin exactitud). Mismos dominios y errores que `evaluate`. */
export function evaluateDouble(e: Expr, env: NumberEnv = {}, angle: AngleMode = 'radians'): number {
  return new DoubleEvaluator(env, angle).eval(e, 0)
}

/** Evalúa y devuelve `null` en vez de lanzar. */
export function tryEvaluate(e: Expr, env: ValueEnv = {}, angle: AngleMode = 'radians'): MathValue | null {
  try {
    return evaluate(e, env, angle)
  } catch {
    return null
  }
}

/** Evalúa en `number` y devuelve `null` en vez de lanzar. */
export function tryEvaluateDouble(e: Expr, env: NumberEnv = {}, angle: AngleMode = 'radians'): number | null {
  try {
    return evaluateDouble(e, env, angle)
  } catch {
    return null
  }
}

const INTEGER_VALUED = new Set(['floor', 'ceil', 'trunc', 'sign', 'fact', 'nCr', 'nPr', 'gcd', 'lcm'])
const TRIG_NAMES = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot'])

function missingVariable(name: string): MathError {
  return new MathError('unknownVariable', tr('Falta el valor de la variable «%@»', name))
}

function unknownFunction(name: string): MathError {
  return new MathError('unknownFunction', tr('No conozco la función «%@»', name))
}

function badArity(name: string, count: number): MathError {
  return new MathError('syntax', tr('«%@» recibió %lld argumento(s) y no los admite', name, count))
}

// MARK: - Evaluador exacto

class ExactEvaluator {
  constructor(
    readonly env: ValueEnv,
    readonly angle: AngleMode,
  ) {}

  eval(e: Expr, depth: number): MathValue {
    if (depth > MAX_DEPTH) throw StackGuard.error()
    switch (e.type) {
      case 'number':
        return MV.rational(e.value)
      case 'real':
        return MV.real(e.value)
      case 'variable': {
        // también vale el otro nombre de la misma letra griega (θ ↔ theta)
        const v = GreekLetters.lookup(e.name, this.env)
        if (v === undefined) throw missingVariable(e.name)
        return v
      }
      case 'constant':
        return MV.real(constantValue(e.name))
      case 'unary':
        return this.unary(e.op, this.eval(e.arg, depth + 1))
      case 'binary':
        return this.binary(e.op, this.eval(e.left, depth + 1), this.eval(e.right, depth + 1))
      case 'call':
        return this.call(e.name, e.args, depth)
    }
  }

  // MARK: Operadores

  private unary(op: UnaryOp, v: MathValue): MathValue {
    switch (op) {
      case 'plus':
        return v
      case 'neg': {
        if (v.kind === 'rational') {
          const n = v.value.negated()
          if (n) return MV.rational(n)
        }
        return MV.real(-MV.double(v))
      }
      case 'percent': {
        if (v.kind === 'rational') {
          const r = v.value.divided(Fraction.int(100))
          if (r) return MV.rational(r)
        }
        return MV.real(MV.double(v) / 100)
      }
      case 'degree':
        if (this.angle === 'degrees') return v
        if (v.kind === 'rational' && v.value.isZero) return v
        return MV.real((MV.double(v) * Math.PI) / 180)
      case 'factorial':
        return this.callValues('fact', [v])
    }
  }

  private realResult(r: number, a: number, b: number): MathValue {
    return MV.real(Numerics.finite(r, Number.isFinite(a) && Number.isFinite(b)))
  }

  private binary(op: BinaryOp, a: MathValue, b: MathValue): MathValue {
    switch (op) {
      case 'add': {
        if (a.kind === 'rational' && b.kind === 'rational') {
          const r = a.value.adding(b.value)
          if (r) return MV.rational(r)
        }
        const x = MV.double(a)
        const y = MV.double(b)
        return this.realResult(x + y, x, y)
      }
      case 'sub': {
        if (a.kind === 'rational' && b.kind === 'rational') {
          const r = a.value.subtracting(b.value)
          if (r) return MV.rational(r)
        }
        const x = MV.double(a)
        const y = MV.double(b)
        return this.realResult(x - y, x, y)
      }
      case 'mul': {
        if (a.kind === 'rational' && b.kind === 'rational') {
          const r = a.value.multiplied(b.value)
          if (r) return MV.rational(r)
        }
        const x = MV.double(a)
        const y = MV.double(b)
        return this.realResult(x * y, x, y)
      }
      case 'div': {
        if (MV.double(b) === 0) throw Numerics.domain(tr('No se puede dividir entre cero'))
        if (a.kind === 'rational' && b.kind === 'rational') {
          const r = a.value.divided(b.value)
          if (r) return MV.rational(r)
        }
        const x = MV.double(a)
        const y = MV.double(b)
        return this.realResult(x / y, x, y)
      }
      case 'pow':
        return this.power(a, b)
      case 'mod':
        return this.callValues('mod', [a, b])
    }
  }

  // MARK: Potencias y raíces exactas

  power(a: MathValue, b: MathValue): MathValue {
    // x^0 = 1 (e^0 es exacto aunque e sea real); 0^0 sigue siendo indeterminado
    const ad = MV.double(a)
    if (b.kind === 'rational' && b.value.isZero && ad !== 0 && !Number.isNaN(ad)) return MV.int(1)
    if (a.kind === 'rational' && b.kind === 'rational') {
      const x = a.value
      const y = b.value
      if (y.isInteger) {
        const e = y.num
        if (x.isZero) {
          if (e === 0n) throw Numerics.domain(tr('0^0 es indeterminado'))
          if (e < 0n) throw Numerics.domain(tr('No se puede dividir entre cero'))
          return MV.int(0)
        }
        const r = x.power(e)
        if (r) return MV.rational(r)
        return MV.real(Numerics.power(x.doubleValue, Number(e)))
      }
      // exponente fraccionario p/q
      if (x.isNegative && y.den % 2n === 0n) {
        throw Numerics.domain(tr('La raíz de índice par de un número negativo no es real'))
      }
      if (x.isZero) {
        if (y.isNegative) throw Numerics.domain(tr('No se puede dividir entre cero'))
        return MV.int(0)
      }
      const r = Exact.root(x, y.num, y.den)
      if (r) return MV.rational(r)
    }
    return MV.real(Numerics.power(ad, MV.double(b)))
  }

  // MARK: Llamadas a funciones

  private call(name: string, args: readonly Expr[], depth: number): MathValue {
    const spec = FunctionTable.specs.get(name)
    if (!spec) throw unknownFunction(name)
    if (!specAccepts(spec, args.length)) throw badArity(name, args.length)
    const values = args.map((a) => this.eval(a, depth + 1))
    if (TRIG_NAMES.has(name)) {
      const q = this.angleInHalfTurns(args[0], values[0])
      if (q) return this.exactTrig(name, q)
    }
    return this.callValues(name, values)
  }

  callValues(name: string, v: readonly MathValue[]): MathValue {
    // estadística: exacta con racionales cuando se puede; si no, en number (más abajo)
    if (isStatistical(name)) {
      const r = Statistics.exact(name, v)
      if (r) return r
    }
    const allRational = (): Fraction[] | null => {
      const out: Fraction[] = []
      for (const x of v) {
        if (x.kind !== 'rational') return null
        out.push(x.value)
      }
      return out
    }
    const v0 = v[0]
    switch (name) {
      case 'sqrt':
        if (v0.kind === 'rational') {
          if (v0.value.isNegative) throw Numerics.domain(tr('No existe la raíz cuadrada (real) de un número negativo'))
          const r = Exact.root(v0.value, 1n, 2n)
          if (r) return MV.rational(r)
        }
        break
      case 'cbrt':
        if (v0.kind === 'rational') {
          const r = Exact.root(v0.value, 1n, 3n)
          if (r) return MV.rational(r)
        }
        break
      case 'root': {
        const v1 = v[1]
        if (v0.kind === 'rational' && v1.kind === 'rational' && v0.value.isInteger && v0.value.num !== 0n) {
          const k = v0.value.num
          const q = v1.value
          if (q.isNegative && k % 2n === 0n) throw Numerics.domain(tr('La raíz de índice par de un número negativo no es real'))
          if (k === 1n) return v1
          if (k >= 2n) {
            const r = Exact.root(q, 1n, k)
            if (r) return MV.rational(r)
          }
          if (k <= -1n && !q.isZero) {
            const r = Exact.root(q, 1n, -k)
            const inv = r ? r.reciprocal() : null
            if (inv) return MV.rational(inv)
          }
        }
        break
      }
      case 'abs':
        if (v0.kind === 'rational') {
          const a = v0.value.absolute()
          if (a) return MV.rational(a)
        }
        break
      case 'exp':
        if (v0.kind === 'rational' && v0.value.isZero) return MV.int(1)
        break
      case 'ln':
        if (v0.kind === 'rational' && v0.value.equals(Fraction.ONE)) return MV.int(0)
        break
      case 'log':
      case 'log2':
      case 'log10': {
        let base: Fraction | null
        let arg: Fraction | null
        if (name === 'log' && v.length === 2) {
          base = MV.fraction(v[0])
          arg = MV.fraction(v[1])
        } else {
          base = Fraction.int(name === 'log2' ? 2 : 10)
          arg = MV.fraction(v[0])
        }
        if (base && arg) {
          const r = Exact.log(base, arg)
          if (r) return MV.rational(r)
        }
        break
      }
      case 'floor':
      case 'ceil':
      case 'trunc':
      case 'sign':
        if (v0.kind === 'rational') {
          const q = v0.value
          switch (name) {
            case 'floor':
              return MV.int(q.floorInt())
            case 'ceil':
              return MV.int(q.ceilInt())
            case 'trunc':
              return MV.int(q.isNegative ? q.ceilInt() : q.floorInt())
            default:
              return MV.int(q.sign)
          }
        }
        break
      case 'round': {
        const qs = allRational()
        if (qs) {
          if (qs.length === 1) {
            const r = Exact.roundHalfAway(qs[0])
            if (r >= INT_MIN && r <= INT_MAX) return MV.int(r)
          } else if (qs[1].isInteger) {
            const r = Exact.round(qs[0], qs[1].num)
            if (r) return MV.rational(r)
          }
        }
        break
      }
      case 'min':
      case 'max': {
        const qs = allRational()
        if (qs && qs.length > 0) {
          let best = qs[0]
          for (const q of qs.slice(1)) if (name === 'min' ? q.lt(best) : q.gt(best)) best = q
          return MV.rational(best)
        }
        // mezcla de racionales y reales: se devuelve el valor ganador tal cual
        let best = v[0]
        for (const x of v.slice(1)) if (name === 'min' ? MV.double(x) < MV.double(best) : MV.double(x) > MV.double(best)) best = x
        return best
      }
      case 'gcd':
      case 'lcm': {
        const qs = allRational()
        if (qs && qs.every((q) => q.isInteger)) {
          let acc = qs[0].num
          let ok = true
          for (const q of qs.slice(1)) {
            const n = q.num
            if (name === 'gcd') {
              acc = Numerics.gcd(acc, n)
              continue
            }
            if (acc === 0n || n === 0n) {
              acc = 0n
              continue
            }
            const g = Numerics.gcd(acc, n)
            const m = (acc / g) * n
            if (m > INT_MAX || m < INT_MIN || m === INT_MIN) {
              ok = false
              break
            }
            acc = m
          }
          if (ok && acc !== INT_MIN) return MV.int(absBig(acc))
        }
        break
      }
      case 'fact':
        if (v0.kind === 'rational' && v0.value.isInteger && v0.value.num >= 0n && v0.value.num <= 20n) {
          let r = 1n
          for (let i = 2n; i <= v0.value.num; i++) r *= i
          return MV.int(r)
        }
        break
      case 'nCr': {
        const qs = allRational()
        if (qs && qs.every((q) => q.isInteger)) {
          const r = Exact.combinations(qs[0].num, qs[1].num)
          if (r !== null) return MV.int(r)
        }
        break
      }
      case 'nPr': {
        const qs = allRational()
        if (qs && qs.every((q) => q.isInteger)) {
          const r = Exact.permutations(qs[0].num, qs[1].num)
          if (r !== null) return MV.int(r)
        }
        break
      }
      case 'mod': {
        const v1 = v[1]
        if (v0.kind === 'rational' && v1.kind === 'rational') {
          const a = v0.value
          const b = v1.value
          if (b.isZero) throw Numerics.domain(tr('No se puede calcular el módulo con divisor 0'))
          const q = a.divided(b)
          const fl = q ? q.floorInt() : null
          const prod = fl !== null && fl >= INT_MIN && fl <= INT_MAX ? b.multiplied(Fraction.int(fl)) : null
          const r = prod ? a.subtracting(prod) : null
          if (r) return MV.rational(r)
        }
        break
      }
      case 'pow':
        return this.power(v[0], v[1])
      case 'rad':
      case 'deg':
        if (v0.kind === 'rational' && v0.value.isZero) return v0
        break
      default:
        break
    }
    // Respaldo numérico
    const result = Numerics.apply(name, v.map(MV.double), this.angle)
    if ((INTEGER_VALUED.has(name) || (name === 'round' && v.length === 1)) && result === roundHalfAwayFromZero(result) && Math.abs(result) < 9e15) {
      return MV.int(BigInt(result))
    }
    return MV.real(result)
  }

  // MARK: Trigonometría exacta en múltiplos de π

  /** Ángulo como múltiplo racional de media vuelta (θ = q·π rad) cuando se puede saber con exactitud. */
  private angleInHalfTurns(arg: Expr, value: MathValue): Fraction | null {
    if (this.angle === 'degrees') {
      if (value.kind === 'rational') return value.value.divided(Fraction.int(180))
      return null
    }
    if (value.kind === 'rational' && value.value.isZero) return Fraction.ZERO
    const lin = this.linearInPi(arg)
    if (!lin || !lin.a.isZero) return null
    return lin.b
  }

  /** Escribe la expresión como `a + b·π` con a, b racionales; `null` si no tiene esa forma. */
  private linearInPi(e: Expr): { a: Fraction; b: Fraction } | null {
    switch (e.type) {
      case 'number':
        return { a: e.value, b: Fraction.ZERO }
      case 'variable': {
        const v = GreekLetters.lookup(e.name, this.env)
        if (v && v.kind === 'rational') return { a: v.value, b: Fraction.ZERO }
        return null
      }
      case 'constant':
        if (e.name === 'pi') return { a: Fraction.ZERO, b: Fraction.ONE }
        if (e.name === 'tau') return { a: Fraction.ZERO, b: Fraction.int(2) }
        return null
      case 'unary': {
        const l = e.op === 'plus' || e.op === 'neg' || e.op === 'percent' || e.op === 'degree' ? this.linearInPi(e.arg) : null
        if (!l) return null
        switch (e.op) {
          case 'plus':
            return l
          case 'neg': {
            const a = l.a.negated()
            const b = l.b.negated()
            return a && b ? { a, b } : null
          }
          case 'percent': {
            const a = l.a.divided(Fraction.int(100))
            const b = l.b.divided(Fraction.int(100))
            return a && b ? { a, b } : null
          }
          case 'degree': {
            if (!l.b.isZero) return null
            const c = l.a.divided(Fraction.int(180))
            return c ? { a: Fraction.ZERO, b: c } : null
          }
          default:
            return null
        }
      }
      case 'binary': {
        if (e.op !== 'add' && e.op !== 'sub' && e.op !== 'mul' && e.op !== 'div') return null
        const l = this.linearInPi(e.left)
        if (!l) return null
        const r = this.linearInPi(e.right)
        if (!r) return null
        switch (e.op) {
          case 'add': {
            const a = l.a.adding(r.a)
            const b = l.b.adding(r.b)
            return a && b ? { a, b } : null
          }
          case 'sub': {
            const a = l.a.subtracting(r.a)
            const b = l.b.subtracting(r.b)
            return a && b ? { a, b } : null
          }
          case 'mul': {
            if (r.b.isZero) {
              const a = l.a.multiplied(r.a)
              const b = l.b.multiplied(r.a)
              if (a && b) return { a, b }
            }
            if (l.b.isZero) {
              const a = r.a.multiplied(l.a)
              const b = r.b.multiplied(l.a)
              if (a && b) return { a, b }
            }
            return null
          }
          case 'div': {
            if (!r.b.isZero || r.a.isZero) return null
            const a = l.a.divided(r.a)
            const b = l.b.divided(r.a)
            return a && b ? { a, b } : null
          }
        }
        return null
      }
      default:
        return null
    }
  }

  /** Trigonometría de θ = q·π: valores racionales exactos en los ángulos notables; el resto, con redondeo mínimo. */
  private exactTrig(name: string, q: Fraction): MathValue {
    // grados como fracción exacta, reducidos a [0, 360)
    const degFrac = q.multiplied(Fraction.int(180))
    if (!degFrac) return this.fallbackTrig(name, q.doubleValue * 180)
    const whole = degFrac.floorInt()
    const frac = degFrac.subtracting(Fraction.int(whole)) ?? Fraction.ZERO
    const reduced = Fraction.int(((whole % 360n) + 360n) % 360n).adding(frac) ?? Fraction.ZERO
    if (reduced.isInteger) {
      const d = Number(reduced.num)
      const half = MV.rational(Fraction.of(1, 2) as Fraction)
      const minusHalf = MV.rational(Fraction.of(-1, 2) as Fraction)
      const r = (n: number): MathValue => MV.int(n)
      switch (name) {
        case 'sin':
          switch (d) {
            case 0: case 180: return r(0)
            case 90: return r(1)
            case 270: return r(-1)
            case 30: case 150: return half
            case 210: case 330: return minusHalf
          }
          break
        case 'cos':
          switch (d) {
            case 0: return r(1)
            case 180: return r(-1)
            case 90: case 270: return r(0)
            case 60: case 300: return half
            case 120: case 240: return minusHalf
          }
          break
        case 'tan':
          switch (d) {
            case 0: case 180: return r(0)
            case 45: case 225: return r(1)
            case 135: case 315: return r(-1)
            case 90: case 270: throw Numerics.domain(tr('La tangente no está definida en ese ángulo'))
          }
          break
        case 'sec':
          switch (d) {
            case 0: return r(1)
            case 180: return r(-1)
            case 60: case 300: return r(2)
            case 120: case 240: return r(-2)
            case 90: case 270: throw Numerics.domain(tr('La secante no está definida en ese ángulo'))
          }
          break
        case 'csc':
          switch (d) {
            case 90: return r(1)
            case 270: return r(-1)
            case 30: case 150: return r(2)
            case 210: case 330: return r(-2)
            case 0: case 180: throw Numerics.domain(tr('La cosecante no está definida en ese ángulo'))
          }
          break
        case 'cot':
          switch (d) {
            case 90: case 270: return r(0)
            case 45: case 225: return r(1)
            case 135: case 315: return r(-1)
            case 0: case 180: throw Numerics.domain(tr('La cotangente no está definida en ese ángulo'))
          }
          break
      }
    }
    return this.fallbackTrig(name, reduced.doubleValue)
  }

  private fallbackTrig(name: string, degrees: number): MathValue {
    return MV.real(Numerics.apply(name, [degrees], 'degrees'))
  }
}

// MARK: - Evaluador en number

class DoubleEvaluator {
  constructor(
    readonly env: NumberEnv,
    readonly angle: AngleMode,
  ) {}

  eval(e: Expr, depth: number): number {
    if (depth > MAX_DEPTH) throw StackGuard.error()
    switch (e.type) {
      case 'number':
        return e.value.doubleValue
      case 'real':
        return e.value
      case 'variable': {
        const v = GreekLetters.lookup(e.name, this.env)
        if (v === undefined) throw missingVariable(e.name)
        return v
      }
      case 'constant':
        return constantValue(e.name)
      case 'unary': {
        const x = this.eval(e.arg, depth + 1)
        switch (e.op) {
          case 'plus':
            return x
          case 'neg':
            return -x
          case 'percent':
            return x / 100
          case 'degree':
            return this.angle === 'degrees' ? x : (x * Math.PI) / 180
          case 'factorial':
            return Numerics.factorial(x)
        }
        break
      }
      case 'binary': {
        const x = this.eval(e.left, depth + 1)
        const y = this.eval(e.right, depth + 1)
        const fin = Number.isFinite(x) && Number.isFinite(y)
        switch (e.op) {
          case 'add':
            return Numerics.finite(x + y, fin)
          case 'sub':
            return Numerics.finite(x - y, fin)
          case 'mul':
            return Numerics.finite(x * y, fin)
          case 'div':
            if (y === 0) throw Numerics.domain(tr('No se puede dividir entre cero'))
            return Numerics.finite(x / y, fin)
          case 'pow':
            return Numerics.power(x, y)
          case 'mod':
            return Numerics.mod(x, y)
        }
        break
      }
      case 'call': {
        const spec = FunctionTable.specs.get(e.name)
        if (!spec) throw unknownFunction(e.name)
        if (!specAccepts(spec, e.args.length)) throw badArity(e.name, e.args.length)
        const values: number[] = []
        for (const a of e.args) values.push(this.eval(a, depth + 1))
        return Numerics.apply(e.name, values, this.angle)
      }
    }
    return NaN
  }
}
