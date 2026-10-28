// Vista de un curso para la interfaz: nota estimada, plan, dominio por habilidad y pendientes (lo calcula el motor de estudio).
import type { HomePlanItem } from './home'

declare module './contract' {
  interface RpcMethods {
    'course.overview': { args: { id: string }; result: CourseOverview }
  }
}

export type ReadinessLabel = 'notStarted' | 'early' | 'gettingThere' | 'almostReady' | 'ready'

export interface SkillProgressView {
  id: string
  /** Dominio 0…1. */
  mastery: number
  seen: boolean
  dueCards: number
  mistakes: number
}

export interface CourseOverview {
  id: string
  readiness: number
  readinessLow: number
  readinessHigh: number
  /** Parte del temario vista (0…1). */
  coverage: number
  label: ReadinessLabel
  plan: HomePlanItem[]
  minutesToday: number
  minutesGoal: number
  dueCards: number
  mistakes: number
  skills: SkillProgressView[]
  attempts: number
  accuracy: number
}
export {}
