// Barra superior sobre el papel: atrás/adelante, título de la pantalla, acciones y el buscador (⌘K).
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, IconButton, Kbd, cx } from '@renderer/design'
import { navigate, useNav } from '../router'
import { usePalette } from './CommandPalette'
import { api } from '@renderer/lib/api'
import { SidebarToggle, useSidebarState } from './Sidebar'

const COMPACT_ROOTS: ReadonlySet<string> = new Set(['inbox', 'chat', 'calendar', 'home'])

export function TopBar({ title, right, compact }: { title?: ReactNode; right?: ReactNode; compact?: boolean }) {
  const { t } = useTranslation()
  const { back, forward, canBack, canForward, route } = useNav()
  const openPalette = usePalette((s) => s.open)
  const isMac = api.platform === 'darwin'
  const collapsed = useSidebarState((s) => s.collapsed)
  // pantalla estrecha (el teléfono): atrás solo si hay adónde volver, el título y la lupa
  if (compact) {
    // las pestañas de abajo son el principio: en ellas no hay «atrás»
    const showBack = canBack && !COMPACT_ROOTS.has(route.name)
    return (
      <div className="relative z-10 flex h-[48px] shrink-0 items-center gap-1 px-2">
        {showBack && (
          <IconButton label={t('nav.back')} size="sm" onClick={back}>
            <Icon name="chevron-left" size={18} />
          </IconButton>
        )}
        <div className={cx('min-w-0 flex-1 truncate font-serif text-[19px] font-medium tracking-[-0.2px]', !showBack && 'pl-2')}>{title}</div>
        {right && <div className="flex items-center gap-1.5">{right}</div>}
        {/* sin barra lateral, los ajustes se abren desde «Hoy» (las cuatro pestañas de abajo se quedan como están) */}
        {route.name === 'home' && (
          <IconButton label={t('nav.settings')} size="sm" onClick={() => navigate({ name: 'settings' })}>
            <Icon name="settings" size={18} />
          </IconButton>
        )}
        <IconButton label={t('search.placeholder')} size="sm" onClick={openPalette}>
          <Icon name="search" size={18} />
        </IconButton>
      </div>
    )
  }
  return (
    <div className={cx('drag relative z-10 flex h-[52px] shrink-0 items-center gap-1 px-3', !isMac && !api.remote && 'pr-[150px]')}>
      {collapsed && <SidebarToggle className="mr-1" />}
      <IconButton label={t('nav.back')} size="sm" disabled={!canBack} onClick={back}>
        <Icon name="chevron-left" size={16} />
      </IconButton>
      <IconButton label={t('nav.forward')} size="sm" disabled={!canForward} onClick={forward}>
        <Icon name="chevron-right" size={16} />
      </IconButton>
      <div className="min-w-0 flex-1 truncate t-headline pl-1.5">{title}</div>
      {right && <div className="no-drag flex items-center gap-1.5 mr-1.5">{right}</div>}
      <button onClick={openPalette} className="no-drag flex h-8 w-[min(300px,28vw)] items-center gap-2 rounded-full bg-fill2 px-3 t-ui text-text3 hover:bg-fill3 transition-colors">
        <Icon name="search" size={15} />
        <span className="flex-1 text-left truncate">{t('search.placeholder')}</span>
        {!api.remote && <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>}
      </button>
    </div>
  )
}
