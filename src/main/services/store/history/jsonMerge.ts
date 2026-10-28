// Deshacer sin pisar lo de otros (port de StudyModel/History/JSONMerge.swift).
//
// Deshacer un cambio de Aula es aplicar al revés la diferencia «antes → después» sobre lo que hay AHORA en el archivo (una
// fusión a tres bandas). Si nadie tocó el archivo después, sale exactamente el «antes». Si el estudiante tocó otras partes,
// se respetan; si tocó LA MISMA parte que cambió Aula, gana lo suyo y se avisa (`conflicts`).
//   · objetos: clave a clave;
//   · listas de objetos con «id»: elemento a elemento por id, y lo que Aula quitó vuelve a su sitio;
//   · listas de valores sueltos sin repetir: como conjuntos ordenados;
//   · si Aula solo reordenó una de esas listas, vuelve el orden de antes (si otro la reordenó después, se queda y se avisa);
//   · lo demás (textos, números, listas sin id): entero.
// Las marcas de tiempo y contadores internos (`VOLATILE_KEYS`) no cuentan como cambio de nadie.
import { compactJSON, isJSONObject, RawNumber } from '@engine/base/json'

/** Claves que cambian solas (fechas de guardado, contadores de uso): no son ediciones de nadie. */
export const VOLATILE_KEYS: ReadonlySet<string> = new Set(['updated', 'updatedAt', 'revision', 'lastUsedAt', 'uses', 'schema'])

type Value = unknown
type Obj = Record<string, unknown>

export interface MergeResult {
  /** undefined = el valor no debe existir (clave ausente o archivo borrado). */
  value: Value | undefined
  /** Dónde se mantuvo lo de otro en vez de deshacer lo de Aula («$.skills[id=suma].title»). */
  conflicts: string[]
}

export function strip(v: Value): Value {
  if (Array.isArray(v)) return v.map(strip)
  if (isJSONObject(v)) {
    const out: Obj = {}
    for (const [k, x] of Object.entries(v)) if (!VOLATILE_KEYS.has(k)) out[k] = strip(x)
    return out
  }
  return v
}

/** ¿Iguales sin contar las claves volátiles? (undefined = ausente) */
export function same(x: Value | undefined, y: Value | undefined): boolean {
  if (x === undefined || y === undefined) return x === undefined && y === undefined
  return compactJSON(strip(x)) === compactJSON(strip(y))
}

/** Deshace sobre `current` el cambio `before → after`. undefined = ausente. */
export function revert(current: Value | undefined, after: Value | undefined, before: Value | undefined, path = '$'): MergeResult {
  if (same(current, after)) return { value: before, conflicts: [] } // nadie lo tocó después: vuelve tal cual
  if (same(after, before)) return { value: current, conflicts: [] } // Aula no cambió esto: se queda lo de ahora
  if (same(current, before)) return { value: current, conflicts: [] } // ya está como antes
  // una lista que no existía antes es una lista vacía (Aula la creó; lo que añadió otro después se queda)
  if (before === undefined && Array.isArray(current) && Array.isArray(after)) return revert(current, after, [], path)
  if (isJSONObject(current) && isJSONObject(after) && isJSONObject(before)) return revertObject(current, after, before, path)
  if (Array.isArray(current) && Array.isArray(after) && Array.isArray(before)) {
    return revertKeyedArray(current, after, before, path) ?? { value: current, conflicts: [path] }
  }
  return { value: current, conflicts: [path] }
}

function revertObject(c: Obj, a: Obj, b: Obj, path: string): MergeResult {
  const out: Obj = {}
  const conflicts: string[] = []
  const keys = [...new Set([...Object.keys(c), ...Object.keys(a), ...Object.keys(b)])].sort()
  for (const key of keys) {
    if (VOLATILE_KEYS.has(key)) {
      const v = key in c ? c[key] : b[key]
      if (v !== undefined) out[key] = v
      continue
    }
    const r = revert(c[key], a[key], b[key], `${path}.${key}`)
    if (r.value !== undefined) out[key] = r.value
    conflicts.push(...r.conflicts)
  }
  return { value: out, conflicts }
}

/** Identidad de cada elemento: el «id» de un objeto o el propio valor. undefined = la lista no se puede fusionar así. */
function identities(list: Value[]): string[] | undefined {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const v of list) {
    let id: string | undefined
    if (isJSONObject(v)) id = typeof v.id === 'string' ? 'o:' + v.id : undefined
    else if (typeof v === 'string') id = 's:' + v
    else if (typeof v === 'number') id = 'n:' + String(v)
    else if (v instanceof RawNumber) id = 'n:' + v.text
    if (id === undefined || seen.has(id)) return undefined
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function common(x: string[], y: string[]): string[] {
  const ys = new Set(y)
  return x.filter((e) => ys.has(e))
}

const sameOrder = (x: string[], y: string[]): boolean => x.length === y.length && x.every((e, i) => e === y[i])

function revertKeyedArray(c: Value[], a: Value[], b: Value[], path: string): MergeResult | undefined {
  const ci = identities(c), ai = identities(a), bi = identities(b)
  if (!ci || !ai || !bi) return undefined
  // todas las listas deben ser del mismo tipo de elemento (objetos con id o valores sueltos)
  const kinds = new Set([...ci, ...ai, ...bi].map((id) => id.slice(0, 2)))
  if (!(kinds.size <= 1 || [...kinds].every((k) => k === 's:' || k === 'n:'))) return undefined
  const C = new Map(ci.map((id, i) => [id, c[i]])), A = new Map(ai.map((id, i) => [id, a[i]])), B = new Map(bi.map((id, i) => [id, b[i]]))
  const result = new Map<string, Value>()
  const conflicts: string[] = []
  const all = [...ci, ...ai.filter((id) => !C.has(id)), ...bi.filter((id) => !C.has(id) && !A.has(id))]
  for (const id of all) {
    const label = id.startsWith('o:') ? `[id=${id.slice(2)}]` : `[${id.slice(2)}]`
    const r = revert(C.get(id), A.get(id), B.get(id), path + label)
    if (r.value !== undefined) result.set(id, r.value)
    conflicts.push(...r.conflicts)
  }
  // orden: el de ahora; lo que vuelve (estaba antes y Aula lo quitó) se coloca tras su vecino de antes
  let order = ci.filter((id) => result.has(id))
  bi.forEach((id, idx) => {
    if (!result.has(id) || order.includes(id)) return
    const previous = bi.slice(0, idx).reverse().find((p) => order.includes(p))
    if (previous !== undefined) order.splice(order.indexOf(previous) + 1, 0, id)
    else order.unshift(id)
  })
  for (const id of all) if (result.has(id) && !order.includes(id)) order.push(id)
  // Aula reordenó la lista: si el orden de ahora sigue siendo el suyo, vuelve el de antes; si otro lo cambió, se avisa
  if (!sameOrder(common(ai, bi), common(bi, ai))) {
    if (sameOrder(common(ci, ai), common(ai, ci))) {
      const rebuilt = bi.filter((id) => result.has(id))
      order.forEach((id, idx) => {
        if (rebuilt.includes(id)) return
        const previous = order.slice(0, idx).reverse().find((p) => rebuilt.includes(p))
        if (previous !== undefined) rebuilt.splice(rebuilt.indexOf(previous) + 1, 0, id)
        else rebuilt.unshift(id)
      })
      order = rebuilt
    } else {
      conflicts.push(path + '[orden]')
    }
  }
  return { value: order.map((id) => result.get(id)), conflicts }
}

export const JSONMerge = { volatileKeys: VOLATILE_KEYS, revert, same, strip }
