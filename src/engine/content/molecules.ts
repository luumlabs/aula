// Moléculas en 3D para el visor `model3d` (port de StudyEngine/Content/Molecules.swift): una pequeña biblioteca de moléculas
// de clase (con geometrías reales) y, para fórmulas con un átomo central (CH4, NH3, H2O, SF6, XeF4, SO4^2-…), la geometría de
// la teoría VSEPR con sus pares libres. Lógica pura: la usan el visor, el validador y las pruebas.
import { foldDiacritics } from '@engine/base/ids'
import type { Atom3D, Bond3D, Model3DBlock } from '@shared/schema'
import type { GradeLang } from '@engine/grading'
import { L } from '@engine/grading/messages'

export interface Molecule {
  atoms: Atom3D[]
  bonds: Bond3D[]
  /** Posiciones de los pares libres del átomo central (para dibujarlos). */
  lonePairs: number[][]
  /** Átomo central (índice) si se construyó por VSEPR. */
  central?: number
  /** Notación AXnEm y nombre de la geometría («tetraédrica»). */
  vsepr?: string
  geometry?: string
  name?: string
}

interface ParsedFormula { counts: Record<string, number>; order: string[]; charge: number }
const formulaKey = (f: ParsedFormula): string => Object.keys(f.counts).sort().map((k) => `${k}${f.counts[k]}`).join('') + (f.charge === 0 ? '' : `q${f.charge}`)

/** Símbolos de los 118 elementos. */
export const ELEMENT_SYMBOLS: ReadonlySet<string> = new Set(`H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe
Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og`.split(/[ \n]+/))

const GROUP: Record<string, number> = {
  H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, Ga: 3, C: 4, Si: 4, Ge: 4, Sn: 4, Pb: 4,
  N: 5, P: 5, As: 5, Sb: 5, O: 6, S: 6, Se: 6, Te: 6, F: 7, Cl: 7, Br: 7, I: 7, He: 8, Ne: 8, Ar: 8, Kr: 8, Xe: 8, Rn: 8
}
const EN: Record<string, number> = {
  H: 2.2, Li: 0.98, Be: 1.57, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98, Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.9, P: 2.19, S: 2.58,
  Cl: 3.16, K: 0.82, Ca: 1.0, Ge: 2.01, As: 2.18, Se: 2.55, Br: 2.96, Kr: 3.0, Sn: 1.96, Sb: 2.05, Te: 2.1, I: 2.66, Xe: 2.6
}
const RADIUS: Record<string, number> = {
  H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21,
  Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Fe: 1.32, Cu: 1.32, Zn: 1.22, Ge: 1.2, As: 1.19, Se: 1.2, Br: 1.2,
  Kr: 1.16, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.4
}

export const covalentRadius = (el: string): number => RADIUS[el] ?? 1.2
const atom = (element: string, x: number, y: number, z: number, charge?: number): Atom3D => (charge === undefined ? { element, x, y, z } : { element, x, y, z, charge })
const bond = (a: number, b: number, order = 1): Bond3D => ({ a, b, order })
const norm = (v: number[]): number[] => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? v.map((x) => x / l) : v }

/** Fórmula sencilla: símbolos con su número, paréntesis con multiplicador y carga («^2-», «2-», «+»). */
export function parseFormula(s: string): ParsedFormula | undefined {
  let text = s.replace(/ /g, '').replace(/·/g, '')
  let charge = 0
  const m = /\^?\{?(\d*)([+\-−])\}?$/.exec(text)
  if (m) {
    const sign = m[2] === '+' ? 1 : -1
    if (m[0].startsWith('^') || m[0].startsWith('{')) {
      // una carga absurda («^9999999999-») desbordaba al contar electrones
      const q = m[1] === '' ? 1 : Number(m[1])
      if (!Number.isFinite(q) || q > 20) return undefined
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
  const isDigit = (c: string | undefined): boolean => c !== undefined && /[0-9]/.test(c)
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    if (c === '(' || c === '[') { stack.push({}); i += 1; continue }
    if (c === ')' || c === ']') {
      i += 1
      let j = i
      while (j < chars.length && isDigit(chars[j])) j += 1
      const mult = j > i ? Number(chars.slice(i, j).join('')) : 1
      i = j
      // multiplicadores y recuentos acotados: «(H2)5000000000000000000» desbordaba
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
    i += 1
    if (i < chars.length && /[a-z]/.test(chars[i])) { sym += chars[i]; i += 1 }
    if (!ELEMENT_SYMBOLS.has(sym)) return undefined
    let j = i
    while (j < chars.length && isDigit(chars[j])) j += 1
    const n = j > i ? Number(chars.slice(i, j).join('')) : 1
    i = j
    if (!(n > 0) || n >= 1000) return undefined
    const top = stack[stack.length - 1]
    const sum = (top[sym] ?? 0) + n
    if (sum > 100_000) return undefined
    top[sym] = sum
    if (!order.includes(sym)) order.push(sym)
  }
  if (stack.length !== 1) return undefined
  const counts = stack[0]
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (!Object.keys(counts).length || total > 400) return undefined
  return { counts, order, charge }
}

/** Nombre de la geometría molecular para AXnEm. */
export function geometryName(x: number, e: number, lang?: GradeLang): string | undefined {
  const k = `${x},${e}`
  const names: Record<string, [string, string]> = {
    '2,0': ['lineal', 'linear'], '3,0': ['trigonal plana', 'trigonal planar'], '2,1': ['angular', 'bent'], '2,2': ['angular', 'bent'],
    '4,0': ['tetraédrica', 'tetrahedral'], '3,1': ['piramidal trigonal', 'trigonal pyramidal'], '5,0': ['bipirámide trigonal', 'trigonal bipyramidal'],
    '4,1': ['balancín', 'seesaw'], '3,2': ['en forma de T', 'T-shaped'], '2,3': ['lineal', 'linear'], '6,0': ['octaédrica', 'octahedral'],
    '5,1': ['piramidal cuadrada', 'square pyramidal'], '4,2': ['plana cuadrada', 'square planar']
  }
  const n = names[k]
  return n ? L(lang, n[0], n[1]) : undefined
}

/** Direcciones de los dominios (ligandos primero, pares libres después). */
function directions(x: number, e: number): { ligands: number[][]; lone: number[][] } | undefined {
  const deg = Math.PI / 180
  const polar = (theta: number, phi: number): number[] => [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]
  if (x === 1) return { ligands: [[1, 0, 0]], lone: Array.from({ length: e }, (_, i) => polar(110 * deg, (i * 2 * Math.PI) / Math.max(1, e))) }
  const k = `${x},${e}`
  switch (k) {
    case '2,0': return { ligands: [[1, 0, 0], [-1, 0, 0]], lone: [] }
    case '3,0': return { ligands: [0, 1, 2].map((i) => polar(90 * deg, i * 120 * deg)), lone: [] }
    case '2,1': { const h = (117 / 2) * deg; return { ligands: [[Math.sin(h), -Math.cos(h), 0], [-Math.sin(h), -Math.cos(h), 0]], lone: [[0, 1, 0]] } }
    case '4,0': return { ligands: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(norm), lone: [] }
    case '3,1': { const th = Math.acos(0.372); return { ligands: [0, 1, 2].map((i) => polar(Math.PI - th, i * 120 * deg)), lone: [[0, 0, 1]] } }
    case '2,2': {
      const h = (104.5 / 2) * deg, l = (114 / 2) * deg
      return { ligands: [[Math.sin(h), 0, -Math.cos(h)], [-Math.sin(h), 0, -Math.cos(h)]], lone: [[0, Math.sin(l), Math.cos(l)], [0, -Math.sin(l), Math.cos(l)]] }
    }
    case '5,0': case '4,1': case '3,2': case '2,3': {
      // bipirámide: axiales ±z, ecuatoriales en el plano xy; los pares libres van a las ecuatoriales
      const eq = [0, 1, 2].map((i) => polar(90 * deg, i * 120 * deg))
      const ax = [[0, 0, 1], [0, 0, -1]]
      return { ligands: [...ax.slice(0, Math.min(2, x)), ...eq.slice(e).slice(0, Math.max(0, x - 2))], lone: eq.slice(0, e) }
    }
    case '6,0': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], lone: [] }
    case '5,1': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]], lone: [[0, 0, 1]] }
    case '4,2': return { ligands: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], lone: [[0, 0, 1], [0, 0, -1]] }
    default: return undefined
  }
}

const TERMINAL = new Set(['H', 'F', 'Cl', 'Br', 'I', 'O', 'S', 'Se', 'N'])

/** Geometría VSEPR para una fórmula con un átomo central y ligandos terminales. */
function vsepr(f: ParsedFormula, lang?: GradeLang): Molecule | undefined {
  // central: aparece una vez, no es H ni F; se prefiere el de más capacidad de enlace y menor electronegatividad
  const singles = Object.entries(f.counts).filter(([k, v]) => v === 1 && k !== 'H' && k !== 'F').map(([k]) => k)
  const rank = (el: string): [number, number] => { const g = GROUP[el] ?? 4; return [g === 7 ? 3 : g === 6 ? 2 : g === 5 ? 1 : 0, EN[el] ?? 2.0] }
  const sorted = [...singles].sort((a, b) => { const ra = rank(a), rb = rank(b); return ra[0] - rb[0] || ra[1] - rb[1] })
  const central = sorted[0]
  if (central === undefined) return undefined
  const v = GROUP[central]
  if (v === undefined) return undefined
  const ligands: string[] = []
  for (const el of f.order) if (el !== central) for (let k = 0; k < (f.counts[el] ?? 0); k++) ligands.push(el)
  if ((f.counts[central] ?? 0) > 1) return undefined
  if (ligands.length < 1 || ligands.length > 6) return undefined
  // los ligandos deben ser terminales
  if (!ligands.every((l) => TERMINAL.has(l))) return undefined
  const available = v - f.charge
  const orders = ligands.map(() => 1)
  let used = ligands.length
  if (available < used) return undefined
  // dobles a O/S y triples a N terminal mientras quedan electrones del central
  ligands.forEach((el, i) => { if ((el === 'O' || el === 'S' || el === 'Se') && used + 1 <= available) { orders[i] = 2; used += 1 } })
  ligands.forEach((el, i) => { if (el === 'N') while (orders[i] < 3 && used + 1 <= available) { orders[i] += 1; used += 1 } })
  const rest = available - used
  const lone = Math.ceil(rest / 2)
  const dirs = directions(ligands.length, lone)
  if (!dirs) return undefined
  const atoms: Atom3D[] = [atom(central, 0, 0, 0)]
  const bonds: Bond3D[] = []
  ligands.forEach((el, i) => {
    const base = covalentRadius(central) + covalentRadius(el)
    const len = base * (orders[i] >= 3 ? 0.78 : orders[i] >= 2 ? 0.87 : 1)
    const d = dirs.ligands[i]
    atoms.push(atom(el, d[0] * len, d[1] * len, d[2] * len))
    bonds.push(bond(0, i + 1, orders[i]))
  })
  const out: Molecule = {
    atoms, bonds, lonePairs: dirs.lone.map((d) => d.map((x) => x * 0.75)), central: 0,
    vsepr: `AX${ligands.length}` + (lone > 1 ? `E${lone}` : lone === 1 ? 'E' : '')
  }
  const g = geometryName(ligands.length, lone, lang)
  if (g) out.geometry = g
  return out
}

function diatomic(a: string, b: string, lang?: GradeLang): Molecule {
  const key = [a, b].sort().join('-')
  const order = ({ 'N-N': 3, 'C-O': 3, 'O-O': 2, 'N-O': 2.5 } as Record<string, number>)[key] ?? 1
  const len = (covalentRadius(a) + covalentRadius(b)) * (order >= 3 ? 0.78 : order >= 2 ? 0.87 : 1)
  return { atoms: [atom(a, -len / 2, 0, 0), atom(b, len / 2, 0, 0)], bonds: [bond(0, 1, order)], lonePairs: [], geometry: L(lang, 'lineal', 'linear') }
}

// MARK: Biblioteca (geometrías reales)

const sub = (p: number[], q: number[]): number[] => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const cross = (p: number[], q: number[]): number[] => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]

/** Posición de un átomo enlazado a `c` con distancia, ángulo (b–c–nuevo) y diedro (a–b–c–nuevo), en grados. */
function place(a: number[], b: number[], c: number[], bondLen: number, angle: number, torsion: number): number[] {
  const ang = (angle * Math.PI) / 180, tor = (torsion * Math.PI) / 180
  const bc = norm(sub(c, b))
  let n = cross(sub(b, a), bc)
  if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-12) { n = cross([0, 0, 1], bc); if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-12) n = [0, 1, 0] }
  n = norm(n)
  const m = cross(n, bc)
  const d2 = [-bondLen * Math.cos(ang), bondLen * Math.sin(ang) * Math.cos(tor), bondLen * Math.sin(ang) * Math.sin(tor)]
  return [0, 1, 2].map((k) => c[k] + d2[0] * bc[k] + d2[1] * m[k] + d2[2] * n[k])
}

/** Matriz Z: (elemento, enlazado a, distancia, ángulo con, ángulo, diedro con, diedro). */
type Z = [string, number, number, number, number, number, number]
function zmatrix(rows: Z[], bonds: Array<[number, number, number]>, name: string): Molecule {
  const pos: number[][] = []
  rows.forEach((r, i) => {
    if (i === 0) pos.push([0, 0, 0])
    else if (i === 1) pos.push([r[2], 0, 0])
    else if (i === 2) {
      const b = pos[r[1]], a = pos[r[3]]
      const ang = (r[4] * Math.PI) / 180
      const dir = norm(sub(a, b))
      const x = dir[0] * Math.cos(ang) - dir[1] * Math.sin(ang), y = dir[0] * Math.sin(ang) + dir[1] * Math.cos(ang)
      pos.push([b[0] + r[2] * x, b[1] + r[2] * y, b[2]])
    } else pos.push(place(pos[r[5]], pos[r[3]], pos[r[1]], r[2], r[4], r[6]))
  })
  const n = Math.max(1, pos.length)
  const c = [0, 1, 2].map((k) => pos.reduce((s, p) => s + p[k], 0) / n)
  return { atoms: rows.map((r, i) => atom(r[0], pos[i][0] - c[0], pos[i][1] - c[1], pos[i][2] - c[2])), bonds: bonds.map(([a, b, o]) => bond(a, b, o)), lonePairs: [], name }
}

const LIBRARY_NAMES: Record<string, string> = {
  agua: 'H2O', water: 'H2O', metano: 'CH4', methane: 'CH4', amoniaco: 'NH3', ammonia: 'NH3', 'dioxido de carbono': 'CO2', 'carbon dioxide': 'CO2',
  etano: 'C2H6', ethane: 'C2H6', eteno: 'C2H4', etileno: 'C2H4', ethene: 'C2H4', ethylene: 'C2H4', etino: 'C2H2', acetileno: 'C2H2', ethyne: 'C2H2', acetylene: 'C2H2',
  metanol: 'CH3OH', methanol: 'CH3OH', etanol: 'C2H5OH', ethanol: 'C2H5OH', benceno: 'C6H6', benzene: 'C6H6', 'acido acetico': 'CH3COOH', 'acetic acid': 'CH3COOH',
  formaldehido: 'CH2O', metanal: 'CH2O', formaldehyde: 'CH2O', 'peroxido de hidrogeno': 'H2O2', 'agua oxigenada': 'H2O2', 'hydrogen peroxide': 'H2O2',
  ozono: 'O3', ozone: 'O3', 'cloruro de sodio': 'NaCl', 'sodium chloride': 'NaCl', 'sal comun': 'NaCl', 'table salt': 'NaCl'
}

function libraryNamed(raw: string, lang?: GradeLang): Molecule | undefined {
  const t = foldDiacritics(raw.toLowerCase()).trim()
  const f = LIBRARY_NAMES[t]
  const p = f ? parseFormula(f) : undefined
  if (!f || !p) return undefined
  const m = libraryComposition(formulaKey(p), lang) ?? buildMolecule(f, lang)
  return m ? { ...m, name: raw } : undefined
}

function libraryComposition(key: string, lang?: GradeLang): Molecule | undefined {
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
      return { atoms: [atom('H', -1.664, 0, 0), atom('C', -0.602, 0, 0), atom('C', 0.602, 0, 0), atom('H', 1.664, 0, 0)], bonds: [bond(0, 1), bond(1, 2, 3), bond(2, 3)], lonePairs: [], geometry: L(lang, 'lineal', 'linear'), name: 'C2H2' }
    case 'C6H6': {
      const atoms: Atom3D[] = [], bonds: Bond3D[] = []
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; atoms.push(atom('C', 1.397 * Math.cos(a), 1.397 * Math.sin(a), 0)) }
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; atoms.push(atom('H', 2.481 * Math.cos(a), 2.481 * Math.sin(a), 0)) }
      for (let k = 0; k < 6; k++) { bonds.push(bond(k, (k + 1) % 6, 1.5)); bonds.push(bond(k, k + 6)) }
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
      return { ...m, geometry: L(lang, 'angular', 'bent'), vsepr: 'AX2E' }
    }
    case 'Cl1Na1': {
      // red cristalina de tipo NaCl: 3 × 3 × 3 iones
      const atoms: Atom3D[] = [], bonds: Bond3D[] = []
      const a = 2.82
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
        const na = (i + j + k) % 2 === 0
        atoms.push(atom(na ? 'Na' : 'Cl', (i - 1) * a, (j - 1) * a, (k - 1) * a, na ? 1 : -1))
      }
      for (let p = 0; p < atoms.length; p++) for (let q = p + 1; q < atoms.length; q++) {
        const d = Math.hypot(atoms[p].x - atoms[q].x, atoms[p].y - atoms[q].y, atoms[p].z - atoms[q].z)
        if (Math.abs(d - a) < 0.01) bonds.push(bond(p, q, 1))
      }
      return { atoms, bonds, lonePairs: [], geometry: L(lang, 'red cúbica', 'cubic lattice'), name: 'NaCl' }
    }
    default: return undefined
  }
}

/** Construye una molécula a partir de una fórmula («CH4», «SO4^2-», «C2H5OH») o un nombre («agua», «benzene»). */
export function buildMolecule(raw: string, lang?: GradeLang): Molecule | undefined {
  const text = raw.trim()
  if (!text || Array.from(text).length >= 80) return undefined
  const named = libraryNamed(text, lang)
  if (named) return named
  const f = parseFormula(text)
  if (!f) return undefined
  const lib = libraryComposition(formulaKey(f), lang)
  if (lib) return lib
  const entries = Object.entries(f.counts)
  if (entries.length === 1 && entries[0][1] === 2 && f.charge === 0) return diatomic(entries[0][0], entries[0][0], lang)
  if (entries.reduce((s, [, v]) => s + v, 0) === 2 && entries.length === 2 && f.charge === 0) return diatomic(f.order[0], f.order[1], lang)
  return vsepr(f, lang)
}

/** Enlaces deducidos por distancia (si la IA da átomos sin enlaces). */
export function bondsByDistance(atoms: readonly Atom3D[]): Bond3D[] {
  if (atoms.length > 600) return []
  const out: Bond3D[] = []
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j]
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const lim = 1.2 * (covalentRadius(a.element) + covalentRadius(b.element))
    if (d > 0.4 && d <= lim) out.push(bond(i, j))
  }
  return out
}

/** Molécula efectiva de un bloque: átomos escritos (con enlaces deducidos si faltan) o la de la fórmula. */
export function moleculeFor(b: Model3DBlock, lang?: GradeLang): Molecule | undefined {
  if (b.atoms.length) {
    const bonds = b.bonds.length ? b.bonds.filter((x) => x.a >= 0 && x.b >= 0 && x.a < b.atoms.length && x.b < b.atoms.length && x.a !== x.b) : bondsByDistance(b.atoms)
    const m: Molecule = { atoms: [...b.atoms], bonds, lonePairs: [] }
    if (b.formula) m.name = b.formula
    // pares libres pedidos con átomos escritos: los de la fórmula, si coincide el número de átomos
    if (b.lonePairs && b.formula) { const built = buildMolecule(b.formula, lang); if (built && built.atoms.length === b.atoms.length) m.lonePairs = built.lonePairs }
    return m
  }
  return b.formula ? buildMolecule(b.formula, lang) : undefined
}

export const MoleculeBuilder = { build: buildMolecule, parse: parseFormula, bondsByDistance, molecule: moleculeFor, covalentRadius, symbols: ELEMENT_SYMBOLS, geometryName }
