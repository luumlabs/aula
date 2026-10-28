// Cabeceras, pies y números de página repetidos (port de HeaderFooterFilter de PDFExtractor.swift).
import type { TextLine } from './layoutBuilder'
import { isPageNumber } from './textCleaner'
import { charCount, trimSet } from './unicode'

interface Candidate { page: number; line: number; key: string; isNumber: boolean }

const midY = (l: TextLine): number => l.rect.y + l.rect.height / 2

/**
 * Quita, página a página, los números de página y las líneas de cabecera o pie que se repiten en gran parte de las páginas.
 * Solo mira las tres líneas más altas y las tres más bajas de cada página (bandas del 13 % superior e inferior).
 * Devuelve las páginas filtradas (nuevas listas; las de entrada no se tocan).
 */
export function filterHeadersAndFooters(pages: TextLine[][], pageHeights: number[]): TextLine[][] {
  if (pages.length === 0) return []
  const candidates: Candidate[] = []
  let pagesWithText = 0
  pages.forEach((lines, p) => {
    if (lines.length === 0) return
    pagesWithText++
    const h = pageHeights[p] ?? 0
    const idx = lines.map((_, i) => i)
    const top = idx.filter((i) => midY(lines[i]) < 0.13 * h).sort((a, b) => lines[a].rect.y - lines[b].rect.y).slice(0, 3)
    const bottom = idx.filter((i) => midY(lines[i]) > 0.87 * h).sort((a, b) => lines[b].rect.y - lines[a].rect.y).slice(0, 3)
    for (const [zone, list] of [['t', top], ['b', bottom]] as const) {
      for (const i of list) {
        const text = lines[i].text
        if (charCount(text) > 120) continue
        candidates.push({ page: p, line: i, key: zone + ':' + normalizedKey(text), isNumber: isPageNumber(text) })
      }
    }
  })
  const pagesByKey = new Map<string, Set<number>>()
  for (const c of candidates) {
    if (c.isNumber || charCount(c.key) < 5) continue
    let set = pagesByKey.get(c.key)
    if (!set) pagesByKey.set(c.key, (set = new Set()))
    set.add(c.page)
  }
  const needed = Math.max(3, Math.ceil(0.4 * pagesWithText))
  const remove = new Map<number, Set<number>>()
  for (const c of candidates) {
    if (c.isNumber || (pagesWithText >= 3 && (pagesByKey.get(c.key)?.size ?? 0) >= needed)) {
      let set = remove.get(c.page)
      if (!set) remove.set(c.page, (set = new Set()))
      set.add(c.line)
    }
  }
  return pages.map((lines, p) => {
    const drop = remove.get(p)
    return drop ? lines.filter((_, i) => !drop.has(i)) : lines
  })
}

/**
 * Clave de comparación de una línea de cabecera o pie: minúsculas, espacios normalizados y sin el número de página
 * («Tema 3 — Página 12» y «Tema 3 — Página 13» dan la misma clave). Las demás cifras se conservan.
 */
export function normalizedKey(s: string): string {
  let t = s.toLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/(p[aá]g(ina)?\.?|page|pp?\.|hoja|sheet)\s*\d+(\s*(de|of|\/)\s*\d+)?/gu, ' '],   // «Página 12», «page 3 of 9», «p. 4»
    [/\b\d+\s*(de|of|\/)\s*\d+\b/gu, ' '],                                          // «12 de 80», «3/10»
    [/^\s*\d+\s*[-–—|•·:]\s*/u, ''],                                                // «12 — texto»
    [/\s*[-–—|•·:]\s*\d+\s*$/u, '']                                                 // «texto — 12»
  ]
  for (const [pattern, replacement] of rules) t = t.replace(pattern, replacement)
  let out = ''
  let space = false
  for (const ch of t) {
    if (/\s/u.test(ch)) { space = true; continue }
    if (space && out) out += ' '
    space = false
    out += ch
  }
  return trimSet(out, ' -–—|•·:.,;')
}
