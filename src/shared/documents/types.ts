// Documentos (port de StudyEngine/Documents): los materiales del estudiante (las fuentes de cada curso y los archivos que
// importa en «Documentos»), sus subrayados y notas, Aula en el lector y los documentos que Aula compone para estudiar en papel
// (guía, resumen, chuleta, tarjetas, examen de práctica y diapositivas) en PDF, Word o Markdown. Isomorfo: sin Node ni DOM.
import type { Block, CalloutKind } from '../schema/blocks'
import type { CardFigure, Deck, Slide } from '../schema/cards'
import type { Exercise } from '../schema/exercises'
import type { CommonMistake, FormulaGroup, GlossaryEntry } from '../schema/pack'
import type { ItemID } from '../schema/coding'

// MARK: - Qué documento

/**
 * Un documento del estudiante: un material de un curso (`Packs/<curso>/sources/<id>/`), un archivo importado en Documentos
 * (`<datos>/Documents/sources/<id>/`) o un documento que creó Aula y quedó guardado en el curso (`Packs/<curso>/documents/`).
 */
export type DocumentRef =
  | { kind: 'source'; packId: ItemID; sourceId: ItemID }
  | { kind: 'import'; docId: string }
  | { kind: 'saved'; packId: ItemID; savedId: string }

/** De dónde viene, para la biblioteca. */
export type DocumentOrigin = DocumentRef['kind']

/** Cómo se lee: páginas de PDF dibujadas, una foto, o el texto con la letra de lectura. */
export type DocumentMode = 'pdf' | 'image' | 'text'

/** Una entrada de la biblioteca de documentos. */
export interface DocumentEntry {
  ref: DocumentRef
  /** Clave estable (rutas de la interfaz y recientes): ver `docKey`. */
  key: string
  title: string
  /** pdf, docx, pptx, image, web, text, markdown… (el `kind` del material). */
  kind: string
  mode: DocumentMode
  origin: DocumentOrigin
  courseId?: ItemID
  courseTitle?: string
  courseHue?: number
  courseIcon?: string
  pages: number
  characters: number
  /** ISO-8601: cuándo se añadió. */
  added: string
  /** ISO-8601: la última vez que se abrió en el lector. */
  opened?: string
  /** Página donde se dejó. */
  lastPage?: number
  /** Subrayados y notas guardados. */
  marks: number
  /** URL servible del original (aula-asset://…), si el protocolo lo sirve. */
  fileUrl?: string
  /** Hay un archivo original en disco (aunque no tenga URL: los PDF creados se leen por IPC). */
  hasFile: boolean
  /** official, book, notes, web, canvas, other (materiales de un curso). */
  trust?: string
  status: 'processing' | 'ready' | 'failed'
}

export interface DocumentCourse {
  id: ItemID
  title: string
  hue: number
  icon: string
}

export interface DocumentLibrary {
  items: DocumentEntry[]
  courses: DocumentCourse[]
}

/** Una entrada del índice (marcadores del PDF o títulos de las páginas). */
export interface DocumentOutlineEntry {
  title: string
  page: number
  /** Última página del capítulo (antes del siguiente del mismo nivel o superior). */
  endPage: number
  level: number
}

export interface DocumentPageText {
  number: number
  text: string
  heading?: string
  /** El texto salió del OCR (página escaneada). */
  ocr?: boolean
}

/** Lo que el lector necesita para abrir un documento. */
export interface DocumentView {
  entry: DocumentEntry
  /** El texto de cada página (1…n): lectura, búsqueda y las acciones de Aula. */
  pages: DocumentPageText[]
  outline: DocumentOutlineEntry[]
  language?: string
  warnings: string[]
}

/** Una coincidencia de una búsqueda, con su página. */
export interface DocumentHit {
  page: number
  snippet: string
}

/** Un resultado de buscar en todos los documentos. */
export interface DocumentSearchHit {
  key: string
  ref: DocumentRef
  title: string
  courseTitle?: string
  page?: number
  /** Con las coincidencias en `**negrita**`. */
  snippet: string
  score: number
}

// MARK: - Subrayados y notas

export const MARK_KINDS = ['highlight', 'underline', 'strike', 'note'] as const
export type DocumentMarkKind = (typeof MARK_KINDS)[number]
export const MARK_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type DocumentMarkColor = (typeof MARK_COLORS)[number]

/** Una marca en una página (formato de `annotations/<material>.json`, igual que la app Swift). */
export interface DocumentAnnotation {
  id: string
  /** Página (1…n). */
  page: number
  kind: DocumentMarkKind
  color: DocumentMarkColor
  /** Rectángulos en coordenadas de la página del PDF (origen abajo a la izquierda): [x, y, ancho, alto]. Vacío en texto. */
  rects: number[][]
  /** Texto marcado. */
  text: string
  note?: string
  author: 'student' | 'aula'
  created: string
  updated: string
}

export interface DocumentAnnotationFile {
  version: number
  title: string
  key: string
  items: DocumentAnnotation[]
}

// MARK: - Aula en el lector

/** Acciones de un clic sobre lo que se está leyendo (DocumentAIAction de Swift). */
export type DocumentAIAction =
  | { type: 'summarizePage'; page: number }
  /** El capítulo de la página; `from`/`to`/`title` si la interfaz lo sabe por los marcadores del PDF. */
  | { type: 'summarizeChapter'; page: number; from?: number; to?: number; title?: string }
  | { type: 'summarizeDocument' }
  | { type: 'explain'; selection: string; page: number }
  | { type: 'ask'; question: string }
  | { type: 'cards'; selection: string; page: number }
  | { type: 'practice'; selection: string; page: number }
  | { type: 'examFocus' }

export interface DocumentAIRequest {
  ref: DocumentRef
  action: DocumentAIAction
  /** Idioma de la respuesta («es», «en»…). */
  language: string
  /** La página como JPEG (base64, sin prefijo), para los modelos que ven (resumir la página, explicar). */
  pageImage?: string
}

/** Una tarjeta propuesta. */
export interface DocumentCardDraft {
  front: string
  back: string
}

/** Lo que llega mientras Aula responde (evento `documents.ai`). */
export interface DocumentAIUpdate {
  jobId: string
  /** Texto acumulado. */
  text: string
  done: boolean
  error?: { message: string; code: string }
  /** Tarjetas leídas de la respuesta (acción «tarjetas»). */
  cards?: DocumentCardDraft[]
  /** Páginas citadas («(p. 12)»), ya dentro del documento. */
  cited?: number[]
}

export interface DocumentCardTarget {
  courseId: ItemID
  courseTitle: string
  hue: number
  skills: { id: ItemID; title: string }[]
}

// MARK: - Documentos que crea Aula

export const DOCUMENT_KINDS = ['guide', 'summary', 'cheatsheet', 'flashcards', 'exam', 'slides'] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]
export const DOCUMENT_FORMATS = ['pdf', 'docx', 'markdown'] as const
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]
export type DocumentPaper = 'a4' | 'letter'

/** Cómo se ve y qué incluye. */
export interface DocumentStyle {
  paper: DocumentPaper
  /** Cuerpo de texto en puntos (9–13). */
  fontSize: number
  /** false = escala de grises. */
  color: boolean
  serif: boolean
  includeNotes: boolean
  includeFormulas: boolean
  includeGlossary: boolean
  includeMistakes: boolean
  includeAnswers: boolean
  includeSolutions: boolean
  /** Examen: número de preguntas (undefined = el plano del examen del curso). */
  questionCount?: number
  minutes?: number
  /** Tarjetas por página (6, 8 o 10). */
  cardsPerPage: number
  /** Reversos en la página siguiente, en espejo (doble cara). */
  duplex: boolean
  /** Diapositivas: folleto (3 por página con líneas). */
  handout: boolean
  /** Semilla del examen (mismo número = mismas preguntas). */
  seed?: number
}

export interface DocumentScope {
  /** Lecciones (vacío = todas). */
  skillIDs: ItemID[]
  unitIDs: ItemID[]
  onlyDone: boolean
}

export interface DocumentRequest {
  kind: DocumentKind
  courseID?: ItemID
  scope: DocumentScope
  style: DocumentStyle
  format: DocumentFormat
  title?: string
  subtitle?: string
  /** Contenido propio en Markdown con `$LaTeX$` (p. ej. el resumen de una clase que escribió Aula). */
  content?: string
  /** Idioma de los textos del documento («es» o «en»). */
  lang?: string
}

/** Nota o subrayado del estudiante en una lección (para la guía). */
export interface DocumentNote {
  excerpt: string
  note?: string
  color?: string
}

export interface DocumentQuestion {
  number: number
  exercise: Exercise
  points: number
  /** Orden en que se imprimen las opciones (índices de las opciones). */
  optionOrder: number[]
  skillTitle: string
}

export interface DocumentAnswer {
  number: number
  /** Markdown con `$LaTeX$`. */
  answer: string
  solution: Block[]
  points: number
}

export interface DocumentCard {
  number: number
  front: string
  back: string
  hint?: string
  topic: string
  figure?: CardFigure
}

export interface DocumentSlide {
  slide: Slide
  deckTitle: string
  index: number
  total: number
  deck?: Deck
}

/** Un elemento del documento. */
export type DocumentItem =
  | { type: 'heading'; text: string; level: number }
  | { type: 'markdown'; md: string }
  | { type: 'block'; block: Block }
  /** Bloque de una lección (la guía lo dibuja con los subrayados del estudiante). */
  | { type: 'lessonBlock'; block: Block; skillID: ItemID; step: number }
  | { type: 'bullets'; items: string[] }
  | { type: 'formulas'; group: FormulaGroup }
  | { type: 'term'; entry: GlossaryEntry }
  | { type: 'mistake'; mistake: CommonMistake; skill: string }
  | { type: 'note'; note: DocumentNote }
  | { type: 'question'; question: DocumentQuestion }
  | { type: 'answer'; answer: DocumentAnswer }
  | { type: 'card'; card: DocumentCard }
  | { type: 'slide'; slide: DocumentSlide }

export type DocumentSectionRole = 'content' | 'lesson' | 'formulas' | 'glossary' | 'mistakes' | 'notes' | 'keyIdeas' | 'questions' | 'answers' | 'cards' | 'slides'

export interface DocumentSection {
  id: string
  role: DocumentSectionRole
  title: string
  /** Encima del título («Lección 3 · Funciones»). */
  eyebrow?: string
  summary?: string
  /** Entra en el índice. */
  toc: boolean
  /** Empieza en página nueva. */
  newPage: boolean
  /** Chuleta: lo menos importante se quita primero si no cabe (0 = imprescindible). */
  priority: number
  items: DocumentItem[]
}

/** Todo lo que va en el documento, ya decidido. Lo dibujan el PDF (vista de impresión), Word y Markdown. */
export interface DocumentPlan {
  request: DocumentRequest
  title: string
  subtitle?: string
  courseTitle?: string
  subject?: string
  hue: number
  icon?: string
  examDate?: string
  examTitle?: string
  minutes?: number
  totalPoints?: number
  instructions?: string
  sections: DocumentSection[]
  /** Curso del que salen las imágenes (`aula-asset://pack/<id>/assets/…`). */
  packId?: ItemID
  /** Idioma del contenido del curso (decimales, etc.). */
  contentLanguage: string
  /** Idioma de los textos del documento. */
  lang: 'es' | 'en'
  created: string
  /** Aviso de integridad académica y procedencia (portada y pie). */
  notice: string
  /** Textos de la vista de impresión, ya en el idioma del documento. */
  words: PrintWords
}

/** Textos fijos de la vista de impresión (los decide el proceso principal en el idioma del documento). */
export interface PrintWords {
  contents: string
  page: string
  name: string
  date: string
  minutes: string
  points: string
  point: string
  exam: string
  answer: string
  question: string
  true: string
  false: string
  order: string
  notes: string
  figure: string
  example: string
  cut: string
  callouts: Record<CalloutKind, string>
}

/** Un documento ya dibujado (para guardar). */
export interface RenderedDocumentInfo {
  format: DocumentFormat
  pages: number
  title: string
  baseName: string
}

/** Documento creado por Aula guardado en el curso (`<curso>/documents/index.json`). */
export interface SavedDocument {
  id: string
  kind: DocumentKind
  format: DocumentFormat
  title: string
  fileName: string
  pages: number
  created: string
  byAssistant: boolean
}
