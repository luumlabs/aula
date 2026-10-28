// Ajustes → Acerca de: la parte de las actualizaciones (estado, notas de la versión nueva y el botón que toca).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Dialog, ProgressBar, cx } from '@renderer/design'
import { RichText } from '@renderer/lib/RichText'
import { api } from '@renderer/lib/api'
import { updateView, type UpdateAction } from '@renderer/lib/updates'
import { notesForLanguage } from '@shared/release-notes'
import type { UpdateState } from '@shared/ipc/updates'

/** Estado + notas (va en el cuerpo de la tarjeta). */
export function UpdateStatus({ state, asked, current }: { state: UpdateState; asked: boolean; current: string }) {
  const { t, i18n } = useTranslation('updates')
  const [notesOpen, setNotesOpen] = useState(false)
  const v = updateView(state, asked, current)
  const notes = notesForLanguage(state.notes, i18n.language)
  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {v.message && (
          <motion.div
            key={v.message}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2"
            role="status"
            aria-live="polite"
          >
            <div className={cx('t-ui', v.tone === 'accent' ? 'text-accent-text' : v.tone === 'warning' ? 'text-warning' : 'text-text2')}>{t(v.message, v.params)}</div>
            {v.progress !== undefined && v.progress < 1 && <ProgressBar value={v.progress} className="mt-2" label={t(v.message, v.params)} />}
            {v.hasNotes && notes && (
              <button type="button" onClick={() => setNotesOpen(true)} className="mt-1 t-ui text-accent-text underline underline-offset-2 hover:no-underline">
                {t('actions.notes')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        title={t('notes.title', { version: state.version ?? '' })}
        size="md"
        footer={
          <Button size="md" onClick={() => setNotesOpen(false)}>
            {t('notes.close')}
          </Button>
        }
      >
        <div className="max-h-[55vh] overflow-y-auto pr-1 t-body">{notes && <RichText text={notes} />}</div>
      </Dialog>
    </>
  )
}

/** El botón (o los dos) que tocan ahora (va al pie de la tarjeta). */
export function UpdateButtons({ state, asked, current, onAsk }: { state: UpdateState; asked: boolean; current: string; onAsk: () => void }) {
  const { t } = useTranslation('updates')
  const v = updateView(state, asked, current)
  const run = (a: UpdateAction) => {
    if (a === 'restart') void api.invoke('updates.install').catch(() => {})
    else if (a === 'download') void api.invoke('updates.openDownloadPage').catch(() => {})
    else {
      onAsk()
      void api.invoke('updates.check').catch(() => {})
    }
  }
  const label: Record<UpdateAction, string> = { check: t('actions.check'), restart: t('actions.restart'), download: t('actions.download'), retry: t('actions.retry') }
  const busy = state.status === 'checking'
  return (
    <div className="flex items-center gap-2">
      {v.secondary && (
        <Button size="md" variant="ghost" disabled={busy} onClick={() => run(v.secondary!)}>
          {label[v.secondary]}
        </Button>
      )}
      <Button
        size="md"
        variant={v.primary === 'restart' || v.primary === 'download' ? 'primary' : 'secondary'}
        loading={v.primary === 'check' && busy}
        disabled={v.primary === 'check' && state.status === 'downloading'}
        onClick={() => run(v.primary)}
      >
        {label[v.primary]}
      </Button>
    </div>
  )
}
