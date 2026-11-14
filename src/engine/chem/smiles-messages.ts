// Mensajes de los errores de SMILES, en español y en inglés. Los ve el alumno (en el idioma de la interfaz, con
// `setChemLanguage`) y la IA que escribe el curso (siempre en español, desde el validador). Las posiciones y los átomos
// se cuentan desde 1, como los numera la herramienta «chemistry».
import { getChemLanguage } from './l10n'

export type SmilesErrorKind =
  | { type: 'empty' }
  | { type: 'tooLong'; limit: number }
  | { type: 'tooManyAtoms'; limit: number }
  | { type: 'unexpectedChar'; char: string; pos: number }
  | { type: 'looksLikeFormula'; pos: number }
  | { type: 'needsBrackets'; symbol: string; pos: number }
  | { type: 'danglingBond'; pos: number }
  | { type: 'branchWithoutAtom'; pos: number }
  | { type: 'unopenedBranch'; pos: number }
  | { type: 'unclosedBranch' }
  | { type: 'ringWithoutAtom'; pos: number }
  | { type: 'ringOnItself'; ring: number; pos: number }
  | { type: 'unclosedRing'; ring: number }
  | { type: 'badRingNumber'; pos: number }
  | { type: 'unclosedBracket'; pos: number }
  | { type: 'badBracketAtom'; text: string; pos: number }
  | { type: 'unknownElement'; symbol: string; pos: number }
  | { type: 'overValence'; atom: number; element: string; bonds: number; max: number }
  | { type: 'aromaticOutsideRing'; atom: number }
  | { type: 'duplicateBond'; a: number; b: number }
  | { type: 'notKekulizable'; atoms: number[] }
  | { type: 'reactionArrows' }
  | { type: 'reactionSide'; side: 'reactants' | 'products' }

type Lang = 'es' | 'en'

const atomList = (atoms: readonly number[]): string => atoms.slice(0, 8).join(', ') + (atoms.length > 8 ? '…' : '')

const ES: { [K in SmilesErrorKind['type']]: (k: Extract<SmilesErrorKind, { type: K }>) => string } = {
  empty: () => 'La SMILES está vacía.',
  tooLong: (k) => `La SMILES es demasiado larga (máximo ${k.limit} caracteres).`,
  tooManyAtoms: (k) => `La molécula es demasiado grande para dibujarla (máximo ${k.limit} átomos sin contar los H).`,
  unexpectedChar: (k) => `No entiendo «${k.char}» en la posición ${k.pos} de la SMILES.`,
  looksLikeFormula: (k) => `Hay una H suelta en la posición ${k.pos}: parece una fórmula condensada. En SMILES los hidrógenos no se escriben (etanol = CCO); si hace falta uno, va entre corchetes: [NH4+].`,
  needsBrackets: (k) => `«${k.symbol}» (posición ${k.pos}) tiene que ir entre corchetes, con su carga si la tiene: [${k.symbol}] o [${k.symbol}+].`,
  danglingBond: (k) => `El enlace de la posición ${k.pos} no une dos átomos.`,
  branchWithoutAtom: (k) => `La rama de la posición ${k.pos} empieza sin un átomo delante.`,
  unopenedBranch: (k) => `Sobra el «)» de la posición ${k.pos}: no se había abierto ninguna rama.`,
  unclosedBranch: () => 'Falta cerrar una rama: hay un «(» sin su «)».',
  ringWithoutAtom: (k) => `El número de anillo de la posición ${k.pos} no va detrás de ningún átomo.`,
  ringOnItself: (k) => `El anillo ${k.ring} se cierra en el mismo átomo que lo abre (posición ${k.pos}).`,
  unclosedRing: (k) => `El anillo ${k.ring} se abre y no se cierra: falta otro ${k.ring} más adelante.`,
  badRingNumber: (k) => `El número de anillo de la posición ${k.pos} está mal escrito: con «%» van dos cifras (%10).`,
  unclosedBracket: (k) => `El corchete de la posición ${k.pos} no se cierra.`,
  badBracketAtom: (k) => `No entiendo el átomo [${k.text}] (posición ${k.pos}). Se escribe así: [NH4+], [O-], [13CH4], [nH].`,
  unknownElement: (k) => `«${k.symbol}» (posición ${k.pos}) no es un elemento químico.`,
  overValence: (k) => `El átomo ${k.atom} (${k.element}) tiene ${k.bonds} enlaces y admite como mucho ${k.max}.`,
  aromaticOutsideRing: (k) => `El átomo ${k.atom} está en minúscula (aromático) pero no forma parte de ningún anillo.`,
  duplicateBond: (k) => `Los átomos ${k.a} y ${k.b} quedan unidos dos veces.`,
  notKekulizable: (k) => `El anillo aromático de los átomos ${atomList(k.atoms)} no puede tener enlaces dobles alternos: revisa las minúsculas o escribe [nH] en el N con hidrógeno (pirrol = c1cc[nH]c1).`,
  reactionArrows: () => 'Una reacción en SMILES se escribe reactivos>>productos (o reactivos>agentes>productos).',
  reactionSide: (k) => (k.side === 'reactants' ? 'Faltan los reactivos de la reacción.' : 'Faltan los productos de la reacción.')
}

const EN: typeof ES = {
  empty: () => 'The SMILES is empty.',
  tooLong: (k) => `The SMILES is too long (at most ${k.limit} characters).`,
  tooManyAtoms: (k) => `The molecule is too big to draw (at most ${k.limit} atoms, not counting H).`,
  unexpectedChar: (k) => `I don't understand “${k.char}” at position ${k.pos} of the SMILES.`,
  looksLikeFormula: (k) => `There is a bare H at position ${k.pos}: it looks like a condensed formula. SMILES leaves hydrogens out (ethanol = CCO); when one is needed it goes in brackets: [NH4+].`,
  needsBrackets: (k) => `“${k.symbol}” (position ${k.pos}) has to go in brackets, with its charge if it has one: [${k.symbol}] or [${k.symbol}+].`,
  danglingBond: (k) => `The bond at position ${k.pos} does not join two atoms.`,
  branchWithoutAtom: (k) => `The branch at position ${k.pos} starts without an atom before it.`,
  unopenedBranch: (k) => `The “)” at position ${k.pos} closes a branch that was never opened.`,
  unclosedBranch: () => 'A branch is not closed: there is a “(” without its “)”.',
  ringWithoutAtom: (k) => `The ring number at position ${k.pos} does not follow an atom.`,
  ringOnItself: (k) => `Ring ${k.ring} closes on the same atom that opens it (position ${k.pos}).`,
  unclosedRing: (k) => `Ring ${k.ring} is opened and never closed: another ${k.ring} is missing later on.`,
  badRingNumber: (k) => `The ring number at position ${k.pos} is badly written: “%” takes two digits (%10).`,
  unclosedBracket: (k) => `The bracket at position ${k.pos} is never closed.`,
  badBracketAtom: (k) => `I can't read the atom [${k.text}] (position ${k.pos}). It is written like this: [NH4+], [O-], [13CH4], [nH].`,
  unknownElement: (k) => `“${k.symbol}” (position ${k.pos}) is not a chemical element.`,
  overValence: (k) => `Atom ${k.atom} (${k.element}) has ${k.bonds} bonds and allows at most ${k.max}.`,
  aromaticOutsideRing: (k) => `Atom ${k.atom} is lowercase (aromatic) but is not part of any ring.`,
  duplicateBond: (k) => `Atoms ${k.a} and ${k.b} are joined twice.`,
  notKekulizable: (k) => `The aromatic ring of atoms ${atomList(k.atoms)} cannot have alternating double bonds: check the lowercase letters or write [nH] on the N that carries a hydrogen (pyrrole = c1cc[nH]c1).`,
  reactionArrows: () => 'A reaction in SMILES is written reactants>>products (or reactants>agents>products).',
  reactionSide: (k) => (k.side === 'reactants' ? 'The reaction has no reactants.' : 'The reaction has no products.')
}

/** Mensaje de un error de SMILES (por defecto en el idioma de ChemKit; cualquier idioma que no sea español, en inglés). */
export function smilesErrorMessage(kind: SmilesErrorKind, lang?: Lang): string {
  const l: Lang = lang ?? (getChemLanguage() === 'es' ? 'es' : 'en')
  const table = l === 'es' ? ES : EN
  return (table[kind.type] as (k: SmilesErrorKind) => string)(kind)
}

/** Pista para la IA (en español) de cómo arreglar cada error; vacía si el mensaje ya lo dice. */
export function smilesErrorHint(kind: SmilesErrorKind): string {
  switch (kind.type) {
    case 'looksLikeFormula': return 'Más ejemplos: ácido acético = CC(=O)O, benceno = c1ccccc1.'
    case 'needsBrackets': return 'Fuera de corchetes solo valen B C N O P S F Cl Br I (y sus minúsculas aromáticas b c n o p s).'
    case 'overValence': return 'Revisa los dobles enlaces o pon la carga entre corchetes ([N+], [O-]).'
    case 'unknownElement': return 'Los símbolos van con mayúscula y, si no son del subconjunto orgánico, entre corchetes ([Na+], [Fe+3]).'
    case 'notKekulizable':
    case 'aromaticOutsideRing': return 'Escribe la forma de Kekulé (C1=CC=CC=C1) si dudas de las minúsculas.'
    case 'unclosedRing':
    case 'ringOnItself':
    case 'duplicateBond': return 'Cada número de anillo aparece dos veces: donde se abre y donde se cierra (ciclohexano = C1CCCCC1).'
    case 'tooManyAtoms': return 'Dibuja solo la parte que importa (con * para el resto: R) o usa una imagen.'
    case 'reactionArrows':
    case 'reactionSide': return 'Ejemplo: CC(=O)O.OCC>>CC(=O)OCC.O (esterificación).'
    default: return ''
  }
}
