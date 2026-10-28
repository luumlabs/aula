import { tr } from '../core/i18n'
import { charCount, chars as toChars, foldedLower, isASCII, isLetter, isNumberChar, trimWS } from '../core/text'
import { MV, type MathValue } from '../core/types'
import { Fraction } from '../numbers/fraction'
import { normalizeText } from '../parse/normalizer'

/** Exponentes sobre las magnitudes base `[m, kg, s, A, K, mol, cd, rad]`. */
export type Dimension = readonly number[]

/** Unidad interpretada: dimensión física, factor de conversión al SI y (para °C/°F) desplazamiento. `SI = valor × factor + offset`. */
export interface UnitInfo {
  /** Exponentes sobre las magnitudes base `[m, kg, s, A, K, mol, cd, rad]`. */
  dimension: Dimension
  /** Factor al SI (kg para la masa). */
  factor: number
  /** Desplazamiento al SI (solo temperaturas afines como °C o °F). */
  offset: number
  /** Texto normalizado de la unidad (como se escribió, ya limpio). */
  text: string
  exactFactor: Fraction | null
  exactOffset: Fraction | null
  /**
   * `true` si es una diferencia de temperatura (`Δ°C`, `Δ°F`, `ΔK`): al convertir con ella no se suma el desplazamiento,
   * así una variación de 5 °C es una de 5 K (calorimetría: q = m·c·ΔT).
   */
  isDifference: boolean
}

/** `true` si es una temperatura afín (°C, °F) y no se puede tratar como simple escala. */
export function unitIsAffine(u: UnitInfo): boolean {
  return u.offset !== 0
}

/** Nombre de la magnitud para los mensajes, ya localizado («velocidad», «longitud», «presión»…). */
export function unitQuantityName(u: UnitInfo): string {
  return UnitTable.quantityName(u.dimension)
}

interface Def {
  dims: number[]
  exact: Fraction | null
  factor: number
  prefixable: boolean
  offset: Fraction | null
}

const ZERO_DIMS = [0, 0, 0, 0, 0, 0, 0, 0]

function dims(m = 0, kg = 0, s = 0, a = 0, k = 0, mol = 0, cd = 0, rad = 0): number[] {
  return [m, kg, s, a, k, mol, cd, rad]
}

function sameDims(a: Dimension, b: Dimension): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function def(d: number[], factor: string, prefixable = false, offset: string | null = null): Def {
  const exact = Fraction.parse(factor)
  const value = exact ? exact.doubleValue : Number.isNaN(Number(factor)) ? 1 : Number(factor)
  return { dims: d, exact, factor: value, prefixable, offset: offset !== null ? Fraction.parse(offset) : null }
}

const TABLE: ReadonlyMap<string, Def> = (() => {
  const t = new Map<string, Def>()
  // base y derivadas SI (prefijables)
  t.set('m', def(dims(1), '1', true))
  t.set('g', def(dims(0, 1), '0.001', true))
  t.set('s', def(dims(0, 0, 1), '1', true))
  t.set('A', def(dims(0, 0, 0, 1), '1', true))
  t.set('K', def(dims(0, 0, 0, 0, 1), '1', true))
  t.set('mol', def(dims(0, 0, 0, 0, 0, 1), '1', true))
  t.set('cd', def(dims(0, 0, 0, 0, 0, 0, 1), '1'))
  t.set('Hz', def(dims(0, 0, -1), '1', true))
  t.set('N', def(dims(1, 1, -2), '1', true))
  t.set('Pa', def(dims(-1, 1, -2), '1', true))
  t.set('J', def(dims(2, 1, -2), '1', true))
  t.set('W', def(dims(2, 1, -3), '1', true))
  t.set('C', def(dims(0, 0, 1, 1), '1', true))
  t.set('V', def(dims(2, 1, -3, -1), '1', true))
  t.set('F', def(dims(-2, -1, 4, 2), '1', true))
  t.set('Ω', def(dims(2, 1, -3, -2), '1', true))
  t.set('S', def(dims(-2, -1, 3, 2), '1', true))
  t.set('Wb', def(dims(2, 1, -2, -1), '1', true))
  t.set('T', def(dims(0, 1, -2, -1), '1', true))
  t.set('H', def(dims(2, 1, -2, -2), '1', true))
  t.set('Bq', def(dims(0, 0, -1), '1', true))
  t.set('L', def(dims(3), '0.001', true))
  t.set('l', t.get('L') as Def)
  t.set('M', def(dims(-3, 0, 0, 0, 0, 1), '1000', true)) // molar = mol/L
  t.set('bar', def(dims(-1, 1, -2), '100000', true))
  t.set('cal', def(dims(2, 1, -2), '4.184', true))
  t.set('Cal', def(dims(2, 1, -2), '4184'))
  t.set('eV', def(dims(2, 1, -2), '1.602176634e-19', true))
  t.set('Wh', def(dims(2, 1, -2), '3600', true))
  // tiempo
  t.set('min', def(dims(0, 0, 1), '60'))
  t.set('h', def(dims(0, 0, 1), '3600'))
  t.set('d', def(dims(0, 0, 1), '86400'))
  t.set('yr', def(dims(0, 0, 1), '31557600'))
  t.set('rpm', def(dims(0, 0, -1), '1/60'))
  // longitud y masa no SI
  t.set('in', def(dims(1), '0.0254'))
  t.set('ft', def(dims(1), '0.3048'))
  t.set('yd', def(dims(1), '0.9144'))
  t.set('mi', def(dims(1), '1609.344'))
  t.set('Å', def(dims(1), '1e-10'))
  t.set('lb', def(dims(0, 1), '0.45359237'))
  t.set('oz', def(dims(0, 1), '0.028349523125'))
  t.set('t', def(dims(0, 1), '1000'))
  // presión, volumen, fuerza, potencia, velocidad
  t.set('atm', def(dims(-1, 1, -2), '101325'))
  t.set('mmHg', def(dims(-1, 1, -2), '20265/152'))
  t.set('torr', def(dims(-1, 1, -2), '20265/152'))
  t.set('psi', def(dims(-1, 1, -2), '6894.757293168361'))
  t.set('gal', def(dims(3), '0.003785411784'))
  t.set('qt', def(dims(3), '0.000946352946'))
  t.set('lbf', def(dims(1, 1, -2), '4.4482216152605'))
  t.set('kgf', def(dims(1, 1, -2), '9.80665'))
  t.set('hp', def(dims(2, 1, -3), '745.69987158227022'))
  t.set('mph', def(dims(1, 0, -1), '0.44704'))
  // adimensionales
  t.set('%', def(ZERO_DIMS, '0.01'))
  t.set('‰', def(ZERO_DIMS, '0.001'))
  t.set('ppm', def(ZERO_DIMS, '1e-6'))
  t.set('ppb', def(ZERO_DIMS, '1e-9'))
  // ángulos
  t.set('rad', def(dims(0, 0, 0, 0, 0, 0, 0, 1), '1', true))
  t.set('°', def(dims(0, 0, 0, 0, 0, 0, 0, 1), '0.017453292519943295'))
  t.set('deg', t.get('°') as Def)
  // temperaturas afines
  t.set('°C', def(dims(0, 0, 0, 0, 1), '1', false, '5463/20'))
  t.set('°F', def(dims(0, 0, 0, 0, 1), '5/9', false, '45967/180'))
  // diferencias de temperatura (sin desplazamiento): ΔT = 5 °C = 5 K = 9 °F
  t.set('Δ°C', def(dims(0, 0, 0, 0, 1), '1'))
  t.set('Δ°F', def(dims(0, 0, 0, 0, 1), '5/9'))
  t.set('ΔK', def(dims(0, 0, 0, 0, 1), '1'))
  return t
})()

/** Nombres completos (sin acentos, en minúsculas) → símbolo. */
const WORDS: ReadonlyMap<string, string> = (() => {
  const w = new Map<string, string>()
  const add = (symbol: string, names: string[]): void => {
    for (const n of names) w.set(n, symbol)
  }
  add('m', ['meter', 'meters', 'metre', 'metres', 'metro', 'metros'])
  add('km', ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kilometro', 'kilometros'])
  add('cm', ['centimeter', 'centimeters', 'centimetre', 'centimetro', 'centimetros'])
  add('mm', ['millimeter', 'millimeters', 'millimetre', 'milimetro', 'milimetros'])
  add('s', ['second', 'seconds', 'sec', 'secs', 'segundo', 'segundos', 'seg'])
  add('min', ['minute', 'minutes', 'mins', 'minuto', 'minutos'])
  add('h', ['hour', 'hours', 'hr', 'hrs', 'hora', 'horas'])
  add('d', ['day', 'days', 'dia', 'dias'])
  add('yr', ['year', 'years', 'ano', 'anos', 'año', 'años', 'yrs'])
  add('kg', ['kilogram', 'kilograms', 'kilogramo', 'kilogramos', 'kilo', 'kilos'])
  add('g', ['gram', 'grams', 'gramo', 'gramos'])
  add('mg', ['milligram', 'milligrams', 'miligramo', 'miligramos'])
  add('L', ['liter', 'liters', 'litre', 'litres', 'litro', 'litros'])
  add('mL', ['milliliter', 'milliliters', 'mililitro', 'mililitros'])
  add('N', ['newton', 'newtons'])
  add('J', ['joule', 'joules', 'julio', 'julios'])
  add('kJ', ['kilojoule', 'kilojoules', 'kilojulio', 'kilojulios'])
  add('W', ['watt', 'watts', 'vatio', 'vatios'])
  add('Pa', ['pascal', 'pascals', 'pascales'])
  add('Hz', ['hertz', 'hercio', 'hercios'])
  add('V', ['volt', 'volts', 'voltio', 'voltios'])
  add('A', ['ampere', 'amperes', 'amp', 'amps', 'amperio', 'amperios'])
  add('Ω', ['ohm', 'ohms', 'ohmio', 'ohmios'])
  add('K', ['kelvin', 'kelvins'])
  add('°C', ['celsius', 'centigrade', 'centigrado', 'centigrados', 'degc', 'degreec'])
  add('°F', ['fahrenheit', 'degf', 'degreef'])
  add('mol', ['mole', 'moles', 'mols'])
  add('°', ['degree', 'degrees', 'grado', 'grados', 'deg'])
  add('rad', ['radian', 'radians', 'radian', 'radianes'])
  add('%', ['percent', 'percentage'])
  add('atm', ['atmosphere', 'atmospheres', 'atmosfera', 'atmosferas'])
  add('cal', ['calorie', 'calories', 'caloria', 'calorias'])
  add('kcal', ['kilocalorie', 'kilocalories', 'kilocaloria', 'kilocalorias'])
  add('ft', ['foot', 'feet', 'pie', 'pies'])
  add('in', ['inch', 'inches', 'pulgada', 'pulgadas'])
  add('mi', ['mile', 'miles', 'milla', 'millas'])
  add('lb', ['pound', 'pounds', 'libra', 'libras', 'lbs'])
  add('mmHg', ['torr'])
  return w
})()

function p10(e: number): Fraction {
  if (e >= 0) return Fraction.int(10).power(e) ?? Fraction.ONE
  return Fraction.ONE.divided(Fraction.int(10).power(-e) ?? Fraction.ONE) ?? Fraction.ONE
}

const PREFIXES: ReadonlyArray<[string, Fraction]> = [
  ['k', p10(3)], ['M', p10(6)], ['G', p10(9)], ['T', p10(12)], ['P', p10(15)],
  ['c', p10(-2)], ['d', p10(-1)], ['m', p10(-3)], ['µ', p10(-6)], ['μ', p10(-6)], ['u', p10(-6)],
  ['n', p10(-9)], ['p', p10(-12)], ['f', p10(-15)],
]

/** Unidades base ordenadas por frecuencia de uso (desempata «Km» entre kilómetro y kilomolar). */
const COMMON_BASES = ['m', 'g', 's', 'L', 'l', 'mol', 'N', 'J', 'W', 'Pa', 'Hz', 'V', 'A', 'K', 'C', 't', 'F', 'H', 'T', 'M', 'S']

interface Resolved {
  dims: number[]
  exact: Fraction | null
  factor: number
  offset: Fraction | null
}

function make(d: Def, prefix?: Fraction): Resolved {
  if (!prefix) return { dims: d.dims, exact: d.exact, factor: d.factor, offset: d.offset }
  const exact = d.exact ? d.exact.multiplied(prefix) : null
  return { dims: d.dims, exact, factor: d.factor * prefix.doubleValue, offset: null }
}

function resolveSymbol(raw: string): Resolved | null {
  const sym = raw.split('º').join('°')
  const direct = TABLE.get(sym)
  if (direct) return make(direct)
  // nombre completo
  const folded = foldedLower(sym)
  const symbol = WORDS.get(folded)
  if (symbol !== undefined) {
    const d = TABLE.get(symbol)
    if (d) return make(d)
    if (symbol !== sym) {
      const r = resolveSymbol(symbol)
      if (r) return r
    }
  }
  // prefijo + unidad
  const symLen = charCount(sym)
  for (const [p, pf] of PREFIXES) {
    if (!sym.startsWith(p) || symLen <= charCount(p)) continue
    const rest = sym.slice(p.length)
    const d = TABLE.get(rest)
    if (d && d.prefixable) return make(d, pf)
  }
  // sin distinguir mayúsculas: solo si hay una única lectura (o una claramente más común)
  const found: Resolved[] = []
  for (const [k, d] of TABLE) if (foldedLower(k) === folded) found.push(make(d))
  if (found.length === 1) return found[0]
  if (found.length === 0) {
    const candidates: Array<{ rank: number; key: string; value: Resolved }> = []
    const foldedLen = charCount(folded)
    for (const [p, pf] of PREFIXES) {
      const fp = foldedLower(p)
      if (!folded.startsWith(fp) || foldedLen <= charCount(p)) continue
      const rest = folded.slice(fp.length)
      for (const [k, d] of TABLE) {
        if (!d.prefixable || foldedLower(k) !== rest) continue
        const idx = COMMON_BASES.indexOf(k)
        candidates.push({ rank: idx >= 0 ? idx : COMMON_BASES.length, key: p + '|' + k, value: make(d, pf) })
      }
    }
    // «KM» / «Km» → km: gana la unidad base más común (m antes que M molar); el orden es determinista
    let best: (typeof candidates)[number] | undefined
    for (const c of candidates) {
      if (!best || c.rank < best.rank || (c.rank === best.rank && c.key < best.key)) best = c
    }
    if (best) return best.value
  }
  return null
}

const PHRASES: ReadonlyArray<[string, string]> = [
  ['grados celsius', '°C'], ['degrees celsius', '°C'], ['degree celsius', '°C'], ['grado celsius', '°C'],
  ['grados centigrados', '°C'], ['grados fahrenheit', '°F'], ['degrees fahrenheit', '°F'],
  ['degree fahrenheit', '°F'], ['grado fahrenheit', '°F'], ['mm hg', 'mmHg'], ['por ciento', '%'],
  ['delta_degc', 'Δ°C'], ['delta degc', 'Δ°C'], ['delta °c', 'Δ°C'], ['δ °c', 'Δ°C'], ['delta_degf', 'Δ°F'],
  ['delta degf', 'Δ°F'], ['delta °f', 'Δ°F'], ['δ °f', 'Δ°F'], ['delta_k', 'ΔK'], ['delta k', 'ΔK'], ['δ k', 'ΔK'],
]

interface Acc {
  dims: number[]
  exact: Fraction | null
  factor: number
  offset: Fraction | null
  exponentSum: number
}

const SAFE = Number.MAX_SAFE_INTEGER

class UnitParser {
  pos = 0
  /** ¿La unidad completa es un único símbolo con exponente 1? */
  singleSymbol = false
  private symbolCount = 0

  constructor(private readonly chars: readonly string[]) {}

  parse(): Acc | null {
    const acc = this.parseSequence()
    if (!acc) return null
    this.skipSpaces()
    if (this.pos !== this.chars.length) return null
    this.singleSymbol = this.symbolCount === 1
    return acc
  }

  private skipSpaces(): void {
    while (this.pos < this.chars.length && this.chars[this.pos] === ' ') this.pos += 1
  }

  /** Producto de factores. Todo lo que sigue a una barra `/` (en este nivel de paréntesis) va al denominador. */
  private parseSequence(): Acc | null {
    const acc: Acc = { dims: [0, 0, 0, 0, 0, 0, 0, 0], exact: Fraction.ONE, factor: 1, offset: null, exponentSum: 0 }
    let sign = 1
    for (;;) {
      this.skipSpaces()
      if (this.pos >= this.chars.length) break
      const c = this.chars[this.pos]
      if (c === ')') break
      if (c === '*' || c === '·') {
        this.pos += 1
        continue
      }
      if (c === '/') {
        this.pos += 1
        sign = -1
        continue
      }
      const f = this.parseFactor()
      if (!f) return null
      const [r, exp] = f
      const k = exp * sign
      const exponentSum = acc.exponentSum + k
      if (Math.abs(exponentSum) > SAFE) return null
      acc.exponentSum = exponentSum
      for (let i = 0; i < 8; i++) {
        const v = acc.dims[i] + r.dims[i] * k
        if (Math.abs(v) > SAFE) return null
        acc.dims[i] = v
      }
      acc.factor *= Math.pow(r.factor, k)
      const p = acc.exact && r.exact ? r.exact.power(k) : null
      const m = acc.exact && p ? acc.exact.multiplied(p) : null
      acc.exact = m
      if (r.offset) acc.offset = r.offset
    }
    return acc
  }

  /** Un factor: símbolo o grupo entre paréntesis, con exponente opcional. Devuelve la unidad y su exponente. */
  private parseFactor(): [Resolved, number] | null {
    const chars = this.chars
    this.skipSpaces()
    if (this.pos >= chars.length) return null
    let base: Resolved
    if (chars[this.pos] === '(') {
      this.pos += 1
      const savedCount = this.symbolCount
      const inner = this.parseSequence()
      if (!inner) return null
      this.skipSpaces()
      if (!(this.pos < chars.length && chars[this.pos] === ')')) return null
      this.pos += 1
      this.symbolCount = savedCount + 2 // un grupo nunca cuenta como símbolo único
      base = { dims: inner.dims, exact: inner.exact, factor: inner.factor, offset: null }
    } else if (isNumberChar(chars[this.pos])) {
      // el "1" de "1/s" (solo como numerador: "1 km" no es una unidad)
      let k = this.pos
      while (k < chars.length && isNumberChar(chars[k])) k += 1
      if (chars.slice(this.pos, k).join('') !== '1') return null
      let after = k
      while (after < chars.length && chars[after] === ' ') after += 1
      if (!(after < chars.length && chars[after] === '/')) return null
      this.pos = k
      base = { dims: [0, 0, 0, 0, 0, 0, 0, 0], exact: Fraction.ONE, factor: 1, offset: null }
    } else {
      let k = this.pos
      while (k < chars.length && isSymbolChar(chars[k])) k += 1
      if (!(k > this.pos)) return null
      const raw = chars.slice(this.pos, k).join('')
      const r = resolveSymbol(raw)
      if (!r) return null
      this.pos = k
      this.symbolCount += 1
      base = r
    }
    // exponente: ^2, ^-1, ^(−1), pegado (m2, s-1)
    let exp = 1
    if (this.pos < chars.length && chars[this.pos] === '^') {
      this.pos += 1
      const e = this.parseSignedInt(true)
      if (e === null) return null
      exp = e
    } else if (
      this.pos < chars.length &&
      (isNumberChar(chars[this.pos]) || ((chars[this.pos] === '-' || chars[this.pos] === '−') && this.pos + 1 < chars.length && isNumberChar(chars[this.pos + 1])))
    ) {
      const e = this.parseSignedInt(false)
      if (e === null) return null
      exp = e
    }
    return [base, exp]
  }

  private parseSignedInt(allowParens: boolean): number | null {
    const chars = this.chars
    let paren = false
    if (allowParens && this.pos < chars.length && chars[this.pos] === '(') {
      paren = true
      this.pos += 1
    }
    let neg = false
    if (this.pos < chars.length && (chars[this.pos] === '-' || chars[this.pos] === '−')) {
      neg = true
      this.pos += 1
    } else if (this.pos < chars.length && chars[this.pos] === '+') this.pos += 1
    let k = this.pos
    while (k < chars.length && isNumberChar(chars[k]) && isASCII(chars[k])) k += 1
    if (!(k > this.pos) || k - this.pos > 2) return null
    const v = Number(chars.slice(this.pos, k).join(''))
    this.pos = k
    if (paren) {
      if (!(this.pos < chars.length && chars[this.pos] === ')')) return null
      this.pos += 1
    }
    return neg ? -v : v
  }
}

function isSymbolChar(c: string): boolean {
  return isLetter(c) || c === '°' || c === '%' || c === '‰' || c === 'Ω' || c === 'µ' || c === 'μ' || c === 'º'
}

const QUANTITY_NAMES: ReadonlyArray<[number[], () => string]> = [
  [dims(), () => noUnits()],
  [dims(1), () => tr('longitud')],
  [dims(0, 1), () => tr('masa')],
  [dims(0, 0, 1), () => tr('tiempo')],
  [dims(0, 0, 0, 1), () => tr('corriente eléctrica')],
  [dims(0, 0, 0, 0, 1), () => tr('temperatura')],
  [dims(0, 0, 0, 0, 0, 1), () => tr('cantidad de sustancia')],
  [dims(0, 0, 0, 0, 0, 0, 0, 1), () => tr('ángulo')],
  [dims(2), () => tr('área')],
  [dims(3), () => tr('volumen')],
  [dims(1, 0, -1), () => tr('velocidad')],
  [dims(1, 0, -2), () => tr('aceleración')],
  [dims(0, 0, -1), () => tr('frecuencia')],
  [dims(1, 1, -2), () => tr('fuerza')],
  [dims(-1, 1, -2), () => tr('presión')],
  [dims(2, 1, -2), () => tr('energía')],
  [dims(2, 1, -3), () => tr('potencia')],
  [dims(0, 0, 1, 1), () => tr('carga eléctrica')],
  [dims(2, 1, -3, -1), () => tr('voltaje')],
  [dims(2, 1, -3, -2), () => tr('resistencia')],
  [dims(-2, -1, 4, 2), () => tr('capacitancia')],
  [dims(-3, 1), () => tr('densidad')],
  [dims(-3, 0, 0, 0, 0, 1), () => tr('concentración molar')],
  [dims(0, -1, 0, 0, 0, 1), () => tr('cantidad por masa')],
  [dims(0, 1, 0, 0, 0, -1), () => tr('masa molar')],
  [dims(2, 1, -2, 0, -1), () => tr('capacidad térmica')],
  [dims(2, 0, -2, 0, -1), () => tr('calor específico')],
  [dims(2, 1, -2, 0, -1, -1), () => tr('constante de los gases')],
]

function noUnits(): string {
  return tr('una cantidad sin unidades')
}

/** Unidades frecuentes en clase, para adivinar en qué unidad se calculó un número escrito sin unidad. */
const COMMON_SYMBOLS = [
  'm', 'cm', 'mm', 'km', 'µm', 'nm', 'g', 'kg', 'mg', 'µg', 's', 'ms', 'min', 'h', 'L', 'mL', 'J', 'kJ', 'cal', 'kcal',
  'N', 'kN', 'Pa', 'kPa', 'MPa', 'atm', 'mmHg', 'bar', 'K', '°C', '°F', 'mol', 'mmol', 'M', 'mM', 'W', 'kW', 'Hz', 'kHz',
  'V', 'mV', 'A', 'mA', 'Ω', 'kΩ', '°', 'rad', '%', 'm/s', 'km/h', 'm/s^2', 'g/mL', 'kg/m^3', 'g/mol', 'g/L', 'mol/L',
]

/** Parseo y conversión de unidades de Matemáticas, Física, Química y Biología. */
export const UnitTable = {
  /**
   * Interpreta una unidad o producto/cociente de unidades: `m/s`, `kg·m/s²`, `J/(mol·K)`, `m s^-1`, `°C`, `mol/L`.
   * Todo lo que sigue a la primera barra `/` va al denominador (`J/mol·K` = J/(mol·K)).
   */
  parse(text: string): UnitInfo | null {
    let s = trimWS(normalizeText(text).string)
    if (s === '' || charCount(s) > 60) return null
    // frases que contienen un espacio pero son una sola unidad
    const folded = foldedLower(s)
    for (const [pattern, symbol] of PHRASES) if (folded === pattern) s = symbol
    const parser = new UnitParser(toChars(s))
    const r = parser.parse()
    if (!r) return null
    const single = parser.singleSymbol
    const affine = single && r.exponentSum === 1 && r.offset !== null
    const factor = r.exact ? r.exact.doubleValue : r.factor
    return {
      dimension: r.dims,
      factor,
      offset: affine ? (r.offset?.doubleValue ?? 0) : 0,
      text: s,
      exactFactor: r.exact,
      exactOffset: affine ? r.offset : null,
      isDifference: single && r.exponentSum === 1 && s.startsWith('Δ') && sameDims(r.dims, dims(0, 0, 0, 0, 1)),
    }
  },

  /**
   * ¿Una es kelvin y la otra grados Celsius (misma escala, distinto origen)? «5 K» y «5 °C» son la misma diferencia de
   * temperatura pero temperaturas muy distintas.
   */
  isKelvinCelsiusPair(a: UnitInfo, b: UnitInfo): boolean {
    const k = dims(0, 0, 0, 0, 1)
    if (!sameDims(a.dimension, k) || !sameDims(b.dimension, k) || a.isDifference || b.isDifference) return false
    if (!(Math.abs(a.factor - 1) <= 1e-12 && Math.abs(b.factor - 1) <= 1e-12)) return false
    return (a.offset === 0) !== (b.offset === 0)
  },

  commonSymbols: COMMON_SYMBOLS as readonly string[],

  /** Unidades habituales con la misma dimensión que `u` (sin repetir su escala). */
  commonUnits(u: UnitInfo): Array<{ symbol: string; unit: UnitInfo }> {
    const out: Array<{ symbol: string; unit: UnitInfo }> = []
    for (const s of COMMON_SYMBOLS) {
      const c = UnitTable.parse(s)
      if (!c || !sameDims(c.dimension, u.dimension)) continue
      if (Math.abs(c.factor - u.factor) <= 1e-12 * Math.abs(u.factor) && c.offset === u.offset) continue
      out.push({ symbol: s, unit: c })
    }
    return out
  },

  /** ¿Tienen las dos unidades la misma dimensión física? */
  areCompatible(a: string, b: string): boolean {
    const x = UnitTable.parse(a)
    const y = UnitTable.parse(b)
    return !!x && !!y && sameDims(x.dimension, y.dimension)
  },

  /** Convierte un valor entre unidades (texto) de la misma dimensión; `null` si no se pueden convertir. */
  convert(value: number, from: string, to: string): number | null {
    const f = UnitTable.parse(from)
    const t = UnitTable.parse(to)
    if (!f || !t) return null
    return UnitTable.convertUnits(value, f, t)
  },

  /**
   * Convierte entre dos unidades ya interpretadas; `null` si sus dimensiones no coinciden.
   * Si una de las dos es una diferencia de temperatura (`Δ°C`), la otra también se toma como diferencia.
   */
  convertUnits(value: number, f: UnitInfo, t: UnitInfo): number | null {
    if (!sameDims(f.dimension, t.dimension) || t.factor === 0) return null
    const difference = f.isDifference || t.isDifference
    return (value * f.factor + (difference ? 0 : f.offset) - (difference ? 0 : t.offset)) / t.factor
  },

  /** Conversión exacta cuando todos los factores son racionales. */
  convertValue(value: MathValue, f: UnitInfo, t: UnitInfo): MathValue | null {
    if (!sameDims(f.dimension, t.dimension)) return null
    const difference = f.isDifference || t.isDifference
    if (value.kind === 'rational' && f.exactFactor && t.exactFactor) {
      const fo = difference ? Fraction.ZERO : (f.exactOffset ?? Fraction.ZERO)
      const to = difference ? Fraction.ZERO : (t.exactOffset ?? Fraction.ZERO)
      const si = value.value.multiplied(f.exactFactor)?.adding(fo) ?? null
      const shifted = si ? si.subtracting(to) : null
      const r = shifted ? shifted.divided(t.exactFactor) : null
      if (r) return MV.rational(r)
    }
    const d = UnitTable.convertUnits(MV.double(value), f, t)
    return d === null ? null : MV.real(d)
  },

  /** ¿Misma dimensión? */
  sameDimension(a: Dimension, b: Dimension): boolean {
    return sameDims(a, b)
  },

  /**
   * Nombre de la magnitud de una dimensión, para los mensajes («se esperaba una unidad de longitud»). Solo se muestra.
   * Si no tiene nombre, la fórmula de la dimensión (`m^2·kg`), que no se traduce.
   */
  quantityName(d: Dimension): string {
    const known = QUANTITY_NAMES.find(([k]) => sameDims(k, d))
    if (known) return known[1]()
    const names = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd', 'rad']
    const parts = names.map((n, i) => [n, d[i]] as const).filter(([, e]) => e !== 0).map(([n, e]) => (e === 1 ? n : `${n}^${e}`))
    return parts.length === 0 ? noUnits() : parts.join('·')
  },
}
