// Ayudantes Unicode con la semántica de Swift: un «carácter» es un grafema (`Character`), y las propiedades
// (`isLetter`, `isNumber`…) se miran en su primer escalar, como hace la biblioteca estándar de Swift.

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Caracteres que pueden formar grafemas de varias unidades (marcas, ZWJ, sustitutos, jamo, escrituras índicas…).
 * Si un texto no tiene ninguno, cada unidad UTF-16 es un grafema y se evita el segmentador (mucho más lento).
 */
const COMPLEX = /[\r\p{M}‌‍︀-️ﾞﾟ\uD800-\uDFFFᄀ-ᇿꥠ-꥿ힰ-퟿؀-؅۝܏࢐࢑࣢ऀ-෿฀-໿ༀ-࿿က-႟ក-៿]/u

/** ¿Cada unidad UTF-16 del texto es un grafema? */
export function isSimple(s: string): boolean {
  return !COMPLEX.test(s)
}

/** Grafemas del texto (`Array(string)` en Swift). */
export function chars(s: string): string[] {
  if (s.length === 0) return []
  if (isSimple(s)) return s.split('')
  const out: string[] = []
  for (const seg of segmenter.segment(s)) out.push(seg.segment)
  return out
}

/** Número de grafemas (`string.count` en Swift). */
export function charCount(s: string): number {
  if (isSimple(s)) return s.length
  let n = 0
  for (const _ of segmenter.segment(s)) n++
  return n
}

/** Los primeros `n` grafemas. */
export function prefixChars(s: string, n: number): string {
  if (n <= 0) return ''
  if (isSimple(s)) return s.slice(0, n)
  let out = ''
  let k = 0
  for (const seg of segmenter.segment(s)) {
    if (k++ >= n) break
    out += seg.segment
  }
  return out
}

/** Los últimos `n` grafemas. */
export function suffixChars(s: string, n: number): string {
  if (n <= 0) return ''
  if (isSimple(s)) return s.length <= n ? s : s.slice(s.length - n)
  const all = chars(s)
  return all.length <= n ? s : all.slice(all.length - n).join('')
}

// MARK: Propiedades (primer escalar)

const RE_ALPHA = /^\p{Alphabetic}/u
const RE_NUM = /^\p{N}/u
const RE_DIGIT = /^\p{Nd}/u
const RE_UPPER = /^\p{Uppercase}/u
const RE_LOWER = /^\p{Lowercase}/u
const RE_WS = /^\p{White_Space}/u

/** `Character.isLetter` (propiedad Alphabetic del primer escalar). */
export function isLetter(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code < 128) return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  return RE_ALPHA.test(c)
}

/** `Character.isNumber` (tipo numérico del primer escalar). */
export function isNumber(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code < 128) return code >= 48 && code <= 57
  return RE_NUM.test(c)
}

export function isUppercase(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code < 128) return code >= 65 && code <= 90
  return RE_UPPER.test(c)
}

export function isLowercase(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code < 128) return code >= 97 && code <= 122
  return RE_LOWER.test(c)
}

/** `Character.isWhitespace` (propiedad White_Space). */
export function isWhitespace(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code < 128) return code === 32 || (code >= 9 && code <= 13)
  return RE_WS.test(c)
}

export function isNewline(c: string): boolean {
  const v = c.codePointAt(0) ?? 0
  return (v >= 0x0a && v <= 0x0d) || v === 0x85 || v === 0x2028 || v === 0x2029
}

/** Valor de una cifra decimal Unicode (٣ → 3, ３ → 3). Las cifras Nd vienen en tramos contiguos de 10 que empiezan en 0. */
export function decimalValue(cp: number): number | null {
  if (cp >= 48 && cp <= 57) return cp - 48
  const s = String.fromCodePoint(cp)
  if (!RE_DIGIT.test(s)) return null
  let start = cp
  while (start > 0 && start > cp - 80 && RE_DIGIT.test(String.fromCodePoint(start - 1))) start--
  return (cp - start) % 10
}

// MARK: Recortes (CharacterSet de Foundation)

/** `.whitespaces`: categoría Zs y tabulador. */
const WS = /^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu
/** `.whitespacesAndNewlines`: categoría Z*, U+0009…U+000D y U+0085. */
const WSNL = /^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu

/** `trimmingCharacters(in: .whitespaces)`. */
export function trimWS(s: string): string {
  if (s.length === 0) return s
  const a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1)
  if (a > 32 && a < 127 && b > 32 && b < 127) return s
  return s.replace(WS, '')
}

/** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWSNL(s: string): string {
  if (s.length === 0) return s
  const a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1)
  if (a > 32 && a < 127 && b > 32 && b < 127) return s
  return s.replace(WSNL, '')
}

/** Recorta los caracteres de `set` (cada carácter del texto dado) en los extremos. */
export function trimSet(s: string, set: string, alsoWhitespace = false): string {
  const inSet = (ch: string): boolean => set.includes(ch) || (alsoWhitespace && /[\p{Z}\t\n\v\f\r\u0085]/u.test(ch))
  const cps = Array.from(s)
  let i = 0, j = cps.length
  while (i < j && inSet(cps[i])) i++
  while (j > i && inSet(cps[j - 1])) j--
  return cps.slice(i, j).join('')
}

/** `split(whereSeparator: \.isWhitespace).joined(separator: " ")`. */
export function collapseWhitespace(s: string): string {
  return s.split(/[\p{White_Space}]+/u).filter((w) => w.length > 0).join(' ')
}

/** Pliegue de acentos y mayúsculas (`folding(options: [.diacriticInsensitive, .caseInsensitive])`). */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** Longitud en bytes UTF-8. */
export function utf8Length(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}
