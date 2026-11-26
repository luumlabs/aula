// Navegación editorial de Aula: cuatro lugares en serif centrados sobre el papel (Hoy, Aula, Cursos, Calendario)
// con subrayado de pincel en tinta y ladrillo; el resto de destinos y la barra lateral opcional quedan en «Más secciones».
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
    <nav aria-label="Aula" className="no-drag flex shrink-0 items-center gap-1">
      {TABS.map(({ route, label, icon }) => {
        const on = active === route.name
        return (
          <button
            type="button"
            key={route.name}
            aria-current={on ? 'page' : undefined}
            onClick={() => navigate(route)}
            className={cx(
              'aula-place relative flex h-9 items-center gap-1.5 rounded-full px-3.5 font-serif text-[calc(15rem/15)] leading-none transition-colors focus-visible:outline-offset-2',
              on ? 'text-text' : 'text-text2 hover:bg-fill1 hover:text-text'
            )}
          >
            <span className={cx('flex items-center', on ? 'text-text' : 'text-text2')}>
              {route.name === 'chat' ? <AulaMark size={18} state={mark} /> : <Icon name={icon} size={17} />}
            </span>
            <span>{t(label)}</span>
            <span aria-hidden className={cx('aula-place-mark', on && 'is-on')} />
          </button>
        )
      })}
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
    <Menu
      items={[
        ...DESTINATIONS.map(({ route, icon, label }) => ({
          label: `${t(label)}${route.name === 'inbox' && unread ? ` (${unread > 99 ? '99+' : unread})` : ''}`,
          icon: <Icon name={icon} size={16} />,
          onSelect: () => navigate(route)
        })),
        ...(toggleSidebar
          ? [
              {
                label: t(sidebarOpen ? 'nav.collapse' : 'nav.expand'),
                icon: <Icon name="inspector" size={16} />,
                separatorBefore: true,
                onSelect: toggleSidebar
              }
            ]
          : [])
      ]}
      trigger={(open, expanded) => (
        <IconButton className="no-drag" label={t('nav.moreMenu')} size={compact ? 'lg' : 'sm'} onClick={open} aria-haspopup="menu" aria-expanded={expanded}>
          <span aria-hidden className="relative flex items-center justify-center">
            <Icon name="more" size={compact ? 20 : 17} />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />}
          </span>
        </IconButton>
      )}
    />
  )
}
