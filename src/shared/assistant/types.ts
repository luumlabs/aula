// Conversaciones con Aula (chat y tutor): mismo formato que la app Swift (StudyEngine/Assistant/AssistantModels.swift),
// para abrir las conversaciones que ya existen en <datos>/Assistant/. Los visuales van dentro del texto como bloques
// ```aula-block {…json de un Block…}``` (y ```aula-slides``` para diapositivas), que la interfaz dibuja con BlockView.
import type { Exercise } from '../schema/exercises'
import type { Flashcard } from '../schema/cards'

export type AssistantRefKind = 'course' | 'lesson' | 'exercise' | 'material' | 'event'

export interface AssistantRef {
  kind: AssistantRefKind
  courseID?: string
  itemID?: string
  skillID?: string
  title: string
  subtitle?: string
  icon?: string
  hue?: number
  date?: string
}

export interface AssistantAttachment {
  id: string
  kind: 'document' | 'image' | 'video' | 'audio' | 'other'
  name: string
  bytes: number
  status: 'processing' | 'ready' | 'failed'
  sourceID?: string
  pages: number
  characters: number
  imageAssets: string[]
  thumbnail?: string
  transcript?: string
  duration?: number
  visionNote?: string
  note?: string
}

export interface AssistantOption {
  id: string
  label: string
  detail?: string
  ref?: AssistantRef
}

export interface AssistantFact {
  label: string
  value: string
}

export type AssistantCardActionKind =
  | 'ask' | 'open' | 'openURL' | 'prepareCourse' | 'adjustCourse' | 'extendCourse' | 'signIn' | 'runAutomation' | 'openAutomation'
  | 'pauseAutomation' | 'cancelAutomation' | 'openToday' | 'openCalendar' | 'openSettings' | 'dismiss' | 'neverForEvent'

export interface AssistantCardAction {
  id: string
  kind: AssistantCardActionKind
  label: string
  symbol?: string
  prominent: boolean
  value?: string
  courseID?: string
  ref?: AssistantRef
}

export interface AssistantStudySet {
  id: string
  title: string
  exercises: Exercise[]
  cards: Flashcard[]
  courseID?: string
  skillID?: string
  results: Record<string, boolean>
  inputs: Record<string, string>
  savedTo?: string
}

export type AssistantCardKind = 'question' | 'approval' | 'items' | 'course' | 'actions' | 'automation' | 'quiz' | 'flashcards'
export type AssistantCardState = 'pending' | 'answered' | 'approved' | 'denied' | 'expired' | 'done'

export interface AssistantCard {
  id: string
  kind: AssistantCardKind
  title: string
  detail?: string
  options: AssistantOption[]
  allowsOther: boolean
  items: AssistantRef[]
  facts: AssistantFact[]
  actionLabel?: string
  icon?: string
  state: AssistantCardState
  answer?: string
  packID?: string
  actions: AssistantCardAction[]
  automationID?: string
  studySet?: AssistantStudySet
}

export interface AssistantStep {
  id: string
  tool: string
  label: string
  ok?: boolean
  /** Lo legible de la llamada (lo que buscó, el título de lo que crea, la web que lee); nunca ids. */
  detail?: string
  /** Cuántas cosas crea (tarjetas, preguntas…), si la herramienta recibe una lista. */
  count?: number
  /** No se hizo: el estudiante dijo que no a su permiso (o el permiso caducó). No cuenta como hecho en el resumen. */
  declined?: boolean
}

export interface TutorContext {
  courseID?: string
  skillID?: string
  exerciseID?: string
  blockID?: string
  /** Pantalla desde la que se pregunta (para dar contexto: 'lesson', 'practice', 'calendar'…). */
  screen?: string
  /** Texto que el estudiante tenía seleccionado. */
  selection?: string
  /** Lo que escribió el estudiante en el ejercicio (si ya respondió). Mismo campo que la app Swift. */
  lastInput?: string
  /** Resumen del resultado: «incorrecto: olvidó el signo». */
  lastResult?: string
  /** Paso de la lección que está leyendo (índice, 0 = el primero). */
  lessonBlock?: number
}

/** Una cita de un material en una respuesta («(Fuente: Apuntes del tema 3, p. 12)»), ya buscada en los cursos. */
export interface AssistantCitation {
  /** Lo que escribió la IA («Apuntes del tema 3»). */
  title: string
  page?: number
  /** El material encontrado (si se encontró). */
  courseID?: string
  sourceID?: string
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  date: string
  mentions: AssistantRef[]
  attachments: AssistantAttachment[]
  cards: AssistantCard[]
  steps: AssistantStep[]
  notices: string[]
  failed: boolean
  provider?: string
  origin?: { kind: 'routine' | 'automation' | 'followup' | 'reminder' | 'system'; title: string; automationID?: string; runID?: string; symbol?: string }
  context?: TutorContext
  interrupted: boolean
  /** Citas de materiales que hay en el texto (solo en respuestas de Aula ya terminadas). */
  citations?: AssistantCitation[]
}

export interface AssistantThread {
  id: string
  title: string
  created: string
  updated: string
  messages: AssistantMessage[]
  pinned: boolean
  /** Tutor de un curso: la conversación tiene ese curso como contexto (y se guarda en `Packs/<curso>/chats/`). */
  courseID?: string
}

/** Lo que solo vive en memoria mientras una conversación responde (nunca se guarda): si está respondiendo, qué hace y lo que
 * el estudiante escribió mientras tanto (se envía junto cuando termina la respuesta). */
export interface AssistantRunState {
  busy: boolean
  label?: string
  queued: AssistantMessage[]
}

export interface AssistantThreadSummary {
  id: string
  title: string
  preview: string
  updated: string
  pinned: boolean
  busy: boolean
  /** Tutor de un curso (ver `AssistantThread.courseID`). */
  courseID?: string
  courseTitle?: string
}

/** Pantallas que Aula puede pedir abrir (herramienta `open_screen`). */
export const ASSISTANT_SCREENS = ['home', 'today', 'stats', 'calendar', 'settings', 'create_course', 'course', 'lesson', 'practice', 'cards', 'exam', 'mistakes', 'materials', 'reference',
  'exercise', 'tool', 'run'] as const
export type AssistantScreen = (typeof ASSISTANT_SCREENS)[number]

/** Lo que Aula pide abrir (evento 'chat.navigate'). */
export interface AssistantNavigateTarget {
  screen: AssistantScreen
  courseID?: string
  skillID?: string
  exerciseID?: string
  /** id de una herramienta de la app (tools/registry.ts): calculator · grapher · periodic · chemistry · units · timer…  */
  tool?: string
  settingsPane?: string
  /** Lección: paso en el que abrirla (0 = el primero). */
  step?: number
}

/** Lo más largo que se puede enviar en un mensaje del chat (lo comprueban la caja de escribir y el proceso principal). Para más,
 * se adjunta como archivo (A3-P2-7). */
export const MAX_MESSAGE_CHARS = 100_000
