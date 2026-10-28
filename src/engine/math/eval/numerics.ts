import { tr } from '../core/i18n'
import { MathError, type AngleMode } from '../core/types'
import { DecimalDigits } from '../format/decimal-digits'
import { NumberFormat } from '../format/number-format'
import { INT_MAX, INT_MIN, absBig, gcdBig } from '../numbers/int64'
import { roundHalfAwayFromZero, swiftPow } from './rounding'
import { isStatistical } from './stat-tables'
import { Statistics } from './statistics'

/** Si |cos| o |sin| es menor que esto, la tangente/secante/cosecante/cotangente se consideran indefinidas. */
const POLE_EPS = 1e-12

function nz(v: number): number {
  return v === 0 ? 0 : v
}

/**
 * Implementación numérica (en `number`) de todas las funciones y operadores, con dominios comprobados y mensajes de
 * error para el estudiante (localizados).
 */
export const Numerics = {
  poleEps: POLE_EPS,

  // MARK: Errores

  domain(message: string): MathError {
    return new MathError('domain', message)
  },

  overflow(message?: string): MathError {
    return new MathError('overflow', message ?? tr('El resultado es demasiado grande'))
  },

  /** Texto breve de un número para los mensajes de error. */
  short(x: number): string {
    return NumberFormat.decimal(x)
  },

  /** Comprueba que el resultado de una operación entre números finitos es finito. */
  finite(r: number, inputsFinite = true): number {
    if (Number.isNaN(r)) throw Numerics.domain(tr('La operación no está definida'))
    if (!Number.isFinite(r) && inputsFinite) throw Numerics.overflow()
    return r
  },

  // MARK: Ángulos

  toRadians(x: number, mode: AngleMode): number {
    return mode === 'degrees' ? (x * Math.PI) / 180 : x
  },

  fromRadians(x: number, mode: AngleMode): number {
    return mode === 'degrees' ? (x * 180) / Math.PI : x
  },

  /** Seno y coseno con ángulos en grados, exactos en los ángulos notables (0, 30, 45, 60, 90…). */
  sinCosDegrees(x: number): { sin: number; cos: number } {
    if (!Number.isFinite(x)) return { sin: NaN, cos: NaN }
    let r = x % 360
    if (r < 0) r += 360
    // cuadrante y ángulo de referencia
    const quadrant = Math.trunc(r / 90) % 4
    const ref = r - quadrant * 90 // 0 ≤ ref < 90
    let s0: number
    let c0: number
    if (ref === 0) {
      s0 = 0
      c0 = 1
    } else if (ref === 30) {
      s0 = 0.5
      c0 = Math.sqrt(3) / 2
    } else if (ref === 45) {
      s0 = Math.sqrt(0.5)
      c0 = Math.sqrt(0.5)
    } else if (ref === 60) {
      s0 = Math.sqrt(3) / 2
      c0 = 0.5
    } else {
      const t = (ref * Math.PI) / 180
      s0 = Math.sin(t)
      c0 = Math.cos(t)
    }
    // rotación por cuadrantes: (sin, cos) de ref + 90·q  (se evita el cero negativo)
    switch (quadrant) {
      case 0:
        return { sin: nz(s0), cos: nz(c0) }
      case 1:
        return { sin: nz(c0), cos: nz(-s0) }
      case 2:
        return { sin: nz(-s0), cos: nz(-c0) }
      default:
        return { sin: nz(-c0), cos: nz(s0) }
    }
  },

  sinValue(x: number, mode: AngleMode): number {
    return mode === 'degrees' ? Numerics.sinCosDegrees(x).sin : Math.sin(x)
  },

  cosValue(x: number, mode: AngleMode): number {
    return mode === 'degrees' ? Numerics.sinCosDegrees(x).cos : Math.cos(x)
  },

  // MARK: Potencias

  /** `a^b` con raíces impares de negativos permitidas (`(-8)^(1/3) = -2`). */
  power(a: number, b: number): number {
    if (Number.isNaN(a) || Number.isNaN(b)) throw Numerics.domain(tr('La operación no está definida'))
    if (a === 0) {
      if (b === 0) throw Numerics.domain(tr('0^0 es indeterminado'))
      if (b < 0) throw Numerics.domain(tr('No se puede dividir entre cero'))
      return 0
    }
    if (a < 0 && b !== Math.round(b) && Number.isFinite(b)) {
      // exponente racional con denominador impar → raíz real
      const sr = Numerics.smallRational(b)
      if (sr && sr[1] % 2 === 1) {
        const magnitude = Math.pow(-a, b)
        const r = sr[0] % 2 === 0 ? magnitude : -magnitude
        return Numerics.finite(r, Number.isFinite(a) && Number.isFinite(b))
      }
      throw Numerics.domain(tr('Esa potencia no es un número real (base negativa con exponente fraccionario)'))
    }
    const r = swiftPow(a, b)
    return Numerics.finite(r, Number.isFinite(a) && Number.isFinite(b))
  },

  /** Si `x` es (muy aproximadamente) `p/q` con `q` ≤ 99, devuelve `[p, q]`. */
  smallRational(x: number): [number, number] | null {
    if (!Number.isFinite(x) || Math.abs(x) >= 1e6) return null
    for (let q = 1; q <= 99; q++) {
      const p = roundHalfAwayFromZero(x * q)
      if (Math.abs(x - p / q) < 1e-12 * Math.max(1, Math.abs(x))) return [p, q]
    }
    return null
  },

  // MARK: Factorial y combinatoria

  /** Entero o error de dominio con `message` (frase completa; solo se calcula si hace falta). */
  requireInteger(x: number, message: () => string): number {
    if (!Number.isFinite(x) || x !== Math.round(x) || Math.abs(x) >= 9e15) throw Numerics.domain(message())
    return x
  },

  /** «nCr solo está definido para números enteros» (el nombre de la función no se traduce). */
  integerOnly(fn: string): string {
    return tr('%@ solo está definido para números enteros', fn)
  },

  factorial(x: number): number {
    const n = Numerics.requireInteger(x, () => tr('El factorial solo está definido para números enteros'))
    if (n < 0) throw Numerics.domain(tr('El factorial no está definido para números negativos'))
    if (n > 170) throw Numerics.overflow(tr('El factorial de %@ es demasiado grande', String(n)))
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
  },

  combinations(nx: number, kx: number): number {
    const n = Numerics.requireInteger(nx, () => Numerics.integerOnly('nCr'))
    const k = Numerics.requireInteger(kx, () => Numerics.integerOnly('nCr'))
    if (n < 0 || k < 0) throw Numerics.domain(tr('nCr necesita números no negativos'))
    if (k > n) return 0
    const kk = Math.min(k, n - k)
    let r = 1
    for (let i = 1; i <= kk; i++) {
      r = (r * (n - kk + i)) / i
      if (!Number.isFinite(r)) throw Numerics.overflow(tr('El resultado de nCr es demasiado grande'))
    }
    return Math.round(r)
  },

  permutations(nx: number, kx: number): number {
    const n = Numerics.requireInteger(nx, () => Numerics.integerOnly('nPr'))
    const k = Numerics.requireInteger(kx, () => Numerics.integerOnly('nPr'))
    if (n < 0 || k < 0) throw Numerics.domain(tr('nPr necesita números no negativos'))
    if (k > n) return 0
    let r = 1
    for (let i = 0; i < k; i++) {
      r *= n - i
      if (!Number.isFinite(r)) throw Numerics.overflow(tr('El resultado de nPr es demasiado grande'))
    }
    return r
  },

  /** Máximo común divisor (con la semántica de `Int` de Swift). */
  gcd(a: bigint, b: bigint): bigint {
    const g = gcdBig(a, b)
    return g > INT_MAX ? INT_MIN : g // 2^63 no cabe: `Int(truncatingIfNeeded:)`
  },

  /** Módulo con el signo del divisor (`-7 mod 3 = 2`). */
  mod(a: number, b: number): number {
    if (b === 0) throw Numerics.domain(tr('No se puede calcular el módulo con divisor 0'))
    let r = a % b
    if (r !== 0 && r < 0 !== b < 0) r += b
    return r
  },

  // MARK: Logaritmos

  log(b: number, x: number): number {
    if (!(b > 0) || b === 1) throw Numerics.domain(tr('La base del logaritmo debe ser positiva y distinta de 1'))
    if (!(x > 0)) throw Numerics.domain(tr('El logaritmo solo existe para números positivos'))
    let r: number
    if (b === 2) r = Math.log2(x)
    else if (b === 10) r = Math.log10(x)
    else r = Math.log(x) / Math.log(b)
    // Ajuste a enteros cuando el resultado está dentro del error de redondeo (log₂ 8 = 3, no 2.9999999999999996)
    const rr = roundHalfAwayFromZero(r)
    if (Math.abs(r - rr) < 1e-13 * Math.max(1, Math.abs(rr)) && Math.abs(rr) < 1000 && swiftPow(b, rr) !== 0 && Math.abs(swiftPow(b, rr) - x) <= 1e-13 * Math.abs(x)) return rr
    return r
  },

  // MARK: Raíces

  root(n: number, x: number): number {
    if (!Number.isFinite(n) || n === 0) throw Numerics.domain(tr('El índice de la raíz no puede ser 0'))
    const ni = Math.round(n)
    if (n === ni) {
      if (n === 2) return Numerics.sqrtChecked(x)
      if (n === 3) return Math.cbrt(x)
      if (x < 0) {
        if (n % 2 === 0) throw Numerics.domain(tr('La raíz de índice par de un número negativo no es real'))
        return -rootPositive(n, -x)
      }
      return rootPositive(n, x)
    }
    if (x < 0) throw Numerics.domain(tr('La raíz de un número negativo no es real'))
    return rootPositive(n, x)
  },

  sqrtChecked(x: number): number {
    if (x < 0) throw Numerics.domain(tr('No existe la raíz cuadrada (real) de un número negativo'))
    return Math.sqrt(x)
  },

  // MARK: Función por nombre

  /** Aplica una función (nombre canónico) a argumentos reales. */
  apply(name: string, a: readonly number[], angle: AngleMode): number {
    if (isStatistical(name)) return Statistics.apply(name, a)
    const inputsFinite = a.every((v) => Number.isFinite(v))
    switch (name) {
      case 'sqrt': return Numerics.sqrtChecked(a[0])
      case 'cbrt': return Math.cbrt(a[0])
      case 'root': return Numerics.root(a[0], a[1])
      case 'abs': return Math.abs(a[0])
      case 'exp': return Numerics.finite(Math.exp(a[0]), Number.isFinite(a[0]))
      case 'ln':
        if (!(a[0] > 0)) throw Numerics.domain(tr('El logaritmo solo existe para números positivos'))
        return Math.log(a[0])
      case 'log':
        if (a.length === 2) return Numerics.log(a[0], a[1])
        return Numerics.log(10, a[0])
      case 'log10': return Numerics.log(10, a[0])
      case 'log2': return Numerics.log(2, a[0])

      case 'sin': return Numerics.finite(Numerics.sinValue(a[0], angle))
      case 'cos': return Numerics.finite(Numerics.cosValue(a[0], angle))
      case 'tan': {
        const c = Numerics.cosValue(a[0], angle)
        if (Math.abs(c) < POLE_EPS) throw Numerics.domain(tr('La tangente no está definida en ese ángulo'))
        return Numerics.finite(Numerics.sinValue(a[0], angle) / c)
      }
      case 'sec': {
        const c = Numerics.cosValue(a[0], angle)
        if (Math.abs(c) < POLE_EPS) throw Numerics.domain(tr('La secante no está definida en ese ángulo'))
        return Numerics.finite(1 / c)
      }
      case 'csc': {
        const s = Numerics.sinValue(a[0], angle)
        if (Math.abs(s) < POLE_EPS) throw Numerics.domain(tr('La cosecante no está definida en ese ángulo'))
        return Numerics.finite(1 / s)
      }
      case 'cot': {
        const s = Numerics.sinValue(a[0], angle)
        if (Math.abs(s) < POLE_EPS) throw Numerics.domain(tr('La cotangente no está definida en ese ángulo'))
        return Numerics.finite(Numerics.cosValue(a[0], angle) / s)
      }
      case 'asin':
        if (!(Math.abs(a[0]) <= 1 + 1e-12)) throw Numerics.domain(tr('El arcoseno solo existe para valores entre -1 y 1'))
        return Numerics.fromRadians(Math.asin(Math.max(-1, Math.min(1, a[0]))), angle)
      case 'acos':
        if (!(Math.abs(a[0]) <= 1 + 1e-12)) throw Numerics.domain(tr('El arcocoseno solo existe para valores entre -1 y 1'))
        return Numerics.fromRadians(Math.acos(Math.max(-1, Math.min(1, a[0]))), angle)
      case 'atan': return Numerics.fromRadians(Math.atan(a[0]), angle)
      case 'atan2':
        if (a[0] === 0 && a[1] === 0) throw Numerics.domain(tr('atan2(0, 0) no está definido'))
        return Numerics.fromRadians(Math.atan2(a[0], a[1]), angle)
      case 'asec':
        if (!(Math.abs(a[0]) >= 1 - 1e-12)) throw Numerics.domain(tr('El arcosecante solo existe para |x| ≥ 1'))
        return Numerics.fromRadians(Math.acos(Math.max(-1, Math.min(1, 1 / a[0]))), angle)
      case 'acsc':
        if (!(Math.abs(a[0]) >= 1 - 1e-12)) throw Numerics.domain(tr('El arcocosecante solo existe para |x| ≥ 1'))
        return Numerics.fromRadians(Math.asin(Math.max(-1, Math.min(1, 1 / a[0]))), angle)
      case 'acot': return Numerics.fromRadians(Math.PI / 2 - Math.atan(a[0]), angle)

      case 'sinh': return Numerics.finite(Math.sinh(a[0]), inputsFinite)
      case 'cosh': return Numerics.finite(Math.cosh(a[0]), inputsFinite)
      case 'tanh': return Math.tanh(a[0])
      case 'asinh': return Math.asinh(a[0])
      case 'acosh':
        if (!(a[0] >= 1)) throw Numerics.domain(tr('acosh solo existe para x ≥ 1'))
        return Math.acosh(a[0])
      case 'atanh':
        if (!(Math.abs(a[0]) < 1)) throw Numerics.domain(tr('atanh solo existe para |x| < 1'))
        return Math.atanh(a[0])

      case 'floor': return Math.floor(a[0])
      case 'ceil': return Math.ceil(a[0])
      case 'trunc': return Math.trunc(a[0])
      case 'sign': return a[0] > 0 ? 1 : a[0] < 0 ? -1 : 0
      case 'round':
        if (a.length === 2) {
          const places = Numerics.requireInteger(a[1], () => tr('El número de decimales solo está definido para números enteros'))
          return Numerics.roundHalfUp(a[0], places)
        }
        return roundHalfAwayFromZero(a[0])
      case 'min': return a.length === 0 ? NaN : swiftMin(a)
      case 'max': return a.length === 0 ? NaN : swiftMax(a)
      case 'gcd':
      case 'lcm': {
        let acc = BigInt(Numerics.requireInteger(a[0], () => Numerics.integerOnly(name)))
        for (const v of a.slice(1)) {
          const n = BigInt(Numerics.requireInteger(v, () => Numerics.integerOnly(name)))
          if (name === 'gcd') {
            acc = Numerics.gcd(acc, n)
          } else {
            if (acc === 0n || n === 0n) {
              acc = 0n
              continue
            }
            const g = Numerics.gcd(acc, n)
            const m = (acc / g) * n
            if (m > INT_MAX || m < INT_MIN) throw Numerics.overflow(tr('El mínimo común múltiplo es demasiado grande'))
            acc = m
          }
        }
        return Number(absBig(acc))
      }
      case 'fact': return Numerics.factorial(a[0])
      case 'nCr': return Numerics.combinations(a[0], a[1])
      case 'nPr': return Numerics.permutations(a[0], a[1])
      case 'mod': return Numerics.mod(a[0], a[1])
      case 'pow': return Numerics.power(a[0], a[1])
      case 'rad': return (a[0] * Math.PI) / 180
      case 'deg': return (a[0] * 180) / Math.PI
      default:
        throw new MathError('unknownFunction', tr('No conozco la función «%@»', name))
    }
  },

  /** Redondeo «escolar» (mitad hacia arriba en valor absoluto) a `places` decimales, sobre la representación decimal más corta. */
  roundHalfUp(x: number, places: number): number {
    const d = DecimalDigits.fromDouble(x)
    if (!d) return x
    d.roundToPlaces(places)
    return d.doubleValue
  },
}

function rootPositive(n: number, x: number): number {
  if (x === 0) {
    if (n < 0) throw Numerics.domain(tr('No se puede dividir entre cero'))
    return 0
  }
  const r = swiftPow(x, 1 / n)
  const rr = roundHalfAwayFromZero(r)
  if (n === Math.round(n) && Math.abs(r - rr) < 1e-12 * Math.max(1, Math.abs(rr)) && swiftPow(rr, n) === x) return rr
  return Numerics.finite(r)
}

// `Array.min()` / `max()` de Swift (NaN no gana nunca a un número: compara con `<`).
function swiftMin(a: readonly number[]): number {
  let best = a[0]
  for (const v of a.slice(1)) if (v < best) best = v
  return best
}

function swiftMax(a: readonly number[]): number {
  let best = a[0]
  for (const v of a.slice(1)) if (v > best) best = v
  return best
}

export { roundHalfAwayFromZero, swiftPow }
