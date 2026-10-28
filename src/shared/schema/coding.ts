// Ayudantes para decodificar con tolerancia (port de StudyModel/Coding.swift): un campo ausente o con tipo equivocado toma su
// valor por defecto, así los archivos viejos, escritos a mano o por la IA no rompen la lectura de todo un curso.
//
// Cada decodificador recibe el valor en bruto y su profundidad `d` (número de claves e índices desde la raíz, como
// `codingPath.count` en Swift) y devuelve `undefined` cuando Swift lanzaría (el elemento se salta en las listas).
import { asText, isJSONObject, parseDecimal, RawNumber, type JSONObject, type JSONValue } from '@engine/base/json'
import { Hashing } from '@engine/base/ids'

export type ItemID = string
/** Fecha ISO-8601 con milisegundos («2026-01-05T12:00:00.000Z»), como `JSONCoders` de Swift. */
export type ISODate = string
/** Entero sin signo de 64 bits escrito en decimal (las semillas de plantilla no caben en un `number`). */
export type U64 = string

export type Obj = Record<string, unknown>

/** El JSON no tiene la forma mínima (p. ej. `pack.json` no es un objeto): Swift lanzaría al decodificarlo. */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaError'
  }
}
export type Decoder<T> = (raw: unknown, d: number, index?: number) => T | undefined

/** Límites que protegen de contenido hostil o dañado (anidamiento absurdo, números gigantes). */
export const ContentLimits = {
  /** Profundidad máxima (en claves/índices JSON) para bloques y respuestas: más allá se degradan a un aviso. */
  maxNesting: 48,
  /** Profundidad máxima (absoluta) de una copia JSON en bruto: lo que queda más abajo se sustituye por null. */
  maxRawNesting: 24,
  /** Número acotado a un rango (los NaN van a `fallback`). */
  clamp(x: number, lo: number, hi: number, fallback?: number): number {
    if (Number.isNaN(x)) return fallback ?? lo
    return Math.min(Math.max(x, lo), hi)
  }
}

export const clamp = ContentLimits.clamp

export function isObj(v: unknown): v is Obj {
  return isJSONObject(v)
}

/** ¿Demasiado anidado para seguir decodificando de forma recursiva? */
export function tooDeep(d: number): boolean {
  return d > ContentLimits.maxNesting
}

/** Quita las claves `undefined` (los opcionales ausentes no se guardan). */
export function prune<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k]
  return o
}

// MARK: Valores sueltos

function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v instanceof RawNumber) return Number(v.text)
  return undefined
}

/** Cadena (solo si es cadena), como `c.optional(.k) as String?`. */
export function vStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
/** Número (como `Double` de `JSONDecoder`: solo números). */
export function vNum(v: unknown): number | undefined {
  const n = numberOf(v)
  return n !== undefined && Number.isFinite(n) ? n : undefined
}
/** Entero de 64 bits (los números con decimales o fuera de rango no valen). */
export function vInt(v: unknown): number | undefined {
  const n = numberOf(v)
  if (n === undefined || !Number.isInteger(n) || Math.abs(n) > 9.223372036854776e18) return undefined
  return n
}
export function vBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
/** Cadena aunque el JSON traiga un número o un booleano ("x": 3 → "3"). */
export function vFlexStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || v instanceof RawNumber) return asText(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return undefined
}
/** Número aunque venga como texto («0.35», «0,35»). */
export function vFlexNum(v: unknown): number | undefined {
  const n = vNum(v)
  if (n !== undefined) return n
  if (typeof v === 'string') return parseDecimal(v.trim().replace(/,/g, '.'))
  return undefined
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

/** Fecha ISO-8601 (con o sin fracción de segundo) normalizada a milisegundos y UTC. */
export function vDate(v: unknown): ISODate | undefined {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

export function nowISO(): ISODate {
  return new Date().toISOString()
}

/** Semilla `UInt64`: número entero ≥ 0 (o `RawNumber`) o su texto decimal. */
export function vU64(v: unknown): U64 | undefined {
  if (v instanceof RawNumber) return /^\d+$/.test(v.text) && BigInt(v.text) < 2n ** 64n ? v.text : undefined
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < 2 ** 64 ? BigInt(v).toString() : undefined
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return BigInt(v) < 2n ** 64n ? v.replace(/^0+(?=\d)/, '') : undefined
  return undefined
}

/** La semilla como se escribe en el JSON: número sin comillas (exacto aunque pase de 2^53). */
export function encodeU64(s: U64): number | RawNumber {
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : new RawNumber(s)
}

// MARK: Campos de un objeto

export function str(o: Obj, k: string): string | undefined {
  return vStr(o[k])
}
export function num(o: Obj, k: string): number | undefined {
  return vNum(o[k])
}
export function int(o: Obj, k: string): number | undefined {
  return vInt(o[k])
}
export function bool(o: Obj, k: string): boolean | undefined {
  return vBool(o[k])
}
export function flexStr(o: Obj, k: string): string | undefined {
  return vFlexStr(o[k])
}
export function flexNum(o: Obj, k: string): number | undefined {
  return vFlexNum(o[k])
}
export function date(o: Obj, k: string): ISODate | undefined {
  return vDate(o[k])
}

/** Enumeración de cadena estricta (un valor desconocido no vale). */
export function enumOf<T extends string>(o: Obj, k: string, values: readonly T[]): T | undefined {
  const s = o[k]
  return typeof s === 'string' && (values as readonly string[]).includes(s) ? (s as T) : undefined
}

/** Lista de textos aunque traiga números o booleanos (["a", 3, true] → ["a", "3", "true"]); una cadena sola es una lista de uno. */
export function strings(o: Obj, k: string): string[] {
  const v = o[k]
  if (Array.isArray(v)) {
    const out: string[] = []
    for (const x of v) {
      if (typeof x === 'string') out.push(x)
      else if (typeof x === 'number' || x instanceof RawNumber) out.push(asText(x))
      else if (typeof x === 'boolean') out.push(x ? 'true' : 'false')
    }
    return out
  }
  const s = vFlexStr(v)
  return s !== undefined ? [s] : []
}

/** `[String]` estricto (como `c.optional(.k) as [String]?`): undefined si no es un arreglo de cadenas. */
export function strictStrings(o: Obj, k: string): string[] | undefined {
  const v = o[k]
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).slice() : undefined
}

/** `[Double]` estricto. */
export function strictNumbers(o: Obj, k: string): number[] | undefined {
  const v = o[k]
  if (!Array.isArray(v)) return undefined
  const out: number[] = []
  for (const x of v) {
    const n = vNum(x)
    if (n === undefined) return undefined
    out.push(n)
  }
  return out
}

/** `[[Double]]` estricto. */
export function strictPoints(o: Obj, k: string): number[][] | undefined {
  const v = o[k]
  if (!Array.isArray(v)) return undefined
  const out: number[][] = []
  for (const row of v) {
    if (!Array.isArray(row)) return undefined
    const r: number[] = []
    for (const x of row) {
      const n = vNum(x)
      if (n === undefined) return undefined
      r.push(n)
    }
    out.push(r)
  }
  return out
}

/** Arreglo tolerante: los elementos que no se pueden leer se saltan en lugar de vaciar la lista completa. */
export function list<T>(o: Obj, k: string, decode: Decoder<T>, d: number): T[] {
  const v = o[k]
  if (!Array.isArray(v)) return []
  const out: T[] = []
  v.forEach((x, i) => {
    const r = decode(x, d + 2, i)
    if (r !== undefined) out.push(r)
  })
  return out
}

/** Valor anidado opcional (como `c.optional(.k)`). */
export function nested<T>(o: Obj, k: string, decode: Decoder<T>, d: number): T | undefined {
  const v = o[k]
  if (v === undefined || v === null) return undefined
  return decode(v, d + 1)
}

/**
 * Id para un elemento que llega sin id: estable entre lecturas (derivado de su contenido y su posición), para que el progreso,
 * los intentos y las respuestas guardadas (que lo referencian por id) sigan encontrándolo al volver a leer el archivo.
 */
export function fallbackID(raw: unknown, index?: number): string {
  let text = ''
  try { text = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '' } catch { text = '' }
  // 6 caracteres, como los ids cortos de siempre; la posición separa dos elementos iguales de la misma lista
  return Hashing.stableID(`${index ?? ''}#${text}`).slice(0, 6)
}

/**
 * Escribe `key` como propiedad propia aunque sea «__proto__» (con `o[key] = v` cambiaría el prototipo y la entrada se perdería).
 * Para diccionarios cuyas claves escribe el usuario o el contenido (ids de habilidades, tarjetas, emparejamientos…).
 */
export function setOwn<T>(o: Record<string, T>, key: string, value: T): void {
  if (key === '__proto__') Object.defineProperty(o, key, { value, writable: true, enumerable: true, configurable: true })
  else o[key] = value
}

/** El valor de una clave PROPIA (`o["constructor"]` devolvería la función heredada de Object). */
export function ownValue<T>(o: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined {
  return o != null && Object.hasOwn(o, key) ? o[key] : undefined
}

/** ¿`key` es una clave propia del diccionario? (en lugar de `key in o`, que también ve lo heredado) */
export function hasOwnKey(o: Readonly<Record<string, unknown>> | null | undefined, key: string): boolean {
  return o != null && Object.hasOwn(o, key)
}

/** Diccionario tolerante: las entradas ilegibles se saltan. */
export function dict<T>(o: Obj, k: string, decode: Decoder<T>, d: number): Record<string, T> {
  const v = o[k]
  const out: Record<string, T> = {}
  if (!isObj(v)) return out
  for (const [key, x] of Object.entries(v)) {
    const r = decode(x, d + 2)
    if (r !== undefined) setOwn(out, key, r)
  }
  return out
}

/** Lista de números ([0.1, 0.2]) aunque alguno venga como texto; como mucho 64. undefined si no es un arreglo. */
export function flexNums(o: Obj, k: string): number[] | undefined {
  const v = o[k]
  if (!Array.isArray(v)) return undefined
  const out: number[] = []
  for (const x of v) {
    if (out.length >= 64) break
    const n = vNum(x)
    if (n !== undefined) out.push(n)
    else if (typeof x === 'string') {
      const p = parseDecimal(x)
      if (p !== undefined) out.push(p)
    }
  }
  return out
}

/** Lista de puntos [[x, y], …] tolerante (como mucho 4000). undefined si no es un arreglo. */
export function points(o: Obj, k: string): number[][] | undefined {
  const v = o[k]
  if (!Array.isArray(v)) return undefined
  const out: number[][] = []
  for (const row of v) {
    if (out.length >= 4000) break
    if (!Array.isArray(row)) continue
    const q: number[] = []
    for (const x of row) {
      const n = vNum(x)
      if (n !== undefined) q.push(n)
      else if (typeof x === 'string') {
        const p = parseDecimal(x)
        if (p !== undefined) q.push(p)
      }
    }
    out.push(q)
  }
  return out
}

/** Copia de un valor JSON cualquiera con la profundidad acotada (absoluta): lo que pasa de `maxRawNesting` es null. */
export function bounded(v: unknown, d: number): JSONValue {
  if (d > ContentLimits.maxRawNesting) return null
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v instanceof RawNumber) return Number(v.text)
  if (Array.isArray(v)) return v.map((x) => bounded(x, d + 1))
  if (isObj(v)) {
    const out: JSONObject = {}
    for (const [k, x] of Object.entries(v)) if (x !== undefined) setOwn(out, k, bounded(x, d + 1))
    return out
  }
  return null
}

/** Fila de una tabla: las celdas pueden venir como números, booleanos o null (se convierten a texto). */
export function flexRow(v: unknown, d: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => asText(bounded(x, d + 1)))
}

/** Hace únicos los ids de una lista («a», «a» → «a», «a-2»), conservando el orden. */
export function uniquifyIDs<T extends { id: string }>(items: T[], seen: Set<string> = new Set()): T[] {
  for (const item of items) {
    if (!seen.has(item.id)) { seen.add(item.id); continue }
    let n = 2
    while (seen.has(`${item.id}-${n}`)) n += 1
    item.id = `${item.id}-${n}`
    seen.add(item.id)
  }
  return items
}

/** Escribe `v` en `out[k]` si no es undefined. */
export function put(out: JSONObject, k: string, v: JSONValue | RawNumber | undefined): void {
  if (v !== undefined) (out as Record<string, unknown>)[k] = v
}

/** Escribe una lista en `out[k]` solo si no está vacía. */
export function putNonEmpty<T>(out: JSONObject, k: string, v: T[], encode?: (x: T) => JSONValue): void {
  if (v.length) out[k] = encode ? v.map(encode) : (v as unknown as JSONValue[])
}

/**
 * Copia las claves dadas de `v` (las `undefined` se omiten; los arreglos se copian). Solo para campos de valores sueltos
 * o listas de valores sueltos: los objetos anidados se escriben con su propio codificador.
 */
export function pickKeys<T extends object>(v: T, keys: Array<keyof T>): JSONObject {
  const out: JSONObject = {}
  for (const k of keys) {
    const x = v[k] as unknown
    if (x === undefined) continue
    ;(out as Record<string, unknown>)[k as string] = Array.isArray(x) ? x.map((e) => (Array.isArray(e) ? e.slice() : e)) : x
  }
  return out
}
