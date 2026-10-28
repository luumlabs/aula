// Lectura y escritura de los JSON del curso: claves ordenadas, legibles y escritura atómica (como `AtomicFile` de Swift).
// Los archivos importantes guardan su versión anterior (`.<nombre>.bak`) y se leen con ella si el principal está dañado.
// Al reescribir, las claves de primer nivel que esta versión no conoce (las escribió una versión más nueva de Aula u otro
// programa) se conservan: abrir y guardar un curso nunca pierde datos que no entiende.
import { existsSync, readFileSync } from 'node:fs'
import { isJSONObject, parseJSON, stringifyJSON } from '@engine/base/json'
import { readWithBackup, writeFileAtomic, type AtomicWriteOptions, type BackupRead } from '../fs'

/** Bytes de un valor JSON como los guarda Aula (claves ordenadas, legible). */
export function jsonBytes(value: unknown, pretty = true): Buffer {
  return Buffer.from(stringifyJSON(value, { pretty, sortKeys: true }), 'utf8')
}

/** Lee y analiza un JSON (conserva los enteros grandes). Lanza si no existe o no es JSON. */
export function readJSONFile(file: string): unknown {
  return parseJSON(readFileSync(file, 'utf8'))
}

/** Como `readJSONFile`, pero undefined si no existe o no se puede leer. */
export function tryReadJSONFile(file: string): unknown {
  if (!existsSync(file)) return undefined
  try {
    return readJSONFile(file)
  } catch {
    return undefined
  }
}

export function writeJSONFile(file: string, value: unknown, pretty = true, opts: AtomicWriteOptions = {}): void {
  writeFileAtomic(file, jsonBytes(value, pretty), opts)
}

/** Lee y decodifica `file`; si está dañado, usa su copia anterior (y deja una copia del dañado). undefined si ninguna sirve. */
export function readDecodedWithBackup<T>(file: string, decode: (raw: unknown) => T): BackupRead<T> | undefined {
  return readWithBackup(file, (text) => decode(parseJSON(text)))
}

/**
 * `encoded` más las claves de primer nivel de `previous` que esta versión no conoce. Una clave es desconocida si estaba en el
 * archivo y desaparece al leerlo y volver a escribirlo (`roundTrip`); las que sí conoce y ya no están se quitaron a propósito.
 */
export function keepUnknownKeys(encoded: unknown, previous: unknown, roundTrip: (raw: unknown) => unknown): unknown {
  if (!isJSONObject(encoded) || !isJSONObject(previous)) return encoded
  let known: unknown
  try { known = roundTrip(previous) } catch { return encoded }
  if (!isJSONObject(known)) return encoded
  const extra = Object.keys(previous).filter((k) => !(k in known) && !(k in encoded))
  if (!extra.length) return encoded
  const out: Record<string, unknown> = { ...encoded }
  for (const k of extra) out[k] = previous[k]
  return out
}

/** Lo que hay ahora en disco como JSON (undefined si no existe o no se entiende). */
export function currentJSON(bytes: Buffer | null): unknown {
  if (!bytes) return undefined
  try { return parseJSON(bytes.toString('utf8')) } catch { return undefined }
}

/** Contenido de un archivo, o null si no existe. */
export function readBytesOrNull(file: string): Buffer | null {
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}
