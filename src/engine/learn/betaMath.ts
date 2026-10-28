// Matemática de la distribución Beta (sin dependencias): beta incompleta regularizada, cuantiles y ajuste por momentos.
// Se usa para los intervalos de credibilidad del dominio y de la preparación.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
]
const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI)

export const BetaMath = {
  /** Media de Beta(a, b). */
  mean(a: number, b: number): number {
    return a / (a + b)
  },

  /** Varianza de Beta(a, b). */
  variance(a: number, b: number): number {
    const s = a + b
    return (a * b) / (s * s * (s + 1))
  },

  /** Beta con esa media y varianza (momentos). `null` si es degenerada. */
  match(mean: number, variance: number): { a: number; b: number } | null {
    const m = mean, v = variance
    if (!Number.isFinite(m) || !Number.isFinite(v) || !(m > 0) || !(m < 1) || !(v > 1e-14)) return null
    const k = (m * (1 - m)) / v - 1
    if (!(k > 0) || !Number.isFinite(k)) return null
    return { a: m * k, b: (1 - m) * k }
  },

  /** I_x(a, b): probabilidad acumulada de Beta(a, b) en x. */
  cdf(x: number, a: number, b: number): number {
    if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return x < 0.5 ? 0 : 1
    if (!(x > 0)) return 0
    if (x >= 1) return 1
    const lbeta = BetaMath.logGamma(a + b) - BetaMath.logGamma(a) - BetaMath.logGamma(b)
    const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log1p(-x))
    if (x < (a + 1) / (a + b + 2)) return Math.min(Math.max((front * continuedFraction(a, b, x)) / a, 0), 1)
    return Math.min(Math.max(1 - (front * continuedFraction(b, a, 1 - x)) / b, 0), 1)
  },

  /** Cuantil p (0…1) por bisección sobre la acumulada. */
  quantile(p: number, a: number, b: number): number {
    if (!(p > 0)) return 0
    if (p >= 1) return 1
    let lo = 0, hi = 1
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2
      if (BetaMath.cdf(mid, a, b) < p) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  },

  /** log Γ(x) para x > 0 (Lanczos, g = 7; reflexión para x < 0,5). */
  logGamma(x: number): number {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - BetaMath.logGamma(1 - x)
    const z = x - 1
    let sum = LANCZOS[0]
    for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i] / (z + i)
    const t = z + 7.5
    return HALF_LOG_2PI + (z + 0.5) * Math.log(t) - t + Math.log(sum)
  }
}

/** Fracción continua de Lentz para la beta incompleta (Numerical Recipes, `betacf`). */
function continuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 500
  const eps = 1e-15
  const tiny = 1e-300
  const qab = a + b, qap = a + 1, qam = a - 1
  let c = 1.0
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIterations; m++) {
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
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < eps) break
  }
  return h
}
