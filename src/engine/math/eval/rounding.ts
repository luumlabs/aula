// Redondeos y potencias con la semántica de la libm de Swift.

/** `pow` de C: igual que `Math.pow` salvo `pow(1, y) = 1` y `pow(-1, ±∞) = 1` (JS da NaN). */
export function swiftPow(a: number, b: number): number {
  if (a === 1) return 1
  if (a === -1 && !Number.isFinite(b) && !Number.isNaN(b)) return 1
  return Math.pow(a, b)
}

/** Redondeo «mitad lejos de cero» (`Double.rounded()` de Swift, `.toNearestOrAwayFromZero`). */
export function roundHalfAwayFromZero(x: number): number {
  if (!Number.isFinite(x)) return x
  // Math.round redondea las mitades hacia +∞: con |x| eso ya es «lejos de cero»
  const v = Math.round(Math.abs(x))
  return x < 0 ? -v : v
}
