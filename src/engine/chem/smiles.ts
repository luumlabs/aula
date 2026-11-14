// Moléculas desde SMILES, la notación lineal que la IA conoce bien («CCO» es el etanol, «c1ccccc1» el benceno,
// «CC(=O)O» el ácido acético): lectura, hidrógenos implícitos, anillos mínimos, forma de Kekulé, composición (fórmula y
// masa molar con el resto del motor), hidrógenos explícitos para la fórmula desarrollada y reacciones (A.B>>C.D).
//
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/molecule.ts (parseSmiles,
// hydrogens, findRings). De Aula: errores con tipo y posición, comprobación de elementos y valencias, anillos mínimos,
// Kekulé, estereoquímica guardada (/ \ @), grupos R con clase, isótopos y reacciones.
import { PeriodicTable } from './elements'
import { AtomKey, type Composition } from './formula'
import { smilesErrorMessage, type SmilesErrorKind } from './smiles-messages'

export type { SmilesErrorKind } from './smiles-messages'

export const SMILES_MAX_LENGTH = 500
export const SMILES_MAX_ATOMS = 80

export type BondOrder = 1 | 1.5 | 2 | 3

export interface SmilesAtom {
  /** Símbolo con mayúscula («C», «Cl», «H»); «*» es un grupo R. */
  element: string
  /** Escrito en minúscula (aromático). */
  aromatic: boolean
  /** Escrito entre corchetes. */
  bracket: boolean
  /** Hidrógenos escritos en el corchete (en los átomos sin corchete se deducen de la valencia). */
  hCount?: number
  charge: number
  isotope?: number
  /** Clase del átomo ([*:1] → 1): numera los grupos R. */
  atomClass?: number
  /** «@» o «@@» (se guarda; aún no se dibuja). */
  chirality?: string
  /** Posición en el texto (desde 1). */
  pos: number
  /** Hidrógeno añadido para la fórmula desarrollada (no estaba en la SMILES). */
  added?: boolean
}

export interface SmilesBond {
  a: number
  b: number
  order: BondOrder
  /** Orden en la forma de Kekulé (1 o 2) de un enlace aromático. */
  kekule?: 1 | 2
  /** Cierre de anillo (con un número en la SMILES). */
  closure: boolean
  /** «/» (up) o «\» (down), leído de `a` hacia `b`: la geometría cis/trans de un doble enlace vecino. */
  dir?: 'up' | 'down'
}

export interface SmilesMolecule {
  /** La SMILES que se leyó (sin el título). */
  source: string
  atoms: SmilesAtom[]
  bonds: SmilesBond[]
  /** Anillos mínimos: los átomos de cada uno en orden de recorrido. */
  rings: number[][]
  /** Hidrógenos de cada átomo (implícitos o escritos). */
  hydrogens: number[]
}

/** Error al leer una SMILES: motivo con sus datos (`kind`) y el mensaje en el idioma de ChemKit. */
export class SmilesError extends Error {
  readonly kind: SmilesErrorKind

  constructor(kind: SmilesErrorKind) {
    super(smilesErrorMessage(kind))
    this.name = 'SmilesError'
    this.kind = kind
  }

  get code(): SmilesErrorKind['type'] {
    return this.kind.type
  }
}

const fail = (kind: SmilesErrorKind): never => {
  throw new SmilesError(kind)
}

/**
 * Valencias habituales del subconjunto orgánico (los demás elementos van entre corchetes). Se, Te y As solo se escriben
 * entre corchetes: están para el Kekulé de sus anillos aromáticos ([se] como [s], [as] como [p]).
 */
const VALENCE: Readonly<Record<string, readonly number[]>> = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1], Se: [2, 4, 6], Te: [2, 4, 6], As: [3, 5]
}
const AROMATIC_BRACKET = new Set(['b', 'c', 'n', 'o', 'p', 's', 'se', 'as', 'te'])
const BRACKET_ATOM = /^(\d*)([A-Z][a-z]?|[a-z][a-z]?|\*)(@{1,2}|@(?:TH|AL|SP|TB|OH)\d{1,2})?(H\d*)?([+-]+\d*)?(?::(\d+))?$/

/** La SMILES sin espacios alrededor y sin el título que puede ir detrás («CCO etanol» → «CCO»). */
export function smilesText(input: string): string {
  return input.trim().split(/\s+/)[0] ?? ''
}

// MARK: Lectura

/** Lee una molécula (subconjunto orgánico, corchetes, ramas, anillos 0-9 y %nn, enlaces - = # : / \ y partes con «.»). */
export function parseSmiles(input: string, maxAtoms = SMILES_MAX_ATOMS): SmilesMolecule {
  const src = smilesText(input)
  if (!src) fail({ type: 'empty' })
  if (src.length > SMILES_MAX_LENGTH) fail({ type: 'tooLong', limit: SMILES_MAX_LENGTH })
  const atoms: SmilesAtom[] = []
  const bonds: SmilesBond[] = []
  const branches: number[] = []
  const open = new Map<number, { atom: number; order?: BondOrder }>()
  let prev = -1
  let pending: { order: BondOrder; dir?: 'up' | 'down'; pos: number } | undefined

  const defaultOrder = (a: number, b: number): BondOrder => (atoms[a].aromatic && atoms[b].aromatic ? 1.5 : 1)
  const addBond = (a: number, b: number, order: BondOrder, closure: boolean, dir?: 'up' | 'down'): void => {
    if (bonds.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) fail({ type: 'duplicateBond', a: Math.min(a, b) + 1, b: Math.max(a, b) + 1 })
    const bond: SmilesBond = { a, b, order, closure }
    if (dir) bond.dir = dir
    bonds.push(bond)
  }
  const addAtom = (atom: SmilesAtom): void => {
    if (atoms.length >= maxAtoms) fail({ type: 'tooManyAtoms', limit: maxAtoms })
    const index = atoms.push(atom) - 1
    if (prev >= 0) addBond(prev, index, pending?.order ?? defaultOrder(prev, index), false, pending?.dir)
    else if (pending) fail({ type: 'danglingBond', pos: pending.pos })
    pending = undefined
    prev = index
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    const pos = i + 1
    if (c === '(') {
      if (prev < 0) fail({ type: 'branchWithoutAtom', pos })
      if (pending) fail({ type: 'danglingBond', pos: pending.pos })
      branches.push(prev)
      i++
    } else if (c === ')') {
      const back = branches.pop()
      if (back === undefined) return fail({ type: 'unopenedBranch', pos })
      if (pending) fail({ type: 'danglingBond', pos: pending.pos })
      prev = back
      i++
    } else if ('-=#:/\\'.includes(c)) {
      if (pending || prev < 0) fail({ type: 'danglingBond', pos })
      pending = { order: c === '=' ? 2 : c === '#' ? 3 : c === ':' ? 1.5 : 1, pos }
      if (c === '/') pending.dir = 'up'
      else if (c === '\\') pending.dir = 'down'
      i++
    } else if (c === '.') {
      if (pending) fail({ type: 'danglingBond', pos: pending.pos })
      prev = -1
      i++
    } else if (/[0-9%]/.test(c)) {
      if (prev < 0) fail({ type: 'ringWithoutAtom', pos })
      let ring: number
      if (c === '%') {
        const digits = src.slice(i + 1, i + 3)
        if (!/^\d\d$/.test(digits)) fail({ type: 'badRingNumber', pos })
        ring = Number(digits)
        i += 3
      } else {
        ring = Number(c)
        i++
      }
      const opened = open.get(ring)
      if (opened) {
        if (opened.atom === prev) fail({ type: 'ringOnItself', ring, pos })
        addBond(opened.atom, prev, pending?.order ?? opened.order ?? defaultOrder(opened.atom, prev), true)
        open.delete(ring)
      } else {
        open.set(ring, { atom: prev, order: pending?.order })
      }
      pending = undefined
    } else if (c === '[') {
      const end = src.indexOf(']', i)
      if (end < 0) return fail({ type: 'unclosedBracket', pos })
      addAtom(bracketAtom(src.slice(i + 1, end), pos))
      i = end + 1
    } else if (src.startsWith('Cl', i) || src.startsWith('Br', i)) {
      addAtom({ element: src.slice(i, i + 2), aromatic: false, bracket: false, charge: 0, pos })
      i += 2
    } else if ('BCNOPSFI*'.includes(c)) {
      // «Na», «Fe», «Si»… fuera de corchetes (sin confundir «Cn», «Sc», «Co»: un átomo y otro aromático)
      const two = src.slice(i, i + 2)
      if (/^[A-Z][a-z]$/.test(two) && !'bcnops'.includes(two[1]) && PeriodicTable.bySymbol(two)) fail({ type: 'needsBrackets', symbol: two, pos })
      addAtom({ element: c, aromatic: false, bracket: false, charge: 0, pos })
      i++
    } else if ('bcnops'.includes(c)) {
      addAtom({ element: c.toUpperCase(), aromatic: true, bracket: false, charge: 0, pos })
      i++
    } else if (c === 'H') {
      fail({ type: 'looksLikeFormula', pos })
    } else if (/[A-Z]/.test(c)) {
      // un elemento fuera del subconjunto orgánico («Na», «Fe»): va entre corchetes
      const two = src.slice(i, i + 2)
      const symbol = /^[A-Z][a-z]$/.test(two) && PeriodicTable.bySymbol(two) ? two : c
      fail(PeriodicTable.bySymbol(symbol) ? { type: 'needsBrackets', symbol, pos } : { type: 'unknownElement', symbol, pos })
    } else {
      fail({ type: 'unexpectedChar', char: c, pos })
    }
  }
  if (pending) fail({ type: 'danglingBond', pos: pending.pos })
  if (branches.length) fail({ type: 'unclosedBranch' })
  if (open.size) fail({ type: 'unclosedRing', ring: [...open.keys()][0] })
  if (!atoms.length) fail({ type: 'empty' })
  return finishMolecule(src, atoms, bonds)
}

/** Un átomo entre corchetes: [isótopo]símbolo[quiralidad][Hn][carga][:clase]. */
function bracketAtom(body: string, pos: number): SmilesAtom {
  const m = BRACKET_ATOM.exec(body)
  if (!m) return fail({ type: 'badBracketAtom', text: body, pos })
  let element = m[2]
  const aromatic = element !== '*' && element[0] === element[0].toLowerCase()
  if (aromatic) {
    if (!AROMATIC_BRACKET.has(element)) fail({ type: 'unknownElement', symbol: element, pos })
    element = element[0].toUpperCase() + element.slice(1)
  } else if (element !== '*' && !PeriodicTable.bySymbol(element)) {
    fail({ type: 'unknownElement', symbol: element, pos })
  }
  const atom: SmilesAtom = { element, aromatic, bracket: true, charge: 0, pos, hCount: m[4] ? (m[4].length > 1 ? Number(m[4].slice(1)) : 1) : 0 }
  if (m[1]) atom.isotope = Number(m[1])
  if (m[3]) atom.chirality = m[3]
  if (m[5]) {
    const sign = m[5][0] === '+' ? 1 : -1
    const digits = m[5].replace(/[+-]/g, '')
    if (digits && m[5].replace(/\d/g, '').length > 1) fail({ type: 'badBracketAtom', text: body, pos })
    atom.charge = sign * (digits ? Number(digits) : m[5].length)
  }
  if (m[6]) atom.atomClass = Number(m[6])
  if (atom.isotope === 0) delete atom.isotope
  if ((atom.hCount ?? 0) > 8 || Math.abs(atom.charge) > 8) fail({ type: 'badBracketAtom', text: body, pos })
  return atom
}

/** Anillos, enlaces aromáticos fuera de anillo, Kekulé, hidrógenos y valencias. */
function finishMolecule(source: string, atoms: SmilesAtom[], bonds: SmilesBond[]): SmilesMolecule {
  const rings = smallestRings(atoms.length, bonds)
  const inRingBond = new Set<number>()
  const inRingAtom = new Set<number>()
  for (const ring of rings) {
    ring.forEach((a, k) => {
      inRingAtom.add(a)
      const b = ring[(k + 1) % ring.length]
      const bi = bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
      if (bi >= 0) inRingBond.add(bi)
    })
  }
  // un enlace entre aromáticos que no está en un anillo es sencillo (el puente del bifenilo)
  bonds.forEach((b, i) => {
    if (b.order === 1.5 && !inRingBond.has(i)) b.order = 1
  })
  atoms.forEach((a, i) => {
    if (a.aromatic && !inRingAtom.has(i)) fail({ type: 'aromaticOutsideRing', atom: i + 1 })
  })
  kekulize(atoms, bonds)
  const hydrogens = atoms.map((_, i) => hydrogenCount(atoms, bonds, i))
  checkValences(atoms, bonds, hydrogens)
  return { source, atoms, bonds, rings, hydrogens }
}

// MARK: Hidrógenos y valencias

/** Orden efectivo de un enlace (el de Kekulé en los aromáticos). */
export const bondValence = (b: SmilesBond): number => (b.order === 1.5 ? (b.kekule ?? 1.5) : b.order)

function usedValence(bonds: readonly SmilesBond[], index: number): number {
  let used = 0
  for (const b of bonds) if (b.a === index || b.b === index) used += bondValence(b)
  return used
}

/** Hidrógenos de un átomo: los del corchete o lo que deja su valencia habitual. Adaptado de Sketchy (hydrogens). */
function hydrogenCount(atoms: readonly SmilesAtom[], bonds: readonly SmilesBond[], index: number): number {
  const atom = atoms[index]
  if (atom.bracket) return atom.hCount ?? 0
  const valences = VALENCE[atom.element]
  if (!valences) return 0
  const used = usedValence(bonds, index)
  const valence = valences.find((v) => v >= used - 0.01) ?? valences[valences.length - 1]
  return Math.max(0, Math.floor(valence - used + 0.01))
}

/** Valencia máxima con la que se comprueba un átomo (undefined = no se comprueba). */
function maxValence(atom: SmilesAtom): number | undefined {
  if (!atom.bracket) {
    const v = VALENCE[atom.element]
    return v ? v[v.length - 1] : undefined
  }
  const q = atom.charge
  switch (atom.element) {
    case 'C': return 4 - Math.abs(q)
    case 'N': return q > 0 ? 4 : q < 0 ? 2 : 5
    case 'O': return 2 + q
    case 'B': return q < 0 ? 4 : 3
    case 'H': return q === 0 ? 1 : 0
    default: return undefined
  }
}

function checkValences(atoms: readonly SmilesAtom[], bonds: readonly SmilesBond[], hydrogens: readonly number[]): void {
  atoms.forEach((atom, i) => {
    const max = maxValence(atom)
    if (max === undefined) return
    const used = usedValence(bonds, i) + (atom.bracket ? hydrogens[i] : 0)
    if (used > max + 0.01) fail({ type: 'overValence', atom: i + 1, element: atom.element === '*' ? 'R' : atom.element, bonds: Math.round(used * 10) / 10, max: Math.max(0, max) })
  })
}

// MARK: Anillos

/**
 * Anillos mínimos: para cada enlace, el camino más corto entre sus extremos sin él; de esos ciclos, los más pequeños que
 * son independientes (tantos como enlaces − átomos + partes). Así un «sobre» no se coloca antes que sus anillos pequeños.
 */
export function smallestRings(n: number, bonds: readonly SmilesBond[]): number[][] {
  const adj: { to: number; bond: number }[][] = Array.from({ length: n }, () => [])
  bonds.forEach((b, i) => {
    adj[b.a].push({ to: b.b, bond: i })
    adj[b.b].push({ to: b.a, bond: i })
  })
  const rank = bonds.length - n + components(n, bonds).length
  if (rank <= 0) return []
  const seen = new Set<string>()
  const candidates: { atoms: number[]; mask: bigint }[] = []
  bonds.forEach((e, ei) => {
    const from = new Map<number, number>([[e.a, -1]])
    const queue = [e.a]
    while (queue.length && !from.has(e.b)) {
      const u = queue.shift()!
      for (const { to, bond } of adj[u]) if (bond !== ei && !from.has(to)) (from.set(to, u), queue.push(to))
    }
    if (!from.has(e.b)) return
    const path: number[] = []
    for (let u = e.b; u !== -1; u = from.get(u)!) path.push(u)
    const key = [...path].sort((x, y) => x - y).join(',')
    if (path.length < 3 || seen.has(key)) return
    seen.add(key)
    let mask = 0n
    path.forEach((a, k) => {
      const b = path[(k + 1) % path.length]
      const bi = bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
      mask |= 1n << BigInt(bi)
    })
    candidates.push({ atoms: path.reverse(), mask })
  })
  candidates.sort((x, y) => x.atoms.length - y.atoms.length)
  // base independiente sobre GF(2) (cada ciclo como conjunto de enlaces)
  const basis = new Map<number, bigint>()
  const rings: number[][] = []
  for (const c of candidates) {
    let v = c.mask
    while (v !== 0n) {
      const top = v.toString(2).length - 1
      const b = basis.get(top)
      if (!b) break
      v ^= b
    }
    if (v === 0n) continue
    basis.set(v.toString(2).length - 1, v)
    rings.push(c.atoms)
    if (rings.length >= rank) break
  }
  return rings
}

/** Partes conectadas (cada molécula de una SMILES con «.»), en el orden de sus átomos. */
export function components(n: number, bonds: readonly { a: number; b: number }[]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const b of bonds) (adj[b.a].push(b.b), adj[b.b].push(b.a))
  const seen = new Array<boolean>(n).fill(false)
  const out: number[][] = []
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue
    const part: number[] = []
    const stack = [s]
    seen[s] = true
    while (stack.length) {
      const u = stack.pop()!
      part.push(u)
      for (const v of adj[u]) if (!seen[v]) (seen[v] = true, stack.push(v))
    }
    out.push(part.sort((x, y) => x - y))
  }
  return out
}

// MARK: Kekulé

/** Valencia que necesita un átomo aromático según su carga (C⁺ y C⁻ 3, N⁺ 4, O⁺ 3…). */
function aromaticTarget(atom: SmilesAtom): number {
  const base = (VALENCE[atom.element] ?? [4])[0]
  const q = atom.charge
  if (atom.element === 'C' || atom.element === 'B') return base - Math.abs(q) + (atom.element === 'B' && q < 0 ? 2 : 0)
  return base + q
}

/**
 * Forma de Kekulé: reparte enlaces dobles alternos en los anillos aromáticos (emparejamiento perfecto de los átomos que
 * necesitan un doble enlace). Lanza `notKekulizable` si no existe (c1cccc1, un pirrol sin [nH]).
 */
function kekulize(atoms: readonly SmilesAtom[], bonds: SmilesBond[]): void {
  const aromatic = bonds.map((b, i) => i).filter((i) => bonds[i].order === 1.5)
  if (!aromatic.length) return
  const needs = new Set<number>()
  atoms.forEach((atom, i) => {
    if (!atom.aromatic) return
    let deg = 0
    for (const b of bonds) if (b.a === i || b.b === i) deg += b.order === 1.5 ? 1 : b.order
    const h = atom.bracket ? (atom.hCount ?? 0) : 0
    if (aromaticTarget(atom) - deg - h >= 1) needs.add(i)
  })
  const options = new Map<number, number[]>()
  for (const i of needs) options.set(i, [])
  for (const bi of aromatic) {
    const { a, b } = bonds[bi]
    if (needs.has(a) && needs.has(b)) (options.get(a)!.push(bi), options.get(b)!.push(bi))
  }
  const matched = new Map<number, number>()
  let budget = 50_000
  const solve = (): boolean => {
    if (--budget < 0) return false
    let best = -1
    let bestCount = Infinity
    for (const i of needs) {
      if (matched.has(i)) continue
      const count = options.get(i)!.filter((bi) => !matched.has(other(bonds[bi], i))).length
      if (count < bestCount) (best = i, bestCount = count)
      if (count === 0) return false
    }
    if (best < 0) return true
    for (const bi of options.get(best)!) {
      const j = other(bonds[bi], best)
      if (matched.has(j)) continue
      matched.set(best, bi)
      matched.set(j, bi)
      if (solve()) return true
      matched.delete(best)
      matched.delete(j)
    }
    return false
  }
  if (needs.size % 2 === 1 || !solve()) {
    const stuck = [...needs].filter((i) => !matched.has(i))
    fail({ type: 'notKekulizable', atoms: (stuck.length ? stuck : [...needs]).map((i) => i + 1).sort((x, y) => x - y) })
  }
  const doubles = new Set(matched.values())
  for (const bi of aromatic) bonds[bi].kekule = doubles.has(bi) ? 2 : 1
}

const other = (b: SmilesBond, i: number): number => (b.a === i ? b.b : b.a)

// MARK: Composición

export interface SmilesComposition {
  composition: Composition
  charge: number
  /** Hay grupos R («*»): la fórmula es la de un fragmento. */
  generic: boolean
}

/** Átomos de cada tipo (con los hidrógenos implícitos) y carga neta; de `atoms` si se da (una especie de una reacción). */
export function smilesComposition(mol: SmilesMolecule, atoms?: readonly number[]): SmilesComposition {
  const counts = new Map<AtomKey, number>()
  const add = (k: AtomKey, n: number): void => {
    if (n > 0) counts.set(k, (counts.get(k) ?? 0) + n)
  }
  let charge = 0
  let generic = false
  for (const i of atoms ?? mol.atoms.map((_, k) => k)) {
    const a = mol.atoms[i]
    charge += a.charge
    add(AtomKey.of(1), mol.hydrogens[i])
    if (a.element === '*') {
      generic = true
      continue
    }
    const e = PeriodicTable.bySymbol(a.element)
    if (e) add(AtomKey.of(e.atomicNumber, a.isotope ?? null), 1)
  }
  return { composition: counts, charge, generic }
}

/**
 * La composición de cada sustancia de una SMILES (sin reacción): una por cada parte separada con «.» (C4H10, C4H10),
 * salvo una sal, todas las partes con carga y neutra en total ([NH4+].[Cl-]: NH4Cl), que es una sola sustancia. Sin las
 * partes que no tienen ningún átomo con fórmula (un «*» suelto).
 */
export function smilesFormulaParts(mol: SmilesMolecule): SmilesComposition[] {
  const parts = components(mol.atoms.length, mol.bonds).map((atoms) => smilesComposition(mol, atoms))
  const salt = parts.every((p) => p.charge !== 0) && parts.reduce((q, p) => q + p.charge, 0) === 0
  return (parts.length > 1 && !salt ? parts : [smilesComposition(mol)]).filter((p) => p.composition.size > 0)
}

/** Número de átomos que no son hidrógeno. */
export const heavyAtomCount = (mol: SmilesMolecule): number => mol.atoms.filter((a) => a.element !== 'H').length

// MARK: Fórmula desarrollada

/** Átomos pesados como máximo para la fórmula desarrollada (con todos los H dibujados). */
export const EXPANDED_MAX_HEAVY = 15

/**
 * La misma molécula con los hidrógenos implícitos como átomos (al final: los números de los átomos de la SMILES no
 * cambian). La usa la fórmula desarrollada, donde se dibuja cada enlace C–H.
 */
export function withExplicitHydrogens(mol: SmilesMolecule): SmilesMolecule {
  const atoms = mol.atoms.map((a) => ({ ...a }))
  const bonds = mol.bonds.map((b) => ({ ...b }))
  const hydrogens = [...mol.hydrogens]
  mol.atoms.forEach((a, i) => {
    for (let k = 0; k < mol.hydrogens[i]; k++) {
      const h = atoms.push({ element: 'H', aromatic: false, bracket: false, charge: 0, pos: a.pos, added: true }) - 1
      bonds.push({ a: i, b: h, order: 1, closure: false })
      hydrogens.push(0)
    }
    hydrogens[i] = 0
  })
  return { source: mol.source, atoms, bonds, rings: mol.rings.map((r) => [...r]), hydrogens }
}

// MARK: Reacciones

export type ReactionSide = 'reactant' | 'agent' | 'product'

export interface SmilesSpecies {
  side: ReactionSide
  /** Átomos de esta especie en la molécula conjunta. */
  atoms: number[]
}

/** Una molécula sola o una reacción: en la reacción, todos los átomos van numerados seguidos (reactivos, agentes, productos). */
export interface ParsedStructure {
  molecule: SmilesMolecule
  /** Solo en las reacciones: cada especie con su lado. */
  species?: SmilesSpecies[]
}

/** ¿Es una reacción (lleva «>»)? */
export const isReactionSmiles = (input: string): boolean => smilesText(input).includes('>')

/** Lee una molécula o una reacción «reactivos>agentes>productos» («A.B>>C.D»). */
export function parseStructure(input: string): ParsedStructure {
  const src = smilesText(input)
  if (!src.includes('>')) return { molecule: parseSmiles(src) }
  if (src.length > SMILES_MAX_LENGTH) fail({ type: 'tooLong', limit: SMILES_MAX_LENGTH })
  const parts = src.split('>')
  if (parts.length !== 3) fail({ type: 'reactionArrows' })
  if (!parts[0]) fail({ type: 'reactionSide', side: 'reactants' })
  if (!parts[2]) fail({ type: 'reactionSide', side: 'products' })
  const sides: ReactionSide[] = ['reactant', 'agent', 'product']
  const atoms: SmilesAtom[] = []
  const bonds: SmilesBond[] = []
  const rings: number[][] = []
  const hydrogens: number[] = []
  const species: SmilesSpecies[] = []
  let offset = 0
  parts.forEach((part, k) => {
    if (part) {
      const mol = parseShifted(part, offset)
      const base = atoms.length
      for (const a of mol.atoms) atoms.push({ ...a, pos: a.pos + offset })
      for (const b of mol.bonds) bonds.push({ ...b, a: b.a + base, b: b.b + base })
      for (const r of mol.rings) rings.push(r.map((x) => x + base))
      hydrogens.push(...mol.hydrogens)
      for (const c of components(mol.atoms.length, mol.bonds)) species.push({ side: sides[k], atoms: c.map((x) => x + base) })
    }
    offset += part.length + 1
  })
  if (atoms.length > SMILES_MAX_ATOMS * 2) fail({ type: 'tooManyAtoms', limit: SMILES_MAX_ATOMS * 2 })
  return { molecule: { source: src, atoms, bonds, rings, hydrogens }, species }
}

/** Lee una parte de una reacción y, si falla, da la posición dentro de la reacción entera. */
function parseShifted(part: string, offset: number): SmilesMolecule {
  try {
    return parseSmiles(part)
  } catch (e) {
    if (e instanceof SmilesError && 'pos' in e.kind) throw new SmilesError({ ...e.kind, pos: e.kind.pos + offset } as SmilesErrorKind)
    throw e
  }
}
