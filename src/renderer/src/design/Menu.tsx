// Menú desplegable (y contextual) de cristal.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { cx } from './cx'
import { placePopover } from './popover'

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

export function Menu({ trigger, items, align = 'end' }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: 'start' | 'end' }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!rect) return
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-aula-menu]')) setRect(null)
    }
    // Esc cierra el menú y nada más (antes también salía de la lección que lo contenía): en captura y marcado como atendido
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setRect(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('blur', () => setRect(null), { once: true })
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [rect])
  const open = () => {
    setSize(null)
    setRect(anchor.current?.getBoundingClientRect() ?? null)
  }
  // debajo si cabe; cerca del borde inferior, encima (nunca fuera de la ventana). Primero con una estimación y, antes de
  // pintar, con lo que mide de verdad (opciones de dos líneas, etiquetas largas: A4-P1-3)
  const menu = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const estimate = { width: 240, height: items.reduce((h, it) => h + 36 + (it.separatorBefore ? 9 : 0), 12) }
  useLayoutEffect(() => {
    const el = menu.current
    if (!rect || !el) return
    const real = { width: el.offsetWidth, height: el.scrollHeight }
    setSize((s) => (s && s.width === real.width && s.height === real.height ? s : real))
  }, [rect, items.length])
  const place = rect ? placePopover(rect, { width: window.innerWidth, height: window.innerHeight }, size ?? estimate, { align }) : null
  return (
    <span ref={anchor} className="inline-flex" data-aula-menu>
      {trigger(open)}
      {createPortal(
        <AnimatePresence>
          {rect && (
            <motion.div
              ref={menu}
              data-aula-menu
              role="menu"
              className="fixed z-[95] material-menu rounded-[14px] p-1.5 min-w-[220px] overflow-auto overscroll-contain"
              style={{ ...(align === 'end' ? { right: Math.max(8, window.innerWidth - rect.right) } : { left: place!.left }), top: place!.top, bottom: place!.bottom, maxHeight: place!.maxHeight }}
              initial={{ opacity: 0, y: place!.above ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: place!.above ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              {items.map((it, i) => (
                <div key={i}>
                  {it.separatorBefore && <div className="h-px bg-line my-1 mx-2" />}
                  <button
                    role="menuitem"
                    disabled={it.disabled}
                    className={cx('w-full flex items-center gap-2.5 rounded-[11px] px-3 py-2 text-left text-[14px] font-medium hover:bg-fill1 disabled:opacity-40', it.danger && 'text-danger')}
                    onClick={() => {
                      setRect(null)
                      it.onSelect()
                    }}
                  >
                    <span className="w-4 grid place-items-center">{it.icon}</span>
                    {it.label}
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </span>
  )
}
