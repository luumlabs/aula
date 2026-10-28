// Barra superior sobre el papel: atrás/adelante, título de la pantalla, acciones y el buscador (⌘K).
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, IconButton, Kbd, cx } from '@renderer/design'
import { useNav } from '../router'
import { usePalette } from './CommandPalette'
import { api } from '@renderer/lib/api'
import { SidebarToggle, useSidebarState } from './Sidebar'

export function TopBar({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  const { t } = useTranslation()
  const { back, forward, canBack, canForward } = useNav()
  const openPalette = usePalette((s) => s.open)
  const isMac = api.platform === 'darwin'
  const collapsed = useSidebarState((s) => s.collapsed)
  return (
    <div className={cx('drag relative z-10 flex h-[52px] shrink-0 items-center gap-1 px-3', !isMac && 'pr-[150px]')}>
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
        <Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
    </div>
  )
}
