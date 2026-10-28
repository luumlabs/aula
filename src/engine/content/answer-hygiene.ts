// Comprobaciones de las claves que no son de estructura: una respuesta numérica sin tolerancia cuando los datos del enunciado
// son aproximados («La Paz ≈ 3.600 m, Quito ≈ 2.850 m» con la clave 750 exacta) y una pista que da la respuesta de un hueco.
// Avisos para la IA que escribe el contenido (español, con la ruta exacta). Puro.
import type { Answer, AnswerOf, Block, ContentIssue, Exercise } from '@shared/schema'

/** Marcas de dato aproximado: ≈, «about 3», «unos 50 m», «aproximadamente»… (en es, en, fr, pt, it). */
const APPROX = /(?:≈|≃|∼|\\approx|~)\s*\$?\s*\d|\b(?:aprox(?:imadamente|\.)?|approx(?:imately|\.)?|about|around|roughly|nearly|almost|some|unos|unas|casi|cerca de|alrededor de|circa|ca\.|environ)\s+\$?\s*\d/iu

/** Texto de los bloques de texto (y de las llamadas y tablas) de un enunciado o una lección. */
export function blocksPlainText(blocks: readonly Block[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'text': out.push(b.md); break
      case 'callout': out.push(b.md); break
      case 'table': out.push(b.headers.join(' '), ...b.rows.map((r) => r.join(' '))); break
      default: break
    }
  }
  return out.join('\n')
}

/** El trozo de texto con la primera marca de aproximación («≈ 3.600 m»), si lo hay. */
export function approximationIn(text: string): string | undefined {
  const m = APPROX.exec(text)
  if (!m) return undefined
  const i = m.index
  return Array.from(text.slice(i, i + 24)).join('').split('\n')[0].trim()
}

const numericWithoutTolerance = (a: Answer): a is AnswerOf<'numeric'> => a.kind === 'numeric' && !(a.absTol > 0) && !(a.relTol > 0)

/**
 * Respuestas numéricas sin tolerancia con datos aproximados en el enunciado (o en la lección, si el enunciado remite a ella):
 * la clave exacta rechaza a quien redondea los datos de otra forma.
 */
export function approximateDataIssues(e: Exercise, path: string, lessonText = ''): ContentIssue[] {
  const out: ContentIssue[] = []
  const own = blocksPlainText(e.prompt)
  const fromLesson = /\b(?:la lecci[oó]n|the lesson|this lesson|esta lecci[oó]n)\b/iu.test(own) ? lessonText : ''
  const check = (a: Answer, text: string, p: string): void => {
    if (!numericWithoutTolerance(a)) return
    const hit = approximationIn(text) ?? approximationIn(fromLesson)
    if (!hit) return
    out.push({
      severity: 'warning', path: p,
      message: `Los datos son aproximados («${hit}») y la respuesta numérica no tiene tolerancia (absTol = relTol = 0): da una tolerancia que cubra esas aproximaciones (p. ej. relTol 0.05) o pon datos exactos en el enunciado.`
    })
  }
  if (e.answer.kind === 'multi') e.answer.parts.forEach((part, i) => check(part.answer, own + '\n' + blocksPlainText(part.prompt), `${path}.answer.parts[${i}].answer`))
  else check(e.answer, own, path + '.answer')
  return out
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** ¿Aparece `word` como palabra o frase entera en `text`? (sin distinguir mayúsculas; las tildes sí cuentan: «nombro» ≠ «nombró») */
export function containsWord(text: string, word: string): boolean {
  const w = word.trim()
  if (!w) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Pistas (del ejercicio, de la parte o el texto de ayuda del hueco) que contienen la respuesta aceptada de un hueco. */
export function hintRevealsBlankIssues(e: Exercise, path: string): ContentIssue[] {
  const out: ContentIssue[] = []
  const check = (c: AnswerOf<'cloze'>, hints: readonly string[], p: string): void => {
    c.blanks.forEach((b, i) => {
      if (b.numeric) return
      const answers = b.accepted.filter((a) => (a.match(/\p{L}/gu)?.length ?? 0) >= 2)
      const hit = (h: string): string | undefined => answers.find((a) => containsWord(h, a))
      for (const h of hints) {
        const a = hit(h)
        if (a !== undefined) {
          out.push({ severity: 'warning', path: p + '.hints', message: `La pista «${Array.from(h).slice(0, 60).join('')}» contiene la respuesta del hueco ${i + 1} («${a}»): una pista orienta (la regla, el paso que toca), no da la respuesta.` })
          break
        }
      }
      const a = b.hint !== undefined ? hit(b.hint) : undefined
      if (a !== undefined) out.push({ severity: 'warning', path: `${p}.answer.blanks[${i}].hint`, message: `El texto de ayuda del hueco ${i + 1} («${b.hint}») contiene su respuesta («${a}»); se ve dentro del hueco: pon el verbo en infinitivo, la categoría o nada.` })
    })
  }
  if (e.answer.kind === 'cloze') check(e.answer, e.hints, path)
  else if (e.answer.kind === 'multi') e.answer.parts.forEach((part, i) => { if (part.answer.kind === 'cloze') check(part.answer, [...e.hints, ...part.hints], `${path}.answer.parts[${i}]`) })
  return out
}
