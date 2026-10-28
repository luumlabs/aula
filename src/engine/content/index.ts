// Contenido de los cursos (port de StudyEngine/Content): validación con mensajes precisos para la IA, normalización del JSON
// que escribe la IA, motor de simulaciones, moléculas 3D (VSEPR), fichas de archivos y páginas de materiales como figura.
export { ContentValidator, clozeTexIssues, looksLikeWords, looksMathematical, pathTooDeep, type ValidatorOptions } from './validator'
export { courseDuplicateExercises, duplicateToDrop, exerciseFingerprint, type ExerciseDuplicate, type ExerciseRef } from './duplicates'
export { approximateDataIssues, approximationIn, hintRevealsBlankIssues } from './answer-hygiene'
export * from './visual-validation'
export { ContentNormalizer, boundedJSON, figurePart, looksNumeric, normalizeBlock, normalizeBlocks, normalizeCard, normalizeDeck, normalizeExercise, normalizeTemplate, optionID } from './normalizer'
export { SimulationEngine, type ResolvedSimObject, type SimulationProblem } from './simulation'
export { MoleculeBuilder, bondsByDistance, buildMolecule, covalentRadius, ELEMENT_SYMBOLS, geometryName, moleculeFor, parseFormula, type Molecule } from './molecules'
export * from './asset-meta'
export * from './source-page'
export { AULA_KATEX_MACROS, katexError, latexIssues, mathSpans, texProblems, texTooComplex, unbalancedBraces } from './tex'
