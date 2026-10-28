// Cuestionarios y tarjetas del chat, lo que no es interfaz (puro, con pruebas): por dónde va un cuestionario guardado en la
// conversación (así al volver a abrirla sigue donde se quedó o enseña la nota), la nota, y las caras de cada tarjeta.
import type { AssistantStudySet } from '@shared/assistant/types'
import type { Flashcard } from '@shared/schema/cards'
import { clozeText } from '@engine/study'
import { foldDiacritics } from '@engine/base/ids'

export interface QuizProgress {
  total: number
  /** Preguntas con resultado (el primer intento cuenta). */
  answered: number
  /** Bien a la primera. */
  right: number
  /** La primera sin responder (−1 si están todas). */
  next: number
  done: boolean
}

/** Los resultados guardados en la tarjeta, con lo que se acaba de responder encima (aún sin confirmar). */
export function quizResults(set: AssistantStudySet, local: Readonly<Record<string, boolean>> = {}): Record<string, boolean> {
  const ids = new Set(set.exercises.map((e) => e.id))
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries({ ...set.results, ...local })) if (ids.has(k)) out[k] = v
  return out
}

export function quizProgress(set: AssistantStudySet, local: Readonly<Record<string, boolean>> = {}): QuizProgress {
  const results = quizResults(set, local)
  const total = set.exercises.length
  const answered = set.exercises.filter((e) => results[e.id] !== undefined).length
  const right = set.exercises.filter((e) => results[e.id] === true).length
  const next = set.exercises.findIndex((e) => results[e.id] === undefined)
  return { total, answered, right, next, done: total > 0 && next < 0 }
}

/** Las preguntas falladas (número desde 1 y lo que respondió), para preguntarle a Aula por ellas. */
export function quizMistakes(set: AssistantStudySet, local: Readonly<Record<string, boolean>> = {}): Array<{ n: number; input?: string }> {
  const results = quizResults(set, local)
  return set.exercises.flatMap((e, i) => (results[e.id] === false ? [{ n: i + 1, ...(set.inputs[e.id] ? { input: set.inputs[e.id] } : {}) }] : []))
}

/** Lo que va en `inputs` (lo lee Aula en los turnos siguientes): corto y en una línea. */
export function inputForAula(summary: string | undefined): string | undefined {
  if (!summary) return undefined
  const one = summary.replace(/\s+/g, ' ').trim()
  return one ? Array.from(one).slice(0, 200).join('') : undefined
}

/** Las caras de una tarjeta: en las de huecos, el frente con «[…]» y la respuesta con el hueco relleno. */
export function flashcardFaces(card: Pick<Flashcard, 'kind' | 'front' | 'back'>): { front: string; back: string; note?: string } {
  if (card.kind === 'cloze') return { front: clozeText(card.front, false), back: clozeText(card.front, true), ...(card.back.trim() ? { note: card.back } : {}) }
  return { front: card.front, back: card.back }
}

// MARK: Dónde guardarlo (J2-22 / A3-P2-16)

const STOP = new Set([
  'the', 'and', 'for', 'with', 'your', 'about', 'cards', 'card', 'flashcards', 'quiz', 'questions', 'practice', 'review', 'exam', 'test',
  'los', 'las', 'del', 'con', 'para', 'por', 'una', 'unos', 'unas', 'sobre', 'tarjetas', 'tarjeta', 'cuestionario', 'preguntas', 'repaso', 'examen', 'prueba'
])

/** Palabras con significado de un texto (sin tildes, mayúsculas ni plurales sencillos). */
export function topicWords(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of foldDiacritics(text.toLowerCase()).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue
    out.add(raw.length > 4 ? raw.replace(/(es|s)$/, '') : raw)
  }
  return out
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0
  for (const w of a) if (b.has(w) || [...b].some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x)))) n++
  return n
}

/** El texto con el que se reconoce de qué va un cuestionario o unas tarjetas. */
function setText(set: Pick<AssistantStudySet, 'title' | 'cards' | 'exercises'>): string {
  return [set.title, ...set.cards.slice(0, 8).map((c) => c.front), ...set.exercises.slice(0, 4).map((e) => e.skill)].join(' ')
}

/** El curso que se propone: el que dijo Aula, el de la conversación, o el que encaja con el tema; si nada encaja, ninguno
 * (antes se proponía el más reciente: unas tarjetas de trigonometría iban a «Fotosíntesis»). */
export function suggestSaveCourse(
  set: Pick<AssistantStudySet, 'title' | 'cards' | 'exercises' | 'courseID'>,
  courses: ReadonlyArray<{ id: string; title: string; subject?: string }>,
  conversationCourse?: string | null
): string | null {
  if (set.courseID && courses.some((c) => c.id === set.courseID)) return set.courseID
  if (conversationCourse && courses.some((c) => c.id === conversationCourse)) return conversationCourse
  const words = topicWords(setText(set))
  let best: { id: string; score: number } | null = null
  for (const c of courses) {
    const score = overlap(words, topicWords(`${c.title} ${c.subject ?? ''}`))
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score }
  }
  return best?.id ?? null
}

/** La lección que se propone dentro del curso: la que dijo Aula, la que encaja con el tema, o la única que hay. */
export function suggestSaveLesson(
  set: Pick<AssistantStudySet, 'title' | 'cards' | 'exercises' | 'skillID'>,
  lessons: ReadonlyArray<{ id: string; title: string }>,
  preferred?: string
): string | null {
  const wanted = preferred ?? set.skillID
  if (wanted && lessons.some((s) => s.id === wanted)) return wanted
  const words = topicWords(setText(set))
  let best: { id: string; score: number } | null = null
  for (const s of lessons) {
    const score = overlap(words, topicWords(s.title))
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score }
  }
  return best?.id ?? (lessons.length === 1 ? lessons[0].id : null)
}
