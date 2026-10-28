// Utilidades de las pruebas de LearnKit (portadas de TestSupport.swift): relojes fijos, zonas explícitas y un generador
// determinista independiente del de producción. Solo lo usan los `*.test.ts`.
import { makeDate, UTC } from '@engine/calendar/time'
import type { Rating, ReviewState } from './fsrs'

export const DAY = 86_400
export const DAY_MS = 86_400_000

export const Zones = { utc: UTC, newYork: 'America/New_York', madrid: 'Europe/Madrid' } as const

export function date(y: number, m: number, d: number, h = 0, mi = 0, s = 0, tz: string = UTC): Date {
  return makeDate(y, m, d, h, mi, s, tz)
}

/** Reloj de referencia: 5-ene-2026 09:00 UTC. */
export const t0 = date(2026, 1, 5, 9, 0, 0)

export function plus(d: Date, seconds: number): Date {
  return new Date(d.getTime() + seconds * 1000)
}

export function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

/** Segundos entre dos fechas. */
export function secondsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 1000
}

/** Intervalo programado en días enteros (0 si está en minutos). */
export function scheduledDays(s: ReviewState): number {
  if (s.phase !== 'review' || !s.lastReview) return 0
  const v = (s.due.getTime() - s.lastReview.getTime()) / DAY_MS
  return v < 0 ? -Math.round(-v) : Math.round(v)
}

/** Pesos de la prueba estándar de py-fsrs / ts-fsrs. */
export const pyWeights = [1.14, 1.01, 5.44, 14.67, 5.3024, 1.5662, 1.2503, 0.0028, 1.5489, 0.1763, 0.9953, 2.7473, 0.0179, 0.3105, 0.3976, 0.0, 2.0902]
/** Pesos por defecto de ts-fsrs 3.5.7. */
export const tsWeights = [0.5701, 1.4436, 4.1386, 10.9355, 5.1443, 1.2006, 0.8627, 0.0362, 1.629, 0.1342, 1.0166, 2.1174, 0.0839, 0.3204, 1.4676, 0.219, 2.8237]

export function ratingOf(c: string): Rating {
  return c === 'A' ? 1 : c === 'H' ? 2 : c === 'G' ? 3 : 4
}

const MASK = (1n << 64n) - 1n

/** Generador determinista para pruebas de propiedades (LCG de 64 bits; el mismo que en Swift). */
export class TestRNG {
  private s: bigint
  constructor(seed: bigint | number) {
    this.s = BigInt.asUintN(64, BigInt(seed))
  }
  next(): bigint {
    this.s = (this.s * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) & MASK
    let z = this.s
    z ^= z >> 33n
    z = (z * 0xff51afd7ed558ccdn) & MASK
    z ^= z >> 33n
    return z
  }
  /** [0, 1) */
  unit(): number {
    return Number(this.next() >> 11n) / 9_007_199_254_740_992
  }
  int(n: number): number {
    return Number(this.next() % BigInt(Math.max(Math.trunc(n), 1)))
  }
  double(lo: number, hi: number): number {
    return lo + (hi - lo) * this.unit()
  }
  pick<T>(a: readonly T[]): T {
    return a[this.int(a.length)]
  }
}

/** Compara con tolerancia relativa/absoluta (como `assertClose`). */
export function close(a: number, b: number, tol = 1e-9): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= tol * scale
}
