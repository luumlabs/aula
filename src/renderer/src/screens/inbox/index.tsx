// «Novedades»: lo que Aula hizo sola (resúmenes, recordatorios, lo nuevo de tu plataforma, seguimientos, avisos), agrupado por
// día con filtros por tipo, y la pestaña «Automatizaciones» con las del estudiante y su editor. A la derecha, «Aula siempre
// activa» (estado, rutinas, uso de hoy) y lo próximo que hará, en una tarjeta que flota.
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Chip, EmptyState, Icon, IconButton, Menu, SegmentedTabs, TextField } from '@renderer/design'
import { useScreenTitle } from '@renderer/app/title'
import { useRpc, useRpcEvent } from '@renderer/lib/useRpc'
import { useSettings } from '@renderer/lib/settings'
import { INBOX_KIND_ORDER, isSnoozed, matchesView, type InboxEntry } from '@shared/automations'
import { AutomationEditor } from './AutomationEditor'
import { AutomationsMini, AutomationsPanel } from './AutomationsPanel'
import { InboxList } from './InboxList'
import { PixelEnvelope } from './PixelEnvelope'
import { ProactiveCard, UpNextCard } from './ProactiveCard'
import { inboxOps } from './actions'
import { KIND_ICONS } from './format'
import { useInboxUI } from './state'

export default function InboxScreen() {
  const { t } = useTranslation('inbox')
  useScreenTitle(t('title'))
  const ui = useInboxUI()
  const inbox = useRpc('automations.inbox', undefined, { events: ['automations.inboxChanged', 'automations.changed'] })
  const snap = useRpc('automations.snapshot', undefined, { events: ['automations.changed', 'settings.changed', 'calendar.changed'] })
  const settingsLoaded = useSettings((s) => !!s.settings)
  const loadSettings = useSettings((s) => s.load)
  useEffect(() => { if (!settingsLoaded) void loadSettings().catch(() => undefined) }, [settingsLoaded, loadSettings])

  // la novedad que pidió abrir una notificación
  const focus = inbox.data?.focus
  useEffect(() => {
    if (focus) useInboxUI.getState().set({ tab: 'inbox', view: 'open', filter: 'all', query: '', selected: focus, expanded: focus })
  }, [focus])
  useRpcEvent('automations.open', (p) => {
    const s = useInboxUI.getState()
    if (p.entryId) s.set({ tab: 'inbox', view: 'open', filter: 'all', query: '', selected: p.entryId, expanded: p.entryId })
    else if (p.automationId) s.set({ tab: 'automations', history: p.automationId })
    else if (p.tab) s.set({ tab: p.tab })
    void inbox.reload()
  })

  const entries = useMemo(() => inbox.data?.entries ?? [], [inbox.data])
  const unread = inbox.data?.unread ?? 0
  const items = snap.data?.items ?? []

  return (
    <div className="@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-1 pb-24">
      <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36 }} className="flex items-end justify-between gap-4 flex-wrap pt-3">
        <div className="flex items-center gap-4 min-w-0">
          <span className="grid place-items-center w-14 h-14 rounded-[16px] bg-surface border-[0.5px] border-line shadow-[var(--e1)] shrink-0">
            <PixelEnvelope lit={unread > 0} size={40} />
          </span>
          <div className="min-w-0">
            <h1 className="t-title1 text-text">{t('title')}</h1>
            <p className="t-ui text-text2 mt-0.5">{unread > 0 ? `${t('subtitle.unread', { count: unread })} · ${t('subtitle.what')}` : t('subtitle.allRead')}</p>
          </div>
        </div>
        <SegmentedTabs value={ui.tab} onChange={(tab) => ui.set({ tab })} items={[
          { id: 'inbox', label: t('tabs.inbox'), icon: <Icon name="inbox" size={14} />, ...(unread ? { badge: unread } : {}) },
          { id: 'automations', label: t('tabs.automations'), icon: <Icon name="repeat" size={14} /> }
        ]} />
      </motion.header>

      <div className="grid grid-cols-12 gap-4 mt-6">
        <main className="col-span-12 @5xl:col-span-8 flex flex-col gap-4 min-w-0">
          {ui.tab === 'inbox' ? (
            inbox.error && !inbox.data ? (
              <EmptyState mark="offline" title={t('error.title')} body={inbox.error.message} action={<Button onClick={() => void inbox.reload()}>{t('error.retry')}</Button>} />
            ) : !inbox.data ? (
              <ListSkeleton />
            ) : (
              <>
                <Toolbar entries={entries} unread={unread} />
                <InboxList entries={entries} items={items} chatLinked={snap.data?.chatLinked ?? false} />
              </>
            )
          ) : (
            <AutomationsPanel items={items} />
          )}
        </main>
        <aside className="col-span-12 @5xl:col-span-4 flex flex-col gap-4">
          {snap.data ? (
            <>
              <ProactiveCard snapshot={snap.data} />
              <UpNextCard snapshot={snap.data} />
              {ui.tab === 'inbox' && <AutomationsMini items={items} />}
            </>
          ) : (
            <div className="h-[340px] skeleton rounded-[22px]" />
          )}
        </aside>
      </div>
      <AutomationEditor />
    </div>
  )
}

/** Abiertas · Pospuestas · Archivadas, los tipos (con lo no leído de cada uno), la búsqueda y «Marcar todo como leído». */
function Toolbar({ entries, unread }: { entries: InboxEntry[]; unread: number }) {
  const { t } = useTranslation('inbox')
  const ui = useInboxUI()
  const now = Date.now()
  const inView = entries.filter((e) => matchesView(e, ui.view, now))
  const snoozed = entries.filter((e) => !e.archived && isSnoozed(e, now)).length
  const kinds = INBOX_KIND_ORDER.filter((k) => inView.some((e) => e.kind === k))
  const unreadOf = (k?: string) => inView.filter((e) => !e.read && (!k || e.kind === k)).length
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs size="sm" value={ui.view} onChange={(view) => ui.set({ view, filter: 'all', expanded: null })} items={[
          { id: 'open', label: t('views.open') },
          { id: 'snoozed', label: t('views.snoozed'), ...(snoozed ? { badge: snoozed } : {}) },
          { id: 'archived', label: t('views.archived') }
        ]} />
        <span className="flex-1" />
        <div className="w-[220px] max-w-full">
          <TextField icon={<Icon name="search" size={14} />} placeholder={t('actions.search')} aria-label={t('actions.search')} value={ui.query} onChange={(e) => ui.set({ query: e.target.value })} className="h-8! text-[13px]!" />
        </div>
        {unread > 0 && ui.view === 'open' && <Button size="sm" variant="ghost" icon={<Icon name="check" size={14} />} onClick={inboxOps.markAllRead}>{t('actions.markAllRead')}</Button>}
        <Menu align="end" items={[
          { label: ui.byKind ? t('actions.groupByDay') : t('actions.groupByKind'), icon: <Icon name="layers" size={14} />, onSelect: () => ui.set({ byKind: !ui.byKind }) },
          { label: t('actions.clearRead'), icon: <Icon name="archive" size={14} />, onSelect: inboxOps.archiveRead }
        ]} trigger={(open) => <IconButton size="sm" label={t('actions.more')} onClick={open}><Icon name="more" size={16} /></IconButton>} />
      </div>
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filters.label')}>
          <Chip active={ui.filter === 'all'} onClick={() => ui.set({ filter: 'all' })}>{t('filters.all')}</Chip>
          {ui.view === 'open' && unreadOf() > 0 && <Chip active={ui.filter === 'unread'} onClick={() => ui.set({ filter: 'unread' })}>{t('filters.unread')} <span className="tabular opacity-70">{unreadOf()}</span></Chip>}
          {kinds.map((k) => (
            <Chip key={k} active={ui.filter === k} icon={<Icon name={KIND_ICONS[k]} size={12} />} onClick={() => ui.set({ filter: ui.filter === k ? 'all' : k })}>
              {t(`kinds.${k}`)}{unreadOf(k) > 0 && <span className="tabular opacity-70">{unreadOf(k)}</span>}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-2/3 skeleton rounded-full" />
      <div className="h-[260px] skeleton rounded-[22px]" />
      <div className="h-[160px] skeleton rounded-[22px]" />
    </div>
  )
}
