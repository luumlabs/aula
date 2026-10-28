import { E, exprEquals, type Expr } from '../core/expr'
import { MV, type AngleMode, type MathValue } from '../core/types'
import { evaluate } from '../eval/evaluate'

/**
 * La igualdad numérica de todos los verificadores (números, conjuntos, puntos, intervalos, restricciones de plantillas):
 * relativa a la escala de los números, con un suelo absoluto diminuto solo cuando la clave es exactamente 0 (para el
 * ruido de coma flotante: sin(π) da 1.2e-16). Con la escala relativa, «0» nunca coincide con una clave distinta de 0.
 */
export const ValueMatch = {
  /** Margen absoluto cuando la clave es exactamente 0 (ruido de coma flotante de una expresión que vale 0). */
  zeroFloor: 1e-12,
  /** Tolerancia relativa entre reales (o entre un real y un racional): unas 6 cifras significativas. */
  realTolerance: 1e-6,
  /** Tolerancia relativa entre dos racionales: solo un decimal larguísimo frente a la fracción (0.3333333333333 ≈ 1/3). */
  rationalTolerance: 5e-11,

  /**
   * ¿`value` ≈ `key`? |value − key| ≤ rel·max(|value|, |key|); si la clave es exactamente 0, |value| ≤ `zeroFloor`.
   * No es simétrica a propósito: un `value` de 0 frente a una clave diminuta (6.63e-34) NO coincide.
   */
  close(value: number, key: number, rel: number): boolean {
    if (value === key) return true
    if (!Number.isFinite(value) || !Number.isFinite(key)) return false
    if (key === 0) return Math.abs(value) <= ValueMatch.zeroFloor
    return Math.abs(value - key) <= rel * Math.max(Math.abs(value), Math.abs(key))
  },

  /**
   * Igualdad por defecto de lo escrito (`value`) con la clave (`key`): exacta entre racionales (salvo un decimal
   * larguísimo frente a la fracción); si no, relativa con 1e-6.
   */
  equal(value: MathValue, key: MathValue): boolean {
    if (value.kind === 'rational' && key.kind === 'rational') {
      return value.value.equals(key.value) || ValueMatch.close(value.value.doubleValue, key.value.doubleValue, ValueMatch.rationalTolerance)
    }
    const x = MV.double(value)
    const y = MV.double(key)
    if (!Number.isFinite(x) && !Number.isNaN(x)) return x === y
    if (!Number.isFinite(y) && !Number.isNaN(y)) return x === y
    return ValueMatch.close(x, y, ValueMatch.realTolerance)
  },

  /** Igualdad entre dos valores sin clave (quitar repetidos, restricciones de plantillas): el suelo del 0 vale en los dos sentidos. */
  same(a: MathValue, b: MathValue): boolean {
    return ValueMatch.equal(a, b) || ValueMatch.equal(b, a)
  },
}

/**
 * «°» como etiqueta: en un ejercicio de ángulos la clave puede venir en grados SIN el símbolo («30», «150») y el
 * estudiante escribirlo CON él («30°, 150°»), o al revés. La «lectura en grados» quita el «°» de la raíz de cada valor
 * (`30°` → 30, `-45°` → -45) y deja todo lo demás igual. Los verificadores la prueban como segunda lectura solo si algún
 * lado lleva «°», y se quedan con la mejor.
 */
export const DegreeLabel = {
  /** ¿El texto lleva el símbolo de grados (o lo que el normalizador convierte en él)? */
  mentioned(text: string): boolean {
    return text.includes('°') || text.includes('º') || text.includes('˚') || text.includes('\\circ') || text.includes('\\degree')
  },

  /** `30°` → `30`; `-30°` → `-30`; `+30°` → `+30`. El resto de la expresión no cambia. */
  strip(e: Expr): Expr {
    if (e.type !== 'unary') return e
    if (e.op === 'degree') return e.arg
    if ((e.op === 'neg' || e.op === 'plus') && e.arg.type === 'unary' && e.arg.op === 'degree') return E.unary(e.op, e.arg.arg)
    return e
  },

  /** ¿La expresión es un valor con «°» en la raíz (`30°`, `-30°`)? */
  isLabeled(e: Expr): boolean {
    return !exprEquals(DegreeLabel.strip(e), e)
  },
}

/** Cómo se evalúan los valores de una respuesta: modo de los ángulos y, en la lectura en grados, el «°» como etiqueta. */
export interface ValueReading {
  angle: AngleMode
  degreeLabel: boolean
}

export const ValueReadings = {
  evaluate(r: ValueReading, e: Expr): MathValue {
    return evaluate(r.degreeLabel ? DegreeLabel.strip(e) : e, {}, r.angle)
  },

  /** Lecturas que hay que probar: la normal y, si algún texto lleva «°» (y los ángulos no están ya en grados), la de grados. */
  readings(angle: AngleMode, texts: readonly string[]): ValueReading[] {
    const normal: ValueReading = { angle, degreeLabel: false }
    if (angle !== 'radians' || !texts.some((t) => DegreeLabel.mentioned(t))) return [normal]
    return [normal, { angle, degreeLabel: true }]
  },
}
