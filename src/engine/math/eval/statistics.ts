import { tr } from '../core/i18n'
import { MathError, MV, type MathValue } from '../core/types'
import { Fraction } from '../numbers/fraction'
import { NumberInput } from '../parse/number-input'
import { Exact } from './exact'
import { erfc, lgamma } from './special'

function domain(message: string): MathError {
  return new MathError('domain', message)
}

const SQRT2 = Math.SQRT2
const SQRT_2PI = Math.sqrt(2 * Math.PI)

/**
 * Estadística con los nombres de las calculadoras TI (los que usan los profesores):
 *
 * - Descriptiva sobre la lista de argumentos: `sum`, `mean`, `median`, `mode` (si es única), `var`/`stdev` (muestrales,
 *   n − 1), `pvar`/`pstdev` (poblacionales, n). También admiten una lista entre llaves: `mean({1, 2, 3})`.
 * - Normal: `normalcdf(a, b, μ=0, σ=1)`, `normalpdf(x, μ=0, σ=1)`, `invnorm(p, μ=0, σ=1)`, `zscore(x, μ, σ)`.
 * - Binomial: `binompdf(n, p, k)`, `binomcdf(n, p, k)` = P(X ≤ k). Poisson: `poissonpdf(λ, k)`, `poissoncdf(λ, k)`.
 * - t de Student: `tcdf(a, b, gl)`, `invt(p, gl)`. Ji cuadrado: `chi2cdf(a, b, gl)`, `chi2pdf(x, gl)`.
 *
 * Los límites de las `…cdf` pueden ser `±inf` o números grandes (`-1e99`, como en la TI). Con argumentos racionales, la
 * estadística descriptiva, `zscore` y la binomial (si cabe) son exactas; el resto devuelve un `number`.
 */
export const Statistics = {
  // MARK: Evaluación exacta (racionales)

  /** Resultado exacto si los argumentos lo permiten; `null` para usar la versión en `number`. */
  exact(name: string, v: readonly MathValue[]): MathValue | null {
    const qs: Fraction[] = []
    for (const x of v) {
      if (x.kind !== 'rational') return null
      qs.push(x.value)
    }
    switch (name) {
      case 'sum': {
        const s = sum(qs)
        return s ? MV.rational(s) : null
      }
      case 'mean': {
        const s = sum(qs)
        const m = s ? s.divided(Fraction.int(qs.length)) : null
        return m ? MV.rational(m) : null
      }
      case 'median': {
        const sorted = [...qs].sort((a, b) => a.compare(b))
        const mid = Math.floor(sorted.length / 2)
        if (sorted.length % 2 === 1) return MV.rational(sorted[mid])
        const s = sorted[mid - 1].adding(sorted[mid])
        const m = s ? s.divided(Fraction.int(2)) : null
        return m ? MV.rational(m) : null
      }
      case 'mode':
        return MV.rational(uniqueMode(qs, (a, b) => a.equals(b), (f) => f.plain))
      case 'var':
      case 'pvar':
      case 'stdev':
      case 'pstdev': {
        const sample = name === 'var' || name === 'stdev'
        checkCount(qs.length, sample)
        const s = sum(qs)
        const m = s ? s.divided(Fraction.int(qs.length)) : null
        if (!m) return null
        let acc: Fraction = Fraction.ZERO
        for (const q of qs) {
          const d = q.subtracting(m)
          const d2 = d ? d.multiplied(d) : null
          const a = d2 ? acc.adding(d2) : null
          if (!a) return null
          acc = a
        }
        const variance = acc.divided(Fraction.int(sample ? qs.length - 1 : qs.length))
        if (!variance) return null
        if (name === 'var' || name === 'pvar') return MV.rational(variance)
        const r = Exact.root(variance, 1n, 2n)
        if (r) return MV.rational(r)
        return MV.real(Math.sqrt(variance.doubleValue))
      }
      case 'zscore': {
        if (!(qs[2].sign > 0)) throw domain(tr('En zscore(x, μ, σ) la desviación típica σ debe ser positiva'))
        const d = qs[0].subtracting(qs[1])
        const z = d ? d.divided(qs[2]) : null
        return z ? MV.rational(z) : null
      }
      case 'binompdf':
      case 'binomcdf': {
        const [n, , k] = binomialArguments(qs.map((q) => q.doubleValue))
        if (n > 200) return null
        if (k < 0) return MV.int(0)
        if (k >= n && name === 'binomcdf') return MV.int(1)
        if (k > n) return MV.int(0)
        const pq = qs[1]
        const q = Fraction.ONE.subtracting(pq)
        if (!q) return null
        const term = (i: number): Fraction | null => {
          const c = Exact.combinations(BigInt(n), BigInt(i))
          const a = pq.power(i)
          const b = q.power(n - i)
          if (c === null || !a || !b) return null
          const ca = Fraction.int(c).multiplied(a)
          return ca ? ca.multiplied(b) : null
        }
        if (name === 'binompdf') {
          const t = term(k)
          return t ? MV.rational(t) : null
        }
        let acc: Fraction = Fraction.ZERO
        for (let i = 0; i <= k; i++) {
          const t = term(i)
          const a = t ? acc.adding(t) : null
          if (!a) return null
          acc = a
        }
        return MV.rational(acc)
      }
      default:
        return null
    }
  },

  // MARK: Evaluación en number

  /** Valor de una función de estadística (nombre canónico) con argumentos reales. */
  apply(name: string, a: readonly number[]): number {
    if (a.some((x) => Number.isNaN(x))) throw domain(tr('La operación no está definida'))
    switch (name) {
      case 'sum':
        return finiteSum(a)
      case 'mean':
        return finiteSum(a) / a.length
      case 'median': {
        const s = [...a].sort((x, y) => x - y)
        const mid = Math.floor(s.length / 2)
        return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
      }
      case 'mode':
        return uniqueMode(a, (x, y) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y)), (x) => NumberInput.shown(x))
      case 'var':
      case 'pvar':
      case 'stdev':
      case 'pstdev': {
        const sample = name === 'var' || name === 'stdev'
        checkCount(a.length, sample)
        if (!a.every((x) => Number.isFinite(x))) throw domain(tr('Los datos deben ser números finitos'))
        const m = a.reduce((s, x) => s + x, 0) / a.length
        const ss = a.reduce((s, x) => s + (x - m) * (x - m), 0)
        const v = ss / (sample ? a.length - 1 : a.length)
        return name === 'var' || name === 'pvar' ? v : Math.sqrt(v)
      }
      case 'zscore':
        positiveSigma(a[2], 'zscore(x, μ, σ)')
        return (a[0] - a[1]) / a[2]
      case 'normalcdf': {
        const mu = a.length >= 3 ? a[2] : 0
        const sigma = a.length >= 4 ? a[3] : 1
        positiveSigma(sigma, 'normalcdf')
        return Statistics.normalProbability((a[0] - mu) / sigma, (a[1] - mu) / sigma)
      }
      case 'normalpdf': {
        const mu = a.length >= 2 ? a[1] : 0
        const sigma = a.length >= 3 ? a[2] : 1
        positiveSigma(sigma, 'normalpdf')
        const z = (a[0] - mu) / sigma
        return Math.exp(-0.5 * z * z) / (sigma * SQRT_2PI)
      }
      case 'invnorm': {
        const mu = a.length >= 2 ? a[1] : 0
        const sigma = a.length >= 3 ? a[2] : 1
        positiveSigma(sigma, 'invnorm')
        openProbability(a[0], 'invnorm')
        return mu + sigma * Statistics.inverseNormal(a[0])
      }
      case 'binompdf':
      case 'binomcdf': {
        const [n, p, k] = binomialArguments(a)
        return name === 'binompdf' ? binomialPDF(n, p, k) : binomialCDF(n, p, k)
      }
      case 'poissonpdf':
      case 'poissoncdf': {
        const lambda = a[0]
        if (!(Number.isFinite(lambda) && lambda > 0)) throw domain(tr('En la distribución de Poisson λ debe ser un número positivo'))
        const k = integer(a[1], () => tr('k debe ser un número entero'))
        if (k < 0) return 0
        if (name === 'poissonpdf') return Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1))
        return Statistics.regularizedGamma(k + 1, lambda).q // P(X ≤ k) = Q(k+1, λ)
      }
      case 'tcdf': {
        const df = degreesOfFreedom(a[2])
        return Statistics.studentProbability(a[0], a[1], df)
      }
      case 'invt': {
        const df = degreesOfFreedom(a[1])
        openProbability(a[0], 'invt')
        return Statistics.inverseStudent(a[0], df)
      }
      case 'chi2cdf': {
        const df = degreesOfFreedom(a[2])
        const lo = Math.max(a[0], 0)
        const hi = Math.max(a[1], 0)
        const pa = chiSquareTails(lo, df)
        const pb = chiSquareTails(hi, df)
        // la cola que no pierde precisión
        return pa.lower > 0.5 ? pa.upper - pb.upper : pb.lower - pa.lower
      }
      case 'chi2pdf': {
        const df = degreesOfFreedom(a[1])
        const x = a[0]
        if (x < 0) return 0
        const k = df / 2
        if (x === 0) {
          if (k < 1) throw domain(tr('chi2pdf no está definida en x = 0 con menos de 2 grados de libertad'))
          return k === 1 ? 0.5 : 0
        }
        return Math.exp((k - 1) * Math.log(x) - x / 2 - k * Math.log(2) - lgamma(k))
      }
      default:
        throw new MathError('unknownFunction', tr('No conozco la función «%@»', name))
    }
  },

  // MARK: Normal

  /** Φ(z): función de distribución de la normal estándar. */
  normalCDF(z: number): number {
    return 0.5 * erfc(-z / SQRT2)
  },

  /** P(za ≤ Z ≤ zb), usando la cola adecuada para no perder precisión lejos del centro. */
  normalProbability(za: number, zb: number): number {
    const upper = (z: number): number => 0.5 * erfc(z / SQRT2)
    if (za >= 0) return upper(za) - upper(zb)
    if (zb <= 0) return Statistics.normalCDF(zb) - Statistics.normalCDF(za)
    return 1 - Statistics.normalCDF(za) - upper(zb)
  },

  /** Φ⁻¹(p) para 0 < p < 1: aproximación de Acklam refinada con pasos de Halley sobre `erfc`. */
  inverseNormal(p: number): number {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
    const low = 0.02425
    let x: number
    if (p < low) {
      const q = Math.sqrt(-2 * Math.log(p))
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    } else if (p <= 1 - low) {
      const q = p - 0.5
      const r = q * q
      x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    } else {
      const q = Math.sqrt(-2 * Math.log1p(-p))
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    // Refinamiento de Halley: e = Φ(x) − p, calculado con la cola pequeña para no perder cifras
    // (si p > 1/2: Φ(x) − p = (1 − p) − Q(x)).
    for (let i = 0; i < 2; i++) {
      const e = p < 0.5 ? Statistics.normalCDF(x) - p : 1 - p - 0.5 * erfc(x / SQRT2)
      const u = e * SQRT_2PI * Math.exp((x * x) / 2)
      if (!Number.isFinite(u)) break
      x -= u / (1 + (x * u) / 2)
    }
    return x
  },

  // MARK: t de Student

  /** F(t) = P(T ≤ t). */
  studentCDF(t: number, df: number): number {
    return t >= 0 ? 1 - studentUpper(t, df) : studentUpper(-t, df)
  },

  /** P(a ≤ T ≤ b) con la cola adecuada. */
  studentProbability(a: number, b: number, df: number): number {
    if (a >= 0) return studentUpper(a, df) - studentUpper(b, df)
    if (b <= 0) return studentUpper(-b, df) - studentUpper(-a, df)
    return 1 - studentUpper(-a, df) - studentUpper(b, df)
  },

  /** t tal que P(T ≤ t) = p. */
  inverseStudent(p: number, df: number): number {
    if (p === 0.5) return 0
    const tail = Math.min(p, 1 - p) // se busca t ≥ 0 con P(T ≥ t) = tail
    let lo = 0
    let hi = Math.max(1, -Statistics.inverseNormal(tail))
    let guardCount = 0
    while (studentUpper(hi, df) > tail && guardCount < 2000) {
      lo = hi
      hi *= 2
      guardCount += 1
    }
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (mid === lo || mid === hi) break
      if (studentUpper(mid, df) > tail) lo = mid
      else hi = mid
    }
    let t = (lo + hi) / 2
    // pulido con Newton
    for (let i = 0; i < 3; i++) {
      const f = studentUpper(t, df) - tail
      const fp = -studentPDF(t, df)
      if (fp === 0 || !Number.isFinite(f)) break
      const next = t - f / fp
      if (!Number.isFinite(next) || next < lo * 0.5 || next > hi * 2) break
      t = next
    }
    return p < 0.5 ? -t : t
  },

  // MARK: Funciones especiales

  /** Funciones gamma incompletas regularizadas (P, Q) con P + Q = 1. Se calcula directamente la menor de las dos. */
  regularizedGamma(a: number, x: number): { p: number; q: number } {
    if (x <= 0) return { p: 0, q: 1 }
    if (!Number.isFinite(x)) return { p: 1, q: 0 }
    const logFactor = -x + a * Math.log(x) - lgamma(a)
    if (x < a + 1) {
      // serie
      let ap = a
      let del = 1 / a
      let s = del
      for (let i = 0; i < 100_000; i++) {
        ap += 1
        del *= x / ap
        s += del
        if (Math.abs(del) < Math.abs(s) * 1e-17) break
      }
      const p = Math.min(1, s * Math.exp(logFactor))
      return { p, q: 1 - p }
    }
    // fracción continua (Lentz)
    const tiny = 1e-300
    let b = x + 1 - a
    let c = 1 / tiny
    let d = 1 / b
    let h = d
    for (let i = 1; i < 100_000; i++) {
      const an = -i * (i - a)
      b += 2
      d = an * d + b
      if (Math.abs(d) < tiny) d = tiny
      c = b + an / c
      if (Math.abs(c) < tiny) c = tiny
      d = 1 / d
      const del = d * c
      h *= del
      if (Math.abs(del - 1) < 1e-16) break
    }
    const q = Math.min(1, Math.exp(logFactor) * h)
    return { p: 1 - q, q }
  },

  /** Función beta incompleta regularizada I_x(a, b). */
  regularizedBeta(a: number, b: number, x: number): number {
    if (x <= 0) return 0
    if (x >= 1) return 1
    const logFront = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x)
    if (x < (a + 1) / (a + b + 2)) return (Math.exp(logFront) * betaContinuedFraction(a, b, x)) / a
    return 1 - (Math.exp(logFront) * betaContinuedFraction(b, a, 1 - x)) / b
  },
}

function sum(qs: readonly Fraction[]): Fraction | null {
  let acc: Fraction = Fraction.ZERO
  for (const q of qs) {
    const a = acc.adding(q)
    if (!a) return null
    acc = a
  }
  return acc
}

function checkCount(n: number, sample: boolean): void {
  if (sample && n < 2) throw domain(tr('La varianza y la desviación típica muestrales necesitan al menos 2 datos'))
}

/** Moda única (el valor que más se repite, al menos dos veces). */
function uniqueMode<T>(values: readonly T[], equal: (a: T, b: T) => boolean, show: (v: T) => string): T {
  const groups: Array<{ value: T; count: number }> = []
  for (const v of values) {
    const g = groups.find((x) => equal(x.value, v))
    if (g) g.count += 1
    else groups.push({ value: v, count: 1 })
  }
  const best = groups.reduce((m, g) => Math.max(m, g.count), 0)
  if (best < 2) throw domain(tr('No hay moda: ningún valor se repite'))
  const winners = groups.filter((g) => g.count === best)
  if (winners.length > 1) {
    const tied = winners.map((w) => show(w.value)).join(NumberInput.listSeparator)
    throw domain(tr('No hay una moda única: %@ se repiten %lld veces cada uno', tied, best))
  }
  return winners[0].value
}

function finiteSum(a: readonly number[]): number {
  const s = a.reduce((acc, x) => acc + x, 0)
  if (Number.isNaN(s)) throw domain(tr('La suma no está definida (∞ − ∞)'))
  return s
}

// MARK: Validación de argumentos

function positiveSigma(s: number, where: string): void {
  if (!(Number.isFinite(s) && s > 0)) throw domain(tr('En %@ la desviación típica σ debe ser un número positivo', where))
}

function openProbability(p: number, name: string): void {
  if (!(p > 0 && p < 1)) throw domain(tr('En %@ el área (probabilidad) debe estar entre 0 y 1, sin incluirlos', name))
}

/** Entero o error de dominio con `message` (frase completa; solo se calcula si hace falta). */
function integer(x: number, message: () => string): number {
  if (!Number.isFinite(x) || x !== Math.round(x) || Math.abs(x) >= 1e15) throw domain(message())
  return x
}

function degreesOfFreedom(x: number): number {
  if (!(Number.isFinite(x) && x > 0)) throw domain(tr('Los grados de libertad deben ser un número positivo'))
  return x
}

function binomialArguments(a: readonly number[]): [number, number, number] {
  const n = integer(a[0], () => tr('En la binomial, n (número de ensayos) debe ser un número entero'))
  if (n < 0) throw domain(tr('En la binomial, n (número de ensayos) no puede ser negativo'))
  if (!(a[1] >= 0 && a[1] <= 1)) throw domain(tr('En la binomial, la probabilidad p debe estar entre 0 y 1'))
  const k = integer(a[2], () => tr('En la binomial, k (número de éxitos) debe ser un número entero'))
  return [n, a[1], k]
}

// MARK: Binomial

function binomialPDF(n: number, p: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (p === 0) return k === 0 ? 1 : 0
  if (p === 1) return k === n ? 1 : 0
  const logC = lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
  if (n <= 1000) {
    // producto directo (más preciso que los logaritmos para n moderado)
    let c = 1
    const kk = Math.min(k, n - k)
    for (let i = 1; i <= kk; i++) c = (c * (n - kk + i)) / i
    const direct = c * Math.pow(p, k) * Math.pow(1 - p, n - k)
    if (isNormal(direct)) return direct
  }
  return Math.exp(logC + k * Math.log(p) + (n - k) * Math.log1p(-p))
}

function binomialCDF(n: number, p: number, k: number): number {
  if (k < 0) return 0
  if (k >= n) return 1
  if (n <= 1000) {
    // suma de la cola más corta
    if (k <= n * p) {
      let s = 0
      for (let i = 0; i <= k; i++) s += binomialPDF(n, p, i)
      return Math.min(1, s)
    }
    let s = 0
    for (let i = k + 1; i <= n; i++) s += binomialPDF(n, p, i)
    return Math.max(0, 1 - s)
  }
  // P(X ≤ k) = I_{1−p}(n − k, k + 1)
  return Statistics.regularizedBeta(n - k, k + 1, 1 - p)
}

/** `Double.isNormal`: finito, distinto de 0 y no subnormal. */
function isNormal(x: number): boolean {
  return Number.isFinite(x) && x !== 0 && Math.abs(x) >= 2.2250738585072014e-308
}

// MARK: t de Student

/** Cola superior P(T ≥ t) para t ≥ 0. */
function studentUpper(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0
  return 0.5 * Statistics.regularizedBeta(df / 2, 0.5, df / (df + t * t))
}

function studentPDF(t: number, df: number): number {
  return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log1p((t * t) / df))
}

// MARK: Ji cuadrado

/** (P(X ≤ x), P(X ≥ x)) de una ji cuadrado con `df` grados de libertad. */
function chiSquareTails(x: number, df: number): { lower: number; upper: number } {
  if (x <= 0) return { lower: 0, upper: 1 }
  if (!Number.isFinite(x)) return { lower: 1, upper: 0 }
  const r = Statistics.regularizedGamma(df / 2, x / 2)
  return { lower: r.p, upper: r.q }
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m < 100_000; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return h
}
