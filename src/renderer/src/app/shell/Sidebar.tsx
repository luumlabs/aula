// Barra lateral en tres grupos: arriba lo de cada día (Hoy, Aula, Bandeja, Calendario); en medio tus cursos y «Nuevo curso»;
// abajo, atenuado, lo de consulta (Documentos, Herramientas, Estadísticas) y Ajustes, que se ve también plegada. Vive
// directamente sobre el vidrio de la ventana (sin panel propio): el papel de la derecha es la única hoja. Se pliega a solo
// iconos (con una transición CSS del ancho, sin JavaScript por fotograma). La fila elegida se desliza.
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { create } from 'zustand'
import { Icon, Tooltip, cx, spring, AulaMark, useTheme, type IconName, SelectionPaint } from '@renderer/design'
import { useNav, type Route } from '../router'
import { SidebarCourses } from './SidebarCourses'
import { goFromSidebar } from './sidebarNav'
import { useInboxCount } from './inboxCount'
import { KeychainNotice } from './KeychainNotice'
import { UpdateNotice } from './UpdateNotice'
import { api } from '@renderer/lib/api'
import { useAulaMarkState } from '@renderer/screens/chat/liveStatus'

interface NavItem {
  key: string
  route: Route
  icon: ReactNode
  label: string
  count?: number
}

export const TOGGLE_SIDEBAR_EVENT = 'aula:toggle-sidebar'
const COLLAPSED_KEY = 'aula.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* sin almacenamiento: solo dura esta sesión */
  }
}

interface SidebarState {
  /** Lo que eligió el estudiante (se guarda). */
  pinned: boolean
  /** Modo concentración: al estudiar, la barra se pliega sola mientras dure el estudio (no se guarda). */
  focus: boolean
  /** Lo que se ve: plegada si la plegó el estudiante o si está estudiando. */
  collapsed: boolean
  toggle: () => void
  expand: () => void
  setFocus: (focus: boolean) => void
}

/** Barra plegada o no (la barra superior pone el botón de desplegar cuando está plegada). */
export const useSidebarState = create<SidebarState>((set, get) => ({
  pinned: readCollapsed(),
  focus: false,
  collapsed: readCollapsed(),
  toggle: () => {
    // desplegarla a mano en pleno estudio la deja abierta hasta salir (y se guarda como lo elegido)
    const collapsed = !get().collapsed
    set({ pinned: collapsed, focus: false, collapsed })
    saveCollapsed(collapsed)
  },
  expand: () => {
    set({ pinned: false, focus: false, collapsed: false })
    saveCollapsed(false)
  },
  setFocus: (focus) => set((s) => ({ focus, collapsed: s.pinned || focus }))
}))

/** Al entrar a estudiar, la barra se pliega; al salir, vuelve a como la dejó el estudiante. */
export function useStudyFocus(studying: boolean): void {
  const setFocus = useSidebarState((s) => s.setFocus)
  const prev = useRef(studying)
  useEffect(() => {
    if (prev.current === studying) return
    prev.current = studying
    setFocus(studying)
  }, [studying, setFocus])
}

/** Ancho de la barra: en macOS, plegada, deja sitio a los semáforos de la ventana (x 22…80). */
export function sidebarWidth(collapsed: boolean, mac: boolean): number {
  return collapsed ? (mac ? 88 : 64) : 248
}

export function Sidebar({ todayCount = 0 }: { todayCount?: number }) {
  const { t } = useTranslation()
  const inboxCount = useInboxCount()
  const route = useNav((s) => s.route)
  const collapsed = useSidebarState((s) => s.collapsed)
  // modo concentración: en una lección, un ejercicio, las tarjetas o el simulacro solo queda lo que se estudia
  useStudyFocus(route.name === 'study')
  const isMac = api.platform === 'darwin'
  const { reducedMotion } = useTheme()
  const markState = useAulaMarkState()
  const ic = (name: IconName) => <Icon name={name} size={17} />
  // lo de consulta va más pequeño y atenuado: no compite con lo de cada día
  const small = (name: IconName) => <Icon name={name} size={15} />

  const primary: NavItem[] = [
    { key: 'home', route: { name: 'home' }, icon: ic('today'), label: t('nav.home'), count: todayCount || undefined },
    { key: 'chat', route: { name: 'chat' }, icon: <AulaMark size={17} state={markState} />, label: t('nav.chat') },
    { key: 'inbox', route: { name: 'inbox' }, icon: ic('inbox'), label: t('nav.inbox'), count: inboxCount || undefined },
    { key: 'calendar', route: { name: 'calendar' }, icon: ic('calendar'), label: t('nav.calendar') }
  ]
  const secondary: NavItem[] = [
    { key: 'documents', route: { name: 'documents' }, icon: small('file-text'), label: t('nav.documents') },
    { key: 'tools', route: { name: 'tools' }, icon: <FxGlyph size={15} />, label: t('nav.tools') },
    { key: 'stats', route: { name: 'stats' }, icon: small('chart'), label: t('nav.stats') }
  ]
  // también desde un dispositivo: allí Ajustes enseña solo lo de uso diario (las claves y las plataformas, en el Mac)
  const settingsItem: NavItem = { key: 'settings', route: { name: 'settings' }, icon: small('settings'), label: t('nav.settings') }
  const activeKey = route.name === 'study' || route.name === 'course' || route.name === 'create' || route.name === 'run' ? null : route.name

  return (
    <nav
      className={cx('relative z-20 flex h-full shrink-0 flex-col overflow-hidden', !reducedMotion && 'transition-[width] duration-[320ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]')}
      style={{ width: sidebarWidth(collapsed, isMac) }}
      aria-label="Aula"
    >
      <div className={cx('drag flex h-[52px] shrink-0 items-center px-3', isMac ? 'justify-end' : 'justify-between pl-4')}>
        {!isMac && !collapsed && <span className="t-headline font-serif text-[17px] font-medium tracking-[-0.2px]">Aula</span>}
        {/* plegada, el botón pasa a la barra superior (en macOS aquí están los semáforos de la ventana) */}
        {!collapsed && <SidebarToggle />}
      </div>

      <div className="px-2 flex flex-col gap-px">
        {primary.map((it) => (
          <NavRow key={it.key} item={it} active={activeKey === it.key} collapsed={collapsed} />
        ))}
      </div>

      <div className={cx('px-4 mt-5 mb-1 t-ui font-semibold text-text3', collapsed && 'invisible')}>{t('nav.courses')}</div>
      {/* la lista de cursos es lo que se desplaza; «Nuevo curso» es su última fila */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2">
        <SidebarCourses collapsed={collapsed} />
      </div>

      <KeychainNotice collapsed={collapsed} />
      <UpdateNotice collapsed={collapsed} />
      <div className="px-2 py-1.5 flex flex-col gap-px border-t-[0.5px] border-line-soft">
        {secondary.map((it) => (
          <NavRow key={it.key} item={it} active={activeKey === it.key} collapsed={collapsed} muted />
        ))}
      </div>
      <div className="px-2 py-1.5 flex flex-col border-t-[0.5px] border-line-soft">
        <NavRow item={settingsItem} active={activeKey === 'settings'} collapsed={collapsed} muted />
      </div>
    </nav>
  )
}

/** Plegar o desplegar la barra lateral (el mismo icono en la barra lateral y, plegada, en la barra superior). */
export function SidebarToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const collapsed = useSidebarState((s) => s.collapsed)
  const toggle = useSidebarState((s) => s.toggle)
  return (
    <button
      className={cx('no-drag grid place-items-center w-7 h-7 rounded-[8px] text-text2 hover:text-text hover:bg-fill1', className)}
      onClick={toggle}
      aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
      title={collapsed ? t('nav.expand') : t('nav.collapse')}
    >
      <Icon name="inspector" size={17} style={{ transform: 'scaleX(-1)' }} />
    </button>
  )
}

/** «f(x)» en serif cursiva, como el botón de herramientas de la app original. */
function FxGlyph({ size = 17 }: { size?: number }) {
  return <span aria-hidden className="font-serif italic leading-none text-center" style={{ fontSize: size - 3, width: size }}>ƒ</span>
}

/** Una fila de la barra. `muted`: lo de consulta, en tinta suave (al elegirla se pinta igual que las demás). */
function NavRow({ item, active, collapsed, muted }: { item: NavItem; active: boolean; collapsed: boolean; muted?: boolean }) {
  const row = (
    <button
      onClick={(e) => goFromSidebar(e, item.route)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? (item.count ? `${item.label} (${item.count})` : item.label) : undefined}
      className={cx('no-drag relative flex w-full items-center gap-2.5 h-8 rounded-[10px] px-2.5 t-ui transition-colors', active ? 'text-text font-medium' : cx('hover:bg-fill1', muted ? 'text-text2 hover:text-text' : 'text-text'), collapsed && 'justify-center px-0')}
    >
      {active && <motion.span layoutId="sidebar-selection" transition={spring.snappy} className="absolute inset-0"><SelectionPaint seed="barra" /></motion.span>}
      <span className={cx('relative grid w-[18px] place-items-center', active ? 'text-text' : 'text-text2')}>{item.icon}</span>
      {!collapsed && <span className="relative flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && item.count ? <span className="relative t-caption tabular">{item.count}</span> : null}
      {collapsed && item.count ? <span className="absolute top-1.5 left-1/2 ml-1.5 w-1.5 h-1.5 rounded-full bg-accent" /> : null}
    </button>
  )
  return collapsed ? (
    <Tooltip label={item.label} side="right">
      {row}
    </Tooltip>
  ) : (
    row
  )
}
