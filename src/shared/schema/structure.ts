// Bloque `structure`: fórmula estructural 2D dibujada desde una SMILES (esquelética como en los libros, semidesarrollada
// o desarrollada), con grupos funcionales resaltados, notas en los átomos, pasos guiados y reacciones («A.B>>C.D»).
// Los átomos se numeran desde 1 en el orden de la SMILES (a diferencia de los enlaces de `model3d`, que van desde 0).
// Todos los campos nuevos son opcionales; una versión anterior de Aula conserva el JSON y muestra «necesita un Aula más nuevo».
import type { JSONObject } from '@engine/base/json'
import { bool, flexStr, isObj, list, prune, pickKeys, str, vFlexNum, vFlexStr, type Obj } from './coding'

export const STRUCTURE_STYLES = ['skeletal', 'condensed', 'expanded'] as const
export type StructureStyle = (typeof STRUCTURE_STYLES)[number]
export const STRUCTURE_AROMATIC = ['auto', 'circle', 'kekule'] as const
export type StructureAromatic = (typeof STRUCTURE_AROMATIC)[number]

/** Límites de lo que se guarda (lo demás se recorta al leer). */
export const STRUCTURE_LIMITS = { smiles: 500, groups: 12, notes: 30, steps: 30, atoms: 200 } as const

/** Grupo de átomos con nombre (un grupo funcional, el carbono quiral…): se resalta y se explica. */
export interface StructureGroup { atoms: number[]; label: string; color?: string; md?: string }
/** Nota pequeña junto a un átomo («α», «δ+», «C1»). */
export interface StructureNote { atom: number; text: string }
/** Paso guiado: rodea un grupo (por su nombre) o unos átomos y lo explica. */
export interface StructureStep { md: string; group?: string; atoms?: number[] }

export interface StructureBlock {
  /** La SMILES (o la reacción «reactivos>>productos»). */
  smiles: string
  title?: string
  caption?: string
  alt: string
  /** Fórmula molecular esperada («C9H8O4»): el validador la compara con la SMILES y sale si no se puede dibujar. */
  formula?: string
  style: StructureStyle
  /** Anillos aromáticos con círculo, en forma de Kekulé o según el anillo (auto). */
  aromatic: StructureAromatic
  groups: StructureGroup[]
  /** Resalta los grupos funcionales que reconoce Aula (además de `groups`). */
  autoGroups: boolean
  notes: StructureNote[]
  steps: StructureStep[]
  /** Muestra la fórmula molecular y la masa molar debajo (por defecto, sí). */
  showFormula: boolean
  /** Condiciones de una reacción (sobre la flecha). */
  conditions?: string
  /** Reacción reversible (⇌). */
  reversible: boolean
}

const STYLE_ALIASES: Record<string, StructureStyle> = {
  skeletal: 'skeletal', line: 'skeletal', lineangle: 'skeletal', esqueletal: 'skeletal', esqueleto: 'skeletal', topologica: 'skeletal', topológica: 'skeletal',
  condensed: 'condensed', full: 'condensed', semidesarrollada: 'condensed', condensada: 'condensed', semi: 'condensed',
  expanded: 'expanded', desarrollada: 'expanded', lewis: 'expanded', displayed: 'expanded'
}

/** Estilo a partir de lo que escriba la IA («semidesarrollada», «full», «line-angle»…). */
export function structureStyleOf(raw: string | undefined): StructureStyle | undefined {
  return raw === undefined ? undefined : STYLE_ALIASES[raw.toLowerCase().replace(/[\s_-]/g, '')]
}

/** Números de átomo válidos (enteros desde 1; también como texto: «3»). Uno solo vale como lista de uno. */
export function structureAtoms(v: unknown): number[] {
  const raw = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
  const out: number[] = []
  for (const x of raw.slice(0, STRUCTURE_LIMITS.atoms)) {
    const n = vFlexNum(x)
    if (n !== undefined && Number.isInteger(n) && n > 0 && n <= 10_000 && !out.includes(n)) out.push(n)
  }
  return out
}

function decodeGroup(raw: unknown): StructureGroup | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  return prune({ atoms: structureAtoms(c.atoms), label: flexStr(c, 'label') ?? flexStr(c, 'name') ?? '', color: str(c, 'color'), md: str(c, 'md') ?? str(c, 'detail') })
}

function decodeNote(raw: unknown): StructureNote | undefined {
  if (!isObj(raw)) return undefined
  const atom = structureAtoms(raw.atom)[0]
  const text = vFlexStr(raw.text) ?? vFlexStr(raw.label)
  return atom === undefined || !text ? undefined : { atom, text }
}

function decodeStep(raw: unknown): StructureStep | undefined {
  if (typeof raw === 'string') return { md: raw }
  if (!isObj(raw)) return undefined
  const atoms = structureAtoms(raw.atoms)
  return prune({ md: flexStr(raw, 'md') ?? flexStr(raw, 'text') ?? '', group: flexStr(raw, 'group'), atoms: atoms.length ? atoms : undefined })
}

export function decodeStructure(raw: unknown, d = 0): StructureBlock | undefined {
  if (!isObj(raw)) return undefined
  const c: Obj = raw
  const smiles = (flexStr(c, 'smiles') ?? '').trim().slice(0, STRUCTURE_LIMITS.smiles)
  const aromaticRaw = str(c, 'aromatic')?.toLowerCase()
  return prune({
    smiles, title: str(c, 'title'), caption: str(c, 'caption'), alt: flexStr(c, 'alt') ?? '', formula: flexStr(c, 'formula'),
    style: structureStyleOf(str(c, 'style')) ?? (bool(c, 'full') ? 'condensed' : 'skeletal'),
    aromatic: (STRUCTURE_AROMATIC as readonly string[]).includes(aromaticRaw ?? '') ? (aromaticRaw as StructureAromatic) : 'auto',
    groups: list(c, 'groups', decodeGroup, d).slice(0, STRUCTURE_LIMITS.groups), autoGroups: bool(c, 'autoGroups') ?? false,
    notes: list(c, 'notes', decodeNote, d).slice(0, STRUCTURE_LIMITS.notes), steps: list(c, 'steps', decodeStep, d).slice(0, STRUCTURE_LIMITS.steps),
    showFormula: bool(c, 'showFormula') ?? true, conditions: str(c, 'conditions'), reversible: bool(c, 'reversible') ?? false
  })
}

export function encodeStructure(v: StructureBlock): JSONObject {
  const out = pickKeys(v, ['title', 'smiles', 'formula', 'alt', 'caption'])
  if (v.style !== 'skeletal') out.style = v.style
  if (v.aromatic !== 'auto') out.aromatic = v.aromatic
  if (v.groups.length) out.groups = v.groups.map((g) => pickKeys(g, ['atoms', 'label', 'color', 'md']))
  if (v.autoGroups) out.autoGroups = true
  if (v.notes.length) out.notes = v.notes.map((n) => pickKeys(n, ['atom', 'text']))
  if (v.steps.length) out.steps = v.steps.map((s) => pickKeys(s, ['md', 'group', 'atoms']))
  if (!v.showFormula) out.showFormula = false
  if (v.conditions !== undefined) out.conditions = v.conditions
  if (v.reversible) out.reversible = true
  return out
}

/** Una estructura vacía con estos campos (para la galería y las pruebas). */
export function makeStructure(p: Partial<StructureBlock> = {}): StructureBlock {
  return { smiles: '', alt: '', style: 'skeletal', aromatic: 'auto', groups: [], autoGroups: false, notes: [], steps: [], showFormula: true, reversible: false, ...p }
}

// MARK: Nombres de tipo y reencaminado

/** Claves con las que la IA escribe la SMILES. */
export const SMILES_KEYS = ['smiles', 'SMILES', 'smile', 'canonicalSmiles', 'isomericSmiles', 'canonical_smiles', 'isomeric_smiles'] as const

/**
 * «molecule» y «molecular» son `model3d`, salvo que el bloque traiga una SMILES y nada en 3D (átomos con coordenadas,
 * sólidos, gráfica o archivo): entonces es una fórmula estructural. Lo usan la lectura del bloque y el normalizador.
 */
export function routeStructureType(type: string, rawType: string, c: Readonly<Record<string, unknown>>): string {
  if (type !== 'model3d') return type
  const raw = rawType.toLowerCase().replace(/[_\- ]/g, '')
  if (raw !== 'molecule' && raw !== 'molecular') return type
  const smiles = SMILES_KEYS.some((k) => typeof c[k] === 'string' && (c[k] as string).trim() !== '')
  const threeD = ['atoms', 'solids', 'solid', 'graph', 'asset', 'surfaces', 'surface', 'curves', 'vectors'].some((k) => c[k] !== undefined)
  return smiles && !threeD ? 'structure' : type
}
