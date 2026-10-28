// Adaptador entre las gráficas y el motor matemático (src/engine/math): analiza una vez cada expresión y la convierte en una
// función rápida. Todo lo que dibuja una gráfica pasa por aquí, para poder cambiar de motor sin tocar los bloques.
import { MathParser } from '@engine/math/parse/parser'
import { evaluateDouble } from '@engine/math/eval/evaluate'
import type { Expr } from '@engine/math/core/expr'
import type { AngleMode } from '@engine/math/core/types'

/** Valores de los parámetros (`a`, `k`, `theta`…) por nombre tal como los escribe el curso. */
export type Params = Readonly<Record<string, number>>

export type RealFn = (v: number) => number | null

const cache = new Map<string, Expr | null>()
const CACHE_LIMIT = 500

/** Árbol de la expresión (o null si no se entiende). Se guarda en caché: los deslizadores la evalúan miles de veces. */
export function parseExpr(text: string, wordVariables = false): Expr | null {
  const key = `${wordVariables ? 'w' : 'l'}:${text}`
  if (cache.has(key)) return cache.get(key) ?? null
  let e: Expr | null = null
  try {
    if (text.trim()) e = MathParser.parse(text, { wordVariables })
  } catch {
    e = null
  }
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(key, e)
  return e
}

/** Entorno con los nombres en su forma canónica (`theta` → `θ`), como los deja el analizador. */
function canonicalEnv(params: Params): Record<string, number> {
  const env: Record<string, number> = {}
  for (const [k, v] of Object.entries(params)) if (Number.isFinite(v)) env[MathParser.canonicalVariableName(k)] = v
  return env
}

/**
 * Expresión en una variable → función real. null si la expresión no se entiende.
 * La función devuelve null donde no está definida (√ de negativos, polos, valores no finitos).
 */
export function compileFn(text: string, variable = 'x', params: Params = {}, opts: { degrees?: boolean; wordVariables?: boolean } = {}): RealFn | null {
  const e = parseExpr(text, opts.wordVariables)
  if (!e) return null
  const name = MathParser.canonicalVariableName(variable)
  const env = canonicalEnv(params)
  const angle: AngleMode = opts.degrees ? 'degrees' : 'radians'
  return (v: number) => {
    env[name] = v
    try {
      const y = evaluateDouble(e, env, angle)
      return Number.isFinite(y) ? y : null
    } catch {
      return null
    }
  }
}

/** Número de un campo («pi/2», «sqrt(3)/2», «2a» con los parámetros). undefined si falta o no se entiende. */
export function evalNumber(text: string | undefined, params: Params = {}, wordVariables = false): number | undefined {
  if (text === undefined || !text.trim()) return undefined
  const e = parseExpr(text, wordVariables)
  if (!e) return undefined
  try {
    const v = evaluateDouble(e, canonicalEnv(params), 'radians')
    return Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}
