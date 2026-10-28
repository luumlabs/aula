// Geometría del mapa (port de MapGeometry en StudyUI/Blocks/Map/MapBlockView.swift) sobre d3-geo: coordenadas válidas, encuadre
// del contenido, punto medio de una ruta, región que contiene un punto y la proyección ajustada a la ventana. Lógica pura.
import { geoArea, geoMercator, geoNaturalEarth1, type GeoProjection } from 'd3-geo'
import type { Feature, LineString, MultiPoint, Polygon } from 'geojson'
import type { MapBlock, MapRegion, MapRoute } from '@shared/schema/visual'
import { mapCoordinates } from '@shared/schema/visual'

export interface GeoBounds { latMin: number; latMax: number; lonMin: number; lonMax: number }

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

/** Encuadre: centro + extensión escritos, o todo el contenido con margen, o el mundo. */
export function mapBounds(b: MapBlock): GeoBounds {
  if (b.lat !== undefined && b.lon !== undefined && b.span !== undefined && b.span > 0) {
    const half = Math.min(90, b.span / 2)
    const halfLon = Math.min(180, (half / Math.max(0.2, Math.cos((b.lat * Math.PI) / 180))) * 1.4)
    return { latMin: Math.max(-85, b.lat - half), latMax: Math.min(85, b.lat + half), lonMin: Math.max(-180, b.lon - halfLon), lonMax: Math.min(180, b.lon + halfLon) }
  }
  const pts = mapCoordinates(b).filter(([la, lo]) => validCoord(la, lo))
  if (!pts.length) return { latMin: -58, latMax: 78, lonMin: -180, lonMax: 180 }
  let latMin = Math.min(...pts.map((p) => p[0])), latMax = Math.max(...pts.map((p) => p[0]))
  let lonMin = Math.min(...pts.map((p) => p[1])), lonMax = Math.max(...pts.map((p) => p[1]))
  const dLat = Math.max(2, latMax - latMin), dLon = Math.max(3, lonMax - lonMin)
  latMin = Math.max(-85, latMin - dLat * 0.25)
  latMax = Math.min(85, latMax + dLat * 0.25)
  lonMin = Math.max(-180, lonMin - dLon * 0.2)
  lonMax = Math.min(180, lonMax + dLon * 0.2)
  return { latMin, latMax, lonMin, lonMax }
}

/** ¿Vista del mundo (o casi)? Entonces la proyección Natural Earth; si no, Mercator (la de los atlas escolares). */
export const isWorldView = (g: GeoBounds): boolean => g.lonMax - g.lonMin > 150 || g.latMax - g.latMin > 100

/** ¿Hace falta el contorno detallado (1:50 millones)? En vistas de una región o un país. */
export const needsDetail = (g: GeoBounds): boolean => g.lonMax - g.lonMin < 45 && g.latMax - g.latMin < 35

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
  if (!world) proj.center([0, 0]).rotate([-(g.lonMin + g.lonMax) / 2, 0])
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
