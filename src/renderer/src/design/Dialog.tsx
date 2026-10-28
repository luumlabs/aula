// Diálogo modal y panel lateral de cristal, con fondo difuminado, Escape para cerrar y foco atrapado.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from './cx'
import { spring } from './tokens'
import { IconButton } from './Button'
import i18n from '@renderer/i18n'
import { useTabTrap } from './focusTrap'

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => {
      // un control con su propio Esc abierto dentro (el selector de «@» del chat) lo cierra él, no el panel entero
      const own = (e.target as HTMLElement | null)?.closest?.('[data-own-escape="true"]')
      // un menú o una lista abiertos encima (en un portal) se cierran ellos primero; el diálogo, con el siguiente Esc
      const popup = document.querySelector('[role="menu"][data-aula-menu], [role="listbox"][data-aula-select]')
      if (e.key === 'Escape' && !own && !popup) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', fn, true)
    return () => window.removeEventListener('keydown', fn, true)
  }, [open, onClose])
}

function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      const root = ref.current
      if (!root) return
      // si React ya enfocó un campo (autoFocus) dentro del diálogo, se respeta; si no, el primer campo y luego el primer botón
      if (root.contains(document.activeElement)) return
      const el =
        root.querySelector<HTMLElement>('[autofocus]') ??
        root.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select') ??
        root.querySelector<HTMLElement>('button:not([data-close]), [tabindex="0"]')
      el?.focus()
    }, 30)
    return () => {
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open])
  // y Tab no sale de la capa a la página tapada por el velo (A4-P2-11)
  useTabTrap(ref, open)
  return ref
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  hideClose?: boolean
  className?: string
}

const widths = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]', xl: 'max-w-[1040px]', full: 'max-w-[min(1320px,94vw)]' }

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', hideClose, className }: DialogProps) {
  useEscape(open, onClose)
  const ref = useFocusTrap(open)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/20 dark:bg-black/45" onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            className={cx('relative w-full bg-raised border-[0.5px] border-line shadow-[var(--e4)] rounded-[24px] p-7 max-h-[88vh] overflow-auto', widths[size], className)}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring.bouncy}
          >
            {!hideClose && (
              <IconButton label={i18n.t('common:actions.close')} data-close size="sm" className="absolute right-4 top-4" onClick={onClose}>
                <X size={16} />
              </IconButton>
            )}
            {title && <h2 className="t-title2 pr-10">{title}</h2>}
            {description && <p className="text-text2 mt-1.5">{description}</p>}
            {children && <div className={cx(title || description ? 'mt-5' : '')}>{children}</div>}
            {footer && <div className="mt-6 flex items-center justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function Drawer({ open, onClose, children, side = 'right', width = 440, title, className }: { open: boolean; onClose: () => void; children: ReactNode; side?: 'right' | 'left'; width?: number; title?: ReactNode; className?: string }) {
  useEscape(open, onClose)
  const ref = useFocusTrap(open)
  const off = side === 'right' ? width + 40 : -(width + 40)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/10 dark:bg-black/35" onClick={onClose} />
          <motion.aside
            ref={ref}
            className={cx('absolute top-[calc(var(--titlebar-h,0px)+12px)] bottom-3 bg-raised border-[0.5px] border-line shadow-[var(--e4)] rounded-[24px] flex flex-col overflow-hidden', side === 'right' ? 'right-3' : 'left-3', className)}
            style={{ width }}
            initial={{ x: off, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: off, opacity: 0.6 }}
            transition={spring.smooth}
          >
            {title && (
              <div className="flex items-center justify-between px-5 pt-5 pb-2">
                <h2 className="t-title2">{title}</h2>
                <IconButton label={i18n.t('common:actions.close')} data-close size="sm" onClick={onClose}>
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-auto">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/** Confirmación sencilla (Sí/No). */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; description?: ReactNode; confirmLabel: string; cancelLabel: string; danger?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm"
      footer={
        <>
          <button className="h-10 px-4 rounded-[13px] font-semibold text-text2 hover:bg-fill1" onClick={onClose}>{cancelLabel}</button>
          <button className={cx('h-10 px-4 rounded-[13px] font-semibold text-white', danger ? 'bg-danger-fill text-white' : 'bg-accent text-on-accent')} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
        </>
      }
    />
  )
}
