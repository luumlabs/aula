// Errores de ChemKit. Todos llevan un mensaje localizado, preciso y amable, pensado para enseñárselo al alumno.

import { L } from './l10n'
import { orList } from './text'

export type ChemErrorKind =
  | { type: 'empty'; what: string }
  | { type: 'tooLong'; limit: number }
  | { type: 'unknownSymbol'; symbol: string; suggestion: string | null }
  | { type: 'lowercaseSymbol'; symbol: string; options: readonly string[] }
  | { type: 'unclosedBracket'; char: string }
  | { type: 'unexpectedClosingBracket'; char: string }
  | { type: 'mismatchedBracket'; open: string; close: string }
  | { type: 'emptyGroup' }
  | { type: 'zeroCount' }
  | { type: 'numberTooLarge'; text: string }
  | { type: 'quantityTooLarge' }
  | { type: 'tooDeep'; limit: number }
  | { type: 'unexpectedCharacter'; text: string }
  | { type: 'misplacedNumber'; text: string }
  | { type: 'invalidCharge'; text: string }
  | { type: 'missingArrow' }
  | { type: 'multipleArrows' }
  | { type: 'emptySide'; side: string }
  | { type: 'invalidQuantity'; text: string }
  | { type: 'incompatibleUnits'; from: string; to: string }
  | { type: 'missingData'; message: string }
  | { type: 'calculation'; message: string }

/** Error de ChemKit con su motivo (`kind`) y el mensaje para el alumno (`message`). */
export class ChemError extends Error {
  readonly kind: ChemErrorKind

  constructor(kind: ChemErrorKind) {
    super(chemErrorMessage(kind))
    this.name = 'ChemError'
    this.kind = kind
  }

  /** Código estable del motivo (para la interfaz o los registros). */
  get code(): ChemErrorKind['type'] {
    return this.kind.type
  }

  /** Mismo motivo y mismos datos. */
  equals(other: ChemError | ChemErrorKind): boolean {
    const k = other instanceof ChemError ? other.kind : other
    return JSON.stringify(k) === JSON.stringify(this.kind)
  }

  static empty = (what: string): ChemError => new ChemError({ type: 'empty', what })
  static tooLong = (limit: number): ChemError => new ChemError({ type: 'tooLong', limit })
  static unknownSymbol = (symbol: string, suggestion: string | null = null): ChemError =>
    new ChemError({ type: 'unknownSymbol', symbol, suggestion })
  static lowercaseSymbol = (symbol: string, options: readonly string[]): ChemError =>
    new ChemError({ type: 'lowercaseSymbol', symbol, options })
  static unclosedBracket = (char: string): ChemError => new ChemError({ type: 'unclosedBracket', char })
  static unexpectedClosingBracket = (char: string): ChemError => new ChemError({ type: 'unexpectedClosingBracket', char })
  static mismatchedBracket = (open: string, close: string): ChemError => new ChemError({ type: 'mismatchedBracket', open, close })
  static emptyGroup = (): ChemError => new ChemError({ type: 'emptyGroup' })
  static zeroCount = (): ChemError => new ChemError({ type: 'zeroCount' })
  static numberTooLarge = (text: string): ChemError => new ChemError({ type: 'numberTooLarge', text })
  static quantityTooLarge = (): ChemError => new ChemError({ type: 'quantityTooLarge' })
  static tooDeep = (limit: number): ChemError => new ChemError({ type: 'tooDeep', limit })
  static unexpectedCharacter = (text: string): ChemError => new ChemError({ type: 'unexpectedCharacter', text })
  static misplacedNumber = (text: string): ChemError => new ChemError({ type: 'misplacedNumber', text })
  static invalidCharge = (text: string): ChemError => new ChemError({ type: 'invalidCharge', text })
  static missingArrow = (): ChemError => new ChemError({ type: 'missingArrow' })
  static multipleArrows = (): ChemError => new ChemError({ type: 'multipleArrows' })
  static emptySide = (side: string): ChemError => new ChemError({ type: 'emptySide', side })
  static invalidQuantity = (text: string): ChemError => new ChemError({ type: 'invalidQuantity', text })
  static incompatibleUnits = (from: string, to: string): ChemError => new ChemError({ type: 'incompatibleUnits', from, to })
  static missingData = (message: string): ChemError => new ChemError({ type: 'missingData', message })
  static calculation = (message: string): ChemError => new ChemError({ type: 'calculation', message })
}

/** Mensaje de un error cualquiera (el de ChemKit si lo es). */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ChemError ? error.message : fallback
}

/** Mensaje para el alumno, en el idioma de la interfaz. */
export function chemErrorMessage(k: ChemErrorKind): string {
  switch (k.type) {
    case 'empty':
      switch (k.what) {
        case 'La fórmula':
          return L('La fórmula está vacía.')
        case 'La ecuación':
          return L('La ecuación está vacía.')
        case 'La configuración electrónica':
          return L('La configuración electrónica está vacía.')
        case 'La descripción':
          return L('La descripción está vacía.')
        default:
          return L('%@ está vacía.', k.what)
      }
    case 'tooLong':
      // El límite va como texto, sin separador de miles.
      return L('El texto es demasiado largo (máximo %@ caracteres).', String(k.limit))
    case 'unknownSymbol':
      if (k.suggestion) return L('«%@» no es un símbolo químico. ¿Quisiste decir %@?', k.symbol, k.suggestion)
      return L('«%@» no es un símbolo químico.', k.symbol)
    case 'lowercaseSymbol':
      if (k.options.length === 0) return L('«%@» no es válido: los símbolos químicos empiezan por mayúscula (Na, Cl, Fe…).', k.symbol)
      if (k.options.length === 1) return L('Los símbolos empiezan por mayúscula: ¿quisiste decir %@?', k.options[0])
      return L('Los símbolos empiezan por mayúscula: ¿%@?', orList(k.options))
    case 'unclosedBracket':
      return k.char === '(' ? L('Falta cerrar un paréntesis.') : L('Falta cerrar un corchete «%@».', k.char)
    case 'unexpectedClosingBracket':
      return L('Sobra un «%@»: se cierra algo que no se había abierto.', k.char)
    case 'mismatchedBracket':
      return L('El «%@» se cierra con «%@»: usa el mismo tipo de paréntesis para abrir y cerrar.', k.open, k.close)
    case 'emptyGroup':
      return L('Hay un paréntesis vacío.')
    case 'zeroCount':
      return L('Un subíndice no puede ser 0: si el elemento no está, no lo escribas.')
    case 'numberTooLarge':
      return L('El número «%@» es demasiado grande.', k.text)
    case 'quantityTooLarge':
      return L('La fórmula tiene cantidades demasiado grandes.')
    case 'tooDeep':
      return L('Hay demasiados paréntesis anidados (máximo %@ niveles).', String(k.limit))
    case 'unexpectedCharacter':
      return L('No entiendo «%@» dentro de una fórmula química.', k.text)
    case 'misplacedNumber':
      return L('El número «%@» está en un sitio raro: los subíndices van justo detrás del símbolo o del paréntesis.', k.text)
    case 'invalidCharge':
      return L('La carga «%@» no está bien escrita: usa, por ejemplo, Fe3+, SO4^2- o NH4+.', k.text)
    case 'missingArrow':
      return L('Falta la flecha (→) entre reactivos y productos.')
    case 'multipleArrows':
      return L('La ecuación tiene más de una flecha: escribe una sola reacción.')
    case 'emptySide':
      if (k.side === 'reactivos') return L('Faltan los reactivos de la ecuación.')
      if (k.side === 'productos') return L('Faltan los productos de la ecuación.')
      return L('Faltan los %@ de la ecuación.', k.side)
    case 'invalidQuantity':
      return L('No entiendo la cantidad «%@». Escríbela como número y unidad, por ejemplo «10 g», «0.5 mol» o «250 mL».', k.text)
    case 'incompatibleUnits':
      return L('No se puede pasar de %@ a %@ directamente.', k.from, k.to)
    case 'missingData':
    case 'calculation':
      return k.message
  }
}
