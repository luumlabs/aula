import { chars as toChars, foldedLower, isDigit, isLetter, trimWS } from '../core/text'
import { NumberInput } from '../parse/number-input'
import { AnswerWords } from './answer-words'

/** Límite de palabra al estilo de ICU (`\b`): letras, cifras y `_` cuentan como «palabra». */
export const WORD_BEFORE = '(?<![\\p{L}\\p{N}_])'
export const WORD_AFTER = '(?![\\p{L}\\p{N}_])'

/** Signos de comparación: una palabra pegada a uno de ellos es una variable («y = 2», «-1 ≤ y ≤ 3»), no «y/o/u». */
const COMPARISON_SIGNS = new Set(['<', '>', '=', '≤', '≥', '≠', '≈', '!', '⩽', '⩾', '≦', '≧'])

/** ¿`c` es un signo de comparación (`<`, `≤`, `=`, `≠`…)? */
export function isComparisonSign(c: string | null | undefined): boolean {
  return c !== null && c !== undefined && COMPARISON_SIGNS.has(c)
}

/** Primer carácter no blanco desde `i` (hacia delante) o antes de `i` (hacia atrás); `null` si no hay. */
function neighbourNonSpace(cs: readonly string[], i: number, step: 1 | -1): string | null {
  let k = step === 1 ? i : i - 1
  while (k >= 0 && k < cs.length && cs[k] === ' ') k += step
  return k >= 0 && k < cs.length ? cs[k] : null
}

const ASSIGNMENT_RE = new RegExp(`^\\s*\\p{L}[\\p{L}0-9_]*\\s*(?:=|∈|${WORD_BEFORE}in${WORD_AFTER})\\s*`, 'u')

/** Utilidades para leer listas escritas por una persona. */
export const ListParsing = {
  /** ¿Dice «sin solución / ∅» en alguno de los 12 idiomas? */
  isEmptyWord(s: string): boolean {
    return AnswerWords.empty.has(AnswerWords.normalized(s))
  },

  /** Quita un par exterior de {} () [] si abarca todo el texto. */
  stripOuterBrackets(s: string): string {
    const t = trimWS(s)
    const cs = toChars(t)
    if (cs.length < 2) return t
    const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' }
    if (pairs[cs[0]] !== cs[cs.length - 1]) return t
    let depth = 0
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]
      if ('{(['.includes(c)) depth += 1
      else if ('})]'.includes(c)) depth -= 1
      if (depth === 0 && i < cs.length - 1) return t // el primer par cierra antes del final
    }
    return trimWS(cs.slice(1, -1).join(''))
  },

  /**
   * Parte por comas, puntos y comas y las palabras «o/or/y/and/ou/oder/или…» (rodeadas de espacios) fuera de paréntesis;
   * junto a un signo de comparación esas palabras son variables («y = 1, y = -1»), no separan.
   * Con `decimalComma` (lectura con coma decimal): una coma pegada entre dos cifras (`1,5`) no separa, y si hay algún `;`
   * fuera de paréntesis solo separa el `;` (`1,5; 2,5`): el `;` siempre separa.
   */
  split(s: string, decimalComma = false): string[] {
    const parts: string[] = []
    let current = ''
    let depth = 0
    const cs = toChars(s)
    const semicolonsOnly = decimalComma && hasTopLevelSemicolon(cs)
    let i = 0
    while (i < cs.length) {
      const c = cs[i]
      if ('{(['.includes(c)) depth += 1
      else if ('})]'.includes(c)) depth = Math.max(0, depth - 1)
      if (depth === 0) {
        const separates = c === ';' || (c === ',' && !semicolonsOnly && !(decimalComma && ListParsing.isGluedBetweenDigits(cs, i)))
        if (separates) {
          parts.push(current)
          current = ''
          i += 1
          continue
        }
        if (c === ' ') {
          let j = i
          while (j < cs.length && cs[j] === ' ') j += 1
          let k = j
          while (k < cs.length && isLetter(cs[k])) k += 1
          if (k > j && k < cs.length && cs[k] === ' ') {
            const word = foldedLower(cs.slice(j, k).join(''))
            // «, y = -1»: junto a un signo de comparación la palabra es la variable, no «y» (la app Swift sí partía)
            const isVariable = isComparisonSign(neighbourNonSpace(cs, k, 1)) || isComparisonSign(neighbourNonSpace(cs, i, -1))
            if (AnswerWords.listSeparators.has(word) && !isVariable) {
              parts.push(current)
              current = ''
              i = k + 1
              continue
            }
          }
        }
      }
      current += c
      i += 1
    }
    parts.push(current)
    return parts.map(trimWS).filter((p) => p !== '')
  },

  /** ¿La coma de la posición `i` está pegada entre dos cifras (`1,5`)? */
  isGluedBetweenDigits(cs: readonly string[], i: number): boolean {
    if (!(i > 0 && i + 1 < cs.length)) return false
    return isDigit(cs[i - 1]) && isDigit(cs[i + 1])
  },

  /** ¿Hay alguna coma pegada entre dos cifras (`1,5`)? Solo entonces existe la lectura con coma decimal de una lista. */
  hasGluedDecimalComma(s: string): boolean {
    const cs = toChars(s)
    return cs.some((c, i) => c === ',' && ListParsing.isGluedBetweenDigits(cs, i))
  },

  /** Quita "x =" / "x∈" delante de una pieza. */
  stripAssignment(piece: string): string {
    return piece.replace(ASSIGNMENT_RE, '')
  },

  /**
   * Expande «±» (también `+-`, `+/-`) → dos piezas, cambiándolo por `+` y por `-` en su sitio:
   * `(1±√5)/2` → `(1+√5)/2` y `(1-√5)/2`; `±2` → `+2` y `-2`. Como mucho 3 signos ± por pieza (8 lecturas).
   */
  expandPlusMinus(piece: string, budget = 3): string[] {
    if (budget <= 0) return [piece]
    for (const marker of ['±', '+/-', '+-']) {
      const r = piece.indexOf(marker)
      if (r < 0) continue
      const plus = piece.slice(0, r) + '+' + piece.slice(r + marker.length)
      const minus = piece.slice(0, r) + '-' + piece.slice(r + marker.length)
      return [...ListParsing.expandPlusMinus(plus, budget - 1), ...ListParsing.expandPlusMinus(minus, budget - 1)]
    }
    return [piece]
  },
}

/** ¿Hay un `;` fuera de paréntesis? */
function hasTopLevelSemicolon(cs: readonly string[]): boolean {
  let depth = 0
  for (const c of cs) {
    if ('{(['.includes(c)) depth += 1
    else if ('})]'.includes(c)) depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) return true
  }
  return false
}

/**
 * Cómo parte el corrector una lista o un punto escritos por el estudiante, con su misma regla de la coma decimal: con coma
 * decimal, `1,5` no se parte; si hay un «;», solo separa el «;»; en las listas, «o/y/or/and…» también separan. La usa la
 * vista previa «Así lo leo» para no enseñar una lectura distinta de la que se califica.
 */
export const AnswerListReading = {
  /** Piezas de un conjunto o lista (como `checkSet`), en la lectura preferida. */
  setPieces(text: string): string[] {
    const body = ListParsing.stripOuterBrackets(text)
    const decimal = ListParsing.hasGluedDecimalComma(body) && (NumberInput.decimalComma || body.includes(';'))
    return ListParsing.split(body, decimal)
  },

  /** Coordenadas de un punto (sin los paréntesis exteriores), como `checkPoint`. */
  pointPieces(body: string): string[] {
    const cs = toChars(body)
    const separator = body.includes(';') ? ';' : ','
    const decimal = separator === ',' && NumberInput.decimalComma && ListParsing.hasGluedDecimalComma(body)
    const pieces: string[] = []
    let current = ''
    let depth = 0
    cs.forEach((c, i) => {
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
      if (depth === 0 && c === separator && !(decimal && ListParsing.isGluedBetweenDigits(cs, i))) {
        pieces.push(current)
        current = ''
        return
      }
      current += c
    })
    pieces.push(current)
    return pieces.map(trimWS).filter((p) => p !== '')
  },
}
