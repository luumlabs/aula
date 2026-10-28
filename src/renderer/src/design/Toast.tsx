// Avisos breves que entran por abajo a la derecha y se apilan.
import { create } from 'zustand'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { spring } from './tokens'
import i18n from '@renderer/i18n'

type Kind = 'success' | 'info' | 'warning' | 'error'
interface ToastItem {
  id: number
  kind: Kind
  title: ReactNode
  body?: ReactNode
  action?: { label: string; run: () => void }
  duration: number
}

interface ToastState {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()
/** El mismo aviso (mismo tipo y mismo texto) no se apila: el que ya está se queda un rato más. */
const sameText = (a: ToastItem, b: Omit<ToastItem, 'id' | 'duration'>): boolean =>
  a.kind === b.kind && !a.action && !b.action && typeof a.title === 'string' && a.title === b.title && (a.body ?? '') === (b.body ?? '') && (a.body == null || typeof a.body === 'string')

export const useToasts = create<ToastState>((set, get) => {
  const arm = (id: number, ms: number) => {
    clearTimeout(timers.get(id))
    if (ms > 0) timers.set(id, setTimeout(() => get().dismiss(id), ms))
  }
  return {
    items: [],
    push: (t) => {
      const twin = get().items.find((i) => sameText(i, t))
      if (twin) {
        arm(twin.id, twin.duration)
        return twin.id
      }
      const id = ++seq
      const item: ToastItem = { duration: t.kind === 'error' ? 7000 : 4200, ...t, id }
      set({ items: [...get().items.slice(-3), item] })
      arm(id, item.duration)
      return id
    },
    dismiss: (id) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
      set({ items: get().items.filter((i) => i.id !== id) })
    }
  }
})

export const toast = {
  success: (title: ReactNode, body?: ReactNode) => useToasts.getState().push({ kind: 'success', title, body }),
  info: (title: ReactNode, body?: ReactNode) => useToasts.getState().push({ kind: 'info', title, body }),
  warning: (title: ReactNode, body?: ReactNode) => useToasts.getState().push({ kind: 'warning', title, body }),
  error: (title: ReactNode, body?: ReactNode) => useToasts.getState().push({ kind: 'error', title, body }),
  action: (title: ReactNode, action: { label: string; run: () => void }, body?: ReactNode) => useToasts.getState().push({ kind: 'info', title, body, action, duration: 8000 })
}

const icons: Record<Kind, ReactNode> = {
  success: <CheckCircle2 size={18} className="text-success" />,
  info: <Info size={18} className="text-info" />,
  warning: <AlertTriangle size={18} className="text-warning" />,
  error: <XCircle size={18} className="text-danger" />
}

export function Toaster() {
  const { items, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[360px] flex-col gap-2.5" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.96 }}
            transition={spring.bouncy}
            className="pointer-events-auto material-menu rounded-[14px] px-4 py-3.5 flex gap-3 items-start"
          >
            <div className="mt-0.5">{icons[t.kind]}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14px] leading-snug">{t.title}</div>
              {t.body && <div className="text-text2 text-[13px] mt-0.5 leading-snug">{t.body}</div>}
              {t.action && (
                <button className="mt-2 text-[13px] font-bold text-accent-text hover:underline" onClick={() => { t.action!.run(); dismiss(t.id) }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button aria-label={i18n.t('common:actions.close')} className="text-text3 hover:text-text" onClick={() => dismiss(t.id)}>
              <X size={15} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
