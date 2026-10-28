// Tabla periódica: los 118 elementos con sus datos de referencia, búsquedas y nombres en los idiomas de la app.

import { ALTERNATIVE_NAMES, RAW_ELEMENTS, type RawElement } from './element-data'
import { CATEGORY_TITLES, ELEMENT_NAMES, STATE_TITLES } from './element-l10n'
import { PHYSICAL_DATA, SUBLIMATION_POINTS } from './element-physical'
import { getChemLanguage, normalizeChemLanguage, type ChemLanguage } from './l10n'
import { charCount, fold, inSentence, parseIntStrict, trimAll, trimChars } from './text'

/** Bloque de la tabla periódica (subcapa que se llena según el orden de Madelung). */
export type PeriodicBlock = 's' | 'p' | 'd' | 'f'

/** Categoría química del elemento (la clasificación de colores habitual; la interfaz elige los colores por clave). */
export type ElementCategory =
  | 'alkaliMetal'
  | 'alkalineEarthMetal'
  | 'transitionMetal'
  | 'postTransitionMetal'
  | 'metalloid'
  | 'reactiveNonmetal'
  | 'halogen'
  | 'nobleGas'
  | 'lanthanide'
  | 'actinide'
  | 'unknown'

export const ELEMENT_CATEGORIES: readonly ElementCategory[] = [
  'alkaliMetal', 'alkalineEarthMetal', 'transitionMetal', 'postTransitionMetal', 'metalloid',
  'reactiveNonmetal', 'halogen', 'nobleGas', 'lanthanide', 'actinide', 'unknown',
]

/** Estado físico a 25 °C y 1 atm. */
export type StandardState = 'solid' | 'liquid' | 'gas' | 'unknown'

export const STANDARD_STATES: readonly StandardState[] = ['solid', 'liquid', 'gas', 'unknown']

/** Nombre de la categoría en español, fijo (lo usan los informes para la IA). */
export const categoryTitle = (c: ElementCategory): string => CATEGORY_TITLES.es[c]

/** Nombre de la categoría en el idioma pedido (o el de la interfaz). */
export const localizedCategoryTitle = (c: ElementCategory, lang?: string): string =>
  CATEGORY_TITLES[lang ? normalizeChemLanguage(lang) : getChemLanguage()][c]

/** `true` para las categorías metálicas (`null` si se desconoce). */
export function categoryIsMetal(c: ElementCategory): boolean | null {
  switch (c) {
    case 'alkaliMetal': case 'alkalineEarthMetal': case 'transitionMetal': case 'postTransitionMetal':
    case 'lanthanide': case 'actinide':
      return true
    case 'metalloid': case 'reactiveNonmetal': case 'halogen': case 'nobleGas':
      return false
    case 'unknown':
      return null
  }
}

const STATE_TITLE_ES: Readonly<Record<StandardState, string>> = { solid: 'Sólido', liquid: 'Líquido', gas: 'Gas', unknown: 'Desconocido' }

/** Nombre del estado en español, fijo («Sólido»). */
export const stateTitle = (s: StandardState): string => STATE_TITLE_ES[s]

/** Nombre del estado en el idioma pedido (o el de la interfaz). */
export const localizedStateTitle = (s: StandardState, lang?: string): string =>
  STATE_TITLES[lang ? normalizeChemLanguage(lang) : getChemLanguage()][s]

/** Masa atómica: estándar abreviada de la IUPAC («22.990») o número másico del isótopo más estable («[98]»). */
export interface AtomicWeight {
  /** `true` si es una masa atómica estándar de la IUPAC. */
  readonly isStandard: boolean
  /** Texto para mostrar: «55.845» o «[98]». */
  readonly text: string
  /** Valor en g/mol (para isótopos, el número másico como aproximación). */
  readonly value: number
  /** Decimales con que se publica (0 para los números másicos). */
  readonly decimalPlaces: number
  /** Número másico si no hay masa estándar. */
  readonly massNumber: number | null
}

/**
 * Un elemento químico con sus datos de referencia (objeto de datos inmutable, apto para la interfaz y para IPC).
 *
 * - `group` es 1…18 (IUPAC). Lantánidos (La–Lu) y actínidos (Ac–Lr) tienen `group === null`.
 * - `gridColumn`/`gridRow`: posición en la cuadrícula de 18 columnas: periodos en las filas 1–7, la 8 vacía como
 *   separación, lantánidos en la 9 y actínidos en la 10 (columnas 3–17).
 */
export interface Element {
  /** Número atómico (Z). */
  readonly atomicNumber: number
  /** Símbolo con su mayúscula exacta («Co», no «CO»). */
  readonly symbol: string
  /** Nombre en español, fijo: para buscar y para los informes de la IA. Para mostrarlo: `localizedElementName`. */
  readonly name: string
  /** Nombre en inglés (ortografía IUPAC: «aluminium», «caesium», «sulfur»). */
  readonly englishName: string
  readonly atomicWeight: AtomicWeight
  /** Masa molar en g/mol (masa atómica estándar o número másico). */
  readonly molarMass: number
  readonly group: number | null
  readonly period: number
  readonly block: PeriodicBlock
  readonly category: ElementCategory
  /** Estado a 25 °C y 1 atm. */
  readonly standardState: StandardState
  /** Electronegatividad de Pauling (`null` si no hay valor de referencia). */
  readonly electronegativity: number | null
  /** Estados de oxidación comunes, de menor a mayor. */
  readonly commonOxidationStates: readonly number[]
  /** Primera energía de ionización en kJ/mol (`null` si no se ha medido). */
  readonly firstIonizationEnergy: number | null
  readonly gridColumn: number
  readonly gridRow: number
  /** Otros nombres aceptados en búsquedas («cinc», «tungsteno», «aluminum»…). */
  readonly alternativeNames: readonly string[]
  /** `true` si es un metal (`null` si se desconoce). */
  readonly isMetal: boolean | null
  /** `true` para Z ≥ 104: la configuración es una predicción teórica. */
  readonly isConfigurationPredicted: boolean
  /** Densidad tal como se publica: g/cm³ (g/L para los gases, ver `densityUnit`). Datos de la tabla de la interfaz. */
  readonly density: number | null
  readonly densityUnit: 'g/cm³' | 'g/L'
  /** Densidad siempre en g/cm³. */
  readonly densityGramsPerCm3: number | null
  /** Punto de fusión a 1 atm (K). */
  readonly meltingPoint: number | null
  /** Punto de ebullición a 1 atm (K). */
  readonly boilingPoint: number | null
  /** Punto de sublimación a 1 atm (K): C y As no se funden a esa presión. */
  readonly sublimationPoint: number | null
  /** Electrones de valencia de los grupos principales (1, 2 y 13–18); `null` en los demás. */
  readonly valenceElectrons: number | null
}

function makeWeight(text: string): AtomicWeight {
  const m = /^\[(\d+)\]$/.exec(text)
  if (m) {
    const a = Number(m[1])
    return { isStandard: false, text: `[${a}]`, value: a, decimalPlaces: 0, massNumber: a }
  }
  const dot = text.indexOf('.')
  return { isStandard: true, text, value: Number(text), decimalPlaces: dot < 0 ? 0 : text.length - dot - 1, massNumber: null }
}

function makeElement(r: RawElement): Element {
  const [z, symbol, name, english, weightText, group, period, category, state, en, ox, ie] = r
  const atomicWeight = makeWeight(weightText)
  const isF = category === 'lanthanide' || category === 'actinide'
  const block: PeriodicBlock = isF ? 'f' : z === 2 || group <= 2 ? 's' : group <= 12 ? 'd' : 'p'
  let gridColumn: number
  let gridRow: number
  if (category === 'lanthanide') {
    gridColumn = 3 + (z - 57)
    gridRow = 9
  } else if (category === 'actinide') {
    gridColumn = 3 + (z - 89)
    gridRow = 10
  } else {
    gridColumn = group
    gridRow = period
  }
  const [density, melt, boil] = PHYSICAL_DATA[z - 1]
  const isGas = state === 'gas'
  const g = isF ? null : group
  let valence: number | null = null
  if (g !== null) valence = z === 2 ? 2 : g <= 2 ? g : g >= 13 ? g - 10 : null
  return Object.freeze({
    atomicNumber: z,
    symbol,
    name,
    englishName: english,
    atomicWeight: Object.freeze(atomicWeight),
    molarMass: atomicWeight.value,
    group: g,
    period,
    block,
    category,
    standardState: state,
    electronegativity: en,
    commonOxidationStates: Object.freeze([...ox].sort((a, b) => a - b)),
    firstIonizationEnergy: ie,
    gridColumn,
    gridRow,
    alternativeNames: Object.freeze([...(ALTERNATIVE_NAMES[z] ?? [])]),
    isMetal: categoryIsMetal(category),
    isConfigurationPredicted: z >= 104,
    density,
    densityUnit: isGas ? 'g/L' : 'g/cm³',
    densityGramsPerCm3: density === null ? null : isGas ? density / 1000 : density,
    meltingPoint: melt,
    boilingPoint: boil,
    sublimationPoint: SUBLIMATION_POINTS[z] ?? null,
    valenceElectrons: valence,
  })
}

/** Los 118 elementos, ordenados por número atómico (índice = Z − 1). */
export const ALL_ELEMENTS: readonly Element[] = Object.freeze(RAW_ELEMENTS.map(makeElement))

/** Nombre en el idioma pedido (o el de la interfaz), con mayúscula inicial («Hierro», «Iron», «Fer», «Eisen»). */
export function localizedElementName(e: Element, lang?: string): string {
  const l: ChemLanguage = lang ? normalizeChemLanguage(lang) : getChemLanguage()
  return ELEMENT_NAMES[l][e.atomicNumber - 1] ?? e.name
}

/** Nombre localizado para usarlo dentro de una frase («un isótopo de carbono»): en minúscula salvo en alemán. */
export const localizedElementNameInSentence = (e: Element): string => inSentence(localizedElementName(e))

/** «Hierro (Fe)». */
export const describeElement = (e: Element): string => `${e.name} (${e.symbol})`

/** Estado de la materia a una temperatura (K) según sus puntos de fusión y ebullición (a 1 atm). */
export function phaseAt(e: Element, kelvin: number): StandardState {
  // Si no se sabe su estado ni a 25 °C, no se inventa a otras temperaturas.
  if (e.standardState === 'unknown') return 'unknown'
  if (e.sublimationPoint !== null) return kelvin < e.sublimationPoint ? 'solid' : 'gas'
  const m = e.meltingPoint
  const b = e.boilingPoint
  if (m !== null && b !== null) return kelvin < m ? 'solid' : kelvin < b ? 'liquid' : 'gas'
  if (m !== null) return kelvin < m ? 'solid' : 'unknown' // sin ebullición conocida no se sabe si sigue líquido
  if (b !== null) return kelvin >= b ? 'gas' : e.standardState
  return 'unknown'
}

// MARK: Búsquedas

const bySymbol = new Map<string, Element>(ALL_ELEMENTS.map((e) => [e.symbol, e]))
const byFoldedSymbol = new Map<string, Element[]>()
for (const e of ALL_ELEMENTS) {
  const k = e.symbol.toLowerCase()
  byFoldedSymbol.set(k, [...(byFoldedSymbol.get(k) ?? []), e])
}
const byFoldedName = new Map<string, Element>()
for (const e of ALL_ELEMENTS) for (const n of [e.name, e.englishName, ...e.alternativeNames]) byFoldedName.set(fold(n), e)

/** Gas noble usado como núcleo en las configuraciones abreviadas. */
export interface NobleGasCore {
  readonly symbol: string
  readonly electrons: number
}

const SEQUENCE: readonly string[] = [
  // Grupo 18 → 1 → 2 → 3 (actínidos, lantánidos, Y, Sc) → 4…12 → 13 → 14 → 15 → H → 16 → 17, de abajo arriba.
  'Og', 'Rn', 'Xe', 'Kr', 'Ar', 'Ne', 'He', 'Fr', 'Cs', 'Rb', 'K', 'Na', 'Li', 'Ra', 'Ba', 'Sr', 'Ca', 'Mg', 'Be',
  'Lr', 'No', 'Md', 'Fm', 'Es', 'Cf', 'Bk', 'Cm', 'Am', 'Pu', 'Np', 'U', 'Pa', 'Th', 'Ac',
  'Lu', 'Yb', 'Tm', 'Er', 'Ho', 'Dy', 'Tb', 'Gd', 'Eu', 'Sm', 'Pm', 'Nd', 'Pr', 'Ce', 'La', 'Y', 'Sc',
  'Rf', 'Hf', 'Zr', 'Ti', 'Db', 'Ta', 'Nb', 'V', 'Sg', 'W', 'Mo', 'Cr', 'Bh', 'Re', 'Tc', 'Mn',
  'Hs', 'Os', 'Ru', 'Fe', 'Mt', 'Ir', 'Rh', 'Co', 'Ds', 'Pt', 'Pd', 'Ni', 'Rg', 'Au', 'Ag', 'Cu',
  'Cn', 'Hg', 'Cd', 'Zn',
  'Nh', 'Tl', 'In', 'Ga', 'Al', 'B', 'Fl', 'Pb', 'Sn', 'Ge', 'Si', 'C', 'Mc', 'Bi', 'Sb', 'As', 'P', 'N', 'H',
  'Lv', 'Po', 'Te', 'Se', 'S', 'O', 'Ts', 'At', 'I', 'Br', 'Cl', 'F',
]
const sequenceIndexByZ = new Map<number, number>()
SEQUENCE.forEach((s, i) => {
  const e = bySymbol.get(s)
  if (e) sequenceIndexByZ.set(e.atomicNumber, i)
})

/** Tabla periódica: los 118 elementos y búsquedas. */
export const PeriodicTable = {
  /** Los 118 elementos ordenados por número atómico. */
  elements: ALL_ELEMENTS,

  /** Elemento por número atómico (1…118). */
  byNumber(z: number): Element | null {
    return Number.isInteger(z) && z >= 1 && z <= ALL_ELEMENTS.length ? ALL_ELEMENTS[z - 1] : null
  },

  /** Elemento por símbolo, respetando mayúsculas: «Co» es cobalto; «CO» no es un símbolo. */
  bySymbol(symbol: string): Element | null {
    return bySymbol.get(symbol) ?? null
  },

  /** Elemento por nombre en español o inglés, sin importar acentos ni mayúsculas («hierro», «Iron», «fosforo»). */
  byName(name: string): Element | null {
    return byFoldedName.get(fold(name)) ?? null
  },

  /**
   * Búsqueda flexible: símbolo exacto, número atómico, nombre (es/en) y, por último, símbolo sin distinguir
   * mayúsculas («fe» → Fe). `null` si no hay coincidencia clara.
   */
  search(query: string): Element | null {
    const q = trimAll(query)
    if (!q || charCount(q) > 60) return null
    const exact = bySymbol.get(q)
    if (exact) return exact
    const z = parseIntStrict(q)
    if (z !== null) return PeriodicTable.byNumber(z)
    const named = PeriodicTable.byName(q)
    if (named) return named
    // «Z=26», «número atómico 26», «elemento 26».
    const folded = fold(q)
    for (const prefix of ['numero atomico', 'numero', 'elemento', 'z']) {
      if (!folded.startsWith(prefix)) continue
      const rest = trimChars(folded.slice(prefix.length), ' =:')
      const n = parseIntStrict(rest)
      if (n !== null) return PeriodicTable.byNumber(n)
    }
    const matches = byFoldedSymbol.get(q.toLowerCase())
    if (matches && matches.length === 1) return matches[0]
    return null
  },

  /** Elementos de un grupo (1–18), de arriba abajo. */
  inGroup(group: number): Element[] {
    return ALL_ELEMENTS.filter((e) => e.group === group)
  },

  /** Elementos de un periodo (1–7), incluidos lantánidos y actínidos. */
  inPeriod(period: number): Element[] {
    return ALL_ELEMENTS.filter((e) => e.period === period)
  },

  /** Gases nobles usados como núcleo en las configuraciones abreviadas. */
  nobleGasCores: Object.freeze([
    { symbol: 'He', electrons: 2 }, { symbol: 'Ne', electrons: 10 }, { symbol: 'Ar', electrons: 18 },
    { symbol: 'Kr', electrons: 36 }, { symbol: 'Xe', electrons: 54 }, { symbol: 'Rn', electrons: 86 },
  ]) as readonly NobleGasCore[],

  /**
   * Posición del elemento en la secuencia de la IUPAC (Tabla VI de las Recomendaciones de 2005) para ordenar fórmulas
   * inorgánicas: el que va antes se escribe primero (NaCl, NH3, H2O, OF2, CaCO3).
   */
  sequenceIndex(z: number): number {
    return sequenceIndexByZ.get(z) ?? 999
  },
}
