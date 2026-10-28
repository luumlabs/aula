// Cantidades con unidad: magnitudes, unidades, lectura de textos («10 g», «25 mL 0.10 M», «5.6 L CN») y resultados de cálculo.

import { ChemError } from './errors'
import { L } from './l10n'
import { countSigFigs, normalizedNumberText, readNumber, SigFigCount } from './sigfigs'
import { charCount, chars, fold, isDigit, isLetter, significant, trimmed, trimSpaces } from './text'

/** Magnitud física de una unidad. */
export type ChemDimension = 'mass' | 'amount' | 'particles' | 'volume' | 'pressure' | 'temperature' | 'molarity' | 'molality' | 'energy'

const DIMENSION_TITLES: Readonly<Record<ChemDimension, string>> = {
  mass: 'masa',
  amount: 'cantidad de sustancia',
  particles: 'número de partículas',
  volume: 'volumen',
  pressure: 'presión',
  temperature: 'temperatura',
  molarity: 'molaridad',
  molality: 'molalidad',
  energy: 'energía',
}

/** Nombre de la magnitud en español, en minúscula. */
export const dimensionTitle = (d: ChemDimension): string => DIMENSION_TITLES[d]
/** Nombre de la magnitud en el idioma de la interfaz, para usarlo dentro de una frase («g (masa)»). */
export const localizedDimensionTitle = (d: ChemDimension): string => L(DIMENSION_TITLES[d])

/** Unidades que entiende ChemKit (los nombres son los de la app Swift). */
export type ChemUnit =
  | 'gram' | 'milligram' | 'kilogram' | 'microgram'
  | 'mole' | 'millimole' | 'micromole' | 'kilomole'
  | 'particles'
  | 'liter' | 'milliliter' | 'microliter' | 'cubicCentimeter' | 'cubicDecimeter' | 'cubicMeter'
  | 'atmosphere' | 'kilopascal' | 'pascal' | 'bar' | 'millibar' | 'millimeterOfMercury' | 'torr' | 'psi'
  | 'kelvin' | 'celsius' | 'fahrenheit'
  | 'molar' | 'millimolar' | 'molal'
  | 'joule' | 'kilojoule' | 'calorie' | 'kilocalorie'

interface UnitInfo {
  symbol: string
  dimension: ChemDimension
  /** Factor a la unidad base de su magnitud (g, mol, 1, L, Pa, K*, mol/L, mol/kg, J). *La temperatura es afín. */
  factor: number
}

const UNITS: Readonly<Record<ChemUnit, UnitInfo>> = {
  gram: { symbol: 'g', dimension: 'mass', factor: 1 },
  milligram: { symbol: 'mg', dimension: 'mass', factor: 1e-3 },
  kilogram: { symbol: 'kg', dimension: 'mass', factor: 1e3 },
  microgram: { symbol: 'µg', dimension: 'mass', factor: 1e-6 },
  mole: { symbol: 'mol', dimension: 'amount', factor: 1 },
  millimole: { symbol: 'mmol', dimension: 'amount', factor: 1e-3 },
  micromole: { symbol: 'µmol', dimension: 'amount', factor: 1e-6 },
  kilomole: { symbol: 'kmol', dimension: 'amount', factor: 1e3 },
  particles: { symbol: 'partículas', dimension: 'particles', factor: 1 },
  liter: { symbol: 'L', dimension: 'volume', factor: 1 },
  milliliter: { symbol: 'mL', dimension: 'volume', factor: 1e-3 },
  microliter: { symbol: 'µL', dimension: 'volume', factor: 1e-6 },
  cubicCentimeter: { symbol: 'cm³', dimension: 'volume', factor: 1e-3 },
  cubicDecimeter: { symbol: 'dm³', dimension: 'volume', factor: 1 },
  cubicMeter: { symbol: 'm³', dimension: 'volume', factor: 1e3 },
  atmosphere: { symbol: 'atm', dimension: 'pressure', factor: 101_325 },
  kilopascal: { symbol: 'kPa', dimension: 'pressure', factor: 1_000 },
  pascal: { symbol: 'Pa', dimension: 'pressure', factor: 1 },
  bar: { symbol: 'bar', dimension: 'pressure', factor: 100_000 },
  millibar: { symbol: 'mbar', dimension: 'pressure', factor: 100 },
  millimeterOfMercury: { symbol: 'mmHg', dimension: 'pressure', factor: 101_325.0 / 760.0 },
  torr: { symbol: 'torr', dimension: 'pressure', factor: 101_325.0 / 760.0 },
  psi: { symbol: 'psi', dimension: 'pressure', factor: 6_894.757_293_168 },
  kelvin: { symbol: 'K', dimension: 'temperature', factor: 1 },
  celsius: { symbol: '°C', dimension: 'temperature', factor: 1 },
  fahrenheit: { symbol: '°F', dimension: 'temperature', factor: 1 },
  molar: { symbol: 'M', dimension: 'molarity', factor: 1 },
  millimolar: { symbol: 'mM', dimension: 'molarity', factor: 1e-3 },
  molal: { symbol: 'm', dimension: 'molality', factor: 1 },
  joule: { symbol: 'J', dimension: 'energy', factor: 1 },
  kilojoule: { symbol: 'kJ', dimension: 'energy', factor: 1_000 },
  calorie: { symbol: 'cal', dimension: 'energy', factor: 4.184 },
  kilocalorie: { symbol: 'kcal', dimension: 'energy', factor: 4_184 },
}

export const CHEM_UNITS = Object.keys(UNITS) as ChemUnit[]

/** Símbolo para mostrar (fijo: también se usa en los informes para la IA y en los datos). */
export const unitSymbol = (u: ChemUnit): string => UNITS[u].symbol
/** Símbolo para una frase en el idioma de la interfaz: el mismo, salvo «partículas», que es una palabra. */
export const localizedUnitSymbol = (u: ChemUnit): string => (u === 'particles' ? L('partículas') : UNITS[u].symbol)
export const unitDimension = (u: ChemUnit): ChemDimension => UNITS[u].dimension
export const unitFactor = (u: ChemUnit): number => UNITS[u].factor

/** Valor en la unidad base de su magnitud (kelvin para temperaturas). */
export function toBase(u: ChemUnit, v: number): number {
  if (u === 'celsius') return v + 273.15
  if (u === 'fahrenheit') return ((v - 32) * 5) / 9 + 273.15
  return v * UNITS[u].factor
}

/** Valor desde la unidad base. */
export function fromBase(u: ChemUnit, v: number): number {
  if (u === 'celsius') return v - 273.15
  if (u === 'fahrenheit') return ((v - 273.15) * 9) / 5 + 32
  return v / UNITS[u].factor
}

const SYNONYMS: ReadonlyMap<string, ChemUnit> = (() => {
  const d = new Map<string, ChemUnit>()
  const add = (u: ChemUnit, names: string[]): void => names.forEach((n) => d.set(n, u))
  add('gram', ['g', 'gr', 'grs', 'gramo', 'gramos', 'gram', 'grams'])
  add('milligram', ['mg', 'miligramo', 'miligramos', 'milligram', 'milligrams'])
  add('kilogram', ['kg', 'kilogramo', 'kilogramos', 'kilo', 'kilos', 'kilogram', 'kilograms'])
  add('microgram', ['µg', 'μg', 'ug', 'mcg', 'microgramo', 'microgramos'])
  add('mole', ['mol', 'moles', 'mole', 'mols'])
  add('millimole', ['mmol', 'milimol', 'milimoles', 'millimol', 'millimoles'])
  add('micromole', ['µmol', 'μmol', 'umol', 'micromol', 'micromoles'])
  add('kilomole', ['kmol', 'kilomol', 'kilomoles'])
  add('particles', [
    'particulas', 'particula', 'moleculas', 'molecula', 'atomos', 'atomo', 'iones', 'ion', 'unidades formula', 'unidad formula',
    'entidades', 'entidades elementales', 'particles', 'particle', 'molecules', 'molecule', 'atoms', 'atom', 'ions',
    'formula units', 'formula unit',
  ])
  add('liter', ['l', 'litro', 'litros', 'liter', 'liters', 'litre', 'litres'])
  add('cubicDecimeter', ['dm3', 'dm³', 'dm^3'])
  add('milliliter', ['ml', 'mililitro', 'mililitros', 'milliliter', 'milliliters', 'millilitre'])
  add('cubicCentimeter', ['cm3', 'cm³', 'cm^3', 'cc'])
  add('microliter', ['µl', 'μl', 'ul', 'microlitro', 'microlitros'])
  add('cubicMeter', ['m3', 'm³', 'm^3'])
  add('atmosphere', ['atm', 'atmosfera', 'atmosferas', 'atmosphere', 'atmospheres'])
  add('kilopascal', ['kpa', 'kilopascal', 'kilopascales', 'kilopascals'])
  add('pascal', ['pa', 'pascal', 'pascales', 'pascals'])
  add('bar', ['bar', 'bares', 'bars'])
  add('millibar', ['mbar', 'milibar', 'milibares'])
  add('millimeterOfMercury', ['mmhg', 'mm hg', 'mm de hg', 'milimetros de mercurio', 'milimetro de mercurio'])
  add('torr', ['torr'])
  add('psi', ['psi'])
  add('kelvin', ['k', 'kelvin', 'kelvins', 'grados kelvin'])
  add('celsius', ['°c', 'oc', 'c', 'grados celsius', 'celsius', 'grados centigrados', 'grados', '° c'])
  add('fahrenheit', ['°f', 'of', 'fahrenheit', 'grados fahrenheit'])
  add('molar', ['m', 'mol/l', 'mol l-1', 'mol·l-1', 'mol l^-1', 'mol·l^-1', 'mol/dm3', 'mol dm-3', 'molar', 'mol/litro', 'moles/litro', 'moles/l'])
  add('millimolar', ['mm', 'mmol/l', 'milimolar'])
  add('molal', ['molal', 'mol/kg', 'moles/kg', 'mol kg-1'])
  add('joule', ['j', 'julio', 'julios', 'joule', 'joules'])
  add('kilojoule', ['kj', 'kilojulio', 'kilojulios', 'kilojoule', 'kilojoules'])
  add('calorie', ['cal', 'caloria', 'calorias', 'calorie', 'calories'])
  add('kilocalorie', ['kcal', 'kilocaloria', 'kilocalorias', 'kilocalorie', 'kilocalories'])
  return d
})()

/**
 * Lee una unidad: símbolos («mL», «°C», «mol/L») o nombres en español e inglés («gramos», «litros»). Distingue «M»
 * (molar) de «m» (molal) y «mM» de «mm».
 */
export function parseUnit(text: string): ChemUnit | null {
  const t = trimSpaces(text).split('⁻¹').join('-1').split('−').join('-')
  if (!t || charCount(t) > 40) return null
  // Sensibles a mayúsculas.
  switch (t) {
    case 'M':
      return 'molar'
    case 'm':
      return 'molal'
    case 'mM':
      return 'millimolar'
    case 'K':
      return 'kelvin'
    case 'C': case '°C': case 'ºC':
      return 'celsius'
    case 'Cal':
      return 'kilocalorie'
    case 'L': case 'l':
      return 'liter'
  }
  return SYNONYMS.get(fold(t.split('º').join('°'))) ?? null
}

/** Cantidad con unidad, recordando cómo se escribió el número (para las cifras significativas). */
export class ChemQuantity {
  readonly value: number
  readonly unit: ChemUnit
  /** El número tal como se escribió («0.250»). */
  readonly numberText: string
  readonly sigFigs: SigFigCount

  constructor(value: number, unit: ChemUnit, numberText: string | null = null) {
    this.value = value
    this.unit = unit
    const text = numberText ?? trimmed(value, 10)
    this.numberText = text
    this.sigFigs = countSigFigs(text) ?? new SigFigCount(6)
  }

  /** «10 g». */
  toString(): string {
    return `${this.numberText} ${unitSymbol(this.unit)}`
  }

  /** La cantidad para meterla en una frase localizada (con la unidad traducida). */
  get localizedText(): string {
    return `${this.numberText} ${localizedUnitSymbol(this.unit)}`
  }

  get dimension(): ChemDimension {
    return unitDimension(this.unit)
  }

  /** Valor en la unidad base (g, mol, L, Pa, K, mol/L, mol/kg, J). */
  get baseValue(): number {
    return toBase(this.unit, this.value)
  }

  /** Lee «10 g», «0,5 mol», «250 mL», «25 °C», «1.2 atm», «6.02e23 moléculas», «0.1 M». */
  static parse(text: string): ChemQuantity {
    const list = parseQuantityList(text)
    if (list.quantities.length !== 1) throw ChemError.invalidQuantity(text)
    return list.quantities[0]
  }

  /** Convierte a otra unidad de la misma magnitud. */
  convertedTo(target: ChemUnit): ChemQuantity {
    if (unitDimension(target) !== this.dimension) {
      throw ChemError.incompatibleUnits(
        `${localizedUnitSymbol(this.unit)} (${localizedDimensionTitle(this.dimension)})`,
        `${localizedUnitSymbol(target)} (${localizedDimensionTitle(unitDimension(target))})`,
      )
    }
    const v = fromBase(target, this.baseValue)
    return new ChemQuantity(v, target, trimmed(v, 12))
  }
}

const STOP_WORDS = new Set(['y', 'a', 'de', 'en', 'at', 'and', 'of', 'con', 'with', 'un', 'una'])
const STP_WORDS = new Set(['cn', 'c.n.', 'c.n', 'stp', 'tpn', 'cnpt', 'condiciones normales', 'en condiciones normales', 'pts', 'ptn'])

/** Lee varias cantidades en un mismo texto («25 mL 0.10 M», «5.0 L a 25 °C y 1 atm») y palabras clave («CN», «STP»). */
export function parseQuantityList(text: string): { quantities: ChemQuantity[]; keywords: Set<string> } {
  const s = normalizedNumberText(text).split('º').join('°')
  if (!s || charCount(s) > 300) throw ChemError.invalidQuantity(text)
  const c = chars(s)
  // Separa por comas/punto y coma y por un número que empieza tras una palabra.
  const pieces: string[] = []
  let current = ''
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]
    if (ch === ';' || (ch === ',' && !(i > 0 && isDigit(c[i - 1]) && i + 1 < c.length && isDigit(c[i + 1])))) {
      pieces.push(current)
      current = ''
      continue
    }
    // Un número que empieza tras un espacio inicia otra cantidad.
    if (isDigit(ch) || ((ch === '-' || ch === '+' || ch === '.') && i + 1 < c.length && isDigit(c[i + 1]))) {
      const tc = trimSpaces(current)
      const inScientific = ['x', 'X', '×', '*', '·'].some((x) => tc.endsWith(x))
      if (i > 0 && c[i - 1] === ' ' && !inScientific && (chars(current).some(isLetter) || current.includes('°'))) {
        pieces.push(current)
        current = ''
      }
    }
    current += ch
  }
  pieces.push(current)
  const quantities: ChemQuantity[] = []
  const keywords = new Set<string>()
  for (const raw of pieces) {
    let piece = trimSpaces(raw)
    // Quita palabras de enlace al principio.
    for (;;) {
      const first = piece.split(' ').filter((w) => w.length > 0)[0]
      if (first === undefined || !STOP_WORDS.has(fold(first))) break
      piece = trimSpaces(piece.slice(piece.indexOf(first) + first.length))
    }
    if (!piece) continue
    const folded = fold(piece)
    if (STP_WORDS.has(folded)) {
      keywords.add('stp')
      continue
    }
    if (folded === 'satp') {
      keywords.add('satp')
      continue
    }
    if (['gas', 'disolucion', 'solucion', 'solution'].includes(folded)) {
      keywords.add(folded)
      continue
    }
    const pc = chars(piece)
    const read = readNumber(pc, 0)
    if (!read) throw ChemError.invalidQuantity(text)
    const [num, end] = read
    let unitText = trimSpaces(pc.slice(end).join(''))
    // Palabras clave pegadas detrás de la unidad: «5.6 L CN», «22.4 L STP», «5.6 L en condiciones normales».
    for (const phrase of ['en condiciones normales', 'condiciones normales', 'medidos en c.n.', 'medidos en cn']) {
      const fu = fold(unitText)
      const at = fu.indexOf(phrase)
      if (at >= 0) {
        keywords.add('stp')
        unitText = trimSpaces(fu.slice(0, at))
        if (!unitText) unitText = 'L'
        break
      }
    }
    const words = unitText.split(' ').filter((w) => w.length > 0)
    while (words.length > 0 && STP_WORDS.has(fold(words[words.length - 1]))) {
      keywords.add('stp')
      words.pop()
    }
    unitText = words.join(' ')
    // Prueba la unidad completa y luego quitando palabras del final («g de NaCl» → «g»).
    let unit: ChemUnit | null = null
    const w = [...words]
    while (w.length > 0 && unit === null) {
      unit = parseUnit(w.join(' '))
      if (unit === null) w.pop()
    }
    if (unit === null) {
      if (!unitText) throw ChemError.calculation(L('A «%@» le falta la unidad (g, mol, mL, atm, °C…).', num.text))
      throw ChemError.calculation(L('No conozco la unidad «%@». Usa, por ejemplo: g, mg, kg, mol, mL, L, atm, kPa, mmHg, °C, K, M.', unitText))
    }
    quantities.push(new ChemQuantity(num.value, unit, trimSpaces(num.text)))
  }
  if (quantities.length === 0 && keywords.size === 0) throw ChemError.invalidQuantity(text)
  return { quantities, keywords }
}

/** Resultado de un cálculo: valor con unidad y pasos explicados en español (objeto de datos). */
export interface ChemCalculation {
  /** Valor sin redondear. */
  readonly value: number
  /** Unidad del resultado («g», «mol/L», «atm»; vacía si no tiene). */
  readonly unit: string
  /** Cifras significativas que justifican los datos (si se pudieron deducir). */
  readonly significantFigures: number | null
  /** Cifras con que se muestra: las de los datos, pero al menos 3 (si los datos justifican menos, ver `strictFormatted`). */
  readonly displaySigFigs: number
  readonly steps: readonly string[]
  readonly notes: readonly string[]
  /** Valor redondeado para mostrar, con la unidad. */
  readonly formatted: string
  /** Redondeo estricto según los datos, solo si tiene menos cifras que `formatted`. */
  readonly strictFormatted: string | null
  /** Nota sobre las cifras significativas para añadir a la explicación. */
  readonly sigFigsNote: string | null
}

export function makeCalculation(o: {
  value: number
  unit: string
  significantFigures: number | null | undefined
  steps: readonly string[]
  notes?: readonly string[]
  displaySigFigs?: number
}): ChemCalculation {
  const sig = o.significantFigures ?? null
  const display = o.displaySigFigs ?? Math.max(sig ?? 4, 3)
  const withUnit = (n: string): string => (o.unit ? `${n} ${o.unit}` : n)
  const formatted = withUnit(significant(o.value, display))
  const strictFormatted = sig !== null && sig < display ? withUnit(significant(o.value, sig)) : null
  let sigFigsNote: string | null = null
  if (sig !== null) {
    sigFigsNote = strictFormatted
      ? `Con las cifras significativas de los datos (${sig} ${sig === 1 ? 'cifra' : 'cifras'}) habría que dar ${strictFormatted}.`
      : `(${display} cifras significativas, como los datos.)`
  }
  return {
    value: o.value,
    unit: o.unit,
    significantFigures: sig,
    displaySigFigs: display,
    steps: o.steps,
    notes: o.notes ?? [],
    formatted,
    strictFormatted,
    sigFigsNote,
  }
}
