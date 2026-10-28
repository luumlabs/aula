// Tokenización para la búsqueda (como SearchText.swift): minúsculas, sin acentos, números y fórmulas (`x^2`, `3.14`, `1/2`)
// como términos, letras griegas por su nombre (π → pi), palabras vacías de español e inglés fuera, raíz ligera e
// ideogramas CJK uno a uno. Las posiciones de los términos son índices de escalares Unicode del texto original.
import { charCount, decimalValue, utf8Length } from '../ingest/text/unicode'

// MARK: Palabras vacías

/** Palabras funcionales que no ayudan a buscar. `sin`, `tan`, `e` NO están (en matemáticas son funciones y constantes). */
export const STOPWORDS_ES = new Set([
  'a', 'al', 'algo', 'algun', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'aqui', 'asi', 'aun', 'aunque', 'bajo', 'cada', 'como', 'con', 'contra',
  'cual', 'cuales', 'cuando', 'cuyo', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella', 'ellas', 'ello', 'ellos', 'en', 'entre', 'era', 'eran', 'eres', 'es', 'esa',
  'esas', 'ese', 'eso', 'esos', 'esta', 'estaba', 'estan', 'estar', 'estas', 'este', 'esto', 'estos', 'estoy', 'fue', 'fueron', 'ha', 'han', 'has', 'hasta', 'hay',
  'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis', 'mucho', 'muy', 'nada', 'ni', 'no', 'nos', 'nosotros', 'nuestra', 'nuestro', 'o', 'os', 'otra',
  'otro', 'para', 'pero', 'poco', 'por', 'porque', 'pues', 'que', 'quien', 'quienes', 'se', 'sea', 'sean', 'ser', 'si', 'sido', 'sino', 'sobre', 'son', 'soy', 'su',
  'sus', 'tambien', 'te', 'tendra', 'tiene', 'tienen', 'todo', 'todos', 'tu', 'tus', 'u', 'un', 'una', 'uno', 'unos', 'unas', 'usted', 'ustedes', 'va', 'vamos',
  'vas', 'vez', 'vosotros', 'voy', 'y', 'ya', 'yo'
])
export const STOPWORDS_EN = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'but', 'by', 'can', 'could', 'did',
  'do', 'does', 'doing', 'done', 'each', 'for', 'from', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'if', 'in', 'into', 'is',
  'it', 'its', 'just', 'may', 'me', 'might', 'more', 'most', 'must', 'my', 'no', 'nor', 'not', 'of', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'out', 'own',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours'
])
export const STOPWORDS = new Set([...STOPWORDS_ES, ...STOPWORDS_EN])

// MARK: Raíz ligera

/** Plurales irregulares (latinos y griegos) que abundan en matemáticas. */
const IRREGULAR: Record<string, string> = {
  vertices: 'vertex', vertice: 'vertex', matrices: 'matrix', matriz: 'matrix', indices: 'index', indice: 'index', axes: 'axis',
  analyses: 'analysis', foci: 'focus', radii: 'radius', hypotheses: 'hypothesis', parentheses: 'parenthesis', criteria: 'criterion',
  phenomena: 'phenomenon', appendices: 'appendix', formulae: 'formula', raices: 'raiz', veces: 'vez', luces: 'luz', lapices: 'lapiz'
}

const isVowel = (c: number): boolean => c === 97 || c === 101 || c === 105 || c === 111 || c === 117

/** Raíz sencilla común a español e inglés: las formas habituales de una palabra dan la misma clave. */
export function stemWord(word: string): string {
  const canonical = Object.prototype.hasOwnProperty.call(IRREGULAR, word) ? IRREGULAR[word] : undefined
  if (canonical !== undefined && canonical !== word) return stemWord(canonical)
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return word
  const b: number[] = []
  for (let i = 0; i < word.length; i++) b.push(word.charCodeAt(i))
  const ends = (suffix: string): boolean => {
    if (b.length < suffix.length) return false
    for (let k = 0; k < suffix.length; k++) if (b[b.length - suffix.length + k] !== suffix.charCodeAt(k)) return false
    return true
  }
  const hasVowel = (n: number): boolean => { for (let k = 0; k < n; k++) if (isVowel(b[k])) return true; return false }
  const undouble = (): void => {
    const l = b[b.length - 1]
    if (b.length >= 4 && l === b[b.length - 2] && !isVowel(l) && l !== 108 && l !== 115 && l !== 122) b.pop()
  }
  const drop = (n: number): void => { b.length -= n }

  // A. Plurales
  if (ends('ies') && b.length > 4) { drop(3); b.push(105) }
  else if (ends('sses')) drop(2)
  else if (ends('es') && b.length > 4) drop(isVowel(b[b.length - 3]) ? 1 : 2)
  else if (ends('s') && !ends('ss') && !ends('us') && !ends('is') && b.length > 3) drop(1)

  // B. Derivación
  if (ends('ing') && b.length - 3 >= 3 && hasVowel(b.length - 3)) { drop(3); undouble() }
  else if (ends('ed') && b.length - 2 >= 4 && hasVowel(b.length - 2)) { drop(2); undouble() }
  else if (ends('mente') && b.length >= 8) drop(5)
  else if (ends('ly') && b.length >= 7) drop(2)

  // C. y → i y vocal final
  if (b.length >= 4 && b[b.length - 1] === 121 && !isVowel(b[b.length - 2])) b[b.length - 1] = 105
  if (b.length >= 5) { const l = b[b.length - 1]; if (l === 97 || l === 101 || l === 111) b.pop() }
  return b.length >= 3 ? String.fromCharCode(...b) : word
}

// MARK: Propiedades Unicode (con caché para el plano básico)

const RE_ALPHA = /^\p{Alphabetic}$/u
const RE_DECIMAL = /^\p{Nd}$/u
const RE_MARK = /^\p{M}$/u
const RE_WS = /^\p{White_Space}$/u

class PropertyCache {
  private readonly bmp = new Uint8Array(65536)
  constructor(private readonly re: RegExp) {}
  has(v: number): boolean {
    if (v < 65536) {
      const c = this.bmp[v]
      if (c !== 0) return c === 1
      const r = this.re.test(String.fromCharCode(v))
      this.bmp[v] = r ? 1 : 2
      return r
    }
    return this.re.test(String.fromCodePoint(v))
  }
}

const alphabetic = new PropertyCache(RE_ALPHA)
const decimal = new PropertyCache(RE_DECIMAL)
const mark = new PropertyCache(RE_MARK)
const white = new PropertyCache(RE_WS)

export const isAlphabeticCP = (v: number): boolean => (v < 128 ? (v >= 65 && v <= 90) || (v >= 97 && v <= 122) : alphabetic.has(v))
export const isDecimalCP = (v: number): boolean => (v < 128 ? v >= 48 && v <= 57 : decimal.has(v))
export const isWhitespaceCP = (v: number): boolean => (v < 128 ? v === 32 || (v >= 9 && v <= 13) : white.has(v))
const isMarkCP = (v: number): boolean => v >= 0x300 && mark.has(v)

/** Escalares Unicode de un texto. */
export function codePoints(text: string): number[] {
  const out: number[] = new Array(text.length)
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { out[n++] = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000; i++; continue }
    }
    out[n++] = c
  }
  out.length = n
  return out
}

/** Texto de un tramo de escalares. */
export function fromCodePoints(cps: number[], lo = 0, hi = cps.length): string {
  let out = ''
  for (let i = lo; i < hi; i += 4096) out += String.fromCodePoint(...cps.slice(i, Math.min(hi, i + 4096)))
  return out
}

// MARK: Tokenizador

export interface Token {
  term: string
  /** Posición en la lista de escalares Unicode del texto original (para resaltar). */
  lo: number
  hi: number
}

const GREEK_NAMES: Record<number, string> = {
  0x3b1: 'alpha', 0x3b2: 'beta', 0x3b3: 'gamma', 0x3b4: 'delta', 0x3b5: 'epsilon', 0x3f5: 'epsilon', 0x3b6: 'zeta', 0x3b7: 'eta', 0x3b8: 'theta', 0x3d1: 'theta',
  0x3b9: 'iota', 0x3ba: 'kappa', 0x3bb: 'lambda', 0x3bc: 'mu', 0xb5: 'mu', 0x3bd: 'nu', 0x3be: 'xi', 0x3bf: 'omicron', 0x3c0: 'pi', 0x3d6: 'pi', 0x3c1: 'rho',
  0x3c3: 'sigma', 0x3c2: 'sigma', 0x3c4: 'tau', 0x3c5: 'upsilon', 0x3c6: 'phi', 0x3d5: 'phi', 0x3c7: 'chi', 0x3c8: 'psi', 0x3c9: 'omega'
}
const SYMBOL_NAMES: Record<number, string> = { 0x221a: 'sqrt', 0x2211: 'sum', 0x222b: 'integral', 0x221e: 'infinity', 0x2202: 'partial', 0x2220: 'angle', 0x2207: 'nabla' }
const SUPERSCRIPTS: Record<number, string> = { 0xb2: '2', 0xb3: '3', 0xb9: '1', 0x2070: '0', 0x2074: '4', 0x2075: '5', 0x2076: '6', 0x2077: '7', 0x2078: '8', 0x2079: '9', 0x207f: 'n' }
const CONTRACTION_SUFFIXES = new Set(['s', 't', 'd', 'll', 're', 've', 'm'])
/** Letras latinas sueltas que la descomposición Unicode no cubre. */
const SPECIAL_FOLDS: Record<number, string> = { 0xdf: 'ss', 0xe6: 'ae', 0xc6: 'ae', 0x153: 'oe', 0x152: 'oe', 0xf8: 'o', 0xd8: 'o', 0x111: 'd', 0x110: 'd', 0x142: 'l', 0x141: 'l', 0x131: 'i' }

function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Tabla de pliegue para U+0080…U+024F (acentos latinos). */
const LATIN_FOLD: Array<string | null> = (() => {
  const t: Array<string | null> = []
  for (let v = 0x80; v <= 0x24f; v++) {
    if (!isAlphabeticCP(v)) { t.push(null); continue }
    const special = SPECIAL_FOLDS[v]
    if (special) { t.push(special); continue }
    const base = stripMarks(String.fromCodePoint(v).toLowerCase())
    t.push(base || null)
  }
  return t
})()

const foldCache = new Map<number, string | null>()

/** Letra o cifra en minúsculas y sin acentos (puede dar varias letras: ß → ss). `null` si no es letra ni cifra. */
function foldedLetters(v: number): string | null {
  if (v < 128) {
    if ((v >= 97 && v <= 122) || (v >= 48 && v <= 57)) return String.fromCharCode(v)
    if (v >= 65 && v <= 90) return String.fromCharCode(v + 32)
    return null
  }
  if (v <= 0x24f) return LATIN_FOLD[v - 0x80]
  if (v === 0x3c2) return 'σ'                     // sigma final: la misma letra que σ
  const cached = foldCache.get(v)
  if (cached !== undefined) return cached
  let out: string | null
  if (isDecimalCP(v)) out = String(decimalValue(v) ?? 0)
  else if (!isAlphabeticCP(v)) out = null
  else out = stripMarks(String.fromCodePoint(v).toLowerCase()) || null
  if (foldCache.size < 20_000) foldCache.set(v, out)
  return out
}

const isWordChar = (v: number): boolean => (v < 128 ? (v >= 97 && v <= 122) || (v >= 65 && v <= 90) || (v >= 48 && v <= 57) : isAlphabeticCP(v) || isDecimalCP(v))
const isAsciiDigit = (v: number): boolean => v >= 48 && v <= 57

/** Escrituras que se tokenizan carácter a carácter (CJK y hangul), con extensiones y 々/〇. */
export function isCJK(v: number): boolean {
  return (v >= 0x3040 && v <= 0x30ff) || (v >= 0x3400 && v <= 0x4dbf) || (v >= 0x4e00 && v <= 0x9fff) || (v >= 0xac00 && v <= 0xd7af) ||
    (v >= 0xf900 && v <= 0xfaff) || (v >= 0xff66 && v <= 0xff9f) || (v >= 0xffa0 && v <= 0xffdc) || (v >= 0x1100 && v <= 0x11ff) ||
    (v >= 0x3130 && v <= 0x318f) || (v >= 0x20000 && v <= 0x3ffff) || v === 0x3005 || v === 0x3007
}

export function containsCJK(text: string): boolean {
  for (const ch of text) if (isCJK(ch.codePointAt(0) ?? 0)) return true
  return false
}

/** ¿Es un único carácter CJK? */
export function isSingleCJK(term: string): boolean {
  const cp = term.codePointAt(0)
  if (cp === undefined) return false
  return term.length === (cp > 0xffff ? 2 : 1) && isCJK(cp)
}

function isGreekLetter(v: number): boolean {
  return v >= 0x370 && v <= 0x3ff && isAlphabeticCP(v)
}

/** Términos (normalizados, sin palabras vacías y con raíz) de un texto, en orden. */
export function terms(text: string): string[] {
  return tokenize(text).map((t) => t.term)
}

/** Plegado sin raíz ni palabras vacías: minúsculas y sin acentos (para prefijos de la consulta). */
export function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    const f = foldedLetters(ch.codePointAt(0) ?? 0)
    if (f) out += f
  }
  return out
}

/** Exponente o subíndice tras `^` o `_`: `2`, `n`, `{n+1}`, `(2x)`, `-1`. Devuelve el texto añadido y dónde sigue. */
function parseScript(s: number[], start: number, marker: string): { text: string; end: number } | null {
  let j = start
  const n = s.length
  if (j >= n) return null
  let piece = ''
  if (s[j] === 45 || s[j] === 0x2212 || s[j] === 43) {
    if (s[j] !== 43) piece += '-'
    j++
    if (j >= n) return null
  }
  if (s[j] === 123 || s[j] === 40) {
    const close = s[j] === 123 ? 125 : 41
    let k = j + 1
    let count = 0
    while (k < n && s[k] !== close && count < 12) {
      const c = s[k]
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122)) piece += String.fromCharCode(c)
      else if (c >= 65 && c <= 90) piece += String.fromCharCode(c + 32)
      else if (c === 45 || c === 43 || c === 0x2212) piece += c === 43 ? '+' : '-'
      k++
      count++
    }
    if (!(k < n && s[k] === close && piece)) return null
    j = k + 1
  } else if (isAsciiDigit(s[j])) {
    let k = j
    while (k < n && k - j < 3 && isAsciiDigit(s[k])) { piece += String.fromCharCode(s[k]); k++ }
    j = k
  } else if ((s[j] >= 97 && s[j] <= 122) || (s[j] >= 65 && s[j] <= 90)) {
    // Una sola letra: en "a_name" o "e^kt" lo que sigue es otra palabra
    if (j + 1 < n && isAlphabeticCP(s[j + 1])) return null
    const v = s[j]
    piece += String.fromCharCode(v >= 65 && v <= 90 ? v + 32 : v)
    j++
  } else return null
  if (!piece) return null
  return { text: marker + piece, end: j }
}

export function tokenize(text: string, keepStopwords = false, stem = true): Token[] {
  const s = codePoints(text)
  const n = s.length
  const tokens: Token[] = []
  const emit = (term: string, lo: number, hi: number, formula: boolean, afterApostrophe: boolean, followedByApostrophe: boolean): void => {
    if (!term || (term.length > 16 && utf8Length(term) > 64)) return
    if (afterApostrophe && CONTRACTION_SUFFIXES.has(term)) return
    if (followedByApostrophe && charCount(term) === 1) return
    if (formula) { tokens.push({ term, lo, hi }); return }
    if (!keepStopwords && STOPWORDS.has(term)) return
    tokens.push({ term: stem ? stemWord(term) : term, lo, hi })
  }

  let i = 0
  while (i < n) {
    const v = s[i]
    // Símbolos matemáticos con nombre
    const symbol = SYMBOL_NAMES[v]
    if (symbol) { tokens.push({ term: symbol, lo: i, hi: i + 1 }); i++; continue }
    // Letras griegas sueltas → su nombre
    if ((v >= 0x370 && v <= 0x3ff) || v === 0xb5) {
      const lower = String.fromCodePoint(v).toLowerCase().codePointAt(0) ?? v
      const g = GREEK_NAMES[lower] ?? GREEK_NAMES[v]
      if (g) {
        const nextIsGreek = i + 1 < n && isGreekLetter(s[i + 1])
        const prevIsGreek = i > 0 && isGreekLetter(s[i - 1])
        if (!nextIsGreek && !prevIsGreek) { tokens.push({ term: g, lo: i, hi: i + 1 }); i++; continue }
      }
    }
    if (!isWordChar(v)) { i++; continue }
    // CJK: cada ideograma es un término
    if (isCJK(v)) { tokens.push({ term: String.fromCodePoint(v), lo: i, hi: i + 1 }); i++; continue }

    // Palabra: letras y cifras, con exponentes, subíndices, decimales y fracciones
    const start = i
    const afterApostrophe = start > 0 && (s[start - 1] === 39 || s[start - 1] === 0x2019)
    let buf = ''
    let bufCount = 0
    let bufLast = -1
    let formula = false
    let lastDigit = false
    let j = i
    const append = (t: string): void => {
      buf += t
      for (const ch of t) { bufCount++; bufLast = ch.codePointAt(0) ?? bufLast }
    }
    scan: while (j < n) {
      const cv = s[j]
      if (cv < 128) {
        if (cv >= 97 && cv <= 122) { buf += String.fromCharCode(cv); bufCount++; bufLast = cv; lastDigit = false; j++; continue }
        if (cv >= 65 && cv <= 90) { buf += String.fromCharCode(cv + 32); bufCount++; bufLast = cv + 32; lastDigit = false; j++; continue }
        if (cv >= 48 && cv <= 57) { buf += String.fromCharCode(cv); bufCount++; bufLast = cv; lastDigit = true; j++; continue }
        switch (cv) {
          case 94: { // ^
            if (!buf) break scan
            const r = parseScript(s, j + 1, '^')
            if (!r) break scan
            append(r.text); formula = true; j = r.end
            break scan
          }
          case 95: { // _ : subíndice solo tras una base corta (x_1, a_n, log_2); "snake_case" no lo es
            if (!buf || bufCount > 3 || j + 1 >= n || !(isWordChar(s[j + 1]) || s[j + 1] === 123)) break scan
            const r = parseScript(s, j + 1, '_')
            if (!r) break scan
            append(r.text); formula = true; j = r.end
            break scan
          }
          case 42: { // ** como potencia
            if (!buf || j + 1 >= n || s[j + 1] !== 42) break scan
            const r = parseScript(s, j + 2, '^')
            if (!r) break scan
            append(r.text); formula = true; j = r.end
            break scan
          }
          case 46: case 44: // . ,
            if (lastDigit && j + 1 < n && isAsciiDigit(s[j + 1])) { append('.'); formula = true; lastDigit = false; j++; continue }
            break scan
          case 47: // /
            if (lastDigit && j + 1 < n && isAsciiDigit(s[j + 1])) { append('/'); formula = true; lastDigit = false; j++; continue }
            break scan
          default:
            break scan
        }
      }
      // Un ideograma dentro de una palabra latina («Python入門») empieza otro término
      if (isCJK(cv)) break scan
      const sup = SUPERSCRIPTS[cv]
      if (sup !== undefined && buf) { append('^' + sup); formula = true; j++; break scan }
      if (cv >= 0x2080 && cv <= 0x2089 && buf) { append('_' + String.fromCharCode(48 + cv - 0x2080)); formula = true; j++; break scan }
      if (isMarkCP(cv)) { j++; continue }
      // "sinθ", "2π": una letra griega empieza otro término
      if (cv >= 0x370 && cv <= 0x3ff && bufLast >= 0 && bufLast < 0x250) break scan
      if (isWordChar(cv)) {
        const f = foldedLetters(cv)
        if (f) { append(f); lastDigit = isDecimalCP(cv) }
        j++
        continue
      }
      break scan
    }
    const end = Math.max(j, start + 1)
    const followedByApostrophe = end < n && (s[end] === 39 || s[end] === 0x2019)
    const term = buf
    if (formula) {
      emit(term, start, end, true, afterApostrophe, followedByApostrophe)
      // También la base ("sin^2" → "sin") para que la consulta "sin" encuentre "sin^2 x"
      const caret = term.search(/[\^_]/)
      if (caret > 0) {
        const base = term.slice(0, caret)
        if (charCount(base) >= 2 && /^\p{Alphabetic}+$/u.test(base)) emit(base, start, end, false, false, false)
      }
    } else {
      emit(term, start, end, /\p{N}/u.test(term), afterApostrophe, followedByApostrophe)
    }
    i = end
  }
  return tokens
}

/** Sin los superíndices (marca y contenido) y sin la marca de los subíndices: `SO_4^{2−}` → `SO4`, `H_2O` → `H2O`. */
export function withoutSuperscripts(text: string): string {
  if (!text.includes('^') && !text.includes('_')) return text
  const s = codePoints(text)
  let out = ''
  let i = 0
  const isSign = (v: number): boolean => v === 43 || v === 45 || v === 0x2212
  while (i < s.length) {
    const u = s[i]
    if (u === 95) { i++; continue }
    if (u === 94) {
      i++
      if (i < s.length && s[i] === 123) {
        let depth = 0
        while (i < s.length) {
          if (s[i] === 123) depth++
          else if (s[i] === 125) depth--
          i++
          if (depth === 0) break
        }
      } else {
        // Sin llaves: signo y cifras («^2-», «^-1», «^3+») o una letra
        if (i < s.length && isSign(s[i])) i++
        if (i < s.length && isAsciiDigit(s[i])) { while (i < s.length && isAsciiDigit(s[i])) i++ }
        else if (i < s.length && isAlphabeticCP(s[i])) i++
        // La carga final («^2-») sí; un signo seguido de algo («x^2-3») es una resta y se queda
        if (i < s.length && isSign(s[i]) && (i + 1 >= s.length || !(isAlphabeticCP(s[i + 1]) || /\p{N}/u.test(String.fromCodePoint(s[i + 1]))))) i++
      }
      continue
    }
    out += String.fromCodePoint(u)
    i++
  }
  return out
}

/** Sin las marcas de superíndice/subíndice (`H_2O` → `H2O`, `cm^3` → `cm3`, `10^{4}` → `104`). */
export function withoutScripts(text: string): string {
  if (!text.includes('^') && !text.includes('_')) return text
  const s = codePoints(text)
  let out = ''
  let i = 0
  while (i < s.length) {
    const u = s[i]
    if (u === 94 || u === 95) {
      i++
      if (i < s.length && s[i] === 123) {
        i++
        let depth = 1
        while (i < s.length && depth > 0) {
          const v = s[i]
          if (v === 123) { depth++; out += '{' }
          else if (v === 125) { depth--; if (depth > 0) out += '}' }
          else out += String.fromCodePoint(v)
          i++
        }
      }
      continue
    }
    out += String.fromCodePoint(u)
    i++
  }
  return out
}
