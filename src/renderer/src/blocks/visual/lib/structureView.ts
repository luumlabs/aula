// Piezas puras del bloque `structure` en pantalla: leer y dibujar la SMILES con el estilo pedido, los grupos que se
// muestran (los escritos y los que reconoce Aula), los conjuntos de átomos de un paso, los trazos con un temblor de mano
// y el rodeado a mano del grupo activo. Sin React: se prueban solas.
import {
  SmilesError, depictStructure, detectFunctionalGroups, heavyAtomCount, layoutStructure, parseStructure, smilesComposition,
  withExplicitHydrogens, type Depiction, type FunctionalGroupKind, type Measure, type ParsedStructure, type SmilesErrorKind, type SmilesMolecule
} from '@engine/chem'
import { Formula } from '@engine/chem/formula'
import { smilesFormulaParts } from '@engine/chem/smiles'
import { drawableStyles } from '@engine/chem/structure-depict'
import { handLoop } from '@renderer/design/paint/brush'
import { rngFrom, seedOf } from '@renderer/design/paint/random'
import type { StructureBlock, StructureStyle } from '@shared/schema/structure'

/** Largo de un enlace en píxeles según el estilo (las letras de la semidesarrollada necesitan más aire). */
export const BOND_PX: Record<StructureStyle, number> = { skeletal: 40, condensed: 54, expanded: 46 }
export const LABEL_PX = 15

export type StructureView =
  | { ok: true; parsed: ParsedStructure; mol: SmilesMolecule; depiction: Depiction; style: StructureStyle; styles: StructureStyle[]; heavy: number }
  | { ok: false; error: SmilesErrorKind }

/**
 * Lee y dibuja la SMILES del bloque con el estilo pedido, si se dibuja bien en él (la desarrollada solo hasta 15 átomos
 * pesados y sin reacciones; ninguna con átomos encimados): si no, la semidesarrollada o la esquelética.
 */
export function structureView(b: Pick<StructureBlock, 'smiles' | 'aromatic' | 'notes' | 'conditions' | 'reversible'>, wanted: StructureStyle, measure: Measure): StructureView {
  let parsed: ParsedStructure
  try {
    parsed = parseStructure(b.smiles)
  } catch (e) {
    if (e instanceof SmilesError) return { ok: false, error: e.kind }
    throw e
  }
  const heavy = heavyAtomCount(parsed.molecule)
  const styles = drawableStyles(parsed.molecule, !!parsed.species)
  const style = styles.includes(wanted) ? wanted : styles.includes('condensed') ? 'condensed' : 'skeletal'
  const mol = style === 'expanded' ? withExplicitHydrogens(parsed.molecule) : parsed.molecule
  const layout = layoutStructure(mol, { straight: style !== 'skeletal' })
  const depiction = depictStructure(mol, layout, {
    style, aromatic: b.aromatic, bondPx: BOND_PX[style], fontPx: LABEL_PX, measure, species: parsed.species, reversible: b.reversible,
    conditions: b.conditions, notes: b.notes.map((n) => ({ atom: n.atom - 1, text: n.text }))
  })
  return { ok: true, parsed, mol, depiction, style, styles, heavy }
}

/** Fórmula molecular para mhchem (de una molécula) o la ecuación (de una reacción); undefined si no hay nada que decir. */
export function formulaCe(parsed: ParsedStructure, reversible: boolean): { ce: string; mass?: number } | undefined {
  const mol = parsed.molecule
  if (!parsed.species) {
    // varias moléculas: cada una con su fórmula (salvo una sal, que es una sola sustancia: NH4Cl); la masa, de una sola
    const parts = smilesFormulaParts(mol)
    if (!parts.length) return undefined
    const formulas = parts.map((p) => Formula.fromComposition(p.composition, p.charge))
    if (formulas.length > 1) return { ce: formulas.map((f) => f.ceBody(false)).join(', ') }
    return { ce: formulas[0].ceBody(false), mass: parts[0].generic ? undefined : formulas[0].molarMass }
  }
  const side = (which: 'reactant' | 'product'): string =>
    parsed.species!.filter((s) => s.side === which).map((s) => {
      const c = smilesComposition(mol, s.atoms)
      return Formula.fromComposition(c.composition, c.charge).ceBody(false)
    }).join(' + ')
  return { ce: `${side('reactant')} ${reversible ? '<=>' : '->'} ${side('product')}` }
}

export interface ShownGroup {
  key: string
  /** Nombre que se ve (el de la IA o el del tipo, ya traducido fuera). */
  label?: string
  kind?: FunctionalGroupKind
  /** Átomos desde 0. */
  atoms: number[]
  color?: string
  md?: string
}

/**
 * Los grupos que se enseñan: primero los escritos (sus átomos desde 1 pasan a 0 y se quitan los que no existen); con
 * `autoGroups`, los que reconoce Aula, juntos por tipo (los 5 alcoholes de la glucosa son un solo botón) y sin repetir los
 * que ya están escritos.
 */
export function shownGroups(b: Pick<StructureBlock, 'groups' | 'autoGroups'>, mol: SmilesMolecule, isReaction: boolean): ShownGroup[] {
  const n = mol.atoms.length
  const out: ShownGroup[] = b.groups
    .map((g, i) => ({ key: `g${i}`, label: g.label, atoms: g.atoms.map((a) => a - 1).filter((a) => a >= 0 && a < n), color: g.color, md: g.md }))
    .filter((g) => g.atoms.length > 0 && g.label.trim())
  if (b.autoGroups && !isReaction) {
    const byKind = new Map<FunctionalGroupKind, number[]>()
    for (const d of detectFunctionalGroups(mol)) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), ...d.atoms])
    for (const [kind, atoms] of byKind) {
      const set = [...new Set(atoms)].sort((x, y) => x - y)
      const same = out.some((g) => g.atoms.length === set.length && g.atoms.every((a) => set.includes(a)))
      if (!same) out.push({ key: `a-${kind}`, kind, atoms: set })
    }
  }
  return out.slice(0, 16)
}

/** Átomos de un paso: los de su grupo (por nombre, sin mayúsculas) o los que lista (desde 1). */
export function stepAtoms(step: { group?: string; atoms?: number[] }, groups: readonly ShownGroup[], n: number): number[] {
  const out = new Set<number>()
  const key = step.group?.trim().toLowerCase()
  if (key) for (const g of groups) if (g.label?.trim().toLowerCase() === key) for (const a of g.atoms) out.add(a)
  for (const a of step.atoms ?? []) if (a >= 1 && a <= n) out.add(a - 1)
  return [...out].sort((x, y) => x - y)
}

/** Átomos activos en racimos (los enlazados entre sí o muy cerca): uno por cada rodeado a mano. */
export function clusters(atoms: readonly number[], d: Depiction, mol: SmilesMolecule): number[][] {
  const set = new Set(atoms)
  const parent = new Map<number, number>(atoms.map((a) => [a, a]))
  const find = (a: number): number => (parent.get(a) === a ? a : find(parent.get(a)!))
  const join = (a: number, b: number): void => {
    parent.set(find(a), find(b))
  }
  for (const b of mol.bonds) if (set.has(b.a) && set.has(b.b)) join(b.a, b.b)
  for (const a of atoms) {
    for (const b of atoms) {
      if (a < b && Math.hypot(d.atoms[a].x - d.atoms[b].x, d.atoms[a].y - d.atoms[b].y) < d.bondPx * 1.2) join(a, b)
    }
  }
  const groups = new Map<number, number[]>()
  for (const a of atoms) groups.set(find(a), [...(groups.get(find(a)) ?? []), a])
  return [...groups.values()]
}

/** Rodeado a mano (como el de la pluma de Aula) alrededor de unos átomos y sus letras. */
export function ringPath(atoms: readonly number[], d: Depiction, seed: string): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const a of atoms) {
    const p = d.atoms[a]
    const l = d.labels.find((x) => x.atom === a)
    const bx = l ? [l.box.x, l.box.x + l.box.w] : [p.x - 6, p.x + 6]
    const by = l ? [l.box.y, l.box.y + l.box.h] : [p.y - 6, p.y + 6]
    x0 = Math.min(x0, bx[0]); x1 = Math.max(x1, bx[1]); y0 = Math.min(y0, by[0]); y1 = Math.max(y1, by[1])
  }
  const pad = d.fontPx * 0.75
  const rx = Math.max(16, (x1 - x0) / 2 + pad) * 1.08
  const ry = Math.max(16, (y1 - y0) / 2 + pad) * 1.08
  const pts = handLoop((x0 + x1) / 2, (y0 + y1) / 2, rx, ry, rngFrom(seedOf(seed)), 1.1)
  return 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')
}

/** Un trazo recto con el temblor de una mano: una curva casi recta, con la panza fija para cada enlace. */
export function handStroke(seg: readonly number[], seed: number): string {
  const [x1, y1, x2, y2] = seg
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const bow = (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * Math.min(1.6, len * 0.035)
  const mx = (x1 + x2) / 2 - ((y2 - y1) / len) * bow
  const my = (y1 + y2) / 2 + ((x2 - x1) / len) * bow
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

/** Flecha de reacción (y la doble media flecha del equilibrio). */
export function arrowPaths(x1: number, x2: number, y: number, kind: 'arrow' | 'equilibrium', size: number): string[] {
  const h = size * 0.9
  if (kind === 'arrow') return [`M${x1} ${y} L${x2} ${y}`, `M${x2 - h * 1.4} ${y - h} L${x2} ${y} L${x2 - h * 1.4} ${y + h}`]
  const g = size * 0.42
  return [`M${x1} ${y - g} L${x2} ${y - g}`, `M${x2 - h * 1.4} ${y - g - h} L${x2} ${y - g}`, `M${x2} ${y + g} L${x1} ${y + g}`, `M${x1 + h * 1.4} ${y + g + h} L${x1} ${y + g}`]
}
