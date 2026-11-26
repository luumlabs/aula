import { useTranslation } from 'react-i18next'
import { AulaMark, cx, Icon, IconButton, Menu, type IconName } from '@renderer/design'
import { useAulaMarkState } from '@renderer/screens/chat/liveStatus'
import { navigate, useNav, type Route } from '../router'
import { TABS } from './CompactTabs'
import { tabOwner } from './tabs'
import { useInboxCount } from './inboxCount'

export function EditorialPlaces() {
  const { t } = useTranslation()
  const active = useNav((s) => tabOwner(s.stack, s.index))
  const mark = useAulaMarkState()
  return (
    <nav aria-label="Aula" className="no-drag flex shrink-0 items-stretch gap-1">
      {TABS.map(({ route, label, icon }) => (
        <button type="button" key={route.name} aria-current={active === route.name ? 'page' : undefined}
          onClick={() => navigate(route)}
          className={cx('t-ui flex min-h-11 items-center gap-1.5 border-b-2 px-2 font-medium focus-visible:outline-offset-[-2px]',
            active === route.name ? 'border-accent text-accent-text' : 'border-transparent text-text2 hover:text-text')}>
          {route.name === 'chat' ? <AulaMark size={17} state={mark} /> : <Icon name={icon} size={17} />}
          {t(label)}
        </button>
      ))}
    </nav>
  )
}

const DESTINATIONS: { route: Route; icon: IconName; label: string }[] = [
  { route: { name: 'inbox' }, icon: 'inbox', label: 'nav.inbox' },
  { route: { name: 'documents' }, icon: 'file-text', label: 'nav.documents' },
  { route: { name: 'tools' }, icon: 'code', label: 'nav.tools' },
  { route: { name: 'stats' }, icon: 'chart', label: 'nav.stats' },
  { route: { name: 'settings' }, icon: 'settings', label: 'nav.settings' }
]

export function EditorialMore({ compact, sidebarOpen, toggleSidebar }: { compact?: boolean; sidebarOpen?: boolean; toggleSidebar?: () => void }) {
  const { t } = useTranslation()
  const unread = useInboxCount()
  return (
    <Menu items={[...DESTINATIONS.map(({ route, icon, label }) => ({
      label: `${t(label)}${route.name === 'inbox' && unread ? ` (${unread > 99 ? '99+' : unread})` : ''}`,
      icon: <Icon name={icon} size={16} />,
      onSelect: () => navigate(route)
    })), ...(toggleSidebar ? [{
      label: t(sidebarOpen ? 'nav.collapse' : 'nav.expand'),
      icon: <Icon name="inspector" size={16} />,
      separatorBefore: true,
      onSelect: toggleSidebar
    }] : [])]} trigger={(open, expanded) => (
      <IconButton className="no-drag" label={t('actions.more')} size={compact ? 'lg' : 'sm'} onClick={open} aria-haspopup="menu" aria-expanded={expanded}>
        <span aria-hidden="true" className="relative text-lg leading-none">···{unread > 0 && <span className="absolute -right-1 top-0 size-1.5 rounded-full bg-accent" />}</span>
      </IconButton>
    )} />
  )
}
