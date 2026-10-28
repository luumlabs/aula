// Resumen de la pantalla de Inicio (lo calcula el proceso principal juntando cursos, progreso, plan y calendario).
declare module './contract' {
  interface RpcMethods {
    'home.summary': { args: void; result: HomeSummary }
  }
}

export type PlanKind = 'cards' | 'mistakes' | 'learn' | 'practice' | 'exam' | 'review'

export interface HomePlanItem {
  id: string
  courseId: string
  courseTitle: string
  icon: string
  hue: number
  kind: PlanKind
  title: string
  detail: string
  minutes: number
  skillId?: string
  done?: boolean
}

export interface HomeExam {
  courseId: string
  title: string
  courseTitle: string
  icon: string
  hue: number
  date: string
  /** Nota estimada 0…1 e intervalo de credibilidad. */
  readiness: number
  readinessLow: number
  readinessHigh: number
  coverage: number
  /** ¿Ya practicó algo en este curso? Si no, la nota estimada no se muestra. */
  started: boolean
}

export interface HomeCourse {
  id: string
  title: string
  subject: string
  icon: string
  hue: number
  readiness: number
  coverage: number
  /** ¿Ya practicó algo en este curso? Si no, la nota estimada no se muestra. */
  started: boolean
  examDate?: string | null
  dueCards: number
  mistakes: number
  skillCount: number
  generating?: boolean
}

export interface HomeEvent {
  id: string
  title: string
  start: string
  end?: string | null
  allDay?: boolean
  kind: 'exam' | 'assignment' | 'class' | 'event' | 'task' | 'study'
  courseId?: string | null
  done?: boolean
}

export interface HomeSummary {
  name: string
  today: { minutesDone: number; minutesGoal: number; itemsDone: number; itemsTotal: number }
  streak: { days: number; best: number; week: boolean[] }
  plan: HomePlanItem[]
  exams: HomeExam[]
  courses: HomeCourse[]
  upcoming: HomeEvent[]
  dueCards: number
  mistakes: number
  aiReady: boolean
}
export {}
