// Datos que el motor de química (src/engine/chem) todavía no trae: radio covalente y año de descubrimiento.
// - Radio covalente (pm): Cordero et al., «Covalent radii revisited», Dalton Trans. 2008 (C sp³; Mn, Fe y Co de espín
//   bajo). Sin dato a partir del curio (Z > 96).
// - Año de descubrimiento (o primer aislamiento/identificación reconocido): `0` = conocido desde la Antigüedad; los años
//   aproximados («hacia 1250») van en negativo para mostrarlos con «c.».
// Además: propiedades numéricas para el mapa de calor y la posición en la escala.
import type { Element } from '@engine/chem/elements'

/** Radio covalente en pm por Z − 1 (`null` sin dato). */
export const COVALENT_RADIUS: readonly (number | null)[] = [
  31, 28, 128, 96, 84, 76, 71, 66, 57, 58, // H–Ne
  166, 141, 121, 111, 107, 105, 102, 106, // Na–Ar
  203, 176, 170, 160, 153, 139, 139, 132, 126, 124, 132, 122, 122, 120, 119, 120, 120, 116, // K–Kr
  220, 195, 190, 175, 164, 154, 147, 146, 142, 139, 145, 144, 142, 139, 139, 138, 139, 140, // Rb–Xe
  244, 215, 207, 204, 203, 201, 199, 198, 198, 196, 194, 192, 192, 189, 190, 187, 187, // Cs–Lu
  175, 170, 162, 151, 144, 141, 136, 136, 132, 145, 146, 148, 140, 150, 150, // Hf–Rn
  260, 221, 215, 206, 200, 196, 190, 187, 180, 169, // Fr–Cm
  null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null // Bk–Og
]

/** Año de descubrimiento por Z − 1 (0 = Antigüedad; negativo = aproximado). */
export const DISCOVERY_YEAR: readonly number[] = [
  1766, 1868, 1817, 1798, 1808, 0, 1772, 1771, 1886, 1898, // H–Ne
  1807, 1755, 1825, 1824, 1669, 0, 1774, 1894, // Na–Ar
  1807, 1808, 1879, 1791, 1801, 1797, 1774, 0, 1735, 1751, 0, 1746, 1875, 1886, -1250, 1817, 1826, 1898, // K–Kr
  1861, 1790, 1794, 1789, 1801, 1778, 1937, 1844, 1804, 1802, 0, 1817, 1863, 0, 0, 1782, 1811, 1898, // Rb–Xe
  1860, 1772, 1838, 1803, 1885, 1885, 1945, 1879, 1896, 1880, 1843, 1886, 1878, 1843, 1879, 1878, 1907, // Cs–Lu
  1923, 1802, 1783, 1925, 1803, 1803, 1735, 0, 0, 1861, 0, -1500, 1898, 1940, 1899, // Hf–Rn
  1939, 1898, 1899, 1829, 1913, 1789, 1940, 1940, 1944, 1944, 1949, 1950, 1952, 1952, 1955, 1958, 1961, // Fr–Lr
  1964, 1967, 1974, 1981, 1984, 1982, 1994, 1994, 1996, 2004, 1999, 2003, 2000, 2010, 2002 // Rf–Og
]

export type HeatProperty = 'electronegativity' | 'radius' | 'ionization' | 'mass' | 'density' | 'melting' | 'discovery'

export const HEAT_PROPERTIES: readonly HeatProperty[] = ['electronegativity', 'radius', 'ionization', 'mass', 'density', 'melting', 'discovery']

/** Unidad de cada propiedad (no se traduce). */
export const HEAT_UNIT: Record<HeatProperty, string> = { electronegativity: '', radius: 'pm', ionization: 'kJ/mol', mass: 'u', density: 'g/cm³', melting: 'K', discovery: '' }

export function covalentRadius(z: number): number | null {
  return COVALENT_RADIUS[z - 1] ?? null
}

/** Año de descubrimiento: `{ year, approx }`, o `ancient` si se conoce desde la Antigüedad. */
export function discovery(z: number): { year: number; approx: boolean } | 'ancient' | null {
  const y = DISCOVERY_YEAR[z - 1]
  if (y === undefined) return null
  if (y === 0) return 'ancient'
  return { year: Math.abs(y), approx: y < 0 }
}

/** Valor numérico de una propiedad (para el mapa de calor), o `null` si no hay dato. */
export function propertyValue(e: Element, p: HeatProperty): number | null {
  switch (p) {
    case 'electronegativity':
      return e.electronegativity
    case 'radius':
      return covalentRadius(e.atomicNumber)
    case 'ionization':
      return e.firstIonizationEnergy
    case 'mass':
      return e.atomicWeight.isStandard ? e.molarMass : null
    case 'density':
      return e.densityGramsPerCm3
    case 'melting':
      return e.meltingPoint ?? e.sublimationPoint
    case 'discovery': {
      const d = discovery(e.atomicNumber)
      return d === 'ancient' ? 1000 : d ? d.year : null
    }
  }
}

/** Extremos de una propiedad entre los elementos dados. La densidad usa escala logarítmica (de 10⁻⁴ a 22 g/cm³). */
export function propertyScale(elements: readonly Element[], p: HeatProperty): { min: number; max: number; log: boolean } {
  const vals = elements.map((e) => propertyValue(e, p)).filter((v): v is number => v !== null && Number.isFinite(v))
  const log = p === 'density'
  const tr = (v: number) => (log ? Math.log10(Math.max(v, 1e-5)) : v)
  return { min: Math.min(...vals.map(tr)), max: Math.max(...vals.map(tr)), log }
}

/** Posición (0…1) de un valor en la escala. */
export function scalePosition(v: number, s: { min: number; max: number; log: boolean }): number {
  const x = s.log ? Math.log10(Math.max(v, 1e-5)) : v
  return s.max > s.min ? Math.max(0, Math.min(1, (x - s.min) / (s.max - s.min))) : 0
}

/** Configuración «[Ar] 4s2 3d6» → trozos para dibujarla con superíndices. */
export function configTokens(text: string): { core: string | null; parts: { orbital: string; count: string }[] } {
  const m = /^\[(\w+)\]\s*(.*)$/.exec(text.trim())
  const core = m ? m[1] : null
  const rest = m ? m[2] : text.trim()
  const parts = rest
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const k = /^(\d+[spdfg])(\d+)$/.exec(tok)
      return k ? { orbital: k[1], count: k[2] } : { orbital: tok, count: '' }
    })
  return { core, parts }
}
