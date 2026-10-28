// Física (pura): tiro parabólico, péndulo (no lineal, con su periodo exacto), oscilador masa-muelle amortiguado, ondas
// y choques en una dimensión. Unidades del SI; ángulos en grados en la interfaz y en radianes dentro.

const rad = (d: number) => (d * Math.PI) / 180

// MARK: Tiro parabólico

export interface Projectile {
  /** Tiempo de vuelo hasta volver al suelo (y = 0). */
  flightTime: number
  range: number
  maxHeight: number
  peakTime: number
  vx: number
  vy0: number
  at: (t: number) => { x: number; y: number; vx: number; vy: number }
}

/** Tiro desde la altura h0 con velocidad v0 y ángulo θ (grados), sin rozamiento. */
export function projectile(v0: number, angleDeg: number, g: number, h0 = 0): Projectile {
  const vx = v0 * Math.cos(rad(angleDeg))
  const vy0 = v0 * Math.sin(rad(angleDeg))
  // y(t) = h0 + vy0 t − g t²/2 = 0 → t = (vy0 + √(vy0² + 2 g h0)) / g
  const flightTime = g > 0 ? (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * g * h0))) / g : Infinity
  const peakTime = g > 0 ? Math.max(0, vy0 / g) : 0
  const maxHeight = h0 + (g > 0 ? Math.max(0, vy0) ** 2 / (2 * g) : 0)
  return {
    flightTime,
    range: vx * flightTime,
    maxHeight,
    peakTime,
    vx,
    vy0,
    at: (t) => ({ x: vx * t, y: h0 + vy0 * t - (g * t * t) / 2, vx, vy: vy0 - g * t })
  }
}

// MARK: Integración

export type Deriv = (y: number[], t: number) => number[]

/** Un paso de Runge-Kutta de orden 4. */
export function rk4(f: Deriv, y: number[], t: number, dt: number): number[] {
  const k1 = f(y, t)
  const k2 = f(y.map((v, i) => v + (dt / 2) * k1[i]), t + dt / 2)
  const k3 = f(y.map((v, i) => v + (dt / 2) * k2[i]), t + dt / 2)
  const k4 = f(y.map((v, i) => v + dt * k3[i]), t + dt)
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

/** Péndulo simple (no lineal): θ'' = −(g/L)·sen θ − b·θ'. Estado [θ, ω] en radianes. */
export function pendulumDeriv(g: number, L: number, b: number): Deriv {
  return ([th, w]) => [w, -(g / L) * Math.sin(th) - b * w]
}

/** Masa-muelle: x'' = −(k/m)·x − (c/m)·x'. Estado [x, v]. */
export function springDeriv(k: number, m: number, c: number): Deriv {
  return ([x, v]) => [v, -(k / m) * x - (c / m) * v]
}

/** Integral elíptica completa de primera especie K(k) por la media aritmético-geométrica. */
export function ellipticK(k: number): number {
  let a = 1
  let b = Math.sqrt(Math.max(0, 1 - k * k))
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return Math.PI / (2 * a)
}

/** Periodo del péndulo: aproximación de ángulos pequeños y exacto (amplitud θ0 en grados). */
export function pendulumPeriod(L: number, g: number, theta0Deg: number): { small: number; exact: number } {
  const small = 2 * Math.PI * Math.sqrt(L / g)
  const exact = 4 * Math.sqrt(L / g) * ellipticK(Math.sin(rad(theta0Deg) / 2))
  return { small, exact }
}

/** Datos del oscilador masa-muelle. */
export function springInfo(k: number, m: number, c: number): { omega0: number; period: number; zeta: number; regime: 'under' | 'critical' | 'over' } {
  const omega0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))
  return { omega0, period: (2 * Math.PI) / omega0, zeta, regime: Math.abs(zeta - 1) < 1e-3 ? 'critical' : zeta < 1 ? 'under' : 'over' }
}

// MARK: Ondas

export interface WaveInfo {
  speed: number
  period: number
  k: number
  omega: number
}

export function waveInfo(lambda: number, f: number): WaveInfo {
  return { speed: lambda * f, period: 1 / f, k: (2 * Math.PI) / lambda, omega: 2 * Math.PI * f }
}

/** y(x, t) de una onda armónica; con `reflected`, la suma con la que viaja al revés (onda estacionaria). */
export function waveY(x: number, t: number, A: number, lambda: number, f: number, reflected: boolean): number {
  const k = (2 * Math.PI) / lambda
  const w = 2 * Math.PI * f
  const y = A * Math.sin(k * x - w * t)
  return reflected ? y + A * Math.sin(k * x + w * t) : y
}

// MARK: Choques

export interface Collision {
  v1: number
  v2: number
  pBefore: number
  pAfter: number
  keBefore: number
  keAfter: number
}

/** Choque frontal en 1D con coeficiente de restitución e (1 elástico, 0 perfectamente inelástico). */
export function collide(m1: number, v1: number, m2: number, v2: number, e: number): Collision {
  const M = m1 + m2
  const p = m1 * v1 + m2 * v2
  const u1 = (p + m2 * e * (v2 - v1)) / M
  const u2 = (p + m1 * e * (v1 - v2)) / M
  return { v1: u1, v2: u2, pBefore: p, pAfter: m1 * u1 + m2 * u2, keBefore: 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2, keAfter: 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2 }
}

/** ¿Llegan a chocar? (el de la izquierda va más deprisa hacia la derecha que el de la derecha). */
export function willCollide(v1: number, v2: number): boolean {
  return v1 > v2
}
