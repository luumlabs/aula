// Lo que el chat necesita de la app (port de AssistantHost.swift). El proceso principal lo implementa (src/main/electron/handlers/
// assistant.ts) y las pruebas usan versiones falsas. Este servicio no importa `electron`: la plataforma, la navegación y el equipo
// que crea cursos llegan por estas interfaces.
import type { AssistantCard, AssistantNavigateTarget, AssistantRef } from '@shared/assistant/types'
import type { AssistantCalendar } from '@engine/calendar'
import type { AssistantTurnTrust } from '@engine/assistant'
import type { ContentValidator } from '@engine/content/validator'
import type { AssistantStudySet } from '@shared/assistant/types'
import type { Library } from '../store/library'
import type { PackStore } from '../store/packStore'
import type { VectorSearcher } from '../search/hybrid'
import type { AssistantAnswer } from './broker'
import type { AssistantAppInfo, AssistantRunInfo } from './prompts'
import type { GoalStore } from './goals'
import type { WebAccess } from '../tools/context'

/** Pantallas de la app que la IA puede abrir. */
export { ASSISTANT_SCREENS } from '@shared/assistant/types'
export type { AssistantScreen } from '@shared/assistant/types'
/** Una pantalla de Aula con lo que haya que abrir en ella. */
export type AssistantTarget = AssistantNavigateTarget

/** Profundidad de un curso nuevo (la de la tubería). */
export type GenerationDepth = 'quick' | 'standard' | 'deep'

/** Un curso nuevo pedido desde el chat. */
export interface AssistantCourseSpec {
  title: string
  subject: string
  depth: GenerationDepth
  examTitle?: string
  /** ISO 8601. */
  examDate?: string
  goal: string
  topics: string
  notes: string
  language?: string
  /** Buscar los materiales en la plataforma de estudio (navegador de Aula) antes de planificar. */
  searchPlatform: boolean
  platformCourse?: string
  focus?: string
  /** Materiales del chat que pasan al curso (ids del almacén de la conversación). */
  attachmentSourceIDs: string[]
}

/** Control de la app desde el chat. Todo lo que cambia algo ya llega aprobado por el estudiante (las herramientas piden permiso). */
export interface AssistantAppControl {
  /** Abre una pantalla (la interfaz navega). Devuelve una frase para la IA si no se pudo. */
  open?(target: AssistantTarget): Promise<string | undefined>
  /** Creaciones y cambios de cursos en marcha o recientes. */
  runs?(): Promise<AssistantRunInfo[]>
  appInfo(): Promise<AssistantAppInfo>
}

/** El equipo que crea y cambia cursos (la tubería). Si no está, el chat ofrece abrir la pantalla de crear curso. */
export interface CourseTeam {
  create(spec: AssistantCourseSpec, attachments?: PackStore): Promise<AssistantRunInfo>
  extend(courseID: string, instruction: string, opts: { skillID?: string; attachmentSourceIDs: string[]; attachments?: PackStore }): Promise<AssistantRunInfo>
}

/** Una página de la plataforma leída en el navegador de Aula (solo lectura). */
export interface PlatformPage {
  url: string
  title: string
  /** Resumen para la IA (con valla para lo que escribe la página). */
  summary: string
  needsLogin?: boolean
}

/** La plataforma del estudiante en el navegador de Aula, en SOLO LECTURA. Lo implementa la capa de Electron. */
export interface PlatformReader {
  /** ¿Hay alguna cuenta configurada y el navegador está listo? */
  ready(): boolean
  /** Nombre del sitio («Canvas · Universidad X») de una dirección. */
  siteName(url: string): string
  /** Id de la cuenta de la plataforma de una dirección (para «Iniciar sesión»). */
  accountFor(url: string): string | undefined
  open(url: string, signal?: AbortSignal): Promise<PlatformPage>
  /** Lee la página abierta (Markdown con valla) por trozos. */
  read(offset: number, signal?: AbortSignal): Promise<{ page: PlatformPage; text: string; nextOffset?: number; elements?: string }>
  links(filter: string | undefined, signal?: AbortSignal): Promise<{ page: PlatformPage; links: Array<{ text: string; url: string }> }>
  /** Pulsa un control por su referencia («e12») de la última lectura (lo que no es de lectura lo bloquea o pide permiso el navegador). */
  click(ref: string, signal?: AbortSignal): Promise<PlatformPage>
  /** Cierra la pestaña de este turno. */
  finish?(): void
}

/** Puente de un turno entre las herramientas y la interfaz: enseñar tarjetas y esperar respuestas. */
export interface TurnIO {
  /** Enseña una tarjeta que espera respuesta (pregunta o permiso) y devuelve lo que contestó el estudiante. */
  ask(card: AssistantCard): Promise<AssistantAnswer>
  /** Enseña una tarjeta sin esperar (selección de elementos, curso en marcha, cuestionario…). */
  show(card: AssistantCard): void
}

/** Sin nadie al otro lado (pruebas): aprueba todo y elige la primera opción. */
export const autoApproveIO: TurnIO = {
  ask: async (card) => (card.kind === 'approval' ? { kind: 'approved' } : { kind: 'option', index: 0 }),
  show: () => undefined
}

/** Todo lo que tocan las herramientas del chat en un turno. */
export interface ToolEnv {
  library: Library
  /** Adjuntos de esta conversación (lo crea al pedirlo). */
  files: () => PackStore
  /** Adjuntos SIN crearlos. */
  filesHandle: () => PackStore
  io: TurnIO
  control?: AssistantAppControl
  team?: CourseTeam
  calendar?: AssistantCalendar
  validator: ContentValidator
  dailyMinutes: number
  allowWeb: boolean
  /** Buscar y leer en internet (`web_search`, `fetch_url`); solo con `allowWeb`. */
  web?: WebAccess
  threadID: string
  goals?: GoalStore
  /** Tutor de un curso: las herramientas usan este curso cuando no se dice otro. */
  defaultCourseID?: string
  /** Un cuestionario o unas tarjetas que Aula enseñó en esta conversación (para `save_study_set`). */
  studySets: (id: string) => AssistantStudySet | undefined
  platform?: PlatformReader
  trust: AssistantTurnTrust
  /** Búsqueda por significado en los materiales de un curso (si hay modelo de vectores). */
  vectors?: (packDir: string) => VectorSearcher | undefined
  /** Para la navegación cuando no hay `control.open`: la interfaz recibe la orden por un evento. */
  navigate?: (target: AssistantTarget) => void
  /** Un curso se creó o cambió (para refrescar menciones). */
  courseChanged?: (courseID: string) => void
  /** Señal del turno (las esperas largas la miran). */
  signal?: AbortSignal
}

/** Lo que muestra una tarjeta de «Abrir» para una referencia. */
export type RefLike = AssistantRef
