// Dibujo convencional de una fórmula estructural a partir de su disposición: qué átomos llevan letra (en la esquelética,
// los carbonos no), enlaces que se detienen antes de las letras, el segundo trazo de un doble enlace de anillo por dentro
// y más corto, los triples en tres líneas, el círculo de los anillos aromáticos y las etiquetas con sus H en el lado
// libre (HO– a la izquierda, –OH a la derecha; H₂O y HCl pero NH₃ y CH₄ sueltos), cargas, isótopos y grupos R.
// También coloca las reacciones (especies, «+» y flecha). Puro: medidas en píxeles con y hacia abajo; el texto se mide
// con la función que se le pase (la interfaz usa la letra real; las pruebas, una estimación).
//
// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/figures/molecule.ts
// (layoutMoleculeFigure). De Aula: letras centradas en el átomo con los H, subíndices y cargas como piezas aparte,
// recorte de los enlaces contra la caja de cada letra, estilos semidesarrollado y desarrollado, Kekulé o círculo por
// sistema aromático, R con su número, isótopos, notas y reacciones.
import { Formula } from './formula'
import { EXPANDED_MAX_HEAVY, heavyAtomCount, smilesComposition, withExplicitHydrogens, type SmilesMolecule, type SmilesSpecies } from './smiles'
import { layoutQuality, layoutStructure, type Pt, type StructureLayout } from './structure-layout'

export type StructureStyle = 'skeletal' | 'condensed' | 'expanded'

/**
 * Estilos en los que se puede enseñar la molécula: la esquelética siempre; la semidesarrollada y la desarrollada (con
 * todos los H: hasta EXPANDED_MAX_HEAVY átomos pesados y sin reacciones) solo si no salen con átomos encimados donde la
 * esquelética no los tiene (si también la esquelética sale deformada, un sistema con puentes, se ofrecen como siempre).
 */
export function drawableStyles(mol: SmilesMolecule, reaction: boolean): StructureStyle[] {
  const flatBad = layoutQuality(mol, layoutStructure(mol)).deformed
  const clean = (m: SmilesMolecule): boolean => flatBad || !layoutQuality(m, layoutStructure(m, { straight: true })).deformed
  const out: StructureStyle[] = ['skeletal']
  if (clean(mol)) out.push('condensed')
  if (!reaction && heavyAtomCount(mol) <= EXPANDED_MAX_HEAVY && clean(withExplicitHydrogens(mol))) out.push('expanded')
  return out
}
export type AromaticMode = 'auto' | 'circle' | 'kekule'
/** Ancho de un texto en píxeles con la letra de la interfaz. */
export type Measure = (text: string, sizePx: number, bold?: boolean) => number

/** Medida aproximada (sin letra real): para las pruebas y el proceso principal. */
export const estimateMeasure: Measure = (text, size, bold) => {
  let ems = 0
  for (const ch of text) ems += /[A-Z]/.test(ch) ? 0.66 : /[0-9]/.test(ch) ? 0.56 : /[il|.,:;]/.test(ch) ? 0.28 : /[+−-]/.test(ch) ? 0.58 : 0.52
  return ems * size * (bold ? 1.04 : 1)
}

export interface DepictOptions {
  style?: StructureStyle
  aromatic?: AromaticMode
  /** Largo de un enlace en píxeles. */
  bondPx?: number
  /** Tamaño de las letras de los átomos. */
  fontPx?: number
  measure?: Measure
  /** Especies de una reacción (de `parseStructure`). */
  species?: SmilesSpecies[]
  reversible?: boolean
  /** Condiciones de la reacción (sobre o bajo la flecha). */
  conditions?: string
  /** Notas junto a un átomo (índice desde 0). */
  notes?: { atom: number; text: string }[]
}

export interface Box { x: number; y: number; w: number; h: number }
export type Segment = [number, number, number, number]

export interface DepictBond {
  index: number
  a: number
  b: number
  kind: 'single' | 'double' | 'triple' | 'aromatic'
  /** Anillo al que pertenece (el menor). */
  ring?: number
  segments: Segment[]
}

export interface DepictCircle { cx: number; cy: number; r: number; ring: number }

export interface LabelPart {
  text: string
  /** Borde izquierdo y línea base del texto. */
  x: number
  y: number
  size: number
  role: 'element' | 'hydrogen' | 'count' | 'charge' | 'isotope' | 'class'
}

export interface DepictLabel {
  atom: number
  x: number
  y: number
  /** Símbolo que se escribe («R» para «*»). */
  element: string
  h: number
  hSide: 'left' | 'right' | 'up' | 'down'
  charge: number
  isotope?: number
  rClass?: number
  parts: LabelPart[]
  box: Box
  /** El texto entero con sub- y superíndices Unicode («H₃C», «NH₄⁺»): para leerlo y para las pruebas. */
  text: string
}

export interface DepictNote { atom: number; x: number; y: number; text: string; size: number }

export interface DepictSymbol {
  kind: 'plus' | 'arrow' | 'equilibrium'
  x: number
  y: number
  /** Final de la flecha. */
  x2?: number
  above?: string
  below?: string
  size: number
}

export interface Depiction {
  /** Posición de cada átomo en píxeles; `shown`: lleva letra; `hidden`: no se dibuja (agentes de una reacción). */
  atoms: { x: number; y: number; shown: boolean; hidden: boolean }[]
  bonds: DepictBond[]
  circles: DepictCircle[]
  labels: DepictLabel[]
  notes: DepictNote[]
  symbols: DepictSymbol[]
  /** Orden en el que se trazan los enlaces (en anchura desde el primer átomo de cada parte). */
  drawOrder: number[]
  bounds: Box
  bondPx: number
  fontPx: number
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const digits = (n: number, set: string): string => String(n).replace(/\d/g, (d) => set[Number(d)])
const chargeText = (q: number): string => (Math.abs(q) > 1 ? String(Math.abs(q)) : '') + (q > 0 ? '+' : '−')
const unionBox = (a: Box | undefined, b: Box): Box => {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Dibuja la molécula (o la reacción) dispuesta con `layoutStructure`. */
export function depictStructure(mol: SmilesMolecule, layout: StructureLayout, opts: DepictOptions = {}): Depiction {
  const style = opts.style ?? 'skeletal'
  const bondPx = opts.bondPx ?? 40
  const f = opts.fontPx ?? 15
  const measure = opts.measure ?? estimateMeasure
  const n = mol.atoms.length
  const at: Pt[] = layout.pos.map(([x, y]) => [x * bondPx, -y * bondPx])
  const neighbours: number[][] = Array.from({ length: n }, () => [])
  for (const b of mol.bonds) (neighbours[b.a].push(b.b), neighbours[b.b].push(b.a))
  const hidden = new Set<number>()
  for (const s of opts.species ?? []) if (s.side === 'agent') for (const a of s.atoms) hidden.add(a)
  const partSize = new Map<number, number>()
  for (const part of layout.parts) for (const a of part) partSize.set(a, part.length)
  const shown = mol.atoms.map((a, i) => {
    if (style !== 'skeletal') return true
    return a.element !== 'C' || neighbours[i].length === 0 || a.charge !== 0 || a.isotope !== undefined || (partSize.get(i) ?? 0) <= 2
  })

  const labelOf = (i: number): DepictLabel => makeLabel(mol, i, at, neighbours, mol.rings, f, measure)
  let labels = new Map<number, DepictLabel>()
  for (let i = 0; i < n; i++) if (shown[i] && !hidden.has(i)) labels.set(i, labelOf(i))

  // reacción: cada especie en su sitio, con «+» entre ellas y la flecha
  const symbols: DepictSymbol[] = []
  if (opts.species?.length) {
    const arranged = arrangeReaction(mol, at, labels, opts.species, bondPx, f, measure, opts)
    symbols.push(...arranged.symbols)
    labels = new Map([...labels].map(([i, l]) => [i, moveLabel(l, arranged.shift[i][0], arranged.shift[i][1])]))
    for (let i = 0; i < n; i++) at[i] = [at[i][0] + arranged.shift[i][0], at[i][1] + arranged.shift[i][1]]
  }

  const circleBonds = circleSystems(mol, opts.aromatic ?? 'auto')
  const ringOfBond = mol.bonds.map((b) => {
    const k = mol.rings.findIndex((r) => r.some((x, j) => (x === b.a && r[(j + 1) % r.length] === b.b) || (x === b.b && r[(j + 1) % r.length] === b.a)))
    return k >= 0 ? k : undefined
  })
  const centreOf = (ring: number[]): Pt => [ring.reduce((s, a) => s + at[a][0], 0) / ring.length, ring.reduce((s, a) => s + at[a][1], 0) / ring.length]

  const bonds: DepictBond[] = []
  mol.bonds.forEach((bond, index) => {
    if (hidden.has(bond.a) || hidden.has(bond.b)) return
    const [p, q] = [at[bond.a], at[bond.b]]
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    const u: Pt = [(q[0] - p[0]) / length, (q[1] - p[1]) / length]
    const normal: Pt = [-u[1], u[0]]
    const kind: DepictBond['kind'] =
      bond.order === 1.5 ? (circleBonds.has(index) ? 'aromatic' : bond.kekule === 2 ? 'double' : 'single') : bond.order === 3 ? 'triple' : bond.order === 2 ? 'double' : 'single'
    const ring = ringOfBond[index]
    const gap = bondPx * 0.15
    const segments: Segment[] = []
    const line = (offset: number, inset = 0): void => {
      const [ox, oy] = [normal[0] * offset, normal[1] * offset]
      const [ix, iy] = [u[0] * inset, u[1] * inset]
      const seg = clip([p[0] + ox + ix, p[1] + oy + iy, q[0] + ox - ix, q[1] + oy - iy], labels.get(bond.a)?.box, labels.get(bond.b)?.box, f * 0.16)
      if (seg) segments.push(seg)
    }
    const sideTowards = (target: Pt): number => {
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      return (target[0] - mid[0]) * normal[0] + (target[1] - mid[1]) * normal[1] > 0 ? 1 : -1
    }
    if (kind === 'double') {
      const others = [...neighbours[bond.a].filter((x) => x !== bond.b), ...neighbours[bond.b].filter((x) => x !== bond.a)]
      const bare = !shown[bond.a] && !shown[bond.b]
      if (ring !== undefined) {
        // en un anillo, el segundo trazo va por dentro
        line(0)
        line(gap * sideTowards(centreOf(mol.rings[ring])), length * 0.13)
      } else if (bare && neighbours[bond.a].length >= 2 && neighbours[bond.b].length >= 2) {
        // en una cadena, hacia el lado de los sustituyentes
        line(0)
        line(gap * sideTowards(centreOf(others)), length * 0.13)
      } else {
        line(gap / 2)
        line(-gap / 2)
      }
    } else if (kind === 'triple') {
      line(0)
      line(gap * 0.95)
      line(-gap * 0.95)
    } else {
      line(0)
    }
    if (segments.length) bonds.push({ index, a: bond.a, b: bond.b, kind, ring, segments })
  })

  // los anillos aromáticos dibujados con círculo
  const circles: DepictCircle[] = []
  mol.rings.forEach((ring, k) => {
    if (ring.some((a) => hidden.has(a))) return
    const all = ring.every((a, j) => {
      const b = ring[(j + 1) % ring.length]
      const bi = mol.bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
      return circleBonds.has(bi)
    })
    if (!all) return
    const [cx, cy] = centreOf(ring)
    circles.push({ cx, cy, r: (bondPx / (2 * Math.tan(Math.PI / ring.length))) * 0.6, ring: k })
  })

  const notes: DepictNote[] = []
  for (const note of opts.notes ?? []) {
    const i = note.atom
    if (i < 0 || i >= n || hidden.has(i) || !note.text) continue
    const [dx, dy] = freeDirection(at, neighbours, i)
    const reach = bondPx * (shown[i] ? 0.62 : 0.42)
    notes.push({ atom: i, x: at[i][0] + dx * reach, y: at[i][1] + dy * reach, text: note.text, size: f * 0.8 })
  }

  const drawOrder = traversal(n, mol, layout.parts, hidden)
  const atoms = at.map(([x, y], i) => ({ x, y, shown: shown[i] && !hidden.has(i), hidden: hidden.has(i) }))
  const labelList = [...labels.values()].sort((a, b) => a.atom - b.atom)
  let bounds: Box | undefined
  for (const [i, a] of atoms.entries()) if (!a.hidden) bounds = unionBox(bounds, { x: at[i][0] - 2, y: at[i][1] - 2, w: 4, h: 4 })
  for (const b of bonds) for (const s of b.segments) bounds = unionBox(bounds, { x: Math.min(s[0], s[2]) - 1, y: Math.min(s[1], s[3]) - 1, w: Math.abs(s[2] - s[0]) + 2, h: Math.abs(s[3] - s[1]) + 2 })
  for (const c of circles) bounds = unionBox(bounds, { x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2 })
  for (const l of labelList) bounds = unionBox(bounds, l.box)
  for (const nt of notes) {
    const w = measure(nt.text, nt.size)
    bounds = unionBox(bounds, { x: nt.x - w / 2 - 2, y: nt.y - nt.size * 0.7, w: w + 4, h: nt.size * 1.4 })
  }
  for (const s of symbols) {
    const x2 = s.x2 ?? s.x
    bounds = unionBox(bounds, { x: s.x - s.size, y: s.y - s.size, w: x2 - s.x + s.size * 2, h: s.size * 2 })
    if (s.above) bounds = unionBox(bounds, { x: (s.x + x2) / 2 - measure(s.above, f * 0.8) / 2, y: s.y - f * 1.9, w: measure(s.above, f * 0.8), h: f })
    if (s.below) bounds = unionBox(bounds, { x: (s.x + x2) / 2 - measure(s.below, f * 0.8) / 2, y: s.y + f * 0.6, w: measure(s.below, f * 0.8), h: f * 1.2 })
  }
  return { atoms, bonds, circles, labels: labelList, notes, symbols, drawOrder, bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 }, bondPx, fontPx: f }
}

// MARK: Etiquetas

/** Hacia dónde no hay enlaces (vector unitario, y hacia abajo). */
function freeDirection(at: Pt[], neighbours: number[][], i: number): Pt {
  let vx = 0
  let vy = 0
  for (const j of neighbours[i]) {
    const d = Math.hypot(at[j][0] - at[i][0], at[j][1] - at[i][1]) || 1
    vx += (at[j][0] - at[i][0]) / d
    vy += (at[j][1] - at[i][1]) / d
  }
  const len = Math.hypot(vx, vy)
  return len < 1e-6 ? [0, -1] : [-vx / len, -vy / len]
}

/** Lado de los H: el libre (HO– a la izquierda, –OH a la derecha; sueltos, H₂O, HCl, H₃O⁺ pero OH⁻, NH₃, CH₄). */
function hydrogenSide(mol: SmilesMolecule, i: number, at: Pt[], neighbours: number[][], rings: number[][]): DepictLabel['hSide'] {
  const a = mol.atoms[i]
  const deg = neighbours[i].length
  if (deg === 0) {
    if (a.element === 'O') return a.charge < 0 ? 'right' : 'left'
    return ['S', 'Se', 'F', 'Cl', 'Br', 'I'].includes(a.element) ? 'left' : 'right'
  }
  let vx = 0
  let vy = 0
  for (const j of neighbours[i]) {
    const d = Math.hypot(at[j][0] - at[i][0], at[j][1] - at[i][1]) || 1
    vx += (at[j][0] - at[i][0]) / d
    vy += (at[j][1] - at[i][1]) / d
  }
  vx /= deg
  vy /= deg
  const inRing = rings.some((r) => r.includes(i))
  if (deg >= 2 && inRing && Math.abs(vy) > 2 * Math.abs(vx) && Math.abs(vy) > 0.3) return vy > 0 ? 'up' : 'down'
  return vx > 0.3 ? 'left' : 'right'
}

function makeLabel(mol: SmilesMolecule, i: number, at: Pt[], neighbours: number[][], rings: number[][], f: number, measure: Measure): DepictLabel {
  const atom = mol.atoms[i]
  const [x, y] = at[i]
  const small = f * 0.68
  const element = atom.element === '*' ? 'R' : atom.element
  const h = mol.hydrogens[i]
  const hSide = hydrogenSide(mol, i, at, neighbours, rings)
  const base = y + f * 0.36
  const wEl = measure(element, f, true)
  const parts: LabelPart[] = [{ text: element, x: x - wEl / 2, y: base, size: f, role: 'element' }]
  let left = x - wEl / 2
  let right = x + wEl / 2
  let text = element
  if (atom.isotope !== undefined) {
    const s = String(atom.isotope)
    const w = measure(s, small)
    parts.push({ text: s, x: left - w, y: base - f * 0.42, size: small, role: 'isotope' })
    left -= w
    text = digits(atom.isotope, SUP) + text
  }
  if (atom.element === '*' && atom.atomClass !== undefined) {
    const s = String(atom.atomClass)
    parts.push({ text: s, x: right, y: base - f * 0.42, size: small, role: 'class' })
    right += measure(s, small)
    text += digits(atom.atomClass, SUP)
  }
  if (h > 0) {
    const wH = measure('H', f, true)
    const count = h > 1 ? String(h) : ''
    const wN = count ? measure(count, small) : 0
    const hText = 'H' + (count ? digits(h, SUB) : '')
    const put = (hx: number, hy: number): void => {
      parts.push({ text: 'H', x: hx, y: hy, size: f, role: 'hydrogen' })
      if (count) parts.push({ text: count, x: hx + wH, y: hy + f * 0.24, size: small, role: 'count' })
    }
    if (hSide === 'right') {
      put(right, base)
      right += wH + wN
      text += hText
    } else if (hSide === 'left') {
      put(left - wH - wN, base)
      left -= wH + wN
      text = hText + text
    } else {
      put(x - (wH + wN) / 2, base + (hSide === 'up' ? -f * 1.02 : f * 1.02))
      text += hText
    }
  }
  if (atom.charge !== 0) {
    const s = chargeText(atom.charge)
    parts.push({ text: s, x: right + f * 0.04, y: base - f * 0.44, size: small, role: 'charge' })
    text += s.replace(/\d/g, (d) => SUP[Number(d)]).replace('+', '⁺').replace('−', '⁻')
  }
  let box: Box | undefined
  for (const p of parts) {
    const w = measure(p.text, p.size, p.role === 'element' || p.role === 'hydrogen')
    box = unionBox(box, { x: p.x, y: p.y - p.size * 0.74, w, h: p.size * 0.92 })
  }
  const label: DepictLabel = { atom: i, x, y, element, h, hSide, charge: atom.charge, parts, box: box!, text }
  if (atom.isotope !== undefined) label.isotope = atom.isotope
  if (atom.element === '*' && atom.atomClass !== undefined) label.rClass = atom.atomClass
  return label
}

function moveLabel(l: DepictLabel, dx: number, dy: number): DepictLabel {
  return { ...l, x: l.x + dx, y: l.y + dy, parts: l.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })), box: { ...l.box, x: l.box.x + dx, y: l.box.y + dy } }
}

// MARK: Enlaces

/** Recorta un segmento para que no entre en las cajas de las letras de sus extremos (con un margen). */
function clip(seg: Segment, boxA: Box | undefined, boxB: Box | undefined, pad: number): Segment | undefined {
  const [x1, y1, x2, y2] = seg
  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0
  let t1 = 1
  const inside = (box: Box): [number, number] | undefined => {
    // Liang–Barsky: tramo del segmento dentro de la caja (ampliada)
    const bx0 = box.x - pad
    const bx1 = box.x + box.w + pad
    const by0 = box.y - pad
    const by1 = box.y + box.h + pad
    let lo = -Infinity
    let hi = Infinity
    for (const [p, q] of [[-dx, x1 - bx0], [dx, bx1 - x1], [-dy, y1 - by0], [dy, by1 - y1]] as [number, number][]) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return undefined
      } else {
        const r = q / p
        if (p < 0) lo = Math.max(lo, r)
        else hi = Math.min(hi, r)
      }
    }
    return lo <= hi ? [lo, hi] : undefined
  }
  if (boxA) {
    const r = inside(boxA)
    if (r && r[0] <= 0) t0 = Math.max(t0, r[1])
  }
  if (boxB) {
    const r = inside(boxB)
    if (r && r[1] >= 1) t1 = Math.min(t1, r[0])
  }
  if (t1 - t0 < 0.04) return undefined
  return [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1]
}

/**
 * Enlaces que se dibujan con el círculo aromático: los de los sistemas aromáticos (anillos fusionados) en los que TODOS los
 * anillos lo admiten. En «auto», solo los de tipo benceno (6 átomos C o N, sin dobles enlaces hacia fuera ni cargas); los
 * demás (cafeína, pirrol, uracilo) van en forma de Kekulé.
 */
function circleSystems(mol: SmilesMolecule, mode: AromaticMode): Set<number> {
  const out = new Set<number>()
  if (mode === 'kekule') return out
  const bondIndex = (a: number, b: number): number => mol.bonds.findIndex((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
  const ringBonds = mol.rings.map((r) => r.map((a, j) => bondIndex(a, r[(j + 1) % r.length])))
  const aromatic = mol.rings.map((_, k) => ringBonds[k].every((bi) => bi >= 0 && mol.bonds[bi].order === 1.5))
  const ringAtoms = (k: number): Set<number> => new Set(mol.rings[k])
  const qualifies = (k: number): boolean => {
    if (mode === 'circle') return true
    const r = mol.rings[k]
    if (r.length !== 6) return false
    if (r.some((a) => !['C', 'N'].includes(mol.atoms[a].element) || mol.atoms[a].charge !== 0)) return false
    const atoms = ringAtoms(k)
    return !mol.bonds.some((b) => b.order === 2 && (atoms.has(b.a) !== atoms.has(b.b)))
  }
  // sistemas: anillos aromáticos que comparten un enlace
  const system = mol.rings.map((_, k) => k)
  const find = (k: number): number => (system[k] === k ? k : (system[k] = find(system[k])))
  for (let i = 0; i < mol.rings.length; i++) {
    for (let j = i + 1; j < mol.rings.length; j++) {
      if (aromatic[i] && aromatic[j] && ringBonds[i].some((b) => ringBonds[j].includes(b))) system[find(i)] = find(j)
    }
  }
  const ok = new Map<number, boolean>()
  mol.rings.forEach((_, k) => {
    if (!aromatic[k]) return
    const root = find(k)
    ok.set(root, (ok.get(root) ?? true) && qualifies(k))
  })
  mol.rings.forEach((_, k) => {
    if (aromatic[k] && ok.get(find(k))) for (const bi of ringBonds[k]) out.add(bi)
  })
  return out
}

/** Orden de trazado: en anchura desde el primer átomo de cada parte (como dibuja una mano). */
function traversal(n: number, mol: SmilesMolecule, parts: number[][], hidden: Set<number>): number[] {
  const order: number[] = []
  const used = new Set<number>()
  const seen = new Set<number>()
  const byAtom: number[][] = Array.from({ length: n }, () => [])
  mol.bonds.forEach((b, i) => (byAtom[b.a].push(i), byAtom[b.b].push(i)))
  for (const part of parts) {
    const start = part[0]
    if (start === undefined || seen.has(start)) continue
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const u = queue.shift()!
      for (const bi of byAtom[u]) {
        if (used.has(bi)) continue
        used.add(bi)
        const b = mol.bonds[bi]
        if (!hidden.has(b.a) && !hidden.has(b.b)) order.push(bi)
        const v = b.a === u ? b.b : b.a
        if (!seen.has(v)) (seen.add(v), queue.push(v))
      }
    }
  }
  return order
}

// MARK: Reacciones

/** Coloca las especies de izquierda a derecha con «+» y la flecha (agentes y condiciones sobre ella). */
function arrangeReaction(
  mol: SmilesMolecule, at: Pt[], labels: Map<number, DepictLabel>, species: SmilesSpecies[], bondPx: number, f: number, measure: Measure, opts: DepictOptions
): { shift: Pt[]; symbols: DepictSymbol[] } {
  const shift: Pt[] = at.map(() => [0, 0])
  const symbols: DepictSymbol[] = []
  const boxOf = (atoms: number[]): Box => {
    let box: Box | undefined
    for (const a of atoms) {
      box = unionBox(box, { x: at[a][0] - 2, y: at[a][1] - 2, w: 4, h: 4 })
      const l = labels.get(a)
      if (l) box = unionBox(box, l.box)
    }
    return box ?? { x: 0, y: 0, w: 0, h: 0 }
  }
  const agents = species.filter((s) => s.side === 'agent').map((s) => {
    const c = smilesComposition(mol, s.atoms)
    return Formula.fromComposition(c.composition, c.charge).unicodeText
  })
  const above = agents.length ? agents.join(', ') : opts.conditions?.trim() || undefined
  const below = agents.length ? opts.conditions?.trim() || undefined : undefined
  const gap = bondPx * 0.42
  const plus = f * 0.9
  let cursor = 0
  const place = (s: SmilesSpecies): void => {
    const box = boxOf(s.atoms)
    const dx = cursor - box.x
    const dy = -(box.y + box.h / 2)
    for (const a of s.atoms) shift[a] = [dx, dy]
    cursor += box.w
  }
  const side = (which: 'reactant' | 'product'): void => {
    species.filter((s) => s.side === which).forEach((s, k) => {
      if (k > 0) {
        cursor += gap
        symbols.push({ kind: 'plus', x: cursor + plus / 2, y: 0, size: plus / 2 })
        cursor += plus + gap
      }
      place(s)
    })
  }
  side('reactant')
  const textW = Math.max(above ? measure(above, f * 0.8) : 0, below ? measure(below, f * 0.8) : 0)
  const arrow = Math.max(bondPx * 2.2, textW + f * 1.6)
  cursor += gap * 1.3
  symbols.push({ kind: opts.reversible ? 'equilibrium' : 'arrow', x: cursor, x2: cursor + arrow, y: 0, size: f * 0.5, above, below })
  cursor += arrow + gap * 1.3
  side('product')
  return { shift, symbols }
}
