import { asObject, lenientBool, lenientDouble, lenientInt, lenientString, lenientStrings } from '../core/lenient'
import { angleModeLenient, type AngleMode } from '../core/types'

/** Forma en la que se debe escribir una respuesta numérica. */
export type NumericForm = 'any' | 'fraction' | 'reducedFraction' | 'integer' | 'decimal' | 'scientific' | 'percent' | 'mixedNumber'

/** Qué hacer con la unidad de una respuesta numérica. */
export type UnitMode = 'required' | 'optional' | 'ignore'

/** Forma pedida para una respuesta algebraica. */
export type ExpressionForm = 'any' | 'expanded' | 'factored' | 'simplified' | 'lowestTerms'

function normalizedRaw(s: string): string {
  return [...s.toLowerCase()].filter((c) => /[\p{Alphabetic}\p{N}]/u.test(c)).join('')
}

/** Lectura tolerante (español, inglés, sinónimos); lo desconocido es `any`. */
export function numericFormLenient(raw: unknown): NumericForm {
  switch (normalizedRaw(typeof raw === 'string' ? raw : 'any')) {
    case 'fraction': case 'fraccion': return 'fraction'
    case 'reducedfraction': case 'reduced': case 'lowestterms': case 'simplifiedfraction': case 'fraccionreducida': case 'irreducible': return 'reducedFraction'
    case 'integer': case 'int': case 'entero': return 'integer'
    case 'decimal': case 'decimals': return 'decimal'
    case 'scientific': case 'sci': case 'cientifica': case 'scientificnotation': return 'scientific'
    case 'percent': case 'percentage': case 'porcentaje': return 'percent'
    case 'mixednumber': case 'mixed': case 'mixto': case 'numeromixto': return 'mixedNumber'
    default: return 'any'
  }
}

/** Lectura tolerante (español, inglés); lo desconocido es `optional`. */
export function unitModeLenient(raw: unknown): UnitMode {
  switch (normalizedRaw(typeof raw === 'string' ? raw : 'optional')) {
    case 'required': case 'obligatoria': case 'obligatorio': return 'required'
    case 'ignore': case 'ignorar': case 'none': return 'ignore'
    default: return 'optional'
  }
}

/** Lectura tolerante (español, inglés, sinónimos); lo desconocido es `any`. */
export function expressionFormLenient(raw: unknown): ExpressionForm {
  switch (normalizedRaw(typeof raw === 'string' ? raw : 'any')) {
    case 'expanded': case 'expandida': case 'expand': case 'standard': return 'expanded'
    case 'factored': case 'factorizada': case 'factor': case 'factorised': return 'factored'
    case 'simplified': case 'simplificada': case 'simplify': return 'simplified'
    case 'lowestterms': case 'reduced': case 'irreducible': case 'enminimostérminos': case 'minimosterminos': return 'lowestTerms'
    default: return 'any'
  }
}

// MARK: - Especificaciones

/** Describe una respuesta numérica correcta y cómo se acepta. */
export interface NumericSpec {
  /** Expresión del valor correcto: `"3/4"`, `"sqrt(2)/2"`, `"-0.5"`. También `"DNE"`/`"undefined"` si es «no definido». */
  value: string
  /** Otros valores igualmente aceptables (p. ej. `"pi"` y `"-pi"`). */
  alternatives: string[]
  /** Tolerancias. 0/0 → por defecto: exacto si el valor y la entrada son racionales; si no, relativa 1e-6. */
  absTol: number
  /** Tolerancia relativa (0 = por defecto). */
  relTol: number
  /**
   * Si se indica, la entrada debe coincidir con el valor redondeado a ese número de decimales (±1 en el último dígito
   * da crédito parcial 0.5 con aviso de redondeo).
   */
  decimals: number | null
  /** Forma en que se debe escribir (fracción, decimal, porcentaje…). */
  form: NumericForm
  /** Unidad esperada: `"m/s"`, `"kJ/mol"`, `"°C"`… */
  unit: string | null
  /** Si la unidad es obligatoria, opcional o se ignora. */
  unitMode: UnitMode
  /** Ángulos de las funciones trigonométricas que escriba el estudiante. */
  angle: AngleMode
}

/** Especificación numérica con el valor correcto y las opciones por defecto (o las indicadas). */
export function numericSpec(value: string, overrides: Partial<Omit<NumericSpec, 'value'>> = {}): NumericSpec {
  return { value, alternatives: [], absTol: 0, relTol: 0, decimals: null, form: 'any', unit: null, unitMode: 'optional', angle: 'radians', ...overrides }
}

/** Lectura tolerante: números donde se esperan textos, enumerados en español, claves que faltan → valores por defecto. */
export function decodeNumericSpec(json: unknown): NumericSpec {
  const c = asObject(json)
  const value = c ? lenientString(c, 'value') : null
  if (!c || value === null) throw new Error('Falta «value»')
  const unit = lenientString(c, 'unit')
  return {
    value,
    alternatives: lenientStrings(c, 'alternatives') ?? [],
    absTol: lenientDouble(c, 'absTol') ?? 0,
    relTol: lenientDouble(c, 'relTol') ?? 0,
    decimals: lenientInt(c, 'decimals'),
    form: numericFormLenient(c.form),
    unit: unit === null || unit === '' ? null : unit,
    unitMode: unitModeLenient(c.unitMode),
    angle: angleModeLenient(c.angle),
  }
}

/** Describe una respuesta algebraica correcta. */
export interface ExpressionSpec {
  /** Expresión correcta (`"2x+1"`, `"sin(x)^2"`). */
  expected: string
  /** Variables de la respuesta (por defecto, las libres de `expected`). */
  variables: string[] | null
  /** Extremo inferior del intervalo del que se toman los puntos de prueba. */
  domainMin: number
  /** Extremo superior del intervalo de los puntos de prueba. */
  domainMax: number
  /** Número de puntos de prueba. */
  samples: number
  /** Forma pedida (expandida, factorizada, simplificada…). */
  form: ExpressionForm
  /** Funciones que no se pueden usar (p. ej. `["sqrt"]` para «sin radicales»). */
  forbiddenFunctions: string[]
  /** Unidad de los ángulos en las funciones trigonométricas. */
  angle: AngleMode
}

/** Especificación algebraica con la expresión correcta y las opciones por defecto (o las indicadas). */
export function expressionSpec(expected: string, overrides: Partial<Omit<ExpressionSpec, 'expected'>> = {}): ExpressionSpec {
  return { expected, variables: null, domainMin: -6, domainMax: 6, samples: 40, form: 'any', forbiddenFunctions: [], angle: 'radians', ...overrides }
}

/** Lectura tolerante: números donde se esperan textos, listas o textos sueltos, claves que faltan → valores por defecto. */
export function decodeExpressionSpec(json: unknown): ExpressionSpec {
  const c = asObject(json)
  const expected = c ? lenientString(c, 'expected') : null
  if (!c || expected === null) throw new Error('Falta «expected»')
  return {
    expected,
    variables: lenientStrings(c, 'variables'),
    domainMin: lenientDouble(c, 'domainMin') ?? -6,
    domainMax: lenientDouble(c, 'domainMax') ?? 6,
    samples: lenientInt(c, 'samples') ?? 40,
    form: expressionFormLenient(c.form),
    forbiddenFunctions: lenientStrings(c, 'forbiddenFunctions') ?? [],
    angle: angleModeLenient(c.angle),
  }
}

/** Opciones para comparar respuestas de texto. */
export interface TextMatchOptions {
  /** No distingue mayúsculas de minúsculas. */
  ignoreCase: boolean
  /** No distingue letras con y sin acento. */
  ignoreAccents: boolean
  /** Ignora la puntuación (`3,14` y `3.14` cuentan igual). */
  ignorePunctuation: boolean
  /**
   * Ignora artículos (el/la/los/las/un/una/the, le/les/der/das/il/um/uma…; «a», «an», «i», «o» solo al principio,
   * porque detrás son parte de la respuesta: «vitamina A», «tipo I»).
   */
  ignoreArticles: boolean
  /**
   * Tolera erratas: distancia de edición ≤ 1 si la palabra tiene ≥ 5 letras (≤ 2 si tiene ≥ 13), salvo que el cambio sea
   * de un prefijo contrario o de negación (endo/exo, hipo/hiper, af/ef, «a»+palabra…), que cambia el significado.
   */
  typoTolerance: boolean
  /** Si se dan, crédito parcial por fracción de palabras clave presentes (en cualquier orden). Sinónimos con `"a|b"`. */
  keywords: string[]
  /** Mínimo de palabras clave para tener algún crédito. */
  minKeywordsForCredit: number | null
}

/** Opciones por defecto (todo activado, sin palabras clave), con los cambios indicados. */
export function textMatchOptions(overrides: Partial<TextMatchOptions> = {}): TextMatchOptions {
  return {
    ignoreCase: true, ignoreAccents: true, ignorePunctuation: true, ignoreArticles: true, typoTolerance: true,
    keywords: [], minKeywordsForCredit: null, ...overrides,
  }
}

/** Lectura tolerante: booleanos como texto (`"sí"`, `"no"`), una palabra clave suelta como lista. */
export function decodeTextMatchOptions(json: unknown): TextMatchOptions {
  const c = asObject(json) ?? {}
  return {
    ignoreCase: lenientBool(c, 'ignoreCase') ?? true,
    ignoreAccents: lenientBool(c, 'ignoreAccents') ?? true,
    ignorePunctuation: lenientBool(c, 'ignorePunctuation') ?? true,
    ignoreArticles: lenientBool(c, 'ignoreArticles') ?? true,
    typoTolerance: lenientBool(c, 'typoTolerance') ?? true,
    keywords: lenientStrings(c, 'keywords') ?? [],
    minKeywordsForCredit: lenientInt(c, 'minKeywordsForCredit'),
  }
}
