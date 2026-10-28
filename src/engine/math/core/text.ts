// Utilidades de texto compartidas: caracteres (como `Character` de Swift), propiedades Unicode, plegado y erratas.

const ASCII_RE = /^[\x00-\x7F]*$/
const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/**
 * Caracteres de un texto tal como los cuenta Swift (`Character` = grupo de grafemas), en forma NFC para que dos
 * escrituras canónicamente iguales («é» y «e» + acento combinado) sean el mismo carácter.
 */
export function chars(s: string): string[] {
  if (ASCII_RE.test(s) && !s.includes('\r\n')) return s.split('')
  if (segmenter) {
    const out: string[] = []
    for (const seg of segmenter.segment(s)) out.push(seg.segment.normalize('NFC'))
    return out
  }
  return Array.from(s.normalize('NFC'))
}

/** Número de caracteres (como `String.count` de Swift). */
export function charCount(s: string): number {
  if (ASCII_RE.test(s) && !s.includes('\r\n')) return s.length
  return chars(s).length
}

function firstCodePoint(c: string): string {
  const cp = c.codePointAt(0)
  return cp === undefined ? '' : String.fromCodePoint(cp)
}

const LETTER_RE = /^\p{Alphabetic}$/u
const NUMBER_RE = /^\p{N}$/u
const WHITE_RE = /^\p{White_Space}$/u
const UPPER_RE = /^\p{Uppercase}$/u

/** `Character.isASCII`: un único escalar ASCII (o «\r\n»). */
export function isASCII(c: string): boolean {
  return (c.length === 1 && c.charCodeAt(0) < 128) || c === '\r\n'
}

/** Cifra ASCII 0-9. */
export function isDigit(c: string | undefined): boolean {
  if (c === undefined || c.length !== 1) return false
  const k = c.charCodeAt(0)
  return k >= 48 && k <= 57
}

/** `Character.isLetter` (propiedad Alphabetic del primer escalar). */
export function isLetter(c: string | undefined): boolean {
  if (!c) return false
  if (c.length === 1) {
    const k = c.charCodeAt(0)
    if (k < 128) return (k >= 65 && k <= 90) || (k >= 97 && k <= 122)
  }
  return LETTER_RE.test(firstCodePoint(c))
}

/** `Character.isNumber` (tiene valor numérico: 7, ½, ٣…). */
export function isNumberChar(c: string | undefined): boolean {
  if (!c) return false
  if (c.length === 1 && c.charCodeAt(0) < 128) return isDigit(c)
  return NUMBER_RE.test(firstCodePoint(c))
}

/** `Character.isWhitespace`. */
export function isWhitespace(c: string | undefined): boolean {
  if (!c) return false
  if (c === '\r\n') return true
  return WHITE_RE.test(firstCodePoint(c))
}

/** `Character.isUppercase`. */
export function isUppercase(c: string | undefined): boolean {
  if (!c) return false
  if (UPPER_RE.test(firstCodePoint(c)) && [...c].length === 1) return true
  return c === c.toUpperCase() && c !== c.toLowerCase()
}

/** Letra ASCII. */
export function isASCIILetter(c: string | undefined): boolean {
  if (!c || c.length !== 1) return false
  const k = c.charCodeAt(0)
  return (k >= 65 && k <= 90) || (k >= 97 && k <= 122)
}

/** Minúsculas y sin diacríticos: `Raíz` → `raiz`. */
export function foldedLower(s: string): string {
  if (ASCII_RE.test(s)) return s.toLowerCase()
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC').toLowerCase()
}

/** Sin diacríticos (sin cambiar mayúsculas). */
export function foldDiacritics(s: string): string {
  if (ASCII_RE.test(s)) return s
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC')
}

/**
 * Distancia de Damerau–Levenshtein (versión «optimal string alignment»: la transposición de dos letras contiguas cuesta 1).
 * Si se pasa `limit`, devuelve `limit + 1` en cuanto sabe que se supera.
 */
export function editDistance(a: readonly string[], b: readonly string[], limit?: number): number {
  if (a.length === b.length && a.every((x, i) => x === b[i])) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  if (limit !== undefined && Math.abs(a.length - b.length) > limit) return limit + 1
  let prev2 = new Array<number>(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      rowMin = Math.min(rowMin, v)
    }
    if (limit !== undefined && rowMin > limit) return limit + 1
    const t = prev2
    prev2 = prev
    prev = cur
    cur = t
  }
  return prev[b.length]
}

// Recortes con los conjuntos de Foundation: `.whitespaces` (Zs y tabulador) y `.whitespacesAndNewlines`.
const WS = '[\\p{Zs}\\t]'
const WSNL = '[\\p{Zs}\\t\\n\\u000B\\f\\r\\u0085\\u2028\\u2029]'
const TRIM_WS = new RegExp(`^${WS}+|${WS}+$`, 'gu')
const TRIM_WSNL = new RegExp(`^${WSNL}+|${WSNL}+$`, 'gu')

/** `trimmingCharacters(in: .whitespaces)`. */
export function trimWS(s: string): string {
  return s.replace(TRIM_WS, '')
}

/** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWSNL(s: string): string {
  return s.replace(TRIM_WSNL, '')
}

/** Orden de textos (por unidades UTF-16, como el orden de Swift en el plano básico). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Copia ordenada de una colección de textos. */
export function sortedStrings(xs: Iterable<string>): string[] {
  return [...xs].sort(compareStrings)
}

/** ¿El texto contiene algún carácter que cumple el predicado? */
export function someChar(s: string, pred: (c: string) => boolean): boolean {
  return chars(s).some(pred)
}

/** Repite un texto `n` veces (n ≥ 0). */
export function repeatStr(s: string, n: number): string {
  return n > 0 ? s.repeat(n) : ''
}

/** Escapa un texto para usarlo dentro de una expresión regular. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&')
}
