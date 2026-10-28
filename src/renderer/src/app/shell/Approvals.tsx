// Permisos de Aula en tus plataformas: cuando la IA quiere hacer algo que no es solo leer (pulsar, abrir, descargar),
// aparece esta hoja con lo que quiere hacer, dónde y por qué. Sin respuesta a tiempo, se deniega sola.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { AulaMark, Button, Icon, ProgressBar, spring } from '@renderer/design'
import { api } from '@renderer/lib/api'
import type { PlatformApprovalRequest } from '@shared/platforms/types'

export function Approvals() {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<PlatformApprovalRequest[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    api
      .invoke('platforms.approvals')
      .then((list) => setQueue(list))
      .catch(() => {})
    return api.on('platforms.approval', (e) => {
      if ('request' in e) setQueue((q) => (q.some((r) => r.id === e.request.id) ? q : [...q, e.request]))
      else setQueue((q) => q.filter((r) => r.id !== e.resolved.id))
    })
  }, [])

  const current = queue[0]
  useEffect(() => {
    if (!current) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [current])

  const answer = (allow: boolean) => {
    if (!current) return
    setQueue((q) => q.slice(1))
    void api.invoke('platforms.approve', { id: current.id, allow }).catch(() => {})
  }

  const total = current ? Math.max(1, Date.parse(current.expiresAt) - Date.parse(current.createdAt)) : 1
  const left = current ? Math.max(0, Date.parse(current.expiresAt) - now) : 0
  const host = current?.url ?? current?.pageURL
  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          role="alertdialog"
          aria-labelledby="aula-approval-title"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={spring.smooth}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(520px,92vw)] rounded-[22px] bg-raised border-[0.5px] border-line shadow-[var(--e4)] p-5"
        >
          <div className="flex items-start gap-3.5">
            <AulaMark size={34} state="waiting" />
            <div className="min-w-0 flex-1">
              <div id="aula-approval-title" className="t-headline text-text">
                {t(`approval.action.${current.action}`, { label: current.label })}
              </div>
              <p className="t-callout text-text2 mt-1">{current.reason}</p>
              {host && (
                <div className="t-footnote text-text3 mt-2 flex items-center gap-1.5 min-w-0">
                  <Icon name="globe" size={13} />
                  <span className="truncate">{safeHost(host)}</span>
                </div>
              )}
            </div>
          </div>
          <ProgressBar value={left / total} height={3} color="var(--line-strong)" className="mt-4" label={t('approval.timeLeft')} />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="t-caption text-text3">{t('approval.autoDeny', { seconds: Math.ceil(left / 1000) })}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => answer(false)}>
                {t('approval.deny')}
              </Button>
              <Button variant="primary" onClick={() => answer(true)}>
                {t('approval.allow')}
              </Button>
            </div>
          </div>
          {queue.length > 1 && <div className="t-caption text-text3 mt-2">{t('approval.more', { count: queue.length - 1 })}</div>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function safeHost(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname.length > 1 ? u.pathname : '')
  } catch {
    return url
  }
}
