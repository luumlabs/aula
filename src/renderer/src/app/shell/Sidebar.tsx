// Barra lateral: Hoy, Aula, Calendario, Herramientas…, tus cursos y «Nuevo curso con Aula». Vive directamente sobre el vidrio de
// la ventana (sin panel propio): el papel de la derecha es la única hoja, así no asoman esquinas del fondo entre los dos.
// Se pliega a solo iconos (con una transición CSS del ancho, sin JavaScript por fotograma). La fila elegida se desliza.
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { create } from 'zustand'
import { Icon, Tooltip, cx, spring, AulaMark, useTheme, type IconName } from '@renderer/design'
import { useNav, navigate, type Route } from '../router'
import { SidebarCourses } from './SidebarCourses'
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

/** Barra plegada o no (la barra superior pone el botón de desplegar cuando está plegada). */
export const useSidebarState = create<{ collapsed: boolean; toggle: () => void }>((set, get) => ({
  collapsed: readCollapsed(),
  toggle: () => {
    const collapsed = !get().collapsed
    set({ collapsed })
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      /* sin almacenamiento: solo dura esta sesión */
    }
  }
}))

/** Ancho de la barra: en macOS, plegada, deja sitio a los semáforos de la ventana (x 22…80). */
export function sidebarWidth(collapsed: boolean, mac: boolean): number {
  return collapsed ? (mac ? 88 : 64) : 248
}

export function Sidebar({ todayCount = 0 }: { todayCount?: number }) {
  const { t } = useTranslation()
  const inboxCount = useInboxCount()
  const route = useNav((s) => s.route)
  const collapsed = useSidebarState((s) => s.collapsed)
  const toggle = useSidebarState((s) => s.toggle)
  // «Ver → Mostrar u ocultar la barra lateral» del menú de la app
  useEffect(() => {
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggle)
  }, [toggle])
  const isMac = api.platform === 'darwin'
  const { reducedMotion } = useTheme()
  const markState = useAulaMarkState()
  const ic = (name: IconName) => <Icon name={name} size={17} />

  const items: NavItem[] = [
    { key: 'home', route: { name: 'home' }, icon: ic('today'), label: t('nav.home'), count: todayCount || undefined },
    { key: 'chat', route: { name: 'chat' }, icon: <AulaMark size={17} state={markState} />, label: t('nav.chat') },
    { key: 'calendar', route: { name: 'calendar' }, icon: ic('calendar'), label: t('nav.calendar') },
    { key: 'stats', route: { name: 'stats' }, icon: ic('chart'), label: t('nav.stats') },
    { key: 'tools', route: { name: 'tools' }, icon: <FxGlyph />, label: t('nav.tools') },
    { key: 'documents', route: { name: 'documents' }, icon: ic('file-text'), label: t('nav.documents') },
    { key: 'inbox', route: { name: 'inbox' }, icon: ic('inbox'), label: t('nav.inbox'), count: inboxCount || undefined }
  ]
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
        {items.map((it) => (
          <NavRow key={it.key} item={it} active={activeKey === it.key} collapsed={collapsed} />
        ))}
      </div>

      <div className={cx('px-4 mt-5 mb-1 t-ui font-semibold text-text3', collapsed && 'invisible')}>{t('nav.courses')}</div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 pb-2">
        <SidebarCourses collapsed={collapsed} />
      </div>

      <KeychainNotice collapsed={collapsed} />
      <UpdateNotice collapsed={collapsed} />
      <div className="flex items-center gap-1 px-2 py-2 border-t-[0.5px] border-line-soft">
        <button
          onClick={() => navigate({ name: 'create' })}
          className={cx('no-drag flex flex-1 min-w-0 items-center gap-2.5 h-8 rounded-[10px] px-2.5 t-ui font-medium text-text hover:bg-fill1', collapsed && 'justify-center px-0')}
          title={t('nav.newCourse')}
          aria-label={collapsed ? t('nav.newCourse') : undefined}
        >
          <span className="text-accent-text">
            <Icon name="create" size={17} />
          </span>
          {!collapsed && <span className="truncate">{t('nav.newCourse')}</span>}
        </button>
        {!collapsed && (
          <button onClick={() => navigate({ name: 'settings' })} className={cx('no-drag grid place-items-center w-8 h-8 rounded-[10px] hover:bg-fill1', route.name === 'settings' ? 'text-text bg-fill2' : 'text-text2 hover:text-text')} aria-label={t('nav.settings')} title={t('nav.settings')}>
            <Icon name="settings" size={17} />
          </button>
        )}
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

/** Novedades sin leer (se actualiza con 'automations.inboxChanged'). */
function useInboxCount(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    api
      .invoke('automations.inboxCount')
      .then((v) => alive && setN(v.unread))
      .catch(() => {})
    const off = api.on('automations.inboxChanged', (e) => setN(e.unread))
    return () => {
      alive = false
      off()
    }
  }, [])
  return n
}

/** «f(x)» en serif cursiva, como el botón de herramientas de la app original. */
function FxGlyph() {
  return <span aria-hidden className="font-serif italic text-[14px] leading-none w-[17px] text-center">ƒ</span>
}

function NavRow({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const row = (
    <button
      onClick={() => navigate(item.route)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? (item.count ? `${item.label} (${item.count})` : item.label) : undefined}
      className={cx('no-drag relative flex w-full items-center gap-2.5 h-8 rounded-[10px] px-2.5 t-ui transition-colors', active ? 'text-text font-medium' : 'text-text hover:bg-fill1', collapsed && 'justify-center px-0')}
    >
      {active && <motion.span layoutId="sidebar-selection" transition={spring.snappy} className="absolute inset-0 rounded-[10px] bg-selected" />}
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
