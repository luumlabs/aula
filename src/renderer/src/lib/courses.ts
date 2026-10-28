// Lista de cursos compartida por toda la interfaz (se refresca con 'courses.changed').
import { create } from 'zustand'
import { api } from './api'
import { demoPacks, isDemo } from './demo'

export interface CourseListItem {
  id: string
  title: string
  subject: string
  icon: string
  hue: number
  updated: string
  examDate?: string | null
  skillCount: number
  exerciseCount: number
  cardCount: number
}

interface CoursesState {
  courses: CourseListItem[]
  loaded: boolean
  load: () => Promise<void>
}

export const useCourses = create<CoursesState>((set) => ({
  courses: [],
  loaded: false,
  load: async () => {
    try {
      const list = (await (api.invoke as (m: string) => Promise<unknown>)('courses.list')) as CourseListItem[]
      set({ courses: Array.isArray(list) ? list : [], loaded: true })
    } catch {
      if (isDemo()) {
        const packs = await demoPacks()
        set({
          loaded: true,
          courses: packs.map((p) => ({ id: p.id, title: p.title, subject: p.subject, icon: p.icon, hue: p.hue, updated: p.updated, examDate: p.exam?.date ?? null, skillCount: p.skills.length, exerciseCount: 0, cardCount: 0 }))
        })
      } else set({ loaded: true })
    }
  }
}))

let wired = false
export function wireCourses(): void {
  if (wired) return
  wired = true
  let t: ReturnType<typeof setTimeout> | null = null
  ;(api.on as (e: string, fn: () => void) => () => void)('courses.changed', () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => void useCourses.getState().load(), 150)
  })
  void useCourses.getState().load()
}
