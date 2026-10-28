// «Automatizaciones» (AutomationsView.swift): las del estudiante y los seguimientos de Aula como tarjetas con su horario, la
// próxima vez y, solo si pide algo, el último resultado en una palabra; «Ejecutar ahora», editar, pausar, borrar y el
// historial (en un panel lateral). Sin ninguna, qué hace esta parte y ejemplos que abren el editor ya rellenos.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button, Card, ConfirmDialog, Drawer, Icon, IconButton, Menu, AulaMark, Spinner, Stagger, StaggerItem, Switch, cx } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { useRpc } from '@renderer/lib/useRpc'
import { defaultSchedule, type AutomationItemView, type AutomationRun, type AutomationSchedule } from '@shared/automations'
import { inboxOps } from './actions'
import { blankDraft } from './AutomationEditor'
import { iconOr, outcomeTone, scheduleSummary, whenText } from './format'
import { useInboxUI } from './state'

/** El editor relleno a partir de un ejemplo. */
function exampleSchedule(i: number): AutomationSchedule {
  switch (i) {
    case 0: return { ...defaultSchedule('daily'), times: ['08:00'] }
    case 1: return { ...defaultSchedule('interval'), everyHours: 7 }
    case 2: return { ...defaultSchedule('beforeEvents'), hoursBefore: [24, 2] }
    default: return { ...defaultSchedule('daily'), times: ['18:00'], weekdays: [6] }
  }
}

export function AutomationsPanel({ items }: { items: AutomationItemView[] }) {
  const { t } = useTranslation('inbox')
  const set = useInboxUI((s) => s.set)
  const mine = items.filter((i) => !i.automation.routine)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="t-title2 text-text">{t('automations.yours')}</h2>
          {mine.length > 0 && <p className="t-footnote mt-0.5">{t('automations.count', { count: mine.length })}</p>}
        </div>
        <Button variant="primary" icon={<Icon name="plus" size={15} />} onClick={() => set({ editing: blankDraft() })}>{t('automations.new')}</Button>
      </div>
      {mine.length === 0 ? <Overview /> : (
        <Stagger className="grid grid-cols-1 @3xl:grid-cols-2 gap-4" gap={0.05}>
          {mine.map((i) => <StaggerItem key={i.automation.id}><AutomationCard item={i} /></StaggerItem>)}
        </Stagger>
      )}
      {mine.length > 0 && <RecentActivity items={items} />}
      <HistoryDrawer items={items} />
    </div>
  )
}

/** Lo último que hizo Aula sola (de todas las automatizaciones y rutinas). */
function RecentActivity({ items }: { items: AutomationItemView[] }) {
  const { t } = useTranslation('inbox')
  const set = useInboxUI((s) => s.set)
  const { data: runs } = useRpc('automations.runs', { limit: 8 }, { events: ['automations.changed'] })
  if (!runs?.length) return null
  return (
    <Card padded="lg">
      <h3 className="t-title2 text-text">{t('automations.recent')}</h3>
      <div className="flex flex-col mt-2">
        {runs.map((r, i) => {
          const tone = outcomeTone(r.outcome) ?? 'var(--text3)'
          const item = items.find((x) => x.automation.id === r.automationID)
          const first = (r.summary || r.error || '').split('\n').find((l) => l.trim())?.replace(/\*\*/g, '') ?? ''
          return (
            <motion.button key={r.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: i * 0.04 }}
              onClick={() => item && set({ history: item.automation.id })} className="flex items-start gap-3 rounded-[12px] px-2 -mx-2 py-2.5 hover:bg-fill1 text-left">
              <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: tone }} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="t-callout font-medium text-text truncate">{item ? (item.automation.routine ? t(`routines.${item.automation.routine}`) : item.automation.title) : r.title}</span>
                  <span className="t-caption font-semibold" style={{ color: tone }}>{t(`automations.outcomes.${r.outcome}`)}</span>
                </span>
                {first && <span className="block t-ui text-text2 truncate">{first}</span>}
              </span>
              <span className="t-caption text-text3 tabular shrink-0">{whenText(t, r.started)}</span>
            </motion.button>
          )
        })}
      </div>
    </Card>
  )
}

/** En «Novedades»: las automatizaciones del estudiante de un vistazo (y crear otra). */
export function AutomationsMini({ items }: { items: AutomationItemView[] }) {
  const { t } = useTranslation('inbox')
  const set = useInboxUI((s) => s.set)
  const mine = items.filter((i) => !i.automation.routine)
  return (
    <Card padded="lg">
      <div className="flex items-center justify-between gap-3">
        <button className="t-title2 text-text text-left hover:text-accent-text transition-colors" onClick={() => set({ tab: 'automations' })}>{t('automations.yours')}</button>
        <IconButton size="sm" label={t('automations.new')} onClick={() => set({ editing: blankDraft() })}><Icon name="plus" size={16} /></IconButton>
      </div>
      {mine.length === 0 ? (
        <p className="t-callout text-text3 mt-2">{t('automations.overviewBody')}</p>
      ) : (
        <div className="flex flex-col mt-2">
          {mine.slice(0, 4).map((i, n) => (
            <motion.button key={i.automation.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.1 + n * 0.05 }}
              onClick={() => set({ tab: 'automations', history: i.automation.id })} className="flex items-center gap-3 rounded-[12px] px-2 -mx-2 py-2 hover:bg-fill1 text-left">
              <Icon name={i.automation.capabilities.includes('platform') ? 'globe' : 'history'} size={16} className={i.automation.enabled ? 'text-text2' : 'text-text3'} />
              <span className="min-w-0 flex-1">
                <span className={cx('block t-callout truncate', i.automation.enabled ? 'text-text' : 'text-text2')}>{i.automation.title}</span>
                <span className="block t-ui text-text3 truncate">{i.running ? t('automations.running') : !i.automation.enabled ? t('automations.paused') : i.nextRun ? t('automations.nextRun', { when: whenText(t, i.nextRun) }) : scheduleSummary(t, i.automation.schedule)}</span>
              </span>
              <OutcomeWord item={i} />
            </motion.button>
          ))}
        </div>
      )}
    </Card>
  )
}

function Overview() {
  const { t } = useTranslation('inbox')
  const set = useInboxUI((s) => s.set)
  const examples = t('automations.examples', { returnObjects: true }) as unknown as string[]
  return (
    <Card padded="lg" className="overflow-hidden">
      <div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(55% 70% at 100% 0%, var(--sun-glow), transparent 70%)' }} />
      <div className="relative flex flex-col gap-4 max-w-[640px]">
        <AulaMark size={44} />
        <div>
          <h3 className="t-title2 text-text">{t('automations.overviewTitle')}</h3>
          <p className="t-body text-text2 mt-1.5">{t('automations.overviewBody')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {(Array.isArray(examples) ? examples : []).map((ex, i) => (
            <motion.button key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05 }} whileHover={{ x: 3 }}
              onClick={() => set({ editing: blankDraft(ex, exampleSchedule(i)) })}
              className="flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 bg-fill1 hover:bg-fill2 text-left t-callout text-text">
              <Icon name="plus" size={14} className="text-text3 shrink-0" />
              <span>{ex}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </Card>
  )
}

function OutcomeWord({ item }: { item: AutomationItemView }) {
  const { t } = useTranslation('inbox')
  const tone = outcomeTone(item.lastOutcome)
  if (!tone || !item.lastOutcome) return null
  return <span className="t-caption font-semibold" style={{ color: tone }}>{t(`automations.outcomes.${item.lastOutcome}`)}</span>
}

function AutomationCard({ item }: { item: AutomationItemView }) {
  const { t } = useTranslation('inbox')
  const set = useInboxUI((s) => s.set)
  const [confirm, setConfirm] = useState(false)
  const a = item.automation
  const on = a.enabled && !item.completed
  return (
    <Card interactive padded={false} className="h-full">
      <div className="p-5 flex flex-col gap-3 h-full">
        <div className="flex items-start gap-3">
          <span className={cx('grid place-items-center w-10 h-10 rounded-[12px] shrink-0', on ? 'bg-accent-wash text-accent-text' : 'bg-fill2 text-text3')}>
            {item.running ? <Spinner size={16} /> : <Icon name={iconOr(a.capabilities.includes('platform') ? 'globe' : a.schedule.kind === 'beforeEvents' ? 'bell' : 'history', 'history')} size={19} />}
          </span>
          <button className="min-w-0 flex-1 text-left" onClick={() => set({ history: a.id })}>
            <div className="flex items-baseline gap-1.5">
              <span className={cx('t-headline truncate', on ? 'text-text' : 'text-text2')}>{a.title}</span>
              {a.origin === 'aula' && <span className="t-ui text-text3 shrink-0">· {t('automations.fromAula')}</span>}
            </div>
            <div className="t-ui text-text2 mt-0.5">{scheduleSummary(t, a.schedule)}</div>
          </button>
          <Switch checked={on} onChange={(v) => inboxOps.setEnabled(a.id, v)} label={a.title} />
        </div>
        {a.instruction && (
          // el relleno en el envoltorio y el recorte en el párrafo: así no asoma media tercera línea
          <div className="rounded-[12px] bg-sunken px-3 py-2">
            <p className="t-callout text-text2 line-clamp-2">{a.instruction}</p>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <span className="t-footnote text-text3 min-w-0 line-clamp-2 leading-snug">
            {item.running ? t('automations.running') : item.completed ? t('automations.completed') : !a.enabled ? t('automations.paused') : item.nextRun ? t('automations.nextRun', { when: whenText(t, item.nextRun) }) : item.lastRun ? t('automations.lastRun', { when: whenText(t, item.lastRun) }) : ''}
          </span>
          <OutcomeWord item={item} />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<Icon name="play" size={12} />} disabled={item.running} onClick={() => void inboxOps.runNow(a.id)}>{t('automations.runNow')}</Button>
          <Menu align="end" items={[
            { label: t('automations.edit'), icon: <Icon name="edit" size={14} />, onSelect: () => set({ editing: { id: a.id, title: a.title, instruction: a.instruction, schedule: a.schedule, capabilities: a.capabilities, notify: a.notify, untilFound: a.untilFound } }) },
            { label: t('automations.history'), icon: <Icon name="history" size={14} />, onSelect: () => set({ history: a.id }) },
            { label: t('automations.delete'), icon: <Icon name="trash" size={14} />, danger: true, separatorBefore: true, onSelect: () => setConfirm(true) }
          ]} trigger={(open) => <IconButton size="sm" label={t('actions.more')} onClick={open}><Icon name="more" size={16} /></IconButton>} />
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); inboxOps.remove(a.id) }} danger
        title={t('automations.deleteTitle', { title: a.title })} description={t('automations.deleteBody')} confirmLabel={t('automations.deleteConfirm')} cancelLabel={t('common:actions.cancel')} />
    </Card>
  )
}

function HistoryDrawer({ items }: { items: AutomationItemView[] }) {
  const { t } = useTranslation('inbox')
  const id = useInboxUI((s) => s.history)
  const set = useInboxUI((s) => s.set)
  const item = items.find((i) => i.automation.id === id)
  const { data: runs, loading } = useRpc('automations.runs', { id: id ?? '' }, { skip: !id, events: ['automations.changed'] })
  return (
    <Drawer open={!!item} onClose={() => set({ history: null })} width={460} title={item?.automation.title}>
      {item && (
        <div className="flex flex-col gap-4">
          <p className="t-ui text-text2">{item.automation.routine ? t(`routines.${item.automation.routine}Detail`) : scheduleSummary(t, item.automation.schedule)}</p>
          {item.automation.instruction && <p className="t-callout text-text rounded-[12px] bg-sunken px-3 py-2">{item.automation.instruction}</p>}
          <h3 className="t-headline text-text mt-1">{t('automations.history')}</h3>
          {loading && !runs ? <Spinner /> : !runs?.length ? <p className="t-ui text-text3">{t('automations.noRuns')}</p> : (
            <div className="flex flex-col">
              {runs.slice(0, 30).map((r) => <RunRow key={r.id} run={r} />)}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function RunRow({ run: r }: { run: AutomationRun }) {
  const { t } = useTranslation('inbox')
  const [open, setOpen] = useState(false)
  const tone = outcomeTone(r.outcome) ?? 'var(--text3)'
  const first = (r.summary || r.error || '').split('\n').find((l) => l.trim()) ?? ''
  return (
    <div className="border-t-[0.5px] border-line-soft first:border-t-0 py-2.5">
      <button className="w-full text-left flex items-start gap-3" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: tone }} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="t-callout font-medium text-text tabular">{whenText(t, r.started)}</span>
            <span className="t-caption font-semibold" style={{ color: tone }}>{t(`automations.outcomes.${r.outcome}`)}</span>
            {r.trigger !== 'scheduled' && <span className="t-caption text-text3">{t(`automations.triggers.${r.trigger}`)}</span>}
            {r.notified && <Icon name="bell" size={11} className="text-text3" />}
          </span>
          <span className={cx('block t-ui text-text2', !open && 'truncate')}>{first.replace(/\*\*/g, '')}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className="mt-1 text-text3 shrink-0" />
      </button>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pl-5 pt-2 flex flex-col gap-2">
          {r.summary && <RichText text={r.summary} className="t-ui text-text" />}
          {r.error && <p className="t-ui text-danger">{r.error}</p>}
          {[...r.newItems, ...r.changedItems].map((f, i) => (
            <div key={i} className="t-ui text-text flex gap-2"><span className="text-text3">{f.kind}</span><span>{f.title}</span></div>
          ))}
          {r.skippedActions.length > 0 && <p className="t-footnote text-text2">{t('automations.skipped', { what: r.skippedActions.join(', ') })}</p>}
          {r.created.length > 0 && <p className="t-footnote text-text2">{t('automations.created', { what: r.created.join(', ') })}</p>}
          {(r.provider || r.tokens > 0) && <p className="t-caption text-text3">{[r.provider, r.tokens > 0 ? t('automations.tokens', { count: r.tokens }) : ''].filter(Boolean).join(' · ')}</p>}
        </motion.div>
      )}
    </div>
  )
}
