// Estadísticas de estudio: se calculan con el progreso guardado de cada curso (nada se inventa).
// La evolución del dominio y de la nota estimada se reconstruye repasando los intentos guardados; el último punto es hoy.
import type { ReadinessLabel } from './course-view'

declare module './contract' {
  interface RpcMethods {
    'stats.get': { args: void; result: StatsData }
  }
}

/** 12 semanas. */
export const STATS_WINDOW_DAYS = 84

export type MasteryLevelName = 'unseen' | 'learning' | 'practicing' | 'solid' | 'mastered'
export const MASTERY_LEVELS: MasteryLevelName[] = ['unseen', 'learning', 'practicing', 'solid', 'mastered']

/** Un día de la ventana (fecha local «AAAA-MM-DD»). */
export interface StatsDay {
  date: string
  minutes: number
  attempts: number
  /** Crédito sumado (0…attempts). */
  correct: number
}

/** Precisión de un tema en la ventana. */
export interface StatsTopic {
  /** «<curso>/<tema>». */
  id: string
  courseId: string
  skillId: string
  title: string
  courseTitle: string
  hue: number
  attempts: number
  /** 0…1. */
  accuracy: number
}

/** Cuántos temas hay en cada nivel al final de una semana (y hoy). */
export interface StatsLevelPoint {
  date: string
  counts: Record<MasteryLevelName, number>
}

/** Nota estimada de un día con su intervalo creíble (0…1). */
export interface StatsScorePoint {
  date: string
  expected: number
  low: number
  high: number
}

export interface StatsCourse {
  id: string
  title: string
  icon: string
  hue: number
  examDate?: string
  /** null si aún no hay ningún tema practicado. */
  expected: number | null
  low: number
  high: number
  coverage: number
  label: ReadinessLabel
  /** Siempre `STATS_WINDOW_DAYS` días, del más antiguo a hoy. */
  days: StatsDay[]
  topics: StatsTopic[]
  levels: StatsLevelPoint[]
  history: StatsScorePoint[]
  skillCount: number
}

export interface StatsData {
  /** Primer día de la ventana y hoy («AAAA-MM-DD», hora local). */
  start: string
  today: string
  courses: StatsCourse[]
}
