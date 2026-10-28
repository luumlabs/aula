// Pista flotante sencilla (aparece tras una pausa breve).
// Se mide antes de pintarse y se coloca dentro de la ventana (`placeTooltip`), con su propio ancho (nunca una columna de una
// palabra por línea). Con el teclado solo aparece si el foco es visible, y se va al pulsar: si el botón abre un menú, la pista
// no se queda encima (A4-P2-9).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { placeTooltip } from './popover'

type Side = 'top' | 'bottom' | 'right' | 'left'

export function Tooltip({ label, children, side = 'top', delay = 350 }: { label: ReactNode; children: ReactNode; side?: Side; delay?: number }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect()
      if (r) setAnchor(r)
    }, delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setAnchor(null)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  useLayoutEffect(() => {
    const el = tip.current
    if (!anchor || !el) return
    const p = placeTooltip(anchor, { width: window.innerWidth, height: window.innerHeight }, { width: el.offsetWidth, height: el.offsetHeight }, side)
    setPos({ left: p.left, top: p.top })
  }, [anchor, side])
  return (
    <span
      ref={ref}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && hide()}
      onFocus={(e) => {
        const t = e.target as HTMLElement
        if (t.matches?.(':focus-visible')) show()
      }}
      onBlur={hide}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {anchor && (
            <motion.div
              ref={tip}
              role="tooltip"
              className="pointer-events-none fixed left-0 top-0 z-[100] w-max max-w-[260px]"
              style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.14 }}
            >
              <div className="rounded-[10px] bg-text text-paper text-[12.5px] font-semibold px-2.5 py-1.5 shadow-lg">{label}</div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </span>
  )
}
