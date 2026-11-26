// Las cuatro pestañas de abajo del teléfono, sin tocar la página (para probarlas solas): de qué pestaña es la pantalla de
// ahora y qué hace tocar una.
import type { Route } from '../router'

export const TAB_ROOTS = ['home', 'chat', 'courses', 'calendar'] as const
export type TabRoot = (typeof TAB_ROOTS)[number]

const isTab = (name: string): name is TabRoot => (TAB_ROOTS as readonly string[]).includes(name)

/** La pestaña de la que cuelga la pantalla de ahora: la última raíz de pestaña en la pila hasta aquí (un curso abierto desde
 *  «Hoy» es de «Hoy»; unos ajustes abiertos desde Novedades, de Novedades). Sin ninguna, «Hoy». */
export function tabOwner(stack: readonly Route[], index: number): TabRoot {
  for (let i = Math.min(index, stack.length - 1); i >= 0; i--) {
    const name = stack[i].name
    if (isTab(name)) return name
  }
  return 'home'
}

/** Tocar una pestaña: otra pestaña, se cambia a ella; la de ahora, en una pantalla abierta desde ella, vuelve a su raíz; la de
 *  ahora en su raíz, sube arriba (como en las apps del iPhone). */
export function tabTap(tab: TabRoot, s: { stack: readonly Route[]; index: number; route: Route }): 'switch' | 'pop' | 'top' {
  if (tabOwner(s.stack, s.index) !== tab) return 'switch'
  const atRoot = s.route.name === tab && Object.keys(s.route).length === 1
  return atRoot ? 'top' : 'pop'
}
