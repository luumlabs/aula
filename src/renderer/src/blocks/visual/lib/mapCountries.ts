// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (el nombre de un país va en
// su pieza más grande; las piezas minúsculas no cuentan).
// Países del mapa sobre el contorno de Natural Earth: casar los de la lección con su contorno (por nombre: el de 1:50
// millones repite el id «036»), la pieza más grande (donde va su nombre), qué país hay bajo un punto (el más pequeño si
// hay varios) y el turno de preguntas de la práctica «¿Dónde está…?». Lógica pura.
import { geoArea, geoContains, type GeoPath } from 'd3-geo'
import type { Feature, GeoJsonProperties, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { MapCountry, MapMarker } from '@shared/schema/visual'
import { companionParent, countryCompanions, countryLabel, findCountry, type Country } from '@engine/geo/countries'

export type CountryFeature = Feature<Geometry, { name?: string } | null>
/** Cualquier contorno (país, región) con sus propiedades. */
export type AnyFeature = Feature<Geometry, GeoJsonProperties>

/** Un país de la lección ya casado con su ficha de la tabla. */
export interface ChosenCountry {
  /** Posición en `countries` del bloque. */
  index: number
  item: MapCountry
  country: Country
}

/** Los países de la lección que existen, sin repetir (el primero gana). */
export function resolveCountries(list: readonly MapCountry[]): ChosenCountry[] {
  const out: ChosenCountry[] = []
  const seen = new Set<string>()
  list.forEach((item, index) => {
    const country = findCountry(item.name)
    if (!country || seen.has(country.ne)) return
    seen.add(country.ne)
    out.push({ index, item, country })
  })
  return out
}

/** Contornos por nombre de Natural Earth. */
export function featuresByName(features: readonly CountryFeature[]): Map<string, CountryFeature> {
  const m = new Map<string, CountryFeature>()
  for (const f of features) {
    const n = f.properties?.name
    if (n && !m.has(n)) m.set(n, f)
  }
  return m
}

/** Los polígonos de un contorno (ninguno si no es una superficie). */
const polygons = (g: Geometry): Polygon['coordinates'][] => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])

/**
 * El contorno de un país con las partes que van con él (Somalia con Somalilandia, Chipre con el norte de la isla), salvo
 * las que la lección nombra aparte (`own`: nombres de Natural Earth de sus países).
 */
export function countryFeature(ne: string, byName: ReadonlyMap<string, CountryFeature>, own: ReadonlySet<string> = new Set()): CountryFeature | undefined {
  const f = byName.get(ne)
  if (!f) return undefined
  const parts = countryCompanions(ne).flatMap((p) => {
    const g = own.has(p) ? undefined : byName.get(p)
    return g ? [g] : []
  })
  if (!parts.length) return f
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: [f, ...parts].flatMap((x) => polygons(x.geometry)) } }
}

/** El país que se nombra al pulsar el contorno `ne`: una parte (Somalilandia) cuenta como su país, salvo que la lección la nombre aparte. */
export function tappedCountry(ne: string, own: ReadonlySet<string>): string {
  const parent = companionParent(ne)
  return parent && !own.has(ne) ? parent : ne
}

/** La pieza más grande de un país (en la esfera), como su propio contorno. */
export function biggestPiece(f: CountryFeature): Feature<Polygon> | undefined {
  const g = f.geometry
  if (g.type === 'Polygon') return { type: 'Feature', properties: {}, geometry: g }
  if (g.type !== 'MultiPolygon') return undefined
  let best: Feature<Polygon> | undefined
  let area = -1
  for (const coordinates of (g as MultiPolygon).coordinates) {
    const piece: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }
    const a = geoArea(piece)
    if (a > area) {
      area = a
      best = piece
    }
  }
  return best
}

/** Dónde va el nombre de un país en el plano: el centro de su pieza más grande, lo que mide esa pieza y la pieza. */
export function labelSpot(f: CountryFeature, path: GeoPath): { x: number; y: number; w: number; h: number; piece: Feature<Polygon> } | undefined {
  const piece = biggestPiece(f)
  if (!piece) return undefined
  const [x, y] = path.centroid(piece)
  const [[x0, y0], [x1, y1]] = path.bounds(piece)
  if (![x, y, x0, y0, x1, y1].every(Number.isFinite)) return undefined
  return { x, y, w: x1 - x0, h: y1 - y0, piece }
}

/**
 * Sitios para el nombre de un país, dentro de su pieza más grande: el centro y, si está ocupado (una chincheta en la
 * capital), algo más a un lado. `inside` dice si un punto de la pantalla cae en la pieza.
 */
export function chipCandidates(x: number, y: number, w: number, h: number, inside: (x: number, y: number) => boolean): Array<{ x: number; y: number; ax: number; ay: number }> {
  const out: Array<{ x: number; y: number; ax: number; ay: number }> = []
  for (const [fx, fy] of [[0, 0], [0, 0.22], [0, -0.22], [-0.25, 0], [0.25, 0], [-0.22, 0.22], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22], [0, 0.36], [0, -0.36]]) {
    const cx = x + fx * w, cy = y + fy * h
    if (inside(cx, cy)) out.push({ x: cx, y: cy, ax: 0.5, ay: 0.5 })
  }
  return out
}

/** El contorno (de los dados) que contiene el punto, el más pequeño si se solapan. */
export function featureAt<T extends { feature: AnyFeature; area: number }>(lon: number, lat: number, items: readonly T[]): T | undefined {
  let best: T | undefined
  for (const it of items) {
    if ((!best || it.area < best.area) && geoContains(it.feature, [lon, lat])) best = it
  }
  return best
}

export type QuizItem = { kind: 'marker'; index: number; name: string } | { kind: 'country'; ne: string; name: string }

/** Lo que pregunta la práctica: los marcadores y los países (por su nombre en la lengua del estudiante), sin repetir nombres. */
export function quizPool(markers: readonly MapMarker[], countries: readonly ChosenCountry[], lang: string): QuizItem[] {
  const out: QuizItem[] = []
  const seen = new Set<string>()
  const key = (s: string): string => s.trim().toLowerCase()
  markers.forEach((m, index) => {
    if (!m.title.trim() || seen.has(key(m.title))) return
    seen.add(key(m.title))
    out.push({ kind: 'marker', index, name: m.title })
  })
  for (const c of countries) {
    const name = countryLabel(c.country, lang)
    if (seen.has(key(name))) continue
    seen.add(key(name))
    out.push({ kind: 'country', ne: c.country.ne, name })
  }
  return out
}
