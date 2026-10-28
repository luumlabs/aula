// «Aula no puede abrir el llavero»: aparece en la barra lateral si el sistema no deja leer secrets.enc (aviso del llavero
// denegado, llavero bloqueado o aún cerrado en Linux). Mientras, Aula no guarda ni borra claves ni sesiones, así que no se
// pierde nada. Salidas: «Reintentar» (vuelve a preguntar al llavero) o, en el diálogo, «Empezar de cero» (aparta el archivo
// como secrets.unreadable-<fecha>.enc, no lo borra) para volver a pegar las claves e iniciar sesión.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Dialog, Icon, cx, spring } from '@renderer/design'
import { api } from '@renderer/lib/api'
import type { SecretsState } from '@shared/ipc/secrets'

function useSecretsState(): [SecretsState, (s: SecretsState) => void] {
  const [state, setState] = useState<SecretsState>({ locked: false })
  useEffect(() => {
    let alive = true
    api.invoke('secrets.status').then((s) => alive && setState(s)).catch(() => {})
    const off = api.on('secrets.changed', (s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return [state, setState]
}

export function KeychainNotice({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('security')
  const [state, setState] = useSecretsState()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'retry' | 'reset' | null>(null)
  const [stillLocked, setStillLocked] = useState(false)

  const retry = async () => {
    setBusy('retry')
    try {
      const s = await api.invoke('secrets.retry')
      setState(s)
      setStillLocked(s.locked)
      if (!s.locked) setOpen(false)
    } finally {
      setBusy(null)
    }
  }
  const reset = async () => {
    setBusy('reset')
    try {
      setState(await api.invoke('secrets.reset'))
      setOpen(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <AnimatePresence>
        {state.locked && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={spring.smooth} className="px-2 pb-2">
            <button
              onClick={() => { setStillLocked(false); setOpen(true) }}
              title={t('keychain.title')}
              className={cx('no-drag w-full flex items-center gap-2.5 rounded-[12px] bg-warning-soft px-2.5 py-2 text-left hover:brightness-[0.98]', collapsed && 'justify-center px-0')}
            >
              <span className="text-warning shrink-0"><Icon name="key" size={16} /></span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block t-footnote font-medium text-text truncate">{t('keychain.title')}</span>
                  <span className="block t-caption text-warning">{t('keychain.open')}</span>
                </span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={t('keychain.title')}
        description={t(`keychain.why.${state.reason ?? 'decrypt'}`)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void reset()} loading={busy === 'reset'} disabled={busy !== null}>{t('keychain.reset')}</Button>
            <Button variant="primary" onClick={() => void retry()} loading={busy === 'retry'} disabled={busy !== null}>{t('keychain.retry')}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 t-body text-text2">
          <p>{t('keychain.safe')}</p>
          <p>{t('keychain.howRetry')}</p>
          <p className="t-footnote text-text3">{t('keychain.howReset')}</p>
          {stillLocked && <p className="t-footnote text-warning" role="status">{t('keychain.stillLocked')}</p>}
        </div>
      </Dialog>
    </>
  )
}
