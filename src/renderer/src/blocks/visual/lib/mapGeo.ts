// Geometría del mapa (port de MapGeometry en StudyUI/Blocks/Map/MapBlockView.swift) sobre d3-geo: coordenadas válidas, encuadre
// del contenido, punto medio de una ruta, región que contiene un punto y la proyección ajustada a la ventana. Lógica pura.
// Partes (el encuadre por países y por nombre, la línea de cambio de fecha) adaptadas de Sketchy
// (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (regionBox).
import { geoArea, geoMercator, geoNaturalEarth1, type GeoProjection } from 'd3-geo'
import type { Feature, LineString, MultiPoint, Polygon } from 'geojson'
import type { MapBlock, MapRegion, MapRoute } from '@shared/schema/visual'
import { mapCoordinates } from '@shared/schema/visual'
import { findCountry, regionBox, type Country, type GeoBox } from '@engine/geo/countries'

/** Encuadre en grados; lonMax puede pasar de 180 cuando cruza la línea de cambio de fecha (Rusia, Fiyi). */
export type GeoBounds = GeoBox

export const validCoord = (lat: number, lon: number): boolean => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180

/** Solo coordenadas válidas (un NaN o una latitud de 1e9 no deben llegar al dibujo). */
export function sanitizeMap(b: MapBlock): MapBlock {
  const pts = (p: number[][]): number[][] => p.filter((q) => q.length >= 2 && validCoord(q[0], q[1])).slice(0, 2000)
  const m: MapBlock = {
    ...b,
    markers: b.markers.filter((k) => validCoord(k.lat, k.lon)),
    regions: b.regions.map((r) => ({ ...r, points: pts(r.points) })).filter((r) => r.points.length >= 3),
    routes: b.routes.map((r) => ({ ...r, points: pts(r.points) })).filter((r) => r.points.length >= 2)
  }
  if (m.lat !== undefined && m.lon !== undefined && !validCoord(m.lat, m.lon)) { delete m.lat; delete m.lon }
  if (m.span !== undefined && !(Number.isFinite(m.span) && m.span > 0 && m.span <= 180)) delete m.span
  return m
}

/** Los países del mapa que existen (los desconocidos no se dibujan; el validador ya avisa), sin repetir. */
export function mapCountries(b: MapBlock): Country[] {
  const out: Country[] = []
  for (const c of b.countries) {
    const found = findCountry(c.name)
    if (found && !out.includes(found)) out.push(found)
  }
  return out
}

/** Intervalos de longitud [oeste, este] (este > 180 si cruza la línea de cambio de fecha). */
export type LonSpan = [number, number]

/**
 * Unión de longitudes de siempre: tal cual o con el oeste pasado a +360°, la más estrecha (puntos en Kamchatka y Alaska no
 * encuadran el mundo entero).
 */
function usualUnion(spans: readonly LonSpan[]): LonSpan {
  // tal cual: lo que cruza la línea de cambio de fecha ocupa de −180 a 180
  const plain = spans.map(([w, e]): LonSpan => (e > 180 ? [-180, 180] : [w, e]))
  const a: LonSpan = [Math.min(...plain.map((s) => s[0])), Math.max(...plain.map((s) => s[1]))]
  // desplazado: todo en 0…360 (lo que cruza el meridiano 0 ya no cabe)
  const shifted = spans.map(([w, e]): LonSpan => (e <= 0 ? [w + 360, e + 360] : w < 0 ? [0, 360] : [w, e]))
  const b: LonSpan = [Math.min(...shifted.map((s) => s[0])), Math.max(...shifted.map((s) => s[1]))]
  if (b[1] - b[0] < a[1] - a[0] - 1e-9) return b[0] >= 180 ? [b[0] - 360, b[1] - 360] : b
  return a
}

/** Ancho del encuadre que sale de un arco (mapBounds deja un 20 % de aire a cada lado; como mucho, la vuelta entera). */
const framedWidth = (s: LonSpan): number => Math.min(360, Math.max(3, s[1] - s[0]) * 1.4)

/**
 * Unión de longitudes: la de siempre (cortando por la línea de cambio de fecha o por el meridiano 0) salvo que el arco más
 * corto acerque de verdad el mapa (Francia y Rusia: de Bretaña a Chukotka, no el mundo entero). Un mapamundi (el G7, la
 * Commonwealth) sigue centrado como siempre en vez de girar hacia el Pacífico.
 */
export function lonUnion(spans: readonly LonSpan[]): LonSpan {
  if (!spans.length) return [-180, 180]
  const usual = usualUnion(spans)
  const arc = shortestArc(spans)
  return framedWidth(arc) * 1.1 < framedWidth(usual) ? arc : usual
}

/**
 * El arco más corto que cubre todos los intervalos, dando la vuelta por donde haga falta: el círculo menos su mayor hueco
 * vacío. El oeste queda en −180…180 y el este pasa de 180 si el arco cruza la línea de cambio de fecha.
 */
export function shortestArc(spans: readonly LonSpan[]): LonSpan {
  if (!spans.length) return [-180, 180]
  // cada intervalo, con su oeste en −180…180 y su largo (como mucho la vuelta entera)
  const segs = spans
    .map(([w, e]): LonSpan => {
      const s = w >= -180 && w < 180 ? w : ((((w + 180) % 360) + 360) % 360) - 180
      return [s, s + Math.max(0, Math.min(360, e - w))]
    })
    .sort((a, c) => a[0] - c[0])
  const merged: LonSpan[] = []
  for (const [s, e] of segs) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  // lo que pasa de 180 vuelve a empezar por el oeste: se come los primeros tramos que alcanza
  const tail = merged[merged.length - 1]
  while (merged.length > 1 && merged[0][0] + 360 <= tail[1]) {
    tail[1] = Math.max(tail[1], merged[0][1] + 360)
    merged.shift()
  }
  if (tail[1] - tail[0] >= 360) return [-180, 180]
  // el mayor hueco (el de la vuelta, entre el último y el primero, o uno entre dos tramos): el arco es todo lo demás
  let gap = merged[0][0] + 360 - tail[1]
  let after = 0
  for (let i = 1; i < merged.length; i++) {
    const g = merged[i][0] - merged[i - 1][1]
    if (g > gap) { gap = g; after = i }
  }
  return after === 0 ? [merged[0][0], tail[1]] : [merged[after][0], merged[after - 1][1] + 360]
}

/** Recuadro de todo el contenido (marcadores, regiones, rutas y, si se piden, países), sin margen, o undefined si no hay nada. */
export function contentBox(b: MapBlock, withCountries = true): GeoBounds | undefined {
  const pts = mapCoordinates(b).filter(([la, lo]) => validCoord(la, lo))
  const boxes = withCountries ? mapCountries(b).map((c) => c.bbox) : []
  if (!pts.length && !boxes.length) return undefined
  const lats = [...pts.map((p) => p[0]), ...boxes.flatMap((x) => [x[1], x[3]])]
  const [lonMin, lonMax] = lonUnion([...pts.map((p): LonSpan => [p[1], p[1]]), ...boxes.map((x): LonSpan => [x[0], x[2]])])
  return { latMin: Math.min(...lats), latMax: Math.max(...lats), lonMin, lonMax }
}

/** Une dos recuadros (en el mismo sentido de longitudes que el primero). */
function unionBox(a: GeoBounds, c: GeoBounds): GeoBounds {
  const [lonMin, lonMax] = lonUnion([[a.lonMin, a.lonMax], [c.lonMin, c.lonMax]])
  return { latMin: Math.min(a.latMin, c.latMin), latMax: Math.max(a.latMax, c.latMax), lonMin, lonMax }
}

const clampLat = (g: GeoBounds): GeoBounds => ({ ...g, latMin: Math.max(-85, g.latMin), latMax: Math.min(85, g.latMax) })

const RAD = Math.PI / 180
const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2))
const mercLat = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD

/**
 * Margen de latitud medido en el plano de Mercator (la proyección de las vistas de una región): un 15 % de alto. En grados
 * daría un norte enorme (Finlandia hasta 80° estiraba el encuadre hasta enseñar medio mundo).
 */
export function padLatitudes(latMin: number, latMax: number, frac = 0.15): [number, number] {
  const y0 = mercY(latMin), y1 = mercY(latMax)
  const mid = (latMin + latMax) / 2
  const pad = Math.max((y1 - y0) * frac, (1 * RAD) / Math.max(0.1, Math.cos(mid * RAD)))
  return [Math.max(-85, mercLat(y0 - pad)), Math.min(85, mercLat(y1 + pad))]
}

/**
 * Encuadre, por este orden: centro + extensión escritos; un encuadre con nombre (`region`) unido al contenido para que no
 * se corte nada; todo el contenido con margen; o el mundo.
 */
export function mapBounds(b: MapBlock): GeoBounds {
  if (b.lat !== undefined && b.lon !== undefined && b.span !== undefined && b.span > 0) {
    const half = Math.min(90, b.span / 2)
    const halfLon = Math.min(180, (half / Math.max(0.2, Math.cos((b.lat * Math.PI) / 180))) * 1.4)
    return { latMin: Math.max(-85, b.lat - half), latMax: Math.min(85, b.lat + half), lonMin: Math.max(-180, b.lon - halfLon), lonMax: Math.min(180, b.lon + halfLon) }
  }
  const named = b.region ? regionBox(b.region) : undefined
  // con un encuadre con nombre, los países pueden salirse (Rusia en «europe»); los puntos, no
  const content = contentBox(b, !named)
  if (named) {
    if (!content) return clampLat(named)
    // lo que se sale del encuadre con nombre entra con un poco de aire (no en el mismo borde)
    const m = Math.max(1, (content.latMax - content.latMin) * 0.08)
    const wraps = content.lonMax > 180
    const lonMin = wraps ? content.lonMin - m : Math.max(-180, content.lonMin - m), lonMax = wraps ? content.lonMax + m : Math.min(180, content.lonMax + m)
    return clampLat(unionBox(named, { latMin: content.latMin - m, latMax: content.latMax + m, lonMin, lonMax }))
  }
  if (!content) return { latMin: -58, latMax: 78, lonMin: -180, lonMax: 180 }
  let { latMin, latMax, lonMin, lonMax } = content
  const dLon = Math.max(3, lonMax - lonMin)
  ;[latMin, latMax] = padLatitudes(latMin, latMax)
  const wraps = lonMax > 180
  // si casi da la vuelta, el aire que queda hasta los 360° se reparte a los dos lados (si no, el borde este se cortaría:
  // el este de Brasil en un mapa de los BRICS aparecía al otro lado)
  const padLon = wraps ? Math.min(dLon * 0.2, Math.max(0, (360 - dLon) / 2)) : dLon * 0.2
  lonMin = wraps ? lonMin - padLon : Math.max(-180, lonMin - padLon)
  lonMax = wraps ? lonMax + padLon : Math.min(180, lonMax + padLon)
  return { latMin, latMax, lonMin, lonMax }
}

/** ¿Vista del mundo (o casi)? Entonces la proyección Natural Earth; si no, Mercator (la de los atlas escolares). */
export const isWorldView = (g: GeoBounds): boolean => g.lonMax - g.lonMin > 150 || g.latMax - g.latMin > 100

/** Alto / ancho natural del encuadre en el plano (Mercator), para que un encuadre alto (de Canarias a Finlandia) no quede enano. */
export function boundsAspect(g: GeoBounds): number {
  if (isWorldView(g)) return 0.52
  const w = Math.max(1e-6, (g.lonMax - g.lonMin) * RAD)
  return (mercY(g.latMax) - mercY(g.latMin)) / w
}

/** ¿Hace falta el contorno detallado (1:50 millones)? En vistas de una región o un país, o si hay un país pequeño (Malta). */
export const needsDetail = (g: GeoBounds, countries: readonly Country[] = []): boolean =>
  (g.lonMax - g.lonMin < 45 && g.latMax - g.latMin < 35) || countries.some((c) => c.small)

/** Proyección ajustada para que el encuadre llene la ventana con un margen. */
export function fitProjection(g: GeoBounds, width: number, height: number, pad = 18): GeoProjection {
  const world = isWorldView(g)
  const proj = world ? geoNaturalEarth1() : geoMercator()
  // el encuadre como puntos de su borde (fitExtent mira los límites del objeto)
  const ring: Array<[number, number]> = []
  const n = 8
  for (let i = 0; i <= n; i++) {
    const lon = g.lonMin + ((g.lonMax - g.lonMin) * i) / n
    ring.push([lon, g.latMin], [lon, g.latMax])
    const lat = g.latMin + ((g.latMax - g.latMin) * i) / n
    ring.push([g.lonMin, lat], [g.lonMax, lat])
  }
  const target: Feature<MultiPoint> = { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: ring } }
  // centrado en su meridiano (también el mundo si el encuadre cruza la línea de cambio de fecha: Rusia, el Pacífico)
  if (!world || g.lonMax > 180) proj.center([0, 0]).rotate([-(g.lonMin + g.lonMax) / 2, 0])
  proj.fitExtent([[pad, pad], [Math.max(pad + 10, width - pad), Math.max(pad + 10, height - pad)]], target)
  return proj
}

/** Polígono de una región en GeoJSON ([lon, lat]), con el sentido que d3 entiende como «dentro» (si no, sería el resto del mundo). */
export function regionFeature(r: MapRegion): Feature<Polygon> {
  const ring = r.points.map((p) => [p[1], p[0]] as [number, number])
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0])
  const f: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
  if (geoArea(f) > 2 * Math.PI) f.geometry.coordinates = [ring.slice().reverse()]
  return f
}

export function routeFeature(r: MapRoute): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.points.map((p) => [p[1], p[0]]) } }
}

/** Punto medio (por longitud recorrida) de una ruta [[lat, lon], …], para poner su nombre. */
export function routeMidpoint(pts: number[][]): [number, number] | undefined {
  const p = pts.filter((q) => q.length >= 2).map((q) => [q[0], q[1]] as [number, number])
  if (!p.length) return undefined
  if (p.length === 1) return p[0]
  const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]))
  let left = seg.reduce((s, d) => s + d, 0) / 2
  for (let k = 0; k < seg.length; k++) {
    const d = seg[k]
    if (left <= d && d > 0) {
      const t = left / d
      return [p[k][0] + (p[k + 1][0] - p[k][0]) * t, p[k][1] + (p[k + 1][1] - p[k][1]) * t]
    }
    left -= d
  }
  return p[p.length - 1]
}

/** Región que contiene el punto (lat, lon), la más pequeña si se solapan (prueba del rayo sobre el polígono). */
export function regionIndexAt(lat: number, lon: number, regions: MapRegion[]): number | undefined {
  let best: [number, number] | undefined
  regions.forEach((r, i) => {
    const poly = r.points.filter((q) => q.length >= 2)
    if (poly.length < 3) return
    let inside = false
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [yi, xi] = poly[a], [yj, xj] = poly[b]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (!inside) return
    let area = 0
    for (let a = 0; a < poly.length; a++) {
      const p = poly[a], q = poly[(a + 1) % poly.length]
      area += p[1] * q[0] - q[1] * p[0]
    }
    area = Math.abs(area) / 2
    if (!best || area < best[1]) best = [i, area]
  })
  return best?.[0]
}
