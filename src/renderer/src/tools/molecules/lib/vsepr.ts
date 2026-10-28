// Moléculas (puro): geometría VSEPR de una fórmula ABₙ (átomo central, pares solitarios, forma, ángulos, hibridación y
// polaridad), coordenadas 3D para dibujarla y una pequeña biblioteca de moléculas habituales (también con varios
// centros: etano, eteno, benceno, metanol…). El motor de química no trae geometría 3D: esto lo completa.
import { parseFormula } from '@engine/chem/parser'
import { PeriodicTable } from '@engine/chem/elements'

export type Vec = [number, number, number]

export interface Atom {
  el: string
  p: Vec
}

export interface Bond {
  a: number
  b: number
  order: 1 | 2 | 3
}

export type ShapeKey =
  | 'linear' | 'trigonalPlanar' | 'bent' | 'tetrahedral' | 'trigonalPyramidal' | 'trigonalBipyramidal' | 'seesaw'
  | 'tShaped' | 'octahedral' | 'squarePyramidal' | 'squarePlanar' | 'diatomic' | 'multi'

export interface Molecule {
  id: string
  formula: string
  atoms: Atom[]
  bonds: Bond[]
  /** Pares solitarios del átomo central: dirección unitaria. */
  lone: Vec[]
  shape: ShapeKey
  /** Notación AXₙEₘ (`null` en moléculas con varios centros). */
  axe: { n: number; m: number } | null
  /** Ángulos de enlace a mostrar (en grados), del más importante al menos. */
  angles: number[]
  /** Ángulos medidos o predichos más pequeños que el ideal por los pares solitarios. */
  compressed: boolean
  hybrid: string | null
  polar: boolean
}

// MARK: Vectores

const norm = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const scale = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k, v[2] * k]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

/** Ángulo (grados) entre dos vectores. */
export function angleBetween(a: Vec, b: Vec): number {
  const na = norm(a)
  const nb = norm(b)
  return deg(Math.acos(Math.max(-1, Math.min(1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]))))
}

// MARK: Geometrías ideales

/** Direcciones de los dominios electrónicos (los primeros `m` son los pares solitarios en las posiciones correctas). */
export function domainDirections(steric: number, m: number): { ligands: Vec[]; lone: Vec[] } {
  const t = 1 / Math.sqrt(3)
  let all: Vec[]
  let loneIdx: number[]
  switch (steric) {
    case 2:
      all = [[1, 0, 0], [-1, 0, 0]]
      loneIdx = [0, 1].slice(0, m)
      break
    case 3:
      all = [0, 120, 240].map((a) => [Math.cos(rad(a + 90)), Math.sin(rad(a + 90)), 0] as Vec)
      loneIdx = [0, 1, 2].slice(0, m)
      break
    case 4:
      all = ([[t, t, t], [t, -t, -t], [-t, t, -t], [-t, -t, t]] as Vec[]).map(norm)
      loneIdx = [0, 1, 2, 3].slice(0, m)
      break
    case 5:
      // ecuatoriales (0–2) en el plano xz, axiales (3–4) en y; los pares solitarios van a las ecuatoriales
      all = [...[0, 120, 240].map((a) => [Math.cos(rad(a)), 0, Math.sin(rad(a))] as Vec), [0, 1, 0], [0, -1, 0]]
      loneIdx = [0, 1, 2, 3, 4].slice(0, m)
      break
    case 6:
      // los pares solitarios, opuestos (trans): ±y
      all = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
      loneIdx = [0, 1, 2, 3, 4, 5].slice(0, m)
      break
    default:
      all = [[1, 0, 0]]
      loneIdx = []
  }
  return { lone: loneIdx.map((i) => all[i]), ligands: all.filter((_, i) => !loneIdx.includes(i)) }
}

const SHAPES: Record<string, ShapeKey> = {
  '2,0': 'linear', '3,0': 'trigonalPlanar', '2,1': 'bent', '4,0': 'tetrahedral', '3,1': 'trigonalPyramidal', '2,2': 'bent',
  '5,0': 'trigonalBipyramidal', '4,1': 'seesaw', '3,2': 'tShaped', '2,3': 'linear', '6,0': 'octahedral', '5,1': 'squarePyramidal', '4,2': 'squarePlanar'
}

const IDEAL_ANGLES: Record<ShapeKey, number[]> = {
  linear: [180], trigonalPlanar: [120], bent: [109.5], tetrahedral: [109.5], trigonalPyramidal: [109.5], trigonalBipyramidal: [90, 120],
  seesaw: [90, 120], tShaped: [90], octahedral: [90], squarePyramidal: [90], squarePlanar: [90], diatomic: [], multi: []
}

const HYBRID: Record<number, string> = { 2: 'sp', 3: 'sp²', 4: 'sp³', 5: 'sp³d', 6: 'sp³d²' }

/** Ángulos reales conocidos (medidos) de moléculas frecuentes. */
const MEASURED: Record<string, number[]> = {
  H2O: [104.5], NH3: [107.8], H2S: [92.1], PH3: [93.5], SO2: [119], O3: [116.8], SF4: [101.6, 173.1], ClF3: [87.5], BrF5: [84.8], 'H3O+': [113], NF3: [102.2], OF2: [103.1], SCl2: [103], NCl3: [107.1], H2Se: [91]
}

// MARK: Datos de los elementos

/** Electrones de valencia de los grupos principales (1, 2, 13–18). */
export function valence(symbol: string): number | null {
  const e = PeriodicTable.bySymbol(symbol)
  if (!e || e.group === null) return null
  if (e.atomicNumber === 2) return 2
  if (e.group <= 2) return e.group
  if (e.group >= 13) return e.group - 10
  return null
}

/** Radio covalente aproximado (Å) para la longitud de los enlaces. */
const COV: Record<string, number> = { H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.2, I: 1.39, Xe: 1.4, Be: 0.96, Kr: 1.16, Se: 1.2, As: 1.19, Al: 1.21, Te: 1.38, Sb: 1.39, Ge: 1.2, Ga: 1.22, Sn: 1.39, N2: 0.71 }
export const covalentA = (el: string): number => COV[el] ?? 1.1

/** Radio de van der Waals (Å) para el modelo compacto. */
const VDW: Record<string, number> = { H: 1.2, B: 1.92, C: 1.7, N: 1.55, O: 1.52, F: 1.47, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, Xe: 2.16, Be: 1.53, Kr: 2.02, Se: 1.9, As: 1.85, Al: 1.84 }
export const vdwA = (el: string): number => VDW[el] ?? 1.9

// MARK: VSEPR de una fórmula

export type VseprResult = { ok: true; molecule: Molecule } | { ok: false; reason: 'parse' | 'notABn' | 'transition' | 'electrons' | 'tooMany' }

/**
 * Molécula ABₙ (o ion) a partir de su fórmula: el átomo central es el que aparece una vez (sin contar H) y, si hay
 * varios, el menos electronegativo. Pares solitarios por recuento de electrones de valencia (octeto en los ligandos).
 */
export function vseprFromFormula(text: string): VseprResult {
  let f
  try {
    f = parseFormula(text)
  } catch {
    return { ok: false, reason: 'parse' }
  }
  const counts = [...f.composition.entries()].map(([k, n]) => ({ el: k.element.symbol, n }))
  const total = counts.reduce((a, c) => a + c.n, 0)
  if (total === 2) {
    // diatómica
    const els = counts.flatMap((c) => Array<string>(c.n).fill(c.el))
    return { ok: true, molecule: diatomic(text, els[0], els[1]) }
  }
  // O₃, I₃⁻: un solo elemento, el central es uno de ellos
  const candidates = counts.length === 1 ? counts : counts.filter((c) => c.n === 1 && c.el !== 'H')
  if (!candidates.length) return { ok: false, reason: 'notABn' }
  const en = (s: string) => PeriodicTable.bySymbol(s)?.electronegativity ?? 4
  const center = candidates.sort((a, b) => en(a.el) - en(b.el))[0].el
  const ligands = counts.flatMap((c) => Array<string>(c.el === center ? c.n - 1 : c.n).fill(c.el))
  if (ligands.length < 2) return { ok: false, reason: 'notABn' }
  if (ligands.length > 6) return { ok: false, reason: 'tooMany' }
  const vc = valence(center)
  if (vc === null || ligands.some((l) => valence(l) === null)) return { ok: false, reason: 'transition' }
  const V = vc + ligands.reduce((a, l) => a + (valence(l) ?? 0), 0) - f.charge
  const onLigands = ligands.reduce((a, l) => a + (l === 'H' ? 2 : 8), 0)
  const m = (V - onLigands) / 2
  if (!Number.isInteger(m) || m < 0 || ligands.length + m > 6) return { ok: false, reason: 'electrons' }
  return { ok: true, molecule: buildABn(text, center, ligands, m) }
}

function diatomic(formula: string, a: string, b: string): Molecule {
  const d = (covalentA(a) + covalentA(b)) * 0.95
  const order: 1 | 2 | 3 = a === b && a === 'N' ? 3 : a === b && a === 'O' ? 2 : (a === 'C' && b === 'O') || (a === 'O' && b === 'C') ? 3 : 1
  return {
    id: formula,
    formula,
    atoms: [{ el: a, p: [-d / 2, 0, 0] }, { el: b, p: [d / 2, 0, 0] }],
    bonds: [{ a: 0, b: 1, order }],
    lone: [],
    shape: 'diatomic',
    axe: null,
    angles: [],
    compressed: false,
    hybrid: null,
    polar: a !== b
  }
}

/** Construye la molécula ABₙEₘ con los ángulos reales si se conocen (los pares solitarios cierran el ángulo). */
export function buildABn(formula: string, center: string, ligands: string[], m: number): Molecule {
  const n = ligands.length
  const steric = n + m
  const shape = SHAPES[`${n},${m}`] ?? (n === 2 ? 'linear' : 'tetrahedral')
  const { ligands: dirs0, lone } = domainDirections(steric, m)
  const key = formula.replace(/\s+/g, '')
  const measured = MEASURED[key]
  let dirs = dirs0
  // con pares solitarios, ajusta las direcciones al ángulo medido (o a uno algo menor que el ideal)
  if (m > 0 && (steric === 4 || steric === 3) && n >= 2) {
    const target = measured?.[0] ?? (steric === 4 ? (m === 1 ? 107 : 104.5) : 117)
    dirs = squeeze(dirs0, lone, target)
  }
  const atoms: Atom[] = [{ el: center, p: [0, 0, 0] }]
  ligands.forEach((l, i) => atoms.push({ el: l, p: scale(dirs[i], (covalentA(center) + covalentA(l)) * 0.97) }))
  const bonds: Bond[] = ligands.map((_, i) => ({ a: 0, b: i + 1, order: 1 }))
  assignMultipleBonds(center, ligands, m, bonds)
  const sameLigands = new Set(ligands).size === 1
  const symmetric = ['linear', 'trigonalPlanar', 'tetrahedral', 'trigonalBipyramidal', 'octahedral', 'squarePlanar'].includes(shape)
  const angles = measured ?? (shape === 'bent' && steric === 3 ? [120] : IDEAL_ANGLES[shape])
  return {
    id: key,
    formula,
    atoms,
    bonds,
    lone,
    shape,
    axe: { n, m },
    angles,
    compressed: m > 0 && shape !== 'linear' && shape !== 'squarePlanar',
    hybrid: HYBRID[steric] ?? null,
    polar: !(symmetric && sameLigands)
  }
}

/**
 * Cierra el ángulo entre ligandos hasta `target` grados manteniendo su simetría alrededor del eje opuesto a los pares
 * solitarios (H₂O 104,5°, NH₃ 107,8°).
 */
function squeeze(dirs: Vec[], lone: Vec[], target: number): Vec[] {
  // eje: opuesto a la media de los pares solitarios
  const axis = norm(scale(lone.reduce((a, b) => add(a, b), [0, 0, 0] as Vec), -1))
  const n = dirs.length
  // ángulo θ entre cada ligando y el eje que da el ángulo pedido entre ligandos
  let theta: number
  if (n === 2) theta = rad(target / 2)
  else {
    // n = 3: cos α = (3cos²θ − 1)/2 → cos²θ = (2cos α + 1)/3
    const c2 = (2 * Math.cos(rad(target)) + 1) / 3
    theta = Math.acos(Math.sqrt(Math.max(0, c2)))
  }
  return dirs.map((d) => {
    // componente perpendicular al eje
    const dot = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
    const perp = norm([d[0] - dot * axis[0], d[1] - dot * axis[1], d[2] - dot * axis[2]])
    return norm(add(scale(axis, Math.cos(theta)), scale(perp, Math.sin(theta))))
  })
}

/** Enlaces múltiples para dejar la carga formal del átomo central lo más cerca de cero (octeto en el periodo 2). */
function assignMultipleBonds(center: string, ligands: string[], m: number, bonds: Bond[]): void {
  const vc = valence(center) ?? 0
  const period = PeriodicTable.bySymbol(center)?.period ?? 2
  const fc = () => vc - 2 * m - bonds.reduce((a, b) => a + b.order, 0)
  const electrons = () => 2 * m + 2 * bonds.reduce((a, b) => a + b.order, 0)
  for (let guard = 0; guard < 12 && fc() > 0; guard++) {
    const i = bonds.findIndex((b, k) => {
      const l = ligands[k]
      if (l === 'H' || ['F', 'Cl', 'Br', 'I'].includes(l) || b.order >= 3) return false
      const vl = valence(l) ?? 0
      const fcl = vl - (8 - 2 * b.order) - b.order
      return fcl < 0
    })
    if (i < 0) break
    if (period === 2 && electrons() + 2 > 8) break
    bonds[i].order = (bonds[i].order + 1) as 1 | 2 | 3
  }
}

// MARK: Biblioteca

/** Moléculas con varios centros (coordenadas en Å, geometría experimental aproximada). */
function multi(id: string, atoms: Atom[], bonds: [number, number, 1 | 2 | 3][], angles: number[], polar: boolean): Molecule {
  return { id, formula: id, atoms, bonds: bonds.map(([a, b, order]) => ({ a, b, order })), lone: [], shape: 'multi', axe: null, angles, compressed: false, hybrid: null, polar }
}

function ethane(): Molecule {
  const atoms: Atom[] = [{ el: 'C', p: [-0.765, 0, 0] }, { el: 'C', p: [0.765, 0, 0] }]
  const th = rad(180 - 109.47)
  const bonds: [number, number, 1][] = [[0, 1, 1]]
  for (const [ci, sign, off] of [[1, 1, 0], [0, -1, 60]] as const) {
    for (const phi of [0, 120, 240]) {
      const p: Vec = [sign * Math.cos(th) * 1.09, Math.sin(th) * Math.cos(rad(phi + off)) * 1.09, Math.sin(th) * Math.sin(rad(phi + off)) * 1.09]
      atoms.push({ el: 'H', p: add(atoms[ci].p, p) })
      bonds.push([ci, atoms.length - 1, 1])
    }
  }
  return multi('C2H6', atoms, bonds, [109.5], false)
}

function benzene(): Molecule {
  const atoms: Atom[] = []
  const bonds: [number, number, 1 | 2][] = []
  for (let i = 0; i < 6; i++) atoms.push({ el: 'C', p: [1.39 * Math.cos(rad(60 * i)), 1.39 * Math.sin(rad(60 * i)), 0] })
  for (let i = 0; i < 6; i++) atoms.push({ el: 'H', p: [2.48 * Math.cos(rad(60 * i)), 2.48 * Math.sin(rad(60 * i)), 0] })
  for (let i = 0; i < 6; i++) {
    bonds.push([i, (i + 1) % 6, i % 2 === 0 ? 2 : 1])
    bonds.push([i, i + 6, 1])
  }
  return multi('C6H6', atoms, bonds, [120], false)
}

function methanol(): Molecule {
  const atoms: Atom[] = [{ el: 'C', p: [-0.71, 0, 0] }, { el: 'O', p: [0.72, 0, 0] }]
  const th = rad(180 - 109.47)
  const bonds: [number, number, 1][] = [[0, 1, 1]]
  for (const phi of [60, 180, 300]) {
    atoms.push({ el: 'H', p: add(atoms[0].p, [-Math.cos(th) * 1.09, Math.sin(th) * Math.cos(rad(phi)) * 1.09, Math.sin(th) * Math.sin(rad(phi)) * 1.09]) })
    bonds.push([0, atoms.length - 1, 1])
  }
  atoms.push({ el: 'H', p: add(atoms[1].p, [Math.cos(rad(180 - 108.5)) * 0.96, Math.sin(rad(180 - 108.5)) * 0.96, 0]) })
  bonds.push([1, atoms.length - 1, 1])
  return multi('CH3OH', atoms, bonds, [108.5, 109.5], true)
}

function ethene(): Molecule {
  const h = (x: number, y: number): Vec => [x, y, 0]
  const atoms: Atom[] = [{ el: 'C', p: [-0.665, 0, 0] }, { el: 'C', p: [0.665, 0, 0] }, { el: 'H', p: h(1.233, 0.927) }, { el: 'H', p: h(1.233, -0.927) }, { el: 'H', p: h(-1.233, 0.927) }, { el: 'H', p: h(-1.233, -0.927) }]
  return multi('C2H4', atoms, [[0, 1, 2], [1, 2, 1], [1, 3, 1], [0, 4, 1], [0, 5, 1]], [121.3, 117.4], false)
}

function ethyne(): Molecule {
  const atoms: Atom[] = [{ el: 'H', p: [-1.66, 0, 0] }, { el: 'C', p: [-0.6, 0, 0] }, { el: 'C', p: [0.6, 0, 0] }, { el: 'H', p: [1.66, 0, 0] }]
  return multi('C2H2', atoms, [[0, 1, 1], [1, 2, 3], [2, 3, 1]], [180], false)
}

function peroxide(): Molecule {
  // ángulo O–O–H de 94,8° y diedro de 111,5°
  const a = rad(94.8)
  const tw = rad(111.5)
  const atoms: Atom[] = [{ el: 'O', p: [-0.74, 0, 0] }, { el: 'O', p: [0.74, 0, 0] }]
  atoms.push({ el: 'H', p: add(atoms[0].p, scale([-Math.cos(a), Math.sin(a), 0], 0.97)) })
  atoms.push({ el: 'H', p: add(atoms[1].p, scale([Math.cos(a), Math.sin(a) * Math.cos(tw), Math.sin(a) * Math.sin(tw)], 0.97)) })
  return multi('H2O2', atoms, [[0, 1, 1], [0, 2, 1], [1, 3, 1]], [94.8], true)
}

/** Moléculas de la biblioteca, por grupos (el primer grupo es el de las formas VSEPR). */
export const LIBRARY: { group: 'vsepr' | 'organic' | 'ions'; formulas: string[] }[] = [
  { group: 'vsepr', formulas: ['H2O', 'CO2', 'NH3', 'CH4', 'BF3', 'BeCl2', 'SO2', 'O3', 'PCl5', 'SF4', 'ClF3', 'XeF2', 'SF6', 'BrF5', 'XeF4', 'H2S', 'CCl4', 'HCN', 'CH2O', 'SO3'] },
  { group: 'organic', formulas: ['C2H6', 'C2H4', 'C2H2', 'C6H6', 'CH3OH', 'H2O2'] },
  { group: 'ions', formulas: ['NH4+', 'H3O+', 'NO3-', 'CO3^2-', 'SO4^2-', 'I3-'] }
]

const BUILT: Record<string, () => Molecule> = { C2H6: ethane, C2H4: ethene, C2H2: ethyne, C6H6: benzene, CH3OH: methanol, H2O2: peroxide }

/** Molécula por fórmula: de la biblioteca o, si es ABₙ, por VSEPR. */
export function moleculeFor(formula: string): VseprResult {
  const key = formula.replace(/\s+/g, '')
  const b = BUILT[key]
  if (b) return { ok: true, molecule: b() }
  return vseprFromFormula(key)
}

/** Ángulo medido en las coordenadas entre los dos primeros ligandos del átomo central (para comprobar). */
export function measuredAngle(m: Molecule): number | null {
  if (m.atoms.length < 3 || m.shape === 'multi' || m.shape === 'diatomic') return null
  return angleBetween(m.atoms[1].p, m.atoms[2].p)
}
