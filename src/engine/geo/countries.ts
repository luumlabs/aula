// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/map.ts (ALIASES, findCountry,
// suggestCountries, MAP_REGIONS, regionBox).
// Países de verdad por su nombre: la IA escribe «Francia», «France» o «FR» y el mapa dibuja la frontera exacta de Natural
// Earth (world-atlas). Encuadres con nombre («europa», «oriente-medio») o por país. Lógica pura e isomorfa: la tabla de
// países está generada (countryTable.ts) y los nombres en español e inglés salen de Intl.DisplayNames.
import { COUNTRY_ROWS } from './countryTable'
import { countryKey, regionKey } from './names'

export { countryKey } from './names'

export interface Country {
  /** Nombre en Natural Earth (`properties.name` del contorno). */
  ne: string
  /** Código ISO 3166-1 alfa-2 (no tienen Somalilandia, Chipre del Norte y algunos territorios). */
  a2?: string
  /** Recuadro que lo encuadra: oeste, sur, este, norte (este > 180 si cruza la línea de cambio de fecha). */
  bbox: [number, number, number, number]
  /** Falta en el contorno de 1:110 millones: hace falta el de 1:50 millones para dibujarlo. */
  small: boolean
}

/** Recuadro geográfico (el mismo que GeoBounds del mapa); lonMax puede pasar de 180 si cruza la línea de cambio de fecha. */
export interface GeoBox { latMin: number; latMax: number; lonMin: number; lonMax: number }

/**
 * Partes de un país que Natural Earth dibuja aparte pero que la ONU y los atlas escolares cuentan dentro de él: «Somalia»
 * incluye Somalilandia y «Chipre», el norte de la isla. Se dibujan, se encuadran y se preguntan con su país, salvo que la
 * lección las nombre aparte.
 */
const COMPANIONS = new Map<string, readonly string[]>([['Somalia', ['Somaliland']], ['Cyprus', ['N. Cyprus']]])
const PARENT = new Map([...COMPANIONS].flatMap(([parent, parts]) => parts.map((p): [string, string] => [p, parent])))

/** Las partes que van con un país (por su nombre en Natural Earth); ninguna en casi todos. */
export const countryCompanions = (ne: string): readonly string[] => COMPANIONS.get(ne) ?? []

/** El país al que pertenece una parte («Somaliland» → «Somalia»), o undefined si no es una parte. */
export const companionParent = (ne: string): string | undefined => PARENT.get(ne)

const ROWS: readonly Country[] = COUNTRY_ROWS.map(([ne, a2, w, s, e, n, small]) => ({
  ne, ...(a2 ? { a2 } : {}), bbox: [w, s, e, n], small: small === 1
}))

// el recuadro de un país con partes las incluye (las dos están junto a su país, sin cruzar la línea de cambio de fecha)
export const COUNTRIES: readonly Country[] = ROWS.map((c) => {
  const boxes = [c.bbox, ...countryCompanions(c.ne).flatMap((p) => ROWS.filter((r) => r.ne === p).map((r) => r.bbox))]
  if (boxes.length === 1) return c
  const [w, s, e, n] = [0, 1, 2, 3].map((k) => (k < 2 ? Math.min : Math.max)(...boxes.map((b) => b[k])))
  return { ...c, bbox: [w, s, e, n] }
})

/** Otros nombres que se usan de verdad (siglas, nombres antiguos o coloquiales), en español e inglés → nombre en Natural Earth. */
const ALIASES: Array<[string, string]> = [
  ['USA', 'United States of America'], ['US', 'United States of America'], ['United States', 'United States of America'], ['America', 'United States of America'],
  ['EE. UU.', 'United States of America'], ['EEUU', 'United States of America'], ['EUA', 'United States of America'], ['Estados Unidos de América', 'United States of America'],
  ['UK', 'United Kingdom'], ['Britain', 'United Kingdom'], ['Great Britain', 'United Kingdom'], ['England', 'United Kingdom'],
  ['Inglaterra', 'United Kingdom'], ['Gran Bretaña', 'United Kingdom'],
  ['Czech Republic', 'Czechia'], ['República Checa', 'Czechia'], ['Chequia', 'Czechia'],
  ['Ivory Coast', "Côte d'Ivoire"], ['Costa de Marfil', "Côte d'Ivoire"], ['Cote dIvoire', "Côte d'Ivoire"],
  ['Swaziland', 'eSwatini'], ['Eswatini', 'eSwatini'], ['Suazilandia', 'eSwatini'], ['Esuatini', 'eSwatini'],
  ['North Macedonia', 'Macedonia'], ['Macedonia del Norte', 'Macedonia'], ['Burma', 'Myanmar'], ['Birmania', 'Myanmar'],
  ['Holland', 'Netherlands'], ['Holanda', 'Netherlands'], ['Korea', 'South Korea'], ['Republic of Korea', 'South Korea'], ['Corea', 'South Korea'],
  ['Corea del Sur', 'South Korea'], ['Corea del Norte', 'North Korea'],
  ['Democratic Republic of the Congo', 'Dem. Rep. Congo'], ['DRC', 'Dem. Rep. Congo'], ['DR Congo', 'Dem. Rep. Congo'], ['RDC', 'Dem. Rep. Congo'],
  ['RD Congo', 'Dem. Rep. Congo'], ['Congo Kinshasa', 'Dem. Rep. Congo'], ['Zaire', 'Dem. Rep. Congo'],
  ['Republic of the Congo', 'Congo'], ['Congo Brazzaville', 'Congo'], ['República del Congo', 'Congo'],
  ['UAE', 'United Arab Emirates'], ['EAU', 'United Arab Emirates'], ['Emiratos', 'United Arab Emirates'],
  ['Türkiye', 'Turkey'], ['Turquía', 'Turkey'], ['East Timor', 'Timor-Leste'], ['Timor Oriental', 'Timor-Leste'],
  ['Western Sahara', 'W. Sahara'], ['Sahara Occidental', 'W. Sahara'], ['Central African Republic', 'Central African Rep.'],
  ['Bosnia', 'Bosnia and Herz.'], ['South Sudan', 'S. Sudan'], ['Sudán del Sur', 'S. Sudan'], ['Equatorial Guinea', 'Eq. Guinea'],
  ['Dominican Republic', 'Dominican Rep.'], ['República Dominicana', 'Dominican Rep.'], ['Cape Verde', 'Cabo Verde'],
  ['Persia', 'Iran'], ['Ceilán', 'Sri Lanka'], ['Ceylon', 'Sri Lanka'], ['Siam', 'Thailand'],
  ['Vaticano', 'Vatican'], ['Vatican City', 'Vatican'], ['Santa Sede', 'Vatican'], ['Holy See', 'Vatican'],
  ['Palestina', 'Palestine'], ['Palestinian Territories', 'Palestine'], ['Northern Cyprus', 'N. Cyprus'], ['Chipre del Norte', 'N. Cyprus'],
  ['Somalilandia', 'Somaliland'], ['Rusia', 'Russia'], ['Russian Federation', 'Russia'], ['Federación Rusa', 'Russia'],
  ['Moldavia', 'Moldova'], ['Bielorrusia', 'Belarus'], ['Byelorussia', 'Belarus'], ['Kirguistán', 'Kyrgyzstan'],
  ['Groenlandia', 'Greenland'], ['Islas Malvinas', 'Falkland Is.'], ['Malvinas', 'Falkland Is.'], ['Falklands', 'Falkland Is.'],
  ['Islas Feroe', 'Faeroe Is.'], ['Faroe Islands', 'Faeroe Is.'], ['Macau', 'Macao']
]

/** Nombre del país en una lengua (Intl.DisplayNames), o undefined si el motor no lo sabe. */
const displayCache = new Map<string, Intl.DisplayNames | null>()
function regionName(code: string, lang: string): string | undefined {
  let dn = displayCache.get(lang)
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' })
    } catch {
      dn = null
    }
    displayCache.set(lang, dn)
  }
  try {
    const n = dn?.of(code)
    return n && n !== code ? n : undefined
  } catch {
    return undefined
  }
}

/** Nombres de los que no tienen código ISO (o con uno que el motor no conoce). */
const NO_CODE: Record<string, { es: string; en: string }> = {
  Somaliland: { es: 'Somalilandia', en: 'Somaliland' },
  'N. Cyprus': { es: 'Chipre del Norte', en: 'Northern Cyprus' },
  'Indian Ocean Ter.': { es: 'Territorios australianos del Índico', en: 'Australian Indian Ocean Territories' },
  'Ashmore and Cartier Is.': { es: 'Islas Ashmore y Cartier', en: 'Ashmore and Cartier Islands' },
  'Siachen Glacier': { es: 'Glaciar de Siachen', en: 'Siachen Glacier' }
}

let index: Map<string, Country> | undefined
let byIso: Map<string, Country> | undefined

/** Índice de claves → país: nombre de Natural Earth, alias, y nombres en inglés y español (por ese orden de preferencia). */
function countryIndex(): Map<string, Country> {
  if (index) return index
  const m = new Map<string, Country>()
  const byNe = new Map(COUNTRIES.map((c) => [c.ne, c]))
  const add = (name: string | undefined, c: Country | undefined): void => {
    if (!name || !c) return
    const k = countryKey(name)
    if (k && !m.has(k)) m.set(k, c)
  }
  for (const c of COUNTRIES) add(c.ne, c)
  for (const [alias, ne] of ALIASES) add(alias, byNe.get(ne))
  for (const lang of ['en', 'es']) {
    for (const c of COUNTRIES) {
      add(c.a2 ? regionName(c.a2, lang) : NO_CODE[c.ne]?.[lang as 'es' | 'en'], c)
      // «Myanmar (Birmania)», «Congo - Kinshasa»: también sin lo que va entre paréntesis
      const full = c.a2 ? regionName(c.a2, lang) : undefined
      if (full && /\(.*\)/.test(full)) add(full.replace(/\s*\(.*\)\s*/g, ' '), c)
    }
  }
  index = m
  return m
}

function isoIndex(): Map<string, Country> {
  if (!byIso) byIso = new Map(COUNTRIES.flatMap((c) => (c.a2 ? [[c.a2, c] as [string, Country]] : [])))
  return byIso
}

/** El país que se quiere decir (nombre en español o inglés, alias o código ISO «FR»), o undefined. */
export function findCountry(nameOrIso: string): Country | undefined {
  const s = nameOrIso.trim()
  if (!s || s.length > 80) return undefined
  if (/^[A-Za-z]{2}$/.test(s)) {
    const byCode = isoIndex().get(s.toUpperCase())
    // «US», «UK»: las siglas en minúscula también son alias
    if (byCode && s === s.toUpperCase()) return byCode
    return countryIndex().get(countryKey(s)) ?? byCode
  }
  return countryIndex().get(countryKey(s))
}

/** Nombre del país para el estudiante, en su lengua (Intl), o el de Natural Earth si no hay otro. */
export function countryLabel(c: Country, lang: string): string {
  const l = lang.toLowerCase().startsWith('es') ? 'es' : lang.toLowerCase().startsWith('en') ? 'en' : lang
  const fromIntl = c.a2 ? regionName(c.a2, l) : undefined
  return fromIntl ?? NO_CODE[c.ne]?.[l === 'es' ? 'es' : 'en'] ?? c.ne
}

/** Distancia de edición (Levenshtein) acotada: corta en cuanto pasa de `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Unos cuantos países que se parecen al nombre desconocido (para el mensaje de error), con su nombre en `lang`. */
export function suggestCountries(name: string, lang = 'es', max = 4): string[] {
  const k = countryKey(name)
  if (!k) return []
  const limit = Math.max(2, Math.floor(k.length / 3))
  const scored = new Map<Country, number>()
  for (const [key, c] of countryIndex()) {
    let d = editDistance(k, key, limit)
    if (d > limit && key.startsWith(k.slice(0, 4)) && k.length >= 4) d = limit
    if (d <= limit && (scored.get(c) ?? Infinity) > d) scored.set(c, d)
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].ne.localeCompare(b[0].ne))
    .slice(0, max)
    .map(([c]) => countryLabel(c, lang))
}

// MARK: Encuadres con nombre

type Box = [west: number, south: number, east: number, north: number]

/** Encuadres con nombre (inglés y español); los de Sketchy más el Mediterráneo y la península ibérica. */
export const MAP_REGIONS: Record<string, Box> = {
  world: [-180, -58, 180, 84],
  europe: [-25, 34, 45, 71],
  africa: [-20, -36, 55, 38],
  asia: [25, -11, 150, 56],
  'middle-east': [24, 11, 64, 43],
  'north-america': [-170, 7, -50, 74],
  'south-america': [-84, -56, -33, 14],
  americas: [-170, -56, -33, 74],
  oceania: [110, -48, 180, 0],
  mediterranean: [-10, 29, 42, 47],
  'iberian-peninsula': [-10, 35.5, 4.5, 44]
}

/** Otras formas de nombrarlos (claves sin acentos ni signos). */
const REGION_ALIASES: Record<string, string> = {
  mundo: 'world', europa: 'europe', asia: 'asia', africa: 'africa', orientemedio: 'middle-east', orienteproximo: 'middle-east',
  middleeast: 'middle-east', mideast: 'middle-east', northamerica: 'north-america', norteamerica: 'north-america',
  americadelnorte: 'north-america', southamerica: 'south-america', sudamerica: 'south-america', suramerica: 'south-america',
  americadelsur: 'south-america', america: 'americas', americas: 'americas', oceania: 'oceania', mediterranean: 'mediterranean',
  mediterraneo: 'mediterranean', marmediterraneo: 'mediterranean', iberianpeninsula: 'iberian-peninsula',
  peninsulaiberica: 'iberian-peninsula', iberia: 'iberian-peninsula', world: 'world', europe: 'europe'
}

/** Nombre del encuadre predefinido («Oriente Medio» → «middle-east»), o undefined. */
export function regionPreset(region: string): string | undefined {
  const k = regionKey(region)
  if (!k) return undefined
  // solo las claves propias: «constructor» o «__proto__» no son encuadres
  const raw = region.trim().toLowerCase()
  if (Object.hasOwn(MAP_REGIONS, raw)) return raw
  return Object.hasOwn(REGION_ALIASES, k) ? REGION_ALIASES[k] : undefined
}

const clampBox = (w: number, s: number, e: number, n: number): GeoBox => ({
  latMin: Math.max(-85, s), latMax: Math.min(85, n), lonMin: Math.max(-180, w), lonMax: Math.min(w + 360, e)
})

/**
 * Encuadre de `region`: un nombre predefinido, un recuadro «oeste,sur,este,norte» o un país (su recuadro con margen).
 * undefined si no se entiende.
 */
export function regionBox(region: string): GeoBox | undefined {
  const s = region.trim()
  if (!s) return undefined
  const preset = regionPreset(s)
  if (preset) {
    const [w, so, e, n] = MAP_REGIONS[preset]
    return { latMin: so, latMax: n, lonMin: w, lonMax: e }
  }
  const nums = s.split(',').map((x) => x.trim())
  if (nums.length === 4 && nums.every((x) => x !== '' && Number.isFinite(Number(x)))) {
    const [w, so, e, n] = nums.map(Number)
    if (so >= n || Math.abs(so) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) return undefined
    // un recuadro que cruza la línea de cambio de fecha («170,-20,-170,0»)
    return clampBox(w, so, e < w ? e + 360 : e, n)
  }
  const c = findCountry(s.replace(/-/g, ' '))
  if (!c) return undefined
  const [w, so, e, n] = c.bbox
  // margen del 25 % (como mucho 12°) y 1° más: Chile se ve con sus vecinos; Rusia no da la vuelta al mundo
  const pad = Math.min(12, Math.max(e - w, n - so) * 0.25) + 1
  return clampBox(w - pad, so - pad, e + pad, n + pad)
}
