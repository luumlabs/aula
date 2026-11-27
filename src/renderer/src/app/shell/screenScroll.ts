// El desplazamiento de las pantallas en el teléfono, como en las apps: subir arriba (tocar la pestaña en la que ya se está o,
// en el iPhone, la hora) y volver a «Hoy» o a Novedades por donde se iba (al cambiar de pestaña cada pantalla se monta de
// nuevo, y empezaba arriba). Cada pantalla se desplaza en su propia zona (la página entera no se mueve): se busca la de
// delante.
import { useNav, type Route } from '../router'
import { isCompact } from './compact'

/** Las pestañas que recuerdan por dónde se iba (el chat ya vuelve a lo último y el calendario, a hoy). */
const REMEMBERED: ReadonlySet<Route['name']> = new Set(['home', 'inbox'])
/** Lo que se espera, como mucho, a que la pantalla que vuelve tenga ya su contenido para dejarla donde estaba. */
const RESTORE_MS = 1500

/** La capa de pantalla de delante (o la de esa ruta, si se pide). */
function activeLayer(name?: Route['name']): HTMLElement | null {
  const sel = name ? `[data-screens] > [data-screen="${name}"][data-active="true"]` : '[data-screens] > [data-active="true"]'
  return document.querySelector<HTMLElement>(sel)
}

/** La zona que se desplaza de una pantalla: la más grande con algo que desplazar. */
export function mainScroller(layer: HTMLElement | null = activeLayer()): HTMLElement | null {
  if (!layer) return null
  const candidates = layer.querySelectorAll<HTMLElement>('.overflow-y-auto, .overflow-auto, .overflow-y-scroll')
  const list = candidates.length ? candidates : layer.querySelectorAll<HTMLElement>('*')
  let best: HTMLElement | null = null
  let area = 0
  for (const el of list) {
    if (el.scrollHeight <= el.clientHeight + 1) continue
    const a = el.clientWidth * el.clientHeight
    if (a <= area) continue
    const oy = getComputedStyle(el).overflowY
    if (oy !== 'auto' && oy !== 'scroll') continue
    area = a
    best = el
  }
  return best
}

const reduced = (): boolean => document.documentElement.classList.contains('reduce-motion')

/** Sube la pantalla de delante hasta arriba (con movimiento reducido, de golpe). Dice si había adónde subir. */
export function scrollActiveToTop(): boolean {
  const el = mainScroller()
  if (!el || el.scrollTop <= 0) return false
  el.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })
  return true
}

const saved = new Map<Route['name'], number>()
let restoring: (() => void) | null = null

/** Apunta por dónde va la pantalla `name` (antes de que se vaya). */
function remember(name: Route['name']): void {
  const el = mainScroller(activeLayer(name))
  if (el) saved.set(name, el.scrollTop)
  else saved.delete(name)
}

/** Deja la pantalla `name`, en cuanto llegue y tenga contenido, donde estaba. Tocarla o desplazarla antes lo cancela. */
function restore(name: Route['name']): void {
  restoring?.()
  const top = saved.get(name)
  if (!top) return
  const until = performance.now() + RESTORE_MS
  let frame = 0
  const stop = (): void => {
    cancelAnimationFrame(frame)
    window.removeEventListener('touchstart', stop, true)
    window.removeEventListener('wheel', stop, true)
    window.removeEventListener('keydown', stop, true)
    if (restoring === stop) restoring = null
  }
  const step = (): void => {
    const el = mainScroller(activeLayer(name))
    const room = el ? el.scrollHeight - el.clientHeight : 0
    if (el && (room >= top || performance.now() > until)) {
      el.scrollTop = Math.min(top, room)
      return stop()
    }
    if (performance.now() > until) return stop()
    frame = requestAnimationFrame(step)
  }
  restoring = stop
  window.addEventListener('touchstart', stop, true)
  window.addEventListener('wheel', stop, true)
  window.addEventListener('keydown', stop, true)
  frame = requestAnimationFrame(step)
}

/** Engancha la memoria de las pestañas y `window.__aulaScrollTop` (la hora del iPhone). Devuelve cómo quitarlo. */
export function installScreenScroll(): () => void {
  const off = useNav.subscribe((s, prev) => {
    if (s.route === prev.route || !isCompact()) return
    // la pantalla que se va aún está a la vista (la nueva entra cuando tiene su código)
    if (REMEMBERED.has(prev.route.name) && prev.route.name !== s.route.name) remember(prev.route.name)
    if (REMEMBERED.has(s.route.name) && prev.route.name !== s.route.name) restore(s.route.name)
  })
  const host = window as unknown as { __aulaScrollTop?: () => boolean }
  host.__aulaScrollTop = scrollActiveToTop
  return () => {
    off()
    restoring?.()
    delete host.__aulaScrollTop
  }
}
