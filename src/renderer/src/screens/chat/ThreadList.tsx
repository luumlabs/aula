// Lista de conversaciones agrupadas (Fijadas, Hoy, Ayer, Antes), con búsqueda.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { AulaMark, Button, Dialog, Icon, Menu, TextField, cx, spring, toast } from '@renderer/design'
import type { AssistantThreadSummary } from '@shared/assistant/types'
import { daysUntil, fmtDate, fmtTime } from '@renderer/lib/format'
import { api } from '@renderer/lib/api'
import { useBusyThreads } from './liveStatus'
import { scheduleDelete, undoDelete } from './deletion'

export function ThreadList({ threads, active, onOpen, onNew }: { threads: AssistantThreadSummary[]; active: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const { t } = useTranslation('chat')
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const live = useBusyThreads()
  // borrar se puede deshacer: la conversación (y sus adjuntos) solo se borra cuando pasa el aviso (J2-4)
  const remove = (x: AssistantThreadSummary) => {
    scheduleDelete(x.id)
    toast.action(t('deletedToast', { title: x.title || t('newThread') }), { label: t('undo'), run: () => void undoDelete(x.id) })
  }
  const saveRename = () => {
    if (!renaming) return
    const title = renaming.title.trim()
    if (title) void api.invoke('chat.renameThread', { id: renaming.id, title }).catch((e: Error) => toast.error(e.message))
    setRenaming(null)
  }
  const groups = useMemo(() => {
    const list = threads.filter((x) => !q || `${x.title} ${x.preview}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.updated.localeCompare(a.updated))
    const g: { key: string; label: string; items: AssistantThreadSummary[] }[] = [
      { key: 'p', label: t('pinned'), items: list.filter((x) => x.pinned) },
      { key: 't', label: t('today'), items: list.filter((x) => !x.pinned && daysUntil(x.updated) === 0) },
      { key: 'y', label: t('yesterday'), items: list.filter((x) => !x.pinned && daysUntil(x.updated) === -1) },
      { key: 'e', label: t('earlier'), items: list.filter((x) => !x.pinned && daysUntil(x.updated) < -1) }
    ]
    return g.filter((x) => x.items.length)
  }, [threads, q, t])
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-1">
        <h2 className="t-title2 text-[19px]">{t('threads')}</h2>
        <Button size="sm" variant="ghost" icon={<Icon name="new-chat" size={15} />} onClick={onNew} aria-label={t('newThread')} />
      </div>
      <div className="mt-3">
        <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} icon={<Icon name="search" size={14} />} />
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {!threads.length && <p className="t-callout text-text3 px-2 py-4">{t('noThreads')}</p>}
        {groups.map((g) => (
          <div key={g.key} className="mb-3">
            <div className="t-ui font-semibold text-text3 px-2 mb-1">{g.label}</div>
            {g.items.map((x, i) => (
              <motion.div key={x.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, delay: i * 0.03 }} className="group relative">
                <button onClick={() => onOpen(x.id)} className={cx('relative w-full rounded-[12px] px-2.5 py-2 text-left transition-colors', x.id !== active && 'hover:bg-fill1')}>
                  {x.id === active && <motion.span layoutId="thread-active" transition={spring.snappy} className="absolute inset-0 rounded-[12px] bg-selected" />}
                  <span className="relative flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 t-callout font-medium">
                      {/* respondiendo: el atardecer de la marca, en pequeño */}
                      {live[x.id] ? <AulaMark size={14} state="working" label={t('answering')} /> : x.pinned && <Icon name="pin" size={12} className="text-text3 shrink-0" />}
                      <span className="min-w-0 truncate" title={x.title}>{x.title}</span>
                    </span>
                    <span className="t-caption shrink-0">{daysUntil(x.updated) === 0 ? fmtTime(x.updated) : fmtDate(x.updated, { day: 'numeric', month: 'short' })}</span>
                  </span>
                  <span className="relative block t-ui text-text3 truncate">{plainPreview(x.preview)}</span>
                </button>
                <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Menu
                    trigger={(open) => (
                      <button className="grid place-items-center w-6 h-6 rounded-[6px] bg-surface text-text3 hover:text-text shadow-[var(--e1)]" onClick={(e) => { e.stopPropagation(); open() }} aria-label={t('moreActions')}>
                        <Icon name="more" size={13} />
                      </button>
                    )}
                    items={[
                      { label: x.pinned ? t('unpin') : t('pin'), icon: <Icon name="pin" size={14} />, onSelect: () => void api.invoke('chat.pinThread', { id: x.id, pinned: !x.pinned }).catch(() => {}) },
                      { label: t('renameMenu'), icon: <Icon name="edit" size={14} />, onSelect: () => setRenaming({ id: x.id, title: x.title }) },
                      { label: t('delete'), icon: <Icon name="trash" size={14} />, danger: true, onSelect: () => remove(x) }
                    ]}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        ))}
      </div>
      <Dialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        size="sm"
        title={t('renameTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>{t('save.cancel')}</Button>
            <Button variant="primary" disabled={!renaming?.title.trim()} onClick={saveRename}>{t('save.save')}</Button>
          </div>
        }
      >
        <TextField
          autoFocus
          value={renaming?.title ?? ''}
          maxLength={120}
          aria-label={t('renameTitle')}
          onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))}
          onKeyDown={(e) => { if (e.key === 'Enter') saveRename() }}
        />
      </Dialog>
    </div>
  )
}

/** Vista previa sin marcas: quita bloques, fórmulas en LaTeX y Markdown para que se lea como frase. */
export function plainPreview(s: string): string {
  return s
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\$\$?([^$]*)\$\$?/g, (_, m: string) => m.replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, ''))
    // solo las marcas de Markdown: «Exam #2» conserva su «#» (J2-18)
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
