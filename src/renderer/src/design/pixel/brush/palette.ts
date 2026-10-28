// Los colores de la ilustración (PURO): el pixel art usaba colores de videojuego, saturados; la ilustración pintada a mano
// usa la misma familia de cada color pero en pigmentos cálidos y planos — ladrillo, arcilla, ocre y avena, crema, salvia,
// azul tinta suave —. Cada color conserva su familia (el azul sigue siendo azul, el verde, verde) para que cada dibujo
// signifique lo mismo, pero se templa: menos croma, el tono atraído hacia el pigmento cálido más cercano y nunca violeta.

/** La tinta de las líneas: negro cálido de barra de tinta (sin el matiz ciruela del `ink` del pixel art). */
export const SUMI = '#2b231e'
/** En papel oscuro, la silueta se entinta en marfil (la línea oscura se perdería contra el papel). */
export const IVORY = '#ece3d4'

const toLin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(c * 255)))
}

/** #rrggbb → OKLCH [L, C, h en grados]. */
export function oklch(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16)
  const r = toLin(n >> 16)
  const g = toLin((n >> 8) & 255)
  const b = toLin(n & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return [L, Math.hypot(A, B), h < 0 ? h + 360 : h]
}

/** OKLCH → #rrggbb (recortando lo que se sale del sRGB por el croma, no por la luz). */
export function fromOklch(L: number, C: number, h: number): string {
  for (let c = C; ; c *= 0.94) {
    const a = c * Math.cos((h * Math.PI) / 180)
    const b = c * Math.sin((h * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    const Bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    const ok = [R, G, Bl].every((v) => v >= -0.002 && v <= 1.002)
    if (ok || c < 0.002) return '#' + [R, G, Bl].map((v) => toSrgb(v).toString(16).padStart(2, '0')).join('')
  }
}

/** Los pigmentos hacia los que se templa cada tono (grados OKLCH): rosa arcilla, ladrillo, ocre, salvia, verde agua, azul tinta. */
const ANCHORS = [18, 40, 76, 138, 188, 246]
const circ = (a: number, b: number) => ((b - a + 540) % 360) - 180

const cache = new Map<string, string>()
/** El pigmento cálido de un color del pixel art (en oscuro, un punto más luminoso: brilla sobre el papel oscuro). */
export function warm(hex0: string, dark = false): string {
  const hex = hex0.slice(0, 7)
  const key = hex + (dark ? 'd' : '')
  const hit = cache.get(key)
  if (hit) return hit
  const [L, C, h] = oklch(hex)
  let L2 = 0.025 + 0.96 * L
  let C2: number
  let h2: number
  if (C < 0.035) {
    // grises → grises cálidos (avena, piedra)
    h2 = 70
    C2 = 0.008 + C * 0.45
  } else {
    let best = ANCHORS[0]
    for (const a of ANCHORS) if (Math.abs(circ(h, a)) < Math.abs(circ(h, best))) best = a
    h2 = (h + circ(h, best) * 0.55 + 360) % 360
    // nunca violeta, morado ni lila
    if (h2 > 262 && h2 < 300) h2 = 262
    if (h2 >= 300 && h2 < 350) h2 = 350
    // los rojos y los ladrillos, un punto más vivos (el corazón tiene que seguir siendo rojo)
    const cap = best === 18 || best === 40 ? 0.17 : 0.145
    C2 = cap * Math.tanh(C / cap)
  }
  if (dark) {
    // en papel oscuro los pigmentos se encienden: los oscuros suben un poco; los claros no (se lavarían)
    L2 = Math.min(0.96, L2 + 0.06 * Math.max(0, 0.78 - L2) / 0.78)
    C2 *= 1.08
  }
  const out = fromOklch(L2, C2, h2)
  cache.set(key, out)
  return out
}
