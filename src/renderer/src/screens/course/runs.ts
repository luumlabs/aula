// La última creación de cada curso, compartida por la pantalla del curso, la barra lateral y Hoy (para marcar los cursos cuya
// creación falló o se detuvo sin ningún tema). Se carga con 'generation.runs' y se actualiza con 'generation.update'.
import { create } from 'zustand'
import type { RunSummary, RunView } from '@shared/generation/types'
import { api } from '@renderer/lib/api'
import { courseRunIssue, latestByCourse, type CourseRunIssue } from './failure'

interface LatestRunsState {
  latest: Record<string, RunSummary>
  load: () => Promise<void>
  /** Un aviso de 'generation.update': la ejecución pasa a ser la última de su curso. */
  apply: (v: RunView) => void
}

export const useLatestRuns = create<LatestRunsState>((set) => ({
  latest: {},
  load: async () => {
    try {
      const runs = await api.invoke('generation.runs')
      set({ latest: latestByCourse(Array.isArray(runs) ? runs : []) })
    } catch {
      /* sin proceso principal (modo demostración): nada que marcar */
    }
  },
  apply: (v) =>
    set((s) => {
      const updated = v.finishedAt ?? new Date().toISOString()
      const summary: RunSummary = { id: v.id, packId: v.packId, title: v.title, icon: v.icon, hue: v.hue, state: v.state, progress: v.progress, stageLabel: '', updated }
      return { latest: { ...s.latest, [v.packId]: summary } }
    })
}))

let wired = false

/** Se conecta una vez (al primer uso): carga inicial, avisos de las ejecuciones y cursos borrados o creados. */
function wire(): void {
  if (wired || typeof window === 'undefined' || !window.aula) return
  wired = true
  let timer: ReturnType<typeof setTimeout> | null = null
  const reload = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void useLatestRuns.getState().load(), 400)
  }
  api.on('generation.update', (v) => useLatestRuns.getState().apply(v))
  ;(api.on as (e: string, fn: () => void) => () => void)('courses.changed', reload)
  void useLatestRuns.getState().load()
}

/** La última ejecución de cada curso (para las listas de cursos). */
export function useLatestRunsMap(): Record<string, RunSummary> {
  wire()
  return useLatestRuns((s) => s.latest)
}

/** La última ejecución de un curso. */
export function useCourseRun(packId: string): RunSummary | undefined {
  wire()
  return useLatestRuns((s) => s.latest[packId])
}

/** El problema de creación de un curso (falló, se detuvo, límite o aún en marcha) si no tiene ningún tema. */
export function useCourseRunIssue(packId: string, skillCount: number): CourseRunIssue | undefined {
  return courseRunIssue(useCourseRun(packId), skillCount)
}
