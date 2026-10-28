/** Opciones del analizador de expresiones. */
export interface ParseOptions {
  /**
   * `2x`, `2(x+1)`, `(x+1)(x-1)`, `2pi`, `3sqrt(2)`, `x y`. Si es `false`, las palabras de varias letras son una sola
   * variable y escribir dos factores seguidos es un error.
   */
  implicitMultiplication: boolean
  /**
   * `0,5` = 0.5 (una coma pegada entre dos cifras es decimal, salvo dentro de los argumentos de una función con varios
   * argumentos como `max(1,5)`, donde separa argumentos).
   */
  decimalComma: boolean
  /** `30°` = 30·π/180 (en modo `degrees` el símbolo no cambia el valor). */
  degreeSymbol: boolean
  /** `50%` = 1/2. Si es `false`, `%` es el operador módulo (`7 % 3`). */
  percent: boolean
  /** `2e3` = 2000 y `1.5e-3` = 0.0015. Si es `false`, `2e3` se lee como `2·e·3` (que es un error). */
  scientificNotation: boolean
  /**
   * Las palabras de varias letras que no son funciones ni constantes (`total`, `vel`) son una sola variable (en vez de
   * un producto de letras). Lo usan las plantillas.
   */
  wordVariables: boolean
}

/** Opciones por defecto: todo activado salvo `wordVariables`. */
export function defaultParseOptions(overrides: Partial<ParseOptions> = {}): ParseOptions {
  return {
    implicitMultiplication: true,
    decimalComma: true,
    degreeSymbol: true,
    percent: true,
    scientificNotation: true,
    wordVariables: false,
    ...overrides,
  }
}

/** ¿Se parten las palabras desconocidas en letras sueltas (`xy` = x·y)? */
export function splitLetters(o: ParseOptions): boolean {
  return o.implicitMultiplication && !o.wordVariables
}
