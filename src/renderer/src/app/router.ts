// Navegación de la app (sin URLs): una pila con atrás/adelante. Las pantallas leen SU ruta con `useRoute()`: la de la capa que
// las pinta, que se congela cuando la pantalla se va (mientras se desvanece no se vuelve a pintar con la ruta de la siguiente).
import { createContext, useContext } from 'react'
import { create } from 'zustand'

/** Las cinco vistas del curso: Resumen, Aprender, Repasar, Simulacro y Materiales. */
export type CourseView = 'overview' | 'learn' | 'review' | 'exam' | 'materials'
/** Ids de antes de juntar las pestañas: siguen funcionando como alias (atajos, ⌘K, enlaces de Aula, scripts, pruebas). */
export type LegacyCourseTab = 'practice' | 'cards' | 'mistakes' | 'reference'
export type CourseTab = CourseView | LegacyCourseTab

export const COURSE_VIEWS: readonly CourseView[] = ['overview', 'learn', 'review', 'exam', 'materials']

/** Dónde acaba un id viejo: Práctica, Tarjetas y Errores son secciones de Repasar; Referencia, el apéndice de Aprender. */
const LEGACY_TABS: Record<LegacyCourseTab, CourseView> = { practice: 'review', cards: 'review', mistakes: 'review', reference: 'learn' }

/** La vista que se pinta para una pestaña (nueva o vieja) y, si era un alias, la sección a la que hay que llevar la vista.
 *  Lo desconocido (una dirección escrita a mano) va al Resumen. */
export function canonicalTab(tab?: string): { view: CourseView; focus?: LegacyCourseTab } {
  if (tab && Object.hasOwn(LEGACY_TABS, tab)) return { view: LEGACY_TABS[tab as LegacyCourseTab], focus: tab as LegacyCourseTab }
  return { view: (COURSE_VIEWS as readonly string[]).includes(tab ?? '') ? (tab as CourseView) : 'overview' }
}

export type Route =
  | { name: 'home' }
  | { name: 'courses' }
  | { name: 'course'; id: string; tab?: CourseTab; skill?: string }
  /** `start`: entrar directamente en el primer paso (la sesión guiada de «Empezar el plan» y «Estudiar ahora»). No se guarda
   *  en la dirección: al recargar no vuelve a arrancar. */
  | { name: 'study'; id: string; mode: 'learn' | 'practice' | 'cards' | 'exam' | 'mistakes' | 'plan'; skill?: string; start?: boolean }
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

/** Cómo se llega a una ruta: `replace`, en lugar de la entrada de ahora; `root`, como una pestaña de abajo del teléfono: el
 *  historial vuelve a empezar en «Hoy» (atrás desde otra pestaña va a «Hoy» y desde «Hoy» sale de la app). */
export interface NavOptions {
  replace?: boolean
  root?: boolean
}

/** La pila de una pestaña que se abre como raíz: «Hoy» sola, o «Hoy» y la pestaña. */
export function rootStack(r: Route): Route[] {
  return r.name === 'home' ? [r] : [{ name: 'home' }, r]
}

interface NavState {
  stack: Route[]
  index: number
  route: Route
  navigate: (r: Route, opts?: NavOptions) => void
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
    if (opts?.root) {
      const next = rootStack(r)
      if (index === stack.length - 1 && JSON.stringify(stack) === JSON.stringify(next)) return
      return set({ stack: next, index: next.length - 1, route: r, canBack: next.length > 1, canForward: false })
    }
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

export const navigate = (r: Route, opts?: NavOptions) => useNav.getState().navigate(r, opts)

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
