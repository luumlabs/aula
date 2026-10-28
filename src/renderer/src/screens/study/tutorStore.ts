// Estado del tutor del curso (el panel de la derecha en los modos de estudio). Es global, pero pertenece a la pantalla que lo
// abrió: solo esa lo pinta, se cierra al ir a otra pantalla y su pregunta inicial se envía UNA vez (A3-P1-1: antes cada
// pantalla de estudio nueva lo reabría y repetía «Explícame mi error», con una llamada de IA de más cada vez).
import { create } from 'zustand'
import type { TutorContext } from '@shared/assistant/types'
import { routeKey, useNav } from '@renderer/app/router'

interface TutorState {
  open: boolean
  context: TutorContext | null
  /** Pregunta que se envía nada más abrir (p. ej. «Explícamelo de otra forma»). De un solo uso: ver `takePrompt`. */
  prompt: string | null
  /** La pantalla (clave de ruta) que lo abrió: solo esa lo enseña. */
  owner: string | null
  show: (context: TutorContext, prompt?: string, owner?: string) => void
  /** Devuelve la pregunta inicial y la borra: aunque el panel se monte otra vez, no se reenvía. */
  takePrompt: () => string | null
  close: () => void
}

export const useTutor = create<TutorState>((set, get) => ({
  open: false,
  context: null,
  prompt: null,
  owner: null,
  show: (context, prompt, owner) => set({ open: true, context, prompt: prompt ?? null, owner: owner ?? routeKey(useNav.getState().route) }),
  takePrompt: () => {
    const p = get().prompt
    if (p !== null) set({ prompt: null })
    return p
  },
  close: () => set({ open: false, prompt: null, owner: null })
}))

/** ¿Lo pinta la pantalla con esta clave de ruta? */
export function tutorVisibleFor(state: Pick<TutorState, 'open' | 'owner'>, key: string): boolean {
  return state.open && state.owner === key
}

// ir a otra pantalla (⌘1–7, ⌘K, atrás, un enlace de la respuesta…) cierra el tutor: su contexto era el de esa pantalla
useNav.subscribe((nav) => {
  const { open, owner, close } = useTutor.getState()
  if (open && owner !== routeKey(nav.route)) close()
})
