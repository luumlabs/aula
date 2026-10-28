// La bandeja «Novedades» (UpdatesInboxView.swift): lo nuevo con un punto del acento y el título en negrita, agrupado por día
// (o por tipo), y al abrir una novedad, el mensaje entero con sus botones, «Responder», de dónde viene, posponer y archivar.
// Teclado: ↑↓ elegir, ↩ abrir, E archivar, U leída/no leída, H posponer 1 h.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, EmptyState, Icon, IconButton, Menu, cx, spring, type MenuItem } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import type { AssistantCard } from '@shared/assistant/types'
import type { AutomationItemView, InboxEntry } from '@shared/automations'
import { SNOOZE_PRESETS, groupByDay, groupByKind, isSnoozed, snoozeDate, visibleEntries } from '@shared/automations/inbox'
import { inboxOps, openAutomation, replyTo, runCardAction } from './actions'
import { KIND_ICONS, iconOr, rowTime, whenText } from './format'
import { useInboxUI } from './state'

export function InboxList({ entries, items, chatLinked }: { entries: InboxEntry[]; items: AutomationItemView[]; chatLinked: boolean }) {
  const { t } = useTranslation('inbox')
  const ui = useInboxUI()
  const now = Date.now()
  const visible = useMemo(() => visibleEntries(entries, { view: ui.view, filter: ui.filter, query: ui.query, now }), [entries, ui.view, ui.filter, ui.query, now])
  const groups = useMemo(
    () => (ui.byKind ? groupByKind(visible).map((g) => ({ key: g.kind, title: t(`kinds.${g.kind}`), entries: g.entries })) : groupByDay(visible, now).map((g) => ({ key: g.section, title: t(`sections.${g.section}`), entries: g.entries }))),
    [visible, ui.byKind, now, t]
  )
  const order = groups.flatMap((g) => g.entries.map((e) => e.id))
  const listRef = useRef<HTMLDivElement>(null)

  // la novedad que pidió abrir una notificación: a la vista
  useEffect(() => {
    if (!ui.selected) return
    const el = document.getElementById(`entry-${ui.selected}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ui.selected])

  const toggle = (e: InboxEntry) => {
    const open = ui.expanded === e.id
    ui.set({ selected: e.id, expanded: open ? null : e.id })
    if (!e.read && !open) inboxOps.markRead([e.id])
  }

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('input, textarea, [role="menu"]')) return
    const i = ui.selected ? order.indexOf(ui.selected) : -1
    const cur = i >= 0 ? visible.find((x) => x.id === order[i]) : undefined
    const after = i >= 0 ? order[i + 1] ?? order[i - 1] ?? null : null
    switch (ev.key) {
      case 'ArrowDown': case 'ArrowUp': {
        if (!order.length) return
        ev.preventDefault()
        const next = ev.key === 'ArrowDown' ? Math.min(order.length - 1, i + 1) : Math.max(0, (i < 0 ? order.length : i) - 1)
        ui.set({ selected: order[next] })
        return
      }
      case 'Enter':
        if (cur) { ev.preventDefault(); toggle(cur) }
        return
      case 'e': case 'E':
        if (cur) { inboxOps.archive([cur.id], !cur.archived); ui.set({ selected: after }) }
        return
      case 'u': case 'U':
        if (cur) inboxOps.markRead([cur.id], !cur.read)
        return
      case 'h': case 'H':
        if (cur) { inboxOps.snooze([cur.id], Date.now() + 3_600_000); ui.set({ selected: after }) }
        return
    }
  }

  if (!visible.length) return <InboxEmpty filtered={ui.filter !== 'all' || !!ui.query} />

  return (
    <div ref={listRef} tabIndex={0} onKeyDown={onKey} className="flex flex-col gap-5 outline-none" aria-label={t('title')}>
      {groups.map((g, gi) => {
        const unread = g.entries.filter((e) => !e.read).length
        return (
          <motion.section key={g.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: gi * 0.05 }}>
            <h3 className="flex items-baseline gap-1.5 px-1 mb-2">
              <span className="t-ui font-semibold text-text2">{g.title}</span>
              {unread > 0 && <span className="t-ui text-text3">· {t('sections.unread', { count: unread })}</span>}
            </h3>
            <Card padded={false} className="overflow-hidden">
              {g.entries.map((e, i) => (
                <EntryRow key={e.id} entry={e} index={i} items={items} chatLinked={chatLinked} selected={ui.selected === e.id} expanded={ui.expanded === e.id} onToggle={() => toggle(e)} />
              ))}
            </Card>
          </motion.section>
        )
      })}
    </div>
  )
}

// MARK: Una novedad

function meta(t: (k: string) => string, e: InboxEntry): string[] {
  const parts = e.kind === 'problem' ? [] : [t(`kinds.${e.kind}`)]
  if (e.course) parts.push(e.course)
  if (e.source && !e.source.startsWith(t(`kinds.${e.kind}`))) parts.push(e.source)
  return parts
}

function EntryRow({ entry: e, index, items, chatLinked, selected, expanded, onToggle }: { entry: InboxEntry; index: number; items: AutomationItemView[]; chatLinked: boolean; selected: boolean; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation('inbox')
  const unread = !e.read && !e.archived
  const urgent = e.priority === 2 && unread && e.kind === 'reminder'
  return (
    <motion.div
      id={`entry-${e.id}`}
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 10) * 0.03 }}
      className={cx(
        'group/entry relative',
        'before:absolute before:top-0 before:right-0 before:left-[82px] before:h-[0.5px] before:bg-line-soft first:before:hidden',
        selected && !expanded && 'bg-selected',
        expanded && 'bg-fill1/60'
      )}
    >
      <button onClick={onToggle} aria-expanded={expanded} className={cx('w-full flex items-start gap-3 pl-3.5 pr-4 py-3 text-left outline-none transition-colors', !expanded && 'hover:bg-fill1')}>
        <span aria-hidden className={cx('mt-[13px] w-2 h-2 rounded-full shrink-0 transition-colors', unread ? 'bg-accent' : 'bg-transparent')} />
        <KindTile entry={e} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-3">
            <span className={cx('t-callout text-text min-w-0', expanded ? 'whitespace-normal' : 'truncate', unread ? 'font-semibold' : 'font-normal')}>
              {unread && <span className="sr-only">{t('filters.unread')}. </span>}
              {e.title}
            </span>
            <span className="ml-auto t-caption tabular text-text3 shrink-0 group-hover/entry:opacity-0 transition-opacity">{rowTime(t, e.date)}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="t-footnote text-text3 truncate">{meta(t, e).join(' · ')}</span>
            {e.kind === 'problem' && <Badge tone="warning" icon="alert">{t('kinds.problem')}</Badge>}
            {urgent && <Badge tone="warning">{t('badges.dueSoon')}</Badge>}
            {e.resurfaced && unread && <Badge tone="neutral" icon="clock">{t('badges.resurfaced')}</Badge>}
            {e.snoozedUntil && isSnoozed(e, Date.now()) && <Badge tone="neutral" icon="clock">{t('badges.back', { when: whenText(t, e.snoozedUntil) })}</Badge>}
          </span>
          {!expanded && e.preview && e.preview !== e.title && <span className={cx('block t-ui truncate mt-1', unread ? 'text-text2' : 'text-text3')}>{e.preview}</span>}
        </span>
      </button>
      {!expanded && <QuickActions entry={e} />}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div key="detail" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="overflow-hidden">
            <EntryDetail entry={e} items={items} chatLinked={chatLinked} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function KindTile({ entry: e }: { entry: InboxEntry }) {
  const tone = e.kind === 'problem' ? 'text-warning bg-warning-soft' : e.priority === 2 && !e.read ? 'text-accent-text bg-accent-wash' : 'text-text2 bg-fill2'
  return (
    <span className={cx('mt-0.5 grid place-items-center w-9 h-9 rounded-[11px] shrink-0', tone)}>
      <Icon name={KIND_ICONS[e.kind]} size={18} />
    </span>
  )
}

function Badge({ tone, icon, children }: { tone: 'warning' | 'neutral' | 'info'; icon?: 'alert' | 'clock'; children: React.ReactNode }) {
  const look = tone === 'warning' ? 'bg-warning-soft text-warning' : tone === 'info' ? 'bg-info-soft text-info' : 'bg-fill2 text-text2'
  return (
    <span className={cx('inline-flex items-center gap-1 h-5 px-1.5 rounded-full t-caption font-medium whitespace-nowrap', look)}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  )
}

/** Al pasar el ratón: leída · posponer · archivar (encima de la hora: la fila no cambia de alto). */
function QuickActions({ entry: e }: { entry: InboxEntry }) {
  const { t } = useTranslation('inbox')
  return (
    <div className="absolute right-3 top-2 flex items-center gap-0.5 rounded-[10px] bg-surface/95 shadow-[var(--e1)] px-0.5 opacity-0 pointer-events-none group-hover/entry:opacity-100 group-hover/entry:pointer-events-auto group-focus-within/entry:opacity-100 group-focus-within/entry:pointer-events-auto transition-opacity">
      <IconButton size="sm" label={e.read ? t('actions.markUnread') : t('actions.markRead')} onClick={() => inboxOps.markRead([e.id], !e.read)}>
        <Icon name={e.read ? 'bell' : 'check'} size={15} />
      </IconButton>
      <SnoozeMenu entry={e} compact />
      <IconButton size="sm" label={e.archived ? t('actions.unarchive') : t('actions.archive')} onClick={() => inboxOps.archive([e.id], !e.archived)}>
        <Icon name={e.archived ? 'upload' : 'archive'} size={15} />
      </IconButton>
    </div>
  )
}

export function SnoozeMenu({ entry: e, compact }: { entry: InboxEntry; compact?: boolean }) {
  const { t } = useTranslation('inbox')
  const now = Date.now()
  const items: MenuItem[] = SNOOZE_PRESETS.flatMap((p) => {
    const d = snoozeDate(p, now)
    return d === null ? [] : [{ label: <span className="flex w-full justify-between gap-6"><span>{t(`snooze.${p}`)}</span><span className="text-text3 tabular">{whenText(t, new Date(d).toISOString())}</span></span>, onSelect: () => inboxOps.snooze([e.id], d) }]
  })
  if (e.snoozedUntil) items.push({ label: t('actions.unsnooze'), separatorBefore: true, onSelect: () => inboxOps.snooze([e.id], null) })
  return (
    <Menu
      align="end"
      items={items}
      trigger={(open) =>
        compact ? (
          <IconButton size="sm" label={t('actions.snooze')} onClick={open}>
            <Icon name="clock" size={15} />
          </IconButton>
        ) : (
          <Button size="sm" variant="ghost" icon={<Icon name="clock" size={14} />} onClick={open}>
            {t('actions.snooze')}
          </Button>
        )
      }
    />
  )
}

// MARK: Abierta

function EntryDetail({ entry: e, items, chatLinked }: { entry: InboxEntry; items: AutomationItemView[]; chatLinked: boolean }) {
  const { t } = useTranslation('inbox')
  const [why, setWhy] = useState(false)
  const msg = e.message
  const item = e.automationID ? items.find((i) => i.automation.id === e.automationID) : undefined
  const cards = (msg?.cards ?? []).filter((c) => c.state !== 'done' || c.actions.length === 0)
  const cardsOpenAutomation = cards.some((c) => c.actions.some((a) => a.kind === 'openAutomation'))
  return (
    <div className="pl-[82px] pr-5 pb-4 flex flex-col gap-3">
      {msg?.notices.map((n, i) => <p key={i} className="t-footnote text-text2">{n}</p>)}
      {msg ? <RichText text={msg.text} className="t-body text-text" /> : <p className="t-body text-text">{e.preview}</p>}
      {cards.map((c, i) => <MessageCard key={c.id} card={c} entry={e} primary={i === 0} />)}
      {why && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="t-ui text-text2 rounded-[12px] bg-fill1 px-3 py-2.5 flex items-start gap-2">
          <Icon name="info" size={15} className="mt-0.5 text-text3 shrink-0" />
          <span>{whyText(t, e, item?.automation.title)}</span>
        </motion.p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" variant={cards.some((c) => c.actions.some((a) => a.prominent)) ? 'ghost' : 'secondary'} icon={<Icon name="chat" size={14} />} onClick={() => replyTo(e, chatLinked)}>
          {t('actions.reply')}
        </Button>
        {item && !cardsOpenAutomation && (
          <Button size="sm" variant="ghost" onClick={() => openAutomation(item.automation.id)}>
            {item.automation.routine ? t('actions.openRoutine') : t('actions.openAutomation')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
          {t('actions.why')}
        </Button>
        {item && item.automation.enabled && e.kind !== 'problem' && why && (
          <Button size="sm" variant="ghost" onClick={() => inboxOps.setEnabled(item.automation.id, false)}>
            {item.automation.routine ? t('actions.pauseRoutine') : t('actions.pauseThis')}
          </Button>
        )}
        <span className="flex-1" />
        <SnoozeMenu entry={e} />
        <Button size="sm" variant="ghost" icon={<Icon name="archive" size={14} />} onClick={() => inboxOps.archive([e.id], !e.archived)}>
          {e.archived ? t('actions.unarchive') : t('actions.archive')}
        </Button>
      </div>
      {!chatLinked && msg && <p className="t-caption text-text3">{t('detail.onlyHere')}</p>}
    </div>
  )
}

function whyText(t: (k: string, o?: Record<string, unknown>) => string, e: InboxEntry, name: string | undefined): string {
  switch (e.kind) {
    case 'platform': return name ? t('why.platformNamed', { name }) : t('why.platform')
    case 'automation': return name ? t('why.automationNamed', { name }) : t('why.automation')
    case 'reminder': case 'summary': case 'offer': case 'followup': case 'problem': return t(`why.${e.kind}`)
    default: return t('why.system')
  }
}

/** Una tarjeta del mensaje: título, datos y sus botones (el destacado de la primera, en ladrillo). */
function MessageCard({ card, entry, primary }: { card: AssistantCard; entry: InboxEntry; primary: boolean }) {
  return (
    <div className="rounded-[16px] bg-sunken border-[0.5px] border-line-soft px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <Icon name={iconOr(card.icon, KIND_ICONS[entry.kind])} size={16} className="text-text2 shrink-0" />
        <span className="t-callout font-semibold text-text min-w-0">{card.title}</span>
      </div>
      {card.detail && <p className="t-ui text-text2 mt-1.5">{card.detail}</p>}
      {card.facts.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {card.facts.map((f, i) => (
            <div key={i} className="contents">
              <dt className="t-ui text-text3">{f.label}</dt>
              <dd className="t-ui text-text min-w-0">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.actions.map((a) => (
            <Button key={a.id} size="sm" variant={a.prominent ? (primary ? 'primary' : 'secondary') : 'ghost'} icon={a.symbol ? <Icon name={iconOr(a.symbol, 'arrow-right')} size={14} /> : undefined} onClick={() => runCardAction(a, entry)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function InboxEmpty({ filtered }: { filtered: boolean }) {
  const { t } = useTranslation('inbox')
  const ui = useInboxUI()
  if (ui.view === 'snoozed') return <EmptyState className="py-16" icon={<Icon name="clock" size={30} />} title={t('empty.snoozedTitle')} body={t('empty.snoozedBody')} />
  if (ui.view === 'archived') return <EmptyState className="py-16" icon={<Icon name="archive" size={30} />} title={t('empty.archivedTitle')} body={t('empty.archivedBody')} />
  if (filtered) {
    return (
      <EmptyState className="py-16" icon={<Icon name="inbox" size={30} />} title={t('empty.filteredTitle')} body={t('empty.filteredBody')}
        action={<Button size="sm" onClick={() => ui.set({ filter: 'all', query: '' })}>{t('empty.showAll')}</Button>} />
    )
  }
  return <EmptyState className="py-16" title={t('empty.title')} body={t('empty.body')} />
}
