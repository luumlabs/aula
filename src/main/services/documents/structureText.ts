// Un bloque `structure` en un documento (Markdown, Word): la fórmula molecular (o la ecuación de la reacción) con mhchem, la
// SMILES para quien quiera volver a dibujarla, sus grupos con la explicación, el recorrido guiado y el pie. El dibujo sale
// en la impresión.
import type { BlockOf } from '@shared/schema'
import { Formula } from '@engine/chem/formula'
import { SmilesError, parseStructure, smilesComposition, smilesFormulaParts, type ParsedStructure } from '@engine/chem/smiles'

/** Fórmula de la molécula (una por sustancia: «C4H10, C4H10») o ecuación de la reacción (\ce{}), si la SMILES se lee. */
function formulaTex(b: BlockOf<'structure'>): string | undefined {
  let parsed: ParsedStructure
  try {
    parsed = parseStructure(b.smiles)
  } catch (e) {
    if (e instanceof SmilesError) return b.formula ? `\\ce{${b.formula}}` : undefined
    throw e
  }
  const mol = parsed.molecule
  const species = parsed.species
  if (!species) {
    const parts = smilesFormulaParts(mol)
    return parts.length ? `\\ce{${parts.map((c) => Formula.fromComposition(c.composition, c.charge).ceBody(false)).join(', ')}}` : undefined
  }
  const side = (which: 'reactant' | 'product'): string =>
    species
      .filter((s) => s.side === which)
      .map((s) => {
        const c = smilesComposition(mol, s.atoms)
        return Formula.fromComposition(c.composition, c.charge).ceBody(false)
      })
      .join(' + ')
  return `\\ce{${side('reactant')} ${b.reversible ? '<=>' : '->'} ${side('product')}}`
}

export interface StructureTextOptions {
  /** En el enunciado de un ejercicio: solo la SMILES y el pie (la fórmula, los grupos y el recorrido darían la respuesta). */
  inPrompt?: boolean
}

/** Texto del bloque bajo su rótulo («*[Fórmula estructural: Aspirina]*»). */
export function structureMarkdown(b: BlockOf<'structure'>, opts: StructureTextOptions = {}): string {
  const lines: string[] = []
  const tex = opts.inPrompt ? undefined : formulaTex(b)
  const head = [tex ? `$${tex}$` : undefined, b.smiles ? `SMILES: \`${b.smiles}\`` : undefined].filter(Boolean).join(' · ')
  if (head) lines.push(head)
  if (b.conditions) lines.push(`*${b.conditions}*`)
  const groups = opts.inPrompt ? [] : b.groups.filter((g) => g.label.trim())
  if (groups.length) lines.push(groups.map((g) => `- **${g.label}**` + (g.md ? `: ${g.md}` : '')).join('\n'))
  // el recorrido guiado, numerado (las líneas de cada paso, sangradas dentro de su número)
  const steps = opts.inPrompt ? [] : b.steps.filter((s) => s.md.trim())
  if (steps.length) lines.push(steps.map((s, i) => `${i + 1}. ${s.md.trim().replace(/\n/g, '\n   ')}`).join('\n'))
  if (b.caption) lines.push(`*${b.caption}*`)
  return lines.join('\n\n')
}
