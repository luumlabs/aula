// Aula en una pantalla estrecha (el iPhone del estudiante, a distancia): sin barra lateral, con cuatro pestañas abajo. Allí
// Aula es sobre todo su asistente: qué hizo por ti, qué hay pendiente, hablar con ella y el calendario; los cursos se
// estudian mejor en el iPad o en el Mac, pero «Hoy» los deja a un toque.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cx, Icon, type IconName } from '@renderer/design'
import { navigate, useNav, type Route } from '../router'
import { useInboxCount } from './inboxCount'

/** ¿La ventana es estrecha como un teléfono? (se entera si cambia: girar el dispositivo, partir la pantalla del iPad). */
export function useCompact(): boolean {
  const query = '(max-width: 700px)'
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = (): void => setCompact(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return compact
}

const TABS: ReadonlyArray<{ route: Route; icon: IconName; label: string }> = [
  { route: { name: 'inbox' }, icon: 'inbox', label: 'nav.inbox' },
  { route: { name: 'chat' }, icon: 'tutor', label: 'nav.chat' },
  { route: { name: 'calendar' }, icon: 'calendar', label: 'nav.calendar' },
  { route: { name: 'home' }, icon: 'today', label: 'nav.home' }
]

export function CompactTabs() {
  const { t } = useTranslation()
  const current = useNav((s) => s.route.name)
  const unread = useInboxCount()
  return (
    <nav aria-label="Aula" className="shrink-0 border-t-[0.5px] border-line bg-surface" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="m-0 flex list-none items-stretch p-0">
        {TABS.map((tab) => {
          const on = current === tab.route.name
          return (
            <li key={tab.route.name} className="flex-1">
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => navigate(tab.route)}
                className={cx('relative flex h-[56px] w-full flex-col items-center justify-center gap-0.5 outline-none focus-visible:bg-fill1', on ? 'text-accent-text' : 'text-text3')}
              >
                <span className="relative">
                  <Icon name={tab.icon} size={22} />
                  {tab.route.name === 'inbox' && unread > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold leading-none text-on-accent">{unread > 99 ? '99+' : unread}</span>
                  )}
                </span>
                <span className="text-[10.5px] font-medium leading-none">{t(tab.label)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
