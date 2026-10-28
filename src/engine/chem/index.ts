// Motor de química (puro e isomorfo: sin Node ni DOM), portado de ChemKit de la app Swift. Lo usan la interfaz (tabla
// periódica, herramientas de química, corrector de ejercicios) y el proceso principal (herramienta «chemistry» de la IA).
//
// - Elementos: los 118 con sus datos IUPAC, búsquedas y nombres en los idiomas de la app; configuraciones electrónicas.
// - Fórmulas: análisis (hidratos, paréntesis, corchetes, cargas, isótopos, LaTeX, Unicode), masa molar y composición.
// - Ecuaciones: análisis, balanceo exacto (racionales con `bigint`), números de oxidación y redox.
// - Cálculos: cantidades y unidades, estequiometría, disoluciones, gases, pH y cifras significativas (pasos en español).
// - Nomenclatura en español (nombre ↔ fórmula, nunca inventa). Correctores para el alumno y herramientas para la IA.
// - Idioma: `setChemLanguage('en')` traduce los mensajes para el alumno; los pasos y los informes para la IA siguen en español.

// MARK: Elementos y configuraciones

export {
  ALL_ELEMENTS, ELEMENT_CATEGORIES, STANDARD_STATES, PeriodicTable, categoryIsMetal, categoryTitle, describeElement,
  localizedCategoryTitle, localizedElementName, localizedElementNameInSentence, localizedStateTitle, phaseAt, stateTitle,
} from './elements'
export type { AtomicWeight, Element, ElementCategory, NobleGasCore, PeriodicBlock, StandardState } from './elements'
export { ELEMENT_NAMES } from './element-l10n'
export { ElectronConfiguration, Subshell, electronConfiguration } from './electron-config'
export type { ConfigurationNotation, ConfigurationOrder } from './electron-config'

// MARK: Idioma y errores

export {
  CHEM_LANGUAGES, getChemLanguage, isDecimalComma, normalizeChemLanguage, phrasesAreSpanish, setChemDecimalComma, setChemLanguage,
} from './l10n'
export type { ChemLanguage } from './l10n'
export { ChemError, chemErrorMessage, errorMessage } from './errors'
export type { ChemErrorKind } from './errors'

// MARK: Fórmulas

export { Rational } from './rational'
export {
  AtomKey, Formula, PHYSICAL_STATES, compositionsEqual, isotopeMass, localizedPhysicalStateTitle, physicalStateTitle,
} from './formula'
export type {
  Composition, FormulaBracket, FormulaComparison, FormulaInit, FormulaNode, FormulaStyle, FormulaUnit, PhysicalState,
} from './formula'
export { FORMULA_MAX_DEPTH, FORMULA_MAX_LENGTH, FORMULA_MAX_SUBSCRIPT, parseFormula } from './parser'
export { EmpiricalFormula, molarMass, molarMassDetails, percentComposition } from './composition'
export type { EmpiricalResult, EmpiricalRow, MolarMassContribution, MolarMassResult, MolecularResult } from './composition'

// MARK: Ecuaciones, balanceo y redox

export { ChemicalEquation, EQUATION_MAX_LENGTH, effectiveCoefficient, makeTerm } from './equation'
export type { Arrow, EquationInit, Side, Term } from './equation'
export { EquationBalancer, balance, balanceEquation } from './balancer'
export type { BalanceMedium, BalanceResult, BalanceStatus } from './balancer'
export { OxidationStateReport, OxidationStates, redoxAnalysis, redoxAnalysisOf } from './redox'
export type { OxidationChange, OxidationEntry, OxidationSite, RedoxAnalysis } from './redox'

// MARK: Cantidades y cálculos

export {
  CHEM_UNITS, ChemQuantity, dimensionTitle, fromBase, localizedDimensionTitle, localizedUnitSymbol, makeCalculation, parseQuantityList,
  parseUnit, toBase, unitDimension, unitSymbol,
} from './quantity'
export type { ChemCalculation, ChemDimension, ChemUnit } from './quantity'
export { ChemConstants, Stoichiometry, convertQuantity, molesOf, parseAmountInput, solveStoichiometry } from './stoichiometry'
export type { AmountInput, SpeciesLine, StoichiometryReport } from './stoichiometry'
export { Gases, Solutions } from './solutions'
export { AcidBase } from './acid-base'
export type { PHResult } from './acid-base'
export { Measurement, SigFigCount, SigFigs, countSigFigs, parseWrittenNumber } from './sigfigs'
export type { WrittenNumber } from './sigfigs'

// MARK: Nomenclatura

export { Nomenclature, formulaForName, nameOf, nameOfText } from './nomenclature'
export type { CompoundName } from './nomenclature'
export { IonTable } from './ion-table'
export type { ChemIon, IonKind } from './ion-table'

// MARK: Formato de números y texto químico

export { andList, chargeText, compact, fixed, orList, roundToSignificant, scientific, significant, subscripted, superscripted, trimmed } from './text'
export type { NumberStyle } from './text'

// MARK: Correctores, herramientas de la IA y API para la interfaz

export { ChemChecker, checkElectronConfiguration, checkEquation, checkFormula, checkName, checkNumber } from './checker'
export type { ChemCheck, ChemCheckStatus, ChemToolResult } from './types'
export {
  CHEM_TOOL_SPECS, ChemTools, balanceInfo, convertInfo, electronConfigurationInfo, elementInfo, empiricalFormulaInfo, molarMassInfo,
  nameInfo, oxidationStatesInfo, pHInfo, redoxInfo, runChemTool, significantFiguresInfo, stoichiometryInfo,
} from './tools'
export type { ChemToolSpec, JsonSchemaObject } from './tools'
export { CHEMISTRY_ACTIONS, CHEMISTRY_TOOL, runChemistryTool } from './chemistry-tool'
export type { ChemistryAction, ChemistryToolOutput } from './chemistry-tool'
export {
  balanceSummary, chemFailure, chemKeyNumber, checkChemAnswer, elementCategories, molarMassBreakdown, searchElements,
} from './ui'
export type {
  BalanceSummary, BalancedSpecies, ChemAnswerKey, ChemAnswerMode, ChemFailure, ElementCategoryInfo, MolarMassBreakdown, MolarMassPart,
} from './ui'
