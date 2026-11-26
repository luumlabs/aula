// Biblioteca de moléculas con nombre para el bloque `structure` y la herramienta `chemistry`: permite escribir
// «glucose», «glucosa», «aspirin» o «ácido acético» en lugar de su SMILES (también en mezclas con «.» y reacciones
// con «>>»). Todas las SMILES están comprobadas por `parseSmiles`, fórmula molecular y calidad del dibujo 2D (sin
// sistemas con puentes deformados). Lógica pura e isomorfa.
// Idea del plan de figuras (#28), inspirada en Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs.

export type MoleculeCategory =
  | 'hydrocarbon'
  | 'functional'
  | 'aromatic'
  | 'aminoAcid'
  | 'sugar'
  | 'nucleobase'
  | 'bioactive'
  | 'inorganic'

export interface NamedMolecule {
  /** Identificador canónico en minúsculas (inglés). */
  id: string
  /** Nombre principal en inglés. */
  en: string
  /** Nombre principal en español. */
  es: string
  /** SMILES verificada (Kekulé para anillos con C=O exocíclico). */
  smiles: string
  /** Fórmula molecular esperada (comprobada en pruebas contra la SMILES). */
  formula: string
  category: MoleculeCategory
  /** Sinónimos en inglés y español (sin repetir `id`, `en` ni `es`). */
  aliases?: readonly string[]
}

export interface ResolvedMoleculeRef {
  input: string
  molecule: NamedMolecule
}

export interface ResolvedStructureInput {
  /** SMILES lista para `parseSmiles` / `parseStructure`. */
  smiles: string
  /** Moléculas que se tradujeron desde un nombre de la biblioteca (vacío si la entrada ya era SMILES). */
  resolved: ResolvedMoleculeRef[]
}

/**
 * Catálogo curado de moléculas habituales en química general, orgánica y bioquímica.
 * Ningún alias puede coincidir con una SMILES válida de otra sustancia (se comprueba en `molecule-library.test.ts`).
 */
export const MOLECULE_LIBRARY: readonly NamedMolecule[] = [
  // MARK: Hidrocarburos
  { id: 'methane', en: 'methane', es: 'metano', smiles: 'C', formula: 'CH4', category: 'hydrocarbon' },
  { id: 'ethane', en: 'ethane', es: 'etano', smiles: 'CC', formula: 'C2H6', category: 'hydrocarbon' },
  { id: 'propane', en: 'propane', es: 'propano', smiles: 'CCC', formula: 'C3H8', category: 'hydrocarbon' },
  { id: 'butane', en: 'butane', es: 'butano', smiles: 'CCCC', formula: 'C4H10', category: 'hydrocarbon', aliases: ['n-butane', 'n-butano'] },
  { id: 'isobutane', en: 'isobutane', es: 'isobutano', smiles: 'CC(C)C', formula: 'C4H10', category: 'hydrocarbon', aliases: ['2-methylpropane', '2-metilpropano', 'methylpropane', 'metilpropano'] },
  { id: 'pentane', en: 'pentane', es: 'pentano', smiles: 'CCCCC', formula: 'C5H12', category: 'hydrocarbon', aliases: ['n-pentane', 'n-pentano'] },
  { id: 'hexane', en: 'hexane', es: 'hexano', smiles: 'CCCCCC', formula: 'C6H14', category: 'hydrocarbon', aliases: ['n-hexane', 'n-hexano'] },
  { id: 'octane', en: 'octane', es: 'octano', smiles: 'CCCCCCCC', formula: 'C8H18', category: 'hydrocarbon', aliases: ['n-octane', 'n-octano'] },
  { id: 'ethene', en: 'ethene', es: 'eteno', smiles: 'C=C', formula: 'C2H4', category: 'hydrocarbon', aliases: ['ethylene', 'etileno'] },
  { id: 'propene', en: 'propene', es: 'propeno', smiles: 'CC=C', formula: 'C3H6', category: 'hydrocarbon', aliases: ['propylene', 'propileno'] },
  { id: 'ethyne', en: 'ethyne', es: 'etino', smiles: 'C#C', formula: 'C2H2', category: 'hydrocarbon', aliases: ['acetylene', 'acetileno'] },
  { id: 'butadiene', en: '1,3-butadiene', es: '1,3-butadieno', smiles: 'C=CC=C', formula: 'C4H6', category: 'hydrocarbon', aliases: ['butadiene', 'butadieno', 'buta-1,3-diene', 'buta-1,3-dieno'] },
  { id: 'cyclopropane', en: 'cyclopropane', es: 'ciclopropano', smiles: 'C1CC1', formula: 'C3H6', category: 'hydrocarbon' },
  { id: 'cyclobutane', en: 'cyclobutane', es: 'ciclobutano', smiles: 'C1CCC1', formula: 'C4H8', category: 'hydrocarbon' },
  { id: 'cyclopentane', en: 'cyclopentane', es: 'ciclopentano', smiles: 'C1CCCC1', formula: 'C5H10', category: 'hydrocarbon' },
  { id: 'cyclohexane', en: 'cyclohexane', es: 'ciclohexano', smiles: 'C1CCCCC1', formula: 'C6H12', category: 'hydrocarbon' },
  { id: 'cyclohexene', en: 'cyclohexene', es: 'ciclohexeno', smiles: 'C1=CCCCC1', formula: 'C6H10', category: 'hydrocarbon' },

  // MARK: Grupos funcionales habituales
  { id: 'methanol', en: 'methanol', es: 'metanol', smiles: 'CO', formula: 'CH4O', category: 'functional', aliases: ['methyl alcohol', 'alcohol metílico'] },
  { id: 'ethanol', en: 'ethanol', es: 'etanol', smiles: 'CCO', formula: 'C2H6O', category: 'functional', aliases: ['ethyl alcohol', 'alcohol etílico'] },
  { id: 'propanol', en: '1-propanol', es: '1-propanol', smiles: 'CCCO', formula: 'C3H8O', category: 'functional', aliases: ['propanol', 'propan-1-ol', 'n-propanol'] },
  { id: 'isopropanol', en: 'isopropanol', es: 'isopropanol', smiles: 'CC(O)C', formula: 'C3H8O', category: 'functional', aliases: ['2-propanol', 'propan-2-ol', 'isopropyl alcohol', 'alcohol isopropílico'] },
  { id: 'butanol', en: '1-butanol', es: '1-butanol', smiles: 'CCCCO', formula: 'C4H10O', category: 'functional', aliases: ['butanol', 'butan-1-ol', 'n-butanol'] },
  { id: 'ethylene-glycol', en: 'ethylene glycol', es: 'etilenglicol', smiles: 'OCCO', formula: 'C2H6O2', category: 'functional', aliases: ['ethane-1,2-diol', 'etano-1,2-diol'] },
  { id: 'glycerol', en: 'glycerol', es: 'glicerol', smiles: 'OCC(O)CO', formula: 'C3H8O3', category: 'functional', aliases: ['glycerin', 'glicerina', 'propane-1,2,3-triol'] },
  { id: 'diethyl-ether', en: 'diethyl ether', es: 'éter dietílico', smiles: 'CCOCC', formula: 'C4H10O', category: 'functional', aliases: ['ethoxyethane', 'etoxietano', 'ether', 'éter'] },
  { id: 'formaldehyde', en: 'formaldehyde', es: 'formaldehído', smiles: 'C=O', formula: 'CH2O', category: 'functional', aliases: ['methanal', 'metanal'] },
  { id: 'acetaldehyde', en: 'acetaldehyde', es: 'acetaldehído', smiles: 'CC=O', formula: 'C2H4O', category: 'functional', aliases: ['ethanal', 'etanal'] },
  { id: 'acetone', en: 'acetone', es: 'acetona', smiles: 'CC(=O)C', formula: 'C3H6O', category: 'functional', aliases: ['propanone', 'propanona', 'propan-2-one'] },
  { id: 'formic-acid', en: 'formic acid', es: 'ácido fórmico', smiles: 'C(=O)O', formula: 'CH2O2', category: 'functional', aliases: ['methanoic acid', 'ácido metanoico'] },
  { id: 'acetic-acid', en: 'acetic acid', es: 'ácido acético', smiles: 'CC(=O)O', formula: 'C2H4O2', category: 'functional', aliases: ['ethanoic acid', 'ácido etanoico'] },
  { id: 'propionic-acid', en: 'propionic acid', es: 'ácido propiónico', smiles: 'CCC(=O)O', formula: 'C3H6O2', category: 'functional', aliases: ['propanoic acid', 'ácido propanoico'] },
  { id: 'butyric-acid', en: 'butyric acid', es: 'ácido butírico', smiles: 'CCCC(=O)O', formula: 'C4H8O2', category: 'functional', aliases: ['butanoic acid', 'ácido butanoico'] },
  { id: 'oxalic-acid', en: 'oxalic acid', es: 'ácido oxálico', smiles: 'OC(=O)C(=O)O', formula: 'C2H2O4', category: 'functional', aliases: ['ethanedioic acid', 'ácido etanodioico'] },
  { id: 'lactic-acid', en: 'lactic acid', es: 'ácido láctico', smiles: 'CC(O)C(=O)O', formula: 'C3H6O3', category: 'functional', aliases: ['2-hydroxypropanoic acid', 'ácido 2-hidroxipropanoico'] },
  { id: 'pyruvic-acid', en: 'pyruvic acid', es: 'ácido pirúvico', smiles: 'CC(=O)C(=O)O', formula: 'C3H4O3', category: 'functional', aliases: ['pyruvate', 'piruvato'] },
  { id: 'malic-acid', en: 'malic acid', es: 'ácido málico', smiles: 'OC(CC(=O)O)C(=O)O', formula: 'C4H6O5', category: 'functional' },
  { id: 'citric-acid', en: 'citric acid', es: 'ácido cítrico', smiles: 'OC(=O)CC(O)(C(=O)O)CC(=O)O', formula: 'C6H8O7', category: 'functional', aliases: ['citrate', 'citrato'] },
  { id: 'methyl-acetate', en: 'methyl acetate', es: 'acetato de metilo', smiles: 'CC(=O)OC', formula: 'C3H6O2', category: 'functional', aliases: ['methyl ethanoate', 'etanoato de metilo'] },
  { id: 'ethyl-acetate', en: 'ethyl acetate', es: 'acetato de etilo', smiles: 'CC(=O)OCC', formula: 'C4H8O2', category: 'functional', aliases: ['ethyl ethanoate', 'etanoato de etilo'] },
  { id: 'methylamine', en: 'methylamine', es: 'metilamina', smiles: 'CN', formula: 'CH5N', category: 'functional', aliases: ['methanamine', 'metanamina'] },
  { id: 'ethylamine', en: 'ethylamine', es: 'etilamina', smiles: 'CCN', formula: 'C2H7N', category: 'functional', aliases: ['ethanamine', 'etanamina'] },
  { id: 'dimethylamine', en: 'dimethylamine', es: 'dimetilamina', smiles: 'CNC', formula: 'C2H7N', category: 'functional' },
  { id: 'trimethylamine', en: 'trimethylamine', es: 'trimetilamina', smiles: 'CN(C)C', formula: 'C3H9N', category: 'functional' },
  { id: 'acetamide', en: 'acetamide', es: 'acetamida', smiles: 'CC(=O)N', formula: 'C2H5NO', category: 'functional', aliases: ['ethanamide', 'etanamida'] },
  { id: 'urea', en: 'urea', es: 'urea', smiles: 'NC(=O)N', formula: 'CH4N2O', category: 'functional', aliases: ['carbamide', 'carbamida'] },
  { id: 'acetonitrile', en: 'acetonitrile', es: 'acetonitrilo', smiles: 'CC#N', formula: 'C2H3N', category: 'functional', aliases: ['ethanenitrile', 'etanonitrilo'] },
  { id: 'chloroform', en: 'chloroform', es: 'cloroformo', smiles: 'ClC(Cl)Cl', formula: 'CHCl3', category: 'functional', aliases: ['trichloromethane', 'triclorometano'] },
  { id: 'dichloromethane', en: 'dichloromethane', es: 'diclorometano', smiles: 'ClCCl', formula: 'CH2Cl2', category: 'functional', aliases: ['methylene chloride', 'cloruro de metileno'] },
  { id: 'dmso', en: 'dimethyl sulfoxide', es: 'dimetilsulfóxido', smiles: 'CS(=O)C', formula: 'C2H6OS', category: 'functional', aliases: ['dmso'] },

  // MARK: Aromáticos y heterociclos
  { id: 'benzene', en: 'benzene', es: 'benceno', smiles: 'c1ccccc1', formula: 'C6H6', category: 'aromatic' },
  { id: 'toluene', en: 'toluene', es: 'tolueno', smiles: 'Cc1ccccc1', formula: 'C7H8', category: 'aromatic', aliases: ['methylbenzene', 'metilbenceno'] },
  { id: 'phenol', en: 'phenol', es: 'fenol', smiles: 'Oc1ccccc1', formula: 'C6H6O', category: 'aromatic', aliases: ['hydroxybenzene', 'hidroxibenceno'] },
  { id: 'aniline', en: 'aniline', es: 'anilina', smiles: 'Nc1ccccc1', formula: 'C6H7N', category: 'aromatic', aliases: ['phenylamine', 'aminobenzene', 'fenilamina'] },
  { id: 'benzaldehyde', en: 'benzaldehyde', es: 'benzaldehído', smiles: 'O=Cc1ccccc1', formula: 'C7H6O', category: 'aromatic' },
  { id: 'benzoic-acid', en: 'benzoic acid', es: 'ácido benzoico', smiles: 'OC(=O)c1ccccc1', formula: 'C7H6O2', category: 'aromatic' },
  { id: 'salicylic-acid', en: 'salicylic acid', es: 'ácido salicílico', smiles: 'OC(=O)c1ccccc1O', formula: 'C7H6O3', category: 'aromatic' },
  { id: 'styrene', en: 'styrene', es: 'estireno', smiles: 'C=Cc1ccccc1', formula: 'C8H8', category: 'aromatic', aliases: ['vinylbenzene', 'vinilbenceno'] },
  { id: 'nitrobenzene', en: 'nitrobenzene', es: 'nitrobenceno', smiles: 'O=[N+]([O-])c1ccccc1', formula: 'C6H5NO2', category: 'aromatic' },
  { id: 'naphthalene', en: 'naphthalene', es: 'naftaleno', smiles: 'c1ccc2ccccc2c1', formula: 'C10H8', category: 'aromatic', aliases: ['naftalina'] },
  { id: 'anthracene', en: 'anthracene', es: 'antraceno', smiles: 'c1ccc2cc3ccccc3cc2c1', formula: 'C14H10', category: 'aromatic' },
  { id: 'pyridine', en: 'pyridine', es: 'piridina', smiles: 'c1ccncc1', formula: 'C5H5N', category: 'aromatic' },
  { id: 'pyrrole', en: 'pyrrole', es: 'pirrol', smiles: 'c1cc[nH]c1', formula: 'C4H5N', category: 'aromatic' },
  { id: 'furan', en: 'furan', es: 'furano', smiles: 'c1ccoc1', formula: 'C4H4O', category: 'aromatic' },
  { id: 'thiophene', en: 'thiophene', es: 'tiofeno', smiles: 'c1ccsc1', formula: 'C4H4S', category: 'aromatic' },
  { id: 'imidazole', en: 'imidazole', es: 'imidazol', smiles: 'c1c[nH]cn1', formula: 'C3H4N2', category: 'aromatic' },
  { id: 'indole', en: 'indole', es: 'indol', smiles: 'c1ccc2[nH]ccc2c1', formula: 'C8H7N', category: 'aromatic' },
  { id: 'pyrimidine', en: 'pyrimidine', es: 'pirimidina', smiles: 'c1cncnc1', formula: 'C4H4N2', category: 'aromatic' },
  { id: 'purine', en: 'purine', es: 'purina', smiles: 'c1ncc2[nH]cnc2n1', formula: 'C5H4N4', category: 'aromatic' },

  // MARK: Los 20 aminoácidos proteinogénicos
  { id: 'glycine', en: 'glycine', es: 'glicina', smiles: 'NCC(=O)O', formula: 'C2H5NO2', category: 'aminoAcid', aliases: ['gly', 'glicocola'] },
  { id: 'alanine', en: 'alanine', es: 'alanina', smiles: 'C[C@@H](C(=O)O)N', formula: 'C3H7NO2', category: 'aminoAcid', aliases: ['l-alanine', 'l-alanina', 'ala'] },
  { id: 'valine', en: 'valine', es: 'valina', smiles: 'CC(C)[C@@H](C(=O)O)N', formula: 'C5H11NO2', category: 'aminoAcid', aliases: ['l-valine', 'l-valina', 'val'] },
  { id: 'leucine', en: 'leucine', es: 'leucina', smiles: 'CC(C)C[C@@H](C(=O)O)N', formula: 'C6H13NO2', category: 'aminoAcid', aliases: ['l-leucine', 'l-leucina', 'leu'] },
  { id: 'isoleucine', en: 'isoleucine', es: 'isoleucina', smiles: 'CC[C@H](C)[C@@H](C(=O)O)N', formula: 'C6H13NO2', category: 'aminoAcid', aliases: ['l-isoleucine', 'l-isoleucina', 'ile'] },
  { id: 'proline', en: 'proline', es: 'prolina', smiles: 'OC(=O)[C@@H]1CCCN1', formula: 'C5H9NO2', category: 'aminoAcid', aliases: ['l-proline', 'l-prolina', 'pro'] },
  { id: 'phenylalanine', en: 'phenylalanine', es: 'fenilalanina', smiles: 'N[C@@H](Cc1ccccc1)C(=O)O', formula: 'C9H11NO2', category: 'aminoAcid', aliases: ['l-phenylalanine', 'l-fenilalanina', 'phe'] },
  { id: 'tyrosine', en: 'tyrosine', es: 'tirosina', smiles: 'N[C@@H](Cc1ccc(O)cc1)C(=O)O', formula: 'C9H11NO3', category: 'aminoAcid', aliases: ['l-tyrosine', 'l-tirosina', 'tyr'] },
  { id: 'tryptophan', en: 'tryptophan', es: 'triptófano', smiles: 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O', formula: 'C11H12N2O2', category: 'aminoAcid', aliases: ['l-tryptophan', 'l-triptófano', 'trp'] },
  { id: 'serine', en: 'serine', es: 'serina', smiles: 'N[C@@H](CO)C(=O)O', formula: 'C3H7NO3', category: 'aminoAcid', aliases: ['l-serine', 'l-serina', 'ser'] },
  { id: 'threonine', en: 'threonine', es: 'treonina', smiles: 'C[C@H](O)[C@@H](C(=O)O)N', formula: 'C4H9NO3', category: 'aminoAcid', aliases: ['l-threonine', 'l-treonina', 'thr'] },
  { id: 'cysteine', en: 'cysteine', es: 'cisteína', smiles: 'N[C@@H](CS)C(=O)O', formula: 'C3H7NO2S', category: 'aminoAcid', aliases: ['l-cysteine', 'l-cisteína', 'cys'] },
  { id: 'methionine', en: 'methionine', es: 'metionina', smiles: 'CSCC[C@@H](C(=O)O)N', formula: 'C5H11NO2S', category: 'aminoAcid', aliases: ['l-methionine', 'l-metionina', 'met'] },
  { id: 'asparagine', en: 'asparagine', es: 'asparagina', smiles: 'NC(=O)C[C@@H](C(=O)O)N', formula: 'C4H8N2O3', category: 'aminoAcid', aliases: ['l-asparagine', 'l-asparagina', 'asn'] },
  { id: 'glutamine', en: 'glutamine', es: 'glutamina', smiles: 'NC(=O)CC[C@@H](C(=O)O)N', formula: 'C5H10N2O3', category: 'aminoAcid', aliases: ['l-glutamine', 'l-glutamina', 'gln'] },
  { id: 'aspartic-acid', en: 'aspartic acid', es: 'ácido aspártico', smiles: 'OC(=O)C[C@@H](C(=O)O)N', formula: 'C4H7NO4', category: 'aminoAcid', aliases: ['aspartate', 'aspartato', 'l-aspartic acid', 'asp'] },
  { id: 'glutamic-acid', en: 'glutamic acid', es: 'ácido glutámico', smiles: 'OC(=O)CC[C@@H](C(=O)O)N', formula: 'C5H9NO4', category: 'aminoAcid', aliases: ['glutamate', 'glutamato', 'l-glutamic acid', 'glu'] },
  { id: 'lysine', en: 'lysine', es: 'lisina', smiles: 'NCCCC[C@@H](C(=O)O)N', formula: 'C6H14N2O2', category: 'aminoAcid', aliases: ['l-lysine', 'l-lisina', 'lys'] },
  { id: 'arginine', en: 'arginine', es: 'arginina', smiles: 'NC(=N)NCCC[C@@H](C(=O)O)N', formula: 'C6H14N4O2', category: 'aminoAcid', aliases: ['l-arginine', 'l-arginina', 'arg'] },
  { id: 'histidine', en: 'histidine', es: 'histidina', smiles: 'N[C@@H](Cc1c[nH]cn1)C(=O)O', formula: 'C6H9N3O2', category: 'aminoAcid', aliases: ['l-histidine', 'l-histidina', 'his'] },

  // MARK: Azúcares
  { id: 'glucose', en: 'glucose', es: 'glucosa', smiles: 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O', formula: 'C6H12O6', category: 'sugar', aliases: ['d-glucose', 'd-glucosa', 'beta-d-glucose', 'dextrose', 'dextrosa'] },
  { id: 'fructose', en: 'fructose', es: 'fructosa', smiles: 'OC[C@H]1O[C@](O)(CO)[C@@H](O)[C@@H]1O', formula: 'C6H12O6', category: 'sugar', aliases: ['d-fructose', 'd-fructosa'] },
  { id: 'galactose', en: 'galactose', es: 'galactosa', smiles: 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@H]1O', formula: 'C6H12O6', category: 'sugar', aliases: ['d-galactose', 'd-galactosa'] },
  { id: 'ribose', en: 'ribose', es: 'ribosa', smiles: 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H]1O', formula: 'C5H10O5', category: 'sugar', aliases: ['d-ribose', 'd-ribosa'] },
  { id: 'deoxyribose', en: 'deoxyribose', es: 'desoxirribosa', smiles: 'OC[C@H]1O[C@@H](O)C[C@@H]1O', formula: 'C5H10O4', category: 'sugar', aliases: ['2-deoxyribose', '2-desoxirribosa'] },
  { id: 'sucrose', en: 'sucrose', es: 'sacarosa', smiles: 'OC[C@H]1O[C@](CO)(O[C@H]2O[C@H](CO)[C@@H](O)[C@H](O)[C@H]2O)[C@@H](O)[C@@H]1O', formula: 'C12H22O11', category: 'sugar' },

  // MARK: Bases nitrogenadas (Kekulé donde hay C=O exocíclico)
  { id: 'adenine', en: 'adenine', es: 'adenina', smiles: 'Nc1ncnc2[nH]cnc12', formula: 'C5H5N5', category: 'nucleobase' },
  { id: 'guanine', en: 'guanine', es: 'guanina', smiles: 'NC1=NC2=C(NC=N2)C(=O)N1', formula: 'C5H5N5O', category: 'nucleobase' },
  { id: 'cytosine', en: 'cytosine', es: 'citosina', smiles: 'NC1=NC(=O)NC=C1', formula: 'C4H5N3O', category: 'nucleobase' },
  { id: 'thymine', en: 'thymine', es: 'timina', smiles: 'CC1=CNC(=O)NC1=O', formula: 'C5H6N2O2', category: 'nucleobase' },
  { id: 'uracil', en: 'uracil', es: 'uracilo', smiles: 'O=C1NC=CC(=O)N1', formula: 'C4H4N2O2', category: 'nucleobase' },

  // MARK: Fármacos, neurotransmisores y biomoléculas conocidas
  { id: 'aspirin', en: 'aspirin', es: 'aspirina', smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', formula: 'C9H8O4', category: 'bioactive', aliases: ['acetylsalicylic acid', 'ácido acetilsalicílico'] },
  { id: 'paracetamol', en: 'paracetamol', es: 'paracetamol', smiles: 'CC(=O)NC1=CC=C(C=C1)O', formula: 'C8H9NO2', category: 'bioactive', aliases: ['acetaminophen', 'acetaminofén', 'acetaminofeno'] },
  { id: 'ibuprofen', en: 'ibuprofen', es: 'ibuprofeno', smiles: 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O', formula: 'C13H18O2', category: 'bioactive' },
  { id: 'caffeine', en: 'caffeine', es: 'cafeína', smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', formula: 'C8H10N4O2', category: 'bioactive' },
  { id: 'nicotine', en: 'nicotine', es: 'nicotina', smiles: 'CN1CCC[C@H]1c2cccnc2', formula: 'C10H14N2', category: 'bioactive' },
  { id: 'dopamine', en: 'dopamine', es: 'dopamina', smiles: 'NCCc1ccc(O)c(O)c1', formula: 'C8H11NO2', category: 'bioactive' },
  { id: 'serotonin', en: 'serotonin', es: 'serotonina', smiles: 'NCCc1c[nH]c2ccc(O)cc12', formula: 'C10H12N2O', category: 'bioactive' },
  { id: 'adrenaline', en: 'adrenaline', es: 'adrenalina', smiles: 'CNC[C@H](O)c1ccc(O)c(O)c1', formula: 'C9H13NO3', category: 'bioactive', aliases: ['epinephrine', 'epinefrina'] },
  { id: 'histamine', en: 'histamine', es: 'histamina', smiles: 'NCCc1c[nH]cn1', formula: 'C5H9N3', category: 'bioactive' },
  { id: 'acetylcholine', en: 'acetylcholine', es: 'acetilcolina', smiles: 'CC(=O)OCC[N+](C)(C)C', formula: 'C7H16NO2^+', category: 'bioactive' },
  { id: 'gaba', en: 'GABA', es: 'GABA', smiles: 'NCCCC(=O)O', formula: 'C4H9NO2', category: 'bioactive', aliases: ['gamma-aminobutyric acid', 'ácido gamma-aminobutírico'] },
  { id: 'melatonin', en: 'melatonin', es: 'melatonina', smiles: 'COc1ccc2[nH]cc(CCNC(=O)C)c2c1', formula: 'C13H16N2O2', category: 'bioactive' },
  { id: 'vitamin-c', en: 'vitamin C', es: 'vitamina C', smiles: 'OC[C@H](O)[C@H]1OC(=O)C(O)=C1O', formula: 'C6H8O6', category: 'bioactive', aliases: ['ascorbic acid', 'ácido ascórbico'] },
  { id: 'cholesterol', en: 'cholesterol', es: 'colesterol', smiles: 'CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C', formula: 'C27H46O', category: 'bioactive' },
  { id: 'vanillin', en: 'vanillin', es: 'vainillina', smiles: 'COc1cc(C=O)ccc1O', formula: 'C8H8O3', category: 'bioactive' },
  { id: 'menthol', en: 'menthol', es: 'mentol', smiles: 'CC(C)[C@@H]1CC[C@@H](C)C[C@H]1O', formula: 'C10H20O', category: 'bioactive' },

  // MARK: Inorgánicas frecuentes
  { id: 'water', en: 'water', es: 'agua', smiles: 'O', formula: 'H2O', category: 'inorganic' },
  { id: 'ammonia', en: 'ammonia', es: 'amoníaco', smiles: 'N', formula: 'NH3', category: 'inorganic', aliases: ['amoniaco'] },
  { id: 'hydrogen-peroxide', en: 'hydrogen peroxide', es: 'peróxido de hidrógeno', smiles: 'OO', formula: 'H2O2', category: 'inorganic', aliases: ['agua oxigenada'] },
  { id: 'carbon-dioxide', en: 'carbon dioxide', es: 'dióxido de carbono', smiles: 'O=C=O', formula: 'CO2', category: 'inorganic' },
  { id: 'carbon-monoxide', en: 'carbon monoxide', es: 'monóxido de carbono', smiles: '[C-]#[O+]', formula: 'CO', category: 'inorganic' },
  { id: 'hydrogen', en: 'hydrogen', es: 'hidrógeno', smiles: '[H][H]', formula: 'H2', category: 'inorganic', aliases: ['dihydrogen', 'dihidrógeno'] },
  { id: 'oxygen', en: 'oxygen', es: 'oxígeno', smiles: 'O=O', formula: 'O2', category: 'inorganic', aliases: ['dioxygen', 'dioxígeno'] },
  { id: 'nitrogen', en: 'nitrogen', es: 'nitrógeno', smiles: 'N#N', formula: 'N2', category: 'inorganic', aliases: ['dinitrogen', 'dinitrógeno'] },
  { id: 'ozone', en: 'ozone', es: 'ozono', smiles: '[O-][O+]=O', formula: 'O3', category: 'inorganic' },
  { id: 'hydrochloric-acid', en: 'hydrochloric acid', es: 'ácido clorhídrico', smiles: 'Cl', formula: 'HCl', category: 'inorganic', aliases: ['hydrogen chloride', 'cloruro de hidrógeno'] },
  { id: 'sulfuric-acid', en: 'sulfuric acid', es: 'ácido sulfúrico', smiles: 'OS(=O)(=O)O', formula: 'H2SO4', category: 'inorganic' },
  { id: 'nitric-acid', en: 'nitric acid', es: 'ácido nítrico', smiles: 'O[N+](=O)[O-]', formula: 'HNO3', category: 'inorganic' },
  { id: 'phosphoric-acid', en: 'phosphoric acid', es: 'ácido fosfórico', smiles: 'OP(=O)(O)O', formula: 'H3PO4', category: 'inorganic' },
  { id: 'carbonic-acid', en: 'carbonic acid', es: 'ácido carbónico', smiles: 'OC(=O)O', formula: 'H2CO3', category: 'inorganic' },
  { id: 'hydrogen-sulfide', en: 'hydrogen sulfide', es: 'sulfuro de hidrógeno', smiles: 'S', formula: 'H2S', category: 'inorganic', aliases: ['ácido sulfhídrico'] }
]

/** Normaliza un nombre para buscarlo sin distinguir mayúsculas, tildes ni guiones/espacios repetidos. */
export function normalizeMoleculeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const INDEX: ReadonlyMap<string, NamedMolecule> = (() => {
  const map = new Map<string, NamedMolecule>()
  for (const m of MOLECULE_LIBRARY) {
    const names = [m.id, m.en, m.es, ...(m.aliases ?? [])]
    for (const n of names) {
      const key = normalizeMoleculeName(n)
      if (key && !map.has(key)) map.set(key, m)
    }
  }
  return map
})()

/** Busca una molécula por nombre en inglés o español (insensible a tildes, mayúsculas y guiones). */
export function lookupMolecule(name: string): NamedMolecule | undefined {
  const key = normalizeMoleculeName(name)
  return key ? INDEX.get(key) : undefined
}

/**
 * Resuelve una entrada que puede ser una SMILES, un nombre de la biblioteca («glucose», «ácido acético»), una mezcla
 * separada por «.» («glucose.fructose») o una reacción («ethanol.acetic acid>>ethyl acetate.water»).
 * Si algo no está en la biblioteca se deja intacto para que lo lea `parseSmiles` (conservando sus errores exactos).
 */
export function resolveStructureInput(input: string): ResolvedStructureInput {
  const trimmed = input.trim()
  if (!trimmed) return { smiles: '', resolved: [] }

  // 1) Coincidencia directa con un nombre completo («glucose», «ácido acético», «vitamin C»…)
  const direct = lookupMolecule(trimmed)
  if (direct) return { smiles: direct.smiles, resolved: [{ input: trimmed, molecule: direct }] }

  // 2) Reacción (A.B>C>D.E) o mezcla (A.B): resuelve cada componente por separado si coincide con la biblioteca
  if (trimmed.includes('>') || trimmed.includes('.')) {
    const resolved: ResolvedMoleculeRef[] = []
    const resolveSide = (side: string): string => {
      const s = side.trim()
      if (!s) return ''
      const whole = lookupMolecule(s)
      if (whole) {
        resolved.push({ input: s, molecule: whole })
        return whole.smiles
      }
      if (!s.includes('.')) return s
      return s
        .split('.')
        .map((part) => {
          const p = part.trim()
          const hit = p ? lookupMolecule(p) : undefined
          if (hit) {
            resolved.push({ input: p, molecule: hit })
            return hit.smiles
          }
          return p
        })
        .join('.')
    }
    if (trimmed.includes('>')) {
      const smiles = trimmed.split('>').map(resolveSide).join('>')
      return resolved.length ? { smiles, resolved } : { smiles: trimmed, resolved: [] }
    }
    const smiles = resolveSide(trimmed)
    return resolved.length ? { smiles, resolved } : { smiles: trimmed, resolved: [] }
  }

  return { smiles: trimmed, resolved: [] }
}

/** Busca moléculas parecidas por prefijo o subcadena (para sugerencias si la IA escribe mal un nombre). */
export function searchMolecules(query: string, limit = 5): NamedMolecule[] {
  const q = normalizeMoleculeName(query)
  if (q.length < 2) return []
  const prefix: NamedMolecule[] = []
  const sub: NamedMolecule[] = []
  for (const m of MOLECULE_LIBRARY) {
    const names = [m.en, m.es, ...(m.aliases ?? [])].map(normalizeMoleculeName)
    if (names.some((n) => n.startsWith(q))) prefix.push(m)
    else if (names.some((n) => n.includes(q))) sub.push(m)
  }
  return [...prefix, ...sub].slice(0, limit)
}
