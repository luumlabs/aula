import { NumberStyle } from '../../base/numberStyle'
import { NumberFormat } from '../format/number-format'

let systemComma: boolean | null = null

/** Separador decimal de la región del sistema (`Intl`), sin el ajuste de la app. */
function detectSystemComma(): boolean {
  if (systemComma === null) {
    try {
      const parts = new Intl.NumberFormat().formatToParts(1.5)
      systemComma = parts.find((p) => p.type === 'decimal')?.value === ','
    } catch {
      systemComma = false
    }
  }
  return systemComma
}

/**
 * Separador decimal con el que el estudiante ESCRIBE números (y que MathKit usa en los números de sus mensajes).
 *
 * MathKit acepta SIEMPRE las dos formas de escribir decimales (`1,5` y `1.5`; `(1,5; 2)` y `(1.5, 2)`; el `;` siempre
 * separa). Esta preferencia decide:
 * - un número con un solo grupo de tres cifras (`1,234` / `1.234`): con el separador decimal del estudiante es SOLO un
 *   decimal; con el otro separador puede ser de miles (va primero) o decimal, y se acepta la lectura que dé la respuesta;
 * - una coma pegada entre cifras dentro de una lista, un punto o un intervalo (`1,5, 2`): qué lectura va primero.
 *
 * También fija el separador de los números que aparecen en los mensajes para el estudiante (nunca en LaTeX, en textos
 * para la IA ni en datos guardados). Por defecto sigue la región del sistema; la app lo fija con `apply(setting)`.
 */
export const NumberInput = {
  /** `true` si la región del sistema usa coma decimal (el valor automático). */
  get systemDecimalComma(): boolean {
    return NumberStyle.isForced ? detectSystemComma() : NumberStyle.decimalComma
  },

  /**
   * `true` si el estudiante escribe los decimales con coma (`1,5`); `false` si los escribe con punto (`1.5`). Es el mismo
   * estado que `NumberStyle` (`@engine/base`): lo que fija la interfaz allí vale para la entrada, y al revés.
   */
  get decimalComma(): boolean {
    return NumberStyle.decimalComma
  },
  set decimalComma(value: boolean) {
    NumberInput.apply(value ? 'comma' : 'point')
  },

  /** `true` si la app fuerza un separador (ajuste «comma» o «point»). */
  get isForced(): boolean {
    return NumberStyle.isForced
  },

  /**
   * Aplica el ajuste de la app: `"comma"` → coma decimal, `"point"` → punto decimal; cualquier otro valor → automático
   * (según la región del sistema).
   */
  apply(setting: string): void {
    NumberStyle.apply(setting)
  },

  /** Número para un MENSAJE visible, con el separador decimal preferido (`0,333` o `0.333`). */
  shown(x: number, places?: number, trimZeros = true): string {
    return NumberFormat.decimal(x, places, trimZeros, NumberInput.decimalComma)
  },

  /** Separador entre números de una lista dentro de un mensaje: `; ` con coma decimal (`1,5; 2`), `, ` con punto. */
  get listSeparator(): string {
    return NumberInput.decimalComma ? '; ' : ', '
  },
}
