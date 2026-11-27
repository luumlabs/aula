// Registro de pantallas: cada ruta carga su pantalla bajo demanda, pero se puede precargar (al quedar la app en reposo y
// justo antes de navegar), así la pantalla anterior se queda hasta que la nueva está lista y nunca se ve una página vacía.
import { use, type ComponentType } from 'react'
import type { Route, RouteName } from './router'
import { api } from '@renderer/lib/api'
import { prefetchCoursePack } from '@renderer/screens/course/data'

export interface ScreenEntry {
  /** La pantalla (suspende solo si su código aún no ha llegado). */
  Component: ComponentType
  /** Trae su código (una sola vez; si falla, se puede volver a intentar). */
  preload: () => Promise<void>
  loaded: () => boolean
}

function screen(factory: () => Promise<{ default: ComponentType }>): ScreenEntry {
  let mod: ComponentType | null = null
  let pending: Promise<void> | null = null
  const preload = (): Promise<void> =>
    (pending ??= factory().then(
      (m) => {
        mod = m.default
      },
      (err: unknown) => {
        pending = null
        throw err
      }
    ))
  function Screen() {
    // ya cargada: se pinta en el acto, sin pasar por Suspense (sin destello del indicador)
    if (!mod) use(preload())
    const M = mod!
    return <M />
  }
  return { Component: Screen, preload, loaded: () => mod !== null }
}

export const SCREENS: Record<RouteName, ScreenEntry> = {
  home: screen(() => import('../screens/home')),
  courses: screen(() => import('../screens/courses')),
  course: screen(() => import('../screens/course')),
  study: screen(() => import('../screens/study')),
  calendar: screen(() => import('../screens/calendar')),
  chat: screen(() => import('../screens/chat')),
  create: screen(() => import('../screens/create')),
  tools: screen(() => import('../screens/tools')),
  settings: screen(() => import('../screens/settings')),
  documents: screen(() => import('../screens/documents')),
  inbox: screen(() => import('../screens/inbox')),
  stats: screen(() => import('../screens/stats')),
  run: screen(() => import('../screens/run')),
  gallery: screen(() => import('../screens/gallery')),
  'blocks-preview': screen(() => import('../blocks/preview/BlocksPreview')),
  'visual-preview': screen(() => import('../blocks/visual/preview/VisualPreview').then((m) => ({ default: () => <m.VisualPreview /> })))
}

/** Lo que una pantalla necesita para pintarse con contenido (no solo su código), con un tope: si tarda, se abre igual. */
const DATA: Partial<Record<RouteName, (r: Route) => Promise<unknown> | undefined>> = {
  course: (r) => (r.name === 'course' ? prefetchCoursePack(r.id) : undefined)
}

/** Espera máxima con la pantalla anterior a la vista mientras llegan los datos de la nueva. */
export const PREPARE_MAX_MS = 320

/** Prepara la pantalla de una ruta: su código (siempre) y sus datos (como mucho `PREPARE_MAX_MS`). */
export function prepareScreen(r: Route): Promise<void> | null {
  const entry = SCREENS[r.name]
  const data = DATA[r.name]?.(r)
  if (entry.loaded() && !data) return null
  const code = entry.preload()
  const capped = data ? Promise.race([data.then(() => undefined, () => undefined), new Promise<void>((ok) => setTimeout(ok, PREPARE_MAX_MS))]) : Promise.resolve()
  return Promise.all([code, capped]).then(() => undefined)
}

const IDLE_ORDER_LOCAL: RouteName[] = ['home', 'courses', 'course', 'chat', 'calendar', 'study', 'create', 'inbox', 'stats', 'documents', 'settings', 'tools', 'run']
// Desde un dispositivo (túnel Tailscale) solo precargamos las 4 pestañas principales para no saturar la red al abrir.
const IDLE_ORDER_REMOTE: RouteName[] = ['home', 'chat', 'courses', 'calendar']

/** Tras el primer pintado, en reposo, trae el código de las pantallas una a una (la primera visita ya no espera a la red). */
export function preloadScreensWhenIdle(): () => void {
  let cancelled = false
  const order = api.remote ? IDLE_ORDER_REMOTE : IDLE_ORDER_LOCAL
  const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200))
  const next = (i: number) => {
    if (cancelled || i >= order.length) return
    idle(() => {
      if (cancelled) return
      void SCREENS[order[i]]
        .preload()
        .catch(() => undefined)
        .then(() => next(i + 1))
    })
  }
  const start = setTimeout(() => next(0), api.remote ? 1200 : 600)
  return () => {
    cancelled = true
    clearTimeout(start)
  }
}

// Empieza a traer la pantalla inicial (Hoy) en paralelo con el arranque de React para ahorrar un salto en el arranque.
if (typeof window !== 'undefined') void SCREENS.home.preload().catch(() => undefined)
