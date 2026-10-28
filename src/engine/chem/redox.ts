// Números de oxidación (reglas estándar), análisis redox de ecuaciones y apoyo redox para el balanceo.
//
// Orden de las reglas: sustancia elemental 0; ion monoatómico = su carga; las sales se separan en sus iones cuando se
// reconocen (NH4NO3 → NH₄⁺ + NO₃⁻; Fe2(SO4)3 → 2 Fe³⁺ + 3 SO₄²⁻; K4[Fe(CN)6] → 4 K⁺ + [Fe(CN)₆]⁴⁻); F = −1; grupo 1 = +1;
// grupo 2 = +2; H = +1 (−1 si solo está unido a metales, B o Si); O = −2 (salvo que sea el único que falta: peróxidos −1,
// superóxidos −1/2, OF2 +2); halógenos −1 si son el elemento más electronegativo; el resto por diferencia. Si quedan
// varios desconocidos, el más electronegativo toma su estado negativo habitual (N −3, S −2, C −4). Si aun así no se
// puede decidir (CuFeS2), se avisa.

import { balanceEquation } from './balancer'
import { ChemError } from './errors'
import { L } from './l10n'
import { ALL_ELEMENTS, PeriodicTable, type Element } from './elements'
import { ChemicalEquation, effectiveCoefficient } from './equation'
import { Formula, type FormulaNode } from './formula'
import { elementComposition, IonTable, zCompositionsEqual } from './ion-table'
import { nodesComposition, parseFormula } from './parser'
import { Rational } from './rational'
import { andList } from './text'

/** Un entorno distinto del mismo elemento (en NH4NO3 el N está a −3 en NH4⁺ y a +5 en NO3⁻). */
export interface OxidationSite {
  /** Parte de la fórmula donde está («NH₄⁺»). */
  readonly context: string
  readonly state: Rational
  readonly count: number
}

/** Número de oxidación de un elemento. */
export interface OxidationEntry {
  readonly element: Element
  /** Átomos de este elemento en la especie. */
  readonly count: number
  /** Número de oxidación (promedio si hay varios entornos o si sale fraccionario: Fe₃O₄ → +8/3). */
  readonly state: Rational
  /** Entornos distintos, si se conocen (vacío si todos los átomos son iguales). */
  readonly sites: readonly OxidationSite[]
}

/** Números de oxidación de los elementos de una especie. */
export class OxidationStateReport {
  constructor(
    readonly formula: Formula,
    readonly entries: readonly OxidationEntry[],
    readonly steps: readonly string[],
    readonly warnings: readonly string[],
  ) {}

  /** Número de oxidación (promedio) de un elemento por símbolo. */
  stateOf(symbol: string): Rational | null {
    const z = symbol === 'D' || symbol === 'T' ? 1 : PeriodicTable.bySymbol(symbol)?.atomicNumber
    return this.entries.find((e) => e.element.atomicNumber === z)?.state ?? null
  }

  /** «K: +1, Mn: +7, O: -2». */
  get summary(): string {
    return this.entries
      .map((e) => {
        let s = `${e.element.symbol}: ${e.state.signedString()}`
        if (e.sites.length > 0) s += ' (' + e.sites.map((x) => `${x.state.signedString()} en ${x.context}`).join(', ') + ')'
        return s
      })
      .join(', ')
  }
}

type SiteList = [string, Rational, number][]
type Sites = Map<number, SiteList>

const el = (z: number): Element => PeriodicTable.byNumber(z) ?? ALL_ELEMENTS[0]
const EN = (z: number): number => el(z).electronegativity ?? 0

function addSites(target: Sites, z: number, items: SiteList): void {
  target.set(z, [...(target.get(z) ?? []), ...items])
}

function label(nodes: readonly FormulaNode[], charge: number): string {
  const comp = nodesComposition(nodes)
  return new Formula({ coefficient: null, units: [{ multiplier: 1, nodes }], charge, state: null, isElectron: false, composition: comp }).unicodeText
}

export const OxidationStates = {
  /** Analiza el texto o la fórmula de una especie. Lanza `ChemError` si no se puede decidir. */
  analyze(input: string | Formula): OxidationStateReport {
    const formula = typeof input === 'string' ? parseFormula(input) : input
    if (formula.isElectron) throw ChemError.calculation(L('El electrón no tiene número de oxidación.'))
    const steps: string[] = []
    const warnings: string[] = []
    const sites: Sites = new Map()
    const multiUnit = formula.units.length > 1
    formula.units.forEach((unit, index) => {
      // En un hidrato cada parte es neutra (salvo que la fórmula entera tenga carga: se la damos a la primera).
      const unitCharge = multiUnit ? (index === 0 ? formula.charge : 0) : formula.charge
      if (multiUnit) steps.push(`Analizo por separado ${label(unit.nodes, unitCharge)} (parte del hidrato).`)
      const r = assign(unit.nodes, unitCharge, 0, steps, warnings)
      for (const [z, list] of r) addSites(sites, z, list.map(([c, q, n]) => [c, q, n * unit.multiplier]))
    })
    // Agrupa por elemento.
    const entries: OxidationEntry[] = []
    for (const e of formula.elements) {
      const list = sites.get(e.atomicNumber)
      if (!list || list.length === 0) continue
      const total = list.reduce((a, [, , n]) => a + n, 0)
      let weighted = Rational.ZERO
      for (const [, q, n] of list) weighted = weighted.add(q.mul(n))
      const avg = weighted.div(total)
      if (!avg) throw ChemError.quantityTooLarge()
      // Entornos distintos (fusiona los que tienen el mismo estado).
      const merged: SiteList = []
      for (const [c, q, n] of list) {
        const m = merged.find((x) => x[1].equals(q))
        if (m) m[2] += n
        else merged.push([c, q, n])
      }
      const siteList = merged.length > 1 ? merged.map(([context, state, count]) => ({ context, state, count })) : []
      entries.push({ element: e, count: total, state: avg, sites: siteList })
      if (!avg.isInteger && siteList.length === 0) {
        warnings.push(`El ${e.symbol} sale con número de oxidación fraccionario (${avg.signedString()}): es un promedio; los átomos no son todos iguales.`)
      }
    }
    for (const e of entries) {
      const v = e.state.toNumber()
      if (v > 8 || v < -4) {
        warnings.push(`El ${e.element.symbol} sale a ${e.state.signedString()}, un valor imposible: la especie debe de tener enlaces que las reglas básicas no ven (peróxidos, ligandos neutros…).`)
      }
    }
    return new OxidationStateReport(formula, entries, steps, warnings)
  },
}

// MARK: Reglas

function assign(nodes: readonly FormulaNode[], charge: number, depth: number, steps: string[], warnings: string[]): Sites {
  const comp = elementComposition(nodesComposition(nodes))
  const name = label(nodes, charge)
  // Sustancia elemental o ion homonuclear.
  if (comp.size === 1) {
    const [[z, n]] = [...comp.entries()]
    const q = Rational.of(charge, n)
    if (!q) throw ChemError.quantityTooLarge()
    const sym = PeriodicTable.byNumber(z)?.symbol ?? '?'
    if (charge === 0) steps.push(`${name} es una sustancia elemental: el ${sym} tiene número de oxidación 0.`)
    else if (n === 1) steps.push(`${name} es un ion monoatómico: su número de oxidación es su carga, ${q.signedString()}.`)
    else steps.push(`En ${name} los ${n} átomos son iguales: ${Rational.int(charge).signedString()} ÷ ${n} = ${q.signedString()}.`)
    return new Map([[z, [[name, q, n]]]])
  }
  // Sales y complejos: separa en iones reconocibles.
  const parts = depth < 6 ? decompose(nodes, charge) : null
  if (parts) {
    steps.push(`${name} = ` + parts.map((p) => label(p.nodes, p.charge) + (p.multiplier > 1 ? ` ×${p.multiplier}` : '')).join(' + ') + ' (se separa en sus iones).')
    const out: Sites = new Map()
    for (const p of parts) {
      const sub = assign(p.nodes, p.charge, depth + 1, steps, warnings)
      for (const [z, list] of sub) addSites(out, z, list.map(([c, q, n]) => [c, q, n * p.multiplier]))
    }
    return out
  }
  return rules(comp, charge, name, steps)
}

function rules(comp: ReadonlyMap<number, number>, charge: number, name: string, steps: string[]): Sites {
  const known = new Map<number, Rational>()
  const zs = [...comp.keys()].sort((a, b) => a - b)
  const unknowns = (): number[] => zs.filter((z) => !known.has(z))

  // F
  if (comp.has(9)) {
    known.set(9, Rational.int(-1))
    steps.push('F: siempre -1.')
  }
  // Grupos 1 y 2
  for (const z of zs) {
    if (known.has(z)) continue
    if (el(z).group === 1 && z !== 1) {
      known.set(z, Rational.int(1))
      steps.push(`${el(z).symbol}: metal alcalino (grupo 1), +1.`)
    } else if (el(z).group === 2) {
      known.set(z, Rational.int(2))
      steps.push(`${el(z).symbol}: alcalinotérreo (grupo 2), +2.`)
    }
  }
  // H
  if (comp.has(1) && !known.has(1)) {
    const others = zs.filter((z) => z !== 1)
    const hydride = others.length > 0 && others.every((z) => el(z).isMetal === true || z === 5 || z === 14)
    known.set(1, Rational.int(hydride ? -1 : 1))
    steps.push(hydride ? 'H: -1 (hidruro: está unido a metales, B o Si, menos electronegativos que él).' : 'H: +1 (unido a no metales).')
  }
  // O: -2 salvo que sea el único desconocido.
  if (comp.has(8) && !known.has(8) && unknowns().length > 1) {
    known.set(8, Rational.int(-2))
    steps.push('O: -2.')
  }
  // Aluminio: +3 en sus compuestos, solo si hay algún no metal (en un intermetálico no tiene sentido).
  if (comp.has(13) && !known.has(13) && zs.some((z) => z !== 13 && el(z).isMetal === false)) {
    known.set(13, Rational.int(3))
    steps.push('Al: +3.')
  }
  // Halógenos (Cl, Br, I, At): -1 si son los más electronegativos de los que faltan; también si son la única incógnita
  // y no hay O ni F (así MgCl₃ o NaCl₃ no se salvan con un «por diferencia» que da un estado imposible).
  for (const z of [17, 35, 53, 85]) {
    if (!comp.has(z) || known.has(z)) continue
    const others = unknowns().filter((x) => x !== z)
    const en = EN(z)
    const moreEN = others.some((x) => EN(x) > en) || known.has(8)
    const allKnownLessEN = [...known.keys()].every((k) => EN(k) < en)
    const onlyHalide = others.length === 0 && !comp.has(8) && !comp.has(9) && allKnownLessEN
    if ((others.length > 0 && !moreEN) || onlyHalide) {
      known.set(z, Rational.int(-1))
      steps.push(`${el(z).symbol}: -1 (es el más electronegativo).`)
    }
  }
  // Si quedan varios desconocidos, el no metal más electronegativo toma su estado negativo habitual.
  while (unknowns().length > 1) {
    const candidates = unknowns().filter((z) => el(z).isMetal === false && el(z).group !== null && (el(z).group ?? 0) >= 14)
    if (candidates.length === 0) break
    const z = candidates.reduce((best, x) => (EN(best) < EN(x) ? x : best))
    const g = el(z).group ?? 18
    const q = Rational.int(-(18 - g))
    known.set(z, q)
    steps.push(`${el(z).symbol}: ${q.signedString()} (el más electronegativo de los que quedan toma su valor negativo habitual).`)
  }
  const left = unknowns()
  if (left.length > 1) {
    const symbols = andList(left.map((z) => el(z).symbol))
    throw ChemError.calculation(
      L('No puedo asignar los números de oxidación de %@ solo con las reglas: %@ quedan sin determinar (hay varias combinaciones posibles).', name, symbols),
    )
  }
  // El último, por diferencia.
  if (left.length === 1) {
    const z = left[0]
    const n = comp.get(z) ?? 1
    let sum = Rational.ZERO
    const terms: string[] = []
    for (const [k, q] of [...known.entries()].sort((a, b) => a[0] - b[0])) {
      const c = comp.get(k) ?? 0
      sum = sum.add(q.mul(c))
      terms.push(c === 1 ? `(${q.signedString()})` : `${c}(${q.signedString()})`)
    }
    const x = Rational.int(charge).sub(sum).div(n)
    if (!x) throw ChemError.quantityTooLarge()
    known.set(z, x)
    const xs = n === 1 ? 'x' : `${n}x`
    steps.push(`${el(z).symbol} por diferencia: ${xs} + ${terms.join(' + ')} = ${charge} → x = ${x.signedString()}.`)
  }
  // Verificación final: los estados asignados tienen que sumar la carga de la especie (NaF₂ no cuadra).
  let check = Rational.ZERO
  for (const [k, q] of known) check = check.add(q.mul(comp.get(k) ?? 0))
  if (!check.equals(Rational.int(charge))) {
    throw ChemError.calculation(
      L(
        'Los números de oxidación de %@ suman %@ y la carga de la especie es %@: la fórmula no cuadra con las reglas. Revisa la fórmula o consulta los estados de oxidación posibles.',
        name,
        check.signedString(),
        Rational.int(charge).signedString(),
      ),
    )
  }
  const out: Sites = new Map()
  for (const [z, q] of known) {
    const n = comp.get(z)
    if (n !== undefined) out.set(z, [[name, q, n]])
  }
  return out
}

// MARK: Separación en iones

interface IonPart {
  nodes: readonly FormulaNode[]
  charge: number
  multiplier: number
}

interface Candidate {
  nodes: readonly FormulaNode[]
  charge: number | null
  multiplier: number
  metal: Element | null
  /** Anión de un solo elemento (O²⁻, Cl⁻, O₂²⁻): solo se separa en especies neutras (sales y óxidos). */
  monatomic: boolean
}

/** Cargas fijas de cationes metálicos «de una sola carga». */
function fixedCationCharge(e: Element): number | null {
  if (e.group === 1 && e.atomicNumber !== 1) return 1
  if (e.group === 2) return 2
  switch (e.symbol) {
    case 'Al':
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

const AMMONIUM = new Map([[7, 1], [1, 4]])
const MERCURY_I = new Map([[80, 2]])

/** Intenta separar la especie en catión(es) + anión(es) reconocibles. */
function decompose(nodes: readonly FormulaNode[], charge: number): IonPart[] | null {
  if (nodes.length < 2) return null // un solo grupo con subíndice: nada que separar
  for (let k = 1; k < nodes.length; k++) {
    const cation = cationCandidate(nodes.slice(0, k))
    if (!cation) continue
    // En un ion poliatómico (Cr2O7²⁻, MnO4⁻) no se separan aniones de un solo elemento (O²⁻, O₂²⁻): no es una sal.
    for (const anion of anionCandidates(nodes.slice(k))) {
      if (!(charge === 0 || !anion.monatomic)) continue
      // Carga total = catión·m + anión·a.
      if (cation.charge !== null) {
        const qc = cation.charge
        const cationTotal = qc * cation.multiplier
        if (anion.charge !== null) {
          if (cationTotal + anion.charge * anion.multiplier === charge) {
            return [
              { nodes: cation.nodes, charge: qc, multiplier: cation.multiplier },
              { nodes: anion.nodes, charge: anion.charge, multiplier: anion.multiplier },
            ]
          }
        } else {
          // Anión complejo de carga desconocida.
          const rest = charge - cationTotal
          if (!(anion.multiplier > 0 && rest % anion.multiplier === 0 && rest < 0)) continue
          return [
            { nodes: cation.nodes, charge: qc, multiplier: cation.multiplier },
            { nodes: anion.nodes, charge: rest / anion.multiplier, multiplier: anion.multiplier },
          ]
        }
      } else if (anion.charge !== null) {
        // Catión de carga variable: la deduce el anión.
        const rest = charge - anion.charge * anion.multiplier
        if (!(cation.multiplier > 0 && rest > 0 && rest % cation.multiplier === 0)) continue
        const qc = rest / cation.multiplier
        if (cation.metal && !cation.metal.commonOxidationStates.includes(qc)) continue
        if (!cation.metal && qc > 8) continue
        return [
          { nodes: cation.nodes, charge: qc, multiplier: cation.multiplier },
          { nodes: anion.nodes, charge: anion.charge, multiplier: anion.multiplier },
        ]
      }
    }
  }
  return null
}

function cationCandidate(nodes: readonly FormulaNode[]): Candidate | null {
  const comp = elementComposition(nodesComposition(nodes))
  if (nodes.length === 1) {
    const node = nodes[0]
    if (node.kind === 'atom') {
      const e = node.key.element
      const one: FormulaNode = { kind: 'atom', key: node.key, count: 1 }
      if (e.atomicNumber === 1) return { nodes: [one], charge: 1, multiplier: node.count, metal: null, monatomic: false }
      if (e.isMetal !== true) return null
      const fixed = fixedCationCharge(e)
      return { nodes: [one], charge: fixed, multiplier: node.count, metal: fixed === null ? e : null, monatomic: false }
    }
    const innerComp = elementComposition(nodesComposition(node.nodes))
    if (zCompositionsEqual(innerComp, AMMONIUM)) return { nodes: node.nodes, charge: 1, multiplier: node.count, metal: null, monatomic: false }
    // Mercurio(I): el catión es el dímero Hg₂²⁺; el grupo (Hg2)₃ aporta tres de ellos.
    if (zCompositionsEqual(innerComp, MERCURY_I)) return { nodes: node.nodes, charge: 2, multiplier: node.count, metal: null, monatomic: false }
    if (node.bracket === 'square') return { nodes: node.nodes, charge: null, multiplier: node.count, metal: null, monatomic: false }
    return null
  }
  // «NH4» sin paréntesis.
  if (zCompositionsEqual(comp, AMMONIUM)) return { nodes, charge: 1, multiplier: 1, metal: null, monatomic: false }
  return null
}

function anionCandidates(nodes: readonly FormulaNode[]): Candidate[] {
  const out: Candidate[] = []
  if (nodes.length === 1) {
    const node = nodes[0]
    if (node.kind === 'atom') {
      const e = node.key.element
      const g = e.group
      if (e.isMetal !== false || g === null || !(g >= 14 || e.atomicNumber === 1)) return []
      const n = node.count
      // Monoatómico (Cl⁻, O²⁻, S²⁻, N³⁻, H⁻…).
      const q = e.atomicNumber === 1 ? -1 : -(18 - g)
      if (g < 18) out.push({ nodes: [{ kind: 'atom', key: node.key, count: 1 }], charge: q, multiplier: n, metal: null, monatomic: true })
      // Poliatómico homonuclear (O₂²⁻, O₂⁻, S₂²⁻, C₂²⁻, N₃⁻).
      for (let size = 2; size <= Math.max(2, n); size++) {
        if (n % size !== 0) continue
        for (const p of IonTable.anionsWithComposition(new Map([[e.atomicNumber, size]]))) {
          out.push({ nodes: [{ kind: 'atom', key: node.key, count: size }], charge: p.formula.charge, multiplier: n / size, metal: null, monatomic: true })
        }
      }
      return out
    }
    const innerComp = elementComposition(nodesComposition(node.nodes))
    for (const p of IonTable.anionsWithComposition(innerComp)) {
      out.push({ nodes: node.nodes, charge: p.formula.charge, multiplier: node.count, metal: null, monatomic: false })
    }
    if (node.bracket === 'square') out.push({ nodes: node.nodes, charge: null, multiplier: node.count, metal: null, monatomic: false })
    return out
  }
  const comp = elementComposition(nodesComposition(nodes))
  for (const p of IonTable.anionsWithComposition(comp)) out.push({ nodes, charge: p.formula.charge, multiplier: 1, metal: null, monatomic: false })
  return out
}

// MARK: Análisis redox de una ecuación

/** Cambio del número de oxidación de un elemento entre un reactivo y un producto. */
export interface OxidationChange {
  readonly element: Element
  readonly from: Rational
  readonly to: Rational
  readonly reactant: Formula
  readonly product: Formula
}

export interface RedoxAnalysis {
  /** `true` si algún elemento cambia de número de oxidación. */
  readonly isRedox: boolean
  readonly oxidations: readonly OxidationChange[]
  readonly reductions: readonly OxidationChange[]
  /** Especies que contienen el elemento que se reduce. */
  readonly oxidizingAgents: readonly Formula[]
  /** Especies que contienen el elemento que se oxida. */
  readonly reducingAgents: readonly Formula[]
  /** Un mismo elemento se oxida y se reduce a la vez (Cl2 → Cl⁻ + ClO3⁻). */
  readonly isDisproportionation: boolean
  /** Dos estados de un elemento acaban en uno intermedio (IO3⁻ + I⁻ → I2). */
  readonly isComproportionation: boolean
  /** Electrones transferidos en la ecuación balanceada (si se pudo determinar). */
  readonly electronsTransferred: number | null
  /** Números de oxidación de cada especie, en orden (reactivos y luego productos, sin electrones). */
  readonly reports: readonly OxidationStateReport[]
  /** Resumen en español. */
  readonly summary: string
  readonly steps: readonly string[]
}

interface Pop {
  q: Rational
  count: Rational
  species: number[]
}

/** Qué se oxida, qué se reduce, agentes y electrones transferidos (balancea antes si hace falta). */
export function redoxAnalysis(equation: ChemicalEquation): RedoxAnalysis {
  let balanced = equation
  if (!equation.isBalanced) {
    const r = balanceEquation(equation)
    balanced = r.isBalanced && r.equation ? r.equation : equation
  }
  const terms = balanced.terms.filter((t) => !t.formula.isElectron)
  const nR = balanced.reactants.filter((t) => !t.formula.isElectron).length
  const reports = terms.map((t) => OxidationStates.analyze(t.formula))
  const steps = ['Calculo el número de oxidación de cada elemento en cada especie:']
  terms.forEach((t, j) => steps.push(`• ${t.formula.text('unicode', false, false)}: ${reports[j].summary}`))
  // Poblaciones: (Z, estado) → átomos en cada lado y especies donde aparece.
  const left = new Map<number, Map<string, Pop>>()
  const right = new Map<number, Map<string, Pop>>()
  terms.forEach((t, j) => {
    for (const e of reports[j].entries) {
      const list: [Rational, number][] = e.sites.length === 0 ? [[e.state, e.count]] : e.sites.map((s) => [s.state, s.count])
      for (const [q, n] of list) {
        const atoms = effectiveCoefficient(t).mul(n)
        const side = j < nR ? left : right
        const byState = side.get(e.element.atomicNumber) ?? new Map<string, Pop>()
        side.set(e.element.atomicNumber, byState)
        const key = q.toString()
        const pop = byState.get(key) ?? { q, count: Rational.ZERO, species: [] }
        pop.count = pop.count.add(atoms)
        pop.species.push(j)
        byState.set(key, pop)
      }
    }
  })
  const oxidations: OxidationChange[] = []
  const reductions: OxidationChange[] = []
  const oxidizing: number[] = []
  const reducing: number[] = []
  let lost = Rational.ZERO
  let gained = Rational.ZERO
  let electronsKnown = balanced.isBalanced
  let disproportionation = false
  let comproportionation = false
  const byValue = (a: Rational, b: Rational): number => a.compare(b)
  const zs = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b)
  for (const z of zs) {
    const l = left.get(z)
    const r = right.get(z)
    const element = PeriodicTable.byNumber(z)
    if (!l || !r || !element) continue
    const ls = [...l.values()].map((p) => p.q).sort(byValue)
    const rs = [...r.values()].map((p) => p.q).sort(byValue)
    const inL = (q: Rational): boolean => l.has(q.toString())
    const inR = (q: Rational): boolean => r.has(q.toString())
    const sameSets = ls.length === rs.length && ls.every(inR)
    if (sameSets && ls.length === 1) continue
    const vanishing = ls.filter((q) => !inR(q))
    const appearing = rs.filter((q) => !inL(q))
    const fromStates = vanishing.length === 0 ? ls : vanishing
    const toStates = appearing.length === 0 ? rs : appearing
    if (vanishing.length === 0 && appearing.length === 0) continue
    let up = false
    let down = false
    for (const a of fromStates) {
      for (const b of toStates) {
        if (a.equals(b)) continue
        const la = l.get(a.toString())
        const rb = r.get(b.toString())
        const change: OxidationChange = {
          element,
          from: a,
          to: b,
          reactant: terms[la?.species[0] ?? 0].formula,
          product: terms[rb?.species[0] ?? 0].formula,
        }
        if (b.gt(a)) {
          oxidations.push(change)
          up = true
          reducing.push(...(la?.species ?? []))
        } else {
          reductions.push(change)
          down = true
          oxidizing.push(...(la?.species ?? []))
        }
      }
    }
    if (up && down) {
      if (fromStates.length === 1) disproportionation = true
      else if (toStates.length === 1) comproportionation = true
    }
    // Electrones (solo si el reparto es claro: un estado de partida o uno de llegada).
    if (fromStates.length === 1) {
      const a = fromStates[0]
      for (const b of toStates) {
        if (b.equals(a)) continue
        const pop = r.get(b.toString())
        if (!pop) {
          electronsKnown = false
          continue
        }
        const e = pop.count.mul(b.sub(a).abs())
        if (b.gt(a)) lost = lost.add(e)
        else gained = gained.add(e)
      }
    } else if (toStates.length === 1) {
      const b = toStates[0]
      for (const a of fromStates) {
        if (a.equals(b)) continue
        const pop = l.get(a.toString())
        if (!pop) {
          electronsKnown = false
          continue
        }
        const e = pop.count.mul(b.sub(a).abs())
        if (b.gt(a)) lost = lost.add(e)
        else gained = gained.add(e)
      }
    } else {
      electronsKnown = false
    }
  }
  const isRedox = oxidations.length > 0 || reductions.length > 0
  const uniq = (idx: readonly number[]): Formula[] => {
    const seen = new Set<string>()
    const out: Formula[] = []
    for (const i of idx) {
      if (i >= terms.length) continue
      const f = terms[i].formula
      if (!seen.has(f.identityKey)) {
        seen.add(f.identityKey)
        out.push(f.withoutState())
      }
    }
    return out
  }
  const electrons = isRedox && electronsKnown && lost.equals(gained) && lost.isInteger ? lost.intValue : null
  let summary: string
  if (!isRedox) {
    summary = 'No es una reacción redox: ningún elemento cambia de número de oxidación.'
  } else {
    const parts: string[] = []
    for (const c of oxidations) parts.push(`El ${c.element.symbol} se oxida (${c.from.signedString()} → ${c.to.signedString()}): pierde electrones.`)
    for (const c of reductions) parts.push(`El ${c.element.symbol} se reduce (${c.from.signedString()} → ${c.to.signedString()}): gana electrones.`)
    const red = uniq(reducing).map((f) => f.unicodeText).join(', ')
    const ox = uniq(oxidizing).map((f) => f.unicodeText).join(', ')
    parts.push(`Agente reductor: ${red}. Agente oxidante: ${ox}.`)
    if (disproportionation) parts.push('Es una dismutación (desproporción): el mismo elemento se oxida y se reduce.')
    if (comproportionation) parts.push('Es una comproporción: dos estados del mismo elemento acaban en uno intermedio.')
    if (electrons !== null) parts.push(`En la ecuación balanceada (${balanced.unicodeText}) se transfieren ${electrons} electrones.`)
    summary = parts.join(' ')
  }
  steps.push(summary)
  return {
    isRedox,
    oxidations,
    reductions,
    oxidizingAgents: uniq(oxidizing),
    reducingAgents: uniq(reducing),
    isDisproportionation: disproportionation,
    isComproportionation: comproportionation,
    electronsTransferred: electrons,
    reports,
    summary,
    steps,
  }
}

// MARK: Apoyo redox para el balanceo

/**
 * Filas extra para la matriz de balanceo: resuelven la ambigüedad típica de ecuaciones con H2O2 (o similares)
 * conservando por separado las poblaciones «espectadoras» de un elemento (el O a −2 en MnO4⁻/H2O cuando el que se oxida
 * es el O a −1 del H2O2). `null` si no se pueden calcular los números de oxidación. `flexible`: especies añadidas por
 * el medio (H₂O, H⁺, OH⁻), que pueden acabar en cualquier lado.
 */
export function spectatorRows(species: readonly Formula[], nR: number, flexible: ReadonlySet<number> = new Set()): number[][] | null {
  const reports: (OxidationStateReport | null)[] = []
  for (const f of species) {
    if (f.isElectron) {
      reports.push(null)
      continue
    }
    try {
      reports.push(OxidationStates.analyze(f))
    } catch {
      return null
    }
  }
  // (Z, estado) → átomos por especie.
  const pops = new Map<number, Map<string, Map<number, number>>>()
  reports.forEach((r, j) => {
    if (!r) return
    for (const e of r.entries) {
      const list: [Rational, number][] = e.sites.length === 0 ? [[e.state, e.count]] : e.sites.map((s) => [s.state, s.count])
      for (const [q, n] of list) {
        const byState = pops.get(e.element.atomicNumber) ?? new Map<string, Map<number, number>>()
        pops.set(e.element.atomicNumber, byState)
        const per = byState.get(q.toString()) ?? new Map<number, number>()
        byState.set(q.toString(), per)
        per.set(j, (per.get(j) ?? 0) + n)
      }
    }
  })
  const rows: number[][] = []
  for (const z of [...pops.keys()].sort((a, b) => a - b)) {
    const byState = pops.get(z) as Map<string, Map<number, number>>
    const states = [...byState.keys()]
    const leftStates = new Set(states.filter((q) => [...(byState.get(q) as Map<number, number>).keys()].some((j) => j < nR)))
    const rightStates = new Set(states.filter((q) => [...(byState.get(q) as Map<number, number>).keys()].some((j) => j >= nR || flexible.has(j))))
    const common = [...leftStates].filter((q) => rightStates.has(q))
    const vanishing = [...leftStates].filter((q) => !rightStates.has(q))
    const appearing = [...rightStates].filter((q) => !leftStates.has(q))
    if (common.length === 0 || vanishing.length === 0 || appearing.length === 0) continue
    for (const q of common) {
      const per = byState.get(q) as Map<number, number>
      rows.push(species.map((_, j) => (per.get(j) ?? 0) * (j < nR ? 1 : -1)))
    }
  }
  return rows
}

/** Atajo: análisis redox de un texto. */
export function redoxAnalysisOf(text: string): RedoxAnalysis {
  return redoxAnalysis(ChemicalEquation.parse(text))
}
