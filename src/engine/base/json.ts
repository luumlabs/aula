// Valor JSON dinámico y utilidades (port de BaseKit/JSONValue.swift). Isomorfo: sin Node ni DOM.

export type JSONPrimitive = null | boolean | number | string
export type JSONValue = JSONPrimitive | JSONValue[] | JSONObject
export interface JSONObject {
  [key: string]: JSONValue
}

/** Profundidad máxima que se acepta al leer (un JSON hostil de cientos de niveles se rechaza). */
export const JSON_MAX_DEPTH = 128

/**
 * Entero que no cabe en un `number` sin perder cifras (p. ej. las semillas `UInt64` de las plantillas).
 * `parseJSON` lo devuelve en lugar del número y `stringifyJSON` lo escribe tal cual, sin comillas.
 */
export class RawNumber {
  readonly text: string
  constructor(text: string) {
    this.text = text
  }
  valueOf(): number {
    return Number(this.text)
  }
  toJSON(): number {
    return Number(this.text)
  }
  toString(): string {
    return this.text
  }
}

export function isJSONObject(v: unknown): v is JSONObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RawNumber)
}

interface ReviverContext {
  source?: string
}

/**
 * `JSON.parse` que conserva los enteros grandes (más de 2^53) como `RawNumber`, para no perder cifras de las semillas.
 * Lanza si el texto no es JSON.
 */
export function parseJSON(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, ctx?: ReviverContext) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value) && ctx?.source && /^-?\d+$/.test(ctx.source)) {
      return new RawNumber(ctx.source)
    }
    return value
  })
}

/** Profundidad de anidamiento de un valor (iterativo: no desborda la pila). */
export function jsonDepth(root: unknown, limit = Infinity): number {
  let max = 0
  const stack: Array<[unknown, number]> = [[root, 1]]
  while (stack.length) {
    const [v, d] = stack.pop()!
    if (Array.isArray(v)) {
      if (d > max) max = d
      if (max > limit) return max
      for (const x of v) stack.push([x, d + 1])
    } else if (isJSONObject(v)) {
      if (d > max) max = d
      if (max > limit) return max
      for (const x of Object.values(v)) stack.push([x, d + 1])
    }
  }
  return max
}

/** Como `JSONValue.parse` de Swift: JSON estricto y como mucho `JSON_MAX_DEPTH` niveles. */
export function parseJSONValue(text: string): JSONValue {
  const v = parseJSON(text)
  if (jsonDepth(v, JSON_MAX_DEPTH) > JSON_MAX_DEPTH) throw new Error(`JSON demasiado anidado (más de ${JSON_MAX_DEPTH} niveles)`)
  return toPlainJSON(v)
}

/** Copia sin `RawNumber` (los enteros grandes pasan a `number`). */
export function toPlainJSON(v: unknown): JSONValue {
  if (v instanceof RawNumber) return Number(v.text)
  if (Array.isArray(v)) return v.map(toPlainJSON)
  if (isJSONObject(v)) {
    const out: JSONObject = {}
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = toPlainJSON(x)
    return out
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v
  return null
}

export interface StringifyOptions {
  /** Legible (sangría de 2 espacios). Por defecto, sí. */
  pretty?: boolean
  /** Claves ordenadas (como `.sortedKeys` de Swift). Por defecto, sí. */
  sortKeys?: boolean
}

/**
 * JSON con claves ordenadas y sin escapar «/» (como `JSONCoders.makeEncoder` de Swift). Omite las claves `undefined`,
 * escribe `RawNumber` sin comillas y los números no finitos como `null`.
 */
export function stringifyJSON(value: unknown, opts: StringifyOptions = {}): string {
  const pretty = opts.pretty ?? true
  const sortKeys = opts.sortKeys ?? true
  const parts: string[] = []
  const write = (v: unknown, indent: string): void => {
    if (v === null || v === undefined) { parts.push('null'); return }
    if (v instanceof RawNumber) { parts.push(v.text); return }
    switch (typeof v) {
      case 'string': parts.push(JSON.stringify(v)); return
      case 'number': parts.push(Number.isFinite(v) ? JSON.stringify(v) : 'null'); return
      case 'boolean': parts.push(v ? 'true' : 'false'); return
      case 'bigint': parts.push(v.toString()); return
      case 'object': break
      default: parts.push('null'); return
    }
    const inner = pretty ? indent + '  ' : ''
    const nl = pretty ? '\n' : ''
    if (Array.isArray(v)) {
      if (v.length === 0) { parts.push('[]'); return }
      parts.push('[' + nl)
      v.forEach((x, i) => {
        parts.push(inner)
        write(x === undefined ? null : x, inner)
        if (i < v.length - 1) parts.push(',')
        parts.push(nl)
      })
      parts.push(indent + ']')
      return
    }
    const obj = v as Record<string, unknown>
    let keys = Object.keys(obj).filter((k) => obj[k] !== undefined)
    if (sortKeys) keys = keys.sort()
    if (keys.length === 0) { parts.push('{}'); return }
    parts.push('{' + nl)
    keys.forEach((k, i) => {
      parts.push(inner + JSON.stringify(k) + (pretty ? ': ' : ':'))
      write(obj[k], inner)
      if (i < keys.length - 1) parts.push(',')
      parts.push(nl)
    })
    parts.push(indent + '}')
  }
  write(value, '')
  return parts.join('')
}

// MARK: Acceso cómodo

/** Texto de un número como lo escribe Swift (`Double.description`): «3», «2.5», «1e-05», «1.5e+20». */
export function numberText(d: number): string {
  if (!Number.isFinite(d)) return Number.isNaN(d) ? 'nan' : d > 0 ? 'inf' : '-inf'
  if (Math.round(d) === d && Math.abs(d) < 1e15) return String(d === 0 ? 0 : d)
  const abs = Math.abs(d)
  if (abs !== 0 && (abs < 1e-4 || abs >= 2 ** 54)) {
    const [mant, exp] = d.toExponential().split('e')
    const sign = exp.startsWith('-') ? '-' : '+'
    const digits = exp.replace(/^[+-]/, '').padStart(2, '0')
    return `${mant}e${sign}${digits}`
  }
  const s = String(d)
  if (/e/i.test(s)) {
    // JS escribe en exponencial lo que Swift escribe en decimal (de 1e21 a 2^54 no ocurre; por si acaso)
    return d.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  }
  return Math.round(d) === d ? s + '.0' : s
}

/** Texto utilizable de un valor: cadena tal cual; número/bool convertidos; resto, JSON compacto. */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return numberText(v)
  if (v instanceof RawNumber) return v.text
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v === null || v === undefined) return ''
  return compactJSON(v)
}

/** Booleano tolerante («sí», «yes», «false»…). */
export function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (['true', 'sí', 'si', 'yes'].includes(s)) return true
    if (['false', 'no'].includes(s)) return false
  }
  return undefined
}

/** Lee un número decimal escrito como texto (como `Double(String)` de Swift, solo valores finitos). */
export function parseDecimal(s: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export function asDouble(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v instanceof RawNumber) return Number(v.text)
  if (typeof v === 'string') return parseDecimal(v.trim())
  return undefined
}

export function asInt(v: unknown): number | undefined {
  const d = asDouble(v)
  if (d !== undefined && Number.isFinite(d) && Math.abs(d) < 9e15) return Math.round(d)
  return undefined
}

/** JSON compacto con claves ordenadas (estable para comparar/hashear). */
export function compactJSON(v: unknown): string {
  return stringifyJSON(v, { pretty: false, sortKeys: true })
}

/** JSON legible con claves ordenadas. */
export function prettyJSON(v: unknown): string {
  return stringifyJSON(v, { pretty: true, sortKeys: true })
}

/** Igualdad estructural de dos valores JSON (sin importar el orden de las claves). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return compactJSON(a) === compactJSON(b)
}

// MARK: Esquemas JSON (para describir herramientas de IA)

export const Schema = {
  object(properties: Array<[string, JSONValue]>, opts: { required?: string[]; description?: string; additional?: boolean } = {}): JSONObject {
    const props: JSONObject = {}
    for (const [k, v] of properties) props[k] = v
    const o: JSONObject = { type: 'object', properties: props, additionalProperties: opts.additional ?? false }
    if (opts.required && opts.required.length) o.required = [...opts.required]
    if (opts.description !== undefined) o.description = opts.description
    return o
  },
  string(description?: string, values?: string[]): JSONObject {
    const o: JSONObject = { type: 'string' }
    if (description !== undefined) o.description = description
    if (values) o.enum = [...values]
    return o
  },
  integer(description?: string, min?: number, max?: number): JSONObject {
    const o: JSONObject = { type: 'integer' }
    if (description !== undefined) o.description = description
    if (min !== undefined) o.minimum = min
    if (max !== undefined) o.maximum = max
    return o
  },
  number(description?: string): JSONObject {
    const o: JSONObject = { type: 'number' }
    if (description !== undefined) o.description = description
    return o
  },
  boolean(description?: string): JSONObject {
    const o: JSONObject = { type: 'boolean' }
    if (description !== undefined) o.description = description
    return o
  },
  array(items: JSONValue, description?: string, minItems?: number): JSONObject {
    const o: JSONObject = { type: 'array', items }
    if (description !== undefined) o.description = description
    if (minItems !== undefined) o.minItems = minItems
    return o
  },
  /** Valor libre (cualquier JSON). */
  any(description?: string): JSONObject {
    return description !== undefined ? { description } : {}
  },
  /** Objeto de forma libre (la herramienta valida sus campos). */
  freeObject(description?: string): JSONObject {
    const o: JSONObject = { type: 'object', additionalProperties: true }
    if (description !== undefined) o.description = description
    return o
  }
}
