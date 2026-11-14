// Arreglos del JSON de un mapa antes de decodificarlo: países escritos con otros nombres de campo (o como objeto
// {"España": 47.4}), regiones que en realidad son un país de hoy sin contorno, y extremos de las rutas nombrados por el
// título de un marcador («from»: "Palos", «to»: "Guanahaní"). Conservador: lo que no entiende lo deja para el validador.
import { asDouble, isJSONObject, type JSONObject, type JSONValue } from '@engine/base/json'
import { findCountry } from '@engine/geo/countries'

type O = JSONObject

const COUNTRY_KEYS = ['states', 'nations', 'países', 'paises', 'highlightCountries', 'highlightedCountries', 'country']

/** Clave de un título para compararlo («Guanahaní» = «guanahani»). */
const titleKey = (s: string): string => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Países como lista: una cadena, un objeto {nombre: valor|color|{…}} o una lista. */
function countryList(v: JSONValue): JSONValue[] | undefined {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(/[,;]/).map((x) => x.trim()).filter((x) => x !== '')
  if (!isJSONObject(v)) return undefined
  // un solo país escrito como objeto
  if (typeof v.name === 'string' || typeof v.country === 'string' || typeof v.iso === 'string') return [v]
  return Object.entries(v).map(([name, x]): JSONValue => {
    if (typeof x === 'number') return { name, value: x }
    // «68,2» es un valor (lo lee el decodificador); «teal», un color
    if (typeof x === 'string') return /^\s*[+-]?\d+([.,]\d+)?\s*$/.test(x) ? { name, value: x } : { name, color: x }
    if (isJSONObject(x)) return { ...x, name }
    return name
  })
}

/** [lat, lon] del marcador con ese título, o undefined. */
function markerPoint(markers: JSONValue[], title: string): [number, number] | undefined {
  const k = titleKey(title)
  for (const m of markers) {
    if (!isJSONObject(m)) continue
    const t = [m.title, m.name, m.label].find((x): x is string => typeof x === 'string')
    if (t === undefined || titleKey(t) !== k) continue
    const lat = asDouble(m.lat ?? null), lon = asDouble(m.lon ?? m.lng ?? m.longitude ?? null)
    if (lat !== undefined && lon !== undefined) return [lat, lon]
  }
  return undefined
}

/** Un extremo de ruta: [lat, lon], el título de un marcador o {lat, lon}. */
function routeEnd(v: JSONValue | undefined, markers: JSONValue[]): JSONValue | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'string') return markerPoint(markers, v) ?? v
  if (isJSONObject(v)) {
    const lat = asDouble(v.lat ?? null), lon = asDouble(v.lon ?? v.lng ?? null)
    if (lat !== undefined && lon !== undefined) return [lat, lon]
    const t = [v.title, v.name].find((x): x is string => typeof x === 'string')
    return t !== undefined ? markerPoint(markers, t) ?? v : v
  }
  return v
}

/** Arreglos de un bloque `map` (ya con sus campos principales movidos a markers/regions/routes). */
export function normalizeMapExtras(o: O): void {
  if (o.countries === undefined) {
    for (const k of COUNTRY_KEYS) if (o[k] !== undefined) { o.countries = o[k]; delete o[k]; break }
  }
  if (o.unit === undefined && typeof o.units === 'string') { o.unit = o.units; delete o.units }
  if (o.countries !== undefined) {
    const list = countryList(o.countries)
    if (list) o.countries = list
  }
  // una región que nombra un país de hoy y no trae contorno es ese país, con su frontera exacta
  if (Array.isArray(o.regions)) {
    const keep: JSONValue[] = []
    const moved: JSONValue[] = []
    for (const r of o.regions) {
      if (isJSONObject(r)) {
        const name = typeof r.name === 'string' ? r.name : typeof r.title === 'string' ? r.title : undefined
        const pts = Array.isArray(r.points) ? r.points : Array.isArray(r.polygon) ? r.polygon : []
        if (name !== undefined && pts.length < 3 && findCountry(name)) {
          const c: O = { name }
          for (const k of ['color', 'label', 'md', 'detail', 'value']) if (r[k] !== undefined) c[k] = r[k]
          moved.push(c)
          continue
        }
      }
      keep.push(r)
    }
    if (moved.length) {
      o.regions = keep
      o.countries = [...(Array.isArray(o.countries) ? o.countries : []), ...moved]
    }
  }
  // extremos de las rutas por el título de un marcador
  const markers = Array.isArray(o.markers) ? o.markers : []
  if (Array.isArray(o.routes)) {
    o.routes = o.routes.map((r) => {
      if (!isJSONObject(r)) return r
      const q: O = { ...r }
      if (q.points === undefined && (q.from !== undefined || q.to !== undefined)) {
        const a = routeEnd(q.from, markers), b = routeEnd(q.to, markers)
        if (Array.isArray(a) && Array.isArray(b)) {
          q.points = [a, b]
          delete q.from
          delete q.to
        }
      } else if (Array.isArray(q.points) && q.points.some((p) => typeof p === 'string' || isJSONObject(p))) {
        const pts = q.points.map((p) => routeEnd(p, markers) ?? p)
        if (pts.every(Array.isArray)) q.points = pts
      }
      return q
    })
  }
}
