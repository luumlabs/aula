import { asObject, lenientBool, lenientDouble, lenientInt, lenientString, lenientStrings } from '../core/lenient'
import type { MathValue } from '../core/types'

/**
 * Cómo se genera el valor de una variable de plantilla. La forma TypeScript es también la forma JSON canónica
 * (`{"type":"int","min":1,"max":9,"exclude":[0]}`).
 */
export type VarKind =
  /** Entero en `[min, max]` que no esté en `exclude`. */
  | { type: 'int'; min: number; max: number; exclude: number[] }
  /** Número con `decimals` decimales en `[min, max]` (se guarda como racional exacto). */
  | { type: 'real'; min: number; max: number; decimals: number }
  /** Uno de los valores literales (`"m/s"`, `"H2O"`, `"12"`). Si el literal es un número, también se puede usar en cuentas. */
  | { type: 'pick'; values: string[] }
  /** Fracción irreducible con denominador entre `minDen` y `maxDen` y numerador hasta `maxNum`. */
  | { type: 'fraction'; minDen: number; maxDen: number; maxNum: number; proper: boolean }
  /** Se calcula con variables anteriores: `"a*b+c"`. */
  | { type: 'expr'; expr: string }

/** Una variable de plantilla: nombre y forma de generarla. */
export interface TemplateVar {
  /** Nombre de la variable (letras, cifras y `_`, empezando por letra). */
  name: string
  /** Cómo se genera su valor. */
  kind: VarKind
}

/** Valores de las variables ya muestreadas. */
export interface TemplateContext {
  /** Valores numéricos (racionales exactos siempre que se puede). */
  values: Record<string, MathValue>
  /** Texto literal de las variables `pick` (y de las numéricas, tal como se escribieron). */
  strings: Record<string, string>
}

/** Contexto vacío (o con valores ya conocidos). */
export function makeTemplateContext(values: Record<string, MathValue> = {}, strings: Record<string, string> = {}): TemplateContext {
  return { values: { ...values }, strings: { ...strings } }
}

function canonicalType(raw: string): VarKind['type'] | null {
  const t = [...raw.toLowerCase()].filter((c) => /\p{Alphabetic}/u.test(c)).join('')
  switch (t) {
    case 'int': case 'integer': case 'entero': case 'natural': return 'int'
    case 'real': case 'float': case 'double': case 'decimal': case 'number': case 'numero': return 'real'
    case 'pick': case 'choice': case 'choose': case 'options': case 'enum': case 'oneof': case 'elegir': case 'lista': return 'pick'
    case 'fraction': case 'frac': case 'fraccion': case 'rational': return 'fraction'
    case 'expr': case 'expression': case 'formula': case 'computed': case 'calc': case 'calculated': return 'expr'
    default: return null
  }
}

/**
 * Lectura tolerante de un `VarKind`. Forma que se escribe: `{"type":"int","min":1,"max":9,"exclude":[0]}`.
 * Formas que se aceptan: `{"int":{"min":1,"max":9}}`, `{"kind":"int","lo":1,"hi":9}`, `{"type":"pick","options":["a","b"]}`…
 * Lanza un `Error` si no se puede leer.
 */
export function decodeVarKind(json: unknown): VarKind {
  const c = asObject(json)
  if (!c) throw new Error('Tipo de variable desconocido (usa int, real, pick, fraction o expr)')
  let type: VarKind['type'] | null = null
  for (const k of ['type', 'kind', 't']) {
    const s = lenientString(c, k)
    const t = s !== null ? canonicalType(s) : null
    if (t) {
      type = t
      break
    }
  }
  // envoltorio de una sola clave: {"int": {...}} / {"pick": [...]}
  let body = c
  if (type === null) {
    for (const key of Object.keys(c)) {
      const t = canonicalType(key)
      if (!t) continue
      type = t
      const nested = asObject(c[key])
      if (nested) body = nested
      else if (t === 'pick') {
        const list = lenientStrings(c, key)
        if (list) return { type: 'pick', values: list }
      } else if (t === 'expr') {
        const s = lenientString(c, key)
        if (s !== null) return { type: 'expr', expr: s }
      }
      break
    }
  }
  if (type === null) throw new Error('Tipo de variable desconocido (usa int, real, pick, fraction o expr)')
  const first = <T>(names: string[], read: (o: Record<string, unknown>, k: string) => T | null): T | null => {
    for (const n of names) {
      const v = read(body, n)
      if (v !== null) return v
    }
    return null
  }
  switch (type) {
    case 'int':
      return {
        type: 'int',
        min: first(['min', 'lo', 'from', 'low'], lenientInt) ?? 1,
        max: first(['max', 'hi', 'to', 'high'], lenientInt) ?? 10,
        exclude: (first(['exclude', 'not', 'except'], lenientStrings) ?? []).filter((s) => /^[+-]?\d+$/.test(s)).map(Number),
      }
    case 'real':
      return {
        type: 'real',
        min: first(['min', 'lo', 'from', 'low'], lenientDouble) ?? 0,
        max: first(['max', 'hi', 'to', 'high'], lenientDouble) ?? 10,
        decimals: first(['decimals', 'places', 'dp'], lenientInt) ?? 1,
      }
    case 'pick': {
      const values = first(['values', 'options', 'items', 'choices', 'list', '_0', 'pick'], lenientStrings)
      if (!values) throw new Error('Falta la lista «values» de la variable pick')
      return { type: 'pick', values }
    }
    case 'fraction':
      return {
        type: 'fraction',
        minDen: first(['minDen', 'min_den', 'denMin'], lenientInt) ?? 2,
        maxDen: first(['maxDen', 'max_den', 'denMax'], lenientInt) ?? 9,
        maxNum: first(['maxNum', 'max_num', 'numMax'], lenientInt) ?? 9,
        proper: lenientBool(body, 'proper') ?? true,
      }
    default: {
      const e = first(['expr', 'expression', 'formula', 'value', '_0'], lenientString)
      if (e === null) throw new Error('Falta la expresión «expr»')
      return { type: 'expr', expr: e }
    }
  }
}

/** Forma JSON canónica de un `VarKind` (`{"type": …}`). */
export function encodeVarKind(k: VarKind): Record<string, unknown> {
  return { ...k }
}

/** Acepta `{"name", "kind": {…}}` y la forma plana `{"name", "type", "min"…}`. Lanza si no se puede leer. */
export function decodeTemplateVar(json: unknown): TemplateVar {
  const c = asObject(json)
  const name = c ? lenientString(c, 'name') : null
  if (!c || name === null) throw new Error('Falta «name»')
  if (Object.prototype.hasOwnProperty.call(c, 'kind')) {
    try {
      return { name, kind: decodeVarKind(c.kind) }
    } catch {
      // forma plana
    }
  }
  try {
    return { name, kind: decodeVarKind(c) } // forma plana: {"name":"a","type":"int","min":1,"max":9}
  } catch {
    throw new Error(`No se pudo leer el tipo de la variable «${name}»`)
  }
}

/** Se escribe como `{"name": …, "kind": {…}}`. */
export function encodeTemplateVar(v: TemplateVar): Record<string, unknown> {
  return { name: v.name, kind: encodeVarKind(v.kind) }
}
