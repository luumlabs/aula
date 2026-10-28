// Foco atrapado en una capa modal (diálogos, cajón, ⌘K, bienvenida): Tab y Mayús+Tab dan la vuelta dentro de la capa en vez
// de salir a la página de detrás, tapada por el velo (A4-P2-11). Solo manda la capa de más arriba (una confirmación sobre un
// diálogo). Los menús y listas que una capa abre van en un portal: si el foco está en uno, se les deja en paz.
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Qué elemento toca al pulsar Tab: el índice del actual (−1 si el foco está fuera) y cuántos hay. `null`: lo hace el navegador. */
export function nextTrapIndex(current: number, count: number, back: boolean): number | null {
  if (count === 0) return null
  if (current < 0) return back ? count - 1 : 0
  if (back && current === 0) return count - 1
  if (!back && current === count - 1) return 0
  return null
}

/** Lo que se puede enfocar con Tab dentro de `root`, en orden (sin lo oculto ni lo inerte). */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

const stack: HTMLElement[] = []
let installed = false

function onTab(e: KeyboardEvent) {
  const root = stack[stack.length - 1]
  if (e.key !== 'Tab' || e.defaultPrevented || !root?.isConnected) return
  const active = document.activeElement as HTMLElement | null
  // un menú o una lista abiertos desde la capa (en un portal) se ocupan de su propio teclado
  if (active && !root.contains(active) && active.closest('[data-aula-menu], [data-aula-select], [role="listbox"], [role="menu"]')) return
  const list = tabbables(root)
  if (list.length === 0) return void e.preventDefault()
  const next = nextTrapIndex(active ? list.indexOf(active) : -1, list.length, e.shiftKey)
  if (next === null) return
  e.preventDefault()
  list[next].focus()
}

/** Atrapa Tab dentro de `ref` mientras `active` (el elemento puede montarse un instante después, con AnimatePresence). */
export function useTabTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (!installed) {
      document.addEventListener('keydown', onTab, true)
      installed = true
    }
    let root: HTMLElement | null = null
    let frame = 0
    const attach = () => {
      root = ref.current
      if (root) stack.push(root)
      else frame = requestAnimationFrame(attach)
    }
    attach()
    return () => {
      cancelAnimationFrame(frame)
      const i = root ? stack.lastIndexOf(root) : -1
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active, ref])
}
