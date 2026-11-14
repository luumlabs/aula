// Lo que la IA necesita para escribir bien un bloque `structure` (fórmula estructural desde SMILES): la referencia
// completa de `block_reference("structure")` y la regla de la auditoría «lección de química orgánica sin ninguna
// estructura». En inglés (instrucciones para la IA), con los ejemplos en español como los cursos.
// Redacción inspirada en Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: src/patterns.ts.
import type { Block } from '@shared/schema'
import type { AuditProblem, Lang } from './audit'

export const STRUCTURE_REFERENCE = String.raw`# structure — 2D structural formula from SMILES (drawn by hand, like a textbook)
The app parses the SMILES, lays out rings and zigzag chains, draws the bonds stroke by stroke and lets the student hover every atom and explore the functional groups. Use it for every organic or biological molecule a lesson names: functional groups, homologous series, isomers, drugs, sugars, amino acids, nucleobases, polymers' repeating units. Its SHAPE in space is a ` + '`model3d`' + String.raw` (VSEPR, chirality in 3D).
{"type":"structure","title":"Aspirina","smiles":"CC(=O)OC1=CC=CC=C1C(=O)O","formula":"C9H8O4","alt":"Fórmula esquelética de la aspirina","caption":"md",
 "style":"skeletal|condensed|expanded",   (skeletal = line-angle like a textbook (default); condensed = every C written with its H («semidesarrollada»); expanded = every bond drawn, also C–H («desarrollada», ≤ 15 heavy atoms))
 "aromatic":"auto|circle|kekule",   (auto: benzene-like rings get a circle, the rest alternating double bonds)
 "groups":[{"atoms":[2,3,4],"label":"éster","md":"Une el ácido acético al fenol…","color":"blue"},{"atoms":[11,12,13],"label":"ácido carboxílico"}],
 "autoGroups":true,   (the app finds and names the functional groups itself: alcohol, phenol, ether, aldehyde, ketone, carboxylic acid, ester, amide, amines, nitrile, nitro, halide, alkene, alkyne, arene…)
 "notes":[{"atom":1,"text":"α"}],   (a tiny label next to an atom: α, δ+, C1, *)
 "steps":[{"md":"Primero, el éster…","group":"éster"},{"md":"Y el carbono α","atoms":[1]}],   (guided tour: each step circles a group (by label) or atoms and dims the rest; ≥ 2 steps)
 "showFormula":true}   (formula + molar mass under the drawing; several substances separated by "." get one formula each, so leave ` + '`formula`' + String.raw` out)
Reactions: "smiles":"CC(=O)O.OCC>>CC(=O)OCC.O" (reactants>>products; reactants>agents>products puts the agents' formulas over the arrow), "conditions":"H₂SO₄, calor","reversible":true (⇌). Atoms are numbered across the whole reaction.
Rules (the validator checks them):
- ALWAYS call chemistry {"action":"structure","input":"<smiles>"} first: it checks the SMILES, gives the molecular formula (copy it into ` + '`formula`' + String.raw`, which is cross-checked), the atoms numbered from 1 and the functional groups it recognises with their atom numbers.
- Hydrogens are implicit (ethanol = CCO, never CH3CH2OH); charges and unusual atoms go in brackets: [NH4+], [O-], [Na+], [13CH4]; R groups are * ([*:1] → R¹). Separate ions or molecules with "." ([Na+].[Cl-]).
- Atoms count from 1 in SMILES order, exactly as the tool lists them (unlike model3d bonds, which count from 0).
- Rings with an exocyclic C=O (caffeine, uracil, nucleobases): prefer the Kekulé SMILES (CN1C=NC2=C1C(=O)N(C(=O)N2C)C); lowercase only for benzene-like rings; pyrrole N–H is [nH].
- cis/trans from / and \ is drawn (F/C=C/F trans, F/C=C\F cis). Tetrahedral stereo (@, @@) is NOT drawn yet (no wedges): for R/S use model3d or explain it in the text.
- Bridged polycycles (norbornane, camphor, morphine, cubane) draw badly in 2D: use model3d with atoms or an image. At most 80 atoms (best ≤ 60).
- In an exercise prompt ("name it", "what is its molecular formula?", "which functional group?"), until the student answers the app hides the title, the formula and molar mass, the steps and the groups' names, and finds no autoGroups. So that the prompt doesn't give the answer away: don't name the molecule or its groups in ` + '`alt`' + String.raw` or ` + '`caption`' + String.raw` either (describe what is drawn), and use ` + '`groups`' + String.raw` there only to highlight the part the question points at.
Examples: functional groups (ethanol CCO, acetic acid CC(=O)O, acetone CC(=O)C, ethyl acetate CC(=O)OCC, methylamine CN, acetamide CC(=O)N), aromatics (benzene c1ccccc1, toluene Cc1ccccc1, phenol Oc1ccccc1), isomers (butane CCCC vs isobutane CC(C)C; but-2-ene C/C=C/C vs C/C=C\C), biomolecules (glucose ring OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O, alanine C[C@@H](C(=O)O)N, caffeine), drugs (paracetamol CC(=O)NC1=CC=C(C=C1)O, ibuprofen CC(C)CC1=CC=C(C=C1)C(C)C(=O)O), reactions (esterification, hydrogenation C=C.[H][H]>>CC, combustion).`

// MARK: Auditoría: química orgánica sin estructuras

/**
 * Nombres sistemáticos en español: la raíz del número de carbonos al principio de la palabra (tras sus prefijos), con
 * sus localizadores, y la terminación del grupo: metano, but-2-eno, buta-1,3-dieno, ciclohexano, 2-metilpropano,
 * propan-2-ol, propanona, ácido etanoico, metilamina. No basta con terminar en -eno o -ino: oxígeno, hidrógeno,
 * nitrógeno, terreno, veneno, camino o vitamina no son química orgánica.
 */
const LOCANTS = String.raw`(?:-\d+(?:,\d+)*-)?`
const IUPAC_NAME_ES = new RegExp(
  String.raw`\b(?:\d+(?:,\d+)*-)?(?:(?:di|tri|tetra)?(?:metil|etil|propil|butil|fenil|cloro|bromo|fluoro|yodo|nitro|amino|hidroxi)|ciclo|iso|neo)*` +
    String.raw`(?:(?:met|et|prop|but|pent|hex|hept|oct|non|dec)a?${LOCANTS}(?:di|tri)?(?:an|en|in)${LOCANTS}(?:o|ol|al|ona|oico|oato|amina)|(?:di|tri)?(?:metil|etil|propil|butil|fenil)amina)s?\b`,
  'gi'
)

/** Señales de química orgánica en el texto (fórmulas condensadas, grupos funcionales, nombres sistemáticos). */
const ORGANIC_SIGNALS: RegExp[] = [
  /\bCH[23]?\b|\bCOOH\b|\bCHO\b|\bNH2\b|—CH|–CH|-CH2-/g,
  /\b(alcohol(es)?|aldeh[ií]dos?|cetonas?|[ée]ster(es)?|aminas?|amidas?|grupos? funcional(es)?|is[óo]mer[oa]s?|benceno|hidrocarburos?|alquenos?|alquinos?|alcanos?|[ée]teres?|fenol(es)?|nitrilos?)\b/gi,
  /\b(aldehydes?|ketones?|esters?|amines?|amides?|functional groups?|isomers?|benzene|hydrocarbons?|alkenes?|alkynes?|alkanes?|ethers?|phenols?|nitriles?|carboxylic acids?)\b/gi,
  IUPAC_NAME_ES
]
/** Señales de que el contexto es química (para no confundir el alcohol de una lección de historia). */
const CHEM_CONTEXT = /\\ce\{|\bmol[ée]cul|\bcompuestos? org[áa]nic|\bqu[íi]mica org[áa]nica|\borganic chemistry|\bmolecule|\bcarbono\b|\bcarbon atom|\benlace (doble|triple|covalente)|\bdouble bond/i

function textOf(lesson: readonly Block[]): string {
  const parts: string[] = []
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === 'string') {
      if (v.length > 2) parts.push(v)
    } else if (depth < 5 && v && typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1)
  }
  for (const b of lesson) if (b.type !== 'image') walk(b, 0)
  return parts.join('\n')
}

/**
 * Una lección de química orgánica que nombra grupos funcionales, fórmulas condensadas o compuestos y no dibuja ninguna
 * estructura (ni un `model3d` con átomos): la IA tiene que enseñar la molécula, no solo nombrarla.
 */
export function organicStructureProblems(lesson: readonly Block[], lang: Lang): AuditProblem[] {
  if (lesson.some((b) => b.type === 'structure' || (b.type === 'model3d' && (b.atoms.length > 0 || !!b.formula)))) return []
  const text = textOf(lesson)
  if (!CHEM_CONTEXT.test(text)) return []
  const signals = ORGANIC_SIGNALS.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0)
  if (signals < 3) return []
  return [{
    forAI: 'lesson: it is organic chemistry (it names functional groups, condensed formulas or compounds) but draws no molecule. The student has to SEE the structure: add a `structure` block (SMILES; call chemistry {"action":"structure"} first and copy its formula) for the molecules this lesson is about, with their functional `groups` highlighted (or `autoGroups`: true), right where the text names them. See block_reference("structure").',
    forUser: lang === 'en' ? 'The lesson is about organic chemistry and draws no molecule.' : 'La lección es de química orgánica y no dibuja ninguna molécula.'
  }]
}
