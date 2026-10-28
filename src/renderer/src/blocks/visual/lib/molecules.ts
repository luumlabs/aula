// Moléculas en 3D para el visor (port de StudyEngine/Content/Molecules.swift): una pequeña biblioteca de moléculas de clase
// con geometrías reales y, para fórmulas con un átomo central (CH4, NH3, H2O, SF6, XeF4, SO4^2-…), la geometría de la teoría
// VSEPR con sus pares libres. Lógica pura (la usan el visor y las pruebas).
import type { Atom3D, Bond3D, Model3DBlock } from '@shared/schema/visual'

export type Vec3 = [number, number, number]

/** Nombre de la geometría (clave de i18n `visual:model.geometry.<clave>`). */
export type GeometryKey =
  | 'linear' | 'trigonalPlanar' | 'bent' | 'tetrahedral' | 'trigonalPyramidal' | 'trigonalBipyramidal' | 'seesaw' | 'tShaped'
  | 'octahedral' | 'squarePyramidal' | 'squarePlanar' | 'cubicLattice' | 'bccLattice' | 'fccLattice' | 'diamondLattice'

export interface Molecule {
  atoms: Atom3D[]
  bonds: Bond3D[]
  /** Direcciones (unitarias × 0,75) de los pares libres del átomo central. */
  lonePairs: Vec3[]
  /** Átomo central si se construyó por VSEPR. */
  central?: number
  /** Notación AXnEm. */
  vsepr?: string
  geometry?: GeometryKey
  name?: string
}

const SYMBOLS = new Set(
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ')
)

const GROUP: Record<string, number> = {
  H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, Ga: 3, C: 4, Si: 4, Ge: 4, Sn: 4, Pb: 4,
  N: 5, P: 5, As: 5, Sb: 5, O: 6, S: 6, Se: 6, Te: 6, F: 7, Cl: 7, Br: 7, I: 7, He: 8, Ne: 8, Ar: 8, Kr: 8, Xe: 8, Rn: 8
}
const EN: Record<string, number> = {
  H: 2.2, Li: 0.98, Be: 1.57, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58,
  Cl: 3.16, K: 0.82, Ca: 1.0, Ge: 2.01, As: 2.18, Se: 2.55, Br: 2.96, Kr: 3.0, Sn: 1.96, Sb: 2.05, Te: 2.1, I: 2.66, Xe: 2.6
}
const COVALENT: Record<string, number> = {
  H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21,
  Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Fe: 1.32, Cu: 1.32, Zn: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2,
  Kr: 1.16, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.4
}
const VDW: Record<string, number> = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, Na: 2.27, K: 2.75, B: 1.92, Si: 2.1, Xe: 2.16 }

export const covalentRadius = (el: string): number => COVALENT[el] ?? 1.2
export const vdwRadius = (el: string): number => VDW[el] ?? 1.8
export const elementSymbol = (raw: string): string => raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase()

// MARK: Fórmulas

export interface ParsedFormula { counts: Record<string, number>; order: string[]; charge: number }
export const formulaKey = (f: ParsedFormula): string =>
  Object.keys(f.counts).sort().map((k) => `${k}${f.counts[k]}`).join('') + (f.charge === 0 ? '' : `q${f.charge}`)

/** Fórmula sencilla: símbolos con su número, paréntesis con multiplicador y carga («^2-», «2-», «+»). */
export function parseFormula(s: string): ParsedFormula | undefined {
  let text = s.replace(/[ ·]/g, '')
  let charge = 0
  const m = /\^?\{?(\d*)([+\-−])\}?$/.exec(text)
  if (m) {
    const sign = m[2] === '+' ? 1 : -1
    if (m[0].startsWith('^') || m[0].startsWith('{')) {
      const q = m[1] === '' ? 1 : Number(m[1])
      // una carga absurda («^9999999999-») no tiene sentido químico
      if (!Number.isInteger(q) || q > 20) return undefined
      charge = sign * q
      text = text.slice(0, m.index)
    } else {
      // sin «^» las cifras son el subíndice («NO3-» = NO₃⁻): la carga es ±1
      charge = sign
      text = text.slice(0, -1)
    }
  }
  const order: string[] = []
  const stack: Array<Record<string, number>> = [{}]
  const chars = Array.from(text)
  let i = 0
  const digits = (): string => { let j = i; while (j < chars.length && /\d/.test(chars[j])) j++; const d = chars.slice(i, j).join(''); i = j; return d }
  while (i < chars.length) {
    const c = chars[i]
    if (c === '(' || c === '[') { stack.push({}); i++; continue }
    if (c === ')' || c === ']') {
      i++
      const d = digits()
      const mult = d ? Number(d) : 1
      if (stack.length <= 1 || !(mult > 0) || mult >= 1000) return undefined
      const inner = stack.pop()!
      const top = stack[stack.length - 1]
      for (const [k, v] of Object.entries(inner)) {
        const sum = (top[k] ?? 0) + v * mult
        if (sum > 100_000) return undefined
        top[k] = sum
      }
      continue
    }
    if (!/[A-Z]/.test(c)) return undefined
    let sym = c
    i++
    if (i < chars.length && /[a-z]/.test(chars[i])) { sym += chars[i]; i++ }
    if (!SYMBOLS.has(sym)) return undefined
    const d = digits()
    const n = d ? Number(d) : 1
    if (!(n > 0) || n >= 1000) return undefined
    const top = stack[stack.length - 1]
    top[sym] = (top[sym] ?? 0) + n
    if (top[sym] > 100_000) return undefined
    if (!order.includes(sym)) order.push(sym)
  }
  if (stack.length !== 1) return undefined
  const counts = stack[0]
  const total = Object.values(counts).reduce((s, v) => s + v, 0)
  if (!Object.keys(counts).length || total > 400) return undefined
  return { counts, order, charge }
}

// MARK: VSEPR

const GEOMETRY: Record<string, GeometryKey> = {
  '2,0': 'linear', '3,0': 'trigonalPlanar', '2,1': 'bent', '2,2': 'bent', '4,0': 'tetrahedral', '3,1': 'trigonalPyramidal',
  '5,0': 'trigonalBipyramidal', '4,1': 'seesaw', '3,2': 'tShaped', '2,3': 'linear', '6,0': 'octahedral', '5,1': 'squarePyramidal', '4,2': 'squarePlanar'
}

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : v }
const deg = Math.PI / 180
const polar = (theta: number, phi: number): Vec3 => [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]

/** Direcciones de los dominios (ligandos primero, pares libres después) para x ligandos y e pares libres. */
export function vseprDirections(x: number, e: number): { ligands: Vec3[]; lone: Vec3[] } | undefined {
  const d = rawDirections(x, e)
  if (!d) return undefined
  // el eje de los pares libres (o el axial) hacia arriba, para que la molécula se vea de frente con la cámara del visor
  const k = `${x},${e}`
  if (x === 1 || ['3,1', '5,0', '4,1', '3,2', '2,3', '5,1', '4,2'].includes(k)) return { ligands: d.ligands.map(zUp), lone: d.lone.map(zUp) }
  return d
}

/** Giro que lleva el eje z al eje y (rotación propia: conserva los ángulos). */
const zUp = (v: Vec3): Vec3 => [v[0], v[2], -v[1]]

function rawDirections(x: number, e: number): { ligands: Vec3[]; lone: Vec3[] } | undefined {
  if (x === 1) return { ligands: [[1, 0, 0]], lone: Array.from({ length: e }, (_, i) => polar(110 * deg, (i * 2 * Math.PI) / Math.max(1, e))) }
  const k = `${x},${e}`
  switch (k) {
    case '2,0': return { ligands: [[1, 0, 0], [-1, 0, 0]], lone: [] }
    case '3,0': return { ligands: [0, 1, 2].map((i) => polar(90 * deg, i * 120 * deg)), lone: [] }
    case '2,1': { const h = (117 / 2) * deg; return { ligands: [[Math.sin(h), -Math.cos(h), 0], [-Math.sin(h), -Math.cos(h), 0]], lone: [[0, 1, 0]] } }
    case '4,0': return { ligands: ([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as Vec3[]).map(norm), lone: [] }
    case '3,1': { const th = Math.acos(0.372); return { ligands: [0, 1, 2].map((i) => polar(Math.PI - th, i * 120 * deg)), lone: [[0, 0, 1]] } } // H–N–H ≈ 107°
    case '2,2': {
      const h = (104.5 / 2) * deg, l = (114 / 2) * deg // H–O–H ≈ 104,5°
      // la V de los enlaces en el plano de la pantalla (abierta hacia abajo); los pares libres arriba, uno delante y otro detrás
      return { ligands: [[Math.sin(h), -Math.cos(h), 0], [-Math.sin(h), -Math.cos(h), 0]], lone: [[0, Math.cos(l), Math.sin(l)], [0, Math.cos(l), -Math.sin(l)]] }
    }
    case '5,0': case '4,1': case '3,2': case '2,3': {
      // bipirámide: axiales ±z, ecuatoriales en el plano xy; los pares libres van a las ecuatoriales
      const eq = [0, 1, 2].map((i) => polar(90 * deg, i * 120 * deg))
      const ax: Vec3[] = [[0, 0, 1], [0, 0, -1]]
      return { ligands: [...ax.slice(0, Math.min(2, x)), ...eq.slice(e).slice(0, Math.max(0, x - 2))], lone: eq.slice(0, e) }
    }
    case '6,0': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], lone: [] }
    case '5,1': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]], lone: [[0, 0, 1]] }
    case '4,2': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], lone: [[0, 0, 1], [0, 0, -1]] }
    default: return undefined
  }
}

/** Geometría VSEPR para una fórmula con un átomo central y ligandos terminales. */
export function vsepr(f: ParsedFormula): Molecule | undefined {
  // central: aparece una vez, no es H ni F; se prefiere el de más capacidad de enlace (C/Si > N/P > O/S > halógenos) y menos electronegativo
  const rank = (el: string): [number, number] => { const g = GROUP[el] ?? 4; return [g === 7 ? 3 : g === 6 ? 2 : g === 5 ? 1 : 0, EN[el] ?? 2] }
  const singles = Object.keys(f.counts).filter((k) => f.counts[k] === 1 && k !== 'H' && k !== 'F')
  singles.sort((a, b) => { const ra = rank(a), rb = rank(b); return ra[0] - rb[0] || ra[1] - rb[1] })
  const central = singles[0]
  if (!central) return undefined
  const v = GROUP[central]
  if (v === undefined) return undefined
  const ligands: string[] = []
  for (const el of f.order) if (el !== central) for (let k = 0; k < (f.counts[el] ?? 0); k++) ligands.push(el)
  if (ligands.length < 1 || ligands.length > 6) return undefined
  // los ligandos deben ser terminales: H, halógenos, O, S, N
  if (!ligands.every((el) => ['H', 'F', 'Cl', 'Br', 'I', 'O', 'S', 'Se', 'N'].includes(el))) return undefined
  const available = v - f.charge
  const orders = ligands.map(() => 1)
  let used = ligands.length
  if (available < used) return undefined
  // dobles a O/S y triples a N terminal mientras quedan electrones del central
  ligands.forEach((el, i) => { if (['O', 'S', 'Se'].includes(el) && used + 1 <= available) { orders[i] = 2; used++ } })
  ligands.forEach((el, i) => { if (el === 'N') while (orders[i] < 3 && used + 1 <= available) { orders[i]++; used++ } })
  const lone = Math.ceil((available - used) / 2)
  const dirs = vseprDirections(ligands.length, lone)
  if (!dirs) return undefined
  const atoms: Atom3D[] = [{ element: central, x: 0, y: 0, z: 0 }]
  const bonds: Bond3D[] = []
  ligands.forEach((el, i) => {
    const len = (covalentRadius(central) + covalentRadius(el)) * (orders[i] >= 3 ? 0.78 : orders[i] >= 2 ? 0.87 : 1)
    const d = dirs.ligands[i]
    atoms.push({ element: el, x: d[0] * len, y: d[1] * len, z: d[2] * len })
    bonds.push({ a: 0, b: i + 1, order: orders[i] })
  })
  const x = ligands.length
  return {
    atoms, bonds, central: 0, lonePairs: dirs.lone.map((d) => [d[0] * 0.75, d[1] * 0.75, d[2] * 0.75] as Vec3),
    vsepr: `AX${x}${lone > 1 ? `E${lone}` : lone === 1 ? 'E' : ''}`, geometry: GEOMETRY[`${x},${lone}`]
  }
}

export function diatomic(a: string, b: string): Molecule {
  const key = [a, b].sort().join('-')
  const order = ({ 'N-N': 3, 'C-O': 3, 'O-O': 2, 'N-O': 2.5 } as Record<string, number>)[key] ?? 1
  const len = (covalentRadius(a) + covalentRadius(b)) * (order >= 3 ? 0.78 : order >= 2 ? 0.87 : 1)
  return { atoms: [{ element: a, x: -len / 2, y: 0, z: 0 }, { element: b, x: len / 2, y: 0, z: 0 }], bonds: [{ a: 0, b: 1, order }], lonePairs: [], geometry: 'linear' }
}

// MARK: Biblioteca (geometrías reales de moléculas de clase)

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
const len2 = (v: Vec3): number => v[0] * v[0] + v[1] * v[1] + v[2] * v[2]

/** Posición de un átomo nuevo enlazado a `c` con distancia, ángulo (b–c–nuevo) y diedro (a–b–c–nuevo), en grados. */
export function place(a: Vec3, b: Vec3, c: Vec3, bond: number, angle: number, torsion: number): Vec3 {
  const ang = angle * deg, tor = torsion * deg
  const bc = norm(sub(c, b))
  let n = cross(sub(b, a), bc)
  if (len2(n) < 1e-12) { n = cross([0, 0, 1], bc); if (len2(n) < 1e-12) n = [0, 1, 0] }
  n = norm(n)
  const m = cross(n, bc)
  const d2: Vec3 = [-bond * Math.cos(ang), bond * Math.sin(ang) * Math.cos(tor), bond * Math.sin(ang) * Math.sin(tor)]
  return [0, 1, 2].map((k) => c[k] + d2[0] * bc[k] + d2[1] * m[k] + d2[2] * n[k]) as Vec3
}

/** Matriz Z: (elemento, enlazado a, distancia, ángulo con, ángulo, diedro con, diedro). */
type Z = [string, number, number, number, number, number, number]

function zmatrix(rows: Z[], bonds: Array<[number, number, number]>, name: string): Molecule {
  const pos: Vec3[] = []
  rows.forEach((r, i) => {
    if (i === 0) pos.push([0, 0, 0])
    else if (i === 1) pos.push([r[2], 0, 0])
    else if (i === 2) {
      const b = pos[r[1]], a = pos[r[3]], ang = r[4] * deg
      // en el plano xy, formando `ang` con a–b
      const dir = norm(sub(a, b))
      const x = dir[0] * Math.cos(ang) - dir[1] * Math.sin(ang), y = dir[0] * Math.sin(ang) + dir[1] * Math.cos(ang)
      pos.push([b[0] + r[2] * x, b[1] + r[2] * y, b[2]])
    } else pos.push(place(pos[r[5]], pos[r[3]], pos[r[1]], r[2], r[4], r[6]))
  })
  const n = Math.max(1, pos.length)
  const cx = pos.reduce((s, p) => s + p[0], 0) / n, cy = pos.reduce((s, p) => s + p[1], 0) / n, cz = pos.reduce((s, p) => s + p[2], 0) / n
  return {
    atoms: rows.map((r, i) => ({ element: r[0], x: pos[i][0] - cx, y: pos[i][1] - cy, z: pos[i][2] - cz })),
    bonds: bonds.map(([a, b, order]) => ({ a, b, order })), lonePairs: [], name
  }
}

const NAMES: Record<string, string> = {
  agua: 'H2O', water: 'H2O', metano: 'CH4', methane: 'CH4', amoniaco: 'NH3', ammonia: 'NH3', 'dioxido de carbono': 'CO2', 'carbon dioxide': 'CO2',
  etano: 'C2H6', ethane: 'C2H6', eteno: 'C2H4', etileno: 'C2H4', ethene: 'C2H4', ethylene: 'C2H4', etino: 'C2H2', acetileno: 'C2H2', ethyne: 'C2H2', acetylene: 'C2H2',
  metanol: 'CH3OH', methanol: 'CH3OH', etanol: 'C2H5OH', ethanol: 'C2H5OH', benceno: 'C6H6', benzene: 'C6H6', 'acido acetico': 'CH3COOH', 'acetic acid': 'CH3COOH',
  formaldehido: 'CH2O', metanal: 'CH2O', formaldehyde: 'CH2O', 'peroxido de hidrogeno': 'H2O2', 'agua oxigenada': 'H2O2', 'hydrogen peroxide': 'H2O2',
  ozono: 'O3', ozone: 'O3', 'cloruro de sodio': 'NaCl', 'sodium chloride': 'NaCl', 'sal comun': 'NaCl', 'table salt': 'NaCl'
}

/** Redes cristalinas por nombre (una celda unidad, con los enlaces entre vecinos más próximos). */
const LATTICES: Record<string, () => Molecule> = {
  bcc: () => lattice('bcc', 'Fe', 'Fe', 2.87), 'cubica centrada en el cuerpo': () => lattice('bcc', 'Fe', 'Fe', 2.87), 'body-centered cubic': () => lattice('bcc', 'Fe', 'Fe', 2.87),
  hierro: () => lattice('bcc', 'Fe', 'Fe', 2.87), iron: () => lattice('bcc', 'Fe', 'Fe', 2.87),
  fcc: () => lattice('fcc', 'Cu', 'Cu', 3.61), 'cubica centrada en las caras': () => lattice('fcc', 'Cu', 'Cu', 3.61), 'face-centered cubic': () => lattice('fcc', 'Cu', 'Cu', 3.61),
  cobre: () => lattice('fcc', 'Cu', 'Cu', 3.61), copper: () => lattice('fcc', 'Cu', 'Cu', 3.61),
  cscl: () => lattice('bcc', 'Cl', 'Cs', 4.12), 'cloruro de cesio': () => lattice('bcc', 'Cl', 'Cs', 4.12), 'cesium chloride': () => lattice('bcc', 'Cl', 'Cs', 4.12),
  diamante: () => lattice('diamond', 'C', 'C', 3.57), diamond: () => lattice('diamond', 'C', 'C', 3.57)
}

/** Celda unidad: esquinas (`corner`), y el centro (bcc), los centros de las caras (fcc) o además cuatro huecos tetraédricos (diamante). */
export function lattice(kind: 'bcc' | 'fcc' | 'diamond', corner: string, inner: string, a: number): Molecule {
  const frac: Array<[number, number, number, string]> = []
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) frac.push([x, y, z, corner])
  if (kind === 'bcc') frac.push([0.5, 0.5, 0.5, inner])
  if (kind === 'fcc' || kind === 'diamond') for (const [x, y, z] of [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]]) frac.push([x, y, z, kind === 'fcc' ? inner : corner])
  if (kind === 'diamond') for (const [x, y, z] of [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]]) frac.push([x, y, z, inner])
  const atoms: Atom3D[] = frac.map(([x, y, z, el]) => ({ element: el, x: (x - 0.5) * a, y: (y - 0.5) * a, z: (z - 0.5) * a }))
  const nn = kind === 'bcc' ? (a * Math.sqrt(3)) / 2 : kind === 'fcc' ? a / Math.SQRT2 : (a * Math.sqrt(3)) / 4
  const bonds: Bond3D[] = []
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z)
    if (Math.abs(d - nn) < 0.02) bonds.push({ a: i, b: j, order: 1 })
  }
  return { atoms, bonds, lonePairs: [], geometry: kind === 'bcc' ? 'bccLattice' : kind === 'fcc' ? 'fccLattice' : 'diamondLattice' }
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

function libraryByName(raw: string): Molecule | undefined {
  const lat = LATTICES[fold(raw)]
  if (lat) return { ...lat(), name: raw }
  const f = NAMES[fold(raw)]
  if (!f) return undefined
  const p = parseFormula(f)
  const m = (p && libraryByComposition(formulaKey(p))) ?? buildMolecule(f)
  return m ? { ...m, name: raw } : undefined
}

function libraryByComposition(key: string): Molecule | undefined {
  switch (key) {
    case 'C2H6':
      return zmatrix([['C', 0, 0, 0, 0, 0, 0], ['C', 0, 1.535, 0, 0, 0, 0], ['H', 0, 1.094, 1, 111.2, 0, 0], ['H', 0, 1.094, 1, 111.2, 2, 120], ['H', 0, 1.094, 1, 111.2, 2, -120],
        ['H', 1, 1.094, 0, 111.2, 2, 180], ['H', 1, 1.094, 0, 111.2, 2, 60], ['H', 1, 1.094, 0, 111.2, 2, -60]],
      [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [1, 7, 1]], 'C2H6')
    case 'C2H4':
      return zmatrix([['C', 0, 0, 0, 0, 0, 0], ['C', 0, 1.339, 0, 0, 0, 0], ['H', 0, 1.086, 1, 121.3, 0, 0], ['H', 0, 1.086, 1, 121.3, 2, 180],
        ['H', 1, 1.086, 0, 121.3, 2, 0], ['H', 1, 1.086, 0, 121.3, 2, 180]],
      [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]], 'C2H4')
    case 'C2H2':
      return {
        atoms: [{ element: 'H', x: -1.664, y: 0, z: 0 }, { element: 'C', x: -0.602, y: 0, z: 0 }, { element: 'C', x: 0.602, y: 0, z: 0 }, { element: 'H', x: 1.664, y: 0, z: 0 }],
        bonds: [{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 3 }, { a: 2, b: 3, order: 1 }], lonePairs: [], geometry: 'linear', name: 'C2H2'
      }
    case 'C6H6': {
      const atoms: Atom3D[] = [], bonds: Bond3D[] = []
      for (let k = 0; k < 6; k++) atoms.push({ element: 'C', x: 1.397 * Math.cos((k * Math.PI) / 3), y: 1.397 * Math.sin((k * Math.PI) / 3), z: 0 })
      for (let k = 0; k < 6; k++) atoms.push({ element: 'H', x: 2.481 * Math.cos((k * Math.PI) / 3), y: 2.481 * Math.sin((k * Math.PI) / 3), z: 0 })
      for (let k = 0; k < 6; k++) { bonds.push({ a: k, b: (k + 1) % 6, order: 1.5 }); bonds.push({ a: k, b: k + 6, order: 1 }) }
      return { atoms, bonds, lonePairs: [], name: 'C6H6' }
    }
    case 'C1H4O1':
      return zmatrix([['C', 0, 0, 0, 0, 0, 0], ['O', 0, 1.427, 0, 0, 0, 0], ['H', 1, 0.956, 0, 108.9, 0, 0], ['H', 0, 1.093, 1, 109.5, 2, 180], ['H', 0, 1.093, 1, 109.5, 2, 60], ['H', 0, 1.093, 1, 109.5, 2, -60]],
        [[0, 1, 1], [1, 2, 1], [0, 3, 1], [0, 4, 1], [0, 5, 1]], 'CH3OH')
    case 'C2H6O1':
      return zmatrix([['C', 0, 0, 0, 0, 0, 0], ['C', 0, 1.512, 0, 0, 0, 0], ['O', 1, 1.43, 0, 107.8, 0, 0], ['H', 2, 0.96, 1, 108.5, 0, 180],
        ['H', 1, 1.09, 0, 110.5, 2, 120], ['H', 1, 1.09, 0, 110.5, 2, -120], ['H', 0, 1.09, 1, 110.5, 2, 180], ['H', 0, 1.09, 1, 110.5, 2, 60], ['H', 0, 1.09, 1, 110.5, 2, -60]],
      [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1], [1, 5, 1], [0, 6, 1], [0, 7, 1], [0, 8, 1]], 'C2H5OH')
    case 'C2H4O2':
      return zmatrix([['C', 0, 0, 0, 0, 0, 0], ['C', 0, 1.52, 0, 0, 0, 0], ['O', 1, 1.21, 0, 125, 0, 0], ['O', 1, 1.36, 0, 112, 2, 180], ['H', 3, 0.97, 1, 107, 2, 0],
        ['H', 0, 1.09, 1, 109.5, 2, 0], ['H', 0, 1.09, 1, 109.5, 2, 120], ['H', 0, 1.09, 1, 109.5, 2, -120]],
      [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [0, 5, 1], [0, 6, 1], [0, 7, 1]], 'CH3COOH')
    case 'H2O2':
      return zmatrix([['O', 0, 0, 0, 0, 0, 0], ['O', 0, 1.475, 0, 0, 0, 0], ['H', 0, 0.95, 1, 94.8, 0, 0], ['H', 1, 0.95, 0, 94.8, 2, 111.5]], [[0, 1, 1], [0, 2, 1], [1, 3, 1]], 'H2O2')
    case 'O3': {
      const m = zmatrix([['O', 0, 0, 0, 0, 0, 0], ['O', 0, 1.278, 0, 0, 0, 0], ['O', 1, 1.278, 0, 116.8, 0, 0]], [[0, 1, 1.5], [1, 2, 1.5]], 'O3')
      return { ...m, geometry: 'bent', vsepr: 'AX2E' }
    }
    case 'Cl1Na1': {
      // red cristalina de tipo NaCl: 3 × 3 × 3 iones
      const atoms: Atom3D[] = [], bonds: Bond3D[] = []
      const a = 2.82
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
        const even = (i + j + k) % 2 === 0
        atoms.push({ element: even ? 'Na' : 'Cl', x: (i - 1) * a, y: (j - 1) * a, z: (k - 1) * a, charge: even ? 1 : -1 })
      }
      for (let p = 0; p < atoms.length; p++) for (let q = p + 1; q < atoms.length; q++) {
        const d = Math.hypot(atoms[p].x - atoms[q].x, atoms[p].y - atoms[q].y, atoms[p].z - atoms[q].z)
        if (Math.abs(d - a) < 0.01) bonds.push({ a: p, b: q, order: 1 })
      }
      return { atoms, bonds, lonePairs: [], geometry: 'cubicLattice', name: 'NaCl' }
    }
    default: return undefined
  }
}

/** Construye una molécula a partir de una fórmula («CH4», «SO4^2-», «C2H5OH») o un nombre («agua», «benzene»). */
export function buildMolecule(raw: string): Molecule | undefined {
  const text = raw.trim()
  if (!text || text.length >= 80) return undefined
  const named = libraryByName(text)
  if (named) return named
  const f = parseFormula(text)
  if (!f) return undefined
  const lib = libraryByComposition(formulaKey(f))
  if (lib) return lib
  const els = Object.keys(f.counts)
  if (els.length === 1 && f.counts[els[0]] === 2 && f.charge === 0) return diatomic(els[0], els[0])
  const total = Object.values(f.counts).reduce((s, v) => s + v, 0)
  if (total === 2 && els.length === 2 && f.charge === 0) return diatomic(f.order[0], f.order[1])
  return vsepr(f)
}

/** Enlaces deducidos por distancia (si se dan átomos sin enlaces). */
export function bondsByDistance(atoms: Atom3D[]): Bond3D[] {
  if (atoms.length > 600) return []
  const out: Bond3D[] = []
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j]
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const lim = 1.2 * (covalentRadius(elementSymbol(a.element)) + covalentRadius(elementSymbol(b.element)))
    if (d > 0.4 && d <= lim) out.push({ a: i, b: j, order: 1 })
  }
  return out
}

/** Molécula efectiva de un bloque: átomos escritos (con enlaces deducidos si faltan) o la de la fórmula. */
export function moleculeFor(b: Pick<Model3DBlock, 'atoms' | 'bonds' | 'formula' | 'lonePairs'>): Molecule | undefined {
  if (b.atoms.length) {
    const atoms = b.atoms.map((a) => ({ ...a, x: safe(a.x), y: safe(a.y), z: safe(a.z) }))
    const bonds = b.bonds.length ? b.bonds.filter((x) => x.a >= 0 && x.b >= 0 && x.a < atoms.length && x.b < atoms.length && x.a !== x.b) : bondsByDistance(atoms)
    const m: Molecule = { atoms, bonds, lonePairs: [], name: b.formula }
    // pares libres pedidos con átomos escritos: los de la fórmula, si coincide el número de átomos
    const built = b.formula ? buildMolecule(b.formula) : undefined
    if (built && built.atoms.length === atoms.length) {
      m.geometry = built.geometry
      m.vsepr = built.vsepr
      if (b.lonePairs) { m.lonePairs = built.lonePairs; m.central = built.central }
    }
    return m
  }
  return b.formula ? buildMolecule(b.formula) : undefined
}

/** Números seguros para la escena (NaN o gigantes de un archivo dañado no deben llegar a la geometría). */
export const safe = (v: number, lo = -1000, hi = 1000, fallback = 0): number => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback)

export interface BondAngle { center: number; a: number; b: number; degrees: number }

/** Ángulo (grados) entre dos enlaces que salen del mismo átomo. */
export function angleAt(m: Molecule, center: number, a: number, b: number): number {
  const c = m.atoms[center], p = m.atoms[a], q = m.atoms[b]
  const u: Vec3 = [p.x - c.x, p.y - c.y, p.z - c.z], v: Vec3 = [q.x - c.x, q.y - c.y, q.z - c.z]
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.sqrt(len2(u) * len2(v)) || 1)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

/**
 * Los ángulos de enlace que vale la pena enseñar: en el átomo central (o en los átomos no hidrógeno con dos o más enlaces),
 * uno por cada valor distinto (redondeado a medio grado), como mucho `max`.
 */
export function keyBondAngles(m: Molecule, max = 3): BondAngle[] {
  if (m.atoms.length > 40 || m.geometry?.endsWith('Lattice')) return []
  const neighbors = new Map<number, number[]>()
  for (const b of m.bonds) {
    neighbors.set(b.a, [...(neighbors.get(b.a) ?? []), b.b])
    neighbors.set(b.b, [...(neighbors.get(b.b) ?? []), b.a])
  }
  const centers = m.central !== undefined ? [m.central] : m.atoms.map((_, i) => i).filter((i) => elementSymbol(m.atoms[i].element) !== 'H' && (neighbors.get(i)?.length ?? 0) >= 2)
  const out: BondAngle[] = []
  const seen = new Set<string>()
  for (const c of centers) {
    const ns = neighbors.get(c) ?? []
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const d = angleAt(m, c, ns[i], ns[j])
      // 180° (lineal opuesto en un octaedro, p. ej.) solo si es lo único que hay
      const key = `${elementSymbol(m.atoms[c].element)}:${Math.round(d * 2) / 2}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ center: c, a: ns[i], b: ns[j], degrees: d })
    }
  }
  const nonLinear = out.filter((x) => x.degrees < 179)
  return (nonLinear.length ? nonLinear : out).slice(0, max)
}
