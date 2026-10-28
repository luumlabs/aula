// Valor JSON genérico (argumentos de herramientas, esquemas, cuerpos de petición).
export type JSONPrimitive = null | boolean | number | string
export type JSONValue = JSONPrimitive | JSONValue[] | JSONObject
export interface JSONObject {
  [key: string]: JSONValue
}

export function isJSONObject(v: unknown): v is JSONObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Esquema JSON de una herramienta (siempre un objeto `type: object`). */
export type JSONSchema = JSONObject
