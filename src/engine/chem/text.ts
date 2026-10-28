// Utilidades de texto: normalización de entradas (Unicode, LaTeX), formato de números y apoyo a las frases localizadas.

import { ChemError } from './errors'
import { getChemLanguage } from './l10n'

// MARK: Caracteres

export const isDigit = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= '0' && c <= '9'
export const isUpper = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= 'A' && c <= 'Z'
export const isLower = (c: string | undefined): boolean => c !== undefined && c.length === 1 && c >= 'a' && c <= 'z'
export const isAsciiLetter = (c: string | undefined): boolean => isUpper(c) || isLower(c)
/** Letra Unicode (como `Character.isLetter`). */
export const isLetter = (c: string | undefined): boolean => c !== undefined && /\p{L}/u.test(c)
/** Espacio en blanco Unicode (como `Character.isWhitespace`). */
export const isWhitespace = (c: string | undefined): boolean => c !== undefined && /\s/u.test(c)

/** Caracteres (puntos de código) de un texto: los emojis cuentan como uno. */
export const chars = (s: string): string[] => Array.from(s)

/** Longitud en caracteres (no en unidades UTF-16). */
export const charCount = (s: string): number => {
  let n = 0
  for (const _ of s) n++
  return n
}

/** Quita espacios y tabuladores de los extremos (como `.whitespaces`). */
export const trimSpaces = (s: string): string => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')
/** Quita espacios y saltos de línea de los extremos (como `.whitespacesAndNewlines`). */
export const trimAll = (s: string): string => s.replace(/^\s+|\s+$/gu, '')
/** Quita de los extremos los caracteres de `set`. */
export const trimChars = (s: string, set: string): string => {
  const c = chars(s)
  let a = 0
  let b = c.length
  while (a < b && set.includes(c[a])) a++
  while (b > a && set.includes(c[b - 1])) b--
  return c.slice(a, b).join('')
}

/** Entero escrito como en Swift `Int(text)`: signo opcional y cifras, sin espacios; `null` si no cabe en 64 bits. */
export function parseIntStrict(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null
  const big = BigInt(text)
  if (big > 9223372036854775807n || big < -9223372036854775808n) return null
  return Number(big)
}

/** 10ⁿ exacto (el `Math.pow` de JavaScript no siempre redondea bien las potencias negativas). */
export const pow10 = (n: number): number => (Number.isInteger(n) ? Number(`1e${n}`) : Math.pow(10, n))

/** Redondeo «escolar» (la mitad se aleja del cero), como `Double.rounded()`. */
export const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

/** Máximo común divisor de enteros (no negativo). */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

// MARK: Plegado para búsquedas

/** Minúsculas, sin acentos ni espacios sobrantes: «Fósforo » → «fosforo». */
export function fold(s: string): string {
  const noMarks = s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
  return noMarks
    .toLowerCase()
    .split(/\s+/u)
    .filter((w) => w.length > 0)
    .join(' ')
}

// MARK: Subíndices y superíndices Unicode

export const SUBSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
}
export const SUPERSCRIPT_CHARS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
}
const TO_SUBSCRIPT: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}
const TO_SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻',
}

export const subscripted = (s: string): string => chars(s).map((c) => TO_SUBSCRIPT[c] ?? c).join('')
export const superscripted = (s: string): string => chars(s).map((c) => TO_SUPERSCRIPT[c] ?? c).join('')

/** Texto de una carga: 2 → «2+», -1 → «-», 1 → «+», 0 → «». */
export function chargeText(charge: number): string {
  if (charge === 0) return ''
  const sign = charge > 0 ? '+' : '-'
  const m = Math.abs(charge)
  return m === 1 ? sign : `${m}${sign}`
}

// MARK: Normalización de fórmulas y ecuaciones

/** Comandos LaTeX que se sustituyen por un texto equivalente. */
const LATEX_REPLACEMENTS: Readonly<Record<string, string>> = {
  cdot: '·', cdotp: '·', bullet: '·', centerdot: '·', times: '×',
  ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: ' ', qquad: ' ',
  Delta: 'Δ', triangle: 'Δ', bigtriangleup: 'Δ',
  rightarrow: '→', longrightarrow: '→', to: '→', Rightarrow: '→', Longrightarrow: '→', rightharpoonup: '→',
  rightleftharpoons: '⇌', leftrightharpoons: '⇌', rightleftarrows: '⇌', leftrightarrow: '⇌', longleftrightarrow: '⇌',
  Leftrightarrow: '⇌', rightleftarrow: '⇌',
  uparrow: '', downarrow: '', '{': '{', '}': '}', '%': '%',
  left: '', right: '', big: '', Big: '', bigl: '', bigr: '',
  nu: 'ν', circ: '°', degree: '°',
}
/** Comandos que envuelven texto: se quedan con su contenido. */
const LATEX_WRAPPERS = new Set([
  'ce', 'mathrm', 'text', 'textrm', 'mathbf', 'textbf', 'mathit', 'textit', 'rm', 'operatorname', 'mbox', 'pu', 'mathsf',
  'boldsymbol', 'displaystyle', 'textstyle',
])

/**
 * Normaliza una fórmula o ecuación escrita a mano, en Unicode o en LaTeX simple, a un texto ASCII con marcas
 * explícitas: subíndices como dígitos, superíndices como `^{…}`, puntos de hidrato como «·», flechas como «→»/«⇌».
 * Lanza error si encuentra un comando LaTeX desconocido.
 */
export function normalize(input: string): string {
  let s = input
  // Delimitadores de LaTeX.
  for (const d of ['\\(', '\\)', '\\[', '\\]', '$$', '$']) s = s.split(d).join(' ')
  s = expandLaTeX(s)
  let out = ''
  let pendingSuperscript = ''
  const flush = (): void => {
    if (pendingSuperscript) {
      out += '^{' + pendingSuperscript + '}'
      pendingSuperscript = ''
    }
  }
  for (const ch of s) {
    const sup = SUPERSCRIPT_CHARS[ch]
    if (sup !== undefined) {
      pendingSuperscript += sup
      continue
    }
    flush()
    const sub = SUBSCRIPT_DIGITS[ch]
    if (sub !== undefined) {
      out += sub
      continue
    }
    switch (ch) {
      case '−': case '–': case '—': case '‒': case '﹣': case '－':
        out += '-'
        break
      case '＋': case '﹢':
        out += '+'
        break
      case '·': case '•': case '∙': case '⋅': case '・': case '*': case '⦁':
        out += '·'
        break
      case '⟶': case '⟹': case '⇒': case '⇨': case '➔': case '➝': case '➞': case '⟼': case '↦': case '⇾': case '→':
        out += '→'
        break
      case '⇌': case '⇄': case '⇆': case '↔': case '⟷': case '⇋': case '⥂': case '⥄': case '⟺': case '⇔':
        out += '⇌'
        break
      case '↑': case '↓':
        break
      case ' ': case ' ': case ' ': case ' ': case ' ': case '\t': case '\n': case '\r':
        out += ' '
        break
      case 'º':
        out += '°'
        break
      default:
        out += ch
    }
  }
  flush()
  // Subíndices LaTeX: «_{2}» → «2», «_2» → «2».
  out = removeSubscriptMarks(out)
  return out
    .split(' ')
    .filter((p) => p.length > 0)
    .join(' ')
}

/** Expande comandos LaTeX sencillos. */
function expandLaTeX(s: string): string {
  if (!s.includes('\\')) return s
  const c = chars(s)
  let out = ''
  let i = 0
  while (i < c.length) {
    const ch = c[i]
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    // Nombre del comando: letras, o un solo símbolo.
    let j = i + 1
    let name = ''
    if (j < c.length && isAsciiLetter(c[j])) {
      while (j < c.length && isAsciiLetter(c[j])) name += c[j++]
    } else if (j < c.length) {
      name = c[j++]
    }
    if (name === 'frac' || name === 'tfrac' || name === 'dfrac') {
      // \frac{a}{b} → a/b
      const [num, afterNum] = readBraced(c, j)
      const [den, afterDen] = readBraced(c, afterNum)
      out += `${expandLaTeX(num)}/${expandLaTeX(den)}`
      i = afterDen
      continue
    }
    if (name === 'xrightarrow' || name === 'xleftrightarrow' || name === 'xrightleftharpoons') {
      // \xrightarrow[abajo]{arriba} → →[arriba, abajo]
      let k = j
      let below = ''
      if (k < c.length && c[k] === '[') {
        let depth = 0
        let t = ''
        while (k < c.length) {
          if (c[k] === '[') {
            depth++
            if (depth === 1) {
              k++
              continue
            }
          }
          if (c[k] === ']') {
            depth--
            if (depth === 0) {
              k++
              break
            }
          }
          t += c[k++]
        }
        below = t
      }
      const [above, after] = readBraced(c, k)
      const arrow = name === 'xrightarrow' ? '→' : '⇌'
      const cond = [above, below].map(trimSpaces).filter((x) => x.length > 0)
      out += cond.length === 0 ? arrow : arrow + '[' + expandLaTeX(cond.join(', ')) + ']'
      i = after
      continue
    }
    if (LATEX_WRAPPERS.has(name)) {
      // Se queda con el contenido (si va entre llaves) o sigue sin más (\rm).
      let k = j
      while (k < c.length && c[k] === ' ') k++
      if (k < c.length && c[k] === '{') {
        const [inner, after] = readBraced(c, k)
        out += expandLaTeX(inner)
        i = after
      } else {
        i = j
      }
      continue
    }
    const rep = LATEX_REPLACEMENTS[name]
    if (rep !== undefined && Object.prototype.hasOwnProperty.call(LATEX_REPLACEMENTS, name)) {
      out += rep
      i = j
      continue
    }
    throw ChemError.unexpectedCharacter('\\' + name)
  }
  return out
}

/** Lee «{…}» empezando en `start` (saltando espacios). Si no hay llave, toma un solo carácter. */
function readBraced(c: string[], start: number): [string, number] {
  let k = start
  while (k < c.length && c[k] === ' ') k++
  if (k >= c.length) return ['', k]
  if (c[k] !== '{') return [c[k], k + 1]
  let depth = 0
  let t = ''
  while (k < c.length) {
    const ch = c[k]
    if (ch === '{') {
      depth++
      if (depth === 1) {
        k++
        continue
      }
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        k++
        break
      }
    }
    t += ch
    k++
  }
  return [t, k]
}

/** Quita las marcas de subíndice LaTeX: «H_{2}O» → «H2O», «H_2O» → «H2O». */
function removeSubscriptMarks(s: string): string {
  if (!s.includes('_')) return s
  const c = chars(s)
  let out = ''
  let i = 0
  while (i < c.length) {
    if (c[i] === '_') {
      if (i + 1 < c.length && c[i + 1] === '{') {
        let k = i + 2
        let depth = 1
        let inner = ''
        while (k < c.length) {
          if (c[k] === '{') depth++
          if (c[k] === '}') {
            depth--
            if (depth === 0) break
          }
          inner += c[k++]
        }
        out += inner
        i = k + 1
      } else {
        i++ // «_2» → el dígito se copia en la siguiente vuelta
      }
      continue
    }
    out += c[i++]
  }
  return out
}

// MARK: Formato de números

/** `toFixed` sin notación exponencial para números enormes. */
function toFixedSafe(x: number, p: number): string {
  if (Math.abs(x) >= 1e21) return BigInt(x).toString() + (p > 0 ? '.' + '0'.repeat(p) : '')
  return x.toFixed(p)
}

/** Número con `places` decimales fijos: (58.443, 2) → «58.44». */
export function fixed(x: number, places: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '-∞'
  const p = Math.max(0, Math.min(places, 15))
  // Redondeo «escolar» (la mitad hacia arriba) a pesar de la representación binaria: 122.545 → 122.55.
  const nudged = x + (x >= 0 ? 1 : -1) * Math.abs(x) * 1e-12
  let s = toFixedSafe(nudged, p)
  if (s.startsWith('-') && Number(s) === 0) s = s.slice(1)
  return s
}

/** Redondea a `sig` cifras significativas. */
export function roundToSignificant(x: number, sig: number): number {
  if (!Number.isFinite(x) || x === 0 || sig <= 0) return x
  const e = Math.floor(Math.log10(Math.abs(x)))
  const factor = pow10(sig - 1 - e)
  // Mitad hacia arriba aunque el binario quede justo por debajo (0.0445 → 0.045 con 2 cifras).
  const r = roundHalfAway(x * factor * (1 + 1e-12)) / factor
  return Number.isFinite(r) ? r : x
}

/** Exponente decimal (posición de la primera cifra significativa). */
export const exponentOf = (x: number): number => (x === 0 || !Number.isFinite(x) ? 0 : Math.floor(Math.log10(Math.abs(x))))

export type NumberStyle = 'plain' | 'unicode' | 'latex'

/**
 * Número con `sig` cifras significativas, conservando ceros finales («2.50»). Usa notación científica si el número
 * es muy grande o muy pequeño, o si los ceros finales serían ambiguos («1.20 × 10³»).
 */
export function significant(x: number, sigIn: number, style: NumberStyle = 'unicode'): string {
  if (!Number.isFinite(x)) return fixed(x, 0)
  if (x === 0) return sigIn <= 1 ? '0' : '0.' + '0'.repeat(sigIn - 1)
  const sig = Math.max(1, Math.min(sigIn, 15))
  const r = roundToSignificant(x, sig)
  const e = exponentOf(r)
  const decimals = sig - 1 - e
  // Un entero acabado en 0 sería ambiguo («100» parece de 1 cifra): se pasa a notación científica.
  const ambiguousZeros = decimals <= 0 && Math.abs(r) >= 10 && r % 10 === 0
  if (e >= 6 || e <= -4 || ambiguousZeros) return scientific(r, sig, style)
  return fixed(r, Math.max(0, decimals))
}

/** Notación científica con `sig` cifras: «6.022 × 10²³», «6.022e23» (plain) o «6.022 \times 10^{23}». */
export function scientific(x: number, sig: number, style: NumberStyle = 'unicode'): string {
  if (!Number.isFinite(x) || x === 0) return fixed(x, Math.max(0, sig - 1))
  let e = exponentOf(x)
  let mantissa = roundToSignificant(x / pow10(e), sig)
  if (Math.abs(mantissa) >= 10) {
    mantissa /= 10
    e += 1
  }
  const m = fixed(mantissa, Math.max(0, sig - 1))
  switch (style) {
    case 'plain':
      return `${m}e${e}`
    case 'unicode':
      return e === 0 ? m : `${m} × 10${superscripted(String(e))}`
    case 'latex':
      return e === 0 ? m : `${m} \\times 10^{${e}}`
  }
}

/** Número «legible» para pasos intermedios: 4 cifras significativas (o el entero si es pequeño). */
export function compact(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return fixed(x, 0)
  if (x === roundHalfAway(x) && Math.abs(x) < 1e6) return fixed(x, 0)
  return significant(x, sig)
}

/** Número con decimales recortados (sin ceros finales): 2.500 → «2.5». */
export function trimmed(x: number, maxDecimals = 6): string {
  let s = fixed(x, maxDecimals)
  if (s.includes('.')) {
    s = s.replace(/0+$/, '')
    if (s.endsWith('.')) s = s.slice(0, -1)
  }
  return s
}

// MARK: Frases en el idioma de la interfaz

function listFormat(items: readonly string[], type: 'conjunction' | 'disjunction'): string {
  const lang = getChemLanguage()
  try {
    return new Intl.ListFormat(lang, { type, style: 'long' }).format(items)
  } catch {
    const word = type === 'conjunction' ? (lang === 'es' ? 'y' : 'and') : lang === 'es' ? 'o' : 'or'
    if (items.length <= 1) return items.join('')
    return items.slice(0, -1).join(', ') + ` ${word} ` + items[items.length - 1]
  }
}

/** Lista con «y» en el idioma de la interfaz: «Cu y Fe», «Cu, Fe y S». */
export const andList = (items: readonly string[]): string => listFormat(items, 'conjunction')

/** Lista con «o» en el idioma de la interfaz: «Co o CO», «A, B o C». */
export const orList = (items: readonly string[]): string => listFormat(items, 'disjunction')

/** Un nombre común para escribirlo dentro de una frase: en minúscula salvo en alemán («Eisen»). */
export function inSentence(name: string): string {
  const lang = getChemLanguage()
  if (lang.toLowerCase().startsWith('de')) return name
  try {
    return name.toLocaleLowerCase(lang)
  } catch {
    return name.toLowerCase()
  }
}

/** Primera letra en mayúscula («el ácido» → «El ácido»). */
export function capitalizeFirst(s: string): string {
  const c = chars(s)
  return c.length === 0 ? s : c[0].toUpperCase() + c.slice(1).join('')
}
