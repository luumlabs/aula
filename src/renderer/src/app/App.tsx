// Raíz de la interfaz: tema, fondo vivo, barra lateral, barra superior, pantallas con transición y capas flotantes.
import { Suspense, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { SunCursor, ThemeProvider, Toaster, Spinner, cx, useTheme } from '@renderer/design'
import { installDabs } from '@renderer/design/paint'
import { api } from '@renderer/lib/api'
import { setLanguage, pickLanguage } from '@renderer/i18n'
import { applyEngineLanguage } from '@engine/language'
import { useSettings, wireSettings } from '@renderer/lib/settings'
import { wireCourses } from '@renderer/lib/courses'
import { Sidebar, TOGGLE_SIDEBAR_EVENT } from './shell/Sidebar'
import { KeychainNotice } from './shell/KeychainNotice'
import { UpdateNotice } from './shell/UpdateNotice'
import { CompactTabs } from './shell/CompactTabs'
import { isCompact, useCompact } from './shell/compact'
import { installScreenScroll } from './shell/screenScroll'
import { installDeviceBack } from './shell/deviceBack'
import { installKeyboardWatch } from './shell/keyboard'
import { LivePanel } from './shell/LivePanel'
import { routeFromHash, routeToHash } from './routeHash'
import { TopBar } from './shell/TopBar'
import { useTitleStore } from './title'
import { CommandPalette } from './shell/CommandPalette'
import { navigate, useNav, routeKey, ScreenScopeContext, type Route } from './router'
import { SCREENS, prepareScreen, preloadScreensWhenIdle } from './screens'
import './screens.css'
import { useDev, installDevHooks } from './dev'
import { useBuiltinCommands } from './shell/commands'
import { AppCommands } from './shell/AppCommands'
import { AchievementToast } from './shell/AchievementToast'
import { Approvals } from './shell/Approvals'
import { AIConsentDialog } from './shell/AIConsent'
import { ErrorBoundary } from './ErrorBoundary'
import { FloatingTools } from '@renderer/tools/floating'
import { Onboarding } from '@renderer/screens/onboarding'

export function App() {
  const settings = useSettings((s) => s.settings)
  const devTheme = useDev((s) => s.theme)
  const { i18n } = useTranslation()

  // desde un dispositivo (iPad, iPhone, Android): sin ventana que arrastrar; en el teléfono, pestañas abajo en vez de barra lateral
  const remote = api.remote
  const compact = useCompact()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => {
    const toggle = () => setSidebarOpen((open) => !open)
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggle)
  }, [])
  // estudiando en el teléfono, la sesión ocupa la pantalla: sin la barra de arriba ni las pestañas (se sale con el «✕» de su
  // cápsula, o con «atrás» del sistema); quedaba poco sitio para el ejercicio, sobre todo en un iPhone SE
  const immersive = useNav((s) => compact && s.route.name === 'study')

  useEffect(() => {
    if (api.platform === 'darwin') document.documentElement.classList.add('vibrant')
    else if (api.remote) {
      document.documentElement.classList.add('remote')
      // si la página se recargó (un túnel nuevo al volver a la app, un refresco), se vuelve a la pantalla apuntada en la
      // dirección; si no, se abre en «Hoy» (la ruta de siempre), también en el teléfono
      const saved = routeFromHash(window.location.hash)
      if (saved) navigate(saved, { replace: true })
    }
    // Windows y Linux: los botones de la ventana (titleBarOverlay, 48 px) se dibujan encima; lo flotante empieza debajo
    else if (api.platform !== 'web') document.documentElement.style.setProperty('--titlebar-h', '48px')
    wireSettings()
    installDabs()
    wireCourses()
    installDevHooks()
  }, [])

  // desde un dispositivo: la pantalla de ahora queda apuntada en la dirección (routeHash.ts)
  useEffect(() => {
    if (!api.remote) return
    return useNav.subscribe((s) => {
      // sin ruta que apuntar, la dirección se queda con su consulta («?demo=1»: al recargar, la demostración sigue siéndolo)
      try { window.history.replaceState(null, '', routeToHash(s.route) || window.location.pathname + window.location.search) } catch { /* sin historial: no se apunta */ }
    })
  }, [])

  // desde un dispositivo: «atrás» del sistema vuelve dentro de Aula, y el teclado de la pantalla se tiene en cuenta
  useEffect(() => {
    if (!api.remote) return
    const offBack = installDeviceBack(isCompact)
    const offKeyboard = installKeyboardWatch()
    return () => {
      offBack()
      offKeyboard()
    }
  }, [])

  // en el teléfono: subir arriba con la pestaña de ahora (o la hora del iPhone) y volver a «Hoy» por donde se iba
  useEffect(() => installScreenScroll(), [])

  // en el teléfono la hoja de papel es toda la pantalla, también bajo la hora y la batería (styles.css: html.compact)
  useEffect(() => {
    document.documentElement.classList.toggle('compact', compact)
  }, [compact])

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
      <Backdrop compact={compact} />
      {/* en la tableta el hueco de la hora queda sobre el lienzo, como la barra lateral; en el teléfono lo pinta la hoja */}
      <div className={cx('relative flex h-full', compact && 'flex-col')} style={remote && !compact ? { paddingTop: 'var(--safe-top)' } : undefined}>
        {/* el hueco de arriba (sobre la hoja) también arrastra la ventana */}
        {!remote && <div aria-hidden className="drag absolute inset-x-0 top-0 h-2" />}
        {!compact && sidebarOpen && <Sidebar />}
        <Sheet compact={compact} sidebarOpen={sidebarOpen}>
          {!immersive && <Bar compact={compact} sidebarOpen={sidebarOpen} />}
          {!compact && !sidebarOpen && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col gap-1 empty:hidden [&>*]:pointer-events-auto">
              <KeychainNotice collapsed />
              <UpdateNotice collapsed />
            </div>
          )}
          <Screens />
        </Sheet>
        {compact && !immersive && <CompactTabs />}
      </div>
      {/* la bienvenida se hace en el Mac (allí se elige la IA); un dispositivo entra directo */}
      <AnimatePresence>{settings && !settings.onboarded && !remote && <Onboarding key="onboarding" />}</AnimatePresence>
      {!compact && <FloatingTools />}
      <CommandPalette />
      <LivePanel />
      <Approvals />
      {/* el aviso de la IA de terceros: solo en un dispositivo (lib/aiConsent.ts) */}
      {remote && <AIConsentDialog />}
      <AchievementToast />
      <Toaster />
      {!remote && <AppCursor />}
    </ThemeProvider>
  )
}

/** El cursor-sol de Aula (Ajustes → Apariencia), con el tema y el movimiento ya resueltos. */
function AppCursor() {
  const cursor = useSettings((s) => s.settings?.general.cursor ?? 'sun')
  const { dark, reducedMotion } = useTheme()
  return <SunCursor enabled={cursor === 'sun'} dark={dark} reducedMotion={reducedMotion} />
}

/**
 * Lienzo: una sola superficie para toda la ventana (en macOS, el vidrio del sistema teñido; fuera, el lienzo liso). Sin
 * brillos ni degradados: la única luz de la interfaz es el ladrillo de lo que se puede pulsar. La barra lateral vive
 * sobre este lienzo, sin panel propio.
 */
function Backdrop({ compact }: { compact: boolean }) {
  // en el teléfono no hay lienzo a la vista: la hoja llega a todos los bordes (y bajo la hora), así que debajo también es papel
  const background = compact ? 'var(--paper)' : api.platform === 'darwin' ? 'var(--sidebar)' : 'var(--canvas)'
  return <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background }} />
}

/**
 * La hoja de papel donde se trabaja: una única tarjeta grande sobre el vidrio. En macOS flota con un margen de 8 px y esquinas
 * de 16 px (casi concéntricas con las de la ventana); en Windows y Linux llega hasta los bordes de arriba, derecha y abajo
 * (allí se dibujan los botones de la ventana) y solo redondea el lado de la barra lateral.
 */
function Sheet({ children, compact, sidebarOpen }: { children: ReactNode; compact?: boolean; sidebarOpen?: boolean }) {
  const mac = api.platform === 'darwin'
  return (
    <main
      className={cx(
        'paper-grain relative flex min-w-0 flex-1 flex-col overflow-clip bg-paper',
        // sin barra lateral (modo editorial) o en teléfono la hoja llena toda la ventana; con barra lateral conserva su marco
        compact || !sidebarOpen ? 'min-h-0' : cx('border-[0.5px] border-line shadow-[var(--e1)]', mac ? 'my-2 mr-2 rounded-[16px]' : 'rounded-l-[16px] border-r-0 border-y-0')
      )}
      style={compact ? { paddingTop: 'var(--safe-top)' } : undefined}
    >
      {children}
    </main>
  )
}

function Bar({ compact, sidebarOpen }: { compact?: boolean; sidebarOpen?: boolean }) {
  const { title, right } = useTitleStore()
  return <TopBar title={title} right={right} compact={compact} sidebarOpen={sidebarOpen} />
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
  // la entrada se ve una sola vez: al terminar o cancelarse SU animación (no la de un hijo, p. ej. .tab-enter) se quita la
  // clase, y un cambio de estilo posterior (data-ambient, movimiento reducido…) ya no puede volver a arrancarla
  const { reducedMotion } = useTheme()
  const [entering, setEntering] = useState(true)
  // con movimiento reducido no hay animación ni `animationend`: se quita ya, o al volver a «Completo» la pantalla entraba otra vez
  useEffect(() => {
    if (reducedMotion) setEntering(false)
  }, [reducedMotion])
  // a mano porque React no tiene onAnimationCancel
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el || !entering) return
    const done = (e: AnimationEvent) => {
      if (e.target === el && e.animationName === 'screen-enter') setEntering(false)
    }
    el.addEventListener('animationend', done)
    el.addEventListener('animationcancel', done)
    return () => {
      el.removeEventListener('animationend', done)
      el.removeEventListener('animationcancel', done)
    }
  }, [entering])
  return (
    <div
      ref={box}
      className={active ? cx('screen-layer relative flex min-h-0 flex-1 flex-col', entering && 'screen-enter') : 'screen-layer screen-leave absolute inset-0 flex min-h-0 flex-col overflow-hidden pointer-events-none'}
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
