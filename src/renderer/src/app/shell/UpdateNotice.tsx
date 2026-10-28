// El aviso de actualizaciones de la barra lateral (A1-P1-3):
//   · «Versión X lista · Reiniciar para actualizar» (la versión ya descargada y comprobada);
//   · «Versión X sin instalar · Ver por qué»: esta copia no puede instalarla sola (Descargas o el .dmg, carpeta sin
//     permiso, firma no válida, un fallo al cambiarla, la vuelta atrás…). Abre Ajustes → Acerca de, que explica qué hacer;
//   · «Versión X disponible · Cómo instalarla»: la .deb de Linux, que nunca se instala sola.
// Los dos últimos se pueden descartar (hasta que haya otra versión). Mientras se vuelve a buscar, el aviso se queda.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, LiveDot, cx, spring } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { noticeKey, updateNotice, useUpdateState, type UpdateNoticeView } from '@renderer/lib/updates'
import { navigate } from '../router'

const DISMISSED_KEY = 'aula.updates.noticeDismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function writeDismissed(key: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, key)
  } catch {
    /* sin almacenamiento: se descarta solo hasta reiniciar */
  }
}

/** El aviso que toca, sin parpadear mientras se vuelve a buscar. */
function useNotice(): UpdateNoticeView | null {
  const upd = useUpdateState()
  const last = useRef<UpdateNoticeView | null>(null)
  const now = updateNotice(upd)
  if (upd.status !== 'checking') last.current = now
  return upd.status === 'checking' ? last.current : now
}

export function UpdateNotice({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('updates')
  const notice = useNotice()
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed())
  useEffect(() => setDismissed(readDismissed()), [notice?.kind, notice?.version])
  const visible = notice && (notice.kind === 'ready' || dismissed !== noticeKey(notice)) ? notice : null

  const title = visible ? t(`notice.${visible.kind}`, { version: visible.version }) : ''
  const action = visible ? t(visible.kind === 'ready' ? 'notice.restart' : visible.kind === 'manual' ? 'notice.why' : 'notice.how') : ''
  const open = () => {
    if (!visible) return
    if (visible.kind === 'ready') void api.invoke('updates.install')
    else navigate({ name: 'settings', section: 'about' })
  }
  const dismiss = () => {
    if (!visible) return
    writeDismissed(noticeKey(visible))
    setDismissed(noticeKey(visible))
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div key={visible.kind} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={spring.smooth} className="px-2 pb-2">
          <div className={cx('relative rounded-[12px]', visible.kind === 'ready' ? 'bg-accent-wash' : 'bg-warning-soft')}>
            <button
              onClick={open}
              title={`${title} · ${action}`}
              className={cx('no-drag w-full flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left hover:brightness-[0.98]', collapsed ? 'justify-center px-0' : visible.kind !== 'ready' && 'pr-8')}
            >
              {visible.kind === 'ready' ? <LiveDot color="var(--sun)" /> : <span className="text-warning shrink-0"><Icon name="download" size={16} /></span>}
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block t-footnote font-medium text-text truncate">{title}</span>
                  <span className={cx('block t-caption', visible.kind === 'ready' ? 'text-accent-text' : 'text-warning')}>{action}</span>
                </span>
              )}
            </button>
            {!collapsed && visible.kind !== 'ready' && (
              <button
                onClick={dismiss}
                aria-label={t('notice.dismiss')}
                title={t('notice.dismiss')}
                className="no-drag absolute right-1.5 top-1.5 grid place-items-center w-6 h-6 rounded-[8px] text-text3 hover:text-text hover:bg-fill1"
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
