// Genera src/engine/geo/countryTable.ts: los países de Natural Earth (world-atlas, 1:50 millones) con su código ISO de dos
// letras, el recuadro que los encuadra y si faltan en el contorno de 1:110 millones (los pequeños). Determinista: se
// vuelve a generar solo si cambia world-atlas.
//   node scripts/dev/country-table.mjs
// El recuadro es el de la pieza más grande del país más las islas cercanas que cuentan (Canarias con España, Alaska con
// Estados Unidos), no el de todos sus territorios (la Guayana Francesa no encuadra Francia).
import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { geoArea } from 'd3-geo'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const topo = require('topojson-client')
// la misma clave que la app (src/engine/geo/names.ts), sin compilar nada
const namesTs = readFileSync(join(root, 'src/engine/geo/names.ts'), 'utf8')
const { countryKey } = await import('data:text/javascript,' + encodeURIComponent(stripTypeScriptTypes(namesTs)))

const load = (f) => JSON.parse(readFileSync(join(root, 'node_modules/world-atlas', f), 'utf8'))
const w50 = load('countries-50m.json')
const w110 = load('countries-110m.json')
const features = topo.feature(w50, w50.objects.countries).features
const big = new Set(w110.objects.countries.geometries.map((g) => g.properties.name))

// Códigos ISO que el nombre de Natural Earth no deja encontrar solo (abreviados o antiguos); null = sin código.
const MANUAL = {
  Vatican: 'VA', 'N. Mariana Is.': 'MP', 'United States of America': 'US', 'S. Geo. and the Is.': 'GS', 'Br. Indian Ocean Ter.': 'IO',
  Turkey: 'TR', 'St. Vin. and Gren.': 'VC', Macedonia: 'MK', Palestine: 'PS', 'Wallis and Futuna Is.': 'WF', 'Fr. S. Antarctic Lands': 'TF',
  Åland: 'AX', 'Faeroe Is.': 'FO', 'Dem. Rep. Congo': 'CD', Congo: 'CG', Macao: 'MO', 'Hong Kong': 'HK', 'Cabo Verde': 'CV', Myanmar: 'MM',
  'Heard I. and McDonald Is.': 'HM', 'Antigua and Barb.': 'AG',
  Somaliland: null, 'N. Cyprus': null, 'Indian Ocean Ter.': null, 'Ashmore and Cartier Is.': null, 'Siachen Glacier': null
}
// Recuadros escritos a mano [oeste, sur, este, norte] donde la regla no da el encuadre de un atlas escolar.
const FRAME = {
  // los 48 estados contiguos y Alaska (Hawái queda fuera, como en los atlas)
  'United States of America': [-168.2, 24.5, -66.9, 71.4],
  // Noruega continental (sin Svalbard)
  Norway: [4.6, 57.9, 31.1, 71.2]
}

const en = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
const codes = new Map()
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b)
    if (['EU', 'EZ', 'UN', 'QO', 'ZZ'].includes(c)) continue
    // solo los códigos vigentes («DD», la antigua RDA, se lee como Alemania)
    if (Intl.getCanonicalLocales('und-' + c)[0] !== 'und-' + c) continue
    const n = en.of(c)
    if (n && n !== c && !codes.has(countryKey(n))) codes.set(countryKey(n), c)
  }
}

/** Piezas del país: área (estereorradianes) y recuadro de su anillo exterior, tal cual y con el oeste pasado a +360°. */
function pieces(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []
  return polys.map((rings) => {
    const ring = rings[0]
    const lons = ring.map((p) => p[0])
    const lats = ring.map((p) => p[1])
    const east = lons.map((l) => (l < 0 ? l + 360 : l))
    const s = Math.min(...lats), n = Math.max(...lats)
    return {
      area: geoArea({ type: 'Polygon', coordinates: rings }),
      plain: { w: Math.min(...lons), e: Math.max(...lons), s, n },
      shifted: { w: Math.min(...east), e: Math.max(...east), s, n }
    }
  })
}

/** Distancia (grados) entre dos recuadros; 0 si se tocan. */
const gap = (a, b) => Math.hypot(Math.max(0, a.w - b.e, b.w - a.e), Math.max(0, a.s - b.n, b.s - a.n))

/**
 * La pieza más grande y, una a una, las que estén cerca de lo ya elegido (a menos de su tamaño) y no sean minúsculas
 * (≥ 0,1 % de su área). Se mira tal cual y con el oeste desplazado (países que cruzan la línea de cambio de fecha) y se
 * queda el más estrecho.
 */
function frame(geom) {
  const ps = pieces(geom)
  if (!ps.length) return undefined
  const main = ps.reduce((a, b) => (b.area > a.area ? b : a))
  const pick = (space) => {
    const m = main[space]
    const size = Math.max(m.e - m.w, m.n - m.s)
    const kept = [main]
    let grew = true
    while (grew) {
      grew = false
      for (const p of ps) {
        if (kept.includes(p) || p.area < main.area * 0.001) continue
        if (kept.some((k) => gap(p[space], k[space]) <= size)) { kept.push(p); grew = true }
      }
    }
    const bs = kept.map((p) => p[space])
    return { w: Math.min(...bs.map((b) => b.w)), e: Math.max(...bs.map((b) => b.e)), s: Math.min(...bs.map((b) => b.s)), n: Math.max(...bs.map((b) => b.n)) }
  }
  const a = pick('plain')
  const b = pick('shifted')
  const box = b.e - b.w < a.e - a.w - 1e-9 ? b : a
  const r = (v, up) => (up ? Math.ceil(v * 10) : Math.floor(v * 10)) / 10
  return [r(box.w, false), r(box.s, false), r(box.e, true), r(box.n, true)]
}

const rows = features
  .map((f) => {
    const ne = f.properties.name
    const a2 = ne in MANUAL ? MANUAL[ne] : codes.get(countryKey(ne)) ?? null
    const bbox = FRAME[ne] ?? frame(f.geometry)
    if (!bbox) throw new Error('sin contorno: ' + ne)
    return { ne, a2, bbox, small: !big.has(ne) }
  })
  .sort((x, y) => x.ne.localeCompare(y.ne, 'en'))

const dup = rows.filter((r, i) => r.a2 && rows.findIndex((q) => q.a2 === r.a2) !== i)
if (dup.length) throw new Error('códigos repetidos: ' + dup.map((r) => r.ne + ' ' + r.a2).join(', '))
const missing = rows.filter((r) => r.a2 === null && !(r.ne in MANUAL))
if (missing.length) throw new Error('sin código ISO (añádelo a MANUAL): ' + missing.map((r) => r.ne).join(', '))

const fmt = (v) => String(Number(v.toFixed(1)))
const lines = rows.map((r) => `  [${JSON.stringify(r.ne)}, ${r.a2 ? JSON.stringify(r.a2) : 'null'}, ${r.bbox.map(fmt).join(', ')}${r.small ? ', 1' : ''}],`)
const out = `// Generado por scripts/dev/country-table.mjs a partir de world-atlas (Natural Earth, dominio público). No editar a mano.
// [nombre en Natural Earth, código ISO 3166-1 alfa-2 o null, oeste, sur, este, norte (grados; este > 180 si cruza la línea
// de cambio de fecha), 1 si falta en el contorno de 1:110 millones (país pequeño)]
export type CountryRow = readonly [string, string | null, number, number, number, number, 1?]

export const COUNTRY_ROWS: readonly CountryRow[] = [
${lines.join('\n')}
]
`
writeFileSync(join(root, 'src/engine/geo/countryTable.ts'), out)
console.log(`${rows.length} países (${rows.filter((r) => r.small).length} pequeños, ${rows.filter((r) => !r.a2).length} sin código)`)
