// Arregla desviaciones comunes del JSON de un dibujo antes de decodificarlo (lo llama el normalizador de contenido): nombres
// de Sketchy o de otras herramientas (blob, shape, una curva de muchos puntos), un objeto escrito como tipo ({"kind":"car"}),
// el tamaño de un objeto en `size`, deslizadores con otros nombres y movimientos escritos sueltos. Conservador.
import { isJSONObject, type JSONObject, type JSONValue } from '@engine/base/json'
import { isObjectName } from './objects'

type O = JSONObject

const obj = (v: JSONValue | undefined): O | undefined => (isJSONObject(v) ? v : undefined)
const arr = (v: JSONValue | undefined): JSONValue[] | undefined => (Array.isArray(v) ? v : undefined)
const strOf = (v: JSONValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined)

/** Nombres de tipo que se entienden como uno de Aula. */
const KIND_ALIASES: Readonly<Record<string, string>> = {
  shape: 'polygon', blob: 'polygon', poly: 'polygon', triangle: 'polygon',
  path: 'polyline', segment: 'line', vector: 'arrow', point: 'dot', label: 'text',
  dimension: 'measure', cota: 'measure', ruler: 'measure', axis: 'axes', ejes: 'axes', rejilla: 'grid'
}

function moveKey(o: O, from: readonly string[], to: string): void {
  if (o[to] !== undefined) return
  for (const f of from) if (o[f] !== undefined) { o[to] = o[f]; delete o[f]; return }
}

/** Un elemento del dibujo. */
export function normalizeDrawItem(v: JSONValue): JSONValue {
  const src = obj(v)
  if (!src) return v
  const o: O = { ...src }
  if (o.kind === undefined && strOf(o.type) !== undefined) { o.kind = o.type; delete o.type }
  const raw = strOf(o.kind)?.trim()
  if (raw !== undefined) {
    const k = raw.toLowerCase()
    const pts = arr(o.points)
    if (k === 'blob' || k === 'smooth') { o.kind = 'polygon'; if (o.smooth === undefined) o.smooth = true }
    else if (k === 'curve' && pts && pts.length > 3) { o.kind = 'polyline'; if (o.smooth === undefined) o.smooth = true }
    else if (k !== 'object' && isObjectName(k) && o.object === undefined) { o.kind = 'object'; o.object = k }
    else if (Object.hasOwn(KIND_ALIASES, k)) o.kind = KIND_ALIASES[k]
    else if (k === 'rightangle' || k === 'right_angle') o.kind = 'rightAngle'
  }
  // un objeto (también como lo guarda Aula para las versiones antiguas: un texto con `object`)
  // (un `object` vacío no cuenta: al leerlo se descarta y el texto sigue siendo texto)
  if (o.kind === 'object' || (o.kind === 'text' && !!strOf(o.object)?.trim())) {
    moveKey(o, ['what', 'name_of_object', 'shape'], 'object')
    if (strOf(o.object)) o.object = strOf(o.object)!.trim().toLowerCase()
    // el tamaño de un objeto es su ancho (un `size` pequeño es la letra de la etiqueta)
    const size = typeof o.size === 'number' ? o.size : undefined
    if (o.w === undefined && o.h === undefined && size !== undefined && size > 24) { o.w = size; delete o.size }
  }
  // movimiento escrito suelto: "move":{dx,dy}, "along":"orbit","at":"t/T"
  if (o.motion === undefined) {
    const m: O = { ...(obj(o.move) ?? obj(o.animate) ?? {}) }
    if (strOf(o.along) !== undefined) { m.along = o.along; delete o.along; if (o.at !== undefined) { m.at = o.at; delete o.at } }
    if (Object.keys(m).length) { o.motion = m; delete o.move; delete o.animate }
  }
  return o
}

/** Deslizadores con otros nombres de campo («symbol», «range», «default»). */
function normalizeParam(v: JSONValue): JSONValue {
  const po = obj(v)
  if (!po) return v
  const o: O = { ...po }
  moveKey(o, ['symbol', 'var', 'id'], 'name')
  const r = arr(o.range)
  if (o.min === undefined && r && r.length >= 2) { o.min = r[0]; o.max = r[1]; delete o.range }
  moveKey(o, ['default', 'initial'], 'value')
  return o
}

/** Un dibujo (bloque `drawing` o figura dentro de otro bloque). Devuelve una copia arreglada. */
export function normalizeDrawingJSON(v: O): O {
  const o: O = { ...v }
  moveKey(o, ['shapes', 'elements', 'primitives'], 'items')
  moveKey(o, ['sliders', 'variables', 'parameters'], 'params')
  moveKey(o, ['clock', 'animation'], 'time')
  const items = arr(o.items)
  if (items) o.items = items.map(normalizeDrawItem)
  const ps = arr(o.params)
  if (ps) o.params = ps.map(normalizeParam)
  const steps = arr(o.steps)
  if (steps) o.steps = steps.map((s) => (typeof s === 'string' ? { md: s } : s))
  return o
}
