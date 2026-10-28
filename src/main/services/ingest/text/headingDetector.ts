// Reconoce líneas que son títulos: Markdown (`## Título`), numerados ("3.2 Círculo unidad"), con palabra clave
// ("Capítulo 3", "Section 2") o EN MAYÚSCULAS. Sirve para propagar el encabezado a cada fragmento.
import { charCount, chars, foldDiacritics, isLetter, isNumber, isUppercase, trimSet, trimWS } from './unicode'

export interface Heading {
  level: number
  title: string
}

const KEYWORD_LEVELS: Record<string, number> = {
  parte: 1, part: 1, capitulo: 1, chapter: 1, tema: 1, unidad: 1, unit: 1, modulo: 1, module: 1,
  apendice: 1, appendix: 1, anexo: 1, seccion: 2, section: 2, leccion: 2, lesson: 2
}

const KEYWORD_NUMBER = /^(\d+(\.\d+)*|[IVXLCivxlc]{1,6}|[A-Za-z])$/
const NUMBERED = /^\d{1,2}(\.\d{1,2}){1,4}\.?\s+/

function trimPunctuation(s: string): string {
  return s.replace(/^\p{P}+|\p{P}+$/gu, '')
}

export function parseHeading(rawLine: string): Heading | null {
  const line = trimWS(rawLine)
  if (!line || charCount(line) > 140) return null

  // 1. Markdown ATX
  if (line.startsWith('#')) {
    const hashes = /^#+/.exec(line)?.[0].length ?? 0
    const rest = line.slice(hashes)
    if (hashes <= 6 && rest.startsWith(' ')) {
      const title = trimSet(rest, '# \t')
      if (title) return { level: hashes, title }
    }
    return null
  }
  if (line.startsWith('- ') || line.startsWith('> ') || line.startsWith('* ') || line.includes(' | ') || line.includes('....')) return null
  const lc = chars(line)
  if (lc.length > 100) return null
  const last = lc[lc.length - 1]

  // 2. Palabra clave + número: "Capítulo 3: Trigonometría", "SECTION 2.1"
  const words = splitMax(line, 2)
  if (words.length >= 2) {
    const key = trimPunctuation(foldDiacritics(words[0]))
    const level = KEYWORD_LEVELS[key]
    if (level !== undefined) {
      const number = trimSet(words[1], '.:)-–—')
      if (KEYWORD_NUMBER.test(number) && (last !== '.' || words.length === 2)) return { level, title: line }
    }
  }

  // 3. Numerados con varios niveles: "3.2 Título", "3.2.1. Título"
  const m = NUMBERED.exec(line)
  if (m) {
    const title = line.slice(m[0].length)
    const first = chars(title.slice(0, 4))[0]
    if (first !== undefined && (isUppercase(first) || first === '¿' || first === '¡') && last !== '.' && last !== ',' && !title.includes('=')) {
      const numbering = trimSet(m[0], '. \t')
      return { level: Math.min(numbering.split('.').filter((x) => x.length > 0).length, 6), title: line }
    }
  }

  // 4. EN MAYÚSCULAS
  if (isAllCaps(line)) return { level: 1, title: line }
  return null
}

/** Como `split(separator: " ", maxSplits:)` de Swift: sin trozos vacíos, como mucho `maxSplits + 1` trozos. */
function splitMax(s: string, maxSplits: number): string[] {
  const out: string[] = []
  let i = 0
  while (i < s.length && s[i] === ' ') i++
  while (i < s.length) {
    if (out.length === maxSplits) { out.push(s.slice(i)); break }
    let j = s.indexOf(' ', i)
    if (j < 0) j = s.length
    out.push(s.slice(i, j))
    i = j
    while (i < s.length && s[i] === ' ') i++
  }
  return out
}

const CAPS_NEUTRAL = new Set(Array.from(':-–—/&(),¿?¡!\'^_{}'))

/** Línea en mayúsculas (≥ 4 letras, pocas palabras, sin fórmulas ni punto final). */
export function isAllCaps(line: string): boolean {
  let letters = 0, upper = 0, others = 0
  const cs = chars(line)
  for (const ch of cs) {
    if (isLetter(ch)) { letters++; if (isUppercase(ch)) upper++ }
    else if (isNumber(ch) || ch === ' ') continue
    else if (CAPS_NEUTRAL.has(ch)) continue
    else others++
  }
  if (letters < 4 || upper !== letters || others !== 0) return false
  if (line.includes('___')) return false
  const first = cs[0]
  if (first === undefined || !(isLetter(first) || isNumber(first))) return false
  const last = cs[cs.length - 1]
  if (last === '.' || last === ';') return false
  return line.split(' ').filter((w) => w.length > 0).length <= 12
}

/** Título de la primera línea de encabezado entre las primeras líneas del texto. */
export function firstHeading(text: string): string | null {
  let seen = 0
  for (const raw of text.split('\n')) {
    if (!raw) continue
    if (++seen > 20) break
    const h = parseHeading(raw)
    if (h) return h.title
  }
  return null
}
