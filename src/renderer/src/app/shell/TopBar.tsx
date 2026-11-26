// Barra superior sobre el papel: atrás/adelante, título de la pantalla, acciones y el buscador (⌘K).
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, IconButton, Kbd, cx } from '@renderer/design'
import { navigate, useNav } from '../router'
import { usePalette } from './CommandPalette'
import { api } from '@renderer/lib/api'
import { SidebarToggle, TOGGLE_SIDEBAR_EVENT, useSidebarState } from './Sidebar'
import { useTitleStore } from '../title'
import { EditorialMore, EditorialPlaces } from './EditorialNav'

const toggleSidebar = () => window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT))

const COMPACT_ROOTS: ReadonlySet<string> = new Set(['courses', 'chat', 'calendar', 'home'])

export function TopBar({ title, right, compact, sidebarOpen }: { title?: ReactNode; right?: ReactNode; compact?: boolean; sidebarOpen?: boolean }) {
  const { t } = useTranslation()
  const { back, forward, canBack, canForward, route } = useNav()
  const openPalette = usePalette((s) => s.open)
  const isMac = api.platform === 'darwin'
  const collapsed = useSidebarState((s) => s.collapsed)
  // la pantalla ya enseña su título (el h1 del curso): en escritorio no se repite (hasta que sale de la vista al desplazarse)
  const compactOnly = useTitleStore((s) => s.compactOnly)
  // pantalla estrecha (el teléfono): atrás solo si hay adónde volver, el título y la lupa
  if (compact) {
    // las pestañas de abajo son el principio: en ellas no hay «atrás»
    const showBack = canBack && !COMPACT_ROOTS.has(route.name)
    return (
      <div className="relative z-10 flex h-[48px] shrink-0 items-center gap-1 px-2">
        {/* con el dedo: botones de 40 px (y zona de toque de 44) */}
        {showBack && (
          <IconButton label={t('nav.back')} size="lg" onClick={back}>
            <Icon name="chevron-left" size={20} />
          </IconButton>
        )}
        {/* en rem: crece con el tamaño del texto (el de Aula y el del sistema), como el resto de la pantalla */}
        <div className={cx('min-w-0 flex-1 truncate font-serif text-[calc(19rem/15)] font-medium tracking-[-0.2px]', !showBack && 'pl-2.5')}>{title}</div>
        {right && <div className="flex items-center gap-1.5">{right}</div>}
        {/* sin barra lateral, los ajustes se abren desde «Hoy» (las cuatro pestañas de abajo se quedan como están) */}
        {route.name === 'home' && (
          <IconButton label={t('nav.settings')} size="lg" onClick={() => navigate({ name: 'settings' })}>
            <Icon name="settings" size={20} />
          </IconButton>
        )}
        <EditorialMore compact />
        <IconButton label={t('search.placeholder')} size="lg" onClick={openPalette}>
          <Icon name="search" size={20} />
        </IconButton>
      </div>
    )
  }
  if (!sidebarOpen) return (
    <header className={cx('drag relative z-10 flex min-h-[52px] shrink-0 items-center gap-1 border-b border-rule px-3',
      isMac ? 'pl-[92px]' : !api.remote && 'pr-[150px]')}>
      <div className="no-drag flex items-center">
        <IconButton label={t('nav.back')} size="sm" disabled={!canBack} onClick={back}><Icon name="chevron-left" size={16} /></IconButton>
        <IconButton label={t('nav.forward')} size="sm" disabled={!canForward} onClick={forward}><Icon name="chevron-right" size={16} /></IconButton>
      </div>
      {route.name !== 'study' && <EditorialPlaces />}
      <div className="min-w-0 flex-1 truncate pl-2 t-headline">{compactOnly || COMPACT_ROOTS.has(route.name) ? null : title}</div>
      {right && <div className="no-drag flex items-center gap-1">{right}</div>}
      {route.name !== 'study' && <IconButton className="no-drag" label={t('search.placeholder')} size="sm" onClick={openPalette}><Icon name="search" size={16} /></IconButton>}
      <EditorialMore toggleSidebar={toggleSidebar} />
    </header>
  )
  return (
    <div className={cx('drag relative z-10 flex h-[52px] shrink-0 items-center gap-1 px-3', !isMac && !api.remote && 'pr-[150px]')}>
      {collapsed && <SidebarToggle className="mr-1" />}
      <IconButton label={t('nav.back')} size="sm" disabled={!canBack} onClick={back}>
        <Icon name="chevron-left" size={16} />
      </IconButton>
      <IconButton label={t('nav.forward')} size="sm" disabled={!canForward} onClick={forward}>
        <Icon name="chevron-right" size={16} />
      </IconButton>
      {/* si la pantalla recoge su título al desplazarse (el curso), entra con un fundido breve */}
      <div key={compactOnly ? 'own' : 'bar'} className="min-w-0 flex-1 truncate t-headline pl-1.5 tab-enter">{compactOnly ? null : title}</div>
      {right && <div className="no-drag flex items-center gap-1.5 mr-1.5">{right}</div>}
      {/* al estudiar no hay buscador a la vista (modo concentración): ⌘K sigue abriéndolo */}
      {route.name !== 'study' && (
        <button onClick={openPalette} className="no-drag flex h-8 w-[min(300px,28vw)] items-center gap-2 rounded-full bg-fill2 px-3 t-ui text-text3 hover:bg-fill3 transition-colors">
          <Icon name="search" size={15} />
          <span className="flex-1 text-left truncate">{t('search.placeholder')}</span>
          {!api.remote && <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>}
        </button>
      )}
      <EditorialMore sidebarOpen toggleSidebar={toggleSidebar} />
    </div>
  )
}
