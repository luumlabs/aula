// Corrección exacta de texto (huecos y respuestas cortas de los cursos de idiomas): las tildes, la ortografía y los artículos
// cuentan; las mayúsculas y la puntuación no. Lo que «casi» coincide (igual sin tildes, sin el artículo o con una errata leve)
// vale 0, con un aviso que dice qué revisar sin dar la respuesta: «murio» por «murió» o «aprobaran» por «aprobaron» no son
// erratas en una clase de español, son el error que se practica.
import { TextChecker, textMatchOptions, type TextMatchOptions } from '@engine/math'
import { AnswerChecker } from './math-bridge'
import { L } from './messages'
import { feedbackLine, makeGrade, type GradeLang, type GradeResult } from './types'

/** Opciones de la lectura exacta. */
export const EXACT_TEXT_OPTIONS: Readonly<Partial<TextMatchOptions>> = {
  ignoreCase: true, ignoreAccents: false, ignorePunctuation: true, ignoreArticles: false, typoTolerance: false
}

/** Qué falla en una respuesta casi correcta. */
export type NearMissKind = 'accents' | 'articles' | 'spelling'

export interface NearMiss {
  kind: NearMissKind
  /** Las palabras del estudiante que no coinciden (como las escribió, normalizadas), para señalarlas sin dar la respuesta. */
  words: string[]
}

const lenientWith = (o: Partial<TextMatchOptions>): TextMatchOptions => textMatchOptions({ ...EXACT_TEXT_OPTIONS, ...o, keywords: [], minKeywordsForCredit: null })

/** Las palabras de `got` que no están en la variante aceptada más parecida (misma cantidad de palabras). */
function differingWords(got: string, accepted: readonly string[]): string[] {
  const checker = new TextChecker(accepted, [], textMatchOptions(EXACT_TEXT_OPTIONS))
  const fold = new TextChecker(accepted, [], lenientWith({ ignoreAccents: true }))
  const given = checker.words(got)
  let best: string[] = []
  let bestSame = -1
  for (const a of accepted) {
    const want = checker.words(a)
    if (want.length !== given.length) continue
    const same = given.filter((w, i) => w === want[i]).length
    // a igualdad, la variante que también coincide sin tildes (la que el estudiante quería escribir)
    const close = given.filter((w, i) => fold.words(w).join(' ') === fold.words(want[i]).join(' ')).length
    const score = same * 100 + close
    if (score > bestSame) { bestSame = score; best = given.filter((w, i) => w !== want[i]) }
  }
  return best.slice(0, 3)
}

/** ¿Lo escrito es casi una respuesta aceptada? (igual sin tildes, sin los artículos o con una errata leve) */
export function nearMiss(got: string, accepted: readonly string[], rejected: readonly string[] = []): NearMiss | undefined {
  // un error típico del autor («gano» por «ganó») no es un «casi»: tiene su propia explicación
  if (rejected.length && AnswerChecker.checkText(got, rejected, [], lenientWith({})).status === 'correct') return undefined
  const check = (o: Partial<TextMatchOptions>) => AnswerChecker.checkText(got, accepted, rejected, lenientWith(o))
  if (check({ ignoreAccents: true }).status === 'correct') return { kind: 'accents', words: differingWords(got, accepted) }
  if (check({ ignoreArticles: true }).status === 'correct') return { kind: 'articles', words: [] }
  const loose = check({ ignoreAccents: true, ignoreArticles: true, typoTolerance: true })
  if (loose.status === 'correct' || loose.status === 'partial') return { kind: 'spelling', words: differingWords(got, accepted) }
  return undefined
}

/** El aviso de una respuesta casi correcta (sin la respuesta: solo qué revisar y dónde). */
export function nearMissMessage(m: NearMiss, lang?: GradeLang): string {
  const shown = m.words.length ? m.words.map((w) => L(lang, `«${w}»`, `“${w}”`)).join(', ') : ''
  switch (m.kind) {
    case 'accents':
      return shown ? L(lang, `Revisa las tildes de ${shown}: aquí cuentan.`, `Check the accents in ${shown}: they count here.`)
        : L(lang, 'Revisa las tildes: aquí cuentan.', 'Check the accents: they count here.')
    case 'articles':
      return L(lang, 'Revisa los artículos (el, la, un…): aquí cuentan.', 'Check the articles: they count here.')
    case 'spelling':
      return shown ? L(lang, `Fíjate en la forma exacta de ${shown}: aquí cuentan la ortografía y la concordancia.`, `Look at the exact form of ${shown}: spelling and agreement count here.`)
        : L(lang, 'Fíjate en la forma exacta: aquí cuentan la ortografía y la concordancia.', 'Look at the exact form: spelling and agreement count here.')
  }
}

/**
 * Resultado de una respuesta que la lectura exacta dio por incorrecta pero que es casi correcta: 0 de crédito (no puede parecer
 * un acierto) y el aviso de qué revisar. undefined si no es un «casi».
 */
export function nearMissGrade(got: string, accepted: readonly string[], rejected: readonly string[], lang?: GradeLang, echoPlain?: string): GradeResult | undefined {
  const m = nearMiss(got, accepted, rejected)
  if (!m) return undefined
  return makeGrade('incorrect', 0, { feedback: [feedbackLine('hint', nearMissMessage(m, lang))], diagnosis: [m.kind], ...(echoPlain !== undefined ? { echoPlain } : {}) })
}
