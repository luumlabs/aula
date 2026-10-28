// Utilidades JSON para los cuerpos de petición (port de AIKit/HTTP/JSONTools.swift y de JSONValue.compact).
import type { JSONObject, JSONValue } from '@shared/ai/json'
import { isJSONObject } from '@shared/ai/json'
import type { ImagePart, ToolCall } from '@shared/ai/types'

/** JSON compacto con claves ordenadas (determinista: importante para la caché de prompts y para las pruebas). */
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']'
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(o[k])).join(',') + '}'
  }
  return 'null'
}

/** JSON estricto (lanza si no es válido). */
export function parseJSON(text: string): JSONValue {
  return JSON.parse(text) as JSONValue
}

export function tryParseJSON(text: string): JSONValue | undefined {
  try {
    return JSON.parse(text) as JSONValue
  } catch {
    return undefined
  }
}

/** Texto utilizable de un valor: cadena tal cual; número/bool convertidos; null vacío; resto, JSON compacto. */
export function asText(v: JSONValue | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return canonicalJSON(v)
}

// Acceso cómodo a valores JSON desconocidos (respuestas de los proveedores).
export function obj(v: unknown): JSONObject | undefined {
  return isJSONObject(v) ? v : undefined
}
export function arr(v: unknown): JSONValue[] | undefined {
  return Array.isArray(v) ? (v as JSONValue[]) : undefined
}
export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
/** Número entero (también de una cadena numérica), como `JSONValue.int` de Swift. */
export function int(v: unknown): number | undefined {
  let d: number | undefined
  if (typeof v === 'number') d = v
  else if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.trim()))) d = Number(v.trim())
  if (d === undefined || !Number.isFinite(d) || Math.abs(d) >= 9e15) return undefined
  return Math.round(d)
}
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const d = Number(v.trim())
    return Number.isNaN(d) ? undefined : d
  }
  return undefined
}
export function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (['true', 'sí', 'si', 'yes'].includes(s)) return true
    if (['false', 'no'].includes(s)) return false
  }
  return undefined
}
/** `v[k1][k2]…` sin lanzar. */
export function at(v: unknown, ...path: (string | number)[]): JSONValue | undefined {
  let cur: unknown = v
  for (const p of path) {
    if (typeof p === 'number') {
      if (!Array.isArray(cur) || p < 0 || p >= cur.length) return undefined
      cur = cur[p]
    } else {
      if (!isJSONObject(cur)) return undefined
      cur = cur[p]
    }
  }
  return cur as JSONValue | undefined
}

/**
 * Fusiona `extra` sobre `base`: los objetos se combinan recursivamente, el resto lo sustituye `extra`, y un `null` en
 * `extra` ELIMINA la clave (permite quitar parámetros que un servidor no admite).
 */
export function deepMergeJSON(base: JSONValue, extra: JSONValue): JSONValue {
  if (!isJSONObject(base) || !isJSONObject(extra)) return extra
  const out: JSONObject = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) {
      delete out[k]
      continue
    }
    out[k] = k in out ? deepMergeJSON(out[k], v) : v
  }
  return out
}

/** Aplica `ChatRequest.extraBody` sobre el cuerpo ya construido. */
export function applyExtraBody(body: JSONObject, extra: JSONObject | undefined): JSONObject {
  if (!extra || Object.keys(extra).length === 0) return body
  const merged = deepMergeJSON(body, extra)
  return isJSONObject(merged) ? merged : body
}

/** El esquema de una herramienta debe ser un objeto JSON Schema; si no lo es se usa uno vacío. */
export function objectSchema(v: JSONValue | undefined): JSONObject {
  if (!isJSONObject(v) || Object.keys(v).length === 0) return { type: 'object', properties: {} }
  if (v.type === undefined) {
    const c: JSONObject = { ...v, type: 'object' }
    if (c.properties === undefined) c.properties = {}
    return c
  }
  return v
}

/** Argumentos de una llamada como cadena JSON: siempre JSON válido (el valor ya reparado, nunca el texto original). */
export function argumentsString(call: ToolCall): string {
  return call.arguments === null || call.arguments === undefined ? '{}' : canonicalJSON(call.arguments)
}

export function dataURL(image: ImagePart): string {
  return `data:${image.mediaType};base64,${image.base64}`
}

/** Copia profunda de un valor JSON. */
export function cloneJSON<T extends JSONValue>(v: T): T {
  return structuredClone(v)
}

/** Igualdad profunda de valores JSON (sin depender del orden de las claves). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJSON(a) === canonicalJSON(b)
}
