// «Novedades»: lo que Aula hizo sola (resúmenes, recordatorios, lo nuevo de tu plataforma, seguimientos, avisos), agrupado por
// día con filtros por tipo, y la pestaña «Automatizaciones» con las del estudiante y su editor. A la derecha, «Aula siempre
// activa» (estado, rutinas, uso de hoy) y lo próximo que hará, en una tarjeta que flota.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Chip, EmptyState, Icon, IconButton, Menu, SegmentedTabs, TextField, cx } from '@renderer/design'
import { useCompact } from '@renderer/app/shell/CompactTabs'
import { useScreenTitle } from '@renderer/app/title'
import { useRpc, useRpcEvent } from '@renderer/lib/useRpc'
import { useSettings } from '@renderer/lib/settings'
import { INBOX_KIND_ORDER, isSnoozed, matchesView, needsYou, type InboxEntry } from '@shared/automations'
import { AutomationEditor } from './AutomationEditor'
import { AutomationsPanel } from './AutomationsPanel'
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
  // la línea de arriba dice solo lo que importa: cuánto hay sin leer y cuánto pide algo de ti
  const attention = entries.filter((e) => needsYou(e) && matchesView(e, 'open', Date.now())).length
  const summary = unread === 0 && attention === 0 ? t('subtitle.allRead') : [unread > 0 ? t('subtitle.unread', { count: unread }) : '', attention > 0 ? t('subtitle.attention', { count: attention }) : ''].filter(Boolean).join(' · ')
  // en el teléfono: primero el interruptor de «Aula siempre activa» con lo próximo que hará, y debajo las novedades
  const phone = useCompact()
  const tabs = (
    <SegmentedTabs value={ui.tab} onChange={(tab) => ui.set({ tab })} items={[
      { id: 'inbox', label: t('tabs.inbox'), icon: <Icon name="inbox" size={14} />, ...(unread ? { badge: unread } : {}) },
      { id: 'automations', label: t('tabs.automations'), icon: <Icon name="repeat" size={14} /> }
    ]} />
  )

  return (
    <div className={cx('@container flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-1 pb-24', phone ? 'px-4' : 'px-6')}>
      {phone ? (
        <div className="flex flex-col gap-3 pt-1">
          {snap.data ? <ProactiveCard snapshot={snap.data} compact /> : <div className="h-[104px] skeleton rounded-[22px]" />}
          <div className="self-start">{tabs}</div>
        </div>
      ) : (
      <motion.header initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36 }} className="flex items-end justify-between gap-4 flex-wrap pt-3">
        <div className="flex items-center gap-4 min-w-0">
          <span className="grid place-items-center w-14 h-14 rounded-[16px] bg-surface border-[0.5px] border-line shadow-[var(--e1)] shrink-0">
            <PixelEnvelope lit={unread > 0} size={40} />
          </span>
          <div className="min-w-0">
            <h1 className="t-title1 text-text">{t('title')}</h1>
            <p className="t-ui text-text2 mt-0.5">{summary}</p>
          </div>
        </div>
        {tabs}
      </motion.header>
      )}

      <div className={cx('grid grid-cols-12 gap-4', phone ? 'mt-3' : 'mt-6')}>
        <main className="col-span-12 @5xl:col-span-8 flex flex-col gap-4 min-w-0">
          {ui.tab === 'inbox' ? (
            inbox.error && !inbox.data ? (
              <EmptyState mark="offline" title={t('error.title')} body={inbox.error.message} action={<Button onClick={() => void inbox.reload()}>{t('error.retry')}</Button>} />
            ) : !inbox.data ? (
              <ListSkeleton />
            ) : (
              <>
                <Toolbar entries={entries} unread={unread} phone={phone} />
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
              {!phone && <ProactiveCard snapshot={snap.data} />}
              <UpNextCard snapshot={snap.data} />
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

/**
 * Una sola fila: Todo · Sin leer · Te necesita, y a la derecha la lupa, «Marcar todo como leído» y un menú con lo que se usa
 * poco (pospuestas, archivadas, ver solo un tipo, agrupar). Si se está viendo otra cosa que lo abierto, una etiqueta lo dice
 * y vuelve con un toque.
 */
function Toolbar({ entries, unread }: { entries: InboxEntry[]; unread: number; phone?: boolean }) {
  const { t } = useTranslation('inbox')
  const ui = useInboxUI()
  const [searching, setSearching] = useState(false)
  const now = Date.now()
  const open = entries.filter((e) => matchesView(e, 'open', now))
  const inView = entries.filter((e) => matchesView(e, ui.view, now))
  const snoozed = entries.filter((e) => !e.archived && isSnoozed(e, now)).length
  const attention = open.filter(needsYou).length
  const kinds = INBOX_KIND_ORDER.filter((k) => inView.some((e) => e.kind === k))
  const main = ui.filter === 'all' || ui.filter === 'unread' || ui.filter === 'attention'
  // lo que se ve cuando no es «lo abierto, todo»: una vista (pospuestas, archivadas) o un solo tipo
  const special = ui.view !== 'open' ? t(`views.${ui.view}`) : !main ? t(`kinds.${ui.filter}`) : null
  const reset = (): void => ui.set({ view: 'open', filter: 'all', expanded: null })
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ui.view === 'open' && (
        <SegmentedTabs size="sm" value={main ? ui.filter : 'all'} onChange={(filter) => ui.set({ filter, expanded: null })} items={[
          { id: 'all', label: t('filters.all') },
          { id: 'unread', label: t('filters.unread'), ...(unread ? { badge: unread } : {}) },
          { id: 'attention', label: t('filters.attention'), ...(attention ? { badge: attention } : {}) }
        ]} />
      )}
      {special && (
        <Chip active icon={<Icon name="close" size={12} />} onClick={reset}>
          <span className="sr-only">{t('actions.clearFilter')}: </span>{special}
        </Chip>
      )}
      <span className="flex-1" />
      {searching || ui.query ? (
        <div className="w-[220px] max-w-full">
          <TextField autoFocus icon={<Icon name="search" size={14} />} placeholder={t('actions.search')} aria-label={t('actions.search')} value={ui.query} onChange={(e) => ui.set({ query: e.target.value })} onBlur={() => { if (!ui.query) setSearching(false) }} className="h-8! text-[13px]!" />
        </div>
      ) : (
        <IconButton size="sm" label={t('actions.searchOpen')} onClick={() => setSearching(true)}><Icon name="search" size={15} /></IconButton>
      )}
      {unread > 0 && ui.view === 'open' && <Button size="sm" variant="ghost" icon={<Icon name="check" size={14} />} onClick={inboxOps.markAllRead}>{t('actions.markAllRead')}</Button>}
      <Menu align="end" items={[
        ...(ui.view === 'open'
          ? [{ label: snoozed ? `${t('actions.showSnoozed')} (${snoozed})` : t('actions.showSnoozed'), icon: <Icon name="clock" size={14} />, onSelect: () => ui.set({ view: 'snoozed' as const, filter: 'all' as const, expanded: null }) }]
          : [{ label: t('actions.showOpen'), icon: <Icon name="inbox" size={14} />, onSelect: reset }]),
        ...(ui.view !== 'archived' ? [{ label: t('actions.showArchived'), icon: <Icon name="archive" size={14} />, onSelect: () => ui.set({ view: 'archived' as const, filter: 'all' as const, expanded: null }) }] : []),
        ...kinds.map((k, i) => ({ label: t('actions.only', { kind: t(`kinds.${k}`) }), icon: <Icon name={KIND_ICONS[k]} size={14} />, separatorBefore: i === 0, onSelect: () => ui.set({ filter: k, expanded: null }) })),
        { label: ui.byKind ? t('actions.groupByDay') : t('actions.groupByKind'), icon: <Icon name="layers" size={14} />, separatorBefore: true, onSelect: () => ui.set({ byKind: !ui.byKind }) },
        { label: t('actions.clearRead'), icon: <Icon name="archive" size={14} />, onSelect: inboxOps.archiveRead }
      ]} trigger={(openMenu) => <IconButton size="sm" label={t('actions.more')} onClick={openMenu}><Icon name="more" size={16} /></IconButton>} />
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
