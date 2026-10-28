// «Lo que Aula recuerda de ti»: los recuerdos por secciones, con buscar, corregir, olvidar, pausar, exportar y borrar todo.
// El interruptor general es Ajustes → Datos → Memoria (settings.data.memory).
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Card, ConfirmDialog, Icon, IconButton, Menu, SectionTitle, Spinner, TextField, toast, cx } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { fmtDate } from '@renderer/lib/format'
import type { MemoryRecordView, MemoryStatus } from '@shared/ipc/memory'

const GROUPS: MemoryRecordView['group'][] = ['about', 'learning', 'exams', 'progress', 'other']

export function MemoryCard() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [items, setItems] = useState<MemoryRecordView[] | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = async () => {
    try {
      const [s, list] = await Promise.all([api.invoke('memory.status'), api.invoke('memory.list', {})])
      setStatus(s)
      setItems(list)
    } catch {
      setItems([])
    }
  }
  useEffect(() => {
    void load()
    return api.on('memory.changed', () => void load())
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter((m) => m.status === 'active' && (!q || m.text.toLowerCase().includes(q) || m.courseTitle?.toLowerCase().includes(q)))
  }, [items, query])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) toast.success(ok)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const paused = !!status?.pausedUntil
  const disabled = status && !status.enabled
  return (
    <Card padded="lg" className="h-full flex flex-col">
      <SectionTitle
        title={t('memory.title')}
        detail={disabled ? t('memory.off') : paused ? t('memory.paused') : t('memory.count', { count: status?.active ?? 0 })}
        action={
          <Menu
            trigger={(open) => (
              <IconButton label={t('memory.more')} onClick={open}>
                <Icon name="more" size={16} />
              </IconButton>
            )}
            items={[
              paused
                ? { label: t('memory.resume'), icon: <Icon name="play" size={15} />, onSelect: () => void run(() => api.invoke('memory.pause', { until: null })) }
                : { label: t('memory.pauseDay'), icon: <Icon name="pause" size={15} />, onSelect: () => void run(() => api.invoke('memory.pause', { until: new Date(Date.now() + 86400000).toISOString() })) },
              { label: t('memory.export'), icon: <Icon name="download" size={15} />, onSelect: () => void exportMemory() },
              { label: t('memory.clear'), icon: <Icon name="trash" size={15} />, danger: true, separatorBefore: true, onSelect: () => setConfirmClear(true) }
            ]}
          />
        }
      />
      <p className="t-ui text-text3 -mt-1 mb-3">{t('memory.body')}</p>
      <div className="flex gap-2 mb-3">
        <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('memory.search')} icon={<Icon name="search" size={15} />} className="flex-1" />
      </div>
      <div className="flex-1 min-h-0 max-h-[420px] overflow-y-auto -mx-2 px-2">
        {items == null ? (
          <div className="grid place-items-center py-8">
            <Spinner size={16} />
          </div>
        ) : shown.length === 0 ? (
          <p className="t-body text-text2 py-4">{query ? t('memory.noMatch') : t('memory.empty')}</p>
        ) : (
          GROUPS.map((g) => {
            const list = shown.filter((m) => m.group === g)
            if (!list.length) return null
            return (
              <div key={g} className="mb-4">
                <div className="t-footnote font-semibold text-text3 mb-1.5">{t(`memory.groups.${g}`)}</div>
                <div className="grid grid-cols-1 gap-1.5 [&>*]:min-w-0">
                  <AnimatePresence initial={false}>
                    {list.map((m) => (
                      <motion.div key={m.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="group/mem rounded-[12px] bg-sunken px-3 py-2.5">
                        {editing?.id === m.id ? (
                          <div className="flex gap-2">
                            <TextField value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} autoFocus className="flex-1" onKeyDown={(e) => e.key === 'Enter' && void run(() => api.invoke('memory.edit', { id: m.id, text: editing.text }).then(() => setEditing(null)))} />
                            <Button size="sm" variant="primary" onClick={() => void run(() => api.invoke('memory.edit', { id: m.id, text: editing.text }).then(() => setEditing(null)))}>
                              {t('memory.save')}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="t-callout text-text [overflow-wrap:anywhere]">{m.text}</div>
                              <div className="t-caption text-text3 mt-0.5">
                                {[t(`memory.sources.${m.source}`), m.courseTitle, fmtDate(m.updatedAt, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                            <div className={cx('flex gap-0.5 opacity-0 group-hover/mem:opacity-100 focus-within:opacity-100 transition-opacity')}>
                              <IconButton size="sm" label={t('memory.edit')} onClick={() => setEditing({ id: m.id, text: m.text })}>
                                <Icon name="edit" size={14} />
                              </IconButton>
                              <IconButton size="sm" label={t('memory.forget')} onClick={() => void run(() => api.invoke('memory.forget', { ids: [m.id] }), t('memory.forgotten'))}>
                                <Icon name="trash" size={14} />
                              </IconButton>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t-[0.5px] border-line-soft">
        <TextField value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t('memory.addPlaceholder')} className="flex-1" onKeyDown={(e) => e.key === 'Enter' && adding.trim() && void run(() => api.invoke('memory.add', { text: adding.trim() }).then(() => setAdding('')))} />
        <Button disabled={!adding.trim() || !!disabled} onClick={() => void run(() => api.invoke('memory.add', { text: adding.trim() }).then(() => setAdding('')))}>
          {t('memory.add')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void run(() => api.invoke('memory.clear'), t('memory.cleared'))}
        danger
        title={t('memory.clearTitle')}
        description={t('memory.clearBody')}
        confirmLabel={t('memory.clear')}
        cancelLabel={t('common:actions.cancel')}
      />
    </Card>
  )

  async function exportMemory() {
    try {
      const { fileName, json } = await api.invoke('memory.export')
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
}
