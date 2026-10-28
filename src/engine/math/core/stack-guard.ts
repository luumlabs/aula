import { tr } from './i18n'
import { MathError } from './types'

/**
 * Protección contra desbordamiento de pila con entradas hostiles (paréntesis anidados, cadenas enormes).
 *
 * En Swift se mide la pila del hilo; en JavaScript no se puede, así que las recursiones llevan la cuenta de su
 * profundidad y se detienen mucho antes del límite de los motores (≈ 10 000 marcos). El analizador ya limita la
 * profundidad de lo que lee (120 niveles); esto protege los árboles construidos en código.
 */
export const StackGuard = {
  /** Profundidad máxima de las recursiones sin estado propio (impresoras, simplificador…). */
  maxDepth: 1500,

  /** ¿Se ha agotado la pila con esta profundidad? */
  exhausted(depth: number): boolean {
    return depth > StackGuard.maxDepth
  },

  /** Error para el estudiante. */
  error(position?: number): MathError {
    return new MathError('overflow', tr('La expresión es demasiado compleja o tiene demasiados niveles anidados'), position)
  },
}
