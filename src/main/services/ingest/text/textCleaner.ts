// Limpieza de texto extraído de PDF y OCR: ligaduras, símbolos de la fuente Symbol, guiones de fin de línea, viñetas,
// espacios, números de página y (sin geometría) unión de líneas partidas por el ancho de la página.
import { foldMathScalar } from '../extract/mathLinearizer'
import { charCount, chars, isLetter, isLowercase, isNumber, isUppercase, trimWS } from './unicode'

// MARK: Caracteres

const NEEDS_NORMALIZE = /[\u0000-\u0008\u000B-\u001F ­ -‏ﬀ-ﬆ-\u2028\u2029﻿⁠  　\u007F]|[\u{1D400}-\u{1D7FF}]/u

/** Fuente Symbol (Adobe) → Unicode, para PDF de Word con símbolos en la zona privada U+F0xx. */
const SYMBOL_FONT: Map<number, string> = (() => {
  const m = new Map<number, string>()
  const table: Array<[number, string]> = [
    [0x20, ' '], [0x21, '!'], [0x22, '∀'], [0x23, '#'], [0x24, '∃'], [0x25, '%'], [0x26, '&'], [0x27, '∋'], [0x28, '('], [0x29, ')'],
    [0x2a, '∗'], [0x2b, '+'], [0x2c, ','], [0x2d, '−'], [0x2e, '.'], [0x2f, '/'], [0x3a, ':'], [0x3b, ';'], [0x3c, '<'], [0x3d, '='],
    [0x3e, '>'], [0x3f, '?'], [0x40, '≅'], [0x5b, '['], [0x5c, '∴'], [0x5d, ']'], [0x5e, '⊥'], [0x5f, '_'], [0x7b, '{'], [0x7c, '|'],
    [0x7d, '}'], [0x7e, '∼'], [0xa1, 'ϒ'], [0xa2, '′'], [0xa3, '≤'], [0xa4, '⁄'], [0xa5, '∞'], [0xa6, 'ƒ'], [0xa7, '♣'], [0xa8, '♦'],
    [0xa9, '♥'], [0xaa, '♠'], [0xab, '↔'], [0xac, '←'], [0xad, '↑'], [0xae, '→'], [0xaf, '↓'], [0xb0, '°'], [0xb1, '±'], [0xb2, '″'],
    [0xb3, '≥'], [0xb4, '×'], [0xb5, '∝'], [0xb6, '∂'], [0xb7, '•'], [0xb8, '÷'], [0xb9, '≠'], [0xba, '≡'], [0xbb, '≈'], [0xbc, '…'],
    [0xbf, '↵'], [0xc0, 'ℵ'], [0xc1, 'ℑ'], [0xc2, 'ℜ'], [0xc3, '℘'], [0xc4, '⊗'], [0xc5, '⊕'], [0xc6, '∅'], [0xc7, '∩'], [0xc8, '∪'],
    [0xc9, '⊃'], [0xca, '⊇'], [0xcb, '⊄'], [0xcc, '⊂'], [0xcd, '⊆'], [0xce, '∈'], [0xcf, '∉'], [0xd0, '∠'], [0xd1, '∇'], [0xd2, '®'],
    [0xd3, '©'], [0xd4, '™'], [0xd5, '∏'], [0xd6, '√'], [0xd7, '⋅'], [0xd8, '¬'], [0xd9, '∧'], [0xda, '∨'], [0xdb, '⇔'], [0xdc, '⇐'],
    [0xdd, '⇑'], [0xde, '⇒'], [0xdf, '⇓'], [0xe0, '◊'], [0xe1, '〈'], [0xe5, '∑'], [0xf1, '〉'], [0xf2, '∫']
  ]
  for (const [k, v] of table) m.set(k, v)
  for (let d = 0x30; d <= 0x39; d++) m.set(d, String.fromCharCode(d))
  Array.from('ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ').forEach((ch, i) => m.set(0x41 + i, ch))
  Array.from('αβχδεφγηιϕκλμνοπθρστυϖωξψζ').forEach((ch, i) => m.set(0x61 + i, ch))
  return m
})()

/** Ligaduras → letras, espacios raros → espacio, invisibles fuera, símbolos de la fuente Symbol → Unicode. */
export function normalizeCharacters(input: string): string {
  let s = input
  if (s.includes('\r')) s = s.replace(/\r\n?/g, '\n')
  if (!NEEDS_NORMALIZE.test(s)) return s
  let out = ''
  for (const ch of s) {
    const v = ch.codePointAt(0) ?? 0
    switch (true) {
      case v === 0xfb00: out += 'ff'; break
      case v === 0xfb01: out += 'fi'; break
      case v === 0xfb02: out += 'fl'; break
      case v === 0xfb03: out += 'ffi'; break
      case v === 0xfb04: out += 'ffl'; break
      case v === 0xfb05 || v === 0xfb06: out += 'st'; break
      case v === 0xa0 || (v >= 0x2000 && v <= 0x200a) || v === 0x202f || v === 0x205f || v === 0x3000: out += ' '; break
      case v === 0xad || (v >= 0x200b && v <= 0x200f) || v === 0x2060 || v === 0xfeff || v === 0x7f: break
      case v === 0x2028 || v === 0x2029 || v === 0x0c: out += '\n'; break
      case v < 32 && v !== 10 && v !== 9: break
      case v >= 0xf020 && v <= 0xf0ff: { const m = SYMBOL_FONT.get(v & 0xff); if (m) out += m; break }
      case v >= 0xe000 && v <= 0xf8ff: break
      case v >= 0x1d400 && v <= 0x1d7ff: out += String.fromCodePoint(foldMathScalar(v)); break
      default: out += ch
    }
  }
  return out
}

// MARK: Viñetas y números

const BULLET_GLYPHS = new Set(['•', '●', '○', '◦', '▪', '■', '□', '▫', '‣', '⁃', '◆', '◇', '➢', '➤', '►', '▸', '∙', '·', '⦁', '✓', '✔', '➔'])

function dropLeading(s: string, set: string): string {
  let i = 0
  while (i < s.length && set.includes(s[i])) i++
  return s.slice(i)
}

/** Si la línea empieza por una viñeta, la devuelve como `- texto`; si no, igual. */
export function normalizeBullet(line: string): string {
  const trimmed = dropLeading(line, ' \t')
  if (!trimmed) return line
  const indent = line.slice(0, line.length - trimmed.length)
  const cs = chars(trimmed)
  const first = cs[0]
  if (BULLET_GLYPHS.has(first)) {
    const rest = dropLeading(trimmed.slice(first.length), ' \t')
    return rest ? indent + '- ' + rest : line
  }
  if (first === '*' || first === '–' || first === '—') {
    const rest = trimmed.slice(first.length)
    const next = cs[2]
    if (cs[1] === ' ' && next !== undefined && (isLetter(next) || next === '(' || next === '¿' || next === '¡')) return indent + '- ' + rest.slice(1)
  }
  return line
}

/** ¿Es solo un marcador de lista ("2.", "a)", "(iv)", "3.1", "•")? */
export function isMarkerOnly(s: string): boolean {
  const t = trimWS(s)
  if (!t || charCount(t) > 6) return false
  if (charCount(t) === 1 && (BULLET_GLYPHS.has(t) || '-–—*'.includes(t))) return true
  return /^\(?(\d{1,3}(\.\d{1,3})*[.)]?|[A-Za-z][.)]|[ivxlIVXL]{1,4}[.)])$/.test(t)
}

const BULLET_START = /^(\(?\d{1,3}[.)]\s+\S|\d{1,3}(\.\d{1,3})+\.?\s+[A-ZÁÉÍÓÚÑ¿¡"“(\[]|\(?[a-zA-Z][.)]\s+\S|[ivxIVX]{1,4}[.)]\s+\S)/

export function startsWithBullet(line: string): boolean {
  const t = dropLeading(line, ' ')
  if (t.startsWith('- ')) return true
  const first = chars(t.slice(0, 4))[0]
  if (first !== undefined && BULLET_GLYPHS.has(first)) return true
  return BULLET_START.test(t)
}

const PAGE_NUMBER_PATTERNS = [
  /^[-–—\s]*\d{1,4}[-–—\s]*$/,
  /^(p[aá]g(ina)?|page|pp?)\.?\s*\d{1,4}(\s*(de|of|\/)\s*\d{1,4})?$/,
  /^\d{1,4}\s*(de|of|\/)\s*\d{1,4}$/,
  /^[-–—\s]*(?=[ivxlc]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})[-–—\s]*$/
]

/** ¿Es una línea con solo un número de página ("12", "- 12 -", "Página 12", "12 de 80", "Page 3 of 9")? */
export function isPageNumber(s: string): boolean {
  const t = s.trim().toLowerCase()
  if (!t || charCount(t) > 24) return false
  return PAGE_NUMBER_PATTERNS.some((p) => p.test(t))
}

// MARK: Guiones y uniones

/** Une dos líneas de un mismo párrafo; quita el guion de partición ("matemá-" + "tica") salvo ante mayúscula o cifra. */
export function joinLines(a: string, b: string): string {
  const left = trimWS(a)
  const right = trimWS(b)
  if (!left) return right
  if (!right) return left
  const lc = chars(left)
  const last = lc[lc.length - 1]
  if (last === '-' || last === '­' || last === '‐') {
    const before = lc[lc.length - 2]
    const r = chars(right.slice(0, 4))[0]
    if (before !== undefined && isLetter(before) && r !== undefined) {
      if (isLowercase(r)) return lc.slice(0, -1).join('') + right
      if (isUppercase(r) || isNumber(r)) return left + right
    }
  }
  return left + ' ' + right
}

// MARK: Texto sin geometría (respaldo)

/** Reconstruye párrafos de un texto en líneas físicas: solo une prosa claramente partida por el ancho. */
export function reflow(text: string): string {
  const lines = normalizeCharacters(text).split('\n').map((l) => trimWS(l))
  const proseLengths = lines.filter(isProse).map(charCount).sort((x, y) => x - y)
  const reference = proseLengths.length === 0 ? 0 : proseLengths[Math.min(proseLengths.length - 1, Math.floor(proseLengths.length * 0.9))]
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    let current = normalizeBullet(collapseSpaces(lines[i]))
    if (!current) {
      if (result[result.length - 1] !== '') result.push('')
      i++
      continue
    }
    while (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (!shouldJoin(current, next, reference)) break
      current = joinLines(current, collapseSpaces(next))
      i++
    }
    result.push(current)
    i++
  }
  return result.join('\n')
}

function shouldJoin(prev: string, next: string, reference: number): boolean {
  if (!prev || !next || reference < 40) return false
  if (startsWithBullet(next) && !prev.endsWith('-')) return false
  if (!((isProse(prev) || prev.startsWith('- ')) && isProse(next))) return false
  const pc = chars(prev)
  const last = pc[pc.length - 1]
  if ('.?!:;»”"'.includes(last)) return false
  if (prev.endsWith('-')) return true
  const first = chars(next.slice(0, 4))[0]
  if (first !== undefined && isLowercase(first)) return pc.length >= Math.floor(reference * 0.55)
  return pc.length >= Math.floor(reference * 0.92)
}

const NEUTRAL_PUNCTUATION = new Set([',', '.', ';', ':', '¿', '?', '¡', '!', '(', ')', '"', "'", '«', '»', '-', '–', '—'])

/** Línea de prosa: casi todo letras y espacios, varias palabras. */
export function isProse(s: string): boolean {
  const cs = chars(s)
  if (cs.length < 12) return false
  let letters = 0, digits = 0, others = 0
  for (const ch of cs) {
    if (isLetter(ch)) letters++
    else if (isNumber(ch)) digits++
    else if (ch === ' ') continue
    else if (!NEUTRAL_PUNCTUATION.has(ch)) others++
  }
  const words = s.split(' ').filter((w) => w.length > 0).length
  return words >= 3 && letters * 100 >= cs.length * 68 && digits * 100 <= cs.length * 12 && others * 100 <= cs.length * 6
}

/** Espacios y tabuladores seguidos a uno, sin los de los extremos. */
export function collapseSpaces(s: string): string {
  let out = ''
  let space = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === ' ' || c === '\t') { space = true; continue }
    if (space && out.length > 0) out += ' '
    space = false
    out += c
  }
  return out
}

// MARK: Cierre

/** Último repaso del texto de una página: sin espacios de más ni más de una línea en blanco seguida. */
export function finalizeText(text: string): string {
  const lines: string[] = []
  let blank = true
  for (const raw of text.split('\n')) {
    const line = trimWS(collapseSpaces(raw))
    if (!line) { if (!blank) lines.push(''); blank = true } else { lines.push(line); blank = false }
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

const GOOD_PUNCTUATION = new Set(Array.from(".,;:!?()[]{}'\"-–—/+=<>%&*¿¡«»°²³^_·•"))
const RE_ALPHABETIC = /\p{Alphabetic}/u
const RE_NUMERIC = /\p{N}/u
const RE_WHITE = /\p{White_Space}/u

/** ¿El texto es basura (fuentes sin mapa Unicode, caracteres de sustitución…)? Para decidir si conviene el OCR. */
export function looksLikeGarbage(s: string): boolean {
  let total = 0, good = 0, replacement = 0
  for (const ch of s) {
    if (RE_WHITE.test(ch)) continue
    total++
    const v = ch.codePointAt(0) ?? 0
    if (v === 0xfffd) replacement++
    else if (RE_ALPHABETIC.test(ch) || RE_NUMERIC.test(ch) || GOOD_PUNCTUATION.has(ch) || (v >= 0x2190 && v <= 0x22ff) || (v >= 0x370 && v <= 0x3ff)) good++
  }
  if (total < 12) return false
  if (replacement * 100 >= total * 8) return true
  return good * 100 < total * 55
}
