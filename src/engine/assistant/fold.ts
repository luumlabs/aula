// Comparar textos sin acentos ni mayúsculas (como `String.folding(options: [.diacriticInsensitive, .caseInsensitive,
// .widthInsensitive])` de Swift).

/** Sin acentos, sin mayúsculas y con los caracteres de ancho completo normalizados. Conserva signos y espacios. */
export function foldPlain(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** Como `MemoryText.fold`: minúsculas, sin acentos ni puntuación, espacios colapsados (para tokenizar). */
export function fold(s: string): string {
  const t = foldPlain(s)
  let out = ''
  let lastSpace = true
  for (const ch of t) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      out += ch
      lastSpace = false
    } else if (!lastSpace) {
      out += ' '
      lastSpace = true
    }
  }
  return out.trim()
}

/** Número de caracteres (puntos de código, como `String.count` aproximado). */
export function charCount(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

/** Los primeros `n` caracteres (sin partir un emoji ni un carácter fuera del BMP). */
export function prefixChars(s: string, n: number): string {
  if (s.length <= n) return s
  return Array.from(s).slice(0, n).join('')
}
