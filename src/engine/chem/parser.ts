// Analizador de fórmulas tal como las escriben alumnos e IA.
//
// Acepta: H2O, Ca(OH)2, Al2(SO4)3, hidratos (CuSO4·5H2O, CuSO4.5H2O, CuSO4*5H2O), complejos ([Fe(CN)6]3-, K4[Fe(CN)6]),
// cargas (SO4^2-, SO4 2-, SO₄²⁻, Fe3+, Fe^{3+}, Fe+3, NH4+, Fe+++), el electrón (e-), estados ((s) (l) (g) (aq), también
// (ac)), coeficientes delante (2H2O, 1/2 O2, 0.5 O2, ½O2), LaTeX sencillo (\mathrm{H_2O}, H_{2}O, \ce{SO4^2-}) e isótopos
// (D2O, T2O, ^{14}C, ¹⁴CO₂).
//
// Reglas para las cargas pegadas sin «^» (la notación ambigua de teclado):
// - Con dos o más dígitos antes del signo, el último es la carga: SO42- = SO₄²⁻, Cr2O72- = Cr₂O₇²⁻ (salvo un 0 final: C60-).
// - Con un solo dígito: tras «]» es carga ([Cu(NH3)4]2+); tras «)» es subíndice (Ag(NH3)2+ = [Ag(NH₃)₂]⁺); en un ion
//   poliatómico es subíndice (NH4+, NO3-); en un ion monoatómico es carga si es un metal o un estado de oxidación habitual
//   del elemento (Fe3+, O2-, N3-), y si no, subíndice (I3- = I₃⁻). Para evitar la ambigüedad: O2^- (superóxido), N3^- (azida).

import { ChemError } from './errors'
import { L, phrasesAreSpanish } from './l10n'
import { localizedElementNameInSentence, PeriodicTable } from './elements'
import { AtomKey, bracketForClose, bracketForOpen, BRACKET_OPEN, Formula, type FormulaBracket, type FormulaNode, type FormulaUnit, type PhysicalState } from './formula'
import { Rational } from './rational'
import { charCount, chars, isAsciiLetter, isDigit, isLower, isUpper, normalize, trimAll, trimSpaces } from './text'
import { commonOrSystematicName } from './nomenclature'

/** Longitud máxima admitida. */
export const FORMULA_MAX_LENGTH = 20_000
/** Niveles máximos de paréntesis anidados. */
export const FORMULA_MAX_DEPTH = 100
/** Mayor subíndice admitido. */
export const FORMULA_MAX_SUBSCRIPT = 999_999
/** Máximo de átomos de un tipo en una fórmula. */
const MAX_TOTAL_COUNT = 1_000_000_000

/** Analiza una fórmula. Lanza `ChemError` con un mensaje para el alumno si no es válida. */
export function parseFormula(text: string): Formula {
  const t = trimAll(text)
  if (!t) throw ChemError.empty('La fórmula')
  if (charCount(t) > FORMULA_MAX_LENGTH) throw ChemError.tooLong(FORMULA_MAX_LENGTH)
  return parseNormalizedFormula(normalize(t))
}

/** Analiza un texto ya normalizado (`normalize`). */
export function parseNormalizedFormula(input: string): Formula {
  let s = trimSpaces(input)
  if (!s) throw ChemError.empty('La fórmula')
  const [state, afterState] = extractState(s)
  s = afterState
  const [coefficient, afterCoefficient] = extractCoefficient(s)
  s = afterCoefficient
  if (!s) throw ChemError.empty('La fórmula')
  if (isElectronText(s)) {
    return new Formula({ coefficient, units: [], charge: -1, state, isElectron: true, composition: new Map() })
  }
  const [charge, body] = extractCharge(s)
  if (!trimSpaces(body)) throw ChemError.invalidCharge(s)
  const units = parseBody(body)
  const composition = computeComposition(units)
  return new Formula({ coefficient, units, charge, state, isElectron: false, composition })
}

// MARK: Estado

const STATE_SUFFIXES: readonly (readonly [string, PhysicalState])[] = [
  ['(aq)', 'aq'], ['(ac)', 'aq'], ['(aq.)', 'aq'], ['(ac.)', 'aq'], ['(dis)', 'aq'],
  ['(s)', 's'], ['(l)', 'l'], ['(g)', 'g'],
]

export function extractState(s: string): [PhysicalState | null, string] {
  for (const [suffix, state] of STATE_SUFFIXES) {
    if (s.endsWith(suffix) && charCount(s) > suffix.length) return [state, trimSpaces(s.slice(0, s.length - suffix.length))]
  }
  return [null, s]
}

// MARK: Coeficiente

const UNICODE_FRACTION_CHARS = new Set(['½', '⅓', '⅔', '¼', '¾', '⅕', '⅖', '⅗', '⅘', '⅙', '⅚', '⅛', '⅜', '⅝', '⅞'])

export function extractCoefficient(s: string): [Rational | null, string] {
  const c = chars(s)
  const first = c[0]
  if (first === undefined || !(isDigit(first) || UNICODE_FRACTION_CHARS.has(first))) return [null, s]
  let i = 0
  let token = ''
  while (i < c.length && isDigit(c[i])) token += c[i++]
  if (i < c.length && UNICODE_FRACTION_CHARS.has(c[i])) {
    token += c[i++]
  } else if (i + 1 < c.length && (c[i] === '.' || c[i] === ',' || c[i] === '/') && isDigit(c[i + 1])) {
    token += c[i++]
    while (i < c.length && isDigit(c[i])) token += c[i++]
  }
  let j = i
  while (j < c.length && c[j] === ' ') j++
  const rest = c.slice(j).join('')
  if (!rest) throw ChemError.calculation(L('«%@» es solo un número: falta la fórmula química.', token))
  const r = Rational.parse(token)
  if (!r) throw ChemError.numberTooLarge(token)
  if (r.isZero) throw ChemError.calculation(L('El coeficiente no puede ser 0.'))
  if (r.num <= 0n) throw ChemError.calculation(L('El coeficiente tiene que ser positivo.'))
  if (r.num > BigInt(FORMULA_MAX_SUBSCRIPT) || r.den > BigInt(FORMULA_MAX_SUBSCRIPT)) throw ChemError.numberTooLarge(token)
  return [r, rest]
}

// MARK: Electrón

const ELECTRON_TEXTS = new Set(['e', 'e-', 'e^-', 'e^{-}', 'e^1-', 'e^{1-}', 'e^-1', 'e^{-1}', 'e-1'])

export function isElectronText(s: string): boolean {
  return ELECTRON_TEXTS.has(s.split(' ').join(''))
}

// MARK: Carga

/** Lee «2-», «+», «-2», «+3», «++», «3+». `null` si no es una carga. */
export function parseChargeSpec(text: string): number | null {
  const t = text.split(' ').join('')
  const c = chars(t)
  if (c.length === 0 || c.length > 6) return null
  const signs = c.filter((x) => x === '+' || x === '-')
  const digits = c.filter(isDigit)
  if (signs.length === 0 || signs.length + digits.length !== c.length) return null
  if (new Set(signs).size !== 1) return null
  const signChar = signs[0]
  const sign = signChar === '+' ? 1 : -1
  if (signs.length > 1) return digits.length === 0 ? sign * signs.length : null
  // Un solo signo: delante o detrás de los dígitos, nunca en medio.
  if (c[0] !== signChar && c[c.length - 1] !== signChar) return null
  if (digits.length === 0) return sign
  const n = Number(digits.join(''))
  if (!(n > 0 && n <= 20)) return null
  return sign * n
}

const isSign = (x: string | undefined): boolean => x === '+' || x === '-'

export function extractCharge(s: string): [number, string] {
  const c = chars(s)
  const str = (a: number, b = c.length): string => c.slice(a, b).join('')
  // a) «^{…}» al final.
  if (c[c.length - 1] === '}') {
    let depth = 0
    let k = c.length - 1
    while (k >= 0) {
      if (c[k] === '}') depth++
      if (c[k] === '{') {
        depth--
        if (depth === 0) break
      }
      k--
    }
    if (k >= 1 && c[k - 1] === '^') {
      const inner = str(k + 1, c.length - 1)
      const q = parseChargeSpec(inner)
      if (q === null) throw ChemError.invalidCharge(inner)
      return [q, trimSpaces(str(0, k - 1))]
    }
  }
  // b) «^2-» sin llaves al final.
  const caret = c.lastIndexOf('^')
  if (caret >= 0) {
    const tail = str(caret + 1)
    const q = parseChargeSpec(tail)
    if (q !== null) return [q, trimSpaces(str(0, caret))]
    if (tail.includes('+') || tail.includes('-')) throw ChemError.invalidCharge(tail)
  }
  // c) Separada por un espacio: «SO4 2-», «NH4 +», «Fe +3».
  const space = c.lastIndexOf(' ')
  if (space >= 0) {
    const tail = str(space + 1)
    if (tail.includes('+') || tail.includes('-')) {
      const q = parseChargeSpec(tail)
      if (q === null) throw ChemError.invalidCharge(tail)
      return [q, trimSpaces(str(0, space))]
    }
  }
  // d) Pegada al final: «Fe3+», «SO42-», «NH4+», «OH-», «Fe+++».
  const last = c[c.length - 1]
  if (last === '+' || last === '-') {
    let k = c.length - 1
    let signCount = 0
    while (k >= 0 && c[k] === last) {
      signCount++
      k--
    }
    if (k >= 0 && isSign(c[k])) throw ChemError.invalidCharge(str(k))
    const digitsEnd = k + 1
    let digitsStart = digitsEnd
    while (digitsStart - 1 >= 0 && isDigit(c[digitsStart - 1])) digitsStart--
    const digits = str(digitsStart, digitsEnd)
    const prefix = str(0, digitsStart)
    const sign = last === '+' ? 1 : -1
    if (!trimSpaces(prefix)) throw ChemError.invalidCharge(s)
    if (signCount > 1) {
      if (digits || signCount > 8) throw ChemError.invalidCharge(str(digitsStart))
      return [sign * signCount, prefix]
    }
    if (!digits) return [sign, prefix]
    if (digits.length >= 2) {
      const q = Number(digits[digits.length - 1])
      if (q === 0) return [sign, prefix + digits]
      return [sign * q, prefix + digits.slice(0, -1)]
    }
    const d = Number(digits)
    if (prefix.endsWith(')') || prefix.endsWith('}')) return [sign, prefix + digits]
    if (prefix.endsWith(']')) return [sign * d, prefix]
    const el = PeriodicTable.bySymbol(prefix)
    if (el) {
      if (el.isMetal === true || el.commonOxidationStates.includes(sign * d)) return [sign * d, prefix]
      return [sign, prefix + digits]
    }
    return [sign, prefix + digits]
  }
  // e) Signo y dígitos al final: «Fe+3», «SO4-2».
  if (isDigit(last)) {
    let k = c.length - 1
    while (k >= 0 && isDigit(c[k])) k--
    if (k >= 1 && isSign(c[k])) {
      const before = c[k - 1]
      if (isAsciiLetter(before) || isDigit(before) || before === ')' || before === ']') {
        const digits = str(k + 1)
        const n = Number(digits)
        if (!(digits.length > 0 && n > 0 && n <= 20)) throw ChemError.invalidCharge(str(k))
        return [(c[k] === '+' ? 1 : -1) * n, str(0, k)]
      }
    }
  }
  if (c.includes('+') || c.includes('-')) {
    // Un signo en medio de la fórmula: probablemente dos especies («Na+Cl») o una carga mal puesta.
    throw ChemError.calculation(
      L('Hay un «+» o «-» en medio de la fórmula «%@». La carga va al final (SO4^2-) y las especies se separan con « + » en las ecuaciones.', s),
    )
  }
  return [0, s]
}

// MARK: Cuerpo

interface Frame {
  bracket: FormulaBracket | null
  nodes: FormulaNode[]
}

export function parseBody(body: string): FormulaUnit[] {
  const c = chars(body)
  const stack: Frame[] = [{ bracket: null, nodes: [] }]
  const units: FormulaUnit[] = []
  let multiplier = 1
  let i = 0
  const top = (): Frame => stack[stack.length - 1]

  const readNumber = (): number | null => {
    let j = i
    let digits = ''
    while (j < c.length && isDigit(c[j])) digits += c[j++]
    if (!digits) return null
    if (j < c.length && (c[j] === '/' || c[j] === ',') && j + 1 < c.length && isDigit(c[j + 1])) {
      const written = digits + c[j]
      throw ChemError.calculation(L('Los subíndices tienen que ser números enteros («%@…» no vale).', written))
    }
    i = j
    const v = Number(digits)
    if (digits.length > 7 || v > FORMULA_MAX_SUBSCRIPT) throw ChemError.numberTooLarge(digits)
    if (v === 0) throw ChemError.zeroCount()
    return v
  }

  const readSymbol = (): string => {
    let sym = c[i++]
    while (i < c.length && isLower(c[i])) sym += c[i++]
    return sym
  }

  while (i < c.length) {
    const ch = c[i]
    if (ch === ' ') {
      i++
      continue
    }
    if (isUpper(ch)) {
      const sym = readSymbol()
      const key = resolveSymbol(sym, body)
      const n = readNumber() ?? 1
      top().nodes.push({ kind: 'atom', key, count: n })
      continue
    }
    if (ch === '^') {
      // Isótopo: «^{14}C» o «^14C».
      i++
      let braced = false
      if (i < c.length && c[i] === '{') {
        braced = true
        i++
      }
      let digits = ''
      while (i < c.length && isDigit(c[i])) digits += c[i++]
      if (braced) {
        if (!(i < c.length && c[i] === '}')) throw ChemError.invalidCharge('^{' + digits)
        i++
      }
      if (!digits || digits.length > 3) {
        throw ChemError.calculation(L('No entiendo el «^» en medio de la fórmula. Las cargas van al final (SO4^2-) y los isótopos se escriben ^{14}C.'))
      }
      const a = Number(digits)
      while (i < c.length && c[i] === ' ') i++
      if (!(i < c.length && isUpper(c[i]))) {
        throw ChemError.calculation(
          L('Después de «^%@» tiene que ir el símbolo del isótopo (por ejemplo ^{14}C). Las cargas van al final: SO4^2-.', digits),
        )
      }
      const sym = readSymbol()
      const el = PeriodicTable.bySymbol(sym)
      if (!el) throw ChemError.unknownSymbol(sym, null)
      if (!(a >= el.atomicNumber && a <= 300)) {
        // Número másico y número atómico son códigos: van como texto, sin separador de miles.
        throw ChemError.calculation(
          L('Un isótopo de %@ no puede tener número másico %@ (tiene al menos %@ protones).', localizedElementNameInSentence(el), String(a), String(el.atomicNumber)),
        )
      }
      const n = readNumber() ?? 1
      top().nodes.push({ kind: 'atom', key: AtomKey.of(el.atomicNumber, a), count: n })
      continue
    }
    const open = bracketForOpen(ch)
    if (open) {
      if (stack.length > FORMULA_MAX_DEPTH) throw ChemError.tooDeep(FORMULA_MAX_DEPTH)
      stack.push({ bracket: open, nodes: [] })
      i++
      continue
    }
    const close = bracketForClose(ch)
    if (close) {
      const frameBracket = top().bracket
      if (stack.length <= 1 || frameBracket === null) throw ChemError.unexpectedClosingBracket(ch)
      if (frameBracket !== close) throw ChemError.mismatchedBracket(BRACKET_OPEN[frameBracket], ch)
      const frame = stack.pop() as Frame
      i++
      const n = readNumber() ?? 1
      if (frame.nodes.length === 0) {
        if (close === 'curly' && n === 1) continue // «{}» de LaTeX
        throw ChemError.emptyGroup()
      }
      top().nodes.push({ kind: 'group', nodes: frame.nodes, bracket: close, count: n })
      continue
    }
    if (ch === '·' || ch === '.') {
      if (stack.length !== 1) throw ChemError.calculation(L('El punto de los hidratos («·») no puede ir dentro de un paréntesis.'))
      if (stack[0].nodes.length === 0) throw ChemError.calculation(L('Falta la fórmula antes del «·».'))
      units.push({ multiplier, nodes: stack[0].nodes })
      stack[0].nodes = []
      i++
      while (i < c.length && c[i] === ' ') i++
      multiplier = readNumber() ?? 1
      continue
    }
    if (isDigit(ch)) {
      let digits = ''
      let j = i
      while (j < c.length && isDigit(c[j])) digits += c[j++]
      throw ChemError.misplacedNumber(digits)
    }
    if (isLower(ch)) {
      let word = ''
      let j = i
      while (j < c.length && isAsciiLetter(c[j])) word += c[j++]
      throw ChemError.lowercaseSymbol(word, describedSuggestions(body))
    }
    if (ch === '+' || ch === '-') {
      throw ChemError.calculation(
        L('Hay un «%@» en medio de la fórmula. La carga va al final (SO4^2-) y las especies se separan con « + » en las ecuaciones.', ch),
      )
    }
    throw ChemError.unexpectedCharacter(ch)
  }
  const open = top().bracket
  if (stack.length > 1 && open) throw ChemError.unclosedBracket(BRACKET_OPEN[open])
  if (stack[0].nodes.length === 0) throw ChemError.calculation(L('Falta la fórmula después del «·».'))
  units.push({ multiplier, nodes: stack[0].nodes })
  return units
}

function resolveSymbol(sym: string, body: string): AtomKey {
  if (sym === 'D') return AtomKey.of(1, 2)
  if (sym === 'T') return AtomKey.of(1, 3)
  const e = PeriodicTable.bySymbol(sym)
  if (e) return AtomKey.ofElement(e)
  throw ChemError.unknownSymbol(sym, describedSuggestions(body)[0] ?? null)
}

/** Composición total de las partes (con los multiplicadores de hidratos y paréntesis). */
export function computeComposition(units: readonly FormulaUnit[]): Map<AtomKey, number> {
  const total = new Map<AtomKey, number>()
  for (const u of units) accumulate(u.nodes, u.multiplier, total)
  return total
}

function accumulate(nodes: readonly FormulaNode[], factor: number, total: Map<AtomKey, number>): void {
  for (const node of nodes) {
    if (node.kind === 'atom') {
      const s = (total.get(node.key) ?? 0) + node.count * factor
      if (!(s <= MAX_TOTAL_COUNT)) throw ChemError.quantityTooLarge()
      total.set(node.key, s)
    } else {
      const f = factor * node.count
      if (!(f <= MAX_TOTAL_COUNT)) throw ChemError.quantityTooLarge()
      accumulate(node.nodes, f, total)
    }
  }
}

/** Composición de unos nodos sueltos (una sola parte, sin multiplicador). */
export function nodesComposition(nodes: readonly FormulaNode[]): Map<AtomKey, number> {
  try {
    return computeComposition([{ multiplier: 1, nodes }])
  } catch {
    return new Map()
  }
}

// MARK: Sugerencias de mayúsculas

/** Lecturas válidas de un texto con las mayúsculas mal puestas: «co» → [Co, CO]; «nacl» → [NaCl]. */
export function caseSuggestions(body: string, limit = 4): string[] {
  const c = chars(body)
  if (c.length > 40) return []
  // Segmentos: letras (a repartir en símbolos) y el resto tal cual.
  const segments: { letters: boolean; text: string }[] = []
  for (const ch of c) {
    const letter = isAsciiLetter(ch)
    const lastSeg = segments[segments.length - 1]
    if (lastSeg && lastSeg.letters === letter && letter) lastSeg.text += ch
    else segments.push({ letters: letter, text: ch })
  }
  let candidates = ['']
  for (const seg of segments) {
    if (seg.letters) {
      const options = symbolSplits(seg.text.toLowerCase(), limit)
      if (options.length === 0) return []
      const next: string[] = []
      for (const cand of candidates) for (const o of options) if (next.length < limit * 2) next.push(cand + o)
      candidates = next
    } else {
      candidates = candidates.map((x) => x + seg.text)
    }
  }
  const valid: string[] = []
  for (const cand of candidates) {
    if (cand === body || valid.includes(cand)) continue
    try {
      parseNormalizedFormula(cand)
      valid.push(cand)
    } catch {
      // no es una lectura válida
    }
    if (valid.length >= limit) break
  }
  return valid
}

/** Formas de partir letras en minúscula en símbolos químicos válidos (primero los símbolos de dos letras). */
function symbolSplits(s: string, limit: number): string[] {
  const c = chars(s)
  const two = (i: number): string | null => {
    if (i + 1 >= c.length) return null
    const t = c[i].toUpperCase() + c[i + 1]
    return PeriodicTable.bySymbol(t) ? t : null
  }
  const one = (i: number): string | null => {
    const t = c[i].toUpperCase()
    return PeriodicTable.bySymbol(t) ? t : null
  }
  // canFinish[i]: desde i se puede terminar. Evita explorar caminos sin salida (sería exponencial: «cocococ…x»).
  const canFinish: boolean[] = new Array(c.length + 1).fill(false)
  canFinish[c.length] = true
  for (let i = c.length - 1; i >= 0; i--) {
    canFinish[i] = (two(i) !== null && canFinish[i + 2]) || (one(i) !== null && canFinish[i + 1])
  }
  const results: string[] = []
  const go = (i: number, acc: string): void => {
    if (results.length >= limit) return
    if (i === c.length) {
      results.push(acc)
      return
    }
    const t2 = two(i)
    if (t2 && canFinish[i + 2]) go(i + 2, acc + t2)
    const t1 = one(i)
    if (t1 && canFinish[i + 1]) go(i + 1, acc + t1)
  }
  if (canFinish[0]) go(0, '')
  return results
}

/**
 * Sugerencias con una descripción entre paréntesis: «Co (cobalto)», «CO (monóxido de carbono)». El nombre de un
 * elemento sale en el idioma de las frases; el de un compuesto, solo si las frases están en español.
 */
export function describedSuggestions(body: string): string[] {
  return caseSuggestions(body).map((candidate) => {
    const e = PeriodicTable.bySymbol(candidate)
    if (e) return `${candidate} (${localizedElementNameInSentence(e)})`
    if (phrasesAreSpanish()) {
      try {
        const name = commonOrSystematicName(parseNormalizedFormula(candidate))
        if (name) return `${candidate} (${name})`
      } catch {
        // sin nombre
      }
    }
    return candidate
  })
}
