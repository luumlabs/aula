// Acción «structure» de la herramienta «chemistry»: la IA comprueba una SMILES ANTES de escribirla en un bloque
// `structure` y recibe la fórmula molecular (para el campo `formula`), la masa molar, los átomos numerados desde 1 (para
// `groups`, `notes` y `steps`), los anillos, los grupos funcionales que se reconocen y los avisos de dibujo. Para la IA:
// en español y compacto.
import { AtomKey, Formula, compositionsEqual, type Composition } from './formula'
import { detectFunctionalGroups, type FunctionalGroupKind } from './functional-groups'
import { EXPANDED_MAX_HEAVY, SmilesError, heavyAtomCount, parseStructure, smilesComposition, smilesFormulaParts, type SmilesMolecule } from './smiles'
import { smilesErrorHint, smilesErrorMessage } from './smiles-messages'
import { drawableStyles } from './structure-depict'
import { layoutQuality, layoutStructure } from './structure-layout'
import type { ChemToolResult } from './types'

/** Nombres de los grupos funcionales en español (para la IA). */
export const GROUP_NAMES_ES: Readonly<Record<FunctionalGroupKind, string>> = {
  carboxylicAcid: 'ácido carboxílico', carboxylate: 'carboxilato', anhydride: 'anhídrido', ester: 'éster', acylHalide: 'haluro de acilo',
  amide: 'amida', aldehyde: 'aldehído', ketone: 'cetona', nitrile: 'nitrilo', nitro: 'nitro', alcohol: 'alcohol', phenol: 'fenol', ether: 'éter',
  amine1: 'amina primaria', amine2: 'amina secundaria', amine3: 'amina terciaria', thiol: 'tiol', halide: 'derivado halogenado',
  alkene: 'alqueno (C=C)', alkyne: 'alquino (C≡C)', arene: 'anillo aromático (areno)'
}

/** Átomos como rango legible («5–10» si son seguidos; si no, «2, 3, 4»). Desde 1. */
export function atomRange(atoms: readonly number[]): string {
  const s = [...atoms].map((a) => a + 1).sort((x, y) => x - y)
  if (s.length > 2 && s.every((v, i) => i === 0 || v === s[i - 1] + 1)) return `${s[0]}–${s[s.length - 1]}`
  return s.join(', ')
}

/** Un átomo como lo lee la IA: «CH3», «OH», «N+», «c» (aromático), «R». */
function atomText(mol: SmilesMolecule, i: number): string {
  const a = mol.atoms[i]
  const sym = a.element === '*' ? 'R' : a.aromatic ? a.element.toLowerCase() : a.element
  const h = mol.hydrogens[i]
  const q = a.charge === 0 ? '' : (Math.abs(a.charge) > 1 ? String(Math.abs(a.charge)) : '') + (a.charge > 0 ? '+' : '-')
  return `${a.isotope ?? ''}${sym}${h ? 'H' + (h > 1 ? h : '') : ''}${q}`
}

const formulaOf = (c: { composition: Composition; charge: number }): Formula => Formula.fromComposition(c.composition, c.charge)

/** Informe de una SMILES (o de una reacción «A.B>>C.D») para la IA. Nunca lanza. */
export function structureInfo(input: string): ChemToolResult {
  let parsed
  try {
    parsed = parseStructure(input)
  } catch (e) {
    if (!(e instanceof SmilesError)) return { ok: false, text: 'No pude leer la SMILES.' }
    const hint = smilesErrorHint(e.kind)
    return { ok: false, text: `SMILES no válida: ${smilesErrorMessage(e.kind, 'es')}${hint ? ' ' + hint : ''}` }
  }
  const mol = parsed.molecule
  const lines: string[] = [`SMILES válida: ${mol.source}`]
  let result: Pick<ChemToolResult, 'value' | 'unit' | 'latex'> = {}
  if (parsed.species) {
    const side = (which: 'reactant' | 'product' | 'agent'): Formula[] => parsed.species!.filter((s) => s.side === which).map((s) => formulaOf(smilesComposition(mol, s.atoms)))
    const reactants = side('reactant')
    const products = side('product')
    const agents = side('agent')
    const text = (fs: Formula[]): string => fs.map((f) => f.plainText).join(' + ')
    lines.push(`• Reacción: ${text(reactants)} → ${text(products)}${agents.length ? ` (agentes sobre la flecha: ${agents.map((f) => f.plainText).join(', ')})` : ''}`)
    const total = (fs: Formula[]): { composition: Composition; charge: number } => {
      const m = new Map<AtomKey, number>()
      let charge = 0
      for (const f of fs) {
        charge += f.charge
        for (const [k, n] of f.composition) m.set(k, (m.get(k) ?? 0) + n)
      }
      return { composition: m, charge }
    }
    const [r, p] = [total(reactants), total(products)]
    lines.push(compositionsEqual(r.composition, p.composition) && r.charge === p.charge
      ? '• Ajustada 1:1 (los mismos átomos a cada lado).'
      : '• No está ajustada 1:1 (en SMILES no hay coeficientes): escribe la ecuación ajustada en el texto con \\ce{} (compruébala con action balance).')
    result.latex = `\\ce{${reactants.map((f) => f.ceBody(false)).join(' + ')} -> ${products.map((f) => f.ceBody(false)).join(' + ')}}`
  } else {
    const parts = smilesFormulaParts(mol)
    if (parts.length > 1) {
      // varias sustancias con «.» (dos isómeros, un soluto y el agua): cada una con la suya, nunca una fórmula sumada
      const fs = parts.map(formulaOf)
      lines.push(`• ${parts.length} sustancias (separadas con «.»): ${fs.map((f, i) => `${f.plainText} (${parts[i].generic ? 'con R' : f.molarMassDetails().formatted})`).join(' · ')}`)
      lines.push('  Debajo del dibujo sale la fórmula de cada una. No pongas `formula` en el bloque: es para una sola sustancia.')
      result = { latex: `\\ce{${fs.map((f) => f.ceBody(false)).join(', ')}}` }
    } else if (parts.length === 1) {
      const comp = parts[0]
      const f = formulaOf(comp)
      const d = f.molarMassDetails()
      lines.push(`• Fórmula molecular: ${f.plainText} (${f.ce})${comp.generic ? ' — con R: es la fórmula del fragmento' : ''} · masa molar ${d.formatted}`)
      lines.push(`  Copia «${f.plainText}» en el campo \`formula\` del bloque structure.`)
      result = { value: d.value, unit: 'g/mol', latex: f.ce }
    } else {
      lines.push('• Solo grupos R: no tiene fórmula molecular.')
    }
  }
  lines.push(`• Átomos (numerados desde 1 en el orden de la SMILES; úsalos en groups, notes y steps): ${mol.atoms.map((_, i) => `${i + 1} ${atomText(mol, i)}`).join(' · ')}`)
  const multiple = mol.bonds.filter((b) => b.order === 2 || b.order === 3).map((b) => `${b.a + 1}${b.order === 2 ? '=' : '≡'}${b.b + 1}`)
  if (multiple.length) lines.push(`• Enlaces múltiples: ${multiple.join(', ')}`)
  if (mol.rings.length) {
    lines.push(`• Anillos: ${mol.rings.map((r) => `${r.length} átomos (${atomRange(r)})${r.every((a) => mol.atoms[a].aromatic) ? ', aromático' : ''}`).join('; ')}`)
  }
  const groups = detectFunctionalGroups(mol)
  if (groups.length) lines.push(`• Grupos funcionales que reconoce Aula: ${groups.map((g) => `${GROUP_NAMES_ES[g.kind]} (${atomRange(g.atoms)})`).join(' · ')}`)
  // avisos de dibujo
  const warn: string[] = []
  const q = layoutQuality(mol, layoutStructure(mol))
  if (q.bridged) warn.push('el dibujo 2D sale deformado (sistema con puentes): mejor model3d con átomos o una imagen')
  else if (q.deformed) warn.push('el dibujo 2D sale con átomos encimados: escribe la SMILES empezando por otro átomo o usa model3d con átomos o una imagen')
  else if (!parsed.species && heavyAtomCount(mol) <= EXPANDED_MAX_HEAVY && !drawableStyles(mol, false).includes('expanded')) {
    warn.push('la fórmula desarrollada (style expanded) sale con H encimados: no se ofrece; usa skeletal o condensed')
  }
  if (mol.atoms.some((a) => a.chirality)) warn.push('@ y @@ (R/S) no se dibujan todavía (sin cuñas): para estereoquímica usa model3d o explícalo en el texto')
  const exocyclic = mol.rings.some((r) => r.every((a) => mol.atoms[a].aromatic) && mol.bonds.some((b) => b.order === 2 && r.includes(b.a) !== r.includes(b.b)))
  if (exocyclic) warn.push('anillo aromático con C=O hacia fuera: se dibuja en forma de Kekulé (dobles alternos), no con círculo')
  if (mol.atoms.length > 60) warn.push(`${mol.atoms.length} átomos es mucho para leerlo: dibuja la parte que importa`)
  if (warn.length) lines.push(`• Avisos: ${warn.join('; ')}.`)
  return { ok: true, text: lines.join('\n'), ...result }
}
