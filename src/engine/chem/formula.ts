// Fórmula química analizada: estructura (grupos, hidratos), composición, carga, estado y coeficiente.

import { L } from './l10n'
import { ALL_ELEMENTS, PeriodicTable, type Element } from './elements'
import { Rational } from './rational'
import { chargeText, gcd, subscripted, superscripted } from './text'
import { parseFormula } from './parser'
import { molarMassDetails, percentComposition, type MolarMassResult } from './composition'

/** Masas de algunos isótopos frecuentes en clase (u = g/mol). Fuente: AME/NIST. */
const ISOTOPES: Readonly<Record<number, Readonly<Record<number, readonly [number, string]>>>> = {
  1: { 1: [1.00782503, '1.0078'], 2: [2.01410178, '2.0141'], 3: [3.01604928, '3.0160'] },
  6: { 12: [12.0, '12.000'], 13: [13.00335484, '13.003'], 14: [14.00324199, '14.003'] },
  7: { 14: [14.003074, '14.003'], 15: [15.0001089, '15.000'] },
  8: { 16: [15.99491462, '15.995'], 17: [16.99913176, '16.999'], 18: [17.99915961, '17.999'] },
  15: { 32: [31.97390764, '31.974'] },
  17: { 35: [34.96885268, '34.969'], 37: [36.9659026, '36.966'] },
  27: { 60: [59.93381554, '59.934'] },
  53: { 131: [130.9061263, '130.91'] },
  92: { 235: [235.0439301, '235.04'], 238: [238.0507884, '238.05'] },
}

/** Masa tabulada de un isótopo (valor y texto) o `null`. */
export function isotopeMass(z: number, a: number): { value: number; text: string } | null {
  const m = ISOTOPES[z]?.[a]
  return m ? { value: m[0], text: m[1] } : null
}

/**
 * Tipo de átomo dentro de una fórmula: un elemento con su mezcla isotópica natural o un isótopo concreto (²H = D,
 * ³H = T, ¹⁴C…). Los isótopos cuentan como especies distintas al balancear (D₂O ≠ H₂O). Los objetos son únicos: se
 * comparan con `===` y sirven de clave en un `Map`.
 */
export class AtomKey {
  private static readonly cache = new Map<string, AtomKey>()

  private constructor(
    readonly atomicNumber: number,
    /** `null` = mezcla isotópica natural. */
    readonly massNumber: number | null,
  ) {}

  static of(atomicNumber: number, massNumber: number | null = null): AtomKey {
    const id = massNumber === null ? `${atomicNumber}` : `${atomicNumber}:${massNumber}`
    let k = AtomKey.cache.get(id)
    if (!k) {
      k = new AtomKey(atomicNumber, massNumber)
      AtomKey.cache.set(id, k)
    }
    return k
  }

  /** Clave del elemento natural. */
  static ofElement(e: Element): AtomKey {
    return AtomKey.of(e.atomicNumber)
  }

  /** El elemento al que pertenece. */
  get element(): Element {
    return PeriodicTable.byNumber(this.atomicNumber) ?? ALL_ELEMENTS[0]
  }

  get isIsotope(): boolean {
    return this.massNumber !== null
  }

  /** Símbolo para mostrar: «Fe», «D», «T», «¹⁴C». */
  get symbol(): string {
    if (this.atomicNumber === 1 && this.massNumber === 2) return 'D'
    if (this.atomicNumber === 1 && this.massNumber === 3) return 'T'
    if (this.massNumber !== null) return superscripted(String(this.massNumber)) + this.element.symbol
    return this.element.symbol
  }

  /** Símbolo en texto plano que el analizador vuelve a entender: «Fe», «D», «^{14}C». */
  get plainSymbol(): string {
    if (this.atomicNumber === 1 && this.massNumber === 2) return 'D'
    if (this.atomicNumber === 1 && this.massNumber === 3) return 'T'
    if (this.massNumber !== null) return `^{${this.massNumber}}` + this.element.symbol
    return this.element.symbol
  }

  /** Símbolo para LaTeX dentro de `\mathrm{}`. */
  get latexSymbol(): string {
    if (this.atomicNumber === 1 && this.massNumber === 2) return 'D'
    if (this.atomicNumber === 1 && this.massNumber === 3) return 'T'
    if (this.massNumber !== null) return `{}^{${this.massNumber}}` + this.element.symbol
    return this.element.symbol
  }

  toString(): string {
    return this.symbol
  }

  /** Masa molar en g/mol: masa atómica estándar, masa exacta de los isótopos conocidos o, si no, el número másico. */
  get mass(): number {
    if (this.massNumber === null) return this.element.molarMass
    return isotopeMass(this.atomicNumber, this.massNumber)?.value ?? this.massNumber
  }

  /** Texto de la masa usada («1.008», «2.0141», «[98]»). */
  get massText(): string {
    if (this.massNumber === null) return this.element.atomicWeight.text
    return isotopeMass(this.atomicNumber, this.massNumber)?.text ?? `≈${this.massNumber}`
  }

  /** Decimales con los que se conoce la masa. */
  get massDecimals(): number {
    if (this.massNumber === null) return this.element.atomicWeight.decimalPlaces
    const t = isotopeMass(this.atomicNumber, this.massNumber)?.text
    if (!t) return 0
    const dot = t.indexOf('.')
    return dot < 0 ? 0 : t.length - dot - 1
  }

  /** `true` si la masa es aproximada (elemento sin masa estándar o isótopo sin masa tabulada). */
  get massIsApproximate(): boolean {
    if (this.massNumber === null) return !this.element.atomicWeight.isStandard
    return isotopeMass(this.atomicNumber, this.massNumber) === null
  }

  static compare(a: AtomKey, b: AtomKey): number {
    return a.atomicNumber - b.atomicNumber || (a.massNumber ?? 0) - (b.massNumber ?? 0)
  }
}

/** Tipo de paréntesis de un grupo. */
export type FormulaBracket = 'round' | 'square' | 'curly'

export const BRACKET_OPEN: Readonly<Record<FormulaBracket, string>> = { round: '(', square: '[', curly: '{' }
export const BRACKET_CLOSE: Readonly<Record<FormulaBracket, string>> = { round: ')', square: ']', curly: '}' }

export function bracketForOpen(c: string): FormulaBracket | null {
  return c === '(' ? 'round' : c === '[' ? 'square' : c === '{' ? 'curly' : null
}
export function bracketForClose(c: string): FormulaBracket | null {
  return c === ')' ? 'round' : c === ']' ? 'square' : c === '}' ? 'curly' : null
}

/** Nodo del árbol de una fórmula: un átomo con su subíndice o un grupo entre paréntesis con el suyo. */
export type FormulaNode =
  | { readonly kind: 'atom'; readonly key: AtomKey; readonly count: number }
  | { readonly kind: 'group'; readonly nodes: readonly FormulaNode[]; readonly bracket: FormulaBracket; readonly count: number }

/** Parte de una fórmula separada por el punto de los hidratos: en CuSO4·5H2O hay dos (×1 CuSO4, ×5 H2O). */
export interface FormulaUnit {
  readonly multiplier: number
  readonly nodes: readonly FormulaNode[]
}

/** Estado físico indicado en una fórmula. */
export type PhysicalState = 's' | 'l' | 'g' | 'aq'

export const PHYSICAL_STATES: readonly PhysicalState[] = ['s', 'l', 'g', 'aq']

/** Nombre del estado en español, en minúscula («en disolución acuosa»). */
export function physicalStateTitle(s: PhysicalState): string {
  switch (s) {
    case 's':
      return 'sólido'
    case 'l':
      return 'líquido'
    case 'g':
      return 'gas'
    case 'aq':
      return 'en disolución acuosa'
  }
}

/** Nombre del estado en el idioma de la interfaz, para usarlo dentro de una frase. */
export const localizedPhysicalStateTitle = (s: PhysicalState): string => L(physicalStateTitle(s))

/** Resultado de comparar dos fórmulas. */
export type FormulaComparison =
  /** La misma fórmula, escrita igual (salvo notación: «H_2O» = «H₂O» = «H2O»). */
  | 'identical'
  /** Mismos átomos y carga, pero escrita de otra forma (CH3COOH / C2H4O2). */
  | 'sameComposition'
  /** Misma proporción de átomos (CH2O / C6H12O6). */
  | 'sameEmpiricalFormula'
  /** Mismos átomos, distinta carga. */
  | 'differentCharge'
  /** Otra sustancia. */
  | 'different'

export type FormulaStyle = 'plain' | 'unicode' | 'latex'

/** Composición: número de átomos de cada tipo. */
export type Composition = ReadonlyMap<AtomKey, number>

/** `true` si dos composiciones tienen exactamente los mismos átomos. */
export function compositionsEqual(a: Composition, b: Composition): boolean {
  if (a.size !== b.size) return false
  for (const [k, n] of a) if (b.get(k) !== n) return false
  return true
}

function nodesEqual(a: readonly FormulaNode[], b: readonly FormulaNode[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    if (x.kind === 'atom') return y.kind === 'atom' && x.key === y.key && x.count === y.count
    return y.kind === 'group' && x.bracket === y.bracket && x.count === y.count && nodesEqual(x.nodes, y.nodes)
  })
}

export interface FormulaInit {
  coefficient: Rational | null
  units: readonly FormulaUnit[]
  charge: number
  state: PhysicalState | null
  isElectron: boolean
  composition: Composition
}

/** Fórmula química analizada (inmutable). */
export class Formula {
  /** Coeficiente escrito delante («2H2O» → 2), si lo hay. */
  readonly coefficient: Rational | null
  /** Partes separadas por «·» (hidratos). */
  readonly units: readonly FormulaUnit[]
  /** Carga neta. */
  readonly charge: number
  /** Estado físico, si se indicó. */
  readonly state: PhysicalState | null
  /** `true` para el electrón «e⁻». */
  readonly isElectron: boolean
  /** Número de átomos de cada tipo en una unidad fórmula (sin el coeficiente). */
  readonly composition: Composition

  constructor(init: FormulaInit) {
    this.coefficient = init.coefficient
    this.units = init.units
    this.charge = init.charge
    this.state = init.state
    this.isElectron = init.isElectron
    this.composition = init.composition
  }

  /** Analiza una fórmula escrita por un alumno o por la IA (ver `parseFormula`). Lanza `ChemError`. */
  static parse(text: string): Formula {
    return parseFormula(text)
  }

  /** Fórmula a partir de una composición (orden de Hill para compuestos orgánicos; si no, orden de la IUPAC). */
  static fromComposition(composition: Composition, charge = 0): Formula {
    const keys = Formula.conventionalOrder([...composition.keys()])
    const nodes: FormulaNode[] = []
    const comp = new Map<AtomKey, number>()
    for (const k of keys) {
      const n = composition.get(k) ?? 0
      if (n > 0) {
        nodes.push({ kind: 'atom', key: k, count: n })
        comp.set(k, n)
      }
    }
    return new Formula({ coefficient: null, units: [{ multiplier: 1, nodes }], charge, state: null, isElectron: false, composition: comp })
  }

  /** El electrón. */
  static readonly electron = new Formula({ coefficient: null, units: [], charge: -1, state: null, isElectron: true, composition: new Map() })

  // MARK: Consultas

  /** Elementos presentes (orden convencional, sin repetir isótopos). */
  get elements(): Element[] {
    const seen = new Set<number>()
    const out: Element[] = []
    for (const k of Formula.conventionalOrder([...this.composition.keys()])) {
      if (!seen.has(k.atomicNumber)) {
        seen.add(k.atomicNumber)
        out.push(k.element)
      }
    }
    return out
  }

  /** Número total de átomos en una unidad fórmula. */
  get atomCount(): number {
    let t = 0
    for (const n of this.composition.values()) t += n
    return t
  }

  /** Átomos de un elemento (sumando sus isótopos). */
  countOf(element: Element): number {
    let t = 0
    for (const [k, n] of this.composition) if (k.atomicNumber === element.atomicNumber) t += n
    return t
  }

  /** Átomos de un símbolo («O», «D»). */
  countOfSymbol(symbol: string): number {
    if (symbol === 'D') return this.composition.get(AtomKey.of(1, 2)) ?? 0
    if (symbol === 'T') return this.composition.get(AtomKey.of(1, 3)) ?? 0
    const e = PeriodicTable.bySymbol(symbol)
    return e ? (this.composition.get(AtomKey.ofElement(e)) ?? 0) : 0
  }

  /** `true` si tiene carga. */
  get isIon(): boolean {
    return this.charge !== 0
  }
  /** `true` si solo tiene un átomo (Na, Fe³⁺, Cl⁻). */
  get isMonatomic(): boolean {
    return this.atomCount === 1
  }
  /** `true` para una sustancia elemental neutra (Fe, O2, S8, P4). */
  get isElementalSubstance(): boolean {
    return !this.isElectron && this.charge === 0 && this.composition.size === 1
  }
  /** `true` si es un hidrato (tiene «·»). */
  get isHydrate(): boolean {
    return this.units.length > 1
  }

  private copy(changes: Partial<FormulaInit>): Formula {
    return new Formula({
      coefficient: this.coefficient,
      units: this.units,
      charge: this.charge,
      state: this.state,
      isElectron: this.isElectron,
      composition: this.composition,
      ...changes,
    })
  }

  /** La misma fórmula sin coeficiente. */
  withoutCoefficient(): Formula {
    return this.coefficient === null ? this : this.copy({ coefficient: null })
  }
  /** La misma fórmula sin estado. */
  withoutState(): Formula {
    return this.state === null ? this : this.copy({ state: null })
  }
  /** La misma fórmula con otro coeficiente. */
  withCoefficient(coefficient: Rational | null): Formula {
    return this.copy({ coefficient })
  }

  /** Clave de identidad de la especie: fórmula canónica con carga, sin coeficiente ni estado. */
  get identityKey(): string {
    return this.text('plain', false, false)
  }

  /** Fórmula empírica (proporción mínima de átomos), en orden convencional. */
  get empiricalFormula(): Formula {
    if (this.isElectron) return this
    let g = 0
    for (const n of this.composition.values()) g = gcd(g, n)
    if (g <= 1) return Formula.fromComposition(this.composition, this.charge)
    const comp = new Map<AtomKey, number>()
    for (const [k, n] of this.composition) comp.set(k, n / g)
    return Formula.fromComposition(comp, this.charge)
  }

  /** Fórmula molecular «compacta» (cada elemento una sola vez) en orden convencional: CH3COOH → C2H4O2. */
  get condensed(): Formula {
    return this.isElectron ? this : Formula.fromComposition(this.composition, this.charge)
  }

  /** Compara con otra fórmula (sin tener en cuenta coeficiente ni estado). */
  compare(other: Formula): FormulaComparison {
    if (this.isElectron || other.isElectron) return this.isElectron === other.isElectron ? 'identical' : 'different'
    if (this.identityKey === other.identityKey) return 'identical'
    if (compositionsEqual(this.composition, other.composition)) return this.charge === other.charge ? 'sameComposition' : 'differentCharge'
    if (this.charge === other.charge) {
      const a = new Set(this.composition.keys())
      const b = new Set(other.composition.keys())
      const sameKeys = a.size === b.size && [...a].every((k) => b.has(k))
      if (sameKeys && compositionsEqual(this.empiricalFormula.composition, other.empiricalFormula.composition)) return 'sameEmpiricalFormula'
    }
    return 'different'
  }

  /** `true` si representan la misma especie (mismos átomos y carga), escrita igual o no. */
  isSameSpecies(other: Formula): boolean {
    const c = this.compare(other)
    return c === 'identical' || c === 'sameComposition'
  }

  /** Igualdad completa (coeficiente, estructura, carga, estado y composición). */
  equals(o: Formula): boolean {
    const coefOK = this.coefficient === null ? o.coefficient === null : this.coefficient.equals(o.coefficient)
    return (
      coefOK &&
      this.charge === o.charge &&
      this.state === o.state &&
      this.isElectron === o.isElectron &&
      compositionsEqual(this.composition, o.composition) &&
      this.units.length === o.units.length &&
      this.units.every((u, i) => u.multiplier === o.units[i].multiplier && nodesEqual(u.nodes, o.units[i].nodes))
    )
  }

  // MARK: Texto

  /** Masa molar en g/mol (suma de las masas atómicas; la masa de los electrones de los iones se desprecia). */
  get molarMass(): number {
    return molarMassDetails(this).value
  }
  /** Masa molar con desglose y porcentajes en masa. */
  molarMassDetails(): MolarMassResult {
    return molarMassDetails(this)
  }
  /** Porcentaje en masa de cada elemento, en orden convencional. */
  get percentComposition(): { element: Element; percent: number }[] {
    return percentComposition(this)
  }

  /** Texto plano canónico que el analizador vuelve a entender: «Ca(OH)2», «SO4^2-», «CuSO4·5H2O», «H2O(l)». */
  get plainText(): string {
    return this.text('plain', false, true)
  }
  /** Texto con subíndices y superíndices Unicode: «Ca(OH)₂», «SO₄²⁻». */
  get unicodeText(): string {
    return this.text('unicode', false, true)
  }
  /** LaTeX (KaTeX): «\mathrm{Ca(OH)_{2}}», «\mathrm{SO_{4}^{2-}}». */
  get latex(): string {
    return this.text('latex', false, true)
  }
  /** mhchem para KaTeX: «\ce{Ca(OH)2}», «\ce{SO4^2-}», «\ce{CuSO4*5H2O}». */
  get ce(): string {
    return `\\ce{${this.ceBody(true)}}`
  }
  /** Texto Unicode con el coeficiente delante («2 H₂O»). */
  toString(): string {
    return this.text('unicode', true, true)
  }
  /** Se guarda como texto plano (con coeficiente y estado), como la app Swift. */
  toJSON(): string {
    return this.text('plain', true, true)
  }
  static fromJSON(text: string): Formula {
    return parseFormula(text)
  }

  /** Fórmula en el sistema de Hill: C y H primero y el resto por orden alfabético (sin C, todo alfabético). */
  get hillFormula(): string {
    if (this.isElectron) return 'e^-'
    let s = Formula.hillOrder([...this.composition.keys()])
      .map((k) => {
        const n = this.composition.get(k) ?? 0
        return k.plainSymbol + (n > 1 ? String(n) : '')
      })
      .join('')
    if (this.charge !== 0) s += '^' + chargeText(this.charge)
    return s
  }

  text(style: FormulaStyle, includeCoefficient: boolean, includeState: boolean): string {
    let body: string
    if (this.isElectron) {
      body = style === 'plain' ? 'e^-' : style === 'unicode' ? 'e⁻' : 'e^{-}'
    } else {
      const unitTexts = this.units.map((u) => {
        const inner = u.nodes.map((n) => nodeText(n, style)).join('')
        return (u.multiplier > 1 ? String(u.multiplier) : '') + inner
      })
      body = unitTexts.join(style === 'latex' ? '\\cdot ' : '·')
      if (this.charge !== 0) {
        const q = chargeText(this.charge)
        if (style === 'plain') body += '^' + q
        else if (style === 'unicode') body += superscripted(q)
        else body += `^{${q}}`
      }
    }
    if (includeState && this.state) body += `(${this.state})`
    if (style === 'latex') body = `\\mathrm{${body}}`
    const c = this.coefficient
    if (includeCoefficient && c && !c.equals(Rational.ONE)) {
      if (style === 'plain') body = (c.isInteger ? c.toString() : c.toString() + ' ') + body
      else if (style === 'unicode') body = c.toString() + ' ' + body
      else body = c.latex() + '\\,' + body
    }
    return body
  }

  /** Cuerpo para mhchem (sin `\ce{}`), con estado y, si se pide, coeficiente. */
  ceBody(includeState: boolean, coefficient: Rational | null = null): string {
    let body: string
    if (this.isElectron) {
      body = 'e-'
    } else {
      body = this.units.map((u) => (u.multiplier > 1 ? String(u.multiplier) : '') + u.nodes.map(ceNode).join('')).join('*')
      if (this.charge !== 0) body += '^' + chargeText(this.charge)
    }
    if (includeState && this.state) body += `(${this.state})`
    if (coefficient && !coefficient.equals(Rational.ONE)) body = `${coefficient.toString()} ${body}`
    return body
  }

  // MARK: Orden de los elementos

  /** Orden de Hill: C, H y luego alfabético; sin carbono, todo alfabético. */
  static hillOrder(keys: readonly AtomKey[]): AtomKey[] {
    const hasCarbon = keys.some((k) => k.atomicNumber === 6)
    const rank = (k: AtomKey): number => (!hasCarbon ? 2 : k.atomicNumber === 6 ? 0 : k.atomicNumber === 1 ? 1 : 2)
    return [...keys].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      const sa = a.element.symbol
      const sb = b.element.symbol
      if (sa !== sb) return sa < sb ? -1 : 1
      return (a.massNumber ?? 0) - (b.massNumber ?? 0)
    })
  }

  /**
   * Orden «convencional»: Hill si hay C e H y ningún metal (compuestos orgánicos); si no, la secuencia de la IUPAC
   * (metales primero: NaCl, Fe2O3, CaCO3, KMnO4, NH3, H2O, OF2).
   */
  static conventionalOrder(keys: readonly AtomKey[]): AtomKey[] {
    const hasC = keys.some((k) => k.atomicNumber === 6)
    const hasH = keys.some((k) => k.atomicNumber === 1)
    const hasMetal = keys.some((k) => k.element.isMetal === true)
    if (hasC && hasH && !hasMetal) return Formula.hillOrder(keys)
    return [...keys].sort((a, b) => {
      const ia = PeriodicTable.sequenceIndex(a.atomicNumber)
      const ib = PeriodicTable.sequenceIndex(b.atomicNumber)
      if (ia !== ib) return ia - ib
      return (a.massNumber ?? 0) - (b.massNumber ?? 0)
    })
  }
}

function nodeText(node: FormulaNode, style: FormulaStyle): string {
  const countText = (n: number): string => {
    if (n <= 1) return ''
    return style === 'plain' ? String(n) : style === 'unicode' ? subscripted(String(n)) : `_{${n}}`
  }
  if (node.kind === 'atom') {
    const k = node.key
    const sym = style === 'plain' ? k.plainSymbol : style === 'unicode' ? k.symbol : k.latexSymbol
    return sym + countText(node.count)
  }
  let open = BRACKET_OPEN[node.bracket]
  let close = BRACKET_CLOSE[node.bracket]
  if (style === 'latex' && node.bracket === 'curly') {
    open = '\\{'
    close = '\\}'
  }
  return open + node.nodes.map((n) => nodeText(n, style)).join('') + close + countText(node.count)
}

function ceNode(node: FormulaNode): string {
  if (node.kind === 'atom') {
    const k = node.key
    const sym = k.massNumber !== null && !(k.atomicNumber === 1 && (k.massNumber === 2 || k.massNumber === 3)) ? `^{${k.massNumber}}${k.element.symbol}` : k.plainSymbol
    return sym + (node.count > 1 ? String(node.count) : '')
  }
  const open = node.bracket === 'curly' ? '\\{' : BRACKET_OPEN[node.bracket]
  const close = node.bracket === 'curly' ? '\\}' : BRACKET_CLOSE[node.bracket]
  return open + node.nodes.map(ceNode).join('') + close + (node.count > 1 ? String(node.count) : '')
}
