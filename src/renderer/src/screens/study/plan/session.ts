// «Estudiar ahora»: el plan de hoy de un curso como una sesión con pasos (tarjetas → errores → aprender → practicar…). Vive
// mientras la app está abierta; cada modo, al terminar, ofrece seguir con el siguiente paso y salir vuelve al plan.
import { create } from 'zustand'
import type { PlanItem } from '@engine/learn'
import { navigate, type Route } from '@renderer/app/router'

interface PlanSession {
  packId: string
  items: PlanItem[]
  done: boolean[]
  /** Paso en marcha (-1 = en la agenda). */
  current: number
  startedAt: number
}

interface PlanStore {
  session: PlanSession | null
}

export const usePlanStore = create<PlanStore>(() => ({ session: null }))

/** Pasos que se pueden hacer (el descanso no es un paso). */
export const runnable = (items: PlanItem[]): PlanItem[] => items.filter((i) => i.kind !== 'rest' && i.minutes > 0)

export function startPlan(packId: string, items: PlanItem[]): void {
  const steps = runnable(items)
  usePlanStore.setState({ session: { packId, items: steps, done: steps.map(() => false), current: -1, startedAt: Date.now() } })
}

export function activePlan(packId: string): PlanSession | null {
  const s = usePlanStore.getState().session
  // un plan de otro día ya no vale
  return s && s.packId === packId && new Date(s.startedAt).toDateString() === new Date().toDateString() ? s : null
}

export function endPlan(): void {
  usePlanStore.setState({ session: null })
}

/** La ruta de estudio de un paso del plan. */
export function routeForStep(packId: string, item: PlanItem): Route {
  const skill = item.skillID ?? undefined
  switch (item.kind) {
    case 'review': return item.id === 'formulas' ? { name: 'course', id: packId, tab: 'reference' } : { name: 'study', id: packId, mode: 'cards' }
    case 'mistakes': return { name: 'study', id: packId, mode: 'mistakes' }
    case 'learn': return { name: 'study', id: packId, mode: 'learn', skill }
    case 'mock': return { name: 'study', id: packId, mode: 'exam' }
    case 'diagnostic': return { name: 'study', id: packId, mode: 'practice', skill: '__diagnostic' }
    default: return { name: 'study', id: packId, mode: 'practice', skill }
  }
}

/** Abre el paso `i` del plan. */
export function runStep(packId: string, i: number): void {
  const s = activePlan(packId)
  if (!s || !s.items[i]) return
  usePlanStore.setState({ session: { ...s, current: i } })
  navigate(routeForStep(packId, s.items[i]))
}

/** El paso en marcha terminó (lo llama el resumen de cada modo). */
export function completeCurrentStep(packId: string): void {
  const s = activePlan(packId)
  if (!s || s.current < 0 || s.done[s.current]) return
  const done = [...s.done]
  done[s.current] = true
  usePlanStore.setState({ session: { ...s, done } })
}

/** El siguiente paso sin hacer (o null si el plan está completo). */
export function nextStep(packId: string): { index: number; item: PlanItem } | null {
  const s = activePlan(packId)
  if (!s) return null
  const i = s.done.findIndex((d, k) => !d && k !== s.current)
  return i >= 0 ? { index: i, item: s.items[i] } : null
}
