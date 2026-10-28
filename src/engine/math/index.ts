// MathKit (port de la app Swift anterior: Sources/MathKit): API PÚBLICA del motor matemático de Aula.
// Isomorfo y puro (sin `node:*` ni `electron`): lo usan la interfaz (calculadora, graficador, corrección al instante) y el
// proceso principal (validación del contenido, herramientas de la IA).
//
//   Analizar:      MathParser.parse / parseDetailed / parseEquation / parseRelation · normalizeText · NumberInput
//   Evaluar:       evaluate (exacto) · evaluateDouble · tryEvaluate · tryEvaluateDouble · Numerics · Statistics
//   Álgebra:       simplify · derivative · Polynomial · MathEquivalence.equivalent
//   Imprimir:      toPlain · toLatex · NumberFormat · UnitFormatting.latex
//   Corregir:      AnswerChecker.checkNumeric / checkExpression / checkEquation / checkInterval / checkSet / checkPoint / checkText
//   Plantillas:    TemplateEngine.sample / evaluate / render · TemplateInstantiator (services)
//   Servicios:     MathKitChecker (validación de contenido) · LiveCalculator (calculadora exacta de la IA y la app)

/** Información del módulo. */
export const MathKitInfo = { name: 'MathKit' } as const

// MARK: Núcleo
export {
  E, children, containsNode, exprEquals, exprKey, freeVariables, functionNames, isConstantExpr, nodeCount, substitute, treeDepth,
  usesIntegerOnlyFunctions, type Expr,
} from './core/expr'
export {
  INT_MAX_NUMBER, MV, MathError, angleModeLenient, constantValue,
  type AngleMode, type BinaryOp, type MathConstant, type MathErrorKind, type MathValue, type UnaryOp,
} from './core/types'
export { FunctionTable, specAccepts, specAllowsMultipleArgs, type FunctionSpec } from './core/functions'
export {
  formatMessage,
  getMathLanguage,
  MATH_LANGUAGES,
  MATH_MESSAGE_CATALOG,
  normalizeMathLanguage,
  setMathLanguage,
  setMathTranslator,
  tr as mathTr,
  type MathCatalogEntry,
  type MathLanguage,
  type MathTranslator,
} from './core/i18n'
export { StackGuard } from './core/stack-guard'
export { chars as mathChars, charCount as mathCharCount, editDistance, foldedLower } from './core/text'

// MARK: Números
export { Fraction, vulgarFractions } from './numbers/fraction'

// MARK: Análisis
export { MathParser, type ParseResult } from './parse/parser'
export { defaultParseOptions, splitLetters, type ParseOptions } from './parse/options'
export { MAX_EXPRESSION_LENGTH, NormalizedText, normalizeText } from './parse/normalizer'
export { NumberInput } from './parse/number-input'
export { GreekLetters } from './parse/greek'
export { convertTeX } from './parse/tex-import'

// MARK: Evaluación
export { evaluate, evaluateDouble, tryEvaluate, tryEvaluateDouble, type NumberEnv, type ValueEnv } from './eval/evaluate'
export { Numerics, roundHalfAwayFromZero, swiftPow } from './eval/numerics'
export { Statistics } from './eval/statistics'
export { Exact } from './eval/exact'

// MARK: Álgebra
export { simplify, piMultiple } from './algebra/simplify'
export { derivative } from './algebra/derivative'
export { Polynomial } from './algebra/polynomial'

// MARK: Formato e impresión
export { NumberFormat } from './format/number-format'
export { DecimalDigits, decimalString } from './format/decimal-digits'
export { realText, toPlain } from './print/plain'
export { latexVariable, toLatex } from './print/latex'

// MARK: Unidades
export { UnitTable, unitIsAffine, unitQuantityName, type Dimension, type UnitInfo } from './units/unit-table'

// MARK: Azar determinista y plantillas
export { DeterministicRNG, type Seed } from './random/rng'
export { TEMPLATE_PARSE_OPTIONS, TemplateEngine, conditionHolds, parseCondition, type Condition } from './template/engine'
export {
  decodeTemplateVar, decodeVarKind, encodeTemplateVar, encodeVarKind, makeTemplateContext,
  type TemplateContext, type TemplateVar, type VarKind,
} from './template/types'

// MARK: Corrección de respuestas
export { AnswerChecker, type ExpressionSpecInput, type NumericSpecInput } from './check/answer-checker'
export { MAX_INPUT_LENGTH, Verdict, type CheckVerdict, type Diagnosis, type VerdictStatus } from './check/verdict'
export {
  decodeExpressionSpec, decodeNumericSpec, decodeTextMatchOptions, expressionFormLenient, expressionSpec, numericFormLenient, numericSpec,
  textMatchOptions, unitModeLenient,
  type ExpressionForm, type ExpressionSpec, type NumericForm, type NumericSpec, type TextMatchOptions, type UnitMode,
} from './check/specs'
export {
  EquivalenceEngine, MathEquivalence, equivalenceConfig,
  type EquivalenceConfig, type EquivalenceOptions, type EquivalenceResult, type EquivalenceVerdict,
} from './check/equivalence'
export { DegreeLabel, ValueMatch, ValueReadings, type ValueReading } from './check/value-match'
export { AnswerVocabulary, AnswerWords } from './check/answer-words'
export { AnswerListReading, ListParsing } from './check/list-parsing'
export { NumericChecker, UnitFormatting, WrittenForm } from './check/numeric-checker'
export { ExpressionChecker, FormRules, type StripResult } from './check/expression-checker'
export { EquationBudget, EquationChecker, type EquationDecision, type FunctionLHS } from './check/equation-checker'
export { IntervalChecker, IntervalFailure, IntervalParsing, RealSet, type IntervalParseResult, type RealInterval } from './check/interval-checker'
export { SetChecker, isDecimalApproximation } from './check/set-checker'
export { DEFAULT_POINT_ABS_TOL, PointChecker } from './check/point-checker'
export { CONTRARY_PREFIXES, DASHES, NEGATION_PREFIXES, TextChecker } from './check/text-checker'

// MARK: Servicios (validación de contenido, plantillas, calculadora)
export {
  LiveCalculator, MathKitChecker, TemplateFailure, TemplateInstantiator,
  type CalcResult, type NumericKeyLike, type TemplateFailureKind, type TemplateSourceLike, type TemplateVarSpecLike,
} from './services'
