// Navegación de la app (sin URLs): una pila con atrás/adelante. Las pantallas leen SU ruta con `useRoute()`: la de la capa que
// las pinta, que se congela cuando la pantalla se va (mientras se desvanece no se vuelve a pintar con la ruta de la siguiente).
import { createContext, useContext } from 'react'
import { create } from 'zustand'

export type CourseTab = 'overview' | 'learn' | 'practice' | 'cards' | 'exam' | 'mistakes' | 'materials' | 'reference'

export type Route =
  | { name: 'home' }
  | { name: 'course'; id: string; tab?: CourseTab; skill?: string }
  | { name: 'study'; id: string; mode: 'learn' | 'practice' | 'cards' | 'exam' | 'mistakes' | 'plan'; skill?: string }
  | { name: 'calendar'; date?: string; view?: 'agenda' | 'week' | 'month' }
  | { name: 'chat'; conversation?: string; prompt?: string }
  | { name: 'create'; prefill?: { title?: string; examDate?: string; topics?: string; eventId?: string; fromPlatform?: boolean } }
  | { name: 'tools'; tool?: string }
  | { name: 'settings'; section?: string }
  | { name: 'documents'; doc?: string }
  | { name: 'inbox' }
  | { name: 'stats' }
  | { name: 'run'; id: string }
  | { name: 'gallery' }
  | { name: 'blocks-preview'; skill?: string }
  | { name: 'visual-preview' }

export type RouteName = Route['name']

interface NavState {
  stack: Route[]
  index: number
  route: Route
  navigate: (r: Route, opts?: { replace?: boolean }) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
}

function same(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: 'home' }],
  index: 0,
  route: { name: 'home' },
  canBack: false,
  canForward: false,
  navigate: (r, opts) => {
    const { stack, index } = get()
    if (same(stack[index], r)) return
    const base = opts?.replace ? stack.slice(0, index) : stack.slice(0, index + 1)
    const next = [...base, r].slice(-60)
    set({ stack: next, index: next.length - 1, route: r, canBack: next.length > 1, canForward: false })
  },
  back: () => {
    const { stack, index } = get()
    if (index <= 0) return
    set({ index: index - 1, route: stack[index - 1], canBack: index - 1 > 0, canForward: true })
  },
  forward: () => {
    const { stack, index } = get()
    if (index >= stack.length - 1) return
    set({ index: index + 1, route: stack[index + 1], canBack: true, canForward: index + 1 < stack.length - 1 })
  }
}))

export const navigate = (r: Route, opts?: { replace?: boolean }) => useNav.getState().navigate(r, opts)

/** Clave estable de una ruta para las transiciones (cambiar de pestaña dentro de un curso no recarga la pantalla). */
export function routeKey(r: Route): string {
  switch (r.name) {
    case 'course':
      return `course:${r.id}`
    case 'study':
      return `study:${r.id}:${r.mode}:${r.skill ?? ''}`
    default:
      return r.name
  }
}

/** La capa de pantalla que pinta a un componente: su ruta y si es la de delante (la que se va ya no manda: ni título ni atajos). */
export interface ScreenScope {
  route: Route
  active: boolean
}

export const ScreenScopeContext = createContext<ScreenScope | null>(null)

/** La ruta de esta pantalla. Dentro de una capa, la suya (aunque la navegación ya vaya por otra); fuera, la actual. */
export function useRoute(): Route {
  const scope = useContext(ScreenScopeContext)
  // con capa no hace falta escuchar la navegación (el selector devuelve siempre lo mismo y no repinta)
  const live = useNav((s) => (scope ? null : s.route))
  return scope?.route ?? live ?? useNav.getState().route
}

/** ¿Es la pantalla de delante? (true fuera de una capa). */
export function useScreenActive(): boolean {
  return useContext(ScreenScopeContext)?.active ?? true
}
