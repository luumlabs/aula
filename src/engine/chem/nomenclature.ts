// Nomenclatura inorgánica básica en español: iones comunes, compuestos iónicos binarios y ternarios sencillos (Stock y
// tradicional), compuestos binarios moleculares (prefijos), ácidos comunes y algunos nombres comunes.
// Alcance limitado: si no se puede nombrar con certeza, devuelve `null` (nunca inventa). Como la app Swift, solo español.

import { ALL_ELEMENTS, PeriodicTable, type Element } from './elements'
import { Formula, type FormulaNode } from './formula'
import { elementComposition, IonTable, zCompositionsEqual, type ChemIon, type IonKind } from './ion-table'
import { nodesComposition, parseChargeSpec, parseFormula } from './parser'
import { chargeText, fold, gcd } from './text'

/** Nombres de un compuesto o ion. */
export interface CompoundName {
  readonly formula: Formula
  /** Nombre recomendado. */
  readonly name: string
  /** Nomenclatura de Stock (números romanos): «óxido de hierro(III)». */
  readonly stock: string | null
  /** Nomenclatura tradicional: «óxido férrico», «cloruro sódico». */
  readonly traditional: string | null
  /** Nomenclatura sistemática con prefijos: «trióxido de dihierro», «dióxido de carbono». */
  readonly systematic: string | null
  /** Nombre común o alternativo: «agua», «amoníaco», «bicarbonato de sodio». */
  readonly common: string | null
  /** Aclaraciones. */
  readonly notes: readonly string[]
  /** Todos los nombres distintos, empezando por el recomendado. */
  readonly allNames: readonly string[]
}

function compound(formula: Formula, name: string, o: { stock?: string | null; traditional?: string | null; systematic?: string | null; common?: string | null; notes?: string[] } = {}): CompoundName {
  const stock = o.stock ?? null
  const traditional = o.traditional ?? null
  const systematic = o.systematic ?? null
  const common = o.common ?? null
  const allNames: string[] = []
  for (const n of [name, stock, traditional, systematic, common]) if (n !== null && !allNames.includes(n)) allNames.push(n)
  return { formula, name, stock, traditional, systematic, common, notes: o.notes ?? [], allNames }
}

// MARK: Tablas

interface Named {
  formulas: string[]
  name: string
  alternatives: string[]
}
const N = (formulas: string[], name: string, alternatives: string[] = []): Named => ({ formulas, name, alternatives })

/** Compuestos con nombre común (o cuyo nombre sistemático conviene fijar a mano). */
const COMMON_COMPOUNDS: readonly Named[] = [
  N(['H2O'], 'agua', ['oxidano']),
  N(['H2O2'], 'peróxido de hidrógeno', ['agua oxigenada']),
  N(['NH3'], 'amoníaco', ['amoniaco', 'azano']),
  N(['CH4'], 'metano'),
  N(['C2H6', 'CH3CH3'], 'etano'),
  N(['C3H8', 'CH3CH2CH3'], 'propano'),
  N(['C4H10'], 'butano'),
  N(['C2H4', 'CH2CH2'], 'eteno', ['etileno']),
  N(['C2H2', 'HCCH'], 'etino', ['acetileno']),
  N(['C6H6'], 'benceno'),
  N(['CH3OH'], 'metanol', ['alcohol metílico']),
  N(['C2H5OH', 'CH3CH2OH'], 'etanol', ['alcohol etílico']),
  N(['C6H12O6'], 'glucosa'),
  N(['C12H22O11'], 'sacarosa', ['azúcar común']),
  N(['CO(NH2)2'], 'urea'),
  N(['O3'], 'ozono', ['trioxígeno']),
  N(['N2H4'], 'hidracina', ['hidrazina']),
  N(['PH3'], 'fosfano', ['fosfina']),
  N(['SiH4'], 'silano'),
  N(['CaC2'], 'carburo de calcio'),
  N(['NO'], 'monóxido de nitrógeno', ['óxido nítrico']),
  N(['N2O'], 'monóxido de dinitrógeno', ['óxido nitroso']),
]

/** Ácidos comunes (el nombre del ácido se usa en disolución acuosa). */
const ACIDS: readonly Named[] = [
  N(['HF'], 'ácido fluorhídrico'), N(['HCl'], 'ácido clorhídrico'), N(['HBr'], 'ácido bromhídrico'), N(['HI'], 'ácido yodhídrico'),
  N(['H2S'], 'ácido sulfhídrico'), N(['HCN'], 'ácido cianhídrico'), N(['HNO3'], 'ácido nítrico'), N(['HNO2'], 'ácido nitroso'),
  N(['H2SO4'], 'ácido sulfúrico'), N(['H2SO3'], 'ácido sulfuroso'), N(['H3PO4'], 'ácido fosfórico', ['ácido ortofosfórico']),
  N(['H2CO3'], 'ácido carbónico'), N(['HClO'], 'ácido hipocloroso'), N(['HClO2'], 'ácido cloroso'), N(['HClO3'], 'ácido clórico'),
  N(['HClO4'], 'ácido perclórico'), N(['HBrO'], 'ácido hipobromoso'), N(['HBrO3'], 'ácido brómico'), N(['HIO3'], 'ácido yódico'),
  N(['HIO4'], 'ácido peryódico'), N(['HMnO4'], 'ácido permangánico'), N(['H2CrO4'], 'ácido crómico'), N(['H2Cr2O7'], 'ácido dicrómico'),
  N(['H2C2O4'], 'ácido oxálico'), N(['CH3COOH', 'HC2H3O2'], 'ácido acético', ['ácido etanoico']),
  N(['HCOOH'], 'ácido fórmico', ['ácido metanoico']), N(['H3BO3'], 'ácido bórico'), N(['H2S2O3'], 'ácido tiosulfúrico'),
  N(['HSCN'], 'ácido tiociánico'), N(['H3AsO4'], 'ácido arsénico'),
]

/** Nombre «binario» de los hidrácidos en estado gaseoso o puro. */
const HYDRACID_GAS_NAMES: Readonly<Record<string, string>> = {
  HF: 'fluoruro de hidrógeno', HCl: 'cloruro de hidrógeno', HBr: 'bromuro de hidrógeno', HI: 'yoduro de hidrógeno',
  H2S: 'sulfuro de hidrógeno', HCN: 'cianuro de hidrógeno',
}

/** Adjetivos tradicionales de cationes de carga única (cloruro sódico, carbonato cálcico). */
const FIXED_ADJECTIVES: Readonly<Record<string, string>> = {
  Na: 'sódico', K: 'potásico', Ca: 'cálcico', Mg: 'magnésico', Ba: 'bárico', Li: 'lítico', Al: 'alumínico', NH4: 'amónico',
}

/** Raíces de los aniones monoatómicos (para nombres con prefijos). */
const ANION_ROOTS: Readonly<Record<number, string>> = {
  9: 'fluoruro', 17: 'cloruro', 35: 'bromuro', 53: 'yoduro', 8: 'óxido', 16: 'sulfuro', 34: 'seleniuro', 52: 'telururo',
  7: 'nitruro', 15: 'fosfuro', 33: 'arseniuro', 6: 'carburo', 14: 'siliciuro', 5: 'boruro', 1: 'hidruro',
}

const NUMBER_PREFIXES = ['', 'mono', 'di', 'tri', 'tetra', 'penta', 'hexa', 'hepta', 'octa', 'nona', 'deca', 'undeca', 'dodeca']

const DIATOMIC = new Set(['H', 'N', 'O', 'F', 'Cl', 'Br', 'I'])

const tryParse = (text: string): Formula | null => {
  try {
    return parseFormula(text)
  } catch {
    return null
  }
}

const lower = (e: Element): string => e.name.toLowerCase()

// MARK: Fórmula → nombre

/** Nombre de una fórmula escrita («NaCl» → cloruro de sodio). `null` si no se puede nombrar con certeza. */
export function nameOfText(formulaText: string): CompoundName | null {
  const f = tryParse(formulaText)
  return f ? nameOf(f) : null
}

/** Nombre de una especie. `null` si no se puede nombrar con certeza. */
export function nameOf(input: Formula): CompoundName | null {
  const f = input.withoutCoefficient()
  if (f.isElectron) return compound(f, 'electrón')
  if (f.isHydrate) return hydrateName(f)
  // Iones de la tabla.
  if (f.charge !== 0) {
    const ion = IonTable.matching(f)
    if (ion) {
      return compound(f, 'ion ' + ion.name, {
        stock: ion.kind === 'cation' && ion.name.includes('(') ? 'ion ' + ion.name : null,
        traditional: ion.traditionalName ? 'ion ' + ion.traditionalName : null,
        notes: [ion.kind === 'cation' ? `Es un catión (carga ${chargeText(f.charge)}).` : `Es un anión (carga ${chargeText(f.charge)}).`],
      })
    }
    // Catión monoatómico de un metal fuera de la tabla: nomenclatura de Stock.
    const e = f.elements[0]
    if (f.composition.size === 1 && f.atomCount === 1 && f.charge > 0 && e && e.isMetal === true && e.commonOxidationStates.includes(f.charge)) {
      const n = e.commonOxidationStates.filter((x) => x > 0).length > 1 ? `${lower(e)}(${roman(f.charge)})` : lower(e)
      return compound(f, 'ion ' + n)
    }
    return null
  }
  // Sustancias elementales.
  if (f.isElementalSubstance) return elementalName(f)
  // Nombres comunes y ácidos.
  const named = lookup(f, COMMON_COMPOUNDS)
  if (named) {
    const sys = binaryMolecularName(f)
    return compound(f, named.name, { systematic: sys === named.name ? null : sys, common: named.alternatives[0] ?? null })
  }
  const acid = lookup(f, ACIDS)
  if (acid) {
    const gas = HYDRACID_GAS_NAMES[f.identityKey] ?? HYDRACID_GAS_NAMES[f.condensed.identityKey]
    if (gas) {
      if (f.state === 'aq') return compound(f, acid.name, { systematic: gas })
      return compound(f, gas, { common: acid.name, notes: [`En disolución acuosa se llama ${acid.name}.`] })
    }
    return compound(f, acid.name, { common: acid.alternatives[0] ?? null })
  }
  const ionic = ionicName(f)
  if (ionic) return ionic
  const sys = binaryMolecularName(f)
  if (sys) return compound(f, sys, { systematic: sys })
  return null
}

/** Nombre corto para mensajes (común, de ácido o sistemático). Lo usa el analizador en sus sugerencias. */
export function commonOrSystematicName(f: Formula): string | null {
  if (f.isElectron) return 'electrón'
  return nameOf(f)?.name ?? null
}

function lookup(f: Formula, table: readonly Named[]): Named | null {
  const key = f.text('plain', false, false)
  for (const item of table) if (item.formulas.includes(key)) return item
  // Misma composición que la forma principal (para escrituras como «HOH»).
  for (const item of table) {
    const g = tryParse(item.formulas[0])
    if (!g || g.charge !== f.charge || f.composition.size > 2) continue
    if (g.composition.size === f.composition.size && [...g.composition].every(([k, n]) => f.composition.get(k) === n)) return item
  }
  return null
}

function elementalName(f: Formula): CompoundName | null {
  const e = f.elements[0]
  if (!e) return null
  const n = f.atomCount
  const elementName = lower(e)
  if (n === 1) return compound(f, elementName)
  if (e.symbol === 'O' && n === 3) return compound(f, 'ozono', { systematic: 'trioxígeno' })
  if (n > 10) return null // C60 y similares: fuera del alcance (no se inventa «hexacontacarbono»)
  const sys = NUMBER_PREFIXES[n] + elementName
  if (n === 2 && DIATOMIC.has(e.symbol)) {
    return compound(f, elementName, { systematic: sys, notes: [`Es la forma molecular habitual del ${elementName} (diatómica).`] })
  }
  if (e.symbol === 'P' && n === 4) return compound(f, 'fósforo blanco', { systematic: sys })
  if (e.symbol === 'S' && n === 8) return compound(f, 'azufre', { systematic: sys, notes: ['Molécula S₈ (azufre rómbico).'] })
  return compound(f, sys, { systematic: sys })
}

function hydrateName(f: Formula): CompoundName | null {
  const water = f.units[f.units.length - 1]
  const first = f.units[0]
  if (f.units.length !== 2 || !water || water.nodes.length !== 2 || !first) return null
  if (!zCompositionsEqual(elementComposition(nodesComposition(water.nodes)), new Map([[1, 2], [8, 1]]))) return null
  const anhydrous = new Formula({
    coefficient: null, units: [{ multiplier: 1, nodes: first.nodes }], charge: 0, state: null, isElectron: false,
    composition: nodesComposition(first.nodes),
  })
  const base = nameOf(anhydrous)
  if (!base) return null
  const n = water.multiplier
  const prefix = n < NUMBER_PREFIXES.length ? NUMBER_PREFIXES[n] : `${n}-`
  const suffix = ` ${prefix}hidratado`
  return compound(f, base.name + suffix, {
    stock: base.stock ? base.stock + suffix : null,
    traditional: base.traditional ? base.traditional + suffix : null,
    notes: [`Hidrato: cada unidad lleva ${n} molécula${n === 1 ? '' : 's'} de agua.`],
  })
}

// MARK: Compuestos iónicos

interface IonicParts {
  cation: ChemIon | null
  metal: Element | null
  cationCharge: number
  cationCount: number
  anion: ChemIon
  anionCount: number
}

interface CationSpec {
  metal: Element | null
  ion: ChemIon | null
  fixedCharge: number | null
  count: number
}

const AMMONIUM = new Map([[7, 1], [1, 4]])
const elementComp = (nodes: readonly FormulaNode[]): Map<number, number> => elementComposition(nodesComposition(nodes))

/** Separa la fórmula en catión (metal o amonio) + anión de la tabla, con cargas que se neutralicen. */
function ionicParts(f: Formula): IonicParts | null {
  const nodes = f.units[0]?.nodes
  if (f.units.length !== 1 || !nodes || nodes.length < 2) return null
  for (let k = 1; k < nodes.length; k++) {
    const cation = nomenclatureCation(nodes.slice(0, k))
    if (!cation) continue
    for (const [anion, anionCharge, anionCount] of nomenclatureAnions(nodes.slice(k))) {
      const p = match(cation, anion, anionCharge, anionCount, f.charge)
      if (p) return p
    }
  }
  return null
}

function nomenclatureCation(nodes: readonly FormulaNode[]): CationSpec | null {
  const ammonium = IonTable.cations.find((c) => c.formulaText === 'NH4^+') ?? null
  if (nodes.length === 1) {
    const node = nodes[0]
    if (node.kind === 'atom') {
      if (node.key.isIsotope || node.key.element.isMetal !== true) return null
      return { metal: node.key.element, ion: null, fixedCharge: null, count: node.count }
    }
    if (zCompositionsEqual(elementComp(node.nodes), AMMONIUM)) return { metal: null, ion: ammonium, fixedCharge: 1, count: node.count }
    // Mercurio(I): (Hg2)₃(PO4)₂ → el catión es Hg₂²⁺ y hay tres.
    const mercuryI = IonTable.cations.find((c) => c.formulaText === 'Hg2^2+')
    if (zCompositionsEqual(elementComp(node.nodes), new Map([[80, 2]])) && mercuryI) {
      return { metal: null, ion: mercuryI, fixedCharge: 2, count: node.count }
    }
    return null
  }
  if (zCompositionsEqual(elementComp(nodes), AMMONIUM)) return { metal: null, ion: ammonium, fixedCharge: 1, count: 1 }
  return null
}

/** Aniones posibles para la parte derecha: (ion, carga, cuántos). */
function nomenclatureAnions(nodes: readonly FormulaNode[]): [ChemIon, number, number][] {
  const out: [ChemIon, number, number][] = []
  if (nodes.length === 1) {
    const node = nodes[0]
    if (node.kind === 'atom') {
      if (node.key.isIsotope) return []
      const n = node.count
      for (const p of IonTable.anionsWithComposition(new Map([[node.key.atomicNumber, 1]]))) out.push([p.ion, p.formula.charge, n])
      if (n > 1) {
        for (let size = 2; size <= n; size++) {
          if (n % size !== 0) continue
          for (const p of IonTable.anionsWithComposition(new Map([[node.key.atomicNumber, size]]))) out.push([p.ion, p.formula.charge, n / size])
        }
      }
      return out
    }
    for (const p of IonTable.anionsWithComposition(elementComp(node.nodes))) out.push([p.ion, p.formula.charge, node.count])
    return out
  }
  for (const p of IonTable.anionsWithComposition(elementComp(nodes))) out.push([p.ion, p.formula.charge, 1])
  return out
}

function fixedCharge(e: Element): number | null {
  if (e.group === 1 && e.atomicNumber !== 1) return 1
  if (e.group === 2) return 2
  switch (e.symbol) {
    case 'Al':
    case 'Ga':
      return 3
    case 'Zn':
    case 'Cd':
      return 2
    case 'Ag':
      return 1
    default:
      return null
  }
}

function match(cation: CationSpec, anion: ChemIon, anionCharge: number, anionCount: number, total: number): IonicParts | null {
  if (!(anionCharge < 0 && cation.count > 0 && anionCount > 0)) return null
  const rest = total - anionCharge * anionCount
  if (!(rest > 0 && rest % cation.count === 0)) return null
  const q = rest / cation.count
  if (cation.ion) {
    if (q !== cation.fixedCharge) return null
    return { cation: cation.ion, metal: null, cationCharge: q, cationCount: cation.count, anion, anionCount }
  }
  const m = cation.metal
  if (!m) return null
  const fixed = fixedCharge(m)
  // Un metal de carga única no puede tener otra.
  if (fixed !== null && fixed !== q) return null
  if (!(m.commonOxidationStates.includes(q) || (m.symbol === 'Hg' && q === 1))) return null
  // Busca el catión en la tabla (Hg(I) es Hg2²⁺).
  const ionText = m.symbol === 'Hg' && q === 1 ? 'Hg2^2+' : `${m.symbol}^${chargeText(q)}`
  const tableIon = IonTable.cations.find((c) => c.formulaText === ionText) ?? null
  return { cation: tableIon, metal: m, cationCharge: q, cationCount: cation.count, anion, anionCount }
}

function ionicName(f: Formula): CompoundName | null {
  if (f.charge !== 0) return null
  const p = ionicParts(f)
  if (!p) return null
  const anionName = p.anion.name
  let cationName: string
  let traditionalAdj: string | null = null
  let multipleStates = false
  if (p.metal) {
    const m = p.metal
    multipleStates = fixedCharge(m) === null && m.commonOxidationStates.filter((x) => x > 0).length > 1
    if (p.cation) {
      cationName = p.cation.name
      traditionalAdj = p.cation.traditionalName ?? FIXED_ADJECTIVES[m.symbol] ?? null
    } else {
      cationName = multipleStates ? `${lower(m)}(${roman(p.cationCharge)})` : lower(m)
      traditionalAdj = FIXED_ADJECTIVES[m.symbol] ?? null
    }
    const paren = cationName.indexOf('(')
    if (!multipleStates && paren >= 0) cationName = cationName.slice(0, paren)
  } else {
    // Catión que no es un metal simple (NH₄⁺, Hg₂²⁺…): su adjetivo tradicional es el suyo, no el del amonio por defecto.
    cationName = p.cation?.name ?? 'amonio'
    traditionalAdj = p.cation?.traditionalName ?? (p.cation?.formulaText === 'NH4^+' ? FIXED_ADJECTIVES.NH4 : null)
  }
  const stock = `${anionName} de ${cationName}`
  const traditional = traditionalAdj && p.anion.name !== 'azida' ? `${anionName} ${traditionalAdj}` : null
  const t = p.anion.traditionalName
  const common = t && t !== p.anion.name ? `${t} de ${cationName}` : null
  // Sistemática con prefijos para binarios metal + no metal (trióxido de dihierro).
  let systematic: string | null = null
  const anionFormula = IonTable.formulaOf(p.anion)
  const anionEl = anionFormula.elements[0]
  if (p.metal && f.composition.size === 2 && anionEl && anionFormula.atomCount === 1) {
    const root = ANION_ROOTS[anionEl.atomicNumber]
    if (root) systematic = prefixed(p.anionCount, root, true, multipleStates) + ' de ' + prefixed(p.cationCount, lower(p.metal), false)
  }
  return compound(f, stock, { stock: multipleStates ? stock : null, traditional, systematic, common })
}

// MARK: Binarios moleculares

/** Prefijo numeral. Con `forceMono`, un 1 en el anión se escribe («monocloruro de cobre» frente a «dicloruro de cobre»). */
function prefixed(n: number, word: string, isAnion: boolean, forceMono = false): string {
  if (n === 1) {
    if (isAnion && word === 'óxido') return 'monóxido'
    if (isAnion && forceMono) return 'mono' + word
    return word
  }
  const p = n < NUMBER_PREFIXES.length ? NUMBER_PREFIXES[n] : `${n}-`
  return p + word
}

/** «CO2» → «dióxido de carbono», «N2O5» → «pentaóxido de dinitrógeno», «PCl5» → «pentacloruro de fósforo». */
export function binaryMolecularName(f: Formula): string | null {
  const nodes = f.units[0]?.nodes
  if (f.charge !== 0 || f.composition.size !== 2 || f.units.length !== 1 || !nodes) return null
  const elements = f.elements
  if (!elements.every((e) => e.isMetal === false) || [...f.composition.keys()].some((k) => k.isIsotope)) return null
  // Orden: como está escrito si son dos símbolos; si no, secuencia de la IUPAC.
  let first: Element
  let second: Element
  const [a, b] = nodes
  if (nodes.length === 2 && a.kind === 'atom' && b.kind === 'atom') {
    first = a.key.element
    second = b.key.element
  } else {
    if (elements.length !== 2) return null
    ;[first, second] = elements
  }
  const root = ANION_ROOTS[second.atomicNumber]
  if (!root || !(first.symbol !== 'H' || ['S', 'Se', 'Te'].includes(second.symbol) || second.group === 17)) return null
  const nFirst = f.countOf(first)
  const nSecond = f.countOf(second)
  const isCH = (first.symbol === 'C' && second.symbol === 'H') || (first.symbol === 'H' && second.symbol === 'C')
  if (nFirst > 10 || nSecond > 10 || isCH || !canBePositive(first, second)) return null
  const firstName = first.symbol === 'H' ? 'hidrógeno' : prefixed(nFirst, lower(first), false)
  const several = first.commonOxidationStates.filter((x) => x > 0).length > 1
  return prefixed(nSecond, root, true, several) + ' de ' + firstName
}

// MARK: Nombre → fórmula

/** Fórmula a partir de un nombre en español («sulfato de hierro(III)» → Fe2(SO4)3). `null` si no se reconoce. */
export function formulaForName(rawName: string): Formula | null {
  let s = fold(rawName).split(' (').join('(').split('( ').join('(').split(' )').join(')')
  if (!s || Array.from(s).length > 120) return null
  for (const prefix of ['el ', 'la ', 'los ', 'las ']) if (s.startsWith(prefix)) s = s.slice(prefix.length)
  // Hidratos.
  let waters = 0
  for (let n = NUMBER_PREFIXES.length - 1; n >= 1; n--) {
    const p = NUMBER_PREFIXES[n]
    for (const suffix of [` ${p}hidratado`, ` ${p}hidrato`]) {
      if (s.endsWith(suffix)) {
        waters = n
        s = s.slice(0, s.length - suffix.length)
        break
      }
    }
    if (waters > 0) break
  }
  if (waters === 0 && s.endsWith(' hidratado')) return null
  const base = formulaWithoutHydrate(s)
  if (!base) return null
  if (waters === 0) return base
  return tryParse(base.plainText + '·' + (waters > 1 ? String(waters) : '') + 'H2O')
}

function formulaWithoutHydrate(s: string): Formula | null {
  // Nombres comunes, ácidos y gases.
  for (const table of [COMMON_COMPOUNDS, ACIDS]) {
    for (const item of table) if ([item.name, ...item.alternatives].map(fold).includes(s)) return tryParse(item.formulas[0])
  }
  for (const [formula, gasName] of Object.entries(HYDRACID_GAS_NAMES)) if (fold(gasName) === s) return tryParse(formula)
  // Iones: «ion sulfato», «catión amonio», «sulfato».
  let ionName = s
  for (const p of ['ion ', 'cation ', 'anion ']) if (ionName.startsWith(p)) ionName = ionName.slice(p.length)
  const ion = ionNamed(ionName)
  if (ion) return ion.formula
  if (s.startsWith('ion ') || s.startsWith('cation ')) {
    const c = cationFromName(ionName)
    if (c) return c.formula
  }
  // Elementos.
  const e = PeriodicTable.byName(s)
  if (e) return tryParse(DIATOMIC.has(e.symbol) ? e.symbol + '2' : e.symbol)
  // «<anión> de <catión>».
  const de = s.indexOf(' de ')
  if (de >= 0) {
    const anionPart = s.slice(0, de)
    const cationPart = s.slice(de + 4)
    const anion = ionNamed(anionPart)
    const cation = anion && anion.kind === 'anion' ? cationFromName(cationPart) : null
    if (anion && cation) return combine(cation, anion)
    // Prefijos: «dióxido de carbono», «tricloruro de hierro».
    const f = prefixedFormula(anionPart, cationPart)
    if (f) return f
  }
  // «<anión> <adjetivo>»: «sulfato férrico», «cloruro sódico».
  const words = s.split(' ').filter((w) => w.length > 0)
  if (words.length >= 2) {
    const adjective = words[words.length - 1]
    const anion = ionNamed(words.slice(0, -1).join(' '))
    const cation = anion && anion.kind === 'anion' ? cationFromAdjective(adjective) : null
    if (anion && cation) return combine(cation, anion)
  }
  return null
}

interface SimpleIon {
  formula: Formula
  kind: IonKind
  text: string
}

function ionNamed(s: string): SimpleIon | null {
  for (const ion of IonTable.all) {
    const names = [ion.name, ...(ion.traditionalName ? [ion.traditionalName] : []), ...ion.otherNames]
    if (names.map(fold).includes(s)) return { formula: IonTable.formulaOf(ion), kind: ion.kind, text: ion.formulaText }
  }
  return null
}

/** Catión por nombre: «hierro(iii)», «sodio», «amonio», «titanio(iv)», «cobre(2+)». */
function cationFromName(s: string): SimpleIon | null {
  const ion = ionNamed(s)
  if (ion && ion.kind === 'cation') return ion
  let name = s
  let charge: number | null = null
  const open = s.indexOf('(')
  if (open >= 0 && s.endsWith(')')) {
    name = s.slice(0, open)
    const inner = s.slice(open + 1, -1)
    charge = romanValue(inner) ?? parseChargeSpec(inner)
    if (charge === null) return null
  }
  const e = PeriodicTable.byName(name)
  if (!e || e.isMetal !== true) return null
  const positive = e.commonOxidationStates.filter((x) => x > 0)
  let q: number
  if (charge !== null) {
    if (!(charge > 0 && (positive.includes(charge) || (e.symbol === 'Hg' && charge === 1)))) return null
    q = charge
  } else {
    if (positive.length !== 1) return null
    q = positive[0]
  }
  const text = e.symbol === 'Hg' && q === 1 ? 'Hg2^2+' : `${e.symbol}^${chargeText(q)}`
  const f = tryParse(text)
  return f ? { formula: f, kind: 'cation', text } : null
}

function cationFromAdjective(adjective: string): SimpleIon | null {
  for (const ion of IonTable.cations) {
    if (ion.traditionalName && fold(ion.traditionalName) === adjective) return { formula: IonTable.formulaOf(ion), kind: 'cation', text: ion.formulaText }
  }
  for (const [symbol, adj] of Object.entries(FIXED_ADJECTIVES)) {
    if (fold(adj) !== adjective) continue
    const text = symbol === 'NH4' ? 'NH4^+' : (IonTable.cations.find((c) => c.formulaText.startsWith(symbol + '^'))?.formulaText ?? '')
    const f = tryParse(text)
    if (f) return { formula: f, kind: 'cation', text }
  }
  return null
}

/** Une catión y anión con la proporción que neutraliza las cargas. */
function combine(cation: SimpleIon, anion: SimpleIon): Formula | null {
  const qc = cation.formula.charge
  const qa = -anion.formula.charge
  if (!(qc > 0 && qa > 0)) return null
  const g = gcd(qc, qa)
  const nc = qa / g
  const na = qc / g
  const part = (ion: SimpleIon, n: number): string => {
    const body = ion.formula.withoutState().text('plain', false, false)
    const core = body.split('^')[0]
    const polyatomic = ion.formula.atomCount > 1
    if (n === 1) return core
    if (core.startsWith('[')) return core + String(n)
    // El catión dimercurio Hg2²⁺ es poliatómico: al multiplicarlo va entre paréntesis, (Hg2)3(PO4)2.
    if (polyatomic) return `(${core})${n}`
    return core + String(n)
  }
  return tryParse(part(cation, nc) + part(anion, na))
}

/** «dióxido» + «carbono» → CO2; «tricloruro» + «hierro» → FeCl3. */
function prefixedFormula(anionPart: string, cationPart: string): Formula | null {
  let a = anionPart
  // Formas con vocal elidida: «pentóxido» → «pentaóxido».
  for (const [short, long] of [
    ['pentoxido', 'pentaoxido'], ['tetroxido', 'tetraoxido'], ['hexoxido', 'hexaoxido'], ['heptoxido', 'heptaoxido'],
    ['octoxido', 'octaoxido'], ['decoxido', 'decaoxido'], ['monoxido', 'monooxido'],
  ]) {
    if (a.startsWith(short)) a = long + a.slice(short.length)
  }
  const split = (word: string, roots: ReadonlyMap<string, number>): [number, number, boolean] | null => {
    for (let n = NUMBER_PREFIXES.length - 1; n >= 0; n--) {
      const p = NUMBER_PREFIXES[n]
      if (!word.startsWith(p)) continue
      const z = roots.get(word.slice(p.length))
      if (z !== undefined) return [Math.max(1, n), z, n > 0]
    }
    return null
  }
  const rootMap = new Map<string, number>()
  for (const [z, r] of Object.entries(ANION_ROOTS)) rootMap.set(fold(r), Number(z))
  const sa = split(a, rootMap)
  if (!sa) return null
  const [na, za, prefixA] = sa
  const elementMap = new Map<string, number>()
  for (const e of ALL_ELEMENTS) {
    elementMap.set(fold(e.name), e.atomicNumber)
    for (const alt of e.alternativeNames) elementMap.set(fold(alt), e.atomicNumber)
  }
  const sc = split(cationPart, elementMap)
  if (!sc) return null
  const [nc, zc, prefixC] = sc
  const ea = PeriodicTable.byNumber(za)
  const ec = PeriodicTable.byNumber(zc)
  if (za === zc || !ea || !ec) return null
  // Sin ningún prefijo, un metal es ambiguo («cloruro de hierro»: ¿FeCl2 o FeCl3?).
  if (!prefixA && !prefixC && ec.isMetal !== false) return null
  // Un gas noble ligero o el flúor no pueden ir delante («cloruro de neón» no existe).
  if (!(ec.isMetal === true || canBePositive(ec, ea))) return null
  return tryParse(ec.symbol + (nc > 1 ? String(nc) : '') + ea.symbol + (na > 1 ? String(na) : ''))
}

/** ¿Puede el elemento ir delante (con número de oxidación positivo) frente al otro? El O solo frente a halógenos (OF2). */
function canBePositive(e: Element, other: Element): boolean {
  if (e.symbol === 'O') return other.category === 'halogen'
  return e.commonOxidationStates.some((x) => x > 0)
}

// MARK: Números romanos

export function roman(n: number): string {
  const table = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
  return n >= 0 && n < table.length ? table[n] : String(n)
}

function romanValue(s: string): number | null {
  const table: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 }
  return table[s.toLowerCase()] ?? null
}

/** API con los nombres de la app Swift. */
export const Nomenclature = {
  /** Nombre de una fórmula (texto o ya analizada). */
  name(input: string | Formula): CompoundName | null {
    return typeof input === 'string' ? nameOfText(input) : nameOf(input)
  },
  /** Fórmula a partir de un nombre en español. */
  formulaForName,
  commonOrSystematicName,
  binaryMolecularName,
  roman,
}
