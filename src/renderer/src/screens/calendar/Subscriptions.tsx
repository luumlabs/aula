// Calendarios suscritos: pegar el enlace .ics de un calendario (el de la universidad, tu Google Calendar, los festivos…),
// ver cuándo se leyó cada uno, volver a leerlo, cambiarle el nombre o quitarlo. Los enlaces nunca vuelven a la interfaz:
// de cada uno solo se ve su servidor.
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { CalendarSubscriptionView } from '@shared/calendar'
import { Button, ConfirmDialog, Dialog, Icon, IconButton, Spinner, TextField, cx, toast } from '@renderer/design'
import { api, isAulaError } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import i18n from '@renderer/i18n'

/** «hace 5 min», «hace 2 h», «ayer»… */
function ago(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const f = new Intl.RelativeTimeFormat(i18n.language === 'es' ? 'es' : 'en', { numeric: 'auto' })
  const a = Math.abs(s)
  if (a < 60) return f.format(0, 'second')
  if (a < 3600) return f.format(Math.round(s / 60), 'minute')
  if (a < 86_400) return f.format(Math.round(s / 3600), 'hour')
  return f.format(Math.round(s / 86_400), 'day')
}

/** El fallo en el idioma de la interfaz (por su código), o la frase que llegó. */
export function subscriptionErrorText(code: string | undefined, message: string | undefined): string {
  return i18n.t(`calendar:subs.errors.${code ?? 'network'}`, { defaultValue: message ?? i18n.t('calendar:subs.errors.network') })
}

export function SubscriptionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const { data, loading, setData } = useRpc('calendar.subscriptions', undefined, { events: ['calendar.changed'], skip: !open })
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CalendarSubscriptionView | null>(null)
  useEffect(() => {
    if (!open) { setUrl(''); setName(''); setError(null) }
  }, [open])
  const subs = data ?? []

  const subscribe = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const v = await api.invoke('calendar.subscribe', { url: url.trim(), ...(name.trim() ? { name: name.trim() } : {}) })
      setData((list) => [...(list ?? []).filter((x) => x.id !== v.id), v])
      toast.success(t('subs.subscribed', { name: v.name }), t('subs.eventsCount', { count: v.events }))
      setUrl('')
      setName('')
    } catch (err) {
      setError(isAulaError(err) ? subscriptionErrorText(err.code, err.message) : String(err))
    } finally {
      setBusy(false)
    }
  }

  const replace = (v: CalendarSubscriptionView) => setData((list) => (list ?? []).map((x) => (x.id === v.id ? v : x)))
  const remove = async (s: CalendarSubscriptionView) => {
    try {
      await api.invoke('calendar.unsubscribe', { id: s.id })
      setData((list) => (list ?? []).filter((x) => x.id !== s.id))
      toast.success(t('subs.removed'), s.name)
    } catch (err) {
      toast.error(t('subs.removeFailed'), String(err instanceof Error ? err.message : err))
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title={t('subs.title')} description={t('subs.intro')} size="md">
        <form onSubmit={(e) => void subscribe(e)}>
          <TextField label={t('subs.url')} placeholder={t('subs.urlPlaceholder')} value={url} autoFocus spellCheck={false} autoComplete="off"
            icon={<Icon name="link" size={15} />} onChange={(e) => setUrl(e.target.value)} />
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <TextField label={t('subs.name')} placeholder={t('subs.namePlaceholder')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" size="md" className="h-9" loading={busy} disabled={!url.trim()}>{t('subs.subscribe')}</Button>
          </div>
          <AnimatePresence initial={false}>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-3.5 py-2.5 t-ui text-text">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warning" />
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="mt-2.5 flex items-start gap-1.5 t-footnote text-text3">
            <Icon name="lock" size={12} className="mt-[3px] shrink-0" />
            {t('subs.secret')}
          </p>
        </form>
        <div className="mt-6">
          <div className="t-ui font-semibold text-text2 mb-2">{t('subs.yours')}</div>
          {loading && !data ? (
            <div className="grid place-items-center py-6"><Spinner size={16} /></div>
          ) : subs.length === 0 ? (
            <p className="rounded-[16px] border border-dashed border-line px-4 py-4 text-center t-callout text-text3">{t('subs.empty')}</p>
          ) : (
            <div className="overflow-hidden rounded-[16px] border-[0.5px] border-line bg-surface">
              {subs.map((s, i) => <SubscriptionRow key={s.id} s={s} index={i} onChanged={replace} onRemove={() => setRemoving(s)} />)}
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
        title={t('subs.removeConfirm', { name: removing?.name ?? '' })}
        description={t('subs.removeBody')}
        confirmLabel={t('subs.remove')}
        cancelLabel={t('common:actions.cancel')}
        danger
      />
    </>
  )
}

function SubscriptionRow({ s, index, onChanged, onRemove }: { s: CalendarSubscriptionView; index: number; onChanged: (v: CalendarSubscriptionView) => void; onRemove: () => void }) {
  const { t } = useTranslation(['calendar', 'common'])
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.name)
  const refresh = async () => {
    setRefreshing(true)
    try {
      const v = await api.invoke('calendar.refreshSubscription', { id: s.id })
      onChanged(v)
      if (v.error) toast.warning(t('subs.failedTitle', { name: v.name }), subscriptionErrorText(v.errorCode, v.error))
      else toast.success(t('subs.refreshedToast', { name: v.name }), t('subs.eventsCount', { count: v.events }))
    } catch (err) {
      toast.error(t('subs.failedTitle', { name: s.name }), String(err instanceof Error ? err.message : err))
    } finally {
      setRefreshing(false)
    }
  }
  const rename = async () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === s.name) return setDraft(s.name)
    try {
      onChanged(await api.invoke('calendar.renameSubscription', { id: s.id, name: next }))
    } catch (err) {
      setDraft(s.name)
      toast.error(t('subs.renameFailed'), String(err instanceof Error ? err.message : err))
    }
  }
  const status = s.error
    ? subscriptionErrorText(s.errorCode, s.error)
    : [s.host, t('subs.eventsCount', { count: s.events }), s.refreshedAt ? t('subs.refreshed', { when: ago(s.refreshedAt) }) : t('subs.never')].join(' · ')
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className="relative flex items-center gap-3 px-4 py-3 before:absolute before:top-0 before:right-0 before:left-[52px] before:h-[0.5px] before:bg-line-soft first:before:hidden"
    >
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-[9px]', s.error ? 'bg-warning-soft text-warning' : 'bg-tile text-text2')}>
        <Icon name={s.error ? 'alert' : 'calendar'} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input autoFocus value={draft} maxLength={80} aria-label={t('subs.rename')} onChange={(e) => setDraft(e.target.value)} onBlur={() => void rename()}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            className="h-7 w-full rounded-[8px] bg-field border-[0.5px] border-accent-line px-2 t-callout text-text outline-none shadow-[0_0_0_3px_var(--accent-wash)]" />
        ) : (
          <button className="group/name flex max-w-full items-center gap-1.5 t-callout font-medium text-text text-left" onClick={() => { setDraft(s.name); setEditing(true) }} title={t('subs.rename')}>
            <span className="truncate">{s.name}</span>
            <Icon name="edit" size={12} className="shrink-0 text-text3 opacity-0 transition-opacity group-hover/name:opacity-100" />
          </button>
        )}
        <div className={cx('t-ui truncate', s.error ? 'text-warning' : 'text-text3')} title={status}>{status}</div>
      </div>
      <IconButton label={t('subs.refresh')} size="sm" onClick={() => void refresh()} disabled={refreshing}>
        {refreshing ? <Spinner size={12} /> : <Icon name="refresh" size={14} />}
      </IconButton>
      <IconButton label={t('subs.remove')} size="sm" className="hover:text-danger" onClick={onRemove}>
        <Icon name="trash" size={14} />
      </IconButton>
    </motion.div>
  )
}
