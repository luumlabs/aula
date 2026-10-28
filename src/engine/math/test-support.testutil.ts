// Ayudantes comunes de las pruebas de MathKit (port de Tests/MathKitTests/TestSupport.swift). Solo los usan los `*.test.ts`.
import { expect } from 'vitest'
import type { Expr } from './core/expr'
import { MathError, MV, type AngleMode, type MathValue } from './core/types'
import { evaluate, evaluateDouble } from './eval/evaluate'
import { Fraction } from './numbers/fraction'
import type { ParseOptions } from './parse/options'
import { MathParser } from './parse/parser'
import { toPlain } from './print/plain'
import type { CheckVerdict, Diagnosis } from './check/verdict'

/** Analiza o falla la prueba. */
export function P(s: string, o?: Partial<ParseOptions>): Expr {
  try {
    return MathParser.parse(s, o)
  } catch (e) {
    throw new Error(`«${s}» debería analizarse y falló: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Texto normalizado (plain) de lo que se entiende al analizar. */
export function plainOf(s: string): string {
  return toPlain(P(s))
}

/** Evalúa en `number`; `null` si hay error de análisis o de evaluación. */
export function num(s: string, env: Record<string, number> = {}, angle: AngleMode = 'radians'): number | null {
  let e: Expr
  try {
    e = MathParser.parse(s)
  } catch {
    return null
  }
  try {
    return evaluateDouble(e, env, angle)
  } catch {
    return null
  }
}

/** Evalúa de forma exacta. */
export function exact(s: string, env: Record<string, MathValue> = {}, angle: AngleMode = 'radians'): MathValue | null {
  let e: Expr
  try {
    e = MathParser.parse(s)
  } catch {
    return null
  }
  try {
    return evaluate(e, env, angle)
  } catch {
    return null
  }
}

/** Error de análisis o de evaluación (`null` si todo va bien). */
export function errorOf(s: string, env: Record<string, MathValue> = {}): MathError | null {
  try {
    const e = MathParser.parse(s)
    evaluate(e, env)
    return null
  } catch (e) {
    if (e instanceof MathError) return e
    return new MathError('unsupported', String(e))
  }
}

export function parseError(s: string, options?: Partial<ParseOptions>): MathError | null {
  try {
    MathParser.parse(s, options)
    return null
  } catch (e) {
    return e instanceof MathError ? e : null
  }
}

export function frac(n: number | bigint, d: number | bigint = 1): Fraction {
  const f = Fraction.of(n, d)
  if (!f) throw new Error(`fracción inválida ${n}/${d}`)
  return f
}

/** Racional exacto como `MathValue`. */
export function Q(n: number | bigint, d: number | bigint = 1): MathValue {
  return MV.rational(frac(n, d))
}

/** Real como `MathValue`. */
export function R(x: number): MathValue {
  return MV.real(x)
}

/** Igualdad de valores (racional con racional, real con real), como `XCTAssertEqual` de `MathValue`. */
export function expectValue(a: MathValue | null | undefined, b: MathValue | null, message = ''): void {
  const show = (v: MathValue | null | undefined): string => (v ? MV.describe(v) : String(v))
  expect(MV.equals(a ?? null, b), `${show(a)} ≠ ${show(b)} ${message}`).toBe(true)
}

export function expectClose(a: number | null | undefined, b: number, tol = 1e-9, message = ''): void {
  if (a === null || a === undefined) {
    expect.fail(`valor nulo (esperado ${b}) ${message}`)
    return
  }
  expect(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} ≠ ${b} ${message}`).toBe(true)
}

/** ¿Tiene esta etiqueta de diagnóstico? */
export function has(v: CheckVerdict, d: Diagnosis): boolean {
  return v.diagnosis.includes(d)
}

/** Igualdad de fracciones. */
export function expectFrac(a: Fraction | null | undefined, b: Fraction | null, message = ''): void {
  expect(a ? a.plain : a, message).toBe(b ? b.plain : b)
}

/** Ejecuta `fn` con el separador decimal del estudiante fijado y lo restaura al terminar. */
export function withDecimalComma<T>(comma: boolean | null, fn: () => T, apply: (setting: string) => void): T {
  apply(comma === null ? 'auto' : comma ? 'comma' : 'point')
  try {
    return fn()
  } finally {
    apply('auto')
  }
}
