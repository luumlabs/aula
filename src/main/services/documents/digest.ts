// Lo esencial de un documento sin IA (port de DocumentDigest.swift): las frases que más dicen de cada página, las palabras que
// más se repiten y las pistas de examen («importante», «entra en el examen», definiciones, fórmulas). La IA redacta a partir de
// esto citando las páginas, y el lector lo usa para «¿Qué entra en el examen?».
import { pageText, type DocumentPages } from './pages'

export interface DigestLine {
  page: number
  text: string
  score: number
}

export interface DocumentDigest {
  /** Por página: sus frases clave, en el orden en que aparecen. */
  pages: { page: number; lines: DigestLine[] }[]
  /** Frases con pistas de examen, por página. */
  examSignals: DigestLine[]
  /** Palabras más repetidas (temas). */
  keywords: string[]
}

export const SIGNAL_WORDS: readonly string[] = [
  'examen', 'exam', 'prueba', 'parcial', 'quiz', 'test', 'importante', 'important', 'recuerda', 'remember', 'no olvides', 'ojo', 'atencion', 'attention',
  'clave', 'key ', 'se define', 'definicion', 'definition', 'defined as', 'se llama', 'is called', 'teorema', 'theorem', 'ley de', 'law of', 'principio', 'principle',
  'formula', 'propiedad', 'property', 'regla', 'rule', 'conclusion', 'en resumen', 'in summary', 'caracteristicas', 'characteristics', 'funcion de', 'tipos de', 'types of',
  // los otros idiomas de Aula
  'prova', 'lembre', 'definicao', 'propriedade', 'regra', 'em resumo',
  'a retenir', 'retenez', 'theoreme', 'loi de', 'propriete', 'regle', 'en resume',
  'prufung', 'klausur', 'wichtig', 'merke', 'gesetz', 'regel', 'zusammenfassung',
  'esame', 'ricorda', 'definizione', 'legge di', 'proprieta', 'regola', 'in sintesi',
  'экзамен', 'важно', 'запомни', 'определение', 'теорема', 'закон', 'свойство', 'правило', 'итог',
  'امتحان', 'مهم', 'تذكر', 'تعريف', 'نظرية', 'قانون', 'قاعدة', 'خلاصة',
  'परीक्षा', 'महत्वपूर्ण', 'याद रखें', 'परिभाषा', 'प्रमेय', 'नियम', 'सूत्र', 'सारांश',
  '考试', '重要', '注意', '定义', '定理', '公式', '性质', '规则', '总结',
  '試験', '定義', '性質', 'まとめ', 'ポイント',
  '시험', '중요', '주의', '정의', '정리', '공식', '성질', '요약'
]

/** Pliega como Swift (`.diacriticInsensitive, .caseInsensitive`). */
export function digestFold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
}

const FOLDED_SIGNALS = SIGNAL_WORDS.map(digestFold)

const STOP = new Set(['para', 'como', 'pero', 'este', 'esta', 'estos', 'estas', 'entre', 'sobre', 'cuando', 'donde', 'desde', 'hasta', 'tiene', 'tienen', 'puede', 'pueden',
  'que', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'con', 'por', 'sus', 'son', 'más', 'mas', 'sin', 'muy', 'también', 'tambien', 'cada', 'todo', 'todos',
  'with', 'that', 'this', 'from', 'have', 'which', 'their', 'there', 'these', 'those', 'into', 'when', 'where', 'also', 'than', 'then', 'they', 'will', 'would',
  'were', 'been', 'being', 'what', 'your', 'such', 'some', 'more', 'most', 'other', 'only', 'each', 'about', 'after', 'before', 'between', 'because'])

/** Escritura sin espacios entre palabras (chino, japonés): una frase corta ya dice mucho. */
export function isCJK(s: string): boolean {
  return /[぀-ヿ㐀-鿿]/.test(s)
}

/** Las palabras de una frase que cuentan (4+ letras, sin las vacías). */
export function digestWords(s: string): string[] {
  return digestFold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => Array.from(w).length >= 4 && !STOP.has(w) && /\p{L}/u.test(w))
}

/** Frases de 30–420 caracteres (las líneas sueltas cortas, como títulos, también cuentan si tienen 3+ palabras). */
export function digestSentences(t: string): string[] {
  const out: string[] = []
  let current = ''
  const ends = '.!?;。！？；؟؛।॥'
  const push = (raw: string, final: boolean): void => {
    const s = raw.replace(/\n/g, ' ').trim()
    const n = Array.from(s).length
    const ok = final ? n >= 30 || (n >= 10 && isCJK(s)) : n >= 30 || (s.split(' ').filter(Boolean).length >= 3 && n >= 12) || (n >= 10 && isCJK(s))
    if (ok) out.push(Array.from(s).slice(0, 420).join(''))
  }
  for (const ch of t.replace(/\n/g, ' \n ')) {
    current += ch
    if (ends.includes(ch) || ch === '\n') {
      push(current, false)
      current = ''
    }
  }
  push(current, true)
  return out
}

/** El resumen sin IA de un tramo de páginas (`range` 1…n incluido). */
export function makeDigest(doc: DocumentPages, range?: [number, number], perPage = 2, signals = 14): DocumentDigest {
  const [r0, r1] = range ?? [1, Math.max(1, doc.pages.length)]
  const lo = Math.max(1, r0), hi = Math.min(doc.pages.length, r1)
  if (lo > hi) return { pages: [], examSignals: [], keywords: [] }
  const tf = new Map<string, number>()
  const sentences: { page: number; text: string; terms: string[]; order: number }[] = []
  for (let p = lo; p <= hi; p++) {
    for (const s of digestSentences(pageText(doc, p))) {
      const terms = digestWords(s)
      sentences.push({ page: p, text: s, terms, order: sentences.length })
      for (const t of new Set(terms)) tf.set(t, (tf.get(t) ?? 0) + 1)
    }
  }
  const keywords = [...tf.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14).map(([k]) => k)
  const byPage = new Map<number, (DigestLine & { order: number })[]>()
  const sig: DigestLine[] = []
  for (const s of sentences) {
    if (!s.terms.length) continue
    let score = s.terms.reduce((acc, t) => acc + Math.log(1 + (tf.get(t) ?? 0)), 0) / Math.sqrt(s.terms.length + 2)
    const f = digestFold(s.text)
    const signal = FOLDED_SIGNALS.some((w) => f.includes(w))
    if (signal) score += 2.5
    if (s.text.includes('=') || /\d/.test(s.text)) score += 0.4
    const line = { page: s.page, text: s.text, score, order: s.order }
    const list = byPage.get(s.page) ?? []
    list.push(line)
    byPage.set(s.page, list)
    if (signal) sig.push({ page: s.page, text: s.text, score })
  }
  const pages: DocumentDigest['pages'] = []
  for (let p = lo; p <= hi; p++) {
    const ls = byPage.get(p)
    if (!ls?.length) continue
    const best = [...ls].sort((a, b) => b.score - a.score).slice(0, perPage).sort((a, b) => a.order - b.order)
    pages.push({ page: p, lines: best.map(({ page, text, score }) => ({ page, text, score })) })
  }
  const examSignals = [...sig].sort((a, b) => b.score - a.score).slice(0, signals).sort((a, b) => a.page - b.page)
  return { pages, examSignals, keywords }
}
