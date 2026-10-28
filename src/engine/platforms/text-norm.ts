// Normalización de etiquetas para comparar (port de ComputerKit/Safety/TextNorm.swift): minúsculas, sin acentos (ñ → n),
// apóstrofos fuera, todo lo que no sea letra, número o marca → espacio, espacios colapsados.
// «¿Cerrar sesión?» → «cerrar sesion»; «Submit (opens in new window)» → «submit opens in new window»; «I’m done» → «im done».

const APOSTROPHES = /['’‘`]/g
const NOT_ALNUM = /[^\p{L}\p{N}\p{M}]+/gu

/** Letras cirílicas y griegas que parecen latinas (lo esencial del «skeleton» de UTS #39), ya en minúsculas. */
const LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x'
}
const LATIN = /\p{Script=Latin}/u
const CYRILLIC_OR_GREEK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u

/** Una palabra que mezcla letras latinas con cirílicas o griegas («Ѕubmit» con S cirílica) se escribe con las latinas. */
function unmixScripts(word: string): string {
  if (!LATIN.test(word) || !CYRILLIC_OR_GREEK.test(word)) return word
  return Array.from(word, (ch) => LOOKALIKES[ch] ?? ch).join('')
}

export function normalizeLabel(s: string): string {
  if (!s) return ''
  // NFKD separa acentos y anchos; se quitan las marcas sin espacio (acentos, hamza, diéresis) y se recompone (hangul)
  let t = s.normalize('NFKD').replace(/\p{Mn}/gu, '').normalize('NFC')
  // caracteres invisibles de formato (espacio de anchura cero, guion blando, unión de palabras…): «Sub\u200Bmit» = «Submit» (A2-P2-11)
  t = t.replace(/\p{Cf}/gu, '')
  t = t.replace(/ß/g, 'ss').replace(/ẞ/g, 'ss').toLowerCase()
  t = t.replace(APOSTROPHES, '').replace(NOT_ALNUM, ' ').trim()
  t = t.replace(/ +/g, ' ')
  t = t.split(' ').map(unmixScripts).join(' ')
  // letras sueltas separadas por espacios («S u b m i t»): se juntan
  t = t.replace(/(?:^|(?<= ))(\p{L}(?: \p{L}){2,})(?= |$)/gu, (m) => m.replace(/ /g, ''))
  return t
}

/** Palabras de un texto ya normalizado. */
export function words(normalized: string): string[] {
  return normalized ? normalized.split(' ') : []
}

/** Colapsa espacios (incluidos saltos de línea, espacios duros y de anchura cero) sin cambiar mayúsculas ni acentos. */
export function collapseSpaces(s: string): string {
  return s.replace(/[\s ​﻿]+/g, ' ').trim()
}

/** Recorta a `max` caracteres con «…». */
export function clip(s: string, max: number): string {
  const chars = [...s]
  if (chars.length <= max || max <= 1) return s
  return chars.slice(0, max - 1).join('') + '…'
}

/** Han, kana y hangul (también jamo sueltos): escrituras sin espacios entre palabras. */
export function isDenseScriptChar(cp: number): boolean {
  return (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xd7b0 && cp <= 0xd7ff)
}

export function hasDenseScript(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (isDenseScriptChar(cp)) return true
  }
  return false
}
