import type { AngleMode } from '../core/types'
import { EquationChecker } from './equation-checker'
import { ExpressionChecker } from './expression-checker'
import { IntervalChecker } from './interval-checker'
import { NumericChecker } from './numeric-checker'
import { DEFAULT_POINT_ABS_TOL, PointChecker } from './point-checker'
import { SetChecker } from './set-checker'
import { expressionSpec, numericSpec, textMatchOptions, type ExpressionSpec, type NumericSpec, type TextMatchOptions } from './specs'
import { TextChecker } from './text-checker'
import type { CheckVerdict } from './verdict'

/** Especificación numérica completa o solo con lo que cambia (el resto, por defecto). */
export type NumericSpecInput = NumericSpec | (Partial<NumericSpec> & { value: string })
/** Especificación algebraica completa o solo con lo que cambia (el resto, por defecto). */
export type ExpressionSpecInput = ExpressionSpec | (Partial<ExpressionSpec> & { expected: string })

/** Copia sin las claves `undefined` (para no tapar los valores por defecto). */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

function fullNumericSpec(s: NumericSpecInput): NumericSpec {
  const { value, ...rest } = s
  return numericSpec(value, definedOnly(rest))
}

function fullExpressionSpec(s: ExpressionSpecInput): ExpressionSpec {
  const { expected, ...rest } = s
  return expressionSpec(expected, definedOnly(rest))
}

/** Comprobación de respuestas. Ningún verificador lanza: todo problema se devuelve como `CheckVerdict`. */
export const AnswerChecker = {
  /** Comprueba una respuesta numérica (con unidad, forma, tolerancias y diagnóstico de errores típicos). */
  checkNumeric(input: string, spec: NumericSpecInput): CheckVerdict {
    return new NumericChecker(fullNumericSpec(spec)).check(input)
  },

  /**
   * Comprueba una respuesta algebraica: equivalencia numérica con la esperada, forma pedida (expandida, factorizada…),
   * funciones prohibidas y diagnóstico de errores típicos (signo, recíproco, factor constante…).
   */
  checkExpression(input: string, spec: ExpressionSpecInput): CheckVerdict {
    return new ExpressionChecker(fullExpressionSpec(spec)).check(input)
  },

  /**
   * Comprueba una ecuación: es correcta si tiene el mismo conjunto solución que la esperada
   * (`y=2x+1` ≡ `2x-y+1=0` ≡ `x=(y-1)/2`).
   */
  checkEquation(input: string, expected: string, variables: readonly string[] | null = null): CheckVerdict {
    return new EquationChecker(expected, variables).check(input)
  },

  /**
   * Comprueba un intervalo o unión de intervalos, comparándolos como conjuntos de la recta real.
   * Acepta `(−∞, 3] ∪ (5, ∞)`, `(-inf,3] U (5,inf)`, `x<3 o x>5`, `2 < x <= 7`, `x ≠ 3`, `{1, 2}`, `ℝ`, `∅`…
   */
  checkInterval(input: string, expected: string, angle: AngleMode = 'radians'): CheckVerdict {
    return new IntervalChecker(expected, angle).check(input)
  },

  /**
   * Comprueba un conjunto de valores (soluciones de una ecuación, una secuencia…). Acepta `1, 2, 3`, `{1;2;3}`,
   * `x=1 o x=2`, `±2`, `2±sqrt(3)`, `no solution`/`∅`. Con `ordered` el orden importa (y los repetidos cuentan).
   */
  checkSet(input: string, expected: readonly string[], ordered = false, angle: AngleMode = 'radians'): CheckVerdict {
    return new SetChecker(expected, ordered, angle).check(input)
  },

  /**
   * Comprueba un punto de 2 o 3 coordenadas: `(1, -2)`, `P = (1; -2)`, `x=1, y=-2`. `absTol` mayor que 1e-6 es un margen
   * absoluto del autor (lectura de una gráfica) que se acepta además de la igualdad normal.
   */
  checkPoint(input: string, expected: readonly string[], absTol: number = DEFAULT_POINT_ABS_TOL, angle: AngleMode = 'radians'): CheckVerdict {
    return new PointChecker(expected, absTol, angle).check(input)
  },

  /**
   * Comprueba una respuesta de texto: ignora mayúsculas, acentos, puntuación y artículos (configurable), tolera erratas
   * leves y puede dar crédito parcial por palabras clave. `rejected`: errores típicos conocidos del autor.
   */
  checkText(input: string, accepted: readonly string[], rejected: readonly string[] = [], options: Partial<TextMatchOptions> = {}): CheckVerdict {
    return new TextChecker(accepted, rejected, textMatchOptions(definedOnly(options))).check(input)
  },
}
