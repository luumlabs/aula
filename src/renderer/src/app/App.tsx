// Raíz de la interfaz: tema, fondo vivo, barra lateral, barra superior, pantallas con transición y capas flotantes.
import { Suspense, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { ThemeProvider, Toaster, Spinner, cx } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { setLanguage, pickLanguage } from '@renderer/i18n'
import { applyEngineLanguage } from '@engine/language'
import { useSettings, wireSettings } from '@renderer/lib/settings'
import { wireCourses } from '@renderer/lib/courses'
import { Sidebar } from './shell/Sidebar'
import { TopBar } from './shell/TopBar'
import { useTitleStore } from './title'
import { CommandPalette } from './shell/CommandPalette'
import { OrbLauncher } from './shell/OrbLauncher'
import { useNav, routeKey, ScreenScopeContext, type Route } from './router'
import { SCREENS, prepareScreen, preloadScreensWhenIdle } from './screens'
import './screens.css'
import { useDev, installDevHooks } from './dev'
import { useBuiltinCommands } from './shell/commands'
import { AppCommands } from './shell/AppCommands'
import { AchievementToast } from './shell/AchievementToast'
import { Approvals } from './shell/Approvals'
import { ErrorBoundary } from './ErrorBoundary'
import { FloatingTools } from '@renderer/tools/floating'
import { Onboarding } from '@renderer/screens/onboarding'

export function App() {
  const settings = useSettings((s) => s.settings)
  const devTheme = useDev((s) => s.theme)
  const { i18n } = useTranslation()

  useEffect(() => {
    if (api.platform === 'darwin') document.documentElement.classList.add('vibrant')
    // Windows y Linux: los botones de la ventana (titleBarOverlay, 48 px) se dibujan encima; lo flotante empieza debajo
    else if (api.platform !== 'web') document.documentElement.style.setProperty('--titlebar-h', '48px')
    wireSettings()
    wireCourses()
    installDevHooks()
  }, [])

  useEffect(() => {
    const lang = pickLanguage(settings?.general.language, navigator.language)
    setLanguage(lang)
    applyEngineLanguage(lang)
  }, [settings?.general.language, i18n])

  useBuiltinCommands()

  const mode = devTheme ?? settings?.general.theme ?? 'system'
  return (
    <ThemeProvider mode={mode} motion={settings?.general.motion ?? 'system'} textScale={settings?.general.textScale ?? 1}>
      <AppCommands />
      <Backdrop />
      <div className="relative flex h-full">
        {/* el hueco de arriba (sobre la hoja) también arrastra la ventana */}
        <div aria-hidden className="drag absolute inset-x-0 top-0 h-2" />
        <Sidebar />
        <Sheet>
          <Bar />
          <Screens />
        </Sheet>
      </div>
      <AnimatePresence>{settings && !settings.onboarded && <Onboarding key="onboarding" />}</AnimatePresence>
      <FloatingTools />
      <OrbLauncher />
      <CommandPalette />
      <Approvals />
      <AchievementToast />
      <Toaster />
    </ThemeProvider>
  )
}

/**
 * Lienzo: una sola superficie de vidrio cálido para toda la ventana (en macOS, el vidrio del sistema teñido; fuera, el lienzo
 * liso), con un único brillo fijo junto a la barra lateral. La barra lateral vive sobre ese vidrio, sin panel propio.
 */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: api.platform === 'darwin' ? 'var(--sidebar)' : 'var(--canvas)' }}>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(520px 380px at 0% 0%, color-mix(in oklab, var(--accent) 10%, transparent), transparent 70%)' }} />
    </div>
  )
}

/**
 * La hoja de papel donde se trabaja: una única tarjeta grande sobre el vidrio. En macOS flota con un margen de 8 px y esquinas
 * de 16 px (casi concéntricas con las de la ventana); en Windows y Linux llega hasta los bordes de arriba, derecha y abajo
 * (allí se dibujan los botones de la ventana) y solo redondea el lado de la barra lateral.
 */
function Sheet({ children }: { children: ReactNode }) {
  const mac = api.platform === 'darwin'
  return (
    <main
      className={cx(
        'relative flex min-w-0 flex-1 flex-col overflow-clip bg-paper border-[0.5px] border-line shadow-[var(--e1)]',
        mac ? 'my-2 mr-2 rounded-[16px]' : 'rounded-l-[16px] border-r-0 border-y-0'
      )}
    >
      {children}
    </main>
  )
}

function Bar() {
  const { title, right } = useTitleStore()
  return <TopBar title={title} right={right} />
}

/** Una pantalla pintada: la de delante o una que se desvanece. `id` cambia con cada visita (A → B → A son tres capas). */
interface Layer {
  id: number
  key: string
  route: Route
}

interface LayersState {
  current: Layer
  leaving: Layer[]
}

type LayersAction = { type: 'show'; route: Route } | { type: 'gone'; id: number }

let layerSeq = 0

function layersReducer(s: LayersState, a: LayersAction): LayersState {
  if (a.type === 'gone') return s.leaving.some((l) => l.id === a.id) ? { ...s, leaving: s.leaving.filter((l) => l.id !== a.id) } : s
  const key = routeKey(a.route)
  // la misma pantalla con otra ruta (p. ej. otra pestaña del curso): sin transición
  if (key === s.current.key) return a.route === s.current.route ? s : { ...s, current: { ...s.current, route: a.route } }
  // como mucho dos desvaneciéndose a la vez (al navegar muy rápido las más viejas se quitan ya)
  return { current: { id: ++layerSeq, key, route: a.route }, leaving: [...s.leaving.slice(-1), s.current] }
}

/** Lo que dura el fundido de la pantalla que se va (después se quita sí o sí, con un temporizador: nunca se queda colgada). */
const LEAVE_MS = 200

/**
 * Las pantallas, en capas: la nueva entra encima de la anterior, que se desvanece debajo y se quita a los `LEAVE_MS`. No hay
 * página vacía entre las dos, y cada capa lee SU ruta (congelada al irse), así que la que se va no se repinta con la ruta de
 * la siguiente («No se encontró este curso» al salir de un curso). Antes de cambiar se espera a tener el código de la pantalla
 * nueva (y, en un curso, sus datos, con tope): mientras, sigue la anterior. Si llegan varias navegaciones seguidas, manda la
 * última; las respuestas que llegan tarde se ignoran.
 */
function Screens() {
  const route = useNav((s) => s.route)
  const [state, dispatch] = useReducer(layersReducer, route, (r): LayersState => ({ current: { id: ++layerSeq, key: routeKey(r), route: r }, leaving: [] }))
  const ticket = useRef(0)

  useEffect(() => {
    const mine = ++ticket.current
    const ready = prepareScreen(route)
    if (!ready) return dispatch({ type: 'show', route })
    ready.then(
      () => mine === ticket.current && dispatch({ type: 'show', route }),
      // sin código (p. ej. un trozo que no carga): se abre igual y el ErrorBoundary lo cuenta
      () => mine === ticket.current && dispatch({ type: 'show', route })
    )
  }, [route])

  useEffect(() => preloadScreensWhenIdle(), [])

  const layers = [...state.leaving, state.current]
  // con movimiento reducido la que se va se quita en cuanto la nueva ya se pintó (dos fotogramas), no antes: sin vacío (A4-P2-15)
  const [entered, setEntered] = useState(0)
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-screens data-entered={entered === state.current.id ? '' : undefined}>
      {layers.map((l) => (
        <ScreenLayer key={l.id} layer={l} active={l.id === state.current.id} onGone={() => dispatch({ type: 'gone', id: l.id })} onEntered={() => setEntered(l.id)} />
      ))}
    </div>
  )
}

function ScreenLayer({ layer, active, onGone, onEntered }: { layer: Layer; active: boolean; onGone: () => void; onEntered: () => void }) {
  const Screen = SCREENS[layer.route.name].Component
  // la que se va se quita a su hora pase lo que pase con las animaciones (pestaña oculta, movimiento reducido…)
  const gone = useRef(onGone)
  gone.current = onGone
  const scope = useMemo(() => ({ route: layer.route, active }), [layer.route, active])
  useEffect(() => {
    if (active) return
    const timer = setTimeout(() => gone.current(), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [active])
  const entered = useRef(onEntered)
  entered.current = onEntered
  useEffect(() => {
    if (!active) return
    let second = 0
    const first = requestAnimationFrame(() => (second = requestAnimationFrame(() => entered.current())))
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [active])
  return (
    <div
      className={active ? 'screen-layer screen-enter relative flex min-h-0 flex-1 flex-col' : 'screen-layer screen-leave absolute inset-0 flex min-h-0 flex-col overflow-hidden pointer-events-none'}
      data-screen={layer.route.name}
      data-active={active ? 'true' : 'false'}
      aria-hidden={active ? undefined : true}
      inert={!active}
    >
      <ScreenScopeContext.Provider value={scope}>
        <ErrorBoundary>
          <Suspense fallback={<ScreenFallback />}>
            <Screen />
          </Suspense>
        </ErrorBoundary>
      </ScreenScopeContext.Provider>
    </div>
  )
}

/** Solo si el código de la pantalla aún no está (casi nunca: se precarga): un indicador que aparece con retraso. */
function ScreenFallback() {
  return (
    <div className="screen-fallback grid flex-1 place-items-center text-text3">
      <Spinner size={18} />
    </div>
  )
}
