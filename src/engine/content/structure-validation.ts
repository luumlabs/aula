// Validación del bloque `structure` (fórmula estructural desde SMILES): la SMILES se tiene que leer, casar con `formula`
// y dibujarse bien en plano; los grupos, notas y pasos apuntan a átomos que existen (desde 1). Mensajes en español para la
// IA que escribe el curso, con la ruta exacta y la pista para arreglarlo.
import type { Block, ContentIssue, IssueSeverity, StructureBlock } from '@shared/schema'
import { Formula, compositionsEqual } from '@engine/chem/formula'
import { detectFunctionalGroups, groupKindsForLabel } from '@engine/chem/functional-groups'
import {
  EXPANDED_MAX_HEAVY, SmilesError, heavyAtomCount, parseStructure, smilesComposition, smilesFormulaParts, type ParsedStructure, type SmilesComposition, type SmilesMolecule
} from '@engine/chem/smiles'
import { smilesErrorHint, smilesErrorMessage } from '@engine/chem/smiles-messages'
import { drawableStyles } from '@engine/chem/structure-depict'
import { layoutQuality, layoutStructure } from '@engine/chem/structure-layout'
import { GROUP_NAMES_ES, atomRange } from '@engine/chem/structure-tool'
import type { ContentValidator } from './validator'
import { latexIssues } from './tex'

const issue = (severity: IssueSeverity, path: string, message: string): ContentIssue => ({ severity, path, message })

/** Lee la SMILES de un bloque; undefined si no se puede (el error lo da el validador). */
function tryParse(smiles: string): ParsedStructure | SmilesError {
  try {
    return parseStructure(smiles)
  } catch (e) {
    if (e instanceof SmilesError) return e
    throw e
  }
}

/** ¿La fórmula escrita es la de esta composición (con su carga)? */
const sameFormula = (f: Formula, c: SmilesComposition): boolean => compositionsEqual(c.composition, f.composition) && c.charge === f.charge

/** La fórmula escrita: una o, para varias sustancias, varias separadas por comas («C4H10, C4H10»). undefined si no se entiende. */
function parseFormulas(text: string): Formula[] | undefined {
  try {
    return text.split(/\s*[,;]\s*/).filter(Boolean).map((t) => Formula.parse(t))
  } catch {
    return undefined
  }
}

/** «1 C, 2 C, 3 O…» (los primeros) para que la IA vea cómo se numeran. */
function numbering(mol: SmilesMolecule): string {
  const list = mol.atoms.slice(0, 16).map((a, i) => `${i + 1} ${a.element === '*' ? 'R' : a.element}`)
  return list.join(', ') + (mol.atoms.length > 16 ? '…' : '')
}

export function checkStructure(v: ContentValidator, s: StructureBlock, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  if (s.title) out.push(...latexIssues(s.title, path + '.title'))
  if (s.caption) out.push(...v.text(s.caption, path + '.caption', false))
  if (!s.alt.trim() && !s.caption?.trim()) out.push(issue('warning', path + '.alt', 'Falta `alt` o `caption`: describe la molécula para quien no la ve.'))
  if (!s.smiles.trim()) {
    out.push(issue('error', path + '.smiles', 'Falta la SMILES (`smiles`): por ejemplo "CCO" para el etanol. Compruébala antes con chemistry {"action":"structure"}.'))
    return out
  }
  const parsed = tryParse(s.smiles)
  if (parsed instanceof SmilesError) {
    const hint = smilesErrorHint(parsed.kind)
    out.push(issue('error', path + '.smiles', `SMILES no válida: ${smilesErrorMessage(parsed.kind, 'es')}${hint ? ' ' + hint : ''} Compruébala con chemistry {"action":"structure"}.`))
    return out
  }
  const mol = parsed.molecule
  const n = mol.atoms.length
  const reaction = parsed.species !== undefined
  if (n > 60) out.push(issue('warning', path + '.smiles', `${n} átomos es mucho para leerlo en un dibujo: muestra la parte que importa (con * para el resto) o usa una imagen.`))

  // fórmula esperada (de una sustancia; con varias separadas por «.», cada una lleva la suya)
  const parts = reaction ? [] : smilesFormulaParts(mol)
  const plain = (c: SmilesComposition): string => Formula.fromComposition(c.composition, c.charge).plainText
  if (s.formula !== undefined && !reaction) {
    const expected = parseFormulas(s.formula)
    if (!expected) out.push(issue('warning', path + '.formula', `No entiendo la fórmula «${s.formula}»: escríbela como C9H8O4 (o NH4^+ con carga).`))
    const whole = smilesComposition(mol)
    if (expected && parts.length > 1) {
      // varias sustancias: vale la de cada una (o la suma, como antes); si no, sobra
      const fits = (expected.length === 1 && sameFormula(expected[0], whole)) || expected.every((f) => parts.some((c) => c.generic || sameFormula(f, c)))
      if (!fits) out.push(issue('warning', path + '.formula', `La SMILES tiene ${parts.length} sustancias (${parts.map(plain).join(' · ')}) y \`formula\` dice ${s.formula}: quita \`formula\` (cada una lleva la suya debajo del dibujo).`))
    } else if (expected && !whole.generic && !(expected.length === 1 && sameFormula(expected[0], whole))) {
      out.push(issue('error', path + '.formula', `La SMILES da ${plain(whole)} y \`formula\` dice ${s.formula}: una de las dos está mal. Compruébala con chemistry {"action":"structure"} (copia su fórmula).`))
    }
  }
  if (s.formula === undefined && !reaction && parts.length === 1) out.push(issue('info', path + '.formula', 'Añade `formula` (la que da chemistry {"action":"structure"}) para que se compruebe la SMILES.'))

  // cómo sale el dibujo, en su estilo (la desarrollada lleva todos los H)
  const quality = layoutQuality(mol, layoutStructure(mol))
  if (quality.bridged) out.push(issue('warning', path + '.smiles', 'El dibujo 2D sale deformado (sistema con puentes): usa model3d con átomos o una imagen.'))
  else if (quality.deformed) out.push(issue('warning', path + '.smiles', 'El dibujo 2D sale con átomos encimados o enlaces cruzados: escribe la SMILES empezando por otro átomo (el dibujo sigue su orden) o usa model3d con átomos o una imagen.'))
  else if (s.style !== 'skeletal') {
    const styles = drawableStyles(mol, reaction)
    const name = s.style === 'expanded' ? 'desarrollada' : 'semidesarrollada'
    const fallback = styles.includes('condensed') ? 'semidesarrollada' : 'esquelética'
    if (reaction && s.style === 'expanded') out.push(issue('warning', path + '.style', `Las reacciones no se dibujan en fórmula desarrollada: se verá ${fallback}.`))
    else if (!styles.includes(s.style) && (s.style === 'condensed' || heavyAtomCount(mol) <= EXPANDED_MAX_HEAVY)) {
      out.push(issue('warning', path + '.style', `La fórmula ${name} de esta molécula sale con átomos encimados: se verá ${fallback}. Usa "style":"skeletal" o una molécula más sencilla.`))
    }
  }
  if (mol.atoms.some((a) => a.chirality)) out.push(issue('info', path + '.smiles', '@ y @@ (R/S) no se dibujan todavía (sin cuñas): si la estereoquímica importa, explícala en el texto o usa model3d.'))
  const exocyclic = mol.rings.some((r) => r.every((a) => mol.atoms[a].aromatic) && mol.bonds.some((b) => b.order === 2 && r.includes(b.a) !== r.includes(b.b)))
  if (exocyclic && s.aromatic === 'circle') out.push(issue('warning', path + '.aromatic', 'Un anillo con C=O hacia fuera (cafeína, uracilo) no es un benceno: quita `aromatic: "circle"` para que se dibuje en forma de Kekulé.'))
  if (s.style === 'expanded' && !reaction && heavyAtomCount(mol) > EXPANDED_MAX_HEAVY) out.push(issue('warning', path + '.style', `La fórmula desarrollada solo se dibuja hasta ${EXPANDED_MAX_HEAVY} átomos (sin contar H): se verá semidesarrollada.`))
  if (reaction && parsed.species) {
    const total = (side: 'reactant' | 'product'): string => parsed.species!.filter((x) => x.side === side).map((x) => Formula.fromComposition(smilesComposition(mol, x.atoms).composition).plainText).sort().join('+')
    const sum = (side: 'reactant' | 'product'): ReturnType<typeof smilesComposition> => smilesComposition(mol, parsed.species!.filter((x) => x.side === side).flatMap((x) => x.atoms))
    const [r, p] = [sum('reactant'), sum('product')]
    if (!compositionsEqual(r.composition, p.composition)) out.push(issue('info', path + '.smiles', `La reacción no está ajustada 1:1 (${total('reactant')} → ${total('product')}): pon la ecuación ajustada en el texto con \\ce{}.`))
  }

  // grupos, notas y pasos
  const outside = (atoms: number[]): number[] => atoms.filter((a) => a > n)
  const rangeHint = `Los átomos se cuentan desde 1 en el orden de la SMILES (${numbering(mol)}).`
  const detected = reaction ? [] : detectFunctionalGroups(mol)
  const labels = new Set<string>()
  s.groups.forEach((g, i) => {
    const gp = `${path}.groups[${i}]`
    if (!g.label.trim()) out.push(issue('error', gp + '.label', 'El grupo no tiene `label` (su nombre: «éster», «grupo hidroxilo»…).'))
    if (!g.atoms.length) out.push(issue('error', gp + '.atoms', `El grupo «${g.label}» no tiene átomos válidos. ${rangeHint}`))
    const bad = outside(g.atoms)
    if (bad.length) out.push(issue('error', gp + '.atoms', `El átomo ${bad.join(', ')} no existe (la molécula tiene ${n}). ${rangeHint}`))
    const key = g.label.trim().toLowerCase()
    if (key && labels.has(key)) out.push(issue('warning', gp + '.label', `Hay dos grupos llamados «${g.label}»: dales nombres distintos («éster 1», «éster 2») o júntalos.`))
    labels.add(key)
    if (g.md) out.push(...v.text(g.md, gp + '.md', false))
    // la etiqueta nombra un grupo que Aula reconoce: ¿está en esos átomos?
    const kinds = groupKindsForLabel(g.label)
    if (kinds.length && g.atoms.length && !bad.length && !reaction) {
      const atoms = new Set(g.atoms.map((a) => a - 1))
      const hit = detected.some((d) => kinds.includes(d.kind) && d.atoms.some((a) => atoms.has(a)))
      if (!hit) {
        const seen = detected.map((d) => `${GROUP_NAMES_ES[d.kind]} (${atomRange(d.atoms)})`).join(' · ')
        out.push(issue('info', gp + '.atoms', `«${g.label}» no coincide con ningún grupo de ese tipo en los átomos ${g.atoms.join(', ')}. Aula reconoce: ${seen || 'ninguno'}.`))
      }
    }
  })
  s.notes.forEach((note, i) => {
    if (note.atom > n) out.push(issue('error', `${path}.notes[${i}].atom`, `El átomo ${note.atom} no existe (la molécula tiene ${n}). ${rangeHint}`))
  })
  s.steps.forEach((st, i) => {
    const sp = `${path}.steps[${i}]`
    out.push(...v.text(st.md, sp + '.md'))
    if (st.group !== undefined && !s.groups.some((g) => g.label.trim().toLowerCase() === st.group!.trim().toLowerCase())) {
      out.push(issue('error', sp + '.group', `El paso apunta al grupo «${st.group}», que no está en \`groups\` (${s.groups.map((g) => `«${g.label}»`).join(', ') || 'no hay grupos'}).`))
    }
    const bad = outside(st.atoms ?? [])
    if (bad.length) out.push(issue('error', sp + '.atoms', `El átomo ${bad.join(', ')} no existe (la molécula tiene ${n}). ${rangeHint}`))
  })
  if (s.steps.length === 1) out.push(issue('warning', path + '.steps', 'Un recorrido guiado necesita al menos 2 pasos.'))
  return out
}

/**
 * Ejercicio con una sola estructura en el enunciado y respuesta química de fórmula: la clave debería ser su fórmula
 * (si no, seguramente la SMILES o la clave están mal).
 */
export function checkStructureFormulaKey(key: string, prompt: readonly Block[], path: string): ContentIssue[] {
  const structures = prompt.filter((b): b is Extract<Block, { type: 'structure' }> => b.type === 'structure')
  if (structures.length !== 1) return []
  const parsed = tryParse(structures[0].smiles)
  if (parsed instanceof SmilesError || parsed.species) return []
  let expected: Formula
  try {
    expected = Formula.parse(key)
  } catch {
    return []
  }
  // con varias sustancias («.»), la clave puede ser la de cualquiera de ellas
  const comps = [smilesComposition(parsed.molecule), ...smilesFormulaParts(parsed.molecule)]
  if (comps.some((c) => c.generic || compositionsEqual(c.composition, expected.composition))) return []
  const parts = smilesFormulaParts(parsed.molecule)
  const got = parts.map((c) => Formula.fromComposition(c.composition, c.charge).plainText).join(' · ')
  return [issue('warning', path + '.expected', `La estructura del enunciado es ${got} y la respuesta dice ${key}: si se pide su fórmula molecular, una de las dos está mal.`)]
}
