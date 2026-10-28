import { Fraction } from '../numbers/fraction'
import { INT_MAX } from '../numbers/int64'

/** Constantes reconocidas por el analizador. */
export type MathConstant = 'pi' | 'e' | 'tau' | 'inf'

/** Valor numérico de una constante. */
export function constantValue(c: MathConstant): number {
  switch (c) {
    case 'pi':
      return Math.PI
    case 'e':
      return Math.E
    case 'tau':
      return 2 * Math.PI
    case 'inf':
      return Infinity
  }
}

/** Operadores unarios. `factorial`, `percent` y `degree` son postfijos. */
export type UnaryOp = 'neg' | 'plus' | 'factorial' | 'percent' | 'degree'

/** Operadores binarios. */
export type BinaryOp = 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'mod'

/** Unidad en la que se interpretan los ángulos al evaluar funciones trigonométricas. */
export type AngleMode = 'radians' | 'degrees'

const DEGREE_WORDS = new Set([
  'degrees', 'degree', 'deg', 'degs', 'grados', 'grado', 'gradossexagesimales', 'sexagesimal', '°', 'º', 'degre', 'degres',
  'degré', 'degrés', 'gradi', 'grado°', 'graus', 'grau', 'градусы', 'градус', '度', '도',
])

/**
 * Lectura tolerante (las especificaciones suelen venir de una IA): «deg», «degree», «grados», «°», «DEG»… son grados;
 * «rad», «radian», «radianes»… y lo desconocido, radianes. «grad»/«grade» no cuentan: en las calculadoras son gradianes.
 * Un valor que no es texto es `radians`.
 */
export function angleModeLenient(raw: unknown): AngleMode {
  if (typeof raw !== 'string') return 'radians'
  const t = [...raw.toLowerCase()].filter((c) => /\p{Alphabetic}/u.test(c) || c === '°' || c === 'º').join('')
  return DEGREE_WORDS.has(t) ? 'degrees' : 'radians'
}

/** Tipo de error matemático. */
export type MathErrorKind =
  /** El texto no es una expresión válida. */
  | 'syntax'
  /** Función desconocida (puede traer sugerencia en el mensaje). */
  | 'unknownFunction'
  /** Falta el valor de una variable al evaluar. */
  | 'unknownVariable'
  /** Fuera del dominio (división entre cero, raíz de un negativo…). */
  | 'domain'
  /** Número o expresión demasiado grande / profunda. */
  | 'overflow'
  /** Cosa legítima pero no soportada. */
  | 'unsupported'

/** Error matemático con un mensaje apto para mostrar al estudiante (ya localizado; el texto base está en español). */
export class MathError extends Error {
  /** Tipo de error (sintaxis, dominio, desbordamiento…). */
  readonly kind: MathErrorKind
  /** Índice (en caracteres, como `Character` de Swift) dentro del texto original, si aplica. */
  readonly position: number | undefined

  constructor(kind: MathErrorKind, message: string, position?: number) {
    // Son errores esperados (dominio, sintaxis…), no fallos del programa: sin pila, que en el muestreo de los
    // verificadores (miles de evaluaciones fuera del dominio) costaba más que la propia evaluación.
    const ctor = Error as unknown as { stackTraceLimit?: number }
    const limit = ctor.stackTraceLimit
    ctor.stackTraceLimit = 0
    super(message)
    ctor.stackTraceLimit = limit
    this.name = 'MathError'
    this.kind = kind
    this.position = position
  }
}

// MARK: - Valores

/** Valor numérico: racional exacto o real aproximado. */
export type MathValue =
  | { readonly kind: 'rational'; readonly value: Fraction }
  | { readonly kind: 'real'; readonly value: number }

/** Utilidades de `MathValue`. */
export const MV = {
  /** Racional exacto. */
  rational(f: Fraction): MathValue {
    return { kind: 'rational', value: f }
  },
  /** Real aproximado. */
  real(d: number): MathValue {
    return { kind: 'real', value: d }
  },
  /** Entero exacto. */
  int(n: number | bigint): MathValue {
    return { kind: 'rational', value: Fraction.int(n) }
  },
  /** Valor como `number` (aproximado si es racional). */
  double(v: MathValue): number {
    return v.kind === 'rational' ? v.value.doubleValue : v.value
  },
  /** `true` si es un racional exacto. */
  isExact(v: MathValue): boolean {
    return v.kind === 'rational'
  },
  /** La fracción exacta, si el valor es racional. */
  fraction(v: MathValue): Fraction | null {
    return v.kind === 'rational' ? v.value : null
  },
  /** `true` si el valor es un entero (exacto, o real sin parte decimal). */
  isInteger(v: MathValue): boolean {
    return v.kind === 'rational' ? v.value.isInteger : Number.isFinite(v.value) && v.value === Math.round(v.value)
  },
  /** Valor entero si lo es y cabe en un `Int` (como `bigint`). */
  integerBig(v: MathValue): bigint | null {
    if (v.kind === 'rational') return v.value.isInteger ? v.value.num : null
    const d = v.value
    if (!Number.isFinite(d) || d !== Math.round(d) || Math.abs(d) >= 9e15) return null
    return BigInt(d)
  },
  /** Valor entero si lo es y cabe en un `Int` (como `number`). */
  integerValue(v: MathValue): number | null {
    const b = MV.integerBig(v)
    return b === null ? null : Number(b)
  },
  /** Igualdad estructural (como `Hashable` en Swift): racional con racional, real con real. */
  equals(a: MathValue | null | undefined, b: MathValue | null | undefined): boolean {
    if (!a || !b) return a === b
    if (a.kind === 'rational' && b.kind === 'rational') return a.value.equals(b.value)
    if (a.kind === 'real' && b.kind === 'real') return a.value === b.value
    return false
  },
  /** Texto de depuración. */
  describe(v: MathValue): string {
    return v.kind === 'rational' ? `rational(${v.value.plain})` : `real(${v.value})`
  },
} as const

/** Máximo de `Int` como `number` (para comparaciones aproximadas). */
export const INT_MAX_NUMBER = Number(INT_MAX)
