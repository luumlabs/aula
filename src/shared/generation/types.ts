// Crear un curso con Aula: la petición que hace la interfaz y el estado vivo de una creación (lo que ve el monitor).
// Formato de las ejecuciones guardadas: el de la app Swift (StudyEngine/Pipeline/GenerationTypes.swift) en Packs/<id>/runs/.

export type GenerationDepth = 'quick' | 'standard' | 'deep'
export type GenerationStage = 'prepare' | 'gather' | 'plan' | 'author' | 'crossCutting' | 'verify' | 'polish'
export const GENERATION_STAGES: GenerationStage[] = ['prepare', 'gather', 'plan', 'author', 'crossCutting', 'verify', 'polish']
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
export type SkillRunStatus = 'pending' | 'running' | 'repairing' | 'verifying' | 'done' | 'needsReview' | 'failed'
export type RunState = 'running' | 'waiting' | 'paused' | 'limit' | 'done' | 'failed' | 'cancelled'
/** Papel de un agente del equipo (cada uno tiene su compañero pixel-art). */
export type AgentRole = 'gatherer' | 'reader' | 'planner' | 'lesson' | 'exercises' | 'cards' | 'verifier' | 'arbiter' | 'glossary' | 'formulas' | 'polish'

/** Un material añadido al crear el curso (ya leído y troceado en el área de preparación). */
export interface MaterialView {
  id: string
  title: string
  kind: string
  pages: number
  characters: number
  status: 'processing' | 'ready' | 'failed'
  official: boolean
  warnings: string[]
  error?: string
  /** Mientras se lee: avance 0…1 y lo que está haciendo («Reconociendo texto (OCR)… página 3 de 12»). */
  progress?: number
  detail?: string
}

export interface CreateRequest {
  title: string
  subject?: string
  level?: string
  /** Idioma del curso ('es', 'en'…); por defecto el de la interfaz. */
  language?: string
  examDate?: string
  goal?: string
  /** Lo que entra en el examen. */
  topics?: string
  /** Formato del examen, puntos, calculadora, cómo quiere las respuestas el profesor. */
  examNotes?: string
  userNotes?: string
  /** Materiales del área de preparación (ids de MaterialView). */
  materialIds: string[]
  /** Los que son «oficiales del profesor» (pesan más). */
  officialIds: string[]
  depth: GenerationDepth
  lessonMode: 'stepByStep' | 'explore' | 'read'
  allowWeb: boolean
  verify: boolean
  /** Buscar los materiales en la plataforma de estudio. */
  gather?: { accountId: string; courseId?: string; focus?: string }
  /** Evento del calendario del que sale este curso («Preparar este examen»). */
  eventId?: string
}

export interface AgentLaneView {
  id: string
  role: AgentRole
  stage: GenerationStage
  skillId?: string
  title: string
  /** Lo que está haciendo ahora («Escribiendo la lección: La parábola»). */
  current: string
  status: 'working' | 'done' | 'failed'
  steps: number
  provider: string
  startedAt: string
  finishedAt?: string
}

export interface SkillRunView {
  id: string
  title: string
  status: SkillRunStatus
  attempts: number
  note: string
  openIssues: number
}

export interface RunQuestion {
  id: string
  text: string
  options: string[]
  allowsOther: boolean
}

export interface RunReport {
  skillsReady: number
  skillsNeedingReview: number
  skillsFailed: number
  lessonBlocks: number
  exercises: number
  cards: number
  decks: number
  verified: number
  fixed: number
  flagged: number
  minutes: number
  notes: string[]
  /** El aviso sobre la investigación en internet (también está en `notes`): lo enseña Materiales cuando no hay fuentes. */
  researchNote?: string
  /** «Pedir cambios»: lo que añadió la ejecución (temas, ejercicios, tarjetas nuevos) y los temas que tocó. */
  added?: { skills: number; exercises: number; cards: number; lessonBlocks: number }
  changedSkills?: number
}

export interface RunView {
  id: string
  packId: string
  title: string
  icon: string
  hue: number
  mode: 'create' | 'extend'
  state: RunState
  stage: GenerationStage
  stages: Record<GenerationStage, StageStatus>
  /** 0…1 */
  progress: number
  lanes: AgentLaneView[]
  skills: SkillRunView[]
  /** Lo que el equipo averiguó del examen y de la plataforma (Markdown). */
  findings?: string
  question?: RunQuestion
  startedAt: string
  finishedAt?: string
  /** Si se paró por un límite de uso: cuándo se puede reanudar. */
  resumeAt?: string
  report?: RunReport
  error?: string
  /** Código estable del error (ai_auth, ai_network…): la interfaz lo explica con sus palabras. */
  errorCode?: string
  provider: string
}

export interface RunSummary {
  id: string
  packId: string
  title: string
  icon: string
  hue: number
  state: RunState
  progress: number
  stageLabel: string
  updated: string
}
