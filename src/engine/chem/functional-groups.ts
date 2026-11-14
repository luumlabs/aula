// Grupos funcionales de una molécula (temario de secundaria y primeros cursos de universidad): se buscan en los átomos
// pesados con sus H y los enlaces de Kekulé, con precedencias para no contar dos veces (un éster no es además éter y
// cetona; un ácido no es además alcohol). Puro; los nombres para el alumno van en la interfaz (visual.json).
import { bondValence, type SmilesMolecule } from './smiles'

export const FUNCTIONAL_GROUP_KINDS = [
  'carboxylicAcid', 'carboxylate', 'anhydride', 'ester', 'acylHalide', 'amide', 'aldehyde', 'ketone', 'nitrile', 'nitro',
  'alcohol', 'phenol', 'ether', 'amine1', 'amine2', 'amine3', 'thiol', 'halide', 'alkene', 'alkyne', 'arene'
] as const
export type FunctionalGroupKind = (typeof FUNCTIONAL_GROUP_KINDS)[number]

export interface FunctionalGroup {
  kind: FunctionalGroupKind
  /** Átomos del grupo (índices desde 0, en orden). */
  atoms: number[]
}

const HALOGENS = new Set(['F', 'Cl', 'Br', 'I'])

/** Busca los grupos funcionales (en el orden de la lista de tipos y, dentro de cada tipo, por posición). */
export function detectFunctionalGroups(mol: SmilesMolecule): FunctionalGroup[] {
  const n = mol.atoms.length
  const el = (i: number): string => mol.atoms[i].element
  const links: { to: number; order: number; aromatic: boolean }[][] = Array.from({ length: n }, () => [])
  for (const b of mol.bonds) {
    const order = bondValence(b)
    links[b.a].push({ to: b.b, order, aromatic: b.order === 1.5 })
    links[b.b].push({ to: b.a, order, aromatic: b.order === 1.5 })
  }
  const H = (i: number): number => mol.hydrogens[i] + links[i].filter((l) => el(l.to) === 'H').length
  const heavy = (i: number): { to: number; order: number; aromatic: boolean }[] => links[i].filter((l) => el(l.to) !== 'H')
  const doubleO = (c: number): number | undefined => heavy(c).find((l) => l.order === 2 && el(l.to) === 'O')?.to
  const arenes = areneRings(mol, links)
  const inArene = new Set(arenes.flat())
  const out: FunctionalGroup[] = []
  const used = new Set<number>()
  const add = (kind: FunctionalGroupKind, atoms: number[]): void => {
    out.push({ kind, atoms: [...new Set(atoms)].sort((a, b) => a - b) })
  }
  const acyl = (c: number): boolean => el(c) === 'C' && doubleO(c) !== undefined

  // carbonilos y derivados: un átomo de C con =O
  const anhydrideO = new Set<number>()
  for (let c = 0; c < n; c++) {
    if (!acyl(c)) continue
    const o = doubleO(c)!
    const others = heavy(c).filter((l) => l.to !== o)
    const singleO = others.filter((l) => l.order === 1 && el(l.to) === 'O')
    const acid = singleO.find((l) => H(l.to) >= 1)
    const anion = singleO.find((l) => mol.atoms[l.to].charge < 0)
    const bridge = singleO.find((l) => heavy(l.to).some((m) => m.to !== c && el(m.to) === 'C'))
    const nitrogen = others.filter((l) => l.order === 1 && el(l.to) === 'N')
    const halogen = others.find((l) => HALOGENS.has(el(l.to)))
    if (acid) {
      add('carboxylicAcid', [c, o, acid.to])
      used.add(o).add(acid.to)
    } else if (anion) {
      add('carboxylate', [c, o, anion.to])
      used.add(o).add(anion.to)
    } else if (bridge) {
      const other = heavy(bridge.to).find((m) => m.to !== c && el(m.to) === 'C')!.to
      if (acyl(other)) {
        if (!anhydrideO.has(bridge.to)) {
          anhydrideO.add(bridge.to)
          add('anhydride', [c, o, bridge.to, other, doubleO(other)!])
        }
      } else {
        add('ester', [c, o, bridge.to])
      }
      used.add(o).add(bridge.to)
    } else if (halogen) {
      add('acylHalide', [c, o, halogen.to])
      used.add(o).add(halogen.to)
    } else if (nitrogen.length) {
      add('amide', [c, o, ...nitrogen.map((l) => l.to)])
      used.add(o)
      for (const l of nitrogen) used.add(l.to)
    } else if (H(c) >= 1) {
      add('aldehyde', [c, o])
      used.add(o)
    } else if (others.filter((l) => el(l.to) === 'C').length >= 2) {
      add('ketone', [c, o])
      used.add(o)
    }
  }
  // nitrilos y nitro
  for (let c = 0; c < n; c++) {
    if (el(c) !== 'C') continue
    const nTriple = heavy(c).find((l) => l.order === 3 && el(l.to) === 'N')
    if (nTriple) {
      add('nitrile', [c, nTriple.to])
      used.add(nTriple.to)
    }
  }
  for (let i = 0; i < n; i++) {
    if (el(i) !== 'N' || used.has(i)) continue
    const os = heavy(i).filter((l) => el(l.to) === 'O' && heavy(l.to).length === 1)
    if (os.length === 2 && os.some((l) => l.order === 2)) {
      add('nitro', [i, ...os.map((l) => l.to)])
      used.add(i)
      for (const l of os) used.add(l.to)
    }
  }
  // oxígeno: alcohol, fenol, éter
  for (let i = 0; i < n; i++) {
    if (el(i) !== 'O' || used.has(i) || mol.atoms[i].aromatic) continue
    const hv = heavy(i)
    if (hv.some((l) => l.order !== 1)) continue
    const carbons = hv.filter((l) => el(l.to) === 'C')
    if (hv.length === 1 && carbons.length === 1 && H(i) >= 1) {
      const c = carbons[0].to
      add(inArene.has(c) || mol.atoms[c].aromatic ? 'phenol' : 'alcohol', [i])
    } else if (hv.length === 2 && carbons.length === 2) {
      add('ether', [i])
    }
  }
  // aminas: N sin dobles enlaces, que no sea amida ni nitro
  for (let i = 0; i < n; i++) {
    if (el(i) !== 'N' || used.has(i) || mol.atoms[i].charge !== 0) continue
    const hv = heavy(i)
    if (hv.some((l) => l.order !== 1) || hv.some((l) => el(l.to) !== 'C')) continue
    if (hv.some((l) => heavy(l.to).some((m) => m.to !== i && m.order >= 2 && (el(m.to) === 'O' || el(m.to) === 'S')))) continue
    const k = hv.length
    if (k >= 1 && k <= 3) add(k === 1 ? 'amine1' : k === 2 ? 'amine2' : 'amine3', [i])
  }
  // azufre y halógenos
  for (let i = 0; i < n; i++) {
    if (el(i) === 'S' && H(i) >= 1 && heavy(i).length === 1 && el(heavy(i)[0].to) === 'C') add('thiol', [i])
    if (HALOGENS.has(el(i)) && !used.has(i) && heavy(i).length === 1 && el(heavy(i)[0].to) === 'C') add('halide', [i])
  }
  // enlaces C=C y C≡C fuera de los anillos aromáticos (también los conjugados escritos en Kekulé: cafeína, uracilo)
  const conjugated = mol.rings.filter((r) => r.every((a) => links[a].some((l) => l.order === 2) || (['N', 'O', 'S'].includes(el(a)) && links[a].every((l) => l.order === 1))))
  const inConjugated = (a: number, b: number): boolean => conjugated.some((r) => r.includes(a) && r.includes(b))
  for (const b of mol.bonds) {
    if (el(b.a) !== 'C' || el(b.b) !== 'C' || b.order === 1.5 || (inArene.has(b.a) && inArene.has(b.b)) || inConjugated(b.a, b.b)) continue
    if (b.order === 2) add('alkene', [b.a, b.b])
    else if (b.order === 3) add('alkyne', [b.a, b.b])
  }
  for (const ring of arenes) add('arene', ring)
  const rank = (k: FunctionalGroupKind): number => FUNCTIONAL_GROUP_KINDS.indexOf(k)
  return out.sort((x, y) => rank(x.kind) - rank(y.kind) || x.atoms[0] - y.atoms[0])
}

/**
 * Anillos de benceno, unidos en sistemas si se fusionan (naftaleno): 6 C escritos aromáticos (en minúscula, sin un =O
 * hacia fuera) o con tres dobles alternos. En un sistema fusionado escrito en Kekulé (naftaleno, antraceno) solo un
 * anillo tiene sus tres dobles; los demás cuentan si cada C tiene su C=C dentro del anillo o hacia un anillo ya aceptado.
 */
function areneRings(mol: SmilesMolecule, links: { to: number; order: number; aromatic: boolean }[][]): number[][] {
  const bond = (a: number, b: number): { order: number; aromatic: boolean } | undefined => links[a].find((l) => l.to === b)
  const six = mol.rings.filter((r) => r.length === 6 && r.every((a) => mol.atoms[a].element === 'C'))
  const written = (r: number[]): boolean =>
    r.every((a, k) => bond(a, r[(k + 1) % 6])?.aromatic) && r.every((a) => !links[a].some((l) => l.order === 2 && !mol.atoms[l.to].aromatic))
  const alternating = (r: number[]): boolean => {
    const orders = r.map((a, k) => bond(a, r[(k + 1) % 6])?.order ?? 0)
    return orders.filter((o) => o === 2).length === 3 && orders.every((o, k) => o + orders[(k + 1) % 6] === 3)
  }
  const benzene = six.filter((r) => written(r) || alternating(r))
  for (let grew = true; grew; ) {
    grew = false
    const accepted = new Set(benzene.flat())
    for (const r of six) {
      if (benzene.includes(r)) continue
      const own = new Set(r)
      const fused = r.every((a) => links[a].some((l) => l.order === 2 && mol.atoms[l.to].element === 'C' && (own.has(l.to) || accepted.has(l.to))))
      if (fused) (benzene.push(r), (grew = true))
    }
  }
  const systems: Set<number>[] = []
  for (const r of benzene) {
    const touching = systems.filter((s) => r.filter((a) => s.has(a)).length >= 2)
    const merged = new Set<number>(r)
    for (const s of touching) {
      for (const a of s) merged.add(a)
      systems.splice(systems.indexOf(s), 1)
    }
    systems.push(merged)
  }
  return systems.map((s) => [...s].sort((a, b) => a - b))
}

/** Palabras con las que la IA nombra cada grupo (español e inglés, sin tildes): para comprobar sus etiquetas. */
const LABEL_WORDS: Record<FunctionalGroupKind, readonly string[]> = {
  carboxylicAcid: ['acido carboxilico', 'carboxilo', 'carboxylic', 'carboxyl', 'cooh'],
  carboxylate: ['carboxilato', 'carboxylate'],
  anhydride: ['anhidrido', 'anhydride'],
  ester: ['ester'],
  acylHalide: ['haluro de acilo', 'halogenuro de acilo', 'acyl halide', 'acid chloride', 'cloruro de acilo'],
  amide: ['amida', 'amide', 'enlace peptidico', 'peptide bond'],
  aldehyde: ['aldehido', 'aldehyde', 'formilo', 'formyl'],
  ketone: ['cetona', 'ketone', 'carbonilo', 'carbonyl'],
  nitrile: ['nitrilo', 'nitrile', 'ciano', 'cyano'],
  nitro: ['nitro'],
  alcohol: ['alcohol', 'hidroxilo', 'hydroxyl', 'oh'],
  phenol: ['fenol', 'phenol', 'hidroxilo', 'hydroxyl'],
  ether: ['eter', 'ether'],
  amine1: ['amina', 'amine', 'amino'],
  amine2: ['amina', 'amine', 'amino'],
  amine3: ['amina', 'amine', 'amino'],
  thiol: ['tiol', 'thiol', 'sulfhidrilo', 'sulfhydryl'],
  halide: ['halogen', 'haluro', 'halide', 'haloalcano', 'haloalkane', 'derivado halogenado'],
  alkene: ['alqueno', 'alkene', 'doble enlace', 'double bond', 'vinilo', 'vinyl'],
  alkyne: ['alquino', 'alkyne', 'triple enlace', 'triple bond'],
  arene: ['areno', 'arene', 'benceno', 'benzene', 'fenilo', 'phenyl', 'anillo aromatico', 'aromatic ring', 'aromatico', 'aromatic']
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tipos de grupo que nombra una etiqueta («Éster», «grupo hidroxilo», «amine») o vacío si no es un grupo conocido. */
export function groupKindsForLabel(label: string): FunctionalGroupKind[] {
  const t = ` ${fold(label).replace(/[^a-z0-9]+/g, ' ')} `
  return FUNCTIONAL_GROUP_KINDS.filter((k) => LABEL_WORDS[k].some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `) || t.includes(` ${w}es `)))
}
