// Búsqueda en la hoja de fórmulas (pura): sin acentos ni mayúsculas, en el nombre, el tema, el «cuándo se usa», las
// variables y el propio LaTeX; todas las palabras tienen que aparecer. Los resultados del nombre van primero.
import { CONSTANTS, FORMULAS, texOf, type Constant, type FormulaEntry, type Subject } from './data'

export type Lang = 'es' | 'en'

export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** Texto de LaTeX legible para buscar («\frac{m}{M}» → «frac m M»). */
const texWords = (tex: string) => tex.replace(/\\([a-zA-Z]+)/g, ' $1 ').replace(/[{}^_\\]/g, ' ')

function score(e: FormulaEntry, words: string[], lang: Lang): number {
  const name = fold(e.name[lang] + ' ' + e.name[lang === 'es' ? 'en' : 'es'])
  const rest = fold([e.topic[lang], e.when[lang], e.vars?.[lang] ?? '', texWords(texOf(e, lang)), e.id].join(' '))
  let s = 0
  for (const w of words) {
    if (name.includes(w)) s += name.startsWith(w) ? 4 : 3
    else if (rest.includes(w)) s += 1
    else return 0
  }
  return s
}

export function searchFormulas(query: string, lang: Lang, subject: Subject | 'all' = 'all', only?: ReadonlySet<string>): FormulaEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  const pool = FORMULAS.filter((f) => (subject === 'all' || f.subject === subject) && (!only || only.has(f.id)))
  if (!words.length) return pool
  return pool
    .map((f) => ({ f, s: score(f, words, lang) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.f)
}

export function searchConstants(query: string, lang: Lang): Constant[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return CONSTANTS
  return CONSTANTS.filter((c) => {
    const hay = fold([c.name.es, c.name.en, c.symbol, c.unit, c.id].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/** Agrupa por tema conservando el orden de la hoja. */
export function groupByTopic(list: FormulaEntry[], lang: Lang): { topic: string; subject: Subject; items: FormulaEntry[] }[] {
  const out: { topic: string; subject: Subject; items: FormulaEntry[] }[] = []
  for (const f of list) {
    const key = f.topic[lang]
    const g = out.find((x) => x.topic === key)
    if (g) g.items.push(f)
    else out.push({ topic: key, subject: f.subject, items: [f] })
  }
  return out
}

/** LaTeX con el separador decimal del idioma (la hoja se escribe con «{,}»). */
export function localizeDecimal(tex: string, lang: Lang): string {
  return lang === 'es' ? tex : tex.replace(/\{,\}/g, '.')
}
