// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (rutas: arco suave sobre el
// círculo máximo, flecha al final y nombre por fuera del arco).
// Rutas con sentido del mapa en el plano de la proyección (antes del zoom): una ruta de dos puntos con flecha se dibuja como
// un arco suave (así no se confunde con una frontera), la punta de flecha sigue la última dirección y el nombre va por fuera
// del arco. Lógica pura.
import { geoInterpolate, type GeoProjection } from 'd3-geo'

export type Pt = [number, number]

/** Cuánto se separa el arco de la cuerda en su mitad (fracción de la cuerda). */
export const BOW = 0.12

const project = (proj: GeoProjection, lat: number, lon: number): Pt | null => {
  const p = proj([lon, lat])
  return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null
}

/** Puntos de un tramo por el círculo máximo, ya proyectados (null si salta de un borde al otro del mapa). */
function greatCircle(proj: GeoProjection, a: number[], b: number[], n: number): Pt[] | null {
  // ojo: Aula guarda [lat, lon]; d3 quiere [lon, lat]
  const along = geoInterpolate([a[1], a[0]], [b[1], b[0]])
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const [lon, lat] = along(i / n)
    const p = project(proj, lat, lon)
    if (!p) return null
    pts.push(p)
  }
  return pts
}

/** ¿Hay un salto (la línea cruza el borde del mapa: la línea de cambio de fecha)? */
function jumps(pts: Pt[]): boolean {
  if (pts.length < 2) return false
  const total = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    if (d > Math.max(40, total * 0.6)) return true
  }
  return false
}

/**
 * Arco de una ruta de dos puntos: 33 puntos por el círculo máximo, combados hacia un lado sin(πt)·cuerda·12 %. Los extremos
 * no se mueven. Si el círculo máximo ya se curva (un viaje largo: de Palos a las Bahamas sube hacia el norte), el arco se
 * comba hacia ese mismo lado, para no enderezarlo. undefined si no se puede (no son 2 puntos o cruza la línea de cambio de
 * fecha).
 */
export function bowedRoute(proj: GeoProjection, points: number[][]): Pt[] | undefined {
  if (points.length !== 2) return undefined
  const pts = greatCircle(proj, points[0], points[1], 32)
  if (!pts || jumps(pts)) return undefined
  const [a, b] = [pts[0], pts[pts.length - 1]]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length < 1e-6) return undefined
  let nx = (b[1] - a[1]) / length, ny = -(b[0] - a[0]) / length
  const mid = pts[Math.floor(pts.length / 2)]
  const bulge = (mid[0] - (a[0] + b[0]) / 2) * nx + (mid[1] - (a[1] + b[1]) / 2) * ny
  if (bulge < -length * 0.01) { nx = -nx; ny = -ny }
  return pts.map(([x, y], i) => {
    const lift = Math.sin((Math.PI * i) / (pts.length - 1)) * length * BOW
    return [x + nx * lift, y + ny * lift]
  })
}

/** Camino SVG de una polilínea. */
export const polylinePath = (pts: Pt[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')

/** La punta de la ruta y su dirección (grados, 0 = hacia la derecha), para la flecha. */
export function routeTip(proj: GeoProjection, points: number[][], bowed?: Pt[]): { x: number; y: number; angle: number } | undefined {
  let a: Pt | null, b: Pt | null
  if (bowed && bowed.length >= 2) {
    a = bowed[bowed.length - 2]
    b = bowed[bowed.length - 1]
  } else {
    if (points.length < 2) return undefined
    const p = points[points.length - 2], q = points[points.length - 1]
    // la dirección de llegada por el círculo máximo (geoPath dibuja así cada tramo)
    const tail = greatCircle(proj, p, q, 24)
    if (!tail || jumps(tail)) return undefined
    a = tail[tail.length - 2]
    b = tail[tail.length - 1]
  }
  if (!a || !b) return undefined
  return { x: b[0], y: b[1], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI }
}

/**
 * Dónde va el nombre de una ruta combada: junto a la cima del arco, por fuera. Devuelve la cima (en el plano) y la normal
 * hacia fuera (unitaria, en pantalla); el que dibuja la aleja unos píxeles.
 */
export function bowLabelSpot(bowed: Pt[]): { at: Pt; out: Pt } | undefined {
  if (bowed.length < 3) return undefined
  const a = bowed[0], b = bowed[bowed.length - 1]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const at = bowed[Math.floor(bowed.length / 2)]
  const n: Pt = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length]
  // hacia fuera = hacia donde se aleja la cima de la cuerda
  const side = (at[0] - (a[0] + b[0]) / 2) * n[0] + (at[1] - (a[1] + b[1]) / 2) * n[1] >= 0 ? 1 : -1
  return { at, out: [n[0] * side, n[1] * side] }
}

/** Puntos de la ruta cada `step` píxeles de pantalla (para que los nombres no la pisen). */
export function routeSamples(pts: Pt[], toScreen: (p: Pt) => Pt, step = 10): Pt[] {
  const out: Pt[] = []
  const s = pts.map(toScreen)
  for (let i = 0; i < s.length; i++) {
    if (i === 0) {
      out.push(s[0])
      continue
    }
    const [x0, y0] = s[i - 1], [x1, y1] = s[i]
    const d = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.min(200, Math.max(1, Math.ceil(d / step)))
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  return out
}

/** Puntos proyectados de una polilínea [[lat, lon], …] siguiendo el círculo máximo en cada tramo (para muestrear). */
export function routePolyline(proj: GeoProjection, points: number[][]): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i < points.length; i++) {
    const seg = greatCircle(proj, points[i - 1], points[i], 8)
    if (!seg || jumps(seg)) continue
    out.push(...(out.length ? seg.slice(1) : seg))
  }
  return out
}
